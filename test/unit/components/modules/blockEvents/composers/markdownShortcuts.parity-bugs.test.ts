import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownShortcuts } from '../../../../../../src/components/modules/blockEvents/composers/markdownShortcuts';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';
import type { Block } from '../../../../../../src/components/block';

/**
 * Regression tests for three Notion text-parity bugs in the markdown shortcut
 * composer:
 *  - #10: "```" must become a code block on the third backtick (no trailing space).
 *  - #13: underscore emphasis is disallowed intraword ("snake_case_" stays plain).
 *  - #14: "***text***" must produce nested bold + italic.
 */

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
    dispatchChange: vi.fn(),
    updateCurrentInput: vi.fn(),
    save: vi.fn(),
    render: vi.fn(),
    ...overrides,
  } as unknown as Block;
};

const createBlokModules = (currentBlock: Block, replace = vi.fn(() => currentBlock)): BlokModules => {
  return {
    BlockManager: {
      currentBlock,
      replace,
      getBlockIndex: vi.fn(() => 0),
      insertDefaultBlockAtIndex: vi.fn(() => currentBlock),
    } as unknown as BlokModules['BlockManager'],
    Tools: {
      blockTools: new Map([
        ['list', { settings: {} }],
        ['header', { settings: { levels: [1, 2, 3, 4, 5, 6] } }],
        ['toggle', { settings: {} }],
        ['code', { settings: {} }],
      ]),
    } as unknown as BlokModules['Tools'],
    YjsManager: {
      stopCapturing: vi.fn(),
    } as unknown as BlokModules['YjsManager'],
    Caret: {
      positions: { START: 'start', END: 'end', DEFAULT: 'default' },
      setToBlock: vi.fn(),
    } as unknown as BlokModules['Caret'],
  } as unknown as BlokModules;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MarkdownShortcuts — Notion parity bugs', () => {
  // BUG #10
  describe('code block shortcut without a trailing space', () => {
    it('converts a bare "```" to a code block on the third backtick (data="`")', () => {
      const block = createBlock();
      if (block.currentInput) {
        block.currentInput.textContent = '```';
      }
      const replace = vi.fn(() => block);
      const blok = createBlokModules(block, replace);
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent({ data: '`' }));

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(block, 'code', expect.objectContaining({ code: '' }));
    });

    it('still converts "``` " (backticks + trailing space) for backward compatibility', () => {
      const block = createBlock();
      if (block.currentInput) {
        block.currentInput.textContent = '``` ';
      }
      const replace = vi.fn(() => block);
      const blok = createBlokModules(block, replace);
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent({ data: ' ' }));

      expect(result).toBe(true);
      expect(replace).toHaveBeenCalledWith(block, 'code', expect.objectContaining({ code: '' }));
    });

    it('does NOT convert a single backtick (inline code) into a code block', () => {
      const block = createBlock();
      if (block.currentInput) {
        block.currentInput.textContent = '`x`';
      }
      const replace = vi.fn(() => block);
      const blok = createBlokModules(block, replace);
      const markdownShortcuts = new MarkdownShortcuts(blok);

      // A trailing backtick on "`x" → text "`x`": must not match the code block shortcut.
      markdownShortcuts.handleInput(createInputEvent({ data: '`' }));

      expect(replace).not.toHaveBeenCalledWith(block, 'code', expect.anything());
    });
  });

  // BUG #13 & #14 (inline)
  describe('inline emphasis flanking & triple markers', () => {
    const setupInline = (rawText: string, closingChar: string): { input: HTMLElement; result: boolean } => {
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

      const block = createBlock({
        currentInput: input,
        firstInput: input,
        lastInput: input,
        inputs: [input],
      });
      const blok = createBlokModules(block);
      const markdownShortcuts = new MarkdownShortcuts(blok);

      const result = markdownShortcuts.handleInput(createInputEvent({ data: closingChar }));

      return { input, result };
    };

    afterEach(() => {
      document.body.innerHTML = '';
    });

    // BUG #13
    it('does NOT italicise intraword underscores ("snake_case_")', () => {
      const { input, result } = setupInline('snake_case_', '_');

      expect(result).toBe(false);
      expect(input.querySelector('i')).toBeNull();
      expect(input.textContent).toBe('snake_case_');
    });

    it('still italicises a properly flanked "_italic_"', () => {
      const { input, result } = setupInline('_italic_', '_');

      expect(result).toBe(true);
      expect(input.querySelector('i')?.textContent).toBe('italic');
    });

    it('still italicises "_word_" after a leading space ("say _hi_")', () => {
      const { input, result } = setupInline('say _hi_', '_');

      expect(result).toBe(true);
      expect(input.querySelector('i')?.textContent).toBe('hi');
    });

    // BUG #13 — guard must NOT change "*" intraword behaviour (CommonMark allows it).
    it('still italicises intraword asterisks ("snake*case*") — "*" behaviour unchanged', () => {
      const { input, result } = setupInline('snake*case*', '*');

      expect(result).toBe(true);
      expect(input.querySelector('i')?.textContent).toBe('case');
    });

    // BUG #14
    it('wraps "***bolditalic***" as nested bold + italic', () => {
      const { input, result } = setupInline('***bolditalic***', '*');

      expect(result).toBe(true);
      const nested = input.querySelector('strong > i');
      expect(nested?.textContent).toBe('bolditalic');
      expect(input.textContent).toBe('bolditalic');
      // No literal asterisks must leak around the span.
      expect(input.textContent).not.toContain('*');
    });

    it('preserves leading text before a triple-marker span ("say ***x***")', () => {
      const { input, result } = setupInline('say ***x***', '*');

      expect(result).toBe(true);
      expect(input.querySelector('strong > i')?.textContent).toBe('x');
      expect(input.textContent).toBe('say x');
    });

    it('does NOT prematurely fire bold while a triple marker is still being typed ("***x**")', () => {
      const { input, result } = setupInline('***x**', '*');

      expect(result).toBe(false);
      expect(input.querySelector('strong')).toBeNull();
      expect(input.textContent).toBe('***x**');
    });

    it('still wraps a plain "**bold**" in <strong>', () => {
      const { input, result } = setupInline('**bold**', '*');

      expect(result).toBe(true);
      expect(input.querySelector('strong')?.textContent).toBe('bold');
    });
  });
});
