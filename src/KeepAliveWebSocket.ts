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
  ? // biome-ignore lint/suspicious/noConfusingVoidType: type magic
    void
  : T extends [infer R]
  ? R
  : T;

export type KeepAliveWebSocketOptions = {
  url: string | (() => Promise<string> | string);
  minTimeBetweenReconnectsMS?: number;
  maxTimeBetweenReconnectsMS?: number;
  minJitterMS?: number;
  maxJitterMS?: number;
  autoconnect?: boolean;
  binaryType?: "blob" | "arraybuffer";
  WebSocket?: typeof WebSocket;
  maxReconnectAttempts?: number;
  connectionTimeoutMS?: number;
};

export class KeepAliveWebSocket extends EventEmitter<KeepAliveWebSocketEvents> {
  private url: string | (() => Promise<string> | string);
  private connected = false;
  private connecting = false;
  private reconnecting = false;
  private closed = false;
  private websocket: WebSocket | undefined;
  private lastConnectAttemptTime = Date.now();
  private minTimeBetweenReconnectsMS = 0;
  private maxTimeBetweenReconnectsMS = 30000;
  private minJitterMS = 0;
  private maxJitterMS = 300;
  private reconnectAttempts = 0;
  private maxReconnectAttempts: number | undefined = undefined;
  private connectionTimeoutMS = 30000;
  private connectionTimeoutHandle: NodeJS.Timeout | undefined = undefined;
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
    if (options.maxTimeBetweenReconnectsMS) {
      this.maxTimeBetweenReconnectsMS = options.maxTimeBetweenReconnectsMS;
    }
    if (options.minJitterMS) {
      this.minJitterMS = options.minJitterMS;
    }
    if (options.maxJitterMS) {
      this.maxJitterMS = options.maxJitterMS;
    }
    if (this.maxJitterMS < this.minJitterMS) {
      [this.minJitterMS, this.maxJitterMS] = [
        this.maxJitterMS,
        this.minJitterMS,
      ];
    }
    if (this.maxTimeBetweenReconnectsMS < this.minTimeBetweenReconnectsMS) {
      [this.minTimeBetweenReconnectsMS, this.maxTimeBetweenReconnectsMS] = [
        this.maxTimeBetweenReconnectsMS,
        this.minTimeBetweenReconnectsMS,
      ];
    }
    if (options.binaryType) {
      this.binaryType = options.binaryType;
    }
    if (options.maxReconnectAttempts) {
      this.maxReconnectAttempts = options.maxReconnectAttempts;
    }
    if (options.connectionTimeoutMS) {
      this.connectionTimeoutMS = options.connectionTimeoutMS;
    }
    if (options.autoconnect) {
      this.connect();
    }
  }

  getWebSocket() {
    return this.websocket;
  }

  setUrl(url: string | (() => Promise<string> | string)) {
    if (this.url !== url) {
      this.url = url;
      this.reconnectAttempts = 0; // Reset attempts when URL changes
    }
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

  getReadyState() {
    return this.websocket ? this.websocket.readyState : WebSocket.CLOSED;
  }

  isReady() {
    return this.getReadyState() === WebSocket.OPEN;
  }

  isClosed() {
    return this.closed;
  }

  async send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    await this.ready();
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not open");
    }
    this.websocket.send(data);
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
    this.closed = true;
    this.reconnectAttempts = 0;
    this.clearConnectionTimeout();
    if (this.websocket) {
      this.cleanupWebSocketListeners();
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
    this.closed = false;
    this.connecting = true;
    this.clearConnectionTimeout();
    try {
      this.lastConnectAttemptTime = Date.now();
      let url: string;
      try {
        url = typeof this.url === "function" ? await this.url() : this.url;
      } catch (error) {
        this.emit("error", error as Error);
        await this.reconnect();
        return this;
      }

      // Clean up old websocket if it exists
      if (this.websocket) {
        this.cleanupWebSocketListeners();
      }

      const websocket = new this.WebSocket(url);

      if (this.binaryType) {
        websocket.binaryType = this.binaryType;
      }

      websocket.addEventListener("open", this.onOpen);
      websocket.addEventListener("close", this.onClose);
      websocket.addEventListener("message", this.onMessage);
      websocket.addEventListener("error", this.onError);

      this.websocket = websocket;

      // Set connection timeout
      this.connectionTimeoutHandle = setTimeout(() => {
        if (!this.connected && this.websocket) {
          this.emit("error", new Error("WebSocket connection timeout"));
          this.websocket.close(1000, "Connection timeout");
        }
      }, this.connectionTimeoutMS);
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
    if (this.closed) {
      return this;
    }
    this.reconnecting = true;
    try {
      // Check if max attempts exceeded
      if (
        this.maxReconnectAttempts !== undefined &&
        this.reconnectAttempts >= this.maxReconnectAttempts
      ) {
        this.emit(
          "error",
          new Error(
            `Max reconnect attempts (${this.maxReconnectAttempts}) exceeded`
          )
        );
        this.close();
        return this;
      }

      this.reconnectAttempts++;

      const attemptIndex = this.reconnectAttempts - 1; // 0-based for retries
      const baseDelay = Math.max(this.minTimeBetweenReconnectsMS, 1);
      const hasZeroBase = this.minTimeBetweenReconnectsMS === 0;

      // Use Math.min to prevent integer overflow in exponential calculation
      const exponent = Math.min(attemptIndex - 1, 53); // 2^53 is max safe integer
      const reconnectDelay =
        attemptIndex === 0
          ? hasZeroBase
            ? 0
            : Math.min(baseDelay, this.maxTimeBetweenReconnectsMS)
          : Math.min(
              baseDelay * 2 ** exponent,
              this.maxTimeBetweenReconnectsMS
            );

      const jitterRange = this.maxJitterMS - this.minJitterMS;
      const jitter =
        reconnectDelay > 0 ? this.minJitterMS + Math.random() * jitterRange : 0;
      const totalDelay = reconnectDelay + jitter;

      const timeSinceLastConnect = Date.now() - this.lastConnectAttemptTime;
      if (timeSinceLastConnect < totalDelay) {
        await waitMS(totalDelay - timeSinceLastConnect);
      }
      if (!this.closed) {
        await this.connect();
      }
    } finally {
      this.reconnecting = false;
    }
    return this;
  }

  private cleanupWebSocketListeners() {
    if (!this.websocket) return;
    try {
      this.websocket.removeEventListener("open", this.onOpen);
      this.websocket.removeEventListener("close", this.onClose);
      this.websocket.removeEventListener("message", this.onMessage);
      this.websocket.removeEventListener("error", this.onError);
    } catch {
      // Ignore cleanup errors
    }
  }

  private clearConnectionTimeout() {
    if (this.connectionTimeoutHandle) {
      clearTimeout(this.connectionTimeoutHandle);
      this.connectionTimeoutHandle = undefined;
    }
  }

  private onOpen = () => {
    if (this.websocket) {
      this.websocket.removeEventListener("open", this.onOpen);
    }
    this.clearConnectionTimeout();
    this.connected = true;
    this.reconnectAttempts = 0;
    this.emit("open");
  };

  private onClose = () => {
    this.cleanupWebSocketListeners();
    this.websocket = undefined;
    this.connected = false;
    if (this.closed) {
      this.emit("close");
    } else {
      this.emit("disconnect");
      this.reconnect();
    }
  };

  private onMessage = (event: Event) => {
    const messageEvent = event as MessageEvent;
    this.emit("message", messageEvent.data);
  };

  private onError = () => {
    this.emit("error");
  };
}

function waitMS(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
