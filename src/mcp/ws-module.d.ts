// The slice of `ws` 8.x this package uses. @types/ws is not installed.
declare module 'ws' {
  export default class WebSocket {
    constructor(url: string, protocols: string[], options?: { origin?: string });
    binaryType: string;
    readonly readyState: number;
    readonly protocol: string;
    onopen: ((event: unknown) => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null;
    onclose: ((event: { code: number; reason: string }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    send(data: ArrayBufferLike | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
    on(event: 'error', listener: (error: Error) => void): this;
  }
}
