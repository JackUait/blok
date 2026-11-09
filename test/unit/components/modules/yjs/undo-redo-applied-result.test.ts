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
 * undo() and redo() say whether the press applied a step. The keyboard reads
 * this to announce "Undone", "Redone" or "Nothing to redo".
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

describe('UndoHistory — undo and redo report whether a step applied', () => {
  let h: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    h = createHarness();
    seedBlocks(h, ['b1', 'b2']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports nothing applied for undo and redo on an empty history', () => {
    expect(h.history.undo()).toBe(false);
    expect(h.history.redo()).toBe(false);
  });

  it('reports an edit undone, redone, then nothing left to redo', () => {
    editText(h, 'b1', 'typed');

    expect(h.history.undo()).toBe(true);
    expect(textOf(h, 'b1')).toBe('');
    expect(h.history.redo()).toBe(true);
    expect(textOf(h, 'b1')).toBe('typed');
    expect(h.history.redo()).toBe(false);
    expect(h.history.undo()).toBe(true);
    expect(h.history.undo()).toBe(false);
  });

  it('reports a move undone and redone', () => {
    moveBlock(h, rootMove('b1', null, 'b2'));

    expect(h.history.undo()).toBe(true);
    expect(h.placement).toHaveBeenCalledTimes(1);
    expect(h.history.redo()).toBe(true);
    expect(h.placement).toHaveBeenCalledTimes(2);
    expect(h.history.redo()).toBe(false);
  });
});
