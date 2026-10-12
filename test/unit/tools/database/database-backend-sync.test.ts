import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { DatabaseBackendSync } from '../../../../src/tools/database/database-backend-sync';
import type { DatabaseAdapter, PropertyDefinition } from '../../../../src/tools/database/types';
import type { BlockReplayCapture, BlockReplayNative } from '../../../../types/events/editor-events';

/** JSON.parse makes "__proto__" an own key; an object literal would set the prototype instead. */
const poisoned = (text: string): unknown => JSON.parse(text);

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
    it('still holds a row whose backend delete failed', async () => {
      const adapter = createMockAdapter();

      vi.mocked(adapter.deleteRow).mockRejectedValue(new Error('offline'));
      const sync = new DatabaseBackendSync(adapter, () => undefined);

      await sync.syncCreateRow({ id: 'r1', properties: {}, position: 'a0' });
      await sync.syncDeleteRow({ rowId: 'r1' });

      expect(sync.holdsRow('r1')).toBe(true);
    });

    it('does not hold a row whose backend create failed', async () => {
      const adapter = createMockAdapter();

      vi.mocked(adapter.createRow).mockRejectedValue(new Error('offline'));
      const sync = new DatabaseBackendSync(adapter, () => undefined);

      await sync.syncCreateRow({ id: 'r1', properties: {}, position: 'a0' });

      expect(sync.holdsRow('r1')).toBe(false);
    });

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

    it('refuses a forward write requested after deletion while an earlier write is pending', async () => {
      const adapter = createMockAdapter();
      const rows = new Set(['r1']);
      let releaseOlderWrite: (() => void) | undefined;
      const olderWriteGate = new Promise<void>((resolve) => { releaseOlderWrite = resolve; });

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        if (properties.title === 'Older') await olderWriteGate;
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

      if (releaseOlderWrite === undefined) throw new Error('older write gate was not initialized');
      releaseOlderWrite();
      await Promise.all([olderWrite, newerWrite, deletion]);

      expect(vi.mocked(adapter.updateRow).mock.calls).toEqual([
        [{ rowId: 'r1', properties: { title: 'Older' } }],
      ]);
      expect(rows.has('r1')).toBe(false);
    });

    it('keeps a reentrant delete behind its adapter update without deferring the update call', async () => {
      const adapter = createMockAdapter();
      const rows = new Set(['r1']);
      const order: string[] = [];
      const sync = new DatabaseBackendSync(adapter);
      let deletion: Promise<void> | undefined;
      let releaseWrite: (() => void) | undefined;
      const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve; });

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        order.push('write started');
        deletion = sync.syncDeleteRow({ rowId });
        await writeGate;
        rows.add(rowId);
        order.push('write finished');
        return { id: rowId, position: 'a0', properties };
      });
      vi.mocked(adapter.deleteRow).mockImplementation(async ({ rowId }) => {
        rows.delete(rowId);
        order.push('delete');
      });
      const writing = sync.syncUpdateRowNow({ rowId: 'r1', properties: { notes: 'changed' } });
      const startedInSameTick = vi.mocked(adapter.updateRow).mock.calls.length === 1;

      if (releaseWrite === undefined) throw new Error('write gate was not initialized');
      releaseWrite();
      await writing;
      if (deletion === undefined) throw new Error('adapter did not request deletion');
      await deletion;

      expect(rows.has('r1')).toBe(false);
      expect(startedInSameTick).toBe(true);
      expect(order).toEqual(['write started', 'write finished', 'delete']);
    });

    it('sends an expired unrelated pending field as soon as replay releases its row', async () => {
      const adapter = createMockAdapter();
      const observer = { created: vi.fn(), updated: vi.fn() };
      const started = Date.now();
      const deliveries: Array<{
        at: number;
        params: Parameters<DatabaseAdapter['updateRow']>[0];
      }> = [];
      let releaseReplay: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => { releaseReplay = resolve; });

      vi.mocked(adapter.updateRow).mockImplementation(async (params) => {
        deliveries.push({
          at: Date.now() - started,
          params: { ...params, properties: { ...params.properties } },
        });
        if (params.properties.notes === 'short') await gate;
        return { id: params.rowId, position: 'a0', properties: params.properties };
      });
      const sync = new DatabaseBackendSync(adapter, undefined, observer);

      sync.syncUpdateRow({ rowId: 'r1', properties: { notes: 'changed', amount: 22 } });
      await vi.advanceTimersByTimeAsync(200);
      sync.syncReplayRow({
        blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes: [{
          path: ['properties', 'notes'],
          beforePresent: true, afterPresent: true, after: 'short',
        }],
      });
      await vi.advanceTimersByTimeAsync(450);
      if (releaseReplay === undefined) throw new Error('replay gate was not initialized');
      releaseReplay();
      await vi.advanceTimersByTimeAsync(0);

      expect(deliveries).toEqual([
        { at: 200, params: { rowId: 'r1', properties: { notes: 'short' } } },
        { at: 650, params: { rowId: 'r1', properties: { amount: 22 } } },
      ]);
      await vi.runAllTimersAsync();

      expect(deliveries).toHaveLength(2);
      expect(observer.updated).toHaveBeenCalledTimes(1);
      expect(observer.created).not.toHaveBeenCalled();
    });

    it('keeps a newer unrelated pending field out of the replay patch', async () => {
      const adapter = createMockAdapter();
      const observer = { created: vi.fn(), updated: vi.fn() };
      let releaseReplay: (() => void) | undefined;
      const replayGate = new Promise<void>((resolve) => { releaseReplay = resolve; });

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        if (properties.notes === 'short') await replayGate;
        return { id: rowId, position: 'a0', properties };
      });
      const sync = new DatabaseBackendSync(adapter, undefined, observer);

      sync.syncUpdateRow({ rowId: 'r1', properties: { notes: 'changed', amount: 22 } });
      sync.syncReplayRow({
        blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes: [{
          path: ['properties', 'notes'],
          beforePresent: true, afterPresent: true, after: 'short',
        }],
      });
      sync.syncUpdateRow({ rowId: 'r1', properties: { amount: 33 } });
      await vi.advanceTimersByTimeAsync(500);

      expect(vi.mocked(adapter.updateRow).mock.calls).toEqual([
        [{ rowId: 'r1', properties: { notes: 'short' } }],
      ]);

      if (releaseReplay === undefined) throw new Error('replay gate was not initialized');
      releaseReplay();
      await vi.runAllTimersAsync();

      expect(vi.mocked(adapter.updateRow).mock.calls).toEqual([
        [{ rowId: 'r1', properties: { notes: 'short' } }],
        [{ rowId: 'r1', properties: { amount: 33 } }],
      ]);
      expect(observer.updated).toHaveBeenCalledTimes(2);
      expect(observer.created).not.toHaveBeenCalled();
    });

    it('queues replay creation behind a pending delete without running automation', async () => {
      const adapter = createMockAdapter();
      const observer = { created: vi.fn(), updated: vi.fn() };
      const rows = new Map<string, { properties: Record<string, unknown>; template?: boolean }>();
      const order: string[] = [];
      let releaseDelete: (() => void) | undefined;
      const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });

      vi.mocked(adapter.deleteRow).mockImplementation(async ({ rowId }) => {
        order.push('delete started');
        await deleteGate;
        rows.delete(rowId);
        order.push('delete ended');
      });
      vi.mocked(adapter.createRow).mockImplementation(async ({ id, properties, position, template }) => {
        rows.set(id, { properties, template });
        order.push('create');
        return { id, properties, position };
      });
      const sync = new DatabaseBackendSync(adapter, undefined, observer);
      const deletion = sync.syncDeleteRow({ rowId: 'r1' });

      sync.syncReplayRow({
        blockId: 'r1', type: 'add', origin: 'undo', scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: true, value: true },
        },
        changes: [
          { path: ['properties'], beforePresent: false, afterPresent: true, after: { t: 'Template' } },
          { path: ['position'], beforePresent: false, afterPresent: true, after: 'a2' },
          { path: ['template'], beforePresent: false, afterPresent: true, after: true },
        ],
      });
      await Promise.resolve();

      expect(adapter.createRow).not.toHaveBeenCalled();

      if (releaseDelete === undefined) throw new Error('delete gate was not initialized');
      releaseDelete();
      await deletion;
      await vi.runAllTimersAsync();

      expect(rows.get('r1')).toEqual({ properties: { t: 'Template' }, template: true });
      expect(order).toEqual(['delete started', 'delete ended', 'create']);
      expect(observer.created).not.toHaveBeenCalled();
      expect(observer.updated).not.toHaveBeenCalled();
    });

    it('serializes a forward delete, replay creation and replay removal', async () => {
      const adapter = createMockAdapter();
      const rows = new Set(['r1']);
      const order: string[] = [];
      let releaseDelete: (() => void) | undefined;
      const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });

      vi.mocked(adapter.deleteRow).mockImplementation(async ({ rowId }) => {
        order.push('delete started');
        await deleteGate;
        rows.delete(rowId);
        order.push('delete ended');
      });
      vi.mocked(adapter.createRow).mockImplementation(async ({ id, properties, position }) => {
        rows.add(id);
        order.push('create');
        return { id, properties, position };
      });
      const sync = new DatabaseBackendSync(adapter);
      const deletion = sync.syncDeleteRow({ rowId: 'r1' });

      sync.syncReplayRow({
        blockId: 'r1', type: 'add', origin: 'undo', scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes: [
          { path: ['properties'], beforePresent: false, afterPresent: true, after: { t: 'Restored' } },
          { path: ['position'], beforePresent: false, afterPresent: true, after: 'a0' },
        ],
      });
      sync.syncReplayRow({
        blockId: 'r1', type: 'remove', origin: 'redo', scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes: [],
      });

      if (releaseDelete === undefined) throw new Error('delete gate was not initialized');
      releaseDelete();
      await deletion;
      await vi.runAllTimersAsync();

      expect(rows.has('r1')).toBe(false);
      expect(order).toEqual([
        'delete started', 'delete ended', 'create', 'delete started', 'delete ended',
      ]);
    });

    it('keeps both captured replay writes before a reentrant row delete', async () => {
      const adapter = createMockAdapter();
      const rows = new Set(['r1']);
      const order: string[] = [];
      const sync = new DatabaseBackendSync(adapter);
      let deletion: Promise<void> | undefined;
      let markMoved: (() => void) | undefined;
      const moved = new Promise<void>((resolve) => { markMoved = resolve; });

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        order.push('update');
        deletion = sync.syncDeleteRow({ rowId });
        rows.add(rowId);
        return { id: rowId, position: 'a0', properties };
      });
      vi.mocked(adapter.moveRow).mockImplementation(async ({ rowId, position }) => {
        order.push('move');
        rows.add(rowId);
        markMoved?.();
        return { id: rowId, position, properties: { notes: 'short' } };
      });
      vi.mocked(adapter.deleteRow).mockImplementation(async ({ rowId }) => {
        order.push('delete');
        rows.delete(rowId);
      });
      const capture: BlockReplayCapture = {
        blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes: [
          { path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' },
          { path: ['position'], beforePresent: true, afterPresent: true, after: 'a2' },
        ],
      };

      sync.syncReplayRow(capture);
      const startedInSameTick = vi.mocked(adapter.updateRow).mock.calls.length === 1;

      if (deletion === undefined) throw new Error('adapter did not request deletion');
      await Promise.all([deletion, moved]);

      expect(rows.has('r1')).toBe(false);
      expect(order).toEqual(['update', 'move', 'delete']);
      expect(startedInSameTick).toBe(true);
    });

    it('queues a captured inverse behind an in-flight forward write', async () => {
      const adapter = createMockAdapter();
      let releaseForward: (() => void) | undefined;
      const forwardGate = new Promise<void>((resolve) => { releaseForward = resolve; });
      let savedNotes = '';

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        if (properties.notes === 'changed') await forwardGate;
        if (typeof properties.notes === 'string') savedNotes = properties.notes;
        return { id: rowId, position: 'a0', properties };
      });
      const sync = new DatabaseBackendSync(adapter);
      const forward = sync.syncUpdateRowNow({ rowId: 'r1', properties: { notes: 'changed' } });

      sync.syncReplayRow({
        blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes: [{
          path: ['properties', 'notes'],
          beforePresent: true, afterPresent: true, after: 'short',
        }],
      });
      if (releaseForward === undefined) throw new Error('forward gate was not initialized');
      releaseForward();
      await forward;
      await vi.runAllTimersAsync();

      expect(savedNotes).toBe('short');
      expect(vi.mocked(adapter.updateRow).mock.calls).toEqual([
        [{ rowId: 'r1', properties: { notes: 'changed' } }],
        [{ rowId: 'r1', properties: { notes: 'short' } }],
      ]);
    });

    it.each<{
      reason: string;
      rejected: Pick<BlockReplayCapture, 'type' | 'origin' | 'scope' | 'changes'>;
    }>([
      {
        reason: 'a missing after slot',
        rejected: {
          type: 'update', origin: 'undo', scope: 'keys',
          changes: [
            { path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' },
            { path: ['properties', 'amount'], beforePresent: true, afterPresent: true },
          ],
        },
      },
      {
        reason: 'a non-finite tail after valid property and position slots',
        rejected: {
          type: 'update', origin: 'undo', scope: 'keys',
          changes: [
            { path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' },
            { path: ['position'], beforePresent: true, afterPresent: true, after: 'a2' },
            { path: ['properties', 'amount'], beforePresent: true, afterPresent: true, after: Number.POSITIVE_INFINITY },
          ],
        },
      },
      {
        reason: 'replacement scope',
        rejected: {
          type: 'update', origin: 'undo', scope: 'replacement',
          changes: [
            { path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' },
          ],
        },
      },
      {
        reason: 'remote origin',
        rejected: {
          type: 'update', origin: 'remote', scope: 'keys',
          changes: [
            { path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' },
          ],
        },
      },
      {
        reason: 'a malformed birth position',
        rejected: {
          type: 'add', origin: 'redo', scope: 'keys',
          changes: [
            { path: ['properties'], beforePresent: false, afterPresent: true, after: { notes: 'short' } },
            { path: ['position'], beforePresent: false, afterPresent: true },
          ],
        },
      },
      {
        reason: 'a removal carrying changes',
        rejected: {
          type: 'remove', origin: 'undo', scope: 'keys',
          changes: [
            { path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' },
          ],
        },
      },
    ])('keeps pending patches at their original deadlines after rejecting $reason', async ({ rejected }) => {
      const adapter = createMockAdapter();
      const observer = { created: vi.fn(), updated: vi.fn() };
      type StoredRow = Awaited<ReturnType<DatabaseAdapter['updateRow']>>;
      const rows = new Map<string, StoredRow>([
        ['r1', { id: 'r1', position: 'a0', properties: { notes: 'stored', status: 'stored', amount: 12 } }],
        ['r2', { id: 'r2', position: 'a1', properties: { notes: 'other', amount: 12 } }],
      ]);
      const started = Date.now();
      const deliveries: Array<
        | { at: number; operation: 'update'; params: Parameters<DatabaseAdapter['updateRow']>[0] }
        | { at: number; operation: 'create'; params: Parameters<DatabaseAdapter['createRow']>[0] }
        | { at: number; operation: 'move'; params: Parameters<DatabaseAdapter['moveRow']>[0] }
        | { at: number; operation: 'delete'; params: Parameters<DatabaseAdapter['deleteRow']>[0] }
      > = [];

      vi.mocked(adapter.updateRow).mockImplementation(async (params) => {
        deliveries.push({
          at: Date.now() - started, operation: 'update',
          params: { ...params, properties: { ...params.properties } },
        });
        const previous = rows.get(params.rowId);

        if (previous === undefined) throw new Error('updated row does not exist');
        const row = { ...previous, properties: { ...previous.properties, ...params.properties } };

        rows.set(params.rowId, row);
        return row;
      });
      vi.mocked(adapter.createRow).mockImplementation(async (params) => {
        deliveries.push({
          at: Date.now() - started, operation: 'create',
          params: { ...params, properties: { ...params.properties } },
        });
        const row = { id: params.id, position: params.position, properties: { ...params.properties } };

        rows.set(params.id, row);
        return row;
      });
      vi.mocked(adapter.moveRow).mockImplementation(async (params) => {
        deliveries.push({ at: Date.now() - started, operation: 'move', params: { ...params } });
        const previous = rows.get(params.rowId);

        if (previous === undefined) throw new Error('moved row does not exist');
        const row = { ...previous, position: params.position };

        rows.set(params.rowId, row);
        return row;
      });
      vi.mocked(adapter.deleteRow).mockImplementation(async (params) => {
        deliveries.push({ at: Date.now() - started, operation: 'delete', params: { ...params } });
        rows.delete(params.rowId);
      });
      const sync = new DatabaseBackendSync(adapter, undefined, observer);

      sync.syncUpdateRow({ rowId: 'r1', properties: { notes: 'changed', status: 'done' } });
      await vi.advanceTimersByTimeAsync(100);
      sync.syncUpdateRow({ rowId: 'r2', properties: { amount: 33 } });
      await vi.advanceTimersByTimeAsync(100);
      sync.syncReplayRow({
        blockId: 'r1',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        ...rejected,
      });
      await vi.advanceTimersByTimeAsync(400);

      expect(deliveries).toEqual([
        {
          at: 500, operation: 'update',
          params: { rowId: 'r1', properties: { notes: 'changed', status: 'done' } },
        },
        {
          at: 600, operation: 'update',
          params: { rowId: 'r2', properties: { amount: 33 } },
        },
      ]);
      await vi.runAllTimersAsync();

      expect(deliveries).toHaveLength(2);
      expect(Array.from(rows.values())).toEqual([
        { id: 'r1', position: 'a0', properties: { notes: 'changed', status: 'done', amount: 12 } },
        { id: 'r2', position: 'a1', properties: { notes: 'other', amount: 33 } },
      ]);
      expect(observer.updated.mock.calls).toEqual([
        [{ rowId: 'r1', properties: { notes: 'changed', status: 'done' } }],
        [{ rowId: 'r2', properties: { amount: 33 } }],
      ]);
      expect(observer.created).not.toHaveBeenCalled();
    });

    describe('structured property replay', () => {
      const replay = (
        changes: BlockReplayCapture['changes'],
        origin: 'undo' | 'redo' = 'undo',
      ): BlockReplayCapture => ({
        blockId: 'r1', type: 'update', origin, scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes,
      });
      const direct = (after: unknown): BlockReplayCapture['changes'][number] => ({
        path: ['properties', 'structured'],
        beforePresent: true, afterPresent: true, after,
      });

      it.each<{
        name: string;
        origin: 'undo' | 'redo';
        after: unknown;
        expected: unknown;
      }>([
        {
          name: 'relation undo', origin: 'undo',
          after: Object.freeze([Object.freeze({ id: 'related-a' }), Object.freeze({ id: 'related-b' })]),
          expected: [{ id: 'related-a' }, { id: 'related-b' }],
        },
        {
          name: 'relation redo', origin: 'redo',
          after: Object.freeze([Object.freeze({ id: 'related-b' }), Object.freeze({ id: 'related-a' })]),
          expected: [{ id: 'related-b' }, { id: 'related-a' }],
        },
        {
          name: 'files undo', origin: 'undo',
          after: Object.freeze([
            Object.freeze({ id: 'file-a', name: 'Before.txt', url: 'https://example.invalid/a.txt' }),
          ]),
          expected: [{ id: 'file-a', name: 'Before.txt', url: 'https://example.invalid/a.txt' }],
        },
        {
          name: 'files redo', origin: 'redo',
          after: Object.freeze([
            Object.freeze({ id: 'file-b', name: 'Second.txt', url: 'https://example.invalid/b.txt' }),
            Object.freeze({ id: 'file-a', name: 'After.txt', url: 'https://example.invalid/a.txt' }),
          ]),
          expected: [
            { id: 'file-b', name: 'Second.txt', url: 'https://example.invalid/b.txt' },
            { id: 'file-a', name: 'After.txt', url: 'https://example.invalid/a.txt' },
          ],
        },
        { name: 'empty undo', origin: 'undo', after: Object.freeze([]), expected: [] },
        { name: 'empty redo', origin: 'redo', after: Object.freeze([]), expected: [] },
      ])('persists $name without flushing an unrelated pending field early', async ({ origin, after, expected }) => {
        const adapter = createMockAdapter();
        const observer = { created: vi.fn(), updated: vi.fn() };
        const stored: { properties: Parameters<DatabaseAdapter['updateRow']>[0]['properties'] } = {
          properties: { structured: [{ id: 'stored' }], status: 'stored' },
        };
        const deliveries: Array<{
          at: number;
          params: Parameters<DatabaseAdapter['updateRow']>[0];
        }> = [];
        const started = Date.now();

        vi.mocked(adapter.updateRow).mockImplementation(async (params) => {
          deliveries.push({ at: Date.now() - started, params });
          stored.properties = { ...stored.properties, ...params.properties };
          return { id: params.rowId, position: 'a0', properties: stored.properties };
        });
        const sync = new DatabaseBackendSync(adapter, undefined, observer);

        sync.syncUpdateRow({
          rowId: 'r1', properties: { structured: [{ id: 'pending' }], status: 'done' },
        });
        await vi.advanceTimersByTimeAsync(100);
        sync.syncReplayRow(replay([direct(after)], origin));
        await vi.advanceTimersByTimeAsync(0);

        expect(stored.properties.structured).toEqual(expected);
        expect(deliveries).toEqual([{
          at: 100, params: { rowId: 'r1', properties: { structured: expected } },
        }]);
        expect(stored.properties.status).toBe('stored');
        await vi.advanceTimersByTimeAsync(400);
        expect(deliveries).toEqual([
          { at: 100, params: { rowId: 'r1', properties: { structured: expected } } },
          { at: 500, params: { rowId: 'r1', properties: { status: 'done' } } },
        ]);
        expect(stored.properties).toEqual({ structured: expected, status: 'done' });
        expect(observer.updated.mock.calls).toEqual([[
          { rowId: 'r1', properties: { structured: [{ id: 'pending' }], status: 'done' } },
        ]]);
        expect(observer.created).not.toHaveBeenCalled();
      });

      it.each<{
        name: string;
        after: unknown;
        expected: unknown;
      }>([
        { name: 'relations', after: Object.freeze([Object.freeze({ id: 'inverse' })]), expected: [{ id: 'inverse' }] },
        {
          name: 'files',
          after: Object.freeze([
            Object.freeze({ id: 'file-a', name: 'Before.txt', url: 'https://example.invalid/a.txt' }),
          ]),
          expected: [{ id: 'file-a', name: 'Before.txt', url: 'https://example.invalid/a.txt' }],
        },
        { name: 'an empty array', after: Object.freeze([]), expected: [] },
      ])('does not recover stale $name after an immediate body write fails', async ({ after, expected }) => {
        const adapter = createMockAdapter();
        const observer = { created: vi.fn(), updated: vi.fn() };
        const stored: { properties: Parameters<DatabaseAdapter['updateRow']>[0]['properties'] } = {
          properties: { structured: [{ id: 'stored' }], status: 'stored' },
        };
        const successfulWrites: Array<Parameters<DatabaseAdapter['updateRow']>[0]> = [];
        const gate: { release?: () => void } = {};
        const failedWriteGate = new Promise<void>((resolve) => { gate.release = resolve; });

        vi.mocked(adapter.updateRow).mockImplementation(async (params) => {
          if (Object.hasOwn(params.properties, 'body')) {
            await failedWriteGate;
            throw new Error('body write failed');
          }
          successfulWrites.push(params);
          stored.properties = { ...stored.properties, ...params.properties };
          return { id: params.rowId, position: 'a0', properties: stored.properties };
        });
        const sync = new DatabaseBackendSync(adapter, undefined, observer);

        sync.syncUpdateRow({
          rowId: 'r1', properties: { structured: [{ id: 'pending' }], status: 'done' },
        });
        const bodyWrite = sync.syncUpdateRowNow({
          rowId: 'r1', properties: { body: { blocks: [] } },
        });

        sync.syncReplayRow(replay([direct(after)]));
        if (gate.release === undefined) throw new Error('failure gate was not initialized');
        gate.release();
        await bodyWrite;
        await vi.runAllTimersAsync();

        expect(stored.properties.structured).toEqual(expected);
        expect(successfulWrites).toEqual([
          { rowId: 'r1', properties: { structured: expected } },
          { rowId: 'r1', properties: { status: 'done' } },
        ]);
        expect(stored.properties.status).toBe('done');
        expect(observer.updated.mock.calls).toEqual([[
          { rowId: 'r1', properties: { structured: [{ id: 'pending' }], status: 'done' } },
        ]]);
        expect(observer.created).not.toHaveBeenCalled();
      });

      const rejected: Array<{
        name: string;
        after: unknown;
        path?: readonly (string | number)[];
      }> = [
        { name: 'a missing id', after: [{}] },
        { name: 'an empty id', after: [{ id: '' }] },
        { name: 'a non-string id', after: [{ id: 7 }] },
        { name: 'a file without a URL', after: [{ id: 'file-a', name: 'Report.txt' }] },
        { name: 'a file without a name', after: [{ id: 'file-a', url: 'https://example.invalid/a.txt' }] },
        { name: 'a non-string file name', after: [{ id: 'file-a', name: 7, url: 'https://example.invalid/a.txt' }] },
        { name: 'a non-finite file URL', after: [{ id: 'file-a', name: 'Report.txt', url: Number.POSITIVE_INFINITY }] },
        { name: 'a nested record', after: [{ id: 'related-a', nested: { id: 'related-b' } }] },
        { name: 'a nested array', after: [[{ id: 'related-a' }]] },
        { name: 'a shared array', after: new Y.Array<unknown>() },
        { name: 'a shared record', after: [new Y.Map<unknown>()] },
        { name: 'a non-finite scalar', after: Number.NaN },
        { name: 'an extra non-finite field', after: [{ id: 'related-a', amount: Number.POSITIVE_INFINITY }] },
        { name: 'duplicate relation ids', after: [{ id: 'related-a' }, { id: 'related-a' }] },
        {
          name: 'duplicate file ids',
          after: [
            { id: 'file-a', name: 'First.txt', url: 'https://example.invalid/a.txt' },
            { id: 'file-a', name: 'Second.txt', url: 'https://example.invalid/b.txt' },
          ],
        },
        {
          name: 'relations mixed with files',
          after: [{ id: 'related-a' }, { id: 'file-a', name: 'Report.txt', url: 'https://example.invalid/a.txt' }],
        },
        {
          name: 'files mixed with relations',
          after: [{ id: 'file-a', name: 'Report.txt', url: 'https://example.invalid/a.txt' }, { id: 'related-a' }],
        },
        { name: 'a scalar mixed with a relation', after: ['related-a', { id: 'related-b' }] },
        { name: 'a string array', after: ['related-a'] },
        { name: 'a custom record prototype', after: [new (class { readonly id = 'related-a'; })()] },
        { name: 'a nested property path', path: ['properties', 'structured', 'id'], after: [{ id: 'related-a' }] },
        { name: 'a duplicate property path', path: ['properties', 'structured'], after: [{ id: 'other' }] },
        { name: 'an array position', path: ['position'], after: [] },
      ];
      const withRejectedTail = ({ after, path }: typeof rejected[number]): BlockReplayCapture =>
        replay([
          direct(Object.freeze([Object.freeze({ id: 'captured' })])),
          { path: ['properties', 'notes'], beforePresent: true, afterPresent: true, after: 'short' },
          { path: ['position'], beforePresent: true, afterPresent: true, after: 'a2' },
          {
            path: path ?? ['properties', 'invalid'],
            beforePresent: true, afterPresent: true, after,
          },
        ]);

      it.each(rejected)('keeps every pending field at its deadline after rejecting $name', async (bad) => {
        const adapter = createMockAdapter();
        const observer = { created: vi.fn(), updated: vi.fn() };
        const stored: { properties: Parameters<DatabaseAdapter['updateRow']>[0]['properties'] } = {
          properties: { structured: [{ id: 'stored' }], notes: 'stored', status: 'stored' },
        };
        const deliveries: Array<{
          at: number;
          params: Parameters<DatabaseAdapter['updateRow']>[0];
        }> = [];
        const started = Date.now();

        vi.mocked(adapter.updateRow).mockImplementation(async (params) => {
          deliveries.push({ at: Date.now() - started, params });
          stored.properties = { ...stored.properties, ...params.properties };
          return { id: params.rowId, position: 'a0', properties: stored.properties };
        });
        const sync = new DatabaseBackendSync(adapter, undefined, observer);

        sync.syncUpdateRow({
          rowId: 'r1', properties: { structured: [{ id: 'pending' }], notes: 'changed', status: 'done' },
        });
        await vi.advanceTimersByTimeAsync(200);
        sync.syncReplayRow(withRejectedTail(bad));
        await vi.advanceTimersByTimeAsync(299);

        expect(deliveries).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(stored.properties).toEqual({
          structured: [{ id: 'pending' }], notes: 'changed', status: 'done',
        });
        expect(deliveries).toEqual([{
          at: 500,
          params: {
            rowId: 'r1', properties: { structured: [{ id: 'pending' }], notes: 'changed', status: 'done' },
          },
        }]);
        expect(adapter.moveRow).not.toHaveBeenCalled();
        expect(adapter.createRow).not.toHaveBeenCalled();
        expect(observer.updated).toHaveBeenCalledTimes(1);
        expect(observer.created).not.toHaveBeenCalled();
      });

      it.each(rejected)('keeps consumed recovery fields after rejecting $name', async (bad) => {
        const adapter = createMockAdapter();
        const observer = { created: vi.fn(), updated: vi.fn() };
        const stored: { properties: Parameters<DatabaseAdapter['updateRow']>[0]['properties'] } = {
          properties: { structured: [{ id: 'stored' }], notes: 'stored', status: 'stored' },
        };
        const successfulWrites: Array<Parameters<DatabaseAdapter['updateRow']>[0]> = [];
        const gate: { release?: () => void } = {};
        const failedWriteGate = new Promise<void>((resolve) => { gate.release = resolve; });

        vi.mocked(adapter.updateRow).mockImplementation(async (params) => {
          if (Object.hasOwn(params.properties, 'body')) {
            await failedWriteGate;
            throw new Error('body write failed');
          }
          successfulWrites.push(params);
          stored.properties = { ...stored.properties, ...params.properties };
          return { id: params.rowId, position: 'a0', properties: stored.properties };
        });
        const sync = new DatabaseBackendSync(adapter, undefined, observer);

        sync.syncUpdateRow({
          rowId: 'r1', properties: { structured: [{ id: 'pending' }], notes: 'changed', status: 'done' },
        });
        const bodyWrite = sync.syncUpdateRowNow({
          rowId: 'r1', properties: { body: { blocks: [] } },
        });

        sync.syncReplayRow(withRejectedTail(bad));
        if (gate.release === undefined) throw new Error('failure gate was not initialized');
        gate.release();
        await bodyWrite;
        await vi.runAllTimersAsync();

        expect(stored.properties).toEqual({
          structured: [{ id: 'pending' }], notes: 'changed', status: 'done',
        });
        expect(successfulWrites).toEqual([{
          rowId: 'r1', properties: { structured: [{ id: 'pending' }], notes: 'changed', status: 'done' },
        }]);
        expect(adapter.moveRow).not.toHaveBeenCalled();
        expect(adapter.createRow).not.toHaveBeenCalled();
        expect(observer.updated).toHaveBeenCalledTimes(1);
        expect(observer.created).not.toHaveBeenCalled();
      });

      it.each<{
        name: string;
        overrides: Partial<Pick<BlockReplayCapture, 'origin' | 'scope' | 'native'>>;
      }>([
        { name: 'remote', overrides: { origin: 'remote' } },
        { name: 'unknown', overrides: { scope: 'unknown' } },
        { name: 'replacement', overrides: { scope: 'replacement' } },
        { name: 'another native type', overrides: {
          native: { type: 'paragraph', parent: { present: true, value: 'db' }, template: { present: false } },
        } },
      ])('does not authorize structured values from $name captures', async ({ overrides }) => {
        const adapter = createMockAdapter();
        const sync = new DatabaseBackendSync(adapter);

        sync.syncReplayRow({ ...replay([direct([{ id: 'captured' }])]), ...overrides });
        await vi.runAllTimersAsync();

        expect(adapter.updateRow).not.toHaveBeenCalled();
        expect(adapter.createRow).not.toHaveBeenCalled();
        expect(adapter.moveRow).not.toHaveBeenCalled();
      });

      it('keeps structured row births outside scalar-only creation replay', async () => {
        const adapter = createMockAdapter();
        const sync = new DatabaseBackendSync(adapter);

        sync.syncReplayRow({
          ...replay([]), type: 'add', origin: 'redo',
          changes: [
            { path: ['properties'], beforePresent: false, afterPresent: true, after: { structured: [{ id: 'related-a' }] } },
            { path: ['position'], beforePresent: false, afterPresent: true, after: 'a0' },
          ],
        });
        await vi.runAllTimersAsync();

        expect(adapter.createRow).not.toHaveBeenCalled();
        expect(adapter.updateRow).not.toHaveBeenCalled();
        expect(adapter.moveRow).not.toHaveBeenCalled();
      });
    });

    it('does not authorize remote, unknown, replacement, nested or unsupported values', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      const base: BlockReplayCapture = {
        blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes: [{
          path: ['properties', 'notes'],
          beforePresent: true, afterPresent: true, after: 'short',
        }],
      };
      const captures: BlockReplayCapture[] = [
        { ...base, origin: 'remote' },
        { ...base, origin: 'local' },
        { ...base, origin: 'load' },
        { ...base, scope: 'unknown' },
        { ...base, scope: 'replacement' },
        { ...base, changes: [{
          path: ['properties', 'notes', 'value'],
          beforePresent: true, afterPresent: true, after: 'short',
        }] },
        { ...base, changes: [{
          path: ['properties', 'notes'],
          beforePresent: true, afterPresent: true, after: { text: 'not a validated scalar' },
        }] },
        { ...base, changes: [{
          path: ['properties', 'notes'],
          beforePresent: true, afterPresent: true,
        }] },
        { ...base, changes: [{
          path: ['properties'],
          beforePresent: true, afterPresent: true, after: { notes: 'short', amount: 99 },
        }] },
        { ...base, changes: [
          ...base.changes,
          { path: ['properties', 'amount', 'value'], beforePresent: true, afterPresent: true, after: 99 },
        ] },
        { ...base, changes: [
          ...base.changes,
          { path: ['pageId'], beforePresent: true, afterPresent: true, after: 'unsupported-owned-page' },
        ] },
        { ...base, changes: [
          ...base.changes,
          { path: ['position'], beforePresent: true, afterPresent: false },
        ] },
        { ...base, changes: [
          { path: ['position'], beforePresent: true, afterPresent: true, after: 'a1' },
          { path: ['properties', 'amount'], beforePresent: true, afterPresent: true, after: Number.NaN },
        ] },
        { ...base, changes: [
          { path: ['properties', 'notes'], beforePresent: true, afterPresent: false, after: 'inconsistent-delete' },
        ] },
        { ...base, type: 'add', changes: [
          { path: ['properties'], beforePresent: false, afterPresent: true, after: { notes: { text: 'unsupported' } } },
          { path: ['position'], beforePresent: false, afterPresent: true, after: 'a0' },
        ] },
        { ...base, type: 'add', changes: [
          { path: ['properties'], beforePresent: false, afterPresent: true, after: { notes: 'valid' } },
          { path: ['position'], beforePresent: false, afterPresent: true, after: 'a0' },
          { path: ['pageId'], beforePresent: false, afterPresent: true, after: 'unsupported-owned-page' },
        ] },
      ];

      for (const capture of captures) sync.syncReplayRow(capture);
      await vi.runAllTimersAsync();

      expect(adapter.updateRow).not.toHaveBeenCalled();
      expect(adapter.createRow).not.toHaveBeenCalled();
      expect(adapter.moveRow).not.toHaveBeenCalled();
      expect(adapter.deleteRow).not.toHaveBeenCalled();
    });

    it('does not treat inherited capture values as owned slots', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      class InheritedAfter {
        readonly path = ['properties', 'notes'];
        readonly beforePresent = true;
        readonly afterPresent = true;
        get after(): string { return 'inherited'; }
      }

      class InheritedProperties {
        readonly notes = 'own';
        get title(): string { return 'inherited'; }
      }

      sync.syncReplayRow({
        blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes: [new InheritedAfter()],
      });
      sync.syncReplayRow({
        blockId: 'r1', type: 'add', origin: 'redo', scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes: [
          { path: ['properties'], beforePresent: false, afterPresent: true, after: new InheritedProperties() },
          { path: ['position'], beforePresent: false, afterPresent: true, after: 'a0' },
        ],
      });
      await vi.runAllTimersAsync();

      expect(adapter.updateRow).not.toHaveBeenCalled();
      expect(adapter.createRow).not.toHaveBeenCalled();
    });

    it.each(['succeeds', 'fails'] as const)(
      'keeps a newer consumed pending value when the second immediate write %s',
      async (secondOutcome) => {
        const adapter = createMockAdapter();
        const observer = { created: vi.fn(), updated: vi.fn() };
        const successfulWrites: Array<Parameters<DatabaseAdapter['updateRow']>[0]> = [];
        let releaseFirstFailure: (() => void) | undefined;
        const firstFailureGate = new Promise<void>((resolve) => { releaseFirstFailure = resolve; });
        let calls = 0;
        let savedStatus = 'stored';
        let savedNotes = 'changed';

        vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
          calls += 1;
          if (calls === 1) {
            await firstFailureGate;
            throw new Error('first immediate write failed');
          }
          if (calls === 2 && secondOutcome === 'fails') {
            throw new Error('second immediate write failed');
          }
          if (typeof properties.status === 'string') savedStatus = properties.status;
          if (typeof properties.notes === 'string') savedNotes = properties.notes;
          successfulWrites.push({ rowId, properties: { ...properties } });
          return { id: rowId, position: 'a0', properties };
        });
        const sync = new DatabaseBackendSync(adapter, undefined, observer);

        sync.syncUpdateRow({
          rowId: 'r1', properties: { notes: 'changed', status: 'old' },
        });
        const firstWrite = sync.syncUpdateRowNow({
          rowId: 'r1', properties: { body: { blocks: [] } },
        });
        sync.syncUpdateRow({ rowId: 'r1', properties: { status: 'new' } });
        const secondWrite = sync.syncUpdateRowNow({
          rowId: 'r1',
          properties: {
            body: { blocks: [{ id: 'second-body', type: 'paragraph', data: { text: 'Second body' } }] },
          },
        });
        const capture: BlockReplayCapture = {
          blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys',
          native: {
            type: 'database-row', parent: { present: true, value: 'db' },
            template: { present: false },
          },
          changes: [{
            path: ['properties', 'notes'],
            beforePresent: true, afterPresent: true, after: 'short',
          }],
        };

        sync.syncReplayRow(capture);
        if (releaseFirstFailure === undefined) throw new Error('first failure gate was not initialized');
        releaseFirstFailure();
        await Promise.all([firstWrite, secondWrite]);
        await vi.runAllTimersAsync();

        expect(savedStatus).toBe('new');
        expect(observer.updated.mock.calls).toEqual([
          [{ rowId: 'r1', properties: { notes: 'changed', status: 'old' } }],
          [{ rowId: 'r1', properties: { status: 'new' } }],
        ]);
        expect(observer.created).not.toHaveBeenCalled();
        expect(savedNotes).toBe('short');
        expect(successfulWrites).toContainEqual({
          rowId: 'r1', properties: { notes: 'short' },
        });
      },
    );

    it('does not recover an undone consumed pending field or notify its observer again after failure', async () => {
      const adapter = createMockAdapter();
      const observer = { created: vi.fn(), updated: vi.fn() };
      const successfulWrites: Array<Parameters<DatabaseAdapter['updateRow']>[0]> = [];
      let releaseFailure: (() => void) | undefined;
      const failureGate = new Promise<void>((resolve) => { releaseFailure = resolve; });
      let calls = 0;
      let savedNotes = 'short';
      let savedStatus = '';

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        calls += 1;
        if (calls === 1) {
          await failureGate;
          throw new Error('body write failed');
        }
        if (typeof properties.notes === 'string') savedNotes = properties.notes;
        if (typeof properties.status === 'string') savedStatus = properties.status;
        successfulWrites.push({ rowId, properties });
        return { id: rowId, position: 'a0', properties };
      });
      const sync = new DatabaseBackendSync(adapter, undefined, observer);

      sync.syncUpdateRow({
        rowId: 'r1', properties: { notes: 'changed', status: 'done' },
      });
      const bodyWrite = sync.syncUpdateRowNow({
        rowId: 'r1', properties: { body: { blocks: [] } },
      });
      sync.syncReplayRow({
        blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys',
        native: {
          type: 'database-row', parent: { present: true, value: 'db' },
          template: { present: false },
        },
        changes: [{
          path: ['properties', 'notes'],
          beforePresent: true, afterPresent: true, after: 'short',
        }],
      });

      if (releaseFailure === undefined) throw new Error('failure gate was not initialized');
      releaseFailure();
      await bodyWrite;
      await vi.runAllTimersAsync();

      expect(savedNotes).toBe('short');
      expect(observer.updated.mock.calls).toEqual([
        [{ rowId: 'r1', properties: { notes: 'changed', status: 'done' } }],
      ]);
      expect(savedStatus).toBe('done');
      expect(successfulWrites).toEqual([
        { rowId: 'r1', properties: { notes: 'short' } },
        { rowId: 'r1', properties: { status: 'done' } },
      ]);
      expect(observer.created).not.toHaveBeenCalled();
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

    it('keeps a newer explicitly flushed title after an older immediate body write fails', async () => {
      const adapter = createMockAdapter();
      const observer = { created: vi.fn(), updated: vi.fn() };
      let releaseBodyWrite: (() => void) | undefined;
      const bodyWriteGate = new Promise<void>((resolve) => { releaseBodyWrite = resolve; });
      let markTitleFlushed: (() => void) | undefined;
      const titleFlushed = new Promise<void>((resolve) => { markTitleFlushed = resolve; });
      let storedTitle = 'Original';
      let writes = 0;

      vi.mocked(adapter.updateRow).mockImplementation(async ({ rowId, properties }) => {
        writes += 1;
        if (writes === 1) {
          await bodyWriteGate;
          throw new Error('body write failed');
        }
        if (typeof properties.title === 'string') storedTitle = properties.title;
        if (properties.title === 'C') markTitleFlushed?.();
        return { id: rowId, position: 'a0', properties };
      });
      const sync = new DatabaseBackendSync(adapter, undefined, observer);

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'A' } });
      const bodyWrite = sync.syncUpdateRowNow({ rowId: 'r1', properties: { body: { blocks: [] } } });

      sync.syncUpdateRow({ rowId: 'r1', properties: { title: 'C' } });
      sync.flushPendingUpdates();
      if (releaseBodyWrite === undefined) throw new Error('body write gate was not initialized');
      releaseBodyWrite();
      await Promise.all([bodyWrite, titleFlushed]);
      await vi.runAllTimersAsync();

      expect(storedTitle).toBe('C');
      expect(observer.updated.mock.calls).toEqual([
        [{ rowId: 'r1', properties: { title: 'A' } }],
        [{ rowId: 'r1', properties: { title: 'C' } }],
      ]);
      expect(observer.created).not.toHaveBeenCalled();
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

  describe('replay writes carry only writable schema values', () => {
    const schema: PropertyDefinition[] = [
      { id: 't', name: 'Name', type: 'title', position: 'a0' },
      { id: 'notes', name: 'Notes', type: 'text', position: 'a1' },
      {
        id: 'stage', name: 'Stage', type: 'select', position: 'a2',
        config: { options: [{ id: 'o-build', label: 'Build', position: 'a0' }] },
      },
      { id: 'link', name: 'Link', type: 'url', position: 'a3' },
      { id: 'files', name: 'Files', type: 'files', position: 'a4' },
      { id: 'num', name: 'ID', type: 'uniqueId', position: 'a5' },
    ];
    const native: BlockReplayNative = {
      type: 'database-row', parent: { present: true, value: 'db' }, template: { present: false },
    };
    const set = (id: string, after: unknown): BlockReplayCapture['changes'][number] =>
      ({ path: ['properties', id], beforePresent: true, afterPresent: true, after });
    const update = (changes: BlockReplayCapture['changes']): BlockReplayCapture =>
      ({ blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys', native, changes });

    it('sends an undo update with only writable schema ids, never __proto__', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncReplayRow(update([
        set('notes', 'short'),
        set('__proto__', 'polluted'),
        set('ghost', 'x'),
        set('num', 7),
      ]), schema);
      await vi.runAllTimersAsync();

      const sent = vi.mocked(adapter.updateRow).mock.calls.map(([params]) => params);

      expect(sent.map((params) => Object.keys(params.properties))).toEqual([['notes']]);
      expect(sent.some((params) => Object.hasOwn(params.properties, '__proto__'))).toBe(false);
    });

    it.each([
      { name: 'an option id the schema does not hold', change: set('stage', 'o-evil') },
      { name: 'a javascript: url', change: set('link', 'javascript:alert(1)') },
      {
        name: 'a file whose url fails safeHref',
        change: set('files', [{ id: 'f1', name: 'a.txt', url: 'javascript:alert(1)' }]),
      },
    ])('skips the whole undo write when it carries $name', async ({ change }) => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncReplayRow(update([set('notes', 'short'), change]), schema);
      await vi.runAllTimersAsync();

      expect(adapter.updateRow).not.toHaveBeenCalled();
      expect(adapter.moveRow).not.toHaveBeenCalled();
    });

    // A skipped create would leave the row out of the backend for good, so a create is cleaned instead.
    it('sends a redo create with only writable schema values and known options', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);
      const add = (rowId: string, properties: unknown): BlockReplayCapture => ({
        blockId: rowId, type: 'add', origin: 'redo', scope: 'keys', native,
        changes: [
          { path: ['properties'], beforePresent: false, afterPresent: true, after: properties },
          { path: ['position'], beforePresent: false, afterPresent: true, after: 'a0' },
        ],
      });

      sync.syncReplayRow(add('r1', poisoned('{"t":"Ok","__proto__":"polluted","ghost":"x","stage":"o-evil","link":"javascript:alert(1)"}')), schema);
      await vi.runAllTimersAsync();

      const created = vi.mocked(adapter.createRow).mock.calls.map(([params]) => params);

      expect(created.map((params) => params.properties)).toEqual([{ t: 'Ok', stage: null, link: null }]);
      expect(created.some((params) => Object.hasOwn(params.properties, '__proto__'))).toBe(false);
    });

    it('refuses a relocation receipt with an unsafe file url, and drops __proto__ from a clean one', () => {
      const sync = new DatabaseBackendSync(createMockAdapter());
      const receipt = (properties: unknown): BlockReplayCapture => ({
        blockId: 'r1', type: 'update', origin: 'undo', scope: 'keys', native, changes: [],
        relocation: {
          before: { type: 'database-row', parent: { present: true, value: 'other' }, template: { present: false } },
          after: native,
          row: { properties: properties as never, position: 'a0' },
        },
      });

      const unsafe = sync.relocationCreateParams(
        receipt({ t: 'A', files: [{ id: 'f1', name: 'a', url: 'javascript:alert(1)' }] }),
        schema,
      );
      const clean = sync.relocationCreateParams(receipt(poisoned('{"t":"A","__proto__":"x","ghost":"y"}')), schema);

      expect(unsafe).toBeUndefined();
      expect(Object.keys(clean?.properties ?? {})).toEqual(['t']);
    });

    it('never sends __proto__ even without a schema', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncReplayRow(update([set('notes', 'short'), set('__proto__', 'polluted')]));
      await vi.runAllTimersAsync();

      const sent = vi.mocked(adapter.updateRow).mock.calls.map(([params]) => params);

      expect(sent.some((params) => Object.hasOwn(params.properties, '__proto__'))).toBe(false);
      expect(sent.map((params) => params.properties)).toEqual([{ notes: 'short' }]);
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
