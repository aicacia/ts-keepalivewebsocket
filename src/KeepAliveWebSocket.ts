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
	WebSocket?: typeof WebSocket;
};

export class KeepAliveWebSocket extends EventEmitter<KeepAliveWebSocketEvents> {
	private url: () => Promise<string> | string;
	private connected = false;
	private connecting = false;
	private reconnecting = false;
	private closed = false;
	private websocket: WebSocket | undefined;
	private connectTime = Date.now();
	private minTimeBetweenReconnectsMS = 0;
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
		if (options.autoconnect) {
			this.connect();
		}
	}

	send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
		if (!this.connected || !this.websocket) {
			throw new Error("WebSocket not ready");
		}
		this.websocket.send(data);
		return this;
	}

	ready() {
		if (this.connected) {
			return Promise.resolve();
		}
		return this.waitOnce("open");
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
		if (this.websocket) {
			this.websocket.close(code, reason);
		} else {
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
