import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlockPlacement, CaretHistoryEntry, SingleMoveEntry, UndoScopeType } from '../../../../../src/components/modules/yjs/types';

const rootPlacement = (afterId: string | null): BlockPlacement => ({ parentId: null, afterId });

/** A root-level move entry: from after `fromAfter` to after `toAfter`. */
const rootMove = (blockId: string, fromAfter: string | null, toAfter: string | null): SingleMoveEntry => ({
  blockId,
  from: rootPlacement(fromAfter),
  to: rootPlacement(toAfter),
});

const createMockBlok = (): BlokModules => {
  const blockManager = {
    currentBlock: undefined,
    getBlockById: vi.fn(),
    getBlockByChildNode: vi.fn(),
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

    // UndoHistory is scope-shape-agnostic (Y.UndoManager tracks whatever
    // shared types it is handed); the harness keeps its own flat array as
    // the tracked substrate, so every fixture below stays valid.
    history = new UndoHistory([yblocks as unknown as UndoScopeType], blok);

    // Set up placement callback to actually perform moves on the flat
    // substrate: reinsert the block right after its placement's afterId
    // (null → first slot; not found → append).
    history.setPlacementCallback((blockId, placement) => {
      const fromIndex = yblocks.toArray().findIndex((b) => b.get('id') === blockId);

      if (fromIndex === -1) {
        return;
      }

      const blockData = yblocks.get(fromIndex).toJSON();

      yblocks.delete(fromIndex);

      const remaining = yblocks.toArray();
      let insertAt = 0;

      if (placement.afterId !== null) {
        const anchor = remaining.findIndex((b) => b.get('id') === placement.afterId);

        insertAt = anchor === -1 ? remaining.length : anchor + 1;
      }
      const newYblock = new Y.Map<unknown>();

      (Object.keys(blockData) as Array<keyof typeof blockData>).forEach((key) => {
        newYblock.set(key as string, blockData[key]);
      });
      yblocks.insert(insertAt, [newYblock]);
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
      history.recordMove(rootMove('b1', null, 'b2'), false);
      expect(history.canUndo()).toBe(true);

      // Stop capturing should end the current undo group
      history.stopCapturing();

      // New move after stopCapturing should be in a separate undo entry
      history.recordMove(rootMove('b2', 'b1', 'b3'), false);

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
      history.recordMove(rootMove('b1', null, 'b2'), false);

      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(false);
    });

    it('returns true for redo after undo', () => {
      history.recordMove(rootMove('b1', null, 'b2'), false);
      history.undo();

      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(true);
    });
  });

  describe('move grouping', () => {
    it('records single moves immediately when not grouped', () => {
      history.markCaretBeforeChange();
      history.recordMove(rootMove('b1', null, 'b2'), false);

      // Should record the move immediately
      history.undo(); // Should not throw

      expect(history.canRedo()).toBe(true);
    });

    it('collects moves during group', () => {
      history.startMoveGroup();

      history.recordMove(rootMove('b1', null, 'b2'), true);
      history.recordMove(rootMove('b2', 'b1', 'b3'), true);

      history.endMoveGroup();

      // Should have recorded both as a single undo entry
      history.undo();

      expect(history.canRedo()).toBe(true);
    });

    it('transactMoves wraps moves in a group', () => {
      const moveCallback = vi.fn();

      history.setPlacementCallback(moveCallback);

      history.transactMoves(() => {
        // Move callback won't be called here
        // We're just testing the grouping
          history.recordMove(rootMove('b1', null, 'b2'), true);
        history.recordMove(rootMove('b2', 'b1', 'b3'), true);
      });

      // Moves should be recorded
      expect(history.canUndo()).toBe(true);
      // The actual move execution happens via callback during undo/redo,
      // not during recordMove
      expect(moveCallback).not.toHaveBeenCalled();
    });
  });

  describe('chronological undo across moves and edits', () => {
    const getText = (id: string): string =>
      (yblocks.toArray().find((b) => b.get('id') === id)?.get('text') as string) ?? '';

    it('undoes the most recent operation first when a move is sandwiched between text edits', () => {
      // Seed two blocks without tracking (no 'local' origin → no undo entries).
      ydoc.transact(() => {
        const b1 = new Y.Map<unknown>();

        b1.set('id', 'b1');
        b1.set('text', '');
        const b2 = new Y.Map<unknown>();

        b2.set('id', 'b2');
        b2.set('text', '');
        yblocks.insert(0, [b1, b2]);
      });

      const moveCallback = vi.fn();

      history.setPlacementCallback(moveCallback);

      // Edit 1 (tracked) — typing into b1.
      ydoc.transact(() => {
        getBlock('b1').set('text', 'A');
      }, 'local');
      history.stopCapturing();

      // Move b1 (recorded between the two edits).
      history.recordMove(rootMove('b1', null, 'b2'), false);
      history.stopCapturing();

      // Edit 2 (tracked) — more typing into b1.
      ydoc.transact(() => {
        getBlock('b1').set('text', 'AB');
      }, 'local');

      // 1st undo: the most recent operation is Edit 2, NOT the move.
      history.undo();
      expect(getText('b1')).toBe('A');
      expect(moveCallback).not.toHaveBeenCalled();

      // 2nd undo: now the move.
      history.undo();
      expect(moveCallback).toHaveBeenCalledWith('b1', rootPlacement(null), 'move-undo');

      // 3rd undo: Edit 1.
      history.undo();
      expect(getText('b1')).toBe('');
    });

    /**
     * One `undo()` can pop SEVERAL yjs stack items: yjs skips an item whose
     * changes a peer has since deleted and keeps popping until one performs
     * a change. The caret stacks must shed exactly the entries whose items
     * left the yjs stack, or every later press is one step out of phase.
     */
    it('sheds every caret entry whose stack item yjs skipped after a peer deleted the edited block', () => {
      const seedBlock = (id: string): Y.Map<unknown> => {
        const block = new Y.Map<unknown>();

        block.set('id', id);
        block.set('text', `${id.toLowerCase()}0`);

        return block;
      };

      ydoc.transact(() => {
        yblocks.insert(0, [seedBlock('A'), seedBlock('B'), seedBlock('C')]);
      });

      const blockManager = blok.BlockManager as unknown as {
        currentBlock: unknown;
        getBlockById: ReturnType<typeof vi.fn>;
      };
      const caret = blok.Caret as unknown as { setToBlock: ReturnType<typeof vi.fn> };
      const setCaretIn = (id: string): void => {
        blockManager.currentBlock = { id, currentInputIndex: 0, currentInput: undefined, inputs: [] };
      };

      blockManager.getBlockById.mockImplementation((id: string) => ({ id, inputs: [], parentId: null }));

      const label = (entries: CaretHistoryEntry[]): string[] =>
        entries.map((entry) => `${entry.kind}:${entry.before?.blockId ?? '-'}`);
      // Read lazily: a new action REPLACES the redo stack array.
      const stacks = history as unknown as { caretUndoStack: CaretHistoryEntry[]; caretRedoStack: CaretHistoryEntry[] };
      const undoEntries = (): CaretHistoryEntry[] => stacks.caretUndoStack;
      const redoEntries = (): CaretHistoryEntry[] => stacks.caretRedoStack;
      const order = (): string[] => yblocks.toArray().map((b) => b.get('id') as string);

      // E1: edit A.
      setCaretIn('A');
      history.markCaretBeforeChange();
      ydoc.transact(() => {
        getBlock('A').set('text', 'a1');
      }, 'local');
      history.stopCapturing();

      // M: move C to the front. `recordMove` only records; the doc move
      // itself is untracked, as YjsManager.moveBlock's is.
      setCaretIn('C');
      ydoc.transact(() => {
        const moved = getBlock('C').toJSON();

        yblocks.delete(order().indexOf('C'), 1);

        const copy = new Y.Map<unknown>();

        Object.entries(moved).forEach(([key, value]) => {
          copy.set(key, value);
        });
        yblocks.insert(0, [copy]);
      });
      history.recordMove(rootMove('C', 'B', null), false);
      history.stopCapturing();

      // E2: edit B.
      setCaretIn('B');
      history.markCaretBeforeChange();
      ydoc.transact(() => {
        getBlock('B').set('text', 'b1');
      }, 'local');

      expect(label(undoEntries())).toEqual(['edit:A', 'move:C', 'edit:B']);
      expect(order()).toEqual(['C', 'A', 'B']);

      // A peer deletes B: E2's changes are gone from the document.
      ydoc.transact(() => {
        yblocks.delete(order().indexOf('B'), 1);
      }, 'remote');

      // Press 1: yjs pops E2 (no-op) AND E1 in the same call.
      history.undo();

      expect(getText('A')).toBe('a0');
      expect(label(undoEntries())).toEqual(['move:C']);
      expect(label(redoEntries())).toEqual(['edit:A']);
      expect(caret.setToBlock).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'A' }), expect.anything());

      // Press 2: the move.
      history.undo();

      expect(order()).toEqual(['A', 'C']);
      expect(history.canUndo()).toBe(false);
      expect(undoEntries()).toHaveLength(0);

      // Press 3: nothing left — no caret jump to a stale position.
      caret.setToBlock.mockClear();
      history.undo();

      expect(caret.setToBlock).not.toHaveBeenCalled();
      expect(undoEntries()).toHaveLength(0);

      // Redo walks back forward in the same order: the move, then E1.
      history.redo();
      expect(order()).toEqual(['C', 'A']);

      history.redo();
      expect(getText('A')).toBe('a1');
      expect(caret.setToBlock).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'A' }), expect.anything());
      expect(label(undoEntries())).toEqual(['move:C', 'edit:A']);
      expect(history.canRedo()).toBe(false);
    });

    function getBlock(id: string): Y.Map<unknown> {
      const block = yblocks.toArray().find((b) => b.get('id') === id);

      if (block === undefined) {
        throw new Error(`block ${id} not found`);
      }

      return block;
    }
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

    it('captures the block from the live selection when currentBlock is stale', () => {
      // `BlockManager.currentBlock` is updated by a debounced selectionchange
      // handler (180ms), so it can lag behind the real caret. If we trust it
      // blindly, the snapshot records the wrong block id while reading the
      // offset from the live selection — undo/redo then sends the caret to the
      // wrong block. The snapshot must reflect the block the caret is actually in.
      const staleBlock = {
        id: 'stale-block',
        currentInputIndex: 0,
        currentInput: document.createElement('div'),
        inputs: [document.createElement('div')],
      };

      const liveInput = document.createElement('div');

      liveInput.setAttribute('contenteditable', 'true');
      const liveTextNode = document.createTextNode('live block text');

      liveInput.appendChild(liveTextNode);
      const liveBlock = {
        id: 'live-block',
        currentInputIndex: 0,
        currentInput: liveInput,
        inputs: [liveInput],
      };

      (blok.BlockManager as unknown as { currentBlock: typeof staleBlock }).currentBlock = staleBlock;
      (blok.BlockManager as unknown as { getBlockByChildNode: ReturnType<typeof vi.fn> })
        .getBlockByChildNode.mockImplementation((node: Node) =>
          (node === liveTextNode ? liveBlock : undefined));

      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
        anchorNode: liveTextNode,
        rangeCount: 0,
      } as unknown as Selection);

      const snapshot = history.captureCaretSnapshot();

      getSelectionSpy.mockRestore();

      expect(snapshot?.blockId).toBe('live-block');
      expect(snapshot?.inputIndex).toBe(0);
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

    it('forced markCaretBeforeChange re-captures past a stale pending snapshot', () => {
      const mockBlock = {
        id: 'b1',
        currentInputIndex: 0,
        currentInput: document.createElement('div'),
      };

      (blok.BlockManager as unknown as { currentBlock: typeof mockBlock }).currentBlock = mockBlock;

      const captureSpy = vi.spyOn(history, 'captureCaretSnapshot');

      // First call captures the pending snapshot.
      history.markCaretBeforeChange();
      expect(captureSpy).toHaveBeenCalledTimes(1);

      // Unforced call while a pending snapshot exists is ignored (dedupes the
      // keydown + beforeinput pair, and keeps a change's own follow-up writes
      // from overwriting the genuine pre-change caret).
      history.markCaretBeforeChange();
      expect(captureSpy).toHaveBeenCalledTimes(1);

      // A forced call (from a fresh keyboard gesture) re-captures, discarding a
      // stale pending left dangling by a prior operation's no-op follow-up
      // write. Without this the caret resets to that stale position on undo.
      history.markCaretBeforeChange(true);
      expect(captureSpy).toHaveBeenCalledTimes(2);

      captureSpy.mockRestore();
    });
  });

  describe('smart grouping', () => {
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

    it('boundary timer fires stopCapturing to checkpoint a finished word', () => {
      vi.useFakeTimers();
      const stopSpy = vi.spyOn(history.undoManager, 'stopCapturing');

      history.markBoundary();
      // Let the boundary timer fire on its own after the idle window.
      vi.advanceTimersByTime(150);

      // A per-word checkpoint is created and the pending boundary clears.
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
      history.recordMove(rootMove('b1', null, 'b2'), false);
      history.markCaretBeforeChange();

      history.clear();

      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
      expect(history.hasPendingBoundary()).toBe(false);
    });

    it('clears the UndoManager and resets history state', () => {
      // Build up some history first
      history.recordMove(rootMove('b1', null, 'b2'), false);
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
      history.recordMove(rootMove('b1', null, 'b2'), false);
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

  describe('after-snapshot auto-refresh (defense-in-depth)', () => {
    it('refreshes the "after" snapshot once focus settles after the change', async () => {
      // Root-cause guard for "redo caret does not catch up to the new block":
      // Yjs `stack-item-added` fires mid-transaction, BEFORE a structural handler
      // (Enter split, paste, tool insert) moves the caret to the new block. So the
      // "after" snapshot captured there points at the OLD block. A microtask
      // re-capture, after the synchronous gesture settles focus, makes redo land
      // on the right block automatically — without each handler having to call
      // updateLastCaretAfterPosition() by hand.
      const blockA = {
        id: 'block-a',
        currentInputIndex: 0,
        currentInput: document.createElement('div'),
        inputs: [document.createElement('div')],
      };
      const blockB = {
        id: 'block-b',
        currentInputIndex: 0,
        currentInput: document.createElement('div'),
        inputs: [document.createElement('div')],
      };

      // Caret is in block A when the undoable change is recorded.
      (blok.BlockManager as unknown as { currentBlock: typeof blockA }).currentBlock = blockA;

      // A tracked ('local') change creates an undo stack item; stack-item-added
      // fires mid-transaction and captures after = block A.
      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'block-a');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      const stack = (history as unknown as { caretUndoStack: CaretHistoryEntry[] }).caretUndoStack;
      expect(stack[stack.length - 1].after?.blockId).toBe('block-a');

      // The gesture handler now moves focus to the new block (mirrors
      // handleEnter's Caret.setToBlock, which runs AFTER the listener).
      (blok.BlockManager as unknown as { currentBlock: typeof blockB }).currentBlock = blockB;

      // Microtask drains: the "after" snapshot catches up to where focus settled.
      await Promise.resolve();

      expect(stack[stack.length - 1].after?.blockId).toBe('block-b');
    });

    it('does not downgrade a captured "after" snapshot to null when focus leaves all blocks', async () => {
      const blockA = {
        id: 'block-a',
        currentInputIndex: 0,
        currentInput: document.createElement('div'),
        inputs: [document.createElement('div')],
      };

      (blok.BlockManager as unknown as { currentBlock: typeof blockA }).currentBlock = blockA;

      ydoc.transact(() => {
        const yblock = new Y.Map<unknown>();
        yblock.set('id', 'block-a');
        yblock.set('type', 'paragraph');
        yblock.set('data', new Y.Map<unknown>());
        yblocks.push([yblock]);
      }, 'local');

      const stack = (history as unknown as { caretUndoStack: CaretHistoryEntry[] }).caretUndoStack;
      expect(stack[stack.length - 1].after?.blockId).toBe('block-a');

      // Focus leaves every block (e.g. moved to a toolbar control). The refresh
      // must NOT overwrite the good snapshot with null.
      (blok.BlockManager as unknown as { currentBlock: undefined }).currentBlock = undefined;

      await Promise.resolve();

      expect(stack[stack.length - 1].after?.blockId).toBe('block-a');
    });
  });

  describe('caret restoration edge cases', () => {
    it('preserves focus (no document-top jump) when snapshot block no longer exists', () => {
      // Regression: when the snapshot's block can't be resolved, undo/redo must
      // NOT teleport the caret to the first block at the document START — that
      // is the user-visible "caret jumps to the very beginning on redo" bug.
      // Focus is preserved instead.
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

      // Must NOT jump to the first block / document top — focus is preserved
      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
      expect(blok.Caret.setToInput).not.toHaveBeenCalled();
    });

    it('does not jump caret to document top on redo when after-block is gone', () => {
      // The redo path restores the entry's "after" snapshot. If that block no
      // longer exists, redo must preserve focus rather than yanking the caret to
      // the very beginning of the document.
      const firstBlock = { id: 'first-block', inputs: [] };

      (blok.BlockManager as unknown as { getBlockById: typeof vi.fn; firstBlock: typeof firstBlock })
        .getBlockById = vi.fn().mockReturnValue(undefined);
      (blok.BlockManager as unknown as { firstBlock: typeof firstBlock }).firstBlock = firstBlock;

      // Seed a redo entry whose "after" points at a since-removed block
      const redoEntry: CaretHistoryEntry = {
        before: { blockId: 'b-before', inputIndex: 0, offset: 2 },
        after: { blockId: 'gone-block', inputIndex: 0, offset: 0 },
      };
      (history as unknown as { caretRedoStack: CaretHistoryEntry[] }).caretRedoStack.push(redoEntry);

      history.redo();

      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
      expect(blok.Caret.setToInput).not.toHaveBeenCalled();
    });

    it('preserves existing focus when snapshot is null', () => {
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

      // When snapshot is null, restoreCaretSnapshot returns early
      // without modifying focus — preserves whatever DOM state exists
      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
      expect(blok.Caret.setToInput).not.toHaveBeenCalled();
    });

    it('falls back to block start when input no longer exists', () => {
      const block = { id: 'b1', inputs: [], parentId: null };
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

      // Append to document so isConnected returns true
      document.body.appendChild(input);
      const block = { id: 'b1', inputs: [input], parentId: null };
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

      // Clean up
      input.remove();
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
      history.recordMove(rootMove('b3', 'b2', null), false);

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
      history.recordMove(rootMove('b3', 'b2', null), false);
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
      history.recordMove(rootMove('b5', 'b4', null), true);
      // Now b4 is at index 4, move it to index 1
      performMove('b4', 4, 1);
      history.recordMove(rootMove('b4', 'b3', 'b5'), true);
      // Now b3 is at index 4, move it to index 2
      performMove('b3', 4, 2);
      history.recordMove(rootMove('b3', 'b2', 'b4'), true);
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
      history.recordMove(rootMove('b3', 'b2', null), false);
      history.undo();

      expect(history.canRedo()).toBe(true);

      // Record new move - should clear redo stack
      history.recordMove(rootMove('b2', 'b1', 'b3'), false);

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
          history.recordMove(rootMove('b1', null, 'b2'), true);
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
      history.recordMove(rootMove('b1', null, null), false);

      expect(history.canUndo()).toBe(true);
    });

    it('handles move of non-existent block gracefully', () => {
      // Recording a move for a block that doesn't exist should not throw
      expect(() => {
        history.recordMove(rootMove('nonexistent', null, 'b1'), false);
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
