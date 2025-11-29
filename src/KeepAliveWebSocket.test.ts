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
      console.log("HTTP request received");
      response.writeHead(404);
      response.end();
    });
    httpServer.listen(7823);
    console.log("Listening on port 7823");
    wsServer = new WebSocketServer({
      httpServer,
      autoAcceptConnections: true,
    });
    wsServer.on("connect", (connection) => {
      console.log("WebSocket client connected");
      connection.on("message", (message) => {
        console.log("WebSocket client sent a message");
        if (message.type === "utf8") {
          connection.sendUTF(message.utf8Data);
        }
      });
    });
    console.log("WebSocket server created");

    websocket = new KeepAliveWebSocket({
      url: () => "ws://localhost:7823",
      WebSocket: WebSocket as never,
      autoconnect: true,
      minTimeBetweenReconnectsMS: 1000,
    });
    console.log("KeepAliveWebSocket created");

    const message1Promise = websocket.message();
    console.log("Waiting Websocket ready");
    await websocket.ready();
    console.log("Websocket ready");
    websocket.send("Hello");
    console.log("Sent first message");
    assert.equal(await message1Promise, "Hello");
    console.log("Received first message");

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
