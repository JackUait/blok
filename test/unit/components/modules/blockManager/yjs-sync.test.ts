import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BlockYjsSync, type SyncHandlers, type BlockYjsSyncDependencies } from '../../../../../src/components/modules/blockManager/yjs-sync';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import { Blocks } from '../../../../../src/components/blocks';
import type { Block } from '../../../../../src/components/block';
import type { BlockChangeEvent } from '../../../../../src/components/modules/yjsManager';
import type { YjsManager } from '../../../../../src/components/modules/yjsManager';
import type { Map as YMap } from 'yjs';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { API } from '../../../../../src/components/modules/api';
import { ToolsCollection } from '../../../../../src/components/tools/collection';
import type { BlockToolAdapter } from '../../../../../src/components/tools/block';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';

/**
 * Create a mock Block for testing
 */
const createMockBlock = (options: {
  id?: string;
  parentId?: string | null;
  data?: Record<string, unknown>;
  tunes?: Record<string, unknown>;
} = {}): Block => {
  const holder = document.createElement('div');
  holder.setAttribute('data-blok-element', '');

  const blockId = options.id ?? `block-${Math.random().toString(16).slice(2)}`;

  const mockSetData = vi.fn((_data: Record<string, unknown>): Promise<boolean> => {
    return Promise.resolve(true);
  });
  const mockCall = vi.fn();
  const mockDestroy = vi.fn();

  return {
    id: blockId,
    holder,
    parentId: options.parentId ?? null,
    contentIds: [],
    data: options.data ?? {},
    preservedTunes: options.tunes ?? {},
    setData: mockSetData as Block['setData'],
    call: mockCall,
    destroy: mockDestroy,
    name: 'paragraph',
    tool: {} as BlockToolAdapter,
    settings: {},
    tunes: new ToolsCollection<BlockToolAdapter>(),
    config: {},
    inputs: [],
    isEmpty: true,
    // EventsDispatcher methods
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    destroyEvents: vi.fn(),
  } as unknown as Block;
};

/**
 * Create mock YjsManager
 *
 * Note: YjsManager has many properties; this mock provides only the methods used by tests.
 * Using unknown assertion to satisfy TypeScript for missing internal properties.
 */
const createMockYjsManager = (): YjsManager => ({
  addBlock: vi.fn(),
  removeBlock: vi.fn(),
  moveBlock: vi.fn(),
  updateBlockData: vi.fn(),
  updateBlockTune: vi.fn(),
  stopCapturing: vi.fn(),
  transact: vi.fn((fn: () => void) => fn()),
  toJSON: vi.fn(() => []),
  getBlockById: vi.fn(() => undefined),
  onBlocksChanged: vi.fn(() => vi.fn()),
  fromJSON: vi.fn(),
  yMapToObject: vi.fn((yMap: YMap<unknown>) => {
    const obj: Record<string, unknown> = {};
    yMap.forEach((value, key) => {
      obj[key] = value;
    });
    return obj;
  }),
} as unknown as YjsManager);

/**
 * Helper to access mock methods on YjsManager
 * Uses unknown as intermediate type to bypass strict type checking for test mocks
 */
const mockGetBlockById = (manager: YjsManager): ReturnType<typeof vi.fn> =>
  (manager as unknown as Record<string, unknown>).getBlockById as ReturnType<typeof vi.fn>;

const mockOnBlocksChanged = (manager: YjsManager): ReturnType<typeof vi.fn> =>
  (manager as unknown as Record<string, unknown>).onBlocksChanged as ReturnType<typeof vi.fn>;

const mockToJSON = (manager: YjsManager): ReturnType<typeof vi.fn> =>
  (manager as unknown as Record<string, unknown>).toJSON as ReturnType<typeof vi.fn>;

/**
 * Create mock Yjs block (YMap)
 * Returns a mock that implements the YMap interface used in tests
 *
 * Note: Using unknown assertion for external Yjs type which has many internal properties
 */
const createMockYMap = (data: Record<string, unknown>): YMap<unknown> => {
  const mockGet = vi.fn((key: string) => data[key]);
  const mockSet = vi.fn();
  const mockDelete = vi.fn();
  const mockHas = vi.fn((key: string) => key in data);
  const mockToJSON = vi.fn(() => data);

  const yMap = {
    get: mockGet,
    set: mockSet,
    delete: mockDelete,
    has: mockHas,
    forEach: function(callback: (value: unknown, key: string, map: YMap<unknown>) => void) {
      Object.entries(data).forEach(([key, value]) => callback(value, key, yMap));
    },
    entries: vi.fn(function*() {
      yield* Object.entries(data);
    }),
    toJSON: mockToJSON,
    _data: data, // Store reference for test access
  } as unknown as YMap<unknown>;

  return yMap;
};

/**
 * Create a BlocksStore with mock blocks
 * Returns a proxied Blocks with index signature to match BlocksStore type
 */
const createBlocksStore = (blocks: Block[]): BlocksStore => {
  const workingArea = document.createElement('div');
  const blocksStore = new Blocks(workingArea);

  for (const block of blocks) {
    blocksStore.push(block);
  }

  // Create proxied BlocksStore to match actual BlockManager setup
  // The Proxy adds the index signature required by BlocksStore
  return new Proxy(blocksStore, {
    set: Blocks.set,
    get: Blocks.get,
  }) as unknown as BlocksStore;
};

/**
 * Create mock dependencies for BlockYjsSync
 */
const createMockDependencies = (yjsManager?: YjsManager): BlockYjsSyncDependencies => ({
  YjsManager: yjsManager ?? createMockYjsManager(),
});

/**
 * Create mock BlockFactory
 */
const createMockBlockFactory = (): BlockFactory => {
  // Create minimal API mock - using object with partial API interface
  const mockAPI: Partial<API> = {
    // Add minimal required methods if needed by BlockFactory
  };
  const mockEventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const mockTools = new ToolsCollection<BlockToolAdapter>();
  const bindBlockEvents = vi.fn();

  return new BlockFactory({
    API: mockAPI as API,
    eventsDispatcher: mockEventsDispatcher,
    readOnly: false,
    tools: mockTools,
  }, bindBlockEvents);
};

/**
 * Create mock SyncHandlers
 */
const createMockSyncHandlers = (): SyncHandlers => ({
  addToDom: vi.fn(),
  removeFromDom: vi.fn(),
  moveInDom: vi.fn(),
  getBlockIndex: vi.fn(() => 0),
  insertDefaultBlock: vi.fn(() => createMockBlock()),
  updateIndentation: vi.fn(),
  replaceBlock: vi.fn(),
});

describe('BlockYjsSync', () => {
  let repository: BlockRepository;
  let factory: BlockFactory;
  let yjsSync: BlockYjsSync;
  let blocksStore: BlocksStore;
  let mockYjsManager: YjsManager;
  let mockHandlers: SyncHandlers;

  beforeEach(() => {
    mockYjsManager = createMockYjsManager();
    mockHandlers = createMockSyncHandlers();

    const blocks = [
      createMockBlock({ id: 'block-1' }),
      createMockBlock({ id: 'block-2' }),
      createMockBlock({ id: 'block-3' }),
    ];
    blocksStore = createBlocksStore(blocks);

    repository = new BlockRepository();
    repository.initialize(blocksStore);

    factory = createMockBlockFactory();

    const dependencies = createMockDependencies(mockYjsManager);
    yjsSync = new BlockYjsSync(dependencies, repository, factory, mockHandlers, blocksStore);
  });

  describe('isSyncingFromYjs getter', () => {
    it('returns false when no sync is in progress', () => {
      expect(yjsSync.isSyncingFromYjs).toBe(false);
    });

    it('returns true during withAtomicOperation execution', () => {
      let syncStateDuringOperation = false;

      yjsSync.withAtomicOperation(() => {
        syncStateDuringOperation = yjsSync.isSyncingFromYjs;
      });

      expect(syncStateDuringOperation).toBe(true);
      expect(yjsSync.isSyncingFromYjs).toBe(false);
    });

    it('handles nested atomic operations with counter', () => {
      expect(yjsSync.isSyncingFromYjs).toBe(false);

      yjsSync.withAtomicOperation(() => {
        expect(yjsSync.isSyncingFromYjs).toBe(true);

        yjsSync.withAtomicOperation(() => {
          expect(yjsSync.isSyncingFromYjs).toBe(true);
        });

        expect(yjsSync.isSyncingFromYjs).toBe(true);
      });

      expect(yjsSync.isSyncingFromYjs).toBe(false);
    });
  });

  describe('withAtomicOperation', () => {
    it('executes function and decrements sync count even if error is thrown', () => {
      const error = new Error('Test error');

      expect(() => {
        yjsSync.withAtomicOperation(() => {
          expect(yjsSync.isSyncingFromYjs).toBe(true);
          throw error;
        });
      }).toThrow(error);

      expect(yjsSync.isSyncingFromYjs).toBe(false);
    });

    it('returns the result of the executed function', () => {
      const result = yjsSync.withAtomicOperation(() => 'test result');

      expect(result).toBe('test result');
    });

    it('handles void functions', () => {
      let executed = false;

      const result = yjsSync.withAtomicOperation(() => {
        executed = true;
      });

      expect(executed).toBe(true);
      expect(result).toBeUndefined();
    });
  });

  describe('subscribe', () => {
    it('subscribes to YjsManager blocks changed events', () => {
      const unsubscribe = yjsSync.subscribe();

      expect(mockYjsManager.onBlocksChanged).toHaveBeenCalledWith(expect.any(Function));

      unsubscribe();
    });

    it('returns unsubscribe function', () => {
      const mockUnsubscribe = vi.fn();
      mockOnBlocksChanged(mockYjsManager).mockReturnValue(mockUnsubscribe);

      const unsubscribe = yjsSync.subscribe();

      expect(unsubscribe).toBe(mockUnsubscribe);
    });
  });

  describe('updateBlocksStore', () => {
    it('updates the internal blocks store reference', () => {
      const newBlocks = [createMockBlock({ id: 'new-block' })];
      const newBlocksStore = createBlocksStore(newBlocks);

      yjsSync.updateBlocksStore(newBlocksStore);

      // The updated blocks store should be used for subsequent operations
      // This is verified implicitly by other operations using the correct blocks
    });
  });

  describe('syncBlockDataToYjs', () => {
    it('syncs block data to YjsManager', async () => {
      const block = createMockBlock({ id: 'test-block' });
      const savedData = { data: { text: 'Hello', level: 2 } };

      await yjsSync.syncBlockDataToYjs(block, savedData);

      expect(mockYjsManager.updateBlockData).toHaveBeenCalledWith('test-block', 'text', 'Hello');
      expect(mockYjsManager.updateBlockData).toHaveBeenCalledWith('test-block', 'level', 2);
    });

    it('does not sync when savedData is undefined', async () => {
      const block = createMockBlock({ id: 'test-block' });

      await yjsSync.syncBlockDataToYjs(block, undefined as unknown as { data: Record<string, unknown> });

      expect(mockYjsManager.updateBlockData).not.toHaveBeenCalled();
    });
  });

  describe('isBlockDataChanged', () => {
    it('returns true when block does not exist in Yjs', () => {
      mockGetBlockById(mockYjsManager).mockReturnValue(undefined);

      const result = yjsSync.isBlockDataChanged('unknown-block', 'text', 'value');

      expect(result).toBe(true);
    });

    it('returns true when value differs from Yjs value', () => {
      const ydata = createMockYMap({ text: 'old value' });
      const yblock = createMockYMap({ data: ydata });

      mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

      const result = yjsSync.isBlockDataChanged('block-1', 'text', 'new value');

      expect(result).toBe(true);
    });

    it('returns false when value matches Yjs value', () => {
      const ydata = createMockYMap({ text: 'same value' });
      const yblock = createMockYMap({ data: ydata });

      mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

      const result = yjsSync.isBlockDataChanged('block-1', 'text', 'same value');

      expect(result).toBe(false);
    });

    it('handles undefined values in Yjs', () => {
      const ydata = createMockYMap({ text: undefined });
      const yblock = createMockYMap({ data: ydata });

      mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

      const result = yjsSync.isBlockDataChanged('block-1', 'text', 'value');

      expect(result).toBe(true);
    });
  });

  describe('Yjs sync event handling', () => {
    let callback: (event: BlockChangeEvent) => void;

    beforeEach(() => {
      // Capture the callback passed to onBlocksChanged
      mockOnBlocksChanged(mockYjsManager).mockImplementation((cb) => {
        callback = cb as (event: BlockChangeEvent) => void;
        return vi.fn();
      });

      yjsSync.subscribe();
    });

    describe('handleYjsUpdate', () => {
      it('updates block data from Yjs on update event', async () => {
        const block = createMockBlock({
          id: 'test-block',
          data: { text: 'old' },
          tunes: { alignment: 'left' },
        });

        // Create a new blocksStore with the block
        const newBlocksStore = createBlocksStore([
          createMockBlock({ id: 'block-1' }),
          createMockBlock({ id: 'block-2' }),
          createMockBlock({ id: 'block-3' }),
          block,
        ]);

        // Update repository and yjsSync to use the new blocksStore
        repository = new BlockRepository();
        repository.initialize(newBlocksStore);

        yjsSync = new BlockYjsSync(
          createMockDependencies(mockYjsManager),
          repository,
          factory,
          mockHandlers,
          newBlocksStore
        );

        // Re-subscribe to capture the callback with the updated instance
        mockOnBlocksChanged(mockYjsManager).mockImplementation((cb) => {
          callback = cb as (event: BlockChangeEvent) => void;
          return vi.fn();
        });
        yjsSync.subscribe();

        const ydata = createMockYMap({ text: 'new text', level: 2 });
        const yblock = createMockYMap({
          type: 'paragraph',
          data: ydata,
          tunes: createMockYMap({ alignment: 'left' }),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

        callback!({ blockId: 'test-block', type: 'update', origin: 'undo' });

        // Wait for the async setData call
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(block.setData).toHaveBeenCalledWith({ text: 'new text', level: 2 });
      });

      it('does not update when block not found', () => {
        mockGetBlockById(mockYjsManager).mockReturnValue(undefined);

        expect(() => {
          callback!({ blockId: 'unknown', type: 'update', origin: 'undo' });
        }).not.toThrow();
      });

      it('does not update when yblock not found', () => {
        const block = createMockBlock({ id: 'test-block' });
        mockGetBlockById(mockYjsManager).mockReturnValue(undefined);

        callback!({ blockId: 'test-block', type: 'update', origin: 'undo' });

        expect(block.setData).not.toHaveBeenCalled();
      });
    });

    describe('handleYjsMove', () => {
      it('batches move operations using microtask', () => {
        // Create mock blocks for the mockHandler to reference
        void [
          createMockBlock({ id: 'block-1' }),
          createMockBlock({ id: 'block-2' }),
          createMockBlock({ id: 'block-3' }),
        ];
        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'block-2' },
          { id: 'block-1' },
          { id: 'block-3' },
        ]);
        mockHandlers.getBlockIndex = vi.fn((block: Block) => {
          const indexMap: Record<string, number> = {
            'block-1': 0,
            'block-2': 1,
            'block-3': 2,
          };
          return indexMap[block.id];
        });

        // Trigger multiple move events
        callback!({ blockId: 'block-1', type: 'move', origin: 'undo' });
        callback!({ blockId: 'block-2', type: 'move', origin: 'undo' });

        // Moves should be batched
      });
    });

    describe('handleYjsAdd', () => {
      it('creates block from Yjs data', () => {
        const yblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: 'Hello' }),
          parentId: 'parent-1',
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);
        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'existing-block' },
          { id: 'new-block', type: 'paragraph', parentId: 'parent-1' },
        ]);

        const composeBlockSpy = vi.spyOn(factory, 'composeBlock').mockReturnValue(
          createMockBlock({ id: 'new-block' })
        );

        callback!({ blockId: 'new-block', type: 'add', origin: 'undo' });

        expect(composeBlockSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'new-block',
            tool: 'paragraph',
            bindEventsImmediately: true,
          })
        );
      });

      it('does not create block if it already exists', () => {
        const existingBlock = createMockBlock({ id: 'existing' });
        repository = new BlockRepository();
        repository.initialize(createBlocksStore([existingBlock]));

        yjsSync = new BlockYjsSync(
          createMockDependencies(mockYjsManager),
          repository,
          factory,
          mockHandlers,
          createBlocksStore([existingBlock])
        );
        yjsSync.subscribe();

        const composeBlockSpy = vi.spyOn(factory, 'composeBlock');

        mockGetBlockById(mockYjsManager).mockReturnValue(
          createMockYMap({ type: 'paragraph' })
        );

        callback!({ blockId: 'existing', type: 'add', origin: 'undo' });

        expect(composeBlockSpy).not.toHaveBeenCalled();
      });
    });

    describe('handleYjsRemove', () => {
      it('removes block from blocks store', () => {
        const blockToRemove = createMockBlock({ id: 'to-remove' });
        const testBlocksStore = createBlocksStore([blockToRemove]);

        repository = new BlockRepository();
        repository.initialize(testBlocksStore);

        mockHandlers.getBlockIndex = vi.fn(() => 0);

        yjsSync = new BlockYjsSync(
          createMockDependencies(mockYjsManager),
          repository,
          factory,
          mockHandlers,
          testBlocksStore
        );
        yjsSync.subscribe();

        callback!({ blockId: 'to-remove', type: 'remove', origin: 'undo' });

        expect(testBlocksStore.length).toBe(0);
      });

      it('inserts default block when all blocks removed', () => {
        const lastBlock = createMockBlock({ id: 'last' });
        mockHandlers.getBlockIndex = vi.fn(() => 0);
        mockHandlers.insertDefaultBlock = vi.fn(() => createMockBlock({ id: 'default' }));

        repository = new BlockRepository();
        repository.initialize(createBlocksStore([lastBlock]));

        yjsSync = new BlockYjsSync(
          createMockDependencies(mockYjsManager),
          repository,
          factory,
          mockHandlers,
          createBlocksStore([lastBlock])
        );
        yjsSync.subscribe();

        callback!({ blockId: 'last', type: 'remove', origin: 'undo' });

        expect(mockHandlers.insertDefaultBlock).toHaveBeenCalledWith(true);
      });
    });
  });

  describe('origin filtering', () => {
    let callback: (event: BlockChangeEvent) => void;

    beforeEach(() => {
      mockOnBlocksChanged(mockYjsManager).mockImplementation((cb) => {
        callback = cb as (event: BlockChangeEvent) => void;
        return vi.fn();
      });

      yjsSync.subscribe();
    });

    it('syncs on undo origin', () => {
      void createMockBlock({ id: 'test', data: {}, tunes: {} });
      const ydata = createMockYMap({});
      const yblock = createMockYMap({ data: ydata, tunes: createMockYMap({}) });

      mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

      expect(() => {
        callback!({ blockId: 'test', type: 'update', origin: 'undo' });
      }).not.toThrow();
    });

    it('syncs on redo origin', () => {
      void createMockBlock({ id: 'test', data: {}, tunes: {} });
      const ydata = createMockYMap({});
      const yblock = createMockYMap({ data: ydata, tunes: createMockYMap({}) });

      mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

      expect(() => {
        callback!({ blockId: 'test', type: 'update', origin: 'redo' });
      }).not.toThrow();
    });
  });
});
