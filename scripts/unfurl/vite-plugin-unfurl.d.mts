/**
 * Type declarations for vite-plugin-unfurl.mjs.
 */

/** Minimal structural view of the incoming request (satisfied by http.IncomingMessage). */
export interface UnfurlRequest {
  url?: string;
}

/** Minimal structural view of the server response (satisfied by http.ServerResponse). */
export interface UnfurlResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body: string): void;
}

export type UnfurlHandler = (req: UnfurlRequest, res: UnfurlResponse) => Promise<void>;

export type UnfurlFetch = (url: string, init?: RequestInit) => Promise<Response>;

export function createUnfurlHandler(fetchImpl?: UnfurlFetch): UnfurlHandler;

/** Structural view of vite dev/preview servers — only what the plugin touches. */
export interface UnfurlMiddlewareServer {
  middlewares: {
    use(path: string, handler: UnfurlHandler): void;
  };
}

export interface UnfurlPlugin {
  name: string;
  configureServer(server: UnfurlMiddlewareServer): void;
  configurePreviewServer(server: UnfurlMiddlewareServer): void;
}

export default function unfurlPlugin(): UnfurlPlugin;
