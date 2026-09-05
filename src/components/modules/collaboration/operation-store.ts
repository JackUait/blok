// lib0's `put`/`del`/`add`/`addAutoKey` helpers accept only
// `string | number | ArrayBuffer | Date` as an item and a narrower key union
// than `IDBValidKey`, so an object row does not type-check through them — the
// six TS errors `offline-cache.ts` carries. Only `openDB`, `transact` and the
// read helpers are used from lib0 here; every write goes straight to the native
// store, and every read through the typed `read` wrapper below.
import * as idb from 'lib0/indexeddb';
import * as Y from 'yjs';

import type { OfflineCacheLocks } from './offline-cache';
import type { WorkingSetTag } from './types';

/**
 * Lineage is compared by EQUALITY and must look like the server's: 32 lower-hex
 * characters. Mirrors the pattern the wire codec validates with.
 */
const LINEAGE_PATTERN = /^[0-9a-f]{32}$/;

/** The only CRDT schema these stored updates can be replayed into. */
const SUPPORTED_FORMAT = 1;

/** Rows under one lineage before they are merged into a single update. */
const DEFAULT_COMPACTION_THRESHOLD = 500;

const META_STORE = 'meta';
const UPDATES_STORE = 'updates';
const OUTBOX_STORE = 'outbox';
const QUARANTINE_STORE = 'quarantine';
const META_KEY = 'meta';
const BY_OPERATION_ID = 'by-operation-id';

/** How many random bytes an operation id carries: 128 bits. */
const OPERATION_ID_BYTES = 16;

/** Which wire protocol the last completed sync negotiated. */
export type SessionProtocol = 'v1' | 'v2';

export interface OperationStoreOptions {
  /** Canonical server URL. */
  url: string;

  /** Document id. Two servers can host the same id with unrelated histories. */
  doc: string;

  /**
   * Opaque, stable partition for the signed-in identity. `null` puts the queue
   * in memory and opens no database at all.
   */
  offlineScope: string | null;

  /** Rows under one lineage before compaction merges them. */
  compactionThreshold?: number;

  /** Defaults to `navigator.locks` when the environment has it. */
  locks?: OfflineCacheLocks;
}

/**
 * Escapes one segment of the partition name, whose parts are joined with `|`.
 *
 * `%` MUST be escaped before `|`: the other order turns `a|b` and the literal
 * `a%7Cb` into the same string, so two partitions share one database.
 * @param segment - one of the url, doc or scope parts
 */
export const escapePartitionSegment = (segment: string): string =>
  segment.replace(/%/g, '%25').replace(/\|/g, '%7C');

/**
 * The store's own record of the session that wrote it. `writeDenied` and
 * `protocol` ride along so a reload restores the member's last known write
 * verdict and routes local edits the way the server will accept them.
 */
export interface StoredSessionMeta {
  format: number;
  epoch: number;
  lineage: string;
  writeDenied: boolean;
  protocol: SessionProtocol;
  savedAt: number;
}

/** An adoptable copy: the meta that gated it, its rows, and what is still owed. */
export interface StoredDocument {
  meta: StoredSessionMeta;
  updates: Uint8Array[];
  pendingOperations: number;
}

/** One local edit waiting for its acknowledgement. */
export interface PendingOperation {
  /** 32 lowercase hex characters. */
  operationId: string;
  lineage: string;
  localOrder: number;
  bytes: Uint8Array;
  createdAt: number;
}

export interface OperationStoreStats {
  pendingOperations: number;
  pendingBytes: number;
  quarantinedOperations: number;
  appendInFlight: boolean;

  /**
   * Offline was asked for and the database could not be opened. The queue runs
   * in memory so the tab's work survives until it is exported, but nothing in
   * it is durable, so nothing in it is sendable either. False in memory mode by
   * consent (`offlineScope: null`), which drains like any other queue.
   */
  storageUnavailable: boolean;

  /**
   * A write failed after the store was open, so an update the document already
   * shows is not in the cache. Every append is refused until `clearAdoptable()`
   * has dropped the copy; the caller blocks editing and offers a recovery
   * export. A rejected append says the same thing once — this says it whenever
   * asked, and without matching on an error message.
   */
  updateLost: boolean;
}

export interface OperationStore {
  /** Opens the database and returns what is adoptable, or null. */
  open: () => Promise<StoredDocument | null>;

  /**
   * Records a VALIDATED control frame — the gate every adoption goes through.
   *
   * `snapshot` seeds the lineage's history in the SAME call, because rows can
   * only be stamped once the meta names a lineage.
   */
  recordSession: (
    tag: WorkingSetTag,
    writeDenied: boolean,
    protocol: SessionProtocol,
    snapshot?: Uint8Array
  ) => Promise<void>;

  /** Local edit on a v2 session: one transaction writes `updates` + `outbox`. */
  appendLocal: (update: Uint8Array) => Promise<PendingOperation>;

  /** Local edit on a v1 session: `updates` only, no outbox row, no receipt. */
  appendCached: (update: Uint8Array) => Promise<void>;

  /** Inbound server update: `updates` only. */
  appendRemote: (update: Uint8Array) => Promise<void>;

  oldestPending: () => Promise<PendingOperation | null>;

  /** Resolves on transaction completion; an aborted delete keeps the row. */
  acknowledge: (operationId: string) => Promise<void>;

  /**
   * One transaction: every outbox row of `lineage` plus the recovery snapshot
   * move to `quarantine`. Returns the number of quarantined outbox rows.
   */
  quarantineLineage: (lineage: string, reason: string, snapshot: Uint8Array) => Promise<number>;

  stats: () => Promise<OperationStoreStats>;

  /**
   * Payload-free hint that another tab committed a change. Listeners must
   * re-read; the hint is lossy by design.
   */
  onCommitted: (listener: () => void) => () => void;

  /** Drops `updates` and `meta`. Never touches `outbox` or `quarantine`. */
  clearAdoptable: () => Promise<void>;

  close: () => Promise<void>;
}

/** What an `updates` row carries: the bytes, and the lineage they belong to. */
interface CachedRow {
  lineage: string;
  bytes: Uint8Array;
}

/** Carries the reason a transaction was aborted out to the awaiting caller. */
interface Failure {
  error?: unknown;
}

/**
 * Normalizes what storage hands back into update bytes yjs will accept.
 *
 * `instanceof Uint8Array` is NOT enough: a structured-clone deserializer may
 * build the view in another realm, where the constructor is a different object
 * and the check is false for a genuine byte array.
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
 * Whether yjs can decode these bytes.
 *
 * A full struct walk, not `Y.mergeUpdates([bytes])`, which hands a single
 * update back untouched.
 * @param bytes - a row's bytes
 */
const isReplayable = (bytes: Uint8Array): boolean => {
  try {
    Y.decodeUpdate(bytes);

    return true;
  } catch {
    return false;
  }
};

/**
 * Whether a stored meta can be replayed into this client's document. Format,
 * lineage and protocol are all checked on the way OUT: another tab running a
 * different build writes into the same database.
 * @param value - the stored meta record, straight out of IndexedDB
 */
const toAdoptableMeta = (value: unknown): StoredSessionMeta | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { format, epoch, lineage, writeDenied, protocol, savedAt } = value as Record<string, unknown>;

  if (format !== SUPPORTED_FORMAT || typeof lineage !== 'string' || !LINEAGE_PATTERN.test(lineage)) {
    return null;
  }

  if (protocol !== 'v1' && protocol !== 'v2') {
    return null;
  }

  return {
    format,
    epoch: typeof epoch === 'number' ? epoch : 0,
    lineage,
    writeDenied: writeDenied === true,
    protocol,
    savedAt: typeof savedAt === 'number' ? savedAt : 0,
  };
};

/**
 * Rebuilds one outbox row, or null when it is not one this build wrote.
 * @param key - the row's auto-increment key, which IS its localOrder
 * @param value - the stored row
 */
const toPendingOperation = (key: IDBValidKey, value: unknown): PendingOperation | null => {
  if (typeof key !== 'number' || typeof value !== 'object' || value === null) {
    return null;
  }

  const { operationId, lineage, bytes, createdAt } = value as Record<string, unknown>;
  const payload = toBytes(bytes);

  if (typeof operationId !== 'string' || typeof lineage !== 'string' || payload === null) {
    return null;
  }

  return {
    operationId,
    lineage,
    localOrder: key,
    bytes: payload,
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
};

/** One CSPRNG-drawn 128-bit id, lowercase hex. Never regenerated on retry. */
const newOperationId = (): string => {
  const bytes = new Uint8Array(OPERATION_ID_BYTES);

  crypto.getRandomValues(bytes);

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

/** `abort()` throws once a transaction has finished or already aborted itself. */
const abortQuietly = (transaction: IDBTransaction): void => {
  try {
    transaction.abort();
  } catch {
    // Already finished: nothing left to roll back.
  }
};

/**
 * One IndexedDB read as a typed promise. lib0's `rtop` returns `Promise<any>`.
 * @param request - the request to await
 */
const read = <T>(request: IDBRequest<T>): Promise<T> => new Promise<T>((resolve, reject) => {
  request.addEventListener('success', () => resolve(request.result));
  request.addEventListener('error', () => reject(request.error ?? new Error('the IndexedDB request failed')));
});

/**
 * Runs one batch of requests and resolves when the TRANSACTION COMMITS — never
 * on request success. This is the whole durability rule: an operation that
 * resolved on request success has not reached disk, and sending it would let
 * the outbox claim work it could lose on a crash.
 *
 * `issue` creates every request synchronously — awaiting one before issuing the
 * next lets the transaction go inactive. Anything that throws on the way in (or
 * inside a cursor callback, through `fail`) aborts the batch by hand, because
 * requests already queued would otherwise still auto-commit.
 * @param transaction - the transaction the batch runs on
 * @param issue - creates the requests, in order
 */
const commitTogether = async (
  transaction: IDBTransaction,
  issue: (fail: (error: unknown) => void) => void
): Promise<void> => {
  const failure: Failure = {};
  const settled = new Promise<void>((resolve, reject) => {
    const rejectWith = (): void => {
      reject(failure.error ?? transaction.error ?? new Error('the IndexedDB transaction did not commit'));
    };

    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', rejectWith);
    transaction.addEventListener('error', rejectWith);
  });

  const fail = (error: unknown): void => {
    failure.error = error;
    abortQuietly(transaction);
  };

  try {
    issue(fail);
  } catch (error) {
    fail(error);
  }

  await settled;
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
 * The collaboration operation store: the offline cache and the durable outbox
 * that makes an exact acknowledgement possible.
 *
 * Three rules carry the design.
 *
 * METADATA IS THE GATE. Rows alone are never adoptable — meta is written only
 * after a control frame validated, so a session that never reached the server
 * cannot fabricate a copy that later boots EDITABLE.
 *
 * EVERY ROW IS STAMPED WITH ITS LINEAGE. A reset mints a new lineage, and rows
 * from the old one are not this document's history.
 *
 * A WRITE RESOLVES ON COMMIT. Every method here awaits
 * `IDBTransaction.oncomplete`, so an operation is offered for sending only once
 * it would survive a crash.
 * @param options - what to store, and where
 */
export const createOperationStore = (options: OperationStoreOptions): OperationStore => {
  const dbName = `blok-ops-${escapePartitionSegment(options.url)}|${escapePartitionSegment(options.doc)}|${escapePartitionSegment(options.offlineScope ?? '')}`;
  const threshold = options.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
  const locks = resolveLocks(options.locks);

  const state: {
    db: IDBDatabase | null;
    channel: BroadcastChannel | null;
    lineage: string | null;
    protocol: SessionProtocol | null;
    rows: number;
    memory: PendingOperation[];
    memoryOrder: number;
    memoryQuarantined: number;
    retained: PendingOperation[];
    appends: number;
    poisoned: boolean;
    storageUnavailable: boolean;
    closed: boolean;
    queue: Promise<unknown>;
    listeners: Set<() => void>;
  } = {
    db: null,
    channel: null,
    lineage: null,
    protocol: null,
    rows: 0,
    memory: [],
    memoryOrder: 0,
    memoryQuarantined: 0,
    retained: [],
    appends: 0,
    poisoned: false,
    storageUnavailable: false,
    closed: false,
    queue: Promise.resolve(),
    listeners: new Set(),
  };

  /**
   * Runs one write after the last, and hands its outcome back to the caller.
   * Serial, because appends stamp rows with the lineage a `recordSession` sets.
   * @param work - the write to run
   */
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const result = state.queue.then(work);

    state.queue = result.catch(() => undefined);

    return result;
  };

  /** Tells the other tabs that something committed. Never notifies this one. */
  const notify = (): void => {
    state.channel?.postMessage(1);
  };

  /**
   * The lineage local edits are stamped with.
   *
   * There is none only before the first sync or a cache adoption, and editing
   * is blocked until then — so this is impossible by construction upstream and
   * throws rather than dropping the edit. The old cache dropped it silently.
   */
  const requireLineage = (): string => {
    if (state.poisoned) {
      throw new Error('Blok collaboration: an update was lost, so editing stays blocked until the cache is dropped');
    }

    if (state.lineage === null) {
      throw new Error('Blok collaboration: a local edit arrived before the session named a lineage');
    }

    return state.lineage;
  };

  /** Forgets the session. Editing resumes at the next `recordSession`. */
  const dropSession = (): void => {
    state.lineage = null;
    state.protocol = null;
  };

  /**
   * A storage failure leaves a hole in the history, and the hole OUTLIVES the
   * session that made it: the lineage goes, and the next `recordSession` must
   * not bring editing back. Yjs integration needs per-client clock continuity,
   * so every later struct from this client depends on the lost one — and
   * `Y.decodeUpdate` validates structure, not dependencies, so nothing
   * downstream would ever notice. Only dropping the cached copy clears it —
   * and no later `recordSession` hands the lineage back, so the remote path,
   * which reads the lineage directly, stays shut too.
   */
  const poison = (): void => {
    dropSession();
    state.poisoned = true;
  };

  /** A closed store has no database; without this it would look like memory mode. */
  const requireOpen = (): void => {
    if (state.closed) {
      throw new Error('Blok collaboration: the operation store is closed');
    }
  };

  /**
   * Rows currently stored under one lineage, with their keys. A row under
   * another lineage is a stranger. A row under THIS lineage that yjs cannot
   * decode is reported apart: the copy it belongs to has a hole in it.
   * @param store - the updates object store to read
   * @param under - the lineage to match
   */
  const rowsUnder = async (
    store: IDBObjectStore,
    under: string
  ): Promise<{ keys: IDBValidKey[]; bytes: Uint8Array[]; strangers: IDBValidKey[]; undecodable: number }> => {
    const keys: IDBValidKey[] = [];
    const bytes: Uint8Array[] = [];
    const strangers: IDBValidKey[] = [];
    const counter = { undecodable: 0 };

    for (const pair of await idb.getAllKeysValues(store)) {
      const key = pair.k as IDBValidKey;
      const row = pair.v as Partial<CachedRow> | null;
      const rowBytes = toBytes(row?.bytes);

      if (row?.lineage !== under) {
        strangers.push(key);
      } else if (rowBytes !== null && isReplayable(rowBytes)) {
        keys.push(key);
        bytes.push(rowBytes);
      } else {
        counter.undecodable += 1;
        strangers.push(key);
      }
    }

    return {
      keys,
      bytes,
      strangers,
      undecodable: counter.undecodable,
    };
  };

  /**
   * Merges every `updates` row under the current lineage into one. Reads and
   * writes ONLY that store: an outbox row is a distinct durable operation, and
   * merging or sweeping one would destroy the receipt it is waiting for.
   *
   * The one non-idempotent sequence here — read, merge, write, delete — which
   * is why it is the only thing that takes a lock. The merged row is written
   * BEFORE the originals are deleted: a crash in between leaves a duplicate,
   * which CRDT updates absorb, while the other order loses history.
   */
  const compactUnderLock = async (): Promise<void> => {
    const current = state.lineage;
    const db = state.db;

    if (db === null || current === null) {
      return;
    }

    const [readStore] = idb.transact(db, [UPDATES_STORE], 'readonly');
    const { keys, bytes } = await rowsUnder(readStore, current);

    if (bytes.length < 2) {
      state.rows = bytes.length;

      return;
    }

    const merged = Y.mergeUpdates(bytes);
    const [writeStore] = idb.transact(db, [UPDATES_STORE]);

    await commitTogether(writeStore.transaction, () => {
      writeStore.add({
        lineage: current,
        bytes: merged,
      });
    });

    const [deleteStore] = idb.transact(db, [UPDATES_STORE]);

    await commitTogether(deleteStore.transaction, () => {
      keys.forEach((key) => deleteStore.delete(key));
    });

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

    await locks.request(`blok-ops-compact-${dbName}`, { ifAvailable: true }, async (lock) => {
      if (lock === null) {
        return;
      }

      await compactUnderLock();
    });
  };

  /** Compacts when the threshold is due. Never fails an append: rows only merge. */
  const compactIfDue = async (): Promise<void> => {
    if (state.rows < threshold) {
      return;
    }

    try {
      await compact();
    } catch {
      // Retried on the next append.
    }
  };

  /**
   * Stores one update in `updates` alone — a v1 local edit or an inbound one.
   * @param db - the open database
   * @param lineage - the stamp for the row
   * @param update - the bytes to store
   */
  const writeCacheRow = async (db: IDBDatabase, lineage: string, update: Uint8Array): Promise<void> => {
    const [store] = idb.transact(db, [UPDATES_STORE]);

    await commitTogether(store.transaction, () => {
      store.add({
        lineage,
        bytes: update,
      });
    });

    state.rows += 1;
  };

  /**
   * The cache row and the outbox row for one v2 local edit, in ONE transaction:
   * a document that renders an edit it cannot send, or sends one it cannot
   * render, is the split-brain this pairing exists to prevent.
   * @param db - the open database
   * @param operation - the operation to store, without its localOrder
   */
  const writeLocalRows = async (db: IDBDatabase, operation: PendingOperation): Promise<number> => {
    const [updatesStore, outboxStore] = idb.transact(db, [UPDATES_STORE, OUTBOX_STORE]);
    const allocated: { request: IDBRequest<IDBValidKey> | null } = { request: null };

    await commitTogether(updatesStore.transaction, () => {
      updatesStore.add({
        lineage: operation.lineage,
        bytes: operation.bytes,
      });
      allocated.request = outboxStore.add({
        operationId: operation.operationId,
        lineage: operation.lineage,
        bytes: operation.bytes,
        createdAt: operation.createdAt,
      });
    });

    state.rows += 1;

    const key = allocated.request?.result;

    return typeof key === 'number' ? key : 0;
  };

  /**
   * Every outbox row, oldest first. The auto-increment key IS `localOrder`, so
   * two tabs allocate distinct values with no lock, leader or lease.
   * @param db - the open database
   */
  const outboxRows = async (db: IDBDatabase): Promise<PendingOperation[]> => {
    const [store] = idb.transact(db, [OUTBOX_STORE], 'readonly');
    const pairs = await idb.getAllKeysValues(store);
    const rows: PendingOperation[] = [];

    for (const pair of pairs) {
      const row = toPendingOperation(pair.k as IDBValidKey, pair.v);

      if (row !== null) {
        rows.push(row);
      }
    }

    return rows;
  };

  return {
    open: async () => {
      if (options.offlineScope === null) {
        return null;
      }

      // The only other lineage restore. Re-opening a poisoned store would hand
      // the lineage back and reopen the remote path onto a copy missing an
      // update — the door `recordSession`'s gate closes, reached the other way.
      if (state.poisoned) {
        return null;
      }

      try {
        state.db = await idb.openDB(dbName, (created) => {
          created.createObjectStore(META_STORE);
          created.createObjectStore(UPDATES_STORE, { autoIncrement: true });
          created
            .createObjectStore(OUTBOX_STORE, { autoIncrement: true })
            .createIndex(BY_OPERATION_ID, 'operationId');
          created.createObjectStore(QUARANTINE_STORE, { autoIncrement: true });
        });
      } catch {
        // No database means no durability, but the queue still runs in memory:
        // an edit the user already made must not be dropped on the floor. The
        // caller asked for offline and cannot have it, so it is told — a null
        // here is otherwise indistinguishable from an empty cache.
        state.db = null;
        state.storageUnavailable = true;

        return null;
      }

      if (typeof BroadcastChannel !== 'undefined') {
        state.channel = new BroadcastChannel(dbName);
        state.channel.onmessage = () => state.listeners.forEach((listener) => listener());
      }

      try {
        const [metaStore] = idb.transact(state.db, [META_STORE], 'readonly');
        const meta = toAdoptableMeta(await read(metaStore.get(META_KEY) as IDBRequest<unknown>));

        if (meta === null) {
          return null;
        }

        const [readStore] = idb.transact(state.db, [UPDATES_STORE], 'readonly');
        const { bytes, strangers, undecodable } = await rowsUnder(readStore, meta.lineage);

        // A row of this copy that will not decode means the copy is not whole.
        // Adopting the rest would boot a document with a hole in it — an empty
        // one, when the hole is the snapshot — as editable. The outbox is left
        // alone: those rows are still operations the server owes a receipt for.
        if (undecodable > 0) {
          const [updatesStore, metaWriteStore] = idb.transact(state.db, [UPDATES_STORE, META_STORE]);

          await commitTogether(updatesStore.transaction, () => {
            updatesStore.clear();
            metaWriteStore.delete(META_KEY);
          });

          return null;
        }

        if (strangers.length > 0) {
          const [sweepStore] = idb.transact(state.db, [UPDATES_STORE]);

          await commitTogether(sweepStore.transaction, () => {
            strangers.forEach((key) => sweepStore.delete(key));
          });
        }

        const pending = (await outboxRows(state.db)).filter((row) => row.lineage === meta.lineage);

        state.lineage = meta.lineage;
        state.protocol = meta.protocol;
        state.rows = bytes.length;

        return {
          meta,
          updates: bytes,
          pendingOperations: pending.length,
        };
      } catch {
        return null;
      }
    },

    recordSession: async (tag, writeDenied, protocol, snapshot) => {
      await enqueue(async () => {
        // Inside the queue like every other state write: a rejected tag must
        // not null the lineage from under an append already queued ahead.
        if (tag.format !== SUPPORTED_FORMAT || !LINEAGE_PATTERN.test(tag.lineage)) {
          dropSession();

          return;
        }

        const db = state.db;

        if (db === null) {
          state.lineage = tag.lineage;
          state.protocol = protocol;

          return;
        }

        // Counted up front, on its own transaction: the write below must not
        // await anything between its requests.
        const [countStore] = idb.transact(db, [UPDATES_STORE], 'readonly');
        const rows = tag.lineage === state.lineage
          ? state.rows
          : (await rowsUnder(countStore, tag.lineage)).bytes.length;

        const [updatesStore, metaStore] = idb.transact(db, [UPDATES_STORE, META_STORE]);

        try {
          // Meta first, then the snapshot, in one transaction. Meta is the
          // adoption gate, and a meta with no snapshot behind it would adopt an
          // EMPTY document as editable.
          await commitTogether(metaStore.transaction, () => {
            metaStore.put({
              format: tag.format,
              epoch: tag.epoch,
              lineage: tag.lineage,
              writeDenied,
              protocol,
              savedAt: Date.now(),
            }, META_KEY);

            if (snapshot !== undefined) {
              updatesStore.add({
                lineage: tag.lineage,
                bytes: snapshot,
              });
            }
          });
        } catch (error) {
          dropSession();
          throw error;
        }

        state.rows = rows + (snapshot === undefined ? 0 : 1);
        notify();

        // A poisoned store takes no lineage back. The meta above is still the
        // server's own word and worth recording, but every write path here
        // stamps rows with this lineage, and there is nothing left to stamp
        // onto: `appendRemote` reads it directly, so without this a reconnect
        // would resume stacking remote rows onto a copy with a gap in it.
        if (state.poisoned) {
          return;
        }

        state.lineage = tag.lineage;
        state.protocol = protocol;
      });
    },

    appendLocal: async (update) => {
      requireOpen();
      state.appends += 1;

      try {
        return await enqueue(async () => {
          const lineage = requireLineage();

          if (state.protocol !== 'v2') {
            throw new Error('Blok collaboration: a v2 operation was appended on a session that is not v2');
          }

          const operation: PendingOperation = {
            operationId: newOperationId(),
            lineage,
            localOrder: 0,
            bytes: update,
            createdAt: Date.now(),
          };
          const db = state.db;

          if (db === null) {
            state.memoryOrder += 1;
            operation.localOrder = state.memoryOrder;
            state.memory.push(operation);

            return operation;
          }

          try {
            operation.localOrder = await writeLocalRows(db, operation);
          } catch (error) {
            // The edit is already visible in the document, so it is kept here
            // for export or recovery — but it is never handed to the drain,
            // because it did not reach disk.
            state.retained.push(operation);
            poison();
            throw error;
          }

          notify();
          await compactIfDue();

          return operation;
        });
      } finally {
        state.appends -= 1;
      }
    },

    appendCached: async (update) => {
      requireOpen();
      state.appends += 1;

      try {
        await enqueue(async () => {
          const lineage = requireLineage();
          const db = state.db;

          if (db === null) {
            return;
          }

          try {
            await writeCacheRow(db, lineage, update);
          } catch (error) {
            poison();
            throw error;
          }

          notify();
          await compactIfDue();
        });
      } finally {
        state.appends -= 1;
      }
    },

    appendRemote: async (update) => {
      requireOpen();

      await enqueue(async () => {
        const lineage = state.lineage;
        const db = state.db;

        // Unlike a local edit, an inbound update legitimately arrives with no
        // lineage — between a reset and the control frame that names the next
        // one — and there is nothing to stamp it with.
        if (lineage === null || db === null) {
          return;
        }

        try {
          await writeCacheRow(db, lineage, update);
        } catch (error) {
          poison();
          throw error;
        }

        await compactIfDue();
      });
    },

    oldestPending: async () => {
      // Kept in memory for export, never handed to the drain: none of it
      // reached disk, and the drain's whole contract is that it did.
      if (state.storageUnavailable) {
        return null;
      }

      const db = state.db;

      if (db === null) {
        return state.memory[0] ?? null;
      }

      const [store] = idb.transact(db, [OUTBOX_STORE], 'readonly');
      const cursor = await read(store.openCursor());

      if (cursor === null) {
        return null;
      }

      return toPendingOperation(cursor.key, cursor.value);
    },

    acknowledge: async (operationId) => {
      await enqueue(async () => {
        const db = state.db;

        if (db === null) {
          state.memory = state.memory.filter((row) => row.operationId !== operationId);

          return;
        }

        const [store] = idb.transact(db, [OUTBOX_STORE]);

        await commitTogether(store.transaction, (fail) => {
          // The delete is issued from the lookup's own success handler: an
          // `await` between the two would let the transaction go inactive.
          const lookup = store.index(BY_OPERATION_ID).getKey(operationId);

          lookup.onsuccess = () => {
            try {
              const key = lookup.result;

              // An acknowledgement for a row another tab already deleted is a
              // no-op, not a failure.
              if (key !== undefined) {
                store.delete(key);
              }
            } catch (error) {
              fail(error);
            }
          };
        });

        notify();
      });
    },

    quarantineLineage: async (lineage, reason, snapshot) => enqueue(async () => {
      // A quarantined lineage can take no further rows; the caller records the
      // next session before editing resumes.
      if (state.lineage === lineage) {
        dropSession();
      }

      const db = state.db;

      if (db === null) {
        const moved = state.memory.filter((row) => row.lineage === lineage).length;

        state.memory = state.memory.filter((row) => row.lineage !== lineage);
        state.memoryQuarantined += moved;

        return moved;
      }

      const [outboxStore, quarantineStore] = idb.transact(db, [OUTBOX_STORE, QUARANTINE_STORE]);
      const quarantinedAt = Date.now();
      const counter = { moved: 0 };

      await commitTogether(outboxStore.transaction, (fail) => {
        const walk = outboxStore.openCursor();

        walk.onsuccess = () => {
          try {
            const cursor = walk.result;

            if (cursor === null) {
              // The recovery snapshot rides the SAME transaction as the rows it
              // is the recovery for: a snapshot without them, or them without
              // it, is an unrecoverable half-move.
              quarantineStore.add({
                kind: 'snapshot',
                lineage,
                reason,
                bytes: snapshot,
                quarantinedAt,
              });

              return;
            }

            const row = toPendingOperation(cursor.key, cursor.value);

            if (row !== null && row.lineage === lineage) {
              quarantineStore.add({
                kind: 'operation',
                lineage,
                reason,
                operationId: row.operationId,
                localOrder: row.localOrder,
                bytes: row.bytes,
                quarantinedAt,
              });
              cursor.delete();
              counter.moved += 1;
            }

            cursor.continue();
          } catch (error) {
            fail(error);
          }
        };
      });

      notify();

      return counter.moved;
    }),

    stats: async () => {
      const db = state.db;
      const retainedBytes = state.retained.reduce((total, row) => total + row.bytes.byteLength, 0);

      if (db === null) {
        return {
          pendingOperations: state.memory.length + state.retained.length,
          pendingBytes: state.memory.reduce((total, row) => total + row.bytes.byteLength, 0) + retainedBytes,
          quarantinedOperations: state.memoryQuarantined,
          appendInFlight: state.appends > 0,
          storageUnavailable: state.storageUnavailable,
          updateLost: state.poisoned,
        };
      }

      const pending = await outboxRows(db);
      const [quarantineStore] = idb.transact(db, [QUARANTINE_STORE], 'readonly');
      const quarantined: unknown[] = await idb.getAll(quarantineStore);

      return {
        pendingOperations: pending.length + state.retained.length,
        pendingBytes: pending.reduce((total, row) => total + row.bytes.byteLength, 0) + retainedBytes,
        quarantinedOperations: quarantined.filter(
          (row) => (row as { kind?: unknown } | null)?.kind === 'operation'
        ).length,
        appendInFlight: state.appends > 0,
        storageUnavailable: state.storageUnavailable,
        updateLost: state.poisoned,
      };
    },

    onCommitted: (listener) => {
      state.listeners.add(listener);

      return () => state.listeners.delete(listener);
    },

    clearAdoptable: async () => {
      await enqueue(async () => {
        // Reset HERE, not before the queue: a recordSession already queued
        // ahead of this one sets the lineage from inside its own turn, so
        // clearing it up front would let that write restore it and leave later
        // rows stamped into a store this call is about to empty.
        dropSession();
        state.rows = 0;

        const db = state.db;

        if (db === null) {
          // Nothing was on disk, so there is no copy left to block editing on.
          state.poisoned = false;

          return;
        }

        const [updatesStore, metaStore] = idb.transact(db, [UPDATES_STORE, META_STORE]);

        await commitTogether(updatesStore.transaction, () => {
          updatesStore.clear();
          metaStore.delete(META_KEY);
        });

        // ONLY here: this is the call the caller makes to recover from a lost
        // write, and the fault that lost it is the fault that fails this clear.
        // Clearing the poison above the transaction would announce that the
        // copy is gone while it is still on disk — and then editing resumes on
        // it and the next operation, which depends on the lost one, is sent.
        state.poisoned = false;
        notify();
      });
    },

    close: async () => {
      // Shut first, drain second: writes already scheduled still run — the last
      // thing a session does is often the snapshot that makes the next boot
      // adoptable — but nothing new joins them.
      state.closed = true;

      await state.queue.catch(() => undefined);

      const db = state.db;
      const channel = state.channel;

      state.db = null;
      state.channel = null;
      state.listeners.clear();

      db?.close();
      channel?.close();
    },
  };
};
