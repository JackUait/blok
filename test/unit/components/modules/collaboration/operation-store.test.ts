/**
 * The collaboration operation store (Wave 4): the offline cache plus the
 * durable outbox that makes an acknowledgement possible.
 *
 * The contract under test: rows are stamped with the lineage they were written
 * under and only rows matching the adoptable meta's lineage are ever adopted;
 * meta exists only after a validated control frame; every write resolves on
 * `IDBTransaction.oncomplete`, never on request success; a local edit with no
 * session throws instead of being dropped; and the outbox is never merged,
 * swept or cleared by anything the cache does.
 */
import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import * as idb from 'lib0/indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { OfflineCacheLocks } from '../../../../../src/components/modules/collaboration/offline-cache';
import {
  createOperationStore,
  type OperationStore,
  type OperationStoreOptions,
} from '../../../../../src/components/modules/collaboration/operation-store';
import type { WorkingSetTag } from '../../../../../src/components/modules/collaboration/types';

const LINEAGE_A = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const LINEAGE_B = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
const URL = 'wss://sync.test/api/sync';
const DOC = 'doc-1';
const SCOPE = 'user-7';

/** The database name the options below produce. Pinned, not derived. */
const DB_NAME = 'blok-ops-wss://sync.test/api/sync|doc-1|user-7';

/**
 * A working-set tag as a validated control frame would carry it.
 * @param lineage - the lineage to announce
 * @param overrides - tag fields to override
 */
const tagWith = (lineage: string, overrides: Partial<WorkingSetTag> = {}): WorkingSetTag => ({
  format: 1,
  epoch: 0,
  lineage,
  ...overrides,
});

/**
 * One Yjs update writing a single map entry — the smallest thing a row can
 * carry that is still observable after adoption.
 * @param key - map key the update writes
 * @param value - the value it writes
 */
const updateWith = (key: string, value: string): Uint8Array => {
  const doc = new Y.Doc();

  doc.getMap('blocks').set(key, value);

  const update = Y.encodeStateAsUpdate(doc);

  doc.destroy();

  return update;
};

/**
 * Applies adopted updates to a fresh document and returns what they built.
 * @param updates - the adopted rows
 */
const materialize = (updates: Uint8Array[]): Record<string, unknown> => {
  const doc = new Y.Doc();

  for (const update of updates) {
    Y.applyUpdate(doc, update);
  }

  const built = doc.getMap('blocks').toJSON();

  doc.destroy();

  return built;
};

/** Opens the store's own database, which a store must already have created. */
const openDatabase = async (): Promise<IDBDatabase> => idb.openDB(DB_NAME, () => undefined);

/**
 * Reads one object store whole, bypassing the module.
 * @param name - the object store to read
 */
const rowsIn = async (name: string): Promise<unknown[]> => {
  const db = await openDatabase();
  const [store] = idb.transact(db, [name], 'readonly');
  const rows: unknown[] = await idb.getAll(store);

  db.close();

  return rows;
};

/**
 * Writes an updates row straight into the store, bypassing the module — what
 * another build sharing the database, or a torn write, leaves behind.
 * @param row - the row to plant
 */
const plantUpdate = async (row: { lineage: string; bytes: Uint8Array }): Promise<void> => {
  const db = await openDatabase();
  const [store] = idb.transact(db, ['updates']);

  await idb.rtop(store.add(row));
  db.close();
};

/** Captured before any spy, so a mock can still reach the real thing. */
const originalAdd = IDBObjectStore.prototype.add;
const originalPut = IDBObjectStore.prototype.put;
const originalDelete = IDBObjectStore.prototype.delete;
const originalClear = IDBObjectStore.prototype.clear;
const originalTransaction = IDBDatabase.prototype.transaction;

/**
 * Makes every `add` against one object store throw, as a full disk would.
 * @param storeName - the object store that cannot be written
 */
const failAddsTo = (storeName: string): void => {
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey
  ) {
    if (this.name === storeName) {
      throw new DOMException('quota', 'QuotaExceededError');
    }

    return originalAdd.call(this, value, key);
  });
};

/**
 * Makes only the recovery snapshot's `add` throw, leaving the row moves alone.
 */
const failSnapshotAdd = (): void => {
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey
  ) {
    if (this.name === 'quarantine' && (value as { kind?: unknown }).kind === 'snapshot') {
      throw new DOMException('quota', 'QuotaExceededError');
    }

    return originalAdd.call(this, value, key);
  });
};

/**
 * Records the stores and mode of every transaction the module opens.
 * @param log - the list to append to
 */
const recordTransactions = (log: Array<{ stores: string[]; mode: string }>): void => {
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    this: IDBDatabase,
    names: string | Iterable<string>,
    mode?: IDBTransactionMode
  ) {
    log.push({ stores: typeof names === 'string' ? [ names ] : [ ...names ],
      mode: mode ?? 'readonly' });

    return originalTransaction.call(this, names, mode);
  });
};

/**
 * Logs when each transaction is OPENED, with its mode, and when a readwrite one
 * commits. Catches a write whose promise resolves on request success while the
 * method carries on to open its next transaction.
 * @param log - the ordered log to append to
 */
const logTransactionOrder = (log: string[]): void => {
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    this: IDBDatabase,
    names: string | Iterable<string>,
    mode?: IDBTransactionMode
  ) {
    const transaction = originalTransaction.call(this, names, mode);

    log.push(`open:${mode ?? 'readonly'}`);

    if (mode === 'readwrite') {
      transaction.addEventListener('complete', () => log.push('commit'));
    }

    return transaction;
  });
};

/**
 * Logs every readwrite transaction and the writes issued on it, in order:
 * `open`, `<store>.<op>`, `commit`.
 * @param log - the ordered log to append to
 */
const logWrites = (log: string[]): void => {
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    this: IDBDatabase,
    names: string | Iterable<string>,
    mode?: IDBTransactionMode
  ) {
    const transaction = originalTransaction.call(this, names, mode);

    if (mode === 'readwrite') {
      log.push('open');
      transaction.addEventListener('complete', () => log.push('commit'));
    }

    return transaction;
  });
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
    this: IDBObjectStore,
    value: unknown,
    key?: IDBValidKey
  ) {
    log.push(`${this.name}.add`);

    return originalAdd.call(this, value, key);
  });
  vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (
    this: IDBObjectStore,
    key: IDBValidKey | IDBKeyRange
  ) {
    log.push(`${this.name}.delete`);

    return originalDelete.call(this, key);
  });
};

/**
 * Appends to `log` the moment each transaction the module opens COMMITS, so a
 * promise that resolved on request success lands on the wrong side of it.
 * @param log - the ordered log to append to
 */
const logCommits = (log: string[]): void => {
  vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    this: IDBDatabase,
    names: string | Iterable<string>,
    mode?: IDBTransactionMode
  ) {
    const transaction = originalTransaction.call(this, names, mode);

    // Readwrite only: a readonly read commits on its own schedule and would
    // make the ordering below nondeterministic.
    if (mode === 'readwrite') {
      transaction.addEventListener('complete', () => log.push('transaction committed'));
    }

    return transaction;
  });
};

/**
 * Writes a meta record straight into the store, bypassing the module — what
 * another build sharing the database leaves behind.
 * @param value - the record to plant
 */
const plantMeta = async (value: unknown): Promise<void> => {
  const db = await openDatabase();
  const [store] = idb.transact(db, ['meta']);

  await idb.rtop(store.put(value, 'meta'));
  db.close();
};

describe('collaboration — operation store', () => {
  let factory: IDBFactory;
  const stores: OperationStore[] = [];

  /**
   * Builds a store and tracks it for teardown.
   * @param options - overrides for the store options
   */
  const storeWith = (options: Partial<OperationStoreOptions> = {}): OperationStore => {
    const store = createOperationStore({
      url: URL,
      doc: DOC,
      offlineScope: SCOPE,
      ...options,
    });

    stores.push(store);

    return store;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
  });

  afterEach(async () => {
    await Promise.all(stores.splice(0).map((store) => store.close()));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('meta-gated adoption', () => {
    it('adopts nothing from an empty store', async () => {
      const store = storeWith();

      expect(await store.open()).toBeNull();
    });

    it('never becomes adoptable from rows alone — meta is the gate', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.close();

      // A row with no meta behind it: a session that never validated a control
      // frame must not be able to fabricate an adoptable copy.
      await plantUpdate({ lineage: LINEAGE_A, bytes: updateWith('block-1', 'unsynced') });

      const reader = storeWith();

      expect(await reader.open()).toBeNull();
    });

    it('adopts meta and updates written by an earlier session', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A, { epoch: 3 }), false, 'v2');
      await writer.appendRemote(updateWith('block-1', 'first'));
      await writer.appendRemote(updateWith('block-2', 'second'));
      await writer.close();

      const reader = storeWith();
      const adopted = await reader.open();

      expect(adopted).not.toBeNull();
      expect(adopted?.meta.lineage).toBe(LINEAGE_A);
      expect(adopted?.meta.epoch).toBe(3);
      expect(adopted?.meta.format).toBe(1);
      expect(adopted?.meta.writeDenied).toBe(false);
      expect(adopted?.meta.protocol).toBe('v2');
      expect(typeof adopted?.meta.savedAt).toBe('number');
      expect(materialize(adopted?.updates ?? [])).toEqual({ 'block-1': 'first', 'block-2': 'second' });
    });

    it('remembers a write-denied member', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), true, 'v2');
      await writer.close();

      const reader = storeWith();

      expect((await reader.open())?.meta.writeDenied).toBe(true);
    });

    it('remembers the protocol the session negotiated', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v1');
      await writer.close();

      const reader = storeWith();

      expect((await reader.open())?.meta.protocol).toBe('v1');
    });

    it('refuses meta whose lineage is not 32 lower-hex characters', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.recordSession(tagWith('NOT-A-LINEAGE'), false, 'v2');

      // The tag never named a lineage, so there is no stamp to write under.
      await expect(writer.appendRemote(updateWith('block-1', 'text'))).resolves.toBeUndefined();
      await writer.close();

      const reader = storeWith();

      expect(await reader.open()).toBeNull();
    });

    it('refuses meta carrying a format this client cannot read', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A, { format: 2 }), false, 'v2');
      await writer.close();

      const reader = storeWith();

      expect(await reader.open()).toBeNull();
    });

    it('refuses meta carrying a protocol this client does not speak', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.close();

      // Routing a local edit needs a protocol this build can honour; anything
      // else would pick the wrong append path on every edit of the session.
      await plantMeta({ format: 1,
        epoch: 0,
        lineage: LINEAGE_A,
        writeDenied: false,
        protocol: 'v9',
        savedAt: 1 });

      const reader = storeWith();

      expect(await reader.open()).toBeNull();
    });
  });

  describe('lineage stamping', () => {
    it('adopts only rows stamped with the meta lineage', async () => {
      const first = storeWith();

      await first.open();
      await first.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await first.appendRemote(updateWith('block-1', 'old lineage'));
      await first.close();

      // The same database, now under a new lineage: the old row must not mix in.
      const second = storeWith();

      await second.open();
      await second.recordSession(tagWith(LINEAGE_B), false, 'v2');
      await second.appendRemote(updateWith('block-2', 'new lineage'));
      await second.close();

      const reader = storeWith();
      const adopted = await reader.open();

      expect(adopted?.meta.lineage).toBe(LINEAGE_B);
      expect(materialize(adopted?.updates ?? [])).toEqual({ 'block-2': 'new lineage' });
    });

    it('sweeps rows from other lineages at adoption', async () => {
      const first = storeWith();

      await first.open();
      await first.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await first.appendRemote(updateWith('block-1', 'old lineage'));
      await first.recordSession(tagWith(LINEAGE_B), false, 'v2');
      await first.appendRemote(updateWith('block-2', 'new lineage'));
      await first.close();

      // This adoption reads lineage B and must DELETE the lineage-A row.
      const sweeper = storeWith();

      await sweeper.open();
      // Back to lineage A: if the sweep did not happen, the old A row would
      // now be adoptable again.
      await sweeper.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await sweeper.close();

      const reader = storeWith();
      const adopted = await reader.open();

      expect(adopted?.meta.lineage).toBe(LINEAGE_A);
      expect(adopted?.updates).toEqual([]);
    });
  });

  describe('unreadable rows', () => {
    it('discards the whole copy when a row under its lineage cannot be decoded', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await writer.appendRemote(updateWith('block-1', 'good'));
      await writer.close();

      const garbage = new Uint8Array([255, 255, 255, 255, 7, 0, 3]);

      expect(() => Y.applyUpdate(new Y.Doc(), garbage)).toThrow();
      await plantUpdate({ lineage: LINEAGE_A, bytes: garbage });

      const reader = storeWith();

      expect(await reader.open()).toBeNull();
      await reader.close();

      expect(await rowsIn('updates')).toHaveLength(0);

      // Nothing is left to adopt on the next boot either: the meta went too.
      const again = storeWith();

      expect(await again.open()).toBeNull();
    });

    it('still adopts a copy whose only bad row belongs to another lineage', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await writer.appendRemote(updateWith('block-1', 'good'));
      await writer.close();

      await plantUpdate({ lineage: LINEAGE_B, bytes: new Uint8Array([255, 255, 255, 255, 7, 0, 3]) });

      const reader = storeWith();
      const adopted = await reader.open();

      expect(materialize(adopted?.updates ?? [])).toEqual({ 'block-1': 'good' });
      await reader.close();

      expect(await rowsIn('updates')).toHaveLength(1);
    });
  });

  describe('idempotent rows', () => {
    it('tolerates the same update written twice, as two tabs would', async () => {
      const writer = storeWith();
      const update = updateWith('block-1', 'once');

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await writer.appendRemote(update);
      await writer.appendRemote(update);
      await writer.close();

      const reader = storeWith();
      const adopted = await reader.open();

      expect(adopted?.updates).toHaveLength(2);
      expect(materialize(adopted?.updates ?? [])).toEqual({ 'block-1': 'once' });
    });
  });

  describe('compaction', () => {
    it('merges rows into one update at the threshold, without a lock manager', async () => {
      // jsdom has no Web Locks; this IS the feature-detect-absent branch.
      expect(navigator.locks).toBeUndefined();

      const writer = storeWith({ compactionThreshold: 3 });

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await writer.appendRemote(updateWith('block-1', 'one'));
      await writer.appendRemote(updateWith('block-2', 'two'));
      await writer.appendRemote(updateWith('block-3', 'three'));
      await writer.close();

      const reader = storeWith();
      const adopted = await reader.open();

      expect(adopted?.updates).toHaveLength(1);
      expect(materialize(adopted?.updates ?? [])).toEqual({
        'block-1': 'one',
        'block-2': 'two',
        'block-3': 'three',
      });
    });

    it('runs under the Web Lock when a lock manager exists', async () => {
      const requests: Array<{ name: string; ifAvailable: boolean }> = [];
      const locks: OfflineCacheLocks = {
        request: async (name, options, callback) => {
          requests.push({ name,
            ifAvailable: options.ifAvailable });

          return callback({});
        },
      };

      const writer = storeWith({ compactionThreshold: 2,
        locks });

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await writer.appendRemote(updateWith('block-1', 'one'));
      await writer.appendRemote(updateWith('block-2', 'two'));
      await writer.close();

      expect(requests).toHaveLength(1);
      expect(requests[0].ifAvailable).toBe(true);

      const reader = storeWith();

      expect((await reader.open())?.updates).toHaveLength(1);
    });

    it('skips compaction while another tab holds the lock, losing nothing', async () => {
      const locks: OfflineCacheLocks = {
        // What `ifAvailable: true` does when the lock is held elsewhere.
        request: async (_name, _options, callback) => callback(null),
      };

      const writer = storeWith({ compactionThreshold: 2,
        locks });

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await writer.appendRemote(updateWith('block-1', 'one'));
      await writer.appendRemote(updateWith('block-2', 'two'));
      await writer.close();

      const reader = storeWith();
      const adopted = await reader.open();

      expect(adopted?.updates).toHaveLength(2);
      expect(materialize(adopted?.updates ?? [])).toEqual({ 'block-1': 'one',
        'block-2': 'two' });
    });
  });

  describe('the session record and its snapshot', () => {
    /**
     * Meta is the adoption gate, and a meta with no snapshot behind it adopts
     * an EMPTY document as editable: the user types into nothing, and on
     * reconnect their new root blocks merge beside the real ones.
     */
    it('leaves no meta behind when the snapshot cannot be stored', async () => {
      const writer = storeWith();

      await writer.open();

      vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });

      await expect(
        writer.recordSession(tagWith(LINEAGE_A), false, 'v2', updateWith('block-1', 'first'))
      ).rejects.toThrow();
      await writer.close();

      const reader = storeWith();

      expect(await reader.open()).toBeNull();
    });
  });

  describe('clearAdoptable', () => {
    it('drops rows and meta, and a later local edit throws', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await writer.appendRemote(updateWith('block-1', 'text'));
      await writer.clearAdoptable();

      await expect(writer.appendLocal(updateWith('block-2', 'after the clear'))).rejects.toThrow();
      await writer.close();

      const reader = storeWith();

      expect(await reader.open()).toBeNull();
    });

    it('empties the store even when a session record is still queued', async () => {
      const store = storeWith();

      await store.open();

      // Not awaited, exactly as the module fires it: a lineage reset can land
      // between the record being scheduled and its turn coming round.
      const recording = store.recordSession(tagWith(LINEAGE_A), false, 'v2', updateWith('block-1', 'first'));

      await store.clearAdoptable();
      await recording;
      await expect(store.appendLocal(updateWith('block-2', 'after the clear'))).rejects.toThrow();
      await store.close();

      const reader = storeWith();

      expect(await reader.open()).toBeNull();
    });
  });

  describe('degrading storage', () => {
    it('keeps the edit in memory when indexedDB is absent, and sends nothing', async () => {
      vi.stubGlobal('indexedDB', undefined);

      const store = storeWith();

      expect(await store.open()).toBeNull();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await store.appendLocal(updateWith('block-1', 'text'));

      // Offline was asked for and could not be given: the edit is kept for
      // export, and nothing that never reached disk is handed to the drain.
      expect(await store.oldestPending()).toBeNull();
      expect((await store.stats()).pendingOperations).toBe(1);
    });

    it('reports that durable storage is unavailable when opening the database throws', async () => {
      vi.spyOn(factory, 'open').mockImplementation(() => {
        throw new Error('quota exceeded');
      });

      const store = storeWith();

      expect(await store.open()).toBeNull();

      // `open() === null` alone cannot be told apart from an empty cache, and
      // the caller has to block editing and ask for a recovery export.
      expect((await store.stats()).storageUnavailable).toBe(true);
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await expect(store.appendLocal(updateWith('block-1', 'text'))).resolves.toBeDefined();
      expect(await store.oldestPending()).toBeNull();
    });

    it('keeps every row when the lock manager itself rejects', async () => {
      const locks: OfflineCacheLocks = {
        request: async () => {
          throw new Error('locks are broken here');
        },
      };

      const writer = storeWith({ compactionThreshold: 2,
        locks });

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await writer.appendRemote(updateWith('block-1', 'one'));
      await writer.appendRemote(updateWith('block-2', 'two'));
      await writer.close();

      const reader = storeWith();
      const adopted = await reader.open();

      expect(adopted?.updates).toHaveLength(2);
      expect(materialize(adopted?.updates ?? [])).toEqual({ 'block-1': 'one',
        'block-2': 'two' });
    });

    it('touches the database only from open(), never at construction', async () => {
      const openSpy = vi.spyOn(factory, 'open');

      storeWith();

      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe('the operation identity', () => {
    it('generates one lowercase 128-bit id and never regenerates it on retry', async () => {
      const draw = vi.spyOn(globalThis.crypto, 'getRandomValues');
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      const first = await store.appendLocal(updateWith('block-1', 'one'));
      const second = await store.appendLocal(updateWith('block-2', 'two'));

      expect(first.operationId).toMatch(/^[0-9a-f]{32}$/);
      expect(second.operationId).not.toBe(first.operationId);
      expect(draw).toHaveBeenCalledWith(expect.objectContaining({ length: 16 }));

      // A retry is a re-read, not a new operation: the id the server will
      // deduplicate against must survive both the re-read and the reload.
      expect((await store.oldestPending())?.operationId).toBe(first.operationId);
      expect((await store.oldestPending())?.operationId).toBe(first.operationId);
      await store.close();

      const reloaded = storeWith();

      await reloaded.open();

      expect((await reloaded.oldestPending())?.operationId).toBe(first.operationId);
    });
  });

  describe('the local edit transaction', () => {
    it('commits cache row and outbox row in one transaction', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      failAddsTo('outbox');

      await expect(store.appendLocal(updateWith('block-1', 'one'))).rejects.toThrow();

      // The rendered edit and its receipt travel together: a cache row whose
      // outbox row was lost is an edit the document shows and never sends.
      expect(await rowsIn('updates')).toEqual([]);
      vi.restoreAllMocks();
      await store.close();

      // A fresh store, because the failure above poisoned that session for
      // good — the pairing itself is what the rest of this test is about.
      const next = storeWith();

      await next.open();
      await next.recordSession(tagWith(LINEAGE_A), false, 'v2');

      const transactions: Array<{ stores: string[]; mode: string }> = [];

      recordTransactions(transactions);
      await next.appendLocal(updateWith('block-2', 'two'));

      expect(transactions).toEqual([ { stores: [ 'updates', 'outbox' ],
        mode: 'readwrite' } ]);
    });

    it('does not resolve appendLocal before transaction completion', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      const order: string[] = [];

      logCommits(order);
      await store.appendLocal(updateWith('block-1', 'one'));
      order.push('appendLocal resolved');

      // Request success is not durability. An operation offered to the socket
      // before its transaction committed can vanish in a crash.
      expect(order).toEqual([ 'transaction committed', 'appendLocal resolved' ]);
    });

    it('recordSession orders meta before the first snapshot in one call', async () => {
      const store = storeWith();

      await store.open();

      const writes: string[] = [];
      const transactions: Array<{ stores: string[]; mode: string }> = [];

      vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey
      ) {
        writes.push(`${this.name}.put`);

        return originalPut.call(this, value, key);
      });
      vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey
      ) {
        writes.push(`${this.name}.add`);

        return originalAdd.call(this, value, key);
      });
      recordTransactions(transactions);

      await store.recordSession(tagWith(LINEAGE_A), false, 'v2', updateWith('block-1', 'first'));

      expect(writes).toEqual([ 'meta.put', 'updates.add' ]);
      expect(transactions.filter((entry) => entry.mode === 'readwrite')).toEqual([
        { stores: [ 'updates', 'meta' ],
          mode: 'readwrite' },
      ]);
    });

    it('v1 session local edit writes an updates row and no outbox row', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v1');
      await store.appendCached(updateWith('block-1', 'one'));

      // A v1 server can never acknowledge, so a row here would never drain.
      expect(await rowsIn('outbox')).toEqual([]);
      expect(await rowsIn('updates')).toHaveLength(1);
      await expect(store.appendLocal(updateWith('block-2', 'two'))).rejects.toThrow();
    });

    it('throws on a local edit made before the session names a protocol', async () => {
      const store = storeWith();

      await store.open();

      // Impossible by construction upstream — editing is blocked until a
      // handshake or an adoption names one — so it must surface, not vanish.
      await expect(store.appendLocal(updateWith('block-1', 'one'))).rejects.toThrow();
      await expect(store.appendCached(updateWith('block-1', 'one'))).rejects.toThrow();
      expect(await rowsIn('outbox')).toEqual([]);
      expect(await rowsIn('updates')).toEqual([]);
    });

    it('two tabs allocate distinct localOrder values without a lock', async () => {
      const request = vi.fn(async () => undefined);
      const locks: OfflineCacheLocks = { request };
      const tabA = storeWith({ locks });

      await tabA.open();

      const tabB = storeWith({ locks });

      await tabB.open();
      await tabA.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await tabB.recordSession(tagWith(LINEAGE_A), false, 'v2');

      const first = await tabA.appendLocal(updateWith('block-1', 'one'));
      const second = await tabB.appendLocal(updateWith('block-2', 'two'));

      expect(second.localOrder).not.toBe(first.localOrder);
      expect([ first.localOrder, second.localOrder ]).toEqual([ 1, 2 ]);
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('acknowledgement', () => {
    it('acknowledges only the exact operation id', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      const first = await store.appendLocal(updateWith('block-1', 'one'));
      const second = await store.appendLocal(updateWith('block-2', 'two'));
      const third = await store.appendLocal(updateWith('block-3', 'three'));

      await store.acknowledge(second.operationId);

      const left = (await rowsIn('outbox')).map((row) => (row as { operationId: string }).operationId);

      expect(left).toEqual([ first.operationId, third.operationId ]);
      expect((await store.oldestPending())?.operationId).toBe(first.operationId);
    });

    it('acknowledge resolves only on transaction completion and an abort keeps the row', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      const first = await store.appendLocal(updateWith('block-1', 'one'));
      const second = await store.appendLocal(updateWith('block-2', 'two'));
      const order: string[] = [];

      logCommits(order);
      await store.acknowledge(first.operationId);
      order.push('acknowledge resolved');

      expect(order).toEqual([ 'transaction committed', 'acknowledge resolved' ]);
      vi.restoreAllMocks();

      // An aborted delete leaves the row exactly where it was; reporting the
      // acknowledgement anyway would drop an operation nobody stored a receipt
      // for.
      vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(function (
        this: IDBObjectStore,
        key: IDBValidKey | IDBKeyRange
      ) {
        const request = originalDelete.call(this, key);

        this.transaction.abort();

        return request;
      });

      await expect(store.acknowledge(second.operationId)).rejects.toThrow();

      const left = (await rowsIn('outbox')).map((row) => (row as { operationId: string }).operationId);

      expect(left).toEqual([ second.operationId ]);
    });

    it('duplicate acknowledgement is a no-op', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      const only = await store.appendLocal(updateWith('block-1', 'one'));

      await store.acknowledge(only.operationId);
      await expect(store.acknowledge(only.operationId)).resolves.toBeUndefined();

      expect((await store.stats()).pendingOperations).toBe(0);
      expect(await store.oldestPending()).toBeNull();
    });
  });

  describe('the cross-tab hint', () => {
    it('a tab woken by another tab\'s onCommitted hint re-reads the oldest row', async () => {
      const tabA = storeWith();

      await tabA.open();
      await tabA.recordSession(tagWith(LINEAGE_A), false, 'v2');

      // Opened AFTER the session record, so the recorded session's own hint
      // cannot reach this channel and the append's hint is the only one left.
      const tabB = storeWith();

      await tabB.open();

      const woken = new Promise<void>((resolve) => {
        tabB.onCommitted(() => resolve());
      });
      const pending = await tabA.appendLocal(updateWith('block-1', 'one'));

      await woken;

      // The hint carries no payload: the woken tab has to go back to storage.
      expect((await tabB.oldestPending())?.operationId).toBe(pending.operationId);
    });
  });

  describe('compaction and the outbox', () => {
    it('cache compaction never touches outbox or quarantine', async () => {
      const store = storeWith({ compactionThreshold: 2 });

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      const first = await store.appendLocal(updateWith('block-1', 'one'));

      await store.appendLocal(updateWith('block-2', 'two'));

      // Merging or sweeping an outbox row destroys the receipt it is waiting
      // for; only `updates` is compactable.
      expect(await rowsIn('outbox')).toHaveLength(2);
      expect(await rowsIn('quarantine')).toEqual([]);
      expect((await store.oldestPending())?.operationId).toBe(first.operationId);
      expect(await rowsIn('updates')).toHaveLength(1);
    });

    it('boot renders cache while retaining pending rows', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v2', updateWith('block-1', 'from the server'));

      const first = await writer.appendLocal(updateWith('block-2', 'typed offline'));

      await writer.appendLocal(updateWith('block-3', 'typed offline too'));
      await writer.close();

      const reader = storeWith();
      const adopted = await reader.open();

      expect(adopted?.pendingOperations).toBe(2);
      expect(materialize(adopted?.updates ?? [])).toEqual({
        'block-1': 'from the server',
        'block-2': 'typed offline',
        'block-3': 'typed offline too',
      });
      expect((await reader.oldestPending())?.operationId).toBe(first.operationId);
    });
  });

  describe('quarantine', () => {
    it('lineage quarantine is atomic and not adoptable', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await store.appendLocal(updateWith('block-1', 'one'));
      await store.appendLocal(updateWith('block-2', 'two'));

      failAddsTo('quarantine');

      await expect(
        store.quarantineLineage(LINEAGE_A, 'read-only', updateWith('block-9', 'recovery'))
      ).rejects.toThrow();

      // A half-move strands rows in neither store.
      expect(await rowsIn('outbox')).toHaveLength(2);
      expect(await rowsIn('quarantine')).toEqual([]);
      vi.restoreAllMocks();

      // The recovery snapshot is the other half of the same move: rows that
      // left the outbox without it are rows nobody can recover.
      failSnapshotAdd();

      await expect(
        store.quarantineLineage(LINEAGE_A, 'read-only', updateWith('block-9', 'recovery'))
      ).rejects.toThrow();

      expect(await rowsIn('outbox')).toHaveLength(2);
      expect(await rowsIn('quarantine')).toEqual([]);
      vi.restoreAllMocks();

      const transactions: Array<{ stores: string[]; mode: string }> = [];

      recordTransactions(transactions);

      const moved = await store.quarantineLineage(LINEAGE_A, 'read-only', updateWith('block-9', 'recovery'));

      expect(transactions).toEqual([ { stores: [ 'outbox', 'quarantine' ],
        mode: 'readwrite' } ]);
      vi.restoreAllMocks();

      expect(moved).toBe(2);
      expect(await rowsIn('outbox')).toEqual([]);
      expect(await rowsIn('quarantine')).toHaveLength(3);
      expect((await store.stats()).quarantinedOperations).toBe(2);

      // The quarantined lineage takes no further rows: the caller records the
      // next session before editing resumes.
      await expect(store.appendLocal(updateWith('block-4', 'four'))).rejects.toThrow();
      await store.close();

      const reader = storeWith();

      // The cache half still renders; what must never come back is the queue.
      expect((await reader.open())?.pendingOperations).toBe(0);
      expect(await reader.oldestPending()).toBeNull();
    });
  });

  describe('a storage failure', () => {
    it('storage failure preserves the in-memory update and reports failure', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      failAddsTo('outbox');

      await expect(store.appendLocal(updateWith('block-1', 'one'))).rejects.toThrow();

      const stats = await store.stats();

      // The edit is already on screen: it is kept for export or recovery, and
      // never offered to the drain, because it never reached disk.
      expect(stats.pendingOperations).toBe(1);
      expect(stats.pendingBytes).toBeGreaterThan(0);
      expect(await store.oldestPending()).toBeNull();
      expect(await rowsIn('outbox')).toEqual([]);

      // The lineage went with the lost row: every later update depends on it.
      // Storage works again here, so only the poisoned session can refuse this.
      vi.restoreAllMocks();
      await expect(store.appendLocal(updateWith('block-2', 'two'))).rejects.toThrow();

      expect(await rowsIn('outbox')).toEqual([]);
    });
  });

  describe('memory mode', () => {
    it('memory mode opens no IndexedDB database', async () => {
      const openSpy = vi.spyOn(factory, 'open');
      const store = storeWith({ offlineScope: null });

      expect(await store.open()).toBeNull();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      const appending = store.appendLocal(updateWith('block-1', 'one'));
      // Read before the append settles: `saved` is impossible while one is out.
      const during = store.stats();
      const pending = await appending;

      expect((await during).appendInFlight).toBe(true);
      expect((await store.stats()).appendInFlight).toBe(false);

      // No offline scope means no consent to write this document to disk.
      // That is not a storage failure: this queue drains like any other.
      expect(openSpy).not.toHaveBeenCalled();
      expect((await store.stats()).storageUnavailable).toBe(false);
      expect((await store.oldestPending())?.operationId).toBe(pending.operationId);

      await store.acknowledge(pending.operationId);

      expect(await store.oldestPending()).toBeNull();
      expect((await store.stats()).pendingOperations).toBe(0);

      // The queue contract is the same one, including the quarantine.
      await store.appendLocal(updateWith('block-2', 'two'));

      expect(await store.quarantineLineage(LINEAGE_A, 'read-only', updateWith('block-9', 'recovery'))).toBe(1);
      expect(await store.oldestPending()).toBeNull();
      expect((await store.stats()).quarantinedOperations).toBe(1);
      expect(openSpy).not.toHaveBeenCalled();
    });
  });

  describe('the durability rule at every write', () => {
    it('every write resolves only on transaction completion, not on request success', async () => {
      const store = storeWith();

      await store.open();

      const order: string[] = [];

      logCommits(order);

      await store.recordSession(tagWith(LINEAGE_A), false, 'v1', updateWith('block-1', 'seed'));
      order.push('recordSession resolved');

      expect(order).toEqual([ 'transaction committed', 'recordSession resolved' ]);

      order.length = 0;
      await store.appendCached(updateWith('block-2', 'cached'));
      order.push('appendCached resolved');

      expect(order).toEqual([ 'transaction committed', 'appendCached resolved' ]);

      order.length = 0;
      await store.appendRemote(updateWith('block-3', 'remote'));
      order.push('appendRemote resolved');

      expect(order).toEqual([ 'transaction committed', 'appendRemote resolved' ]);

      order.length = 0;
      await store.quarantineLineage(LINEAGE_A, 'read-only', updateWith('block-4', 'recovery'));
      order.push('quarantineLineage resolved');

      expect(order).toEqual([ 'transaction committed', 'quarantineLineage resolved' ]);

      order.length = 0;
      await store.clearAdoptable();
      order.push('clearAdoptable resolved');

      expect(order).toEqual([ 'transaction committed', 'clearAdoptable resolved' ]);
    });

    it('open resolves only after its sweep, and after its discard, commits', async () => {
      const writer = storeWith();

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await writer.appendRemote(updateWith('block-1', 'good'));
      await writer.close();
      await plantUpdate({ lineage: LINEAGE_B,
        bytes: updateWith('block-2', 'stranger') });

      const sweeper = storeWith();
      const sweep: string[] = [];

      logTransactionOrder(sweep);
      await sweeper.open();

      // The sweep is durable before open() moves on to read the outbox. A
      // promise resolved on request success would open that next transaction
      // while this one is still uncommitted.
      expect(sweep.slice(-3)).toEqual([ 'open:readwrite', 'commit', 'open:readonly' ]);
      await sweeper.close();
      vi.restoreAllMocks();

      await plantUpdate({ lineage: LINEAGE_A,
        bytes: new Uint8Array([ 255, 255, 255, 255, 7, 0, 3 ]) });

      const discarder = storeWith();
      const discard: string[] = [];

      logCommits(discard);

      expect(await discarder.open()).toBeNull();
      discard.push('open resolved');

      expect(discard).toEqual([ 'transaction committed', 'open resolved' ]);
    });

    it('compaction commits the merged row before it deletes the originals', async () => {
      const store = storeWith({ compactionThreshold: 2 });

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await store.appendRemote(updateWith('block-1', 'one'));

      const log: string[] = [];

      logWrites(log);
      await store.appendRemote(updateWith('block-2', 'two'));

      // A crash between the write and the delete leaves a duplicate, which
      // CRDT updates absorb; the other order loses history outright.
      expect(log).toEqual([
        'open', 'updates.add', 'commit',
        'open', 'updates.add', 'commit',
        'open', 'updates.delete', 'updates.delete', 'commit',
      ]);
    });
  });

  describe('clearAdoptable and the queue', () => {
    it('clearAdoptable never touches the outbox or the quarantine', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      const pending = await store.appendLocal(updateWith('block-1', 'one'));

      // A quarantine of another lineage moves no rows but leaves its recovery
      // snapshot behind, so there is something in that store to protect too.
      await store.quarantineLineage(LINEAGE_B, 'read-only', updateWith('block-9', 'recovery'));
      await store.clearAdoptable();

      // This is what the reset sequence calls right after quarantineLineage:
      // dropping the queue here would drop operations the server owes a
      // receipt for.
      expect(await rowsIn('outbox')).toHaveLength(1);
      expect(await rowsIn('quarantine')).toHaveLength(1);
      expect((await store.oldestPending())?.operationId).toBe(pending.operationId);
      expect(await rowsIn('updates')).toEqual([]);
    });
  });

  describe('a poisoned session', () => {
    it('stays poisoned across the next session record, until the cache is dropped', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await store.appendLocal(updateWith('block-1', 'one'));

      failAddsTo('outbox');

      await expect(store.appendLocal(updateWith('block-2', 'two'))).rejects.toThrow();
      vi.restoreAllMocks();

      // The next validated control frame must NOT re-arm editing. Every later
      // update from this Yjs client depends on the one that was lost, and
      // `Y.decodeUpdate` validates structure, not dependencies — so nothing
      // downstream would ever notice the hole.
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      // The MESSAGE, not just a rejection: with the lineage gate in place a
      // bare rejects.toThrow() is satisfied by the null-lineage error, which
      // leaves the poison check itself pinned by nothing.
      await expect(store.appendLocal(updateWith('block-3', 'three')))
        .rejects.toThrow(/an update was lost/);

      // The other lineage restore: re-opening must not re-arm the remote path
      // onto a copy that is missing an update.
      expect(await store.open()).toBeNull();
      await expect(store.appendRemote(updateWith('block-r', 'remote'))).resolves.toBeUndefined();
      expect(await rowsIn('updates')).toHaveLength(1);
      expect(await rowsIn('outbox')).toHaveLength(1);

      // Dropping the cached copy drops the hole with it.
      await store.clearAdoptable();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await expect(store.appendLocal(updateWith('block-4', 'four'))).resolves.toBeDefined();
    });

    it('a failed cached write and a failed remote write poison it too', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v1');

      failAddsTo('updates');

      await expect(store.appendCached(updateWith('block-1', 'one'))).rejects.toThrow();
      vi.restoreAllMocks();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v1');
      await expect(store.appendCached(updateWith('block-2', 'two'))).rejects.toThrow();

      await store.clearAdoptable();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      failAddsTo('updates');

      await expect(store.appendRemote(updateWith('block-3', 'three'))).rejects.toThrow();
      vi.restoreAllMocks();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await expect(store.appendLocal(updateWith('block-4', 'four'))).rejects.toThrow();
    });

    it('a failed clearAdoptable leaves the session poisoned', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await store.appendLocal(updateWith('block-1', 'one'));

      failAddsTo('outbox');

      await expect(store.appendLocal(updateWith('block-2', 'two'))).rejects.toThrow();
      vi.restoreAllMocks();

      // The fault that failed the append is the fault that fails the recovery
      // clear: the copy is still on disk, so the poison must still stand.
      vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementationOnce(function (this: IDBObjectStore) {
        const request = originalClear.call(this);

        this.transaction.abort();

        return request;
      });

      await expect(store.clearAdoptable()).rejects.toThrow();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      await expect(store.appendLocal(updateWith('block-3', 'three'))).rejects.toThrow();
      expect(await rowsIn('outbox')).toHaveLength(1);
      expect(await rowsIn('updates')).toHaveLength(1);
    });

    it('reports the lost update in stats, so nothing has to match on a message', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      expect((await store.stats()).updateLost).toBe(false);

      failAddsTo('outbox');

      await expect(store.appendLocal(updateWith('block-1', 'one'))).rejects.toThrow();
      vi.restoreAllMocks();

      // A rejected promise is a one-shot fact; "block editing and offer a
      // recovery export" is a state the caller consults whenever it likes.
      expect((await store.stats()).updateLost).toBe(true);

      await store.clearAdoptable();

      expect((await store.stats()).updateLost).toBe(false);
    });

    it('stops caching remote updates too, and the next session record does not resume them', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await store.appendRemote(updateWith('block-1', 'one'));

      failAddsTo('updates');

      await expect(store.appendRemote(updateWith('block-2', 'two'))).rejects.toThrow();
      vi.restoreAllMocks();
      await store.appendRemote(updateWith('block-3', 'three'));

      // Rows written after the lost one depend on it, and `Y.decodeUpdate`
      // validates structure, not dependencies — an orphan row would be waved
      // through by adoption and materialise nothing.
      expect(await rowsIn('updates')).toHaveLength(1);

      // A reconnect records the session again; that must not resume them.
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await store.appendRemote(updateWith('block-4', 'four'));

      expect(await rowsIn('updates')).toHaveLength(1);
    });
  });

  describe('after close', () => {
    it('shuts the door before it drains, so an append racing the drain is refused', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');

      const inFlight = store.appendLocal(updateWith('block-1', 'one'));
      const closing = store.close();

      // `enqueue` chains on the queue close() is already awaiting, so an append
      // that slips in lands behind it — durable, and unreachable afterwards,
      // because the store it belongs to has no database any more.
      await expect(store.appendLocal(updateWith('block-2', 'two'))).rejects.toThrow();
      await inFlight;
      await closing;

      expect(await rowsIn('outbox')).toHaveLength(1);
    });

    it('refuses every append, instead of queueing one nothing can store', async () => {
      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await store.close();

      // A closed store has no database, and a store with no database is memory
      // mode — which would resolve the append and offer it to the drain.
      await expect(store.appendLocal(updateWith('block-1', 'one'))).rejects.toThrow();
      await expect(store.appendCached(updateWith('block-1', 'one'))).rejects.toThrow();
      await expect(store.appendRemote(updateWith('block-1', 'one'))).rejects.toThrow();
      expect(await rowsIn('outbox')).toEqual([]);
      expect(await store.oldestPending()).toBeNull();
    });
  });

  /**
   * The database name joins url, doc and scope with `|`. Unescaped, a `|`
   * inside a segment moves the boundary, so two different partitions produce
   * one name and share one outbox. `offlineScope` makes that a person
   * boundary, which is why the separator has to be unambiguous.
   */
  describe('the partition boundary', () => {
    /**
     * Writes an adoptable copy under one partition.
     * @param options - the partition to write under
     * @param text - what the single row carries
     */
    const seed = async (options: Partial<OperationStoreOptions>): Promise<void> => {
      const writer = storeWith(options);

      await writer.open();
      await writer.recordSession(tagWith(LINEAGE_A), false, 'v2');
      await writer.appendRemote(updateWith('block-1', 'first partition'));
      await writer.close();
    };

    it('keeps two partitions apart when a separator sits inside a segment', async () => {
      await seed({ url: 'wss://sync.test/a|b',
        doc: 'c' });

      const reader = storeWith({ url: 'wss://sync.test/a',
        doc: 'b|c' });

      expect(
        await reader.open(),
        'a `|` inside the url aliased two partitions onto one database'
      ).toBeNull();
    });

    it('keeps an escaped separator apart from a segment that spells it out', async () => {
      await seed({ url: 'wss://sync.test/a|b' });

      const reader = storeWith({ url: 'wss://sync.test/a%7Cb' });

      expect(
        await reader.open(),
        'escaping `|` before `%` aliased `a|b` onto the literal `a%7Cb`'
      ).toBeNull();
    });
  });

  describe('the legacy development database', () => {
    it('a prepopulated legacy blok-collab-* database stays untouched', async () => {
      const legacyName = `blok-collab-${URL}`;
      const legacy = await idb.openDB(legacyName, (created) => {
        idb.createStores(created, [ [ 'updates', { autoIncrement: true } ], [ 'meta' ] ]);
      });
      const [ legacyUpdates, legacyMeta ] = idb.transact(legacy, [ 'updates', 'meta' ]);

      await idb.rtop(legacyUpdates.add({ lineage: LINEAGE_A,
        bytes: updateWith('block-1', 'development era') }));
      await idb.rtop(legacyMeta.put({ format: 1,
        epoch: 0,
        lineage: LINEAGE_A,
        writeDenied: false,
        savedAt: 7 }, 'meta'));
      legacy.close();

      const store = storeWith();

      await store.open();
      await store.recordSession(tagWith(LINEAGE_B), false, 'v2');
      await store.appendLocal(updateWith('block-2', 'new era'));
      await store.clearAdoptable();
      await store.close();

      const reopened = await idb.openDB(legacyName, () => undefined);
      const [ readUpdates, readMeta ] = idb.transact(reopened, [ 'updates', 'meta' ], 'readonly');
      const survivors: unknown[] = await idb.getAll(readUpdates);
      const meta = await idb.get(readMeta, 'meta');

      reopened.close();

      // Its rows mix local and remote updates with no attribution, so nothing
      // here may read, migrate or clear them.
      expect(survivors).toHaveLength(1);
      expect(meta).toMatchObject({ lineage: LINEAGE_A,
        savedAt: 7 });
      expect((await factory.databases()).map((entry) => entry.name).sort()).toEqual([ DB_NAME, legacyName ].sort());
    });
  });
});
