import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { DatabaseBackendSync } from '../../../../src/tools/database/database-backend-sync';
import type {
  DatabaseAdapter,
  DatabaseRow,
  DatabaseViewConfig,
  PropertyDefinition,
} from '../../../../src/tools/database/types';

const ROW: DatabaseRow = { id: 'r1', position: 'a0', properties: {} };
const PROPERTY: PropertyDefinition = { id: 'p1', name: 'P', type: 'text', position: 'a0' };
const VIEW: DatabaseViewConfig = {
  id: 'v1', name: 'V', type: 'table', position: 'a0', sorts: [], filters: [], visibleProperties: [],
};

interface MockAdapter extends DatabaseAdapter {
  loadDatabase: Mock<DatabaseAdapter['loadDatabase']>;
  createRow: Mock<DatabaseAdapter['createRow']>;
  updateRow: Mock<DatabaseAdapter['updateRow']>;
  moveRow: Mock<DatabaseAdapter['moveRow']>;
  deleteRow: Mock<DatabaseAdapter['deleteRow']>;
  createProperty: Mock<DatabaseAdapter['createProperty']>;
  updateProperty: Mock<DatabaseAdapter['updateProperty']>;
  deleteProperty: Mock<DatabaseAdapter['deleteProperty']>;
  createView: Mock<DatabaseAdapter['createView']>;
  updateView: Mock<DatabaseAdapter['updateView']>;
  deleteView: Mock<DatabaseAdapter['deleteView']>;
}

const createAdapter = (): MockAdapter => ({
  loadDatabase: vi.fn<DatabaseAdapter['loadDatabase']>(async () => ({ schema: [], views: [] })),
  createRow: vi.fn<DatabaseAdapter['createRow']>(async () => ROW),
  updateRow: vi.fn<DatabaseAdapter['updateRow']>(async () => ROW),
  moveRow: vi.fn<DatabaseAdapter['moveRow']>(async () => ROW),
  deleteRow: vi.fn<DatabaseAdapter['deleteRow']>(async () => undefined),
  createProperty: vi.fn<DatabaseAdapter['createProperty']>(async () => PROPERTY),
  updateProperty: vi.fn<DatabaseAdapter['updateProperty']>(async () => PROPERTY),
  deleteProperty: vi.fn<DatabaseAdapter['deleteProperty']>(async () => undefined),
  createView: vi.fn<DatabaseAdapter['createView']>(async () => VIEW),
  updateView: vi.fn<DatabaseAdapter['updateView']>(async () => VIEW),
  deleteView: vi.fn<DatabaseAdapter['deleteView']>(async () => undefined),
});

/**
 * Every assertion here reads a COMPLETE value: the whole `mock.calls` list of a
 * collaborator (`toHaveBeenCalledWith` ignores extra calls), the exact number of
 * live fake timers, or the exact merged payload.
 *
 * `vi.getTimerCount()` and a spy on the global `clearTimeout` are the only
 * windows onto the two private timer maps: a class that schedules or cancels a
 * timer nobody can see is otherwise indistinguishable from one that does not.
 */
describe('DatabaseBackendSync — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('safeCall', () => {
    it('never reaches the callback when there is no adapter, so onError stays silent', async () => {
      const onError = vi.fn<(error: unknown) => void>();
      const sync = new DatabaseBackendSync(undefined, onError);

      await expect(sync.syncLoadDatabase()).resolves.toBeUndefined();
      await expect(sync.syncCreateRow({ id: 'r1', properties: {}, position: 'a0' })).resolves.toBeUndefined();
      await expect(sync.syncCreateView({ id: 'v1', name: 'V', type: 'table', position: 'a0' })).resolves.toBeUndefined();

      expect(onError.mock.calls).toStrictEqual([]);
    });

    it('swallows an adapter rejection when no onError handler was supplied', async () => {
      const adapter = createAdapter();
      const failure = new Error('Network fail');

      adapter.createRow.mockRejectedValue(failure);

      const sync = new DatabaseBackendSync(adapter);

      await expect(sync.syncCreateRow({ id: 'r1', properties: {}, position: 'a0' })).resolves.toBeUndefined();
    });

    it('hands onError the adapter error exactly once', async () => {
      const adapter = createAdapter();
      const failure = new Error('Network fail');

      adapter.deleteView.mockRejectedValue(failure);

      const onError = vi.fn<(error: unknown) => void>();
      const sync = new DatabaseBackendSync(adapter, onError);

      await sync.syncDeleteView({ viewId: 'v1' });

      expect(onError.mock.calls).toStrictEqual([[failure]]);
    });
  });

  describe('syncUpdateRow', () => {
    it('schedules nothing without an adapter', () => {
      const sync = new DatabaseBackendSync();

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });

      expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels no timer on the first update of a row', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });

      expect(clearTimeoutSpy.mock.calls).toStrictEqual([]);
      expect(vi.getTimerCount()).toBe(1);
    });

    it('restarts the debounce window on the second update instead of letting the first timer fire', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      vi.advanceTimersByTime(400);
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'B' } });

      // 500ms after the FIRST call: the first timer must already be cancelled.
      vi.advanceTimersByTime(100);
      expect(adapter.updateRow.mock.calls).toStrictEqual([]);
      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(400);
      expect(adapter.updateRow.mock.calls).toStrictEqual([[{ rowId: 'r1', properties: { title: 'B' } }]]);
    });
  });

  describe('syncUpdatePropertyDebounced', () => {
    it('schedules nothing without an adapter', () => {
      const sync = new DatabaseBackendSync();

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { name: 'A' } });

      expect(vi.getTimerCount()).toBe(0);
    });

    it('cancels no timer on the first update of a property', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { name: 'A' } });

      expect(clearTimeoutSpy.mock.calls).toStrictEqual([]);
      expect(vi.getTimerCount()).toBe(1);
    });

    it('restarts the debounce window on the second update instead of letting the first timer fire', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { name: 'A' } });
      vi.advanceTimersByTime(400);
      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { name: 'B' } });

      vi.advanceTimersByTime(100);
      expect(adapter.updateProperty.mock.calls).toStrictEqual([]);
      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(400);
      expect(adapter.updateProperty.mock.calls).toStrictEqual([[{ propertyId: 'p1', changes: { name: 'B' } }]]);
    });
  });

  describe('destroy', () => {
    it('cancels the pending row timer', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      expect(vi.getTimerCount()).toBe(1);

      sync.destroy();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('empties the row timer map, so a later flush walks nothing', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      sync.destroy();

      // Spy AFTER destroy: this measures the flush walk, not destroy's own cancels.
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      sync.flushPendingUpdates();

      expect(clearTimeoutSpy.mock.calls).toStrictEqual([]);
      expect(adapter.updateRow.mock.calls).toStrictEqual([]);
    });

    it('drops the pending row payload so it cannot merge into a later update', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      sync.destroy();
      sync.syncUpdateRow({ rowId: 'r1', properties: { status: 'done' } });
      sync.flushPendingUpdates();

      expect(adapter.updateRow.mock.calls).toStrictEqual([[{ rowId: 'r1', properties: { status: 'done' } }]]);
    });

    it('cancels the pending property timer', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { name: 'A' } });
      expect(vi.getTimerCount()).toBe(1);

      sync.destroy();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('empties the property timer map, so a later flush walks nothing', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { name: 'A' } });
      sync.destroy();

      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      sync.flushPendingPropertyUpdates();

      expect(clearTimeoutSpy.mock.calls).toStrictEqual([]);
      expect(adapter.updateProperty.mock.calls).toStrictEqual([]);
    });
  });

  describe('flushing a row', () => {
    it('cancels the row debounce timer it fired early', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      expect(vi.getTimerCount()).toBe(1);

      sync.flushPendingUpdates();

      expect(vi.getTimerCount()).toBe(0);
      expect(adapter.updateRow.mock.calls).toStrictEqual([[{ rowId: 'r1', properties: { title: 'A' } }]]);
    });

    it('moving a row with nothing pending cancels no timer and sends no update', async () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      await sync.syncMoveRow({ rowId: 'ghost', position: 'a1' });

      expect(clearTimeoutSpy.mock.calls).toStrictEqual([]);
      expect(adapter.updateRow.mock.calls).toStrictEqual([]);
      expect(adapter.moveRow.mock.calls).toStrictEqual([[{ rowId: 'ghost', position: 'a1' }]]);
    });

    it('forgets a flushed row, so a second flush revisits nothing', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      sync.flushPendingUpdates();

      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      sync.flushPendingUpdates();

      expect(clearTimeoutSpy.mock.calls).toStrictEqual([]);
      expect(adapter.updateRow.mock.calls).toStrictEqual([[{ rowId: 'r1', properties: { title: 'A' } }]]);
    });

    it('drops the flushed payload, so the next update to the same row is sent alone', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      sync.flushPendingUpdates();
      sync.syncUpdateRow({ rowId: 'r1', properties: { status: 'done' } });
      sync.flushPendingUpdates();

      expect(adapter.updateRow.mock.calls).toStrictEqual([
        [{ rowId: 'r1', properties: { title: 'A' } }],
        [{ rowId: 'r1', properties: { status: 'done' } }],
      ]);
    });
  });

  /*
   * Four mutants in the property path are equivalent — no test can see them,
   * because `pendingPropertyTimers` and `pendingPropertyUpdates` are written in
   * lockstep and `flushProperty` has no caller that names a property with
   * nothing pending. Every write site touches BOTH maps:
   *   - lines 71-72  set updates[id] and then timers[id]
   *   - lines 127+129 delete both
   *   - lines 111-112 clear both
   * and the only two callers of `flushProperty` are line 74 (its own timer
   * callback, which fires only while its map entry is still there) and line 103
   * (a walk over the live keys of `pendingPropertyTimers`). The row path differs
   * only because `syncMoveRow` calls `flushRow(params.rowId)` at line 47 with an
   * arbitrary row id — which is exactly how the two flushRow twins below die.
   *
   *   112:5  `this.pendingPropertyUpdates.clear()` -> `;`
   *          A stale entry left by destroy is only readable by flushProperty,
   *          which needs the id back in the timer map — and the only way back in
   *          (syncUpdatePropertyDebounced) overwrites updates[id] at line 71
   *          first. Line 71 is a plain `set`, not the merge the row path does at
   *          line 42, so nothing of the stale value survives. The row twin
   *          (109:5) IS killed above, by that merge.
   *   126:9  `timer !== undefined` -> `true`
   *          `timer` is never undefined here: the id always comes from the timer
   *          map itself.
   *   129:5  `this.pendingPropertyUpdates.delete(propertyId)` -> `;`
   *          Same as 112:5 — the retained value is overwritten by line 71 before
   *          any reader can reach it. The row twin (120:5) IS killed above.
   *   130:9  `params !== undefined` -> `true`
   *          `params` is never undefined here, by the same lockstep. The row
   *          twin (121:9) IS killed above, via syncMoveRow on an unknown id.
   */
  describe('flushing a property', () => {
    it('cancels the property debounce timer it fired early', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { name: 'A' } });
      expect(vi.getTimerCount()).toBe(1);

      sync.flushPendingPropertyUpdates();

      expect(vi.getTimerCount()).toBe(0);
      expect(adapter.updateProperty.mock.calls).toStrictEqual([[{ propertyId: 'p1', changes: { name: 'A' } }]]);
    });

    it('forgets a flushed property, so a second flush revisits nothing', () => {
      const adapter = createAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { name: 'A' } });
      sync.flushPendingPropertyUpdates();

      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      sync.flushPendingPropertyUpdates();

      expect(clearTimeoutSpy.mock.calls).toStrictEqual([]);
      expect(adapter.updateProperty.mock.calls).toStrictEqual([[{ propertyId: 'p1', changes: { name: 'A' } }]]);
    });
  });
});
