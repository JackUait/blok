/**
 * Dev ticket mint for `yarn serve`: the playground's stand-in for the host
 * app route that hands out access passes. `GET /ticket?name=<n>&doc=<d>`
 * answers `{ "ticket": "<pass>" }`.
 *
 * Anyone on this machine can mint a write pass here. That is fine for a dev
 * server bound to loopback, and wrong anywhere else.
 */
import { createServer } from 'node:http';

// Node strips the types: this needs a Node that runs .ts files (22.18+, 23.6+).
import { blokTicket } from '../packages/server/src/ticket.ts';

/**
 * The claims a pass gets. The user id is built exactly like `userConfig()` in
 * index.html, so history can map an actor back to the tab that wrote.
 *
 * @param {URLSearchParams} params The mint request's query.
 * @returns {{ user: string, write: true, doc?: string }}
 */
export function ticketClaimsFor(params) {
  const name = params.get('name')?.trim();
  const doc = params.get('doc');

  return {
    user: name ? `playground-${name.toLowerCase()}` : 'playground-user',
    write: true,
    ...(doc ? { doc } : {}),
  };
}

/**
 * @param {object} options
 * @param {string} options.secret The secret the sync service runs with.
 * @param {string[]} options.origins Origins allowed to read a pass.
 * @param {string | undefined} options.origin The request's Origin header.
 * @param {string} options.method
 * @param {string} options.url The request path and query.
 * @returns {{ status: number, headers: Record<string, string>, body?: string }}
 */
export function handleTicketRequest({ secret, origins, origin, method, url }) {
  const headers = origin !== undefined && origins.includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : { Vary: 'Origin' };
  const parsed = new URL(url, 'http://127.0.0.1');

  if (parsed.pathname !== '/ticket') {
    return { status: 404, headers };
  }

  if (method !== 'GET') {
    return { status: 405, headers: { ...headers, Allow: 'GET' } };
  }

  return {
    status: 200,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify({ ticket: blokTicket(secret, ticketClaimsFor(parsed.searchParams)) }),
  };
}

/**
 * Start the mint on `port`, or on any free port when that one is taken. The
 * page learns the address from Vite's env, so the port itself does not matter.
 *
 * @param {object} options
 * @param {number} options.port Preferred port.
 * @param {string} options.secret
 * @param {string[]} options.origins
 * @returns {Promise<{ server: import('node:http').Server, url: string }>}
 */
export function startTicketMint({ port, secret, origins }) {
  const server = createServer((request, response) => {
    const { status, headers, body } = handleTicketRequest({
      secret,
      origins,
      origin: request.headers.origin,
      method: request.method ?? 'GET',
      url: request.url ?? '/',
    });

    response.writeHead(status, headers);
    response.end(body);
  });

  const listen = (at) => new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(at, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  return listen(port)
    .catch(() => listen(0))
    .then(() => ({ server, url: `http://127.0.0.1:${server.address().port}/ticket` }));
}
