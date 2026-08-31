// @vitest-environment node

import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it as baseIt } from 'vitest';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { createCollabProvider } from '../../../src/components/modules/collaboration/provider';
import type {
  CollabDocSeam,
  CollabProvider,
  CollabSocketFactory,
  CollabStatus,
  CollabStatusDetail,
  WebSocketLike,
} from '../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import type { OutputBlockData } from '../../../types/data-formats/output-data';
import { startDocEndpoint, type FixtureDocEndpoint } from './doc-endpoint';
import { startServer, type RunningServer } from './run-against';

/**
 * The other half of sync-contract.test.ts: that suite drives a STOCK
 * y-websocket client against the built binary, this one drives Blok's OWN
 * client — the real `createCollabProvider` over the real `DocumentStore` seam —
 * against the same binary, and puts the two on the same document to prove they
 * agree on the wire.
 *
 * Same gate: only scripts/test-server-conformance.mjs builds the binary and
 * sets BLOK_CONFORMANCE_SERVER, so a plain `yarn test` skips the file.
 *
 * Every wait carries an explicit deadline and reports what the client saw when
 * it expires; nothing is asserted by absence within a short window.
 */
const unset = (name: string): boolean =>
  process.env[name] === undefined || process.env[name] === '';

const it = baseIt.skipIf(unset('BLOK_CONFORMANCE_SERVER'));

const ALLOWED_ORIGIN = 'https://app.example.com';
const SYNC_PROTOCOL = 'blok-sync.v1';
/** Every signed fixture ticket carries this doc claim, so ticket cases use it. */
const TICKET_DOC_ID = 'doc-42';
/** The server drains open sockets with "going away" on SIGTERM. */
const CLOSE_GOING_AWAY = 1001;
/** The room was reset; the client's history no longer belongs to it. */
const CLOSE_LINEAGE_RESET = 4409;
const POLL_INTERVAL_MS = 25;
const DEADLINE_MS = 15_000;
const TEST_TIMEOUT_MS = 45_000;

interface SyncTickets {
  compatible: string;
  readOnly: string;
  secret: string;
}

interface StatusEntry {
  status: CollabStatus;
  detail?: CollabStatusDetail;
}

interface BlokClient {
  readonly provider: CollabProvider;
  readonly sockets: WebSocket[];
  readonly statuses: StatusEntry[];
  readonly store: DocumentStore;
  blockIds(): string[];
  blocks(): OutputBlockData[];
  describe(): string;
  destroy(): void;
  whenConnected(): Promise<void>;
}

interface StockClient {
  readonly doc: Y.Doc;
  readonly provider: WebsocketProvider;
  describe(): string;
  destroy(): void;
  whenSynced(): Promise<void>;
}

interface ClientHarness {
  readonly endpoint: FixtureDocEndpoint;
  readonly server: RunningServer;
  /** A real Blok client: createCollabProvider over a real DocumentStore. */
  connect(docId: string, ticket?: string): BlokClient;
  /** A stock y-websocket peer, for the ecosystem-agreement cases. */
  connectStock(docId: string): StockClient;
}

function loadTickets(): SyncTickets {
  const path = fileURLToPath(new URL('./fixtures/tickets.json', import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Server ticket fixture has an invalid shape');
  }

  const fixture = parsed as Record<string, unknown>;
  const read = (key: keyof SyncTickets): string => {
    const value = fixture[key];

    if (typeof value !== 'string') {
      throw new Error(`Server ticket fixture is missing "${key}"`);
    }

    return value;
  };

  return { compatible: read('compatible'), readOnly: read('readOnly'), secret: read('secret') };
}

const tickets = loadTickets();

function readCanonical(caseName: string): OutputBlockData[] {
  const path = fileURLToPath(new URL(`./fixtures/collab/${caseName}/canonical.json`, import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (!Array.isArray(parsed)) {
    throw new Error(`${path} must hold an array of blocks`);
  }

  return parsed as OutputBlockData[];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(
  predicate: () => boolean,
  describe: () => string,
  timeoutMs = DEADLINE_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${describe()}`);
    }

    await delay(POLL_INTERVAL_MS);
  }
}

/** Binds a real DocumentStore to the provider's structural seam (CollabDocSeam). */
const seamFor = (store: DocumentStore): CollabDocSeam => ({
  applyRemoteUpdate: (update, origin) => store.applyRemoteUpdate(update, origin),
  onDocUpdate: (callback) => store.onUpdate(callback),
  getStateVector: () => store.getStateVector(),
  encodeStateAsUpdate: (stateVector) => store.encodeStateAsUpdate(stateVector),
  enableAwareness: () => store.enableAwareness(),
  setAwarenessField: (field, value) => store.setAwarenessField(field, value),
  getAwarenessStates: () => store.getAwarenessStates(),
  onAwarenessChange: (callback) => store.onAwarenessChange(callback),
  onAwarenessUpdate: (callback) => store.onAwarenessUpdate(callback),
  encodeAwarenessUpdate: (clients) => store.encodeAwarenessUpdate(clients),
  applyAwarenessUpdate: (update, origin) => store.applyAwarenessUpdate(update, origin),
  clearRemoteAwarenessStates: () => store.clearRemoteAwarenessStates(),
  resetForRelineage: () => store.resetForRelineage(),
});

/**
 * Node's global WebSocket is the transport — `ws` is not a dependency and none
 * is needed. Two node-only details: the DOM typing does not know about undici's
 * init object, and node sends no Origin header. The header goes out in TICKET
 * mode only: `SyncHandshake` makes the origin check mandatory the moment an
 * Origin header is present, and a no-auth server has no allow-list to pass.
 * @param origin - the Origin header to send, or null to send none
 * @param sockets - collects the raw sockets so a test can read the negotiated
 *   subprotocol off them
 */
function nodeSocketFactory(origin: string | null, sockets: WebSocket[]): CollabSocketFactory {
  return (url, protocols) => {
    const init = origin === null ? { protocols } : { protocols, headers: { Origin: origin } };
    const socket = new WebSocket(url, init as unknown as string[]);

    sockets.push(socket);

    return socket as unknown as WebSocketLike;
  };
}

function connectBlokClient(wsUrl: string, docId: string, ticket: string | undefined): BlokClient {
  const store = new DocumentStore(new YBlockSerializer());
  const statuses: StatusEntry[] = [];
  const sockets: WebSocket[] = [];
  const provider = createCollabProvider({
    url: `${wsUrl}/${encodeURIComponent(docId)}`,
    docId,
    yjs: seamFor(store),
    ticketSource: ticket === undefined ? undefined : () => Promise.resolve(ticket),
    socketFactory: nodeSocketFactory(ticket === undefined ? null : ALLOWED_ORIGIN, sockets),
    onStatus: (status, detail) => statuses.push({ status, detail }),
    // No jitter, so a recoverable close is retried at the bottom of the
    // backoff window (500 ms for the first attempt) instead of up to a second.
    random: () => 0,
  });

  const blocks = (): OutputBlockData[] => store.toJSON();
  const blockIds = (): string[] =>
    blocks().flatMap((block) => typeof block.id === 'string' ? [block.id] : []);
  const describe = (): string =>
    `blok client "${docId}"${ticket === undefined ? '' : ' (ticket)'}: status=${provider.status} ` +
    `tag=${JSON.stringify(provider.tag)} blocks=[${blockIds().join(', ')}] ` +
    `statuses=${JSON.stringify(statuses)}`;

  let destroyed = false;

  provider.connect();

  return {
    provider,
    sockets,
    statuses,
    store,
    blockIds,
    blocks,
    describe,
    // Idempotent, and it destroys the STORE too: the provider turns awareness on
    // at connect, and its 3 s sweep timer would hold the worker open.
    destroy: () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      provider.destroy();
      store.destroy();
    },
    whenConnected: () => waitFor(
      () => {
        // `error` is terminal — the provider has stopped and will never reach
        // 'connected', so fail now with what it saw instead of at the deadline.
        if (provider.status === 'error') {
          throw new Error(`the provider gave up; ${describe()}`);
        }

        return provider.status === 'connected';
      },
      () => `the first sync of ${describe()}`,
    ),
  };
}

function connectStockClient(wsUrl: string, docId: string): StockClient {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(wsUrl, docId, doc, {
    connect: false,
    // Same-process providers would otherwise sync through BroadcastChannel and
    // every convergence case would pass without touching the server.
    disableBc: true,
  });
  const describe = (): string => `stock client "${docId}": synced=${provider.synced}`;

  let destroyed = false;

  provider.connect();

  return {
    doc,
    provider,
    describe,
    destroy: () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      provider.destroy();
      doc.destroy();
    },
    whenSynced: () => waitFor(() => provider.synced, () => `sync of ${describe()}`),
  };
}

async function withBlokServer(
  auth: 'none' | 'ticket',
  run: (harness: ClientHarness) => Promise<void>,
): Promise<void> {
  const collabDirectory = await mkdtemp(join(tmpdir(), 'blok-client-conformance-'));
  const endpoint = await startDocEndpoint();
  const clients: { destroy: () => void }[] = [];
  let server: RunningServer | undefined;

  try {
    server = await startServer({
      args: [
        '--listen', '127.0.0.1:0',
        '--auth', auth,
        '--storage-dir', '',
        '--rate-limit', '0',
        '--collab',
        '--collab-dir', collabDirectory,
        '--doc-endpoint', endpoint.url,
        ...(auth === 'ticket' ? ['--allow-origin', ALLOWED_ORIGIN] : []),
      ],
      env: auth === 'ticket' ? { BLOK_SECRET: tickets.secret } : {},
    });

    const wsUrl = `${server.baseUrl.replace(/^http:/, 'ws:')}/sync`;

    await run({
      endpoint,
      server,
      connect: (docId, ticket) => {
        const client = connectBlokClient(wsUrl, docId, ticket);

        clients.push(client);

        return client;
      },
      connectStock: (docId) => {
        const client = connectStockClient(wsUrl, docId);

        clients.push(client);

        return client;
      },
    });
  } finally {
    // Destroy on the failure path too: a live provider keeps reconnecting with
    // backoff and holds the worker open.
    for (const client of clients) {
      client.destroy();
    }

    await server?.stop();
    await endpoint.stop();
    await rm(collabDirectory, { recursive: true, force: true });
  }
}

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

/**
 * Edits a STOCK peer's doc through the real DocumentStore, using only its
 * binary seam: mirror the doc into a store, mutate, apply the diff back.
 * @param doc - the stock peer's document
 * @param mutate - what to do to the mirrored store
 */
function editBlocks(doc: Y.Doc, mutate: (store: DocumentStore) => void): void {
  const store = createStore();

  store.applyRemoteUpdate(Y.encodeStateAsUpdate(doc));
  mutate(store);
  Y.applyUpdate(doc, store.encodeStateAsUpdate(Y.encodeStateVector(doc)));
  store.destroy();
}

/** Reads a stock peer's doc the way the editor would: through DocumentStore.toJSON. */
function readBlocks(doc: Y.Doc): OutputBlockData[] {
  const store = createStore();

  store.applyRemoteUpdate(Y.encodeStateAsUpdate(doc));

  const blocks = store.toJSON();

  store.destroy();

  return blocks;
}

const paragraph = (id: string, text: string): OutputBlockData => ({ id, type: 'paragraph', data: { text } });

const stockBlockIds = (doc: Y.Doc): string[] =>
  readBlocks(doc).flatMap((block) => typeof block.id === 'string' ? [block.id] : []);

const holds = (ids: string[], wanted: string[]): boolean => {
  const present = new Set(ids);

  return wanted.every((id) => present.has(id));
};

function ticketHeaders(ticket: string): Record<string, string> {
  return { Origin: ALLOWED_ORIGIN, Authorization: `Bearer ${ticket}` };
}

/**
 * Alice's presence among everything a peer knows. Matched by CONTENT, not by
 * client id: every stock y-websocket peer publishes an empty local state of its
 * own, so "the states that are not mine" is not a unique answer.
 * @param states - the peer's awareness states
 */
function alicePresence(states: Map<number, Record<string, unknown>>): unknown[] {
  return Array.from(states.values()).filter((state) => {
    const user = state.user;

    return typeof user === 'object' && user !== null &&
      (user as Record<string, unknown>).name === 'alice';
  });
}

it('connects with a doc-scoped pass offered as a subprotocol and reports connected after the first sync', async () => {
  await withBlokServer('ticket', async ({ connect }) => {
    const client = connect(TICKET_DOC_ID, tickets.compatible);

    await client.whenConnected();

    // Reaching 'connected' IS the control-frame-first proof: the provider
    // buffers every inbound frame until the control frame validates, so the
    // SyncStep2 that marks it synced can only have been applied after it.
    expect(client.provider.tag).toEqual({
      epoch: expect.any(Number),
      format: 1,
      lineage: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(client.sockets).toHaveLength(1);
    expect(client.sockets[0].protocol).toBe(SYNC_PROTOCOL);
    expect(client.statuses.map((entry) => entry.status)).toEqual(['connecting', 'connected']);
  });
}, TEST_TIMEOUT_MS);

it('converges with a stock y-websocket peer in both directions', async () => {
  await withBlokServer('none', async ({ connect, connectStock }) => {
    const blok = connect('converge');
    const stock = connectStock('converge');

    await Promise.all([blok.whenConnected(), stock.whenSynced()]);

    blok.store.addBlock(paragraph('b1', 'from the blok client'));
    editBlocks(stock.doc, (store) => {
      store.addBlock(paragraph('s1', 'from the stock peer'));
    });

    await waitFor(
      () => holds(blok.blockIds(), ['b1', 's1']) && holds(stockBlockIds(stock.doc), ['b1', 's1']),
      () => `both edits on both peers; ${blok.describe()}; ${stock.describe()}`,
    );

    expect(blok.blocks()).toEqual(readBlocks(stock.doc));
    expect([...blok.blockIds()].sort()).toEqual(['b1', 's1']);
  });
}, TEST_TIMEOUT_MS);

it('reads a seeded document back out of its own DocumentStore as the canonical JSON', async () => {
  await withBlokServer('none', async ({ connect, endpoint }) => {
    const canonical = readCanonical('hierarchy-3-deep');
    const docId = 'seed-hierarchy-3-deep';

    endpoint.serve(docId, { time: Date.now(), blocks: canonical });

    const client = connect(docId);

    await client.whenConnected();

    // JSON -> doc endpoint -> server working set -> wire -> provider -> seam
    // -> DocumentStore -> JSON, through every real component on both sides.
    expect(client.blocks()).toEqual(canonical);
  });
}, TEST_TIMEOUT_MS);

it('never lands a read-only client\'s edits on a writer, and keeps its socket open', async () => {
  await withBlokServer('ticket', async ({ connect }) => {
    const writer = connect(TICKET_DOC_ID, tickets.compatible);
    const reader = connect(TICKET_DOC_ID, tickets.readOnly);

    await Promise.all([writer.whenConnected(), reader.whenConnected()]);

    writer.store.addBlock(paragraph('w1', 'writer one'));
    await waitFor(
      () => holds(reader.blockIds(), ['w1']),
      () => `the reader to receive w1; ${reader.describe()}`,
    );

    reader.store.addBlock(paragraph('r1', 'reader edit that must be dropped'));
    writer.store.addBlock(paragraph('w2', 'writer two'));

    // w2 completes a full round trip after r1 was sent, so its arrival is the
    // positive event that proves r1 was dropped rather than still in flight.
    await waitFor(
      () => holds(reader.blockIds(), ['w2']),
      () => `the reader to receive w2; ${reader.describe()}`,
    );

    expect(writer.blockIds()).toEqual(['w1', 'w2']);
    // The reader keeps its own edit locally; only the room refuses it. Its
    // ORDER is a genuine CRDT tie between r1 and w2, so only membership is
    // asserted here.
    expect([...reader.blockIds()].sort()).toEqual(['r1', 'w1', 'w2']);
    expect(reader.provider.status).toBe('connected');
    expect(reader.statuses.map((entry) => entry.status)).toEqual(['connecting', 'connected']);
  });
}, TEST_TIMEOUT_MS);

it('resets its lineage on 4409 and reconnects carrying none of its pre-reset content', async () => {
  await withBlokServer('ticket', async ({ connect, endpoint, server }) => {
    endpoint.serve(TICKET_DOC_ID, { time: Date.now(), blocks: [paragraph('seed-1', 'seeded')] });

    const client = connect(TICKET_DOC_ID, tickets.compatible);

    await client.whenConnected();

    const before = client.provider.tag;

    expect(before).not.toBeNull();
    expect(client.blockIds()).toEqual(['seed-1']);

    client.store.addBlock(paragraph('a1', 'before the reset'));

    const witness = connect(TICKET_DOC_ID, tickets.compatible);

    await witness.whenConnected();
    await waitFor(
      () => holds(witness.blockIds(), ['a1']),
      () => `the room to hold a1 before the reset; ${witness.describe()}`,
    );
    witness.destroy();

    const reset = await server.request(
      'POST',
      `/sync/${TICKET_DOC_ID}/reset`,
      { headers: ticketHeaders(tickets.compatible) },
    );

    expect(reset.status, reset.text).toBe(204);

    await waitFor(
      () => client.statuses.some((entry) => entry.detail?.code === CLOSE_LINEAGE_RESET),
      () => `the client to see the lineage close; ${client.describe()}`,
    );

    await waitFor(
      () => client.provider.status === 'connected' &&
        client.provider.tag !== null &&
        client.provider.tag.lineage !== before?.lineage,
      () => `the client to resync on the new lineage; ${client.describe()}`,
    );

    // The client half of the reset invariant: the pre-reset edit lived only in
    // the document `resetForRelineage` threw away, so neither the re-seeded
    // room nor the reconnecting client can carry it.
    expect(client.blockIds()).toEqual(['seed-1']);
    expect(client.provider.tag?.epoch).toBe((before?.epoch ?? 0) + 1);
    expect(client.provider.tag?.format).toBe(1);
  });
}, TEST_TIMEOUT_MS);

it('reports offline with close 1001 when the server drains on SIGTERM', async () => {
  await withBlokServer('none', async ({ connect, server }) => {
    const client = connect('drain');

    await client.whenConnected();
    await server.stop();

    await waitFor(
      () => client.statuses.some((entry) =>
        entry.status === 'offline' && entry.detail?.code === CLOSE_GOING_AWAY),
      () => `the client to see the drain close; ${client.describe()}`,
    );

    // A drain is recoverable: the provider backs off and retries rather than
    // giving up, so no status may be the terminal 'error'.
    expect(client.statuses.filter((entry) => entry.status === 'error')).toEqual([]);
  });
}, TEST_TIMEOUT_MS);

it('publishes awareness that a stock peer sees, including one that joins later', async () => {
  await withBlokServer('none', async ({ connect, connectStock }) => {
    const presence = { user: { name: 'alice', color: '#3b82f6' }, blockId: 'block-1' };
    const alice = connect('presence');
    const bob = connectStock('presence');

    await Promise.all([alice.whenConnected(), bob.whenSynced()]);

    // After 'connected': the provider enables awareness on connect, and a field
    // set before that is dropped by the seam.
    alice.store.setAwarenessField('user', presence.user);
    alice.store.setAwarenessField('blockId', presence.blockId);

    await waitFor(
      () => alicePresence(bob.provider.awareness.getStates()).length === 1,
      () => `bob to see alice's presence; ${bob.describe()}; ${alice.describe()}`,
    );
    expect(alicePresence(bob.provider.awareness.getStates())[0]).toEqual(presence);

    const carol = connectStock('presence');

    await carol.whenSynced();
    // Alice never touches her state again, so carol can only learn it through
    // the server's join-time queryAwareness and the provider's reply to it. The
    // deadline stays under the 15 s renewal that would re-broadcast it anyway.
    await waitFor(
      () => alicePresence(carol.provider.awareness.getStates()).length === 1,
      () => `carol to learn alice's presence on join; ${carol.describe()}`,
      5_000,
    );
    expect(alicePresence(carol.provider.awareness.getStates())[0]).toEqual(presence);
  });
}, TEST_TIMEOUT_MS);
