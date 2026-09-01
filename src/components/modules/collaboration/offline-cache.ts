import * as idb from 'lib0/indexeddb';
import * as Y from 'yjs';

import type { WorkingSetTag } from './types';

/**
 * Lineage is compared by EQUALITY and must look like the server's: 32 lower-hex
 * characters. Mirrors the pattern the wire codec validates with.
 */
const LINEAGE_PATTERN = /^[0-9a-f]{32}$/;

/** The only CRDT schema these cached updates can be replayed into. */
const SUPPORTED_FORMAT = 1;

/** Rows under one lineage before they are merged into a single update. */
const DEFAULT_COMPACTION_THRESHOLD = 500;

const UPDATES_STORE = 'updates';
const META_STORE = 'meta';
const META_KEY = 'meta';

/** What a cached row carries: the bytes, and the lineage they belong to. */
interface CachedRow {
  lineage: string;
  bytes: Uint8Array;
}

/**
 * The cache's own record of the session that wrote it. `writeDenied` rides
 * along so a reload restores the member's last known write verdict instead of
 * letting them type into a document the server will refuse.
 */
export interface OfflineCacheMeta {
  format: number;
  epoch: number;
  lineage: string;
  writeDenied: boolean;
  savedAt: number;
}

/** An adoptable cache: the meta that gated it, and the updates it stored. */
export interface OfflineCacheContents {
  meta: OfflineCacheMeta;
  updates: Uint8Array[];
}

/**
 * The slice of the Web Locks API compaction needs. Injected so the caller can
 * supply one in an environment that has none — `navigator.locks` is absent in
 * jsdom and in older browsers.
 */
export interface OfflineCacheLocks {
  request: (
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void>
  ) => Promise<void>;
}

export interface OfflineCacheOptions {
  /**
   * Identifies the cached document. Server URL AND doc id: the same doc id can
   * live on two servers, and their histories are unrelated.
   */
  key: string;

  /** Rows under one lineage before compaction merges them. */
  compactionThreshold?: number;

  /** Defaults to `navigator.locks` when the environment has it. */
  locks?: OfflineCacheLocks;
}

export interface OfflineCache {
  /**
   * Opens the database and returns what is adoptable, or null. Nothing else
   * here touches storage until this has run.
   */
  open: () => Promise<OfflineCacheContents | null>;

  /** Stores one update under the current lineage. */
  append: (update: Uint8Array) => Promise<void>;

  /**
   * Records a VALIDATED control frame — the gate every adoption goes through.
   *
   * `snapshot` seeds the lineage's history in the SAME call, because rows can
   * only be stamped once the meta names a lineage: everything the document held
   * before that moment would otherwise be unstorable.
   */
  saveMeta: (tag: WorkingSetTag, writeDenied: boolean, snapshot?: Uint8Array) => Promise<void>;

  /** Drops every row and the meta. Used when the lineage changes under us. */
  clear: () => Promise<void>;

  close: () => void;
}

/**
 * Normalizes what storage hands back into update bytes yjs will accept.
 *
 * `instanceof Uint8Array` is NOT enough: a structured-clone deserializer may
 * build the view in another realm, where the constructor is a different object
 * and the check is false for a genuine byte array. Rebuilding over the same
 * buffer costs nothing and copies nothing.
 * @param value - a `bytes` field straight out of IndexedDB
 */
const toBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) {
    return value;
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  return null;
};

/**
 * Whether a stored record can be replayed into this client's document. Format
 * and lineage are both checked on the way IN and on the way OUT: another tab
 * running a different build writes into the same store.
 * @param value - the stored meta record, straight out of IndexedDB
 */
const toAdoptableMeta = (value: unknown): OfflineCacheMeta | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { format, epoch, lineage, writeDenied, savedAt } = value as Record<string, unknown>;

  if (format !== SUPPORTED_FORMAT || typeof lineage !== 'string' || !LINEAGE_PATTERN.test(lineage)) {
    return null;
  }

  return {
    format,
    epoch: typeof epoch === 'number' ? epoch : 0,
    lineage,
    writeDenied: writeDenied === true,
    savedAt: typeof savedAt === 'number' ? savedAt : 0,
  };
};

/**
 * The lock manager to compact under, or null when the environment has none.
 * @param supplied - a lock manager the caller injected
 */
const resolveLocks = (supplied: OfflineCacheLocks | undefined): OfflineCacheLocks | null => {
  if (supplied !== undefined) {
    return supplied;
  }

  const manager = typeof navigator === 'undefined'
    ? undefined
    : (navigator as Navigator & { locks?: LockManager }).locks;

  if (manager === undefined) {
    return null;
  }

  return {
    request: async (name, options, callback) => {
      await manager.request(name, options, callback);
    },
  };
};

/**
 * The collaboration offline cache: the local half of "edits made while
 * disconnected survive a reload".
 *
 * Two rules carry the whole design.
 *
 * METADATA IS THE GATE. Rows alone are never adoptable — meta is written only
 * after a control frame validated, so a session that never reached the server
 * cannot fabricate a cache that later boots EDITABLE. That is what keeps the
 * "never editable unsynced" law intact through the offline carve-out.
 *
 * EVERY ROW IS STAMPED WITH ITS LINEAGE. A reset mints a new lineage, and rows
 * from the old one are not this document's history; adoption reads only rows
 * matching the meta and sweeps the rest. Without the stamp, a tab still offline
 * on the old lineage would mix its rows into the new document.
 *
 * Every storage failure degrades to "no cache". A browser with full disk, a
 * private window, or a user who cleared site data must cost the session
 * nothing but the cache itself.
 * @param options - what to cache, and where
 */
export const createOfflineCache = (options: OfflineCacheOptions): OfflineCache => {
  const dbName = `blok-collab-${options.key}`;
  const threshold = options.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
  const locks = resolveLocks(options.locks);

  /** Mutable session state, in one place — same shape the provider uses. */
  const state: {
    db: IDBDatabase | null;
    lineage: string | null;
    rows: number;
    queue: Promise<void>;
  } = {
    db: null,
    lineage: null,
    rows: 0,
    queue: Promise.resolve(),
  };

  /**
   * Runs one write after the last, against the database handle as it was when
   * the CALLER asked — not as it is when the turn comes.
   *
   * Both halves matter. Serial, because appends stamp rows with the lineage a
   * saveMeta sets, and interleaving them would stamp a row with the wrong one.
   * Handle-at-call-time, because an editor torn down right after a sync would
   * otherwise drop the very snapshot that makes the next boot adoptable — the
   * work was already scheduled, and `close` waits for it.
   * @param work - the write to run
   */
  const enqueue = (work: (db: IDBDatabase) => Promise<void>): Promise<void> => {
    const db = state.db;

    if (db === null) {
      return Promise.resolve();
    }

    state.queue = state.queue.then(async () => {
      try {
        await work(db);
      } catch {
        // A cache that cannot write is a cache the session does without.
      }
    });

    return state.queue;
  };

  /**
   * Rows currently stored under one lineage, with their keys.
   * @param store - the updates object store to read
   * @param under - the lineage to match
   */
  const rowsUnder = async (
    store: IDBObjectStore,
    under: string
  ): Promise<{ keys: IDBValidKey[]; bytes: Uint8Array[]; strangers: IDBValidKey[] }> => {
    const keys: IDBValidKey[] = [];
    const bytes: Uint8Array[] = [];
    const strangers: IDBValidKey[] = [];

    for (const pair of await idb.getAllKeysValues(store)) {
      const key = pair.k as IDBValidKey;
      const row = pair.v as Partial<CachedRow> | null;
      const rowBytes = toBytes(row?.bytes);

      if (row?.lineage === under && rowBytes !== null) {
        keys.push(key);
        bytes.push(rowBytes);
      } else {
        strangers.push(key);
      }
    }

    return {
      keys,
      bytes,
      strangers,
    };
  };

  /**
   * Merges every row under the current lineage into one.
   *
   * The one non-idempotent sequence here — read, merge, write, delete — which
   * is why it is the only thing that takes a lock. The merged row is written
   * BEFORE the originals are deleted: a crash in between leaves a duplicate,
   * which CRDT updates absorb, while the other order loses history.
   */
  const compactUnderLock = async (): Promise<void> => {
    const current = state.lineage;

    if (state.db === null || current === null) {
      return;
    }

    const [readStore] = idb.transact(state.db, [UPDATES_STORE], 'readonly');
    const { keys, bytes } = await rowsUnder(readStore, current);

    if (bytes.length < 2) {
      state.rows = bytes.length;

      return;
    }

    const merged = Y.mergeUpdates(bytes);
    const [writeStore] = idb.transact(state.db, [UPDATES_STORE]);

    await idb.addAutoKey(writeStore, {
      lineage: current,
      bytes: merged,
    });

    const [deleteStore] = idb.transact(state.db, [UPDATES_STORE]);

    await Promise.all(keys.map((key) => idb.del(deleteStore, key)));

    state.rows = 1;
  };

  /**
   * Compacts, under the Web Lock when there is one. A lock held by another tab
   * means that tab is compacting: skipping costs nothing, because rows are only
   * ever merged, never dropped.
   */
  const compact = async (): Promise<void> => {
    if (locks === null) {
      await compactUnderLock();

      return;
    }

    await locks.request(`blok-collab-compact-${options.key}`, { ifAvailable: true }, async (lock) => {
      if (lock === null) {
        return;
      }

      await compactUnderLock();
    });
  };

  return {
    open: async () => {
      try {
        state.db = await idb.openDB(dbName, (created) => {
          idb.createStores(created, [[UPDATES_STORE, { autoIncrement: true }], [META_STORE]]);
        });
      } catch {
        state.db = null;

        return null;
      }

      try {
        const [metaStore] = idb.transact(state.db, [META_STORE], 'readonly');
        const meta = toAdoptableMeta(await idb.get(metaStore, META_KEY));

        if (meta === null) {
          return null;
        }

        const [readStore] = idb.transact(state.db, [UPDATES_STORE], 'readonly');
        const { bytes, strangers } = await rowsUnder(readStore, meta.lineage);

        if (strangers.length > 0) {
          const [sweepStore] = idb.transact(state.db, [UPDATES_STORE]);

          await Promise.all(strangers.map((key) => idb.del(sweepStore, key)));
        }

        state.lineage = meta.lineage;
        state.rows = bytes.length;

        return {
          meta,
          updates: bytes,
        };
      } catch {
        return null;
      }
    },

    append: async (update) => {
      await enqueue(async (db) => {
        const current = state.lineage;

        // No lineage means no stamp, and an unstamped row could never be
        // adopted by anyone. Writing it would only consume the user's disk.
        if (current === null) {
          return;
        }

        const [store] = idb.transact(db, [UPDATES_STORE]);

        await idb.addAutoKey(store, {
          lineage: current,
          bytes: update,
        });

        state.rows += 1;

        if (state.rows >= threshold) {
          await compact();
        }
      });
    },

    saveMeta: async (tag, writeDenied, snapshot) => {
      if (tag.format !== SUPPORTED_FORMAT || !LINEAGE_PATTERN.test(tag.lineage)) {
        state.lineage = null;

        return;
      }

      await enqueue(async (db) => {
        const [metaStore] = idb.transact(db, [META_STORE]);

        await idb.put(metaStore, {
          format: tag.format,
          epoch: tag.epoch,
          lineage: tag.lineage,
          writeDenied,
          savedAt: Date.now(),
        }, META_KEY);

        if (tag.lineage !== state.lineage) {
          state.lineage = tag.lineage;

          const [countStore] = idb.transact(db, [UPDATES_STORE], 'readonly');

          state.rows = (await rowsUnder(countStore, tag.lineage)).bytes.length;
        }

        if (snapshot === undefined) {
          return;
        }

        const [store] = idb.transact(db, [UPDATES_STORE]);

        await idb.addAutoKey(store, {
          lineage: tag.lineage,
          bytes: snapshot,
        });

        state.rows += 1;
      });
    },

    clear: async () => {
      state.rows = 0;

      await enqueue(async (db) => {
        // Nulled HERE, not before the queue: a saveMeta already queued ahead
        // of this one sets the lineage from inside its own turn, so clearing
        // it up front would let that write restore it and leave later rows
        // stamped into a store this call is about to empty.
        state.lineage = null;

        const [updatesStore, metaStore] = idb.transact(db, [UPDATES_STORE, META_STORE]);

        await idb.rtop(updatesStore.clear());
        await idb.del(metaStore, META_KEY);
      });
    },

    close: () => {
      const db = state.db;

      state.db = null;

      // Writes already scheduled still run: the last thing a session does is
      // often the snapshot that makes the next boot adoptable.
      void state.queue.then(() => db?.close());
    },
  };
};
