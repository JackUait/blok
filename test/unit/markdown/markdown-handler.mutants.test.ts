import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { hasMarkdownSignals, MarkdownHandler } from '../../../src/markdown/markdown-handler';
import type { Block } from '../../../src/components/block';
import type { BasePasteHandler } from '../../../src/components/modules/paste/handlers/base';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../src/components/modules/paste/sanitizer-config';

describe('hasMarkdownSignals mutants', () => {
  describe('nothing to detect', () => {
    it('is false for an empty string', () => {
      expect(hasMarkdownSignals('')).toBe(false);
    });

    it('is false for ordinary prose', () => {
      expect(hasMarkdownSignals('Just a sentence about 2 things, priced at $5 and $9.')).toBe(false);
    });
  });

  describe('headings', () => {
    it.each(['# One', '## Two', '###### Six'])('detects %s', (text) => {
      expect(hasMarkdownSignals(text)).toBe(true);
    });

    it('detects a heading on a later line', () => {
      expect(hasMarkdownSignals('intro\n## Later')).toBe(true);
    });

    it('needs whitespace after the hashes', () => {
      expect(hasMarkdownSignals('#NoSpace')).toBe(false);
    });

    it('stops at six hashes', () => {
      expect(hasMarkdownSignals('####### Seven')).toBe(false);
    });

    it('needs the hashes at the start of a line', () => {
      expect(hasMarkdownSignals('a # not a heading')).toBe(false);
    });
  });

  describe('fenced code', () => {
    it('detects a fence at the start of a line', () => {
      expect(hasMarkdownSignals('```\ncode\n```')).toBe(true);
    });

    it('ignores a fence mid-line', () => {
      expect(hasMarkdownSignals('a ``` b')).toBe(false);
    });
  });

  describe('tables', () => {
    it('detects a GFM separator row', () => {
      expect(hasMarkdownSignals('| a | b |\n| --- | --- |')).toBe(true);
    });

    it('ignores a pipe with no rule after it', () => {
      expect(hasMarkdownSignals('a | b')).toBe(false);
    });
  });

  describe('task lists', () => {
    it.each(['- [ ] todo', '- [x] done'])('detects %s', (text) => {
      expect(hasMarkdownSignals(text)).toBe(true);
    });

    it('ignores another letter in the box', () => {
      expect(hasMarkdownSignals('a\n- [y] neither')).toBe(true);
    });
  });

  describe('unordered lists', () => {
    it.each(['- item', '* item', '+ item', '  - indented'])('detects %s', (text) => {
      expect(hasMarkdownSignals(text)).toBe(true);
    });

    it('needs whitespace after the marker', () => {
      expect(hasMarkdownSignals('-item')).toBe(false);
    });

    it('needs content after the whitespace', () => {
      expect(hasMarkdownSignals('- ')).toBe(false);
    });
  });

  describe('ordered lists', () => {
    it.each(['1. item', '1) item', '42. item'])('detects %s', (text) => {
      expect(hasMarkdownSignals(text)).toBe(true);
    });

    it('needs whitespace after the marker', () => {
      expect(hasMarkdownSignals('1.item')).toBe(false);
    });

    it('stops at nine digits', () => {
      expect(hasMarkdownSignals('1234567890. item')).toBe(false);
    });
  });

  describe('blockquotes', () => {
    it('detects a quote with content after the space', () => {
      expect(hasMarkdownSignals('> quoted')).toBe(true);
    });

    it.each(['-> arrow', '=> arrow', '>>> chevrons', '>no space'])('ignores %s', (text) => {
      expect(hasMarkdownSignals(text)).toBe(false);
    });

    it('allows up to three leading spaces and no more', () => {
      expect(hasMarkdownSignals('   > quoted')).toBe(true);
      expect(hasMarkdownSignals('    > quoted')).toBe(false);
    });
  });

  describe('links and images', () => {
    it('detects a link', () => {
      expect(hasMarkdownSignals('see [the docs](https://example.test) for more')).toBe(true);
    });

    it('needs text inside the brackets', () => {
      expect(hasMarkdownSignals('[](https://example.test)')).toBe(false);
    });

    it('needs a url inside the parentheses', () => {
      expect(hasMarkdownSignals('[text]()')).toBe(false);
    });

    it('refuses a bracket inside the link text, so the scan cannot run past it', () => {
      expect(hasMarkdownSignals('[a[b]c](d)')).toBe(false);
    });

    it('detects an image marker on its own', () => {
      expect(hasMarkdownSignals('![')).toBe(true);
    });
  });

  describe('emphasis', () => {
    it('detects bold', () => {
      expect(hasMarkdownSignals('some **bold** text')).toBe(true);
    });

    it('ignores an unpaired marker', () => {
      expect(hasMarkdownSignals('2 ** 3')).toBe(false);
    });
  });

  describe('math', () => {
    it('detects block math', () => {
      expect(hasMarkdownSignals('$$\\frac{a}{b}$$')).toBe(true);
    });

    it('detects inline math', () => {
      expect(hasMarkdownSignals('the value $x + 1$ is used')).toBe(true);
    });

    it('ignores a currency pair with spaces inside', () => {
      expect(hasMarkdownSignals('costs $ 5 to $ 9')).toBe(false);
    });

    it('ignores a lone dollar sign', () => {
      expect(hasMarkdownSignals('costs $5')).toBe(false);
    });
  });
});

describe('hasMarkdownSignals — regex boundaries', () => {
  it('detects a table separator row with no padding around the pipes', () => {
    expect(hasMarkdownSignals('|a|b|\n|---|---|')).toBe(true);
  });

  it('does not treat a task box in the middle of a line as a task item', () => {
    expect(hasMarkdownSignals('text - [ ] not a task')).toBe(false);
  });

  it('detects an unordered marker followed by more than one space', () => {
    expect(hasMarkdownSignals('-  spaced')).toBe(true);
  });

  it('detects an ordered marker followed by more than one space', () => {
    expect(hasMarkdownSignals('1.  spaced')).toBe(true);
  });

  it('detects block math whose body contains whitespace', () => {
    expect(hasMarkdownSignals('$$a + b$$')).toBe(true);
  });
});

interface ComposeBlockOptions {
  id: string;
  tool: string;
  data: Record<string, unknown>;
  parentId?: string;
  origin?: string;
}

type ComposeBlockImpl = (options: ComposeBlockOptions) => unknown;

interface BlokMockOptions {
  currentBlock?: unknown;
  currentBlockIndex?: number;
  composeBlockImpl?: ComposeBlockImpl;
}

const createBlokMock = (options: BlokMockOptions = {}) => {
  const composeBlock = vi.fn();

  composeBlock.mockImplementation(
    options.composeBlockImpl ?? ((blockOptions: ComposeBlockOptions) => ({ id: blockOptions.id }))
  );

  const insertMany = vi.fn();
  const removeBlock = vi.fn().mockResolvedValue(undefined);
  const setBlockParent = vi.fn();
  const setToBlock = vi.fn();
  const insertContentAtCaretPosition = vi.fn();

  const blok = {
    BlockManager: {
      composeBlock,
      insertMany,
      removeBlock,
      setBlockParent,
      currentBlock: options.currentBlock,
      currentBlockIndex: options.currentBlockIndex ?? 0,
    },
    Caret: { setToBlock, insertContentAtCaretPosition, positions: { END: 'end' } },
  } as unknown as BlokModules;

  return {
    blok,
    composeBlock,
    insertMany,
    removeBlock,
    setBlockParent,
    setToBlock,
    insertContentAtCaretPosition,
  };
};

const createContainerBlock = (caretInsideChildRegion: boolean) => {
  const holder = document.createElement('div');
  const childRegion = document.createElement('div');
  const currentInput = document.createElement('div');

  childRegion.setAttribute('data-blok-toggle-children', '');
  holder.appendChild(childRegion);

  if (caretInsideChildRegion) {
    childRegion.appendChild(currentInput);
  } else {
    holder.appendChild(currentInput);
  }

  return { id: 'b1', parentId: 'cal1', isEmpty: false, currentInput, holder };
};

describe('MarkdownHandler.canHandle', () => {
  const createHandler = (): MarkdownHandler => {
    const { blok } = createBlokMock();

    return new MarkdownHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder);
  };

  it('scores markdown text at the markdown priority', () => {
    expect(createHandler().canHandle('# Heading')).toBe(30);
  });

  it('scores plain text at zero', () => {
    expect(createHandler().canHandle('hello there')).toBe(0);
  });

  it('declines a non-string payload', () => {
    expect(createHandler().canHandle(42)).toBe(0);
  });

  it('declines a non-string payload whose string form is markdown', () => {
    expect(createHandler().canHandle(['# Heading'])).toBe(0);
  });

  it('declines a whitespace-only payload', () => {
    expect(createHandler().canHandle('   ')).toBe(0);
  });
});

describe('MarkdownHandler — converter outcomes', () => {
  let converter: ReturnType<typeof vi.fn>;
  let IsolatedHandler: typeof MarkdownHandler;
  let IsolatedBlock: typeof Block;
  let IsolatedBase: typeof BasePasteHandler;

  const createHandler = (blok: BlokModules): MarkdownHandler =>
    new IsolatedHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder);

  beforeEach(async () => {
    converter = vi.fn();
    vi.doMock('../../../src/markdown/index', () => ({ markdownToBlocks: converter }));
    vi.resetModules();

    IsolatedHandler = (await import('../../../src/markdown/markdown-handler')).MarkdownHandler;
    IsolatedBlock = (await import('../../../src/components/block')).Block;
    IsolatedBase = (await import('../../../src/components/modules/paste/handlers/base')).BasePasteHandler;
  });

  afterEach(() => {
    vi.doUnmock('../../../src/markdown/index');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('declines a non-string payload even when the converter would succeed', async () => {
    converter.mockResolvedValue([{ id: 'p1', type: 'paragraph', data: { text: 'x' } }]);
    const { blok, insertMany } = createBlokMock();

    const handled = await createHandler(blok).handle(42, { canReplaceCurrentBlock: false });

    expect(handled).toBe(false);
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('declines when the converter yields null', async () => {
    converter.mockResolvedValue(null);
    const { blok, insertMany } = createBlokMock();

    const handled = await createHandler(blok).handle('**bold**', { canReplaceCurrentBlock: false });

    expect(handled).toBe(false);
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('declines when the converter yields an empty list', async () => {
    converter.mockResolvedValue([]);
    const { blok, insertMany } = createBlokMock();

    const handled = await createHandler(blok).handle('**bold**', { canReplaceCurrentBlock: false });

    expect(handled).toBe(false);
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('declines and warns when the converter throws', async () => {
    converter.mockRejectedValue(new Error('bad markdown'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { blok, insertMany } = createBlokMock();

    const handled = await createHandler(blok).handle('**bold**', { canReplaceCurrentBlock: false });

    expect(handled).toBe(false);
    expect(insertMany).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'MarkdownHandler: markdown conversion failed, falling back to plain text',
      expect.any(Error)
    );
  });

  it('keeps a newline-bearing fragment on the block path', async () => {
    converter.mockResolvedValue([{ id: 'p1', type: 'paragraph', data: { text: '<strong>b</strong>' } }]);
    const currentBlock = { id: 'b1', parentId: null, isEmpty: false, currentInput: document.createElement('div'), holder: document.createElement('div') };
    const { blok, insertMany, insertContentAtCaretPosition } = createBlokMock({ currentBlock });

    const handled = await createHandler(blok).handle('**b**\nsecond', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
  });

  it('keeps a multi-block single line on the block path', async () => {
    converter.mockResolvedValue([
      { id: 'p1', type: 'paragraph', data: { text: '<strong>b</strong>' } },
      { id: 'p2', type: 'paragraph', data: { text: 'x' } },
    ]);
    const currentBlock = { id: 'b1', parentId: null, isEmpty: false, currentInput: document.createElement('div'), holder: document.createElement('div') };
    const { blok, insertMany, insertContentAtCaretPosition } = createBlokMock({ currentBlock });

    const handled = await createHandler(blok).handle('**b**', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
  });

  it('treats a missing paragraph text as an empty inline fragment', async () => {
    converter.mockResolvedValue([{ id: 'p1', type: 'paragraph', data: {} }]);
    const currentBlock = {
      id: 'b1',
      parentId: null,
      isEmpty: false,
      currentInput: document.createElement('div'),
      holder: document.createElement('div'),
      tool: { baseSanitizeConfig: { strong: true } },
    };
    const { blok, insertContentAtCaretPosition } = createBlokMock({ currentBlock });

    const handled = await createHandler(blok).handle('**b**', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(insertContentAtCaretPosition.mock.calls[0][0]).not.toContain('Stryker');
  });

  it('declines the inline path when the current block is unknown', async () => {
    converter.mockResolvedValue([{ id: 'p1', type: 'paragraph', data: { text: '<strong>b</strong>' } }]);
    const { blok, insertMany } = createBlokMock();

    const handled = await createHandler(blok).handle('**b**', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(insertMany).toHaveBeenCalledTimes(1);
  });

  it('declines the inline path when the block has no editable input', async () => {
    converter.mockResolvedValue([{ id: 'p1', type: 'paragraph', data: { text: '<strong>b</strong>' } }]);
    const currentBlock = { id: 'b1', parentId: null, isEmpty: false, currentInput: null, holder: document.createElement('div') };
    const { blok, insertMany } = createBlokMock({ currentBlock });

    const handled = await createHandler(blok).handle('**b**', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(insertMany).toHaveBeenCalledTimes(1);
  });

  it('hands the composed inline fragment to the base pipeline', async () => {
    converter.mockResolvedValue([{ id: 'p1', type: 'paragraph', data: { text: '<strong>b</strong>' } }]);
    const currentBlock = {
      id: 'b1',
      parentId: null,
      isEmpty: false,
      currentInput: document.createElement('div'),
      holder: document.createElement('div'),
      tool: { baseSanitizeConfig: { strong: true } },
    };
    const { blok, insertContentAtCaretPosition } = createBlokMock({ currentBlock });

    const composeSpy = vi.spyOn(
      IsolatedBase.prototype as unknown as { composePasteEvent: (type: string, detail: unknown) => Event },
      'composePasteEvent'
    );
    const inlineSpy = vi
      .spyOn(
        IsolatedBase.prototype as unknown as {
          processInlinePaste: (data: unknown, canReplaceCurrentBlock: boolean) => Promise<void>;
        },
        'processInlinePaste'
      )
      .mockResolvedValue(undefined);

    const handled = await createHandler(blok).handle('**b**', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(composeSpy).toHaveBeenCalledWith('tag', { data: expect.any(HTMLElement) });
    expect(inlineSpy).toHaveBeenCalledTimes(1);
    expect(inlineSpy.mock.calls[0][1]).toBe(false);

    const payload = inlineSpy.mock.calls[0][0] as { content: HTMLElement; tool: string; isBlock: boolean };

    expect(payload.tool).toBe('paragraph');
    expect(payload.isBlock).toBe(false);
    expect(payload.content.innerHTML).toContain('strong');
    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
  });

  it('keeps the converted output blocks intact when inserting', async () => {
    converter.mockResolvedValue([{ id: 'p1', type: 'paragraph', data: { text: 'x' } }]);
    const { blok, insertMany, composeBlock } = createBlokMock();

    await createHandler(blok).handle('**b**', { canReplaceCurrentBlock: false });

    expect(insertMany.mock.calls[0][0]).toEqual(composeBlock.mock.results.map((result) => result.value as unknown));
  });

  it('does not place the caret when the composed blocks are not Block instances', async () => {
    converter.mockResolvedValue([{ id: 'p1', type: 'paragraph', data: { text: 'x' } }]);
    const { blok, insertMany, setToBlock } = createBlokMock();

    const handled = await createHandler(blok).handle('**b**', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(setToBlock).not.toHaveBeenCalled();
  });

  it('places the caret at the end of the last inserted block', async () => {
    converter.mockResolvedValue([
      { id: 'x1', type: 'paragraph', data: { text: 'a' } },
      { id: 'x2', type: 'paragraph', data: { text: 'b' } },
      { id: 'x3', type: 'paragraph', data: { text: 'c' } },
    ]);
    const made: Block[] = [];
    const { blok, insertMany, setToBlock } = createBlokMock({
      composeBlockImpl: () => {
        const block = Object.create(IsolatedBlock.prototype) as Block;

        made.push(block);

        return block;
      },
    });

    const handled = await createHandler(blok).handle('a\nb\nc', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(made).toHaveLength(3);
    expect(setToBlock).toHaveBeenCalledTimes(1);
    expect(setToBlock).toHaveBeenCalledWith(made[2], 'end');
  });

  it('reparents into the container title block when the caret sits outside the child region', async () => {
    converter.mockResolvedValue([
      { id: 'x1', type: 'paragraph', data: { text: 'a' } },
      { id: 'x2', type: 'paragraph', data: { text: 'b' } },
    ]);
    const { blok, setBlockParent } = createBlokMock({ currentBlock: createContainerBlock(false) });

    const handled = await createHandler(blok).handle('first\nsecond', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(setBlockParent).toHaveBeenCalledTimes(2);

    for (const call of setBlockParent.mock.calls) {
      expect(call[1]).toBe('b1');
    }
  });

  it('keeps the container children parent when the caret sits inside the child region', async () => {
    converter.mockResolvedValue([
      { id: 'x1', type: 'paragraph', data: { text: 'a' } },
      { id: 'x2', type: 'paragraph', data: { text: 'b' } },
    ]);
    const { blok, setBlockParent } = createBlokMock({ currentBlock: createContainerBlock(true) });

    const handled = await createHandler(blok).handle('first\nsecond', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(setBlockParent).toHaveBeenCalledTimes(2);

    for (const call of setBlockParent.mock.calls) {
      expect(call[1]).toBe('cal1');
    }
  });

  it('reparents only the blocks that carry no parent of their own', async () => {
    converter.mockResolvedValue([
      {
        id: 'tbl-1',
        type: 'table',
        data: { withHeadings: false, content: [[{ blocks: ['p-a'] }, { blocks: ['p-b'] }]] },
      },
      { id: 'p-a', type: 'paragraph', data: { text: 'Cell A' } },
      { id: 'p-b', type: 'paragraph', data: { text: 'Cell B' } },
      { id: 'p-root', type: 'paragraph', data: { text: 'Root' }, parent: null },
    ]);
    const { blok, composeBlock, insertMany, setBlockParent } = createBlokMock({
      currentBlock: createContainerBlock(false),
    });

    const handled = await createHandler(blok).handle('| a |\n| --- |\n| b |', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(insertMany.mock.calls[0][0]).toEqual(composeBlock.mock.results.map((result) => result.value as unknown));
    expect(setBlockParent).toHaveBeenCalledTimes(2);

    for (const call of setBlockParent.mock.calls) {
      expect(call[1]).toBe('b1');
    }

    for (const call of composeBlock.mock.calls) {
      expect((call[0] as { origin?: string }).origin).toBe('paste');
    }
  });

  it('moves the insertion point past the current block when nothing is replaced', async () => {
    converter.mockResolvedValue([{ id: 'x1', type: 'paragraph', data: { text: 'a' } }]);
    const { blok, insertMany, removeBlock } = createBlokMock({ currentBlockIndex: 3 });

    const handled = await createHandler(blok).handle('a', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(insertMany.mock.calls[0][1]).toBe(4);
    expect(removeBlock).not.toHaveBeenCalled();
  });

  it('replaces the current empty block in place', async () => {
    converter.mockResolvedValue([{ id: 'x1', type: 'paragraph', data: { text: 'a' } }]);
    const currentBlock = { id: 'b1', parentId: null, isEmpty: true, currentInput: document.createElement('div'), holder: document.createElement('div') };
    const { blok, insertMany, removeBlock } = createBlokMock({ currentBlock, currentBlockIndex: 2 });

    const handled = await createHandler(blok).handle('a', { canReplaceCurrentBlock: true });

    expect(handled).toBe(true);
    expect(insertMany.mock.calls[0][1]).toBe(2);
    expect(removeBlock).toHaveBeenCalledTimes(1);
    expect(removeBlock.mock.calls[0][1]).toBe(false);
  });

  it('keeps the current empty block when replacement is not allowed', async () => {
    converter.mockResolvedValue([{ id: 'x1', type: 'paragraph', data: { text: 'a' } }]);
    const currentBlock = { id: 'b1', parentId: null, isEmpty: true, currentInput: document.createElement('div'), holder: document.createElement('div') };
    const { blok, insertMany, removeBlock } = createBlokMock({ currentBlock, currentBlockIndex: 2 });

    const handled = await createHandler(blok).handle('a', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    expect(insertMany.mock.calls[0][1]).toBe(3);
    expect(removeBlock).not.toHaveBeenCalled();
  });

  it('does not replace a block that is not there', async () => {
    converter.mockResolvedValue([{ id: 'x1', type: 'paragraph', data: { text: 'a' } }]);
    const { blok, insertMany, removeBlock } = createBlokMock({ currentBlockIndex: 3 });

    const handled = await createHandler(blok).handle('a', { canReplaceCurrentBlock: true });

    expect(handled).toBe(true);
    expect(insertMany.mock.calls[0][1]).toBe(4);
    expect(removeBlock).not.toHaveBeenCalled();
  });
});

