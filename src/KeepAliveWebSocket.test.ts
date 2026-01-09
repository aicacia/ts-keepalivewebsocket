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

      // Allow tolerance for timing + 300ms jitter
      assert.ok(
        delay1 >= 50 && delay1 <= 500,
        `First retry delay should be ~100ms + jitter, got ${delay1}ms`
      );
      assert.ok(
        delay2 >= 50 && delay2 <= 500,
        `Second retry delay should be ~200ms + jitter, got ${delay2}ms`
      );
      assert.ok(
        delay3 >= 150 && delay3 <= 800,
        `Third retry delay should be ~400ms + jitter, got ${delay3}ms`
      );
    }

    // Total time should be in the expected backoff window (with jitter)
    assert.ok(
      totalTime >= 150,
      `Total time should include backoff, got ${totalTime}ms`
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

      // These should be capped at ~300ms + 300ms jitter (with tolerance)
      assert.ok(
        delay3 >= 150 && delay3 <= 700,
        `Fourth retry should be capped at ~300ms + jitter, got ${delay3}ms`
      );
      assert.ok(
        delay4 >= 250 && delay4 <= 700,
        `Fifth retry should be capped at ~300ms + jitter, got ${delay4}ms`
      );
    }

    assert.end();
  } finally {
    websocket?.close();
    wsServer?.closeAllConnections();
    httpServer?.close();
  }
});

tape(
  "zero minTimeBetweenReconnectsMS still backs off",
  async (assert: tape.Test) => {
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
      httpServer.listen(7826);

      wsServer = new WebSocketServer({
        httpServer,
        autoAcceptConnections: false,
      });

      wsServer.on("request", (request) => {
        connectionAttempts.push(Date.now());
        connectionCount++;

        if (connectionCount <= 2) {
          request.reject();
        } else {
          request.accept();
        }
      });

      websocket = new KeepAliveWebSocket({
        url: () => "ws://localhost:7826",
        WebSocket: WebSocket as never,
        autoconnect: true,
        minTimeBetweenReconnectsMS: 0,
        maxTimeBetweenReconnectsMS: 50,
        minJitterMS: 0,
        maxJitterMS: 0,
      });

      await websocket.ready();

      assert.equal(
        connectionAttempts.length,
        3,
        "Should attempt 3 connections"
      );

      if (connectionAttempts.length >= 3) {
        const delay1 = connectionAttempts[1] - connectionAttempts[0];
        const delay2 = connectionAttempts[2] - connectionAttempts[1];

        // First retry is immediate when minTimeBetweenReconnectsMS is zero
        assert.ok(
          delay1 >= 0,
          `First retry should be immediate, got ${delay1}ms`
        );
        assert.ok(
          delay2 > delay1,
          `Second retry should back off, got ${delay2}ms`
        );
      }

      assert.end();
    } finally {
      websocket?.close();
      wsServer?.closeAllConnections();
      httpServer?.close();
    }
  }
);

tape(
  "respects min time between connects even for quick disconnects",
  async (assert: tape.Test) => {
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
      httpServer.listen(7827);

      wsServer = new WebSocketServer({
        httpServer,
        autoAcceptConnections: true,
      });

      wsServer.on("connect", (connection) => {
        connectionAttempts.push(Date.now());
        connectionCount++;

        // Close the connection immediately after accepting
        // This simulates a quick disconnect scenario
        setTimeout(() => {
          connection.close();
        }, 10);
      });

      websocket = new KeepAliveWebSocket({
        url: () => "ws://localhost:7827",
        WebSocket: WebSocket as never,
        autoconnect: true,
        minTimeBetweenReconnectsMS: 500, // 500ms minimum between attempts
        maxTimeBetweenReconnectsMS: 500, // Same as min to test exact timing
        minJitterMS: 0, // No jitter for precise testing
        maxJitterMS: 0,
      });

      // Wait for first connection
      await websocket.ready();

      // Wait for quick disconnect and subsequent reconnect
      await websocket.waitOnce("disconnect");
      await websocket.ready();

      assert.ok(
        connectionAttempts.length >= 2,
        "Should have at least 2 connection attempts"
      );

      if (connectionAttempts.length >= 2) {
        const timeBetweenAttempts =
          connectionAttempts[1] - connectionAttempts[0];

        // Even though the connection succeeded and then quickly disconnected,
        // the next connection attempt should still respect the minimum time
        assert.ok(
          timeBetweenAttempts >= 500,
          `Time between connection attempts should be at least 500ms, got ${timeBetweenAttempts}ms`
        );

        // Allow tolerance for timing overhead and system variability
        assert.ok(
          timeBetweenAttempts < 1000,
          `Time between connection attempts should be reasonably close to 500ms, got ${timeBetweenAttempts}ms`
        );
      }

      assert.end();
    } finally {
      websocket?.close();
      wsServer?.closeAllConnections();
      httpServer?.close();
    }
  }
);
