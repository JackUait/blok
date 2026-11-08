import type { BlokMcpHandleLease, BlokMcpHandleRecord, BlokMcpHandleStore } from './options';

interface Entry {
  record: BlokMcpHandleRecord;
  lastUsed: number;
  leased: boolean;
  /** Resolved at release, so the next acquire can try. */
  released: Array<() => void>;
}

/**
 * The handle store contract in one process's memory, for tests and as the reference the files
 * store matches. A server without a handleStore keeps using HandleRegistry, not this.
 */
export const createMemoryHandleStore = (now: () => number = Date.now): BlokMcpHandleStore => {
  const entries = new Map<string, Entry>();
  const expired = (entry: Entry, idleMs: number): boolean => !entry.leased && now() - entry.lastUsed > idleMs;
  const live = (handle: string, idleMs: number): Entry | undefined => {
    const entry = entries.get(handle);

    if (entry !== undefined && expired(entry, idleMs)) {
      entries.delete(handle);

      return undefined;
    }

    return entry;
  };
  const count = (principal: string, idleMs: number): number =>
    [...entries.keys()].filter((handle) => live(handle, idleMs)?.record.principal === principal).length;

  const leaseOf = (handle: string): BlokMcpHandleLease => {
    const entry = entries.get(handle);
    const held = { released: false };

    if (entry === undefined) {
      throw new Error(`blok-mcp: handle ${handle} is gone`);
    }

    return {
      record: structuredClone(entry.record),
      save: (next) => {
        if (held.released || entries.get(handle) !== entry) {
          return Promise.resolve();
        }
        entry.record = structuredClone(next);

        return Promise.resolve();
      },
      release: () => {
        if (!held.released) {
          held.released = true;
          entry.leased = false;
          entry.lastUsed = now();
          entry.released.splice(0).forEach((wake) => wake());
        }

        return Promise.resolve();
      },
    };
  };

  const acquire = async (handle: string, idleMs: number, timeoutMs: number): Promise<BlokMcpHandleLease | 'unknown' | 'busy'> => {
    const deadline = now() + timeoutMs;

    for (;;) {
      const entry = live(handle, idleMs);

      if (entry === undefined) {
        return 'unknown';
      }
      if (!entry.leased) {
        entry.leased = true;

        return leaseOf(handle);
      }
      const left = deadline - now();

      if (left <= 0) {
        return 'busy';
      }
      const timer: { id?: ReturnType<typeof setTimeout> } = {};

      await new Promise<void>((resolve) => {
        entry.released.push(resolve);
        timer.id = setTimeout(resolve, left);
      });
      clearTimeout(timer.id);
    }
  };

  return {
    count: (principal, idleMs) => Promise.resolve(count(principal, idleMs)),
    tryAdd: (handle, record, maxPerPrincipal, idleMs) => {
      if (entries.has(handle)) {
        return Promise.reject(new Error(`blok-mcp: handle ${handle} is taken`));
      }
      if (count(record.principal, idleMs) >= maxPerPrincipal) {
        return Promise.resolve(false);
      }
      entries.set(handle, { record: structuredClone(record), lastUsed: now(), leased: false, released: [] });

      return Promise.resolve(true);
    },
    acquire,
    remove: (handle) => {
      entries.delete(handle);

      return Promise.resolve();
    },
  };
};
