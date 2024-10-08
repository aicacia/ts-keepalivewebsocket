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
		httpServer?.close();
		wsServer?.closeAllConnections();
		websocket?.close();
	}
});
