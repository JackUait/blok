import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';

import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type {
  BlockPlacement,
  MoveReplayCallback,
  SingleMoveEntry,
  UndoScopeType,
} from '../../../../../src/components/modules/yjs/types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * A new action must invalidate redo — for the MOVE stacks too.
 *
 * Moves live on their own stacks because yjs models a move as delete+insert,
 * which undoes as a resurrection. That split leaves two holes where the two
 * histories can disagree about whether a redo exists:
 *
 *  1. A tracked local write clears `caretRedoStack` but not `moveRedoStack`.
 *     `redo()` decides "is the next redo a move" from the CARET stack, so the
 *     orphaned move group is unreachable — while `canRedo()` still answers
 *     from `moveRedoStack` and says yes. The button stays enabled forever and
 *     does nothing (only a NEW move ever cleared that stack).
 *  2. The reverse hole: a move's own transaction uses the UNTRACKED 'move'
 *     origin, so yjs's `addStackItem` returns before the
 *     `else if (!redoing) this.clear(false, true)` that would have dropped its
 *     own redoStack. `redo()` after a move then finds an empty caret redo
 *     stack, concludes "not a move", and delegates to `undoManager.redo()` —
 *     replaying an edit the user had already undone.
 */

interface FakeBlock {
  id: string;
  parentId: string | null;
  inputs: HTMLElement[];
  currentInput: HTMLElement | undefined;
  currentInputIndex: number;
}

interface Harness {
  ydoc: Y.Doc;
  yblocks: Y.Array<Y.Map<unknown>>;
  history: UndoHistory;
  placement: ReturnType<typeof vi.fn<MoveReplayCallback>>;
}

const rootPlacement = (afterId: string | null): BlockPlacement => ({ parentId: null, afterId });

const rootMove = (blockId: string, fromAfter: string | null, toAfter: string | null): SingleMoveEntry => ({
  blockId,
  from: rootPlacement(fromAfter),
  to: rootPlacement(toAfter),
});

const createHarness = (): Harness => {
  const ydoc = new Y.Doc();
  const yblocks = ydoc.getArray<Y.Map<unknown>>('blocks');
  const blocks: FakeBlock[] = [];

  const blockManager = {
    currentBlock: undefined as FakeBlock | undefined,
    blocks,
    getBlockById: vi.fn((): FakeBlock | undefined => undefined),
    getBlockByChildNode: vi.fn((): FakeBlock | undefined => undefined),
    firstBlock: undefined,
  };

  const caret = {
    setToBlock: vi.fn(),
    setToInput: vi.fn(),
    positions: { START: 'start', END: 'end', DEFAULT: 'default' },
  };

  const blok = {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    Caret: caret as unknown as BlokModules['Caret'],
  } as unknown as BlokModules;

  const history = new UndoHistory([yblocks as unknown as UndoScopeType], blok);
  const placement = vi.fn<MoveReplayCallback>();

  history.setPlacementCallback(placement);

  return { ydoc, yblocks, history, placement };
};

/** Seeds yjs blocks without an origin, so no undo entry is created. */
const seedBlocks = (harness: Harness, ids: string[]): void => {
  harness.ydoc.transact(() => {
    ids.forEach((id) => {
      const yblock = new Y.Map<unknown>();

      yblock.set('id', id);
      yblock.set('text', '');
      harness.yblocks.push([yblock]);
    });
  });
};

const yblockOf = (harness: Harness, id: string): Y.Map<unknown> => {
  const found = harness.yblocks.toArray().find((block) => block.get('id') === id);

  if (found === undefined) {
    throw new Error(`no yjs block ${id}`);
  }

  return found;
};

const textOf = (harness: Harness, id: string): string => String(yblockOf(harness, id).get('text'));

/** A tracked edit: 'local' is the only origin the UndoManager records. */
const editText = (harness: Harness, id: string, text: string): void => {
  harness.ydoc.transact(() => {
    yblockOf(harness, id).set('text', text);
  }, 'local');
};

/**
 * A move as the real pipeline makes it: an order write under the UNTRACKED
 * 'move' origin (the placement move stacks own its history, so yjs must not
 * also record it), then the bookkeeping entry.
 */
const moveBlock = (harness: Harness, entry: SingleMoveEntry): void => {
  harness.ydoc.transact(() => {
    const index = harness.yblocks.toArray().findIndex((block) => block.get('id') === entry.blockId);

    if (index === -1) {
      return;
    }

    const yblock = yblockOf(harness, entry.blockId);
    const clone = new Y.Map<unknown>();

    yblock.forEach((value, key) => clone.set(key, value));
    harness.yblocks.delete(index, 1);
    harness.yblocks.push([clone]);
  }, 'move');

  harness.history.recordMove(entry, false);
};

const moveRedoDepth = (history: UndoHistory): number =>
  (history as unknown as { moveRedoStack: unknown[] }).moveRedoStack.length;

describe('UndoHistory — a new action invalidates redo on BOTH histories', () => {
  let h: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    h = createHarness();
    seedBlocks(h, ['b1', 'b2']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('drops the undone move from redo once an unrelated tracked write lands', () => {
    h.history.recordMove(rootMove('b1', null, 'b2'), false);
    h.history.undo();

    expect(h.history.canRedo()).toBe(true);

    // One unrelated tracked write — a tool normalisation is enough.
    editText(h, 'b2', 'normalised');

    // The move group is now unreachable: `redo()` reads the CARET redo stack to
    // decide whether the next redo is a move, and that one was just cleared.
    expect(moveRedoDepth(h.history)).toBe(0);
    expect(h.history.canRedo()).toBe(false);
  });

  it('does not resurrect an undone edit when redo follows a move', () => {
    editText(h, 'b1', 'STALE-EDIT');
    h.history.undo();

    expect(textOf(h, 'b1')).toBe('');

    moveBlock(h, rootMove('b2', 'b1', null));

    h.history.redo();

    expect(textOf(h, 'b1')).toBe('');
    expect(h.history.canRedo()).toBe(false);
  });

  it('starts a fresh capture window at a move, so the next edit undoes on its own', () => {
    editText(h, 'b1', 'a');
    moveBlock(h, rootMove('b2', 'b1', null));
    // Same tick, so without a capture boundary yjs merges this into the
    // PRE-move stack item (`stack-item-updated`, no new caret entry) and the
    // caret stack's top stays the move.
    editText(h, 'b1', 'ab');

    h.history.undo();

    // The edit made AFTER the move is what one undo takes back.
    expect(textOf(h, 'b1')).toBe('a');
    // ...and the move is untouched, still waiting on the move stack.
    expect(h.placement).not.toHaveBeenCalled();
    expect(h.history.canUndo()).toBe(true);
  });
});
