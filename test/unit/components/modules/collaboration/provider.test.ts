import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCollabProvider } from '../../../../../src/components/modules/collaboration/provider';
import { decode, encode } from '../../../../../src/components/modules/collaboration/sync-wire';
import type {
  CollabDocSeam,
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

  public open(): void {
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

/** Connect, open, and validate the control frame — the "ready" starting point. */
const connectAndHandshake = (harness: Harness): MockSocket => {
  harness.provider.connect();

  const socket = harness.socket();

  socket.open();
  socket.deliver(controlFrame());

  return socket;
};

/** Server side of a first sync: answer our SyncStep1 with SyncStep2 + SyncStep1. */
const completeFirstSync = (harness: Harness, socket: MockSocket, peer: DocumentStore): void => {
  socket.deliver({ type: 'syncStep2', update: peer.encodeStateAsUpdate(harness.store.getStateVector()) });
  socket.deliver({ type: 'syncStep1', stateVector: peer.getStateVector() });
};

/** A harness whose seam records every lineage reset the provider asks for. */
const createResetHarness = (): { harness: Harness; resets: number[] } => {
  const resets: number[] = [];
  const harness = createHarness({}, (seam) => ({
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

      expect(harness.socket().frameTypes).toEqual(['syncStep1']);
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
      expect(harness.socket().frameTypes).toEqual(['syncStep1', 'syncStep2']);
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

    it('is terminal when the control frame never arrives', () => {
      const harness = createHarness({ handshakeTimeoutMs: 5000 });

      harness.provider.connect();
      harness.socket().open();

      vi.advanceTimersByTime(5000);

      expect(harness.statuses.at(-1)).toEqual({
        status: 'error',
        detail: expect.objectContaining({ error: 'handshake-timeout' }),
      });
      expect(harness.socket().closedWith).not.toBeNull();

      vi.advanceTimersByTime(120_000);

      expect(harness.sockets).toHaveLength(1);
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

      vi.advanceTimersByTime(120_000);

      expect(harness.sockets).toHaveLength(3);
    });

    it('accepts the new lineage after a reset instead of resetting again', () => {
      const { harness, resets } = createResetHarness();
      const first = connectAndHandshake(harness);

      first.serverClose(1001, 'restart');
      vi.advanceTimersByTime(1000);
      harness.socket().open();
      harness.socket().deliver(controlFrame({ lineage: LINEAGE_B, epoch: 1 }));

      vi.advanceTimersByTime(120_000);

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

      expect(socket.frameTypes).toEqual(['syncStep1', 'update']);
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

      expect(socket.frameTypes).toEqual(['syncStep1']);

      vi.advanceTimersByTime(100);

      expect(socket.frameTypes).toEqual(['syncStep1', 'awareness']);
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

      expect(socket.frameTypes).toEqual(['syncStep1', 'awareness']);
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

      vi.advanceTimersByTime(120_000);

      expect(harness.sockets).toHaveLength(2);
      expect(harness.statuses.map((entry) => entry.status)).not.toContain('error');
    });

    it('sends no pre-reset history on the connection that follows a 4409', () => {
      const { harness } = createResetHarness();
      const socket = connectAndHandshake(harness);

      harness.store.addBlock({ id: 'stale', type: 'paragraph', data: { text: 'must never be resent' } });
      socket.serverClose(4409, 'the room was reset');
      vi.advanceTimersByTime(120_000);

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

    it('refreshes the ticket and retries ONCE on 4401, then goes terminal', async () => {
      const ticketSource = vi.fn(() => Promise.resolve('tok'));
      const harness = createHarness({ ticketSource });

      harness.provider.connect();
      await flushMicrotasks();
      harness.socket().open();
      harness.socket().deliver(controlFrame());
      harness.socket().serverClose(4401, 'invalid pass');

      vi.advanceTimersByTime(30_000);
      await flushMicrotasks();

      expect(harness.sockets).toHaveLength(2);
      expect(ticketSource).toHaveBeenLastCalledWith({ forceRefresh: true });

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

    it('is terminal only on the SECOND consecutive 1009', () => {
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

    it('lets a completed sync clear the consecutive-failure counters', () => {
      const harness = createHarness();
      const peer = new DocumentStore(new YBlockSerializer());

      stores.push(peer);

      connectAndHandshake(harness).serverClose(1009, 'message too big');
      vi.advanceTimersByTime(1000);

      harness.socket().open();
      harness.socket().deliver(controlFrame());
      completeFirstSync(harness, harness.socket(), peer);
      harness.socket().serverClose(1009, 'message too big');

      expect(harness.statuses.at(-1)?.status).toBe('offline');
    });

    it('does not treat two 1009s separated by another code as consecutive', () => {
      const harness = createHarness();

      connectAndHandshake(harness).serverClose(1009, 'message too big');
      vi.advanceTimersByTime(1000);

      harness.socket().open();
      harness.socket().deliver(controlFrame());
      harness.socket().serverClose(4503, '');
      vi.advanceTimersByTime(30_000);

      harness.socket().open();
      harness.socket().deliver(controlFrame());
      harness.socket().serverClose(1009, 'message too big');

      expect(harness.statuses.at(-1)?.status).toBe('offline');
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
        vi.advanceTimersByTime(60_000);
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

      expect(socket.frameTypes).toEqual(['syncStep1']);
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
});
