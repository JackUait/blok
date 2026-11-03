import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlokUploader } from '../../../types/configs/uploader';
import { indexedDBStorage, resolveBlokObjectUrl } from './indexeddb';

// vitest.config.ts runs Node, which has no IndexedDB. `fake-indexeddb/auto`
// installs a spec-compliant in-memory implementation on globalThis.
import 'fake-indexeddb/auto';

function requireUploadByFile(uploader: BlokUploader): NonNullable<BlokUploader['uploadByFile']> {
  const { uploadByFile } = uploader;

  if (!uploadByFile) {
    throw new Error('expected uploadByFile to be defined');
  }

  return uploadByFile;
}

describe('indexedDBStorage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    indexedDB.deleteDatabase('blok-assets-test');
    // Separate db from the leak test below: a connection the source code
    // fails to close (the exact bug under test) blocks a later
    // deleteDatabase on the same name, which would hang this beforeEach.
    indexedDB.deleteDatabase('blok-assets-test-read-fail');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores the file and returns a stable blok: reference', async () => {
    const uploader = indexedDBStorage({ dbName: 'blok-assets-test' });

    const result = await requireUploadByFile(uploader)(new File(['bytes'], 'a.png', { type: 'image/png' }), { kind: 'image' });

    expect(result.url).toMatch(/^blok:asset\//);
    expect(result.fileName).toBe('a.png');
  });

  it('reads the file back after the object URL from the first session is gone', async () => {
    const uploader = indexedDBStorage({ dbName: 'blok-assets-test' });
    const { url } = await requireUploadByFile(uploader)(new File(['bytes'], 'a.png', { type: 'image/png' }), { kind: 'image' });

    const resolved = await resolveBlokObjectUrl(url, { dbName: 'blok-assets-test' });

    expect(resolved).toMatch(/^blob:/);
  });

  describe('blob type on read', () => {
    async function resolvedType(file: File, kind: 'image' | 'file'): Promise<string> {
      const spy = vi.spyOn(URL, 'createObjectURL');
      const uploader = indexedDBStorage({ dbName: 'blok-assets-test' });
      const { url } = await requireUploadByFile(uploader)(file, { kind });

      await resolveBlokObjectUrl(url, { dbName: 'blok-assets-test' });

      const blob = spy.mock.calls.at(-1)?.[0];

      if (!(blob instanceof Blob)) {
        throw new Error('expected createObjectURL to get a Blob');
      }

      return blob.type;
    }

    it('re-types an HTML file to text/plain, so the blob: URL never runs as the host page', async () => {
      expect(await resolvedType(new File(['<script>1</script>'], 'a.html', { type: 'text/html' }), 'file')).toBe('text/plain');
    });

    it('re-types an SVG stored as a file, since it would run script when opened', async () => {
      expect(await resolvedType(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }), 'file')).toBe('text/plain');
    });

    it('keeps SVG stored as an image, since <img> needs the type and runs no script', async () => {
      expect(await resolvedType(new File(['<svg/>'], 'a.svg', { type: 'image/svg+xml' }), 'image')).toBe('image/svg+xml');
    });

    it('keeps a safe type such as PNG', async () => {
      expect(await resolvedType(new File(['bytes'], 'a.png', { type: 'image/png' }), 'image')).toBe('image/png');
    });

    it('re-types SVG from a record saved before the kind was stored', async () => {
      const spy = vi.spyOn(URL, 'createObjectURL');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('blok-assets-test', 1);

        request.onupgradeneeded = (): void => {
          request.result.createObjectStore('assets');
        };
        request.onsuccess = (): void => resolve(request.result);
        request.onerror = (): void => reject(request.error);
      });

      await new Promise<void>((resolve, reject) => {
        const request = db.transaction('assets', 'readwrite').objectStore('assets')
          .put({ blob: new Blob(['<svg/>'], { type: 'image/svg+xml' }), name: 'old.svg', type: 'image/svg+xml' }, 'old');

        request.onsuccess = (): void => resolve();
        request.onerror = (): void => reject(request.error);
      });
      db.close();

      await resolveBlokObjectUrl('blok:asset/old', { dbName: 'blok-assets-test' });

      const blob = spy.mock.calls.at(-1)?.[0];

      expect(blob instanceof Blob ? blob.type : null).toBe('text/plain');
    });
  });

  it('returns null for a reference that is not stored', async () => {
    expect(await resolveBlokObjectUrl('blok:asset/missing', { dbName: 'blok-assets-test' })).toBeNull();
  });

  it('passes through a plain http url untouched', async () => {
    expect(await resolveBlokObjectUrl('https://example.com/a.png', { dbName: 'blok-assets-test' }))
      .toBe('https://example.com/a.png');
  });

  it('closes the db handle even when the write fails, so a later deleteDatabase does not hang', async () => {
    const closeSpy = vi.spyOn(IDBDatabase.prototype, 'close');

    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    const uploader = indexedDBStorage({ dbName: 'blok-assets-test' });

    await expect(
      requireUploadByFile(uploader)(new File(['bytes'], 'a.png', { type: 'image/png' }), { kind: 'image' })
    ).rejects.toThrow('QuotaExceededError');

    expect(closeSpy).toHaveBeenCalled();
  });

  it('closes the db handle even when the read fails', async () => {
    const closeSpy = vi.spyOn(IDBDatabase.prototype, 'close');

    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(() => {
      throw new Error('read boom');
    });

    await expect(
      resolveBlokObjectUrl('blok:asset/whatever', { dbName: 'blok-assets-test-read-fail' })
    ).rejects.toThrow('read boom');

    expect(closeSpy).toHaveBeenCalled();
  });
});
