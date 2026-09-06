// @vitest-environment node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as decoding from 'lib0/decoding';
import { expect, it as baseIt } from 'vitest';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { DocumentStore } from '../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../src/components/modules/yjs/serializer';
import type { OutputBlockData } from '../../../types/data-formats/output-data';
import { startDocEndpoint, type FixtureDocEndpoint } from './doc-endpoint';
import { startServer, type RunningServer } from './run-against';

/**
 * Wire conformance for the sync rooms: a STOCK y-websocket client (no Blok
 * code on the wire side) against the built server binary. Same gate as
 * server-contract.test.ts — only scripts/test-server-conformance.mjs builds
 * the binary and sets BLOK_CONFORMANCE_SERVER; a plain `yarn test` skips.
 *
 * Every wait carries an explicit deadline and reports what the clients saw
 * when it expires, so a red run names the wire behaviour that was missing.
 */
const unset = (name: string): boolean =>
  process.env[name] === undefined || process.env[name] === '';

const it = baseIt.skipIf(unset('BLOK_CONFORMANCE_SERVER'));

const ALLOWED_ORIGIN = 'https://app.example.com';
const SYNC_PROTOCOL = 'blok-sync.v1';
/** Blok's epoch announcement; y-protocols uses 0-3 (plan decision 6). */
const CONTROL_MESSAGE_TYPE = 100;
/** The three v2 types. A v1 client has no handler for any of them. */
const V2_MESSAGE_TYPES = [102, 103, 104];
/** CollabJournalCodec: bodyLength + version + source + a 32-byte header checksum. */
const RECORD_HEADER_BYTES = 38;
/** Every signed fixture ticket carries this doc claim (docMismatch carries "other-doc"). */
const TICKET_DOC_ID = 'doc-42';
const POLL_INTERVAL_MS = 25;
const DEADLINE_MS = 10_000;
/** Export debounce (2s) and max delay (10s) are room defaults; the PUT follows. */
const EXPORT_DEADLINE_MS = 20_000;
const TEST_TIMEOUT_MS = 45_000;

interface SyncTickets {
  compatible: string;
  docMismatch: string;
  expired: string;
  readOnly: string;
  secret: string;
}

interface ControlFrame {
  epoch: number;
  format: number;
  /** 16 random bytes as lower hex, minted on every seed; see CollabWorkingSetTag. */
  lineage: string;
}

interface ConnectOptions {
  /** Subprotocols to offer in no-auth mode; a stock client offers none by default. */
  protocols?: string[];
  /** Default true: y-websocket reconnects on every close code outside 4400-4499. */
  reconnect?: boolean;
  /** Offers [blok-sync.v1, ticket] as subprotocols and sends the allowed Origin. */
  ticket?: string;
}

interface SyncClient {
  readonly closeCodes: number[];
  readonly controlFrames: ControlFrame[];
  readonly doc: Y.Doc;
  readonly provider: WebsocketProvider;
  /** Outer types of any 102/103/104 frame this v1 client was sent. */
  readonly v2Frames: number[];
  describe(): string;
  destroy(): void;
  whenSynced(): Promise<void>;
}

interface SyncHarness {
  /** Where the server keeps its journals; only meaningful on a journal harness. */
  readonly collabDirectory: string;
  readonly endpoint: FixtureDocEndpoint;
  readonly server: RunningServer;
  connect(docId: string, options?: ConnectOptions): SyncClient;
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

  return {
    compatible: read('compatible'),
    docMismatch: read('docMismatch'),
    expired: read('expired'),
    readOnly: read('readOnly'),
    secret: read('secret'),
  };
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

function parseControlFrame(json: string): ControlFrame {
  const parsed: unknown = JSON.parse(json);

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Control frame is not a JSON object: ${json}`);
  }

  const { epoch, format, lineage } = parsed as Record<string, unknown>;

  if (typeof epoch !== 'number' || typeof format !== 'number') {
    throw new Error(`Control frame lacks numeric epoch/format: ${json}`);
  }

  if (typeof lineage !== 'string') {
    throw new Error(`Control frame lacks a lineage string: ${json}`);
  }

  return { epoch, format, lineage };
}

/**
 * Node's WebSocket sends no Origin header (browsers do), and the ticket-mode
 * guard rejects upgrades without an allowed one. Node accepts an undici init
 * object in the protocols slot; the DOM typing does not know it.
 */
class OriginWebSocket extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, { protocols, headers: { Origin: ALLOWED_ORIGIN } } as unknown as string[]);
  }
}

function connectClient(wsUrl: string, docId: string, options: ConnectOptions): SyncClient {
  const doc = new Y.Doc();
  const closeCodes: number[] = [];
  const controlFrames: ControlFrame[] = [];
  const statuses: string[] = [];
  const v2Frames: number[] = [];
  const ticket = options.ticket;
  let errors = 0;
  const offered = options.protocols === undefined ? {} : { protocols: options.protocols };
  const handshake = ticket === undefined
    ? offered
    : { protocols: [SYNC_PROTOCOL, ticket], WebSocketPolyfill: OriginWebSocket };
  // `connect: false` so the hooks below are in place before the first frame
  // or status event; the constructor would otherwise dial synchronously.
  const provider = new WebsocketProvider(wsUrl, docId, doc, {
    connect: false,
    // Same-process providers would otherwise sync through BroadcastChannel
    // and every convergence case would pass without touching the server.
    disableBc: true,
    ...handshake,
    ...(options.reconnect === false ? { shouldReconnect: () => false } : {}),
  });

  // The stock provider knows types 0-3 only and logs "Unable to compute
  // message" for anything else; this hook records the epoch frame instead.
  provider.messageHandlers[CONTROL_MESSAGE_TYPE] = (_encoder, decoder) => {
    controlFrames.push(parseControlFrame(decoding.readVarString(decoder)));
  };

  // Same trick for the v2 types, so "a v1 client was sent a frame it cannot
  // read" becomes an assertion instead of a log line.
  for (const type of V2_MESSAGE_TYPES) {
    provider.messageHandlers[type] = () => {
      v2Frames.push(type);
    };
  }
  provider.on('connection-close', (event) => {
    if (event !== null) {
      closeCodes.push(event.code);
    }
  });
  provider.on('connection-error', () => {
    errors += 1;
  });
  provider.on('status', ({ status }) => {
    statuses.push(status);
  });
  provider.connect();

  const describe = (): string =>
    `client "${docId}"${ticket === undefined ? '' : ' (ticket)'}: ` +
    `status=${statuses.at(-1) ?? 'never connected'} synced=${provider.synced} ` +
    `protocol=${provider.ws?.protocol ?? 'none'} v2Frames=[${v2Frames.join(', ')}] ` +
    `closes=[${closeCodes.join(', ')}] errors=${errors} control=${JSON.stringify(controlFrames)}`;

  let destroyed = false;

  return {
    closeCodes,
    controlFrames,
    doc,
    provider,
    v2Frames,
    describe,
    // Idempotent: a test may destroy a client it is done with before the harness sweeps up.
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

async function withSyncServer(
  auth: 'none' | 'ticket',
  run: (harness: SyncHarness) => Promise<void>,
  // Only a --conformance-journal build registers an operation store, and only a
  // server with one journals anything at all (protocol section 11.1).
  journal = false,
): Promise<void> {
  const collabDirectory = await mkdtemp(join(tmpdir(), 'blok-sync-conformance-'));
  const endpoint = await startDocEndpoint();
  const clients: SyncClient[] = [];
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
        const client = connectClient(wsUrl, docId, options);

        clients.push(client);

        return client;
      },
    });
  } finally {
    // Destroy on the failure path too: an undestroyed provider keeps
    // reconnecting with backoff and holds the worker open.
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
 * Edits a stock client's doc through the real DocumentStore, using only its
 * binary seam (the way a provider adapter would): mirror the doc into a
 * store, mutate, apply the diff back.
 */
function editBlocks(doc: Y.Doc, mutate: (store: DocumentStore) => void): void {
  const store = createStore();

  store.applyRemoteUpdate(Y.encodeStateAsUpdate(doc));
  mutate(store);
  Y.applyUpdate(doc, store.encodeStateAsUpdate(Y.encodeStateVector(doc)));
  store.destroy();
}

/** Reads a stock client's doc the way the editor would: through DocumentStore.toJSON. */
function readBlocks(doc: Y.Doc): OutputBlockData[] {
  const store = createStore();

  store.applyRemoteUpdate(Y.encodeStateAsUpdate(doc));

  const blocks = store.toJSON();

  store.destroy();

  return blocks;
}

const paragraph = (id: string, text: string): OutputBlockData => ({ id, type: 'paragraph', data: { text } });

function addParagraph(doc: Y.Doc, id: string, text: string): void {
  editBlocks(doc, (store) => {
    store.addBlock(paragraph(id, text));
  });
}

const blockIds = (doc: Y.Doc): string[] =>
  readBlocks(doc).flatMap((block) => typeof block.id === 'string' ? [block.id] : []);

const hasBlocks = (doc: Y.Doc, ids: string[]): boolean => {
  const present = new Set(blockIds(doc));

  return ids.every((id) => present.has(id));
};

function outputBlocks(body: unknown): unknown {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>).blocks : undefined;
}

function ticketHeaders(ticket: string): Record<string, string> {
  return { Origin: ALLOWED_ORIGIN, Authorization: `Bearer ${ticket}` };
}

/*
 * `docKey` and `recordOffsets` below are byte-identical to
 * protocol-v2-contract.test.ts's copies, so a reviewer can diff those two;
 * `journalFile` is NOT — it is narrowed to the single-file case these tests
 * need. RECORD_HEADER_BYTES is hand-copied from CollabJournalCodec.HeaderSize,
 * and `recordOffsets` REFUSES a journal its records do not tile exactly rather
 * than reporting a plausible count.
 */
function docKey(docId: string): string {
  return createHash('sha256').update(docId, 'utf8').digest('hex');
}

async function journalFile(collabDirectory: string, docId: string): Promise<string> {
  const directory = join(collabDirectory, `${docKey(docId)}.journal`);
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

/**
 * The journal AS IT STOOD the instant a peer first held `ids`. Polled one
 * event-loop turn at a time and read SYNCHRONOUSLY: every millisecond of slack
 * is time a server that broadcast before it appended would use to catch up.
 * @param peer - the client whose document is watched
 * @param ids - the blocks whose arrival ends the wait
 * @param journal - the journal file to read at that instant
 */
async function journalWhenDelivered(
  peer: SyncClient,
  ids: string[],
  journal: string,
): Promise<Buffer> {
  const deadline = Date.now() + DEADLINE_MS;

  while (Date.now() < deadline) {
    if (hasBlocks(peer.doc, ids)) {
      return readFileSync(journal);
    }

    await new Promise((resolve) => {
      setImmediate(resolve);
    });
  }

  throw new Error(`Timed out waiting for ${ids.join(', ')} on ${peer.describe()}`);
}

it('converges two stock clients editing different blocks concurrently in no-auth loopback mode', async () => {
  await withSyncServer('none', async ({ connect }) => {
    const alice = connect('converge');
    const bob = connect('converge');

    await Promise.all([alice.whenSynced(), bob.whenSynced()]);

    addParagraph(alice.doc, 'a1', 'from alice');
    addParagraph(bob.doc, 'b1', 'from bob');

    await waitFor(
      () => hasBlocks(alice.doc, ['a1', 'b1']) && hasBlocks(bob.doc, ['a1', 'b1']),
      () => `both edits on both clients; ${alice.describe()}; ${bob.describe()}`,
    );

    expect(readBlocks(alice.doc)).toEqual(readBlocks(bob.doc));
    expect([...blockIds(alice.doc)].sort()).toEqual(['a1', 'b1']);
    expect(alice.controlFrames).toEqual([]);
    expect(bob.controlFrames).toEqual([]);
  });
}, TEST_TIMEOUT_MS);

it('hands a late joiner the full document state', async () => {
  await withSyncServer('none', async ({ connect }) => {
    const alice = connect('late-join');

    await alice.whenSynced();
    addParagraph(alice.doc, 'a1', 'first');
    addParagraph(alice.doc, 'a2', 'second');

    const carol = connect('late-join');

    await carol.whenSynced();
    await waitFor(
      () => hasBlocks(carol.doc, ['a1', 'a2']),
      () => `the late joiner to hold both blocks; ${carol.describe()}`,
    );

    expect(readBlocks(carol.doc)).toEqual(readBlocks(alice.doc));
  });
}, TEST_TIMEOUT_MS);

it('delivers edits made while a client was away once it reconnects', async () => {
  await withSyncServer('none', async ({ connect }) => {
    const alice = connect('reconnect');
    const bob = connect('reconnect');

    await Promise.all([alice.whenSynced(), bob.whenSynced()]);

    alice.provider.disconnect();
    addParagraph(bob.doc, 'b1', 'while alice was away');

    const witness = connect('reconnect');

    await waitFor(
      () => hasBlocks(witness.doc, ['b1']),
      () => `the server to hold bob's edit; ${witness.describe()}`,
    );
    expect(hasBlocks(alice.doc, ['b1'])).toBe(false);

    alice.provider.connect();

    await alice.whenSynced();
    await waitFor(
      () => hasBlocks(alice.doc, ['b1']),
      () => `alice to receive the missed edit; ${alice.describe()}`,
    );

    expect(readBlocks(alice.doc)).toEqual(readBlocks(bob.doc));
  });
}, TEST_TIMEOUT_MS);

it('accepts a compatible ticket offered as a subprotocol and announces the epoch first', async () => {
  await withSyncServer('ticket', async ({ connect }) => {
    const client = connect(TICKET_DOC_ID, { ticket: tickets.compatible });

    await client.whenSynced();
    await waitFor(
      () => client.controlFrames.length > 0,
      () => `the epoch control frame; ${client.describe()}`,
    );

    expect(client.controlFrames).toEqual([
      { epoch: expect.any(Number), format: 1, lineage: expect.stringMatching(/^[0-9a-f]{32}$/) },
    ]);
    expect(client.provider.ws?.protocol).toBe(SYNC_PROTOCOL);
    expect(client.closeCodes).toEqual([]);
  });
}, TEST_TIMEOUT_MS);

it('accepts then closes 4401 for a ticket bound to another doc or expired', async () => {
  await withSyncServer('ticket', async ({ connect }) => {
    for (const [name, ticket] of [
      ['docMismatch', tickets.docMismatch],
      ['expired', tickets.expired],
    ] as const) {
      const client = connect(TICKET_DOC_ID, { ticket });

      await waitFor(
        () => client.closeCodes.length > 0,
        () => `the ${name} connection to close; ${client.describe()}`,
      );

      expect(client.closeCodes, name).toEqual([4401]);
      expect(client.controlFrames, name).toEqual([]);
      expect(client.provider.synced, name).toBe(false);
    }
  });
}, TEST_TIMEOUT_MS);

it('relays a writer to a read-only ticket but never the reverse', async () => {
  await withSyncServer('ticket', async ({ connect }) => {
    const writer = connect(TICKET_DOC_ID, { ticket: tickets.compatible });
    const reader = connect(TICKET_DOC_ID, { ticket: tickets.readOnly });

    await Promise.all([writer.whenSynced(), reader.whenSynced()]);

    addParagraph(writer.doc, 'w1', 'writer one');
    await waitFor(
      () => hasBlocks(reader.doc, ['w1']),
      () => `the reader to receive w1; ${reader.describe()}`,
    );

    addParagraph(reader.doc, 'r1', 'reader edit that must be dropped');
    addParagraph(writer.doc, 'w2', 'writer two');

    // w2 completes a full round-trip after r1 was sent, so its arrival is
    // the positive event that proves r1 was dropped rather than still in flight.
    await waitFor(
      () => hasBlocks(reader.doc, ['w2']),
      () => `the reader to receive w2; ${reader.describe()}`,
    );

    expect(blockIds(writer.doc)).toEqual(['w1', 'w2']);
    expect(hasBlocks(reader.doc, ['r1'])).toBe(true);
    expect(reader.closeCodes).toEqual([]);

    const auditor = connect(TICKET_DOC_ID, { ticket: tickets.compatible });

    await auditor.whenSynced();
    await waitFor(
      () => hasBlocks(auditor.doc, ['w1', 'w2']),
      () => `a fresh writer to receive the room state; ${auditor.describe()}`,
    );

    expect(blockIds(auditor.doc)).toEqual(['w1', 'w2']);
  });
}, TEST_TIMEOUT_MS);

it('relays awareness and re-queries presence for a late joiner', async () => {
  await withSyncServer('none', async ({ connect }) => {
    const presence = { user: 'alice', blockId: 'block-1' };
    const alice = connect('presence');
    const bob = connect('presence');

    await Promise.all([alice.whenSynced(), bob.whenSynced()]);

    alice.provider.awareness.setLocalState(presence);

    await waitFor(
      () => bob.provider.awareness.getStates().has(alice.doc.clientID),
      () => `bob to see alice's presence; ${bob.describe()}`,
    );
    expect(bob.provider.awareness.getStates().get(alice.doc.clientID)).toEqual(presence);

    const carol = connect('presence');

    await carol.whenSynced();
    // Alice does not touch her state again, so carol can only learn it through
    // the server's join-time queryAwareness. The deadline stays under the 15 s
    // awareness renewal that would otherwise re-broadcast it anyway.
    await waitFor(
      () => carol.provider.awareness.getStates().has(alice.doc.clientID),
      () => `carol to learn alice's presence on join; ${carol.describe()}`,
      5_000,
    );
    expect(carol.provider.awareness.getStates().get(alice.doc.clientID)).toEqual(presence);
  });
}, TEST_TIMEOUT_MS);

it('seeds a room from the doc endpoint so a stock client reads canonical.json through the real DocumentStore', async () => {
  await withSyncServer('none', async ({ endpoint, connect }) => {
    for (const caseName of ['hierarchy-3-deep', 'database-rows']) {
      const canonical = readCanonical(caseName);
      const docId = `seed-${caseName}`;

      endpoint.serve(docId, { time: Date.now(), blocks: canonical });

      const client = connect(docId);

      await client.whenSynced();

      expect(readBlocks(client.doc), caseName).toEqual(canonical);
      client.destroy();
    }
  });
}, TEST_TIMEOUT_MS);

it('exports an edited document back to the doc endpoint with the served version', async () => {
  await withSyncServer('none', async ({ endpoint, connect }) => {
    const docId = 'exported';

    endpoint.serve(docId, {
      data: { time: Date.now(), blocks: [paragraph('seed-1', 'seeded')] },
      version: 'v7',
    });

    const client = connect(docId);

    await client.whenSynced();
    expect(blockIds(client.doc)).toEqual(['seed-1']);

    addParagraph(client.doc, 'e1', 'exported edit');

    const carriesEdit = (put: { body: unknown; docId: string }): boolean => {
      const blocks = outputBlocks(put.body);

      return put.docId === docId &&
        Array.isArray(blocks) &&
        blocks.some((block: unknown) => typeof block === 'object' && block !== null &&
          (block as Record<string, unknown>).id === 'e1');
    };

    await waitFor(
      () => endpoint.puts.some(carriesEdit),
      () => `a PUT carrying e1; PUTs so far: ${JSON.stringify(endpoint.puts)}; ${client.describe()}`,
      EXPORT_DEADLINE_MS,
    );

    const exported = endpoint.puts.find(carriesEdit);

    expect(exported?.headers['content-type']).toMatch(/^application\/json/);
    expect(exported?.headers['blok-doc-version']).toBe('v7');
    expect(outputBlocks(exported?.body)).toEqual(readBlocks(client.doc));
  });
}, EXPORT_DEADLINE_MS + TEST_TIMEOUT_MS);

it('resets a document: 204, open sockets close 4409, the next join sees epoch + 1 and the re-seeded doc', async () => {
  await withSyncServer('ticket', async ({ endpoint, server, connect }) => {
    endpoint.serve(TICKET_DOC_ID, { time: Date.now(), blocks: [paragraph('seed-1', 'seeded')] });

    const alice = connect(TICKET_DOC_ID, { ticket: tickets.compatible, reconnect: false });

    await alice.whenSynced();
    await waitFor(
      () => alice.controlFrames.length > 0,
      () => `alice's epoch control frame; ${alice.describe()}`,
    );

    const { epoch, lineage } = alice.controlFrames[0];

    addParagraph(alice.doc, 'a1', 'before the reset');

    const witness = connect(TICKET_DOC_ID, { ticket: tickets.compatible, reconnect: false });

    await waitFor(
      () => hasBlocks(witness.doc, ['a1']),
      () => `the room to hold a1 before the reset; ${witness.describe()}`,
    );

    const reset = await server.request(
      'POST',
      `/sync/${TICKET_DOC_ID}/reset`,
      { headers: ticketHeaders(tickets.compatible) },
    );

    expect(reset.status, reset.text).toBe(204);

    await waitFor(
      () => alice.closeCodes.length > 0 && witness.closeCodes.length > 0,
      () => `both sockets to close after the reset; ${alice.describe()}; ${witness.describe()}`,
    );
    expect(alice.closeCodes).toEqual([4409]);
    expect(witness.closeCodes).toEqual([4409]);

    const bob = connect(TICKET_DOC_ID, { ticket: tickets.compatible });

    await bob.whenSynced();
    await waitFor(
      () => bob.controlFrames.length > 0,
      () => `bob's epoch control frame; ${bob.describe()}`,
    );

    // The epoch counts resets; the lineage says "this is a different history",
    // which is the only thing a client holding cached updates can act on.
    expect(bob.controlFrames[0]).toEqual({
      epoch: epoch + 1,
      format: 1,
      lineage: expect.stringMatching(/^[0-9a-f]{32}$/),
    });
    expect(bob.controlFrames[0].lineage).not.toBe(lineage);
    expect(blockIds(bob.doc)).toEqual(['seed-1']);
  });
}, TEST_TIMEOUT_MS);

it('journals a v1 member\'s write before it broadcasts it, and sends it no receipt', async () => {
  await withSyncServer('none', async ({ collabDirectory, connect }) => {
    const docId = 'v1-on-a-journalled-room';
    // Named explicitly rather than left to a stock client's empty offer, so
    // the assertion below is about the version the server SELECTED.
    const alice = connect(docId, { protocols: [SYNC_PROTOCOL] });
    const bob = connect(docId, { protocols: [SYNC_PROTOCOL] });

    await Promise.all([alice.whenSynced(), bob.whenSynced()]);

    expect(alice.provider.ws?.protocol, alice.describe()).toBe(SYNC_PROTOCOL);
    expect(bob.provider.ws?.protocol, bob.describe()).toBe(SYNC_PROTOCOL);

    const journal = await journalFile(collabDirectory, docId);

    // The baseline that makes the count below mean something: a journal-backed
    // room writes no operation record for a seed or a join.
    expect(recordOffsets(readFileSync(journal))).toHaveLength(0);

    addParagraph(alice.doc, 'a1', 'a v1 write on a journal-backed room');

    // Section 9: the server awaits the append and only then publishes, so the
    // record is on disk at the instant the FIRST peer can see the update. Read
    // at that instant, not after — a later read would pass for a server that
    // broadcast first and appended a moment afterwards.
    expect(
      recordOffsets(await journalWhenDelivered(bob, ['a1'], journal)),
      'the update reached a peer before the journal held it'
    ).toHaveLength(1);

    // ...and the writer earns nothing for it. A type-103 is a v2 frame; a v1
    // provider ends its session on one it cannot parse.
    expect(
      alice.v2Frames,
      'a v1 member was sent a v2 frame on a journal-backed document'
    ).toEqual([]);
    expect(bob.v2Frames).toEqual([]);
    expect(alice.closeCodes).toEqual([]);
    expect(bob.closeCodes).toEqual([]);
    expect(readBlocks(bob.doc)).toEqual(readBlocks(alice.doc));
  }, true);
}, TEST_TIMEOUT_MS);
