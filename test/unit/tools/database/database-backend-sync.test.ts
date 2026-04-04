import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseBackendSync } from '../../../../src/tools/database/database-backend-sync';
import type { DatabaseAdapter } from '../../../../src/tools/database/types';

const createMockAdapter = (): DatabaseAdapter => ({
  loadDatabase: vi.fn().mockResolvedValue({ schema: [], views: [] }),
  createRow: vi.fn().mockResolvedValue({ id: 'r1', position: 'a0', properties: {} }),
  updateRow: vi.fn().mockResolvedValue({ id: 'r1', position: 'a0', properties: {} }),
  moveRow: vi.fn().mockResolvedValue({ id: 'r1', position: 'a0', properties: {} }),
  deleteRow: vi.fn().mockResolvedValue(undefined),
  createProperty: vi.fn().mockResolvedValue({ id: 'p1', name: 'P', type: 'text', position: 'a0' }),
  updateProperty: vi.fn().mockResolvedValue({ id: 'p1', name: 'P', type: 'text', position: 'a0' }),
  deleteProperty: vi.fn().mockResolvedValue(undefined),
  createView: vi.fn().mockResolvedValue({ id: 'v1', name: 'V', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: [] }),
  updateView: vi.fn().mockResolvedValue({ id: 'v1', name: 'V', type: 'board', position: 'a0', sorts: [], filters: [], visibleProperties: [] }),
  deleteView: vi.fn().mockResolvedValue(undefined),
});

describe('DatabaseBackendSync', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  describe('no adapter', () => {
    it('all sync methods are silent no-ops', async () => {
      const sync = new DatabaseBackendSync();
      await expect(sync.syncCreateRow({ id: 'r1', properties: {}, position: 'a0' })).resolves.toBeUndefined();
      await expect(sync.syncMoveRow({ rowId: 'r1', position: 'a1' })).resolves.toBeUndefined();
      await expect(sync.syncDeleteRow({ rowId: 'r1' })).resolves.toBeUndefined();
      await expect(sync.syncCreateProperty({ id: 'p1', name: 'P', type: 'text', position: 'a0' })).resolves.toBeUndefined();
      await expect(sync.syncUpdateProperty({ propertyId: 'p1', changes: { name: 'Q' } })).resolves.toBeUndefined();
      await expect(sync.syncDeleteProperty({ propertyId: 'p1' })).resolves.toBeUndefined();
      await expect(sync.syncCreateView({ id: 'v1', name: 'V', type: 'board', position: 'a0' })).resolves.toBeUndefined();
      await expect(sync.syncUpdateView({ viewId: 'v1', changes: { name: 'W' } })).resolves.toBeUndefined();
      await expect(sync.syncDeleteView({ viewId: 'v1' })).resolves.toBeUndefined();
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'Test' } });
    });
  });

  describe('load operation', () => {
    it('syncLoadDatabase calls adapter.loadDatabase', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      const result = await sync.syncLoadDatabase();

      expect(adapter.loadDatabase).toHaveBeenCalled();
      expect(result).toEqual({ schema: [], views: [] });
    });

    it('syncLoadDatabase returns undefined when no adapter', async () => {
      const sync = new DatabaseBackendSync();
      const result = await sync.syncLoadDatabase();

      expect(result).toBeUndefined();
    });
  });

  describe('row operations', () => {
    it('syncCreateRow calls adapter.createRow', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      await sync.syncCreateRow({ id: 'r1', properties: { title: 'Hi' }, position: 'a0' });
      expect(adapter.createRow).toHaveBeenCalledWith({ id: 'r1', properties: { title: 'Hi' }, position: 'a0' });
    });

    it('syncMoveRow calls adapter.moveRow', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      await sync.syncMoveRow({ rowId: 'r1', position: 'a5' });
      expect(adapter.moveRow).toHaveBeenCalledWith({ rowId: 'r1', position: 'a5' });
    });

    it('syncMoveRow flushes pending updateRow for the same row before moving', async () => {
      const adapter = createMockAdapter();
      const callOrder: string[] = [];

      (adapter.updateRow as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('updateRow');

        return { id: 'r1', position: 'a0', properties: {} };
      });
      (adapter.moveRow as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callOrder.push('moveRow');

        return { id: 'r1', position: 'a5', properties: {} };
      });

      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { status: 'done' } });
      await sync.syncMoveRow({ rowId: 'r1', position: 'a5' });

      expect(adapter.updateRow).toHaveBeenCalledWith({ rowId: 'r1', properties: { status: 'done' } });
      expect(adapter.moveRow).toHaveBeenCalledWith({ rowId: 'r1', position: 'a5' });
      expect(callOrder).toEqual(['updateRow', 'moveRow']);
    });

    it('syncDeleteRow calls adapter.deleteRow', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      await sync.syncDeleteRow({ rowId: 'r1' });
      expect(adapter.deleteRow).toHaveBeenCalledWith({ rowId: 'r1' });
    });

    it('syncUpdateRow debounces at 500ms', () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'First' } });
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'Second' } });
      expect(adapter.updateRow).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(adapter.updateRow).toHaveBeenCalledTimes(1);
      expect(adapter.updateRow).toHaveBeenCalledWith({ rowId: 'r1', properties: { title: 'Second' } });
    });

    it('syncUpdateRow merges properties from rapid updates to the same row', () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'Hello' } });
      sync.syncUpdateRow({ rowId: 'r1', properties: { desc: 'World' } });

      expect(adapter.updateRow).not.toHaveBeenCalled();
      vi.advanceTimersByTime(500);
      expect(adapter.updateRow).toHaveBeenCalledTimes(1);
      expect(adapter.updateRow).toHaveBeenCalledWith({ rowId: 'r1', properties: { title: 'Hello', desc: 'World' } });
    });
  });

  describe('property operations', () => {
    it('syncCreateProperty calls adapter.createProperty', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      await sync.syncCreateProperty({ id: 'p1', name: 'Priority', type: 'select', position: 'a0' });
      expect(adapter.createProperty).toHaveBeenCalledWith({ id: 'p1', name: 'Priority', type: 'select', position: 'a0' });
    });

    it('syncUpdateProperty calls adapter.updateProperty', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      await sync.syncUpdateProperty({ propertyId: 'p1', changes: { name: 'Phase' } });
      expect(adapter.updateProperty).toHaveBeenCalledWith({ propertyId: 'p1', changes: { name: 'Phase' } });
    });

    it('syncDeleteProperty calls adapter.deleteProperty', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      await sync.syncDeleteProperty({ propertyId: 'p1' });
      expect(adapter.deleteProperty).toHaveBeenCalledWith({ propertyId: 'p1' });
    });
  });

  describe('view operations', () => {
    it('syncCreateView calls adapter.createView', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      await sync.syncCreateView({ id: 'v1', name: 'Table', type: 'table', position: 'a0' });
      expect(adapter.createView).toHaveBeenCalledWith({ id: 'v1', name: 'Table', type: 'table', position: 'a0' });
    });

    it('syncUpdateView calls adapter.updateView', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      await sync.syncUpdateView({ viewId: 'v1', changes: { name: 'Renamed' } });
      expect(adapter.updateView).toHaveBeenCalledWith({ viewId: 'v1', changes: { name: 'Renamed' } });
    });

    it('syncDeleteView calls adapter.deleteView', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      await sync.syncDeleteView({ viewId: 'v1' });
      expect(adapter.deleteView).toHaveBeenCalledWith({ viewId: 'v1' });
    });
  });

  describe('error handling', () => {
    it('calls onError when adapter throws', async () => {
      const adapter = createMockAdapter();
      const error = new Error('Network fail');
      (adapter.createRow as ReturnType<typeof vi.fn>).mockRejectedValue(error);
      const onError = vi.fn();
      const sync = new DatabaseBackendSync(adapter, onError);
      await sync.syncCreateRow({ id: 'r1', properties: {}, position: 'a0' });
      expect(onError).toHaveBeenCalledWith(error);
    });
  });

  describe('flush and destroy', () => {
    it('flushPendingUpdates sends all debounced updates immediately', () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      sync.syncUpdateRow({ rowId: 'r2', properties: { title: 'B' } });
      expect(adapter.updateRow).not.toHaveBeenCalled();
      sync.flushPendingUpdates();
      expect(adapter.updateRow).toHaveBeenCalledTimes(2);
      expect(adapter.updateRow).toHaveBeenCalledWith({ rowId: 'r1', properties: { title: 'A' } });
      expect(adapter.updateRow).toHaveBeenCalledWith({ rowId: 'r2', properties: { title: 'B' } });
    });

    it('destroy clears pending timers without sending', () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      sync.destroy();
      vi.advanceTimersByTime(1000);
      expect(adapter.updateRow).not.toHaveBeenCalled();
    });
  });
});
