/**
 * Dev-only document store for `yarn serve`.
 *
 * Collaboration rooms seed a document by GETting `{--doc-endpoint}/{docId}` and
 * export it back with a PUT to the same path, so the dev server needs something
 * answering both. This is that something: an in-memory stand-in for the routes a
 * real consumer would own.
 *
 * In-memory is the point, not a shortcut — the shared document is meant to live
 * exactly as long as `yarn serve` does, so a restart brings the playground's
 * showcase back instead of whatever the last session left behind.
 */
import { createServer } from 'node:http';

const DOCUMENTS_PATH = '/docs/';

/**
 * Answer one document request.
 *
 * Split out from the server so the contract can be tested without a socket.
 *
 * @param {object} options
 * @param {Map<string, unknown>} options.documents Written documents, by id.
 * @param {unknown} options.seed Answer for a document nobody has written yet.
 * @param {string} options.method HTTP method.
 * @param {string} options.path Request path.
 * @param {string} [options.body] Request body, for PUT.
 * @returns {{ status: number, body?: string }}
 */
export function handleDocumentRequest({ documents, seed, method, path, body }) {
  if (!path.startsWith(DOCUMENTS_PATH)) {
    return { status: 404, body: '{"error":"not a document path"}' };
  }

  let id;

  try {
    id = decodeURIComponent(path.slice(DOCUMENTS_PATH.length));
  } catch {
    // A stray request with a broken escape would otherwise throw inside the
    // request handler and take the whole dev server down.
    return { status: 400, body: '{"error":"malformed document id"}' };
  }

  if (method === 'GET') {
    return { status: 200, body: JSON.stringify(documents.has(id) ? documents.get(id) : seed) };
  }

  if (method === 'PUT') {
    let document;

    try {
      document = JSON.parse(body ?? '');
    } catch {
      return { status: 400, body: '{"error":"invalid json"}' };
    }

    documents.set(id, document);

    return { status: 204 };
  }

  return { status: 405 };
}

/**
 * Start the store. Runs inside the `yarn serve` process — one less child to
 * supervise and shut down.
 *
 * @param {object} options
 * @param {number} options.port Port to listen on.
 * @param {unknown} options.seed Document handed out until someone writes one.
 * @returns {Promise<import('node:http').Server>}
 */
export function startDocumentStore({ port, seed }) {
  const documents = new Map();
  const server = createServer((request, response) => {
    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.once('end', () => {
      const { status, body } = handleDocumentRequest({
        documents,
        seed,
        method: request.method ?? 'GET',
        path: new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
        body: Buffer.concat(chunks).toString('utf8'),
      });

      response.writeHead(status, body === undefined ? {} : { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(body);
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
