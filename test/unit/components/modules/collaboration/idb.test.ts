import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAll, getAllKeysValues, openDB, read, transact } from '../../../../../src/components/modules/collaboration/idb';

const DB = 'idb-test';

const withTestStore = (db: IDBDatabase): void => {
  db.createObjectStore('test', { autoIncrement: true });
};

describe('idb', () => {
  let factory: IDBFactory;

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // lib0's indexeddb.test.js (testRetrieveElements), for the helpers Blok keeps.
  it('reads values, and keys paired with their values, in key order', async () => {
    const db = await openDB(DB, withTestStore);
    const [store] = transact(db, ['test']);

    await read(store.put(1, ['t', 2]));
    await read(store.put(0, ['t', 1]));

    expect(await getAll(store)).toEqual([0, 1]);
    expect(await getAllKeysValues(store)).toEqual([{ k: ['t', 1], v: 0 }, { k: ['t', 2], v: 1 }]);
    expect(await read(store.get(['t', 1]))).toBe(0);
    db.close();
  });

  it('pairs keys and values inside one transaction', async () => {
    const db = await openDB(DB, withTestStore);
    const [store] = transact(db, ['test']);

    await read(store.add('a'));
    await read(store.add('b'));

    const pairs = getAllKeysValues(store);
    // Queued right after both reads. Reading values only once the keys came
    // back would let this delete land between them and shift every value.
    const late = read(store.delete(1));

    expect(await pairs).toEqual([{ k: 1, v: 'a' }, { k: 2, v: 'b' }]);
    await late;
    db.close();
  });

  it('runs the upgrade callback only when the database is created', async () => {
    const upgrade = vi.fn(withTestStore);

    (await openDB(DB, upgrade)).close();
    (await openDB(DB, upgrade)).close();

    expect(upgrade).toHaveBeenCalledTimes(1);
  });

  it('opens stores read-write by default, in the order asked for', async () => {
    const db = await openDB(DB, (created) => {
      created.createObjectStore('a');
      created.createObjectStore('b');
    });
    const [b, a] = transact(db, ['b', 'a']);

    expect([b.name, a.name]).toEqual(['b', 'a']);
    expect(b.transaction.mode).toBe('readwrite');
    expect(transact(db, ['a'], 'readonly')[0].transaction.mode).toBe('readonly');
    db.close();
  });

  it('closes itself when another tab deletes or upgrades the database', async () => {
    const db = await openDB(DB, withTestStore);
    const blocked = vi.fn();
    const request = factory.deleteDatabase(DB);

    request.onblocked = blocked;
    await read(request);

    expect(blocked).not.toHaveBeenCalled();
    expect(() => db.transaction(['test'])).toThrow();
  });

  it('rejects, rather than throws, when IndexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined);

    const opening = openDB(DB, withTestStore);

    await expect(opening).rejects.toThrow();
  });

  it('rejects when the open request fails', async () => {
    vi.spyOn(factory, 'open').mockImplementation(() => {
      const request = new EventTarget() as IDBOpenDBRequest;

      Object.defineProperty(request, 'error', { value: new DOMException('denied', 'UnknownError') });
      queueMicrotask(() => {
        const event = new Event('error');

        Object.defineProperty(event, 'target', { value: request });
        request.onerror?.(event);
      });

      return request;
    });

    await expect(openDB(DB, withTestStore)).rejects.toThrow(new Error('UnknownError: denied'));
  });

  it('rejects a failed read with an Error that names the cause', async () => {
    const db = await openDB(DB, withTestStore);
    const [store] = transact(db, ['test']);

    await read(store.add('x', 1));
    const duplicate = read(store.add('y', 1));

    await expect(duplicate).rejects.toBeInstanceOf(Error);
    await expect(duplicate).rejects.toThrow(/ConstraintError/);
    db.close();
  });
});
