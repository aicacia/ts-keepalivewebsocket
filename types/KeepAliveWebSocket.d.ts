import { EventEmitter, type EventEmitter as EventEmitterTypes } from "eventemitter3";
export type KeepAliveWebSocketEvents = {
    open(): void;
    message(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
    error(error?: Error): void;
    disconnect(): void;
    close(): void;
};
type KeepAliveWebSocketEventNames = EventEmitterTypes.EventNames<KeepAliveWebSocketEvents>;
type EventEmitterReturnType<T> = T extends [] ? void : T extends [infer R] ? R : T;
export type KeepAliveWebSocketOptions = {
    url: () => Promise<string> | string;
    minTimeBetweenReconnectsMS?: number;
    autoconnect?: boolean;
    WebSocket?: typeof WebSocket;
};
export declare class KeepAliveWebSocket extends EventEmitter<KeepAliveWebSocketEvents> {
    private url;
    private connected;
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
    waitOnce<K extends KeepAliveWebSocketEventNames>(event: K): Promise<EventEmitterReturnType<EventEmitter.ArgumentMap<KeepAliveWebSocketEvents>[K]>>;
    close(code?: number, reason?: string): void;
    connect(): Promise<this>;
    private reconnect;
}
export {};
