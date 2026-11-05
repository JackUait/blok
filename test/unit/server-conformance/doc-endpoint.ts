import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

/**
 * A stand-in for the consumer's document routes that `--doc-endpoint` points
 * at. Sync rooms GET `{url}/{docId}` to seed and PUT the same path to export.
 */
export interface RecordedPut {
  readonly body: unknown;
  readonly docId: string;
  /** Header names lower-cased, as Node's http parser hands them out. */
  readonly headers: Record<string, string>;
}

export interface FixtureDocEndpoint {
  /** The `--doc-endpoint` value; documents live one path segment below it. */
  readonly url: string;
  readonly puts: readonly RecordedPut[];
  /** The doc id of every GET, in order. */
  readonly gets: readonly string[];
  /** The headers of every GET, in the same order as `gets`. */
  readonly getHeaders: readonly Record<string, string>[];
  /** Answer GETs for `docId` with `document` (bare OutputData or a `{data, version}` envelope). */
  serve(docId: string, document: unknown): void;
  stop(): Promise<void>;
}

const DOCUMENTS_PATH = '/docs/';

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.once('error', reject);
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function flattenHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') {
      headers[name] = value;
    } else if (Array.isArray(value)) {
      headers[name] = value.join(', ');
    }
  }

  return headers;
}

function sendJson(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(body);
}

// A server that escapes a doc id badly must fail an assertion, not throw
// inside the request handler.
function decodeDocId(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export async function startDocEndpoint(): Promise<FixtureDocEndpoint> {
  const documents = new Map<string, unknown>();
  const puts: RecordedPut[] = [];
  const gets: string[] = [];
  const getHeaders: Record<string, string>[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;

    if (!path.startsWith(DOCUMENTS_PATH)) {
      sendJson(response, 404, '{"error":"not a document path"}');
      return;
    }

    const docId = decodeDocId(path.slice(DOCUMENTS_PATH.length));

    if (request.method === 'GET') {
      gets.push(docId);
      getHeaders.push(flattenHeaders(request));
      // A literal `null` body is the endpoint's "nothing saved yet". An
      // empty body or a 404 makes the room fail its seed closed instead.
      sendJson(response, 200, JSON.stringify(documents.has(docId) ? documents.get(docId) : null));
    } else if (request.method === 'PUT') {
      readBody(request).then((text) => {
        puts.push({ docId, headers: flattenHeaders(request), body: JSON.parse(text) as unknown });
        response.writeHead(204);
        response.end();
      }, (error: unknown) => {
        sendJson(response, 500, JSON.stringify({ error: String(error) }));
      });
    } else {
      response.writeHead(405, { Allow: 'GET, PUT' });
      response.end();
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
    throw new Error('Could not allocate a doc-endpoint port');
  }

  return {
    url: `http://127.0.0.1:${address.port}${DOCUMENTS_PATH.slice(0, -1)}`,
    puts,
    gets,
    getHeaders,
    serve: (docId, document) => {
      documents.set(docId, document);
    },
    stop: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error === undefined ? resolve() : reject(error));
    }),
  };
}
