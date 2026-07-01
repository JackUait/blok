import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownShortcuts } from '../../../../../../src/components/modules/blockEvents/composers/markdownShortcuts';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';

const createInputEvent = (options: Partial<InputEvent> = {}): InputEvent => {
  return {
    inputType: 'insertText',
    data: ' ',
    ...options,
  } as InputEvent;
};

const createBlock = (overrides: Partial<Block> = {}): Block => {
  const input = document.createElement('div');
  input.contentEditable = 'true';
  input.textContent = '';

  const holder = document.createElement('div');
  holder.appendChild(input);
  holder.setAttribute('data-blok-depth', '0');

  return {
    id: 'test-block',
    name: 'paragraph',
    holder,
    currentInput: input,
    inputs: [input],
    firstInput: input,
    lastInput: input,
    tool: {
      isDefault: true,
      isLineBreaksEnabled: false,
      name: 'paragraph',
    },
    isEmpty: false,
    hasMedia: false,
    updateCurrentInput: vi.fn(),
    save: vi.fn(),
    render: vi.fn(),
    ...overrides,
  } as unknown as Block;
};

const createBlokModules = (overrides: Partial<BlokModules> = {}): BlokModules => {
  const mockBlock = createBlock();

  const defaults: Partial<BlokModules> = {
    BlockManager: {
      currentBlock: mockBlock,
      blocks: [mockBlock],
      getBlockByIndex: vi.fn(() => mockBlock),
      getBlockIndex: vi.fn(() => 0),
      currentBlockIndex: 0,
      previousBlock: null,
      nextBlock: null,
      replace: vi.fn(() => mockBlock),
      insertDefaultBlockAtIndex: vi.fn(() => mockBlock),
      split: vi.fn(() => mockBlock),
      removeBlock: vi.fn(),
      setCurrentBlockByChildNode: vi.fn(),
      mergeBlocks: vi.fn(),
      update: vi.fn(() => mockBlock),
      deleteSelectedBlocksAndInsertReplacement: vi.fn(() => mockBlock),
    } as unknown as BlokModules['BlockManager'],
    Tools: {
      blockTools: new Map([
        ['list', { settings: {} }],
        ['header', { settings: { levels: [1, 2, 3, 4, 5, 6] } }],
        ['toggle', { settings: {} }],
      ]),
    } as unknown as BlokModules['Tools'],
    YjsManager: {
      stopCapturing: vi.fn(),
    } as unknown as BlokModules['YjsManager'],
    Caret: {
      positions: { START: 'start', END: 'end', DEFAULT: 'default' },
      setToBlock: vi.fn(),
      navigateNext: vi.fn(),
      navigatePrevious: vi.fn(),
      navigateVerticalNext: vi.fn(),
      navigateVerticalPrevious: vi.fn(),
      insertContentAtCaretPosition: vi.fn(),
    } as unknown as BlokModules['Caret'],
  };

  const mergedState: Partial<BlokModules> = { ...defaults };

  for (const [moduleName, moduleOverrides] of Object.entries(overrides) as Array<[keyof BlokModules, unknown]>) {
    const defaultModule = defaults[moduleName];

    if (
      defaultModule !== undefined &&
      defaultModule !== null &&
      typeof defaultModule === 'object' &&
      moduleOverrides !== null &&
      typeof moduleOverrides === 'object'
    ) {
      (mergedState as unknown as Record<keyof BlokModules, BlokModules[keyof BlokModules]>)[moduleName] = {
        ...(defaultModule as unknown as Record<string, unknown>),
        ...(moduleOverrides as Record<string, unknown>),
      } as unknown as BlokModules[typeof moduleName];
    } else if (moduleOverrides !== undefined) {
      (mergedState as Record<keyof BlokModules, BlokModules[keyof BlokModules]>)[moduleName] =
        moduleOverrides as BlokModules[typeof moduleName];
    }
  }

  return mergedState as BlokModules;
};

const setupInline = (rawText: string, closingChar: string): {
  input: HTMLElement;
  result: boolean;
  dispatchChange: ReturnType<typeof vi.fn>;
} => {
  const input = document.createElement('div');
  input.contentEditable = 'true';
  document.body.appendChild(input);
  const textNode = document.createTextNode(rawText);
  input.appendChild(textNode);

  const range = document.createRange();
  range.setStart(textNode, rawText.length);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  const dispatchChange = vi.fn();
  const mockBlock = createBlock({
    currentInput: input,
    firstInput: input,
    lastInput: input,
    inputs: [input],
    dispatchChange,
  } as unknown as Partial<Block>);
  const blok = createBlokModules({
    BlockManager: { currentBlock: mockBlock } as unknown as BlokModules['BlockManager'],
  });
  const markdownShortcuts = new MarkdownShortcuts(blok);

  const result = markdownShortcuts.handleInput(createInputEvent({ data: closingChar }));

  return { input, result, dispatchChange };
};

/**
 * Same as {@link setupInline}, but splits `textChunks` across SEPARATE sibling
 * text nodes instead of one contiguous text node. Real browsers fragment typed
 * text into multiple text nodes around characters with dedicated keydown
 * handling (e.g. "/" opens the slash-command toolbox via a non-native insertion
 * path) — this reproduces that DOM shape so markdown detection is verified
 * against what the editor actually produces, not an idealized single node.
 */
const setupInlineFragmented = (textChunks: string[], closingChar: string): {
  input: HTMLElement;
  result: boolean;
  dispatchChange: ReturnType<typeof vi.fn>;
} => {
  const input = document.createElement('div');

  input.contentEditable = 'true';
  document.body.appendChild(input);

  const textNodes = textChunks.map((chunk) => {
    const node = document.createTextNode(chunk);

    input.appendChild(node);

    return node;
  });

  const lastNode = textNodes[textNodes.length - 1];
  const range = document.createRange();

  range.setStart(lastNode, lastNode.textContent?.length ?? 0);
  range.collapse(true);
  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);

  const dispatchChange = vi.fn();
  const mockBlock = createBlock({
    currentInput: input,
    firstInput: input,
    lastInput: input,
    inputs: [input],
    dispatchChange,
  } as unknown as Partial<Block>);
  const blok = createBlokModules({
    BlockManager: { currentBlock: mockBlock } as unknown as BlokModules['BlockManager'],
  });
  const markdownShortcuts = new MarkdownShortcuts(blok);

  const result = markdownShortcuts.handleInput(createInputEvent({ data: closingChar }));

  return { input, result, dispatchChange };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MarkdownShortcuts', () => {
  describe('handleInput', () => {
    it('returns false for non-insertText events', () => {
      const blok = createBlokModules();
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent({ inputType: 'deleteContent' });

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
    });

    it('returns false when data is not a space', () => {
      const blok = createBlokModules();
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent({ data: 'a' });

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
    });

    it('returns false when there is no current block', () => {
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: null,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
    });

    it('returns false when current block is not default tool', () => {
      const mockBlock = createBlock({
        tool: {
          isDefault: false,
          isLineBreaksEnabled: false,
          name: 'header',
        } as unknown as Block['tool'],
      });
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
    });
  });

  describe('checklist shortcut', () => {
    it('converts [] to unchecked checklist', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '[] ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({
          style: 'checklist',
          checked: false,
        })
      );
      expect(stopCapturing).toHaveBeenCalledTimes(2);
    });

    it('converts [x] to checked checklist', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '[x] ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({
          style: 'checklist',
          checked: true,
        })
      );
    });

    it('converts [X] to checked checklist', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '[X] ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({
          style: 'checklist',
          checked: true,
        })
      );
    });
  });

  describe('unordered list shortcut', () => {
    it('converts "- " to unordered list', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '- ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({
          style: 'unordered',
          checked: false,
        })
      );
    });

    it('converts "+ " to unordered list', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '+ ';
      }
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({
          style: 'unordered',
        })
      );
    });

    it('converts "* " to unordered list', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '* ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({
          style: 'unordered',
        })
      );
    });
  });

  describe('ordered list shortcut', () => {
    it('converts "1. " to ordered list', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '1. ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({
          style: 'ordered',
          checked: false,
        })
      );
    });

    it('converts "5. " to ordered list with start number', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '5. ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({
          style: 'ordered',
          start: 5,
        })
      );
    });

    it('converts "a. " to ordered list (Notion alphabetic alias)', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = 'a. ';
      }
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({ style: 'ordered' })
      );
    });

    it('converts "i. " to ordered list (Notion roman alias)', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = 'i. ';
      }
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({ style: 'ordered' })
      );
    });

    it('starts the "i. " roman alias at 1, not roman-numeral value 9', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = 'i. ';
      }
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(true);
      // start 1 is the default, so it is omitted entirely (never 9).
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.not.objectContaining({ start: expect.anything() })
      );
    });

    it('starts the "a. " alpha alias at 1', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = 'a. ';
      }
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.not.objectContaining({ start: expect.anything() })
      );
    });

    it('does NOT convert "q. " (a letter other than a/i) into a list', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = 'q. ';
      }
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('does NOT convert "z) " (a letter other than a/i) into a list', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = 'z) ';
      }
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('does NOT convert a multi-letter word like "etc. " into a list', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = 'etc. ';
      }
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe('inline markdown auto-format', () => {
    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('wraps **bold** in <strong> when the closing ** is typed', () => {
      const { input, result, dispatchChange } = setupInline('**bold**', '*');

      expect(result).toBe(true);
      expect(input.querySelector('strong')?.textContent).toBe('bold');
      expect(input.textContent).toBe('bold');
      expect(dispatchChange).toHaveBeenCalled();
    });

    it('wraps *italic* in <i>', () => {
      const { input, result } = setupInline('*italic*', '*');

      expect(result).toBe(true);
      expect(input.querySelector('i')?.textContent).toBe('italic');
    });

    it('wraps `code` in <code> literally', () => {
      const { input, result } = setupInline('`x = 1`', '`');

      expect(result).toBe(true);
      expect(input.querySelector('code')?.textContent).toBe('x = 1');
    });

    it('wraps ~strike~ in <s>', () => {
      const { input, result } = setupInline('~gone~', '~');

      expect(result).toBe(true);
      expect(input.querySelector('s')?.textContent).toBe('gone');
    });

    it('preserves leading text before the formatted span', () => {
      const { input, result } = setupInline('say **hi**', '*');

      expect(result).toBe(true);
      expect(input.querySelector('strong')?.textContent).toBe('hi');
      expect(input.textContent).toBe('say hi');
    });

    it('does NOT format when there is no opening marker', () => {
      const { input, result } = setupInline('just text*', '*');

      expect(result).toBe(false);
      expect(input.querySelector('strong')).toBeNull();
      expect(input.querySelector('i')).toBeNull();
    });

    it('does NOT prematurely italicize while bold is still being typed (**bold*)', () => {
      const { input, result } = setupInline('**bold*', '*');

      expect(result).toBe(false);
      expect(input.querySelector('i')).toBeNull();
    });

    it('does NOT format a double span padded with inner spaces (** bold **)', () => {
      const { input, result } = setupInline('** bold **', '*');

      expect(result).toBe(false);
      expect(input.querySelector('strong')).toBeNull();
      expect(input.textContent).toBe('** bold **');
    });

    it('does NOT format a single span padded with inner spaces (* x *)', () => {
      const { input, result } = setupInline('* x *', '*');

      expect(result).toBe(false);
      expect(input.querySelector('i')).toBeNull();
      expect(input.textContent).toBe('* x *');
    });
  });

  describe('link markdown auto-format', () => {
    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('converts [text](url) into an <a> when the closing ) is typed', () => {
      const { input, result, dispatchChange } = setupInline('[Blok](https://blok.dev)', ')');

      expect(result).toBe(true);

      const anchor = input.querySelector('a');

      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute('href')).toBe('https://blok.dev');
      expect(anchor?.textContent).toBe('Blok');
      expect(input.textContent).toBe('Blok');
      expect(dispatchChange).toHaveBeenCalled();

      // Matches the defaults used when a link is created via the Link inline tool's button.
      expect(anchor?.getAttribute('target')).toBe('_blank');
      expect(anchor?.getAttribute('rel')).toBe('nofollow');
    });

    it('preserves leading text before the formatted link', () => {
      const { input } = setupInline('see [Blok](https://blok.dev)', ')');

      expect(input.querySelector('a')?.textContent).toBe('Blok');
      expect(input.textContent).toBe('see Blok');
    });

    it('places the caret right after the inserted link', () => {
      const { input } = setupInline('[Blok](https://blok.dev)', ')');
      const anchor = input.querySelector('a');
      const selection = window.getSelection();
      const range = selection?.getRangeAt(0);

      expect(anchor).not.toBeNull();
      expect(range?.collapsed).toBe(true);
      expect(range?.startContainer.nodeType === Node.ELEMENT_NODE ? range?.startContainer : range?.startContainer.parentNode).not.toBe(anchor);
    });

    it('does NOT format when there is no opening [', () => {
      const { input, result } = setupInline('just text(url)', ')');

      expect(result).toBe(false);
      expect(input.querySelector('a')).toBeNull();
    });

    it('does NOT format with an empty link label []()', () => {
      const { input, result } = setupInline('[](https://blok.dev)', ')');

      expect(result).toBe(false);
      expect(input.querySelector('a')).toBeNull();
    });

    it('does NOT format with an empty url [text]()', () => {
      const { input, result } = setupInline('[text]()', ')');

      expect(result).toBe(false);
      expect(input.querySelector('a')).toBeNull();
    });

    it('does NOT format a url containing a javascript: scheme (XSS guard)', () => {
      const { input, result } = setupInline('[click me](javascript:alert(1))', ')');

      expect(result).toBe(false);
      expect(input.querySelector('a')).toBeNull();
    });

    it('does NOT format inside an existing code span', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      document.body.appendChild(input);

      const code = document.createElement('code');

      code.textContent = '[Blok](https://blok.dev)';
      input.appendChild(code);

      const textNode = code.firstChild as Text;
      const range = document.createRange();

      range.setStart(textNode, textNode.textContent?.length ?? 0);
      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      const mockBlock = createBlock({
        currentInput: input,
        firstInput: input,
        lastInput: input,
        inputs: [input],
      } as unknown as Partial<Block>);
      const blok = createBlokModules({
        BlockManager: { currentBlock: mockBlock } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent({ data: ')' }));

      expect(result).toBe(false);
      expect(input.querySelector('a')).toBeNull();

      document.body.innerHTML = '';
    });

    it('converts [text](url) into an <a> when the url is fragmented across multiple text nodes (real-browser "/" typing)', () => {
      // Reproduces the actual DOM shape produced by a real browser: typing "/"
      // goes through the slash-command keydown handler (preventDefault +
      // Caret.insertContentAtCaretPosition), which inserts each "/" as its own
      // text node instead of extending the node the browser would otherwise
      // type into. A real "https://blok.dev" URL therefore lands as
      // ["See [Blok](https:", "/", "/blok.dev)"] by the time ")" is typed.
      const { input, result, dispatchChange } = setupInlineFragmented(
        ['See [Blok](https:', '/', '/blok.dev)'],
        ')'
      );

      expect(result).toBe(true);

      const anchor = input.querySelector('a');

      expect(anchor).not.toBeNull();
      expect(anchor?.getAttribute('href')).toBe('https://blok.dev');
      expect(anchor?.textContent).toBe('Blok');
      expect(input.textContent).toBe('See Blok');
      expect(dispatchChange).toHaveBeenCalled();
    });

    it('does NOT format a fragmented run when there is no opening [ (fragmentation must not over-match)', () => {
      const { input, result } = setupInlineFragmented(['just text(https:', '/', '/blok.dev)'], ')');

      expect(result).toBe(false);
      expect(input.querySelector('a')).toBeNull();
    });
  });

  describe('header shortcut', () => {
    it('converts "# " to level 1 header', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '# ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'header',
        expect.objectContaining({
          level: 1,
        })
      );
    });

    it('converts "## " to level 2 header', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '## ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'header',
        expect.objectContaining({
          level: 2,
        })
      );
    });

    it('converts "### " to level 3 header', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '### ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'header',
        expect.objectContaining({
          level: 3,
        })
      );
    });
  });

  describe('toggle shortcut', () => {
    it('converts "> " to toggle block', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '> ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'toggle',
        expect.objectContaining({
          text: '',
        })
      );
      expect(stopCapturing).toHaveBeenCalledTimes(2);
    });

    it('preserves text content after toggle shortcut', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '> Some toggle text';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      const replaceCall = replace.mock.calls[0] as unknown as [Block, string, { text: string }];
      expect(replaceCall[2].text).toBe('Some toggle text');
    });

    it('returns false when toggle tool is not available', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '> ';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map([
            ['list', { settings: {} }],
            ['header', { settings: { levels: [1, 2, 3, 4, 5, 6] } }],
            // No toggle tool
          ]),
        } as unknown as BlokModules['Tools'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe('depth preservation', () => {
    it('preserves depth attribute when converting to list', () => {
      const mockBlock = createBlock();
      mockBlock.holder.setAttribute('data-blok-depth', '2');
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '- ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({
          depth: 2,
        })
      );
    });
  });

  describe('custom header shortcuts', () => {
    it('matches custom header shortcuts when configured', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '! ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
        Tools: {
          blockTools: new Map([
            ['header', {
              settings: {
                shortcuts: {
                  1: '!',
                  2: '!!',
                },
              },
            }],
          ]),
        } as unknown as BlokModules['Tools'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'header',
        expect.objectContaining({
          level: 1,
        })
      );
    });
  });

  describe('HTML extraction edge cases', () => {
    it('preserves HTML content when converting shortcuts', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.innerHTML = '- <b>bold text</b> remaining';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalled();
      const replaceCall = replace.mock.calls[0] as unknown as [Block, string, { text: string }];
      expect(replaceCall).toHaveLength(3);
      expect(replaceCall[0]).toBe(mockBlock);
      expect(replaceCall[1]).toBe('list');
      // The text data should contain the HTML content after the shortcut
      const textData = replaceCall[2];
      expect(textData.text).toContain('bold text');
      expect(textData.text).toContain('remaining');
    });

    it('handles block with only text content (no HTML)', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '# Just text';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      const replaceCall = replace.mock.calls[0] as unknown as [Block, string, { text: string }];
      const textData = replaceCall[2];
      expect(textData.text).toBe('Just text');
    });

    it('handles block with mixed content and inline elements', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.innerHTML = '- <em>italic</em> and <strong>bold</strong>';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      const replaceCall = replace.mock.calls[0] as unknown as [Block, string, { text: string }];
      const textData = replaceCall[2];
      expect(textData.text).toContain('italic');
      expect(textData.text).toContain('bold');
    });

    it('returns false when shortcut pattern is not matched', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = 'No shortcut here';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('returns false when text content is empty', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe('caret handling', () => {
    it('sets caret to block start when offset is zero', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.innerHTML = '# ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      // Mock getCaretOffset to return 2 (length of "# ")
      markdownShortcuts.handleInput(event);

      // When caret offset is at or after the shortcut, setToBlock should be called
      expect(setToBlock).toHaveBeenCalled();
      const setToBlockCall = setToBlock.mock.calls[0] as unknown as [Block, string];
      expect(setToBlockCall[1]).toBe('start');
    });

    it('preserves caret offset for remaining content', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.innerHTML = '# Header text';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      markdownShortcuts.handleInput(event);

      // Should set caret - when there's no selection, offset is 0, so START position is used
      expect(setToBlock).toHaveBeenCalled();
      const setToBlockCall = setToBlock.mock.calls[0] as unknown as [Block, string];
      expect(setToBlockCall[1]).toBe('start');
    });
  });

  describe('header shortcuts in table cells', () => {
    it('does not convert "# " to header inside table cell', () => {
      const cellBlocks = document.createElement('div');
      cellBlocks.setAttribute('data-blok-table-cell-blocks', '');
      const holder = document.createElement('div');
      const input = document.createElement('div');
      input.setAttribute('contenteditable', 'true');
      input.textContent = '# ';
      holder.appendChild(input);
      cellBlocks.appendChild(holder);
      document.body.appendChild(cellBlocks);

      const mockBlock = createBlock({
        holder,
        currentInput: input,
      });

      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });

      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();

      cellBlocks.remove();
    });

    it('converts "# " to header outside table cell', () => {
      const holder = document.createElement('div');
      const input = document.createElement('div');
      input.setAttribute('contenteditable', 'true');
      input.textContent = '# ';
      holder.appendChild(input);
      document.body.appendChild(holder);

      const mockBlock = createBlock({
        holder,
        currentInput: input,
      });

      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });

      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalled();

      holder.remove();
    });
  });

  describe('header tool availability', () => {
    it('returns false when header tool is not available', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '# ';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map(), // No header tool
        } as unknown as BlokModules['Tools'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('returns false when list tool is not available', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '- ';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map(), // No list tool
        } as unknown as BlokModules['Tools'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });
  });

  // Bug 2: Tests for handleToggleHeaderShortcut()
  describe('toggle header shortcut', () => {
    it('converts ">## text" to H2 toggle header with isToggleable: true', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '>## Some text';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'header',
        expect.objectContaining({
          level: 2,
          isToggleable: true,
          text: 'Some text',
        })
      );
    });

    it('converts ">### text" to H3 toggle header', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '>### Some text';
      }
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'header',
        expect.objectContaining({
          level: 3,
          isToggleable: true,
        })
      );
    });

    it('converts "># text" to H1 toggle header', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '># Some text';
      }
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'header',
        expect.objectContaining({
          level: 1,
          isToggleable: true,
        })
      );
    });

    // Bug 1: Stray <br> left in DOM after ">##" shortcut with empty content
    it('does not leave a stray <br> in the DOM when shortcut has no trailing text (caretOffset = 0)', () => {
      const mockBlock = createBlock();
      // Build a block that mimics the post-conversion state:
      // firstInput has a contenteditable=false toggle arrow as its first child
      const toggleArrow = document.createElement('span');
      toggleArrow.setAttribute('data-blok-toggle-arrow', '');
      toggleArrow.contentEditable = 'false';

      const input = document.createElement('div');
      input.contentEditable = 'true';
      input.appendChild(toggleArrow);

      const holder = document.createElement('div');
      holder.appendChild(input);

      const newBlock = createBlock({
        holder,
        currentInput: input,
        firstInput: input,
      });

      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '>## ';
      }
      const replace = vi.fn(() => newBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      markdownShortcuts.handleInput(event);

      // After conversion the input must not contain any <br> elements
      expect(input.querySelector('br')).toBeNull();
    });

    it('preserves HTML content like "<strong>Bold</strong>" after ">## " shortcut', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.innerHTML = '>## <strong>Bold</strong>';
      }
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      const replaceCall = replace.mock.calls[0] as unknown as [Block, string, { text: string }];
      expect(replaceCall[2].text).toContain('Bold');
    });

    it('returns false when current block is not default tool (e.g. list item)', () => {
      const mockBlock = createBlock({
        tool: {
          isDefault: false,
          isLineBreaksEnabled: false,
          name: 'list',
        } as unknown as Block['tool'],
      });
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '>## Some text';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('returns false when header tool is not available', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '>## Some text';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map([
            ['list', { settings: {} }],
            ['toggle', { settings: {} }],
            // No header tool
          ]),
        } as unknown as BlokModules['Tools'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    // Bug 4: Regex allows H4-H6 but the toggle heading toolbox only supports H1-H3.
    // The levels config check in handleToggleHeaderShortcut() already rejects unsupported
    // levels — this test verifies that ">#### text" is rejected when levels = [1, 2, 3].
    it('returns false for ">#### text" when configured levels only include 1-3', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '>#### Some text';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map([
            ['list', { settings: {} }],
            ['header', { settings: { levels: [1, 2, 3] } }],
            ['toggle', { settings: {} }],
          ]),
        } as unknown as BlokModules['Tools'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });
  });

  // Bug 8: Missing table cell guard in "> " and ">##" shortcuts
  describe('toggle and toggle header shortcuts in table cells', () => {
    it('does not convert "> " to toggle block inside a table cell', () => {
      const cellBlocks = document.createElement('div');
      cellBlocks.setAttribute('data-blok-table-cell-blocks', '');
      const holder = document.createElement('div');
      const input = document.createElement('div');
      input.setAttribute('contenteditable', 'true');
      input.textContent = '> ';
      holder.appendChild(input);
      cellBlocks.appendChild(holder);
      document.body.appendChild(cellBlocks);

      const mockBlock = createBlock({
        holder,
        currentInput: input,
      });

      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });

      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();

      cellBlocks.remove();
    });

    it('does not convert ">## text" to toggle header inside a table cell', () => {
      const cellBlocks = document.createElement('div');
      cellBlocks.setAttribute('data-blok-table-cell-blocks', '');
      const holder = document.createElement('div');
      const input = document.createElement('div');
      input.setAttribute('contenteditable', 'true');
      input.textContent = '>## Heading text';
      holder.appendChild(input);
      cellBlocks.appendChild(holder);
      document.body.appendChild(cellBlocks);

      const mockBlock = createBlock({
        holder,
        currentInput: input,
      });

      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });

      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();

      cellBlocks.remove();
    });

    it('converts "> " to toggle block outside a table cell', () => {
      const holder = document.createElement('div');
      const input = document.createElement('div');
      input.setAttribute('contenteditable', 'true');
      input.textContent = '> ';
      holder.appendChild(input);
      document.body.appendChild(holder);

      const mockBlock = createBlock({
        holder,
        currentInput: input,
      });

      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });

      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(mockBlock, 'toggle', expect.any(Object));

      holder.remove();
    });
  });

  describe('divider shortcut', () => {
    it('converts --- to divider when typing the third hyphen', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '---';
      }
      const newDividerBlock = createBlock({ id: 'divider-block' });
      const replace = vi.fn(() => newDividerBlock);
      const stopCapturing = vi.fn();
      const getBlockIndex = vi.fn(() => 0);
      const insertDefaultBlockAtIndex = vi.fn(() => mockBlock);
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
          getBlockIndex,
          insertDefaultBlockAtIndex,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map([
            ['list', { settings: {} }],
            ['header', { settings: { levels: [1, 2, 3, 4, 5, 6] } }],
            ['toggle', { settings: {} }],
            ['divider', { settings: {} }],
          ]),
        } as unknown as BlokModules['Tools'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent({ data: '-' });

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(mockBlock, 'divider', {});
      expect(stopCapturing).toHaveBeenCalledTimes(2);
    });

    it('does not convert -- (only two hyphens)', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '--';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map([
            ['list', { settings: {} }],
            ['header', { settings: { levels: [1, 2, 3, 4, 5, 6] } }],
            ['toggle', { settings: {} }],
            ['divider', { settings: {} }],
          ]),
        } as unknown as BlokModules['Tools'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent({ data: '-' });

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('does not convert when divider tool is not registered', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '---';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent({ data: '-' });

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('does not convert when block is not the default tool', () => {
      const mockBlock = createBlock({
        tool: {
          isDefault: false,
          isLineBreaksEnabled: false,
          name: 'header',
        } as unknown as Block['tool'],
      });
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '---';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map([
            ['list', { settings: {} }],
            ['header', { settings: { levels: [1, 2, 3, 4, 5, 6] } }],
            ['toggle', { settings: {} }],
            ['divider', { settings: {} }],
          ]),
        } as unknown as BlokModules['Tools'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent({ data: '-' });

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('does not convert --- with trailing text', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '---hello';
      }
      const replace = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map([
            ['list', { settings: {} }],
            ['header', { settings: { levels: [1, 2, 3, 4, 5, 6] } }],
            ['toggle', { settings: {} }],
            ['divider', { settings: {} }],
          ]),
        } as unknown as BlokModules['Tools'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent({ data: '-' });

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('creates a new empty paragraph after the divider', () => {
      const mockBlock = createBlock();
      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '---';
      }
      const paragraphBlock = createBlock({ id: 'paragraph-block' });
      const newDividerBlock = createBlock({ id: 'divider-block' });
      const newBlockIndex = 2;
      const replace = vi.fn(() => newDividerBlock);
      const stopCapturing = vi.fn();
      const getBlockIndex = vi.fn(() => newBlockIndex);
      const insertDefaultBlockAtIndex = vi.fn(() => paragraphBlock);
      const setToBlock = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
          getBlockIndex,
          insertDefaultBlockAtIndex,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map([
            ['list', { settings: {} }],
            ['header', { settings: { levels: [1, 2, 3, 4, 5, 6] } }],
            ['toggle', { settings: {} }],
            ['divider', { settings: {} }],
          ]),
        } as unknown as BlokModules['Tools'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
        Caret: {
          setToBlock,
          positions: { START: 'start', END: 'end', DEFAULT: 'default' },
        } as unknown as BlokModules['Caret'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent({ data: '-' });

      markdownShortcuts.handleInput(event);

      expect(insertDefaultBlockAtIndex).toHaveBeenCalledWith(newBlockIndex + 1);
      expect(setToBlock).toHaveBeenCalledWith(paragraphBlock, 'start');
    });
  });

  describe('quote shortcut', () => {
    it('converts " followed by space to quote block', () => {
      const mockBlock = createBlock();

      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '" ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map([
            ['quote', { settings: {} }],
          ]),
        } as unknown as BlokModules['Tools'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'quote',
        expect.objectContaining({
          text: '',
        })
      );
      expect(stopCapturing).toHaveBeenCalledTimes(2);
    });

    it('preserves text content after quote shortcut', () => {
      const mockBlock = createBlock();

      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '" Some quoted text';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map([
            ['quote', { settings: {} }],
          ]),
        } as unknown as BlokModules['Tools'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      const replaceCall = replace.mock.calls[0] as unknown as [Block, string, { text: string }];

      expect(replaceCall[2].text).toBe('Some quoted text');
    });

    it('returns false when quote tool is not available', () => {
      const mockBlock = createBlock();

      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '" ';
      }
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map(),
        } as unknown as BlokModules['Tools'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
    });
  });

  describe('code shortcut', () => {
    it('converts ``` followed by space to code block', () => {
      const mockBlock = createBlock();

      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '``` ';
      }
      const replace = vi.fn(() => mockBlock);
      const stopCapturing = vi.fn();
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map([
            ['code', { settings: {} }],
          ]),
        } as unknown as BlokModules['Tools'],
        YjsManager: {
          stopCapturing,
        } as unknown as BlokModules['YjsManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'code',
        expect.objectContaining({
          code: '',
        })
      );
      expect(stopCapturing).toHaveBeenCalledTimes(2);
    });

    it('returns false when code tool is not available', () => {
      const mockBlock = createBlock();

      if (mockBlock.currentInput) {
        mockBlock.currentInput.textContent = '``` ';
      }
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
        } as unknown as BlokModules['BlockManager'],
        Tools: {
          blockTools: new Map(),
        } as unknown as BlokModules['Tools'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);
      const event = createInputEvent();

      const result = markdownShortcuts.handleInput(event);

      expect(result).toBe(false);
    });
  });

  // m-8: list markdown triggers should fire in non-paragraph editable text blocks
  // (heading, quote), converting the block to the list type and preserving text —
  // matching Notion. They must still NOT fire in code blocks or already-list blocks.
  describe('list triggers in non-default text blocks (m-8)', () => {
    const createTextBlock = (toolName: string, text: string): Block => {
      const block = createBlock({
        tool: {
          isDefault: false,
          isLineBreaksEnabled: false,
          name: toolName,
        } as unknown as Block['tool'],
      });

      if (block.currentInput) {
        block.currentInput.textContent = text;
      }

      return block;
    };

    it('converts "- " inside a HEADING into an unordered list, preserving text', () => {
      const mockBlock = createTextBlock('header', '- My heading text');
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({ style: 'unordered' })
      );
      const replaceCall = replace.mock.calls[0] as unknown as [Block, string, { text: string }];
      expect(replaceCall[2].text).toBe('My heading text');
    });

    it('converts "1. " inside a QUOTE into an ordered list, preserving text', () => {
      const mockBlock = createTextBlock('quote', '1. Quoted item');
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({ style: 'ordered' })
      );
      const replaceCall = replace.mock.calls[0] as unknown as [Block, string, { text: string }];
      expect(replaceCall[2].text).toBe('Quoted item');
    });

    it('converts "[] " inside a HEADING into an unchecked checklist', () => {
      const mockBlock = createTextBlock('header', '[] Todo heading');
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(
        mockBlock,
        'list',
        expect.objectContaining({ style: 'checklist', checked: false })
      );
    });

    it('does NOT convert "- " inside a CODE block', () => {
      const mockBlock = createTextBlock('code', '- not a list');
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('does NOT convert "- " inside an existing LIST block', () => {
      const mockBlock = createTextBlock('list', '- already a list');
      const replace = vi.fn(() => mockBlock);
      const blok = createBlokModules({
        BlockManager: {
          currentBlock: mockBlock,
          replace,
        } as unknown as BlokModules['BlockManager'],
      });
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent());

      expect(result).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });
  });
});
