import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { createMcpHandler, requireBearerAuth } from '@modelcontextprotocol/server';

import { createJwtVerifier, principalOf } from './auth/oauth';
import type { BlokMcpOptions } from './options';
import type { Dispatch } from './sdk-server';
import { buildSdkServer } from './sdk-server';
import type { McpTool } from './tools';

export interface HttpServerInput {
  /** host:port; port 0 picks a free one. */
  listen: string;
  path?: string;
  tools: McpTool[];
  instructions: string;
  dispatch: Dispatch;
  auth: BlokMcpOptions['auth'];
  /** The caller's principal when auth is none. */
  principal: string;
  version: string;
  /** JWKS fetch; tests inject it. */
  fetchImpl?: typeof fetch;
}

const METADATA_PATH = '/.well-known/oauth-protected-resource';
// MCP clients are not browsers: only a loopback page may drive this server (spec §3.7 "validate Origin").
const LOOPBACK_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
// Matches the SDK's own default body bound (CreateMcpHandlerOptions.maxRequestBodySize).
const MAX_BODY_BYTES = 4 * 1024 * 1024;

class BodyTooLargeError extends Error {}

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  const size = { bytes: 0 };

  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));

    size.bytes += bytes.byteLength;
    if (size.bytes > MAX_BODY_BYTES) {
      throw new BodyTooLargeError();
    }
    chunks.push(bytes);
  }

  return Buffer.concat(chunks);
};

const headersOf = (req: IncomingMessage): Headers => {
  const headers = new Headers();

  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      headers.set(name, value);
    } else if (Array.isArray(value)) {
      headers.set(name, value.join(', '));
    }
  }

  return headers;
};

const toRequest = async (req: IncomingMessage, url: URL, headers: Headers, signal: AbortSignal): Promise<Request> => {
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';

  // Uint8Array.from copies into a plain ArrayBuffer, which BodyInit accepts and Buffer is not typed as.
  return new Request(url, { method, headers, signal, ...(hasBody && { body: Uint8Array.from(await readBody(req)) }) });
};

const send = async (res: ServerResponse, response: Response): Promise<void> => {
  if (res.destroyed) {
    await response.body?.cancel();

    return;
  }
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body === null) {
    res.end();

    return;
  }
  for await (const chunk of response.body) {
    // Leaving the loop cancels the stream, so a gone client stops the SDK's writes too.
    if (res.destroyed) {
      return;
    }
    res.write(chunk);
  }
  res.end();
};

const splitListen = (listen: string): { host: string; port: number } => {
  const at = listen.lastIndexOf(':');

  return { host: listen.slice(0, at).replace(/^\[|\]$/g, ''), port: Number(listen.slice(at + 1)) };
};

/**
 * Streamable HTTP for hosted use. Each request gets a fresh SDK server; the
 * caller's identity comes from the verified bearer token, or from `principal`
 * when auth is none.
 */
export const startHttpServer = async (input: HttpServerInput): Promise<{ url: string; close(): Promise<void> }> => {
  const path = input.path ?? '/mcp';
  const oauth = input.auth.kind === 'oauth' ? input.auth : null;
  const authenticate = oauth === null ? null : requireBearerAuth({
    verifier: createJwtVerifier(oauth, input.fetchImpl),
    requiredScopes: ['blok.read'],
    expectedResource: new URL(oauth.audience),
    resourceMetadataUrl: new URL(METADATA_PATH, oauth.audience).href,
  });
  const handler = createMcpHandler((ctx) => {
    const info = ctx.authInfo;

    return buildSdkServer({
      tools: input.tools,
      instructions: input.instructions,
      dispatch: input.dispatch,
      caller: (clientName) => (info === undefined
        ? { principal: input.principal, clientName, scopes: null }
        : { principal: principalOf(info), clientName, scopes: info.scopes }),
      version: input.version,
    });
  });

  const serve = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const origin = req.headers.origin;

    if (origin !== undefined && !LOOPBACK_ORIGIN.test(origin)) {
      res.writeHead(403).end();

      return;
    }
    if (oauth !== null && req.method === 'GET' && url.pathname === METADATA_PATH) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        resource: oauth.audience,
        authorization_servers: [oauth.issuer],
        scopes_supported: ['blok.read', 'blok.write'],
        bearer_methods_supported: ['header'],
      }));

      return;
    }
    if (url.pathname !== path) {
      res.writeHead(404).end();

      return;
    }
    const headers = headersOf(req);
    // The bearer gate reads only the Authorization header, so an unauthenticated caller never gets a body read.
    const verdict = authenticate === null ? undefined : await authenticate(new Request(url, { headers }));

    if (verdict instanceof Response) {
      await send(res, verdict);

      return;
    }
    const disconnect = new AbortController();

    res.once('close', () => {
      if (!res.writableFinished) {
        disconnect.abort();
      }
    });
    const request = await toRequest(req, url, headers, disconnect.signal);

    await send(res, await handler.fetch(request, { authInfo: verdict }));
  };

  const server = createServer((req, res) => {
    serve(req, res).catch((error: unknown) => {
      if (res.headersSent || res.destroyed) {
        res.destroy();

        return;
      }
      if (error instanceof BodyTooLargeError) {
        res.writeHead(413).end();

        return;
      }
      console.error('blok-mcp: HTTP request failed', error);
      res.writeHead(500).end();
    });
  });
  const { host, port } = splitListen(input.listen);

  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      done();
    });
  });
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('blok-mcp: the HTTP server has no TCP address');
  }
  const shownHost = address.family === 'IPv6' ? `[${address.address}]` : address.address;

  return {
    url: `http://${shownHost}:${address.port}`,
    close: async () => {
      await handler.close();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
    },
  };
};
