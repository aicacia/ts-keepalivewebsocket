import {
  EventEmitter,
  type EventEmitter as EventEmitterTypes,
} from "eventemitter3";

export type KeepAliveWebSocketEvents = {
  open(this: KeepAliveWebSocket): void;
  message(
    this: KeepAliveWebSocket,
    data: string | ArrayBufferLike | Blob | ArrayBufferView
  ): void;
  error(this: KeepAliveWebSocket, error?: Error): void;
  disconnect(this: KeepAliveWebSocket): void;
  close(this: KeepAliveWebSocket): void;
};

type KeepAliveWebSocketEventNames =
  EventEmitterTypes.EventNames<KeepAliveWebSocketEvents>;
type KeepAliveWebSocketEventArguments =
  EventEmitterTypes.ArgumentMap<KeepAliveWebSocketEvents>;
type EventEmitterReturnType<T> = T extends []
  ? // biome-ignore lint/suspicious/noConfusingVoidType: <explanation>
    void
  : T extends [infer R]
  ? R
  : T;

export type KeepAliveWebSocketOptions = {
  url: () => Promise<string> | string;
  minTimeBetweenReconnectsMS?: number;
  autoconnect?: boolean;
  binaryType?: "blob" | "arraybuffer";
  WebSocket?: typeof WebSocket;
};

export class KeepAliveWebSocket extends EventEmitter<KeepAliveWebSocketEvents> {
  private url: () => Promise<string> | string;
  private connected = false;
  private connecting = false;
  private reconnecting = false;
  private isClosed = false;
  private websocket: WebSocket | undefined;
  private connectTime = Date.now();
  private minTimeBetweenReconnectsMS = 0;
  private binaryType: "blob" | "arraybuffer" | undefined = undefined;
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
    if (options.binaryType) {
      this.binaryType = options.binaryType;
    }
    if (options.autoconnect) {
      this.connect();
    }
  }

  getWebSocket() {
    return this.websocket;
  }

  setUrl(url: () => Promise<string> | string) {
    this.url = url;
    this.close();
    return this.connect();
  }

  setBinaryType(binaryType: "blob" | "arraybuffer" | undefined) {
    this.binaryType = binaryType;
    if (this.websocket && binaryType) {
      this.websocket.binaryType = binaryType;
    }
    return this;
  }

  async send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    await this.ready();
    // biome-ignore lint/style/noNonNullAssertion: ready
    this.websocket!.send(data);
    return this;
  }

  async ready() {
    if (!this.connected) {
      await this.waitOnce("open");
    }
    return this;
  }

  message() {
    return this.waitOnce("message");
  }

  waitOnce<K extends KeepAliveWebSocketEventNames>(event: K) {
    return new Promise<
      EventEmitterReturnType<KeepAliveWebSocketEventArguments[K]>
    >((resolve) => {
      this.once(event, (...args) => {
        switch (args.length) {
          case 0:
            resolve(undefined as never);
            break;
          case 1:
            resolve(args[0]);
            break;
          default:
            resolve(args as never);
            break;
        }
      });
    });
  }

  close(code?: number, reason?: string) {
    this.connected = false;
    this.connecting = false;
    this.isClosed = true;
    if (this.websocket) {
      this.websocket.close(code, reason);
    } else {
      this.emit("close");
    }
    return this;
  }

  async connect() {
    if (this.connected) {
      return this;
    }
    if (this.connecting) {
      return this;
    }
    this.isClosed = false;
    this.connecting = true;
    try {
      this.connectTime = Date.now();
      const websocket = new this.WebSocket(await this.url());

      if (this.binaryType) {
        websocket.binaryType = this.binaryType;
      }

      const onOpen = () => {
        websocket.removeEventListener("open", onOpen);
        this.connected = true;
        this.emit("open");
      };
      websocket.addEventListener("open", onOpen);

      websocket.addEventListener("close", () => {
        this.websocket = undefined;
        this.connected = false;
        if (this.isClosed) {
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
      await this.reconnect();
    } finally {
      this.connecting = false;
    }
    return this;
  }

  private async reconnect() {
    if (this.reconnecting) {
      return this;
    }
    this.reconnecting = true;
    try {
      const timeSinceLastConnect = Date.now() - this.connectTime;
      if (timeSinceLastConnect < this.minTimeBetweenReconnectsMS) {
        await waitMS(this.minTimeBetweenReconnectsMS - timeSinceLastConnect);
      }
      await this.connect();
    } finally {
      this.reconnecting = false;
    }
    return this;
  }
}

function waitMS(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
