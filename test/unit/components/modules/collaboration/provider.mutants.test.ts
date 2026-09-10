import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type * as LoggerModule from '../../../../../src/components/utils/logger';

vi.mock('../../../../../src/components/utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof LoggerModule>();

  return { ...actual, logLabeled: vi.fn() };
});

import { logLabeled } from '../../../../../src/components/utils/logger';
import { createCollabProvider } from '../../../../../src/components/modules/collaboration/provider';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type {
  CollabDocSeam,
  CollabOutbox,
  CollabOutboxRow,
  CollabProvider,
  CollabProviderOptions,
  CollabStatus,
  CollabStatusDetail,
  SyncWireDecodeResult,
  SyncWireFrame,
  WebSocketLike,
} from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import type { AwarenessChange } from '../../../../../src/components/modules/yjs/types';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

/**
 * Mutation-hardening companion to provider.test.ts.
 *
 * Every test here aims at something a mutant changes: an exact status, an exact
 * log line, an exact frame count, or the exact arguments a dependency was handed.
 * The provider's effects are mostly ASYNC and mostly INVISIBLE — a timer either
 * fires or it does not — so counts and reasons, never "something happened", are
 * the only assertions that can tell a mutant from the real thing.
 *
 * The one seam concession is `anyDocHook`: production binds the provider to the
 * store's FILTERED doc hook, so the provider's own echo guard can only be reached
 * by handing it every update — which is exactly what `onAnyDocUpdate`'s contract
 * asks a subscriber to guard against.
 */

const PROTOCOL = 'blok-sync.v1';
const PROTOCOL_V2 = 'blok-sync.v2';
const URL = 'wss://example.test/sync/doc-1';
const DOC_ID = 'doc-1';
const LINEAGE_A = '0123456789abcdef0123456789abcdef';
const LINEAGE_B = 'fedcba9876543210fedcba9876543210';
const OP_A = 'aaaaaaaa111122223333444455556666';
const OP_B = 'bbbbbbbb7777888899990000aaaabbbb';
/** Short, so the handshake-deadline test does not advance ten seconds a step. */
const HANDSHAKE_TIMEOUT_MS = 50;
/** Long, so no unrelated deadline fires while a test advances a backoff. */
const NO_DEADLINE_MS = 600_000;

interface StatusEntry {
  status: CollabStatus;
  detail?: CollabStatusDetail;
}

/** Mock transport: records what was written and lets the test drive the events. */
class MockSocket implements WebSocketLike {
  public binaryType = 'blob';

  public readyState = 0;

  public protocol = '';

  public onopen: ((event: unknown) => void) | null = null;

  public onmessage: ((event: { data: unknown }) => void) | null = null;

  public onclose: ((event: { code: number; reason: string }) => void) | null = null;

  public onerror: ((event: unknown) => void) | null = null;

  public readonly sent: Uint8Array[] = [];

  public closedWith: { code?: number; reason?: string } | null = null;

  public constructor(public readonly url: string, public readonly protocols: string[]) {}

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    this.sent.push(data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data as ArrayBufferLike));
  }

  public close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }

  /** Mirrors a browser: `.protocol` is settled before `onopen` fires. */
  public open(protocol = PROTOCOL): void {
    this.protocol = protocol;
    this.readyState = 1;
    this.onopen?.({});
  }

  /** Deliver one frame the way the server would. */
  public deliver(frame: SyncWireFrame): void {
    this.onmessage?.({ data: encode(frame) });
  }

  /** Deliver raw bytes, for frames the codec refuses or does not know. */
  public deliverRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  public serverClose(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  public get decoded(): SyncWireDecodeResult[] {
    return this.sent.map((bytes) => decode(bytes));
  }

  /** How many frames of `type` this socket was handed — the shape most tests need. */
  public count(type: SyncWireFrame['type']): number {
    return this.decoded.filter((frame) => frame.type === type).length;
  }
}

const controlFrame = (lineage = LINEAGE_A, format = 1): SyncWireFrame => ({
  type: 'control',
  tag: { format, epoch: 0, lineage },
});

/** In-memory outbox, with the levers the async paths need to be parked. */
class FakeOutbox implements CollabOutbox {
  /** Every quarantine, in order, with the snapshot it was handed. */
  public readonly quarantined: { lineage: string; reason: string; snapshot: Uint8Array }[] = [];

  /** Replaces `oldestPending`'s answer once, so a drain pass can be parked. */
  public gate: (() => Promise<CollabOutboxRow | null>) | null = null;

  public quarantineFails = false;

  public appendFails = false;

  public unhooks = 0;

  public rows: CollabOutboxRow[];

  public constructor(rows: CollabOutboxRow[] = []) {
    this.rows = rows;
  }

  public static pending(lineage = LINEAGE_A, operationId = OP_A): CollabOutboxRow {
    return { operationId, lineage, bytes: new Uint8Array([1, 2, 3]) };
  }

  public async appendLocal(update: Uint8Array): Promise<CollabOutboxRow> {
    if (this.appendFails) {
      throw new Error('append failed');
    }

    const row: CollabOutboxRow = { operationId: `${OP_A.slice(0, 31)}${this.rows.length}`, lineage: LINEAGE_A, bytes: update };

    this.rows.push(row);

    return row;
  }

  public async oldestPending(): Promise<CollabOutboxRow | null> {
    const gate = this.gate;

    if (gate !== null) {
      this.gate = null;

      return gate();
    }

    return this.rows[0] ?? null;
  }

  public async acknowledge(operationId: string): Promise<void> {
    this.rows = this.rows.filter((row) => row.operationId !== operationId);
  }

  public async quarantineLineage(lineage: string, reason: string, snapshot: Uint8Array): Promise<number> {
    if (this.quarantineFails) {
      throw new Error('quarantine failed');
    }

    this.quarantined.push({ lineage, reason, snapshot });

    const before = this.rows.length;

    this.rows = this.rows.filter((row) => row.lineage !== lineage);

    return before - this.rows.length;
  }

  public onCommitted(): () => void {
    return (): void => {
      this.unhooks += 1;
    };
  }
}

interface Recordings {
  resets: number;
  clearedRemote: number;
  docUnhooks: number;
  awarenessUnhooks: number;
  awarenessArgs: (number[] | undefined)[];
  docCallbacks: ((update: Uint8Array, origin: unknown) => void)[];
  awarenessCallbacks: ((changes: AwarenessChange, origin: unknown) => void)[];
}

const createRecorder = (): Recordings => ({
  resets: 0,
  clearedRemote: 0,
  docUnhooks: 0,
  awarenessUnhooks: 0,
  awarenessArgs: [],
  docCallbacks: [],
  awarenessCallbacks: [],
});

interface HarnessConfig {
  options?: Partial<CollabProviderOptions>;
  outbox?: FakeOutbox | null;
  /** Hand the provider EVERY doc update, remote ones included. See the file header. */
  anyDocHook?: boolean;
  /** Override the departure encoding, so the `null` branch is reachable. */
  departure?: Uint8Array | null;
  /** Force the peer map the handshake-time re-announce reads. */
  awarenessStates?: Map<number, Record<string, unknown>>;
  /** Make the doc seam throw on apply, with the given value. */
  applyThrows?: unknown;
}

interface Harness {
  provider: CollabProvider;
  store: DocumentStore;
  sockets: MockSocket[];
  statuses: StatusEntry[];
  rec: Recordings;
  outbox: FakeOutbox | null;
  socket: () => MockSocket;
}

const stores: DocumentStore[] = [];
const providers: CollabProvider[] = [];

const createHarness = (config: HarnessConfig = {}): Harness => {
  const sockets: MockSocket[] = [];
  const statuses: StatusEntry[] = [];
  const rec = createRecorder();
  const store = new DocumentStore(new YBlockSerializer());
  const outbox = config.outbox ?? null;

  stores.push(store);

  const seam: CollabDocSeam = {
    applyRemoteUpdate: (update, origin) => {
      if (config.applyThrows !== undefined) {
        throw config.applyThrows;
      }

      store.applyRemoteUpdate(update, origin);
    },
    onDocUpdate: (callback) => {
      rec.docCallbacks.push(callback);

      const off = config.anyDocHook === true ? store.onAnyUpdate(callback) : store.onUpdate(callback);

      return (): void => {
        rec.docUnhooks += 1;
        off();
      };
    },
    onAnyDocUpdate: (callback) => store.onAnyUpdate(callback),
    getStateVector: () => store.getStateVector(),
    encodeStateAsUpdate: (stateVector) => store.encodeStateAsUpdate(stateVector),
    enableAwareness: () => store.enableAwareness(),
    setAwarenessField: (field, value) => store.setAwarenessField(field, value),
    getAwarenessStates: () => config.awarenessStates ?? store.getAwarenessStates(),
    onAwarenessChange: (callback) => store.onAwarenessChange(callback),
    onAwarenessUpdate: (callback) => {
      rec.awarenessCallbacks.push(callback);

      const off = store.onAwarenessUpdate(callback);

      return (): void => {
        rec.awarenessUnhooks += 1;
        off();
      };
    },
    encodeAwarenessUpdate: (clients) => {
      rec.awarenessArgs.push(clients);

      return store.encodeAwarenessUpdate(clients);
    },
    encodeLocalAwarenessDeparture: () =>
      config.departure === undefined ? store.encodeLocalAwarenessDeparture() : config.departure,
    applyAwarenessUpdate: (update, origin) => store.applyAwarenessUpdate(update, origin),
    clearRemoteAwarenessStates: () => {
      rec.clearedRemote += 1;
      store.clearRemoteAwarenessStates();
    },
    resetForRelineage: () => {
      rec.resets += 1;
      store.resetForRelineage();
    },
  };

  const provider = createCollabProvider({
    url: URL,
    docId: DOC_ID,
    yjs: seam,
    handshakeTimeoutMs: NO_DEADLINE_MS,
    onStatus: (status, detail) => statuses.push({ status, detail }),
    // Deterministic jitter: the full backoff step, no randomness.
    random: () => 1,
    ...(outbox === null ? {} : { outbox }),
    ...config.options,
    socketFactory:
      config.options?.socketFactory ??
      ((url, protocols): WebSocketLike => {
        const socket = new MockSocket(url, protocols);

        sockets.push(socket);

        return socket;
      }),
  });

  providers.push(provider);

  return {
    provider,
    store,
    sockets,
    statuses,
    rec,
    outbox,
    socket: () => {
      const socket = sockets.at(-1);

      if (socket === undefined) {
        throw new Error('no socket was created');
      }

      return socket;
    },
  };
};

/** Connect, open, and validate a control frame. */
const ready = (harness: Harness, protocol = PROTOCOL): MockSocket => {
  harness.provider.connect();

  const socket = harness.socket();

  socket.open(protocol);
  socket.deliver(controlFrame());

  return socket;
};

/** The server's answer to our opening SyncStep1, on the v2 paths. */
const completeSync = (harness: Harness, socket: MockSocket): void => {
  socket.deliver({ type: 'syncStep2', update: harness.store.encodeStateAsUpdate() });
};

const advanceToReconnect = (harness: Harness): void => {
  const retryInMs = harness.statuses.at(-1)?.detail?.retryInMs;

  if (retryInMs === undefined) {
    throw new Error('no reconnect is pending');
  }

  vi.advanceTimersByTime(retryInMs);
};

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
};

/** A real, non-empty document update, produced the way a peer would. */
const peerUpdate = (): Uint8Array => {
  const peer = new Y.Doc();

  peer.getMap('probe').set('k', `v-${String(Math.random())}`);

  return Y.encodeStateAsUpdate(peer);
};

/** A state vector naming one peer's history, so a residual diff is not empty. */
const peerVectorWith = (): { vector: Uint8Array; update: Uint8Array } => {
  const peer = new Y.Doc();

  peer.getMap('probe').set('k', 'v');

  return { vector: Y.encodeStateVector(peer), update: Y.encodeStateAsUpdate(peer) };
};

const framedSizeOf = (update: Uint8Array): number => encode({ type: 'update', update }).byteLength;

const driveDocUpdate = (harness: Harness, update: Uint8Array, origin: unknown): void => {
  const callback = harness.rec.docCallbacks.at(-1);

  if (callback === undefined) {
    throw new Error('the seam is not hooked');
  }

  callback(update, origin);
};

const driveAwareness = (harness: Harness, changes: Partial<AwarenessChange>): void => {
  const callback = harness.rec.awarenessCallbacks.at(-1);

  if (callback === undefined) {
    throw new Error('the seam is not hooked');
  }

  callback({ added: [], updated: [], removed: [], ...changes }, {});
};

const logCalls = (): unknown[][] => vi.mocked(logLabeled).mock.calls;

const lastLog = (): { message: string; level: unknown } => {
  const call = logCalls().at(-1) ?? [];
  const message: unknown = call[0];

  return { message: typeof message === 'string' ? message : '', level: call[1] };
};

describe('createCollabProvider (mutation hardening)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (providers.length > 0) {
      providers.pop()?.destroy();
    }

    while (stores.length > 0) {
      stores.pop()?.destroy();
    }

    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('the surface before anything connects', () => {
    it('reports offline and v1 before a socket exists', () => {
      const harness = createHarness();

      expect(harness.provider.status).toBe('offline');
      expect(harness.provider.protocol).toBe('v1');
      expect(harness.provider.tag).toBeNull();
    });

    it('is not destroyed at creation: connect opens a transport', () => {
      const harness = createHarness();

      harness.provider.connect();

      expect(harness.sockets).toHaveLength(1);
    });

    it('offers only blok-sync.v1 when there is no outbox', () => {
      const harness = createHarness();

      harness.provider.connect();

      expect(harness.socket().protocols).toStrictEqual(['blok-sync.v1']);
    });

    it('offers blok-sync.v2 first when an outbox exists', () => {
      const harness = createHarness({ outbox: new FakeOutbox() });

      harness.provider.connect();

      expect(harness.socket().protocols).toStrictEqual(['blok-sync.v2', 'blok-sync.v1']);
    });

    it('offers the ticket after the version tokens', async () => {
      const ticketSource = vi.fn(() => Promise.resolve('tok-1'));
      const harness = createHarness({ options: { ticketSource } });

      harness.provider.connect();
      await flushMicrotasks();

      expect(harness.socket().protocols).toStrictEqual(['blok-sync.v1', 'tok-1']);
    });

    it('mints the first ticket without asking for a refresh', async () => {
      const ticketSource = vi.fn(() => Promise.resolve('tok-1'));
      const harness = createHarness({ options: { ticketSource } });

      harness.provider.connect();
      await flushMicrotasks();

      expect(ticketSource).toHaveBeenCalledWith(undefined);
    });

    it('opens the real WebSocket when no factory is injected', () => {
      const opened: { url: string; protocols: string[] }[] = [];

      class FakeWebSocket implements WebSocketLike {
        public binaryType = 'blob';

        public readyState = 0;

        public protocol = '';

        public onopen: ((event: unknown) => void) | null = null;

        public onmessage: ((event: { data: unknown }) => void) | null = null;

        public onclose: ((event: { code: number; reason: string }) => void) | null = null;

        public onerror: ((event: unknown) => void) | null = null;

        public constructor(url: string, protocols: string[] | string | undefined) {
          opened.push({ url, protocols: typeof protocols === 'string' ? [protocols] : (protocols ?? []) });
        }

        public send(): void {
          // The provider's opening frame; this test never delivers an answer.
        }

        public close(): void {
          // Nothing to close: the socket never opened.
        }
      }

      vi.stubGlobal('WebSocket', FakeWebSocket);

      const store = new DocumentStore(new YBlockSerializer());

      stores.push(store);

      const provider = createCollabProvider({
        url: URL,
        docId: DOC_ID,
        yjs: store as unknown as CollabDocSeam,
        handshakeTimeoutMs: NO_DEADLINE_MS,
      });

      providers.push(provider);

      provider.connect();

      expect(opened).toStrictEqual([{ url: URL, protocols: ['blok-sync.v1'] }]);
    });
  });

  describe('toBytes — what the transport may hand us', () => {
    it('reads a plain object with buffer fields as nothing, not as bytes', () => {
      const harness = createHarness();

      harness.provider.connect();

      const socket = harness.socket();

      socket.open();

      const bytes = encode(controlFrame());

      socket.deliverRaw({ buffer: bytes.buffer, byteOffset: 0, byteLength: bytes.byteLength });

      expect(harness.provider.tag).toBeNull();
    });

    it('normalizes a typed-array view into the bytes it covers', () => {
      const harness = createHarness();

      harness.provider.connect();

      const socket = harness.socket();

      socket.open();

      const bytes = encode(controlFrame());

      socket.deliverRaw(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));

      expect(harness.provider.tag).toStrictEqual({ format: 1, epoch: 0, lineage: LINEAGE_A });
    });

    it('normalizes an ArrayBuffer into its bytes', () => {
      const harness = createHarness();

      harness.provider.connect();

      const socket = harness.socket();

      socket.open();

      const bytes = encode(controlFrame());

      socket.deliverRaw(bytes.buffer.slice(0));

      expect(harness.provider.tag).toStrictEqual({ format: 1, epoch: 0, lineage: LINEAGE_A });
    });
  });

  describe('the presence window', () => {
    it('sends once per window: a flush leaves nothing queued behind it', () => {
      const harness = createHarness();
      const socket = ready(harness);

      vi.advanceTimersByTime(100);

      const baseline = socket.count('awareness');

      socket.deliver({ type: 'queryAwareness' });
      vi.advanceTimersByTime(100);

      expect(socket.count('awareness')).toBe(baseline + 1);
      expect(harness.rec.awarenessArgs.at(-1)).toBeUndefined();

      // Nothing new happened, so the next window must stay silent.
      driveAwareness(harness, {});
      vi.advanceTimersByTime(100);

      expect(socket.count('awareness')).toBe(baseline + 1);
    });

    it('does not let a second change push the pending window past the first', () => {
      const harness = createHarness();
      const socket = ready(harness);

      vi.advanceTimersByTime(100);

      const baseline = socket.count('awareness');

      driveAwareness(harness, { added: [7] });
      vi.advanceTimersByTime(50);
      driveAwareness(harness, { added: [8] });
      vi.advanceTimersByTime(50);

      expect(socket.count('awareness')).toBe(baseline + 1);

      // A change after the first flush arms a NEW window; the old timer must
      // not still be alive to fire inside it.
      driveAwareness(harness, { added: [9] });
      vi.advanceTimersByTime(60);

      expect(socket.count('awareness')).toBe(baseline + 1);

      vi.advanceTimersByTime(40);

      expect(socket.count('awareness')).toBe(baseline + 2);
    });

    it('sends the changed client ids, not every state, after a local change', () => {
      const harness = createHarness();
      const socket = ready(harness);

      vi.advanceTimersByTime(100);

      const baseline = socket.count('awareness');

      driveAwareness(harness, { added: [7] });
      vi.advanceTimersByTime(100);

      expect(harness.rec.awarenessArgs.at(-1)).toStrictEqual([7]);
      expect(socket.count('awareness')).toBe(baseline + 1);
    });

    it('does not replay the client ids a previous flush already sent', () => {
      const harness = createHarness({ awarenessStates: new Map() });
      const socket = ready(harness);

      driveAwareness(harness, { added: [5] });
      vi.advanceTimersByTime(100);

      expect(socket.count('awareness')).toBe(1);

      driveAwareness(harness, {});
      vi.advanceTimersByTime(100);

      expect(socket.count('awareness')).toBe(1);
    });

    it('starts with nothing pending: a local change sends only its own client', () => {
      const harness = createHarness({ awarenessStates: new Map() });
      const socket = ready(harness);

      driveAwareness(harness, { added: [7] });
      vi.advanceTimersByTime(100);

      expect(harness.rec.awarenessArgs.at(-1)).toStrictEqual([7]);
      expect(socket.count('awareness')).toBe(1);
    });

    it('coalesces a burst into one frame at the end of the FIRST window', () => {
      const harness = createHarness();
      const socket = ready(harness);

      vi.advanceTimersByTime(100);

      const baseline = socket.count('awareness');

      driveAwareness(harness, { added: [7] });
      vi.advanceTimersByTime(50);
      driveAwareness(harness, { added: [8] });
      vi.advanceTimersByTime(50);

      expect(socket.count('awareness')).toBe(baseline + 1);
    });

    it('drops the queued clients when the connection is torn down', () => {
      const harness = createHarness({ awarenessStates: new Map() });
      const socket = ready(harness);

      // No advance: the window must never open, so the teardown is what has to
      // drop the queued client.
      driveAwareness(harness, { added: [5] });

      socket.serverClose(1006);
      advanceToReconnect(harness);

      const next = harness.socket();

      next.open();
      next.deliver(controlFrame());

      // Nothing changed on this connection, so an empty window stays silent.
      driveAwareness(harness, {});
      vi.advanceTimersByTime(100);

      expect(next.count('awareness')).toBe(0);
      expect(harness.rec.awarenessArgs).toStrictEqual([]);

      // The window on the new connection carries only what changed on it.
      driveAwareness(harness, { added: [7] });
      vi.advanceTimersByTime(100);

      expect(harness.rec.awarenessArgs.at(-1)).toStrictEqual([7]);
    });

    it('does not withdraw presence the seam reports it cannot encode', () => {
      const harness = createHarness({ departure: null });
      const socket = ready(harness);

      const baseline = socket.count('awareness');

      harness.provider.announceDeparture();

      expect(socket.count('awareness')).toBe(baseline);
    });

    it('withdraws presence on the caller turn when the seam can encode it', () => {
      const harness = createHarness();
      const socket = ready(harness);

      vi.advanceTimersByTime(100);

      const baseline = socket.count('awareness');

      harness.provider.announceDeparture();

      expect(socket.count('awareness')).toBe(baseline + 1);
    });

    it('does not re-announce presence the seam says is empty', () => {
      const harness = createHarness({ awarenessStates: new Map() });

      ready(harness);
      vi.advanceTimersByTime(100);

      expect(harness.socket().count('awareness')).toBe(0);
    });

    it('re-announces presence the seam already holds', () => {
      const harness = createHarness({ awarenessStates: new Map([[7, { user: 'a' }]]) });

      ready(harness);
      vi.advanceTimersByTime(100);

      expect(harness.socket().count('awareness')).toBe(1);
    });

    it('uses the 100ms default window when none is configured', () => {
      const harness = createHarness({ options: { awarenessThrottleMs: undefined } });
      const socket = ready(harness);

      vi.advanceTimersByTime(100);

      const baseline = socket.count('awareness');

      driveAwareness(harness, { added: [7] });
      vi.advanceTimersByTime(99);

      expect(socket.count('awareness')).toBe(baseline);

      vi.advanceTimersByTime(1);

      expect(socket.count('awareness')).toBe(baseline + 1);
    });
  });

  describe('the activity budget', () => {
    it('sends on a first handshake that happens before any earlier send exists', () => {
      vi.setSystemTime(0);

      const harness = createHarness();
      const socket = ready(harness);

      expect(socket.count('activity')).toBe(1);
    });

    it('sends once per handshake, and skips one inside the minute', () => {
      const harness = createHarness();
      const socket = ready(harness);

      expect(socket.count('activity')).toBe(1);

      socket.serverClose(1006);
      advanceToReconnect(harness);

      const second = harness.socket();

      vi.advanceTimersByTime(57_000);
      second.open();
      second.deliver(controlFrame());

      expect(second.count('activity')).toBe(0);
    });

    it('sends again at exactly one minute, not a moment before', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(1006);
      advanceToReconnect(harness);

      const second = harness.socket();

      vi.advanceTimersByTime(57_000);
      second.open();
      second.deliver(controlFrame());

      expect(second.count('activity')).toBe(0);

      // 1000 + 57000 + the second backoff step (2000) lands on the minute exactly.
      second.serverClose(1006);
      advanceToReconnect(harness);

      const third = harness.socket();

      third.open();
      third.deliver(controlFrame());

      expect(third.count('activity')).toBe(1);
    });
  });

  describe('the doc seam', () => {
    it('does not echo an update that arrived from the server', () => {
      const harness = createHarness({ anyDocHook: true });
      const socket = ready(harness);

      socket.deliver({ type: 'update', update: peerUpdate() });

      expect(socket.count('update')).toBe(0);
    });

    it('sends a local update that carries another origin', () => {
      const harness = createHarness({ anyDocHook: true });
      const socket = ready(harness);

      harness.store.applyRemoteUpdate(peerUpdate(), { from: 'local-tab' });

      expect(socket.count('update')).toBe(1);
    });

    it('refuses a local update larger than the announced cap, and says why', () => {
      const harness = createHarness();
      const socket = ready(harness);
      const bytes = peerUpdate();
      const size = framedSizeOf(bytes);

      socket.deliver({ type: 'limits', maxMessageBytes: size });
      driveDocUpdate(harness, bytes, { from: 'local-tab' });

      expect(socket.count('update')).toBe(1);

      driveDocUpdate(harness, bytes, { from: 'local-tab-2' });

      expect(socket.count('update')).toBe(2);

      socket.deliver({ type: 'limits', maxMessageBytes: size - 1 });
      driveDocUpdate(harness, bytes, { from: 'local-tab-3' });

      expect(socket.count('update')).toBe(2);
      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'error',
        detail: {
          error: 'oversized-update',
          reason:
            `${DOC_ID} cannot be sent: a local update takes ${size} bytes, ` +
            `and the server takes at most ${size - 1} bytes per message`,
        },
      });
    });

    it('routes local updates through the outbox when the server selected v2', () => {
      const harness = createHarness({ outbox: new FakeOutbox() });
      const socket = ready(harness, PROTOCOL_V2);

      driveDocUpdate(harness, peerUpdate(), { from: 'local-tab' });

      expect(socket.count('update')).toBe(0);
    });
  });

  describe('the close-code policy', () => {
    it('ends the session on a terminal close code, naming it', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(4400, 'bad');

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'error',
        detail: { code: 4400, reason: 'bad', error: 'bad-request' },
      });
    });

    it('names forbidden separately from bad-request', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(4403, 'nope');

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'error',
        detail: { code: 4403, reason: 'nope', error: 'forbidden' },
      });
    });

    it('does not send a close of its own when the server closed first', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(1006);

      expect(socket.closedWith).toBeNull();
      expect(socket.onmessage).toBeNull();
    });

    it('does not end the session on an ordinary close between two 4401s', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(4401, 'ticket');
      advanceToReconnect(harness);

      const second = harness.socket();

      second.open();
      second.serverClose(1006);

      expect(harness.statuses.at(-1)?.status).toBe('offline');
      expect(harness.provider.status).toBe('offline');
    });

    it('does not count an ordinary close towards the 4401 budget', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(1006);
      advanceToReconnect(harness);

      const second = harness.socket();

      second.open();
      second.serverClose(4401, 'ticket');

      expect(harness.statuses.at(-1)?.status).toBe('offline');
      expect(harness.provider.status).toBe('offline');
    });

    it('ends the session on the second 4401 since the last sync', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(4401, 'ticket');
      advanceToReconnect(harness);

      const second = harness.socket();

      second.open();
      second.serverClose(4401, 'ticket');

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'error',
        detail: { code: 4401, reason: 'ticket', error: 'unauthorized' },
      });
    });

    it('ends the session on the second 1009 since the last sync', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(1009, 'too big');
      advanceToReconnect(harness);

      const second = harness.socket();

      second.open();
      second.serverClose(1009, 'too big');

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'error',
        detail: { code: 1009, reason: 'too big', error: 'oversized-update' },
      });
    });

    it('marks an ordinary close for no ticket refresh at all', async () => {
      const ticketSource = vi.fn(() => Promise.resolve('tok'));
      const harness = createHarness({ options: { ticketSource } });

      harness.provider.connect();
      await flushMicrotasks();

      const socket = harness.socket();

      socket.open();
      socket.serverClose(1006);
      advanceToReconnect(harness);
      await flushMicrotasks();

      expect(ticketSource).toHaveBeenCalledTimes(2);
      expect(ticketSource).toHaveBeenLastCalledWith(undefined);
    });

    it('asks for a forced ticket refresh after a 4401', async () => {
      const ticketSource = vi.fn(() => Promise.resolve('tok'));
      const harness = createHarness({ options: { ticketSource } });

      harness.provider.connect();
      await flushMicrotasks();

      const socket = harness.socket();

      socket.open();
      socket.serverClose(4401, 'stale');
      advanceToReconnect(harness);
      await flushMicrotasks();

      expect(ticketSource).toHaveBeenLastCalledWith({ forceRefresh: true });
    });
  });

  describe('the handshake deadline', () => {
    it('ends the session after three silent handshakes, naming the url', () => {
      const harness = createHarness({ options: { handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS } });

      harness.provider.connect();
      harness.socket();

      vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS);
      expect(harness.statuses.at(-1)?.status).toBe('offline');

      advanceToReconnect(harness);
      vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS);
      expect(harness.statuses.at(-1)?.status).toBe('offline');

      advanceToReconnect(harness);
      vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS);

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'error',
        detail: { error: 'handshake-timeout', reason: `${URL} sent no control frame` },
      });
    });

    it('drops an unsynced connection that validated but never synced', () => {
      const harness = createHarness({ options: { handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS } });
      const socket = ready(harness);

      vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS);

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'offline',
        detail: { code: undefined, reason: `${DOC_ID} validated the handshake but sent no first sync`, retryInMs: 1000 },
      });
      expect(socket.closedWith).toStrictEqual({ code: 1000, reason: undefined });
    });
  });

  describe('the control frame', () => {
    it('refuses a format this client cannot read, naming the format', () => {
      const harness = createHarness();

      harness.provider.connect();

      const socket = harness.socket();

      socket.open();
      socket.deliver(controlFrame(LINEAGE_A, 7));

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'error',
        detail: { error: 'unsupported-format', reason: `${DOC_ID} is stored in format 7` },
      });
    });

    it('adopts the lineage of the first control frame', () => {
      const harness = createHarness();
      const socket = ready(harness);

      expect(harness.provider.tag).toStrictEqual({ format: 1, epoch: 0, lineage: LINEAGE_A });
      expect(harness.provider.protocol).toBe('v1');
      expect(harness.provider.status).toBe('connecting');
      expect(socket.count('syncStep1')).toBe(1);
    });

    it('relineages when the room announces a lineage this document does not hold', () => {
      const harness = createHarness({ options: { initialLineage: LINEAGE_B } });

      harness.provider.connect();

      const socket = harness.socket();

      socket.open();
      socket.deliver(controlFrame());

      expect(harness.rec.resets).toBe(1);
      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'offline',
        detail: { code: undefined, reason: `${DOC_ID} was reset; its history is not ours`, retryInMs: 1000 },
      });
    });

    it('hooks the seam once, so a repeated control frame cannot double every write', () => {
      const harness = createHarness({ anyDocHook: true });
      const socket = ready(harness);

      harness.store.applyRemoteUpdate(peerUpdate(), { from: 'local' });

      expect(socket.count('update')).toBe(1);

      socket.deliver(controlFrame(LINEAGE_A, 1));
      harness.store.applyRemoteUpdate(peerUpdate(), { from: 'local-2' });

      expect(socket.count('update')).toBe(2);
      expect(harness.rec.awarenessCallbacks).toHaveLength(1);
    });

    it('applies a buffered update once the control frame validates', () => {
      const harness = createHarness({ anyDocHook: true });

      harness.provider.connect();

      const socket = harness.socket();

      socket.open();
      socket.deliver({ type: 'update', update: peerUpdate() });
      socket.deliver(controlFrame());
      harness.store.applyRemoteUpdate(peerUpdate(), { from: 'local' });

      expect(harness.provider.tag).toStrictEqual({ format: 1, epoch: 0, lineage: LINEAGE_A });
      expect(socket.count('update')).toBe(1);
    });

    it('holds exactly 64 frames and drops the connection on the 65th', () => {
      const harness = createHarness();

      harness.provider.connect();

      const socket = harness.socket();
      const before = harness.statuses.length;

      socket.open();

      for (let index = 0; index < 64; index += 1) {
        socket.deliver({ type: 'queryAwareness' });
      }

      expect(harness.statuses).toHaveLength(before);

      socket.deliver({ type: 'queryAwareness' });

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'offline',
        detail: {
          code: undefined,
          reason: `${DOC_ID} sent more than 64 frames before its control frame`,
          retryInMs: 1000,
        },
      });
    });

    it('reports a completed sync once, however many sync frames arrive', () => {
      const harness = createHarness();
      const socket = ready(harness);

      completeSync(harness, socket);
      completeSync(harness, socket);

      expect(harness.statuses.filter((entry) => entry.status === 'connected')).toHaveLength(1);
    });

    it('does not leave a live connection waiting for a first sync that already landed', () => {
      const harness = createHarness({ options: { handshakeTimeoutMs: HANDSHAKE_TIMEOUT_MS } });
      const socket = ready(harness);

      completeSync(harness, socket);
      const before = harness.statuses.length;

      vi.advanceTimersByTime(HANDSHAKE_TIMEOUT_MS);

      expect(harness.provider.status).toBe('connected');
      expect(harness.statuses).toHaveLength(before);
    });
  });

  describe('frames the connection must not act on', () => {
    it('ignores a payload the codec cannot read rather than ending the session', () => {
      const harness = createHarness();
      const socket = ready(harness);

      const before = harness.statuses.length;

      socket.deliverRaw('not bytes');
      socket.deliverRaw(null);

      expect(harness.statuses).toHaveLength(before);
      expect(harness.provider.tag).toStrictEqual({ format: 1, epoch: 0, lineage: LINEAGE_A });
    });

    it('does not let unknown or malformed frames fill the pre-control buffer', () => {
      const harness = createHarness();

      harness.provider.connect();

      const socket = harness.socket();

      socket.open();

      for (let index = 0; index < 70; index += 1) {
        socket.deliverRaw(new Uint8Array([5]));
        socket.deliverRaw(new Uint8Array(0));
      }

      socket.deliver(controlFrame());

      expect(harness.provider.tag).toStrictEqual({ format: 1, epoch: 0, lineage: LINEAGE_A });
      expect(harness.statuses).toHaveLength(1);
    });

    it('drops an acknowledgement that arrives before the control frame', () => {
      const onOperationAcknowledged = vi.fn();
      const harness = createHarness({ outbox: new FakeOutbox(), options: { onOperationAcknowledged } });

      harness.provider.connect();

      const socket = harness.socket();

      socket.open(PROTOCOL_V2);
      socket.deliver({ type: 'acknowledgement', lineage: LINEAGE_A, operationId: OP_A, serverSequence: '1' });

      expect(onOperationAcknowledged).not.toHaveBeenCalled();
      expect(harness.statuses.at(-1)?.status).toBe('connecting');
      expect(harness.provider.tag).toBeNull();
    });
  });

  describe('failures the seam raises', () => {
    it('ends the session and reports the seam message', () => {
      const harness = createHarness({ applyThrows: new Error('the update is not a document') });
      const socket = ready(harness);

      socket.deliver({ type: 'syncStep2', update: new Uint8Array([1]) });

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'error',
        detail: { error: 'apply-failed', reason: 'the update is not a document' },
      });
      expect(lastLog()).toStrictEqual({
        message: `collaboration could not apply a frame for ${DOC_ID}`,
        level: 'error',
      });
    });

    it('falls back to its own wording when the seam throws a non-Error', () => {
      const harness = createHarness({ applyThrows: 'a bare string' });
      const socket = ready(harness);

      socket.deliver({ type: 'syncStep2', update: new Uint8Array([1]) });

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'error',
        detail: { error: 'apply-failed', reason: `${DOC_ID} could not apply a frame` },
      });
    });

    it('drops a presence frame that throws instead of ending the session', () => {
      const onVerifiedIdentities = vi.fn(() => {
        throw new Error('host listener blew up');
      });
      const harness = createHarness({ options: { onVerifiedIdentities } });
      const socket = ready(harness);

      socket.deliver({ type: 'identities', identities: [{ clientId: 1, actorId: 'a' }] });

      expect(harness.provider.status).toBe('connecting');
      expect(harness.statuses).toHaveLength(1);
      expect(lastLog()).toStrictEqual({ message: `collaboration dropped a presence frame for ${DOC_ID}`, level: 'warn' });
    });

    it('does not require a host listener to deliver an identities frame', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.deliver({ type: 'identities', identities: [{ clientId: 1, actorId: 'a' }] });

      expect(logCalls()).toHaveLength(0);
      expect(harness.statuses).toHaveLength(1);
    });

    it('survives a status sink that was never provided', () => {
      const harness = createHarness({ options: { onStatus: undefined } });

      expect(() => harness.provider.connect()).not.toThrow();
      expect(harness.sockets).toHaveLength(1);
    });

    it('recovers from a socket factory that throws, naming the message', () => {
      const harness = createHarness({
        options: {
          socketFactory: () => {
            throw new Error('the CSP refused the connection');
          },
        },
      });

      harness.provider.connect();

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'offline',
        detail: { code: undefined, reason: 'the CSP refused the connection', retryInMs: 1000 },
      });
    });

    it('recovers from a socket factory that throws something that is not an Error', () => {
      const harness = createHarness({
        options: {
          socketFactory: () => {
            throw 'a bare string';
          },
        },
      });

      harness.provider.connect();

      expect(harness.statuses.at(-1)?.detail?.reason).toBe(`${URL} could not be opened`);
    });

    it('recovers from a ticket that could not be minted, naming the reason', async () => {
      const ticketSource = vi.fn(() => Promise.reject(new Error('the pass expired')));
      const harness = createHarness({ options: { ticketSource } });

      harness.provider.connect();
      await flushMicrotasks();

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'offline',
        detail: { code: undefined, reason: 'the pass expired', retryInMs: 1000 },
      });
    });

    it('says so in its own words when a ticket rejects with a non-Error', async () => {
      const ticketSource = vi.fn(() => Promise.reject('nope'));
      const harness = createHarness({ options: { ticketSource } });

      harness.provider.connect();
      await flushMicrotasks();

      expect(harness.statuses.at(-1)?.detail?.reason).toBe('the ticket could not be minted');
    });
  });

  describe('backoff', () => {
    it('answers a planned restart with a short delay, then a full step', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(1001, 'restart');

      expect(harness.statuses.at(-1)?.detail?.retryInMs).toBe(250);

      advanceToReconnect(harness);

      const second = harness.socket();

      second.open();
      second.serverClose(1001, 'restart');

      expect(harness.statuses.at(-1)?.detail?.retryInMs).toBe(2000);
    });

    it('applies the jitter factor to the ceiling, not the other way round', () => {
      const harness = createHarness({ options: { random: () => 0.5 } });
      const socket = ready(harness);

      socket.serverClose(1006);

      // Ceiling 1000, factor 0.5 + 0.5 * 0.5 = 0.75.
      expect(harness.statuses.at(-1)?.detail?.retryInMs).toBe(750);
    });

    it('draws jitter from Math.random when no source is injected', () => {
      const harness = createHarness({ options: { random: undefined } });
      const socket = ready(harness);

      socket.serverClose(1006);

      const retryInMs = harness.statuses.at(-1)?.detail?.retryInMs;

      expect(typeof retryInMs).toBe('number');
      expect(Number.isFinite(retryInMs)).toBe(true);
      expect(retryInMs).toBeGreaterThanOrEqual(500);
      expect(retryInMs).toBeLessThanOrEqual(1000);
    });

    it('costs a policy close two backoff steps', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(1008, 'too loud');

      expect(harness.statuses.at(-1)?.detail?.retryInMs).toBe(2000);
    });
  });

  describe('destroy', () => {
    it('is inert before anything connected', () => {
      const harness = createHarness();

      expect(() => harness.provider.destroy()).not.toThrow();

      expect(harness.provider.status).toBe('offline');
      expect(harness.sockets).toHaveLength(0);
    });

    it('is idempotent: a second destroy does not unhook anything twice', () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });

      ready(harness);
      harness.provider.destroy();
      harness.provider.destroy();

      expect(outbox.unhooks).toBe(1);
      expect(harness.rec.clearedRemote).toBe(1);
      expect(harness.statuses.at(-1)?.status).toBe('connecting');
    });

    it('refuses to reconnect after destroy', () => {
      const harness = createHarness();

      ready(harness);
      harness.provider.destroy();
      harness.provider.connect();

      expect(harness.sockets).toHaveLength(1);
    });

    it('leaves a pending reconnect alone: connect does not open a second generation', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(1006);

      const before = harness.sockets.length;

      harness.provider.connect();

      expect(harness.sockets).toHaveLength(before);
    });

    it('does not start a generation after a terminal close', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.serverClose(4400, 'bad');
      harness.provider.connect();

      expect(harness.sockets).toHaveLength(1);
      expect(harness.provider.status).toBe('error');
    });
  });

  describe('the v2 outbox drain', () => {
    it('sends the oldest pending row as an operation frame', async () => {
      const harness = createHarness({ outbox: new FakeOutbox([FakeOutbox.pending()]) });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      expect(socket.count('operation')).toBe(1);
      expect(socket.count('syncStep1')).toBe(1);
    });

    it('does nothing without an outbox even when the server selected v2', async () => {
      const harness = createHarness();
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      harness.provider.drain();
      await flushMicrotasks();

      expect(logCalls()).toHaveLength(0);
    });

    it('reports a drain pass the store could not answer, and keeps draining', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      outbox.oldestPending = () => Promise.reject(new Error('the store is gone'));

      harness.provider.drain();
      await flushMicrotasks();

      expect(lastLog()).toStrictEqual({
        message: `collaboration could not drain the outbox of ${DOC_ID}`,
        level: 'error',
      });

      // The failed pass must not wedge the next one.
      outbox.oldestPending = FakeOutbox.prototype.oldestPending.bind(outbox);
      outbox.rows.push(FakeOutbox.pending());

      harness.provider.drain();
      await flushMicrotasks();

      expect(socket.count('operation')).toBe(1);
    });

    it('sends nothing while an operation is still unanswered', async () => {
      const outbox = new FakeOutbox([FakeOutbox.pending()]);
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      outbox.rows.push(FakeOutbox.pending(LINEAGE_A, OP_B));

      harness.provider.drain();
      await flushMicrotasks();

      expect(socket.count('operation')).toBe(1);
    });

    it('tears down and redrives when an operation goes unanswered', async () => {
      const harness = createHarness({ outbox: new FakeOutbox([FakeOutbox.pending()]) });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();
      vi.advanceTimersByTime(15_000);

      expect(socket.closedWith).toStrictEqual({ code: 1000, reason: undefined });
      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'offline',
        detail: { code: undefined, reason: `${DOC_ID} did not acknowledge an operation`, retryInMs: 1000 },
      });
    });

    it('quarantines a row bigger than the announced cap instead of sending it', async () => {
      const outbox = new FakeOutbox([FakeOutbox.pending()]);
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      socket.deliver({ type: 'limits', maxMessageBytes: 4 });
      completeSync(harness, socket);
      await flushMicrotasks();

      expect(socket.count('operation')).toBe(0);
      expect(outbox.quarantined).toHaveLength(1);
      expect(outbox.quarantined[0].reason).toBe('oversized-update');
      expect(harness.provider.status).toBe('connected');
    });

    it('sends a row the announced cap has room for, at the exact boundary', async () => {
      const outbox = new FakeOutbox([FakeOutbox.pending()]);
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);
      const row = FakeOutbox.pending();
      const framed = encode({
        type: 'operation',
        lineage: row.lineage,
        operationId: row.operationId,
        update: row.bytes,
      }).byteLength;

      socket.deliver({ type: 'limits', maxMessageBytes: framed });
      completeSync(harness, socket);
      await flushMicrotasks();

      expect(socket.count('operation')).toBe(1);
      expect(outbox.quarantined).toHaveLength(0);
    });

    it('quarantines a row of a lineage this session no longer serves', async () => {
      const outbox = new FakeOutbox([FakeOutbox.pending(LINEAGE_B, OP_B)]);
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      expect(outbox.quarantined).toHaveLength(1);
      expect(outbox.quarantined[0].reason).toBe('stale-lineage');
      expect(socket.count('operation')).toBe(0);
      expect(harness.provider.status).toBe('connected');
    });

    it('re-wakes the drain once a stale row is quarantined away', async () => {
      const outbox = new FakeOutbox([FakeOutbox.pending(LINEAGE_B, OP_B), FakeOutbox.pending(LINEAGE_A, OP_A)]);
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      expect(outbox.quarantined.map((entry) => entry.reason)).toStrictEqual(['stale-lineage']);
      expect(socket.count('operation')).toBe(1);
    });

    it('hands the whole document to a quarantine when the session keeps a local copy', async () => {
      const outbox = new FakeOutbox([FakeOutbox.pending()]);
      const harness = createHarness({ outbox, options: { keepsLocalCopy: true } });
      const socket = ready(harness, PROTOCOL_V2);

      socket.deliver({ type: 'limits', maxMessageBytes: 4 });
      completeSync(harness, socket);
      await flushMicrotasks();

      expect(outbox.quarantined).toHaveLength(1);
      expect(outbox.quarantined[0].snapshot).toStrictEqual(harness.store.encodeStateAsUpdate());
    });

    it('reports a quarantine that could not commit to the host', async () => {
      const outbox = new FakeOutbox([FakeOutbox.pending()]);
      const onOutboxFailure = vi.fn();
      const harness = createHarness({ outbox, options: { keepsLocalCopy: true, onOutboxFailure } });
      const socket = ready(harness, PROTOCOL_V2);

      outbox.quarantineFails = true;
      socket.deliver({ type: 'limits', maxMessageBytes: 4 });
      completeSync(harness, socket);
      await flushMicrotasks();

      expect(onOutboxFailure).toHaveBeenCalledTimes(1);
      expect(onOutboxFailure.mock.calls[0][0]).toStrictEqual(new Error('quarantine failed'));
      expect(lastLog()).toStrictEqual({
        message: `collaboration could not quarantine the pending operations of ${DOC_ID}`,
        level: 'error',
      });
    });

    it('drains after an acknowledgement retires the row', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox, options: { onOperationAcknowledged: vi.fn() } });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      outbox.rows.push(FakeOutbox.pending());
      harness.provider.drain();
      await flushMicrotasks();

      expect(socket.count('operation')).toBe(1);

      socket.deliver({ type: 'acknowledgement', lineage: LINEAGE_A, operationId: OP_A, serverSequence: '4' });
      await flushMicrotasks();

      expect(outbox.rows).toHaveLength(0);
    });

    it('reports a failed acknowledgement deletion by its own log line', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      outbox.rows.push(FakeOutbox.pending());
      harness.provider.drain();
      await flushMicrotasks();

      outbox.acknowledge = () => Promise.reject(new Error('the store is gone'));

      socket.deliver({ type: 'acknowledgement', lineage: LINEAGE_A, operationId: OP_A, serverSequence: '4' });
      await flushMicrotasks();

      expect(lastLog()).toStrictEqual({
        message: `collaboration could not delete an acknowledged operation of ${DOC_ID}`,
        level: 'error',
      });
    });

    it('releases the in-flight slot only for the operation the server named', async () => {
      const harness = createHarness({ outbox: new FakeOutbox([FakeOutbox.pending()]) });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      socket.deliver({ type: 'acknowledgement', lineage: LINEAGE_A, operationId: OP_B, serverSequence: '1' });
      await flushMicrotasks();

      // The row is still ours to send, so releasing the slot would put it out twice.
      expect(socket.count('operation')).toBe(1);

      vi.advanceTimersByTime(15_000);

      expect(harness.statuses.at(-1)?.detail?.reason).toBe(`${DOC_ID} did not acknowledge an operation`);
    });

    it('tolerates an acknowledgement that names nothing in flight', async () => {
      const onOperationAcknowledged = vi.fn();
      const harness = createHarness({ outbox: new FakeOutbox(), options: { onOperationAcknowledged } });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      socket.deliver({ type: 'acknowledgement', lineage: LINEAGE_A, operationId: OP_A, serverSequence: '9' });

      expect(onOperationAcknowledged).toHaveBeenCalledWith('9');
      expect(harness.statuses.at(-1)?.status).toBe('connected');
    });

    it('ignores an acknowledgement that carries no outbox to delete from', async () => {
      const onOperationAcknowledged = vi.fn();
      const harness = createHarness({ options: { onOperationAcknowledged } });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      socket.deliver({ type: 'acknowledgement', lineage: LINEAGE_A, operationId: OP_A, serverSequence: '9' });

      expect(onOperationAcknowledged).not.toHaveBeenCalled();
      expect(harness.statuses.at(-1)?.status).toBe('connected');
    });

    it('treats not-synced as transient: reconnect, quarantine nothing', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      socket.deliver({ type: 'rejection', lineage: LINEAGE_A, operationId: OP_A, code: 'not-synced' });
      await flushMicrotasks();

      expect(outbox.quarantined).toHaveLength(0);
      expect(harness.statuses.at(-1)?.detail?.reason).toBe(`${DOC_ID} was not ready for an operation`);
      expect(socket.closedWith).toStrictEqual({ code: 1000, reason: undefined });
    });

    it('treats lineage-mismatch as a relineage, not a quarantine', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      socket.deliver({ type: 'rejection', lineage: LINEAGE_A, operationId: OP_A, code: 'lineage-mismatch' });
      await flushMicrotasks();

      expect(harness.rec.resets).toBe(1);
      expect(outbox.quarantined.map((entry) => entry.reason)).toStrictEqual(['lineage-reset']);
      expect(harness.statuses.at(-1)?.detail?.reason).toBe(`${DOC_ID} was reset; its history is not ours`);
      expect(socket.closedWith).toStrictEqual({ code: 1000, reason: undefined });
    });

    it('keeps its own operation in flight when a rejection names another one', async () => {
      const outbox = new FakeOutbox([FakeOutbox.pending()]);
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      expect(socket.count('operation')).toBe(1);

      socket.deliver({ type: 'rejection', lineage: LINEAGE_A, operationId: OP_B, code: 'read-only' });
      await flushMicrotasks();

      expect(outbox.quarantined.map((entry) => entry.reason)).toStrictEqual(['read-only']);

      // Our own operation is still unanswered, so its deadline must still run.
      vi.advanceTimersByTime(15_000);

      expect(harness.statuses.at(-1)?.detail?.reason).toBe(`${DOC_ID} did not acknowledge an operation`);
    });

    it('quarantines the tail under the code the server sent', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      socket.deliver({ type: 'rejection', lineage: LINEAGE_A, operationId: OP_A, code: 'read-only' });
      await flushMicrotasks();

      expect(outbox.quarantined).toHaveLength(1);
      expect(outbox.quarantined[0].reason).toBe('read-only');
      expect(harness.rec.resets).toBe(0);
    });

    it('ignores a rejection that names no outbox at all', async () => {
      const harness = createHarness();
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      socket.deliver({ type: 'rejection', lineage: LINEAGE_A, operationId: OP_A, code: 'lineage-mismatch' });
      await flushMicrotasks();

      expect(harness.rec.resets).toBe(0);
      expect(harness.statuses.at(-1)?.status).toBe('connected');
    });

    it('ignores a rejection of a lineage this connection is not serving', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      socket.deliver({ type: 'rejection', lineage: LINEAGE_B, operationId: OP_A, code: 'read-only' });
      await flushMicrotasks();

      expect(outbox.quarantined).toHaveLength(0);
    });

    it('asks once per connection for the residual round, then journals what it owes', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      harness.store.applyRemoteUpdate(peerUpdate(), { from: 'seed' });

      const { vector } = peerVectorWith();

      socket.deliver({ type: 'syncStep1', stateVector: vector });
      await flushMicrotasks();

      expect(socket.count('syncStep1')).toBe(2);

      socket.deliver({ type: 'syncStep1', stateVector: vector });
      await flushMicrotasks();

      expect(outbox.rows).toHaveLength(1);
      expect(socket.count('operation')).toBe(1);
    });

    it('does not journal a residual the server already has', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      socket.deliver({ type: 'syncStep1', stateVector: harness.store.getStateVector() });
      await flushMicrotasks();

      socket.deliver({ type: 'syncStep1', stateVector: harness.store.getStateVector() });
      await flushMicrotasks();

      expect(outbox.rows).toHaveLength(0);
    });

    it('says so when the residual state could not be journalled', async () => {
      const outbox = new FakeOutbox();
      const onOutboxFailure = vi.fn();
      const harness = createHarness({ outbox, options: { onOutboxFailure } });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      harness.store.applyRemoteUpdate(peerUpdate(), { from: 'seed' });

      const { vector } = peerVectorWith();

      socket.deliver({ type: 'syncStep1', stateVector: vector });
      await flushMicrotasks();

      outbox.appendFails = true;

      socket.deliver({ type: 'syncStep1', stateVector: vector });
      await flushMicrotasks();

      expect(onOutboxFailure).toHaveBeenCalledTimes(1);
      expect(lastLog()).toStrictEqual({
        message: `collaboration could not journal the residual state of ${DOC_ID}`,
        level: 'error',
      });
    });

    it('drains the outbox when the server asks for a resync', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      outbox.rows.push(FakeOutbox.pending());

      socket.deliver({ type: 'syncStep1', stateVector: harness.store.getStateVector() });
      await flushMicrotasks();

      expect(socket.count('operation')).toBe(1);
    });


    it('does not write on the new connection when a drain pass outlives the old one', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      let release: ((row: CollabOutboxRow | null) => void) | null = null;

      outbox.gate = () => new Promise<CollabOutboxRow | null>((resolve) => {
        release = resolve;
      });

      harness.provider.drain();
      await flushMicrotasks();

      socket.serverClose(1006);
      advanceToReconnect(harness);

      const next = harness.socket();

      next.open(PROTOCOL_V2);
      next.deliver(controlFrame());
      completeSync(harness, next);
      await flushMicrotasks();

      if (release !== null) {
        (release as (row: CollabOutboxRow | null) => void)(FakeOutbox.pending());
      }

      await flushMicrotasks();

      expect(next.count('operation')).toBe(0);
    });

    it('does not drain for a residual that was appended on the old connection', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();
      harness.store.applyRemoteUpdate(peerUpdate(), { from: 'seed' });

      const { vector } = peerVectorWith();

      socket.deliver({ type: 'syncStep1', stateVector: vector });
      await flushMicrotasks();

      let release: (() => void) | null = null;
      const parked = new Promise<void>((resolve) => {
        release = resolve;
      });
      const append = outbox.appendLocal.bind(outbox);

      outbox.appendLocal = async (update) => {
        await parked;

        return append(update);
      };

      socket.deliver({ type: 'syncStep1', stateVector: vector });
      await flushMicrotasks();

      socket.serverClose(1006);
      advanceToReconnect(harness);

      const next = harness.socket();

      next.open(PROTOCOL_V2);
      next.deliver(controlFrame());
      completeSync(harness, next);
      await flushMicrotasks();

      if (release !== null) {
        (release as () => void)();
      }

      await flushMicrotasks();

      expect(next.count('operation')).toBe(0);
    });

    it('does not drain for a row that appeared while an acknowledgement was committing', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      let release: (() => void) | null = null;
      const parked = new Promise<void>((resolve) => {
        release = resolve;
      });

      outbox.acknowledge = async () => {
        await parked;
        // Another tab wrote into the same store while this one was deleting.
        outbox.rows.push(FakeOutbox.pending(LINEAGE_A, OP_B));
      };

      socket.deliver({ type: 'acknowledgement', lineage: LINEAGE_A, operationId: OP_A, serverSequence: '2' });
      await flushMicrotasks();

      socket.serverClose(1006);
      advanceToReconnect(harness);

      const next = harness.socket();

      next.open(PROTOCOL_V2);
      next.deliver(controlFrame());
      completeSync(harness, next);
      await flushMicrotasks();

      if (release !== null) {
        (release as () => void)();
      }

      await flushMicrotasks();

      expect(next.count('operation')).toBe(0);
    });

    it('asks for the residual round again on a fresh connection', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      harness.store.applyRemoteUpdate(peerUpdate(), { from: 'seed' });

      const { vector } = peerVectorWith();

      socket.serverClose(1006);
      advanceToReconnect(harness);

      const next = harness.socket();

      next.open(PROTOCOL_V2);
      next.deliver(controlFrame());
      completeSync(harness, next);
      await flushMicrotasks();

      next.deliver({ type: 'syncStep1', stateVector: vector });
      await flushMicrotasks();

      expect(next.count('syncStep1')).toBe(2);
    });

    it('does not carry an owed resync from the connection that owed it', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      // Park a pass so the server's SyncStep1 sets the debt without the drain
      // that would have spent it.
      let release: ((row: CollabOutboxRow | null) => void) | null = null;

      outbox.gate = () => new Promise<CollabOutboxRow | null>((resolve) => {
        release = resolve;
      });

      harness.provider.drain();
      await flushMicrotasks();

      socket.deliver({ type: 'syncStep1', stateVector: harness.store.getStateVector() });
      await flushMicrotasks();

      if (release !== null) {
        (release as (row: CollabOutboxRow | null) => void)(FakeOutbox.pending(LINEAGE_A, OP_B));
      }

      await flushMicrotasks();

      // The row the parked pass sent is retired with the connection.
      outbox.rows = [];

      socket.serverClose(1006);
      advanceToReconnect(harness);

      const next = harness.socket();

      next.open(PROTOCOL_V2);
      next.deliver(controlFrame());
      completeSync(harness, next);
      await flushMicrotasks();

      expect(next.count('syncStep1')).toBe(1);
    });

    it('answers a v1 resync with syncStep2', () => {
      const harness = createHarness();
      const socket = ready(harness);

      socket.deliver({ type: 'syncStep1', stateVector: new Uint8Array([0]) });

      expect(socket.count('syncStep2')).toBe(1);
    });

    it('refuses a resync answer bigger than the announced cap, naming the numbers', () => {
      const harness = createHarness();
      const socket = ready(harness);
      const answer = encode({ type: 'syncStep2', update: harness.store.encodeStateAsUpdate(new Uint8Array([0])) })
        .byteLength;

      socket.deliver({ type: 'limits', maxMessageBytes: 4 });
      socket.deliver({ type: 'syncStep1', stateVector: new Uint8Array([0]) });

      expect(socket.count('syncStep2')).toBe(0);
      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'error',
        detail: {
          error: 'oversized-update',
          reason:
            `${DOC_ID} cannot be sent: answering the server's resync takes ${answer} bytes, ` +
            `and the server takes at most 4 bytes per message`,
        },
      });
    });

    it('refuses a resync answer at least as big as a frame already refused', () => {
      const harness = createHarness();
      const socket = ready(harness);
      // The only frame this connection writes is its opening state vector, which
      // is what a 1009 close leaves as the estimate of the server's cap.
      const refused = encode({ type: 'syncStep1', stateVector: harness.store.getStateVector() }).byteLength;
      const answer = encode({ type: 'syncStep2', update: harness.store.encodeStateAsUpdate(new Uint8Array([0])) })
        .byteLength;

      expect(answer).toBeGreaterThanOrEqual(refused);

      socket.serverClose(1009, 'too big');
      advanceToReconnect(harness);

      const second = harness.socket();

      second.open();
      second.deliver(controlFrame());
      second.deliver({ type: 'syncStep1', stateVector: new Uint8Array([0]) });

      expect(harness.statuses.at(-1)).toStrictEqual({
        status: 'error',
        detail: {
          error: 'oversized-update',
          reason:
            `${DOC_ID} cannot be sent: answering the server's resync takes ${answer} bytes, ` +
            `and it already refused a frame of ${refused} bytes as too big`,
        },
      });
    });
  });


  describe('relineage', () => {
    it('resets synchronously and journals nothing when there is no outbox', () => {
      const harness = createHarness({ options: { initialLineage: LINEAGE_B } });

      harness.provider.connect();

      const socket = harness.socket();

      socket.open();
      socket.serverClose(4409, 'reset');

      expect(harness.rec.resets).toBe(1);
    });

    it('resets synchronously when the session never learned a lineage', () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox });

      harness.provider.connect();

      const socket = harness.socket();

      socket.open(PROTOCOL_V2);
      socket.serverClose(4409, 'reset');

      expect(harness.rec.resets).toBe(1);
      expect(outbox.quarantined).toHaveLength(0);
    });

    it('waits for the quarantine before it resets the document', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox, options: { initialLineage: LINEAGE_A } });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      let release: (() => void) | null = null;
      const parked = new Promise<void>((resolve) => {
        release = resolve;
      });

      const quarantine = outbox.quarantineLineage.bind(outbox);

      outbox.quarantineLineage = async (lineage, reason, snapshot) => {
        await parked;

        return quarantine(lineage, reason, snapshot);
      };

      socket.serverClose(4409, 'reset');

      await flushMicrotasks();

      expect(harness.rec.resets).toBe(0);
      expect(harness.statuses.at(-1)?.status).toBe('connected');

      if (release !== null) {
        (release as () => void)();
      }

      await flushMicrotasks();

      expect(harness.rec.resets).toBe(1);
      expect(outbox.quarantined.map((entry) => entry.reason)).toStrictEqual(['lineage-reset']);
    });

    it('does not reset a document whose session was destroyed mid-quarantine', async () => {
      const outbox = new FakeOutbox();
      const harness = createHarness({ outbox, options: { initialLineage: LINEAGE_A } });
      const socket = ready(harness, PROTOCOL_V2);

      completeSync(harness, socket);
      await flushMicrotasks();

      let release: (() => void) | null = null;
      const parked = new Promise<void>((resolve) => {
        release = resolve;
      });

      const quarantine = outbox.quarantineLineage.bind(outbox);

      outbox.quarantineLineage = async (lineage, reason, snapshot) => {
        await parked;

        return quarantine(lineage, reason, snapshot);
      };

      socket.serverClose(4409, 'reset');
      harness.provider.destroy();

      if (release !== null) {
        (release as () => void)();
      }

      await flushMicrotasks();

      expect(harness.rec.resets).toBe(0);
    });
  });
});
