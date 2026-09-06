// @vitest-environment node

import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it as baseIt } from 'vitest';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { createCollabProvider } from '../../../src/components/modules/collaboration/provider';
import type {
  CollabDocSeam,
  CollabOutbox,
  CollabOutboxRow,
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
const SYNC_PROTOCOL_V2 = 'blok-sync.v2';
/** Every signed fixture ticket carries this doc claim, so ticket cases use it. */
const TICKET_DOC_ID = 'doc-42';
/** The server drains open sockets with "going away" on SIGTERM. */
const CLOSE_GOING_AWAY = 1001;
/** The room was reset; the client's history no longer belongs to it. */
const CLOSE_LINEAGE_RESET = 4409;
/** Type 0 — SyncStep1/SyncStep2/Update, the frames v1 and v2 share. */
const SYNC_FRAME_TYPE = 0;
const SYNC_STEP1_SUBTYPE = 0;
/** Type 102 — the only frame a v2 client's write may ride (protocol section 7). */
const OPERATION_FRAME_TYPE = 102;
const ACKNOWLEDGEMENT_FRAME_TYPE = 103;
const REJECTION_FRAME_TYPE = 104;
/** CollabJournalCodec: bodyLength + version + source + a 32-byte header checksum. */
const RECORD_HEADER_BYTES = 38;
/** The reason the provider stamps on a quarantine a superseded lineage forced. */
const RELINEAGE_REASON = 'lineage-reset';
const POLL_INTERVAL_MS = 25;
const DEADLINE_MS = 15_000;
const TEST_TIMEOUT_MS = 45_000;
/** Two rounds of connect-and-converge plus a reset; the plain budget is too tight. */
const LONG_TEST_TIMEOUT_MS = 90_000;

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
  /** Every subprotocol list this client has offered, newest connection last. */
  readonly offers: string[][];
  readonly provider: CollabProvider;
  readonly sockets: WebSocket[];
  readonly statuses: StatusEntry[];
  readonly store: DocumentStore;
  blockIds(): string[];
  blocks(): OutputBlockData[];
  describe(): string;
  destroy(): void;
  /** How many SyncStep1 frames the server has sent this client. */
  receivedSyncStep1(): number;
  /** Outer frame type of everything this client has PUT ON THE WIRE. */
  sentTypes(): number[];
  whenConnected(): Promise<void>;
}

interface BlokClientOptions {
  /** Lineage the document already carries, as a cache-adopted boot passes it. */
  initialLineage?: string;
  /** Present makes this a v2-capable tab: it offers v2 and drains through the outbox. */
  outbox?: CollabOutbox;
  ticket?: string;
}

interface StockClient {
  readonly closeCodes: number[];
  readonly doc: Y.Doc;
  readonly provider: WebsocketProvider;
  /** Outer types of any 102/103/104 frame this stock reader was sent. */
  readonly v2Frames: number[];
  describe(): string;
  destroy(): void;
  whenSynced(): Promise<void>;
}

interface ClientHarness {
  /** Where the server keeps its journals; only meaningful on a journal harness. */
  readonly collabDirectory: string;
  readonly endpoint: FixtureDocEndpoint;
  readonly server: RunningServer;
  /** A real Blok client: createCollabProvider over a real DocumentStore. */
  connect(docId: string, options?: BlokClientOptions): BlokClient;
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
  onAnyDocUpdate: (callback) => store.onAnyUpdate(callback),
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
function nodeSocketFactory(
  origin: string | null,
  sockets: WebSocket[],
  offers: string[][],
  sent: Uint8Array[],
  received: Uint8Array[],
): CollabSocketFactory {
  return (url, protocols) => {
    const init = origin === null ? { protocols } : { protocols, headers: { Origin: origin } };
    const socket = new WebSocket(url, init as unknown as string[]);
    const write = socket.send.bind(socket);

    offers.push([...protocols]);
    sockets.push(socket);
    // Shadowed on the instance, never wrapped in a proxy: the provider assigns
    // onmessage/onclose as properties of this very object.
    socket.send = (data: string | ArrayBufferLike | Blob | ArrayBufferView): void => {
      if (ArrayBuffer.isView(data)) {
        sent.push(new Uint8Array(
          data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        ));
      }

      write(data);
    };
    // Coexists with the provider's own `onmessage`; the provider sets
    // binaryType before the first frame, so `data` is always an ArrayBuffer.
    socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (event.data instanceof ArrayBuffer) {
        received.push(new Uint8Array(event.data));
      }
    });

    return socket as unknown as WebSocketLike;
  };
}

/**
 * One varuint and where it ends.
 * @param frame - the frame to read
 * @param from - the byte to start at
 */
function readVarUint(frame: Uint8Array, from: number): [number, number] {
  let value = 0;
  let shift = 0;
  let at = from;

  while (at < frame.length) {
    const next = frame[at];

    at += 1;
    value += (next & 0x7f) * 2 ** shift;

    if ((next & 0x80) === 0) {
      return [value, at];
    }

    shift += 7;
  }

  throw new Error('A frame carries an unterminated varuint');
}

/** The outer type varuint of one frame. */
function outerFrameType(frame: Uint8Array): number {
  return readVarUint(frame, 0)[0];
}

/** A type-0 sub-type-0 frame: the server asking what this client is missing. */
function isSyncStep1(frame: Uint8Array): boolean {
  const [type, afterType] = readVarUint(frame, 0);

  return type === SYNC_FRAME_TYPE && readVarUint(frame, afterType)[0] === SYNC_STEP1_SUBTYPE;
}

function connectBlokClient(wsUrl: string, docId: string, options: BlokClientOptions): BlokClient {
  const store = new DocumentStore(new YBlockSerializer());
  const statuses: StatusEntry[] = [];
  const sockets: WebSocket[] = [];
  const offers: string[][] = [];
  const sent: Uint8Array[] = [];
  const received: Uint8Array[] = [];
  const ticket = options.ticket;
  const outbox = options.outbox;
  const provider = createCollabProvider({
    url: `${wsUrl}/${encodeURIComponent(docId)}`,
    docId,
    yjs: seamFor(store),
    ticketSource: ticket === undefined ? undefined : () => Promise.resolve(ticket),
    socketFactory: nodeSocketFactory(
      ticket === undefined ? null : ALLOWED_ORIGIN,
      sockets,
      offers,
      sent,
      received,
    ),
    onStatus: (status, detail) => statuses.push({ status, detail }),
    // No jitter, so a recoverable close is retried at the bottom of the
    // backoff window (500 ms for the first attempt) instead of up to a second.
    random: () => 0,
    initialLineage: options.initialLineage,
    outbox,
  });

  // The Collaboration module's outbox tap, which lives nowhere the provider can
  // reach: under v2 the provider's own seam hook drops every local edit, and
  // this is what replaces it. Same gate and same wake as the module's.
  const unhookOutbox = outbox === undefined ? null : store.onUpdate((update) => {
    if (provider.protocol !== 'v2') {
      return;
    }

    void outbox.appendLocal(update).then(() => provider.drain());
  });

  const blocks = (): OutputBlockData[] => store.toJSON();
  const blockIds = (): string[] =>
    blocks().flatMap((block) => typeof block.id === 'string' ? [block.id] : []);
  const describe = (): string =>
    `blok client "${docId}"${ticket === undefined ? '' : ' (ticket)'}: status=${provider.status} ` +
    `protocol=${provider.protocol} tag=${JSON.stringify(provider.tag)} ` +
    `blocks=[${blockIds().join(', ')}] sent=[${sent.map(outerFrameType).join(', ')}] ` +
    `statuses=${JSON.stringify(statuses)}`;

  let destroyed = false;

  provider.connect();

  return {
    offers,
    provider,
    sockets,
    statuses,
    store,
    blockIds,
    blocks,
    describe,
    receivedSyncStep1: () => received.filter(isSyncStep1).length,
    sentTypes: () => sent.map(outerFrameType),
    // Idempotent, and it destroys the STORE too: the provider turns awareness on
    // at connect, and its 3 s sweep timer would hold the worker open.
    destroy: () => {
      if (destroyed) {
        return;
      }

      destroyed = true;
      unhookOutbox?.();
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
  const closeCodes: number[] = [];
  const v2Frames: number[] = [];
  const provider = new WebsocketProvider(wsUrl, docId, doc, {
    connect: false,
    // Same-process providers would otherwise sync through BroadcastChannel and
    // every convergence case would pass without touching the server.
    disableBc: true,
  });

  // A stock reader knows types 0-3 and logs "Unable to compute message" for
  // anything else. Recording the three v2 types turns "a v2 frame reached a
  // client that cannot read one" into an assertion instead of a log line.
  for (const type of [OPERATION_FRAME_TYPE, ACKNOWLEDGEMENT_FRAME_TYPE, REJECTION_FRAME_TYPE]) {
    provider.messageHandlers[type] = () => {
      v2Frames.push(type);
    };
  }

  provider.on('connection-close', (event) => {
    if (event !== null) {
      closeCodes.push(event.code);
    }
  });

  const describe = (): string =>
    `stock client "${docId}": synced=${provider.synced} closes=[${closeCodes.join(', ')}] ` +
    `v2Frames=[${v2Frames.join(', ')}]`;

  let destroyed = false;

  provider.connect();

  return {
    closeCodes,
    doc,
    provider,
    v2Frames,
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
  // Only a --conformance-journal build registers an operation store, and only a
  // server with one selects blok-sync.v2 (SyncHandshake.SelectSubProtocol).
  journal = false,
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
        ...(journal ? ['--conformance-journal'] : []),
        ...(auth === 'ticket' ? ['--allow-origin', ALLOWED_ORIGIN] : []),
      ],
      env: auth === 'ticket' ? { BLOK_SECRET: tickets.secret } : {},
    });

    const wsUrl = `${server.baseUrl.replace(/^http:/, 'ws:')}/sync`;

    await run({
      collabDirectory,
      endpoint,
      server,
      connect: (docId, options = {}) => {
        const client = connectBlokClient(wsUrl, docId, options);

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
 * One valid Yjs update carrying one block, built off an empty document so it
 * depends on nothing: a client can journal it, another can submit it, and the
 * server can apply it in any order.
 * @param id - the block id
 * @param text - the paragraph text
 */
function localUpdate(id: string, text: string): Uint8Array {
  const store = createStore();

  store.addBlock(paragraph(id, text));

  const update = store.encodeStateAsUpdate();

  store.destroy();

  return update;
}

/*
 * The journal readers below are byte-identical to protocol-v2-contract.test.ts's
 * copies, so a reviewer can diff them; RECORD_HEADER_BYTES is hand-copied from
 * CollabJournalCodec.HeaderSize and `recordOffsets` REFUSES a journal its
 * records do not tile exactly rather than reporting a plausible count.
 */
function docKey(docId: string): string {
  return createHash('sha256').update(docId, 'utf8').digest('hex');
}

function journalDirectory(collabDirectory: string, docId: string): string {
  return join(collabDirectory, `${docKey(docId)}.journal`);
}

async function journalFile(collabDirectory: string, docId: string): Promise<string> {
  const directory = journalDirectory(collabDirectory, docId);
  const names = (await readdir(directory)).filter((name) => name.startsWith('journal.'));

  if (names.length !== 1) {
    throw new Error(`${directory} holds ${names.length} "journal.*" files: ${names.join(', ')}`);
  }

  return join(directory, names[0]);
}

function recordOffsets(journal: Buffer): number[] {
  const offsets: number[] = [];
  let at = 0;

  while (at < journal.length) {
    const bodyLength = at + RECORD_HEADER_BYTES <= journal.length
      ? journal.readInt32LE(at)
      : -1;
    const end = at + RECORD_HEADER_BYTES + bodyLength;

    if (bodyLength < 0 || end > journal.length) {
      throw new Error(
        `The journal does not tile into records: ${journal.length - at} bytes are left over ` +
        `after ${offsets.length} records, with a header size of ${RECORD_HEADER_BYTES}.`,
      );
    }

    offsets.push(at);
    at = end;
  }

  return offsets;
}

async function journalRecordCount(collabDirectory: string, docId: string): Promise<number> {
  return recordOffsets(await readFile(await journalFile(collabDirectory, docId))).length;
}

interface QuarantineEntry {
  lineage: string;
  moved: CollabOutboxRow[];
  reason: string;
  snapshot: Uint8Array;
}

/**
 * The browser store's outbox seam, in memory. ONE instance stands for ONE
 * origin's IndexedDB store, so two providers built over the same instance are
 * two tabs of the same browser sharing the same rows — which is the only way to
 * model "two tabs send the same row" outside a browser.
 *
 * Ordering matches the real store: everything but `oldestPending` runs on a
 * single serial queue, and the read deliberately stays off it.
 */
class SharedOutbox implements CollabOutbox {
  /** Rows still pending, oldest first. */
  public rows: CollabOutboxRow[] = [];

  /** Every update handed to `appendLocal`, in order. */
  public appended: Uint8Array[] = [];

  /** One entry per acknowledgement, DUPLICATES KEPT: two tabs answer twice. */
  public acknowledged: string[] = [];

  public quarantined: QuarantineEntry[] = [];

  /** What local edits are stamped with; a test sets it from the control frame. */
  public lineage: string | null = null;

  private queue: Promise<unknown> = Promise.resolve();

  private readonly listeners = new Set<() => void>();

  /**
   * @param update - the local Yjs update to journal
   */
  public appendLocal(update: Uint8Array): Promise<CollabOutboxRow> {
    return this.enqueue(() => {
      const lineage = this.lineage;

      if (lineage === null) {
        throw new Error('the outbox has no lineage to stamp a local edit with');
      }

      const row = { operationId: randomBytes(16).toString('hex'), lineage, bytes: update };

      this.appended.push(update);
      this.rows.push(row);

      return row;
    });
  }

  public oldestPending(): Promise<CollabOutboxRow | null> {
    return Promise.resolve(this.rows[0] ?? null);
  }

  /**
   * @param operationId - the row to retire
   */
  public acknowledge(operationId: string): Promise<void> {
    return this.enqueue(() => {
      this.acknowledged.push(operationId);
      this.rows = this.rows.filter((row) => row.operationId !== operationId);
    });
  }

  /**
   * @param lineage - the lineage to empty
   * @param reason - a fixed string or a rejection code
   * @param snapshot - the recovery copy taken beside the rows
   */
  public quarantineLineage(lineage: string, reason: string, snapshot: Uint8Array): Promise<number> {
    return this.enqueue(() => {
      const moved = this.rows.filter((row) => row.lineage === lineage);

      this.rows = this.rows.filter((row) => row.lineage !== lineage);
      this.quarantined.push({ lineage, moved, reason, snapshot });

      return moved.length;
    });
  }

  /**
   * @param listener - woken when another tab commits; never fired here
   */
  public onCommitted(listener: () => void): () => void {
    this.listeners.add(listener);

    return (): void => {
      this.listeners.delete(listener);
    };
  }

  /**
   * @param work - the write to run behind everything already queued
   */
  private enqueue<T>(work: () => T): Promise<T> {
    const result = this.queue.then(work);

    this.queue = result.catch(() => undefined);

    return result;
  }
}

/** The lineage this connection was told, or a failure naming what it saw. */
function lineageOf(client: BlokClient): string {
  const lineage = client.provider.tag?.lineage;

  if (lineage === undefined) {
    throw new Error(`No control frame reached ${client.describe()}`);
  }

  return lineage;
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
    const client = connect(TICKET_DOC_ID, { ticket: tickets.compatible });

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
    const writer = connect(TICKET_DOC_ID, { ticket: tickets.compatible });
    const reader = connect(TICKET_DOC_ID, { ticket: tickets.readOnly });

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

    const client = connect(TICKET_DOC_ID, { ticket: tickets.compatible });

    await client.whenConnected();

    const before = client.provider.tag;

    expect(before).not.toBeNull();
    expect(client.blockIds()).toEqual(['seed-1']);

    client.store.addBlock(paragraph('a1', 'before the reset'));

    const witness = connect(TICKET_DOC_ID, { ticket: tickets.compatible });

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

/**
 * The v2 connect exchange (protocol section 7.1) ends on the SECOND server
 * SyncStep1: `markSynced` drains, the first server SyncStep1 drains again, the
 * empty outbox turns that into a request for the residual state vector, and
 * only the answer to THAT closes the residual phase.
 *
 * The barrier has to be the arriving frame, not the leaving one. Between the
 * client's residual SyncStep1 and the server's answer, any edit made here is
 * still missing from the state vector the server quoted — so the provider
 * journals it a SECOND time as the residual operation, and a case about one row
 * silently acquires two.
 * @param client - the tab to wait on
 */
function whenIdle(client: BlokClient): Promise<void> {
  return waitFor(
    () => client.receivedSyncStep1() >= 2,
    () => `the residual sync exchange of ${client.describe()}`,
  );
}

it('a v2-capable client on a v1 server keeps its journalled rows and sends none of them', async () => {
  await withBlokServer('none', async ({ connect }) => {
    const outbox = new SharedOutbox();
    const client = connect('retained-under-v1', { outbox });
    const witness = connect('retained-under-v1');

    await Promise.all([client.whenConnected(), witness.whenConnected()]);

    // Protocol section 2. The offer leads with v2 — this client HAS an outbox —
    // and a server that registered no operation store selects v1 regardless.
    expect(
      client.offers[0],
      'a client holding durable rows never offered v2, so a journalling server could not have taken them'
    ).toEqual([SYNC_PROTOCOL_V2, SYNC_PROTOCOL]);
    expect(client.sockets[0].protocol).toBe(SYNC_PROTOCOL);
    expect(client.provider.protocol).toBe('v1');

    outbox.lineage = lineageOf(client);

    const row = await outbox.appendLocal(localUpdate('kept', 'journalled by an earlier v2 session'));

    client.provider.drain();

    // The positive event. A v1 local edit still travels, so a whole round trip
    // has elapsed with the operation frame never sent — rather than the frame
    // being merely still in flight.
    client.store.addBlock(paragraph('v1-1', 'a raw v1 update'));
    await waitFor(
      () => holds(witness.blockIds(), ['v1-1']),
      () => `the witness to receive the v1 update; ${witness.describe()}`,
    );

    expect(
      client.sentTypes(),
      'a v1 session put an operation frame on the wire, which v1 can neither acknowledge nor reject'
    ).not.toContain(OPERATION_FRAME_TYPE);
    // Kept, not sent and not thrown away: this is the state the module reports
    // as durability unavailable, and the only input it reads for it is a
    // non-null oldest pending row on a session that negotiated v1.
    expect(
      outbox.rows.map((pending) => pending.operationId),
      'a durable row went missing on a session that can never get a receipt for it'
    ).toEqual([row.operationId]);
    expect(outbox.acknowledged).toEqual([]);
    expect(outbox.quarantined).toEqual([]);
  });
}, TEST_TIMEOUT_MS);

it('a stock y-websocket reader converges with a v2 writer and is sent no v2 frame', async () => {
  await withBlokServer('none', async ({ collabDirectory, connect, connectStock }) => {
    const docId = 'v2-writer-stock-reader';
    const outbox = new SharedOutbox();
    const writer = connect(docId, { outbox });
    const reader = connectStock(docId);

    await Promise.all([writer.whenConnected(), reader.whenSynced()]);
    await whenIdle(writer);

    expect(writer.offers[0]).toEqual([SYNC_PROTOCOL_V2, SYNC_PROTOCOL]);
    expect(writer.sockets[0].protocol).toBe(SYNC_PROTOCOL_V2);
    expect(writer.provider.protocol).toBe('v2');
    expect(await journalRecordCount(collabDirectory, docId)).toBe(0);

    outbox.lineage = lineageOf(writer);
    writer.store.addBlock(paragraph('w1', 'from the v2 writer'));

    await waitFor(
      () => holds(stockBlockIds(reader.doc), ['w1']) && outbox.acknowledged.length === 1,
      () => `the stock reader to converge and the writer to be acknowledged; ` +
        `${reader.describe()}; ${writer.describe()}`,
    );

    expect(writer.sentTypes()).toContain(OPERATION_FRAME_TYPE);
    expect(outbox.rows).toEqual([]);
    expect(await journalRecordCount(collabDirectory, docId)).toBe(1);
    // Section 9, the stock row: the reader gets the ordinary type-0 broadcast,
    // no receipt, and no frame its provider would end the session on.
    expect(
      reader.v2Frames,
      'a stock y-websocket reader was sent a v2 frame it has no handler for'
    ).toEqual([]);
    expect(reader.closeCodes).toEqual([]);
    expect(readBlocks(reader.doc)).toEqual(writer.blocks());
  }, true);
}, TEST_TIMEOUT_MS);

it('two tabs sharing one outbox row are both acknowledged from a single journal record', async () => {
  await withBlokServer('none', async ({ collabDirectory, connect }) => {
    const docId = 'two-tabs-one-row';
    const outbox = new SharedOutbox();
    const tabA = connect(docId, { outbox });
    const tabB = connect(docId, { outbox });

    await Promise.all([tabA.whenConnected(), tabB.whenConnected()]);
    await Promise.all([whenIdle(tabA), whenIdle(tabB)]);

    expect(tabA.provider.protocol).toBe('v2');
    expect(tabB.provider.protocol).toBe('v2');
    expect(await journalRecordCount(collabDirectory, docId)).toBe(0);

    outbox.lineage = lineageOf(tabA);

    // Seeded rather than typed: a loopback acknowledgement lands in a
    // millisecond or two, so an edit driven through one tab's tap would retire
    // the row before the other tab ever read it and the case would be about one
    // tab. Both drains go out in the same tick, and `oldestPending` resolves on
    // the microtask queue — ahead of anything the server could answer.
    const row = await outbox.appendLocal(localUpdate('shared', 'one row, two tabs'));

    tabA.provider.drain();
    tabB.provider.drain();

    await waitFor(
      () => outbox.acknowledged.filter((id) => id === row.operationId).length === 2,
      () => `both tabs to be acknowledged for ${row.operationId}; ` +
        `acknowledged=${JSON.stringify(outbox.acknowledged)}; ${tabA.describe()}; ${tabB.describe()}`,
    );

    expect(tabA.sentTypes()).toContain(OPERATION_FRAME_TYPE);
    expect(tabB.sentTypes()).toContain(OPERATION_FRAME_TYPE);
    // Section 7.2: the second arrival is a duplicate — answered out of history,
    // never committed a second time.
    expect(
      await journalRecordCount(collabDirectory, docId),
      'the second tab committed the row again instead of being answered from history'
    ).toBe(1);
    expect(outbox.rows).toEqual([]);

    // And the duplicate spent nothing: the next new row still costs exactly one
    // record, which a server that had consumed a sequence for it would not show.
    const next = await outbox.appendLocal(localUpdate('after', 'the next new operation'));

    tabA.provider.drain();
    await waitFor(
      () => outbox.acknowledged.includes(next.operationId),
      () => `the next operation to be acknowledged; ${tabA.describe()}`,
    );
    expect(await journalRecordCount(collabDirectory, docId)).toBe(2);
  }, true);
}, TEST_TIMEOUT_MS);

it('a row one tab journalled is submitted by the other tab and both converge', async () => {
  await withBlokServer('none', async ({ connect }) => {
    const docId = 'tab-b-submits';
    const outbox = new SharedOutbox();
    const tabA = connect(docId, { outbox });
    const tabB = connect(docId, { outbox });

    await Promise.all([tabA.whenConnected(), tabB.whenConnected()]);
    await Promise.all([whenIdle(tabA), whenIdle(tabB)]);

    outbox.lineage = lineageOf(tabA);

    const row = await outbox.appendLocal(localUpdate('shared-row', 'work tab A journalled'));

    // Only B drains. A's connect-time drains are already spent, and nothing
    // wakes another: the outbox's committed hint never fires for a row this
    // browser wrote.
    tabB.provider.drain();

    // The acknowledgement is waited on TOO, not read off the convergence: the
    // server broadcasts the committed update before it sends the type-103, so a
    // relay that has landed says nothing about a receipt that has not.
    await waitFor(
      () => holds(tabA.blockIds(), ['shared-row']) && holds(tabB.blockIds(), ['shared-row']) &&
        outbox.acknowledged.length === 1,
      () => `both tabs to hold the row and tab B to be acknowledged; ` +
        `acknowledged=${JSON.stringify(outbox.acknowledged)}; ${tabA.describe()}; ${tabB.describe()}`,
    );

    // Two different mechanisms, and the case needs both to hold. The bytes were
    // built off a scratch document, so NEITHER tab ever applied them locally: B
    // has them only because section 7 broadcasts a committed update to the
    // submitter too, and A only because the same broadcast reaches every other
    // member.
    expect(
      tabA.sentTypes(),
      'the tab that journalled the row submitted it as well, so the relay proves nothing'
    ).not.toContain(OPERATION_FRAME_TYPE);
    expect(tabB.sentTypes()).toContain(OPERATION_FRAME_TYPE);
    expect(outbox.acknowledged).toEqual([row.operationId]);
    expect(outbox.rows).toEqual([]);
    expect(tabA.blocks()).toEqual(tabB.blocks());
  }, true);
}, TEST_TIMEOUT_MS);

it('read-only and reset verdicts quarantine pending bytes rather than losing or replaying them', async () => {
  await withBlokServer('ticket', async ({ connect, server }) => {
    const readerOutbox = new SharedOutbox();
    const writer = connect(TICKET_DOC_ID, { ticket: tickets.compatible });
    const reader = connect(TICKET_DOC_ID, { ticket: tickets.readOnly, outbox: readerOutbox });

    await Promise.all([writer.whenConnected(), reader.whenConnected()]);
    await whenIdle(reader);

    // A viewer negotiates v2 like anyone else; the write verdict is answered
    // per operation, not at the door.
    expect(reader.sockets[0].protocol).toBe(SYNC_PROTOCOL_V2);

    const supersededLineage = lineageOf(reader);

    readerOutbox.lineage = supersededLineage;
    reader.store.addBlock(paragraph('r1', 'typed by a viewer'));

    await waitFor(
      () => readerOutbox.quarantined.length === 1,
      () => `the viewer's row to be quarantined; ${JSON.stringify(readerOutbox.quarantined)}`,
    );

    const refused = readerOutbox.quarantined[0];

    // `read-only` is FINAL (section 6): a write verdict that flips mid-typing
    // must leave the typed content recoverable, so the bytes are moved aside
    // with a recovery snapshot rather than retried or dropped.
    expect(refused.reason).toBe('read-only');
    expect(refused.moved.map((row) => row.bytes)).toEqual(readerOutbox.appended);
    expect(refused.snapshot.byteLength).toBeGreaterThan(0);
    expect(readerOutbox.acknowledged).toEqual([]);
    expect(readerOutbox.rows).toEqual([]);

    // A viewer is refused the WRITE, not the room.
    writer.store.addBlock(paragraph('w1', 'after the refusal'));
    await waitFor(
      () => holds(reader.blockIds(), ['w1']),
      () => `the refused member to keep receiving; ${reader.describe()}`,
    );
    expect(reader.provider.status).toBe('connected');
    expect(reader.statuses.filter((entry) => entry.status === 'error')).toEqual([]);

    writer.destroy();
    reader.destroy();

    // The reset half: a tab holding a row stamped with the SUPERSEDED lineage.
    // Seeded before the connection so the relineage runs off the very first
    // control frame — a mismatch is settled before any sync completes, so no
    // drain can have raced it.
    const resetOutbox = new SharedOutbox();

    resetOutbox.lineage = supersededLineage;

    const stranded = await resetOutbox.appendLocal(localUpdate('s1', 'typed before the reset'));
    const reset = await server.request(
      'POST',
      `/sync/${TICKET_DOC_ID}/reset`,
      { headers: ticketHeaders(tickets.compatible) },
    );

    expect(reset.status, reset.text).toBe(204);

    const returning = connect(TICKET_DOC_ID, {
      ticket: tickets.compatible,
      outbox: resetOutbox,
      initialLineage: supersededLineage,
    });

    await returning.whenConnected();

    expect(lineageOf(returning)).not.toBe(supersededLineage);
    expect(resetOutbox.quarantined.map((entry) => entry.lineage)).toEqual([supersededLineage]);
    expect(resetOutbox.quarantined[0].reason).toBe(RELINEAGE_REASON);
    expect(resetOutbox.quarantined[0].moved.map((row) => row.operationId))
      .toEqual([stranded.operationId]);
    // Never replayed: an id committed on the old lineage is not a duplicate on
    // the new one, so sending it would be a fresh operation carrying dead
    // history rather than a retry.
    expect(
      returning.sentTypes(),
      'a row stamped with a superseded lineage was put on the wire of the new one'
    ).not.toContain(OPERATION_FRAME_TYPE);
    expect(resetOutbox.rows).toEqual([]);
    expect(resetOutbox.acknowledged).toEqual([]);
  }, true);
}, LONG_TEST_TIMEOUT_MS);
