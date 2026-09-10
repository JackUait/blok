import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarkdownShortcuts } from '../../../../../../src/components/modules/blockEvents/composers/markdownShortcuts';
import type { Block } from '../../../../../../src/components/block';
import type { BlokModules } from '../../../../../../src/types-internal/blok-modules';

/**
 * Header tool settings the composer reads. `shortcuts` being present at all
 * switches it from the built-in "#" grammar to the custom-prefix matcher.
 */
interface HeaderSettings {
  levels?: number[];
  shortcuts?: Record<number, string>;
}

interface ToolEntry {
  settings: HeaderSettings;
}

/** Text sitting in the document BEFORE the editor input. */
const DECOY_TEXT = 'DECOY';

/**
 * Every tool the composer can convert into. Registered by default so guard
 * clauses ("tool missing") are only exercised when a test asks for it.
 */
const defaultTools = (headerSettings: HeaderSettings): Array<[string, ToolEntry]> => [
  ['list', { settings: {} }],
  ['header', { settings: headerSettings }],
  ['toggle', { settings: {} }],
  ['divider', { settings: {} }],
  ['quote', { settings: {} }],
  ['code', { settings: {} }],
];

const createEvent = (data: string | null, inputType = 'insertText'): InputEvent =>
  new InputEvent('input', {
    inputType,
    data,
  });

const selectCollapsed = (node: Node, offset: number): void => {
  const range = document.createRange();

  range.setStart(node, offset);
  range.collapse(true);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

const selectSpan = (startNode: Node, startOffset: number, endNode: Node, endOffset: number): void => {
  const range = document.createRange();

  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);

  const selection = window.getSelection();

  selection?.removeAllRanges();
  selection?.addRange(range);
};

/**
 * Put the caret `offset` characters into `root`'s text, descending into whatever
 * text node holds that position — mirrors how a real caret lands in fragmented
 * content, which a plain `setStart(firstChild, n)` would not.
 */
const setCaretAtOffset = (root: HTMLElement, offset: number): void => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let consumed = 0;
  let node = walker.nextNode();

  while (node !== null) {
    const length = node.textContent?.length ?? 0;

    if (consumed + length >= offset) {
      selectCollapsed(node, offset - consumed);

      return;
    }

    consumed += length;
    node = walker.nextNode();
  }

  throw new Error(`caret offset ${offset} is past the ${consumed} characters available`);
};

interface SetupOptions {
  /** innerHTML of the editor input. Ignored when `textNodes` is given. */
  html?: string;
  /** Build the input from separate sibling text nodes instead of parsed HTML. */
  textNodes?: string[];
  /** Caret position in characters, `'end'`, or `'none'` to leave it to the test. */
  caret?: number | 'end' | 'none';
  toolName?: string;
  isDefault?: boolean;
  /** Value of `data-blok-depth` on the block holder. */
  depth?: number;
  headerSettings?: HeaderSettings;
  /** Tool names to register; omit to register all of them. */
  tools?: string[];
  withoutCurrentBlock?: boolean;
  withoutCurrentInput?: boolean;
  /** Shape of the REPLACEMENT block's firstInput, which the toggle-arrow caret path reads. */
  newBlockFirstInput?: 'withArrow' | 'empty' | 'none';
  /** Index `BlockManager.getBlockIndex` reports for the replacement block. */
  blockIndex?: number;
}

const setup = (options: SetupOptions = {}) => {
  const {
    html = '',
    textNodes,
    caret = 'end',
    toolName = 'paragraph',
    isDefault = true,
    depth = 0,
    headerSettings = { levels: [1, 2, 3, 4, 5, 6] },
    tools,
    withoutCurrentBlock = false,
    withoutCurrentInput = false,
    newBlockFirstInput = 'withArrow',
    blockIndex = 4,
  } = options;

  // Text before the editor in the document: `getCaretOffset` measures from the
  // input, so anything that stops scoping the range to the input picks this up.
  const decoy = document.createElement('p');

  decoy.textContent = DECOY_TEXT;
  document.body.appendChild(decoy);

  const input = document.createElement('div');

  input.contentEditable = 'true';

  if (textNodes === undefined) {
    input.innerHTML = html;
  } else {
    for (const chunk of textNodes) {
      input.appendChild(document.createTextNode(chunk));
    }
  }

  const holder = document.createElement('div');

  holder.setAttribute('data-blok-depth', String(depth));
  holder.appendChild(input);

  document.body.appendChild(holder);

  if (caret !== 'none') {
    setCaretAtOffset(input, caret === 'end' ? (input.textContent ?? '').length : caret);
  }

  const dispatchChange = vi.fn();
  const block = {
    id: 'source-block',
    name: toolName,
    holder,
    currentInput: withoutCurrentInput ? null : input,
    firstInput: input,
    lastInput: input,
    inputs: [input],
    tool: {
      isDefault,
      name: toolName,
    },
    dispatchChange,
  } as unknown as Block;

  const newBlockInput = document.createElement('div');

  if (newBlockFirstInput === 'withArrow') {
    const arrow = document.createElement('span');

    arrow.contentEditable = 'false';
    arrow.textContent = '▸';
    newBlockInput.appendChild(arrow);
    newBlockInput.appendChild(document.createTextNode('converted'));
  }

  document.body.appendChild(newBlockInput);

  const newBlock = {
    id: 'replacement-block',
    name: 'replacement',
    holder: document.createElement('div'),
    firstInput: newBlockFirstInput === 'none' ? null : newBlockInput,
    currentInput: newBlockInput,
    inputs: [newBlockInput],
    tool: {
      isDefault: false,
      name: 'replacement',
    },
    dispatchChange: vi.fn(),
  } as unknown as Block;

  const replace = vi.fn<(target: Block, tool: string, data: Record<string, unknown>) => Block>(() => newBlock);
  const insertDefaultBlockAtIndex = vi.fn<(index: number) => Block>(() => newBlock);
  const getBlockIndex = vi.fn<(target: Block) => number>(() => blockIndex);
  const stopCapturing = vi.fn();
  const setToBlock = vi.fn<(target: Block, position?: string, offset?: number) => void>();

  const registered = defaultTools(headerSettings).filter(([name]) => tools === undefined || tools.includes(name));

  const blok = {
    BlockManager: {
      currentBlock: withoutCurrentBlock ? null : block,
      replace,
      insertDefaultBlockAtIndex,
      getBlockIndex,
    },
    Tools: {
      blockTools: new Map<string, ToolEntry>(registered),
    },
    YjsManager: {
      stopCapturing,
    },
    Caret: {
      positions: {
        START: 'start',
        END: 'end',
        DEFAULT: 'default',
      },
      setToBlock,
    },
  } as unknown as BlokModules;

  const shortcuts = new MarkdownShortcuts(blok);
  const run = (data: string | null, inputType = 'insertText'): boolean =>
    shortcuts.handleInput(createEvent(data, inputType));

  return {
    input,
    block,
    newBlock,
    newBlockInput,
    replace,
    insertDefaultBlockAtIndex,
    getBlockIndex,
    stopCapturing,
    setToBlock,
    dispatchChange,
    run,
  };
};

/** The data object the composer handed to `BlockManager.replace`. */
const replacedData = (replace: ReturnType<typeof setup>['replace']): Record<string, unknown> => {
  const call = replace.mock.calls[0];

  if (call === undefined) {
    throw new Error('BlockManager.replace was never called');
  }

  return call[2];
};

describe('MarkdownShortcuts — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  describe('input-event gating', () => {
    it('ignores a non-insertText event carrying a space', () => {
      const { run, replace } = setup({ html: '# heading' });

      expect(run(' ', 'insertFromPaste')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('returns false without touching the block when the caret block is gone', () => {
      const { run, replace } = setup({ html: '*italic*', withoutCurrentBlock: true });

      expect(run('*')).toBe(false);
      expect(run(')')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('returns false for every space shortcut when the block has no editable input', () => {
      const { run, replace } = setup({ html: '# heading', withoutCurrentInput: true });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('returns false for the divider shortcut when the block has no editable input', () => {
      const { run, replace } = setup({ html: '---', withoutCurrentInput: true });

      expect(run('-')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('returns false for the divider shortcut when the caret block is gone', () => {
      const { run, replace } = setup({ html: '---', withoutCurrentBlock: true });

      expect(run('-')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('reports true to the caller when the third backtick converts to a code block', () => {
      const { run, replace, setToBlock } = setup({ html: '```' });

      expect(run('`')).toBe(true);
      expect(replace).toHaveBeenCalledTimes(1);
      expect(replacedData(replace)).toStrictEqual({ code: '' });
      expect(setToBlock).toHaveBeenCalledWith(expect.anything(), 'start');
    });
  });

  describe('list shortcuts', () => {
    it('strips exactly "[] " and keeps the rest of the line', () => {
      const { run, replace } = setup({ html: '[] buy milk' });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'buy milk',
        style: 'checklist',
        checked: false,
      });
    });

    it('strips exactly "[x] " and keeps the rest of the line', () => {
      const { run, replace } = setup({ html: '[x] buy milk' });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'buy milk',
        style: 'checklist',
        checked: true,
      });
    });

    it('strips exactly "[ ] " — the spaced form is four characters, not three', () => {
      const { run, replace } = setup({ html: '[ ] buy milk' });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'buy milk',
        style: 'checklist',
        checked: false,
      });
    });

    it('omits depth entirely for a top-level checklist', () => {
      const { run, replace } = setup({ html: '[] task', depth: 0 });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).not.toHaveProperty('depth');
    });

    it('carries the holder depth onto a nested checklist', () => {
      const { run, replace } = setup({ html: '[] task', depth: 3 });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'task',
        style: 'checklist',
        checked: false,
        depth: 3,
      });
    });

    it('omits depth entirely for a top-level bullet', () => {
      const { run, replace } = setup({ html: '- item', depth: 0 });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).not.toHaveProperty('depth');
    });

    it('carries the holder depth onto a nested bullet', () => {
      const { run, replace } = setup({ html: '- item', depth: 2 });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'item',
        style: 'unordered',
        checked: false,
        depth: 2,
      });
    });

    it('omits depth entirely for a top-level numbered item', () => {
      const { run, replace } = setup({ html: '1. item', depth: 0 });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'item',
        style: 'ordered',
        checked: false,
      });
    });

    it('carries the holder depth onto a nested numbered item', () => {
      const { run, replace } = setup({ html: '7) item', depth: 5 });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'item',
        style: 'ordered',
        checked: false,
        start: 7,
        depth: 5,
      });
    });

    it('keeps the caret on the same character it was typed at when converting a checklist', () => {
      // "[x] abcdef" with the caret after "abc": 7 characters in, minus the
      // 4-character marker, is offset 3 of the converted block.
      const { run, setToBlock, newBlock } = setup({ html: '[x] abcdef', caret: 7 });

      expect(run(' ')).toBe(true);
      expect(setToBlock).toHaveBeenCalledTimes(1);

      const call = setToBlock.mock.calls[0];

      expect(call[0]).toBe(newBlock);
      expect(call[1]).toBe('default');
      expect(call[2]).toBe(3);
    });

    it('keeps the caret on the same character when converting a bullet', () => {
      const { run, setToBlock } = setup({ html: '- abcdef', caret: 5 });

      expect(run(' ')).toBe(true);
      expect(setToBlock).toHaveBeenCalledWith(expect.anything(), 'default', 3);
    });

    it('keeps the caret on the same character when converting a numbered item', () => {
      const { run, setToBlock } = setup({ html: '12. abcdef', caret: 7 });

      expect(run(' ')).toBe(true);
      expect(setToBlock).toHaveBeenCalledWith(expect.anything(), 'default', 3);
    });

    it('pins the caret to the block start when the marker is all that was typed', () => {
      const { run, setToBlock, newBlock } = setup({ html: '- ', caret: 2 });

      expect(run(' ')).toBe(true);

      const call = setToBlock.mock.calls[0];

      expect(call[0]).toBe(newBlock);
      expect(call[1]).toBe('start');
      expect(call[2]).toBeUndefined();
    });

    it('brackets the checklist conversion with two undo-capture stops', () => {
      const { run, stopCapturing, setToBlock } = setup({ html: '[] task' });

      expect(run(' ')).toBe(true);
      expect(stopCapturing).toHaveBeenCalledTimes(2);
      expect(setToBlock).toHaveBeenCalledTimes(1);
    });

    it('brackets the bullet conversion with two undo-capture stops', () => {
      const { run, stopCapturing, setToBlock } = setup({ html: '- item' });

      expect(run(' ')).toBe(true);
      expect(stopCapturing).toHaveBeenCalledTimes(2);
      expect(setToBlock).toHaveBeenCalledTimes(1);
    });

    it('brackets the numbered conversion with two undo-capture stops', () => {
      const { run, stopCapturing, setToBlock } = setup({ html: '1. item' });

      expect(run(' ')).toBe(true);
      expect(stopCapturing).toHaveBeenCalledTimes(2);
      expect(setToBlock).toHaveBeenCalledTimes(1);
    });
  });

  describe('header shortcuts', () => {
    it('leaves a non-default block alone when "# " is typed inside it', () => {
      const { run, replace } = setup({ html: '# text', toolName: 'callout', isDefault: false });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('keeps the caret on the same character when converting a header', () => {
      const { run, setToBlock, newBlock } = setup({ html: '## abcdef', caret: 6 });

      expect(run(' ')).toBe(true);

      const call = setToBlock.mock.calls[0];

      expect(call[0]).toBe(newBlock);
      expect(call[1]).toBe('default');
      expect(call[2]).toBe(3);
    });

    it('brackets the header conversion with two undo-capture stops', () => {
      const { run, stopCapturing, setToBlock } = setup({ html: '### text' });

      expect(run(' ')).toBe(true);
      expect(stopCapturing).toHaveBeenCalledTimes(2);
      expect(setToBlock).toHaveBeenCalledTimes(1);
    });

    it('refuses a heading level the header tool does not offer', () => {
      const { run, replace } = setup({ html: '### text', headerSettings: { levels: [1, 2] } });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('accepts a heading level the header tool does offer', () => {
      const { run, replace } = setup({ html: '## text', headerSettings: { levels: [1, 2] } });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'text',
        level: 2,
      });
    });

    it('does nothing when the line holds no header marker at all', () => {
      const { run, replace, stopCapturing } = setup({ html: 'plain sentence' });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
      expect(stopCapturing).not.toHaveBeenCalled();
    });
  });

  describe('custom header shortcuts', () => {
    // "@ @" (level 2) starts with "@" (level 1), and the character after "@" is
    // a space — so both prefixes qualify and only the longest-first ordering
    // picks the one the user actually typed.
    const nestedPrefixes: HeaderSettings = { shortcuts: { 1: '@', 2: '@ @' } };
    const reversedNesting: HeaderSettings = { shortcuts: { 1: '@ @', 2: '@' } };

    it('prefers the longest matching prefix over a shorter one it contains', () => {
      const { run, replace } = setup({ html: '@ @ title', headerSettings: nestedPrefixes });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'title',
        level: 2,
      });
    });

    it('orders prefixes by length, not by reversing the configured order', () => {
      const { run, replace } = setup({ html: '@ @ title', headerSettings: reversedNesting });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'title',
        level: 1,
      });
    });

    it('consumes the prefix plus exactly one separator character', () => {
      const { run, replace } = setup({ html: '@ hello', headerSettings: { shortcuts: { 1: '@' } } });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'hello',
        level: 1,
      });
    });

    it('accepts a non-breaking space after the prefix', () => {
      const { run, replace } = setup({
        html: '@\u00a0hello',
        headerSettings: { shortcuts: { 1: '@' } },
      });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: 'hello',
        level: 1,
      });
    });

    it('does NOT fire when the prefix is glued to a word ("@x y")', () => {
      const { run, replace } = setup({ html: '@x y', headerSettings: { shortcuts: { 1: '@' } } });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('does NOT fire on a line that merely has a space in the prefix position', () => {
      // "a x" shares no prefix with "@" — a match must be anchored on the
      // configured text, not just on finding a space at its length.
      const { run, replace } = setup({ html: 'a x', headerSettings: { shortcuts: { 1: '@' } } });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('does NOT fire when the line is nothing but the prefix', () => {
      const { run, replace } = setup({ html: '@', headerSettings: { shortcuts: { 1: '@' } } });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe('toggle header shortcuts', () => {
    it('keeps the caret on the same character when converting a toggle header', () => {
      // ">## abcdef": marker is ">" + 2 hashes + space = 4 characters.
      const { run, setToBlock, newBlock } = setup({ html: '>## abcdef', caret: 7 });

      expect(run(' ')).toBe(true);

      const call = setToBlock.mock.calls[0];

      expect(call[0]).toBe(newBlock);
      expect(call[1]).toBe('default');
      expect(call[2]).toBe(3);
    });

    it('parks the caret after the toggle arrow when only the marker was typed', () => {
      const { run, setToBlock, newBlockInput } = setup({ html: '>## ', caret: 4 });

      expect(run(' ')).toBe(true);
      expect(setToBlock).not.toHaveBeenCalled();

      const selection = window.getSelection();

      expect(selection?.rangeCount).toBe(1);

      const range = selection?.getRangeAt(0);

      expect(range?.startContainer).toBe(newBlockInput);
      expect(range?.startOffset).toBe(1);
      expect(range?.collapsed).toBe(true);
    });

    it('falls back to the block start when the converted heading has no arrow node', () => {
      const { run, setToBlock, newBlock } = setup({ html: '>## ', caret: 4, newBlockFirstInput: 'empty' });

      expect(run(' ')).toBe(true);

      const call = setToBlock.mock.calls[0];

      expect(call[0]).toBe(newBlock);
      expect(call[1]).toBe('start');
    });

    it('falls back to the block start when the converted heading exposes no input', () => {
      const { run, setToBlock, newBlock } = setup({ html: '>## ', caret: 4, newBlockFirstInput: 'none' });

      expect(run(' ')).toBe(true);

      const call = setToBlock.mock.calls[0];

      expect(call[0]).toBe(newBlock);
      expect(call[1]).toBe('start');
    });

    it('parks the caret after the arrow without a selection object to work with', () => {
      const { run, setToBlock } = setup({ html: '>## ', caret: 4 });

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(run(' ')).toBe(true);
      expect(setToBlock).not.toHaveBeenCalled();
    });

    it('brackets the toggle-header conversion with two undo-capture stops', () => {
      const { run, stopCapturing, replace } = setup({ html: '>### text' });

      expect(run(' ')).toBe(true);
      expect(stopCapturing).toHaveBeenCalledTimes(2);
      expect(replacedData(replace)).toStrictEqual({
        text: 'text',
        level: 3,
        isToggleable: true,
      });
    });
  });

  describe('toggle shortcut', () => {
    it('leaves a non-default block alone when "> " is typed inside it', () => {
      const { run, replace } = setup({ html: '> text', toolName: 'callout', isDefault: false });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('keeps the caret on the same character when converting a toggle', () => {
      const { run, setToBlock } = setup({ html: '> abcdef', caret: 5 });

      expect(run(' ')).toBe(true);
      expect(setToBlock).toHaveBeenCalledWith(expect.anything(), 'default', 3);
    });

    it('brackets the toggle conversion with two undo-capture stops', () => {
      const { run, stopCapturing, setToBlock } = setup({ html: '> text' });

      expect(run(' ')).toBe(true);
      expect(stopCapturing).toHaveBeenCalledTimes(2);
      expect(setToBlock).toHaveBeenCalledTimes(1);
    });
  });

  describe('quote shortcut', () => {
    it('leaves a non-default block alone when the quote marker is typed inside it', () => {
      const { run, replace } = setup({ html: '" text', toolName: 'callout', isDefault: false });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('does NOT convert a line that lacks the quote marker', () => {
      const { run, replace } = setup({ html: 'ordinary line', tools: ['quote'] });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('keeps the caret on the same character when converting a quote', () => {
      const { run, setToBlock } = setup({ html: '" abcdef', caret: 5 });

      expect(run(' ')).toBe(true);
      expect(setToBlock).toHaveBeenCalledWith(expect.anything(), 'default', 3);
    });

    it('brackets the quote conversion with two undo-capture stops', () => {
      const { run, stopCapturing, setToBlock } = setup({ html: '" text' });

      expect(run(' ')).toBe(true);
      expect(stopCapturing).toHaveBeenCalledTimes(2);
      expect(setToBlock).toHaveBeenCalledTimes(1);
    });
  });

  describe('code shortcut', () => {
    it('leaves a non-default block alone when "``` " is typed inside it', () => {
      const { run, replace } = setup({ html: '``` code', toolName: 'callout', isDefault: false });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('does NOT convert a line that lacks the fence', () => {
      const { run, replace } = setup({ html: 'ordinary line', tools: ['code'] });

      expect(run(' ')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
    });

    it('does not convert a fenced line when the typed character is not a backtick', () => {
      const { run, replace, input } = setup({ html: '``` foo' });

      expect(run('*')).toBe(false);
      expect(replace).not.toHaveBeenCalled();
      expect(input.textContent).toBe('``` foo');
    });

    it('keeps the text typed after the fence', () => {
      const { run, replace } = setup({ html: '``` foo' });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({ code: 'foo' });
    });

    it('brackets the code conversion with two undo-capture stops and parks the caret at the start', () => {
      const { run, stopCapturing, setToBlock, newBlock } = setup({ html: '``` foo' });

      expect(run(' ')).toBe(true);
      expect(stopCapturing).toHaveBeenCalledTimes(2);

      const call = setToBlock.mock.calls[0];

      expect(call[0]).toBe(newBlock);
      expect(call[1]).toBe('start');
    });
  });

  describe('divider shortcut', () => {
    it('inserts the follow-up paragraph directly after the divider it just made', () => {
      const { run, insertDefaultBlockAtIndex, getBlockIndex, newBlock, setToBlock } = setup({
        html: '---',
        blockIndex: 4,
      });

      expect(run('-')).toBe(true);
      expect(getBlockIndex).toHaveBeenCalledWith(newBlock);
      expect(insertDefaultBlockAtIndex).toHaveBeenCalledWith(5);
      expect(setToBlock).toHaveBeenCalledWith(newBlock, 'start');
    });

    it('brackets the divider conversion with two undo-capture stops', () => {
      const { run, stopCapturing } = setup({ html: '---' });

      expect(run('-')).toBe(true);
      expect(stopCapturing).toHaveBeenCalledTimes(2);
    });
  });

  describe('shortcut text extraction', () => {
    it('keeps inline markup that surrounds the consumed marker', () => {
      const { run, replace } = setup({ html: '<b>#</b> heading text' });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: '<b></b>heading text',
        level: 1,
      });
    });

    it('consumes the marker across the several nodes it is split over', () => {
      const { run, replace } = setup({ html: '<b>#</b><i>#</i> heading text' });

      expect(run(' ')).toBe(true);
      expect(replacedData(replace)).toStrictEqual({
        text: '<b></b><i></i>heading text',
        level: 2,
      });
    });
  });

  describe('caret measurement', () => {
    it('measures the caret from the input, not from the start of the document', () => {
      // The document holds text before the editor; a caret offset that counted
      // it would land the converted caret past the text the user typed.
      const { run, setToBlock } = setup({ html: '# abcdef', caret: 5 });

      expect(document.body.textContent?.startsWith(DECOY_TEXT)).toBe(true);
      expect(run(' ')).toBe(true);
      expect(setToBlock).toHaveBeenCalledWith(expect.anything(), 'default', 3);
    });

    it('measures the caret where it sits, not at the end of the line', () => {
      const { run, setToBlock } = setup({ html: '# abcdef', caret: 4 });

      expect(run(' ')).toBe(true);
      expect(setToBlock).toHaveBeenCalledWith(expect.anything(), 'default', 2);
    });

    it('falls back to the block start when there is no selection to measure', () => {
      const { run, setToBlock, newBlock } = setup({ html: '# abcdef', caret: 'none' });

      window.getSelection()?.removeAllRanges();

      expect(run(' ')).toBe(true);

      const call = setToBlock.mock.calls[0];

      expect(call[0]).toBe(newBlock);
      expect(call[1]).toBe('start');
    });
  });

  describe('inline markdown detection', () => {
    it('nests bold inside italic for the triple-marker form', () => {
      const { input, run } = setup({ html: '***bold***' });

      expect(run('*')).toBe(true);
      expect(input.innerHTML).toBe('<strong><i>bold</i></strong>');
    });

    it('leaves "~~~word~~~" alone — strike has no separate double form', () => {
      const { input, run } = setup({ html: '~~~word~~~' });

      expect(run('~')).toBe(false);
      expect(input.innerHTML).toBe('~~~word~~~');
    });

    it('leaves a triple-backtick span alone rather than wrapping it in a nameless tag', () => {
      const { input, run } = setup({ html: '```word```' });

      expect(run('`')).toBe(false);
      expect(input.innerHTML).toBe('```word```');
    });

    it('leaves a double-backtick span alone — backticks have no bold form', () => {
      const { input, run } = setup({ html: '``word``' });

      expect(run('`')).toBe(false);
      expect(input.innerHTML).toBe('``word``');
    });

    it('leaves "*** padded ***" alone', () => {
      const { input, run } = setup({ html: '*** padded ***' });

      expect(run('*')).toBe(false);
      expect(input.innerHTML).toBe('*** padded ***');
    });

    it('formats only the text before the caret and keeps what follows it', () => {
      const { input, run } = setup({ html: '**bold** tail', caret: 8 });

      expect(run('*')).toBe(true);
      expect(input.innerHTML).toBe('<strong>bold</strong> tail');
    });

    it('does not leave an empty text node in front of a span that starts the line', () => {
      const { input, run } = setup({ html: '*x*' });

      expect(run('*')).toBe(true);
      expect(input.childNodes).toHaveLength(1);
      expect(input.innerHTML).toBe('<i>x</i>');
    });

    it('flushes the direct DOM edit to the block exactly once', () => {
      const { run, dispatchChange, stopCapturing } = setup({ html: '**bold**' });

      expect(run('*')).toBe(true);
      expect(dispatchChange).toHaveBeenCalledTimes(1);
      expect(stopCapturing).toHaveBeenCalledTimes(2);
    });

    it('leaves the caret directly after the new span when nothing follows it', () => {
      const { input, run } = setup({ html: '*x*' });

      expect(run('*')).toBe(true);

      const selection = window.getSelection();
      const range = selection?.getRangeAt(0);

      expect(range?.startContainer).toBe(input);
      expect(range?.startOffset).toBe(1);
      expect(range?.collapsed).toBe(true);
    });

    it('leaves the caret in the trailing text when something follows the span', () => {
      const { input, run } = setup({ html: '*x* tail', caret: 3 });

      expect(run('*')).toBe(true);

      const range = window.getSelection()?.getRangeAt(0);

      expect(range?.startContainer).toBe(input.childNodes[1]);
      expect(range?.startOffset).toBe(0);
      expect(input.innerHTML).toBe('<i>x</i> tail');
    });

    it('does not format while the selection still spans a range', () => {
      const { input, run } = setup({ textNodes: ['**bold**', 'xy'], caret: 'none' });

      selectSpan(input.childNodes[0], 8, input.childNodes[1], 1);

      expect(run('*')).toBe(false);
      expect(input.innerHTML).toBe('**bold**xy');
    });

    it('does not format when there is no selection at all', () => {
      const { input, run } = setup({ html: '**bold**', caret: 'none' });

      window.getSelection()?.removeAllRanges();

      expect(run('*')).toBe(false);
      expect(input.innerHTML).toBe('**bold**');
    });

    it('does not format when the browser reports no selection object', () => {
      const { input, run } = setup({ html: '**bold**' });

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(run('*')).toBe(false);
      expect(input.innerHTML).toBe('**bold**');
    });

    it('does not format when the caret sits on an element rather than in its text', () => {
      const { input, run } = setup({ textNodes: ['*', 'x', '*'], caret: 'none' });

      selectCollapsed(input, 3);

      expect(run('*')).toBe(false);
      expect(input.isConnected).toBe(true);
      expect(input.textContent).toBe('*x*');
    });

    it('does not format text that sits outside the edited block', () => {
      const { input, run } = setup({ html: 'untouched', caret: 'none' });
      const stranger = document.createElement('div');

      stranger.textContent = '*x*';
      document.body.appendChild(stranger);

      const strangerText = stranger.firstChild;

      if (strangerText === null) {
        throw new Error('fixture text node missing');
      }

      selectCollapsed(strangerText, 3);

      expect(run('*')).toBe(false);
      expect(stranger.innerHTML).toBe('*x*');
      expect(input.innerHTML).toBe('untouched');
    });

    it('does not format when the block has no editable input', () => {
      const { input, run } = setup({ html: '**bold**', withoutCurrentInput: true });

      expect(run('*')).toBe(false);
      expect(input.innerHTML).toBe('**bold**');
    });

    it('leaves markers inside an existing code span literal', () => {
      const { input, run } = setup({ html: '<code>*x*</code>', caret: 'none' });
      const codeText = input.querySelector('code')?.firstChild;

      if (codeText === undefined || codeText === null) {
        throw new Error('fixture code text node missing');
      }

      selectCollapsed(codeText, 3);

      expect(run('*')).toBe(false);
      expect(input.innerHTML).toBe('<code>*x*</code>');
    });
  });

  describe('link markdown detection', () => {
    it('does not build a link while the selection still spans a range', () => {
      const { input, run } = setup({ textNodes: ['[a](b)', 'xy'], caret: 'none' });

      selectSpan(input.childNodes[0], 6, input.childNodes[1], 1);

      expect(run(')')).toBe(false);
      expect(input.querySelector('a')).toBeNull();
    });

    it('does not build a link when there is no selection at all', () => {
      const { input, run } = setup({ html: '[a](b)', caret: 'none' });

      window.getSelection()?.removeAllRanges();

      expect(run(')')).toBe(false);
      expect(input.querySelector('a')).toBeNull();
    });

    it('does not build a link when the caret sits on an element rather than in its text', () => {
      const { input, run } = setup({ textNodes: ['[a]', '(b)'], caret: 'none' });

      selectCollapsed(input, 2);

      expect(run(')')).toBe(false);
      expect(input.querySelector('a')).toBeNull();
      expect(input.isConnected).toBe(true);
    });

    it('does not build a link from text outside the edited block', () => {
      const { input, run } = setup({ html: 'untouched', caret: 'none' });
      const stranger = document.createElement('div');

      stranger.textContent = '[a](b)';
      document.body.appendChild(stranger);

      const strangerText = stranger.firstChild;

      if (strangerText === null) {
        throw new Error('fixture text node missing');
      }

      selectCollapsed(strangerText, 6);

      expect(run(')')).toBe(false);
      expect(stranger.querySelector('a')).toBeNull();
      expect(input.innerHTML).toBe('untouched');
    });

    it('does not build a link when the block has no editable input', () => {
      const { input, run } = setup({ html: '[a](b)', withoutCurrentInput: true });

      expect(run(')')).toBe(false);
      expect(input.querySelector('a')).toBeNull();
    });

    // The url capture rejects parens, so a payload with them never reaches the
    // scheme check — the guard is only exercised by a paren-free scheme.
    it('rejects a javascript: url and leaves the typed markdown as text', () => {
      const { input, run } = setup({ html: '[click](javascript:alert)' });

      expect(run(')')).toBe(false);
      expect(input.querySelector('a')).toBeNull();
      expect(input.textContent).toBe('[click](javascript:alert)');
    });

    it('rejects a data: url and leaves the typed markdown as text', () => {
      const { input, run } = setup({ html: '[x](data:text/html;base64,PHN2Zz4=)' });

      expect(run(')')).toBe(false);
      expect(input.querySelector('a')).toBeNull();
    });

    it('still builds a link for a scheme-less path', () => {
      const { input, run } = setup({ html: '[docs](/guide)' });

      expect(run(')')).toBe(true);
      expect(input.querySelector('a')?.getAttribute('href')).toBe('/guide');
    });

    it('measures the markdown span up to the caret, not to the end of the line', () => {
      const { input, run } = setup({ html: '[x](y) trailing', caret: 6 });

      expect(run(')')).toBe(true);
      expect(input.textContent).toBe('x trailing');
      expect(input.querySelector('a')?.textContent).toBe('x');
    });

    it('does not build a link when the typed character is not the closing paren', () => {
      const { input, run, replace } = setup({ html: '[x](y)' });

      expect(run('*')).toBe(false);
      expect(input.querySelector('a')).toBeNull();
      expect(replace).not.toHaveBeenCalled();
    });

    it('does not build a link when the browser reports no selection object', () => {
      const { input, run } = setup({ html: '[x](y)' });

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(run(')')).toBe(false);
      expect(input.querySelector('a')).toBeNull();
    });

    it('replaces the whole span when the markdown starts inside a later text node', () => {
      const { input, run } = setup({ textNodes: ['abc', 'de[x](y)'], caret: 'end' });

      expect(run(')')).toBe(true);
      expect(input.textContent).toBe('abcdex');

      const anchor = input.querySelector('a');

      expect(anchor?.getAttribute('href')).toBe('y');
      expect(anchor?.textContent).toBe('x');
    });

    it('replaces the whole span when the markdown starts exactly at a node boundary', () => {
      const { input, run } = setup({ textNodes: ['ab', '[x](y)'], caret: 'end' });

      expect(run(')')).toBe(true);
      expect(input.textContent).toBe('abx');
      expect(input.querySelector('a')?.textContent).toBe('x');
    });

    // The span's first character sits at the END of one inline element while the
    // closing paren is typed inside the NEXT one, so "end of the first node" and
    // "start of the second" are the same text offset but two different DOM
    // positions. The anchor is rebuilt at the span's own start boundary — the
    // one after the <b> — not inside the element the paren was typed in.
    it('rebuilds the link where the span started, not inside the element holding the closing paren', () => {
      const { input, run } = setup({ html: '<b>ab</b><i>[x](y)</i>' });

      expect(run(')')).toBe(true);
      expect(input.querySelector('i a')).toBeNull();
      expect(input.querySelector('a')?.parentElement).toBe(input);
      expect(input.textContent).toBe('abx');
    });

    it('leaves the caret directly after the new link', () => {
      const { input, run } = setup({ html: '[x](y)' });

      expect(run(')')).toBe(true);

      const anchor = input.querySelector('a');
      const range = window.getSelection()?.getRangeAt(0);

      expect(range?.collapsed).toBe(true);
      expect(range?.startContainer).toBe(input);
      expect(anchor).not.toBeNull();

      if (anchor !== null) {
        expect(range?.comparePoint(anchor, 0)).toBe(-1);
      }
    });

    it('flushes the direct DOM edit to the block exactly once', () => {
      const { run, dispatchChange, stopCapturing } = setup({ html: '[x](y)' });

      expect(run(')')).toBe(true);
      expect(dispatchChange).toHaveBeenCalledTimes(1);
      expect(stopCapturing).toHaveBeenCalledTimes(2);
    });
  });
});
