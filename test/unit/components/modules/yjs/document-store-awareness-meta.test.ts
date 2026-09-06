import * as encoding from 'lib0/encoding';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';

/**
 * y-protocols keeps a `meta` row (clock + last-seen time) for every client id
 * it has ever heard of, and its outdated sweep deletes STATES only. A peer
 * that floods fake client ids therefore grows `meta` without bound: each id
 * costs a state for 30 s and a meta row forever. The seam must prune.
 */
const OUTDATED_TIMEOUT_MS = 30_000;
const SWEEP_INTERVAL_MS = OUTDATED_TIMEOUT_MS / 10;

/** Matches AWARENESS_TOMBSTONE_TTL_MS in the seam. */
const TOMBSTONE_TTL_MS = 90_000;

interface AwarenessInternals {
  meta: Map<number, { clock: number; lastUpdated: number }>;
  states: Map<number, unknown>;
}

/** y-protocols' private bookkeeping, reached only to measure and age it. */
const awarenessInternals = (store: DocumentStore): AwarenessInternals =>
  (store as unknown as { awareness: AwarenessInternals }).awareness;

/**
 * Age the given clients past the outdated timeout and run one sweep. lib0
 * binds its clock to the real `Date.now` at import, so fake timers drive the
 * sweep interval but not the timestamps the sweep compares.
 */
const timeOut = (store: DocumentStore, clientIds: number[]): void => {
  const { meta } = awarenessInternals(store);

  for (const clientId of clientIds) {
    const row = meta.get(clientId);

    if (row !== undefined) {
      row.lastUpdated -= OUTDATED_TIMEOUT_MS + 1;
    }
  }

  vi.advanceTimersByTime(SWEEP_INTERVAL_MS);
};

/**
 * Age the given clients past the tombstone TTL, so the next inbound frame is
 * allowed to drop their meta rows.
 */
const outliveTombstone = (store: DocumentStore, clientIds: number[]): void => {
  const { meta } = awarenessInternals(store);

  for (const clientId of clientIds) {
    const row = meta.get(clientId);

    if (row !== undefined) {
      row.lastUpdated -= TOMBSTONE_TTL_MS + 1;
    }
  }
};

/** One awareness frame carrying a state per client id, exactly as y-protocols encodes it. */
const frameFor = (clientIds: number[], clock = 1): Uint8Array => {
  const encoder = encoding.createEncoder();

  encoding.writeVarUint(encoder, clientIds.length);

  for (const clientId of clientIds) {
    encoding.writeVarUint(encoder, clientId);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, JSON.stringify({ user: { name: `fake-${clientId}` } }));
  }

  return encoding.toUint8Array(encoder);
};

describe('DocumentStore awareness — meta pruning', () => {
  let store: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    // Fake timers BEFORE enableAwareness: the outdated sweep is scheduled in
    // the Awareness constructor.
    vi.useFakeTimers();
    store = new DocumentStore(new YBlockSerializer());
    store.enableAwareness();
  });

  afterEach(() => {
    store.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('drops the meta rows of clients the outdated sweep removed, so a fake-id flood cannot grow meta without bound', () => {
    const fakeIds = Array.from({ length: 1000 }, (_, index) => 100_000 + index);

    store.applyAwarenessUpdate(frameFor(fakeIds), { source: 'peer' });

    const { meta, states } = awarenessInternals(store);

    expect(states.size).toBe(1001);
    expect(meta.size).toBe(1001);

    timeOut(store, fakeIds);

    expect(states.size).toBe(1);

    // The rows outlive the sweep on purpose — they are the tombstones that
    // keep a peer's relay from re-adding these ids. The flood guard collects
    // them once they are older than that window, on the next inbound frame.
    outliveTombstone(store, fakeIds);
    store.applyAwarenessUpdate(frameFor([1]), { source: 'peer' });

    expect(states.size).toBe(2);
    expect(meta.size).toBe(2);
  });

  it('encodes a client whose meta row was pruned without throwing', () => {
    store.applyAwarenessUpdate(frameFor([42]), { source: 'peer' });
    timeOut(store, [42]);
    outliveTombstone(store, [42]);
    store.applyAwarenessUpdate(frameFor([43]), { source: 'peer' });

    // The provider lists removed ids for its deferred broadcast; y-protocols
    // itself would throw on a missing row.
    expect(() => store.encodeAwarenessUpdate([42, 43])).not.toThrow();
    expect(store.getAwarenessStates().has(43)).toBe(true);
  });
});

/**
 * The meta row of a client whose state is gone is y-protocols' TOMBSTONE: it
 * is what makes `applyAwarenessUpdate` reject a relayed state at a clock the
 * row already holds, and the only thing `encodeAwarenessUpdate` can encode a
 * removal from. Deleting it the moment the state goes turns every peer's
 * relay into a resurrection and empties the removal we were about to send.
 */
describe('DocumentStore awareness — tombstones', () => {
  let store: DocumentStore;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    store = new DocumentStore(new YBlockSerializer());
    store.enableAwareness();
  });

  afterEach(() => {
    store.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refuses a client the sweep removed when a peer relays it again at the same clock', () => {
    store.applyAwarenessUpdate(frameFor([777], 2), { source: 'peer' });
    timeOut(store, [777]);

    expect(store.getAwarenessStates().has(777)).toBe(false);

    // Every join makes the server ask the room to re-announce, and a peer that
    // has not swept yet answers with 777 still in it.
    store.applyAwarenessUpdate(frameFor([777], 2), { source: 'peer' });

    expect(store.getAwarenessStates().has(777)).toBe(false);
  });

  it('still encodes the removal of a swept client after an unrelated frame arrives first', () => {
    const peer = new DocumentStore(new YBlockSerializer());

    peer.enableAwareness();
    peer.applyAwarenessUpdate(frameFor([777], 2), { source: 'peer' });
    store.applyAwarenessUpdate(frameFor([777], 2), { source: 'peer' });
    timeOut(store, [777]);

    // The provider coalesces removals over 100ms; anything inbound in that
    // window used to delete the row the removal is encoded from.
    store.applyAwarenessUpdate(frameFor([1], 1), { source: 'peer' });
    peer.applyAwarenessUpdate(store.encodeAwarenessUpdate([777]), { source: 'peer' });

    expect(peer.getAwarenessStates().has(777)).toBe(false);

    peer.destroy();
  });

  it('encodes a departure that clears this client from a peer', () => {
    const peer = new DocumentStore(new YBlockSerializer());

    peer.enableAwareness();
    store.setAwarenessField('user', { name: 'Alice' });
    peer.applyAwarenessUpdate(store.encodeAwarenessUpdate(), { source: 'peer' });

    const localClientId = [...store.getAwarenessStates().keys()][0];

    expect(peer.getAwarenessStates().has(localClientId)).toBe(true);

    const departure = store.encodeLocalAwarenessDeparture();

    expect(departure).not.toBeNull();
    peer.applyAwarenessUpdate(departure as Uint8Array, { source: 'peer' });

    expect(peer.getAwarenessStates().has(localClientId)).toBe(false);

    peer.destroy();
  });

  it('reports no departure before awareness is enabled', () => {
    const silent = new DocumentStore(new YBlockSerializer());

    expect(silent.encodeLocalAwarenessDeparture()).toBeNull();

    silent.destroy();
  });
});
