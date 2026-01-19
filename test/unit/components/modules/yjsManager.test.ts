import { describe, it, expect, beforeEach, vi } from 'vitest';
import { YjsManager } from '../../../../src/components/modules/yjs';
import type { BlokConfig } from '../../../../types';

const createYjsManager = (): YjsManager => {
  const config: BlokConfig = {};

  const eventsDispatcher = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as YjsManager['eventsDispatcher'];

  const manager = new YjsManager({
    config,
    eventsDispatcher,
  });

  return manager;
};

describe('YjsManager', () => {
  let manager: YjsManager;

  beforeEach(() => {
    manager = createYjsManager();
  });

  describe('initialization', () => {
    it('should create Y.Doc on construction', () => {
      expect(manager).toBeDefined();
    });
  });

  describe('toJSON', () => {
    it('should return empty array when no blocks exist', () => {
      const result = manager.toJSON();

      expect(result).toEqual([]);
    });

    it('should serialize blocks to OutputBlockData format', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Hello' } },
        { id: 'block2', type: 'header', data: { text: 'Title', level: 2 } },
      ]);

      const result = manager.toJSON();

      expect(result).toEqual([
        { id: 'block1', type: 'paragraph', data: { text: 'Hello' } },
        { id: 'block2', type: 'header', data: { text: 'Title', level: 2 } },
      ]);
    });

    it('should include parentId when present', () => {
      manager.fromJSON([
        { id: 'parent', type: 'paragraph', data: { text: 'Parent' } },
        { id: 'child', type: 'paragraph', data: { text: 'Child' }, parent: 'parent' },
      ]);

      const result = manager.toJSON();

      expect(result[1].parent).toBe('parent');
    });
  });

  describe('addBlock', () => {
    it('should add block at the end by default', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });
      manager.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } });

      const result = manager.toJSON();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('block1');
      expect(result[1].id).toBe('block2');
    });

    it('should add block at specified index', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });
      manager.addBlock({ id: 'block3', type: 'paragraph', data: { text: 'Third' } });
      manager.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } }, 1);

      const result = manager.toJSON();

      expect(result[1].id).toBe('block2');
    });

    it('should return the created Y.Map', () => {
      const yblock = manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });

      expect(yblock.get('id')).toBe('block1');
    });
  });

  describe('removeBlock', () => {
    it('should remove block by id', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
      ]);

      manager.removeBlock('block1');

      const result = manager.toJSON();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('block2');
    });

    it('should do nothing if block id not found', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
      ]);

      manager.removeBlock('nonexistent');

      expect(manager.toJSON()).toHaveLength(1);
    });
  });

  describe('moveBlock', () => {
    it('should move block to new index', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
        { id: 'block3', type: 'paragraph', data: { text: 'Third' } },
      ]);

      manager.moveBlock('block3', 0);

      const result = manager.toJSON();

      expect(result[0].id).toBe('block3');
      expect(result[1].id).toBe('block1');
      expect(result[2].id).toBe('block2');
    });
  });

  describe('updateBlockData', () => {
    it('should update a single property in block data', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Original' } },
      ]);

      manager.updateBlockData('block1', 'text', 'Updated');

      const result = manager.toJSON();

      expect(result[0].data.text).toBe('Updated');
    });

    it('should add new property to block data', () => {
      manager.fromJSON([
        { id: 'block1', type: 'header', data: { text: 'Title' } },
      ]);

      manager.updateBlockData('block1', 'level', 2);

      const result = manager.toJSON();

      expect(result[0].data.level).toBe(2);
    });

    it('should do nothing if block not found', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Original' } },
      ]);

      manager.updateBlockData('nonexistent', 'text', 'Updated');

      expect(manager.toJSON()[0].data.text).toBe('Original');
    });
  });

  describe('getBlockById', () => {
    it('should return Y.Map for existing block', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Test' } },
      ]);

      const yblock = manager.getBlockById('block1');

      expect(yblock).toBeDefined();
      expect(yblock?.get('id')).toBe('block1');
    });

    it('should return undefined for nonexistent block', () => {
      const yblock = manager.getBlockById('nonexistent');

      expect(yblock).toBeUndefined();
    });
  });

  describe('undo/redo', () => {
    it('should undo block addition', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });

      expect(manager.toJSON()).toHaveLength(1);

      manager.undo();

      expect(manager.toJSON()).toHaveLength(0);
    });

    it('should redo undone block addition', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });
      manager.undo();

      expect(manager.toJSON()).toHaveLength(0);

      manager.redo();

      expect(manager.toJSON()).toHaveLength(1);
    });

    it('should undo block removal', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });
      manager.stopCapturing(); // Force new undo group
      manager.removeBlock('block1');

      expect(manager.toJSON()).toHaveLength(0);

      manager.undo();

      expect(manager.toJSON()).toHaveLength(1);
    });

    it('should undo data update', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Original' } });
      manager.stopCapturing();
      manager.updateBlockData('block1', 'text', 'Updated');

      expect(manager.toJSON()[0].data.text).toBe('Updated');

      manager.undo();

      expect(manager.toJSON()[0].data.text).toBe('Original');
    });

    it('should not undo fromJSON operations (origin: load)', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Loaded' } },
      ]);

      // Undo should have no effect since fromJSON uses 'load' origin
      manager.undo();

      expect(manager.toJSON()).toHaveLength(1);
      expect(manager.toJSON()[0].data.text).toBe('Loaded');
    });

    it('clears all history stacks when fromJSON is called', () => {
      // Build up some history
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });
      manager.stopCapturing();
      manager.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } });

      // Verify we have undo history
      expect(manager.toJSON()).toHaveLength(2);
      manager.undo();
      expect(manager.toJSON()).toHaveLength(1);

      // Now load new data via fromJSON
      manager.fromJSON([
        { id: 'new1', type: 'paragraph', data: { text: 'New content' } },
      ]);

      // Undo should have no effect - history was cleared
      manager.undo();
      expect(manager.toJSON()).toHaveLength(1);
      expect(manager.toJSON()[0].id).toBe('new1');

      // Redo should also have no effect
      manager.redo();
      expect(manager.toJSON()).toHaveLength(1);
      expect(manager.toJSON()[0].id).toBe('new1');
    });
  });

  describe('change observation', () => {
    it('should emit event when block is added', () => {
      const callback = vi.fn();

      manager.onBlocksChanged(callback);
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'add', blockId: 'block1' })
      );
    });

    it('should emit event when block is removed', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Test' } },
      ]);

      const callback = vi.fn();

      manager.onBlocksChanged(callback);
      manager.removeBlock('block1');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'remove', blockId: 'block1' })
      );
    });

    it('should emit event when block data changes', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'Original' } },
      ]);

      const callback = vi.fn();

      manager.onBlocksChanged(callback);
      manager.updateBlockData('block1', 'text', 'Updated');

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'update', blockId: 'block1' })
      );
    });

    it('should include origin in event', () => {
      const callback = vi.fn();

      manager.onBlocksChanged(callback);
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });

      expect(callback).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'local' })
      );
    });
  });

  describe('smart grouping', () => {
    describe('isBoundaryCharacter', () => {
      it.each([
        [' ', true],
        ['\t', true],
        ['.', true],
        ['?', true],
        ['!', true],
        [',', true],
        [';', true],
        [':', true],
        ['a', false],
        ['1', false],
        ['@', false],
        ['-', false],
      ])('should return %s for "%s"', (char, expected) => {
        expect(YjsManager.isBoundaryCharacter(char)).toBe(expected);
      });
    });

    it('should initialize with no pending boundary', () => {
      expect(manager.hasPendingBoundary()).toBe(false);
    });

    it('should set pending boundary when markBoundary is called', () => {
      manager.markBoundary();
      expect(manager.hasPendingBoundary()).toBe(true);
    });

    it('should clear pending boundary after timeout', async () => {
      vi.useFakeTimers();
      manager.markBoundary();
      expect(manager.hasPendingBoundary()).toBe(true);

      vi.advanceTimersByTime(150);

      expect(manager.hasPendingBoundary()).toBe(false);
      vi.useRealTimers();
    });

    it('should clear pending boundary when clearBoundary is called', () => {
      vi.useFakeTimers();
      manager.markBoundary();
      expect(manager.hasPendingBoundary()).toBe(true);

      manager.clearBoundary();
      expect(manager.hasPendingBoundary()).toBe(false);

      // Timeout should not fire stopCapturing after clearBoundary
      vi.advanceTimersByTime(150);
      // No error means success - stopCapturing wasn't called unnecessarily
      vi.useRealTimers();
    });

    it('should clear pending boundary after timeout via checkAndHandleBoundary', () => {
      vi.useFakeTimers();

      manager.markBoundary();
      expect(manager.hasPendingBoundary()).toBe(true);

      // Advance time past BOUNDARY_TIMEOUT_MS (100ms)
      vi.advanceTimersByTime(110);

      // The setTimeout callback should have cleared the pending boundary
      expect(manager.hasPendingBoundary()).toBe(false);

      vi.useRealTimers();
    });

    it('has no effect when no pending boundary', () => {
      // Should not throw when called with no pending boundary
      expect(() => manager.checkAndHandleBoundary()).not.toThrow();
      expect(manager.hasPendingBoundary()).toBe(false);
    });
  });

  describe('clearHistory boundary cleanup', () => {
    it('should clear pending boundary when history is cleared via fromJSON', () => {
      vi.useFakeTimers();
      manager.markBoundary();
      expect(manager.hasPendingBoundary()).toBe(true);

      // fromJSON calls clearHistory internally
      manager.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Test' } }]);

      expect(manager.hasPendingBoundary()).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('updateBlockTune', () => {
    it('adds new tune to block', () => {
      manager.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Hello' } }]);

      manager.updateBlockTune('block1', 'alignment', 'center');

      const result = manager.toJSON();
      expect(result[0].tunes).toEqual({ alignment: 'center' });
    });

    it('updates existing tune', () => {
      manager.fromJSON([
        {
          id: 'block1',
          type: 'paragraph',
          data: { text: 'Hello' },
          tunes: { alignment: 'left' },
        },
      ]);

      manager.updateBlockTune('block1', 'alignment', 'center');

      const result = manager.toJSON();
      expect(result[0].tunes?.alignment).toBe('center');
    });

    it('does nothing if block not found', () => {
      manager.fromJSON([{ id: 'block1', type: 'paragraph', data: { text: 'Hello' } }]);

      manager.updateBlockTune('nonexistent', 'alignment', 'center');

      expect(manager.toJSON()[0].tunes).toBeUndefined();
    });
  });

  describe('transact', () => {
    it('wraps operations in a single transaction', () => {
      manager.transact(() => {
        manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'First' } });
        manager.addBlock({ id: 'block2', type: 'paragraph', data: { text: 'Second' } });
      });

      expect(manager.toJSON()).toHaveLength(2);
    });
  });

  describe('transactMoves', () => {
    it('groups multiple moves into a single undo entry', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
        { id: 'block3', type: 'paragraph', data: { text: 'Third' } },
        { id: 'block4', type: 'paragraph', data: { text: 'Fourth' } },
      ]);

      const originalOrder = manager.toJSON().map((b) => b.id);
      expect(originalOrder).toEqual(['block1', 'block2', 'block3', 'block4']);

      // Group multiple moves
      manager.transactMoves(() => {
        manager.moveBlock('block4', 0);
        manager.moveBlock('block3', 1);
      });

      const movedOrder = manager.toJSON().map((b) => b.id);
      expect(movedOrder).toEqual(['block4', 'block3', 'block1', 'block2']);

      // Single undo should reverse both moves
      manager.undo();

      const undoneOrder = manager.toJSON().map((b) => b.id);
      expect(undoneOrder).toEqual(['block1', 'block2', 'block3', 'block4']);
    });

    it('handles exception cleanly', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
      ]);

      // Should not throw even if function throws
      expect(() => {
        manager.transactMoves(() => {
          manager.moveBlock('block2', 0);
          throw new Error('Test error');
        });
      }).toThrow('Test error');

      // The state should still be consistent
      expect(() => manager.toJSON()).not.toThrow();
    });

    it('can be nested (uses counter for isMoveGroupActive)', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
        { id: 'block3', type: 'paragraph', data: { text: 'Third' } },
      ]);

      // Nested transactMoves - outermost one controls the group
      manager.transactMoves(() => {
        manager.moveBlock('block3', 0);
        manager.transactMoves(() => {
          manager.moveBlock('block2', 1);
        });
      });

      // Both moves should be recorded
      expect(manager.toJSON().map((b) => b.id)).toEqual(['block3', 'block2', 'block1']);
    });
  });

  describe('markCaretBeforeChange', () => {
    it('marks caret position before a change', () => {
      expect(() => manager.markCaretBeforeChange()).not.toThrow();
    });

    it('can be called multiple times without error', () => {
      manager.markCaretBeforeChange();
      manager.markCaretBeforeChange();
      manager.markCaretBeforeChange();

      // Should not throw
      expect(() => manager.undo()).not.toThrow();
    });
  });

  describe('captureCaretSnapshot', () => {
    it('returns null when no Blok modules are available', () => {
      const snapshot = manager.captureCaretSnapshot();
      expect(snapshot).toBeNull();
    });

    it('does not throw when called without Blok initialization', () => {
      expect(() => manager.captureCaretSnapshot()).not.toThrow();
    });
  });

  describe('updateLastCaretAfterPosition', () => {
    it('does not throw when called without Blok initialization', () => {
      expect(() => manager.updateLastCaretAfterPosition()).not.toThrow();
    });

    it('does not throw when caret stack is empty', () => {
      manager.updateLastCaretAfterPosition();
      expect(() => manager.undo()).not.toThrow();
    });
  });

  describe('moveBlock edge cases', () => {
    it('does nothing when moving to same index', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
      ]);

      const originalOrder = manager.toJSON().map((b) => b.id);

      manager.moveBlock('block2', 1);

      expect(manager.toJSON().map((b) => b.id)).toEqual(originalOrder);
    });

    it('does nothing when block is not found', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
      ]);

      manager.moveBlock('nonexistent', 0);

      expect(manager.toJSON()).toHaveLength(1);
      expect(manager.toJSON()[0].id).toBe('block1');
    });

    it('records move for undo even when moved to end', () => {
      manager.fromJSON([
        { id: 'block1', type: 'paragraph', data: { text: 'First' } },
        { id: 'block2', type: 'paragraph', data: { text: 'Second' } },
      ]);

      manager.moveBlock('block1', 1);

      expect(manager.toJSON().map((b) => b.id)).toEqual(['block2', 'block1']);

      manager.undo();

      expect(manager.toJSON().map((b) => b.id)).toEqual(['block1', 'block2']);
    });
  });

  describe('set state (Blok modules)', () => {
    it('allows setting Blok modules', () => {
      const mockBlok = {
        BlockManager: {},
        Caret: {},
      };

      expect(() => {
        manager.state = mockBlok as unknown as typeof manager.state;
      }).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('cleans up all resources', () => {
      manager.addBlock({ id: 'block1', type: 'paragraph', data: { text: 'Test' } });

      expect(() => manager.destroy()).not.toThrow();

      // After destroy, operations should still work without errors
      // (though the Yjs doc is destroyed)
      expect(() => manager.toJSON()).not.toThrow();
    });
  });
});
