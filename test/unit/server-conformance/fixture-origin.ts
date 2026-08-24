import { readFileSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
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

export async function startFixtureOrigin(): Promise<FixtureOrigin> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;

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
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  };
}
