// @vitest-environment node

import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { appendFile, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it as baseIt } from 'vitest';
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
 */
const unset = (name: string): boolean =>
  process.env[name] === undefined || process.env[name] === '';

const it = baseIt.skipIf(unset('BLOK_CONFORMANCE_SERVER'));

const DOC_ID = 'doc-journal';
const PROTOCOL_V2 = 'blok-sync.v2';
const SYNC_TYPE = 0;
const STEP1 = 0;
const STEP2 = 1;
const UPDATE = 2;
const CONTROL_TYPE = 100;
const OPERATION_TYPE = 102;
const ACKNOWLEDGEMENT_TYPE = 103;
const REJECTION_TYPE = 104;
const DRAINING_CLOSE = 1001;
const UNAVAILABLE_CLOSE = 4503;
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
  readonly closed: CloseRecord | null;
  readonly doc: Y.Doc;
  readonly lineage: string;
  readonly rejections: Map<string, string>;
  /** Sends an operation and resolves with its server sequence. */
  commit(update: Uint8Array, operationId?: string): Promise<string>;
  describe(): string;
  destroy(): void;
  submit(operationId: string, update: Uint8Array): void;
  waitForAck(operationId: string): Promise<string>;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

function frameOf(parts: number[][]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

function syncFrame(subType: number, payload: Uint8Array): Uint8Array {
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
): Uint8Array {
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

/** Byte offsets of every complete record; the remainder, if any, is a torn tail. */
function recordOffsets(journal: Buffer): number[] {
  const offsets: number[] = [];
  let at = 0;

  while (at + RECORD_HEADER_BYTES <= journal.length) {
    const bodyLength = journal.readInt32LE(at);
    const end = at + RECORD_HEADER_BYTES + bodyLength;

    if (bodyLength < 0 || end > journal.length) {
      break;
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

function startJournalServer(
  collabDirectory: string,
  endpoint: FixtureDocEndpoint,
): Promise<RunningServer> {
  return startServer({
    args: [
      '--listen', '127.0.0.1:0',
      '--auth', 'none',
      '--storage-dir', '',
      '--rate-limit', '0',
      '--collab',
      '--collab-dir', collabDirectory,
      '--doc-endpoint', endpoint.url,
      '--conformance-journal',
    ],
  });
}

interface RawSocket {
  readonly closed: CloseRecord | null;
  readonly frames: Uint8Array[];
  readonly socket: WebSocket;
  destroy(): void;
}

function openSocket(server: RunningServer, docId: string): Promise<RawSocket> {
  const url = `${server.baseUrl.replace(/^http:/, 'ws:')}/sync/${encodeURIComponent(docId)}`;
  const socket = new WebSocket(url, [PROTOCOL_V2, 'blok-sync.v1']);
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
async function connect(server: RunningServer, docId = DOC_ID): Promise<V2Client> {
  const raw = await openSocket(server, docId);
  const acks = new Map<string, string>();
  const rejections = new Map<string, string>();
  const doc = new Y.Doc();
  let lineage: string | null = null;
  let synced = false;

  const absorb = (frame: Uint8Array): void => {
    const [type, afterType] = readVarUint(frame, 0);

    if (type === SYNC_TYPE) {
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
    `closed=${JSON.stringify(raw.closed)}`;

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
    submit: (id, update) => {
      raw.socket.send(operationFrame(lineage ?? '', id, update));
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

async function withHarness(body: (harness: Harness) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'blok-journal-'));
  const collabDirectory = join(root, 'collab');
  const endpoint = await startDocEndpoint();
  const servers: RunningServer[] = [];

  try {
    await body({
      collabDirectory,
      endpoint,
      start: async () => {
        const server = await startJournalServer(collabDirectory, endpoint);

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

it(
  'an acknowledged operation survives a hard kill and restart',
  { timeout: TEST_TIMEOUT_MS },
  () => withHarness(async ({ collabDirectory, endpoint, start }) => {
    const server = await start();
    const client = await connect(server);

    expect(await client.commit(independentUpdate('alpha'))).toBe('1');
    client.destroy();
    await server.kill();

    // Asserted AFTER the kill, which is what makes this a CRASH test: a
    // graceful stop drains, and a drain exports the projection. Nothing was
    // written outside the journal, so nothing else can explain the recovery.
    expect(endpoint.puts).toHaveLength(0);
    // A journal-backed room writes no working-set blob at all.
    expect(existsSync(join(collabDirectory, docKey(DOC_ID)))).toBe(false);
    expect(recordOffsets(await readFile(await journalFile(collabDirectory, DOC_ID)))).toHaveLength(1);

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

    // What a process killed mid-append leaves: a record header that was never
    // finished. Recovery must drop exactly it, and nothing before it.
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
