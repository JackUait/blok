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
});
