import EventEmitter from "eventemitter3";
export type KeepAliveWebSocketEvents = {
    open(): void;
    message(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
    error(error?: Error): void;
    disconnect(): void;
    close(): void;
};
export type KeepAliveWebSocketOptions = {
    url: () => Promise<string>;
    minTimeBetweenReconnectsMS?: number;
    WebSocket?: typeof WebSocket;
};
export declare class KeepAliveWebSocket extends EventEmitter<KeepAliveWebSocketEvents> {
    private url;
    private connecting;
    private reconnecting;
    private closed;
    private websocket;
    private connectTime;
    private minTimeBetweenReconnectsMS;
    private WebSocket;
    constructor(options: KeepAliveWebSocketOptions);
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): this;
    ready(): Promise<void>;
    close(code?: number, reason?: string): void;
    private connect;
    private reconnect;
}
