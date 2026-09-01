/**
 * The collaboration offline cache (Phase 4, Wave B).
 *
 * The contract under test: rows are stamped with the lineage they were written
 * under and only rows matching the adoptable meta's lineage are ever adopted;
 * meta exists only after a validated control frame, so a never-synced session
 * can never fabricate an adoptable cache; compaction is the one non-idempotent
 * sequence and runs under the Web Lock when one exists; and every IndexedDB
 * failure degrades to "no cache", never to a thrown session.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import {
  createOfflineCache,
  type OfflineCache,
  type OfflineCacheLocks,
  type OfflineCacheOptions,
} from '../../../../../src/components/modules/collaboration/offline-cache';
import type { WorkingSetTag } from '../../../../../src/components/modules/collaboration/types';

const LINEAGE_A = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';
const LINEAGE_B = 'b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2';
const KEY = 'wss://sync.test/api/sync/doc-1';

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
 * One Yjs update writing a single map entry — the smallest thing a cache row
 * can carry that is still observable after adoption.
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

describe('collaboration — offline cache', () => {
  let factory: IDBFactory;
  const caches: OfflineCache[] = [];

  /**
   * Builds a cache and tracks it for teardown.
   * @param options - overrides for the cache options
   */
  const cacheWith = (options: Partial<OfflineCacheOptions> = {}): OfflineCache => {
    const cache = createOfflineCache({ key: KEY, ...options });

    caches.push(cache);

    return cache;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    factory = new IDBFactory();
    vi.stubGlobal('indexedDB', factory);
  });

  afterEach(() => {
    caches.splice(0).forEach((cache) => cache.close());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('meta-gated adoption', () => {
    it('adopts nothing from an empty cache', async () => {
      const cache = cacheWith();

      expect(await cache.open()).toBeNull();
    });

    it('never becomes adoptable from rows alone — meta is the gate', async () => {
      const writer = cacheWith();

      await writer.open();
      // No saveMeta: this session never validated a control frame, so its
      // appends must not fabricate an adoptable cache.
      await writer.append(updateWith('block-1', 'unsynced'));
      writer.close();

      const reader = cacheWith();

      expect(await reader.open()).toBeNull();
    });

    it('adopts meta and updates written by an earlier session', async () => {
      const writer = cacheWith();

      await writer.open();
      await writer.saveMeta(tagWith(LINEAGE_A, { epoch: 3 }), false);
      await writer.append(updateWith('block-1', 'first'));
      await writer.append(updateWith('block-2', 'second'));
      writer.close();

      const reader = cacheWith();
      const adopted = await reader.open();

      expect(adopted).not.toBeNull();
      expect(adopted?.meta.lineage).toBe(LINEAGE_A);
      expect(adopted?.meta.epoch).toBe(3);
      expect(adopted?.meta.format).toBe(1);
      expect(adopted?.meta.writeDenied).toBe(false);
      expect(typeof adopted?.meta.savedAt).toBe('number');
      expect(materialize(adopted?.updates ?? [])).toEqual({ 'block-1': 'first', 'block-2': 'second' });
    });

    it('remembers a write-denied member', async () => {
      const writer = cacheWith();

      await writer.open();
      await writer.saveMeta(tagWith(LINEAGE_A), true);
      writer.close();

      const reader = cacheWith();

      expect((await reader.open())?.meta.writeDenied).toBe(true);
    });

    it('refuses meta whose lineage is not 32 lower-hex characters', async () => {
      const writer = cacheWith();

      await writer.open();
      await writer.saveMeta(tagWith('NOT-A-LINEAGE'), false);
      await writer.append(updateWith('block-1', 'text'));
      writer.close();

      const reader = cacheWith();

      expect(await reader.open()).toBeNull();
    });

    it('refuses meta carrying a format this client cannot read', async () => {
      const writer = cacheWith();

      await writer.open();
      await writer.saveMeta(tagWith(LINEAGE_A, { format: 2 }), false);
      await writer.append(updateWith('block-1', 'text'));
      writer.close();

      const reader = cacheWith();

      expect(await reader.open()).toBeNull();
    });
  });

  describe('lineage stamping', () => {
    it('adopts only rows stamped with the meta lineage', async () => {
      const first = cacheWith();

      await first.open();
      await first.saveMeta(tagWith(LINEAGE_A), false);
      await first.append(updateWith('block-1', 'old lineage'));
      first.close();

      // The same store, now under a new lineage: the old row must not mix in.
      const second = cacheWith();

      await second.open();
      await second.saveMeta(tagWith(LINEAGE_B), false);
      await second.append(updateWith('block-2', 'new lineage'));
      second.close();

      const reader = cacheWith();
      const adopted = await reader.open();

      expect(adopted?.meta.lineage).toBe(LINEAGE_B);
      expect(materialize(adopted?.updates ?? [])).toEqual({ 'block-2': 'new lineage' });
    });

    it('sweeps rows from other lineages at adoption', async () => {
      const first = cacheWith();

      await first.open();
      await first.saveMeta(tagWith(LINEAGE_A), false);
      await first.append(updateWith('block-1', 'old lineage'));
      await first.saveMeta(tagWith(LINEAGE_B), false);
      await first.append(updateWith('block-2', 'new lineage'));
      first.close();

      // This adoption reads lineage B and must DELETE the lineage-A row.
      const sweeper = cacheWith();

      await sweeper.open();
      // Back to lineage A: if the sweep did not happen, the old A row would
      // now be adoptable again.
      await sweeper.saveMeta(tagWith(LINEAGE_A), false);
      sweeper.close();

      const reader = cacheWith();
      const adopted = await reader.open();

      expect(adopted?.meta.lineage).toBe(LINEAGE_A);
      expect(adopted?.updates).toEqual([]);
    });
  });

  describe('idempotent rows', () => {
    it('tolerates the same update written twice, as two tabs would', async () => {
      const writer = cacheWith();
      const update = updateWith('block-1', 'once');

      await writer.open();
      await writer.saveMeta(tagWith(LINEAGE_A), false);
      await writer.append(update);
      await writer.append(update);
      writer.close();

      const reader = cacheWith();
      const adopted = await reader.open();

      expect(adopted?.updates).toHaveLength(2);
      expect(materialize(adopted?.updates ?? [])).toEqual({ 'block-1': 'once' });
    });
  });

  describe('compaction', () => {
    it('merges rows into one update at the threshold, without a lock manager', async () => {
      // jsdom has no Web Locks; this IS the feature-detect-absent branch. If
      // this ever starts failing because locks appeared, the default branch
      // under test moved — re-cover the absent one explicitly.
      expect(navigator.locks).toBeUndefined();

      const writer = cacheWith({ compactionThreshold: 3 });

      await writer.open();
      await writer.saveMeta(tagWith(LINEAGE_A), false);
      await writer.append(updateWith('block-1', 'one'));
      await writer.append(updateWith('block-2', 'two'));
      await writer.append(updateWith('block-3', 'three'));
      writer.close();

      const reader = cacheWith();
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
          requests.push({ name, ifAvailable: options.ifAvailable });

          return callback({});
        },
      };

      const writer = cacheWith({ compactionThreshold: 2, locks });

      await writer.open();
      await writer.saveMeta(tagWith(LINEAGE_A), false);
      await writer.append(updateWith('block-1', 'one'));
      await writer.append(updateWith('block-2', 'two'));
      writer.close();

      expect(requests).toHaveLength(1);
      expect(requests[0].ifAvailable).toBe(true);

      const reader = cacheWith();

      expect((await reader.open())?.updates).toHaveLength(1);
    });

    it('skips compaction while another tab holds the lock, losing nothing', async () => {
      const locks: OfflineCacheLocks = {
        // What `ifAvailable: true` does when the lock is held elsewhere.
        request: async (_name, _options, callback) => callback(null),
      };

      const writer = cacheWith({ compactionThreshold: 2, locks });

      await writer.open();
      await writer.saveMeta(tagWith(LINEAGE_A), false);
      await writer.append(updateWith('block-1', 'one'));
      await writer.append(updateWith('block-2', 'two'));
      writer.close();

      const reader = cacheWith();
      const adopted = await reader.open();

      expect(adopted?.updates).toHaveLength(2);
      expect(materialize(adopted?.updates ?? [])).toEqual({ 'block-1': 'one', 'block-2': 'two' });
    });
  });

  describe('clear', () => {
    it('drops rows and meta, and later appends write nothing', async () => {
      const writer = cacheWith();

      await writer.open();
      await writer.saveMeta(tagWith(LINEAGE_A), false);
      await writer.append(updateWith('block-1', 'text'));
      await writer.clear();
      await writer.append(updateWith('block-2', 'after the clear'));
      writer.close();

      const reader = cacheWith();

      expect(await reader.open()).toBeNull();
    });
  });

  describe('degrade on failure', () => {
    it('adopts nothing when indexedDB is absent, and every write is inert', async () => {
      vi.stubGlobal('indexedDB', undefined);

      const cache = cacheWith();

      expect(await cache.open()).toBeNull();
      await expect(cache.append(updateWith('block-1', 'text'))).resolves.toBeUndefined();
      await expect(cache.saveMeta(tagWith(LINEAGE_A), false)).resolves.toBeUndefined();
      await expect(cache.clear()).resolves.toBeUndefined();
    });

    it('adopts nothing when opening the database throws', async () => {
      vi.spyOn(factory, 'open').mockImplementation(() => {
        throw new Error('quota exceeded');
      });

      const cache = cacheWith();

      expect(await cache.open()).toBeNull();
      await expect(cache.append(updateWith('block-1', 'text'))).resolves.toBeUndefined();
    });

    it('keeps every row when the lock manager itself rejects', async () => {
      const locks: OfflineCacheLocks = {
        request: async () => {
          throw new Error('locks are broken here');
        },
      };

      const writer = cacheWith({ compactionThreshold: 2, locks });

      await writer.open();
      await writer.saveMeta(tagWith(LINEAGE_A), false);
      await writer.append(updateWith('block-1', 'one'));
      await writer.append(updateWith('block-2', 'two'));
      writer.close();

      const reader = cacheWith();
      const adopted = await reader.open();

      expect(adopted?.updates).toHaveLength(2);
      expect(materialize(adopted?.updates ?? [])).toEqual({ 'block-1': 'one', 'block-2': 'two' });
    });

    it('touches the database only from open(), never at construction', async () => {
      const openSpy = vi.spyOn(factory, 'open');
      const cache = cacheWith();

      await cache.append(updateWith('block-1', 'text'));
      await cache.saveMeta(tagWith(LINEAGE_A), false);

      expect(openSpy).not.toHaveBeenCalled();
    });
  });
});
