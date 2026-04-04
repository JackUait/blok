import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasMarkdownSignals, MarkdownHandler } from '../../../src/markdown/markdown-handler';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../src/components/modules/paste/sanitizer-config';

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
});
