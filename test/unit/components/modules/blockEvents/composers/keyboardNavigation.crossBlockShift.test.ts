import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardNavigation } from '../../../../../../src/components/modules/blockEvents/composers/keyboardNavigation';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';
import { keyCodes } from '../../../../../../src/components/utils';
import * as caretUtils from '../../../../../../src/components/utils/caret/index';

interface Line {
  block: Block;
  input: HTMLElement;
  text: Text;
}

const line = (id: string, value: string): Line => {
  const holder = document.createElement('div');
  const input = document.createElement('div');
  const text = document.createTextNode(value);

  input.setAttribute('contenteditable', 'true');
  input.appendChild(text);
  holder.appendChild(input);
  document.body.appendChild(holder);

  const block = {
    id,
    name: 'paragraph',
    holder,
    currentInput: input,
    inputs: [input],
    focusable: true,
    updateCurrentInput: vi.fn(),
  } as unknown as Block;

  return { block, input, text };
};

const collapseAt = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
};

interface Setup {
  nav: KeyboardNavigation;
  first: Line;
  second: Line;
  navigateVerticalNext: ReturnType<typeof vi.fn>;
}

/**
 * Two text blocks. `navigateVerticalNext` moves a collapsed caret into the second
 * block at offset 4, the way the real Caret module does on the last line.
 */
const setup = (options: { insideTableCell?: boolean; next?: boolean; selectableAcross?: boolean } = {}): Setup => {
  const first = line('b1', 'Alpha one');
  const second = line('b2', 'Beta two');

  if (options.insideTableCell === true) {
    const cell = document.createElement('div');

    cell.setAttribute('data-blok-table-cell-blocks', '');
    cell.appendChild(first.block.holder);
    document.body.appendChild(cell);
  }

  const blockManager = {
    currentBlock: first.block,
    nextVisibleBlock: options.next === false ? null : second.block,
    setCurrentBlockByChildNode: vi.fn((node: Node) => {
      blockManager.currentBlock = second.input.contains(node) ? second.block : first.block;
    }),
    getBlockByChildNode: (node: Node): Block => (second.input.contains(node) ? second.block : first.block),
  };
  const navigateVerticalNext = vi.fn(() => {
    collapseAt(second.text, 4);

    return true;
  });

  const blok = {
    BlockManager: blockManager,
    Caret: { navigateVerticalNext, navigateNext: vi.fn(() => false), resetGoalColumn: vi.fn() },
    Toolbar: { close: vi.fn(), moveAndOpen: vi.fn(), hideBlockActions: vi.fn() },
    InlineToolbar: { close: vi.fn(), tryToShow: vi.fn(() => Promise.resolve()) },
    UI: { someToolbarOpened: false, nodes: {} },
    BlockSelection: { anyBlockSelected: false, clearSelection: vi.fn(), selectBlock: vi.fn() },
    CrossBlockSelection: {
      toggleBlockSelectedState: vi.fn(),
      canSelectTextAcross: vi.fn(() => options.selectableAcross ?? true),
    },
  } as unknown as BlokModules;

  return { nav: new KeyboardNavigation(blok), first, second, navigateVerticalNext };
};

const shiftDown = (): KeyboardEvent => new KeyboardEvent('keydown', {
  key: 'ArrowDown',
  keyCode: keyCodes.DOWN,
  shiftKey: true,
  cancelable: true,
});

const selectionPoints = (): { anchor: [Node | null, number]; focus: [Node | null, number] } => {
  const selection = document.getSelection();

  return {
    anchor: [selection?.anchorNode ?? null, selection?.anchorOffset ?? -1],
    focus: [selection?.focusNode ?? null, selection?.focusOffset ?? -1],
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Shift+ArrowDown from inside a block\'s text', () => {
  it('keeps the anchor and moves the focus into the next block', () => {
    const { nav, first, second } = setup();

    collapseAt(first.text, 6);
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    const event = shiftDown();

    nav.handleArrowRightAndDown(event);

    expect(selectionPoints()).toEqual({
      anchor: [first.text, 6],
      focus: [second.text, 4],
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('never lets the move append a block after a container', () => {
    const { nav, first, navigateVerticalNext } = setup();

    collapseAt(first.text, 6);
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    nav.handleArrowRightAndDown(shiftDown());

    expect(navigateVerticalNext).toHaveBeenCalledWith(false, false);
  });

  it('moves from the focus end of a selection, not from its anchor', () => {
    const { nav, first, second, navigateVerticalNext } = setup();

    document.getSelection()?.setBaseAndExtent(first.text, 2, first.text, 6);
    navigateVerticalNext.mockImplementation(() => {
      const selection = document.getSelection();

      expect([selection?.isCollapsed, selection?.focusNode, selection?.focusOffset]).toEqual([true, first.text, 6]);
      collapseAt(second.text, 4);

      return true;
    });
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    nav.handleArrowRightAndDown(shiftDown());

    expect(selectionPoints()).toEqual({
      anchor: [first.text, 2],
      focus: [second.text, 4],
    });
  });

  it('leaves the selection to the browser when the focus is not on the last line', () => {
    const { nav, first, navigateVerticalNext } = setup();

    document.getSelection()?.setBaseAndExtent(first.text, 2, first.text, 6);
    navigateVerticalNext.mockReturnValue(false);
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    const event = shiftDown();

    nav.handleArrowRightAndDown(event);

    expect(selectionPoints()).toEqual({
      anchor: [first.text, 2],
      focus: [first.text, 6],
    });
    expect(event.defaultPrevented).toBe(false);
  });

  it('only moves the caret when the next block is in another container', () => {
    const { nav, first, second } = setup({ selectableAcross: false });

    collapseAt(first.text, 6);
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    nav.handleArrowRightAndDown(shiftDown());

    expect(selectionPoints()).toEqual({
      anchor: [second.text, 4],
      focus: [second.text, 4],
    });
  });

  it('does not move at all when no block follows', () => {
    const { nav, first, navigateVerticalNext } = setup({ next: false });

    collapseAt(first.text, 6);
    vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

    nav.handleArrowRightAndDown(shiftDown());

    expect(navigateVerticalNext).not.toHaveBeenCalled();
    expect(selectionPoints().focus).toEqual([first.text, 6]);
  });
});

describe('Shift+End over a selection that spans two blocks', () => {
  const shiftEnd = (): KeyboardEvent => new KeyboardEvent('keydown', { key: 'End', shiftKey: true, cancelable: true });

  /** jsdom has no Selection.modify; this one moves a caret to the end of its text node, like a one-line block. */
  const stubLineEndMove = (): void => {
    const selection = document.getSelection();

    if (selection === null) {
      throw new Error('no selection');
    }
    Object.defineProperty(selection, 'modify', {
      configurable: true,
      value: (alter: string, direction: string, granularity: string): void => {
        if (alter === 'move' && direction === 'forward' && granularity === 'lineboundary' && selection.focusNode !== null) {
          selection.collapse(selection.focusNode, selection.focusNode.textContent?.length ?? 0);
        }
      },
    });
  };

  afterEach(() => {
    const selection = document.getSelection();

    if (selection !== null) {
      Reflect.deleteProperty(selection, 'modify');
    }
  });

  it('moves the focus to the end of its line and keeps the anchor in the other block', () => {
    const { nav, first, second } = setup();

    stubLineEndMove();
    document.getSelection()?.setBaseAndExtent(first.text, 6, second.text, 4);

    const event = shiftEnd();

    nav.handleShiftEnd(event);

    expect(selectionPoints()).toEqual({
      anchor: [first.text, 6],
      focus: [second.text, 8],
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves a selection inside one block to the browser', () => {
    const { nav, first } = setup();

    stubLineEndMove();
    document.getSelection()?.setBaseAndExtent(first.text, 2, first.text, 4);

    const event = shiftEnd();

    nav.handleShiftEnd(event);

    expect(selectionPoints().focus).toEqual([first.text, 4]);
    expect(event.defaultPrevented).toBe(false);
  });
});
