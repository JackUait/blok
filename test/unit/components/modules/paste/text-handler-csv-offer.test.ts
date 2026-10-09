/**
 * Plain text that reads as a CSV/TSV table pastes as paragraphs, then offers
 * to become a database. Unverified in Notion (research/05 U4).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TextHandler } from '../../../../../src/components/modules/paste/handlers/text-handler';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { ToolRegistry } from '../../../../../src/components/modules/paste/tool-registry';
import type { SanitizerConfigBuilder } from '../../../../../src/components/modules/paste/sanitizer-config';

const createBlok = (tools: string[]): { blok: BlokModules; show: ReturnType<typeof vi.fn> } => {
  const blocks: Array<{ id: string }> = [{ id: 'existing' }];
  const show = vi.fn();
  const counter = { n: 0 };
  const paste = vi.fn(async (tool: string) => {
    counter.n += 1;
    const block = { id: `pasted-${counter.n}`, name: tool, parentId: null, holder: document.createElement('div'), isEmpty: false };

    blocks.push(block);

    return block;
  });
  const blok = {
    BlockManager: {
      get blocks() {
        return blocks;
      },
      currentBlock: { id: 'existing', name: 'paragraph', parentId: null, isEmpty: true, holder: document.createElement('div'), currentInput: document.createElement('div') },
      paste,
      setBlockParent: vi.fn(),
      transactForTool: vi.fn((fn: () => void) => fn()),
      setCurrentBlockByChildNode: vi.fn(),
    },
    Caret: { setToBlock: vi.fn(), positions: { END: 'end' }, insertContentAtCaretPosition: vi.fn() },
    Tools: { blockTools: new Map(tools.map((name) => [name, {}])) },
    NotifierAPI: { methods: { show } },
    BlocksAPI: { methods: {} },
    I18n: { t: (key: string) => key },
  } as unknown as BlokModules;

  return { blok, show };
};

const handler = (blok: BlokModules): TextHandler =>
  new TextHandler(blok, {} as ToolRegistry, {} as SanitizerConfigBuilder, { defaultBlock: 'paragraph' });

describe('TextHandler — CSV paste offer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('offers to convert a pasted table when the database tool is there', async () => {
    const { blok, show } = createBlok(['paragraph', 'database', 'database-row']);

    await handler(blok).handle('Task\tPoints\nWrite\t3', { canReplaceCurrentBlock: true });

    expect(show).toHaveBeenCalledWith(expect.objectContaining({ message: 'tools.database.csvPasteOffer' }));
  });

  it('offers nothing without the database tool, or for prose', async () => {
    const without = createBlok(['paragraph']);
    const prose = createBlok(['paragraph', 'database', 'database-row']);

    await handler(without.blok).handle('Task\tPoints\nWrite\t3', { canReplaceCurrentBlock: true });
    await handler(prose.blok).handle('Hello\nthere', { canReplaceCurrentBlock: true });

    expect(without.show).not.toHaveBeenCalled();
    expect(prose.show).not.toHaveBeenCalled();
  });
});
