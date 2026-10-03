export const VIEW_STATE_PREFIX = 'blok:view:';
export const VIEW_STATE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface ViewStateStore {
  get(blockId: string, key: string): unknown;
  set(blockId: string, key: string, value: unknown): void;
  /** Fires for changes made in OTHER tabs (storage event) and in this store. */
  subscribe(blockId: string, key: string, listener: (value: unknown) => void): () => void;
  /** Re-key once the document key becomes known (auto mode resolves late). */
  setScope(scope: string | null): void;
  destroy(): void;
}

interface StoredEntry { v: unknown; t: number }

const parse = (raw: string | null): StoredEntry | null => {
  if (raw === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return typeof parsed === 'object' && parsed !== null && 't' in parsed && typeof parsed.t === 'number'
      ? { v: 'v' in parsed ? parsed.v : undefined, t: parsed.t }
      : null;
  } catch {
    return null;
  }
};

const defaultStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

export const createViewStateStore = (options: {
  scope: string | null;
  storage?: Storage | null;
  now?: () => number;
}): ViewStateStore => {
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const now = options.now ?? Date.now;
  const memory = new Map<string, unknown>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const current = { scope: options.scope };

  const memoryKey = (blockId: string, key: string): string => `${blockId}:${key}`;
  const storageKey = (blockId: string, key: string): string | null =>
    current.scope === null ? null : `${VIEW_STATE_PREFIX}${current.scope}:${blockId}:${key}`;

  const notify = (id: string, value: unknown): void => {
    listeners.get(id)?.forEach((listener) => listener(value));
  };

  const sweep = (): void => {
    if (storage === null) {
      return;
    }

    try {
      // Collect first: removing while indexing shifts storage.key(i).
      const stale = Array.from({ length: storage.length }, (_, i) => storage.key(i))
        .filter((key): key is string => key !== null && key.startsWith(VIEW_STATE_PREFIX))
        .filter((key) => {
          const entry = parse(storage.getItem(key));

          return entry === null || now() - entry.t > VIEW_STATE_MAX_AGE_MS;
        });

      stale.forEach((key) => storage.removeItem(key));
    } catch {
      // Storage blocked: nothing to sweep.
    }
  };

  const onStorage = (event: StorageEvent): void => {
    const prefix = current.scope === null ? null : `${VIEW_STATE_PREFIX}${current.scope}:`;

    if (prefix === null || event.key === null || !event.key.startsWith(prefix)) {
      return;
    }

    const id = event.key.slice(prefix.length);
    const value = parse(event.newValue)?.v;

    memory.set(id, value);
    notify(id, value);
  };

  const readPersisted = (persisted: string): StoredEntry | null => {
    if (storage === null) {
      return null;
    }

    try {
      return parse(storage.getItem(persisted));
    } catch {
      return null;
    }
  };

  sweep();
  window.addEventListener('storage', onStorage);

  return {
    get: (blockId, key) => {
      const persisted = storageKey(blockId, key);
      const entry = persisted === null ? null : readPersisted(persisted);

      return entry === null ? memory.get(memoryKey(blockId, key)) : entry.v;
    },
    set: (blockId, key, value) => {
      const id = memoryKey(blockId, key);
      const persisted = storageKey(blockId, key);

      memory.set(id, value);
      if (persisted !== null && storage !== null) {
        try {
          storage.setItem(persisted, JSON.stringify({ v: value, t: now() }));
        } catch {
          // Quota or blocked storage: memory still holds it for this tab.
        }
      }
      notify(id, value);
    },
    subscribe: (blockId, key, listener) => {
      const id = memoryKey(blockId, key);
      const set = listeners.get(id) ?? new Set();

      set.add(listener);
      listeners.set(id, set);

      return () => {
        set.delete(listener);
      };
    },
    setScope: (next) => {
      current.scope = next;
    },
    destroy: () => {
      window.removeEventListener('storage', onStorage);
      listeners.clear();
    },
  };
};
