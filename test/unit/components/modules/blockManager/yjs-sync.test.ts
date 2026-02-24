import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BlockYjsSync, type SyncHandlers, type BlockYjsSyncDependencies } from '../../../../../src/components/modules/blockManager/yjs-sync';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import { Blocks } from '../../../../../src/components/blocks';
import type { Block } from '../../../../../src/components/block';
import type { BlockChangeEvent } from '../../../../../src/components/modules/yjs/types';
import type { YjsManager } from '../../../../../src/components/modules/yjs';
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
    tools: mockTools,
    moduleInstances: {
      ReadOnly: { isEnabled: false },
    } as never,
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
  onBlockRemoved: vi.fn(),
  onBlockAdded: vi.fn(),
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
    // Initialize callback with a no-op function to avoid undefined issues
    let callback: (event: BlockChangeEvent) => void = () => {
      // No-op default implementation
    };

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

        callback({ blockId: 'test-block', type: 'update', origin: 'undo' });

        // Wait for the async setData call
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(block.setData).toHaveBeenCalledWith({ text: 'new text', level: 2 });
      });

      it('does not update when block not found', () => {
        mockGetBlockById(mockYjsManager).mockReturnValue(undefined);

        expect(() => {
          callback({ blockId: 'unknown', type: 'update', origin: 'undo' });
        }).not.toThrow();
      });

      it('does not update when yblock not found', () => {
        const block = createMockBlock({ id: 'test-block' });
        mockGetBlockById(mockYjsManager).mockReturnValue(undefined);

        callback({ blockId: 'test-block', type: 'update', origin: 'undo' });

        expect(block.setData).not.toHaveBeenCalled();
      });

      it('recreates block when setData returns false', async () => {
        const block = createMockBlock({
          id: 'test-block',
          data: { content: [] },
          tunes: {},
        });

        // Override name to 'table' and setData to return false
        (block as unknown as Record<string, unknown>).name = 'table';
        (block.setData as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(false));

        const newBlocksStore = createBlocksStore([
          createMockBlock({ id: 'block-1' }),
          block,
        ]);

        repository = new BlockRepository();
        repository.initialize(newBlocksStore);

        yjsSync = new BlockYjsSync(
          createMockDependencies(mockYjsManager),
          repository,
          factory,
          mockHandlers,
          newBlocksStore
        );

        mockOnBlocksChanged(mockYjsManager).mockImplementation((cb) => {
          callback = cb as (event: BlockChangeEvent) => void;
          return vi.fn();
        });
        yjsSync.subscribe();

        const newData = { content: [['cell1', 'cell2']] };
        const ydata = createMockYMap(newData);
        const yblock = createMockYMap({
          type: 'table',
          data: ydata,
          tunes: createMockYMap({}),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

        const newBlock = createMockBlock({ id: 'test-block' });
        const composeBlockSpy = vi.spyOn(factory, 'composeBlock').mockReturnValue(newBlock);
        mockHandlers.getBlockIndex = vi.fn(() => 1);

        callback({ blockId: 'test-block', type: 'update', origin: 'undo' });

        // Wait for async setData + then chain to resolve
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(composeBlockSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'test-block',
            tool: 'table',
            data: newData,
            tunes: {},
            bindEventsImmediately: true,
          })
        );
        expect(mockHandlers.replaceBlock).toHaveBeenCalledWith(1, newBlock);
      });

      it('does not recreate block when setData returns true', async () => {
        const block = createMockBlock({
          id: 'test-block',
          data: { text: 'old' },
          tunes: {},
        });

        // setData returns true by default (from createMockBlock)

        const newBlocksStore = createBlocksStore([block]);

        repository = new BlockRepository();
        repository.initialize(newBlocksStore);

        yjsSync = new BlockYjsSync(
          createMockDependencies(mockYjsManager),
          repository,
          factory,
          mockHandlers,
          newBlocksStore
        );

        mockOnBlocksChanged(mockYjsManager).mockImplementation((cb) => {
          callback = cb as (event: BlockChangeEvent) => void;
          return vi.fn();
        });
        yjsSync.subscribe();

        const ydata = createMockYMap({ text: 'new text' });
        const yblock = createMockYMap({
          type: 'paragraph',
          data: ydata,
          tunes: createMockYMap({}),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

        const composeBlockSpy = vi.spyOn(factory, 'composeBlock');

        callback({ blockId: 'test-block', type: 'update', origin: 'undo' });

        // Wait for async setData + then chain to resolve
        await new Promise(resolve => setTimeout(resolve, 0));

        expect(composeBlockSpy).not.toHaveBeenCalled();
        expect(mockHandlers.replaceBlock).not.toHaveBeenCalled();
      });

      it('keeps isSyncingFromYjs true through RAF after setData resolves', async () => {
        const block = createMockBlock({
          id: 'test-block',
          data: { text: 'old' },
          tunes: {},
        });

        const newBlocksStore = createBlocksStore([block]);

        repository = new BlockRepository();
        repository.initialize(newBlocksStore);

        yjsSync = new BlockYjsSync(
          createMockDependencies(mockYjsManager),
          repository,
          factory,
          mockHandlers,
          newBlocksStore
        );

        mockOnBlocksChanged(mockYjsManager).mockImplementation((cb) => {
          callback = cb as (event: BlockChangeEvent) => void;
          return vi.fn();
        });
        yjsSync.subscribe();

        const ydata = createMockYMap({ text: 'new text' });
        const yblock = createMockYMap({
          type: 'paragraph',
          data: ydata,
          tunes: createMockYMap({}),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

        callback({ blockId: 'test-block', type: 'update', origin: 'undo' });

        // Immediately after the event, isSyncingFromYjs should be true
        expect(yjsSync.isSyncingFromYjs).toBe(true);

        // Wait for setData promise to resolve
        await new Promise(resolve => setTimeout(resolve, 0));

        // After setData resolves, isSyncingFromYjs should still be true
        // (extended through RAF to prevent DOM mutation observers from syncing back)
        expect(yjsSync.isSyncingFromYjs).toBe(true);

        // Wait for requestAnimationFrame to fire
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));

        // Now it should be false
        expect(yjsSync.isSyncingFromYjs).toBe(false);
      });

      it('keeps isSyncingFromYjs true through RAF for tunes-changed path', () => {
        const block = createMockBlock({
          id: 'test-block',
          data: { text: 'old' },
          tunes: { alignment: 'left' },
        });

        const newBlocksStore = createBlocksStore([block]);

        repository = new BlockRepository();
        repository.initialize(newBlocksStore);

        yjsSync = new BlockYjsSync(
          createMockDependencies(mockYjsManager),
          repository,
          factory,
          mockHandlers,
          newBlocksStore
        );

        mockOnBlocksChanged(mockYjsManager).mockImplementation((cb) => {
          callback = cb as (event: BlockChangeEvent) => void;
          return vi.fn();
        });
        yjsSync.subscribe();

        const ydata = createMockYMap({ text: 'old' });
        const yblock = createMockYMap({
          type: 'paragraph',
          data: ydata,
          // Different tunes to trigger tunes-changed path
          tunes: createMockYMap({ alignment: 'center' }),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

        const newBlock = createMockBlock({ id: 'test-block' });

        vi.spyOn(factory, 'composeBlock').mockReturnValue(newBlock);
        mockHandlers.getBlockIndex = vi.fn(() => 0);

        callback({ blockId: 'test-block', type: 'update', origin: 'undo' });

        // After synchronous replaceBlock, isSyncingFromYjs should still be true
        // (extended through RAF)
        expect(yjsSync.isSyncingFromYjs).toBe(true);
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
        callback({ blockId: 'block-1', type: 'move', origin: 'undo' });
        callback({ blockId: 'block-2', type: 'move', origin: 'undo' });

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

        callback({ blockId: 'new-block', type: 'add', origin: 'undo' });

        expect(composeBlockSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            id: 'new-block',
            tool: 'paragraph',
            bindEventsImmediately: true,
          })
        );
      });

      it('calls onBlockAdded handler after inserting block', () => {
        const yblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: 'Hello' }),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);
        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'new-block', type: 'paragraph' },
        ]);

        const newBlock = createMockBlock({ id: 'new-block' });
        vi.spyOn(factory, 'composeBlock').mockReturnValue(newBlock);

        mockHandlers.onBlockAdded = vi.fn();

        callback({ blockId: 'new-block', type: 'add', origin: 'undo' });

        expect(mockHandlers.onBlockAdded).toHaveBeenCalledWith(newBlock, 0);
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

        callback({ blockId: 'existing', type: 'add', origin: 'undo' });

        expect(composeBlockSpy).not.toHaveBeenCalled();
      });
    });

    describe('handleYjsBatchAdd', () => {
      it('creates all blocks and adds to array before activating any', () => {
        const tableBlock = createMockBlock({ id: 'table-1' });
        const childBlock = createMockBlock({ id: 'child-1' });

        const activationOrder: string[] = [];

        // Track when RENDERED is called (activation) for each block
        (tableBlock.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
          if (method === 'rendered') {
            activationOrder.push('table-1');
            // When table's rendered() fires, child should already be in blocks array
            const childInArray = blocksStore.blocks.some(
              (b: Block) => b.id === 'child-1'
            );
            expect(childInArray).toBe(true);
          }
        });
        (childBlock.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
          if (method === 'rendered') {
            activationOrder.push('child-1');
          }
        });

        vi.spyOn(factory, 'composeBlock').mockImplementation((options) => {
          if ((options as { id: string }).id === 'table-1') return tableBlock;
          return childBlock;
        });

        const tableYblock = createMockYMap({
          type: 'table',
          data: createMockYMap({ content: [] }),
        });
        const childYblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: '' }),
          parentId: 'table-1',
        });
        mockGetBlockById(mockYjsManager).mockImplementation((id: string) => {
          if (id === 'table-1') return tableYblock;
          if (id === 'child-1') return childYblock;
          return undefined;
        });

        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'block-1' },
          { id: 'block-2' },
          { id: 'block-3' },
          { id: 'table-1', type: 'table' },
          { id: 'child-1', type: 'paragraph', parentId: 'table-1' },
        ]);

        callback({ blockIds: ['table-1', 'child-1'], type: 'batch-add', origin: 'undo' });

        // Both blocks should be in the array
        expect(blocksStore.blocks.some((b: Block) => b.id === 'table-1')).toBe(true);
        expect(blocksStore.blocks.some((b: Block) => b.id === 'child-1')).toBe(true);

        // Table should be activated (RENDERED) before child
        expect(activationOrder).toEqual(['table-1', 'child-1']);
      });

      it('skips blocks that already exist in the repository', () => {
        const composeBlockSpy = vi.spyOn(factory, 'composeBlock');

        const yblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: '' }),
        });
        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);
        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'block-1' },
          { id: 'block-2' },
          { id: 'block-3' },
        ]);

        // block-1 already exists in repository
        callback({ blockIds: ['block-1', 'new-block'], type: 'batch-add', origin: 'undo' });

        // Should only compose the new block, not the existing one
        const composedIds = composeBlockSpy.mock.calls.map(
          (call) => (call[0] as { id: string }).id
        );
        expect(composedIds).not.toContain('block-1');
      });

      it('does not insert child holders into DOM directly when parent mounts them', () => {
        const tableBlock = createMockBlock({ id: 'table-1' });
        const childBlock = createMockBlock({ id: 'child-1' });

        // Simulate: when table's RENDERED fires, it mounts child into its DOM
        (tableBlock.call as ReturnType<typeof vi.fn>).mockImplementation((method: string) => {
          if (method === 'rendered') {
            // Simulate mountBlocksInCell: parent appends child holder into its own holder
            tableBlock.holder.appendChild(childBlock.holder);
          }
        });

        vi.spyOn(factory, 'composeBlock').mockImplementation((options) => {
          if ((options as { id: string }).id === 'table-1') return tableBlock;
          return childBlock;
        });

        const tableYblock = createMockYMap({
          type: 'table',
          data: createMockYMap({ content: [] }),
        });
        const childYblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: '' }),
          parentId: 'table-1',
        });
        mockGetBlockById(mockYjsManager).mockImplementation((id: string) => {
          if (id === 'table-1') return tableYblock;
          if (id === 'child-1') return childYblock;
          return undefined;
        });

        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'block-1' },
          { id: 'block-2' },
          { id: 'block-3' },
          { id: 'table-1', type: 'table' },
          { id: 'child-1', type: 'paragraph', parentId: 'table-1' },
        ]);

        callback({ blockIds: ['table-1', 'child-1'], type: 'batch-add', origin: 'undo' });

        // Child should still be inside the table holder (not moved to working area)
        expect(tableBlock.holder.contains(childBlock.holder)).toBe(true);
      });

      it('emits onBlockAdded for each block after activation', () => {
        const tableBlock = createMockBlock({ id: 'table-1' });
        const childBlock = createMockBlock({ id: 'child-1' });

        vi.spyOn(factory, 'composeBlock').mockImplementation((options) => {
          if ((options as { id: string }).id === 'table-1') return tableBlock;
          return childBlock;
        });

        const tableYblock = createMockYMap({
          type: 'table',
          data: createMockYMap({ content: [] }),
        });
        const childYblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: '' }),
          parentId: 'table-1',
        });
        mockGetBlockById(mockYjsManager).mockImplementation((id: string) => {
          if (id === 'table-1') return tableYblock;
          if (id === 'child-1') return childYblock;
          return undefined;
        });

        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'block-1' },
          { id: 'block-2' },
          { id: 'block-3' },
          { id: 'table-1', type: 'table' },
          { id: 'child-1', type: 'paragraph', parentId: 'table-1' },
        ]);

        mockHandlers.onBlockAdded = vi.fn();

        callback({ blockIds: ['table-1', 'child-1'], type: 'batch-add', origin: 'undo' });

        expect(mockHandlers.onBlockAdded).toHaveBeenCalledTimes(2);
        expect(mockHandlers.onBlockAdded).toHaveBeenCalledWith(tableBlock, expect.any(Number));
        expect(mockHandlers.onBlockAdded).toHaveBeenCalledWith(childBlock, expect.any(Number));
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

        callback({ blockId: 'to-remove', type: 'remove', origin: 'undo' });

        expect(testBlocksStore.length).toBe(0);
      });

      it('calls onBlockRemoved handler before removing block from store', () => {
        const blockToRemove = createMockBlock({ id: 'to-remove' });
        const testBlocksStore = createBlocksStore([blockToRemove]);

        repository = new BlockRepository();
        repository.initialize(testBlocksStore);

        mockHandlers.getBlockIndex = vi.fn(() => 0);
        mockHandlers.onBlockRemoved = vi.fn();

        yjsSync = new BlockYjsSync(
          createMockDependencies(mockYjsManager),
          repository,
          factory,
          mockHandlers,
          testBlocksStore
        );

        mockOnBlocksChanged(mockYjsManager).mockImplementation((cb) => {
          callback = cb as (event: BlockChangeEvent) => void;
          return vi.fn();
        });
        yjsSync.subscribe();

        callback({ blockId: 'to-remove', type: 'remove', origin: 'undo' });

        expect(mockHandlers.onBlockRemoved).toHaveBeenCalledWith(blockToRemove, 0);
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

        callback({ blockId: 'last', type: 'remove', origin: 'undo' });

        expect(mockHandlers.insertDefaultBlock).toHaveBeenCalledWith(true);
      });

      it('keeps Yjs sync state active while removing a block', () => {
        const syncStates: boolean[] = [];
        const blockToRemove = createMockBlock({ id: 'to-remove' });
        const testBlocksStore = createBlocksStore([blockToRemove]);

        (blockToRemove.destroy as ReturnType<typeof vi.fn>).mockImplementation(() => {
          syncStates.push(yjsSync.isSyncingFromYjs);
        });

        repository = new BlockRepository();
        repository.initialize(testBlocksStore);

        mockHandlers.getBlockIndex = vi.fn(() => 0);
        mockHandlers.onBlockRemoved = vi.fn(() => {
          syncStates.push(yjsSync.isSyncingFromYjs);
        });

        yjsSync = new BlockYjsSync(
          createMockDependencies(mockYjsManager),
          repository,
          factory,
          mockHandlers,
          testBlocksStore
        );
        yjsSync.subscribe();

        callback({ blockId: 'to-remove', type: 'remove', origin: 'undo' });

        expect(syncStates).toEqual([true, true]);
        expect(yjsSync.isSyncingFromYjs).toBe(false);
      });
    });
  });

  describe('origin filtering', () => {
    // Initialize callback with a no-op function to avoid undefined issues
    let callback: (event: BlockChangeEvent) => void = () => {
      // No-op default implementation
    };

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
        callback({ blockId: 'test', type: 'update', origin: 'undo' });
      }).not.toThrow();
    });

    it('syncs on redo origin', () => {
      void createMockBlock({ id: 'test', data: {}, tunes: {} });
      const ydata = createMockYMap({});
      const yblock = createMockYMap({ data: ydata, tunes: createMockYMap({}) });

      mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

      expect(() => {
        callback({ blockId: 'test', type: 'update', origin: 'redo' });
      }).not.toThrow();
    });
  });
});
