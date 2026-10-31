import { readFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DELAY_MILLISECONDS = 10_250;
const OVERSIZED_BODY = Buffer.alloc((2 << 20) + 1, 'x');
const PRECEDENCE_HTML = readFileSync(fileURLToPath(
  new URL('./fixtures/metadata/precedence.html', import.meta.url),
));
const ERROR_HTML = readFileSync(fileURLToPath(
  new URL('./fixtures/metadata/error.html', import.meta.url),
));

export const FIXTURE_MEDIA_BODY = 'remote media bytes';

export interface FixtureOrigin {
  readonly baseUrl: string;
  /** Requests to /hold wait here until released; peak counts them at once. */
  readonly held: { current: number; peak: number; release(): void };
  /** Headers of every request the origin received, in order. */
  readonly received: Array<{ headers: IncomingHttpHeaders; path: string }>;
  readonly delayedUrl: string;
  readonly errorUrl: string;
  readonly mediaFinalUrl: string;
  readonly mediaRedirectUrl: string;
  readonly metadataFaviconUrl: string;
  readonly metadataFinalUrl: string;
  readonly metadataImageUrl: string;
  readonly metadataRedirectUrl: string;
  readonly oversizedUrl: string;
  stop(): Promise<void>;
}

function send(response: ServerResponse, status: number, contentType: string, body: Buffer | string): void {
  response.writeHead(status, { 'Content-Type': contentType });
  response.end(body);
}

// Each body is PRECEDENCE_HTML under the Content-Encoding lines named here.
const ENCODED: Record<string, { body: () => Buffer; encoding: string[] }> = {
  'gzip': { body: () => gzipSync(PRECEDENCE_HTML), encoding: ['gzip'] },
  'upper-gzip': { body: () => gzipSync(PRECEDENCE_HTML), encoding: ['GZIP'] },
  'br': { body: () => brotliCompressSync(PRECEDENCE_HTML), encoding: ['br'] },
  'deflate': { body: () => deflateSync(PRECEDENCE_HTML), encoding: ['deflate'] },
  'raw-deflate': { body: () => deflateRawSync(PRECEDENCE_HTML), encoding: ['deflate'] },
  'identity': { body: () => PRECEDENCE_HTML, encoding: ['identity'] },
  'empty': { body: () => PRECEDENCE_HTML, encoding: [''] },
  'two-in-one': { body: () => gzipSync(gzipSync(PRECEDENCE_HTML)), encoding: ['gzip, gzip'] },
  'two-lines': { body: () => gzipSync(gzipSync(PRECEDENCE_HTML)), encoding: ['gzip', 'gzip'] },
  'unknown': { body: () => PRECEDENCE_HTML, encoding: ['x-unknown'] },
  'compress': { body: () => PRECEDENCE_HTML, encoding: ['compress'] },
  'corrupt-gzip': { body: () => Buffer.from('not gzip at all'), encoding: ['gzip'] },
  'trailing-garbage': {
    body: () => Buffer.concat([gzipSync(PRECEDENCE_HTML), Buffer.from('garbage')]),
    encoding: ['gzip'],
  },
  'bomb': { body: () => gzipSync(OVERSIZED_BODY), encoding: ['gzip'] },
  'spaced': { body: () => gzipSync(PRECEDENCE_HTML), encoding: [' gzip '] },
  'truncated-gzip': { body: () => cut(gzipSync(PRECEDENCE_HTML)), encoding: ['gzip'] },
  'truncated-deflate': { body: () => cut(deflateSync(PRECEDENCE_HTML)), encoding: ['deflate'] },
  'truncated-br': { body: () => cut(brotliCompressSync(PRECEDENCE_HTML)), encoding: ['br'] },
  'two-gzip-members': {
    body: () => Buffer.concat([
      gzipSync(PRECEDENCE_HTML.subarray(0, 100)),
      gzipSync(PRECEDENCE_HTML.subarray(100)),
    ]),
    encoding: ['gzip'],
  },
  'gzip-zero-padding': {
    body: () => Buffer.concat([gzipSync(PRECEDENCE_HTML), Buffer.alloc(512)]),
    encoding: ['gzip'],
  },
  'gzip-then-bad-member': {
    body: () => Buffer.concat([gzipSync(PRECEDENCE_HTML), Buffer.from([0x1f, 0x8b, 0x00, 0x00])]),
    encoding: ['gzip'],
  },
  'gzip-then-one-magic-byte': {
    body: () => Buffer.concat([gzipSync(PRECEDENCE_HTML), Buffer.from([0x1f])]),
    encoding: ['gzip'],
  },
  'gzip-bad-crc': { body: () => flipByte(gzipSync(PRECEDENCE_HTML), -8), encoding: ['gzip'] },
  'deflate-bad-adler': { body: () => flipByte(deflateSync(PRECEDENCE_HTML), -1), encoding: ['deflate'] },
  'deflate-trailing-garbage': {
    body: () => Buffer.concat([deflateSync(PRECEDENCE_HTML), Buffer.from('garbage')]),
    encoding: ['deflate'],
  },
  'br-trailing-garbage': {
    body: () => Buffer.concat([brotliCompressSync(PRECEDENCE_HTML), Buffer.from('garbage')]),
    encoding: ['br'],
  },
  'empty-gzip-body': { body: () => Buffer.alloc(0), encoding: ['gzip'] },
  'empty-br-body': { body: () => Buffer.alloc(0), encoding: ['br'] },
  'empty-deflate-body': { body: () => Buffer.alloc(0), encoding: ['deflate'] },
};

function cut(bytes: Buffer): Buffer {
  return bytes.subarray(0, Math.floor(bytes.length / 2));
}

function flipByte(bytes: Buffer, index: number): Buffer {
  const copy = Buffer.from(bytes);
  const at = index < 0 ? copy.length + index : index;

  copy[at] ^= 0xff;

  return copy;
}

export async function startFixtureOrigin(): Promise<FixtureOrigin> {
  const received: FixtureOrigin['received'] = [];
  const waiting: Array<() => void> = [];
  const held = {
    current: 0,
    peak: 0,
    release(): void {
      for (const resume of waiting.splice(0)) {
        resume();
      }
    },
  };
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;

    received.push({ path, headers: request.headers });

    if (path.startsWith('/encoded/')) {
      const encoded = ENCODED[path.slice('/encoded/'.length)];

      if (encoded !== undefined) {
        response.writeHead(200, [
          ['Content-Type', 'text/html; charset=utf-8'],
          ...encoded.encoding.map((value) => ['Content-Encoding', value]),
        ].flat());
        response.end(encoded.body());

        return;
      }
    }

    if (path.startsWith('/hold/')) {
      held.current++;
      held.peak = Math.max(held.peak, held.current);
      waiting.push(() => {
        held.current--;
        send(response, 200, path.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8', PRECEDENCE_HTML);
      });

      return;
    }

    switch (path) {
      case '/metadata/redirect':
        response.writeHead(302, { Location: '/metadata/final/page.html?from=redirect' });
        response.end();
        break;
      case '/metadata/final/page.html':
        send(response, 200, 'text/html; charset=utf-8', PRECEDENCE_HTML);
        break;
      case '/media/redirect':
        response.writeHead(302, { Location: '/media/final/photo.jpeg?download=1' });
        response.end();
        break;
      case '/media/final/photo.jpeg':
        send(response, 200, 'image/jpeg', FIXTURE_MEDIA_BODY);
        break;
      case '/oversized':
        send(response, 200, 'text/html; charset=utf-8', OVERSIZED_BODY);
        break;
      case '/delayed': {
        const timeout = setTimeout(() => {
          send(response, 200, 'text/html; charset=utf-8', PRECEDENCE_HTML);
        }, DELAY_MILLISECONDS);

        response.once('close', () => clearTimeout(timeout));
        break;
      }
      case '/error':
        send(response, 503, 'text/html; charset=utf-8', ERROR_HTML);
        break;
      default:
        send(response, 404, 'text/plain; charset=utf-8', 'fixture not found\n');
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();

  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Could not allocate a fixture-origin port');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    held,
    received,
    delayedUrl: `${baseUrl}/delayed`,
    errorUrl: `${baseUrl}/error`,
    mediaFinalUrl: `${baseUrl}/media/final/photo.jpeg?download=1`,
    mediaRedirectUrl: `${baseUrl}/media/redirect`,
    metadataFaviconUrl: `${baseUrl}/metadata/final/favicon.svg`,
    metadataFinalUrl: `${baseUrl}/metadata/final/page.html?from=redirect`,
    metadataImageUrl: `${baseUrl}/metadata/images/cover.png?size=2`,
    metadataRedirectUrl: `${baseUrl}/metadata/redirect`,
    oversizedUrl: `${baseUrl}/oversized`,
    stop: () => new Promise<void>((resolve, reject) => {
      held.release();
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  };
}
