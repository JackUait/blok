import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { CaretHistoryEntry, UndoScopeType } from '../../../../../src/components/modules/yjs/types';

interface FakeBlock {
  id: string;
  inputs: HTMLElement[];
  currentInputIndex: number;
  currentInput: HTMLElement;
}

const makeBlock = (id: string, text: string): FakeBlock => {
  const input = document.createElement('div');

  input.contentEditable = 'true';
  input.textContent = text;
  document.body.appendChild(input);

  return { id, inputs: [input], currentInputIndex: 0, currentInput: input };
};

const putCaret = (block: FakeBlock, offset: number): void => {
  const text = block.inputs[0].firstChild;

  if (text === null) {
    throw new Error('empty input');
  }
  window.getSelection()?.collapse(text, offset);
};

/**
 * Reading the selection right after a DOM change makes the browser lay out
 * the page again, so a held step (a "+" drag adding a row of cells) must not
 * read it once per write.
 */
describe('UndoHistory caret reads in a held step', () => {
  let history: UndoHistory;
  let ydoc: Y.Doc;
  let yblocks: Y.Array<Y.Map<unknown>>;
  let blocks: FakeBlock[];

  const write = (id: string): void => {
    history.markCaretBeforeChange();
    ydoc.transact(() => {
      const yblock = new Y.Map<unknown>();

      yblock.set('id', id);
      yblocks.push([yblock]);
    }, 'local');
  };

  const internals = (): { caretUndoStack: CaretHistoryEntry[]; caretRedoStack: CaretHistoryEntry[] } =>
    history as unknown as { caretUndoStack: CaretHistoryEntry[]; caretRedoStack: CaretHistoryEntry[] };

  beforeEach(() => {
    vi.clearAllMocks();
    blocks = [makeBlock('a', 'Alpha one'), makeBlock('b', 'Bravo two')];
    ydoc = new Y.Doc();
    yblocks = ydoc.getArray('blocks');

    const blockManager = {
      currentBlock: undefined,
      getBlockById: (id: string) => blocks.find((block) => block.id === id),
      getBlockByChildNode: (node: Node) => blocks.find((block) => block.inputs[0].contains(node)),
      setCurrentBlockByChildNode: vi.fn(),
    };

    history = new UndoHistory([yblocks as unknown as UndoScopeType], {
      BlockManager: blockManager,
      BlockSelection: { clearSelection: vi.fn() },
      Caret: { setToInput: vi.fn(), setToBlock: vi.fn(), positions: { START: 'start', DEFAULT: 'default' } },
    } as unknown as BlokModules);
  });

  afterEach(() => {
    history.destroy();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('reads the selection a fixed number of times however many writes the step takes', () => {
    const reads = vi.spyOn(window, 'getSelection');
    const readsForStep = (writes: number): number => {
      putCaret(blocks[0], 2);
      history.holdCapture();
      history.splitStep();
      reads.mockClear();
      Array.from({ length: writes }, (_, i) => `cell-${writes}-${i}`).forEach(write);
      history.releaseCapture();

      return reads.mock.calls.length;
    };

    const one = readsForStep(1);
    const thirty = readsForStep(30);

    expect(thirty).toBe(one);
    expect(history.undoManager.undoStack).toHaveLength(2);
  });

  it('records the caret where the task left it as the step caret-after', async () => {
    putCaret(blocks[0], 2);
    history.holdCapture();
    history.splitStep();
    write('x');
    putCaret(blocks[1], 3);
    write('y');

    await Promise.resolve();

    expect(internals().caretUndoStack.at(-1)?.after).toMatchObject({ blockId: 'b', offset: 3 });
    expect(internals().caretUndoStack.at(-1)?.before).toMatchObject({ blockId: 'a', offset: 2 });
  });

  it('keeps the latest caret-after when the step is undone in the same task', () => {
    putCaret(blocks[0], 2);
    history.holdCapture();
    history.splitStep();
    write('x');
    putCaret(blocks[1], 3);
    write('y');
    history.releaseCapture();
    history.undo();

    expect(internals().caretRedoStack.at(-1)?.after).toMatchObject({ blockId: 'b', offset: 3 });
  });

  it('takes a fresh caret-before for a step split off inside the hold', () => {
    putCaret(blocks[0], 2);
    history.holdCapture();
    history.splitStep();
    write('x');
    putCaret(blocks[1], 3);
    history.splitStep();
    write('y');

    expect(history.undoManager.undoStack).toHaveLength(2);
    expect(internals().caretUndoStack.at(-1)?.before).toMatchObject({ blockId: 'b', offset: 3 });
  });
});
