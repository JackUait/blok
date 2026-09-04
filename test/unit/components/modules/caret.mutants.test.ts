import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Caret } from '../../../../src/components/modules/caret';
import { Dom as $ } from '../../../../src/components/dom';
import { EventsDispatcher } from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../src/components/block';
import { SelectionUtils as Selection } from '../../../../src/components/selection';
import * as caretUtils from '../../../../src/components/utils/caret/index';

type BlockManagerStub = {
  currentBlock?: Block;
  nextVisibleBlock: Block | null;
  previousVisibleBlock: Block | null;
  blocks: Block[];
  insertAtEnd: ReturnType<typeof vi.fn>;
  setCurrentBlockByChildNode: ReturnType<typeof vi.fn>;
  getBlockById: ReturnType<typeof vi.fn>;
};

type BlockSelectionStub = {
  clearSelection: ReturnType<typeof vi.fn>;
  selectBlock: ReturnType<typeof vi.fn>;
};

type CaretSetup = {
  caret: Caret;
  blockManager: BlockManagerStub;
  blockSelection: BlockSelectionStub;
};

type BlockOptions = {
  id?: string;
  focusable?: boolean;
  isEmpty?: boolean;
  parentId?: string | null;
  inputs?: {
    first?: HTMLElement;
    last?: HTMLElement;
    current?: HTMLElement;
  };
};

const createContentEditable = (html = 'text'): HTMLElement => {
  const element = document.createElement('div');

  element.contentEditable = 'true';
  element.innerHTML = html;

  return element;
};

const createBlock = (options: BlockOptions = {}): Block => {
  const holder = document.createElement('div');
  const inputs = [ options.inputs?.current, options.inputs?.first, options.inputs?.last ];

  inputs.forEach((input) => {
    if (input && !holder.contains(input)) {
      holder.appendChild(input);
    }
  });

  const defaultInput = options.inputs?.current ?? createContentEditable();

  if (!holder.contains(defaultInput)) {
    holder.appendChild(defaultInput);
  }

  const blockStub = {
    holder,
    id: options.id ?? `block-${Math.random().toString(36).slice(2)}`,
    focusable: options.focusable ?? true,
    isEmpty: options.isEmpty ?? false,
    parentId: options.parentId ?? null,
    tool: { isDefault: true },
    firstInput: options.inputs?.first ?? defaultInput,
    lastInput: options.inputs?.last ?? defaultInput,
    currentInput: defaultInput,
    nextInput: undefined,
    previousInput: undefined,
  };

  return blockStub as unknown as Block;
};

const createCaret = (): CaretSetup => {
  const blockManager: BlockManagerStub = {
    currentBlock: undefined,
    nextVisibleBlock: null,
    previousVisibleBlock: null,
    blocks: [],
    insertAtEnd: vi.fn(),
    setCurrentBlockByChildNode: vi.fn(),
    getBlockById: vi.fn(),
  };

  const blockSelection: BlockSelectionStub = {
    clearSelection: vi.fn(),
    selectBlock: vi.fn(),
  };

  const caret = new Caret({
    config: { sanitizer: {} },
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  caret.state = {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    BlockSelection: blockSelection as unknown as BlokModules['BlockSelection'],
  } as BlokModules;

  return {
    caret,
    blockManager,
    blockSelection,
  };
};

const cursorRect = (top: number, bottom: number): DOMRect =>
  ({
    top,
    bottom,
  }) as unknown as DOMRect;

describe('Caret — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  /**
   * No `caret.set` spy anywhere in this block — spying it would hide the
   * scrolling that `set` itself performs.
   */
  describe('set — scrolling the caret into view', () => {
    it('scrolls up by the caret top plus a margin and skips the downward scroll', () => {
      const { caret } = createCaret();

      vi.spyOn(Selection, 'setCursor').mockReturnValue(cursorRect(-50, window.innerHeight + 500));
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

      caret.set(createContentEditable(), 0);

      expect(scrollBy).toHaveBeenCalledTimes(1);
      expect(scrollBy).toHaveBeenCalledWith(0, -80);
    });

    it('does not scroll when the caret sits exactly inside the viewport edges', () => {
      const { caret } = createCaret();

      vi.spyOn(Selection, 'setCursor').mockReturnValue(cursorRect(0, window.innerHeight));
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

      caret.set(createContentEditable(), 0);

      expect(scrollBy).not.toHaveBeenCalled();
    });

    it('scrolls down by the overflow below the viewport plus a margin', () => {
      const { caret } = createCaret();

      vi.spyOn(Selection, 'setCursor').mockReturnValue(cursorRect(10, window.innerHeight + 100));
      const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => undefined);

      caret.set(createContentEditable(), 0);

      expect(scrollBy).toHaveBeenCalledTimes(1);
      expect(scrollBy).toHaveBeenCalledWith(0, 130);
    });
  });

  describe('setToBlockAtXPosition', () => {
    it('places the caret at the given X inside the first input', () => {
      const { caret, blockManager } = createCaret();
      const first = createContentEditable('first');
      const last = createContentEditable('last');
      const block = createBlock({ inputs: { first,
        last,
        current: last } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlockAtXPosition(block, 42, true);

      expect(setCaretAtX).toHaveBeenCalledWith(first, 42, true);
      expect(setSpy).not.toHaveBeenCalled();
      expect(blockManager.setCurrentBlockByChildNode).toHaveBeenCalledWith(block.holder);
      expect(block.currentInput).toBe(first);
    });

    it('places the caret at the end of the last input when no X is given', () => {
      const { caret, blockManager } = createCaret();
      const first = createContentEditable('first');
      const last = createContentEditable('last');
      const block = createBlock({ inputs: { first,
        last,
        current: first } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlockAtXPosition(block, null, false);

      expect(setCaretAtX).not.toHaveBeenCalled();
      expect(setSpy).toHaveBeenCalledWith(last.firstChild, 4);
      expect(block.currentInput).toBe(last);
    });

    it('survives a block manager that cannot resolve a current block', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();

      vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(() => caret.setToBlockAtXPosition(block, 42, true)).not.toThrow();
      expect(blockManager.currentBlock).toBeUndefined();
    });
  });

  describe('setToInputAtXPosition', () => {
    it('places the caret at the given X and marks the input as current', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();
      const input = createContentEditable('other');

      blockManager.currentBlock = block;

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInputAtXPosition(input, 12, false);

      expect(setCaretAtX).toHaveBeenCalledWith(input, 12, false);
      expect(setSpy).not.toHaveBeenCalled();
      expect(block.currentInput).toBe(input);
    });

    it('places the caret at the very start of the input when no X is given', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock();
      const input = createContentEditable('<b>Alpha</b>Beta');

      blockManager.currentBlock = block;

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);
      const firstTextNode = input.querySelector('b')?.firstChild ?? null;

      caret.setToInputAtXPosition(input, null, true);

      expect(setCaretAtX).not.toHaveBeenCalled();
      expect(firstTextNode).not.toBeNull();
      expect(setSpy).toHaveBeenCalledWith(firstTextNode, 0);
    });

    it('leaves the caret untouched when no node can be reached inside the input', () => {
      const { caret, blockManager } = createCaret();

      blockManager.currentBlock = createBlock();

      vi.spyOn($, 'getDeepestNode').mockReturnValue(null);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInputAtXPosition(createContentEditable('Alpha'), null, true);

      expect(setSpy).not.toHaveBeenCalled();
    });

    it('survives being called while no block is current', () => {
      const { caret, blockManager } = createCaret();

      blockManager.currentBlock = undefined;
      vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(() => caret.setToInputAtXPosition(createContentEditable(), 12, false)).not.toThrow();
    });
  });

  describe('setToBlock at the end of an input that holds no text', () => {
    it('falls back to the deepest node of the input itself', () => {
      const { caret, blockManager } = createCaret();
      const input = document.createElement('div');

      input.innerHTML = '<img src="picture.png">';

      const block = createBlock({ inputs: { first: input,
        last: input,
        current: input } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.END);

      expect(setSpy).toHaveBeenCalledWith(input, 0);
    });

    it('does nothing when neither a text node nor a deepest node can be resolved', () => {
      const { caret } = createCaret();
      const input = document.createElement('div');

      input.innerHTML = '<img src="picture.png">';

      const block = createBlock({ inputs: { first: input,
        last: input,
        current: input } });

      vi.spyOn($, 'getDeepestNode').mockReturnValue(null);
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(() => caret.setToBlock(block, caret.positions.END)).not.toThrow();
      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  describe('setToInput with a default position', () => {
    it('falls back to the end of an input that has no text nodes at all', () => {
      const { caret, blockManager } = createCaret();
      const input = document.createElement('div');

      blockManager.currentBlock = createBlock();

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInput(input);

      expect(setSpy).toHaveBeenCalledWith(input, 0);
    });
  });

  describe('vertical navigation onto a target block', () => {
    const setupVertical = (next: Block | null): CaretSetup => {
      const setup = createCaret();
      const current = createBlock({ isEmpty: true });

      setup.blockManager.currentBlock = current;
      setup.blockManager.nextVisibleBlock = next;

      return setup;
    };

    it('reports no navigation when there is no next block', () => {
      const { caret, blockSelection } = setupVertical(null);

      expect(caret.navigateVerticalNext()).toBe(false);
      expect(blockSelection.selectBlock).not.toHaveBeenCalled();
    });

    it('moves the caret into a focusable next block', () => {
      const next = createBlock();
      const { caret, blockManager, blockSelection } = setupVertical(next);

      vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(caret.navigateVerticalNext()).toBe(true);
      expect(blockManager.setCurrentBlockByChildNode).toHaveBeenCalledWith(next.holder);
      expect(blockSelection.selectBlock).not.toHaveBeenCalled();
    });

    it('selects a next block that cannot hold a caret', () => {
      const next = createBlock({ focusable: false });
      const { caret, blockManager, blockSelection } = setupVertical(next);

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(caret.navigateVerticalNext()).toBe(true);
      expect(blockSelection.selectBlock).toHaveBeenCalledWith(next);
      expect(blockManager.currentBlock).toBe(next);
      expect(blockManager.setCurrentBlockByChildNode).not.toHaveBeenCalled();
      // Selecting a block clears the previous selection exactly once; a second
      // clear means the focusable branch ran instead.
      expect(blockSelection.clearSelection).toHaveBeenCalledTimes(1);
    });
  });

  describe('setToBlock at the end of formatted text', () => {
    const endOfBlock = (html: string): { setSpy: ReturnType<typeof vi.spyOn>; input: HTMLElement } => {
      const { caret, blockManager } = createCaret();
      const input = createContentEditable(html);
      const block = createBlock({ inputs: { first: input,
        last: input,
        current: input } });

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToBlock(block, caret.positions.END);

      return {
        setSpy,
        input,
      };
    };

    it('keeps the caret inside the last formatted run when the text ends with punctuation', () => {
      const { setSpy, input } = endOfBlock('Alpha<b>Beta</b>.');
      const beta = input.querySelector('b')?.firstChild ?? null;

      expect(beta).not.toBeNull();
      expect(setSpy).toHaveBeenCalledWith(beta, 4);
    });

    it('lands on the trailing punctuation when the block holds nothing else', () => {
      const { setSpy, input } = endOfBlock('<b>...</b>');
      const dots = input.querySelector('b')?.firstChild ?? null;

      expect(dots).not.toBeNull();
      expect(setSpy).toHaveBeenCalledWith(dots, 3);
    });

    it('lands after the trailing punctuation when the meaningful text is not nested', () => {
      const { setSpy, input } = endOfBlock('Hello<b>.</b>');
      const dot = input.querySelector('b')?.firstChild ?? null;

      expect(dot).not.toBeNull();
      expect(setSpy).toHaveBeenCalledWith(dot, 1);
    });
  });

  describe('navigatePrevious', () => {
    it('reports no navigation when there is no current block', () => {
      const { caret } = createCaret();

      expect(caret.navigatePrevious()).toBe(false);
    });

    it('stays inside the block when the caret is not at its start', () => {
      const { caret, blockManager } = createCaret();

      blockManager.currentBlock = createBlock();
      blockManager.previousVisibleBlock = createBlock();
      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      expect(caret.navigatePrevious()).toBe(false);
      expect(setSpy).not.toHaveBeenCalled();
    });
  });

  describe('vertical navigation out of a container', () => {
    it('lands on the first block after the whole container', () => {
      const { caret, blockManager } = createCaret();
      const before = createBlock({ id: 'before',
        inputs: { current: createContentEditable('before') } });
      const container = createBlock({ id: 'container',
        inputs: { current: createContentEditable('container') } });
      const child = createBlock({ id: 'child',
        parentId: 'container',
        inputs: { current: createContentEditable('child') } });
      const after = createBlock({ id: 'after',
        inputs: { current: createContentEditable('after') } });

      blockManager.blocks = [ before, container, child, after ];
      blockManager.currentBlock = child;
      blockManager.nextVisibleBlock = null;
      blockManager.getBlockById.mockImplementation((id: string) =>
        blockManager.blocks.find(candidate => candidate.id === id));

      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(100);

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(caret.navigateVerticalNext()).toBe(true);
      expect(setCaretAtX).toHaveBeenCalledWith(after.firstInput, 100, true);
      expect(blockManager.insertAtEnd).not.toHaveBeenCalled();
    });

    it('appends a fresh block when the container has nothing after it', () => {
      const { caret, blockManager } = createCaret();
      // A table cell is not itself a registered block, so the container id
      // resolves to nothing in the flat block array.
      const other = createBlock({ id: 'other',
        inputs: { current: createContentEditable('other') } });
      const child = createBlock({ id: 'child',
        parentId: 'cell',
        inputs: { current: createContentEditable('child') } });
      const appended = createBlock({ id: 'appended',
        inputs: { current: createContentEditable('appended') } });

      blockManager.blocks = [ other, child ];
      blockManager.currentBlock = child;
      blockManager.nextVisibleBlock = null;
      blockManager.getBlockById.mockReturnValue(undefined);
      blockManager.insertAtEnd.mockReturnValue(appended);

      vi.spyOn(caretUtils, 'isCaretAtLastLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(100);
      vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(caret.navigateVerticalNext()).toBe(true);
      expect(blockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      expect(setCaretAtX).not.toHaveBeenCalled();
    });

    it('lands on the block sitting right before the container', () => {
      const { caret, blockManager } = createCaret();
      const before = createBlock({ id: 'before',
        inputs: { current: createContentEditable('before') } });
      const container = createBlock({ id: 'container',
        inputs: { current: createContentEditable('container') } });
      const child = createBlock({ id: 'child',
        parentId: 'container',
        inputs: { current: createContentEditable('child') } });

      blockManager.blocks = [ before, container, child ];
      blockManager.currentBlock = child;
      blockManager.previousVisibleBlock = null;
      blockManager.getBlockById.mockImplementation((id: string) =>
        blockManager.blocks.find(candidate => candidate.id === id));

      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(100);

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(caret.navigateVerticalPrevious()).toBe(true);
      expect(setCaretAtX).toHaveBeenCalledWith(before.lastInput, 100, false);
    });

    it('reports no navigation when the container is the very first block', () => {
      const { caret, blockManager } = createCaret();
      const container = createBlock({ id: 'container' });
      const child = createBlock({ id: 'child',
        parentId: 'container' });

      blockManager.blocks = [ container, child ];
      blockManager.currentBlock = child;
      blockManager.previousVisibleBlock = null;
      blockManager.getBlockById.mockImplementation((id: string) =>
        blockManager.blocks.find(candidate => candidate.id === id));

      vi.spyOn(caretUtils, 'isCaretAtFirstLine').mockReturnValue(true);
      vi.spyOn(caretUtils, 'getCaretXPosition').mockReturnValue(100);

      const setCaretAtX = vi.spyOn(caretUtils, 'setCaretAtXPosition').mockImplementation(() => undefined);

      expect(caret.navigateVerticalPrevious()).toBe(false);
      expect(setCaretAtX).not.toHaveBeenCalled();
    });
  });
});
