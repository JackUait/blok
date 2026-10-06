import { IDBFactory } from 'fake-indexeddb';
import * as idb from 'lib0/indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createOperationStore,
  type OperationStore,
} from '../../../../../src/components/modules/collaboration/operation-store';
import {
  forgetOfflinePartitions,
  forgetOfflineScope,
  inspectOfflineScope,
} from '../../../../../src/components/modules/collaboration/offline-scope';
import type { WorkingSetTag } from '../../../../../src/components/modules/collaboration/types';

const LINEAGE_A = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const LINEAGE_B = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
const URL_A = 'wss://first.test/sync';
const URL_B = 'wss://second.test/sync';
const SCOPE_A = 'user-a';
const SCOPE_B = 'user-b';
const DB_A = 'blok-ops-wss://first.test/sync|same-id|user-a';
const DB_A_SECOND = 'blok-ops-wss://second.test/sync|other-id|user-a';

const tagWith = (lineage: string): WorkingSetTag => ({
  format: 1,
  epoch: 0,
  lineage,
});

describe('collaboration — offline scope', () => {
  let factory: IDBFactory;
  const stores: OperationStore[] = [];
  const handles: IDBDatabase[] = [];

  const storeWith = async (url: string, doc: string, scope: string): Promise<OperationStore> => {
    const store = createOperationStore({ url, doc, offlineScope: scope });

    stores.push(store);
    await store.open();

    return store;
  };

  const closeStores = async (): Promise<void> => {
    await Promise.all(stores.splice(0).map((store) => store.close()));
  };

  const createDatabase = async (name: string): Promise<void> => {
    const db = await idb.openDB(name, () => undefined);

    db.close();
  };

  const replaceMeta = async (name: string, value: unknown): Promise<void> => {
    const db = await idb.openDB(name, () => undefined);
    const transaction = db.transaction('meta', 'readwrite');
    const committed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    transaction.objectStore('meta').put(value, 'meta');
    await committed;
    db.close();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
  });

  afterEach(async () => {
    await closeStores();
    handles.splice(0).forEach((db) => db.close());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports every store and forgets only the selected identity after explicit discard', async () => {
    const first = await storeWith(URL_A, 'same-id', SCOPE_A);

    await first.recordSession(tagWith(LINEAGE_A), false, 'v2');
    await first.appendLocal(new Uint8Array([0, 0]));
    await first.quarantineLineage(LINEAGE_A, 'reset', new Uint8Array([8, 9, 10, 11]));
    await first.recordSession(tagWith(LINEAGE_B), false, 'v2');
    await first.appendLocal(new Uint8Array([4, 5]));

    const second = await storeWith(URL_B, 'other-id', SCOPE_A);

    await second.recordSession(tagWith(LINEAGE_A), false, 'v1');
    await second.appendCached(new Uint8Array([1, 2, 3, 4, 5, 6]));

    const otherUser = await storeWith(URL_A, 'same-id', SCOPE_B);

    await otherUser.recordSession(tagWith(LINEAGE_A), false, 'v2');
    await otherUser.appendLocal(new Uint8Array([1]));

    await closeStores();

    const report = await inspectOfflineScope(SCOPE_A);

    expect(report.partitions).toHaveLength(2);
    expect(report.partitions).toContainEqual({
      url: URL_A,
      doc: 'same-id',
      outbox: { count: 1, bytes: 2 },
      quarantine: { count: 2, bytes: 6 },
      updates: { count: 2, bytes: 4 },
      mayHaveUnsentV1Edits: false,
    });
    expect(report.partitions).toContainEqual({
      url: URL_B,
      doc: 'other-id',
      outbox: { count: 0, bytes: 0 },
      quarantine: { count: 0, bytes: 0 },
      updates: { count: 1, bytes: 6 },
      mayHaveUnsentV1Edits: true,
    });

    await expect(forgetOfflineScope(SCOPE_A, { discardPending: true }))
      .resolves.toEqual({ deletedPartitions: 2, discarded: report });
    expect((await inspectOfflineScope(SCOPE_A)).partitions).toEqual([]);
    expect((await inspectOfflineScope(SCOPE_B)).partitions).toHaveLength(1);
    expect((await factory.databases()).map(({ name }) => name)).not.toContain(DB_A);
    expect((await factory.databases()).map(({ name }) => name)).not.toContain(DB_A_SECOND);
  });

  it('rejects a missing or false discard decision without deleting pending work', async () => {
    const store = await storeWith(URL_A, 'same-id', SCOPE_A);

    await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
    await store.appendLocal(new Uint8Array([1, 2, 3]));
    await closeStores();

    await expect(forgetOfflineScope(SCOPE_A, undefined as unknown as { discardPending: true }))
      .rejects.toThrow(/discardPending/);
    await expect(forgetOfflineScope(SCOPE_A, { discardPending: false } as unknown as { discardPending: true }))
      .rejects.toThrow(/discardPending/);
    expect((await inspectOfflineScope(SCOPE_A)).partitions[0]?.outbox).toEqual({ count: 1, bytes: 3 });
  });

  it('keeps outbox and quarantine after clearAdoptable, then forgets the whole partition', async () => {
    const store = await storeWith(URL_A, 'same-id', SCOPE_A);

    await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
    await store.appendLocal(new Uint8Array([0, 0]));
    await store.quarantineLineage(LINEAGE_A, 'reset', new Uint8Array([3, 4, 5]));
    await store.recordSession(tagWith(LINEAGE_B), false, 'v2');
    await store.appendLocal(new Uint8Array([6, 7, 8, 9]));
    await store.clearAdoptable();
    await closeStores();

    expect((await inspectOfflineScope(SCOPE_A)).partitions[0]).toMatchObject({
      outbox: { count: 1, bytes: 4 },
      quarantine: { count: 2, bytes: 5 },
      updates: { count: 0, bytes: 0 },
    });

    await forgetOfflineScope(SCOPE_A, { discardPending: true });
    expect((await inspectOfflineScope(SCOPE_A)).partitions).toEqual([]);
  });

  it('flags cached updates with unknown metadata as possibly unsent v1 edits', async () => {
    const store = await storeWith(URL_A, 'same-id', SCOPE_A);

    await store.recordSession(tagWith(LINEAGE_A), false, 'v2');
    await store.appendCached(new Uint8Array([1, 2]));
    await closeStores();
    await replaceMeta(DB_A, { format: 99, protocol: 'v2' });

    expect((await inspectOfflineScope(SCOPE_A)).partitions[0]).toMatchObject({
      updates: { count: 1, bytes: 2 },
      mayHaveUnsentV1Edits: true,
    });
  });

  it('selectively forgets a document within one scope', async () => {
    await storeWith(URL_A, 'same-id', SCOPE_A);
    await storeWith(URL_B, 'other-id', SCOPE_A);
    await closeStores();

    await expect(forgetOfflinePartitions(
      SCOPE_A,
      (partition) => partition.doc === 'same-id',
      { discardPending: true }
    )).resolves.toMatchObject({
      deletedPartitions: 1,
      discarded: { partitions: [{ url: URL_A, doc: 'same-id' }] },
    });
    expect((await inspectOfflineScope(SCOPE_A)).partitions).toMatchObject([
      { url: URL_B, doc: 'other-id' },
    ]);
  });

  it('rejects when database enumeration is unavailable before deleting anything', async () => {
    await storeWith(URL_A, 'same-id', SCOPE_A);
    await closeStores();

    const deleteDatabase = vi.spyOn(factory, 'deleteDatabase');

    Object.defineProperty(factory, 'databases', { configurable: true, value: undefined });

    await expect(inspectOfflineScope(SCOPE_A)).rejects.toThrow(/databases/);
    await expect(forgetOfflineScope(SCOPE_A, { discardPending: true })).rejects.toThrow(/databases/);
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it('waits for a blocked deletion to finish before reporting its result', async () => {
    await storeWith(URL_A, 'same-id', SCOPE_A);
    await closeStores();

    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(DB_A);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    handles.push(held);
    const originalDelete = factory.deleteDatabase.bind(factory);
    let onBlocked: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { onBlocked = resolve; });

    vi.spyOn(factory, 'deleteDatabase').mockImplementation((name) => {
      const request = originalDelete(name);

      request.addEventListener('blocked', () => onBlocked?.());

      return request;
    });

    const forgetting = forgetOfflineScope(SCOPE_A, { discardPending: true });
    const result = expect(forgetting).resolves.toMatchObject({ deletedPartitions: 1 });
    let settled = false;

    void forgetting.then(() => { settled = true; }, () => { settled = true; });
    await blocked;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    held.close();
    await result;
    expect((await factory.databases()).map(({ name }) => name)).not.toContain(DB_A);
  });

  it('rejects a delete request error without reporting success', async () => {
    await storeWith(URL_A, 'same-id', SCOPE_A);
    await closeStores();

    const request = new EventTarget();

    Object.defineProperty(request, 'error', { value: new DOMException('permission denied', 'UnknownError') });
    vi.spyOn(factory, 'deleteDatabase').mockImplementation(() => {
      queueMicrotask(() => request.dispatchEvent(new Event('error')));

      return request as unknown as IDBOpenDBRequest;
    });

    await expect(forgetOfflineScope(SCOPE_A, { discardPending: true }))
      .rejects.toThrow(/permission denied/);
    expect((await inspectOfflineScope(SCOPE_A)).partitions).toHaveLength(1);
  });

  it('rejects partial deletion and names the databases already deleted', async () => {
    await storeWith(URL_A, 'same-id', SCOPE_A);
    await storeWith(URL_B, 'other-id', SCOPE_A);
    await closeStores();

    const originalDelete = factory.deleteDatabase.bind(factory);
    const deleted: string[] = [];

    vi.spyOn(factory, 'deleteDatabase').mockImplementation((name) => {
      if (deleted.length > 0) {
        throw new Error('injected delete failure');
      }

      deleted.push(name);

      return originalDelete(name);
    });

    await expect(forgetOfflineScope(SCOPE_A, { discardPending: true }))
      .rejects.toThrow(DB_A);
    expect(deleted).toEqual([DB_A]);
    expect((await factory.databases()).map(({ name }) => name)).not.toContain(deleted[0]);
    expect((await inspectOfflineScope(SCOPE_A)).partitions).toHaveLength(1);
  });

  it('leaves malformed and unrelated database names untouched', async () => {
    const names = [
      'other-app|doc|user-a',
      'blok-ops-url|doc|user-a|extra',
      'blok-ops-url%7c|doc|user-a',
      'blok-ops-url%GG|doc|user-a',
    ];

    for (const name of names) {
      await createDatabase(name);
    }

    await expect(forgetOfflineScope(SCOPE_A, { discardPending: true }))
      .resolves.toMatchObject({ deletedPartitions: 0 });
    expect((await factory.databases()).map(({ name }) => name)).toEqual(names);
  });

  it('decodes escaped separators without crossing scope boundaries', async () => {
    await storeWith('wss://first.test/a|b', 'doc%7C|one', 'user|a');
    await storeWith('wss://first.test/a%7Cb', 'doc%7C|one', 'user%7Ca');
    await closeStores();

    expect((await inspectOfflineScope('user|a')).partitions).toMatchObject([
      { url: 'wss://first.test/a|b', doc: 'doc%7C|one' },
    ]);
    expect((await inspectOfflineScope('user%7Ca')).partitions).toMatchObject([
      { url: 'wss://first.test/a%7Cb', doc: 'doc%7C|one' },
    ]);

    await forgetOfflineScope('user|a', { discardPending: true });
    expect((await inspectOfflineScope('user|a')).partitions).toEqual([]);
    expect((await inspectOfflineScope('user%7Ca')).partitions).toHaveLength(1);
  });

  it('fails inspection rather than hiding a matching database with missing stores', async () => {
    await storeWith(URL_A, 'same-id', SCOPE_A);
    await closeStores();
    await createDatabase(DB_A_SECOND);

    const deleteDatabase = vi.spyOn(factory, 'deleteDatabase');

    await expect(inspectOfflineScope(SCOPE_A)).rejects.toThrow();
    await expect(forgetOfflineScope(SCOPE_A, { discardPending: true })).rejects.toThrow();
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect((await factory.databases()).map(({ name }) => name)).toContain(DB_A);
  });
});
