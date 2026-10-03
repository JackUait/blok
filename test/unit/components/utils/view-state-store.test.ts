import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewStateStore, VIEW_STATE_MAX_AGE_MS } from '../../../../src/components/utils/view-state-store';

describe('ViewStateStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns undefined when nothing was stored', () => {
    expect(createViewStateStore({ scope: 'd' }).get('b1', 'open')).toBeUndefined();
  });

  it('persists a value under the document scope', () => {
    createViewStateStore({ scope: 'd' }).set('b1', 'open', true);

    expect(createViewStateStore({ scope: 'd' }).get('b1', 'open')).toBe(true);
    expect(createViewStateStore({ scope: 'other' }).get('b1', 'open')).toBeUndefined();
  });

  it('keeps state in memory only without a scope', () => {
    const store = createViewStateStore({ scope: null });

    store.set('b1', 'open', true);

    expect(store.get('b1', 'open')).toBe(true);
    expect(localStorage.length).toBe(0);
  });

  it('falls back to memory when storage throws', () => {
    const broken: Storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => undefined,
      key: () => null,
      clear: () => undefined,
      length: 0,
    };
    const store = createViewStateStore({ scope: 'd', storage: broken });

    store.set('b1', 'open', true);

    expect(store.get('b1', 'open')).toBe(true);
  });

  it('notifies subscribers about another tab writing the key', () => {
    const store = createViewStateStore({ scope: 'd' });
    const listener = vi.fn();

    store.subscribe('b1', 'open', listener);
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'blok:view:d:b1:open',
      newValue: JSON.stringify({ v: true, t: 1 }),
      storageArea: localStorage,
    }));

    expect(listener).toHaveBeenCalledWith(true);
  });

  it('drops entries older than the max age on creation', () => {
    localStorage.setItem('blok:view:d:old:open', JSON.stringify({ v: true, t: 0 }));
    createViewStateStore({ scope: 'd', now: () => VIEW_STATE_MAX_AGE_MS + 1 });

    expect(localStorage.getItem('blok:view:d:old:open')).toBeNull();
  });

  it('stops listening after destroy', () => {
    const store = createViewStateStore({ scope: 'd' });
    const listener = vi.fn();

    store.subscribe('b1', 'open', listener);
    store.destroy();
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'blok:view:d:b1:open',
      newValue: JSON.stringify({ v: true, t: 1 }),
      storageArea: localStorage,
    }));

    expect(listener).not.toHaveBeenCalled();
  });
});
