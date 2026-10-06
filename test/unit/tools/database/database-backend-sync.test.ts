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
  beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
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

    it('waits for an in-flight create before deleting the row', async () => {
      const adapter = createMockAdapter();
      const rows = new Set<string>();
      let releaseCreate: (() => void) | undefined;
      const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });

      vi.mocked(adapter.createRow).mockImplementation(async ({ id, position, properties }) => {
        await createGate;
        rows.add(id);
        return { id, position, properties };
      });
      vi.mocked(adapter.deleteRow).mockImplementation(async ({ rowId }) => {
        rows.delete(rowId);
      });
      const sync = new DatabaseBackendSync(adapter);

      const creation = sync.syncCreateRow({ id: 'r1', properties: {}, position: 'a0' });
      const deletion = sync.syncDeleteRow({ rowId: 'r1' });

      await Promise.resolve();
      if (releaseCreate === undefined) throw new Error('create gate was not initialized');
      releaseCreate();
      await Promise.all([creation, deletion]);

      expect(rows.has('r1')).toBe(false);
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

    it('waits for a newly flushed row update to finish before moving', async () => {
      const adapter = createMockAdapter();
      const completions: string[] = [];
      let releaseFirstWrite: (() => void) | undefined;
      let releaseFlushedWrite: (() => void) | undefined;
      let markFlushedStarted: (() => void) | undefined;
      let markFlushedFinished: (() => void) | undefined;
      const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
      const flushedWriteGate = new Promise<void>((resolve) => { releaseFlushedWrite = resolve; });
      const flushedStarted = new Promise<void>((resolve) => { markFlushedStarted = resolve; });
      const flushedFinished = new Promise<void>((resolve) => { markFlushedFinished = resolve; });

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        if (properties.title === 'First') {
          await firstWriteGate;
          completions.push('first update');
        } else {
          markFlushedStarted?.();
          await flushedWriteGate;
          completions.push('flushed update');
          markFlushedFinished?.();
        }

        return { id: rowId, position: 'a0', properties };
      });
      vi.mocked(adapter.moveRow).mockImplementation(async ({ rowId, position }) => {
        completions.push('move');
        return { id: rowId, position, properties: {} };
      });
      const sync = new DatabaseBackendSync(adapter);

      const firstWrite = sync.syncUpdateRowNow({ rowId: 'r1', properties: { title: 'First' } });
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'Flushed' } });
      const move = sync.syncMoveRow({ rowId: 'r1', position: 'a1' });

      if (releaseFirstWrite === undefined || releaseFlushedWrite === undefined) throw new Error('write gates were not initialized');
      releaseFirstWrite();
      await flushedStarted;
      releaseFlushedWrite();
      await Promise.all([firstWrite, flushedFinished, move]);

      expect(completions).toEqual(['first update', 'flushed update', 'move']);
    });

    it('syncDeleteRow calls adapter.deleteRow', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      await sync.syncDeleteRow({ rowId: 'r1' });
      expect(adapter.deleteRow).toHaveBeenCalledWith({ rowId: 'r1' });
    });

    it('does not send a debounced update queued during deletion', async () => {
      const adapter = createMockAdapter();
      const rows = new Set(['r1']);
      let releaseDelete: (() => void) | undefined;
      const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });

      vi.mocked(adapter.deleteRow).mockImplementation(async ({ rowId }) => {
        await deleteGate;
        rows.delete(rowId);
      });
      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        rows.add(rowId);
        return { id: rowId, position: 'a0', properties };
      });
      const sync = new DatabaseBackendSync(adapter);

      const deletion = sync.syncDeleteRow({ rowId: 'r1' });
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'Late' } });

      if (releaseDelete === undefined) throw new Error('delete gate was not initialized');
      releaseDelete();
      await deletion;
      await vi.runAllTimersAsync();

      expect(rows.has('r1')).toBe(false);
    });

    it('does not write a row while its delete request is in flight', async () => {
      const adapter = createMockAdapter();
      const rows = new Set(['r1']);
      let releaseDelete: (() => void) | undefined;
      let releaseUpdate: (() => void) | undefined;
      let markDeleteApplied: (() => void) | undefined;
      const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
      const updateGate = new Promise<void>((resolve) => { releaseUpdate = resolve; });
      const deleteApplied = new Promise<void>((resolve) => { markDeleteApplied = resolve; });

      vi.mocked(adapter.deleteRow).mockImplementation(async ({ rowId }) => {
        await deleteGate;
        rows.delete(rowId);
        markDeleteApplied?.();
      });
      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        await updateGate;
        rows.add(rowId);
        return { id: rowId, position: 'a0', properties };
      });
      const sync = new DatabaseBackendSync(adapter);

      const deletion = sync.syncDeleteRow({ rowId: 'r1' });
      const update = sync.syncUpdateRowNow({ rowId: 'r1', properties: { title: 'Late' } });

      if (releaseDelete === undefined || releaseUpdate === undefined) throw new Error('row write gates were not initialized');
      releaseDelete();
      await deleteApplied;
      releaseUpdate();
      await Promise.all([deletion, update]);

      expect(rows.has('r1')).toBe(false);
    });

    it('waits for an in-flight move before deleting the row', async () => {
      const adapter = createMockAdapter();
      const rows = new Set(['r1']);
      let releaseMove: (() => void) | undefined;
      const moveGate = new Promise<void>((resolve) => { releaseMove = resolve; });

      vi.mocked(adapter.moveRow).mockImplementation(async ({ rowId, position }) => {
        await moveGate;
        rows.add(rowId);
        return { id: rowId, position, properties: {} };
      });
      vi.mocked(adapter.deleteRow).mockImplementation(async ({ rowId }) => {
        rows.delete(rowId);
      });
      const sync = new DatabaseBackendSync(adapter);

      const move = sync.syncMoveRow({ rowId: 'r1', position: 'a1' });
      const deletion = sync.syncDeleteRow({ rowId: 'r1' });

      await Promise.resolve();
      if (releaseMove === undefined) throw new Error('move gate was not initialized');
      releaseMove();
      await Promise.all([move, deletion]);

      expect(rows.has('r1')).toBe(false);
    });

    it('does not recreate a deleted row when an immediate body write finishes late', async () => {
      const adapter = createMockAdapter();
      const rows = new Set(['r1']);
      let releaseWrite: (() => void) | undefined;
      const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        await writeGate;
        rows.add(rowId);
        return { id: rowId, position: 'a0', properties };
      });
      vi.mocked(adapter.deleteRow).mockImplementation(async ({ rowId }) => {
        rows.delete(rowId);
      });
      const sync = new DatabaseBackendSync(adapter);

      const write = sync.syncUpdateRowNow({ rowId: 'r1', properties: { body: { blocks: [] } } });
      const deletion = sync.syncDeleteRow({ rowId: 'r1' });

      await Promise.resolve();
      if (releaseWrite === undefined) throw new Error('body write gate was not initialized');
      releaseWrite();
      await Promise.all([write, deletion]);

      expect(rows.has('r1')).toBe(false);
    });

    it('does not recreate a deleted row when a newer immediate write starts during an earlier write', async () => {
      const adapter = createMockAdapter();
      const rows = new Set(['r1']);
      let releaseOlderWrite: (() => void) | undefined;
      let releaseNewerWrite: (() => void) | undefined;
      let markNewerStarted: (() => void) | undefined;
      const olderWriteGate = new Promise<void>((resolve) => { releaseOlderWrite = resolve; });
      const newerWriteGate = new Promise<void>((resolve) => { releaseNewerWrite = resolve; });
      const newerStarted = new Promise<void>((resolve) => { markNewerStarted = resolve; });

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        if (properties.title === 'Older') {
          await olderWriteGate;
        } else {
          markNewerStarted?.();
          await newerWriteGate;
        }
        rows.add(rowId);
        return { id: rowId, position: 'a0', properties };
      });
      vi.mocked(adapter.deleteRow).mockImplementation(async ({ rowId }) => {
        rows.delete(rowId);
      });
      const sync = new DatabaseBackendSync(adapter);

      const olderWrite = sync.syncUpdateRowNow({ rowId: 'r1', properties: { title: 'Older' } });
      const deletion = sync.syncDeleteRow({ rowId: 'r1' });
      const newerWrite = sync.syncUpdateRowNow({ rowId: 'r1', properties: { title: 'Newer' } });

      if (releaseOlderWrite === undefined || releaseNewerWrite === undefined) throw new Error('write gates were not initialized');
      releaseOlderWrite();
      await newerStarted;
      releaseNewerWrite();
      await Promise.all([olderWrite, newerWrite, deletion]);

      expect(rows.has('r1')).toBe(false);
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

    it('keeps queued title and status after an immediate body write fails', async () => {
      const adapter = createMockAdapter();
      const successfulWrites: Array<Parameters<DatabaseAdapter['updateRow']>[0]> = [];
      let attempts = 0;

      vi.mocked(adapter.updateRow).mockImplementation(async (params) => {
        attempts += 1;
        if (attempts === 1) throw new Error('body write failed');
        successfulWrites.push(params);
        return { id: params.rowId, position: 'a0', properties: params.properties };
      });
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'Renamed' } });
      sync.syncUpdateRow({ rowId: 'r1', properties: { status: 'done' } });
      await expect(sync.syncUpdateRowNow({
        rowId: 'r1',
        properties: { body: { blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Body' } }] } },
      })).resolves.toBeUndefined();
      expect(attempts).toBe(1);

      sync.flushPendingUpdates();
      await vi.runAllTimersAsync();
      expect(successfulWrites).toHaveLength(1);
      expect(successfulWrites[0]).toMatchObject({
        rowId: 'r1', properties: { title: 'Renamed', status: 'done' },
      });
    });

    it('keeps a newer flushed title after an older immediate body write fails', async () => {
      const adapter = createMockAdapter();
      let releaseBodyWrite: (() => void) | undefined;
      const bodyWriteGate = new Promise<void>((resolve) => { releaseBodyWrite = resolve; });
      let storedTitle = 'Original';
      let writes = 0;

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        writes += 1;
        if (writes === 1) {
          await bodyWriteGate;
          throw new Error('body write failed');
        }
        if (typeof properties.title === 'string') storedTitle = properties.title;
        return { id: rowId, position: 'a0', properties };
      });
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      const bodyWrite = sync.syncUpdateRowNow({ rowId: 'r1', properties: { body: { blocks: [] } } });

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'C' } });
      vi.advanceTimersByTime(500);
      if (releaseBodyWrite === undefined) throw new Error('body write gate was not initialized');
      releaseBodyWrite();
      await bodyWrite;
      await vi.runAllTimersAsync();

      expect(storedTitle).toBe('C');
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

  describe('syncUpdatePropertyDebounced', () => {
    it('does not call adapter immediately', () => {
      vi.useFakeTimers();
      const adapter = { updateProperty: vi.fn().mockResolvedValue(undefined) } as unknown as DatabaseAdapter;
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { config: { options: [] } } });

      expect(adapter.updateProperty).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('calls adapter after debounce delay', async () => {
      vi.useFakeTimers();
      const adapter = { updateProperty: vi.fn().mockResolvedValue(undefined) } as unknown as DatabaseAdapter;
      const sync = new DatabaseBackendSync(adapter);
      const params = { propertyId: 'p1', changes: { config: { options: [] } } };

      sync.syncUpdatePropertyDebounced(params);
      await vi.runAllTimersAsync();

      expect(adapter.updateProperty).toHaveBeenCalledOnce();
      expect(adapter.updateProperty).toHaveBeenCalledWith(params);
      vi.useRealTimers();
    });

    it('coalesces rapid calls — only the last one fires', async () => {
      vi.useFakeTimers();
      const adapter = { updateProperty: vi.fn().mockResolvedValue(undefined) } as unknown as DatabaseAdapter;
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { config: { options: [{ id: 'o1', label: 'A', position: 'a0' }] } } });
      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { config: { options: [{ id: 'o1', label: 'B', position: 'a0' }] } } });
      await vi.runAllTimersAsync();

      expect(adapter.updateProperty).toHaveBeenCalledOnce();
      expect(adapter.updateProperty).toHaveBeenCalledWith({
        propertyId: 'p1',
        changes: { config: { options: [{ id: 'o1', label: 'B', position: 'a0' }] } },
      });
      vi.useRealTimers();
    });

    it('uses a separate timer per propertyId', async () => {
      vi.useFakeTimers();
      const adapter = { updateProperty: vi.fn().mockResolvedValue(undefined) } as unknown as DatabaseAdapter;
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { config: { options: [] } } });
      sync.syncUpdatePropertyDebounced({ propertyId: 'p2', changes: { config: { options: [] } } });
      await vi.runAllTimersAsync();

      expect(adapter.updateProperty).toHaveBeenCalledTimes(2);

      // Verify each propertyId was synced independently
      const calls = (adapter.updateProperty as ReturnType<typeof vi.fn>).mock.calls;

      expect(calls.map((c: unknown[]) => (c[0] as { propertyId: string }).propertyId)).toEqual(['p1', 'p2']);
      vi.useRealTimers();
    });

    it('cancels pending property timer on destroy', () => {
      vi.useFakeTimers();
      const adapter = { updateProperty: vi.fn().mockResolvedValue(undefined) } as unknown as DatabaseAdapter;
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { config: { options: [] } } });
      sync.destroy();
      vi.runAllTimers();

      // destroy should clear the timer — adapter must NOT be called after destroy
      expect(adapter.updateProperty).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe('flush and destroy', () => {
    it('does not retry a failed write from a destroyed view over a new view', async () => {
      const adapter = createMockAdapter();
      let rejectOldWrite: ((error: Error) => void) | undefined;
      const oldWriteGate = new Promise<void>((_resolve, reject) => { rejectOldWrite = reject; });
      let persistedTitle = '';

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        if (properties.body !== undefined) await oldWriteGate;
        if (typeof properties.title === 'string') persistedTitle = properties.title;
        return { id: rowId, position: 'a0', properties };
      });
      const oldView = new DatabaseBackendSync(adapter);

      oldView.syncUpdateRow({ rowId: 'r1', properties: { title: 'Old' } });
      const oldWrite = oldView.syncUpdateRowNow({ rowId: 'r1', properties: { body: { blocks: [] } } });
      oldView.destroy();

      const newView = new DatabaseBackendSync(adapter);
      await newView.syncUpdateRowNow({ rowId: 'r1', properties: { title: 'New' } });
      if (rejectOldWrite === undefined) throw new Error('old write gate was not initialized');
      rejectOldWrite(new Error('old write failed'));
      await oldWrite;
      await vi.runAllTimersAsync();

      expect(persistedTitle).toBe('New');
    });

    it('flushes a timer-expired update before teardown', async () => {
      const adapter = createMockAdapter();
      let releaseOldWrite: (() => void) | undefined;
      const oldWriteGate = new Promise<void>((resolve) => { releaseOldWrite = resolve; });
      let persistedTitle = '';

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        if (properties.title === 'Old') await oldWriteGate;
        if (typeof properties.title === 'string') persistedTitle = properties.title;
        return { id: rowId, position: 'a0', properties };
      });
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'Old' } });
      vi.advanceTimersByTime(500);
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'New' } });
      vi.advanceTimersByTime(500);
      sync.flushPendingUpdates();
      sync.destroy();

      if (releaseOldWrite === undefined) throw new Error('old write did not start');
      releaseOldWrite();
      await vi.runAllTimersAsync();

      expect(persistedTitle).toBe('New');
    });

    it('flushes an update queued behind an in-flight write before destroy', async () => {
      const adapter = createMockAdapter();
      let releaseFirstWrite: (() => void) | undefined;
      const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
      let persistedTitle = '';

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        if (properties.title === 'Old') await firstWriteGate;
        if (typeof properties.title === 'string') persistedTitle = properties.title;
        return { id: rowId, position: 'a0', properties };
      });
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'Old' } });
      vi.advanceTimersByTime(500);
      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'New' } });
      sync.flushPendingUpdates();
      sync.destroy();

      if (releaseFirstWrite === undefined) throw new Error('first write did not start');
      releaseFirstWrite();
      await vi.runAllTimersAsync();

      expect(persistedTitle).toBe('New');
    });

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

  describe('flushPendingPropertyUpdates', () => {
    it('immediately flushes pending property updates', async () => {
      vi.useFakeTimers();
      const adapter = { updateProperty: vi.fn().mockResolvedValue(undefined) } as unknown as DatabaseAdapter;
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdatePropertyDebounced({ propertyId: 'p1', changes: { config: { options: [] } } });
      sync.flushPendingPropertyUpdates();

      // should fire immediately without waiting for timer
      expect(adapter.updateProperty).toHaveBeenCalledOnce();
      vi.useRealTimers();
    });

    it('is a no-op when no pending property updates exist', () => {
      const adapter = { updateProperty: vi.fn().mockResolvedValue(undefined) } as unknown as DatabaseAdapter;
      const sync = new DatabaseBackendSync(adapter);

      expect(() => sync.flushPendingPropertyUpdates()).not.toThrow();
      expect(adapter.updateProperty).not.toHaveBeenCalled();
    });
  });
});
