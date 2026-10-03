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
  // One bucket per scope, so a scope switch never reads another document's values.
  const memory = new Map<string | null, Map<string, unknown>>();
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const current = { scope: options.scope };

  const memoryKey = (blockId: string, key: string): string => `${blockId}:${key}`;
  const storageKey = (id: string): string | null =>
    current.scope === null ? null : `${VIEW_STATE_PREFIX}${current.scope}:${id}`;

  const bucket = (scope: string | null): Map<string, unknown> => {
    const existing = memory.get(scope);

    if (existing !== undefined) {
      return existing;
    }

    const created = new Map<string, unknown>();

    memory.set(scope, created);

    return created;
  };

  const persist = (id: string, value: unknown): void => {
    const persisted = storageKey(id);

    if (persisted === null || storage === null) {
      return;
    }

    try {
      storage.setItem(persisted, JSON.stringify({ v: value, t: now() }));
    } catch {
      // A stale stored entry would beat the newer value held in memory.
      try {
        storage.removeItem(persisted);
      } catch {
        // Storage blocked entirely: memory already wins.
      }
    }
  };

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

    bucket(current.scope).set(id, value);
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
      const id = memoryKey(blockId, key);
      const persisted = storageKey(id);
      const entry = persisted === null ? null : readPersisted(persisted);

      return entry === null ? memory.get(current.scope)?.get(id) : entry.v;
    },
    set: (blockId, key, value) => {
      const id = memoryKey(blockId, key);

      bucket(current.scope).set(id, value);
      persist(id, value);
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
      const adopting = current.scope === null && next !== null;
      const pending = adopting ? memory.get(null) : undefined;

      current.scope = next;
      if (pending === undefined) {
        return;
      }
      // Values set before the document key was known move into the new scope.
      memory.delete(null);
      pending.forEach((value, id) => {
        bucket(next).set(id, value);
        persist(id, value);
      });
    },
    destroy: () => {
      window.removeEventListener('storage', onStorage);
      listeners.clear();
    },
  };
};
