import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasMarkdownSignals, MarkdownHandler } from '../../../src/markdown/markdown-handler';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../src/components/modules/paste/sanitizer-config';

import type * as MarkdownIndexModule from '../../../src/markdown/index';

vi.mock('../../../src/markdown/index', async () => {
  const actual = await vi.importActual<typeof MarkdownIndexModule>(
    '../../../src/markdown/index'
  );

  return actual;
});

describe('MarkdownHandler', () => {
  let handler: MarkdownHandler;
  let mockComposeBlock: ReturnType<typeof vi.fn>;
  let mockInsertMany: ReturnType<typeof vi.fn>;
  let mockRemoveBlock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockComposeBlock = vi.fn().mockImplementation((options: { id: string }) => ({
      id: options.id,
    }));
    mockInsertMany = vi.fn();
    mockRemoveBlock = vi.fn().mockResolvedValue(undefined);

    const mockBlok = {
      BlockManager: {
        composeBlock: mockComposeBlock,
        insertMany: mockInsertMany,
        removeBlock: mockRemoveBlock,
        currentBlock: undefined,
        currentBlockIndex: 0,
      },
      Caret: {
        setToBlock: vi.fn(),
        positions: { END: 'end' },
      },
    } as unknown as BlokModules;

    handler = new MarkdownHandler(
      mockBlok,
      {} as ToolRegistry,
      {} as SanitizerConfigBuilder,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes parentId to composeBlock for table cell blocks', async () => {
    const md = '| A | B |\n| --- | --- |\n| 1 | 2 |';

    await handler.handle(md, { canReplaceCurrentBlock: false });

    // Find the table block call
    const tableCall = mockComposeBlock.mock.calls.find(
      (args) => (args[0] as { tool: string }).tool === 'table'
    );

    expect(tableCall).toBeDefined();
    const tableId = (tableCall![0] as { id: string }).id;

    // Find cell paragraph calls — they should have parentId set to the table's id
    const cellCalls = mockComposeBlock.mock.calls.filter(
      (args) => (args[0] as { parentId?: string }).parentId !== undefined
    );

    expect(cellCalls.length).toBe(4); // 2 rows × 2 cols = 4 cell paragraphs
    for (const args of cellCalls) {
      expect((args[0] as { parentId: string }).parentId).toBe(tableId);
    }
  });

  it('normalizes flat-array table children even if markdownToBlocks emits children without parent', async () => {
    // Defense-in-depth: if mdast-to-blocks ever regresses to emitting the
    // dodopizza shape (table cells reference children by id but the children
    // themselves carry no `parent` field), the handler must still classify
    // them as children of the table — not as detached top-level paragraphs.
    vi.doMock('../../../src/markdown/index', () => ({
      markdownToBlocks: vi.fn().mockResolvedValue([
        {
          id: 'tbl-1',
          type: 'table',
          data: {
            withHeadings: false,
            content: [[{ blocks: ['p-a'] }, { blocks: ['p-b'] }]],
          },
        },
        {
          id: 'p-a',
          type: 'paragraph',
          data: { text: 'Cell A' },
        },
        {
          id: 'p-b',
          type: 'paragraph',
          data: { text: 'Cell B' },
        },
      ]),
    }));

    // Re-import handler so the dynamic import inside handle() resolves the mock.
    vi.resetModules();
    const { MarkdownHandler: IsolatedHandler } = await import('../../../src/markdown/markdown-handler');

    const isolatedCompose = vi.fn().mockImplementation((options: { id: string }) => ({ id: options.id }));
    const isolatedInsert = vi.fn();
    const isolatedBlok = {
      BlockManager: {
        composeBlock: isolatedCompose,
        insertMany: isolatedInsert,
        removeBlock: vi.fn().mockResolvedValue(undefined),
        currentBlock: undefined,
        currentBlockIndex: 0,
      },
      Caret: { setToBlock: vi.fn(), positions: { END: 'end' } },
    } as unknown as BlokModules;

    const isolated = new IsolatedHandler(isolatedBlok, {} as ToolRegistry, {} as SanitizerConfigBuilder);

    await isolated.handle('| A | B |\n| --- | --- |\n| 1 | 2 |', { canReplaceCurrentBlock: false });

    const childCalls = isolatedCompose.mock.calls.filter(
      (args) => (args[0] as { tool: string }).tool === 'paragraph'
    );

    expect(childCalls).toHaveLength(2);
    for (const args of childCalls) {
      expect((args[0] as { parentId?: string }).parentId).toBe('tbl-1');
    }

    vi.doUnmock('../../../src/markdown/index');
  });
});

describe('hasMarkdownSignals', () => {
  it('detects heading syntax', () => {
    expect(hasMarkdownSignals('# Hello World')).toBe(true);
    expect(hasMarkdownSignals('## Subheading')).toBe(true);
    expect(hasMarkdownSignals('### Third level')).toBe(true);
  });

  it('detects fenced code blocks', () => {
    expect(hasMarkdownSignals('```js\nconsole.log("hi")\n```')).toBe(true);
  });

  it('detects GFM table separators', () => {
    expect(hasMarkdownSignals('| A | B |\n| --- | --- |')).toBe(true);
  });

  it('detects task list items', () => {
    expect(hasMarkdownSignals('- [ ] Todo item')).toBe(true);
    expect(hasMarkdownSignals('- [x] Done item')).toBe(true);
  });

  it('detects markdown links', () => {
    expect(hasMarkdownSignals('Check out [this link](https://example.com)')).toBe(true);
  });

  it('detects bold syntax', () => {
    expect(hasMarkdownSignals('This is **bold** text')).toBe(true);
  });

  it('detects image syntax', () => {
    expect(hasMarkdownSignals('![alt text](https://img.com/pic.png)')).toBe(true);
  });

  it('rejects plain text without markdown signals', () => {
    expect(hasMarkdownSignals('Hello world')).toBe(false);
    expect(hasMarkdownSignals('Just some regular text here.')).toBe(false);
    expect(hasMarkdownSignals('Price is $100 or #1 best seller')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(hasMarkdownSignals('')).toBe(false);
  });

  it('rejects # not followed by space', () => {
    expect(hasMarkdownSignals('#hashtag')).toBe(false);
  });

  it('detects block math with double dollar signs', () => {
    expect(hasMarkdownSignals('Before $$E = mc^2$$ after')).toBe(true);
    expect(hasMarkdownSignals('$$\\sum_{i=1}^n i = \\frac{n(n+1)}{2}$$')).toBe(true);
  });

  it('detects inline math with single dollar signs', () => {
    expect(hasMarkdownSignals('The equation $E = mc^2$ is famous')).toBe(true);
    expect(hasMarkdownSignals('$x^2 + y^2 = z^2$')).toBe(true);
  });

  it('does not detect dollar amounts as math', () => {
    expect(hasMarkdownSignals('The price is $100')).toBe(false);
    expect(hasMarkdownSignals('I have $50 and $30')).toBe(false);
  });
});
