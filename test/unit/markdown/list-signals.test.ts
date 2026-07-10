import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hasMarkdownSignals, MarkdownHandler } from '../../../src/markdown/markdown-handler';
import { markdownToBlocks } from '../../../src/markdown/index';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../src/components/modules/paste/sanitizer-config';

/**
 * Regression coverage for the list-paste Notion-parity cluster
 * (M-10, M-11, M-12, M-16, M-19, m-20, m-21).
 *
 * Root cause: MARKDOWN_SIGNALS omitted plain bullet (`- `, `* `, `+ `) and
 * ordered (`1. `) markers, so list-shaped clipboard text scored 0 and paste
 * fell back to the plain TextHandler, producing literal-text paragraphs.
 */
describe('hasMarkdownSignals — list detection (Notion parity)', () => {
  it('M-10: detects a plain multi-line bullet list (`- a\\n- b\\n- c`)', () => {
    expect(hasMarkdownSignals('- a\n- b\n- c')).toBe(true);
  });

  it('M-10: detects `* ` and `+ ` bullet markers', () => {
    expect(hasMarkdownSignals('* one\n* two')).toBe(true);
    expect(hasMarkdownSignals('+ one\n+ two')).toBe(true);
  });

  it('M-11: detects nested/indented bullets', () => {
    expect(hasMarkdownSignals('- parent\n  - child\n    - grandchild')).toBe(true);
  });

  it('M-12/M-16: detects a plain numbered list (`1. \\n2. \\n3. `)', () => {
    expect(hasMarkdownSignals('1. first\n2. second\n3. third')).toBe(true);
  });

  it('m-19: detects a single-line bullet (`- item`, no newline)', () => {
    expect(hasMarkdownSignals('- item')).toBe(true);
  });

  it('m-21: detects bullets separated by a blank line (`- a\\n\\n- b`)', () => {
    expect(hasMarkdownSignals('- a\n\n- b')).toBe(true);
  });

  it('m-20: does NOT misfire on prose with a mid-line dash or hyphenated range', () => {
    expect(hasMarkdownSignals('well - that is interesting')).toBe(false);
    expect(hasMarkdownSignals('the range is 5-10 units')).toBe(false);
    expect(hasMarkdownSignals('see step 1. then continue')).toBe(false);
    expect(hasMarkdownSignals('a-b-c hyphenated word')).toBe(false);
  });

  it('m-20: does NOT misfire on a bare dash with no content after it', () => {
    expect(hasMarkdownSignals('-')).toBe(false);
    expect(hasMarkdownSignals('- ')).toBe(false);
  });
});

describe('markdownToBlocks — list conversion already preserves structure', () => {
  it('M-10: plain bullets become unordered list blocks', async () => {
    const blocks = await markdownToBlocks('- a\n- b\n- c');

    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      expect(block).toMatchObject({ type: 'list', data: { style: 'unordered' } });
    }
  });

  it('M-11: nested bullets become flat list blocks with incrementing depth', async () => {
    const blocks = await markdownToBlocks('- parent\n  - child\n    - grandchild');

    expect(blocks.map((b) => (b.data as { depth: number }).depth)).toEqual([0, 1, 2]);
  });

  it('M-12/M-16: numbered lines become ordered list blocks (round-trip of `1. ` export)', async () => {
    const blocks = await markdownToBlocks('1. first\n2. second\n3. third');

    expect(blocks).toHaveLength(3);
    for (const block of blocks) {
      expect(block).toMatchObject({ type: 'list', data: { style: 'ordered' } });
    }
  });

  it('m-21: blank-line-separated bullets still become a list (CommonMark loose list)', async () => {
    const blocks = await markdownToBlocks('- a\n\n- b');

    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks.every((b) => b.type === 'list')).toBe(true);
  });
});

describe('MarkdownHandler — list-shaped paste routes through the converter end-to-end', () => {
  let composeBlock: ReturnType<typeof vi.fn>;
  let insertMany: ReturnType<typeof vi.fn>;
  let insertContentAtCaretPosition: ReturnType<typeof vi.fn>;
  let handler: MarkdownHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    composeBlock = vi.fn().mockImplementation((options: { id: string }) => ({ id: options.id }));
    insertMany = vi.fn();
    insertContentAtCaretPosition = vi.fn();

    const blok = {
      BlockManager: {
        composeBlock,
        insertMany,
        removeBlock: vi.fn().mockResolvedValue(undefined),
        currentBlock: undefined,
        currentBlockIndex: 0,
      },
      Caret: {
        setToBlock: vi.fn(),
        positions: { END: 'end' },
        insertContentAtCaretPosition,
      },
    } as unknown as BlokModules;

    handler = new MarkdownHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('canHandle returns 30 for list-shaped text (was 0 before the signal fix)', () => {
    expect(handler.canHandle('- a\n- b\n- c')).toBe(30);
    expect(handler.canHandle('1. a\n2. b')).toBe(30);
    expect(handler.canHandle('- single')).toBe(30);
  });

  it('M-10: a plain bullet paste inserts list blocks, not literal-text paragraphs', async () => {
    const handled = await handler.handle('- a\n- b\n- c', { canReplaceCurrentBlock: false });

    expect(handled).toBe(true);
    const tools = composeBlock.mock.calls.map((args) => (args[0] as { tool: string }).tool);

    expect(tools).toEqual(['list', 'list', 'list']);
  });

  it('m-19: a single-line bullet inserts ONE list block (not merged inline as a paragraph)', async () => {
    await handler.handle('- item', { canReplaceCurrentBlock: false });

    const tools = composeBlock.mock.calls.map((args) => (args[0] as { tool: string }).tool);

    expect(tools).toEqual(['list']);
    expect(insertMany).toHaveBeenCalledTimes(1);
    // A bullet is a block, never an inline fragment merge.
    expect(insertContentAtCaretPosition).not.toHaveBeenCalled();
  });
});
