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
    httpServer.listen(8080);
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
      url: () => "ws://localhost:8080",
      WebSocket: WebSocket as never,
    });

    const message1Promise = websocket.waitOnce("message");
    await websocket.ready();
    websocket.send("Hello");
    const [message1] = await message1Promise;
    assert.equal(message1, "Hello");

    const disconnectPromise = websocket.waitOnce("disconnect");
    wsServer.closeAllConnections();
    await disconnectPromise;

    const message2Promise = websocket.waitOnce("message");
    await websocket.ready();
    websocket.send("world!");
    const [message2] = await message2Promise;
    assert.equal(message2, "world!");

    assert.end();
  } finally {
    httpServer?.close();
    wsServer?.closeAllConnections();
    websocket?.close();
  }
});
