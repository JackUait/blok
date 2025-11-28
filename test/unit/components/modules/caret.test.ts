import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Caret from '../../../../src/components/modules/caret';
import EventsDispatcher from '../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../src/components/events';
import type { BlokModules } from '../../../../src/types-internal/blok-modules';
import type { BlokConfig } from '../../../../types';
import type Block from '../../../../src/components/block';
import Selection from '../../../../src/components/selection';
import * as caretUtils from '../../../../src/components/utils/caret';

type BlockManagerStub = {
  currentBlock?: Block;
  nextBlock: Block | null;
  previousBlock: Block | null;
  lastBlock?: Block;
  insertAtEnd: ReturnType<typeof vi.fn>;
  setCurrentBlockByChildNode: ReturnType<typeof vi.fn>;
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
  focusable?: boolean;
  isEmpty?: boolean;
  tool?: { isDefault: boolean };
  inputs?: {
    first?: HTMLElement;
    last?: HTMLElement;
    current?: HTMLElement;
    next?: HTMLElement;
    previous?: HTMLElement;
  };
};

const createContentEditable = (html = 'text'): HTMLElement => {
  const element = document.createElement('div');

  element.contentEditable = 'true';
  element.innerHTML = html;

  return element;
};

const attachInput = (holder: HTMLElement, input?: HTMLElement): HTMLElement | undefined => {
  if (!input) {
    return undefined;
  }

  if (!holder.contains(input)) {
    holder.appendChild(input);
  }

  return input;
};

const createBlock = (options: BlockOptions = {}): Block => {
  const holder = document.createElement('div');

  holder.classList.add('blok-element');

  const defaultInput = attachInput(holder, options.inputs?.current) ?? createContentEditable();

  attachInput(holder, options.inputs?.first);
  attachInput(holder, options.inputs?.last);

  const blockStub = {
    holder,
    focusable: options.focusable ?? true,
    isEmpty: options.isEmpty ?? false,
    tool: options.tool ?? { isDefault: true },
    firstInput: options.inputs?.first ?? defaultInput,
    lastInput: options.inputs?.last ?? defaultInput,
    currentInput: defaultInput,
    nextInput: options.inputs?.next,
    previousInput: options.inputs?.previous,
  };

  return blockStub as unknown as Block;
};

const createCaret = (overrides: Partial<BlokModules> = {}): CaretSetup => {
  const blockManager: BlockManagerStub = {
    currentBlock: undefined,
    nextBlock: null,
    previousBlock: null,
    lastBlock: undefined,
    insertAtEnd: vi.fn(),
    setCurrentBlockByChildNode: vi.fn(),
  };

  const blockSelection: BlockSelectionStub = {
    clearSelection: vi.fn(),
    selectBlock: vi.fn(),
  };

  const defaults: Partial<BlokModules> = {
    BlockManager: blockManager as unknown as BlokModules['BlockManager'],
    BlockSelection: blockSelection as unknown as BlokModules['BlockSelection'],
  };

  const caret = new Caret({
    config: { sanitizer: {} } as BlokConfig,
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  caret.state = {
    ...defaults,
    ...overrides,
  } as BlokModules;

  return {
    caret,
    blockManager,
    blockSelection,
  };
};

const setCollapsedSelection = (node: Node, offset: number): void => {
  const selection = window.getSelection();
  const range = document.createRange();

  range.setStart(node, offset);
  range.setEnd(node, offset);

  selection?.removeAllRanges();
  selection?.addRange(range);
};

describe('Caret module', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  describe('setToBlock', () => {
    it('highlights non focusable block instead of moving caret', () => {
      const { caret, blockSelection, blockManager } = createCaret();
      const block = createBlock({ focusable: false });
      const removeAllRanges = vi.fn();

      vi.spyOn(window, 'getSelection').mockReturnValue({
        removeAllRanges,
      } as unknown as globalThis.Selection | null);

      caret.setToBlock(block);

      expect(blockSelection.clearSelection).toHaveBeenCalledTimes(1);
      expect(removeAllRanges).toHaveBeenCalledTimes(1);
      expect(blockSelection.selectBlock).toHaveBeenCalledWith(block);
      expect(blockManager.currentBlock).toBe(block);
    });

    it('places caret at the start of the first input', () => {
      const { caret, blockManager } = createCaret();
      const input = createContentEditable('Hello');
      const textNode = input.firstChild as Text;
      const block = createBlock({
        inputs: { first: input,
          current: input },
      });
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      caret.setToBlock(block, caret.positions.START);

      expect(setSpy).toHaveBeenCalledTimes(1);
      const [node, offset] = setSpy.mock.calls[0];

      expect(node).toBe(textNode);
      expect(offset).toBe(0);
      expect(blockManager.currentBlock?.currentInput).toBe(input);
    });

    it('prefers last meaningful nested text node when setting caret to the end', () => {
      const { caret, blockManager } = createCaret();
      const lastMeaningful = document.createElement('strong');

      lastMeaningful.textContent = 'Hello';

      const trailingPunctuation = document.createElement('span');

      trailingPunctuation.textContent = '!!!';

      const input = createContentEditable('');

      input.append(lastMeaningful, trailingPunctuation);

      const block = createBlock({
        inputs: { last: input,
          current: input },
      });
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      blockManager.setCurrentBlockByChildNode.mockImplementation(() => {
        blockManager.currentBlock = block;
      });

      caret.setToBlock(block, caret.positions.END);

      expect(setSpy).toHaveBeenCalledTimes(1);
      const [node, offset] = setSpy.mock.calls[0];

      expect(node?.textContent).toBe('Hello');
      expect(offset).toBe(5);
    });
  });

  describe('setToInput', () => {
    it('moves caret to requested position and updates current input reference', () => {
      const { caret, blockManager } = createCaret();
      const input = createContentEditable('Sample text');
      const textNode = input.firstChild as Text;
      const block = createBlock({
        inputs: { current: input },
      });

      blockManager.currentBlock = block;

      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInput(input, caret.positions.END);

      expect(setSpy).toHaveBeenCalledTimes(1);
      const [node, offset] = setSpy.mock.calls[0];

      expect(node).toBe(textNode);
      expect(offset).toBe(textNode.length);
      expect(block.currentInput).toBe(input);
    });

    it('uses provided offset only for default position', () => {
      const { caret } = createCaret();
      const input = createContentEditable('abc');
      const setSpy = vi.spyOn(caret, 'set').mockImplementation(() => undefined);

      caret.setToInput(input, caret.positions.DEFAULT, 2);

      expect(setSpy).toHaveBeenCalledWith(input.firstChild, 2);
    });
  });

  describe('navigateNext', () => {
    it('focuses next input when caret is at the end', () => {
      const { caret, blockManager } = createCaret();
      const currentInput = createContentEditable('A');
      const nextInput = createContentEditable('B');
      const block = createBlock({
        inputs: {
          current: currentInput,
          next: nextInput,
        },
      });

      blockManager.currentBlock = block;
      const setToInput = vi.spyOn(caret, 'setToInput').mockImplementation(() => undefined);

      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      const result = caret.navigateNext();

      expect(result).toBe(true);
      expect(setToInput).toHaveBeenCalledWith(nextInput, caret.positions.START);
    });

    it('creates a default block when there is no next block', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock({
        tool: { isDefault: false },
        inputs: { current: createContentEditable('text') },
      });

      blockManager.currentBlock = block;
      blockManager.nextBlock = null;

      const insertedBlock = createBlock();

      blockManager.insertAtEnd.mockReturnValue(insertedBlock);
      const setToBlock = vi.spyOn(caret, 'setToBlock').mockImplementation(() => undefined);

      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(true);

      const result = caret.navigateNext();

      expect(result).toBe(true);
      expect(blockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      expect(setToBlock).toHaveBeenCalledWith(insertedBlock, caret.positions.START);
    });

    it('does not move caret when navigation is not allowed', () => {
      const { caret, blockManager } = createCaret();
      const block = createBlock({
        tool: { isDefault: true },
        inputs: { current: createContentEditable('text') },
      });

      blockManager.currentBlock = block;
      blockManager.nextBlock = null;

      vi.spyOn(caretUtils, 'isCaretAtEndOfInput').mockReturnValue(false);

      expect(caret.navigateNext()).toBe(false);
      expect(blockManager.insertAtEnd).not.toHaveBeenCalled();
    });
  });

  describe('navigatePrevious', () => {
    it('focuses previous input when caret is at the start', () => {
      const { caret, blockManager } = createCaret();
      const previousInput = createContentEditable('previous');
      const currentInput = createContentEditable('current');
      const block = createBlock({
        inputs: {
          current: currentInput,
          previous: previousInput,
        },
      });

      blockManager.currentBlock = block;

      const setToInput = vi.spyOn(caret, 'setToInput').mockImplementation(() => undefined);

      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      const result = caret.navigatePrevious();

      expect(result).toBe(true);
      expect(setToInput).toHaveBeenCalledWith(previousInput, caret.positions.END);
    });

    it('moves to previous block when available', () => {
      const { caret, blockManager } = createCaret();
      const currentBlock = createBlock({
        inputs: { current: createContentEditable('content') },
      });
      const previousBlock = createBlock({
        inputs: { current: createContentEditable('prev') },
      });

      blockManager.currentBlock = currentBlock;
      blockManager.previousBlock = previousBlock;

      const setToBlock = vi.spyOn(caret, 'setToBlock').mockImplementation(() => undefined);

      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(true);

      const result = caret.navigatePrevious();

      expect(result).toBe(true);
      expect(setToBlock).toHaveBeenCalledWith(previousBlock, caret.positions.END);
    });

    it('stays on current block when caret is not at the start', () => {
      const { caret, blockManager } = createCaret();
      const currentBlock = createBlock({
        inputs: { current: createContentEditable('content') },
      });

      blockManager.currentBlock = currentBlock;
      blockManager.previousBlock = null;

      vi.spyOn(caretUtils, 'isCaretAtStartOfInput').mockReturnValue(false);

      expect(caret.navigatePrevious()).toBe(false);
    });
  });

  describe('setToTheLastBlock', () => {
    it('moves caret to the last default empty block', () => {
      const { caret, blockManager } = createCaret();
      const lastBlock = createBlock({
        tool: { isDefault: true },
        isEmpty: true,
      });
      const setToBlock = vi.spyOn(caret, 'setToBlock').mockImplementation(() => undefined);

      blockManager.lastBlock = lastBlock;

      caret.setToTheLastBlock();

      expect(setToBlock).toHaveBeenCalledWith(lastBlock);
    });

    it('appends new block when the last one is filled or custom', () => {
      const { caret, blockManager } = createCaret();
      const lastBlock = createBlock({
        tool: { isDefault: false },
        isEmpty: false,
      });
      const newBlock = createBlock();
      const setToBlock = vi.spyOn(caret, 'setToBlock').mockImplementation(() => undefined);

      blockManager.lastBlock = lastBlock;
      blockManager.insertAtEnd.mockReturnValue(newBlock);

      caret.setToTheLastBlock();

      expect(blockManager.insertAtEnd).toHaveBeenCalledTimes(1);
      expect(setToBlock).toHaveBeenCalledWith(newBlock);
    });
  });

  describe('extractFragmentFromCaretPosition', () => {
    it('returns fragment from native inputs and updates value', () => {
      const { caret, blockManager } = createCaret();
      const input = document.createElement('input');

      input.value = 'HelloWorld';
      input.selectionStart = 5;
      input.selectionEnd = 5;

      const block = createBlock();

      block.currentInput = input;
      blockManager.currentBlock = block;

      const selection = {
        rangeCount: 1,
        getRangeAt: vi.fn(() => ({
          deleteContents: vi.fn(),
        })),
      } as unknown as globalThis.Selection;

      vi.spyOn(Selection, 'get').mockReturnValue(selection);

      const fragment = caret.extractFragmentFromCaretPosition();

      expect(fragment?.textContent).toBe('World');
      expect(input.value).toBe('Hello');
    });

    it('extracts contenteditable fragment starting from caret', () => {
      const { caret, blockManager } = createCaret();
      const input = createContentEditable('abcdef');
      const textNode = input.firstChild as Text;
      const block = createBlock({
        inputs: { current: input },
      });

      document.body.appendChild(input);
      setCollapsedSelection(textNode, 2);

      blockManager.currentBlock = block;

      const fragment = caret.extractFragmentFromCaretPosition();

      expect(fragment).toBeInstanceOf(DocumentFragment);
      expect(fragment?.textContent).toBe('cdef');
      expect(input.textContent).toBe('ab');
    });
  });

  describe('insertContentAtCaretPosition', () => {
    it('inserts provided html fragment and updates selection', () => {
      const { caret } = createCaret();
      const container = createContentEditable('Hello');
      const textNode = container.firstChild as Text;

      document.body.appendChild(container);
      setCollapsedSelection(textNode, textNode.length);

      caret.insertContentAtCaretPosition('<span>!</span>');

      expect(container.innerHTML).toBe('Hello<span>!</span>');

      const selection = window.getSelection();

      expect(selection?.focusNode?.textContent).toBe('!');
      expect(selection?.focusOffset).toBe(1);
    });

    it('appends empty text node when fragment has no nodes', () => {
      const { caret } = createCaret();
      const container = createContentEditable('Hello');
      const textNode = container.firstChild as Text;

      document.body.appendChild(container);
      setCollapsedSelection(textNode, textNode.length);

      caret.insertContentAtCaretPosition('');

      const lastChild = container.lastChild as Text;

      expect(lastChild).toBeInstanceOf(Text);
      expect(lastChild.textContent).toBe('');
    });
  });

  describe('shadow caret helpers', () => {
    it('creates and removes shadow caret element', () => {
      const { caret } = createCaret();
      const container = createContentEditable('text');

      document.body.appendChild(container);

      caret.createShadow(container);

      const shadow = container.querySelector('.blok-shadow-caret');

      expect(shadow).not.toBeNull();

      caret.restoreCaret(container);

      expect(container.querySelector('.blok-shadow-caret')).toBeNull();
    });
  });

  describe('resolveEndPositionNode', () => {
    it('returns native input node with its content length', () => {
      const { caret } = createCaret();
      const input = document.createElement('textarea');

      input.value = 'text';

      const resolver = (caret as unknown as {
        resolveEndPositionNode: (el: HTMLElement) => { node: Node | null; offset: number };
      }).resolveEndPositionNode;

      const { node, offset } = resolver(input);

      expect(node).toBe(input);
      expect(offset).toBe(4);
    });

    it('returns last text node when punctuation is at the root level', () => {
      const { caret } = createCaret();
      const element = createContentEditable('');
      const firstText = document.createTextNode('Hello');
      const punctuation = document.createTextNode('!!!');

      element.append(firstText, punctuation);

      const resolver = (caret as unknown as {
        resolveEndPositionNode: (el: HTMLElement) => { node: Node | null; offset: number };
      }).resolveEndPositionNode;

      const { node, offset } = resolver(element);

      expect(node).toBe(punctuation);
      expect(offset).toBe(3);
    });

    it('treats unicode punctuation as meaningful text', () => {
      const { caret } = createCaret();
      const element = createContentEditable('');
      const first = document.createTextNode('Hi');
      const unicodePunctuation = document.createTextNode('—');

      element.append(first, unicodePunctuation);

      const resolver = (caret as unknown as {
        resolveEndPositionNode: (el: HTMLElement) => { node: Node | null; offset: number };
      }).resolveEndPositionNode;

      const { node, offset } = resolver(element);

      expect(node).toBe(unicodePunctuation);
      expect(offset).toBe(1);
    });
  });
});
