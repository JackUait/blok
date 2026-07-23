import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { Saver } from '../../../../src/components/modules/saver';
import { SaveFailed } from '../../../../src/components/events';
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
  /**
   * Optional live DOM holder — required only by tests exercising the
   * WYSIWYG order guard (flat-array vs DOM order of container children).
   */
  holder?: HTMLElement;
  /**
   * Drives the single-empty-default-block short-circuit. Both default to the
   * values that keep a block in the output.
   */
  isEmpty?: boolean;
  isDefault?: boolean;
}

interface CreateSaverOptions {
  blocks?: Block[];
  sanitizer?: SanitizerConfig;
  stubTool?: string;
  toolSanitizeConfigs?: Record<string, SanitizerConfig>;
  onError?: BlokConfig['onError'];
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
    name: options.tool,
    save: saveMock,
    validate: validateMock,
    parentId: options.parentId ?? null,
    contentIds: options.contentIds ?? [],
    lastEditedAt: options.lastEditedAt,
    lastEditedBy: options.lastEditedBy ?? null,
    isEmpty: options.isEmpty ?? false,
    tool: { isDefault: options.isDefault ?? false },
    ...(options.holder !== undefined ? { holder: options.holder } : {}),
  } as unknown as Block;

  return {
    block,
    savedData,
    saveMock,
    validateMock,
  };
};

const createSaver = (options: CreateSaverOptions = {}): { saver: Saver; eventsDispatcher: Saver['eventsDispatcher'] } => {
  const config: BlokConfig = {
    sanitizer: options.sanitizer ?? ({}),
    ...(options.onError ? { onError: options.onError } : {}),
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
    toolConfigs[stubTool] = {};
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

  return { saver, eventsDispatcher };
};

describe('Saver module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reports a save failure via config.onError and the SaveFailed event, and still returns undefined', async () => {
    const boom = new Error('serialization boom');
    const failing = createBlockMock({ id: 'block-1', tool: 'paragraph', data: { text: 'x' } });

    failing.saveMock.mockRejectedValue(boom);

    const onError = vi.fn();
    const { saver, eventsDispatcher } = createSaver({ blocks: [failing.block], onError });

    const result = await saver.save();

    expect(result).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(boom, { source: 'save' });
    expect(eventsDispatcher.emit).toHaveBeenCalledWith(SaveFailed, { error: boom });
  });

  it('does not call config.onError or emit SaveFailed on a successful save', async () => {
    const onError = vi.fn();
    const block = createBlockMock({ id: 'block-1', tool: 'paragraph', data: { text: 'x' } });
    const { saver, eventsDispatcher } = createSaver({ blocks: [block.block], onError });

    await saver.save();

    expect(onError).not.toHaveBeenCalled();
    expect(eventsDispatcher.emit).not.toHaveBeenCalledWith(SaveFailed, expect.anything());
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

  it('returns an empty blocks array for a single empty default block', async () => {
    const emptyBlock = createBlockMock({
      id: 'block-1',
      tool: 'paragraph',
      data: { text: '' },
      isEmpty: true,
      isDefault: true,
    });

    const { saver } = createSaver({ blocks: [emptyBlock.block] });

    const result = await saver.save();

    expect(result?.blocks).toEqual([]);
  });

  it('keeps a single default block whose text is only a slash', async () => {
    const slashBlock = createBlockMock({
      id: 'block-1',
      tool: 'paragraph',
      data: { text: '/' },
      isEmpty: false,
      isDefault: true,
    });

    const { saver } = createSaver({ blocks: [slashBlock.block] });

    const result = await saver.save();

    expect(result?.blocks).toHaveLength(1);
    expect(result?.blocks[0]).toEqual(expect.objectContaining({ data: { text: '/' } }));
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

  it('promotes a dangling-parent block to root in output WITHOUT mutating the live block', async () => {
    // Regression: save() is a read path and must not mutate the live block
    // model. The dangling-parentId repair previously did `block.parentId = null`
    // on the live Block, diverging the in-memory model from the Yjs source of
    // truth (the repair never reached Yjs, and a later observe could re-apply
    // the stale value). The output must still promote the orphan to root.
    vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
    vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

    const danglingBlock = createBlockMock({
      id: 'orphan-1',
      tool: 'paragraph',
      data: { text: 'orphan' },
      parentId: 'ghost-parent', // parent id not present in the blocks array
    });

    const rootBlock = createBlockMock({
      id: 'root-1',
      tool: 'paragraph',
      data: { text: 'root' },
    });

    const { saver } = createSaver({
      blocks: [danglingBlock.block, rootBlock.block],
      toolSanitizeConfigs: { paragraph: {} },
    });

    const result = await saver.save();

    // Output ships the orphan at root level — no dangling `parent` reference.
    const orphanOut = result?.blocks.find(b => b.id === 'orphan-1');

    expect(orphanOut).toBeDefined();
    expect(orphanOut?.parent).toBeUndefined();

    // The live block model is untouched by the (read-only) save.
    expect(danglingBlock.block.parentId).toBe('ghost-parent');
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

  describe('dangling parentId repair pass', () => {
    // Regression: even after a6fa892e closed the three mutation paths that
    // introduced dangling parent refs, a belt-and-braces save-time repair
    // guarantees the saver is physically incapable of emitting output where
    // block.parent points at an id that does not exist in the blocks array.
    // If drift somehow reaches this point, the orphan is promoted to root
    // (parent cleared) — strictly better than shipping corrupted JSON.
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('promotes orphan to root in output without throwing and without mutating the live block', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      const logLabeledSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const rootA = createBlockMock({
        id: 'A',
        tool: 'paragraph',
        data: { text: 'root A' },
      });

      const orphanB = createBlockMock({
        id: 'B',
        tool: 'paragraph',
        data: { text: 'orphan B' },
        // parentId points at a block that does not exist in the blocks array
        parentId: 'missing-block-id',
      });

      const { saver } = createSaver({
        blocks: [rootA.block, orphanB.block],
        toolSanitizeConfigs: { paragraph: {} },
      });

      const result = await saver.save();

      // Save must succeed — no hierarchy violation should be thrown because
      // the orphan is treated as root for output purposes before validation.
      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result).toBeDefined();

      const blockIds = result?.blocks.map(b => b.id);

      expect(blockIds).toContain('A');
      expect(blockIds).toContain('B');

      const outputB = result?.blocks.find(b => b.id === 'B');

      // B must NOT carry a parent field — it was promoted to root in OUTPUT
      expect(outputB).toBeDefined();
      expect(outputB).not.toHaveProperty('parent');

      // save() is read-only: the live block's parentId must be left untouched
      // (mutating it diverges the in-memory model from the Yjs source of truth).
      expect(orphanB.block.parentId).toBe('missing-block-id');

      // The save still logs one warning about the dangling ref it routed around
      expect(logLabeledSpy).toHaveBeenCalledWith(
        expect.stringMatching(/dangling parentId missing-block-id on block B/),
        'warn'
      );
    });
  });

  describe('hierarchy drift assertion gate (NODE_ENV)', () => {
    // The dangling-parentId handling promotes any orphan to root in OUTPUT, so
    // a parent referencing a non-existent id can never reach the gate. To still
    // exercise the NODE_ENV gate, induce a STRUCTURAL drift the repair does not
    // cover: an invalid parent with no parentId of its own is dropped from
    // output by makeOutput (invalid + no parent → skipped), orphaning its valid
    // child whose `parent` now points at a block missing from the output —
    // exactly the child-parent-missing violation validateHierarchy catches.
    const driftingBlocks = (): Block[] => {
      const droppedParent = createBlockMock({
        id: 'ghost-parent',
        tool: 'paragraph',
        data: { text: '' },
        isValid: false, // invalid + no parentId → skipped by makeOutput
      });

      const child = createBlockMock({
        id: 'orphan-child',
        tool: 'paragraph',
        data: { text: 'ejected from nowhere' },
        parentId: 'ghost-parent', // resolves at snapshot, but parent is dropped
      });

      return [droppedParent.block, child.block];
    };

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('throws on drift when NODE_ENV=development', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

      const { saver } = createSaver({
        blocks: driftingBlocks(),
        toolSanitizeConfigs: { paragraph: {} },
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(saver.getLastSaveError()).toBeInstanceOf(Error);
      expect((saver.getLastSaveError() as Error).message).toMatch(/hierarchy drift/);
    });

    it('throws on drift when NODE_ENV=test', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);

      const { saver } = createSaver({
        blocks: driftingBlocks(),
        toolSanitizeConfigs: { paragraph: {} },
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(saver.getLastSaveError()).toBeInstanceOf(Error);
      expect((saver.getLastSaveError() as Error).message).toMatch(/hierarchy drift/);
    });

    it('only logs on drift when NODE_ENV=production so user saves never break', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      const logLabeledSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { saver } = createSaver({
        blocks: driftingBlocks(),
        toolSanitizeConfigs: { paragraph: {} },
      });

      const result = await saver.save();

      expect(result).toBeDefined();
      expect(result?.blocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: 'orphan-child', parent: 'ghost-parent' }),
        ])
      );
      expect(saver.getLastSaveError()).toBeUndefined();
      expect(logLabeledSpy).toHaveBeenCalledWith(expect.stringMatching(/hierarchy drift/), 'error');
    });

    it('repairs dangling parentId before the gate so no drift is thrown', async () => {
      // The classic fixture (orphan.parentId = 'ghost-parent') now flows through
      // the pre-validation repair pass. In dev/test the gate would previously
      // have thrown; now the ref is cleared, the orphan is promoted to root,
      // and save succeeds cleanly.
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const orphan = createBlockMock({
        id: 'orphan-child',
        tool: 'paragraph',
        data: { text: 'ejected from nowhere' },
        parentId: 'ghost-parent',
      });

      const { saver } = createSaver({
        blocks: [orphan.block],
        toolSanitizeConfigs: { paragraph: {} },
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks).toHaveLength(1);
      expect(result?.blocks[0]).not.toHaveProperty('parent');
    });
  });

  describe('WYSIWYG order guard (flat-array vs DOM order of container children)', () => {
    // Regression family: "the image saved right under the column title moved
    // to the very bottom of the column after saving". Root cause was a code
    // path (plus-button raw DOM hoist) that moved a block's holder in the DOM
    // without moving its flat-array position — the editor displayed one order,
    // the Saver (which derives each parent's content[] from the flat array)
    // emitted another. This guard makes the saver the last line of defense:
    // dev/test saves THROW on such divergence so any future path that desyncs
    // DOM from the model is caught in CI; production saves repair the output
    // to the DOM order (what the user actually saw) and log an error.

    /**
     * Builds a column with three children whose FLAT order is
     * [heading, body, image] but whose DOM order inside the column's
     * container is [heading, image, body] — the reported bug's shape.
     */
    const divergentColumnBlocks = (): { blocks: Block[]; cleanup: () => void } => {
      const columnHolder = document.createElement('div');
      const container = document.createElement('div');

      columnHolder.appendChild(container);
      document.body.appendChild(columnHolder);

      const headingHolder = document.createElement('div');
      const imageHolder = document.createElement('div');
      const bodyHolder = document.createElement('div');

      // DOM (what the user sees): heading, image, body.
      container.append(headingHolder, imageHolder, bodyHolder);

      const column = createBlockMock({
        id: 'col1',
        tool: 'column',
        data: {},
        contentIds: ['h1', 'body1', 'img1'],
        holder: columnHolder,
      });
      const heading = createBlockMock({
        id: 'h1',
        tool: 'header',
        data: { text: 'Title' },
        parentId: 'col1',
        holder: headingHolder,
      });
      const body = createBlockMock({
        id: 'body1',
        tool: 'paragraph',
        data: { text: 'Body' },
        parentId: 'col1',
        holder: bodyHolder,
      });
      const image = createBlockMock({
        id: 'img1',
        tool: 'image',
        data: { url: 'https://example.com/x.png' },
        parentId: 'col1',
        holder: imageHolder,
      });

      return {
        // FLAT order (what a buggy path left behind): heading, body, image.
        blocks: [column.block, heading.block, body.block, image.block],
        cleanup: () => columnHolder.remove(),
      };
    };

    afterEach(() => {
      vi.unstubAllEnvs();
      document.body.innerHTML = '';
    });

    it('throws in test env when a column child\'s DOM order diverges from its flat-array order', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = divergentColumnBlocks();
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, header: {}, image: {}, column: {} },
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(saver.getLastSaveError()).toBeInstanceOf(Error);
      expect((saver.getLastSaveError() as Error).message).toMatch(/DOM order/);

      cleanup();
    });

    it('repairs the output to the DOM order (WYSIWYG) in production and logs an error', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      const logLabeledSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = divergentColumnBlocks();
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, header: {}, image: {}, column: {} },
      });

      const result = await saver.save();

      expect(result).toBeDefined();
      expect(saver.getLastSaveError()).toBeUndefined();

      // The emitted content[] follows what the user SAW: heading, image, body.
      const column = result?.blocks.find(b => b.id === 'col1');

      expect(column?.content).toEqual(['h1', 'img1', 'body1']);

      // The output ARRAY order matches too (the renderer mounts children by
      // array order, so content[] alone is not enough).
      const childIdsInArrayOrder = result?.blocks
        .filter(b => b.parent === 'col1')
        .map(b => b.id);

      expect(childIdsInArrayOrder).toEqual(['h1', 'img1', 'body1']);

      expect(logLabeledSpy).toHaveBeenCalledWith(expect.stringMatching(/DOM order/), 'error');

      cleanup();
    });

    it('does not interfere when flat order and DOM order agree', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      const logLabeledSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const columnHolder = document.createElement('div');
      const container = document.createElement('div');

      columnHolder.appendChild(container);
      document.body.appendChild(columnHolder);

      const headingHolder = document.createElement('div');
      const bodyHolder = document.createElement('div');

      container.append(headingHolder, bodyHolder);

      const column = createBlockMock({
        id: 'col1',
        tool: 'column',
        data: {},
        contentIds: ['h1', 'body1'],
        holder: columnHolder,
      });
      const heading = createBlockMock({
        id: 'h1',
        tool: 'header',
        data: { text: 'Title' },
        parentId: 'col1',
        holder: headingHolder,
      });
      const body = createBlockMock({
        id: 'body1',
        tool: 'paragraph',
        data: { text: 'Body' },
        parentId: 'col1',
        holder: bodyHolder,
      });

      const { saver } = createSaver({
        blocks: [column.block, heading.block, body.block],
        toolSanitizeConfigs: { paragraph: {}, header: {}, column: {} },
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks.find(b => b.id === 'col1')?.content).toEqual(['h1', 'body1']);
      expect(logLabeledSpy).not.toHaveBeenCalledWith(expect.stringMatching(/DOM order/), 'error');

      columnHolder.remove();
    });

    it('skips self-managing containers whose DOM order legitimately diverges (database views)', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const dbHolder = document.createElement('div');
      const container = document.createElement('div');

      dbHolder.appendChild(container);
      document.body.appendChild(dbHolder);

      const rowAHolder = document.createElement('div');
      const rowBHolder = document.createElement('div');

      // DOM shows B before A (e.g. a board view grouped by status).
      container.append(rowBHolder, rowAHolder);

      const database = createBlockMock({
        id: 'db1',
        tool: 'database',
        data: {},
        contentIds: ['rowA', 'rowB'],
        holder: dbHolder,
      });
      const rowA = createBlockMock({
        id: 'rowA',
        tool: 'database-row',
        data: {},
        parentId: 'db1',
        holder: rowAHolder,
      });
      const rowB = createBlockMock({
        id: 'rowB',
        tool: 'database-row',
        data: {},
        parentId: 'db1',
        holder: rowBHolder,
      });

      const { saver } = createSaver({
        blocks: [database.block, rowA.block, rowB.block],
        toolSanitizeConfigs: { database: {}, 'database-row': {} },
      });

      const result = await saver.save();

      // No throw, no reorder: the database's flat order is authoritative.
      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks.find(b => b.id === 'db1')?.content).toEqual(['rowA', 'rowB']);

      dbHolder.remove();
    });
  });

  describe('table view-reference guard (children vs data.content grid)', () => {
    // Regression family: "Cmd+Z in a table, then save → the table's text
    // reappears line-by-line under the table". A rebuild path duplicated cell
    // blocks and left the originals parented to the table but unreferenced by
    // any grid cell — invisible in the editor, but emitted by the Saver and
    // rendered below the table after a save → re-render round trip. This guard
    // makes the saver the last line of defense for the WHOLE class: dev/test
    // saves THROW when a table's children diverge from its grid references;
    // production saves repair the output to what the user actually saw.

    type TableFixtureOptions = {
      /** Extra child of the table that no grid cell references. */
      ghost?: { id: string; connected: boolean };
      /** Grid cell reference pointing at a block that does not exist. */
      danglingRef?: string;
      /** Use legacy string cells instead of blocks-format cells. */
      legacyCells?: boolean;
    };

    const tableFixture = (options: TableFixtureOptions = {}): { blocks: Block[]; cleanup: () => void } => {
      const tableHolder = document.createElement('div');
      const cellContainerA = document.createElement('div');
      const cellContainerB = document.createElement('div');

      tableHolder.append(cellContainerA, cellContainerB);
      document.body.appendChild(tableHolder);

      const cellAHolder = document.createElement('div');
      const cellBHolder = document.createElement('div');

      cellContainerA.appendChild(cellAHolder);
      cellContainerB.appendChild(cellBHolder);

      const cellARefs = ['cellA', ...(options.danglingRef !== undefined ? [options.danglingRef] : [])];
      const content = options.legacyCells === true
        ? [['Alpha', 'Beta']]
        : [[{ blocks: cellARefs }, { blocks: ['cellB'] }]];

      const contentIds = ['cellA', 'cellB', ...(options.ghost !== undefined ? [options.ghost.id] : [])];

      const table = createBlockMock({
        id: 'tbl1',
        tool: 'table',
        data: { withHeadings: false, content },
        contentIds,
        holder: tableHolder,
      });
      const cellA = createBlockMock({
        id: 'cellA',
        tool: 'paragraph',
        data: { text: 'Alpha' },
        parentId: 'tbl1',
        holder: cellAHolder,
      });
      const cellB = createBlockMock({
        id: 'cellB',
        tool: 'paragraph',
        data: { text: 'Beta' },
        parentId: 'tbl1',
        holder: cellBHolder,
      });

      const blocks = [table.block, cellA.block, cellB.block];

      if (options.ghost !== undefined) {
        const ghostHolder = document.createElement('div');

        if (options.ghost.connected) {
          document.body.appendChild(ghostHolder);
        }

        const ghost = createBlockMock({
          id: options.ghost.id,
          tool: 'paragraph',
          data: { text: 'GHOST' },
          parentId: 'tbl1',
          holder: ghostHolder,
        });

        blocks.push(ghost.block);
      }

      return {
        blocks,
        cleanup: () => {
          document.body.innerHTML = '';
        },
      };
    };

    afterEach(() => {
      vi.unstubAllEnvs();
      document.body.innerHTML = '';
    });

    it('throws in test env when a table child is not referenced by any grid cell', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = tableFixture({ ghost: { id: 'ghost1', connected: false } });
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, table: {} },
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(saver.getLastSaveError()).toBeInstanceOf(Error);
      expect((saver.getLastSaveError() as Error).message).toMatch(/not referenced by any cell/);
      expect((saver.getLastSaveError() as Error).message).toContain('ghost1');

      cleanup();
    });

    it('throws in test env when a grid cell references a block missing from the document', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = tableFixture({ danglingRef: 'no-such-block' });
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, table: {} },
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(saver.getLastSaveError()).toBeInstanceOf(Error);
      expect((saver.getLastSaveError() as Error).message).toMatch(/references missing block/);
      expect((saver.getLastSaveError() as Error).message).toContain('no-such-block');

      cleanup();
    });

    it('production: prunes an invisible (disconnected) orphan child from the output', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      const logLabeledSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = tableFixture({ ghost: { id: 'ghost1', connected: false } });
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, table: {} },
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks.find(b => b.id === 'ghost1')).toBeUndefined();
      expect(result?.blocks.find(b => b.id === 'tbl1')?.content).toEqual(['cellA', 'cellB']);
      expect(logLabeledSpy).toHaveBeenCalledWith(expect.stringMatching(/not referenced by any cell/), 'error');

      cleanup();
    });

    it('production: promotes a visible (connected) orphan child to root in the output', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = tableFixture({ ghost: { id: 'ghost1', connected: true } });
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, table: {} },
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();

      const ghost = result?.blocks.find(b => b.id === 'ghost1');

      expect(ghost).toBeDefined();
      expect(ghost).not.toHaveProperty('parent');
      expect(result?.blocks.find(b => b.id === 'tbl1')?.content).toEqual(['cellA', 'cellB']);

      cleanup();
    });

    it('production: prunes a dangling grid reference from the emitted table data', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = tableFixture({ danglingRef: 'no-such-block' });
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, table: {} },
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();

      const tableData = result?.blocks.find(b => b.id === 'tbl1')?.data as {
        content: Array<Array<{ blocks: string[] }>>;
      };

      expect(tableData.content[0][0].blocks).toEqual(['cellA']);
      expect(tableData.content[0][1].blocks).toEqual(['cellB']);

      cleanup();
    });

    it('does not throw for a consistent table', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = tableFixture();
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, table: {} },
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks.map(b => b.id)).toEqual(['tbl1', 'cellA', 'cellB']);

      cleanup();
    });

    it('skips the check for legacy string-cell tables (no block references to validate)', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = tableFixture({
        legacyCells: true,
        ghost: { id: 'ghost1', connected: true },
      });
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, table: {} },
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks.find(b => b.id === 'ghost1')).toBeDefined();

      cleanup();
    });
  });

  describe('table cell order guard (cell.blocks vs DOM order inside the cell)', () => {
    // Regression family: "images inserted at the top of a table cell moved to
    // the bottom of the cell after saving". The table keeps its own per-cell
    // block-id lists (data.content[row][col].blocks) which the flat-order
    // WYSIWYG guard cannot see (tables are DOM_ORDER_EXEMPT). Table.save()
    // repairs divergence itself, but silently — so a future regression there
    // would ship unnoticed. This guard is the independent save-boundary
    // backstop: dev/test saves THROW when a cell's saved order diverges from
    // the visible DOM order of its mounted holders; production saves repair
    // the emitted table data to what the user actually saw.

    type CellOrderFixtureOptions = {
      /** Saved cell.blocks order (default: reversed vs DOM). */
      savedOrder?: string[];
      /** Ids whose holders are NOT mounted in the cell container. */
      unmounted?: string[];
    };

    const cellOrderFixture = (options: CellOrderFixtureOptions = {}): { blocks: Block[]; cleanup: () => void } => {
      const tableHolder = document.createElement('div');
      const cellContainer = document.createElement('div');

      cellContainer.setAttribute('data-blok-table-cell-blocks', '');
      tableHolder.appendChild(cellContainer);
      document.body.appendChild(tableHolder);

      const ids = ['b1', 'b2', 'b3'];
      const unmounted = new Set(options.unmounted ?? []);
      const holders = new Map<string, HTMLElement>();

      // DOM order is b1, b2, b3 — the order the user sees.
      for (const id of ids) {
        const holder = document.createElement('div');

        holder.setAttribute('data-blok-id', id);

        if (!unmounted.has(id)) {
          cellContainer.appendChild(holder);
        }

        holders.set(id, holder);
      }

      const savedOrder = options.savedOrder ?? ['b3', 'b1', 'b2'];

      const table = createBlockMock({
        id: 'tbl1',
        tool: 'table',
        data: { withHeadings: false, content: [[{ blocks: savedOrder }]] },
        contentIds: ids,
        holder: tableHolder,
      });

      const blocks = [
        table.block,
        ...ids.map(id => createBlockMock({
          id,
          tool: 'paragraph',
          data: { text: id },
          parentId: 'tbl1',
          holder: holders.get(id),
        }).block),
      ];

      return {
        blocks,
        cleanup: () => {
          document.body.innerHTML = '';
        },
      };
    };

    afterEach(() => {
      vi.unstubAllEnvs();
      document.body.innerHTML = '';
    });

    it('throws in test env when a cell\'s saved block order diverges from the DOM order', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = cellOrderFixture();
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, table: {} },
      });

      await expect(saver.save()).resolves.toBeUndefined();
      expect(saver.getLastSaveError()).toBeInstanceOf(Error);
      expect((saver.getLastSaveError() as Error).message).toMatch(/cell.*order|order.*cell/i);
      expect((saver.getLastSaveError() as Error).message).toContain('tbl1');

      cleanup();
    });

    it('production: repairs the emitted cell order to the DOM order (WYSIWYG) and logs an error', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      const logLabeledSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = cellOrderFixture();
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, table: {} },
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();

      const tableData = result?.blocks.find(b => b.id === 'tbl1')?.data as {
        content: Array<Array<{ blocks: string[] }>>;
      };

      expect(tableData.content[0][0].blocks).toEqual(['b1', 'b2', 'b3']);
      expect(logLabeledSpy).toHaveBeenCalledWith(expect.stringMatching(/cell.*order|order.*cell/i), 'error');

      cleanup();
    });

    it('does not throw when the saved cell order matches the DOM order', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = cellOrderFixture({ savedOrder: ['b1', 'b2', 'b3'] });
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, table: {} },
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();
      expect(result?.blocks.map(b => b.id)).toEqual(['tbl1', 'b1', 'b2', 'b3']);

      cleanup();
    });

    it('skips cells with an unmounted holder (transitional state) and keeps the model order', async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.spyOn(sanitizer, 'sanitizeBlocks').mockImplementation((blocks) => blocks);
      vi.spyOn(utils, 'logLabeled').mockImplementation(() => undefined);

      const { blocks, cleanup } = cellOrderFixture({ unmounted: ['b3'] });
      const { saver } = createSaver({
        blocks,
        toolSanitizeConfigs: { paragraph: {}, table: {} },
      });

      const result = await saver.save();

      expect(saver.getLastSaveError()).toBeUndefined();

      const tableData = result?.blocks.find(b => b.id === 'tbl1')?.data as {
        content: Array<Array<{ blocks: string[] }>>;
      };

      expect(tableData.content[0][0].blocks).toEqual(['b3', 'b1', 'b2']);

      cleanup();
    });
  });
});

