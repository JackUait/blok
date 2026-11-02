import { createServer } from 'node:http';

export interface RecordedS3Request {
  readonly body: Buffer;
  readonly headers: Record<string, string>;
  readonly method: string;
  readonly path: string;
}

export interface FakeS3 {
  readonly baseUrl: string;
  readonly requests: readonly RecordedS3Request[];
  stop(): Promise<void>;
}

/**
 * Every request is recorded. By default each one answers `status` with an
 * empty body. A `stateful` bucket keeps what is PUT: GET and HEAD answer it
 * or 404 NoSuchKey, and DELETE forgets it.
 */
export async function startFakeS3(status = 200, options: { stateful?: boolean } = {}): Promise<FakeS3> {
  const requests: RecordedS3Request[] = [];
  const objects = new Map<string, Buffer>();
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on('end', () => {
      const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [
        name,
        Array.isArray(value) ? value.join(', ') : value ?? '',
      ]));

      const recorded = {
        body: Buffer.concat(chunks),
        headers,
        method: request.method ?? '',
        path: new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
      };

      requests.push(recorded);

      if (options.stateful === true) {
        const held = objects.get(recorded.path);

        if (recorded.method === 'PUT') {
          objects.set(recorded.path, recorded.body);
          response.writeHead(200, { ETag: '"fixture"' });
          response.end();
        } else if (recorded.method === 'DELETE') {
          objects.delete(recorded.path);
          response.writeHead(204);
          response.end();
        } else if (held === undefined) {
          response.writeHead(404, { 'Content-Type': 'application/xml' });
          response.end(recorded.method === 'HEAD' ? undefined : '<Error><Code>NoSuchKey</Code></Error>');
        } else {
          response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': held.length });
          response.end(recorded.method === 'HEAD' ? undefined : held);
        }

        return;
      }

      response.writeHead(status, { 'Content-Type': 'application/xml' });
      response.end(status >= 400 ? '<Error><Code>FixtureFailure</Code></Error>' : '');
    });
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
    throw new Error('Could not allocate a fake-S3 port');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    stop: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  };
}
