import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { UndoHistory } from '../../../../../src/components/modules/yjs/undo-history';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

interface FakeBlock {
  id: string;
  inputs: HTMLElement[];
  currentInput: HTMLElement;
  currentInputIndex: number;
  parentId: string | null;
  selected: boolean;
  holder: HTMLElement;
}

const makeBlock = (id: string, text: string): FakeBlock => {
  const holder = document.createElement('div');
  const input = document.createElement('div');

  holder.setAttribute('data-blok-id', id);
  input.contentEditable = 'true';
  input.textContent = text;
  holder.appendChild(input);
  document.body.appendChild(holder);

  return { id, inputs: [input], currentInput: input, currentInputIndex: 0, parentId: null, selected: false, holder };
};

const textNode = (block: FakeBlock): Node => {
  const node = block.inputs[0].firstChild;

  if (node === null) {
    throw new Error(`block ${block.id} has no text`);
  }

  return node;
};

const putCaret = (block: FakeBlock, offset: number, end = offset): void => {
  const node = textNode(block);

  window.getSelection()?.setBaseAndExtent(node, offset, node, end);
};

describe('UndoHistory: the selection at the undo press', () => {
  let ydoc: Y.Doc;
  let ydata: Y.Map<unknown>;
  let history: UndoHistory;
  let blocks: FakeBlock[];
  let blok: BlokModules;
  let caret: { setToInput: ReturnType<typeof vi.fn>; setToBlock: ReturnType<typeof vi.fn>; positions: Record<string, string> };
  let selectBlock: ReturnType<typeof vi.fn>;
  let toolbar: { opened: boolean; close: ReturnType<typeof vi.fn>; tryToShow: ReturnType<typeof vi.fn>; followRestoredRange: ReturnType<typeof vi.fn> };

  const blockOf = (node: Node): FakeBlock | undefined =>
    blocks.find((block) => block.inputs.some((input) => input === node || input.contains(node)));

  const write = (value: string): void => {
    ydoc.transact(() => ydata.set('text', value), 'local');
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ydoc = new Y.Doc();
    ydata = ydoc.getMap('data');
    blocks = [makeBlock('a', 'Alpha'), makeBlock('b', 'Beta'), makeBlock('c', 'Gamma')];

    caret = {
      // Moves the real selection, so a later press reads where the restore left it.
      setToInput: vi.fn((input: HTMLElement, _position: string, offset: number) => {
        const node = input.firstChild;

        if (node !== null) {
          window.getSelection()?.setBaseAndExtent(node, offset, node, offset);
        }
      }),
      setToBlock: vi.fn(),
      positions: { START: 'start', END: 'end', DEFAULT: 'default' },
    };
    selectBlock = vi.fn((block: FakeBlock) => {
      window.getSelection()?.removeAllRanges();
      Object.assign(block, { selected: true });
    });
    toolbar = { opened: false, close: vi.fn(), tryToShow: vi.fn(), followRestoredRange: vi.fn() };

    blok = {
      BlockManager: {
        currentBlock: undefined,
        getBlockById: (id: string) => blocks.find((block) => block.id === id),
        getBlockByChildNode: (node: Node) => blockOf(node),
        setCurrentBlockByChildNode: vi.fn(),
      },
      BlockSelection: {
        get selectedBlocks() {
          return blocks.filter((block) => block.selected);
        },
        get anyBlockSelected() {
          return blocks.some((block) => block.selected);
        },
        clearSelection: vi.fn(() => blocks.forEach((block) => Object.assign(block, { selected: false }))),
        selectBlock,
        adoptSelectionIntoNavigationMode: vi.fn(() => false),
      },
      InlineToolbar: toolbar,
      Caret: caret,
    } as unknown as BlokModules;

    history = new UndoHistory([ydata], blok);
  });

  afterEach(() => {
    history.destroy();
    blocks.forEach((block) => block.holder.remove());
    window.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  it('redo puts the caret where it was at the matching undo press, not at the end of the edit', () => {
    putCaret(blocks[0], 5);
    history.beginGesture('typing');
    write('Alpha one');
    putCaret(blocks[2], 5);

    history.undo();
    caret.setToInput.mockClear();
    history.redo();

    expect(caret.setToInput).toHaveBeenLastCalledWith(blocks[2].inputs[0], 'default', 5);
  });

  it('redo gives back the block selection that was live at the undo press, with no caret', () => {
    putCaret(blocks[0], 5);
    history.beginGesture('typing');
    write('Alpha x');
    window.getSelection()?.removeAllRanges();
    blocks[0].selected = true;

    history.undo();
    caret.setToInput.mockClear();
    selectBlock.mockClear();
    history.redo();

    expect(selectBlock).toHaveBeenCalledWith(blocks[0]);
    expect(blocks.filter((block) => block.selected).map((block) => block.id)).toEqual(['a']);
    expect(caret.setToInput).not.toHaveBeenCalled();
  });

  it('redo falls back to the step\'s own caret when the undo press had no selection in the editor', () => {
    putCaret(blocks[0], 5);
    history.beginGesture('typing');
    write('Alpha one');
    window.getSelection()?.removeAllRanges();

    history.undo();
    window.getSelection()?.removeAllRanges();
    caret.setToInput.mockClear();
    history.redo();

    expect(caret.setToInput).toHaveBeenLastCalledWith(blocks[0].inputs[0], 'default', 5);
  });

  it('undo of a step made on a block selection gives that block selection back, with no caret', () => {
    window.getSelection()?.removeAllRanges();
    blocks[1].selected = true;
    history.beginGesture('discrete');
    write('deleted b');
    blocks[1].selected = false;
    putCaret(blocks[0], 0);

    caret.setToInput.mockClear();
    history.undo();

    expect(blocks.filter((block) => block.selected).map((block) => block.id)).toEqual(['b']);
    expect(caret.setToInput).not.toHaveBeenCalled();
  });

  it('undo selects a block that has no text input instead of dropping the caret nowhere', () => {
    const bare = { ...makeBlock('x', ''), inputs: [] };

    blocks.push(bare);
    putCaret(blocks[0], 5);
    history.beginGesture('discrete');
    write('colour');
    (history as unknown as { caretUndoStack: Array<{ before: unknown }> }).caretUndoStack[0].before = { blockId: 'x', inputIndex: 0, offset: 0 };

    history.undo();

    expect(selectBlock).toHaveBeenCalledWith(bare);
    expect(caret.setToBlock).not.toHaveBeenCalled();
  });

  it('keeps focus on a block\'s own control, like a to-do checkbox, through undo and redo', () => {
    const checkbox = document.createElement('input');

    checkbox.type = 'checkbox';
    blocks[0].holder.prepend(checkbox);
    putCaret(blocks[0], 5);
    checkbox.focus();
    history.beginGesture('discrete');
    write('checked');

    history.undo();
    expect(checkbox).toHaveFocus();
    expect(caret.setToInput).not.toHaveBeenCalled();

    history.redo();
    expect(checkbox).toHaveFocus();
    expect(caret.setToInput).not.toHaveBeenCalled();
  });

  it('undo of typing puts the caret back in the text even when the block\'s checkbox has focus', () => {
    const checkbox = document.createElement('input');

    checkbox.type = 'checkbox';
    blocks[0].holder.prepend(checkbox);
    putCaret(blocks[0], 5);
    history.beginGesture('typing');
    write('Alpha one');
    blocks[0].inputs[0].textContent = 'Alpha one';
    putCaret(blocks[0], 9);
    checkbox.focus();

    history.undo();

    expect(caret.setToInput).toHaveBeenLastCalledWith(blocks[0].inputs[0], 'default', 5);
  });

  it('puts the restored caret back into a block the replay rebuilt after the restore', () => {
    putCaret(blocks[0], 5);
    history.beginGesture('typing');
    write('Alpha one');
    history.undo();

    // The rebuild swaps in a new block with the same id, and focus drops.
    const rebuilt = makeBlock('a', 'Alpha one');

    blocks[0].holder.remove();
    blocks[0] = rebuilt;
    window.getSelection()?.removeAllRanges();
    caret.setToInput.mockClear();

    history.reapplyCaretAfterRebuild('a');

    expect(caret.setToInput).toHaveBeenLastCalledWith(rebuilt.inputs[0], 'default', 5);
  });

  it('puts the restored caret back when the replay rebuilt the block\'s container', () => {
    blocks[1].parentId = 'a';
    putCaret(blocks[1], 4);
    history.beginGesture('discrete');
    write('container colour');
    history.undo();
    window.getSelection()?.removeAllRanges();
    caret.setToInput.mockClear();

    history.reapplyCaretAfterRebuild('a');

    expect(caret.setToInput).toHaveBeenLastCalledWith(blocks[1].inputs[0], 'default', 4);
  });

  it('selects a block again when the replay rebuilt it after its block selection was restored', () => {
    window.getSelection()?.removeAllRanges();
    blocks[1].selected = true;
    history.beginGesture('discrete');
    write('turned into a heading');
    history.undo();
    expect(blocks[1].selected).toBe(true);

    // The rebuild swaps in a new, unselected block with the same id.
    const rebuilt = makeBlock('b', 'Beta');

    blocks[1].holder.remove();
    blocks[1] = rebuilt;

    history.reapplyCaretAfterRebuild('b');

    expect(rebuilt.selected).toBe(true);
    expect(caret.setToInput).not.toHaveBeenCalled();
  });

  it('leaves the caret alone after a rebuild when the user has moved it', () => {
    putCaret(blocks[0], 5);
    history.beginGesture('typing');
    write('Alpha one');
    history.undo();
    putCaret(blocks[2], 2);
    history.beginGesture('discrete');
    caret.setToInput.mockClear();

    history.reapplyCaretAfterRebuild('a');

    expect(caret.setToInput).not.toHaveBeenCalled();
  });

  it('a caret restore still clears a block selection left from before', () => {
    putCaret(blocks[0], 5);
    history.beginGesture('typing');
    write('Alpha one');
    window.getSelection()?.removeAllRanges();
    blocks[2].selected = true;

    history.undo();

    expect(blocks.some((block) => block.selected)).toBe(false);
    expect(caret.setToInput).toHaveBeenLastCalledWith(blocks[0].inputs[0], 'default', 5);
  });

  it('keeps an open inline toolbar open over a restored range and refreshes its active states', () => {
    putCaret(blocks[0], 0, 5);
    history.beginGesture('discrete');
    write('bold');
    toolbar.opened = true;

    history.undo();

    expect(toolbar.close).not.toHaveBeenCalled();
    expect(toolbar.followRestoredRange).toHaveBeenCalled();
  });

  it('starts a restored range inside the mark it covers, so the toolbar reads the mark', () => {
    const input = blocks[0].inputs[0];

    input.innerHTML = 'Hello <i>brave</i> world';
    const word = input.querySelector('i')?.firstChild ?? null;

    if (word === null) {
      throw new Error('no mark');
    }
    window.getSelection()?.setBaseAndExtent(word, 0, word, 5);
    history.beginGesture('discrete');
    write('italic');
    putCaret(blocks[1], 0);

    history.undo();

    expect(window.getSelection()?.getRangeAt(0).startContainer).toBe(word);
    expect(window.getSelection()?.toString()).toBe('brave');
  });

  it('opens the inline toolbar for a restored non-collapsed range', () => {
    putCaret(blocks[0], 0, 5);
    history.beginGesture('discrete');
    write('deleted range');
    putCaret(blocks[0], 0);

    history.undo();

    const selection = window.getSelection();

    expect(selection?.isCollapsed).toBe(false);
    expect(toolbar.tryToShow).toHaveBeenCalled();
  });
});
