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

export async function startFakeS3(status = 200): Promise<FakeS3> {
  const requests: RecordedS3Request[] = [];
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

      requests.push({
        body: Buffer.concat(chunks),
        headers,
        method: request.method ?? '',
        path: new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
      });
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
