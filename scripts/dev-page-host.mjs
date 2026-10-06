/**
 * Dev and test-only reference page host. Not published: package.json `files`
 * leaves scripts/ out, and the library must not ship a page store.
 *
 * It keeps what docs/maintainers/page-host-integration.md puts on the host:
 * `{ pageId, title, icon, version }` per page, a compare-and-swap title write,
 * per-user access, and an event stream that names changed pages but never
 * carries their metadata. The user is whoever `X-Dev-User` (or `?user=`, for
 * EventSource, which cannot send headers) says. There is no authentication.
 */
import { createServer } from 'node:http';

const ACCESS_LEVELS = new Set(['read', 'write']);

const json = (status, value) => ({ status, body: JSON.stringify(value) });

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * In-memory pages, access lists and test faults.
 *
 * @param {Array<{ pageId: string, title?: string, icon?: string, acl?: Record<string, 'read' | 'write'> }>} seed
 */
export function createPageStore(seed = []) {
  const pages = new Map(seed.map((page) => [page.pageId, {
    pageId: page.pageId,
    title: page.title ?? '',
    ...(page.icon !== undefined && { icon: page.icon }),
    version: 1,
    acl: { ...page.acl },
  }]));
  const faults = { saves: [], gets: [], slow: new Map(), muted: new Set(), delayedGets: 0, delayedSent: 0 };

  return {
    pages,
    faults,
    isMuted: (user) => faults.muted.has(user),
  };
}

/** `'write'`, `'read'` or `'none'`. A `'*'` entry is the access of everyone not listed. */
const accessOf = (record, user) => {
  if (user === null || user === '') {
    return 'none';
  }

  return record.acl[user] ?? record.acl['*'] ?? 'none';
};

const publicRecord = ({ pageId, title, icon, version }) => ({ pageId, title, ...(icon !== undefined && { icon }), version });

const matches = (fault, user, pageId) =>
  (fault.user === undefined || fault.user === user) && (fault.pageId === undefined || fault.pageId === pageId);

/** Removes and returns the first fault in `list` aimed at this request. */
const takeFault = (list, user, pageId) => {
  const index = list.findIndex((fault) => matches(fault, user, pageId));

  return index === -1 ? undefined : list.splice(index, 1)[0];
};

const parseBody = (body) => {
  try {
    const value = JSON.parse(body ?? '');

    return isObject(value) ? value : null;
  } catch {
    return null;
  }
};

const optional = (value) => (typeof value === 'string' ? value : undefined);

/**
 * Answer one request. Split out from the server so the contract is testable
 * without a socket.
 *
 * `delayMs` asks the server to hold an answer that was already computed, so a
 * delayed answer is stale the way a slow network makes it stale. `broadcast`
 * lists page ids to announce on the event stream.
 *
 * @param {object} options
 * @param {ReturnType<typeof createPageStore>} options.store
 * @param {string | null} options.user
 * @param {string} options.method
 * @param {string} options.path
 * @param {string} [options.body]
 * @returns {{ status: number, body?: string, broadcast?: string[], delayMs?: number }}
 */
export function handlePageHostRequest({ store, user, method, path, body }) {
  if (method === 'OPTIONS') {
    return { status: 204 };
  }

  if (path === '/__faults') {
    return handleFaults(store, method, body);
  }

  if (path === '/pages' && method === 'POST') {
    return createPage(store, user, body);
  }

  const match = /^\/pages\/([^/]+)(\/title|\/acl)?$/.exec(path);

  if (match === null) {
    return json(404, { error: 'no such route' });
  }

  let pageId;

  try {
    pageId = decodeURIComponent(match[1]);
  } catch {
    return json(400, { error: 'malformed page id' });
  }

  const record = store.pages.get(pageId);

  if (record === undefined) {
    return json(404, { error: 'no such page' });
  }

  if (match[2] === undefined && method === 'GET') {
    return readPage(store, record, user);
  }

  if (match[2] === '/title' && method === 'PUT') {
    return saveTitle(store, record, user, body);
  }

  if (match[2] === '/acl' && method === 'PUT') {
    return setAccess(record, body);
  }

  return { status: 405 };
}

function readPage(store, record, user) {
  if (accessOf(record, user) === 'none') {
    return json(200, { pageId: record.pageId, access: 'none' });
  }

  const answer = json(200, publicRecord(record));
  const once = takeFault(store.faults.gets, user, record.pageId);
  const slow = [...store.faults.slow.values()].find((fault) => matches(fault, user, record.pageId));
  const delayMs = once?.ms ?? slow?.ms;

  if (delayMs === undefined) {
    return answer;
  }
  store.faults.delayedGets += 1;

  return { ...answer, delayMs };
}

function saveTitle(store, record, user, body) {
  if (accessOf(record, user) !== 'write') {
    return json(403, { error: 'no write access' });
  }

  const request = parseBody(body);

  if (request === null || typeof request.title !== 'string' || typeof request.expectedVersion !== 'number') {
    return json(400, { error: 'expected { title, expectedVersion }' });
  }

  if (takeFault(store.faults.saves, user, record.pageId) !== undefined) {
    return json(503, { error: 'save failed (injected)' });
  }

  if (request.expectedVersion !== record.version) {
    return json(409, publicRecord(record));
  }

  record.title = request.title;
  record.version += 1;

  return { ...json(200, publicRecord(record)), broadcast: [record.pageId] };
}

function setAccess(record, body) {
  const request = parseBody(body);

  if (request === null || typeof request.user !== 'string' || !(request.access === null || ACCESS_LEVELS.has(request.access))) {
    return json(400, { error: 'expected { user, access: "read" | "write" | null }' });
  }

  if (request.access === null) {
    delete record.acl[request.user];
  } else {
    record.acl[request.user] = request.access;
  }

  return { ...json(200, { pageId: record.pageId }), broadcast: [record.pageId] };
}

function createPage(store, user, body) {
  const request = parseBody(body);

  if (request === null || typeof request.pageId !== 'string' || request.pageId === '' || user === null || user === '') {
    return json(400, { error: 'expected { pageId } and a user' });
  }

  const existing = store.pages.get(request.pageId);

  if (existing !== undefined) {
    return json(200, accessOf(existing, user) === 'none' ? { pageId: existing.pageId, access: 'none' } : publicRecord(existing));
  }

  const icon = optional(request.icon);
  const record = {
    pageId: request.pageId,
    title: optional(request.title) ?? '',
    ...(icon !== undefined && { icon }),
    version: 1,
    acl: { [user]: 'write' },
  };

  store.pages.set(record.pageId, record);

  return { ...json(201, publicRecord(record)), broadcast: [record.pageId] };
}

/**
 * Test faults, each aimed at a user and/or page (omitted = any):
 * `failNextSave` fails one title save with 503; `delayNextGetMs` holds one
 * allowed GET; `delayAllowedGetsMs` holds every allowed GET until set to 0
 * (a denial is never held); `muteEvents` stops that user's event stream.
 */
function handleFaults(store, method, body) {
  const { faults } = store;

  if (method === 'GET') {
    return json(200, { delayedGets: faults.delayedGets, delayedSent: faults.delayedSent });
  }

  const request = parseBody(body);

  if (method !== 'POST' || request === null) {
    return json(400, { error: 'expected a fault object' });
  }

  const target = { user: optional(request.user), pageId: optional(request.pageId) };

  if (request.failNextSave === true) {
    faults.saves.push(target);
  }
  if (typeof request.delayNextGetMs === 'number') {
    faults.gets.push({ ...target, ms: request.delayNextGetMs });
  }
  if (typeof request.delayAllowedGetsMs === 'number') {
    const key = `${target.user ?? '*'}\n${target.pageId ?? '*'}`;

    if (request.delayAllowedGetsMs > 0) {
      faults.slow.set(key, { ...target, ms: request.delayAllowedGetsMs });
    } else {
      faults.slow.delete(key);
    }
  }
  if (typeof request.muteEvents === 'boolean' && target.user !== undefined) {
    if (request.muteEvents) {
      faults.muted.add(target.user);
    } else {
      faults.muted.delete(target.user);
    }
  }

  return { status: 204 };
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-dev-user',
};

/**
 * Start the host on `port` (0 = any free port).
 *
 * @param {object} options
 * @param {number} options.port
 * @param {Parameters<typeof createPageStore>[0]} [options.seed]
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export function startPageHost({ port, seed = [] }) {
  const store = createPageStore(seed);
  const listeners = new Set();

  const broadcast = (pageIds) => {
    for (const listener of listeners) {
      if (store.isMuted(listener.user)) {
        continue;
      }
      for (const pageId of pageIds) {
        listener.response.write(`data: ${JSON.stringify({ pageId })}\n\n`);
      }
    }
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const user = request.headers['x-dev-user'] ?? url.searchParams.get('user');

    if (url.pathname === '/events' && request.method === 'GET') {
      response.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      // Flushes the headers now, so the client's open event fires.
      response.write(': open\n\n');

      const listener = { user: typeof user === 'string' ? user : null, response };

      listeners.add(listener);
      request.once('close', () => listeners.delete(listener));

      return;
    }

    const chunks = [];

    request.on('data', (chunk) => chunks.push(chunk));
    request.once('end', () => {
      const answer = handlePageHostRequest({
        store,
        user: typeof user === 'string' ? user : null,
        method: request.method ?? 'GET',
        path: url.pathname,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      const send = () => {
        if (response.destroyed) {
          return;
        }
        response.writeHead(answer.status, answer.body === undefined ? CORS : { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(answer.body);
        if (answer.delayMs !== undefined) {
          store.faults.delayedSent += 1;
        }
      };

      if (answer.broadcast !== undefined) {
        broadcast(answer.broadcast);
      }
      if (answer.delayMs === undefined) {
        send();
      } else {
        setTimeout(send, answer.delayMs);
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);

      const address = server.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : port;

      resolve({
        url: `http://127.0.0.1:${boundPort}`,
        // close() waits for open connections, and an event stream never ends on its own.
        close: () => new Promise((done) => {
          for (const listener of listeners) {
            listener.response.end();
          }
          listeners.clear();
          server.close(() => done(undefined));
          server.closeAllConnections();
        }),
      });
    });
  });
}

/**
 * Start on the first free port from `from`, trying `attempts` ports.
 *
 * @param {{ from: number, attempts: number, seed?: Parameters<typeof createPageStore>[0] }} options
 */
export async function startPageHostNear({ from, attempts, seed }) {
  let lastError;

  for (let port = from; port < from + attempts; port++) {
    try {
      return await startPageHost({ port, seed });
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') {
        throw error;
      }
      lastError = error;
    }
  }

  throw lastError;
}

/**
 * The host's seed for the playground's pages: everyone may read and rename
 * them. Revoke a user with `PUT /pages/:id/acl { user, access: null }`.
 *
 * @param {object} pages Pages by id, as parsed from playground-pages.json.
 * @returns {Array<{ pageId: string, title: string, icon?: string, acl: Record<string, 'read' | 'write'> }>}
 */
export function playgroundPageSeed(pages) {
  return Object.entries(pages).filter(([, page]) => isObject(page)).map(([pageId, page]) => ({
    pageId,
    title: typeof page.title === 'string' ? page.title : '',
    ...(typeof page.icon === 'string' && { icon: page.icon }),
    acl: { '*': 'write' },
  }));
}
