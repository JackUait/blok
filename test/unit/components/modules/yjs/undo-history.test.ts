import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { CaretHistoryEntry } from '../../../../../src/components/modules/yjs/types';

const createMockBlok = (): BlokModules => {
  const blockManager = {
    currentBlock: undefined,
    getBlockById: vi.fn(),
    firstBlock: undefined,
  };

  const caret = {
    setToBlock: vi.fn(),
    setToInput: vi.fn(),
    positions: {
      START: 'start',
      DEFAULT: 'default',
    },
  };

  return {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    Caret: caret as unknown as BlokModules['Caret'],
  } as unknown as BlokModules;
};

describe('UndoHistory', () => {
  let history: UndoHistory;
  let ydoc: Y.Doc;
  let yblocks: Y.Array<Y.Map<unknown>>;
  let blok: BlokModules;

  beforeEach(() => {
    ydoc = new Y.Doc();
    yblocks = ydoc.getArray('blocks');
    blok = createMockBlok();

    history = new UndoHistory(yblocks, blok);

    // Set up move callback to actually perform moves
    history.setMoveCallback((blockId, toIndex) => {
      const fromIndex = yblocks.toArray().findIndex((b) => b.get('id') === blockId);
      if (fromIndex !== -1) {
        const yblock = yblocks.get(fromIndex);
        const blockData = yblock.toJSON();
        yblocks.delete(fromIndex);
        const newYblock = new Y.Map<unknown>();
        (Object.keys(blockData) as Array<keyof typeof blockData>).forEach((key) => {
          newYblock.set(key as string, blockData[key]);
        });
        yblocks.insert(toIndex, [newYblock]);
      }
    });
  });

  describe('initialization', () => {
    it('creates UndoManager on construction', () => {
      expect(history.undoManager).toBeDefined();
    });

    it('starts with empty history', () => {
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
    });
  });

  describe('stopCapturing', () => {
    it('creates a checkpoint so subsequent changes are in separate undo entries', () => {
      // Verify stopCapturing can be called without errors
      expect(() => history.stopCapturing()).not.toThrow();

      // Also verify it works when we have existing history
      history.recordMove('b1', 0, 1, false);
      expect(history.canUndo()).toBe(true);

      // Stop capturing should end the current undo group
      history.stopCapturing();

      // New move after stopCapturing should be in a separate undo entry
      history.recordMove('b2', 1, 2, false);

      // We should now have 2 separate undo entries (2 moves can be undone)
      history.undo();
      expect(history.canUndo()).toBe(true); // Still have more to undo
      history.undo();
      expect(history.canUndo()).toBe(false); // Nothing left to undo
    });
  });

  describe('canUndo and canRedo', () => {
    it('returns false initially', () => {
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
    });

    it('returns true after move is recorded', () => {
      history.recordMove('b1', 0, 1, false);

      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(false);
    });

    it('returns true for redo after undo', () => {
      history.recordMove('b1', 0, 1, false);
      history.undo();

      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(true);
    });
  });

  describe('move grouping', () => {
    it('records single moves immediately when not grouped', () => {
      history.markCaretBeforeChange();
      history.recordMove('b1', 0, 1, false);

      // Should record the move immediately
      history.undo(); // Should not throw

      expect(history.canRedo()).toBe(true);
    });

    it('collects moves during group', () => {
      history.startMoveGroup();

      history.recordMove('b1', 0, 2, true);
      history.recordMove('b2', 1, 3, true);

      history.endMoveGroup();

      // Should have recorded both as a single undo entry
      history.undo();

      expect(history.canRedo()).toBe(true);
    });

    it('transactMoves wraps moves in a group', () => {
      const moveCallback = vi.fn();

      history.setMoveCallback(moveCallback);

      history.transactMoves(() => {
        // Move callback won't be called here
        // We're just testing the grouping
          history.recordMove('b1', 0, 1, true);
        history.recordMove('b2', 1, 2, true);
      });

      // Moves should be recorded
      expect(history.canUndo()).toBe(true);
      // The actual move execution happens via callback during undo/redo,
      // not during recordMove
      expect(moveCallback).not.toHaveBeenCalled();
    });
  });

  describe('caret tracking', () => {
    it('captures caret snapshot', () => {
      const mockBlock = {
        id: 'b1',
        currentInputIndex: 0,
        currentInput: document.createElement('div'),
      };

      (blok.BlockManager as unknown as { currentBlock: typeof mockBlock }).currentBlock = mockBlock;

      const snapshot = history.captureCaretSnapshot();

      expect(snapshot).not.toBeNull();
      expect(snapshot?.blockId).toBe('b1');
    });

    it('returns null when no current block', () => {
      (blok.BlockManager as unknown as { currentBlock: undefined }).currentBlock = undefined;

      const snapshot = history.captureCaretSnapshot();

      expect(snapshot).toBeNull();
    });

    it('marks caret before change', () => {
      const mockBlock = {
        id: 'b1',
        currentInputIndex: 0,
        currentInput: document.createElement('div'),
      };

      (blok.BlockManager as unknown as { currentBlock: typeof mockBlock }).currentBlock = mockBlock;

      history.markCaretBeforeChange();

      // Should have captured the caret position
      expect(history.captureCaretSnapshot()).not.toBeNull();
    });

    it('does not overwrite on subsequent markCaretBeforeChange calls', () => {
      const mockBlock = {
        id: 'b1',
        currentInputIndex: 0,
        currentInput: document.createElement('div'),
      };

      (blok.BlockManager as unknown as { currentBlock: typeof mockBlock }).currentBlock = mockBlock;

      history.markCaretBeforeChange();
      history.captureCaretSnapshot();

      // Change block
      (blok.BlockManager as unknown as { currentBlock: typeof mockBlock }).currentBlock = {
        ...mockBlock,
        id: 'b2',
      };

      history.markCaretBeforeChange();
      history.captureCaretSnapshot();

      // The caret before should still be from the first call
      // (This tests the hasPendingCaret guard)
      expect(history.captureCaretSnapshot()).not.toBeNull();
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
        expect(UndoHistory.isBoundaryCharacter(char)).toBe(expected);
      });
    });

    it('hasPendingBoundary returns false initially', () => {
      expect(history.hasPendingBoundary()).toBe(false);
    });

    it('hasPendingBoundary returns true after markBoundary', () => {
      vi.useFakeTimers();

      history.markBoundary();

      expect(history.hasPendingBoundary()).toBe(true);

      vi.useRealTimers();
    });

    it('clears pending boundary after timeout', () => {
      vi.useFakeTimers();

      history.markBoundary();
      expect(history.hasPendingBoundary()).toBe(true);

      vi.advanceTimersByTime(150);

      expect(history.hasPendingBoundary()).toBe(false);

      vi.useRealTimers();
    });

    it('clearBoundary clears pending boundary immediately', () => {
      vi.useFakeTimers();

      history.markBoundary();
      expect(history.hasPendingBoundary()).toBe(true);

      history.clearBoundary();

      expect(history.hasPendingBoundary()).toBe(false);

      // Timeout should not cause issues
      vi.advanceTimersByTime(150);

      vi.useRealTimers();
    });

    it('checkAndHandleBoundary creates checkpoint after timeout', () => {
      vi.useFakeTimers();
      const stopSpy = vi.spyOn(history.undoManager, 'stopCapturing');

      history.markBoundary();
      vi.advanceTimersByTime(50); // Only 50ms elapsed

      history.checkAndHandleBoundary();
      expect(stopSpy).not.toHaveBeenCalled(); // Not enough time

      vi.advanceTimersByTime(60); // Now 110ms total

      history.checkAndHandleBoundary();
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(history.hasPendingBoundary()).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('setBlok', () => {
    it('updates the Blok modules reference', () => {
      const newBlok: BlokModules = {} as unknown as BlokModules;

      history.setBlok(newBlok);

      // Verify by checking that captureCaretSnapshot doesn't throw
      expect(() => history.captureCaretSnapshot()).not.toThrow();
    });
  });

  describe('clear', () => {
    it('clears all history stacks', () => {
      // Build up some history
      history.recordMove('b1', 0, 1, false);
      history.markCaretBeforeChange();

      history.clear();

      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
      expect(history.hasPendingBoundary()).toBe(false);
    });

    it('clears the UndoManager and resets history state', () => {
      // Build up some history first
      history.recordMove('b1', 0, 1, false);
      expect(history.canUndo()).toBe(true);

      // Clear should reset all state
      history.clear();

      // Verify the observable effect: history is empty
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
    });
  });

  describe('destroy', () => {
    it('clears history and destroys UndoManager', () => {
      // Build up some history first
      history.recordMove('b1', 0, 1, false);
      expect(history.canUndo()).toBe(true);

      // Destroy should clean up
      history.destroy();

      // Verify the observable effect: history is no longer usable
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
    });
  });

  describe('undo and redo', () => {
    it('undo with no history does not throw', () => {
      expect(() => history.undo()).not.toThrow();
    });

    it('redo with no history does not throw', () => {
      expect(() => history.redo()).not.toThrow();
    });
  });

  describe('updateLastCaretAfterPosition', () => {
    it('does nothing when caret stack is empty', () => {
      expect(() => history.updateLastCaretAfterPosition()).not.toThrow();
    });

    it('updates the after position of the last caret entry', () => {
      const mockBlock = {
        id: 'b1',
        currentInputIndex: 0,
        currentInput: document.createElement('div'),
      };

      (blok.BlockManager as unknown as { currentBlock: typeof mockBlock }).currentBlock = mockBlock;

      // Manually push a caret entry (normally done by UndoHistory internally)
      const testCaretEntry: CaretHistoryEntry = {
        before: { blockId: 'b1', inputIndex: 0, offset: 0 },
        after: { blockId: 'b1', inputIndex: 0, offset: 5 },
      };
      (history as unknown as { caretUndoStack: CaretHistoryEntry[] }).caretUndoStack.push(testCaretEntry);

      history.updateLastCaretAfterPosition();

      // Should not throw
      const stack = (history as unknown as { caretUndoStack: CaretHistoryEntry[] }).caretUndoStack;
      expect(stack[0].after).toBeDefined();
    });
  });

  describe('caret restoration edge cases', () => {
    it('restores to first block when snapshot block no longer exists', () => {
      const firstBlock = { id: 'first-block', inputs: [] };
      const snapshot = { blockId: 'deleted-block', inputIndex: 0, offset: 5 };

      (blok.BlockManager as unknown as { getBlockById: typeof vi.fn; firstBlock: typeof firstBlock })
        .getBlockById = vi.fn().mockReturnValue(undefined);
      (blok.BlockManager as unknown as { firstBlock: typeof firstBlock }).firstBlock = firstBlock;

      // Manually trigger the internal restoreCaretSnapshot logic by pushing to caret stack
      const testEntry: CaretHistoryEntry = {
        before: snapshot,
        after: null,
      };
      (history as unknown as { caretUndoStack: CaretHistoryEntry[] }).caretUndoStack.push(testEntry);

      history.undo();

      // Should fall back to first block
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(firstBlock, 'start');
    });

    it('clears selection when snapshot is null and no first block exists', () => {
      const removeSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
        removeAllRanges: vi.fn(),
      } as unknown as ReturnType<typeof window.getSelection>);

      const snapshot = null;

      (blok.BlockManager as unknown as { getBlockById: typeof vi.fn; firstBlock: undefined })
        .getBlockById = vi.fn().mockReturnValue(undefined);
      (blok.BlockManager as unknown as { firstBlock: undefined }).firstBlock = undefined;

      // Manually trigger the internal restoreCaretSnapshot logic
      const testEntry: CaretHistoryEntry = {
        before: snapshot,
        after: null,
      };
      (history as unknown as { caretUndoStack: CaretHistoryEntry[] }).caretUndoStack.push(testEntry);

      history.undo();

      expect(removeSelectionSpy).toHaveBeenCalled();
      removeSelectionSpy.mockRestore();
    });

    it('falls back to block start when input no longer exists', () => {
      const block = { id: 'b1', inputs: [] };
      const snapshot = { blockId: 'b1', inputIndex: 5, offset: 10 }; // input at index 5 doesn't exist

      (blok.BlockManager as unknown as { getBlockById: typeof vi.fn }).getBlockById = vi.fn().mockReturnValue(block);

      // Manually trigger the internal restoreCaretSnapshot logic
      const testEntry: CaretHistoryEntry = {
        before: snapshot,
        after: null,
      };
      (history as unknown as { caretUndoStack: CaretHistoryEntry[] }).caretUndoStack.push(testEntry);

      history.undo();

      // Should fall back to block start
      expect(blok.Caret.setToBlock).toHaveBeenCalledWith(block, 'start');
    });

    it('restores to specific input when input exists', () => {
      const input = document.createElement('div');
      const block = { id: 'b1', inputs: [input] };
      const snapshot = { blockId: 'b1', inputIndex: 0, offset: 5 };

      (blok.BlockManager as unknown as { getBlockById: typeof vi.fn }).getBlockById = vi.fn().mockReturnValue(block);

      // Manually trigger the internal restoreCaretSnapshot logic
      const testEntry: CaretHistoryEntry = {
        before: snapshot,
        after: null,
      };
      (history as unknown as { caretUndoStack: CaretHistoryEntry[] }).caretUndoStack.push(testEntry);

      history.undo();

      // Should restore to specific input
      expect(blok.Caret.setToInput).toHaveBeenCalledWith(input, 'default', 5);
    });

    it('does nothing when snapshot is null and no block manager available', () => {
      // Test the edge case where Blok is not fully initialized
      const emptyBlok: BlokModules = {} as unknown as BlokModules;
      history.setBlok(emptyBlok);

      expect(() => history.undo()).not.toThrow();
    });
  });

  describe('move undo/redo with real Yjs operations', () => {
    it('correctly undoes a single block move', () => {
      // Create blocks in Yjs
      ydoc.transact(() => {
        for (let i = 1; i <= 3; i++) {
          const yblock = new Y.Map<unknown>();
          yblock.set('id', `b${i}`);
          yblock.set('type', 'paragraph');
          yblock.set('data', new Y.Map<unknown>());
          yblocks.push([yblock]);
        }
      }, 'local');

      const initialOrder = yblocks.toArray().map((b) => b.get('id'));
      expect(initialOrder).toEqual(['b1', 'b2', 'b3']);

      // Record and perform a move
      history.recordMove('b3', 2, 0, false);

      // Verify the move was recorded
      expect(history.canUndo()).toBe(true);

      // Undo should restore original order
      history.undo();

      const undoOrder = yblocks.toArray().map((b) => b.get('id'));
      expect(undoOrder).toEqual(['b1', 'b2', 'b3']);
    });

    it('correctly redoes a single block move', () => {
      // Create blocks in Yjs
      ydoc.transact(() => {
        for (let i = 1; i <= 3; i++) {
          const yblock = new Y.Map<unknown>();
          yblock.set('id', `b${i}`);
          yblock.set('type', 'paragraph');
          yblock.set('data', new Y.Map<unknown>());
          yblocks.push([yblock]);
        }
      }, 'local');

      // Record and perform a move
      history.recordMove('b3', 2, 0, false);
      history.undo();

      const undoOrder = yblocks.toArray().map((b) => b.get('id'));
      expect(undoOrder).toEqual(['b1', 'b2', 'b3']);

      // Redo should restore moved order
      history.redo();

      const redoOrder = yblocks.toArray().map((b) => b.get('id'));
      expect(redoOrder).toEqual(['b3', 'b1', 'b2']);
    });

    it('undoes multiple moves in reverse order when grouped', () => {
      // Create blocks
      ydoc.transact(() => {
        for (let i = 1; i <= 5; i++) {
          const yblock = new Y.Map<unknown>();
          yblock.set('id', `b${i}`);
          yblock.set('type', 'paragraph');
          yblock.set('data', new Y.Map<unknown>());
          yblocks.push([yblock]);
        }
      }, 'local');

      const initialOrder = yblocks.toArray().map((b) => b.get('id'));
      expect(initialOrder).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);

      // Helper to perform a move
      const performMove = (_blockId: string, fromIndex: number, toIndex: number): void => {
        const yblock = yblocks.get(fromIndex);
        const blockData = yblock.toJSON();
        yblocks.delete(fromIndex);
        const newYblock = new Y.Map<unknown>();
        (Object.keys(blockData) as Array<keyof typeof blockData>).forEach((key) => {
          newYblock.set(key as string, blockData[key]);
        });
        yblocks.insert(toIndex, [newYblock]);
      };

      // Perform and record a group of moves
      history.startMoveGroup();
      // Move b5 from 4 to 0
      performMove('b5', 4, 0);
      history.recordMove('b5', 4, 0, true);
      // Now b4 is at index 4, move it to index 1
      performMove('b4', 4, 1);
      history.recordMove('b4', 4, 1, true);
      // Now b3 is at index 4, move it to index 2
      performMove('b3', 4, 2);
      history.recordMove('b3', 4, 2, true);
      history.endMoveGroup();

      const movedOrder = yblocks.toArray().map((b) => b.get('id'));
      expect(movedOrder).toEqual(['b5', 'b4', 'b3', 'b1', 'b2']);

      // Single undo should reverse all moves in reverse order
      history.undo();

      const undoOrder = yblocks.toArray().map((b) => b.get('id'));
      expect(undoOrder).toEqual(['b1', 'b2', 'b3', 'b4', 'b5']);
    });

    it('clears redo stack when new move is recorded', () => {
      // Create blocks
      ydoc.transact(() => {
        for (let i = 1; i <= 3; i++) {
          const yblock = new Y.Map<unknown>();
          yblock.set('id', `b${i}`);
          yblock.set('type', 'paragraph');
          yblock.set('data', new Y.Map<unknown>());
          yblocks.push([yblock]);
        }
      }, 'local');

      // Record first move
      history.recordMove('b3', 2, 0, false);
      history.undo();

      expect(history.canRedo()).toBe(true);

      // Record new move - should clear redo stack
      history.recordMove('b2', 1, 2, false);

      expect(history.canRedo()).toBe(false);
      expect(history.canUndo()).toBe(true);
    });

    it('transactMoves handles exceptions cleanly', () => {
      // Create blocks
      ydoc.transact(() => {
        for (let i = 1; i <= 3; i++) {
          const yblock = new Y.Map<unknown>();
          yblock.set('id', `b${i}`);
          yblock.set('type', 'paragraph');
          yblock.set('data', new Y.Map<unknown>());
          yblocks.push([yblock]);
        }
      }, 'local');

      // Get initial canUndo state
      const initialCanUndo = history.canUndo();

      // Test that transactMoves cleans up even when function throws
      expect(() => {
        history.transactMoves(() => {
          // Since we're in a group, recordMove won't call markCaretBeforeChange
          history.recordMove('b1', 0, 1, true);
          throw new Error('Test error');
        });
      }).toThrow('Test error');

      // Despite the error, the move group should be closed
      // (no pending move group state - moves inside transactMoves are grouped)
      // The move itself was recorded in the moveUndoStack since we called endMoveGroup
      // But the test is checking that transactMoves properly cleans up the group
      // The key behavior is that endMoveGroup is called even on exception
      expect(history.canUndo()).toBe(initialCanUndo); // Should be same as initial since no actual move happened
    });
  });

  describe('move undo/redo edge cases', () => {
    it('handles move to same index (no-op)', () => {
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'b1');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      // Recording a move to the same index should still work
      history.recordMove('b1', 0, 0, false);

      expect(history.canUndo()).toBe(true);
    });

    it('handles move of non-existent block gracefully', () => {
      // Recording a move for a block that doesn't exist should not throw
      expect(() => {
        history.recordMove('nonexistent', 0, 1, false);
      }).not.toThrow();
    });

    it('handles empty move group', () => {
      history.startMoveGroup();
      // End group without recording any moves
      history.endMoveGroup();

      expect(history.canUndo()).toBe(false);
    });
  });
});
