import {
  EventEmitter,
  type EventEmitter as EventEmitterTypes,
} from "eventemitter3";

export type KeepAliveWebSocketEvents = {
  open(): void;
  message(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  error(error?: Error): void;
  disconnect(): void;
  close(): void;
};

type KeepAliveWebSocketEventNames =
  EventEmitterTypes.EventNames<KeepAliveWebSocketEvents>;
type KeepAliveWebSocketEventArguments =
  EventEmitterTypes.ArgumentMap<KeepAliveWebSocketEvents>;

export type KeepAliveWebSocketOptions = {
  url: () => Promise<string> | string;
  minTimeBetweenReconnectsMS?: number;
  WebSocket?: typeof WebSocket;
};

export class KeepAliveWebSocket extends EventEmitter<KeepAliveWebSocketEvents> {
  private url: () => Promise<string> | string;
  private connecting = false;
  private reconnecting = false;
  private closed = false;
  private websocket: WebSocket | undefined;
  private connectTime = Date.now();
  private minTimeBetweenReconnectsMS = 5000;
  private WebSocket: typeof WebSocket;

  constructor(options: KeepAliveWebSocketOptions) {
    super();
    this.url = options.url;
    if (options.WebSocket) {
      this.WebSocket = options.WebSocket;
    } else {
      this.WebSocket = WebSocket;
    }
    if (options.minTimeBetweenReconnectsMS) {
      this.minTimeBetweenReconnectsMS = options.minTimeBetweenReconnectsMS;
    }
    this.connect();
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
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
    return new Promise<void>((resolve, reject) => {
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

  async waitOnce<K extends KeepAliveWebSocketEventNames>(event: K) {
    return new Promise<KeepAliveWebSocketEventArguments[K]>((resolve) => {
      this.once(event, (...args) => {
        resolve(args);
      });
    });
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    if (this.websocket) {
      this.websocket.close(code, reason);
    } else {
      this.emit("close");
    }
  }

  private async connect() {
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
        } else {
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
    } catch (error) {
      this.emit("error", error as Error);
      this.reconnect();
    } finally {
      this.connecting = false;
    }
    return this;
  }

  private reconnect() {
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
      } else {
        this.connect();
      }
    } finally {
      this.reconnecting = false;
    }
    return this;
  }
}
