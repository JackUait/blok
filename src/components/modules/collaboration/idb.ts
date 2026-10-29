// The IndexedDB helpers operation-store used from lib0/indexeddb, with the same
// behaviour: errors are wrapped as `new Error(String(cause))`, and an open
// database closes itself on `versionchange` so another tab is never blocked.

export const read = <T>(request: IDBRequest<T>): Promise<T> => new Promise<T>((resolve, reject) => {
  request.addEventListener('error', () => reject(new Error(String(request.error))));
  request.addEventListener('success', () => resolve(request.result));
});

/**
 * Opens `name` at its current version. `upgrade` runs only when the database
 * is created, so its stores must all be made there.
 * @param name - the database name
 * @param upgrade - creates the object stores of a new database
 */
export const openDB = (name: string, upgrade: (db: IDBDatabase) => void): Promise<IDBDatabase> =>
  // The executor throws (and so rejects) when `indexedDB` is missing.
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);

    request.onupgradeneeded = () => upgrade(request.result);
    request.onerror = () => reject(new Error(String(request.error)));
    request.onsuccess = () => {
      const db = request.result;

      db.onversionchange = () => db.close();
      resolve(db);
    };
  });

/**
 * One transaction over `stores`, returned in the order asked for.
 * @param db - the open database
 * @param stores - object store names
 * @param mode - the transaction mode
 */
export const transact = (
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode = 'readwrite'
): IDBObjectStore[] => {
  const transaction = db.transaction(stores, mode);

  return stores.map((store) => transaction.objectStore(store));
};

export const getAll = (store: IDBObjectStore): Promise<unknown[]> => read<unknown[]>(store.getAll());

/** Both reads are issued at once, in the same transaction, so their rows line up. */
export const getAllKeysValues = async (store: IDBObjectStore): Promise<Array<{ k: IDBValidKey; v: unknown }>> => {
  const [keys, values] = await Promise.all([read(store.getAllKeys()), getAll(store)]);

  return keys.map((k, index) => ({ k, v: values[index] }));
};
