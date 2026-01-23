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
});
