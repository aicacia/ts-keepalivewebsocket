import { EventEmitter, } from "eventemitter3";
export class KeepAliveWebSocket extends EventEmitter {
    constructor(options) {
        super();
        this.connecting = false;
        this.reconnecting = false;
        this.closed = false;
        this.connectTime = Date.now();
        this.minTimeBetweenReconnectsMS = 5000;
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
        if (!this.websocket) {
            throw new Error("WebSocket not ready");
        }
        this.websocket.send(data);
        return this;
    }
    ready() {
        if (this.websocket) {
            return Promise.resolve();
        }
        return new Promise((resolve, reject) => {
            const removeAllListeners = () => {
                this.off("open", onOpen);
                this.off("error", onError);
                this.off("close", onClose);
            };
            const onOpen = () => {
                removeAllListeners();
                resolve();
            };
            const onError = () => {
                removeAllListeners();
                reject();
            };
            const onClose = () => {
                removeAllListeners();
                reject();
            };
            this.on("open", onOpen);
            this.on("error", onError);
            this.on("close", onClose);
        });
    }
    waitOnce(event) {
        return new Promise((resolve) => {
            this.once(event, (...args) => {
                if (args.length === 1) {
                    resolve(args[0]);
                }
                else {
                    resolve(args);
                }
            });
        });
    }
    close(code, reason) {
        this.closed = true;
        if (this.websocket) {
            this.websocket.close(code, reason);
        }
        else {
            this.emit("close");
        }
    }
    async connect() {
        if (this.connecting) {
            return this;
        }
        this.connecting = true;
        try {
            this.connectTime = Date.now();
            const websocket = new this.WebSocket(await this.url());
            const onOpen = () => {
                websocket.removeEventListener("open", onOpen);
                this.emit("open");
            };
            websocket.addEventListener("open", onOpen);
            websocket.addEventListener("close", () => {
                this.websocket = undefined;
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
            this.reconnect();
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
