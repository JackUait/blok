import { describe, it, expect, afterEach, vi } from 'vitest';

import { DocumentStore } from '../../../../../src/components/modules/yjs/document-store';
import { YBlockSerializer } from '../../../../../src/components/modules/yjs/serializer';
import type { AwarenessChange } from '../../../../../src/components/modules/yjs/types';

const createStore = (): DocumentStore => new DocumentStore(new YBlockSerializer());

/** The private lazy Awareness field, for the "absent = zero cost" proof. */
const awarenessField = (store: DocumentStore): unknown =>
  (store as unknown as { awareness: unknown }).awareness;

/** A store's own client id (present as the single local key once enabled). */
const localClientId = (store: DocumentStore): number => {
  const [id] = Array.from(store.getAwarenessStates().keys());

  return id;
};

describe('DocumentStore awareness seam', () => {
  const stores: DocumentStore[] = [];

  const track = (store: DocumentStore): DocumentStore => {
    stores.push(store);

    return store;
  };

  afterEach(() => {
    while (stores.length > 0) {
      stores.pop()?.destroy();
    }
    vi.restoreAllMocks();
  });

  describe('lazy construction — absent = zero cost', () => {
    it('has no Awareness and schedules no timer before enableAwareness', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const store = track(createStore());

      expect(awarenessField(store)).toBeNull();
      expect(setIntervalSpy).not.toHaveBeenCalled();
    });

    it('creates the Awareness and one timer on first enable; enable is idempotent', () => {
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const store = track(createStore());

      store.enableAwareness();
      const first = awarenessField(store);

      expect(first).not.toBeNull();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);

      store.enableAwareness();

      expect(awarenessField(store)).toBe(first);
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('binary round-trip (provider face)', () => {
    it('encodes local state from store A and applies it into store B', () => {
      const a = track(createStore());
      const b = track(createStore());

      a.enableAwareness();
      b.enableAwareness();
      a.setAwarenessField('user', { name: 'Ada', color: '#abcdef' });

      const idA = localClientId(a);

      b.applyAwarenessUpdate(a.encodeAwarenessUpdate(), { provider: 'test' });

      expect(b.getAwarenessStates().get(idA)).toEqual({ user: { name: 'Ada', color: '#abcdef' } });
    });
  });

  describe('onAwarenessChange (presence face)', () => {
    it('fires with added, then updated, then removed', () => {
      const a = track(createStore());
      const b = track(createStore());

      a.enableAwareness();
      b.enableAwareness();

      const changes: AwarenessChange[] = [];

      b.onAwarenessChange((change) => changes.push(change));

      a.setAwarenessField('user', { name: 'Ada' });
      const idA = localClientId(a);

      b.applyAwarenessUpdate(a.encodeAwarenessUpdate(), 'remote');

      expect(changes.at(-1)?.added).toContain(idA);

      a.setAwarenessField('user', { name: 'Ada v2' });
      b.applyAwarenessUpdate(a.encodeAwarenessUpdate(), 'remote');

      expect(changes.at(-1)?.updated).toContain(idA);

      b.clearRemoteAwarenessStates();

      expect(changes.at(-1)?.removed).toContain(idA);
    });

    it('unsubscribe stops delivery', () => {
      const store = track(createStore());

      store.enableAwareness();

      const callback = vi.fn();
      const unsubscribe = store.onAwarenessChange(callback);

      store.setAwarenessField('user', { name: 'One' });
      expect(callback).toHaveBeenCalledTimes(1);

      unsubscribe();
      store.setAwarenessField('user', { name: 'Two' });
      expect(callback).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearRemoteAwarenessStates', () => {
    it('drops remote entries but keeps the local state', () => {
      const a = track(createStore());
      const b = track(createStore());

      a.enableAwareness();
      b.enableAwareness();
      a.setAwarenessField('user', { name: 'Ada' });
      b.setAwarenessField('user', { name: 'Bob' });

      const idA = localClientId(a);
      const idB = localClientId(b);

      b.applyAwarenessUpdate(a.encodeAwarenessUpdate(), 'remote');

      expect(b.getAwarenessStates().has(idA)).toBe(true);

      b.clearRemoteAwarenessStates();

      expect(b.getAwarenessStates().has(idA)).toBe(false);
      expect(b.getAwarenessStates().has(idB)).toBe(true);
    });
  });

  describe('pre-enable contract', () => {
    it('onAwarenessChange throws before enableAwareness', () => {
      const store = track(createStore());

      expect(() => store.onAwarenessChange(() => undefined)).toThrow(/not enabled/);
    });

    it('encodeAwarenessUpdate throws before enableAwareness', () => {
      const store = track(createStore());

      expect(() => store.encodeAwarenessUpdate()).toThrow(/not enabled/);
    });

    it('mutators and reads no-op before enableAwareness', () => {
      const store = track(createStore());

      expect(() => store.setAwarenessField('user', {})).not.toThrow();
      expect(() => store.applyAwarenessUpdate(new Uint8Array([0]), 'remote')).not.toThrow();
      expect(() => store.clearRemoteAwarenessStates()).not.toThrow();
      expect(store.getAwarenessStates().size).toBe(0);
    });
  });

  describe('destroy', () => {
    it('clears the awareness timer, nulls the field, and does not throw', () => {
      const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
      const store = createStore();

      store.enableAwareness();

      const timerId = (awarenessField(store) as { _checkInterval: unknown })._checkInterval;

      expect(() => store.destroy()).not.toThrow();
      expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
      expect(awarenessField(store)).toBeNull();
    });
  });

  describe('provider-facing subscription (onAwarenessUpdate)', () => {
    /**
     * y-protocols renews the local state every 3s with EQUAL content to keep
     * peers from pruning it (awareness.js:59-62 → setLocalState(getLocalState())).
     * setLocalState only emits 'change' when filteredUpdated is non-empty, and an
     * equal renewal is filtered out — so a 'change' subscription never sees the
     * keepalive, the provider never rebroadcasts it, and every standard peer
     * drops our presence after outdatedTimeout (30s). The provider must ride
     * 'update', which fires for renewals too.
     */
    it('delivers an equal-content renewal that onAwarenessChange filters out', () => {
      const store = track(createStore());

      store.enableAwareness();
      store.setAwarenessField('user', { name: 'Jack' });

      const onUpdate = vi.fn();
      const onChange = vi.fn();

      store.onAwarenessUpdate(onUpdate);
      store.onAwarenessChange(onChange);

      // Exactly what the keepalive does: re-set the same state.
      store.renewAwarenessForKeepalive();

      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled();
    });

    it('unsubscribes cleanly', () => {
      const store = track(createStore());

      store.enableAwareness();

      const onUpdate = vi.fn();
      const unhook = store.onAwarenessUpdate(onUpdate);

      unhook();
      store.renewAwarenessForKeepalive();

      expect(onUpdate).not.toHaveBeenCalled();
    });
  });
});
