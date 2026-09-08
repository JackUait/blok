import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperationStore } from '../../../../../src/components/modules/collaboration/operation-store';
import { createCollabProvider } from '../../../../../src/components/modules/collaboration/provider';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type {
  CollabDocSeam,
  CollabOutbox,
  CollabProviderOptions,
  CollabStatus,
  CollabStatusDetail,
  SyncWireFrame,
  WebSocketLike,
} from '../../../../../src/components/modules/collaboration/types';
import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import type { AwarenessChange } from '../../../../../src/components/modules/yjs/types';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

const PROTOCOL = 'blok-sync.v1';

/** What a server that has a durable operation store selects. */
const PROTOCOL_V2 = 'blok-sync.v2';
const LINEAGE_A = '0123456789abcdef0123456789abcdef';
const LINEAGE_B = 'fedcba9876543210fedcba9876543210';

/** A control frame with the announceable defaults; override one field per test. */
const controlFrame = (over: Partial<{ format: number; epoch: number; lineage: string }> = {}): SyncWireFrame => ({
  type: 'control',
  tag: { format: 1, epoch: 0, lineage: LINEAGE_A, ...over },
});

/**
 * Mock transport. Records what the provider wrote, lets a test drive open /
 * message / close, and can be linked to a peer socket so two providers relay
 * through it (the two-provider convergence harness).
 */
class MockSocket {
  public binaryType = 'blob';

  public readyState = 0;

  public protocol = '';

  public onopen: ((event: unknown) => void) | null = null;

  public onmessage: ((event: { data: unknown }) => void) | null = null;

  public onclose: ((event: { code: number; reason: string }) => void) | null = null;

  public onerror: ((event: unknown) => void) | null = null;

  public readonly sent: Uint8Array[] = [];

  public closedWith: { code?: number; reason?: string } | null = null;

  /** When set, everything this socket sends is delivered to the peer. */
  public peer: MockSocket | null = null;

  public constructor(public readonly url: string, public readonly protocols: string[]) {}

  public send(data: ArrayBufferLike | ArrayBufferView): void {
    const bytes = data instanceof Uint8Array ? new Uint8Array(data) : new Uint8Array(data as ArrayBuffer);

    this.sent.push(bytes);
    this.peer?.receive(bytes);
  }

  public close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }

  // ---- test drivers ----

  /** Mirrors a real WebSocket: `.protocol` is set before `onopen` fires. */
  public open(protocol = PROTOCOL): void {
    this.protocol = protocol;
    this.readyState = 1;
    this.onopen?.({});
  }

  /** Deliver one frame; `asArrayBuffer` exercises the ArrayBuffer normalization. */
  public deliver(frame: SyncWireFrame, asArrayBuffer = false): void {
    const bytes = encode(frame);

    this.onmessage?.({ data: asArrayBuffer ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes });
  }

  public receive(bytes: Uint8Array): void {
    this.onmessage?.({ data: bytes });
  }

  public serverClose(code: number, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  public get frames(): SyncWireFrame[] {
    return this.sent.map((bytes) => decode(bytes) as SyncWireFrame);
  }

  public get frameTypes(): string[] {
    return this.frames.map((frame) => frame.type);
  }
}

/** Binds a real DocumentStore to the provider's structural seam. */
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
  encodeLocalAwarenessDeparture: () => store.encodeLocalAwarenessDeparture(),
  applyAwarenessUpdate: (update, origin) => store.applyAwarenessUpdate(update, origin),
  clearRemoteAwarenessStates: () => store.clearRemoteAwarenessStates(),
  resetForRelineage: () => store.resetForRelineage(),
});

interface StatusEntry {
  status: CollabStatus;
  detail?: CollabStatusDetail;
}

const stores: DocumentStore[] = [];
const providers: { destroy: () => void }[] = [];

interface Harness {
  provider: ReturnType<typeof createCollabProvider>;
  store: DocumentStore;
  sockets: MockSocket[];
  statuses: StatusEntry[];
  socket: () => MockSocket;
}

const createHarness = (
  overrides: Partial<CollabProviderOptions> = {},
  wrapSeam?: (seam: CollabDocSeam) => CollabDocSeam
): Harness => {
  const sockets: MockSocket[] = [];
  const statuses: StatusEntry[] = [];
  const store = new DocumentStore(new YBlockSerializer());

  stores.push(store);

  const seam = seamFor(store);
  const provider = createCollabProvider({
    url: 'wss://example.test/sync/doc-1',
    docId: 'doc-1',
    yjs: wrapSeam === undefined ? seam : wrapSeam(seam),
    socketFactory: (url, protocols): WebSocketLike => {
      const socket = new MockSocket(url, protocols);

      sockets.push(socket);

      return socket;
    },
    onStatus: (status, detail) => statuses.push({ status, detail }),
    // Deterministic jitter: the full backoff step, no randomness.
    random: () => 1,
    ...overrides,
  });

  providers.push(provider);

  return {
    provider,
    store,
    sockets,
    statuses,
    socket: () => {
      const socket = sockets.at(-1);

      if (socket === undefined) {
        throw new Error('no socket was created');
      }

      return socket;
    },
  };
};

/**
 * Connect, open, and validate the control frame — the "ready" starting point.
 * @param harness - the provider under test
 * @param protocol - the subprotocol the server selects
 */
const connectAndHandshake = (harness: Harness, protocol = PROTOCOL): MockSocket => {
  harness.provider.connect();

  const socket = harness.socket();

  socket.open(protocol);
  socket.deliver(controlFrame());

  return socket;
};

/** Server side of a first sync: answer our SyncStep1 with SyncStep2 + SyncStep1. */
const completeFirstSync = (harness: Harness, socket: MockSocket, peer: DocumentStore): void => {
  socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate(harness.store.getStateVector()) });
  socket.deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });
};

/**
 * Advances exactly to the reconnect the last `offline` status announced. The
 * handshake deadline is armed when a socket is CREATED, so jumping far past the
 * reconnect would let the new, still-unopened socket time out first.
 * @param harness - the provider under test
 */
const advanceToReconnect = (harness: Harness): void => {
  const retryInMs = harness.statuses.at(-1)?.detail?.retryInMs;

  if (retryInMs === undefined) {
    throw new Error('no reconnect is pending');
  }

  vi.advanceTimersByTime(retryInMs);
};

/** A harness whose seam records every lineage reset the provider asks for. */
const createResetHarness = (
  overrides: Partial<CollabProviderOptions> = {}
): { harness: Harness; resets: number[] } => {
  const resets: number[] = [];
  const harness = createHarness(overrides, (seam) => ({
    ...seam,
    resetForRelineage: () => {
      resets.push(resets.length + 1);
      seam.resetForRelineage();
    },
  }));

  return { harness, resets };
};

/** Client ids a state vector accounts for — empty means "a document with no history". */
const clientsIn = (stateVector: Uint8Array): number[] =>
  Array.from(Y.decodeStateVector(stateVector).keys());

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('createCollabProvider', () => {
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

  describe('connection', () => {
    it('offers the blok-sync.v1 subprotocol alone when there is no ticket source', () => {
      const harness = createHarness();

      harness.provider.connect();

      expect(harness.socket().url).toBe('wss://example.test/sync/doc-1');
      expect(harness.socket().protocols).toEqual([PROTOCOL]);
    });

    it('offers the ticket as the second subprotocol when a ticket source exists', async () => {
      const ticketSource = vi.fn(() => Promise.resolve('tok-1'));
      const harness = createHarness({ ticketSource });

      harness.provider.connect();
      await flushMicrotasks();

      expect(harness.socket().protocols).toEqual([PROTOCOL, 'tok-1']);
    });

    /**
     * A provider with NO outbox cannot honour v2, so it must never be selected
     * into it: under v2 the seam drops every local edit and the drain that
     * replaces them returns at once, which leaves the client unable to send
     * anything after its opening SyncStep1. Offers stay [v1] / [v1, ticket] and
     * the write path stays exactly what it was.
     */
    it('stock provider behavior is unchanged', async () => {
      const ticketSource = vi.fn(() => Promise.resolve('tok-1'));
      const noTicket = createHarness();
      const withTicket = createHarness({ ticketSource });

      noTicket.provider.connect();
      withTicket.provider.connect();
      await flushMicrotasks();

      expect(
        noTicket.socket().protocols,
        'a provider with no outbox offered v2, a protocol it cannot send a single local edit under'
      ).toEqual([PROTOCOL]);
      expect(withTicket.socket().protocols).toEqual([PROTOCOL, 'tok-1']);

      const socket = noTicket.socket();

      socket.open(PROTOCOL);
      socket.deliver(controlFrame());
      noTicket.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'hi' } });

      expect(socket.frameTypes, 'a stock session stopped broadcasting its local writes')
        .toEqual(['syncStep1', 'activity', 'update']);
    });

    it('exposes the server-selected subprotocol once the socket opens', () => {
      const harness = createHarness();

      harness.provider.connect();
      harness.socket().open();

      expect(harness.socket().protocol).toBe(PROTOCOL);
    });

    it('reports connecting and asks for binary frames', () => {
      const harness = createHarness();

      harness.provider.connect();

      expect(harness.statuses[0]?.status).toBe('connecting');
      expect(harness.socket().binaryType).toBe('arraybuffer');
    });

    it('goes offline and backs off when the ticket mint fails', async () => {
      const ticketSource = vi.fn(() => Promise.reject(new Error('no pass')));
      const harness = createHarness({ ticketSource });

      harness.provider.connect();
      await flushMicrotasks();

      expect(harness.sockets).toHaveLength(0);
      expect(harness.statuses.at(-1)?.status).toBe('offline');

      vi.advanceTimersByTime(1000);
      await flushMicrotasks();

      expect(ticketSource).toHaveBeenCalledTimes(2);
    });

    // A factory throw is a failed connection (CSP, a bad URL, an exhausted
    // transport), not a dead provider — the same recovery as a failed mint.
    it('goes offline instead of throwing out of connect when the socket factory throws', () => {
      const harness = createHarness({
        socketFactory: () => {
          throw new Error('blocked by CSP');
        },
      });

      expect(() => harness.provider.connect()).not.toThrow();

      expect(harness.statuses.at(-1)).toEqual({
        status: 'offline',
        detail: expect.objectContaining({ reason: 'blocked by CSP', retryInMs: 1000 }),
      });
    });

    it('keeps retrying after the socket factory throws on a reconnect', () => {
      const sockets: MockSocket[] = [];
      const statuses: StatusEntry[] = [];
      const store = new DocumentStore(new YBlockSerializer());
      const broken = { now: false };

      stores.push(store);

      const provider = createCollabProvider({
        url: 'wss://example.test/sync/doc-1',
        docId: 'doc-1',
        yjs: seamFor(store),
        socketFactory: (url, protocols): WebSocketLike => {
          if (broken.now) {
            throw new Error('blocked');
          }

          const socket = new MockSocket(url, protocols);

          sockets.push(socket);

          return socket;
        },
        onStatus: (status, detail) => statuses.push({ status, detail }),
        random: () => 1,
      });

      providers.push(provider);
      provider.connect();
      sockets[0].open();
      sockets[0].deliver(controlFrame());

      broken.now = true;
      sockets[0].serverClose(4503, 'unavailable');
      vi.advanceTimersByTime(1000);

      expect(sockets).toHaveLength(1);
      expect(statuses.at(-1)).toEqual({
        status: 'offline',
        detail: expect.objectContaining({ reason: 'blocked' }),
      });

      // The transport recovers and the provider is still trying.
      broken.now = false;
      vi.advanceTimersByTime(statuses.at(-1)?.detail?.retryInMs ?? 0);

      expect(sockets).toHaveLength(2);
    });

    it('goes offline rather than leaking a rejection when the factory throws behind a ticket', async () => {
      const harness = createHarness({
        ticketSource: () => Promise.resolve('tok'),
        socketFactory: () => {
          throw new Error('blocked');
        },
      });

      harness.provider.connect();
      await flushMicrotasks();

      expect(harness.statuses.at(-1)).toEqual({
        status: 'offline',
        detail: expect.objectContaining({ reason: 'blocked' }),
      });
    });
  });

  describe('handshake order', () => {
    it('sends ONLY SyncStep1 when the socket opens', () => {
      const harness = createHarness();

      harness.provider.connect();
      harness.socket().open();

      expect(harness.socket().frameTypes).toEqual(['syncStep1']);
    });

    it('never sends an Update before the control frame is validated', () => {
      const harness = createHarness();

      harness.provider.connect();
      harness.socket().open();
      harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'secret history' } });

      expect(harness.socket().frameTypes).toEqual(['syncStep1']);

      harness.socket().deliver(controlFrame());

      expect(harness.socket().frameTypes).toEqual(['syncStep1', 'activity']);
    });

    it('never answers a peer SyncStep1 with SyncStep2 before the control frame', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      harness.provider.connect();
      harness.socket().open();
      harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'history' } });
      harness.socket().deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });

      expect(harness.socket().frameTypes).toEqual(['syncStep1']);
    });

    it('drains the frames buffered before the control frame once it validates', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      peer.addBlock({ id: 'p1', type: 'paragraph', data: { text: 'from peer' } });

      harness.provider.connect();
      harness.socket().open();
      harness.socket().deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      harness.socket().deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });

      expect(harness.store.toJSON()).toHaveLength(0);

      harness.socket().deliver(controlFrame());

      expect(harness.store.toJSON().map((block) => block.id)).toEqual(['p1']);
      expect(harness.socket().frameTypes).toEqual(['syncStep1', 'activity', 'syncStep2']);
    });

    // Dropping a frame is worse than dropping the connection: Yjs parks every
    // later update on the missing one, so the document stalls with no sign of
    // it. Closing makes the next handshake re-sync from a state vector.
    it('closes the connection instead of dropping frames past the buffer cap, and heals on the reconnect', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());
      const updates: Uint8Array[] = [];

      stores.push(peer);

      const unhook = peer.onUpdate((update) => updates.push(update));

      for (const index of Array.from({ length: 70 }, (_, position) => position)) {
        peer.addBlock({ id: `b${index}`, type: 'paragraph', data: { text: `line ${index}` } });
      }
      unhook();

      harness.provider.connect();

      const first = harness.socket();

      first.open();

      for (const update of updates) {
        first.deliver({ type: 'update', update });
      }

      expect(first.closedWith).toEqual({ code: 1000, reason: undefined });
      expect(harness.statuses.at(-1)).toEqual({
        status: 'offline',
        detail: expect.objectContaining({ reason: expect.stringContaining('before its control frame') }),
      });

      advanceToReconnect(harness);

      const second = harness.socket();

      expect(second).not.toBe(first);
      second.open();
      second.deliver(controlFrame());
      second.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate(harness.store.getStateVector()) });

      expect(harness.store.toJSON()).toHaveLength(70);
      expect(harness.statuses.at(-1)?.status).toBe('connected');
    });

    // The onmessage guard (provider.ts) must treat these exactly like
    // `unknown`: the codec (task 1.2) decodes them, but nothing wires them
    // into the provider yet (task 4.4). Without the guard, an operation/
    // acknowledgement/rejection frame arriving in `awaiting-control` would
    // reach `bufferInbound` and count toward MAX_BUFFERED_INBOUND — so a peer
    // sending 64+ of them would force the same teardown+reconnect the cap
    // test above exists for, over frames this provider does nothing with.
    it('drops v2 operation/acknowledgement/rejection frames before the control frame instead of buffering them', () => {
      const harness = createHarness();
      const operationId = LINEAGE_B;
      const v2Frames: SyncWireFrame[] = [
        { type: 'operation', lineage: LINEAGE_A, operationId, update: new Uint8Array([1]) },
        { type: 'acknowledgement', lineage: LINEAGE_A, operationId, serverSequence: '1' },
        { type: 'rejection', lineage: LINEAGE_A, operationId, code: 'not-synced' },
      ];

      harness.provider.connect();
      harness.socket().open();

      // 70 of EACH type, against a MAX_BUFFERED_INBOUND of 64: buffering any
      // ONE of the three would trip the cap and close the socket, exactly like
      // the test above. Cycling 70 frames in TOTAL would not — 23 of each is
      // under the cap, and the test would stop discriminating.
      for (let index = 0; index < 70 * v2Frames.length; index += 1) {
        harness.socket().deliver(v2Frames[index % v2Frames.length]);
      }

      expect(harness.socket().closedWith).toBeNull();
      expect(harness.statuses.some((entry) => entry.status === 'offline')).toBe(false);

      harness.socket().deliver(controlFrame());

      expect(harness.provider.tag).toEqual({ format: 1, epoch: 0, lineage: LINEAGE_A });
    });

    // Same guard, same reason: before task 1 the codec decoded 106/107 as
    // `unknown` (already dropped at the same site), so this was inert. Now
    // that the codec recognises them, they must be dropped explicitly or a
    // peer sending 64+ before the control frame trips MAX_BUFFERED_INBOUND
    // and tears the connection down over frames nothing here acts on yet.
    it('drops activity and identities frames before the control frame instead of buffering them', () => {
      const harness = createHarness();
      const frames: SyncWireFrame[] = [
        { type: 'activity' },
        { type: 'identities', identities: [{ clientId: 1, actorId: 'u_1' }] },
      ];

      harness.provider.connect();
      harness.socket().open();

      for (let index = 0; index < 70 * frames.length; index += 1) {
        harness.socket().deliver(frames[index % frames.length]);
      }

      expect(harness.socket().closedWith).toBeNull();
      expect(harness.statuses.some((entry) => entry.status === 'offline')).toBe(false);

      harness.socket().deliver(controlFrame());

      expect(harness.provider.tag).toEqual({ format: 1, epoch: 0, lineage: LINEAGE_A });
    });

    it('reads frames delivered as an ArrayBuffer', () => {
      const harness = createHarness();

      harness.provider.connect();
      harness.socket().open();
      harness.socket().deliver(controlFrame(), true);

      expect(harness.provider.tag).toEqual({ format: 1, epoch: 0, lineage: LINEAGE_A });
    });
  });

  describe('control frame validation', () => {
    it('captures the tag from a valid control frame', () => {
      const harness = createHarness();

      connectAndHandshake(harness);

      expect(harness.provider.tag).toEqual({ format: 1, epoch: 0, lineage: LINEAGE_A });
    });

    it('is terminal on an unknown format and does not reconnect', () => {
      const harness = createHarness();

      harness.provider.connect();
      harness.socket().open();
      harness.socket().deliver(controlFrame({ format: 2 }));

      expect(harness.statuses.at(-1)).toEqual({
        status: 'error',
        detail: expect.objectContaining({ error: 'unsupported-format' }),
      });
      expect(harness.socket().closedWith).not.toBeNull();

      vi.advanceTimersByTime(120_000);

      expect(harness.sockets).toHaveLength(1);
    });

    // A silent socket is an INFERENCE, not a verdict: a cold-starting server and
    // a buffering proxy look exactly like an endpoint that does not speak the
    // protocol. A dead server retries forever, so a slow one must not fare worse.
    it('retries with backoff when the control frame never arrives', () => {
      const harness = createHarness({ handshakeTimeoutMs: 5000 });

      harness.provider.connect();
      harness.socket().open();

      vi.advanceTimersByTime(5000);

      expect(harness.statuses.at(-1)).toEqual({
        status: 'offline',
        detail: expect.objectContaining({ reason: expect.stringContaining('no control frame'), retryInMs: 1000 }),
      });
      expect(harness.socket().closedWith).not.toBeNull();

      vi.advanceTimersByTime(1000);

      expect(harness.sockets).toHaveLength(2);
    });

    // Browsers put no deadline on the opening handshake: a server that accepts
    // the TCP connection and never completes the upgrade would park the client
    // in `connecting` forever — no reconnect, no degrade view.
    it('retries with backoff when the socket never opens', () => {
      const harness = createHarness({ handshakeTimeoutMs: 5000 });

      harness.provider.connect();
      vi.advanceTimersByTime(5000);

      expect(harness.statuses.at(-1)).toEqual({
        status: 'offline',
        detail: expect.objectContaining({ retryInMs: 1000 }),
      });
      expect(harness.socket().closedWith).not.toBeNull();

      vi.advanceTimersByTime(1000);

      expect(harness.sockets).toHaveLength(2);
    });

    it('recovers when the server answers the retried handshake', () => {
      const harness = createHarness({ handshakeTimeoutMs: 5000 });
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      harness.provider.connect();
      harness.socket().open();
      vi.advanceTimersByTime(5000);
      vi.advanceTimersByTime(1000);

      const second = harness.socket();

      second.open();
      second.deliver(controlFrame());
      completeFirstSync(harness, second, peer);

      expect(harness.statuses.at(-1)?.status).toBe('connected');
      expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
    });

    it('is terminal on the third handshake timeout since the last sync', () => {
      const harness = createHarness({ handshakeTimeoutMs: 5000 });

      harness.provider.connect();

      for (const _attempt of [0, 1]) {
        harness.socket().open();
        vi.advanceTimersByTime(5000);

        expect(harness.statuses.at(-1)?.status).toBe('offline');

        advanceToReconnect(harness);
      }

      harness.socket().open();
      vi.advanceTimersByTime(5000);

      expect(harness.statuses.at(-1)).toEqual({
        status: 'error',
        detail: expect.objectContaining({ error: 'handshake-timeout' }),
      });

      vi.advanceTimersByTime(300_000);

      expect(harness.sockets).toHaveLength(3);
    });

    it('lets a completed sync clear the handshake-timeout count', () => {
      const harness = createHarness({ handshakeTimeoutMs: 5000 });
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      harness.provider.connect();

      for (const _attempt of [0, 1]) {
        harness.socket().open();
        vi.advanceTimersByTime(5000);
        advanceToReconnect(harness);
      }

      harness.socket().open();
      harness.socket().deliver(controlFrame());
      completeFirstSync(harness, harness.socket(), peer);
      harness.socket().serverClose(4503, '');
      advanceToReconnect(harness);

      harness.socket().open();
      vi.advanceTimersByTime(5000);

      expect(harness.statuses.at(-1)?.status).toBe('offline');
    });

    it('resets the document and reconnects when a later control frame changes lineage', () => {
      const { harness, resets } = createResetHarness();
      const first = connectAndHandshake(harness);

      harness.store.addBlock({ id: 'stale', type: 'paragraph', data: { text: 'old history' } });

      first.serverClose(1001, 'restart');
      vi.advanceTimersByTime(1000);

      const second = harness.socket();

      second.open();
      second.deliver(controlFrame({ lineage: LINEAGE_B, epoch: 1 }));

      expect(resets).toHaveLength(1);
      expect(harness.store.toJSON()).toEqual([]);
      expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
      expect(second.closedWith).not.toBeNull();

      advanceToReconnect(harness);

      expect(harness.sockets).toHaveLength(3);
    });

    it('accepts the new lineage after a reset instead of resetting again', () => {
      const { harness, resets } = createResetHarness();
      const first = connectAndHandshake(harness);

      first.serverClose(1001, 'restart');
      vi.advanceTimersByTime(1000);
      harness.socket().open();
      harness.socket().deliver(controlFrame({ lineage: LINEAGE_B, epoch: 1 }));

      advanceToReconnect(harness);

      const third = harness.socket();

      third.open();
      third.deliver(controlFrame({ lineage: LINEAGE_B, epoch: 1 }));

      expect(resets).toHaveLength(1);
      expect(harness.provider.tag).toEqual({ format: 1, epoch: 1, lineage: LINEAGE_B });
      expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
    });

    it('does not re-hook the seam when a second control frame repeats on one connection', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness);

      socket.deliver(controlFrame({ epoch: 1 }));
      harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'once' } });

      expect(socket.frameTypes.filter((type) => type === 'update')).toHaveLength(1);
      expect(harness.provider.tag).toEqual({ format: 1, epoch: 1, lineage: LINEAGE_A });
    });

    it('accepts a later control frame that repeats the same lineage', () => {
      const harness = createHarness();
      const first = connectAndHandshake(harness);

      first.serverClose(1001, 'restart');
      vi.advanceTimersByTime(1000);

      const second = harness.socket();

      second.open();
      second.deliver(controlFrame({ epoch: 0 }));

      expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
    });
  });

  // Validating the control frame is not a sync. Nothing else re-arms a deadline
  // after it, so without this the client sits in `connecting` forever — read-only,
  // empty, no reconnect, and no degrade view (that only runs on offline/error).
  describe('first-sync deadline', () => {
    it('goes offline and retries when the first sync never arrives', () => {
      const harness = createHarness({ handshakeTimeoutMs: 5000 });

      connectAndHandshake(harness);

      expect(harness.statuses.at(-1)?.status).toBe('connecting');

      vi.advanceTimersByTime(5000);

      expect(harness.statuses.at(-1)).toEqual({
        status: 'offline',
        detail: expect.objectContaining({ reason: expect.stringContaining('no first sync'), retryInMs: 1000 }),
      });
      expect(harness.socket().closedWith).not.toBeNull();

      vi.advanceTimersByTime(1000);

      expect(harness.sockets).toHaveLength(2);
    });

    it('does not fire once the first sync lands', () => {
      const harness = createHarness({ handshakeTimeoutMs: 5000 });
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);

      const socket = connectAndHandshake(harness);

      completeFirstSync(harness, socket, peer);
      vi.advanceTimersByTime(60_000);

      expect(harness.statuses.at(-1)?.status).toBe('connected');
      expect(harness.sockets).toHaveLength(1);
    });

    // The drain completes the sync inside `handleControl` itself, so a deadline
    // armed after it would fire on a connection that is already live.
    it('is not armed when the sync arrived before the control frame', () => {
      const harness = createHarness({ handshakeTimeoutMs: 5000 });
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      peer.addBlock({ id: 'p1', type: 'paragraph', data: { text: 'from peer' } });

      harness.provider.connect();
      harness.socket().open();
      harness.socket().deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      harness.socket().deliver(controlFrame());
      vi.advanceTimersByTime(60_000);

      expect(harness.statuses.at(-1)?.status).toBe('connected');
      expect(harness.sockets).toHaveLength(1);
    });

    it('is not re-armed by a control frame repeated on a synced connection', () => {
      const harness = createHarness({ handshakeTimeoutMs: 5000 });
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);

      const socket = connectAndHandshake(harness);

      completeFirstSync(harness, socket, peer);
      socket.deliver(controlFrame({ epoch: 1 }));
      vi.advanceTimersByTime(60_000);

      expect(harness.statuses.at(-1)?.status).toBe('connected');
      expect(harness.sockets).toHaveLength(1);
    });
  });

  describe('doc traffic through the seam', () => {
    it('applies syncStep2 and update frames and reports connected on the first sync', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      peer.addBlock({ id: 'p1', type: 'paragraph', data: { text: 'one' } });

      const socket = connectAndHandshake(harness);

      completeFirstSync(harness, socket, peer);

      expect(harness.store.toJSON().map((block) => block.id)).toEqual(['p1']);
      expect(harness.statuses.at(-1)?.status).toBe('connected');

      peer.addBlock({ id: 'p2', type: 'paragraph', data: { text: 'two' } });
      socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate(harness.store.getStateVector()) });

      expect(harness.store.toJSON().map((block) => block.id)).toEqual(['p1', 'p2']);
    });

    it('answers an incoming SyncStep1 with a diff against the peer state vector', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);

      const socket = connectAndHandshake(harness);

      harness.store.addBlock({ id: 'local', type: 'paragraph', data: { text: 'mine' } });
      socket.deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });

      const answer = socket.frames.at(-1);

      expect(answer?.type).toBe('syncStep2');

      if (answer?.type === 'syncStep2') {
        peer.applyRemoteUpdate(answer.update, { source: 'test-peer' });
      }

      expect(peer.toJSON().map((block) => block.id)).toEqual(['local']);
    });

    it('broadcasts a local write as an update frame', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness);

      harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'hi' } });

      expect(socket.frameTypes).toEqual(['syncStep1', 'activity', 'update']);
    });

    /**
     * The v2 send path is the outbox drain (Task 4.4): an operation leaves only
     * once the store has committed it. A raw type-0 written straight out of the
     * seam would put the edit on the wire BEFORE `appendLocal` resolved, which
     * is the send the design's local-durability boundary forbids.
     */
    it('sends nothing before appendLocal resolves: a v2 session writes no raw update frame', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness, PROTOCOL_V2);

      harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'hi' } });

      expect(socket.frameTypes, 'a v2 local edit went on the wire before the store committed it')
        .toEqual(['syncStep1', 'activity']);
    });

    /** The other half of the same switch: v1 has no outbox, so v1 still sends. */
    it('still broadcasts a local write when the server selected v1', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness, PROTOCOL);

      harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'hi' } });

      expect(socket.frameTypes).toEqual(['syncStep1', 'activity', 'update']);
    });

    it('reports the protocol the server selected', () => {
      const harness = createHarness();

      connectAndHandshake(harness, PROTOCOL_V2);

      expect(harness.provider.protocol).toBe('v2');
    });

    it('reports v1 when the server selected no subprotocol at all', () => {
      const harness = createHarness();

      connectAndHandshake(harness, '');

      expect(harness.provider.protocol).toBe('v1');
    });

    it('uses ONE provider origin for the whole generation (never one per message)', () => {
      const origins: unknown[] = [];
      const harness = createHarness({}, (seam) => ({
        ...seam,
        applyRemoteUpdate: (update, origin) => {
          origins.push(origin);
          seam.applyRemoteUpdate(update, origin);
        },
      }));
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);

      const socket = connectAndHandshake(harness);

      peer.addBlock({ id: 'p1', type: 'paragraph', data: { text: 'one' } });
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      peer.addBlock({ id: 'p2', type: 'paragraph', data: { text: 'two' } });
      socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate(harness.store.getStateVector()) });

      expect(origins).toHaveLength(2);
      expect(new Set(origins).size).toBe(1);
    });
  });

  describe('two-provider relay', () => {
    /**
     * Two providers over a linked pair of mock sockets. The relay plays the one
     * role a peer cannot: it hands each side the SAME control frame first.
     */
    const createRelay = (): { a: Harness; b: Harness; socketA: MockSocket; socketB: MockSocket } => {
      const a = createHarness();
      const b = createHarness();

      a.provider.connect();
      b.provider.connect();

      const socketA = a.socket();
      const socketB = b.socket();

      socketA.peer = socketB;
      socketB.peer = socketA;

      socketA.open();
      socketB.open();
      socketA.deliver(controlFrame());
      socketB.deliver(controlFrame());

      return { a, b, socketA, socketB };
    };

    it('converges two real DocumentStores', () => {
      const { a, b } = createRelay();

      a.store.addBlock({ id: 'from-a', type: 'paragraph', data: { text: 'A' } });
      b.store.addBlock({ id: 'from-b', type: 'paragraph', data: { text: 'B' } });

      expect(a.store.toJSON().map((block) => block.id).sort()).toEqual(['from-a', 'from-b']);
      expect(b.store.toJSON().map((block) => block.id).sort()).toEqual(['from-a', 'from-b']);
    });

    it('does not re-broadcast a remote update (echo suppression)', () => {
      const { a, b, socketB } = createRelay();
      const before = socketB.sent.length;

      a.store.addBlock({ id: 'from-a', type: 'paragraph', data: { text: 'A' } });

      expect(b.store.toJSON().map((block) => block.id)).toEqual(['from-a']);
      expect(socketB.sent.length).toBe(before);
    });
  });

  describe('awareness', () => {
    it('forwards a local awareness change out, throttled', () => {
      const harness = createHarness({ awarenessThrottleMs: 100 });
      const socket = connectAndHandshake(harness);

      harness.store.setAwarenessField('user', { name: 'Ada' });
      harness.store.setAwarenessField('user', { name: 'Ada v2' });

      expect(socket.frameTypes).toEqual(['syncStep1', 'activity']);

      vi.advanceTimersByTime(100);

      expect(socket.frameTypes).toEqual(['syncStep1', 'activity', 'awareness']);
    });

    it('broadcasts from the update channel, so keepalive renewals reach peers', () => {
      const emitters: ((changes: AwarenessChange, origin: unknown) => void)[] = [];
      const harness = createHarness({ awarenessThrottleMs: 100 }, (seam) => ({
        ...seam,
        onAwarenessUpdate: (callback) => {
          emitters.push(callback);

          return seam.onAwarenessUpdate(callback);
        },
      }));
      const socket = connectAndHandshake(harness);

      harness.store.setAwarenessField('user', { name: 'Ada' });
      vi.advanceTimersByTime(100);

      const before = socket.frameTypes.length;
      const [clientId] = Array.from(harness.store.getAwarenessStates().keys());

      // A keepalive renewal reaches 'update' only: y-protocols filters equal
      // content out of the 'change' delta, so a provider hooked to 'change'
      // would never rebroadcast and peers would prune us after 30s idle.
      // The real renewal cannot be driven here — lib0 captures Date.now at
      // import, so fake timers never move its clock.
      expect(emitters).toHaveLength(1);

      for (const emit of emitters) {
        emit({ added: [], updated: [clientId], removed: [] }, 'local');
      }

      vi.advanceTimersByTime(100);

      expect(socket.frameTypes.slice(before)).toEqual(['awareness']);
    });

    it('applies an incoming awareness frame into the seam', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      peer.enableAwareness();
      peer.setAwarenessField('user', { name: 'Bob' });

      const socket = connectAndHandshake(harness);
      const peerClientId = Array.from(peer.getAwarenessStates().keys())[0];

      socket.deliver({ type: 'awareness', update: peer.encodeAwarenessUpdate() });

      expect(harness.store.getAwarenessStates().get(peerClientId)).toEqual({ user: { name: 'Bob' } });
    });

    it('enables awareness at connect, so presence set before the handshake survives', () => {
      const harness = createHarness({ awarenessThrottleMs: 100 });

      harness.provider.connect();
      // The seam silently drops this while awareness is off.
      harness.store.setAwarenessField('user', { name: 'Ada' });

      const socket = harness.socket();

      socket.open();
      socket.deliver(controlFrame());
      vi.advanceTimersByTime(100);

      const announced = socket.frames.at(-1);
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      peer.enableAwareness();

      expect(announced?.type).toBe('awareness');

      if (announced?.type === 'awareness') {
        peer.applyAwarenessUpdate(announced.update, 'remote');
      }

      expect(Array.from(peer.getAwarenessStates().values())).toContainEqual({ user: { name: 'Ada' } });
    });

    it('announces our own presence once the connection is negotiated', () => {
      const harness = createHarness({ awarenessThrottleMs: 100 });
      const socket = connectAndHandshake(harness);

      vi.advanceTimersByTime(100);

      expect(socket.frameTypes).toEqual(['syncStep1', 'activity', 'awareness']);
    });

    it('does not echo an applied remote awareness update back out', () => {
      const harness = createHarness({ awarenessThrottleMs: 100 });
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      peer.enableAwareness();
      peer.setAwarenessField('user', { name: 'Bob' });

      const socket = connectAndHandshake(harness);

      // Let the connect-time self-announce go out first.
      vi.advanceTimersByTime(100);

      const before = socket.frameTypes.length;

      socket.deliver({ type: 'awareness', update: peer.encodeAwarenessUpdate() });
      vi.advanceTimersByTime(500);

      expect(socket.frameTypes).toHaveLength(before);
    });

    it('answers a queryAwareness burst with ONE throttled awareness frame', () => {
      const harness = createHarness({ awarenessThrottleMs: 100 });
      const socket = connectAndHandshake(harness);

      harness.store.setAwarenessField('user', { name: 'Ada' });
      vi.advanceTimersByTime(100);

      const before = socket.frameTypes.length;

      for (const _index of [0, 1, 2, 3, 4, 5, 6, 7]) {
        socket.deliver({ type: 'queryAwareness' });
      }

      vi.advanceTimersByTime(100);

      expect(socket.frameTypes.slice(before)).toEqual(['awareness']);
    });

    it('drops remote presence when the connection closes', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      peer.enableAwareness();
      peer.setAwarenessField('user', { name: 'Bob' });

      const socket = connectAndHandshake(harness);
      const peerClientId = Array.from(peer.getAwarenessStates().keys())[0];

      socket.deliver({ type: 'awareness', update: peer.encodeAwarenessUpdate() });

      expect(harness.store.getAwarenessStates().has(peerClientId)).toBe(true);

      socket.serverClose(4503, 'unavailable');

      expect(harness.store.getAwarenessStates().has(peerClientId)).toBe(false);
    });

    /**
     * A tab that reloads takes a NEW client id with it, so a peer that was
     * never told the old one left draws the same person twice until its own
     * 30s sweep expires the corpse. y-protocols asks a departing client to
     * publish a null state; nothing did.
     */
    describe('departure', () => {
      it('writes the departure straight to the socket, without waiting for the presence window', () => {
        const harness = createHarness({ awarenessThrottleMs: 100 });
        const peer = new DocumentStore(new YBlockSerializer());

        stores.push(peer);
        peer.enableAwareness();

        const socket = connectAndHandshake(harness);

        harness.store.setAwarenessField('user', { name: 'Alice' });
        vi.advanceTimersByTime(100);

        const localClientId = Array.from(harness.store.getAwarenessStates().keys())[0];

        peer.applyAwarenessUpdate(harness.store.encodeAwarenessUpdate(), { source: 'peer' });
        expect(peer.getAwarenessStates().has(localClientId)).toBe(true);

        const before = socket.frames.length;

        harness.provider.announceDeparture();

        const written = socket.frames.slice(before);

        expect(written.map((frame) => frame.type)).toEqual(['awareness']);

        const departure = written[0];

        if (departure.type !== 'awareness') {
          throw new Error('expected an awareness frame');
        }

        peer.applyAwarenessUpdate(departure.update, { source: 'peer' });

        expect(peer.getAwarenessStates().has(localClientId)).toBe(false);
      });

      it('announces the departure before closing the socket on destroy', () => {
        const harness = createHarness();
        const socket = connectAndHandshake(harness);

        harness.store.setAwarenessField('user', { name: 'Alice' });
        vi.advanceTimersByTime(100);

        const before = socket.frames.length;

        harness.provider.destroy();

        expect(socket.frames.slice(before).map((frame) => frame.type)).toEqual(['awareness']);
        expect(socket.closedWith?.code).toBe(1000);
      });

      it('says nothing when it never reached a server', () => {
        const harness = createHarness();

        harness.provider.connect();
        harness.provider.announceDeparture();

        expect(harness.socket().frames).toEqual([]);
      });
    });
  });

  describe('activity', () => {
    it('sends one activity frame right after the handshake completes', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness);

      expect(socket.frameTypes).toEqual(['syncStep1', 'activity']);
    });

    it('puts one activity frame on the socket when asked, once the session is ready', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness);

      const before = socket.frames.length;

      harness.provider.sendActivity();

      const written = socket.frames.slice(before);

      expect(written.map((frame) => frame.type)).toEqual(['activity']);
    });

    it('sends nothing before the control frame validates', () => {
      const harness = createHarness();

      harness.provider.connect();
      harness.socket().open();
      harness.provider.sendActivity();

      expect(harness.socket().frameTypes).toEqual(['syncStep1']);
    });

    it('says nothing when it never reached a server', () => {
      const harness = createHarness();

      harness.provider.connect();
      harness.provider.sendActivity();

      expect(harness.socket().frames).toEqual([]);
    });

    it('sends nothing once the connection is torn down', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness);

      harness.provider.destroy();

      const before = socket.sent.length;

      harness.provider.sendActivity();

      expect(socket.sent.length).toBe(before);
    });

    it('sends exactly one activity frame even if the control frame repeats', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness);

      socket.deliver(controlFrame());

      expect(socket.frameTypes.filter((type) => type === 'activity')).toHaveLength(1);
    });

    // markSynced resets `attempt` to 0 on every completed sync, and a 1001
    // close at attempt 1 gets the flat SHORT_RECONNECT_MS — so a server that
    // closes with 1001 right after every sync reconnects every ~250ms. Without
    // a budget that survives the generation, each of those reconnects would
    // put a fresh activity frame on the wire.
    it('does not resend activity on a fast reconnect inside the 60-second budget', () => {
      const harness = createHarness();
      const first = connectAndHandshake(harness);

      first.serverClose(1001, 'going away');
      advanceToReconnect(harness);

      const second = harness.socket();

      second.open();
      second.deliver(controlFrame());

      const activityFrames = [...first.frameTypes, ...second.frameTypes]
        .filter((type) => type === 'activity');

      expect(activityFrames).toHaveLength(1);
    });

    it('resends activity on a reconnect once the 60-second budget has passed', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);

      const first = connectAndHandshake(harness);

      // Complete the first sync so nothing else is armed to fire during the
      // idle advance below.
      completeFirstSync(harness, first, peer);
      vi.advanceTimersByTime(60_000);

      first.serverClose(1001, 'going away');
      advanceToReconnect(harness);

      const second = harness.socket();

      second.open();
      second.deliver(controlFrame());

      const activityFrames = [...first.frameTypes, ...second.frameTypes]
        .filter((type) => type === 'activity');

      expect(activityFrames).toHaveLength(2);
    });
  });

  // A seam that throws has failed to materialise the document. Retrying the same
  // frame throws again, and skipping it stalls every later update on the missing
  // one — so the session ends and the host is told, rather than presenting an
  // editor over a document that never loaded.
  describe('a frame the seam cannot apply', () => {
    /** A seam whose applyRemoteUpdate throws the first `failures` times. */
    const throwingSeam = (failures: number): { harness: Harness; applied: number[] } => {
      const applied: number[] = [];
      const attempts = { count: 0 };
      const harness = createHarness({}, (seam) => ({
        ...seam,
        applyRemoteUpdate: (update, origin) => {
          attempts.count += 1;

          if (attempts.count <= failures) {
            throw new Error('BlockYjsSync blew up materialising the first sync');
          }

          applied.push(update.length);
          seam.applyRemoteUpdate(update, origin);
        },
      }));

      return { harness, applied };
    };

    it('ends the session when the buffered drain throws', () => {
      const { harness, applied } = throwingSeam(1);
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      peer.addBlock({ id: 'a', type: 'paragraph', data: { text: 'one' } });

      harness.provider.connect();
      harness.socket().open();
      harness.socket().deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });
      peer.addBlock({ id: 'b', type: 'paragraph', data: { text: 'two' } });
      harness.socket().deliver({ type: 'update', update: peer.encodeStateAsUpdate() });

      expect(() => harness.socket().deliver(controlFrame())).not.toThrow();

      expect(harness.statuses.at(-1)).toEqual({
        status: 'error',
        detail: expect.objectContaining({ error: 'apply-failed', reason: expect.stringContaining('blew up') }),
      });
      expect(harness.provider.status).toBe('error');

      // The socket is closed and detached, so the connection cannot go on
      // looking live over a document that never materialised.
      expect(harness.socket().closedWith?.code).toBe(1000);
      harness.socket().deliver({ type: 'update', update: peer.encodeStateAsUpdate() });
      expect(applied).toHaveLength(0);
    });

    it('never reports connected when the first sync could not be applied', () => {
      const { harness } = throwingSeam(1);
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      peer.addBlock({ id: 'a', type: 'paragraph', data: { text: 'one' } });

      const socket = connectAndHandshake(harness);

      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });

      expect(harness.statuses.map((entry) => entry.status)).not.toContain('connected');
      expect(harness.statuses.at(-1)?.detail?.error).toBe('apply-failed');
    });

    it('does not reconnect after an apply failure', () => {
      const { harness } = throwingSeam(1);
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      peer.addBlock({ id: 'a', type: 'paragraph', data: { text: 'one' } });
      connectAndHandshake(harness).deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate() });

      vi.advanceTimersByTime(300_000);

      expect(harness.sockets).toHaveLength(1);
    });
  });

  // One peer's malformed presence must not end everybody else's session: the
  // server relays awareness after reading only the client count, so any
  // pass-holder can put bytes y-protocols cannot decode on every other member's
  // wire. Doc frames stay terminal (the three tests above); presence is dropped.
  describe('a presence frame the seam cannot apply', () => {
    const hostilePayloads: { name: string; bytes: number[] }[] = [
      { name: 'truncated after the client count', bytes: [1, 0xff] },
      { name: 'carrying a state that is not JSON', bytes: [1, 5, 0, 3, 97, 98, 99] },
    ];

    for (const { name, bytes } of hostilePayloads) {
      it(`drops an awareness frame ${name} and stays connected`, () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const harness = createHarness();
        const peer = new DocumentStore(new YBlockSerializer());

        stores.push(peer);
        peer.addBlock({ id: 'p1', type: 'paragraph', data: { text: 'one' } });

        const socket = connectAndHandshake(harness);

        completeFirstSync(harness, socket, peer);
        socket.deliver({ type: 'awareness', update: new Uint8Array(bytes) });

        expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
        expect(harness.provider.status).toBe('connected');
        expect(socket.closedWith).toBeNull();
        expect(warn).toHaveBeenCalled();

        // Positive proof the connection is still live: a later doc frame applies.
        peer.addBlock({ id: 'p2', type: 'paragraph', data: { text: 'two' } });
        socket.deliver({ type: 'update', update: peer.encodeStateAsUpdate(harness.store.getStateVector()) });

        expect(harness.store.toJSON().map((block) => block.id)).toEqual(['p1', 'p2']);
      });
    }
  });

  describe('close-code policy', () => {
    const terminalCases: { code: number; error: string }[] = [
      { code: 4400, error: 'bad-request' },
      { code: 4403, error: 'forbidden' },
    ];

    for (const { code, error } of terminalCases) {
      it(`is terminal on ${code} (${error}) and never reconnects`, () => {
        const harness = createHarness();
        const socket = connectAndHandshake(harness);

        socket.serverClose(code, 'nope');

        expect(harness.statuses.at(-1)).toEqual({
          status: 'error',
          detail: expect.objectContaining({ error, code }),
        });

        vi.advanceTimersByTime(300_000);

        expect(harness.sockets).toHaveLength(1);
      });
    }

    it('resets the document and reconnects on 4409 instead of going terminal', () => {
      const { harness, resets } = createResetHarness();
      const socket = connectAndHandshake(harness);

      harness.store.addBlock({ id: 'stale', type: 'paragraph', data: { text: 'old history' } });
      socket.serverClose(4409, 'the room was reset');

      expect(resets).toHaveLength(1);
      expect(harness.store.toJSON()).toEqual([]);
      expect(harness.statuses.at(-1)?.status).toBe('offline');

      advanceToReconnect(harness);

      expect(harness.sockets).toHaveLength(2);
      expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
    });

    it('sends no pre-reset history on the connection that follows a 4409', () => {
      const { harness } = createResetHarness();
      const socket = connectAndHandshake(harness);

      harness.store.addBlock({ id: 'stale', type: 'paragraph', data: { text: 'must never be resent' } });
      socket.serverClose(4409, 'the room was reset');
      advanceToReconnect(harness);

      const second = harness.socket();

      second.open();

      // Control-frame-first still holds, and the ONE frame allowed before it
      // now describes a document with no history at all.
      expect(second.frameTypes).toEqual(['syncStep1']);

      const opening = second.frames[0];

      expect(opening.type === 'syncStep1' && clientsIn(opening.stateVector)).toEqual([]);

      second.deliver(controlFrame({ lineage: LINEAGE_B, epoch: 1 }));

      // The room asks what we have; the answer must carry none of the old room.
      const room = new DocumentStore(new YBlockSerializer());

      stores.push(room);
      second.deliver({ type: 'syncStep1', stateVector: room.getStateVector() });

      const answer = second.frames.at(-1);

      expect(answer?.type).toBe('syncStep2');

      if (answer?.type === 'syncStep2') {
        room.applyRemoteUpdate(answer.update, { source: 'room' });
      }

      expect(room.toJSON()).toEqual([]);
      expect(second.frameTypes.filter((type) => type === 'update')).toHaveLength(0);
    });

    /**
     * A cache-adopted boot carries history the provider did not watch arrive.
     * Without the cached lineage, the FIRST control frame is adopted rather
     * than compared — so a room reset while this tab was away announces a new
     * lineage, the client keeps its stale history, and the resync answer ships
     * a dead room's blocks into the live one.
     */
    it('relineages when the cached lineage does not match the first control frame', () => {
      const { harness, resets } = createResetHarness({ initialLineage: LINEAGE_A });

      harness.provider.connect();

      const socket = harness.socket();

      harness.store.addBlock({ id: 'cached', type: 'paragraph', data: { text: 'from the cache' } });

      socket.open();
      socket.deliver(controlFrame({ lineage: LINEAGE_B, epoch: 4 }));

      expect(resets).toHaveLength(1);
      expect(harness.store.toJSON()).toEqual([]);
      expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
    });

    it('keeps a cache-adopted document when the first control frame agrees', () => {
      const { harness, resets } = createResetHarness({ initialLineage: LINEAGE_A });

      harness.provider.connect();

      const socket = harness.socket();

      harness.store.addBlock({ id: 'cached', type: 'paragraph', data: { text: 'from the cache' } });

      socket.open();
      socket.deliver(controlFrame({ lineage: LINEAGE_A }));

      expect(resets).toHaveLength(0);
      expect(harness.store.toJSON().map((block) => block.id)).toEqual(['cached']);
    });

    it('refreshes the ticket and retries ONCE on 4401, then goes terminal', async () => {
      // A source that honours the flag, so the assertion below is about the
      // ticket that reached the wire — an arity-0 source (the bug) re-offers the
      // rejected one and fails here.
      const ticketSource = vi.fn((request?: { forceRefresh?: boolean }) =>
        Promise.resolve(request?.forceRefresh === true ? 'tok-fresh' : 'tok')
      );
      const harness = createHarness({ ticketSource });

      harness.provider.connect();
      await flushMicrotasks();
      expect(harness.socket().protocols).toEqual([PROTOCOL, 'tok']);
      harness.socket().open();
      harness.socket().deliver(controlFrame());
      harness.socket().serverClose(4401, 'invalid pass');

      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();

      expect(harness.sockets).toHaveLength(2);
      expect(ticketSource).toHaveBeenLastCalledWith({ forceRefresh: true });
      expect(harness.socket().protocols).toEqual([PROTOCOL, 'tok-fresh']);

      harness.socket().open();
      harness.socket().serverClose(4401, 'invalid pass');

      expect(harness.statuses.at(-1)).toEqual({
        status: 'error',
        detail: expect.objectContaining({ error: 'unauthorized', code: 4401 }),
      });

      vi.advanceTimersByTime(300_000);
      await flushMicrotasks();

      expect(harness.sockets).toHaveLength(2);
    });

    it('reconnects after 4503 with backoff', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness);

      socket.serverClose(4503, 'unavailable');

      expect(harness.statuses.at(-1)).toEqual({
        status: 'offline',
        detail: expect.objectContaining({ code: 4503, retryInMs: 1000 }),
      });

      vi.advanceTimersByTime(1000);

      expect(harness.sockets).toHaveLength(2);
    });

    it('reconnects quickly after 1001', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness);

      socket.serverClose(1001, 'server shutting down');

      expect(harness.statuses.at(-1)?.detail?.retryInMs).toBeLessThan(1000);

      vi.advanceTimersByTime(harness.statuses.at(-1)?.detail?.retryInMs ?? 0);

      expect(harness.sockets).toHaveLength(2);
    });

    it('backs off harder after 1008 than after a plain close', () => {
      const plain = createHarness();

      connectAndHandshake(plain).serverClose(4503, '');

      const policed = createHarness();

      connectAndHandshake(policed).serverClose(1008, 'inbound rate exceeded');

      const plainDelay = plain.statuses.at(-1)?.detail?.retryInMs ?? 0;
      const policedDelay = policed.statuses.at(-1)?.detail?.retryInMs ?? 0;

      expect(policedDelay).toBeGreaterThan(plainDelay);
    });

    it('is terminal only on the SECOND 1009', () => {
      const harness = createHarness();

      connectAndHandshake(harness).serverClose(1009, 'message too big');

      expect(harness.statuses.at(-1)?.status).toBe('offline');

      vi.advanceTimersByTime(1000);
      harness.socket().open();
      harness.socket().deliver(controlFrame());
      harness.socket().serverClose(1009, 'message too big');

      expect(harness.statuses.at(-1)).toEqual({
        status: 'error',
        detail: expect.objectContaining({ error: 'oversized-update', code: 1009 }),
      });

      vi.advanceTimersByTime(300_000);

      expect(harness.sockets).toHaveLength(2);
    });

    // The spiral: after a 1009 the reconnect's SyncStep1 draws the server's own
    // SyncStep1, and answering it with the whole state re-ships the very bytes
    // that were just refused — so ONE oversized paste ends the session in two
    // rounds, with no explanation of what was too big.
    describe('a state the server already refused', () => {
      /** Connect, sync against `room`, write `blocks`, then take a 1009. */
      const refuseAfterWriting = (harness: Harness, room: DocumentStore, blocks: { id: string; text: string }[]): void => {
        const first = connectAndHandshake(harness);

        completeFirstSync(harness, first, room);

        for (const block of blocks) {
          harness.store.addBlock({ id: block.id, type: 'paragraph', data: { text: block.text } });
        }

        first.serverClose(1009, 'message too big');
      };

      it('refuses to answer a resync with it, and says how big it was', () => {
        const harness = createHarness();
        const room = new DocumentStore(new YBlockSerializer());
        const fresh = new DocumentStore(new YBlockSerializer());

        stores.push(room, fresh);
        refuseAfterWriting(harness, room, [
          { id: 'kept', text: 'y'.repeat(2048) },
          { id: 'huge', text: 'x'.repeat(8192) },
        ]);

        expect(harness.statuses.at(-1)?.status).toBe('offline');

        vi.advanceTimersByTime(30_000);

        const second = harness.socket();

        second.open();
        second.deliver(controlFrame());
        second.deliver({ type: 'syncStep1', stateVector: fresh.getStateVector() });

        expect(second.frameTypes).toEqual(['syncStep1']);
        expect(harness.statuses.at(-1)).toEqual({
          status: 'error',
          detail: expect.objectContaining({
            error: 'oversized-update',
            reason: expect.stringContaining('bytes'),
          }),
        });
      });

      // The refusal is the first thing that can end the session by returning
      // normally, and the buffered drain is a loop: a server that ordered its
      // frames the other way would otherwise report 'connected' AFTER 'error',
      // un-latching a terminal state the module treats as the last word.
      it('stops draining the buffer when the refusal ends the session', () => {
        const harness = createHarness();
        const room = new DocumentStore(new YBlockSerializer());
        const fresh = new DocumentStore(new YBlockSerializer());

        stores.push(room, fresh);
        refuseAfterWriting(harness, room, [
          { id: 'kept', text: 'y'.repeat(2048) },
          { id: 'huge', text: 'x'.repeat(8192) },
        ]);
        advanceToReconnect(harness);

        const second = harness.socket();

        second.open();
        second.deliver({ type: 'syncStep1', stateVector: fresh.getStateVector() });
        second.deliver({ type: 'syncStep2', update: room.encodeStateAsUpdate() });
        second.deliver(controlFrame());

        const terminalAt = harness.statuses.findIndex((entry) => entry.status === 'error');

        expect(harness.statuses[terminalAt]?.detail?.error).toBe('oversized-update');

        // Nothing may follow the provider's last word: not a buffered syncStep2
        // reporting 'connected', and not a deadline the dead connection armed.
        vi.advanceTimersByTime(300_000);

        expect(harness.statuses.slice(terminalAt + 1)).toEqual([]);
        expect(harness.sockets).toHaveLength(2);
      });

      it('still answers a resync whose diff is smaller than the refused frame', () => {
        const harness = createHarness();
        const room = new DocumentStore(new YBlockSerializer());

        stores.push(room);
        refuseAfterWriting(harness, room, [{ id: 'huge', text: 'x'.repeat(8192) }]);
        vi.advanceTimersByTime(30_000);

        const second = harness.socket();

        second.open();
        second.deliver(controlFrame());

        // The room holds everything we have, so the answer is a few bytes.
        room.applyRemoteUpdate(harness.store.encodeStateAsUpdate(), { source: 'room' });
        second.deliver({ type: 'syncStep1', stateVector: room.getStateVector() });

        expect(second.frameTypes).toEqual(['syncStep1', 'syncStep2']);
        expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
      });

      // The real server answers our SyncStep1 with SyncStep2 FIRST, then its
      // own SyncStep1 (CollabRoom.AnswerSyncStep1Locked). Against a server
      // that announces no cap, clearing the learned bound on that SyncStep2
      // let the answer re-ship the refused bytes on every reconnect: 1009,
      // back in ~1s, repeat — and no terminal ever fired.
      it('is terminal on the reconnect when SyncStep2 precedes SyncStep1 (the real server order)', () => {
        const harness = createHarness();
        const room = new DocumentStore(new YBlockSerializer());

        stores.push(room);
        refuseAfterWriting(harness, room, [{ id: 'huge', text: 'x'.repeat(8192) }]);

        // The room never took the refused bytes, so its state vector still
        // lacks them and a shipped answer draws the 1009 again.
        for (const _round of [0, 1, 2]) {
          advanceToReconnect(harness);

          const socket = harness.socket();

          socket.open();
          socket.deliver(controlFrame());
          socket.deliver({ type: 'syncStep2', update: room.encodeStateAsUpdate(harness.store.getStateVector()) });
          socket.deliver({ type: 'syncStep1', stateVector: room.getStateVector() });

          if (harness.provider.status === 'error') {
            break;
          }

          socket.serverClose(1009, 'message too big');
        }

        expect(harness.statuses.at(-1)).toEqual({
          status: 'error',
          detail: expect.objectContaining({ error: 'oversized-update' }),
        });
        expect(harness.sockets).toHaveLength(2);
      });

      // The bound is a loop-breaker for the answer that follows a 1009. Once
      // an answer has shipped, a later resync — a state vector that lacks the
      // once-refused bytes — is answered in full again.
      it('forgets the refused size once a resync answer ships', () => {
        const harness = createHarness();
        const room = new DocumentStore(new YBlockSerializer());
        const fresh = new DocumentStore(new YBlockSerializer());

        stores.push(room, fresh);
        refuseAfterWriting(harness, room, [{ id: 'huge', text: 'x'.repeat(8192) }]);
        vi.advanceTimersByTime(30_000);

        const second = harness.socket();

        second.open();
        second.deliver(controlFrame());

        // The room holds everything we have, so the resync answer is a few bytes.
        room.applyRemoteUpdate(harness.store.encodeStateAsUpdate(), { source: 'room' });
        completeFirstSync(harness, second, room);

        expect(harness.statuses.at(-1)?.status).toBe('connected');
        expect(second.frameTypes).toEqual(['syncStep1', 'syncStep2']);

        second.deliver({ type: 'syncStep1', stateVector: fresh.getStateVector() });

        expect(second.frameTypes).toEqual(['syncStep1', 'syncStep2', 'syncStep2']);
        expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
      });

      // A 1009 before we wrote anything says nothing about our own frames; a
      // bound of zero would refuse every answer for the rest of the session.
      it('learns no bound from a 1009 on a connection it never wrote to', () => {
        const harness = createHarness();
        const fresh = new DocumentStore(new YBlockSerializer());

        stores.push(fresh);
        harness.provider.connect();
        harness.socket().serverClose(1009, 'message too big');
        vi.advanceTimersByTime(30_000);

        const second = harness.socket();

        second.open();
        second.deliver(controlFrame());
        harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'hi' } });
        second.deliver({ type: 'syncStep1', stateVector: fresh.getStateVector() });

        expect(second.frameTypes).toContain('syncStep2');
      });
    });

    // The 1009 count clears with the bound, on a shipped resync answer — not
    // on the sync alone, which lands BEFORE the answer on a real server.
    it('lets a shipped resync answer clear the failure counters', () => {
      const harness = createHarness();
      const room = new DocumentStore(new YBlockSerializer());

      stores.push(room);

      const first = connectAndHandshake(harness);

      harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'x'.repeat(512) } });
      first.serverClose(1009, 'message too big');
      vi.advanceTimersByTime(1000);

      const second = harness.socket();

      second.open();
      second.deliver(controlFrame());

      // The room holds b1, so the answer to its SyncStep1 is a few bytes.
      room.applyRemoteUpdate(harness.store.encodeStateAsUpdate(), { source: 'room' });
      completeFirstSync(harness, second, room);

      expect(second.frameTypes).toEqual(['syncStep1', 'syncStep2']);

      second.serverClose(1009, 'message too big');

      expect(harness.statuses.at(-1)?.status).toBe('offline');
    });

    // An unrelated close in between says nothing about whether our frames fit;
    // resetting the count on one let a flapping server hide the policy forever.
    it('still terminates on the second 1009 when another code intervenes', () => {
      const harness = createHarness();

      connectAndHandshake(harness).serverClose(1009, 'message too big');
      vi.advanceTimersByTime(1000);

      harness.socket().open();
      harness.socket().deliver(controlFrame());
      harness.socket().serverClose(4503, '');
      advanceToReconnect(harness);

      harness.socket().open();
      harness.socket().deliver(controlFrame());
      harness.socket().serverClose(1009, 'message too big');

      expect(harness.statuses.at(-1)).toEqual({
        status: 'error',
        detail: expect.objectContaining({ error: 'oversized-update', code: 1009 }),
      });
    });

    // The second 4401 rejects a ticket that was force-minted one cycle earlier,
    // so a dropped connection in between does not earn the session a third try.
    it('still terminates on the second 4401 when another code intervenes', () => {
      const harness = createHarness();

      connectAndHandshake(harness).serverClose(4401, 'invalid pass');
      advanceToReconnect(harness);

      harness.socket().open();
      harness.socket().deliver(controlFrame());
      harness.socket().serverClose(1006, 'connection lost');
      advanceToReconnect(harness);

      harness.socket().open();
      harness.socket().deliver(controlFrame());
      harness.socket().serverClose(4401, 'invalid pass');

      expect(harness.statuses.at(-1)).toEqual({
        status: 'error',
        detail: expect.objectContaining({ error: 'unauthorized', code: 4401 }),
      });
    });
  });

  // The server sends its message cap as a limits frame right after the control
  // frame, so the client can refuse an oversized frame BEFORE writing it —
  // learning from a 1009 stays the fallback for servers that announce nothing.
  describe('the announced message cap', () => {
    it('refuses to answer a resync bigger than the announced cap, terminally', () => {
      const harness = createHarness();
      const fresh = new DocumentStore(new YBlockSerializer());

      stores.push(fresh);

      const socket = connectAndHandshake(harness);

      socket.deliver({ type: 'limits', maxMessageBytes: 200 });
      harness.store.addBlock({ id: 'huge', type: 'paragraph', data: { text: 'x'.repeat(8192) } });
      socket.deliver({ type: 'syncStep1', stateVector: fresh.getStateVector() });

      expect(socket.frameTypes).not.toContain('syncStep2');
      expect(harness.statuses.at(-1)).toEqual({
        status: 'error',
        detail: expect.objectContaining({
          error: 'oversized-update',
          reason: expect.stringContaining('bytes'),
        }),
      });

      // Terminal: no reconnect may follow the refusal.
      vi.advanceTimersByTime(300_000);

      expect(harness.sockets).toHaveLength(1);
    });

    // The server refuses frames STRICTLY larger than its cap, so must we.
    it('still answers a resync exactly at the announced cap', () => {
      const harness = createHarness();
      const fresh = new DocumentStore(new YBlockSerializer());

      stores.push(fresh);

      const socket = connectAndHandshake(harness);

      harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'x'.repeat(512) } });

      const answer = encode({ type: 'syncStep2', update: harness.store.encodeStateAsUpdate(fresh.getStateVector()) });

      socket.deliver({ type: 'limits', maxMessageBytes: answer.byteLength });
      socket.deliver({ type: 'syncStep1', stateVector: fresh.getStateVector() });

      expect(socket.frameTypes).toContain('syncStep2');
      expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
    });

    it('refuses to send a local update bigger than the announced cap, terminally', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);

      const socket = connectAndHandshake(harness);

      socket.deliver({ type: 'limits', maxMessageBytes: 200 });
      completeFirstSync(harness, socket, peer);

      expect(harness.statuses.at(-1)?.status).toBe('connected');

      harness.store.addBlock({ id: 'huge', type: 'paragraph', data: { text: 'x'.repeat(8192) } });

      expect(socket.frameTypes).not.toContain('update');
      expect(harness.statuses.at(-1)).toEqual({
        status: 'error',
        detail: expect.objectContaining({
          error: 'oversized-update',
          reason: expect.stringContaining('bytes'),
        }),
      });

      vi.advanceTimersByTime(300_000);

      expect(harness.sockets).toHaveLength(1);
    });

    // The announced cap is fact, not inference: a completed sync clears the
    // LEARNED refused-size bound, but must not clear what the server declared.
    it('keeps the announced cap across a completed sync', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);
      // Written BEFORE connect, so no update frame ships: the oversized bytes
      // leave only as the answer to the peer's syncStep1 below.
      harness.store.addBlock({ id: 'huge', type: 'paragraph', data: { text: 'x'.repeat(8192) } });

      const socket = connectAndHandshake(harness);

      socket.deliver({ type: 'limits', maxMessageBytes: 200 });
      // syncStep2 completes the sync (clearing the learned bound), THEN the
      // peer's syncStep1 draws the oversized answer against the announced cap.
      completeFirstSync(harness, socket, peer);

      expect(harness.statuses.map((entry) => entry.status)).toContain('connected');
      expect(harness.statuses.at(-1)).toEqual({
        status: 'error',
        detail: expect.objectContaining({ error: 'oversized-update' }),
      });
    });

    // A different server (or a redeploy) may take different sizes: the cap
    // belongs to the CONNECTION that announced it, never to the next one.
    it('drops the announced cap on reconnect and re-learns from the next frame', () => {
      const harness = createHarness();
      const fresh = new DocumentStore(new YBlockSerializer());

      stores.push(fresh);

      const first = connectAndHandshake(harness);

      first.deliver({ type: 'limits', maxMessageBytes: 100 });
      first.serverClose(1006, 'connection lost');
      vi.advanceTimersByTime(30_000);

      const second = harness.socket();

      second.open();
      second.deliver(controlFrame());
      harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'x'.repeat(512) } });
      second.deliver({ type: 'syncStep1', stateVector: fresh.getStateVector() });

      expect(second.frameTypes).toContain('syncStep2');
      expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
    });

    it('still ignores a frame of an unknown message type', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);

      const socket = connectAndHandshake(harness);

      completeFirstSync(harness, socket, peer);
      // Type 102 with a payload: ignorable forward compatibility, not an error.
      socket.receive(new Uint8Array([102, 0x02, 0xde, 0xad]));

      expect(harness.statuses.at(-1)?.status).toBe('connected');
      expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
    });
  });

  describe('backoff', () => {
    it('grows exponentially and caps at 30s', () => {
      const harness = createHarness();
      const delays: number[] = [];

      connectAndHandshake(harness);

      for (const _attempt of Array.from({ length: 8 })) {
        harness.socket().serverClose(4503, '');
        delays.push(harness.statuses.at(-1)?.detail?.retryInMs ?? 0);
        advanceToReconnect(harness);
        harness.socket().open();
        harness.socket().deliver(controlFrame());
      }

      expect(delays.slice(0, 5)).toEqual([1000, 2000, 4000, 8000, 16_000]);
      expect(delays.at(-1)).toBe(30_000);
    });

    it('resets the backoff after a successful sync', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);

      const socket = connectAndHandshake(harness);

      socket.serverClose(4503, '');

      expect(harness.statuses.at(-1)?.detail?.retryInMs).toBe(1000);

      vi.advanceTimersByTime(1000);
      harness.socket().open();
      harness.socket().deliver(controlFrame());
      harness.socket().serverClose(4503, '');

      expect(harness.statuses.at(-1)?.detail?.retryInMs).toBe(2000);

      vi.advanceTimersByTime(2000);
      harness.socket().open();
      harness.socket().deliver(controlFrame());
      completeFirstSync(harness, harness.socket(), peer);
      harness.socket().serverClose(4503, '');

      expect(harness.statuses.at(-1)?.detail?.retryInMs).toBe(1000);
    });
  });

  describe('reconnect hygiene', () => {
    it('re-hooks the seam exactly once per generation', () => {
      const harness = createHarness();
      const first = connectAndHandshake(harness);

      first.serverClose(1001, '');
      vi.advanceTimersByTime(1000);

      const second = harness.socket();

      second.open();
      second.deliver(controlFrame());
      harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'once' } });

      expect(second.frameTypes.filter((type) => type === 'update')).toHaveLength(1);
      expect(first.frameTypes.filter((type) => type === 'update')).toHaveLength(0);
    });

    it('ignores a stale socket that closes after a newer generation opened', () => {
      const harness = createHarness();
      const first = connectAndHandshake(harness);

      first.serverClose(1001, '');
      vi.advanceTimersByTime(1000);

      const second = harness.socket();

      second.open();
      second.deliver(controlFrame());
      first.serverClose(4400, 'late');

      expect(harness.statuses.at(-1)?.status).not.toBe('error');
    });
  });

  describe('destroy', () => {
    it('closes the socket, stops timers and reports nothing afterwards', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness);
      const seen = harness.statuses.length;

      harness.provider.destroy();

      expect(socket.closedWith).not.toBeNull();

      harness.store.destroy();
      stores.length = 0;

      expect(vi.getTimerCount()).toBe(0);
      expect(harness.statuses).toHaveLength(seen);
    });

    it('unhooks the doc seam so a later local write sends nothing', () => {
      const harness = createHarness();
      const socket = connectAndHandshake(harness);

      harness.provider.destroy();
      harness.store.addBlock({ id: 'b1', type: 'paragraph', data: { text: 'after' } });

      // Not an exact list: destroy also withdraws this client's presence, and
      // that goodbye is the one frame it is allowed to send on the way out.
      expect(socket.frameTypes).not.toContain('update');
      expect(socket.frameTypes.filter((type) => type !== 'awareness')).toEqual(['syncStep1', 'activity']);
    });

    it('never opens a socket when the ticket resolves after destroy', async () => {
      const ticketSource = vi.fn(() => Promise.resolve('tok'));
      const harness = createHarness({ ticketSource });

      harness.provider.connect();
      harness.provider.destroy();
      await flushMicrotasks();

      expect(harness.sockets).toHaveLength(0);
      expect(harness.statuses.map((entry) => entry.status)).toEqual(['connecting']);
    });

    it('does not reconnect after destroy', () => {
      const harness = createHarness();

      connectAndHandshake(harness).serverClose(4503, '');
      harness.provider.destroy();

      vi.advanceTimersByTime(300_000);

      expect(harness.sockets).toHaveLength(1);
    });
  });

  /**
   * blok-sync.v2: the outbox drain, exact acknowledgement, retry and rejection
   * (packages/server/protocol/blok-sync-v2.md sections 6-8).
   */
  describe('the v2 outbox drain', () => {
    /** Mirrors the provider's own deadline; a test advances exactly to it. */
    const ACK_TIMEOUT_MS = 15_000;

    /** 32 lowercase hex, and never an id this outbox mints. */
    const OTHER_TAB_OPERATION = 'abcdefabcdefabcdefabcdefabcdefab';

    /** The one rejection code that means "your history belongs to another room". */
    const LINEAGE_MISMATCH = 'lineage-mismatch';

    interface OutboxRow {
      operationId: string;
      lineage: string;
      bytes: Uint8Array;
    }

    /**
     * The slice of `OperationStore` the provider drains.
     *
     * Its write queue is SERIAL exactly as the store's `enqueue` is
     * (`operation-store.ts`), and that is a contract rather than a
     * convenience: `quarantineLineage` has to run behind every `appendLocal`
     * already issued, or the edit the relineage flush provokes is stranded.
     * `oldestPending` stays OFF the queue, as the store's readonly cursor does.
     */
    class FakeOutbox {
      public rows: OutboxRow[] = [];

      public appended: Uint8Array[] = [];

      public acknowledged: string[] = [];

      public quarantined: { lineage: string; reason: string; snapshot: Uint8Array; moved: OutboxRow[] }[] = [];

      /** Ordered trace of the steps a relineage has to take in one exact order. */
      public readonly log: string[] = [];

      public lineage: string | null;

      /** Set to make every `quarantineLineage` reject with it. */
      public failQuarantine: Error | null = null;

      /** Set to make every `appendLocal` reject with it. */
      public failAppend: Error | null = null;

      /** When set, `quarantineLineage` waits on it before it does anything. */
      public quarantineGate: Promise<void> | null = null;

      /** Every `quarantineLineage` call, committed or not. */
      public quarantineAttempts = 0;

      private queue: Promise<unknown> = Promise.resolve();

      private minted = 0;

      private readonly listeners = new Set<() => void>();

      public constructor(lineage: string) {
        this.lineage = lineage;
      }

      /** Puts a row in without going through the provider. */
      public seed(bytes: Uint8Array): OutboxRow {
        const row = { operationId: this.mintId(), lineage: this.lineage ?? LINEAGE_A, bytes };

        this.rows.push(row);

        return row;
      }

      /** What another tab's commit looks like from here. */
      public commit(): void {
        this.listeners.forEach((listener) => listener());
      }

      public appendLocal(update: Uint8Array): Promise<OutboxRow> {
        return this.enqueue(() => {
          const lineage = this.lineage;

          if (this.failAppend !== null) {
            throw this.failAppend;
          }

          if (lineage === null) {
            throw new Error('the outbox has no lineage to stamp a local edit with');
          }

          this.appended.push(update);

          const row = { operationId: this.mintId(), lineage, bytes: update };

          this.rows.push(row);

          return row;
        });
      }

      public oldestPending(): Promise<OutboxRow | null> {
        return Promise.resolve(this.rows[0] ?? null);
      }

      public acknowledge(operationId: string): Promise<void> {
        return this.enqueue(() => {
          this.acknowledged.push(operationId);
          this.rows = this.rows.filter((row) => row.operationId !== operationId);
        });
      }

      public quarantineLineage(lineage: string, reason: string, snapshot: Uint8Array): Promise<number> {
        this.quarantineAttempts += 1;

        return this.enqueue(async () => {
          // The real store calls `dropSession()` BEFORE its transaction and
          // never rolls that back, so a quarantine that FAILS still ends the
          // lineage. That asymmetry is the whole of the stale-row defect.
          if (this.lineage === lineage) {
            this.lineage = null;
          }

          if (this.quarantineGate !== null) {
            await this.quarantineGate;
          }

          if (this.failQuarantine !== null) {
            throw this.failQuarantine;
          }

          const moved = this.rows.filter((row) => row.lineage === lineage);

          this.rows = this.rows.filter((row) => row.lineage !== lineage);

          this.log.push('quarantine');
          this.quarantined.push({ lineage, reason, snapshot, moved });

          return moved.length;
        });
      }

      public onCommitted(listener: () => void): () => void {
        this.listeners.add(listener);

        return (): void => {
          this.listeners.delete(listener);
        };
      }

      private enqueue<T>(work: () => T | PromiseLike<T>): Promise<T> {
        const result = this.queue.then(work);

        this.queue = result.catch(() => undefined);

        return result;
      }

      private mintId(): string {
        this.minted += 1;

        return this.minted.toString(16).padStart(32, '0');
      }
    }

    /** Every microtask a drain chains — deeper than `flushMicrotasks`. */
    const settle = async (): Promise<void> => {
      for (let tick = 0; tick < 20; tick += 1) {
        await Promise.resolve();
      }
    };

    /** A peer document playing the server side, registered for teardown. */
    const newPeer = (): DocumentStore => {
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);

      return peer;
    };

    const v2Handshake = (
      outbox: FakeOutbox,
      overrides: Partial<CollabProviderOptions> = {}
    ): { harness: Harness; socket: MockSocket } => {
      const harness = createHarness({ outbox, ...overrides });

      return { harness, socket: connectAndHandshake(harness, PROTOCOL_V2) };
    };

    /** The server's answer to our SyncStep1: its diff, then its own state vector. */
    const serverFirstSync = (harness: Harness, socket: MockSocket, peer: DocumentStore): void => {
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate(harness.store.getStateVector()) });
      socket.deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });
    };

    const operationFrames = (socket: MockSocket): Extract<SyncWireFrame, { type: 'operation' }>[] =>
      socket.frames.filter(
        (frame): frame is Extract<SyncWireFrame, { type: 'operation' }> => frame.type === 'operation'
      );

    const operationIds = (socket: MockSocket): string[] =>
      operationFrames(socket).map((frame) => frame.operationId);

    it('v2 never answers a server SyncStep1 with a raw SyncStep2', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);

      peer.addBlock({ id: 'p1', type: 'paragraph', data: { text: 'server' } });
      serverFirstSync(harness, socket, peer);
      await settle();

      expect(
        socket.frameTypes,
        'a v2 session answered the server SyncStep1 with a raw SyncStep2, putting history on the wire outside an operation envelope'
      ).not.toContain('syncStep2');
      expect(socket.frameTypes).toEqual(['syncStep1', 'activity', 'syncStep1']);
    });

    it('drains only after applying the server SyncStep2', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);

      outbox.seed(new Uint8Array([1, 2, 3]));
      harness.provider.drain();
      await settle();

      expect(socket.frameTypes, 'an operation was sent before the server SyncStep2 had been applied')
        .toEqual(['syncStep1', 'activity']);

      // ONLY the SyncStep2, without the server SyncStep1 that normally follows
      // it: the sync this frame completes is what has to unblock the drain.
      socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate(harness.store.getStateVector()) });
      await settle();

      expect(operationFrames(socket), 'the completed first sync did not release the drain').toHaveLength(1);
    });

    it('a server SyncStep1 is ignored while the outbox is non-empty and re-requested once it drains', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);
      const row = outbox.seed(new Uint8Array([1, 2, 3]));

      serverFirstSync(harness, socket, peer);
      await settle();

      expect(socket.frameTypes, 'the server SyncStep1 was served while operations were still pending')
        .toEqual(['syncStep1', 'activity', 'operation']);

      socket.deliver({
        type: 'acknowledgement',
        lineage: LINEAGE_A,
        operationId: row.operationId,
        serverSequence: '1',
      });
      await settle();

      expect(socket.frameTypes, 'a drained outbox never re-requested the server state vector')
        .toEqual(['syncStep1', 'activity', 'operation', 'syncStep1']);
    });

    it('residual local state after draining is enveloped as one operation', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);
      const row = outbox.seed(new Uint8Array([1, 2, 3]));

      // Local content no outbox row covers: what a v1 session left behind.
      harness.store.addBlock({ id: 'residual', type: 'paragraph', data: { text: 'kept' } });

      serverFirstSync(harness, socket, peer);
      await settle();

      socket.deliver({
        type: 'acknowledgement',
        lineage: LINEAGE_A,
        operationId: row.operationId,
        serverSequence: '1',
      });
      await settle();

      socket.deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });
      await settle();

      expect(
        outbox.appended,
        'the residual local state never reached the outbox, so it could only go up outside an operation envelope'
      ).toHaveLength(1);

      const frames = operationFrames(socket);

      expect(frames).toHaveLength(2);

      const applied = newPeer();

      applied.applyRemoteUpdate(frames[1].update, {});

      expect(applied.toJSON().map((block) => block.id)).toEqual(['residual']);
    });

    it('envelopes nothing when the server already holds every local struct', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);

      harness.store.addBlock({ id: 'shared', type: 'paragraph', data: { text: 'both' } });
      peer.applyRemoteUpdate(harness.store.encodeStateAsUpdate(), {});

      serverFirstSync(harness, socket, peer);
      await settle();
      socket.deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });
      await settle();

      expect(
        outbox.appended,
        'a caught-up diff was enveloped as an operation, so every v2 connection would journal an empty edit'
      ).toEqual([]);
      expect(operationFrames(socket)).toEqual([]);
    });

    it('v1-era cached edits reach a v2 server after an upgrade', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);

      // Cached under a v1 session, so it left no outbox row behind.
      harness.store.addBlock({ id: 'cached', type: 'paragraph', data: { text: 'from v1' } });

      serverFirstSync(harness, socket, peer);
      await settle();
      socket.deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });
      await settle();

      const frames = operationFrames(socket);

      expect(frames, 'edits cached under a v1 session never reached the v2 server').toHaveLength(1);

      const applied = newPeer();

      applied.applyRemoteUpdate(frames[0].update, {});

      expect(applied.toJSON().map((block) => block.id)).toEqual(['cached']);
    });

    it('keeps one operation in flight per provider', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);

      outbox.seed(new Uint8Array([1]));
      outbox.seed(new Uint8Array([2]));

      serverFirstSync(harness, socket, peer);
      await settle();
      harness.provider.drain();
      harness.provider.drain();
      await settle();

      expect(
        operationFrames(socket),
        'a second operation went on the wire while the first was still unacknowledged'
      ).toHaveLength(1);
    });

    it('resends the same id after disconnect before ack', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);
      const row = outbox.seed(new Uint8Array([1, 2, 3]));

      serverFirstSync(harness, socket, peer);
      await settle();

      expect(operationFrames(socket)).toHaveLength(1);

      socket.serverClose(1006, 'dropped');
      advanceToReconnect(harness);

      const next = harness.socket();

      next.open(PROTOCOL_V2);
      next.deliver(controlFrame());
      serverFirstSync(harness, next, peer);
      await settle();

      expect(
        operationIds(next),
        'the retry minted a new operation id, so the server cannot recognise it as the duplicate it is'
      ).toEqual([row.operationId]);
    });

    it('ack deletes the exact row and drains the next', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);
      const first = outbox.seed(new Uint8Array([1]));
      const second = outbox.seed(new Uint8Array([2]));

      serverFirstSync(harness, socket, peer);
      await settle();

      socket.deliver({
        type: 'acknowledgement',
        lineage: LINEAGE_A,
        operationId: first.operationId,
        serverSequence: '1',
      });
      await settle();

      expect(outbox.acknowledged, 'the acknowledgement deleted something other than the row it named')
        .toEqual([first.operationId]);
      expect(outbox.rows.map((row) => row.operationId)).toEqual([second.operationId]);
      expect(operationIds(socket)).toEqual([first.operationId, second.operationId]);
    });

    it('ack from another tab is harmless', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);
      const first = outbox.seed(new Uint8Array([1]));
      const second = outbox.seed(new Uint8Array([2]));

      serverFirstSync(harness, socket, peer);
      await settle();

      socket.deliver({
        type: 'acknowledgement',
        lineage: LINEAGE_A,
        operationId: OTHER_TAB_OPERATION,
        serverSequence: '7',
      });
      await settle();

      expect(
        operationIds(socket),
        "another tab's acknowledgement released the in-flight slot, so two operations were unanswered at once"
      ).toEqual([first.operationId]);
      expect(outbox.rows.map((row) => row.operationId)).toEqual([first.operationId, second.operationId]);

      socket.deliver({
        type: 'acknowledgement',
        lineage: LINEAGE_A,
        operationId: first.operationId,
        serverSequence: '8',
      });
      await settle();

      expect(operationIds(socket)).toEqual([first.operationId, second.operationId]);
    });

    it('ack timeout reconnects without deleting', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);

      outbox.seed(new Uint8Array([1, 2, 3]));
      serverFirstSync(harness, socket, peer);
      await settle();

      expect(operationFrames(socket)).toHaveLength(1);

      vi.advanceTimersByTime(ACK_TIMEOUT_MS);
      await settle();

      expect(outbox.acknowledged, 'a row nobody acknowledged was deleted when its deadline passed').toEqual([]);
      expect(outbox.rows).toHaveLength(1);
      expect(harness.statuses.at(-1)?.status).toBe('offline');
    });

    it('broadcast from the submitting socket applies idempotently', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);

      harness.store.addBlock({ id: 'mine', type: 'paragraph', data: { text: 'typed' } });
      outbox.seed(harness.store.encodeStateAsUpdate());
      serverFirstSync(harness, socket, peer);
      await settle();

      // The broadcast has to carry something this document LACKS. Echoing back
      // state we already hold passes whether the frame is applied, applied
      // twice, or ignored — and ignoring it is the mistake this diff invites,
      // since v2 replaces the type-0 SEND path while type-0 stays the
      // server-to-client broadcast format (protocol section 7).
      peer.addBlock({ id: 'theirs', type: 'paragraph', data: { text: 'peer' } });

      const broadcast = peer.encodeStateAsUpdate(harness.store.getStateVector());

      socket.deliver({ type: 'update', update: broadcast });
      socket.deliver({ type: 'update', update: broadcast });
      await settle();

      // Sorted: two root blocks from two clients converge in a well-defined but
      // client-id-dependent order, and the claim here is presence-without-
      // duplication, not order. A skipped apply gives ['mine'], a doubled one
      // ['mine', 'theirs', 'theirs'].
      expect(
        [...harness.store.toJSON().map((block) => block.id)].sort(),
        'a v2 session did not apply the server broadcast, or applied it twice — that frame is how it receives every peer\'s work'
      ).toEqual(['mine', 'theirs']);
      expect(harness.statuses.some((entry) => entry.status === 'error')).toBe(false);
    });

    it('lineage mismatch quarantines before reset', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const harness = createHarness({ outbox, initialLineage: LINEAGE_A }, (seam) => ({
        ...seam,
        resetForRelineage: (): void => {
          outbox.log.push('reset');
          seam.resetForRelineage();
        },
      }));
      const row = outbox.seed(new Uint8Array([1, 2, 3]));

      harness.provider.connect();
      harness.socket().open(PROTOCOL_V2);
      harness.socket().deliver(controlFrame({ lineage: LINEAGE_B }));
      await settle();

      expect(
        outbox.log,
        'the document was reset before the old lineage was quarantined, so its pending rows were stranded under a lineage nothing can drain'
      ).toEqual(['quarantine', 'reset']);
      expect(outbox.quarantined.map((entry) => entry.lineage)).toEqual([LINEAGE_A]);
      expect(outbox.quarantined[0].moved.map((moved) => moved.operationId)).toEqual([row.operationId]);
      expect(harness.statuses.at(-1)?.status).toBe('offline');
    });

    it('a buffered Yjs write in flight during relineage lands in quarantine, not the new lineage', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const buffered = new Uint8Array([9, 9, 9]);
      const harness = createHarness({ outbox, initialLineage: LINEAGE_A }, (seam) => ({
        ...seam,
        // What the module's lifetime capture tap does when the buffer flushes.
        flushPendingWrites: (): void => {
          void outbox.appendLocal(buffered);
        },
        resetForRelineage: (): void => {
          outbox.log.push('reset');
          seam.resetForRelineage();
        },
      }));

      harness.provider.connect();
      harness.socket().open(PROTOCOL_V2);
      harness.socket().deliver(controlFrame({ lineage: LINEAGE_B }));
      await settle();

      expect(
        outbox.quarantined[0]?.moved.map((moved) => moved.bytes),
        'the last buffered edit was journalled after the quarantine walked the outbox, so it stayed stamped with a lineage the server has abandoned'
      ).toEqual([buffered]);
      expect(outbox.rows, 'a row survived the relineage').toEqual([]);
      expect(outbox.log).toEqual(['quarantine', 'reset']);
    });

    it('final rejection quarantines the dependent tail', async () => {
      // The four stable final codes plus one the spec's OPEN set allows and
      // this build has never heard of: an unknown code is final too.
      const codes = ['invalid-update', 'read-only', 'oversized-update', 'operation-id-conflict', 'some-future-code'];

      for (const code of codes) {
        const outbox = new FakeOutbox(LINEAGE_A);
        const peer = newPeer();
        const { harness, socket } = v2Handshake(outbox);
        const first = outbox.seed(new Uint8Array([1]));

        outbox.seed(new Uint8Array([2]));
        serverFirstSync(harness, socket, peer);
        await settle();

        socket.deliver({ type: 'rejection', lineage: LINEAGE_A, operationId: first.operationId, code });
        await settle();

        expect(
          outbox.rows,
          `a ${code} rejection left the dependent tail in the outbox, where it is redriven and refused forever`
        ).toEqual([]);
        expect(outbox.quarantined.map((entry) => entry.reason)).toEqual([code]);
        expect(socket.closedWith, `a ${code} rejection ended the connection`).toBeNull();
      }
    });

    it('transient server close leaves every row pending', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);

      outbox.seed(new Uint8Array([1, 2, 3]));
      serverFirstSync(harness, socket, peer);
      await settle();

      socket.serverClose(1006, 'dropped');
      await settle();

      expect(outbox.quarantined, 'a dropped connection quarantined rows the server never judged').toEqual([]);
      expect(outbox.rows).toHaveLength(1);
      expect(outbox.acknowledged).toEqual([]);
      expect(harness.statuses.at(-1)?.status).toBe('offline');
    });

    it('commit-unavailable close (4503) keeps every row, quarantines nothing, and reconnects with backoff', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);

      outbox.seed(new Uint8Array([1, 2, 3]));
      serverFirstSync(harness, socket, peer);
      await settle();

      socket.serverClose(4503, 'commit unavailable, retry');
      await settle();

      expect(
        outbox.quarantined,
        'a commit-unavailable close quarantined rows whose commit outcome is merely unknown'
      ).toEqual([]);
      expect(outbox.rows).toHaveLength(1);
      expect(harness.statuses.at(-1)).toEqual({
        status: 'offline',
        detail: expect.objectContaining({ code: 4503, retryInMs: 1000 }),
      });

      advanceToReconnect(harness);

      expect(harness.sockets).toHaveLength(2);
    });

    it('message-size validation includes the v2 wrapper', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);
      const bytes = new Uint8Array(64).fill(7);
      const row = outbox.seed(bytes);
      const framed = encode({
        type: 'operation',
        lineage: LINEAGE_A,
        operationId: row.operationId,
        update: bytes,
      }).byteLength;

      // Strictly between the bare update and the framed operation: only the
      // 102 envelope puts this row over the server's cap.
      expect(bytes.byteLength).toBeLessThan(framed - 1);
      socket.deliver({ type: 'limits', maxMessageBytes: framed - 1 });
      serverFirstSync(harness, socket, peer);
      await settle();

      expect(
        socket.frameTypes,
        'an operation past the server cap went on the wire — the cap was measured against the bare update, not the type-102 frame it travels in'
      ).not.toContain('operation');
      expect(outbox.quarantined.map((entry) => entry.reason)).toEqual(['oversized-update']);
      expect(
        harness.statuses.some((entry) => entry.status === 'error'),
        'one oversized row ended the whole session, so the next boot adopts it and ends the session again'
      ).toBe(false);
    });

    it('ignores a v2 frame naming a lineage we do not serve', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);
      const first = outbox.seed(new Uint8Array([1]));
      const second = outbox.seed(new Uint8Array([2]));

      serverFirstSync(harness, socket, peer);
      await settle();

      socket.deliver({
        type: 'acknowledgement',
        lineage: LINEAGE_B,
        operationId: first.operationId,
        serverSequence: '1',
      });
      socket.deliver({ type: 'rejection', lineage: LINEAGE_B, operationId: first.operationId, code: 'invalid-update' });
      await settle();

      expect(
        outbox.acknowledged,
        'a frame naming a lineage this session does not serve retired one of its rows'
      ).toEqual([]);
      expect(outbox.quarantined).toEqual([]);
      expect(outbox.rows.map((row) => row.operationId)).toEqual([first.operationId, second.operationId]);
      expect(operationIds(socket), 'a foreign-lineage frame released the in-flight slot').toEqual([first.operationId]);
    });

    it('frame 104 resets, retries or quarantines according to its code', async () => {
      // The three dispositions the spec fixes: a changed lineage resets, the one
      // transient code keeps everything, and anything final quarantines the tail
      // WITHOUT throwing the document away.
      const cases = [
        { code: LINEAGE_MISMATCH, resets: 1, quarantines: 1, kept: 0 },
        { code: 'not-synced', resets: 0, quarantines: 0, kept: 1 },
        { code: 'invalid-update', resets: 0, quarantines: 1, kept: 0 },
      ];

      for (const expected of cases) {
        const outbox = new FakeOutbox(LINEAGE_A);
        const peer = newPeer();
        const resets = { count: 0 };
        const harness = createHarness({ outbox }, (seam) => ({
          ...seam,
          resetForRelineage: (): void => {
            resets.count += 1;
            seam.resetForRelineage();
          },
        }));
        const socket = connectAndHandshake(harness, PROTOCOL_V2);
        const row = outbox.seed(new Uint8Array([1]));

        serverFirstSync(harness, socket, peer);
        await settle();

        socket.deliver({ type: 'rejection', lineage: LINEAGE_A, operationId: row.operationId, code: expected.code });
        await settle();

        expect(
          resets.count,
          `a ${expected.code} rejection took the wrong disposition: only a lineage that changed may throw the document away`
        ).toBe(expected.resets);
        expect(outbox.quarantined).toHaveLength(expected.quarantines);
        expect(outbox.rows).toHaveLength(expected.kept);
      }
    });

    it('asks for the residual state vector once per connection', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);

      serverFirstSync(harness, socket, peer);
      await settle();
      socket.deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });
      await settle();

      // A conformant server answers EVERY inbound SyncStep1 with one of its own.
      socket.deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });
      socket.deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });
      await settle();

      expect(
        socket.frameTypes.filter((type) => type === 'syncStep1'),
        'a second residual round went out, and a conformant server answers that with another SyncStep1 — a ping-pong with no end'
      ).toHaveLength(2);
    });

    /**
     * Compile-time only; `lint:types` is what checks it. The Collaboration
     * module hands the real store straight to the provider, so the seam has to
     * stay a structural subset of `OperationStore`.
     */
    it('the operation store satisfies the outbox seam the provider drains', () => {
      const storeIsAnOutbox: OperationStore extends CollabOutbox ? true : never = true;

      expect(storeIsAnOutbox).toBe(true);
    });

    it('quarantines a row of an abandoned lineage instead of sending it', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const harness = createHarness({ outbox, initialLineage: LINEAGE_A });

      outbox.seed(new Uint8Array([1, 2, 3]));
      // A quarantine that does not commit still ends the lineage in the store,
      // so the rows stay behind while the session moves on to the next one.
      outbox.failQuarantine = new Error('the quarantine transaction did not commit');

      harness.provider.connect();
      harness.socket().open(PROTOCOL_V2);
      harness.socket().deliver(controlFrame({ lineage: LINEAGE_B }));
      await settle();

      outbox.failQuarantine = null;
      advanceToReconnect(harness);

      const next = harness.socket();

      next.open(PROTOCOL_V2);
      next.deliver(controlFrame({ lineage: LINEAGE_B }));
      serverFirstSync(harness, next, peer);
      await settle();

      expect(
        operationIds(next),
        'a row stamped with an abandoned lineage went on the wire against the new one: the server answers lineage-mismatch, that relineage quarantines a lineage holding nothing, and the client loops forever with no terminal state'
      ).toEqual([]);
      expect(
        outbox.quarantined.map((entry) => entry.lineage),
        "the stale row was left as oldestPending's answer, which wedges the drain for the session"
      ).toContain(LINEAGE_A);
      expect(outbox.rows).toEqual([]);
    });

    it('stops trying when the stale-lineage quarantine will not commit', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const harness = createHarness({ outbox, initialLineage: LINEAGE_A });

      outbox.seed(new Uint8Array([1, 2, 3]));
      // Never lifted: whatever broke the relineage quarantine breaks the drain's
      // one too.
      outbox.failQuarantine = new Error('the quarantine transaction did not commit');

      harness.provider.connect();
      harness.socket().open(PROTOCOL_V2);
      harness.socket().deliver(controlFrame({ lineage: LINEAGE_B }));
      await settle();
      advanceToReconnect(harness);

      const next = harness.socket();

      next.open(PROTOCOL_V2);
      next.deliver(controlFrame({ lineage: LINEAGE_B }));
      serverFirstSync(harness, next, peer);
      await settle();

      // One for the relineage, one for the drain's stale row. Re-waking the
      // drain after a quarantine that did not commit reads the SAME row back
      // and spins on it.
      expect(
        outbox.quarantineAttempts,
        'the drain re-woke itself after a quarantine that did not commit, so it spins on the row it could not move'
      ).toBe(2);
      expect(operationIds(next)).toEqual([]);
    });

    it('reports a quarantine failure to the host', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const failures: unknown[] = [];
      const refusal = new Error('the quarantine transaction did not commit');
      const harness = createHarness({
        outbox,
        initialLineage: LINEAGE_A,
        onOutboxFailure: (thrown) => failures.push(thrown),
      });

      outbox.seed(new Uint8Array([1]));
      outbox.failQuarantine = refusal;

      harness.provider.connect();
      harness.socket().open(PROTOCOL_V2);
      harness.socket().deliver(controlFrame({ lineage: LINEAGE_B }));
      await settle();

      expect(
        failures,
        'a store write the PROVIDER issued failed and nothing told the host, so the session goes on reporting itself healthy while the local copy is poisoned'
      ).toEqual([refusal]);
    });

    it('reports a residual append failure to the host', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const failures: unknown[] = [];
      const refusal = new Error('the outbox write did not commit');
      const peer = newPeer();
      const harness = createHarness({ outbox, onOutboxFailure: (thrown) => failures.push(thrown) });
      const socket = connectAndHandshake(harness, PROTOCOL_V2);

      harness.store.addBlock({ id: 'residual', type: 'paragraph', data: { text: 'kept' } });
      outbox.failAppend = refusal;

      serverFirstSync(harness, socket, peer);
      await settle();
      socket.deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });
      await settle();

      expect(
        failures,
        'the one append the provider issues itself swallowed its refusal, so the 4.1 contract (drop the adoptable copy when an append rejects) went unhonoured on that path'
      ).toEqual([refusal]);
    });

    it('a final rejection leaves the connection alive past the ack deadline', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);
      const rejected = outbox.seed(new Uint8Array([1]));

      serverFirstSync(harness, socket, peer);
      await settle();

      socket.deliver({
        type: 'rejection',
        lineage: LINEAGE_A,
        operationId: rejected.operationId,
        code: 'invalid-update',
      });
      await settle();

      vi.advanceTimersByTime(ACK_TIMEOUT_MS);
      await settle();

      expect(
        socket.closedWith,
        'the acknowledgement deadline of an operation the rejection already settled tore down a connection that is meant to stay open'
      ).toBeNull();
      expect(harness.statuses.at(-1)?.status).toBe('connected');
    });

    it('refuses a connect while the relineage preparation is still running', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const release = { now: (): void => undefined };
      const harness = createHarness({ outbox, initialLineage: LINEAGE_A }, (seam) => ({
        ...seam,
        resetForRelineage: (): void => {
          outbox.log.push('reset');
          seam.resetForRelineage();
        },
      }));

      outbox.quarantineGate = new Promise<void>((resolve) => {
        release.now = resolve;
      });
      outbox.seed(new Uint8Array([1]));

      harness.provider.connect();
      harness.socket().open(PROTOCOL_V2);
      harness.socket().deliver(controlFrame({ lineage: LINEAGE_B }));
      await settle();

      // Inside the window: the quarantine has not committed, so the document
      // still carries the lineage being discarded.
      harness.provider.connect();

      expect(
        harness.sockets,
        'a host connect opened a generation on a document still being discarded, and the bumped generation then made the pending preparation skip the reset altogether'
      ).toHaveLength(1);

      release.now();
      await settle();

      expect(outbox.log).toEqual(['quarantine', 'reset']);
    });

    it('drains on the committed hint another tab raises', async () => {
      const outbox = new FakeOutbox(LINEAGE_A);
      const peer = newPeer();
      const { harness, socket } = v2Handshake(outbox);

      serverFirstSync(harness, socket, peer);
      await settle();

      expect(operationFrames(socket)).toEqual([]);

      const row = outbox.seed(new Uint8Array([4, 5]));

      outbox.commit();
      await settle();

      expect(
        operationIds(socket),
        'a row another tab committed sat in the outbox until this tab happened to reconnect'
      ).toEqual([row.operationId]);
    });

    /**
     * Protocol section 2. A client that negotiated v1 MUST NOT claim durable
     * acknowledgement: it keeps every row it holds, sends none of them, and
     * waits for a connection that can take them.
     */
    describe('mixed-version fallback', () => {
      it('offers blok-sync.v2 ahead of v1 once it has an outbox to drain', async () => {
        const ticketSource = vi.fn(() => Promise.resolve('tok-1'));
        const noTicket = createHarness({ outbox: new FakeOutbox(LINEAGE_A) });
        const withTicket = createHarness({ outbox: new FakeOutbox(LINEAGE_A), ticketSource });

        noTicket.provider.connect();
        withTicket.provider.connect();
        await flushMicrotasks();

        expect(
          noTicket.socket().protocols,
          'a client that can drain v2 never offered it, so a v2 server can only select v1 and nothing it journals is ever acknowledged'
        ).toEqual([PROTOCOL_V2, PROTOCOL]);
        expect(withTicket.socket().protocols).toEqual([PROTOCOL_V2, PROTOCOL, 'tok-1']);
      });

      it('v1 selected with pending v2 rows sends none', async () => {
        const outbox = new FakeOutbox(LINEAGE_A);
        const peer = newPeer();
        const harness = createHarness({ outbox });
        const socket = connectAndHandshake(harness, PROTOCOL);
        const row = outbox.seed(new Uint8Array([1, 2, 3]));

        harness.provider.drain();
        completeFirstSync(harness, socket, peer);
        await settle();

        expect(
          operationFrames(socket),
          'a v1 server was sent an operation it can neither acknowledge nor reject'
        ).toEqual([]);
        expect(
          outbox.rows.map((pending) => pending.operationId),
          'a row went missing on a session that cannot get a receipt for it'
        ).toEqual([row.operationId]);
        // v1 keeps its raw answer: withholding it would strand the room's sync.
        expect(socket.frameTypes).toEqual(['syncStep1', 'activity', 'syncStep2']);
      });

      it('v1 never deletes or acknowledges a v2 row', async () => {
        const outbox = new FakeOutbox(LINEAGE_A);
        const peer = newPeer();
        const harness = createHarness({ outbox });
        const socket = connectAndHandshake(harness, PROTOCOL);
        const row = outbox.seed(new Uint8Array([1, 2, 3]));

        completeFirstSync(harness, socket, peer);
        await settle();

        // Out of spec from the server's side, which is the point: a v1 session
        // has claimed no durability, so it may act on neither verdict.
        socket.deliver({
          type: 'acknowledgement',
          lineage: LINEAGE_A,
          operationId: row.operationId,
          serverSequence: '1',
        });
        socket.deliver({
          type: 'rejection',
          lineage: LINEAGE_A,
          operationId: row.operationId,
          code: 'invalid-update',
        });
        await settle();

        expect(
          outbox.acknowledged,
          'a v1 session retired a durable row on a receipt v1 never entitled it to'
        ).toEqual([]);
        expect(
          outbox.quarantined,
          'a v1 session quarantined a row on a verdict about an operation it never sent'
        ).toEqual([]);
        expect(outbox.rows.map((pending) => pending.operationId)).toEqual([row.operationId]);
      });

      it('a v2 connection drains and retires the row the v1 one kept', async () => {
        const outbox = new FakeOutbox(LINEAGE_A);
        const peer = newPeer();
        const harness = createHarness({ outbox });
        const first = connectAndHandshake(harness, PROTOCOL);
        const row = outbox.seed(new Uint8Array([1, 2, 3]));

        completeFirstSync(harness, first, peer);
        await settle();

        expect(operationFrames(first)).toEqual([]);

        first.serverClose(1006);
        advanceToReconnect(harness);

        const second = harness.socket();

        second.open(PROTOCOL_V2);
        second.deliver(controlFrame());
        completeFirstSync(harness, second, peer);
        await settle();

        expect(
          operationIds(second),
          'the row a v1 session kept was never sent on the v2 connection that could finally take it'
        ).toEqual([row.operationId]);

        second.deliver({
          type: 'acknowledgement',
          lineage: LINEAGE_A,
          operationId: row.operationId,
          serverSequence: '1',
        });
        await settle();

        expect(outbox.acknowledged).toEqual([row.operationId]);
        expect(outbox.rows).toEqual([]);
      });
    });
  });
});
