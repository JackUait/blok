import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { Saver } from '../../../../src/components/modules/saver';
import type { Block } from '../../../../src/components/block';
import type { BlokConfig, SanitizerConfig } from '../../../../types';
import type { SavedData } from '../../../../types/data-formats';
import * as sanitizer from '../../../../src/components/utils/sanitizer';
import * as utils from '../../../../src/components/utils';

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
    save: saveMock,
    validate: validateMock,
    parentId: options.parentId ?? null,
    contentIds: options.contentIds ?? [],
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
});

