import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';

import { BlocksAPI } from '../../../../../src/components/modules/api/blocks';
import { ToolNotFoundError } from '../../../../../src/components/errors/tool-not-found';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import * as utils from '../../../../../src/components/utils';

import type { BlokEventMap } from '../../../../../src/components/events';
import type { HashTarget } from '../../../../../src/components/utils/hash-target';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { BlokConfig, BlockToolData, OutputBlockData, OutputData } from '../../../../../types';
import type * as TableRestrictions from '../../../../../src/tools/table/table-restrictions';

type ConversionConfig = {
  export?: (data: BlockToolData) => string;
  import?: (text: string) => BlockToolData;
};

type ToolStub = { conversionConfig?: ConversionConfig };

const {
  blockConstructorSpy,
  blockAPIConstructorSpy,
  mockAnnounce,
  mockResolveHashTarget,
  mockBlocksToMarkdown,
  mockMarkdownToBlocks,
  mockIsInsideTableCell,
} = vi.hoisted(() => ({
  blockConstructorSpy: vi.fn<(options?: { tool?: unknown; data?: BlockToolData }) => Record<string, unknown>>(
    function (this: Record<string, unknown>) {
      return this;
    }
  ),
  blockAPIConstructorSpy: vi.fn<(block: unknown, api?: unknown) => Record<string, unknown>>(
    function (this: Record<string, unknown>) {
      return this;
    }
  ),
  mockAnnounce: vi.fn((_message: string) => {}),
  mockResolveHashTarget: vi.fn((_hash: unknown, _holder: unknown): HashTarget | null => null),
  mockBlocksToMarkdown: vi.fn((_blocks: unknown[]): string => 'MD'),
  mockMarkdownToBlocks: vi.fn(async (_md: string, _options?: unknown): Promise<OutputBlockData[]> => []),
  mockIsInsideTableCell: vi.fn((_block: unknown): boolean => false),
}));

vi.mock('../../../../../src/components/block', () => ({
  ['__esModule']: true,
  Block: blockConstructorSpy,
}));

vi.mock('../../../../../src/components/block/api', () => ({
  ['__esModule']: true,
  BlockAPI: blockAPIConstructorSpy,
}));

vi.mock('../../../../../src/components/utils/announcer', () => ({
  announce: mockAnnounce,
  registerAnnouncer: vi.fn(),
  destroyAnnouncer: vi.fn(),
}));

vi.mock('../../../../../src/components/utils/hash-target', () => ({
  resolveHashTarget: mockResolveHashTarget,
  decodeHashFragment: (raw: string): string => raw,
}));

vi.mock('../../../../../src/markdown/blocks-to-markdown', () => ({
  blocksToMarkdown: mockBlocksToMarkdown,
}));

vi.mock('../../../../../src/markdown/index', () => ({
  markdownToBlocks: mockMarkdownToBlocks,
}));

// Partial mock: the restriction rules stay real, only the "is this block inside a
// cell" probe is observable, so a test can see whether it was consulted at all.
vi.mock('../../../../../src/tools/table/table-restrictions', async (importOriginal) => {
  const actual = await importOriginal<typeof TableRestrictions>();

  return {
    ...actual,
    isInsideTableCell: mockIsInsideTableCell,
  };
});

type BlockStub = {
  id: string;
  name: string;
  holder: HTMLElement;
  watchBlockMutations: Mock<() => void>;
  unwatchBlockMutations: Mock<() => void>;
};

const createBlockStub = (id: string, name = 'paragraph'): BlockStub => ({
  id,
  name,
  holder: document.createElement('div'),
  watchBlockMutations: vi.fn(),
  unwatchBlockMutations: vi.fn(),
});

type ComposeBlockOptions = {
  id?: string;
  tool: string;
  data?: BlockToolData;
  tunes?: unknown;
  parentId?: string | null;
  contentIds?: string[];
  lastEditedAt?: number;
  lastEditedBy?: string;
  origin?: string;
};

type InsertOptions = {
  id?: string;
  tool?: string;
  data?: BlockToolData;
  index?: number;
  needToFocus?: boolean;
  replace?: boolean;
  tunes?: unknown;
  origin?: string;
};

type BlockManagerMock = {
  blocks: BlockStub[];
  currentBlockIndex: number;
  currentBlock: BlockStub | null;
  isSyncingFromYjs: boolean;
  isPointerDragActive: boolean;
  suppressStopCapturing: boolean;
  getBlockByIndex: Mock<(index: number) => BlockStub | undefined>;
  getBlockById: Mock<(id: unknown) => BlockStub | undefined>;
  getBlockIndex: Mock<(block: BlockStub) => number>;
  getBlock: Mock<(element: HTMLElement) => BlockStub | undefined>;
  move: Mock<(toIndex: number, fromIndex?: number) => void>;
  removeBlock: Mock<(block?: BlockStub) => Promise<void>>;
  insert: Mock<(options: InsertOptions) => BlockStub>;
  insertMany: Mock<(blocks: BlockStub[], index: number, options?: unknown) => void>;
  composeBlock: Mock<(options: ComposeBlockOptions) => BlockStub>;
  clear: Mock<(addLast?: boolean) => Promise<void>>;
  update: Mock<(block: BlockStub) => Promise<BlockStub>>;
  convert: Mock<(block: BlockStub, newType: string, overrides?: BlockToolData) => Promise<BlockStub>>;
  splitBlockWithData: Mock<(...args: unknown[]) => BlockStub>;
  insertInsideParent: Mock<(parentId: string, index: number, data?: BlockToolData, tool?: string) => BlockStub>;
  setBlockParent: Mock<(block: BlockStub, parentId: string | null) => void>;
  setPointerDragActive: Mock<(active: boolean) => void>;
  transactForTool: Mock<(fn: () => void) => void>;
  beginToolTransaction: Mock<() => void>;
  endToolTransaction: Mock<() => void>;
};

const createBlockManagerMock = (initialBlocks: BlockStub[]): BlockManagerMock => {
  const blockManager: BlockManagerMock = {
    blocks: [...initialBlocks],
    currentBlockIndex: 0,
    currentBlock: initialBlocks[0] ?? null,
    isSyncingFromYjs: false,
    isPointerDragActive: false,
    suppressStopCapturing: false,
    getBlockByIndex: vi.fn((index: number) => blockManager.blocks[index]),
    getBlockById: vi.fn((id: unknown) => blockManager.blocks.find((block) => block.id === id)),
    getBlockIndex: vi.fn((block: BlockStub) => blockManager.blocks.indexOf(block)),
    getBlock: vi.fn((element: HTMLElement) => blockManager.blocks.find((block) => block.holder === element)),
    move: vi.fn(),
    // Deliberately inert: a guard that wrongly lets a missing block through must
    // show up as an unexpected CALL, not as a throw the caller swallows.
    removeBlock: vi.fn(async (_block?: BlockStub) => {}),
    insert: vi.fn((options: InsertOptions) => createBlockStub(options.id ?? 'inserted', options.tool ?? 'unknown')),
    insertMany: vi.fn(),
    composeBlock: vi.fn((options: ComposeBlockOptions) => createBlockStub(options.id ?? 'composed', options.tool)),
    clear: vi.fn(async (_addLast?: boolean) => {}),
    update: vi.fn(async (block: BlockStub) => block),
    convert: vi.fn(async (block: BlockStub, newType: string) => createBlockStub(block.id, newType)),
    splitBlockWithData: vi.fn(() => createBlockStub('split')),
    insertInsideParent: vi.fn((parentId: string) => createBlockStub(`child-of-${parentId}`)),
    setBlockParent: vi.fn(),
    setPointerDragActive: vi.fn(),
    transactForTool: vi.fn(),
    beginToolTransaction: vi.fn(),
    endToolTransaction: vi.fn(),
  };

  return blockManager;
};

type BlokStub = {
  BlockManager: BlockManagerMock;
  Caret: { setToBlock: Mock<(block: unknown, position?: string) => boolean>; positions: { END: string } };
  Toolbar: { close: Mock<() => void> };
  InlineToolbar: { close: Mock<() => void> };
  ModificationsObserver: {
    disable: Mock<() => void>;
    enable: Mock<() => void>;
    discardPendingChanges: Mock<() => void>;
  };
  Renderer: {
    render: Mock<(blocks: OutputBlockData[]) => Promise<void>>;
    markRenderStart: Mock<() => void>;
    markRenderEnd: Mock<() => void>;
    pendingHashScroll: string | null;
  };
  Saver: { save: Mock<() => Promise<OutputData | undefined>> };
  Paste: { processText: Mock<(html: string, sanitize?: boolean) => Promise<void>> };
  BlockSelection: { selectBlock: Mock<(block: unknown) => void> };
  Tools: { blockTools: Map<string, ToolStub> };
  YjsManager: {
    stopCapturing: Mock<() => void>;
    transactWithoutCapture: Mock<(fn: () => void) => void>;
  };
  I18n: { t: Mock<(key: string) => string> };
  API: Record<string, unknown>;
  Collaboration?: { isEnabled: boolean };
  UI?: { nodes: { holder: HTMLElement } };
};

const createBlokStub = (blockManager: BlockManagerMock, overrides: Partial<BlokStub>): BlokStub => ({
  BlockManager: blockManager,
  Caret: {
    setToBlock: vi.fn(() => true),
    positions: { END: 'end' },
  },
  Toolbar: { close: vi.fn() },
  InlineToolbar: { close: vi.fn() },
  ModificationsObserver: {
    disable: vi.fn(),
    enable: vi.fn(),
    discardPendingChanges: vi.fn(),
  },
  Renderer: {
    render: vi.fn(async (_blocks: OutputBlockData[]) => {}),
    markRenderStart: vi.fn(),
    markRenderEnd: vi.fn(),
    pendingHashScroll: null,
  },
  Saver: { save: vi.fn(async () => undefined) },
  Paste: { processText: vi.fn(async (_html: string, _sanitize?: boolean) => {}) },
  BlockSelection: { selectBlock: vi.fn() },
  Tools: { blockTools: new Map<string, ToolStub>() },
  YjsManager: {
    stopCapturing: vi.fn(),
    transactWithoutCapture: vi.fn(),
  },
  I18n: { t: vi.fn((key: string) => key) },
  API: {},
  ...overrides,
});

const createBlocksApi = (options: {
  blocks?: BlockStub[];
  blokOverrides?: Partial<BlokStub>;
  config?: Partial<BlokConfig>;
} = {}): { blocksApi: BlocksAPI; blok: BlokStub; blockManager: BlockManagerMock } => {
  const blockManager = createBlockManagerMock(options.blocks ?? [createBlockStub('b1')]);
  const blok = createBlokStub(blockManager, options.blokOverrides ?? {});
  const moduleConfig: ModuleConfig = {
    config: {
      defaultBlock: 'paragraph',
      ...(options.config ?? {}),
    },
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  const blocksApi = new BlocksAPI(moduleConfig);

  blocksApi.state = blok as unknown as BlokModules;

  return {
    blocksApi,
    blok,
    blockManager,
  };
};

const REFUSAL = (method: string, doc: string): string =>
  `blocks.${method}() is not allowed while collaboration is on. `
  + 'The document lives on the sync service and is shared with everyone editing it, '
  + 'so replacing it from this editor would overwrite their work. '
  + `To replace the whole document, call POST /sync/${doc}/reset on your server: `
  + 'it reloads the document from your own document endpoint and every open editor picks it up. '
  + 'To change part of the document, use blocks.insert(), blocks.update() or blocks.delete().';

describe('BlocksAPI — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    blockConstructorSpy.mockImplementation(function (
      this: { data: BlockToolData },
      options: { tool?: unknown; data?: BlockToolData } = {}
    ) {
      this.data = options.data ?? {};

      return this;
    });

    blockAPIConstructorSpy.mockImplementation(function (this: { wrappedBlock: unknown }, block: unknown) {
      this.wrappedBlock = block;

      return this;
    });

    mockResolveHashTarget.mockReturnValue(null);
    mockBlocksToMarkdown.mockReturnValue('MD');
    mockMarkdownToBlocks.mockResolvedValue([]);
    mockIsInsideTableCell.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('methods facade', () => {
    it('reads isSyncingFromYjs straight off the BlockManager', () => {
      const { blocksApi, blockManager } = createBlocksApi();

      blockManager.isSyncingFromYjs = true;

      expect(blocksApi.methods.isSyncingFromYjs).toBe(true);
    });

    it('forwards clear() to BlockManager.clear(true) and closes the inline toolbar', async () => {
      const { blocksApi, blok, blockManager } = createBlocksApi();

      await blocksApi.methods.clear();

      expect(blockManager.clear).toHaveBeenCalledWith(true);
      expect(blok.InlineToolbar.close).toHaveBeenCalledTimes(1);
    });

    it('forwards getCurrentBlockIndex() to the BlockManager index', () => {
      const { blocksApi, blockManager } = createBlocksApi();

      blockManager.currentBlockIndex = 3;

      expect(blocksApi.methods.getCurrentBlockIndex()).toBe(3);
    });

    it('forwards getById() to the block carrying that id', () => {
      const blocks = [createBlockStub('b1'), createBlockStub('b2')];
      const { blocksApi } = createBlocksApi({ blocks });

      const result = blocksApi.methods.getById('b2');

      expect(result).not.toBeNull();
      expect(blockAPIConstructorSpy.mock.calls[0][0]).toBe(blocks[1]);
    });

    it('forwards getBlockByElement() to the block owning that element', () => {
      const blocks = [createBlockStub('b1'), createBlockStub('b2')];
      const { blocksApi } = createBlocksApi({ blocks });

      const result = blocksApi.methods.getBlockByElement(blocks[1].holder);

      expect(result).not.toBeUndefined();
      expect(blockAPIConstructorSpy.mock.calls[0][0]).toBe(blocks[1]);
    });

    it('forwards the transaction methods to their BlockManager counterparts', () => {
      const { blocksApi, blockManager } = createBlocksApi();

      blocksApi.methods.beginTransaction?.();
      blocksApi.methods.endTransaction?.();

      expect(blockManager.beginToolTransaction).toHaveBeenCalledTimes(1);
      expect(blockManager.endToolTransaction).toHaveBeenCalledTimes(1);
    });

    it('forwards transactWithoutCapture() to YjsManager with the same function', () => {
      const { blocksApi, blok } = createBlocksApi();
      const fn = (): void => {};

      blocksApi.methods.transactWithoutCapture?.(fn);

      expect(blok.YjsManager.transactWithoutCapture).toHaveBeenCalledTimes(1);
      expect(blok.YjsManager.transactWithoutCapture.mock.calls[0][0]).toBe(fn);
    });

    it('forwards setPointerDragActive() to the BlockManager', () => {
      const { blocksApi, blockManager } = createBlocksApi();

      blocksApi.methods.setPointerDragActive?.(true);

      expect(blockManager.setPointerDragActive).toHaveBeenCalledWith(true);
    });
  });

  describe('delete()', () => {
    it('removes the block at the index and leaves the caret alone when setCaret is false', async () => {
      const blocks = [createBlockStub('b1'), createBlockStub('b2')];
      const { blocksApi, blok, blockManager } = createBlocksApi({ blocks });

      await blocksApi.methods.delete(1, false);

      expect(blockManager.removeBlock.mock.calls[0][0]).toBe(blocks[1]);
      expect(blok.Caret.setToBlock).not.toHaveBeenCalled();
      expect(blok.Toolbar.close).toHaveBeenCalledTimes(1);
    });

    it('warns and removes nothing when no block lives at the index', async () => {
      const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});
      const { blocksApi, blockManager } = createBlocksApi();

      await blocksApi.methods.delete(99);

      expect(blockManager.removeBlock).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('There is no block at index `99`', 'warn');
    });
  });

  describe('refuseWholesaleReplace()', () => {
    const collaborating = {
      blokOverrides: { Collaboration: { isEnabled: true } },
      config: { collaboration: { doc: 'my-doc' } },
    };

    it('names clear() and the reset endpoint in the refusal', async () => {
      const { blocksApi } = createBlocksApi(collaborating);

      await expect(blocksApi.methods.clear()).rejects.toThrow(REFUSAL('clear', 'my-doc'));
    });

    it('names render() in the refusal and does no work at all', async () => {
      const { blocksApi, blok } = createBlocksApi(collaborating);

      await expect(blocksApi.methods.render({ blocks: [] })).rejects.toThrow(REFUSAL('render', 'my-doc'));
      expect(blok.Saver.save).not.toHaveBeenCalled();
    });

    it('names renderFromHTML() in the refusal', async () => {
      const { blocksApi } = createBlocksApi(collaborating);

      await expect(blocksApi.methods.renderFromHTML('<p>x</p>')).rejects.toThrow(
        REFUSAL('renderFromHTML', 'my-doc')
      );
    });
  });

  describe('render()', () => {
    it('renders when nothing is saved yet, even for an empty document', async () => {
      const { blocksApi, blok } = createBlocksApi();

      blok.Saver.save.mockResolvedValue(undefined);

      await blocksApi.methods.render({ blocks: [] });

      expect(blok.Renderer.render).toHaveBeenCalledTimes(1);
      expect(blok.Renderer.markRenderStart).toHaveBeenCalledTimes(1);
      expect(blok.Renderer.markRenderEnd).toHaveBeenCalledTimes(1);
      expect(blok.ModificationsObserver.discardPendingChanges).toHaveBeenCalledTimes(1);
    });

    it('brackets the rebuild with markRenderStart/markRenderEnd', async () => {
      const { blocksApi, blok } = createBlocksApi();

      await blocksApi.methods.render({ blocks: [{ id: 'x', type: 'paragraph', data: { text: 'hi' } }] });

      expect(blok.Renderer.markRenderStart).toHaveBeenCalledTimes(1);
      expect(blok.Renderer.markRenderEnd).toHaveBeenCalledTimes(1);
      expect(blok.Renderer.render).toHaveBeenCalledTimes(1);
    });
  });

  describe('renderFromHTML()', () => {
    it('brackets the paste with markRenderStart/markRenderEnd', async () => {
      const { blocksApi, blok, blockManager } = createBlocksApi();

      await blocksApi.methods.renderFromHTML('<p>hi</p>');

      expect(blok.Renderer.markRenderStart).toHaveBeenCalledTimes(1);
      expect(blok.Renderer.markRenderEnd).toHaveBeenCalledTimes(1);
      expect(blockManager.clear).toHaveBeenCalledTimes(1);
      expect(blok.Paste.processText).toHaveBeenCalledWith('<p>hi</p>', true);
    });

    it('still marks the render finished when the paste throws', async () => {
      const { blocksApi, blok } = createBlocksApi();

      blok.Paste.processText.mockRejectedValue(new Error('boom'));

      await expect(blocksApi.methods.renderFromHTML('<p>hi</p>')).rejects.toThrow('boom');
      expect(blok.Renderer.markRenderEnd).toHaveBeenCalledTimes(1);
    });
  });

  describe('importMarkdown()', () => {
    it('returns the converted blocks wrapped in an OutputData envelope', async () => {
      const converted: OutputBlockData[] = [{ id: 'p', type: 'paragraph', data: { text: 'hi' } }];
      const { blocksApi } = createBlocksApi();

      mockMarkdownToBlocks.mockResolvedValue(converted);

      const result = await blocksApi.methods.importMarkdown('hi');

      expect(result).toStrictEqual({ blocks: converted });
    });
  });

  describe('exportMarkdown()', () => {
    it('hands blocksToMarkdown each block with its structural nesting depth', async () => {
      const { blocksApi, blok } = createBlocksApi();

      blok.Saver.save.mockResolvedValue({
        blocks: [
          { id: 'root', type: 'paragraph', data: { text: 'R' } },
          { id: 'child', type: 'paragraph', data: { text: 'C' }, parent: 'root' },
          { id: 'grand', type: 'paragraph', data: { text: 'G' }, parent: 'child' },
        ],
      });

      const markdown = await blocksApi.methods.exportMarkdown();

      expect(markdown).toBe('MD');
      expect(mockBlocksToMarkdown.mock.calls[0][0]).toStrictEqual([
        { id: 'root', tool: 'paragraph', data: { text: 'R' }, parentId: null, indent: 0 },
        { id: 'child', tool: 'paragraph', data: { text: 'C' }, parentId: 'root', indent: 1 },
        { id: 'grand', tool: 'paragraph', data: { text: 'G' }, parentId: 'child', indent: 2 },
      ]);
    });

    it('terminates on a parent cycle instead of recursing forever', async () => {
      const { blocksApi, blok } = createBlocksApi();

      blok.Saver.save.mockResolvedValue({
        blocks: [
          { id: 'a', type: 'paragraph', data: {}, parent: 'b' },
          { id: 'b', type: 'paragraph', data: {}, parent: 'a' },
        ],
      });

      await blocksApi.methods.exportMarkdown();

      expect(mockBlocksToMarkdown.mock.calls[0][0]).toStrictEqual([
        { id: 'a', tool: 'paragraph', data: {}, parentId: 'b', indent: 2 },
        { id: 'b', tool: 'paragraph', data: {}, parentId: 'a', indent: 2 },
      ]);
    });
  });

  describe('insert()', () => {
    it('skips the table-cell lookup entirely when there is no tool to insert', () => {
      const { blocksApi, blockManager } = createBlocksApi({ config: { defaultBlock: undefined } });

      blocksApi.methods.insert();

      expect(blockManager.getBlockByIndex).not.toHaveBeenCalled();
      expect(blockManager.insert.mock.calls[0][0].tool).toBeUndefined();
    });

    it('resolves the table-cell context at the passed index, not the current one', () => {
      const { blocksApi, blockManager } = createBlocksApi({
        blocks: [createBlockStub('b1'), createBlockStub('b2'), createBlockStub('b3')],
      });

      blockManager.currentBlockIndex = 0;

      blocksApi.methods.insert('paragraph', {}, {}, 2);

      expect(blockManager.getBlockByIndex).toHaveBeenCalledWith(2);
    });

    it('does not probe the table-cell context when the index resolves to no block', () => {
      const { blocksApi, blockManager } = createBlocksApi();

      blockManager.currentBlockIndex = -1;

      blocksApi.methods.insert('header');

      expect(mockIsInsideTableCell).not.toHaveBeenCalled();
      expect(blockManager.insert.mock.calls[0][0].tool).toBe('header');
    });

    it('keeps the requested tool outside a table cell and demotes it inside one', () => {
      const { blocksApi, blockManager } = createBlocksApi();

      blocksApi.methods.insert('header');
      expect(blockManager.insert.mock.calls[0][0].tool).toBe('header');

      mockIsInsideTableCell.mockReturnValue(true);
      blocksApi.methods.insert('header');
      expect(blockManager.insert.mock.calls[1][0].tool).toBe('paragraph');
    });
  });

  describe('composeBlockData()', () => {
    it('throws a ToolNotFoundError naming the missing tool', async () => {
      const { blocksApi } = createBlocksApi();

      await expect(blocksApi.methods.composeBlockData('ghost')).rejects.toBeInstanceOf(ToolNotFoundError);
      await expect(blocksApi.methods.composeBlockData('ghost')).rejects.toThrow(
        'Block Tool with type "ghost" not found'
      );
    });

    it('returns the probe block data for a registered tool', async () => {
      const { blocksApi, blok } = createBlocksApi();

      blok.Tools.blockTools.set('paragraph', {});

      await expect(blocksApi.methods.composeBlockData('paragraph')).resolves.toStrictEqual({});
    });
  });

  describe('convert()', () => {
    const exportFn = (_data: BlockToolData): string => 'text';
    const importFn = (text: string): BlockToolData => ({ text });

    it('throws a ToolNotFoundError naming the missing target tool', async () => {
      const { blocksApi, blok } = createBlocksApi({ blocks: [createBlockStub('b1', 'paragraph')] });

      blok.Tools.blockTools.set('paragraph', { conversionConfig: { export: exportFn } });

      await expect(blocksApi.methods.convert('b1', 'ghost')).rejects.toBeInstanceOf(ToolNotFoundError);
      await expect(blocksApi.methods.convert('b1', 'ghost')).rejects.toThrow(
        'Block Tool with type "ghost" not found'
      );
    });

    it('refuses when the source tool is not registered at all', async () => {
      const { blocksApi, blok, blockManager } = createBlocksApi({ blocks: [createBlockStub('b1', 'ghost')] });

      blok.Tools.blockTools.set('header', { conversionConfig: { import: importFn } });

      await expect(blocksApi.methods.convert('b1', 'header')).rejects.toThrow(
        'Conversion from "ghost" to "header" is not possible. Ghost tool(s) should provide a "conversionConfig"'
      );
      expect(blockManager.convert).not.toHaveBeenCalled();
    });

    it('refuses when the source tool is registered but carries no conversionConfig', async () => {
      const { blocksApi, blok } = createBlocksApi({ blocks: [createBlockStub('b1', 'image')] });

      blok.Tools.blockTools.set('image', {});
      blok.Tools.blockTools.set('header', { conversionConfig: { import: importFn } });

      await expect(blocksApi.methods.convert('b1', 'header')).rejects.toThrow(
        'Conversion from "image" to "header" is not possible. Image tool(s) should provide a "conversionConfig"'
      );
    });

    it('lists both tools when neither side can convert', async () => {
      const { blocksApi, blok } = createBlocksApi({ blocks: [createBlockStub('b1', 'image')] });

      blok.Tools.blockTools.set('image', {});
      blok.Tools.blockTools.set('embed', {});

      await expect(blocksApi.methods.convert('b1', 'embed')).rejects.toThrow(
        'Conversion from "image" to "embed" is not possible. Image and Embed tool(s) should provide a "conversionConfig"'
      );
    });

    it('converts when both tools declare the matching conversionConfig halves', async () => {
      const blocks = [createBlockStub('b1', 'paragraph')];
      const { blocksApi, blok, blockManager } = createBlocksApi({ blocks });

      blok.Tools.blockTools.set('paragraph', { conversionConfig: { export: exportFn } });
      blok.Tools.blockTools.set('header', { conversionConfig: { import: importFn } });

      await blocksApi.methods.convert('b1', 'header');

      expect(blockManager.convert.mock.calls[0][0]).toBe(blocks[0]);
    });
  });

  describe('insertMany()', () => {
    it('composes every block with the api origin', () => {
      const { blocksApi, blockManager } = createBlocksApi();

      blocksApi.methods.insertMany([{ id: 'n1', type: 'paragraph', data: { text: 'a' } }], 0);

      expect(blockManager.composeBlock.mock.calls[0][0]).toStrictEqual({
        id: 'n1',
        tool: 'paragraph',
        data: { text: 'a' },
        tunes: undefined,
        parentId: undefined,
        contentIds: undefined,
        lastEditedAt: undefined,
        lastEditedBy: undefined,
        origin: 'api',
      });
    });
  });

  describe('insertInsideParent()', () => {
    it('opens a fresh undo group before inserting the child', () => {
      const { blocksApi, blok } = createBlocksApi();

      blocksApi.methods.insertInsideParent('p1', 1);

      expect(blok.YjsManager.stopCapturing).toHaveBeenCalledTimes(1);
    });

    it('leaves the undo group open when the BlockManager suppresses stopCapturing', () => {
      const { blocksApi, blok, blockManager } = createBlocksApi();

      blockManager.suppressStopCapturing = true;

      blocksApi.methods.insertInsideParent('p1', 1);

      expect(blok.YjsManager.stopCapturing).not.toHaveBeenCalled();
      expect(blockManager.insertInsideParent).toHaveBeenCalledTimes(1);
    });
  });

  describe('setBlockParent()', () => {
    it('reparents the block carrying that id', () => {
      const blocks = [createBlockStub('b1'), createBlockStub('b2')];
      const { blocksApi, blockManager } = createBlocksApi({ blocks });

      blocksApi.methods.setBlockParent('b2', 'p1');

      expect(blockManager.setBlockParent.mock.calls[0][0]).toBe(blocks[1]);
      expect(blockManager.setBlockParent.mock.calls[0][1]).toBe('p1');
    });

    it('warns and reparents nothing when the id is unknown', () => {
      const logSpy = vi.spyOn(utils, 'logLabeled').mockImplementation(() => {});
      const { blocksApi, blockManager } = createBlocksApi();

      blocksApi.methods.setBlockParent('missing', 'p1');

      expect(blockManager.setBlockParent).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('There is no block with id `missing`', 'warn');
    });
  });

  describe('block mutation watching', () => {
    it('silences the block at the given index', () => {
      const blocks = [createBlockStub('b1'), createBlockStub('b2')];
      const { blocksApi } = createBlocksApi({ blocks });

      blocksApi.methods.stopBlockMutationWatching(1);

      expect(blocks[1].unwatchBlockMutations).toHaveBeenCalledTimes(1);
      expect(blocks[0].unwatchBlockMutations).not.toHaveBeenCalled();
    });

    it('is a no-op when no block lives at the index', () => {
      const blocks = [createBlockStub('b1')];
      const { blocksApi } = createBlocksApi({ blocks });

      expect(() => blocksApi.methods.stopBlockMutationWatching(99)).not.toThrow();
      expect(blocks[0].unwatchBlockMutations).not.toHaveBeenCalled();
    });

    it('re-arms the block carrying that id', () => {
      const blocks = [createBlockStub('b1'), createBlockStub('b2')];
      const { blocksApi } = createBlocksApi({ blocks });

      blocksApi.methods.startBlockMutationWatching('b2');

      expect(blocks[1].watchBlockMutations).toHaveBeenCalledTimes(1);
      expect(blocks[0].watchBlockMutations).not.toHaveBeenCalled();
    });

    it('silently skips an id that no longer exists', () => {
      const { blocksApi } = createBlocksApi();

      expect(() => blocksApi.methods.startBlockMutationWatching('gone')).not.toThrow();
    });
  });

  describe('scrollToBlock()', () => {
    let scrollToSpy: Mock<(options?: ScrollToOptions) => void>;
    // jsdom owns both of these on the window instance, so the descriptors are
    // captured and put back rather than deleted — deleting would strip them
    // from the environment for the rest of the file.
    let originalDescriptors: Record<string, PropertyDescriptor | undefined>;

    beforeEach(() => {
      originalDescriptors = {
        scrollTo: Object.getOwnPropertyDescriptor(window, 'scrollTo'),
        scrollY: Object.getOwnPropertyDescriptor(window, 'scrollY'),
      };
      scrollToSpy = vi.fn();
      Object.defineProperty(window, 'scrollTo', {
        configurable: true,
        writable: true,
        value: scrollToSpy,
      });
      Object.defineProperty(window, 'scrollY', {
        configurable: true,
        get: () => 100,
      });
    });

    afterEach(() => {
      for (const [name, descriptor] of Object.entries(originalDescriptors)) {
        if (descriptor === undefined) {
          Reflect.deleteProperty(window, name);
        } else {
          Object.defineProperty(window, name, descriptor);
        }
      }
    });

    const targetElement = (): HTMLElement => {
      const element = document.createElement('div');

      element.getBoundingClientRect = (): DOMRect => ({ top: 50 } as DOMRect);

      return element;
    };

    it('adds the page scroll offset to the element rect before scrolling', () => {
      const { blocksApi } = createBlocksApi({ config: { scrollToBlock: { topOffset: 20 } } });

      mockResolveHashTarget.mockReturnValue({
        element: targetElement(),
        blockId: 'b1',
      });

      blocksApi.methods.scrollToBlock?.('b1');

      expect(scrollToSpy).toHaveBeenCalledWith({ top: 130, behavior: 'smooth' });
    });

    it('selects nothing when the fragment resolved to a loose anchor', () => {
      const { blocksApi, blok, blockManager } = createBlocksApi();

      mockResolveHashTarget.mockReturnValue({
        element: targetElement(),
        blockId: null,
      });

      blocksApi.methods.scrollToBlock?.('anchor');

      expect(blockManager.getBlockById).not.toHaveBeenCalled();
      expect(blok.BlockSelection.selectBlock).not.toHaveBeenCalled();
      expect(mockAnnounce).toHaveBeenCalledTimes(1);
    });
  });

  describe('processPendingHashScroll()', () => {
    it('resolves nothing when no hash scroll is pending', async () => {
      const { blocksApi } = createBlocksApi();

      await blocksApi.methods.render({ blocks: [{ id: 'x', type: 'paragraph', data: { text: 'hi' } }] });

      expect(mockResolveHashTarget).not.toHaveBeenCalled();
    });

    it('drains a pending hash scroll after the render', async () => {
      const { blocksApi, blok } = createBlocksApi();

      blok.Renderer.pendingHashScroll = 'b1';

      await blocksApi.methods.render({ blocks: [{ id: 'x', type: 'paragraph', data: { text: 'hi' } }] });

      expect(mockResolveHashTarget).toHaveBeenCalledTimes(1);
      expect(mockResolveHashTarget.mock.calls[0][0]).toBe('b1');
      expect(blok.Renderer.pendingHashScroll).toBeNull();
    });
  });
});
