import type { BlokUploader, UploadContext, UploadedAsset } from '../../../types/configs/uploader';
import { createSafeObjectUrl, localImageUrl } from '../../../src/shared/safe-object-url';

export interface IndexedDBStorageOptions {
  dbName?: string;
}

const DEFAULT_DB = 'blok-assets';
const STORE = 'assets';
const PREFIX = 'blok:asset/';

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);

    request.onupgradeneeded = (): void => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB open failed'));
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = run(db.transaction(STORE, mode).objectStore(STORE));

    request.onsuccess = (): void => resolve(request.result);
    request.onerror = (): void => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function indexedDBStorage(options: IndexedDBStorageOptions = {}): BlokUploader {
  const dbName = options.dbName ?? DEFAULT_DB;

  return {
    async uploadByFile(file: File, ctx: UploadContext): Promise<UploadedAsset> {
      const key = crypto.randomUUID();
      const db = await openDb(dbName);

      try {
        await tx(db, 'readwrite', (store) => store.put({ blob: file, name: file.name, type: file.type, kind: ctx.kind }, key));
      } finally {
        db.close();
      }

      // A blok: reference rather than a blob: URL: blob URLs are scoped to the
      // page that made them, so saving one produces a broken image after reload.
      return { url: `${PREFIX}${key}`, fileName: file.name };
    },
  };
}

export async function resolveBlokObjectUrl(url: string, options: IndexedDBStorageOptions = {}): Promise<string | null> {
  if (!url.startsWith(PREFIX)) {
    return url;
  }

  const db = await openDb(options.dbName ?? DEFAULT_DB);
  const record = await readRecord(db, url.slice(PREFIX.length));

  // Same rule as core: an image SVG becomes a data: URL, since an SVG blob
  // opened in a tab runs as the host. Records saved before `kind` was stored lose SVG.
  if (record === undefined) {
    return null;
  }

  return record.kind === 'image' ? localImageUrl(record.blob) : createSafeObjectUrl(record.blob);
}

interface StoredRecord {
  blob: Blob;
  kind?: string;
}

function readRecord(db: IDBDatabase, key: string): Promise<StoredRecord | undefined> {
  return tx<StoredRecord | undefined>(
    db,
    'readonly',
    // IDBObjectStore.get() returns IDBRequest<any> per lib.dom.d.ts — the cast
    // narrows it to what this store actually holds.
    (store) => store.get(key) as IDBRequest<StoredRecord | undefined>
  ).finally(() => db.close());
}
