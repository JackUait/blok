// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startDocEndpoint, type FixtureDocEndpoint } from './doc-endpoint';
import { startServer, type RunningServer } from './run-against';

// Only scripts/test-server-conformance.mjs builds the binary and sets these.
const unset = (name: string): boolean =>
  process.env[name] === undefined || process.env[name] === '';

const noServer = unset('BLOK_CONFORMANCE_SERVER');
const target = process.env.BLOK_CONFORMANCE_TARGET ?? 'csharp';

// The Go host does not serve these routes yet; they still run for csharp.
const notPortedToGo = noServer || target === 'go';

// Go's http.Server answers 400 for a bad escape before any handler runs, so no
// router can match Kestrel here. A known host gap, kept apart from the above.
const goHostGap = noServer || target === 'go';

const ALLOWED_ORIGIN = 'https://app.example.com';
const DISALLOWED_ORIGIN = 'https://evil.example.net';
const HEALTH_BODY = '{"status":"ok","version":"dev"}\n';

interface RawResponse {
  body: string;
  /** Header names lower-cased; one entry per header line, in order. */
  headers: Record<string, string[]>;
  status: number;
}

function decodeChunked(body: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;

  while (offset < body.length) {
    const lineEnd = body.indexOf('\r\n', offset);
    const size = Number.parseInt(body.subarray(offset, lineEnd).toString('latin1'), 16);

    if (size === 0) {
      break;
    }

    parts.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
    offset = lineEnd + 2 + size + 2;
  }

  return Buffer.concat(parts);
}

/**
 * Sends the request target byte for byte. `server.request` goes through
 * `new URL`, which removes dot segments and reads `//x` as a host name, so it
 * cannot reach the paths this file is about.
 */
function rawRequest(
  baseUrl: string,
  method: string,
  path: string,
  headers: Record<string, string> = {},
  protocol = 'HTTP/1.1',
): Promise<RawResponse> {
  const { hostname, port } = new URL(baseUrl);

  return new Promise((resolve, reject) => {
    const socket = connect(Number(port), hostname);
    const chunks: Buffer[] = [];

    socket.once('error', reject);
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('end', () => {
      const bytes = Buffer.concat(chunks);
      const headEnd = bytes.indexOf('\r\n\r\n');
      const [statusLine, ...lines] = bytes.subarray(0, headEnd).toString('latin1').split('\r\n');
      const parsed: Record<string, string[]> = {};

      for (const line of lines) {
        const colon = line.indexOf(':');

        (parsed[line.slice(0, colon).toLowerCase()] ??= []).push(line.slice(colon + 1).trim());
      }

      const rest = bytes.subarray(headEnd + 4);
      const chunked = (parsed['transfer-encoding'] ?? []).includes('chunked');
      const framed = chunked ? decodeChunked(rest) : rest;
      const body = method.toUpperCase() === 'HEAD' ? Buffer.alloc(0) : framed;

      resolve({
        status: Number(statusLine.split(' ')[1]),
        headers: parsed,
        body: body.toString('utf8'),
      });
    });

    const extra = Object.entries(headers).map(([name, value]) => `${name}: ${value}\r\n`).join('');

    socket.write(`${method} ${path} ${protocol}\r\nHost: ${hostname}:${port}\r\nConnection: close\r\n${extra}\r\n`);
  });
}

/**
 * Kestrel streams every answer with a body: chunked on HTTP/1.1, closed on
 * HTTP/1.0, and on HEAD no length header at all. Only an exact "HEAD" counts
 * as HEAD here; "head" is framed like GET.
 */
function expectStreamed(response: RawResponse, method: string, protocol = 'HTTP/1.1'): void {
  const chunked = method !== 'HEAD' && protocol === 'HTTP/1.1';

  expect(response.headers['content-length']).toBeUndefined();
  expect(response.headers['transfer-encoding']).toEqual(chunked ? ['chunked'] : undefined);
}

function expectNotFound(response: RawResponse, method = 'GET'): void {
  expect(response.status).toBe(404);
  expectStreamed(response, method);
  expect(response.headers['content-type']).toEqual(['text/plain; charset=utf-8']);
  expect(response.headers.allow).toBeUndefined();
  expect(response.headers['x-content-type-options']).toBeUndefined();
}

function expectMethodNotAllowed(response: RawResponse, allow: string, method: string): void {
  expect(response.status).toBe(405);
  expectStreamed(response, method);
  expect(response.headers.allow).toEqual([allow]);
  expect(response.headers['content-type']).toEqual(['text/plain; charset=utf-8']);
  expect(response.headers['x-content-type-options']).toBeUndefined();
  expect(response.body).toBe(method === 'HEAD' ? '' : 'Method Not Allowed\n');
}

describe('routing contract: health, unknown routes and ported routes', () => {
  describe.skipIf(noServer)('a host that serves only /health', () => {
    let server: RunningServer;

    beforeAll(async () => {
      server = await startServer({
        args: [
          '--listen', '127.0.0.1:0',
          '--auth', 'none',
          '--storage-dir', '',
          '--rate-limit', '0',
          '--no-unfurl',
        ],
      });
    });

    afterAll(async () => {
      await server?.stop();
    });

    it.each([
      '/health',
      '/HEALTH',
      '/Health/',
      '/health/',
      '/./health',
      '/x/../health',
      '/../health',
      '/%2e/health',
      '/%2E%2E/health',
      '/%68ealth',
      '/health?x=1',
      '/health/.',
      '/health/./',
    ])('matches GET %s to /health without a redirect', async (path) => {
      const response = await rawRequest(server.baseUrl, 'GET', path);

      expect(response.status).toBe(200);
      expectStreamed(response, 'GET');
      expect(response.headers['content-type']).toEqual(['application/json']);
      expect(response.headers.location).toBeUndefined();
      expect(response.body).toBe(HEALTH_BODY);
    });

    it('matches the method name case-insensitively', async () => {
      const response = await rawRequest(server.baseUrl, 'get', '/health');

      expect(response.status).toBe(200);
      expect(response.body).toBe(HEALTH_BODY);
    });

    it.each(['HEAD', 'head'])('answers %s /HEALTH/ like GET, with no body', async (method) => {
      const response = await rawRequest(server.baseUrl, method, '/HEALTH/');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toEqual(['application/json']);
      expect(response.body).toBe('');
    });

    // Health writes no body for either spelling. Kestrel frames "head" like
    // GET, and an answer with no body written gets Content-Length: 0.
    it.each([
      ['HEAD', undefined],
      ['head', ['0']],
    ])('frames %s /health with Content-Length %j', async (method, contentLength) => {
      const response = await rawRequest(server.baseUrl, method, '/health');

      expect(response.headers['content-length']).toEqual(contentLength);
      expect(response.headers['transfer-encoding']).toBeUndefined();
    });

    it.each([
      ['POST', '/health'],
      ['post', '/health'],
      ['PUT', '/health/'],
      ['DELETE', '/HEALTH/'],
      ['OPTIONS', '/health'],
    ])('answers %s %s with 405 and Allow: GET, HEAD', async (method, path) => {
      expectMethodNotAllowed(await rawRequest(server.baseUrl, method, path), 'GET, HEAD', method);
    });

    it.each([
      ['GET', '//health'],
      ['GET', '/health//'],
      ['GET', '/health%2F'],
      ['GET', '/health%2fx'],
      ['GET', '/health/x'],
      ['GET', '/health/..'],
      ['GET', '/'],
      ['GET', '/nope'],
      ['POST', '/nope'],
      ['OPTIONS', '/nope'],
      ['OPTIONS', '*'],
      ['GET', '/unfurl'],
    ])('answers %s %s with the 404 catch-all', async (method, path) => {
      const response = await rawRequest(server.baseUrl, method, path);

      expectNotFound(response, method);
      expect(response.body).toBe('404 page not found\n');
    });

    it('answers HEAD on an unknown route with 404 and no body', async () => {
      const response = await rawRequest(server.baseUrl, 'HEAD', '/nope');

      expectNotFound(response, 'HEAD');
      expect(response.body).toBe('');
    });

    // DELETE, not POST: Kestrel refuses an HTTP/1.0 POST with no length.
    it.each([
      ['GET', '/health', 200],
      ['HEAD', '/health', 200],
      ['GET', '/nope', 404],
      ['HEAD', '/nope', 404],
      ['DELETE', '/health', 405],
    ])('answers %s %s over HTTP/1.0 with %i and no length header', async (method, path, status) => {
      const response = await rawRequest(server.baseUrl, method, path, {}, 'HTTP/1.0');

      expect(response.status).toBe(status);
      expectStreamed(response, method, 'HTTP/1.0');
    });

    // Kestrel refuses a decoded NUL in the path before routing, on any method.
    it.each([
      ['GET', '/health%00'],
      ['HEAD', '/health%00'],
      ['POST', '/x%00'],
      ['GET', '/a%00b/c'],
      ['GET', '/x/../health%00'],
    ])('answers %s %s with an empty 400', async (method, path) => {
      const response = await rawRequest(server.baseUrl, method, path);

      expect(response.status).toBe(400);
      expect(response.headers['content-length']).toEqual(['0']);
      expect(response.headers['content-type']).toBeUndefined();
      expect(response.body).toBe('');
    });

    it.each([
      ['/health?x=%00', 200],
      ['/health%2500', 404],
      ['/health%01', 404],
    ])('does not refuse GET %s', async (path, status) => {
      expect((await rawRequest(server.baseUrl, 'GET', path)).status).toBe(status);
    });

    it.skipIf(goHostGap)('answers a malformed escape on an unknown route with the 404 catch-all', async () => {
      const response = await rawRequest(server.baseUrl, 'GET', '/a%zzb');

      expectNotFound(response);
      expect(response.body).toBe('404 page not found\n');
    });
  });

  // C# maps the local file route "/{fileName}" before /health. A literal
  // segment still beats a parameter, and the file route (order 0) beats the
  // /upload 405 fallback (order 1).
  describe.skipIf(noServer)('a host that serves local files at the root', () => {
    let server: RunningServer;
    let storageDirectory: string;

    beforeAll(async () => {
      storageDirectory = await mkdtemp(join(tmpdir(), 'blok-routing-files-'));
      server = await startServer({
        args: [
          '--listen', '127.0.0.1:0',
          '--auth', 'none',
          '--storage-dir', storageDirectory,
          '--public-url', '/',
          '--rate-limit', '0',
          '--no-unfurl',
        ],
      });
    });

    afterAll(async () => {
      await server?.stop();
      await rm(storageDirectory, { recursive: true, force: true });
    });

    it.each(['/health', '/HEALTH/'])('matches GET %s to /health, not the file route', async (path) => {
      const response = await rawRequest(server.baseUrl, 'GET', path);

      expect(response.status).toBe(200);
      expect(response.body).toBe(HEALTH_BODY);
    });

    it('answers GET /upload from the file route, not with 405', async () => {
      const response = await rawRequest(server.baseUrl, 'GET', '/upload');

      expectNotFound(response);
      expect(response.body).toBe('404 page not found\n');
    });
  });

  describe.skipIf(notPortedToGo)('a host with unfurl and collab routes', () => {
    let server: RunningServer;
    let endpoint: FixtureDocEndpoint;
    let collabDirectory: string;

    beforeAll(async () => {
      collabDirectory = await mkdtemp(join(tmpdir(), 'blok-routing-conformance-'));
      endpoint = await startDocEndpoint();
      server = await startServer({
        args: [
          '--listen', '127.0.0.1:0',
          '--auth', 'none',
          '--storage-dir', '',
          '--rate-limit', '0',
          '--allow-origin', ALLOWED_ORIGIN,
          '--collab',
          '--collab-dir', collabDirectory,
          '--doc-endpoint', endpoint.url,
        ],
      });
    });

    afterAll(async () => {
      await server?.stop();
      await endpoint?.stop();
      await rm(collabDirectory, { recursive: true, force: true });
    });

    it.each([
      ['HEAD', '/sync/x', 'GET'],
      ['POST', '/sync/x', 'GET'],
      ['OPTIONS', '/sync/x', 'GET'],
      ['HEAD', '/sync/x/state', 'GET, OPTIONS'],
      ['POST', '/sync/x/state', 'GET, OPTIONS'],
      ['GET', '/sync/x/history/l', 'DELETE, OPTIONS'],
      ['PUT', '/sync/x/history/l', 'DELETE, OPTIONS'],
      ['POST', '/unfurl', 'GET, HEAD, OPTIONS'],
    ])('answers %s %s with 405 and Allow: %s', async (method, path, allow) => {
      expectMethodNotAllowed(await rawRequest(server.baseUrl, method, path), allow, method);
    });

    // The single-segment refusal comes before any document load, so a 400
    // proves the state route ran without starting the document runtime.
    it('matches /SYNC/a%2Fb/STATE/ to the state route', async () => {
      const response = await rawRequest(server.baseUrl, 'GET', '/SYNC/a%2Fb/STATE/');

      expect(response.status).toBe(400);
      expect(response.body).toBe('document ids must be a single path segment\n');
    });

    // Literal segments fold ASCII only: "ſ" (U+017F) upper-cases to "S" in
    // Unicode, and must still miss /sync.
    it.each([
      '/sync/x/state//',
      '/sync/%2e%2e/state',
      '/%C5%BFync/x/state',
    ])('answers GET %s with the 404 catch-all', async (path) => {
      const response = await rawRequest(server.baseUrl, 'GET', path);

      expectNotFound(response);
      expect(response.body).toBe('404 page not found\n');
    });

    // Decoded, the slash would split {doc} and the path would match no route.
    // %252F decodes once, to a {doc} of "a%2Fb".
    it.each(['/sync/a%2Fb/state', '/sync/a%2fb/state', '/sync/a%5Cb/state', '/sync/a%252Fb/state'])(
      'keeps the encoded separator in {doc} for GET %s',
      async (path) => {
        const response = await rawRequest(server.baseUrl, 'GET', path);

        expect(response.status).toBe(400);
        expect(response.body).toBe('document ids must be a single path segment\n');
      },
    );

    it('answers a preflight on /UNFURL/ with the exact CORS headers', async () => {
      const response = await rawRequest(server.baseUrl, 'OPTIONS', '/UNFURL/', {
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Headers': 'authorization',
        'Access-Control-Request-Method': 'GET',
      });

      expect(response.status).toBe(204);
      expect(response.body).toBe('');
      expect(response.headers['access-control-allow-origin']).toEqual([ALLOWED_ORIGIN]);
      expect(response.headers['access-control-allow-methods']).toEqual(['GET, OPTIONS']);
      expect(response.headers['access-control-allow-headers']).toEqual(['authorization']);
      expect(response.headers['access-control-max-age']).toEqual(['600']);
      expect(response.headers.vary).toEqual(['Access-Control-Request-Headers', 'Origin']);
    });

    it.each([
      ['/sync/x/state', 'GET, OPTIONS'],
      ['/sync/x/history/l', 'DELETE, OPTIONS'],
    ])('answers a preflight on %s with Allow-Methods %s and the origin as sent', async (path, methods) => {
      const sentOrigin = 'https://APP.example.com';
      const response = await rawRequest(server.baseUrl, 'OPTIONS', path, { Origin: sentOrigin });

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toEqual([sentOrigin]);
      expect(response.headers['access-control-allow-methods']).toEqual([methods]);
      expect(response.headers['access-control-allow-headers']).toBeUndefined();
      expect(response.headers.vary).toEqual(['Origin']);
    });

    it.each([
      ['no Origin', {}],
      ['a disallowed Origin', { Origin: DISALLOWED_ORIGIN }],
    ])('refuses a preflight with %s', async (_label, headers: Record<string, string>) => {
      const response = await rawRequest(server.baseUrl, 'OPTIONS', '/unfurl', headers);

      expect(response.status).toBe(403);
      expect(response.headers['content-type']).toEqual(['text/plain; charset=utf-8']);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.body).toBe('origin not allowed\n');
    });
  });
});
