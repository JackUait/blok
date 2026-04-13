import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { Saver } from '../../../../src/components/modules/saver';
import type { Block } from '../../../../src/components/block';
import type { BlokConfig, SanitizerConfig } from '../../../../types';
import type { SavedData } from '../../../../types/data-formats';
import * as sanitizer from '../../../../src/components/utils/sanitizer';
import * as utils from '../../../../src/components/utils';

vi.mock('../../../../src/components/utils/id-generator', () => ({
  generateBlockId: vi.fn(() => 'mock-id'),
}));

type BlockSaveResult = SavedData & { tunes?: Record<string, unknown> };

interface BlockMock {
  block: Block;
  savedData: BlockSaveResult;
  saveMock: Mock<() => Promise<BlockSaveResult>>;
  validateMock: Mock<(data: BlockSaveResult['data']) => Promise<boolean>>;
}

interface BlockMockOptions {
  id: string;
  tool: string;
  data: SavedData['data'];
  tunes?: Record<string, unknown>;
  isValid?: boolean;
  parentId?: string | null;
  contentIds?: string[];
  lastEditedAt?: number;
  lastEditedBy?: string | null;
}

interface CreateSaverOptions {
  blocks?: Block[];
  sanitizer?: SanitizerConfig;
  stubTool?: string;
  toolSanitizeConfigs?: Record<string, SanitizerConfig>;
}

const createBlockMock = (options: BlockMockOptions): BlockMock => {
  const savedData: BlockSaveResult = {
    id: options.id,
    tool: options.tool,
    data: options.data,
    time: 0,
    ...(options.tunes ? { tunes: options.tunes } : {}),
  };

  const saveMock = vi.fn((): Promise<BlockSaveResult> => Promise.resolve(savedData));
  const validateMock = vi.fn((_data: BlockSaveResult['data']): Promise<boolean> => Promise.resolve(options.isValid ?? true));

  const block = {
    id: options.id,
    save: saveMock,
    validate: validateMock,
    parentId: options.parentId ?? null,
    contentIds: options.contentIds ?? [],
    lastEditedAt: options.lastEditedAt,
    lastEditedBy: options.lastEditedBy ?? null,
  } as unknown as Block;

  return {
    block,
    savedData,
    saveMock,
    validateMock,
  };
};

const createSaver = (options: CreateSaverOptions = {}): { saver: Saver } => {
  const config: BlokConfig = {
    sanitizer: options.sanitizer ?? ({} as SanitizerConfig),
  };

  const eventsDispatcher = {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as Saver['eventsDispatcher'];

  const saver = new Saver({
    config,
    eventsDispatcher,
  });

  const stubTool = options.stubTool ?? 'stub';
  const toolConfigs: Record<string, SanitizerConfig> = {
    ...(options.toolSanitizeConfigs ?? {}),
  };

  if (!toolConfigs[stubTool]) {
    toolConfigs[stubTool] = {} as SanitizerConfig;
  }

  const blockTools = new Map<string, { sanitizeConfig?: SanitizerConfig }>(
    Object.entries(toolConfigs).map(([name, sanitizeConfig]) => [name, { sanitizeConfig } ])
  );

  const blokState = {
    BlockManager: {
      blocks: options.blocks ?? [],
    },
    Tools: {
      blockTools,
      stubTool,
    },
  };

  (saver as unknown as { state: Saver['Blok'] }).state = blokState as unknown as Saver['Blok'];

  return { saver };
};

describe('Saver module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('saves valid blocks, sanitizes data, and preserves stub data', async () => {
    vi.useFakeTimers();
    const frozenDate = new Date('2024-05-01T10:00:00Z');

    vi.setSystemTime(frozenDate);

    const version = 'test-version';

    vi.spyOn(utils, 'getBlokVersion').mockReturnValue(version);

    const paragraphBlock = createBlockMock({
      id: 'block-1',
      tool: 'paragraph',
      data: { text: '<b>Hello</b>' },
      tunes: {
        alignment: 'left',
      },
    });

    const preservedData = {
      type: 'legacy-tool',
      data: { text: 'Keep me intact' },
    };

    const stubToolName = 'stub-tool';

    const stubBlock = createBlockMock({
      id: 'block-2',
      tool: stubToolName,
      data: preservedData,
    });

    const sanitizeBlocksSpy = vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks, getConfig, globalSanitizer) => {
      expect(typeof getConfig).toBe('function');

      if (typeof getConfig !== 'function') {
        throw new Error('Expected sanitize config resolver to be a function');
      }

      expect(getConfig('paragraph')).toEqual({ paragraph: { b: true } });
      expect(globalSanitizer).toEqual({ common: true });

      return blocks.map((block) => {
        if (block.tool === 'paragraph') {
          return {
            ...block,
            data: { text: 'Hello' },
          };
        }

        return block;
      });
    });

    const { saver } = createSaver({
      blocks: [paragraphBlock.block, stubBlock.block],
      sanitizer: { common: true },
      stubTool: stubToolName,
      toolSanitizeConfigs: {
        paragraph: { paragraph: { b: true } },
        [stubToolName]: {},
      },
    });

    const result = await saver.save();

    expect(paragraphBlock.saveMock).toHaveBeenCalledTimes(1);
    expect(paragraphBlock.validateMock).toHaveBeenCalledWith(paragraphBlock.savedData.data);
    expect(stubBlock.saveMock).toHaveBeenCalledTimes(1);
    expect(sanitizeBlocksSpy).toHaveBeenCalledTimes(1);

    const [ blocksBeforeSanitize ] = sanitizeBlocksSpy.mock.calls[0];

    expect(blocksBeforeSanitize).toEqual([
      expect.objectContaining({
        id: paragraphBlock.savedData.id,
        tool: 'paragraph',
        data: paragraphBlock.savedData.data,
        tunes: paragraphBlock.savedData.tunes,
        isValid: true,
      }),
      expect.objectContaining({
        id: stubBlock.savedData.id,
        tool: 'stub-tool',
        data: preservedData,
        isValid: true,
      }),
    ]);

    expect(result).toEqual({
      time: frozenDate.valueOf(),
      version,
      blocks: [
        {
          id: paragraphBlock.savedData.id,
          type: 'paragraph',
          data: { text: 'Hello' },
          tunes: paragraphBlock.savedData.tunes,
        },
        preservedData,
      ],
    });
  });

  it('skips invalid blocks and logs the reason', async () => {
    const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

    const invalidBlock = createBlockMock({
      id: 'invalid',
      tool: 'quote',
      data: { text: 'Invalid' },
      isValid: false,
    });

    const validBlock = createBlockMock({
      id: 'valid',
      tool: 'paragraph',
      data: { text: 'Valid' },
    });

    const sanitizeBlocksSpy = vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const { saver } = createSaver({
      blocks: [invalidBlock.block, validBlock.block],
      toolSanitizeConfigs: {
        quote: {},
        paragraph: {},
      },
    });

    const result = await saver.save();

    expect(result?.blocks).toEqual([
      {
        id: 'valid',
        type: 'paragraph',
        data: { text: 'Valid' },
      },
    ]);

    expect(sanitizeBlocksSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('Block «quote» skipped because saved data is invalid');
  });

  it('preserves invalid child blocks that have a parentId', async () => {
    const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const tableBlock = createBlockMock({
      id: 'table-1',
      tool: 'table',
      data: { content: [[{ blocks: ['cell-text', 'cell-empty'] }]] },
      contentIds: ['cell-text', 'cell-empty'],
    });

    const cellTextBlock = createBlockMock({
      id: 'cell-text',
      tool: 'paragraph',
      data: { text: 'Hello' },
      parentId: 'table-1',
    });

    const cellEmptyBlock = createBlockMock({
      id: 'cell-empty',
      tool: 'paragraph',
      data: { text: '' },
      isValid: false,
      parentId: 'table-1',
    });

    const { saver } = createSaver({
      blocks: [tableBlock.block, cellTextBlock.block, cellEmptyBlock.block],
      toolSanitizeConfigs: {
        table: {},
        paragraph: {},
      },
    });

    const result = await saver.save();

    // The empty paragraph with parentId should be preserved, not dropped
    const blockIds = result?.blocks.map(b => b.id);

    expect(blockIds).toContain('cell-empty');
    expect(result?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cell-empty',
          type: 'paragraph',
          data: { text: '' },
          parent: 'table-1',
        }),
      ])
    );

    // Invalid blocks WITHOUT a parent should still be skipped
    expect(logSpy).not.toHaveBeenCalledWith('Block «paragraph» skipped because saved data is invalid');
  });

  it('still skips invalid blocks that have no parentId', async () => {
    const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const invalidOrphanBlock = createBlockMock({
      id: 'orphan',
      tool: 'paragraph',
      data: { text: '' },
      isValid: false,
    });

    const validBlock = createBlockMock({
      id: 'valid',
      tool: 'paragraph',
      data: { text: 'Keep me' },
    });

    const { saver } = createSaver({
      blocks: [invalidOrphanBlock.block, validBlock.block],
      toolSanitizeConfigs: {
        paragraph: {},
      },
    });

    const result = await saver.save();

    const blockIds = result?.blocks.map(b => b.id);

    expect(blockIds).not.toContain('orphan');
    expect(blockIds).toContain('valid');
    expect(logSpy).toHaveBeenCalledWith('Block «paragraph» skipped because saved data is invalid');
  });

  it('preserves image blocks inside table cells when they have parentId', async () => {
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const tableBlock = createBlockMock({
      id: 'table-1',
      tool: 'table',
      data: { content: [[{ blocks: ['image-1', 'cell-1-1'] }]] },
      contentIds: ['image-1', 'cell-1-1'],
    });

    const imageBlock = createBlockMock({
      id: 'image-1',
      tool: 'image',
      data: { url: 'https://example.com/photo.jpg' },
      parentId: 'table-1',
    });

    const paragraphBlock = createBlockMock({
      id: 'cell-1-1',
      tool: 'paragraph',
      data: { text: 'Caption text' },
      parentId: 'table-1',
    });

    const { saver } = createSaver({
      blocks: [tableBlock.block, imageBlock.block, paragraphBlock.block],
      toolSanitizeConfigs: {
        table: {},
        image: {},
        paragraph: {},
      },
    });

    const result = await saver.save();

    const blockIds = result?.blocks.map(b => b.id);

    // Image block must be preserved — it has parentId pointing to the table
    expect(blockIds).toContain('image-1');
    expect(blockIds).toContain('cell-1-1');
    expect(blockIds).toContain('table-1');

    expect(result?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'image-1',
          type: 'image',
          data: { url: 'https://example.com/photo.jpg' },
          parent: 'table-1',
        }),
      ])
    );
  });

  it('logs a labeled error when saving fails', async () => {
    const error = new Error('save failed');
    const logLabeledSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);
    const sanitizeBlocksSpy = vi.spyOn(sanitizer, 'sanitizeBlocks');

    const failingBlock = {
      save: vi.fn().mockRejectedValue(error),
      validate: vi.fn(),
    } as unknown as Block;

    const { saver } = createSaver({
      blocks: [ failingBlock ],
      toolSanitizeConfigs: {
        paragraph: {},
      },
    });

    await expect(saver.save()).resolves.toBeUndefined();
    expect(logLabeledSpy).toHaveBeenCalledWith('Saving failed due to the Error %o', 'error', error);
    expect(sanitizeBlocksSpy).not.toHaveBeenCalled();
  });

  describe('block edit metadata in output', () => {
    it('should include lastEditedAt and lastEditedBy in output when present', async () => {
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

      const editedBlock = createBlockMock({
        id: 'edited-block',
        tool: 'paragraph',
        data: { text: 'Edited content' },
        lastEditedAt: 1700000000000,
        lastEditedBy: 'user-123',
      });

      const { saver } = createSaver({
        blocks: [editedBlock.block],
        toolSanitizeConfigs: {
          paragraph: {},
        },
      });

      const result = await saver.save();

      expect(result?.blocks).toEqual([
        expect.objectContaining({
          id: 'edited-block',
          type: 'paragraph',
          data: { text: 'Edited content' },
          lastEditedAt: 1700000000000,
          lastEditedBy: 'user-123',
        }),
      ]);
    });

    it('should omit lastEditedAt and lastEditedBy from output when not present', async () => {
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

      const plainBlock = createBlockMock({
        id: 'plain-block',
        tool: 'paragraph',
        data: { text: 'Plain content' },
      });

      const { saver } = createSaver({
        blocks: [plainBlock.block],
        toolSanitizeConfigs: {
          paragraph: {},
        },
      });

      const result = await saver.save();

      const outputBlock = result?.blocks[0];

      expect(outputBlock).toBeDefined();
      expect(outputBlock).not.toHaveProperty('lastEditedAt');
      expect(outputBlock).not.toHaveProperty('lastEditedBy');
    });
  });

  it('normalizes inline images in table cell paragraphs during save', async () => {
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const { generateBlockId } = await import('../../../../src/components/utils/id-generator');
    vi.mocked(generateBlockId).mockReturnValue('img-norm-1');

    const tableBlock = createBlockMock({
      id: 'table-1',
      tool: 'table',
      data: { content: [[{ blocks: ['para-1'] }]] },
      contentIds: ['para-1'],
    });

    const paragraphBlock = createBlockMock({
      id: 'para-1',
      tool: 'paragraph',
      data: { text: '<p><img src="https://example.com/photo.jpg" style="width: 100%;"><br></p>' },
      parentId: 'table-1',
    });

    const { saver } = createSaver({
      blocks: [tableBlock.block, paragraphBlock.block],
      toolSanitizeConfigs: {
        table: {},
        paragraph: {},
        image: {},
      },
    });

    const result = await saver.save();

    // Should contain 3 blocks: table, image, paragraph
    expect(result?.blocks).toHaveLength(3);

    // Image block should be extracted
    const imageOutputBlock = result?.blocks.find(b => b.type === 'image');
    expect(imageOutputBlock).toEqual(expect.objectContaining({
      id: 'img-norm-1',
      type: 'image',
      data: { url: 'https://example.com/photo.jpg' },
      parent: 'table-1',
    }));

    // Paragraph should no longer contain <img>
    const paraOutputBlock = result?.blocks.find(b => b.id === 'para-1');
    expect((paraOutputBlock?.data as { text: string }).text).not.toContain('<img');

    // Table cell content should reference the new image block before the paragraph
    const tableOutputBlock = result?.blocks.find(b => b.id === 'table-1');
    const cellBlocks = (tableOutputBlock?.data as { content: Array<Array<{ blocks: string[] }>> }).content[0][0].blocks;
    expect(cellBlocks[0]).toBe('img-norm-1');
    expect(cellBlocks[1]).toBe('para-1');

    // Table content field should include new image block ID
    expect(tableOutputBlock?.content).toContain('img-norm-1');
  });

  it('derives callout content[] from children parentId when contentIds is stale', async () => {
    // Regression: pasting content into a callout could leave parent.contentIds
    // out of sync with child.parentId, causing collapseToLegacy to eject the
    // child from the callout body on the next round-trip. Saver must be the
    // single source of truth for content[] and derive it from the live block
    // list so the invariant "child.parentId ⇒ parent.content.includes(child)"
    // always holds in the output JSON.
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const callout = createBlockMock({
      id: 'cal1',
      tool: 'callout',
      data: { emoji: '💡', textColor: null, backgroundColor: null },
      // Stale contentIds — missing the child that was added via paste
      contentIds: [],
    });

    const header = createBlockMock({
      id: 'hdr1',
      tool: 'header',
      data: { text: 'Исключения', level: 4 },
      parentId: 'cal1',
    });

    const pastedParagraph = createBlockMock({
      id: 'p-pasted',
      tool: 'paragraph',
      data: { text: '1. Item' },
      parentId: 'cal1',
    });

    const { saver } = createSaver({
      blocks: [callout.block, header.block, pastedParagraph.block],
      toolSanitizeConfigs: {
        callout: {},
        header: {},
        paragraph: {},
      },
    });

    const result = await saver.save();
    const calloutOut = result?.blocks.find(b => b.id === 'cal1');

    expect(calloutOut?.content).toEqual(['hdr1', 'p-pasted']);
  });

  it('derives content[] in blocks-array order even when contentIds is reversed', async () => {
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const callout = createBlockMock({
      id: 'cal1',
      tool: 'callout',
      data: { emoji: '💡', textColor: null, backgroundColor: null },
      // Stale AND reversed — must be overridden by blocks-array order
      contentIds: ['p3', 'p2', 'p1'],
    });

    const p1 = createBlockMock({ id: 'p1', tool: 'paragraph', data: { text: 'one' },   parentId: 'cal1' });
    const p2 = createBlockMock({ id: 'p2', tool: 'paragraph', data: { text: 'two' },   parentId: 'cal1' });
    const p3 = createBlockMock({ id: 'p3', tool: 'paragraph', data: { text: 'three' }, parentId: 'cal1' });

    const { saver } = createSaver({
      blocks: [callout.block, p1.block, p2.block, p3.block],
      toolSanitizeConfigs: { callout: {}, paragraph: {} },
    });

    const result = await saver.save();

    expect(result?.blocks.find(b => b.id === 'cal1')?.content).toEqual(['p1', 'p2', 'p3']);
  });

  it('drops dead ids from contentIds when children do not exist in blocks array', async () => {
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const callout = createBlockMock({
      id: 'cal1',
      tool: 'callout',
      data: { emoji: '💡', textColor: null, backgroundColor: null },
      // Dead id "ghost" no longer exists — must be dropped
      contentIds: ['ghost', 'p1'],
    });

    const p1 = createBlockMock({ id: 'p1', tool: 'paragraph', data: { text: 'real' }, parentId: 'cal1' });

    const { saver } = createSaver({
      blocks: [callout.block, p1.block],
      toolSanitizeConfigs: { callout: {}, paragraph: {} },
    });

    const result = await saver.save();
    const calloutOut = result?.blocks.find(b => b.id === 'cal1');

    expect(calloutOut?.content).toEqual(['p1']);
    expect(calloutOut?.content).not.toContain('ghost');
  });

  it('keeps drift isolated per callout when multiple callouts coexist', async () => {
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const cal1 = createBlockMock({
      id: 'cal1',
      tool: 'callout',
      data: { emoji: '💡', textColor: null, backgroundColor: null },
      contentIds: [],
    });
    const cal2 = createBlockMock({
      id: 'cal2',
      tool: 'callout',
      data: { emoji: '⚠️', textColor: null, backgroundColor: null },
      contentIds: [],
    });

    const a1 = createBlockMock({ id: 'a1', tool: 'paragraph', data: { text: 'A1' }, parentId: 'cal1' });
    const a2 = createBlockMock({ id: 'a2', tool: 'paragraph', data: { text: 'A2' }, parentId: 'cal1' });
    const b1 = createBlockMock({ id: 'b1', tool: 'paragraph', data: { text: 'B1' }, parentId: 'cal2' });

    const { saver } = createSaver({
      blocks: [cal1.block, a1.block, a2.block, cal2.block, b1.block],
      toolSanitizeConfigs: { callout: {}, paragraph: {} },
    });

    const result = await saver.save();

    expect(result?.blocks.find(b => b.id === 'cal1')?.content).toEqual(['a1', 'a2']);
    expect(result?.blocks.find(b => b.id === 'cal2')?.content).toEqual(['b1']);
  });

  it('derives root-toggle content[] from children parentId when contentIds is stale', async () => {
    // Saver reconciliation must be generic for every container, not just callout.
    // Pasting into a toggle body leaves toggle.contentIds stale the same way it
    // does for callout; if saver only covers callout the bug recurs on toggle.
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const toggle = createBlockMock({
      id: 'tog1',
      tool: 'toggle',
      data: { text: 'Group', isOpen: true },
      contentIds: [],
    });
    const p1 = createBlockMock({ id: 'p1', tool: 'paragraph', data: { text: 'one' }, parentId: 'tog1' });
    const p2 = createBlockMock({ id: 'p2', tool: 'paragraph', data: { text: 'two' }, parentId: 'tog1' });

    const { saver } = createSaver({
      blocks: [toggle.block, p1.block, p2.block],
      toolSanitizeConfigs: { toggle: {}, paragraph: {} },
    });

    const result = await saver.save();

    expect(result?.blocks.find(b => b.id === 'tog1')?.content).toEqual(['p1', 'p2']);
  });

  it('derives toggleable-header content[] from children parentId when contentIds is stale', async () => {
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const header = createBlockMock({
      id: 'h1',
      tool: 'header',
      data: { text: 'Section', level: 2, isToggleable: true, isOpen: true },
      contentIds: [],
    });
    const p1 = createBlockMock({ id: 'p1', tool: 'paragraph', data: { text: 'a' }, parentId: 'h1' });
    const p2 = createBlockMock({ id: 'p2', tool: 'paragraph', data: { text: 'b' }, parentId: 'h1' });

    const { saver } = createSaver({
      blocks: [header.block, p1.block, p2.block],
      toolSanitizeConfigs: { header: {}, paragraph: {} },
    });

    const result = await saver.save();

    expect(result?.blocks.find(b => b.id === 'h1')?.content).toEqual(['p1', 'p2']);
  });

  it('derives nested-list content[] from children parentId when contentIds is stale', async () => {
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const root = createBlockMock({
      id: 'l1',
      tool: 'list',
      data: { style: 'unordered', text: 'root' },
      contentIds: [],
    });
    const child1 = createBlockMock({
      id: 'l2',
      tool: 'list',
      data: { style: 'unordered', text: 'child one' },
      parentId: 'l1',
    });
    const child2 = createBlockMock({
      id: 'l3',
      tool: 'list',
      data: { style: 'unordered', text: 'child two' },
      parentId: 'l1',
    });

    const { saver } = createSaver({
      blocks: [root.block, child1.block, child2.block],
      toolSanitizeConfigs: { list: {} },
    });

    const result = await saver.save();

    expect(result?.blocks.find(b => b.id === 'l1')?.content).toEqual(['l2', 'l3']);
  });

  it('derives content[] through a two-level callout→toggle→paragraph chain', async () => {
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

    const callout = createBlockMock({
      id: 'cal1',
      tool: 'callout',
      data: { emoji: '💡', textColor: null, backgroundColor: null },
      contentIds: [],
    });
    const toggle = createBlockMock({
      id: 'tog1',
      tool: 'toggle',
      data: { text: 'Toggle title', status: 'open' },
      parentId: 'cal1',
      contentIds: [],
    });
    const leaf = createBlockMock({
      id: 'leaf',
      tool: 'paragraph',
      data: { text: 'deep child' },
      parentId: 'tog1',
    });

    const { saver } = createSaver({
      blocks: [callout.block, toggle.block, leaf.block],
      toolSanitizeConfigs: { callout: {}, toggle: {}, paragraph: {} },
    });

    const result = await saver.save();

    expect(result?.blocks.find(b => b.id === 'cal1')?.content).toEqual(['tog1']);
    expect(result?.blocks.find(b => b.id === 'tog1')?.content).toEqual(['leaf']);
  });
});

