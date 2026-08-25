import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MarkdownHandler } from '../../../src/markdown/markdown-handler';
import type { BlokModules } from '../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../src/components/modules/paste/sanitizer-config';
import type { OutputBlockData } from '../../../types/data-formats/output-data';

const { markdownToBlocks } = vi.hoisted(() => ({
  markdownToBlocks: vi.fn<(md: string) => Promise<OutputBlockData[]>>(),
}));

vi.mock('../../../src/markdown/index', () => ({ markdownToBlocks }));

/**
 * A converter failure must decline the paste so routeToHandlers falls through
 * to TextHandler. Without the guard the throw escapes the whole pipeline and
 * the paste silently does nothing.
 */
describe('MarkdownHandler — converter failure falls back instead of throwing', () => {
  let handler: MarkdownHandler;
  let insertMany: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    insertMany = vi.fn();

    const blok = {
      BlockManager: {
        composeBlock: vi.fn(),
        insertMany,
        removeBlock: vi.fn().mockResolvedValue(undefined),
        currentBlock: undefined,
        currentBlockIndex: 0,
      },
      Caret: {
        setToBlock: vi.fn(),
        positions: { END: 'end' },
      },
    } as unknown as BlokModules;

    handler = new MarkdownHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when the converter rejects', async () => {
    markdownToBlocks.mockRejectedValue(new Error('parser exploded'));

    await expect(handler.handle('# Heading', { canReplaceCurrentBlock: false })).resolves.toBe(false);
    expect(insertMany).not.toHaveBeenCalled();
  });

  it('returns false when the converter throws synchronously', async () => {
    markdownToBlocks.mockImplementation(() => {
      throw new Error('parser exploded');
    });

    await expect(handler.handle('# Heading', { canReplaceCurrentBlock: false })).resolves.toBe(false);
    expect(insertMany).not.toHaveBeenCalled();
  });
});
