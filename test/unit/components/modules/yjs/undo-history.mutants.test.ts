import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
import * as Y from 'yjs';

import { BOUNDARY_TIMEOUT_MS } from '../../../../../src/components/modules/yjs/serializer';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlockPlacement, MoveReplayCallback, SingleMoveEntry, UndoScopeType } from '../../../../../src/components/modules/yjs/types';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/** The slice of a Block that UndoHistory actually reads. */
interface FakeBlock {
  id: string;
  parentId: string | null;
  inputs: HTMLElement[];
  currentInput: HTMLElement | undefined;
  currentInputIndex: number;
}

type PlacementCall = [string, BlockPlacement, 'move-undo' | 'move-redo'];

const rootPlacement = (afterId: string | null): BlockPlacement => ({ parentId: null, afterId });

const rootMove = (blockId: string, fromAfter: string | null, toAfter: string | null): SingleMoveEntry => ({
  blockId,
  from: rootPlacement(fromAfter),
  to: rootPlacement(toAfter),
});

/**
 * A contenteditable holding one text node. `connected` decides whether it is in
 * the document — `restoreCaretSnapshot` branches on `input.isConnected`.
 */
const makeInput = (text: string, connected = true): HTMLElement => {
  const input = document.createElement('div');

  input.setAttribute('contenteditable', 'true');
  input.append(document.createTextNode(text));

  if (connected) {
    document.body.append(input);
  }

  return input;
};

const placeCaret = (node: Node, offset: number): void => {
  const selection = window.getSelection();

  if (selection === null) {
    throw new Error('jsdom returned no selection');
  }

  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
};

const clearCaret = (): void => {
  window.getSelection()?.removeAllRanges();
};

const firstTextNode = (input: HTMLElement): Node => {
  const node = input.firstChild;

  if (node === null) {
    throw new Error('input has no text node');
  }

  return node;
};

interface Harness {
  ydoc: Y.Doc;
  yblocks: Y.Array<Y.Map<unknown>>;
  history: UndoHistory;
  /** What `BlockManager.blocks` returns — the sibling-search haystack. */
  blocks: FakeBlock[];
  /** What `BlockManager.getBlockById` resolves; kept apart from `blocks`. */
  registry: Map<string, FakeBlock>;
  getBlockById: Mock<(id: string) => FakeBlock | undefined>;
  getBlockByChildNode: Mock<(node: Node) => FakeBlock | undefined>;
  setToBlock: Mock<(block: FakeBlock, position: string) => void>;
  setToInput: Mock<(input: HTMLElement, position: string, offset: number) => void>;
  placement: Mock<MoveReplayCallback>;
  focus: (block: FakeBlock | undefined) => void;
}

const createHarness = (): Harness => {
  const ydoc = new Y.Doc();
  const yblocks = ydoc.getArray<Y.Map<unknown>>('blocks');
  const blocks: FakeBlock[] = [];
  const registry = new Map<string, FakeBlock>();

  const getBlockById = vi.fn((id: string): FakeBlock | undefined => registry.get(id));
  const getBlockByChildNode = vi.fn((node: Node): FakeBlock | undefined =>
    blocks.find((block) => block.inputs.some((input) => input === node || input.contains(node))));

  const blockManager = {
    currentBlock: undefined as FakeBlock | undefined,
    blocks,
    getBlockById,
    getBlockByChildNode,
    firstBlock: undefined,
  };

  const setToBlock = vi.fn<(block: FakeBlock, position: string) => void>();
  const setToInput = vi.fn<(input: HTMLElement, position: string, offset: number) => void>();
  const caret = {
    setToBlock,
    setToInput,
    positions: {
      START: 'start',
      END: 'end',
      DEFAULT: 'default',
    },
  };

  const blok = {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    Caret: caret as unknown as BlokModules['Caret'],
  } as unknown as BlokModules;

  const history = new UndoHistory([yblocks as unknown as UndoScopeType], blok);
  const placement = vi.fn<MoveReplayCallback>();

  history.setPlacementCallback(placement);

  return {
    ydoc,
    yblocks,
    history,
    blocks,
    registry,
    getBlockById,
    getBlockByChildNode,
    setToBlock,
    setToInput,
    placement,
    focus: (block) => {
      blockManager.currentBlock = block;
    },
  };
};

/** Registers a block in both lookup surfaces and returns it. */
const addBlock = (
  harness: Harness,
  id: string,
  options: { parentId?: string | null; inputs?: HTMLElement[]; currentInputIndex?: number } = {}
): FakeBlock => {
  const inputs = options.inputs ?? [makeInput(`${id} text`)];
  const currentInputIndex = options.currentInputIndex ?? 0;
  const block: FakeBlock = {
    id,
    parentId: options.parentId ?? null,
    inputs,
    currentInput: inputs[currentInputIndex],
    currentInputIndex,
  };

  harness.blocks.push(block);
  harness.registry.set(id, block);

  return block;
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

const lastCaretInput = (harness: Harness): HTMLElement | undefined => harness.setToInput.mock.calls.at(-1)?.[0];
const lastCaretBlock = (harness: Harness): FakeBlock | undefined => harness.setToBlock.mock.calls.at(-1)?.[0];
const placementCalls = (harness: Harness): PlacementCall[] =>
  harness.placement.mock.calls.map((call) => [call[0], call[1], call[2]]);

describe('UndoHistory — mutation coverage', () => {
  let h: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    clearCaret();
    h = createHarness();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    clearCaret();
    document.body.replaceChildren();
  });

  describe('undo and redo restore the caret the user actually had', () => {
    it('undo restores the position from before the edit and redo the one after it', () => {
      const before = addBlock(h, 'before-block');
      const after = addBlock(h, 'after-block');

      seedBlocks(h, ['b1']);

      h.focus(before);
      h.history.markCaretBeforeChange();
      // Focus has moved on by the time the transaction records the entry, so
      // `before` and `after` are different blocks — the whole point of the pair.
      h.focus(after);
      editText(h, 'b1', 'typed');

      h.history.undo();

      expect(textOf(h, 'b1')).toBe('');
      expect(lastCaretInput(h)).toBe(before.inputs[0]);

      h.history.redo();

      expect(textOf(h, 'b1')).toBe('typed');
      expect(lastCaretInput(h)).toBe(after.inputs[0]);
    });

    it('redo falls back to the before-position when the after-position was never captured', () => {
      const before = addBlock(h, 'before-block');

      seedBlocks(h, ['b1']);

      h.focus(before);
      h.history.markCaretBeforeChange();
      // Focus is gone by the time the entry is recorded: `after` is null.
      h.focus(undefined);
      editText(h, 'b1', 'typed');

      h.history.undo();
      h.setToInput.mockClear();
      h.history.redo();

      expect(lastCaretInput(h)).toBe(before.inputs[0]);
    });

    it('a second undo unwinds the older edit, not a move that happened before it', () => {
      seedBlocks(h, ['b1', 'b2']);

      const blockA = addBlock(h, 'a');

      h.focus(blockA);
      h.history.markCaretBeforeChange();
      h.history.recordMove(rootMove('b2', 'b1', null), false);

      editText(h, 'b1', 'one');
      h.history.stopCapturing();
      editText(h, 'b1', 'one two');

      h.history.undo();

      expect(textOf(h, 'b1')).toBe('one');
      expect(h.placement).not.toHaveBeenCalled();

      h.history.undo();

      // The caret stack must shed exactly the entry whose yjs item was popped.
      // Shedding both leaves the move on top, and this press replays the move
      // instead of unwinding the first edit.
      expect(textOf(h, 'b1')).toBe('');
      expect(h.placement).not.toHaveBeenCalled();
    });

    it('redo replays the edit undone last, not a move undone before it', () => {
      seedBlocks(h, ['b1', 'b2']);

      const blockA = addBlock(h, 'a');

      h.focus(blockA);
      editText(h, 'b1', 'typed');
      h.history.stopCapturing();
      h.history.markCaretBeforeChange();
      h.history.recordMove(rootMove('b2', 'b1', null), false);

      h.history.undo();

      expect(placementCalls(h)).toEqual([['b2', rootPlacement('b1'), 'move-undo']]);

      h.history.undo();

      expect(textOf(h, 'b1')).toBe('');

      h.history.redo();

      expect(textOf(h, 'b1')).toBe('typed');
      expect(placementCalls(h)).toHaveLength(1);
    });
  });

  // yjs stamps its capture clock through `lib0/time`, which captured the real
  // `Date.now` at module load — a faked Date does not reach it. These edits
  // merge because they are adjacent synchronous statements, far inside the
  // 500ms capture window.
  describe('two edits inside the capture window are one undo step', () => {
    it('one undo removes both, and redo returns the caret to where the second left it', () => {
      const first = addBlock(h, 'first-block');
      const second = addBlock(h, 'second-block');

      seedBlocks(h, ['b1']);

      h.focus(first);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'a');

      h.history.markCaretBeforeChange();
      h.focus(second);
      editText(h, 'b1', 'ab');

      h.history.undo();

      expect(textOf(h, 'b1')).toBe('');
      expect(h.history.canUndo()).toBe(false);
      expect(lastCaretInput(h)).toBe(first.inputs[0]);

      h.history.redo();

      expect(textOf(h, 'b1')).toBe('ab');
      expect(lastCaretInput(h)).toBe(second.inputs[0]);
    });

    it('the merge backfills a before-position the first edit could not capture', () => {
      const marked = addBlock(h, 'marked-block');
      const settled = addBlock(h, 'settled-block');

      seedBlocks(h, ['b1']);

      // Nothing focused: the first edit records before = null.
      h.focus(undefined);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'a');

      h.focus(marked);
      h.history.markCaretBeforeChange();
      h.focus(settled);
      editText(h, 'b1', 'ab');

      h.history.undo();

      expect(lastCaretInput(h)).toBe(marked.inputs[0]);
    });

    it('the merge never overwrites a before-position the first edit did capture', () => {
      const original = addBlock(h, 'original-block');
      const later = addBlock(h, 'later-block');
      const settled = addBlock(h, 'settled-block');

      seedBlocks(h, ['b1']);

      h.focus(original);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'a');

      h.focus(later);
      h.history.markCaretBeforeChange();
      h.focus(settled);
      editText(h, 'b1', 'ab');

      h.history.undo();

      expect(lastCaretInput(h)).toBe(original.inputs[0]);
    });

    it('the merge clears the pending capture so the next step records its own', () => {
      const merged = addBlock(h, 'merged-block');
      const next = addBlock(h, 'next-block');

      seedBlocks(h, ['b1']);

      h.focus(merged);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'a');
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'ab');

      h.history.stopCapturing();

      h.focus(next);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'ab c');

      h.history.undo();

      expect(textOf(h, 'b1')).toBe('ab');
      expect(lastCaretInput(h)).toBe(next.inputs[0]);
    });
  });

  describe('the deferred after-snapshot refresh', () => {
    it('leaves an entry alone once it is no longer the newest', async () => {
      const edited = addBlock(h, 'edited-block');
      const moved = addBlock(h, 'moved-block');
      const drifted = addBlock(h, 'drifted-block');

      seedBlocks(h, ['b1', 'b2']);

      h.focus(edited);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'typed');

      // A move lands before the scheduled microtask drains, so the edit's entry
      // is no longer the top of the stack.
      h.focus(moved);
      h.history.markCaretBeforeChange();
      h.history.recordMove(rootMove('b2', 'b1', null), false);

      h.focus(drifted);
      await Promise.resolve();

      h.history.undo();
      h.setToInput.mockClear();
      h.history.redo();

      // The move entry's after-position must still be where the move left the
      // caret, not where focus happened to be when the stale refresh ran.
      expect(lastCaretInput(h)).toBe(moved.inputs[0]);
    });
  });

  describe('the undo/redo guard flag', () => {
    it('is released so the next edit is tracked for caret restore', () => {
      const first = addBlock(h, 'first-block');
      const second = addBlock(h, 'second-block');

      seedBlocks(h, ['b1']);

      h.focus(first);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'one');

      h.history.undo();

      h.focus(second);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'two');

      h.setToInput.mockClear();
      h.history.undo();

      expect(lastCaretInput(h)).toBe(second.inputs[0]);
    });
  });

  describe('the buffered-write flush barrier', () => {
    it('runs before undo, before redo and before a capture checkpoint', () => {
      const flush = vi.fn();

      h.history.setFlushPendingWritesHook(flush);

      h.history.undo();
      expect(flush).toHaveBeenCalledTimes(1);

      h.history.redo();
      expect(flush).toHaveBeenCalledTimes(2);

      h.history.stopCapturing();
      expect(flush).toHaveBeenCalledTimes(3);
    });
  });

  describe('rebindScope', () => {
    it('swaps in a manager over the new roots, detaches the old one and re-arms caret tracking', () => {
      const focused = addBlock(h, 'focused-block');
      const oldManager = h.history.undoManager;
      const otherDoc = new Y.Doc();
      const otherBlocks = otherDoc.getArray<Y.Map<unknown>>('blocks');

      seedBlocks(h, ['b1']);

      h.history.rebindScope([otherBlocks as unknown as UndoScopeType]);

      expect(h.history.undoManager).not.toBe(oldManager);

      // The retired manager must stop listening: its document is about to be
      // destroyed, and a stale manager keeps recording into a dead lineage.
      editText(h, 'b1', 'typed');

      expect(oldManager.undoStack).toHaveLength(0);
      expect(h.history.canUndo()).toBe(false);

      h.focus(focused);
      h.history.markCaretBeforeChange();
      otherDoc.transact(() => {
        otherBlocks.push([new Y.Map<unknown>()]);
      }, 'local');

      h.history.undo();

      expect(lastCaretInput(h)).toBe(focused.inputs[0]);
    });
  });

  describe('setBlok', () => {
    it('points caret capture at the newly supplied modules', () => {
      const original = addBlock(h, 'original-block');

      h.focus(original);

      expect(h.history.captureCaretSnapshot()?.blockId).toBe('original-block');

      const later: FakeBlock = {
        id: 'later-block',
        parentId: null,
        inputs: [makeInput('later')],
        currentInput: undefined,
        currentInputIndex: 0,
      };

      later.currentInput = later.inputs[0];

      h.history.setBlok({
        BlockManager: {
          currentBlock: later,
          blocks: [later],
          getBlockById: vi.fn(),
          getBlockByChildNode: vi.fn(),
        } as unknown as BlokModules['BlockManager'],
      } as unknown as BlokModules);

      expect(h.history.captureCaretSnapshot()?.blockId).toBe('later-block');
    });
  });

  describe('captureCaretSnapshot', () => {
    it('returns null before Blok has a BlockManager', () => {
      h.history.setBlok({} as unknown as BlokModules);

      expect(h.history.captureCaretSnapshot()).toBeNull();
    });

    it('uses the tracked input when the platform reports no selection at all', () => {
      const block = addBlock(h, 'tracked-block', {
        inputs: [makeInput('zero'), makeInput('one')],
        currentInputIndex: 1,
      });

      h.focus(block);
      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      const snapshot = h.history.captureCaretSnapshot();

      expect(snapshot?.blockId).toBe('tracked-block');
      expect(snapshot?.inputIndex).toBe(1);
      expect(h.getBlockByChildNode).not.toHaveBeenCalled();
    });

    it('records the input the live selection is in, and its offset', () => {
      const inputs = [makeInput('zero'), makeInput('one two three')];
      const block = addBlock(h, 'multi-input-block', {
        inputs,
        currentInputIndex: 0,
      });

      h.focus(block);
      placeCaret(firstTextNode(inputs[1]), 3);

      const snapshot = h.history.captureCaretSnapshot();

      // Index and offset must come from the SAME input, or undo sends the caret
      // into one block at another block's offset.
      expect(snapshot?.inputIndex).toBe(1);
      expect(snapshot?.offset).toBe(3);
    });

    it('prefers the tracked input when the selection cannot be resolved to a block', () => {
      const inputs = [makeInput('zero'), makeInput('one two three')];
      const block = addBlock(h, 'unresolved-block', {
        inputs,
        currentInputIndex: 0,
      });

      h.focus(block);
      h.getBlockByChildNode.mockReturnValue(undefined);
      placeCaret(firstTextNode(inputs[1]), 3);

      const snapshot = h.history.captureCaretSnapshot();

      // An unresolved selection is not evidence about which input the caret is
      // in, so the block's own tracked index has to win.
      expect(snapshot?.inputIndex).toBe(0);
    });

    it('reports offset 0 for a block that has no input to measure', () => {
      const block = addBlock(h, 'inputless-block', { inputs: [] });
      const stray = makeInput('one two three');

      block.currentInput = undefined;
      h.focus(block);
      h.getBlockByChildNode.mockReturnValue(undefined);
      placeCaret(firstTextNode(stray), 3);

      const snapshot = h.history.captureCaretSnapshot();

      // Falling back to the ambient selection would measure an offset inside a
      // contenteditable that is not this block's input.
      expect(snapshot?.offset).toBe(0);
    });
  });

  describe('restoring a caret whose input was rebuilt', () => {
    /**
     * Drives `restoreCaretSnapshot` through the public path: a recorded move's
     * `before` snapshot is restored on undo.
     */
    const undoOntoSnapshotOf = (block: FakeBlock): void => {
      seedBlocks(h, ['b1', 'b2']);
      h.focus(block);
      h.history.markCaretBeforeChange();
      h.history.recordMove(rootMove('b2', 'b1', null), false);
      h.history.undo();
    };

    it('lands on the last connected sibling inside the same parent', () => {
      addBlock(h, 'no-input-sibling', { parentId: 'p', inputs: [] });
      const first = addBlock(h, 'first-sibling', { parentId: 'p' });
      const second = addBlock(h, 'second-sibling', { parentId: 'p' });
      const last = addBlock(h, 'last-sibling', { parentId: 'p' });
      const target = addBlock(h, 'target-block', {
        parentId: 'p',
        inputs: [makeInput('connected'), makeInput('rebuilt', false)],
        currentInputIndex: 1,
      });
      const stranger = addBlock(h, 'stranger-block', { parentId: 'other-parent' });

      undoOntoSnapshotOf(target);

      expect(lastCaretBlock(h)).toBe(last);
      expect(lastCaretBlock(h)).not.toBe(second);
      expect(lastCaretBlock(h)).not.toBe(first);
      expect(lastCaretBlock(h)).not.toBe(stranger);
      expect(h.setToBlock.mock.calls.at(-1)?.[1]).toBe('end');
    });

    it('falls back to the parent block when no sibling is connected', () => {
      const parent = addBlock(h, 'parent-block');
      const target = addBlock(h, 'target-block', {
        parentId: 'parent-block',
        inputs: [makeInput('rebuilt', false)],
      });

      undoOntoSnapshotOf(target);

      expect(lastCaretBlock(h)).toBe(parent);
      expect(h.setToBlock.mock.calls.at(-1)?.[1]).toBe('start');
    });

    it('falls back to the block itself when the parent is gone too', () => {
      const target = addBlock(h, 'target-block', {
        parentId: 'missing-parent',
        inputs: [makeInput('rebuilt', false)],
      });

      undoOntoSnapshotOf(target);

      expect(lastCaretBlock(h)).toBe(target);
      expect(h.setToBlock.mock.calls.at(-1)?.[1]).toBe('start');
    });
  });

  describe('move groups', () => {
    it('a group opened inside another rides the outer one, so one undo reverses both', () => {
      h.history.transactMoves(() => {
        h.history.recordMove(rootMove('b1', null, 'b2'), true);
        h.history.transactMoves(() => {
          h.history.recordMove(rootMove('b2', 'b1', null), true);
        });
      });

      h.history.undo();

      // Newest step first, and both in one press: starting a second group would
      // discard everything collected so far.
      expect(placementCalls(h)).toEqual([
        ['b2', rootPlacement('b1'), 'move-undo'],
        ['b1', rootPlacement(null), 'move-undo'],
      ]);
      expect(h.history.canUndo()).toBe(false);
    });

    it("the group's undo restores the caret from before the group started", () => {
      const started = addBlock(h, 'started-block');
      const finished = addBlock(h, 'finished-block');

      h.focus(started);
      h.history.startMoveGroup();
      h.history.recordMove(rootMove('b1', null, 'b2'), true);
      h.focus(finished);
      h.history.endMoveGroup();

      h.history.undo();

      expect(lastCaretInput(h)).toBe(started.inputs[0]);
    });

    it('a grouped move recorded with no group open is recorded on its own', () => {
      expect(() => h.history.recordMove(rootMove('b1', null, 'b2'), true)).not.toThrow();
      expect(h.history.canUndo()).toBe(true);
    });

    it('ending a group that was never started changes nothing', () => {
      expect(() => h.history.endMoveGroup()).not.toThrow();
      expect(h.history.canUndo()).toBe(false);
    });

    it('a redone move is undoable again and carries the move-redo origin', () => {
      h.history.recordMove(rootMove('b1', null, 'b2'), false);

      h.history.undo();
      h.history.redo();

      expect(placementCalls(h).at(-1)).toEqual(['b1', rootPlacement('b2'), 'move-redo']);

      h.history.undo();

      expect(placementCalls(h).at(-1)).toEqual(['b1', rootPlacement(null), 'move-undo']);
    });
  });

  describe('a reparent attached to an in-flight move', () => {
    it('is dropped when no move group is open', () => {
      expect(() =>
        h.history.recordParentChangeForPendingMove('b1', rootPlacement(null), rootPlacement('b2')))
        .not.toThrow();
      expect(h.history.canUndo()).toBe(false);
    });

    it('advances the destination of that block only, keeping its original origin', () => {
      const inner: BlockPlacement = { parentId: 'toggle', afterId: null };

      // The reparented block is deliberately NOT the first entry in the group:
      // matching on position instead of id would rewrite the wrong block.
      h.history.startMoveGroup();
      h.history.recordMove(rootMove('b9', 'b8', null), true);
      h.history.recordMove(rootMove('b1', null, 'b2'), true);
      h.history.recordParentChangeForPendingMove('b1', rootPlacement('b2'), inner);
      h.history.endMoveGroup();

      h.history.undo();

      // `from` is first-write-wins: the mid-group placement is not where the
      // drag started, so undo must still target the pre-drag slot.
      expect(placementCalls(h)).toEqual([
        ['b1', rootPlacement(null), 'move-undo'],
        ['b9', rootPlacement('b8'), 'move-undo'],
      ]);

      h.placement.mockClear();
      h.history.redo();

      expect(placementCalls(h)).toEqual([
        ['b9', rootPlacement(null), 'move-redo'],
        ['b1', inner, 'move-redo'],
      ]);
    });

    it('creates a parent-only entry when the block has not moved inside the group', () => {
      const inner: BlockPlacement = { parentId: 'toggle', afterId: null };

      h.history.startMoveGroup();
      h.history.recordParentChangeForPendingMove('b1', rootPlacement('b2'), inner);
      h.history.endMoveGroup();

      h.history.undo();

      expect(placementCalls(h)).toEqual([['b1', rootPlacement('b2'), 'move-undo']]);
    });
  });

  describe('rewindCaptureClock', () => {
    it('rewinds the capture clock but never pushes it forward', () => {
      seedBlocks(h, ['b1']);
      editText(h, 'b1', 'typed');

      const stamped = h.history.undoManager.lastChange;

      h.history.rewindCaptureClock(stamped - 100);

      expect(h.history.undoManager.lastChange).toBe(stamped - 100);

      // Pushing the clock forward would merge actions the user separated by
      // more than the capture window into one undo step.
      h.history.rewindCaptureClock(stamped + 500);

      expect(h.history.undoManager.lastChange).toBe(stamped - 100);
    });
  });

  describe('continueEntryThatCreated', () => {
    /** The id of the first struct written by `write`. */
    const idOfStructsWrittenBy = (write: () => void): Y.ID => {
      const clock = Y.getState(h.ydoc.store, h.ydoc.clientID);

      write();

      return Y.createID(h.ydoc.clientID, clock);
    };

    it('merges the replacement into the entry that created the block', () => {
      const creationId = idOfStructsWrittenBy(() => {
        h.ydoc.transact(() => {
          const yblock = new Y.Map<unknown>();

          yblock.set('id', 'slot');
          yblock.set('text', '');
          h.yblocks.push([yblock]);
        }, 'local');
      });

      // The user paused long enough for the scaffold slot to close its entry.
      h.history.stopCapturing();
      h.history.continueEntryThatCreated(creationId);
      editText(h, 'slot', 'chosen');

      expect(h.history.undoManager.undoStack).toHaveLength(1);

      h.history.undo();

      expect(h.yblocks.length).toBe(0);
    });

    it('leaves history alone when the newest entry did not create the block', () => {
      const creationId = idOfStructsWrittenBy(() => {
        h.ydoc.transact(() => {
          const yblock = new Y.Map<unknown>();

          yblock.set('id', 'slot');
          yblock.set('text', '');
          h.yblocks.push([yblock]);
        }, 'local');
      });

      h.history.stopCapturing();
      editText(h, 'slot', 'one');
      h.history.stopCapturing();

      h.history.continueEntryThatCreated(creationId);
      editText(h, 'slot', 'one two');

      // A slot buried under a later entry existed as a state of its own, so
      // undo has to restore it rather than skip past it.
      expect(h.history.undoManager.undoStack).toHaveLength(3);
    });

    it('does nothing for a block that is not in the document', () => {
      seedBlocks(h, ['b1']);
      editText(h, 'b1', 'one');
      h.history.stopCapturing();

      h.history.continueEntryThatCreated(null);
      editText(h, 'b1', 'one two');

      expect(h.history.undoManager.undoStack).toHaveLength(2);
    });

    it('does nothing when there is no entry to continue', () => {
      const creationId = Y.createID(h.ydoc.clientID, 0);

      expect(() => h.history.continueEntryThatCreated(creationId)).not.toThrow();
      expect(h.history.canUndo()).toBe(false);
    });
  });

  describe('scroll position around a caret restore', () => {
    /** Reports `scroll` as the page offset and captures every scrollTo. */
    const trackScroll = (initial: number): { set: (y: number) => void; scrollTo: MockInstance<typeof window.scrollTo> } => {
      let scroll = initial;

      vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scroll);

      return {
        set: (y: number) => {
          scroll = y;
        },
        scrollTo: vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined),
      };
    };

    it('is restored when undoing or redoing a move threw the page across a viewport', () => {
      const page = trackScroll(400);

      h.placement.mockImplementation(() => {
        page.set(400 + window.innerHeight + 1);
      });

      h.history.recordMove(rootMove('b1', null, 'b2'), false);
      h.history.undo();

      expect(page.scrollTo).toHaveBeenCalledWith(0, 400);

      page.set(400);
      page.scrollTo.mockClear();
      h.history.redo();

      expect(page.scrollTo).toHaveBeenCalledWith(0, 400);
    });

    it('is restored when undoing or redoing an edit threw the page across a viewport', () => {
      const focused = addBlock(h, 'focused-block');
      const page = trackScroll(400);

      seedBlocks(h, ['b1']);
      h.focus(focused);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'typed');

      h.setToInput.mockImplementation(() => {
        page.set(400 + window.innerHeight + 1);
      });

      h.history.undo();

      expect(page.scrollTo).toHaveBeenCalledWith(0, 400);

      page.set(400);
      page.scrollTo.mockClear();
      h.history.redo();

      expect(page.scrollTo).toHaveBeenCalledWith(0, 400);
    });

    it('is left alone when the page did not move a full viewport', () => {
      const page = trackScroll(500);

      h.history.recordMove(rootMove('b1', null, 'b2'), false);
      h.history.undo();

      // The page never moved at all; only the difference of the two positions
      // may decide this.
      expect(page.scrollTo).not.toHaveBeenCalled();

      page.set(500);
      h.placement.mockImplementation(() => {
        page.set(500 + window.innerHeight);
      });
      h.history.redo();

      // Exactly one viewport is the boundary and is not a jump.
      expect(page.scrollTo).not.toHaveBeenCalled();
    });
  });

  describe('word-boundary checkpoints', () => {
    /** Counts checkpoints: the flush barrier runs at the start of each one. */
    const countCheckpoints = (): ReturnType<typeof vi.fn> => {
      const flush = vi.fn();

      h.history.setFlushPendingWritesHook(flush);

      return flush;
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    });

    it('typing again before the idle window restarts the timer', () => {
      const checkpoints = countCheckpoints();

      h.history.markBoundary();
      vi.advanceTimersByTime(60);
      h.history.markBoundary();
      vi.advanceTimersByTime(60);

      // 120ms after the first boundary but only 60ms after the second: the
      // first timer must have been cancelled, or the word splits mid-typing.
      expect(checkpoints).not.toHaveBeenCalled();
      expect(h.history.hasPendingBoundary()).toBe(true);

      vi.advanceTimersByTime(45);

      expect(checkpoints).toHaveBeenCalledTimes(1);
      expect(h.history.hasPendingBoundary()).toBe(false);
    });

    it('clearBoundary cancels the pending checkpoint outright', () => {
      const checkpoints = countCheckpoints();

      expect(() => h.history.clearBoundary()).not.toThrow();

      h.history.markBoundary();
      h.history.clearBoundary();

      expect(vi.getTimerCount()).toBe(0);

      vi.advanceTimersByTime(50);
      h.history.markBoundary();
      vi.advanceTimersByTime(70);

      // A timer left running from the cancelled boundary would fire here.
      expect(checkpoints).not.toHaveBeenCalled();

      vi.advanceTimersByTime(45);

      expect(checkpoints).toHaveBeenCalledTimes(1);
    });

    it('checkAndHandleBoundary checkpoints once the idle window has passed', () => {
      const checkpoints = countCheckpoints();
      const started = Date.now();

      h.history.markBoundary();

      // The clock moves without the timer firing, which is what happens when
      // the tab was busy: the keystroke handler has to notice by itself.
      vi.setSystemTime(started + 99);
      h.history.checkAndHandleBoundary();

      expect(checkpoints).not.toHaveBeenCalled();
      expect(h.history.hasPendingBoundary()).toBe(true);

      vi.setSystemTime(started + 100);
      h.history.checkAndHandleBoundary();

      expect(checkpoints).toHaveBeenCalledTimes(1);
      expect(h.history.hasPendingBoundary()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('clear and destroy', () => {
    it('leaves undo and redo nothing to reach for', () => {
      const focused = addBlock(h, 'focused-block');

      seedBlocks(h, ['b1', 'b2']);
      h.focus(focused);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'typed');
      h.history.recordMove(rootMove('b2', 'b1', null), false);

      h.history.clear();

      expect(h.history.canUndo()).toBe(false);
      expect(h.history.canRedo()).toBe(false);

      h.getBlockById.mockClear();
      h.history.undo();
      h.history.redo();

      // A leftover entry is carried into a caret restore whose snapshot was
      // never captured, so the next press either throws or moves the caret.
      expect(h.getBlockById).not.toHaveBeenCalled();
      expect(h.placement).not.toHaveBeenCalled();
    });

    it('re-arms caret capture for the next edit', () => {
      const before = addBlock(h, 'before-block');
      const after = addBlock(h, 'after-block');

      seedBlocks(h, ['b1']);
      h.focus(before);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'first');

      h.history.clear();

      h.focus(before);
      h.history.markCaretBeforeChange();
      h.focus(after);
      editText(h, 'b1', 'second');

      h.setToInput.mockClear();
      h.history.undo();

      expect(lastCaretInput(h)).toBe(before.inputs[0]);
    });

    it('cancels a pending word boundary', () => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });

      h.history.markBoundary();
      h.history.clear();

      expect(h.history.hasPendingBoundary()).toBe(false);
    });

    it('destroy detaches the manager from the document', () => {
      seedBlocks(h, ['b1']);
      editText(h, 'b1', 'one');

      h.history.destroy();
      editText(h, 'b1', 'two');

      expect(h.history.canUndo()).toBe(false);
    });
  });

  describe('history driven from outside UndoHistory', () => {
    it('a direct undo on the manager adds no caret step of its own', () => {
      const edited = addBlock(h, 'edited-block');
      const drifted = addBlock(h, 'drifted-block');

      seedBlocks(h, ['b1']);
      h.focus(edited);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'typed');

      h.focus(drifted);
      h.history.undoManager.undo();

      h.setToInput.mockClear();
      h.history.undo();

      // The item yjs pushed onto its redo stack is not a new user action.
      expect(lastCaretInput(h)).toBe(edited.inputs[0]);
    });

    it('a second redo still knows which caret step it is replaying', () => {
      const first = addBlock(h, 'first-block');
      const second = addBlock(h, 'second-block');

      seedBlocks(h, ['b1']);

      h.focus(first);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'one');
      h.history.stopCapturing();

      h.focus(second);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'one two');

      h.history.undo();
      h.history.undo();
      h.history.redo();

      h.setToInput.mockClear();
      h.history.redo();

      expect(lastCaretInput(h)).toBe(second.inputs[0]);
    });
  });

  describe('a new action discards what redo was holding', () => {
    it('a fresh move leaves redo with nothing to restore', () => {
      h.history.recordMove(rootMove('b1', null, 'b2'), false);
      h.history.undo();

      h.history.recordMove(rootMove('b3', 'b2', null), false);

      expect(h.history.canRedo()).toBe(false);

      h.getBlockById.mockClear();
      h.placement.mockClear();
      h.history.redo();

      // A stale redo entry is carried into a caret restore whose snapshot was
      // never captured, so this press either throws or moves the caret.
      expect(h.getBlockById).not.toHaveBeenCalled();
      expect(h.placement).not.toHaveBeenCalled();
    });
  });

  describe('updateLastCaretAfterPosition', () => {
    it('moves the newest step to where focus ended up after the transaction', () => {
      const recorded = addBlock(h, 'recorded-block');
      const settled = addBlock(h, 'settled-block');

      seedBlocks(h, ['b1']);
      h.focus(recorded);
      h.history.markCaretBeforeChange();
      editText(h, 'b1', 'typed');

      // A structural handler moved the caret after yjs closed the entry.
      h.focus(settled);
      h.history.updateLastCaretAfterPosition();

      h.history.undo();
      h.setToInput.mockClear();
      h.history.redo();

      expect(lastCaretInput(h)).toBe(settled.inputs[0]);
    });
  });
});

/**
 * PROVEN EQUIVALENT (no test can distinguish this mutant):
 *
 * - markBoundary L952 `if (this.pendingBoundary)` forced true: pendingBoundary
 *   is set false only by clearBoundary — which cancels the very timer that
 *   reads the flag — so the callback never runs with the flag false.
 */
describe('UndoHistory — boundary checkpoints', () => {
  let h: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    clearCaret();
    h = createHarness();
    vi.useFakeTimers();
  });

  // The file-level afterEach restores real timers.

  it('checkpoints once the boundary timeout elapses', () => {
    const stop = vi.spyOn(h.history, 'stopCapturing');

    h.history.markBoundary();
    vi.advanceTimersByTime(BOUNDARY_TIMEOUT_MS);

    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not checkpoint a boundary that was cleared', () => {
    const stop = vi.spyOn(h.history, 'stopCapturing');

    h.history.markBoundary();
    h.history.clearBoundary();
    vi.advanceTimersByTime(BOUNDARY_TIMEOUT_MS);

    expect(stop).not.toHaveBeenCalled();
  });

  it('does not touch any timer when the first boundary is marked', () => {
    const clear = vi.spyOn(window, 'clearTimeout');

    h.history.markBoundary();

    expect(clear).not.toHaveBeenCalled();
  });

  it('does not touch any timer when a boundary is cleared with none pending', () => {
    const clear = vi.spyOn(window, 'clearTimeout');

    h.history.clearBoundary();

    expect(clear).not.toHaveBeenCalled();
  });
});

describe('UndoHistory — captureCaretSnapshot before initialization', () => {
  it('returns null instead of dereferencing an uninitialized Blok', () => {
    const ydoc = new Y.Doc();
    const yblocks = ydoc.getArray<Y.Map<unknown>>('blocks');
    const uninitialized = new UndoHistory(
      [yblocks as unknown as UndoScopeType],
      undefined as unknown as BlokModules
    );

    expect(uninitialized.captureCaretSnapshot()).toBeNull();
  });
});

/**
 * PROVEN EQUIVALENT (no test can distinguish these mutants):
 *
 * - undo L373 / redo L422 second-conjunct mutations (`lastMoveGroup.length > 0`
 *   forced true, or weakened to >= 0): endMoveGroup only records a group when
 *   it holds at least one entry, so every group reachable at L373/L422 is
 *   non-empty and the conjunct is settled by `!== undefined` alone.
 */
describe('UndoHistory — undo and redo with no recorded operations', () => {
  let h: Harness;

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.replaceChildren();
    clearCaret();
    h = createHarness();
  });

  it('undo() on an empty history delegates to yjs without throwing', () => {
    expect(() => h.history.undo()).not.toThrow();
    expect(h.placement).not.toHaveBeenCalled();
  });

  it('redo() on an empty history delegates to yjs without throwing', () => {
    expect(() => h.history.redo()).not.toThrow();
    expect(h.placement).not.toHaveBeenCalled();
  });
});
