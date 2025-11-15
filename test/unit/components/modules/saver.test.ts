import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import Saver from '../../../../src/components/modules/saver';
import type Block from '../../../../src/components/block';
import type { EditorConfig, SanitizerConfig } from '../../../../types';
import type { SavedData } from '../../../../types/data-formats';
import * as sanitizer from '../../../../src/components/utils/sanitizer';
import * as utils from '../../../../src/components/utils';

type BlockSaveResult = SavedData & { tunes?: Record<string, unknown> };

interface BlockMock {
  block: Block;
  savedData: BlockSaveResult;
  saveMock: Mock<[], Promise<BlockSaveResult>>;
  validateMock: Mock<[BlockSaveResult['data']], Promise<boolean>>;
}

interface BlockMockOptions {
  id: string;
  tool: string;
  data: SavedData['data'];
  tunes?: Record<string, unknown>;
  isValid?: boolean;
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

  const saveMock = vi.fn<[], Promise<BlockSaveResult>>().mockResolvedValue(savedData);
  const validateMock = vi.fn<[BlockSaveResult['data']], Promise<boolean>>()
    .mockResolvedValue(options.isValid ?? true);

  const block = {
    save: saveMock,
    validate: validateMock,
  } as unknown as Block;

  return {
    block,
    savedData,
    saveMock,
    validateMock,
  };
};

const createSaver = (options: CreateSaverOptions = {}): { saver: Saver } => {
  const config: EditorConfig = {
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

  const editorState = {
    BlockManager: {
      blocks: options.blocks ?? [],
    },
    Tools: {
      blockTools,
      stubTool,
    },
  };

  (saver as unknown as { state: Saver['Editor'] }).state = editorState as unknown as Saver['Editor'];

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

    vi.spyOn(utils, 'getEditorVersion').mockReturnValue(version);

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

