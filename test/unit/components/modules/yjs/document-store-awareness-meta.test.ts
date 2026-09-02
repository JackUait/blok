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

    // The seam prunes on the next inbound frame.
    store.applyAwarenessUpdate(frameFor([1]), { source: 'peer' });

    expect(states.size).toBe(2);
    expect(meta.size).toBe(2);
  });

  it('encodes a client whose meta row was pruned without throwing', () => {
    store.applyAwarenessUpdate(frameFor([42]), { source: 'peer' });
    timeOut(store, [42]);
    store.applyAwarenessUpdate(frameFor([43]), { source: 'peer' });

    // The provider lists removed ids for its deferred broadcast; y-protocols
    // itself would throw on a missing row.
    expect(() => store.encodeAwarenessUpdate([42, 43])).not.toThrow();
    expect(store.getAwarenessStates().has(43)).toBe(true);
  });
});
