import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Block } from '../../../../../src/components/block';
import type { BlokEventMap } from '../../../../../src/components/events';
import { BlockEvents } from '../../../../../src/components/modules/blockEvents';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';

/**
 * Spies shared by every case — each one stands for a structural mutation Blok
 * performs on a contenteditable block and must NOT perform on a form control
 * a tool renders.
 */
interface Spies {
  insertDefaultBlockAtIndex: ReturnType<typeof vi.fn>;
  split: ReturnType<typeof vi.fn>;
  removeBlock: ReturnType<typeof vi.fn>;
  mergeBlocks: ReturnType<typeof vi.fn>;
  selectBlock: ReturnType<typeof vi.fn>;
  navigatePrevious: ReturnType<typeof vi.fn>;
  navigateNext: ReturnType<typeof vi.fn>;
  toolboxOpen: ReturnType<typeof vi.fn>;
  insertContentAtCaretPosition: ReturnType<typeof vi.fn>;
}

interface Harness {
  blockEvents: BlockEvents;
  spies: Spies;
  fire: (event: KeyboardEvent) => void;
}

const createKeyboardEvent = (options: {
  key: string;
  code?: string;
  target: EventTarget;
}): KeyboardEvent => {
  let defaultPrevented = false;

  return {
    key: options.key,
    code: options.code ?? '',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    target: options.target,
    get defaultPrevented(): boolean {
      return defaultPrevented;
    },
    preventDefault: vi.fn(() => {
      defaultPrevented = true;
    }),
    stopPropagation: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as KeyboardEvent;
};

/**
 * Build a Block stub whose single editable surface is `input`, mounted in a
 * holder that lives inside the editor wrapper.
 */
const createBlock = (options: {
  id: string;
  name: string;
  input: HTMLElement;
  wrapper: HTMLElement;
  isEmpty?: boolean;
}): Block => {
  const holder = document.createElement('div');

  holder.appendChild(options.input);
  options.wrapper.appendChild(holder);

  return {
    id: options.id,
    name: options.name,
    holder,
    parentId: null,
    currentInput: options.input,
    inputs: [options.input],
    firstInput: options.input,
    lastInput: options.input,
    isEmpty: options.isEmpty ?? false,
    hasMedia: false,
    mergeable: true,
    selected: false,
    tool: {
      name: options.name,
      isDefault: false,
      isLineBreaksEnabled: false,
      enabledInlineTools: true,
      conversionConfig: undefined,
    },
    updateCurrentInput: vi.fn(),
  } as unknown as Block;
};

const createHarness = (input: HTMLElement): Harness => {
  const wrapper = document.createElement('div');

  document.body.appendChild(wrapper);

  const previousBlockInput = document.createElement('div');

  previousBlockInput.contentEditable = 'true';
  previousBlockInput.textContent = 'previous';

  const previousBlock = createBlock({
    id: 'previous',
    name: 'paragraph',
    input: previousBlockInput,
    wrapper,
  });

  const nextBlockInput = document.createElement('div');

  nextBlockInput.contentEditable = 'true';
  nextBlockInput.textContent = 'next';

  const nextBlock = createBlock({
    id: 'next',
    name: 'paragraph',
    input: nextBlockInput,
    wrapper,
  });

  const currentBlock = createBlock({
    id: 'current',
    name: 'custom-tool',
    input,
    wrapper,
  });

  const spies: Spies = {
    insertDefaultBlockAtIndex: vi.fn(() => nextBlock),
    split: vi.fn(() => nextBlock),
    removeBlock: vi.fn(() => Promise.resolve()),
    mergeBlocks: vi.fn(() => Promise.resolve()),
    selectBlock: vi.fn(),
    navigatePrevious: vi.fn(() => false),
    navigateNext: vi.fn(() => false),
    toolboxOpen: vi.fn(),
    insertContentAtCaretPosition: vi.fn(),
  };

  const blockEvents = new BlockEvents({
    config: {},
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  });

  const state: Partial<BlokModules> = {
    BlockManager: {
      currentBlock,
      previousBlock,
      nextBlock,
      blocks: [previousBlock, currentBlock, nextBlock],
      currentBlockIndex: 1,
      setCurrentBlockByChildNode: vi.fn(),
      insertDefaultBlockAtIndex: spies.insertDefaultBlockAtIndex,
      split: spies.split,
      removeBlock: spies.removeBlock,
      mergeBlocks: spies.mergeBlocks,
      setBlockParent: vi.fn(),
      transactForTool: (callback: () => void) => {
        callback();
      },
    } as unknown as BlokModules['BlockManager'],
    Caret: {
      positions: { START: 'start', END: 'end', DEFAULT: 'default' },
      setToBlock: vi.fn(),
      navigateNext: spies.navigateNext,
      navigatePrevious: spies.navigatePrevious,
      resetGoalColumn: vi.fn(),
      insertContentAtCaretPosition: spies.insertContentAtCaretPosition,
    } as unknown as BlokModules['Caret'],
    Toolbar: {
      opened: false,
      close: vi.fn(),
      moveAndOpen: vi.fn(),
      hideBlockActions: vi.fn(),
      discardPlusContext: vi.fn(),
      toolbox: {
        opened: false,
        open: spies.toolboxOpen,
      },
    } as unknown as BlokModules['Toolbar'],
    InlineToolbar: {
      opened: false,
      close: vi.fn(),
    } as unknown as BlokModules['InlineToolbar'],
    BlockSettings: {
      opened: false,
      open: vi.fn(),
      contains: vi.fn(() => false),
    } as unknown as BlokModules['BlockSettings'],
    BlockSelection: {
      anyBlockSelected: false,
      navigationModeEnabled: false,
      selectedBlocks: [],
      clearSelection: vi.fn(),
      selectBlock: spies.selectBlock,
      enableNavigationMode: vi.fn(),
      adoptSelectionIntoNavigationMode: vi.fn(() => false),
    } as unknown as BlokModules['BlockSelection'],
    UI: {
      nodes: { wrapper },
      someToolbarOpened: false,
      someFlipperButtonFocused: false,
      checkEmptiness: vi.fn(),
      closeAllToolbars: vi.fn(),
      isRtl: false,
    } as unknown as BlokModules['UI'],
    Tools: {
      defaultTool: { name: 'paragraph' },
    } as unknown as BlokModules['Tools'],
    YjsManager: {
      stopCapturing: vi.fn(),
      markCaretBeforeChange: vi.fn(),
      updateLastCaretAfterPosition: vi.fn(),
      markBoundary: vi.fn(),
      clearBoundary: vi.fn(),
      checkAndHandleBoundary: vi.fn(),
      hasPendingBoundary: vi.fn(() => false),
    } as unknown as BlokModules['YjsManager'],
  };

  blockEvents.state = state as BlokModules;

  return {
    blockEvents,
    spies,
    fire: (event: KeyboardEvent) => {
      blockEvents.keydown(event);
    },
  };
};

/**
 * Native text field with a caret placed at `caret` (collapsed).
 */
const createTextInput = (type: string, value: string, caret: number): HTMLInputElement => {
  const input = document.createElement('input');

  input.type = type;
  input.value = value;
  document.body.appendChild(input);
  input.focus();
  input.setSelectionRange(caret, caret);

  return input;
};

const createTextarea = (value: string, caret: number): HTMLTextAreaElement => {
  const textarea = document.createElement('textarea');

  textarea.value = value;
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.setSelectionRange(caret, caret);

  return textarea;
};

const createContenteditable = (text: string): HTMLElement => {
  const editable = document.createElement('div');

  editable.contentEditable = 'true';
  editable.textContent = text;

  return editable;
};

const expectNoStructuralMutation = (spies: Spies): void => {
  expect(spies.insertDefaultBlockAtIndex).not.toHaveBeenCalled();
  expect(spies.split).not.toHaveBeenCalled();
  expect(spies.removeBlock).not.toHaveBeenCalled();
  expect(spies.mergeBlocks).not.toHaveBeenCalled();
  expect(spies.selectBlock).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('BlockEvents — keydown inside a tool-rendered native form control', () => {
  it('does not insert a block when Enter is pressed at the end of the field', () => {
    const input = createTextInput('text', 'abc', 3);
    const { fire, spies } = createHarness(input);
    const event = createKeyboardEvent({ key: 'Enter', target: input });

    fire(event);

    expectNoStructuralMutation(spies);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not insert a block above when Enter is pressed at offset 0 of the field', () => {
    const input = createTextInput('text', 'abc', 0);
    const { fire, spies } = createHarness(input);
    const event = createKeyboardEvent({ key: 'Enter', target: input });

    fire(event);

    expectNoStructuralMutation(spies);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not split the block (nor truncate the value) when Enter is pressed mid-field', () => {
    const input = createTextInput('text', 'abc', 1);
    const { fire, spies } = createHarness(input);
    const event = createKeyboardEvent({ key: 'Enter', target: input });

    fire(event);

    expectNoStructuralMutation(spies);
    expect(input.value).toBe('abc');
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not run the block-merge path when Backspace is pressed at offset 0', () => {
    const input = createTextInput('text', 'abc', 0);
    const { fire, spies } = createHarness(input);
    const event = createKeyboardEvent({ key: 'Backspace', target: input });

    fire(event);

    expectNoStructuralMutation(spies);
    expect(spies.navigatePrevious).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not run the block-merge path when Delete is pressed at the end of the field', () => {
    const input = createTextInput('text', 'abc', 3);
    const { fire, spies } = createHarness(input);
    const event = createKeyboardEvent({ key: 'Delete', target: input });

    fire(event);

    expectNoStructuralMutation(spies);
    expect(spies.navigateNext).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does not open the toolbox when "/" is typed in the field', () => {
    const input = createTextInput('text', 'abc', 3);
    const { fire, spies } = createHarness(input);
    const event = createKeyboardEvent({ key: '/', code: 'Slash', target: input });

    fire(event);

    expect(spies.toolboxOpen).not.toHaveBeenCalled();
    expect(spies.insertContentAtCaretPosition).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  describe('first-party fields that render native controls', () => {
    /**
     * The image/video/audio/file empty-state URL bar and the embed URL bar are
     * `input[type="url"]` inside the block holder — Enter there commits the URL
     * through the tool's own listener and must never create a paragraph.
     */
    it('leaves the media / embed url bar (input[type=url]) alone on Enter and Backspace', () => {
      const input = createTextInput('url', 'https://example.com', 0);
      const { fire, spies } = createHarness(input);

      fire(createKeyboardEvent({ key: 'Backspace', target: input }));
      input.setSelectionRange(input.value.length, input.value.length);
      fire(createKeyboardEvent({ key: 'Enter', target: input }));

      expectNoStructuralMutation(spies);
      expect(input.value).toBe('https://example.com');
    });

    /**
     * The database card drawer renders its title as a <textarea> inside the
     * database block's holder.
     */
    it('leaves the database drawer title (textarea) alone on Enter and Backspace', () => {
      const textarea = createTextarea('Card title', 0);
      const { fire, spies } = createHarness(textarea);

      fire(createKeyboardEvent({ key: 'Backspace', target: textarea }));
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      fire(createKeyboardEvent({ key: 'Enter', target: textarea }));

      expectNoStructuralMutation(spies);
      expect(textarea.value).toBe('Card title');
    });
  });

  describe('contenteditable blocks keep the normal behaviour', () => {
    it('still inserts a block on Enter at the end of a contenteditable', () => {
      const editable = createContenteditable('abc');
      const { fire, spies } = createHarness(editable);
      const range = document.createRange();
      const selection = window.getSelection();

      editable.focus();
      range.selectNodeContents(editable);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);

      const event = createKeyboardEvent({ key: 'Enter', target: editable });

      fire(event);

      expect(spies.insertDefaultBlockAtIndex).toHaveBeenCalledTimes(1);
      expect(event.preventDefault).toHaveBeenCalled();
    });

    it('still opens the toolbox on "/" in a contenteditable', () => {
      const editable = createContenteditable('abc');
      const { fire, spies } = createHarness(editable);
      const event = createKeyboardEvent({ key: '/', code: 'Slash', target: editable });

      fire(event);

      expect(spies.toolboxOpen).toHaveBeenCalledTimes(1);
      expect(spies.insertContentAtCaretPosition).toHaveBeenCalledWith('/');
      expect(event.preventDefault).toHaveBeenCalled();
    });
  });
});
