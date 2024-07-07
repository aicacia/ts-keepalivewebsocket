"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeepAliveWebSocket = void 0;
const eventemitter3_1 = require("eventemitter3");
class KeepAliveWebSocket extends eventemitter3_1.EventEmitter {
    constructor(options) {
        super();
        this.connected = false;
        this.connecting = false;
        this.reconnecting = false;
        this.closed = false;
        this.connectTime = Date.now();
        this.minTimeBetweenReconnectsMS = 0;
        this.url = options.url;
        if (options.WebSocket) {
            this.WebSocket = options.WebSocket;
        }
        else {
            this.WebSocket = WebSocket;
        }
        if (options.minTimeBetweenReconnectsMS) {
            this.minTimeBetweenReconnectsMS = options.minTimeBetweenReconnectsMS;
        }
        if (options.autoconnect) {
            this.connect();
        }
    }
    send(data) {
        var _a;
        if (!this.connected) {
            throw new Error("WebSocket not ready");
        }
        (_a = this.websocket) === null || _a === void 0 ? void 0 : _a.send(data);
        return this;
    }
    ready() {
        if (this.connected) {
            return Promise.resolve();
        }
        return this.waitOnce("open");
    }
    waitOnce(event) {
        return new Promise((resolve) => {
            this.once(event, (...args) => {
                switch (args.length) {
                    case 0:
                        resolve(undefined);
                        break;
                    case 1:
                        resolve(args[0]);
                        break;
                    default:
                        resolve(args);
                        break;
                }
            });
        });
    }
    close(code, reason) {
        this.connected = false;
        this.connecting = false;
        this.closed = true;
        if (this.websocket) {
            this.websocket.close(code, reason);
        }
        else {
            this.emit("close");
        }
    }
    async connect() {
        if (this.connected) {
            return this;
        }
        if (this.connecting) {
            return this;
        }
        this.connecting = true;
        try {
            this.connectTime = Date.now();
            const websocket = new this.WebSocket(await this.url());
            const onOpen = () => {
                websocket.removeEventListener("open", onOpen);
                this.connected = true;
                this.emit("open");
            };
            websocket.addEventListener("open", onOpen);
            websocket.addEventListener("close", () => {
                this.websocket = undefined;
                this.connected = false;
                if (this.closed) {
                    this.emit("close");
                }
                else {
                    this.emit("disconnect");
                    this.reconnect();
                }
            });
            websocket.addEventListener("message", (event) => {
                this.emit("message", event.data);
            });
            websocket.addEventListener("error", () => {
                this.emit("error");
            });
            this.websocket = websocket;
        }
        catch (error) {
            this.emit("error", error);
        }
        finally {
            this.connecting = false;
        }
        return this;
    }
    reconnect() {
        if (this.reconnecting) {
            return this;
        }
        this.reconnecting = true;
        try {
            const timeSinceLastConnect = Date.now() - this.connectTime;
            if (timeSinceLastConnect < this.minTimeBetweenReconnectsMS) {
                setTimeout(() => {
                    this.connect();
                }, this.minTimeBetweenReconnectsMS - timeSinceLastConnect);
            }
            else {
                this.connect();
            }
        }
        finally {
            this.reconnecting = false;
        }
        return this;
    }
}
exports.KeepAliveWebSocket = KeepAliveWebSocket;
