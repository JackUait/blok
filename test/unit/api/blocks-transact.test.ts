import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { BlocksAPI } from '../../../src/components/modules/api/blocks';
import { EventsDispatcher } from '../../../src/components/utils/events';

import type { ModuleConfig } from '../../../src/types-internal/module-config';
import type { BlokConfig, BlockToolData } from '../../../types';
import type { BlokEventMap } from '../../../src/components/events';
import type { BlokModules } from '../../../src/types-internal/blok-modules';

const { blockConstructorSpy, blockAPIConstructorSpy } = vi.hoisted(() => {
  return {
    blockConstructorSpy: vi.fn(function (this: Record<string, unknown>) {
      return this;
    }),
    blockAPIConstructorSpy: vi.fn(function (this: Record<string, unknown>, block: unknown) {
      (this as { wrappedBlock: unknown }).wrappedBlock = block;

      return this;
    }),
  };
});

vi.mock('../../../src/components/block', () => ({
  ['__esModule']: true,
  Block: blockConstructorSpy,
}));

vi.mock('../../../src/components/block/api', () => ({
  ['__esModule']: true,
  BlockAPI: blockAPIConstructorSpy,
}));

type BlockManagerMock = {
  blocks: unknown[];
  currentBlockIndex: number;
  currentBlock: null;
  isSyncingFromYjs: boolean;
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
  splitBlockWithData: ReturnType<typeof vi.fn>;
  transactForTool: ReturnType<typeof vi.fn>;
};

const createBlockManagerMock = (): BlockManagerMock => ({
  blocks: [],
  currentBlockIndex: 0,
  currentBlock: null,
  isSyncingFromYjs: false,
  getBlockByIndex: vi.fn(),
  getBlockById: vi.fn(),
  getBlockIndex: vi.fn(),
  getBlock: vi.fn(),
  move: vi.fn(),
  removeBlock: vi.fn(),
  insert: vi.fn(),
  insertMany: vi.fn(),
  composeBlock: vi.fn(),
  clear: vi.fn(),
  update: vi.fn(),
  convert: vi.fn(),
  splitBlockWithData: vi.fn(),
  transactForTool: vi.fn((fn: () => void) => fn()),
});

type BlokStub = {
  BlockManager: BlockManagerMock;
  Caret: { setToBlock: ReturnType<typeof vi.fn>; positions: { END: string } };
  Toolbar: { close: ReturnType<typeof vi.fn> };
  InlineToolbar: { close: ReturnType<typeof vi.fn> };
  ModificationsObserver: { disable: ReturnType<typeof vi.fn>; enable: ReturnType<typeof vi.fn> };
  Renderer: { render: ReturnType<typeof vi.fn> };
  Paste: { processText: ReturnType<typeof vi.fn> };
  Tools: { blockTools: Map<string, unknown> };
  YjsManager: { stopCapturing: ReturnType<typeof vi.fn> };
  API: Record<string, unknown>;
};

const createBlokStub = (blockManager: BlockManagerMock): BlokStub => ({
  BlockManager: blockManager,
  Caret: { setToBlock: vi.fn(), positions: { END: 'end' } },
  Toolbar: { close: vi.fn() },
  InlineToolbar: { close: vi.fn() },
  ModificationsObserver: { disable: vi.fn(), enable: vi.fn() },
  Renderer: { render: vi.fn() },
  Paste: { processText: vi.fn() },
  Tools: { blockTools: new Map() },
  YjsManager: { stopCapturing: vi.fn() },
  API: {},
});

const createBlocksApi = (): { blocksApi: BlocksAPI; blok: BlokStub; blockManager: BlockManagerMock } => {
  const blockManager = createBlockManagerMock();
  const blok = createBlokStub(blockManager);

  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const moduleConfig: ModuleConfig = {
    config: {
      defaultBlock: 'paragraph',
    } as BlokConfig,
    eventsDispatcher,
  };

  const blocksApi = new BlocksAPI(moduleConfig);

  blocksApi.state = blok as unknown as BlokModules;

  return { blocksApi, blok, blockManager };
};

/**
 * Tests for the Blocks API transact() method.
 *
 * The transact method groups multiple block operations into a single undo entry
 * by suppressing stopCapturing calls during the operation.
 */
describe('Blocks API transact()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes transact in the methods getter', () => {
    const { blocksApi } = createBlocksApi();
    const methods = blocksApi.methods;

    expect(methods.transact).toBeDefined();
    expect(typeof methods.transact).toBe('function');
  });

  it('delegates to BlockManager.transactForTool', () => {
    const { blocksApi, blockManager } = createBlocksApi();
    const fn = vi.fn();

    blocksApi.methods.transact?.(fn);

    expect(blockManager.transactForTool).toHaveBeenCalledWith(fn);
  });

  it('executes the provided function', () => {
    const { blocksApi } = createBlocksApi();
    const fn = vi.fn();

    blocksApi.methods.transact?.(fn);

    expect(fn).toHaveBeenCalledOnce();
  });

  it('propagates errors from the provided function', () => {
    const { blocksApi, blockManager } = createBlocksApi();
    const error = new Error('operation failed');

    blockManager.transactForTool.mockImplementation((fn: () => void) => {
      fn();
    });

    expect(() => {
      blocksApi.methods.transact?.(() => {
        throw error;
      });
    }).toThrow('operation failed');
  });
});
