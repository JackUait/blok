import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { KanbanAdapter, KanbanCardData, KanbanColumnData } from '../../../../src/tools/database/types';
import { DatabaseBackendSync } from '../../../../src/tools/database/database-backend-sync';

const createMockAdapter = (): KanbanAdapter => ({
  loadBoard: vi.fn().mockResolvedValue({ columns: [], cards: [] }),
  moveCard: vi.fn().mockResolvedValue({} as KanbanCardData),
  createCard: vi.fn().mockResolvedValue({} as KanbanCardData),
  updateCard: vi.fn().mockResolvedValue({} as KanbanCardData),
  deleteCard: vi.fn().mockResolvedValue(undefined),
  createColumn: vi.fn().mockResolvedValue({} as KanbanColumnData),
  updateColumn: vi.fn().mockResolvedValue({} as KanbanColumnData),
  moveColumn: vi.fn().mockResolvedValue({} as KanbanColumnData),
  deleteColumn: vi.fn().mockResolvedValue(undefined),
});

describe('DatabaseBackendSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('no adapter', () => {
    it('does not throw when calling sync methods without adapter', async () => {
      const sync = new DatabaseBackendSync();

      await expect(
        sync.syncMoveCard({ cardId: 'c1', toColumnId: 'col-2', position: 'a0', fromColumnId: 'col-1' })
      ).resolves.toBeUndefined();

      await expect(
        sync.syncCreateCard({ id: 'c1', columnId: 'col-1', position: 'a0', title: 'Test' })
      ).resolves.toBeUndefined();

      await expect(
        sync.syncDeleteCard({ cardId: 'c1' })
      ).resolves.toBeUndefined();

      sync.syncUpdateCard({ cardId: 'c1', changes: { title: 'Updated' } });

      sync.destroy();
    });
  });

  describe('with adapter', () => {
    it('calls adapter.moveCard() immediately on syncMoveCard', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      const params = { cardId: 'c1', toColumnId: 'col-2', position: 'a0', fromColumnId: 'col-1' };

      await sync.syncMoveCard(params);

      expect(adapter.moveCard).toHaveBeenCalledOnce();
      expect(adapter.moveCard).toHaveBeenCalledWith(params);

      sync.destroy();
    });

    it('calls adapter.createCard() immediately on syncCreateCard', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      const params = { id: 'c1', columnId: 'col-1', position: 'a0', title: 'New Card' };

      await sync.syncCreateCard(params);

      expect(adapter.createCard).toHaveBeenCalledOnce();
      expect(adapter.createCard).toHaveBeenCalledWith(params);

      sync.destroy();
    });
  });

  describe('debounce', () => {
    it('syncUpdateCard() debounces at 500ms — coalesces multiple calls', async () => {
      const adapter = createMockAdapter();
      const sync = new DatabaseBackendSync(adapter);

      sync.syncUpdateCard({ cardId: 'c1', changes: { title: 'First' } });
      sync.syncUpdateCard({ cardId: 'c1', changes: { title: 'Second' } });
      sync.syncUpdateCard({ cardId: 'c1', changes: { title: 'Third' } });

      expect(adapter.updateCard).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);

      expect(adapter.updateCard).toHaveBeenCalledOnce();
      expect(adapter.updateCard).toHaveBeenCalledWith({ cardId: 'c1', changes: { title: 'Third' } });

      sync.destroy();
    });
  });

  describe('error handling', () => {
    it('calls onError callback when adapter throws', async () => {
      const adapter = createMockAdapter();
      const error = new Error('Network failure');

      vi.mocked(adapter.moveCard).mockRejectedValueOnce(error);

      const onError = vi.fn();
      const sync = new DatabaseBackendSync(adapter, onError);

      await sync.syncMoveCard({ cardId: 'c1', toColumnId: 'col-2', position: 'a0', fromColumnId: 'col-1' });

      expect(onError).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(error);

      sync.destroy();
    });
  });
});
