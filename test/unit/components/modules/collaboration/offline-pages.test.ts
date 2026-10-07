import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forgetOfflinePage, listOfflinePages } from '../../../../../src/blok';
import {
  createOperationStore,
  type OperationStore,
} from '../../../../../src/components/modules/collaboration/operation-store';
import type { WorkingSetTag } from '../../../../../src/components/modules/collaboration/types';

const LINEAGE = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const tag: WorkingSetTag = { format: 2, epoch: 0, lineage: LINEAGE };

describe('collaboration — offline pages', () => {
  const stores: OperationStore[] = [];
  const handles: IDBDatabase[] = [];
  let factory: IDBFactory;

  const seed = async (url: string, doc: string, scope: string): Promise<OperationStore> => {
    const store = createOperationStore({ url, doc, offlineScope: scope });

    stores.push(store);
    await store.open();
    await store.recordSession(tag, false, 'v2');

    return store;
  };

  const closeStores = async (): Promise<void> => {
    await Promise.all(stores.splice(0).map(store => store.close()));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
  });

  afterEach(async () => {
    await closeStores();
    handles.splice(0).forEach(db => db.close());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists selected-scope partitions including pending and quarantined work', async () => {
    const pending = await seed('wss://one.test/sync', 'p', 'account-a');

    await pending.appendLocal(new Uint8Array([1, 2]));
    await pending.quarantineLineage(LINEAGE, 'reset', new Uint8Array([3, 4, 5]));
    const other = createOperationStore({
      url: 'wss://two.test/sync', doc: 'p', offlineScope: 'account-a',
    });

    stores.push(other);
    await other.open();
    await other.recordSession(tag, false, 'v1');
    await other.appendCached(new Uint8Array([6]));
    await seed('wss://one.test/sync', 'p', 'account-b');
    await closeStores();

    expect(await listOfflinePages('account-a')).toEqual([
      {
        url: 'wss://one.test/sync',
        doc: 'p',
        outbox: { count: 0, bytes: 0 },
        quarantine: { count: 2, bytes: 5 },
        updates: { count: 1, bytes: 2 },
        mayHaveUnsentV1Edits: false,
      },
      {
        url: 'wss://two.test/sync',
        doc: 'p',
        outbox: { count: 0, bytes: 0 },
        quarantine: { count: 0, bytes: 0 },
        updates: { count: 1, bytes: 1 },
        mayHaveUnsentV1Edits: true,
      },
    ]);
    expect(await listOfflinePages('account-b')).toHaveLength(1);
  });

  it('forgets only the exact server and document within one scope', async () => {
    const selected = await seed('wss://one.test/sync', 'p', 'account-a');

    await selected.appendLocal(new Uint8Array([1, 2]));
    await seed('wss://one.test/sync', 'q', 'account-a');
    await seed('wss://two.test/sync', 'p', 'account-a');
    await seed('wss://one.test/sync', 'p', 'account-b');
    await closeStores();

    const result = await forgetOfflinePage(
      'account-a',
      { url: 'wss://one.test/sync', doc: 'p' },
      { discardPending: true }
    );

    expect(result).toMatchObject({
      deletedPartitions: 1,
      discarded: { partitions: [{ url: 'wss://one.test/sync', doc: 'p', outbox: { count: 1 } }] },
    });
    expect((await listOfflinePages('account-a')).map(({ url, doc }) => [url, doc])).toEqual([
      ['wss://one.test/sync', 'q'],
      ['wss://two.test/sync', 'p'],
    ]);
    expect(await listOfflinePages('account-b')).toHaveLength(1);
  });

  it('requires an explicit discard decision at runtime', async () => {
    const store = await seed('wss://one.test/sync', 'p', 'account-a');

    await store.appendLocal(new Uint8Array([1]));
    await closeStores();

    await expect(forgetOfflinePage(
      'account-a',
      { url: 'wss://one.test/sync', doc: 'p' },
      undefined as unknown as { discardPending: true }
    )).rejects.toThrow(/discardPending/);
    expect((await listOfflinePages('account-a'))[0]?.outbox.count).toBe(1);
  });

  it('waits for a blocked page deletion before claiming success', async () => {
    await seed('wss://one.test/sync', 'p', 'account-a');
    await closeStores();
    const handle = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open('blok-ops-wss://one.test/sync|p|account-a');

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    handles.push(handle);
    const originalDelete = factory.deleteDatabase.bind(factory);
    let onBlocked: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => { onBlocked = resolve; });

    vi.spyOn(factory, 'deleteDatabase').mockImplementation((name) => {
      const request = originalDelete(name);

      request.addEventListener('blocked', () => onBlocked?.());

      return request;
    });

    const forgetting = forgetOfflinePage(
      'account-a',
      { url: 'wss://one.test/sync', doc: 'p' },
      { discardPending: true }
    );
    const result = expect(forgetting).resolves.toMatchObject({ deletedPartitions: 1 });

    await blocked;
    handle.close();
    await result;
    expect(await listOfflinePages('account-a')).toEqual([]);
  });
});
