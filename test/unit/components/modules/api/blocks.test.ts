import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import BlocksAPI from '../../../../../src/components/modules/api/blocks';
import EventsDispatcher from '../../../../../src/components/utils/events';
import * as utils from '../../../../../src/components/utils';

import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { EditorConfig, OutputBlockData, OutputData, BlockToolData } from '../../../../../types';
import type { EditorEventMap } from '../../../../../src/components/events';
import type { BlockTuneData } from '../../../../../types/block-tunes/block-tune-data';
import type { EditorModules } from '../../../../../src/types-internal/editor-modules';

const { blockConstructorSpy, blockAPIConstructorSpy } = vi.hoisted(() => {
  return {
    blockConstructorSpy: vi.fn(),
    blockAPIConstructorSpy: vi.fn(),
  };
});

vi.mock('../../../../../src/components/block', () => ({
  ['__esModule']: true,
  default: blockConstructorSpy,
}));

vi.mock('../../../../../src/components/block/api', () => ({
  ['__esModule']: true,
  default: blockAPIConstructorSpy,
}));

type BlockStub = {
  id: string;
  name: string;
  holder: HTMLElement;
  stretched: boolean;
  data: BlockToolData;
};

type BlockManagerInsertOptions = {
  id?: string;
  tool: string;
  data?: BlockToolData;
  index?: number;
  needToFocus?: boolean;
  replace?: boolean;
};

type MockBlockConstructorOptions = {
  tool?: { name: string };
  data?: BlockToolData;
};

const createBlockStub = (overrides: Partial<BlockStub> = {}): BlockStub => {
  return {
    id: overrides.id ?? `block-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    name: overrides.name ?? 'paragraph',
    holder: overrides.holder ?? document.createElement('div'),
    stretched: overrides.stretched ?? false,
    data: overrides.data ?? {},
  };
};

type BlockManagerMock = {
  blocks: BlockStub[];
  currentBlockIndex: number;
  currentBlock: BlockStub | null;
  getBlockByIndex: ReturnType<typeof vi.fn>;
  getBlockById: ReturnType<typeof vi.fn>;
  getBlockIndex: ReturnType<typeof vi.fn>;
  getBlock: ReturnType<typeof vi.fn>;
  move: ReturnType<typeof vi.fn>;
  removeBlock: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  insertMany: ReturnType<typeof vi.fn>;
  composeBlock: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  convert: ReturnType<typeof vi.fn>;
};

const createBlockManagerMock = (initialBlocks: BlockStub[] = [ createBlockStub() ]): BlockManagerMock => {
  const blockManager: BlockManagerMock = {
    blocks: [ ...initialBlocks ],
    currentBlockIndex: 0,
    currentBlock: initialBlocks[0] ?? null,
    getBlockByIndex: vi.fn((index: number) => {
      return blockManager.blocks[index];
    }) as ReturnType<typeof vi.fn>,
    getBlockById: vi.fn((id: string) => {
      return blockManager.blocks.find((block) => block.id === id);
    }) as ReturnType<typeof vi.fn>,
    getBlockIndex: vi.fn((block: BlockStub) => {
      return blockManager.blocks.indexOf(block);
    }) as ReturnType<typeof vi.fn>,
    getBlock: vi.fn((element: HTMLElement) => {
      return blockManager.blocks.find((block) => block.holder === element);
    }) as ReturnType<typeof vi.fn>,
    move: vi.fn() as ReturnType<typeof vi.fn>,
    removeBlock: vi.fn((block?: BlockStub) => {
      if (!block) {
        throw new Error('Block not found');
      }

      const index = blockManager.blocks.indexOf(block);

      if (index === -1) {
        throw new Error('Block not found');
      }
      blockManager.blocks.splice(index, 1);
      blockManager.currentBlock = blockManager.blocks[blockManager.currentBlockIndex] ?? null;
    }) as ReturnType<typeof vi.fn>,
    insert: vi.fn((options?: BlockManagerInsertOptions) => {
      const initialLength = blockManager.blocks.length;

      const resolvedOptions: BlockManagerInsertOptions = options ?? {
        tool: 'paragraph',
        data: {},
      };

      const block = createBlockStub({
        id: resolvedOptions.id,
        name: resolvedOptions.tool,
        data: resolvedOptions.data ?? {},
      });

      if (typeof resolvedOptions.index === 'number') {
        if (resolvedOptions.replace) {
          blockManager.blocks.splice(resolvedOptions.index, 1, block);
        } else {
          blockManager.blocks.splice(resolvedOptions.index + 1, 0, block);
        }
      } else {
        blockManager.blocks.push(block);
      }

      if (initialLength > 0) {
        blockManager.currentBlock = blockManager.blocks[blockManager.currentBlockIndex] ?? null;
      }

      return block;
    }) as ReturnType<typeof vi.fn>,
    insertMany: vi.fn((blocksToInsert: BlockStub[], index: number) => {
      blockManager.blocks.splice(index, 0, ...blocksToInsert);
      blockManager.currentBlock = blockManager.blocks[blockManager.currentBlockIndex] ?? null;
    }) as ReturnType<typeof vi.fn>,
    composeBlock: vi.fn(({ id, tool, data }: { id?: string; tool: string; data?: BlockToolData }) => {
      return createBlockStub({
        id,
        name: tool,
        data: data ?? {},
      });
    }) as ReturnType<typeof vi.fn>,
    clear: vi.fn(async () => {
      blockManager.blocks = [];
      blockManager.currentBlock = null;
    }) as ReturnType<typeof vi.fn>,
    update: vi.fn(async (block: BlockStub, data?: Partial<BlockToolData>, _tunes?: Record<string, BlockTuneData>) => {
      const updatedBlock: BlockStub = {
        ...block,
        data: {
          ...block.data,
          ...(data ?? {}),
        },
      };

      const index = blockManager.blocks.indexOf(block);

      if (index !== -1) {
        blockManager.blocks.splice(index, 1, updatedBlock);
      }

      return updatedBlock;
    }) as ReturnType<typeof vi.fn>,
    convert: vi.fn(async (block: BlockStub, newType: string, dataOverrides?: BlockToolData) => {
      const converted: BlockStub = {
        ...createBlockStub({
          id: block.id,
          name: newType,
          data: {
            ...block.data,
            ...dataOverrides,
          },
        }),
        holder: block.holder,
        stretched: block.stretched,
      };

      const index = blockManager.blocks.indexOf(block);

      if (index !== -1) {
        blockManager.blocks.splice(index, 1, converted);
      }

      return converted;
    }) as ReturnType<typeof vi.fn>,
  };

  return blockManager;
};

type EditorStub = {
  BlockManager: BlockManagerMock;
  Caret: {
    setToBlock: ReturnType<typeof vi.fn>;
    positions: {
      END: string;
    };
  };
  Toolbar: {
    close: ReturnType<typeof vi.fn>;
  };
  InlineToolbar: {
    close: ReturnType<typeof vi.fn>;
  };
  ModificationsObserver: {
    disable: ReturnType<typeof vi.fn>;
    enable: ReturnType<typeof vi.fn>;
  };
  Renderer: {
    render: ReturnType<typeof vi.fn>;
  };
  Paste: {
    processText: ReturnType<typeof vi.fn>;
  };
  Tools: {
    blockTools: Map<string, { conversionConfig?: { export?: () => unknown; import?: () => unknown } }>;
  };
  API: Record<string, unknown>;
};

const createEditorStub = (
  blockManager: BlockManagerMock,
  overrides: Partial<EditorStub> = {}
): EditorStub => {
  const base: EditorStub = {
    BlockManager: blockManager,
    Caret: {
      setToBlock: vi.fn(() => true) as ReturnType<typeof vi.fn>,
      positions: {
        END: 'end',
      },
    },
    Toolbar: {
      close: vi.fn() as ReturnType<typeof vi.fn>,
    },
    InlineToolbar: {
      close: vi.fn() as ReturnType<typeof vi.fn>,
    },
    ModificationsObserver: {
      disable: vi.fn() as ReturnType<typeof vi.fn>,
      enable: vi.fn() as ReturnType<typeof vi.fn>,
    },
    Renderer: {
      render: vi.fn(async (_blocks: OutputBlockData[]) => {}) as ReturnType<typeof vi.fn>,
    },
    Paste: {
      processText: vi.fn(async (_html: string, _sanitize: boolean) => {}) as ReturnType<typeof vi.fn>,
    },
    Tools: {
      blockTools: new Map(),
    },
    API: {},
  };

  return {
    ...base,
    ...overrides,
  };
};

const createBlocksApi = (options: {
  blocks?: BlockStub[];
  blockManager?: BlockManagerMock;
  editorOverrides?: Partial<EditorStub>;
  configOverrides?: Partial<EditorConfig>;
} = {}): { blocksApi: BlocksAPI; editor: EditorStub; blockManager: BlockManagerMock } => {
  const blockManager = options.blockManager ?? createBlockManagerMock(options.blocks);
  const editor = createEditorStub(blockManager, options.editorOverrides);

  const eventsDispatcher = new EventsDispatcher<EditorEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {
      defaultBlock: 'paragraph',
      ...(options.configOverrides ?? {}),
    } as EditorConfig,
    eventsDispatcher,
  };

  const blocksApi = new BlocksAPI(moduleConfig);

  blocksApi.state = editor as unknown as EditorModules;

  return {
    blocksApi,
    editor,
    blockManager,
  };
};

describe('BlocksAPI', () => {
  beforeEach(() => {
    blockConstructorSpy.mockReset();
    blockConstructorSpy.mockImplementation((options: MockBlockConstructorOptions = {}) => {
      if (!options?.tool) {
        throw new Error('Tool is required');
      }

      return {
        data: options.data ?? {
          mock: true,
        },
      };
    });

    blockAPIConstructorSpy.mockReset();
    blockAPIConstructorSpy.mockImplementation((block: unknown) => {
      return { wrappedBlock: block };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('basic getters', () => {
    it('returns amount of blocks via getBlocksCount()', () => {
      const initialBlocks = [createBlockStub(), createBlockStub()];
      const { blocksApi } = createBlocksApi({ blocks: initialBlocks });

      expect(blocksApi.getBlocksCount()).toBe(initialBlocks.length);
    });

    it('returns current block index via getCurrentBlockIndex()', () => {
      const { blocksApi, blockManager } = createBlocksApi();

      blockManager.currentBlockIndex = 2;

      expect(blocksApi.getCurrentBlockIndex()).toBe(2);
    });
  });

  describe('block lookup helpers', () => {
    it('returns block index when block exists', () => {
      const block = createBlockStub({ id: 'target' });
      const { blocksApi } = createBlocksApi({ blocks: [ block ] });

      expect(blocksApi.getBlockIndex('target')).toBe(0);
    });

    it('logs warning when block index requested for missing id', () => {
      const { blocksApi } = createBlocksApi({ blocks: [] });
      const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});

      expect(blocksApi.getBlockIndex('missing')).toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith('There is no block with id `missing`', 'warn');

      logSpy.mockRestore();
    });

    it('wraps block by index into BlockAPI instance', () => {
      const block = createBlockStub({ id: 'b-1' });
      const { blocksApi, blockManager } = createBlocksApi({ blocks: [ block ] });

      const result = blocksApi.getBlockByIndex(0);

      expect(blockManager.getBlockByIndex).toHaveBeenCalledWith(0);
      expect(blockAPIConstructorSpy).toHaveBeenCalledWith(block);
      expect(result).toEqual({ wrappedBlock: block });
    });

    it('logs warning when requesting block by missing index', () => {
      const { blocksApi, blockManager } = createBlocksApi({ blocks: [] });
      const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});

      blockManager.getBlockByIndex.mockReturnValueOnce(undefined);

      expect(blocksApi.getBlockByIndex(0)).toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith('There is no block at index `0`', 'warn');

      logSpy.mockRestore();
    });

    it('wraps block by id into BlockAPI instance', () => {
      const block = createBlockStub({ id: 'block-id' });
      const { blocksApi, blockManager } = createBlocksApi({ blocks: [ block ] });

      const result = blocksApi.getById('block-id');

      expect(blockManager.getBlockById).toHaveBeenCalledWith('block-id');
      expect(blockAPIConstructorSpy).toHaveBeenCalledWith(block);
      expect(result).toEqual({ wrappedBlock: block });
    });

    it('returns null when block by id is missing', () => {
      const { blocksApi, blockManager } = createBlocksApi({ blocks: [] });
      const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});

      blockManager.getBlockById.mockReturnValueOnce(undefined);

      expect(blocksApi.getById('missing-id')).toBeNull();
      expect(logSpy).toHaveBeenCalledWith('There is no block with id `missing-id`', 'warn');

      logSpy.mockRestore();
    });

    it('wraps block by element into BlockAPI instance', () => {
      const block = createBlockStub();
      const { blocksApi, blockManager } = createBlocksApi({ blocks: [ block ] });

      blockManager.getBlock.mockReturnValueOnce(block);

      const result = blocksApi.getBlockByElement(block.holder);

      expect(blockManager.getBlock).toHaveBeenCalledWith(block.holder);
      expect(blockAPIConstructorSpy).toHaveBeenCalledWith(block);
      expect(result).toEqual({ wrappedBlock: block });
    });

    it('logs warning when block is not found for element', () => {
      const { blocksApi, blockManager } = createBlocksApi({ blocks: [] });
      const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});
      const element = document.createElement('div');

      blockManager.getBlock.mockReturnValueOnce(undefined);

      expect(blocksApi.getBlockByElement(element)).toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(
        'There is no block corresponding to element `' + element + '`',
        'warn'
      );

      logSpy.mockRestore();
    });
  });

  describe('block ordering', () => {
    it('delegates move to BlockManager', () => {
      const { blocksApi, blockManager } = createBlocksApi();

      blocksApi.move(4, 1);

      expect(blockManager.move).toHaveBeenCalledWith(4, 1);
    });
  });

  describe('block deletion', () => {
    it('removes block and re-focuses current block', () => {
      const blocks = [createBlockStub({ id: 'a' }), createBlockStub({ id: 'b' })];
      const { blocksApi, blockManager, editor } = createBlocksApi({ blocks });

      blockManager.currentBlockIndex = 0;

      blocksApi.delete(0);

      expect(blockManager.getBlockByIndex).toHaveBeenCalledWith(0);
      expect(blockManager.removeBlock).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
      expect(editor.Caret.setToBlock).toHaveBeenCalledWith(
        blockManager.currentBlock,
        editor.Caret.positions.END
      );
      expect(editor.Toolbar.close).toHaveBeenCalled();
    });

    it('inserts default block when last block is removed', () => {
      const block = createBlockStub({ id: 'only' });
      const { blocksApi, blockManager, editor } = createBlocksApi({ blocks: [ block ] });

      blockManager.removeBlock.mockImplementationOnce(() => {
        blockManager.blocks = [];
        blockManager.currentBlock = null;
      });

      blocksApi.delete(0);

      expect(blockManager.insert).toHaveBeenCalledTimes(1);
      expect(editor.Caret.setToBlock).not.toHaveBeenCalled();
      expect(editor.Toolbar.close).toHaveBeenCalled();
    });

    it('logs warning when block removal throws', () => {
      const block = createBlockStub({ id: 'faulty' });
      const { blocksApi, blockManager, editor } = createBlocksApi({ blocks: [ block ] });
      const error = new Error('remove failed');
      const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});

      blockManager.removeBlock.mockImplementationOnce(() => {
        throw error;
      });

      blocksApi.delete(0);

      expect(logSpy).toHaveBeenCalledWith(error, 'warn');
      expect(blockManager.insert).not.toHaveBeenCalled();
      expect(editor.Toolbar.close).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });

  describe('clearing and rendering', () => {
    it('clears editor via BlockManager and closes inline toolbar', async () => {
      const { blocksApi, blockManager, editor } = createBlocksApi();

      await blocksApi.clear();

      expect(blockManager.clear).toHaveBeenCalledWith(true);
      expect(editor.InlineToolbar.close).toHaveBeenCalled();
    });

    it('renders new data via renderer', async () => {
      const { blocksApi, blockManager, editor } = createBlocksApi();
      const data: OutputData = {
        blocks: [
          {
            id: 'id-1',
            type: 'paragraph',
            data: { text: 'text' },
          },
        ],
      };

      await blocksApi.render(data);

      expect(editor.ModificationsObserver.disable).toHaveBeenCalled();
      expect(blockManager.clear).toHaveBeenCalledWith();
      expect(editor.Renderer.render).toHaveBeenCalledWith(data.blocks);
      expect(editor.ModificationsObserver.enable).toHaveBeenCalled();

      const disableOrder = editor.ModificationsObserver.disable.mock.invocationCallOrder[0];
      const clearOrder = blockManager.clear.mock.invocationCallOrder[0];
      const renderOrder = editor.Renderer.render.mock.invocationCallOrder[0];
      const enableOrder = editor.ModificationsObserver.enable.mock.invocationCallOrder[0];

      expect(disableOrder).toBeLessThan(clearOrder);
      expect(clearOrder).toBeLessThan(renderOrder);
      expect(renderOrder).toBeLessThan(enableOrder);
    });

    it('throws when render data is malformed', async () => {
      const { blocksApi } = createBlocksApi();

      await expect(blocksApi.render({} as OutputData)).rejects.toThrow('Incorrect data passed to the render() method');
    });

    it('renders from HTML string', async () => {
      const { blocksApi, blockManager, editor } = createBlocksApi();

      await blocksApi.renderFromHTML('<p>Hello</p>');

      expect(blockManager.clear).toHaveBeenCalledWith();
      expect(editor.Paste.processText).toHaveBeenCalledWith('<p>Hello</p>', true);
    });
  });


  describe('block insertion APIs', () => {
    it('inserts a new block and wraps it with BlockAPI', () => {
      const { blocksApi, blockManager } = createBlocksApi();
      const data: BlockToolData = { text: 'inserted' };

      const result = blocksApi.insert('paragraph', data, {}, 0, true, false, 'custom');

      expect(blockManager.insert).toHaveBeenCalledWith({
        id: 'custom',
        tool: 'paragraph',
        data,
        index: 0,
        needToFocus: true,
        replace: false,
      });
      expect(blockAPIConstructorSpy).toHaveBeenCalled();
      expect(result).toEqual({ wrappedBlock: expect.objectContaining({ id: 'custom' }) });
    });

    it('uses default block type when insert arguments are omitted', () => {
      const { blocksApi, blockManager } = createBlocksApi({
        configOverrides: { defaultBlock: 'header' },
      });

      blocksApi.insert();

      expect(blockManager.insert).toHaveBeenCalledWith(expect.objectContaining({
        tool: 'header',
      }));
    });

    it('composes block data through Block constructor', async () => {
      const toolName = 'custom-tool';
      const tool = { name: toolName };
      const { blocksApi, editor } = createBlocksApi();

      editor.Tools.blockTools.set(toolName, tool as { conversionConfig?: { export?: () => unknown; import?: () => unknown } });
      blockConstructorSpy.mockImplementationOnce((options: MockBlockConstructorOptions & { tool: { name: string } }) => {
        return {
          data: {
            createdFrom: options.tool.name,
          },
        };
      });

      const data = await blocksApi.composeBlockData(toolName);

      expect(blockConstructorSpy).toHaveBeenCalledWith(expect.objectContaining({
        tool,
        readOnly: true,
        data: {},
        tunesData: {},
      }));
      expect(data).toEqual({ createdFrom: toolName });
    });

    it('throws when composeBlockData received unknown tool', async () => {
      const { blocksApi } = createBlocksApi();

      await expect(blocksApi.composeBlockData('unknown')).rejects.toThrow();
    });

    it('inserts multiple blocks via insertMany', () => {
      const { blocksApi, blockManager } = createBlocksApi();
      const blocksToInsert: OutputBlockData[] = [
        { id: '1',
          type: 'paragraph',
          data: { text: 'one' } },
        { id: '2',
          type: 'header',
          data: { text: 'two' } },
      ];

      const result = blocksApi.methods.insertMany(blocksToInsert, 0);

      expect(blockManager.composeBlock).toHaveBeenCalledTimes(2);
      expect(blockManager.insertMany).toHaveBeenCalledWith(
        expect.arrayContaining([ expect.objectContaining({ id: '1' }) ]),
        0
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('wrappedBlock');
    });

    it('validates insertMany index type', () => {
      const { blocksApi } = createBlocksApi();

      expect(() => {
        blocksApi.methods.insertMany([], 'invalid' as unknown as number);
      }).toThrow('Index should be a number');
    });

    it('validates insertMany index bounds', () => {
      const { blocksApi } = createBlocksApi();

      expect(() => {
        blocksApi.methods.insertMany([], -1);
      }).toThrow('Index should be greater than or equal to 0');
    });
  });

  describe('block updates and conversion', () => {
    it('updates block data via BlockManager', async () => {
      const block = createBlockStub({ id: 'to-update' });
      const { blocksApi, blockManager } = createBlocksApi({ blocks: [ block ] });
      const newData: Partial<BlockToolData> = { text: 'updated' };

      blockManager.update.mockImplementationOnce(async (current, data?: Partial<BlockToolData>, _tunes?: Record<string, BlockTuneData>) => {
        return {
          ...current,
          data: {
            ...current.data,
            ...data,
          },
        };
      });

      const result = await blocksApi.update('to-update', newData);

      expect(blockManager.getBlockById).toHaveBeenCalledWith('to-update');
      expect(blockManager.update).toHaveBeenCalledWith(block, newData, undefined);
      expect(blockAPIConstructorSpy).toHaveBeenCalled();
      expect(result).toEqual({ wrappedBlock: expect.objectContaining({ id: 'to-update' }) });
    });

    it('throws when updating block that does not exist', async () => {
      const { blocksApi, blockManager } = createBlocksApi({ blocks: [] });

      blockManager.getBlockById.mockReturnValueOnce(undefined);

      await expect(blocksApi.update('missing', {})).rejects.toThrow('Block with id "missing" not found');
    });

    it('converts block to another type when conversion config exists', async () => {
      const block = createBlockStub({ id: 'convertible',
        name: 'paragraph' });
      const { blocksApi, blockManager, editor } = createBlocksApi({ blocks: [ block ] });
      const originalTool = { conversionConfig: { export: () => ({}) } };
      const targetTool = { conversionConfig: { import: () => ({}) } };

      editor.Tools.blockTools.set('paragraph', originalTool);
      editor.Tools.blockTools.set('header', targetTool);

      const result = await blocksApi.methods.convert('convertible', 'header');

      expect(blockManager.convert).toHaveBeenCalledWith(
        block,
        'header',
        undefined
      );
      expect(blockAPIConstructorSpy).toHaveBeenCalled();
      expect(result).toEqual({ wrappedBlock: expect.objectContaining({ name: 'header' }) });
    });

    it('throws when conversion target tool lacks conversionConfig', async () => {
      const block = createBlockStub({ id: 'convertible',
        name: 'paragraph' });
      const { blocksApi, editor } = createBlocksApi({ blocks: [ block ] });
      const originalTool = { conversionConfig: { export: () => ({}) } };
      const targetTool = {};

      editor.Tools.blockTools.set('paragraph', originalTool);
      editor.Tools.blockTools.set('header', targetTool);

      await expect(blocksApi.methods.convert('convertible', 'header')).rejects.toThrow(
        'Conversion from "paragraph" to "header" is not possible. Header tool(s) should provide a "conversionConfig"'
      );
    });

    it('throws when block to convert does not exist', async () => {
      const { blocksApi } = createBlocksApi({ blocks: [] });

      await expect(blocksApi.methods.convert('missing', 'header')).rejects.toThrow('Block with id "missing" not found');
    });
  });
});


