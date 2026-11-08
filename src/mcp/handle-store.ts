import type { BlokMcpHandleLease, BlokMcpHandleRecord, BlokMcpHandleStore } from './options';

interface Entry {
  record: BlokMcpHandleRecord;
  lastUsed: number;
  /** The holding lease's token, or null when free. */
  holder: symbol | null;
  /** Resolved at release or removal, so the next acquire can try. */
  released: Array<() => void>;
}

const lost = (handle: string): Error => new Error(`blok-mcp handle store: the lease on ${handle} was lost`);

/**
 * The handle store contract in one process's memory, for tests and as the reference the files
 * store matches. A server without a handleStore keeps using HandleRegistry, not this. One process
 * cannot pause apart from itself, so its leases need no time limit.
 */
export const createMemoryHandleStore = (now: () => number = Date.now): BlokMcpHandleStore => {
  const entries = new Map<string, Entry>();
  const expired = (entry: Entry, idleMs: number): boolean => entry.holder === null && now() - entry.lastUsed > idleMs;
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
  const wake = (waiting: Array<() => void>): void => {
    waiting.splice(0).forEach((resolve) => resolve());
  };

  // Takes the free lease on a live handle.
  const leaseOf = (handle: string): BlokMcpHandleLease => {
    const entry = entries.get(handle);
    const token = Symbol(handle);
    const holds = (): boolean => entry !== undefined && entries.get(handle) === entry && entry.holder === token;

    if (entry === undefined) {
      throw new Error(`blok-mcp: handle ${handle} is gone`);
    }
    entry.holder = token;

    return {
      record: structuredClone(entry.record),
      save: (next) => {
        if (!holds()) {
          return Promise.reject(lost(handle));
        }
        entry.record = structuredClone(next);

        return Promise.resolve();
      },
      release: () => {
        if (holds()) {
          entry.holder = null;
          entry.lastUsed = now();
          wake(entry.released);
        }

        return Promise.resolve();
      },
      remove: () => {
        if (!holds()) {
          return Promise.reject(lost(handle));
        }
        entries.delete(handle);
        entry.holder = null;
        wake(entry.released);

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
      if (entry.holder === null) {
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
      entries.set(handle, { record: structuredClone(record), lastUsed: now(), holder: null, released: [] });

      return Promise.resolve(true);
    },
    acquire,
    sweep: (idleMs) => {
      [...entries.keys()].forEach((handle) => live(handle, idleMs));

      return Promise.resolve();
    },
  };
};
