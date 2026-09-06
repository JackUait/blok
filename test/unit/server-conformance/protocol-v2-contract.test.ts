// @vitest-environment node

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, it as baseIt } from 'vitest';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { startDocEndpoint, type FixtureDocEndpoint } from './doc-endpoint';
import { startServer, type RunningServer } from './run-against';

/**
 * Hard-kill recovery for `blok-sync.v2`, proved from OUTSIDE the process: a
 * real server binary, a real local collaboration directory, SIGKILL, a
 * restart on the same directory, and a late join that reads back what
 * survived. Every in-process proof of the same behaviour already exists in
 * Blok.Server.Tests; none of it can observe a process dying.
 *
 * Same gate as the other conformance files — only
 * scripts/test-server-conformance.mjs builds the binary and sets
 * BLOK_CONFORMANCE_SERVER, so a plain `yarn test` skips.
 *
 * THE HOST ONLY JOURNALS UNDER --conformance-journal, which exists solely in
 * the BLOK_SERVER_CONFORMANCE build. A stock host resolves no
 * ICollabOperationStore, so it negotiates v1 and has no journal at all; every
 * helper here therefore asserts the negotiated subprotocol before it asserts
 * anything about durability.
 *
 * WHAT NONE OF THIS PROVES IS FSYNC, and the gap is bigger than it looks. A
 * killed process leaves its page cache to the kernel, so a record that reached
 * write(2) survives SIGKILL whether or not it was flushed to stable storage.
 * Deleting `journal.Flush(flushToDisk: true)` from LocalCollabOperationStore
 * outright leaves all six of these tests green — the journal FileStream is
 * opened with BufferSize = 0, so the bytes reach the page cache on the write
 * either way. The line the store's own remarks call "THE ACKNOWLEDGEMENT
 * BOUNDARY IS ONE FLUSH" therefore has NO coverage here. These tests prove
 * ORDERING: nothing is acknowledged before it is written. Durability across
 * power loss needs a power cut or a fault-injecting filesystem.
 */
const unset = (name: string): boolean =>
  process.env[name] === undefined || process.env[name] === '';

const it = baseIt.skipIf(unset('BLOK_CONFORMANCE_SERVER'));

const DOC_ID = 'doc-journal';
/** The document every fixture ticket in `fixtures/tickets.json` names. */
const TICKET_DOC_ID = 'doc-42';
const ALLOWED_ORIGIN = 'https://app.example.com';
const PROTOCOL_V2 = 'blok-sync.v2';
const SYNC_TYPE = 0;
const STEP1 = 0;
const STEP2 = 1;
const UPDATE = 2;
const AWARENESS_TYPE = 1;
const CONTROL_TYPE = 100;
const OPERATION_TYPE = 102;
const ACKNOWLEDGEMENT_TYPE = 103;
const REJECTION_TYPE = 104;
const DRAINING_CLOSE = 1001;
const RESET_CLOSE = 4409;
const UNAVAILABLE_CLOSE = 4503;
/** Its own text, so a failed commit is not read as a failed seed (same 4503). */
const COMMIT_UNAVAILABLE_REASON = 'commit unavailable, retry';
/** The shared Yjs root every operation in this file appends one string to. */
const ROOT = 'conformance';
/** CollabJournalCodec: bodyLength + version + source + a 32-byte header checksum. */
const RECORD_HEADER_BYTES = 38;
const DEADLINE_MS = 15_000;
const POLL_INTERVAL_MS = 20;
const TEST_TIMEOUT_MS = 120_000;

interface CloseRecord {
  code: number;
  reason: string;
}

interface V2Client {
  readonly acks: Map<string, string>;
  /** How many type-1 frames this connection has been relayed. */
  readonly awarenessFrames: number;
  readonly closed: CloseRecord | null;
  readonly doc: Y.Doc;
  readonly lineage: string;
  readonly rejections: Map<string, string>;
  /** Sends an operation and resolves with its server sequence. */
  commit(update: Uint8Array, operationId?: string): Promise<string>;
  describe(): string;
  destroy(): void;
  /** Absorbs whatever has arrived; `doc` only advances when something reads. */
  drain(): void;
  /** Publishes one y-protocols presence state as a type-1 frame. */
  publishPresence(state: Record<string, unknown>): void;
  /** `lineage` defaults to the one this connection was told; pass another to name a superseded one. */
  submit(operationId: string, update: Uint8Array, lineage?: string): void;
  waitForAck(operationId: string): Promise<string>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** The check phase, so a frame that arrived in the poll phase is already absorbed. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function waitFor(
  ready: () => boolean,
  describe: () => string,
  timeoutMs = DEADLINE_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!ready()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${describe()}`);
    }

    await delay(POLL_INTERVAL_MS);
  }
}

function writeVarUint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;

  while (rest >= 0x80) {
    bytes.push((rest & 0x7f) | 0x80);
    rest >>>= 7;
  }

  bytes.push(rest);

  return bytes;
}

function readVarUint(bytes: Uint8Array, from: number): [number, number] {
  let value = 0;
  let shift = 0;
  let at = from;

  while (at < bytes.length) {
    const next = bytes[at];

    at += 1;
    value += (next & 0x7f) * 2 ** shift;

    if ((next & 0x80) === 0) {
      return [value, at];
    }

    shift += 7;
  }

  throw new Error('Unterminated varuint in a server frame');
}

// `Uint8Array<ArrayBuffer>`, not bare `Uint8Array`: every frame here is handed
// to `WebSocket.send`, which takes `BufferSource` and so refuses a view whose
// buffer could be a SharedArrayBuffer. `Uint8Array.from` allocates a real
// ArrayBuffer, so this is the true type — widening it back breaks every send.
function frameOf(parts: number[][]): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(parts.flat());
}

function syncFrame(subType: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  return frameOf([
    writeVarUint(SYNC_TYPE),
    writeVarUint(subType),
    writeVarUint(payload.length),
    [...payload],
  ]);
}

function operationFrame(
  lineage: string,
  operationId: string,
  update: Uint8Array,
): Uint8Array<ArrayBuffer> {
  // Canonical metadata: no whitespace, keys in this order (protocol §4.2).
  const metadata = Buffer.from(JSON.stringify({ lineage, operationId }), 'utf8');

  return frameOf([
    writeVarUint(OPERATION_TYPE),
    writeVarUint(metadata.length),
    [...metadata],
    writeVarUint(update.length),
    [...update],
  ]);
}

function readMetadata(frame: Uint8Array, after: number): Record<string, unknown> {
  const [length, start] = readVarUint(frame, after);
  const parsed: unknown = JSON.parse(
    Buffer.from(frame.slice(start, start + length)).toString('utf8'),
  );

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('A metadata section did not hold a JSON object');
  }

  return parsed as Record<string, unknown>;
}

function requiredString(metadata: Record<string, unknown>, key: string): string {
  const value = metadata[key];

  if (typeof value !== 'string') {
    throw new Error(`A server frame is missing the "${key}" metadata field`);
  }

  return value;
}

function operationId(): string {
  return randomBytes(16).toString('hex');
}

/**
 * One update per call, each from its own document, so the updates carry no
 * dependency on one another: a subset can be applied in any order and every
 * value still shows up. Dependent updates would make a dropped operation hide
 * every later one and turn a durability assertion into a Yjs-pending one.
 */
function independentUpdate(value: string): Uint8Array {
  const doc = new Y.Doc();
  let captured: Uint8Array | undefined;

  doc.on('update', (update: Uint8Array) => {
    captured = update;
  });
  doc.getArray<string>(ROOT).push([value]);
  doc.destroy();

  if (captured === undefined) {
    throw new Error(`Building the update for "${value}" emitted nothing`);
  }

  return captured;
}

function contentOf(doc: Y.Doc): string[] {
  return [...doc.getArray<string>(ROOT).toArray()].sort();
}

function docKey(docId: string): string {
  return createHash('sha256').update(docId, 'utf8').digest('hex');
}

function journalDirectory(collabDirectory: string, docId: string): string {
  return join(collabDirectory, `${docKey(docId)}.journal`);
}

async function fileStartingWith(directory: string, prefix: string): Promise<string | null> {
  const names = (await readdir(directory)).filter((name) => name.startsWith(prefix));

  if (names.length > 1) {
    throw new Error(`${directory} holds ${names.length} "${prefix}*" files: ${names.join(', ')}`);
  }

  return names.length === 0 ? null : join(directory, names[0]);
}

async function journalFile(collabDirectory: string, docId: string): Promise<string> {
  const directory = journalDirectory(collabDirectory, docId);
  const path = await fileStartingWith(directory, 'journal.');

  if (path === null) {
    throw new Error(`${directory} holds no journal file: ${(await readdir(directory)).join(', ')}`);
  }

  return path;
}

/** `checkpoint.<generation>.<through>.<fence>`; null when none is published. */
async function checkpointThrough(
  collabDirectory: string,
  docId: string,
): Promise<number | null> {
  const path = await fileStartingWith(journalDirectory(collabDirectory, docId), 'checkpoint.');

  if (path === null) {
    return null;
  }

  const parts = path.split('.');

  return Number(parts[parts.length - 2]);
}

/**
 * Byte offsets of every record. A journal whose records do not tile it exactly
 * is REFUSED rather than reported as a plausible count: RECORD_HEADER_BYTES is
 * hand-copied from CollabJournalCodec.HeaderSize, and a header that grew would
 * otherwise silently mis-parse and make every length assertion in this file
 * meaningless.
 */
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

async function journalDigest(collabDirectory: string, docId: string): Promise<string> {
  const directory = journalDirectory(collabDirectory, docId);
  const digest = createHash('sha256');

  // Only the per-lineage files. The lock is a liveness handle and the manifest
  // legitimately gains a fence on every open; a re-seed would mint a new
  // generation, so it would show up in these names and bytes anyway.
  const durable = (name: string): boolean =>
    name.startsWith('journal.') || name.startsWith('baseline.') || name.startsWith('checkpoint.');

  for (const name of (await readdir(directory)).filter(durable).sort()) {
    digest.update(name).update(await readFile(join(directory, name)));
  }

  return digest.digest('hex');
}

interface Tickets {
  compatible: string;
  readOnly: string;
  secret: string;
  /** A second WRITER, user `u2` on the same document — the actor contrast. */
  userTwo: string;
}

/** The same signed fixture passes the other conformance files use; `doc-42` is their document. */
function loadTickets(): Tickets {
  const path = fileURLToPath(new URL('./fixtures/tickets.json', import.meta.url));
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('The server ticket fixture has an invalid shape');
  }

  const read = (key: keyof Tickets): string => {
    const value = (parsed as Record<string, unknown>)[key];

    if (typeof value !== 'string' || value === '') {
      throw new Error(`The server ticket fixture is missing "${key}"`);
    }

    return value;
  };

  return {
    compatible: read('compatible'),
    readOnly: read('readOnly'),
    secret: read('secret'),
    userTwo: read('userTwo'),
  };
}

const tickets = loadTickets();

function startJournalServer(
  collabDirectory: string,
  endpoint: FixtureDocEndpoint,
  auth: 'none' | 'ticket',
): Promise<RunningServer> {
  return startServer({
    args: [
      '--listen', '127.0.0.1:0',
      '--auth', auth,
      '--storage-dir', '',
      '--rate-limit', '0',
      '--collab',
      '--collab-dir', collabDirectory,
      '--doc-endpoint', endpoint.url,
      '--conformance-journal',
      ...(auth === 'ticket' ? ['--allow-origin', ALLOWED_ORIGIN] : []),
    ],
    env: auth === 'ticket' ? { BLOK_SECRET: tickets.secret } : {},
  });
}

interface RawSocket {
  readonly closed: CloseRecord | null;
  readonly frames: Uint8Array[];
  readonly socket: WebSocket;
  destroy(): void;
}

function openSocket(server: RunningServer, docId: string, ticket?: string): Promise<RawSocket> {
  const url = `${server.baseUrl.replace(/^http:/, 'ws:')}/sync/${encodeURIComponent(docId)}`;
  const protocols = ticket === undefined
    ? [PROTOCOL_V2, 'blok-sync.v1']
    : [PROTOCOL_V2, 'blok-sync.v1', ticket];
  // Node's WebSocket sends no Origin header and ticket mode refuses an upgrade
  // without an allowed one. Node takes headers through an undici init object in
  // the protocols slot; the DOM typing does not know it.
  const socket = ticket === undefined
    ? new WebSocket(url, protocols)
    : new WebSocket(
        url,
        { protocols, headers: { Origin: ALLOWED_ORIGIN } } as unknown as string[],
      );
  const frames: Uint8Array[] = [];
  let closed: CloseRecord | null = null;

  socket.binaryType = 'arraybuffer';
  socket.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.data instanceof ArrayBuffer) {
      frames.push(new Uint8Array(event.data));
    }
  });
  socket.addEventListener('close', (event: CloseEvent) => {
    closed = { code: event.code, reason: event.reason };
  });

  const handle: RawSocket = {
    get closed() {
      return closed;
    },
    frames,
    socket,
    destroy: () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
  };

  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => resolve(handle), { once: true });
    socket.addEventListener('error', () => {
      reject(new Error(`Could not open a sync socket to ${url}`));
    }, { once: true });
  });
}

/**
 * Opens a socket, checks that the server picked v2, reads the lineage off the
 * control frame and finishes the sync phase. The room refuses an operation
 * sent before it has answered a SyncStep1 (`not-synced`), so the handshake is
 * not optional.
 */
async function connect(
  server: RunningServer,
  docId = DOC_ID,
  ticket?: string,
): Promise<V2Client> {
  const raw = await openSocket(server, docId, ticket);
  const acks = new Map<string, string>();
  const rejections = new Map<string, string>();
  const doc = new Y.Doc();
  let lineage: string | null = null;
  let synced = false;
  let awarenessFrames = 0;

  const absorb = (frame: Uint8Array): void => {
    const [type, afterType] = readVarUint(frame, 0);

    if (type === AWARENESS_TYPE) {
      awarenessFrames += 1;
    } else if (type === SYNC_TYPE) {
      const [subType, afterSubType] = readVarUint(frame, afterType);
      const [length, start] = readVarUint(frame, afterSubType);
      const carriesState = subType === STEP2 || subType === UPDATE;

      if (carriesState) {
        Y.applyUpdate(doc, frame.slice(start, start + length));
      }

      synced ||= subType === STEP2;
    } else if (type === CONTROL_TYPE) {
      lineage = requiredString(readMetadata(frame, afterType), 'lineage');
    } else if (type === ACKNOWLEDGEMENT_TYPE) {
      const metadata = readMetadata(frame, afterType);

      acks.set(
        requiredString(metadata, 'operationId'),
        requiredString(metadata, 'serverSequence'),
      );
    } else if (type === REJECTION_TYPE) {
      const metadata = readMetadata(frame, afterType);

      rejections.set(requiredString(metadata, 'operationId'), requiredString(metadata, 'code'));
    }
  };

  const drain = (): void => {
    for (const frame of raw.frames.splice(0)) {
      absorb(frame);
    }
  };

  const describe = (): string =>
    `socket protocol=${raw.socket.protocol} lineage=${String(lineage)} ` +
    `acks=${JSON.stringify([...acks])} rejections=${JSON.stringify([...rejections])} ` +
    `awareness=${awarenessFrames} closed=${JSON.stringify(raw.closed)}`;

  expect(
    raw.socket.protocol,
    'the server must select blok-sync.v2; without a registered operation store it has no journal ' +
    'and every durability assertion below would be vacuous',
  ).toBe(PROTOCOL_V2);

  await waitFor(() => {
    drain();

    return lineage !== null;
  }, () => `the type-100 control frame (${describe()})`);

  raw.socket.send(syncFrame(STEP1, Y.encodeStateVector(doc)));
  await waitFor(() => {
    drain();

    return synced;
  }, () => `the server's SyncStep2 (${describe()})`);

  const waitForAck = async (id: string): Promise<string> => {
    await waitFor(() => {
      drain();

      return acks.has(id) || rejections.has(id) || raw.closed !== null;
    }, () => `an answer to operation ${id} (${describe()})`);

    const sequence = acks.get(id);

    if (sequence === undefined) {
      throw new Error(`Operation ${id} was not acknowledged: ${describe()}`);
    }

    return sequence;
  };

  return {
    doc,
    describe,
    drain,
    get awarenessFrames() {
      drain();

      return awarenessFrames;
    },
    get acks() {
      drain();

      return acks;
    },
    get rejections() {
      drain();

      return rejections;
    },
    get closed() {
      drain();

      return raw.closed;
    },
    get lineage() {
      if (lineage === null) {
        throw new Error('The server sent no control frame');
      }

      return lineage;
    },
    commit: (update, id = operationId()) => {
      raw.socket.send(operationFrame(lineage ?? '', id, update));

      return waitForAck(id);
    },
    destroy: () => {
      raw.destroy();
      doc.destroy();
    },
    // y-protocols' own encoder, so the server's awareness validator sees the
    // frame every stock client sends. The room relays it verbatim and never
    // reads it, which is exactly what the actor case has to be able to assume.
    publishPresence: (state) => {
      const awareness = new Awareness(doc);

      awareness.setLocalState(state);

      const update = encodeAwarenessUpdate(awareness, [doc.clientID]);

      raw.socket.send(frameOf([
        writeVarUint(AWARENESS_TYPE),
        writeVarUint(update.length),
        [...update],
      ]));
      awareness.destroy();
    },
    submit: (id, update, named = lineage ?? '') => {
      raw.socket.send(operationFrame(named, id, update));
    },
    waitForAck,
  };
}

/** The plan's late join: a fresh connection whose SyncStep2 is the recovered document. */
async function lateJoin(server: RunningServer, docId = DOC_ID): Promise<string[]> {
  const client = await connect(server, docId);

  try {
    return contentOf(client.doc);
  } finally {
    client.destroy();
  }
}

interface Harness {
  collabDirectory: string;
  endpoint: FixtureDocEndpoint;
  /** Every server started this way is stopped when the test ends, pass or fail. */
  start(): Promise<RunningServer>;
}

async function withHarness(
  body: (harness: Harness) => Promise<void>,
  auth: 'none' | 'ticket' = 'none',
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'blok-journal-'));
  const collabDirectory = join(root, 'collab');
  const endpoint = await startDocEndpoint();
  const servers: RunningServer[] = [];

  try {
    await body({
      collabDirectory,
      endpoint,
      start: async () => {
        const server = await startJournalServer(collabDirectory, endpoint, auth);

        servers.push(server);

        return server;
      },
    });
  } finally {
    for (const server of servers) {
      await server.stop();
    }

    await endpoint.stop();
    await rm(root, { force: true, recursive: true });
  }
}

/**
 * Like `waitForAck`, but the answer this operation is owed is a type-104. It
 * never settles on an acknowledgement, because the id under test may already
 * be ACKNOWLEDGED from an earlier send — which is the whole point of the
 * conflict case.
 */
async function waitForRejection(client: V2Client, id: string): Promise<string> {
  await waitFor(
    () => client.rejections.has(id) || client.closed !== null,
    () => `a rejection of operation ${id} (${client.describe()})`,
  );

  const code = client.rejections.get(id);

  if (code === undefined) {
    throw new Error(`Operation ${id} was not rejected: ${client.describe()}`);
  }

  return code;
}

/**
 * A join after a commit failure. The room manager refuses the document for a
 * doubling wait rather than reloading it through the outage, so the FIRST join
 * after the store recovers is answered with a close; this probes until one
 * survives instead of assuming a duration.
 */
async function connectAfterOutage(server: RunningServer, docId = DOC_ID): Promise<V2Client> {
  const deadline = Date.now() + DEADLINE_MS;

  for (;;) {
    const probe = await openSocket(server, docId);

    await waitFor(
      () => probe.frames.length > 0 || probe.closed !== null,
      () => 'the room to answer a probe join',
    );

    const refused = probe.closed !== null;

    probe.destroy();

    if (!refused) {
      return connect(server, docId);
    }

    if (Date.now() > deadline) {
      throw new Error(`The room for "${docId}" stayed unavailable for ${DEADLINE_MS} ms`);
    }

    await delay(POLL_INTERVAL_MS);
  }
}

/** CollabJournalCodec's body: operationId, sequence, ticks, then the actor's length. */
function actorOf(journal: Buffer, offset: number): string | null {
  const body = offset + RECORD_HEADER_BYTES;
  const length = journal.readInt32LE(body + 32);

  return length < 0 ? null : journal.toString('utf8', body + 36, body + 36 + length);
}

/**
 * The journal as it stood the instant the acknowledgement was seen. Polled one
 * event-loop turn at a time and read SYNCHRONOUSLY, because every millisecond
 * of slack here is time a server that acknowledged before it wrote would use
 * to catch up — which is exactly what this must not tolerate.
 */
async function journalWhenAcknowledged(
  client: V2Client,
  id: string,
  journal: string,
): Promise<Buffer> {
  const deadline = Date.now() + DEADLINE_MS;

  while (Date.now() < deadline) {
    if (client.acks.has(id)) {
      return readFileSync(journal);
    }

    await nextTurn();
  }

  throw new Error(`Timed out waiting for the acknowledgement of ${id} (${client.describe()})`);
}

it(
  'an acknowledged operation survives a hard kill and restart',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, endpoint, start }) => {
    const server = await start();
    const client = await connect(server);

    const journal = await journalFile(collabDirectory, DOC_ID);
    const acknowledged = operationId();

    client.submit(acknowledged, independentUpdate('alpha'));
    // At the acknowledgement, not after the kill: read later this passes for a
    // server that acknowledged first and wrote a moment after. It shortens the
    // window rather than closing it — the room's Send runs asynchronously to
    // its commit lane, so even a server that acknowledges before it appends
    // usually gets the record down before the frame leaves the socket
    // (measured: this catches such a server about one run in three). The
    // ordering is pinned DETERMINISTICALLY by "a failed journal commit
    // acknowledges nothing ..." below, where the append cannot succeed at all.
    expect(recordOffsets(await journalWhenAcknowledged(client, acknowledged, journal)))
      .toHaveLength(1);
    expect(client.acks.get(acknowledged)).toBe('1');
    client.destroy();
    await server.kill();

    // Asserted AFTER the kill, which is what makes this a CRASH test: a
    // graceful stop drains, and a drain exports the projection. Nothing was
    // written outside the journal, so nothing else can explain the recovery.
    expect(endpoint.puts).toHaveLength(0);
    // A journal-backed room writes no working-set blob at all.
    expect(existsSync(join(collabDirectory, docKey(DOC_ID)))).toBe(false);
    expect(recordOffsets(await readFile(journal))).toHaveLength(1);

    const restarted = await start();

    expect(await lateJoin(restarted)).toEqual(['alpha']);
  }),
);

it(
  'a torn final journal record is dropped and the resend commits exactly once on restart',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const client = await connect(server);
    const third = operationId();
    // The retry has to carry the very same bytes: the same id with different
    // bytes is operation-id-conflict, not a duplicate.
    const gamma = independentUpdate('gamma');

    expect(await client.commit(independentUpdate('alpha'))).toBe('1');
    expect(await client.commit(independentUpdate('beta'))).toBe('2');
    // Sent but never waited on: the outcome of this one is unknown to the
    // client, which is the crash table's "journal result unknown" row.
    client.submit(third, gamma);
    client.destroy();
    await server.kill();

    // A tail that is not a whole record. SIGKILL cannot produce this — the
    // journal stream is unbuffered, so a record is one write(2) that either
    // happened or did not — but a power cut or a partial sector can, and
    // recovery must drop exactly it and nothing before it.
    await appendFile(await journalFile(collabDirectory, DOC_ID), Buffer.alloc(12, 0xab));

    const restarted = await start();

    try {
      const resent = await connect(restarted);

      // Fresh or duplicate, the same id lands on the same sequence: the
      // torn tail cost the lineage nothing and the retry committed once.
      expect(await resent.commit(gamma, third)).toBe('3');
      expect(await resent.commit(independentUpdate('delta'))).toBe('4');
      expect(contentOf(resent.doc)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
      resent.destroy();
      expect(await lateJoin(restarted)).toEqual(['alpha', 'beta', 'delta', 'gamma']);
    } finally {
      await restarted.stop();
    }
  }),
);

it(
  'an acknowledgement lost after the commit replays one journal record',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const client = await connect(server);
    const second = operationId();
    const beta = independentUpdate('beta');

    expect(await client.commit(independentUpdate('alpha'))).toBe('1');
    expect(await client.commit(beta, second)).toBe('2');
    client.destroy();
    await server.kill();

    const journal = await journalFile(collabDirectory, DOC_ID);

    expect(recordOffsets(await readFile(journal))).toHaveLength(2);

    const restarted = await start();

    try {
      const resent = await connect(restarted);

      // The record is found, not written again: the original sequence comes
      // back and the next new operation is 3, not 4.
      expect(await resent.commit(beta, second)).toBe('2');
      expect(await resent.commit(independentUpdate('gamma'))).toBe('3');
      expect(recordOffsets(await readFile(journal))).toHaveLength(3);
      resent.destroy();
      expect(await lateJoin(restarted)).toEqual(['alpha', 'beta', 'gamma']);
    } finally {
      await restarted.stop();
    }
  }),
);

it(
  'checkpoint lag replays the journal tail after a hard kill',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const client = await connect(server);
    const committed: string[] = [];
    let through: number | null = null;

    // The room publishes a checkpoint off CollabRoomOptions.CheckpointOperationThreshold,
    // which no host flag exposes, so the count is discovered rather than
    // hard-coded. The checkpoint is posted onto the room's lane during the
    // commit that crosses the threshold, so it has run by the time the next
    // acknowledgement arrives.
    for (let index = 1; index <= 96 && through === null; index++) {
      const value = `op-${String(index).padStart(2, '0')}`;

      expect(await client.commit(independentUpdate(value))).toBe(String(index));
      committed.push(value);
      through = await checkpointThrough(collabDirectory, DOC_ID);
    }

    expect(through, `no checkpoint after ${committed.length} operations`).not.toBeNull();

    for (const value of ['tail-a', 'tail-b', 'tail-c']) {
      expect(await client.commit(independentUpdate(value))).toBe(String(committed.length + 1));
      committed.push(value);
    }

    client.destroy();
    await server.kill();

    // The checkpoint still lags the journal: everything after it exists only
    // as tail records, so a restart that replayed the checkpoint alone would
    // lose them.
    expect(await checkpointThrough(collabDirectory, DOC_ID)).toBe(through);
    expect(through).toBeLessThan(committed.length);

    const restarted = await start();

    try {
      expect(await lateJoin(restarted)).toEqual([...committed].sort());
    } finally {
      await restarted.stop();
    }
  }),
);

it(
  'a drain never acknowledges an operation the journal did not commit',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ start }) => {
    const server = await start();
    const client = await connect(server);
    const sent = new Map<string, string>();

    for (let index = 0; index < 8; index++) {
      const value = `drain-${index}`;
      const id = operationId();

      sent.set(id, value);
      client.submit(id, independentUpdate(value));
    }

    await waitFor(() => client.acks.size > 0, () => `a first acknowledgement (${client.describe()})`);
    await server.stop();
    await waitFor(() => client.closed !== null, () => `the drain's close (${client.describe()})`);
    expect(client.closed?.code).toBe(DRAINING_CLOSE);

    const acked = [...client.acks.entries()];

    expect(acked.length).toBeGreaterThan(0);
    client.destroy();

    const restarted = await start();

    try {
      const rejoined = await connect(restarted);
      const next = Number(await rejoined.commit(independentUpdate('after-drain')));
      const durableThrough = next - 1;

      // Sequences are gap-free, so the durable high-water mark is the count of
      // records the restart found. Every sequence the drain acknowledged has to
      // sit at or below it, or the server acknowledged an operation it never
      // committed.
      for (const [id, sequence] of acked) {
        expect(Number(sequence), `operation ${id} was acknowledged above the durable mark`)
          .toBeLessThanOrEqual(durableThrough);
      }

      const recovered = contentOf(rejoined.doc);

      for (const [id] of acked) {
        expect(recovered, `${sent.get(id) ?? id} was acknowledged but did not survive`)
          .toContain(sent.get(id));
      }

      rejoined.destroy();
    } finally {
      await restarted.stop();
    }
  }),
);

it(
  'middle journal corruption refuses to serve the document',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const client = await connect(server);

    for (const value of ['alpha', 'beta', 'gamma']) {
      await client.commit(independentUpdate(value));
    }

    client.destroy();
    await server.kill();

    const journal = await journalFile(collabDirectory, DOC_ID);
    const bytes = await readFile(journal);
    const offsets = recordOffsets(bytes);

    expect(offsets).toHaveLength(3);

    // A byte inside the SECOND record's body. A torn write never alters bytes
    // it already wrote, so a record that is neither first nor last and fails
    // its checksum can only be corruption, and recovery must not skip it.
    const target = offsets[1] + RECORD_HEADER_BYTES + 4;

    bytes[target] ^= 0xff;
    await writeFile(journal, bytes);

    const before = await journalDigest(collabDirectory, DOC_ID);
    const restarted = await start();

    try {
      const refused = await openSocket(restarted, DOC_ID);

      await waitFor(
        () => refused.closed !== null,
        () => `the refusal (frames=${refused.frames.length})`,
      );
      expect(refused.closed?.code).toBe(UNAVAILABLE_CLOSE);

      // Fail closed is a refusal, not a crash, and it re-seeds nothing.
      expect((await restarted.request('GET', '/health')).status).toBe(200);
      expect(await journalDigest(collabDirectory, DOC_ID)).toBe(before);
    } finally {
      await restarted.stop();
    }
  }),
);

it(
  'a resent operation with the same id and the same bytes is answered from history, never committed twice',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const client = await connect(server);
    const first = operationId();
    const alpha = independentUpdate('alpha');

    expect(await client.commit(alpha, first)).toBe('1');
    // The retry a client makes when it never saw the acknowledgement: the
    // ORIGINAL sequence comes back.
    expect(await client.commit(alpha, first)).toBe('1');
    // ...and the next new operation takes 2, so the duplicate spent no sequence.
    expect(await client.commit(independentUpdate('beta'))).toBe('2');
    expect(recordOffsets(await readFile(await journalFile(collabDirectory, DOC_ID))))
      .toHaveLength(2);
    client.destroy();
    expect(await lateJoin(server)).toEqual(['alpha', 'beta']);
  }),
);

it(
  'the same operation id with different bytes is refused as a conflict and never applied',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const client = await connect(server);
    const reused = operationId();

    expect(await client.commit(independentUpdate('alpha'), reused)).toBe('1');
    client.submit(reused, independentUpdate('beta'));
    expect(await waitForRejection(client, reused)).toBe('operation-id-conflict');
    // A per-operation refusal, not a close: any writer could otherwise end the
    // room for everyone by re-sending one id with different bytes.
    expect(client.closed).toBeNull();
    expect(await client.commit(independentUpdate('gamma'))).toBe('2');
    expect(recordOffsets(await readFile(await journalFile(collabDirectory, DOC_ID))))
      .toHaveLength(2);
    // The refused bytes never reached the document: the id is settled BEFORE
    // the update is applied.
    expect(contentOf(client.doc)).toEqual(['alpha', 'gamma']);
    client.destroy();
    expect(await lateJoin(server)).toEqual(['alpha', 'gamma']);
  }),
);

it(
  'a failed journal commit acknowledges nothing, closes every member 4503, and leaves the retry to settle it',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const writer = await connect(server);
    const observer = await connect(server);
    const pending = operationId();
    const beta = independentUpdate('beta');

    expect(await writer.commit(independentUpdate('alpha'))).toBe('1');

    const journal = await journalFile(collabDirectory, DOC_ID);
    const manifest = join(journalDirectory(collabDirectory, DOC_ID), 'manifest');
    const intact = await readFile(manifest);

    // The store's own head, made unreadable under the open session. Its fence
    // lives here and is re-read from this path before anything is written, so
    // every call the commit path makes now fails — which is the only outage
    // this harness can induce from outside the process.
    await writeFile(manifest, Buffer.alloc(intact.length, 0));
    writer.submit(pending, beta);
    await waitFor(
      () => writer.closed !== null && observer.closed !== null,
      () => `both members to close (${writer.describe()}; ${observer.describe()})`,
    );

    // Neither answer: the outcome is UNKNOWN, and a type-104 would tell the
    // client to quarantine work that may well be durable.
    expect(writer.acks.has(pending)).toBe(false);
    expect(writer.rejections.has(pending)).toBe(false);
    expect(writer.closed).toEqual({
      code: UNAVAILABLE_CLOSE,
      reason: COMMIT_UNAVAILABLE_REASON,
    });
    // Not only the writer: the room discards itself, so every member goes.
    expect(observer.closed).toEqual({
      code: UNAVAILABLE_CLOSE,
      reason: COMMIT_UNAVAILABLE_REASON,
    });
    expect(recordOffsets(await readFile(journal))).toHaveLength(1);
    writer.destroy();
    observer.destroy();

    await writeFile(manifest, intact);

    const retry = await connectAfterOutage(server);

    // The same operation id is how an unknown outcome is settled, and it
    // commits exactly once.
    expect(await retry.commit(beta, pending)).toBe('2');
    expect(recordOffsets(await readFile(journal))).toHaveLength(2);
    retry.destroy();
    expect(await lateJoin(server)).toEqual(['alpha', 'beta']);
  }),
);

it(
  'a published checkpoint keeps every operation id it covers answerable from history',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const client = await connect(server);
    const covered = operationId();
    const first = independentUpdate('op-01');
    const committed = ['op-01'];
    let through: number | null = null;

    expect(await client.commit(first, covered)).toBe('1');

    // Discovered, not hard-coded: the threshold is a room option no host flag
    // exposes.
    for (let index = 2; index <= 96 && through === null; index++) {
      const value = `op-${String(index).padStart(2, '0')}`;

      expect(await client.commit(independentUpdate(value))).toBe(String(index));
      committed.push(value);
      through = await checkpointThrough(collabDirectory, DOC_ID);
    }

    expect(through, `no checkpoint after ${committed.length} operations`).not.toBeNull();
    expect(through).toBeGreaterThanOrEqual(1);

    const journal = await journalFile(collabDirectory, DOC_ID);

    // A checkpoint compacts REPLAY, not history: it removes no record...
    expect(recordOffsets(await readFile(journal))).toHaveLength(committed.length);
    // ...so an id it covers still answers with its own original sequence
    // instead of being committed a second time.
    expect(await client.commit(first, covered)).toBe('1');
    expect(recordOffsets(await readFile(journal))).toHaveLength(committed.length);
    client.destroy();
    await server.kill();

    const restarted = await start();

    try {
      const rejoined = await connect(restarted);

      expect(contentOf(rejoined.doc)).toEqual([...committed].sort());
      // Still answered after a restart that replayed only the tail: the
      // durable id index spans the whole journal, checkpoint or not.
      expect(await rejoined.commit(first, covered)).toBe('1');
      rejoined.destroy();
    } finally {
      await restarted.stop();
    }
  }),
);

it(
  'a reset starts a new lineage that refuses the old one and reuses none of its ids',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const client = await connect(server);
    const carried = operationId();
    const stale = operationId();
    const alpha = independentUpdate('alpha');
    const before = client.lineage;

    expect(await client.commit(alpha, carried)).toBe('1');

    const reset = await server.request('POST', `/sync/${DOC_ID}/reset`);

    expect(reset.status, reset.text).toBe(204);
    await waitFor(() => client.closed !== null, () => `the reset close (${client.describe()})`);
    expect(client.closed?.code).toBe(RESET_CLOSE);
    client.destroy();

    const after = await connect(server);

    expect(after.lineage).not.toBe(before);
    // Refused before the id is looked up at all: the lookup answers for the
    // CURRENT lineage only, so an old-lineage operation would otherwise be
    // journalled into a history it never belonged to.
    after.submit(stale, independentUpdate('stale'), before);
    expect(await waitForRejection(after, stale)).toBe('lineage-mismatch');
    expect(after.closed).toBeNull();

    // The very id and bytes that are durable on the OLD lineage commit afresh
    // rather than answering as a duplicate out of that history. Ids are
    // lineage-scoped, which is why a client quarantines its pending
    // old-lineage rows instead of replaying them here.
    expect(await after.commit(alpha, carried)).toBe('1');
    // `1` alone cannot say which happened: a duplicate served out of the old
    // lineage carries its original sequence, which was also 1. Only the NEXT
    // sequence separates them — a duplicate commits nothing, so the new
    // lineage would still be empty and this would be `1`.
    expect(await after.commit(independentUpdate('beta'))).toBe('2');
    // And this is what separates lineage-first from lookup-first. `carried` is
    // NOW committed on the CURRENT lineage, so a server that looked the id up
    // before comparing the lineage would answer this as a duplicate. The fresh
    // id above cannot tell the two orderings apart: neither of them finds it.
    after.submit(carried, alpha, before);
    expect(await waitForRejection(after, carried)).toBe('lineage-mismatch');

    // Section 8: an acknowledgement is not a delivery receipt. This server
    // relays the committed update AFTER the type-103, so reading the document
    // off the acknowledgement is a race the test loses about half the time.
    await waitFor(
      () => {
        after.drain();

        return contentOf(after.doc).length === 2;
      },
      () => `both relayed updates (${after.describe()})`,
    );
    expect(contentOf(after.doc)).toEqual(['alpha', 'beta']);
    after.destroy();

    // The superseded generation's journal is still on disk: a reset starts a
    // new history, it does not erase the old one.
    const journals = (await readdir(journalDirectory(collabDirectory, DOC_ID)))
      .filter((name) => name.startsWith('journal.'));

    expect(journals).toHaveLength(2);
  }),
);

it(
  'an authenticated actor is journalled and a read-only member is refused without a close',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const writer = await connect(server, TICKET_DOC_ID, tickets.compatible);
    const reader = await connect(server, TICKET_DOC_ID, tickets.readOnly);
    const refused = operationId();

    expect(await writer.commit(independentUpdate('alpha'))).toBe('1');

    const journal = await journalFile(collabDirectory, TICKET_DOC_ID);
    const bytes = await readFile(journal);
    const offsets = recordOffsets(bytes);

    expect(offsets).toHaveLength(1);
    // The verified pass's own user claim — not the rate-limit key, not
    // awareness, and not anything the operation metadata carried.
    expect(actorOf(bytes, offsets[0])).toBe('u1');

    reader.submit(refused, independentUpdate('beta'));
    expect(await waitForRejection(reader, refused)).toBe('read-only');
    // A viewer is refused the WRITE, not the room.
    expect(reader.closed).toBeNull();
    expect(await writer.commit(independentUpdate('gamma'))).toBe('2');
    await waitFor(
      () => {
        reader.drain();

        return contentOf(reader.doc).includes('gamma');
      },
      () => `the read-only member to receive the broadcast (${reader.describe()})`,
    );
    expect(recordOffsets(await readFile(journal))).toHaveLength(2);
    expect(contentOf(reader.doc)).toEqual(['alpha', 'gamma']);
    writer.destroy();
    reader.destroy();
  }, 'ticket'),
);

it(
  'a v2 operation is acknowledged, relayed to a v2 peer, and served to a late join',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const alice = await connect(server);
    const bob = await connect(server);
    const first = operationId();

    alice.submit(first, independentUpdate('alpha'));
    expect(await alice.waitForAck(first)).toBe('1');

    // Section 8: an acknowledgement is not a delivery receipt, so BOTH
    // documents are read off the relay rather than off the type-103. Alice's
    // own copy is the section 7 self-echo — the broadcast that carries a
    // committed update to every member INCLUDING the socket that submitted it,
    // which nothing else on a v2 socket provides.
    await waitFor(
      () => {
        alice.drain();
        bob.drain();

        return contentOf(alice.doc).includes('alpha') && contentOf(bob.doc).includes('alpha');
      },
      () => `the committed update on both v2 members (${alice.describe()}; ${bob.describe()})`,
    );

    // The other direction, on the same lineage: sequences are gap-free across
    // members, not per connection.
    expect(await bob.commit(independentUpdate('beta'))).toBe('2');
    await waitFor(
      () => {
        alice.drain();

        return contentOf(alice.doc).includes('beta');
      },
      () => `the peer's committed update on alice (${alice.describe()})`,
    );

    expect(contentOf(alice.doc)).toEqual(['alpha', 'beta']);
    expect(contentOf(bob.doc)).toEqual(['alpha', 'beta']);
    expect(recordOffsets(await readFile(await journalFile(collabDirectory, DOC_ID))))
      .toHaveLength(2);
    alice.destroy();
    bob.destroy();

    // And a member that was never in the room is served both from the store.
    expect(await lateJoin(server)).toEqual(['alpha', 'beta']);
  }),
);

it(
  'the journalled actor comes from each connection\'s own pass, never from presence',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, start }) => {
    const server = await start();
    const one = await connect(server, TICKET_DOC_ID, tickets.compatible);
    const two = await connect(server, TICKET_DOC_ID, tickets.userTwo);

    // Presence deliberately CROSSED: each connection advertises the other's
    // user. A server that took the actor from awareness would journal the two
    // records in exactly the reverse order of the one asserted below.
    one.publishPresence({ user: { name: 'u2' } });
    two.publishPresence({ user: { name: 'u1' } });

    // The positive event that puts both states in the room before either
    // commit: the server relays presence to every OTHER member, so each side
    // seeing a type-1 frame is the peer's claim having landed.
    await waitFor(
      () => one.awarenessFrames > 0 && two.awarenessFrames > 0,
      () => `both presence claims to reach the room (${one.describe()}; ${two.describe()})`,
    );

    expect(await one.commit(independentUpdate('from-one'))).toBe('1');
    expect(await two.commit(independentUpdate('from-two'))).toBe('2');

    const bytes = await readFile(await journalFile(collabDirectory, TICKET_DOC_ID));
    const offsets = recordOffsets(bytes);

    expect(offsets).toHaveLength(2);
    // Two connections from the same address on the same document, differing in
    // nothing but the pass they presented. A room-wide or address-wide actor
    // would repeat one value; an actor read from presence would swap them.
    expect(
      offsets.map((offset) => actorOf(bytes, offset)),
      'the journalled actor did not follow the submitting connection\'s own pass'
    ).toEqual(['u1', 'u2']);
    one.destroy();
    two.destroy();
  }, 'ticket'),
);
