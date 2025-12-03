import tape from "tape";
import {
  server as WebSocketServer,
  w3cwebsocket as WebSocket,
} from "websocket";
import { createServer, type Server } from "node:http";
import { KeepAliveWebSocket } from "./KeepAliveWebSocket";

tape("basic", async (assert: tape.Test) => {
  let websocket: KeepAliveWebSocket | undefined;
  let httpServer: Server | undefined;
  let wsServer: WebSocketServer | undefined;
  try {
    httpServer = createServer((request, response) => {
      response.writeHead(404);
      response.end();
    });
    httpServer.listen(7823);
    wsServer = new WebSocketServer({
      httpServer,
      autoAcceptConnections: true,
    });
    wsServer.on("connect", (connection) => {
      connection.on("message", (message) => {
        if (message.type === "utf8") {
          connection.sendUTF(message.utf8Data);
        }
      });
    });

    websocket = new KeepAliveWebSocket({
      url: () => "ws://localhost:7823",
      WebSocket: WebSocket as never,
      autoconnect: true,
      minTimeBetweenReconnectsMS: 1000,
    });

    const message1Promise = websocket.message();
    await websocket.ready();
    websocket.send("Hello");
    assert.equal(await message1Promise, "Hello");

    const disconnectPromise = websocket.waitOnce("disconnect");
    wsServer.closeAllConnections();
    await disconnectPromise;

    const message2Promise = websocket.message();
    await websocket.ready();
    websocket.send("world!");
    assert.equal(await message2Promise, "world!");

    assert.end();
  } finally {
    websocket?.close();
    wsServer?.closeAllConnections();
    httpServer?.close();
  }
});

tape("exponential backoff", async (assert: tape.Test) => {
  let websocket: KeepAliveWebSocket | undefined;
  let httpServer: Server | undefined;
  let wsServer: WebSocketServer | undefined;
  const connectionAttempts: number[] = [];
  let connectionCount = 0;

  try {
    httpServer = createServer((request, response) => {
      response.writeHead(404);
      response.end();
    });
    httpServer.listen(7824);

    wsServer = new WebSocketServer({
      httpServer,
      autoAcceptConnections: false,
    });

    // Track connection attempts and reject the first 3
    wsServer.on("request", (request) => {
      const timestamp = Date.now();
      connectionAttempts.push(timestamp);
      connectionCount++;

      if (connectionCount <= 3) {
        // Reject first 3 connections to trigger retries
        request.reject();
      } else {
        // Accept the 4th connection
        request.accept();
      }
    });

    const startTime = Date.now();
    websocket = new KeepAliveWebSocket({
      url: () => "ws://localhost:7824",
      WebSocket: WebSocket as never,
      autoconnect: true,
      minTimeBetweenReconnectsMS: 100, // 100ms base delay
      maxTimeBetweenReconnectsMS: 1000, // 1s max delay
    });

    // Wait for successful connection (after 3 rejections)
    await websocket.ready();
    const totalTime = Date.now() - startTime;

    assert.equal(
      connectionAttempts.length,
      4,
      "Should have 4 connection attempts"
    );

    // Verify exponential backoff delays
    // 1st attempt: immediate
    // 2nd attempt: ~100ms after 1st (100 * 2^0)
    // 3rd attempt: ~200ms after 2nd (100 * 2^1)
    // 4th attempt: ~400ms after 3rd (100 * 2^2)

    if (connectionAttempts.length >= 3) {
      const delay1 = connectionAttempts[1] - connectionAttempts[0];
      const delay2 = connectionAttempts[2] - connectionAttempts[1];
      const delay3 = connectionAttempts[3] - connectionAttempts[2];

      // Allow some tolerance for timing (~50ms)
      assert.ok(
        delay1 >= 80 && delay1 <= 200,
        `First retry delay should be ~100ms, got ${delay1}ms`
      );
      assert.ok(
        delay2 >= 180 && delay2 <= 300,
        `Second retry delay should be ~200ms, got ${delay2}ms`
      );
      assert.ok(
        delay3 >= 380 && delay3 <= 500,
        `Third retry delay should be ~400ms, got ${delay3}ms`
      );

      // Verify delays are increasing (exponential)
      assert.ok(delay2 > delay1, "Second delay should be greater than first");
      assert.ok(delay3 > delay2, "Third delay should be greater than second");
    }

    // Total time should be at least 700ms (100 + 200 + 400)
    assert.ok(
      totalTime >= 600,
      `Total time should be at least 600ms, got ${totalTime}ms`
    );

    assert.end();
  } finally {
    websocket?.close();
    wsServer?.closeAllConnections();
    httpServer?.close();
  }
});

tape("max backoff delay", async (assert: tape.Test) => {
  let websocket: KeepAliveWebSocket | undefined;
  let httpServer: Server | undefined;
  let wsServer: WebSocketServer | undefined;
  const connectionAttempts: number[] = [];
  let connectionCount = 0;

  try {
    httpServer = createServer((request, response) => {
      response.writeHead(404);
      response.end();
    });
    httpServer.listen(7825);

    wsServer = new WebSocketServer({
      httpServer,
      autoAcceptConnections: false,
    });

    // Track connection attempts and reject the first 5
    wsServer.on("request", (request) => {
      const timestamp = Date.now();
      connectionAttempts.push(timestamp);
      connectionCount++;

      if (connectionCount <= 5) {
        request.reject();
      } else {
        request.accept();
      }
    });

    websocket = new KeepAliveWebSocket({
      url: () => "ws://localhost:7825",
      WebSocket: WebSocket as never,
      autoconnect: true,
      minTimeBetweenReconnectsMS: 100, // 100ms base
      maxTimeBetweenReconnectsMS: 300, // Cap at 300ms
    });

    await websocket.ready();

    assert.equal(
      connectionAttempts.length,
      6,
      "Should have 6 connection attempts"
    );

    // Verify that delays are capped at maxTimeBetweenReconnectsMS
    // 1st: immediate
    // 2nd: 100ms (100 * 2^0)
    // 3rd: 200ms (100 * 2^1)
    // 4th: 300ms (capped, would be 400ms)
    // 5th: 300ms (capped, would be 800ms)
    // 6th: 300ms (capped, would be 1600ms)

    if (connectionAttempts.length >= 5) {
      const delay3 = connectionAttempts[3] - connectionAttempts[2];
      const delay4 = connectionAttempts[4] - connectionAttempts[3];

      // These should be capped at ~300ms (with tolerance)
      assert.ok(
        delay3 >= 250 && delay3 <= 400,
        `Fourth retry should be capped at ~300ms, got ${delay3}ms`
      );
      assert.ok(
        delay4 >= 250 && delay4 <= 400,
        `Fifth retry should be capped at ~300ms, got ${delay4}ms`
      );
    }

    assert.end();
  } finally {
    websocket?.close();
    wsServer?.closeAllConnections();
    httpServer?.close();
  }
});
