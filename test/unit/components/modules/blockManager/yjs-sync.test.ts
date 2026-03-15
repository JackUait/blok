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
  contentIds?: string[];
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
    contentIds: options.contentIds ?? [],
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
  setBlockParent: vi.fn(),
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

        // Mock requestAnimationFrame for deterministic control over when cleanup fires
        let scheduledRafCallback: FrameRequestCallback | undefined;
        const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
          scheduledRafCallback = cb;
          return 0;
        });

        try {
          callback({ blockId: 'test-block', type: 'update', origin: 'undo' });

          // Immediately after the event, isSyncingFromYjs should be true
          expect(yjsSync.isSyncingFromYjs).toBe(true);

          // Wait for setData promise to resolve (RAF cleanup is now scheduled but not fired)
          await new Promise(resolve => setTimeout(resolve, 0));

          // After setData resolves, isSyncingFromYjs should still be true
          // (cleanup deferred to RAF which hasn't fired yet)
          expect(yjsSync.isSyncingFromYjs).toBe(true);
          expect(scheduledRafCallback).toBeDefined();

          // Manually fire the RAF callback to simulate the next animation frame
          scheduledRafCallback?.(performance.now());

          // Now it should be false
          expect(yjsSync.isSyncingFromYjs).toBe(false);
        } finally {
          rafSpy.mockRestore();
        }
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

      it('preserves contentIds when replacing block due to tunes change', () => {
        /**
         * Bug 2 regression: handleYjsUpdate must carry over contentIds when
         * recreating a block because tunes changed.
         */
        const block = createMockBlock({
          id: 'toggle-block',
          data: { text: 'toggle' },
          tunes: { toggleOpen: true },
          contentIds: ['child-1', 'child-2'],
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

        const ydata = createMockYMap({ text: 'toggle' });
        const yblock = createMockYMap({
          type: 'paragraph',
          data: ydata,
          tunes: createMockYMap({ toggleOpen: false }),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

        const newBlock = createMockBlock({ id: 'toggle-block' });
        const composeBlockSpy = vi.spyOn(factory, 'composeBlock').mockReturnValue(newBlock);
        mockHandlers.getBlockIndex = vi.fn(() => 0);

        callback({ blockId: 'toggle-block', type: 'update', origin: 'undo' });

        expect(composeBlockSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            contentIds: ['child-1', 'child-2'],
          })
        );
      });

      it('preserves contentIds when replacing block due to setData failure', async () => {
        /**
         * Bug 2 regression: handleYjsUpdate must carry over contentIds when
         * falling back to block replacement because setData returns false.
         */
        const block = createMockBlock({
          id: 'toggle-block',
          data: { text: 'toggle' },
          tunes: {},
          contentIds: ['child-a', 'child-b'],
        });

        (block.setData as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(false));

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

        const ydata = createMockYMap({ text: 'updated toggle' });
        const yblock = createMockYMap({
          type: 'paragraph',
          data: ydata,
          tunes: createMockYMap({}),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

        const newBlock = createMockBlock({ id: 'toggle-block' });
        const composeBlockSpy = vi.spyOn(factory, 'composeBlock').mockReturnValue(newBlock);
        mockHandlers.getBlockIndex = vi.fn(() => 0);

        callback({ blockId: 'toggle-block', type: 'update', origin: 'undo' });

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(composeBlockSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            contentIds: ['child-a', 'child-b'],
          })
        );
      });

      it('preserves parentId when replacing block due to tunes change', () => {
        /**
         * Bug 2 regression: handleYjsUpdate must carry over parentId when
         * recreating a block because tunes changed.
         */
        const block = createMockBlock({
          id: 'child-block',
          data: { text: 'child' },
          tunes: { alignment: 'left' },
          parentId: 'parent-1',
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

        const ydata = createMockYMap({ text: 'child' });
        const yblock = createMockYMap({
          type: 'paragraph',
          data: ydata,
          tunes: createMockYMap({ alignment: 'center' }),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

        const newBlock = createMockBlock({ id: 'child-block' });
        const composeBlockSpy = vi.spyOn(factory, 'composeBlock').mockReturnValue(newBlock);
        mockHandlers.getBlockIndex = vi.fn(() => 0);

        callback({ blockId: 'child-block', type: 'update', origin: 'undo' });

        expect(composeBlockSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            parentId: 'parent-1',
          })
        );
      });

      it('preserves parentId when replacing block due to setData failure', async () => {
        /**
         * Bug 2 regression: handleYjsUpdate must carry over parentId when
         * falling back to block replacement because setData returns false.
         */
        const block = createMockBlock({
          id: 'child-block',
          data: { text: 'child' },
          tunes: {},
          parentId: 'parent-1',
        });

        (block.setData as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(false));

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

        const ydata = createMockYMap({ text: 'updated child' });
        const yblock = createMockYMap({
          type: 'paragraph',
          data: ydata,
          tunes: createMockYMap({}),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);

        const newBlock = createMockBlock({ id: 'child-block' });
        const composeBlockSpy = vi.spyOn(factory, 'composeBlock').mockReturnValue(newBlock);
        mockHandlers.getBlockIndex = vi.fn(() => 0);

        callback({ blockId: 'child-block', type: 'update', origin: 'undo' });

        await new Promise(resolve => setTimeout(resolve, 0));

        expect(composeBlockSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            parentId: 'parent-1',
          })
        );
      });

      it('reconciles orphaned children after block replacement in handleYjsUpdate', async () => {
        /**
         * Bug 3 regression: after replaceBlock in handleYjsUpdate,
         * reconcileOrphanedChildren must fix child blocks whose in-memory
         * parentId is stale while Yjs records the correct parentId.
         */
        const parentBlock = createMockBlock({
          id: 'parent-block',
          data: { text: 'parent' },
          tunes: {},
          contentIds: ['child-block'],
        });

        const childBlock = createMockBlock({
          id: 'child-block',
          parentId: 'stale-old-parent',
        });

        (parentBlock.setData as ReturnType<typeof vi.fn>).mockReturnValue(Promise.resolve(false));

        const newBlocksStore = createBlocksStore([parentBlock, childBlock]);

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

        const parentYdata = createMockYMap({ text: 'parent updated' });
        const parentYblock = createMockYMap({
          type: 'paragraph',
          data: parentYdata,
          tunes: createMockYMap({}),
        });

        const childYblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: '' }),
          parentId: 'parent-block',
        });

        mockGetBlockById(mockYjsManager).mockImplementation((id: string) => {
          if (id === 'parent-block') return parentYblock;
          if (id === 'child-block') return childYblock;
          return undefined;
        });

        const newBlock = createMockBlock({ id: 'parent-block' });
        vi.spyOn(factory, 'composeBlock').mockReturnValue(newBlock);
        mockHandlers.getBlockIndex = vi.fn(() => 0);

        expect(childBlock.parentId).toBe('stale-old-parent');

        callback({ blockId: 'parent-block', type: 'update', origin: 'undo' });

        await new Promise(resolve => setTimeout(resolve, 0));

        // reconcileOrphanedChildren must call setBlockParent to fully restore
        // DOM placement, parent contentIds, and visibility — not just set parentId.
        expect(mockHandlers.setBlockParent).toHaveBeenCalledWith(childBlock, 'parent-block');
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

      it('reconciles orphaned children whose Yjs parentId matches restored block (Bug 3 regression)', () => {
        /**
         * Regression test for Bug 3:
         * When replace() converts a toggle to paragraph:
         *   - toggle (id A) is removed from Yjs; paragraph (id B) is added
         *   - in JS memory: child.parentId is set to B OUTSIDE the Yjs transaction
         *
         * After undo:
         *   - Yjs re-adds block A (toggle) via handleYjsAdd
         *   - Yjs removes block B (paragraph) via handleYjsRemove
         *
         * Child blocks still have parentId = B in memory (orphaned).
         * The Yjs state for the child still records parentId = A (correct).
         *
         * Fix: handleYjsAdd must scan existing blocks and reconcile any
         * whose Yjs parentId = A but in-memory parentId ≠ A.
         */

        // Set up: child block exists in repository with stale in-memory parentId = 'paragraph-id'
        const childBlock = createMockBlock({ id: 'child-id', parentId: 'paragraph-id' });
        const testBlocksStore = createBlocksStore([childBlock]);

        repository = new BlockRepository();
        repository.initialize(testBlocksStore);

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

        // Yjs state: child block has parentId = 'toggle-id' (correct/original)
        const childYblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: '' }),
          parentId: 'toggle-id',
        });

        // toggle yblock has no parentId
        const toggleYblock = createMockYMap({
          type: 'toggle',
          data: createMockYMap({}),
        });

        mockGetBlockById(mockYjsManager).mockImplementation((id: string) => {
          if (id === 'toggle-id') return toggleYblock;
          if (id === 'child-id') return childYblock;
          return undefined;
        });

        // Yjs toJSON: toggle is now restored at index 0
        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'toggle-id', type: 'toggle' },
          { id: 'child-id', type: 'paragraph', parentId: 'toggle-id' },
        ]);

        const restoredToggle = createMockBlock({ id: 'toggle-id' });
        vi.spyOn(factory, 'composeBlock').mockReturnValue(restoredToggle);

        // Before undo: child has stale parentId pointing to removed paragraph
        expect(childBlock.parentId).toBe('paragraph-id');

        // Simulate undo: Yjs re-adds the toggle
        callback({ blockId: 'toggle-id', type: 'add', origin: 'undo' });

        // After undo: reconcileOrphanedChildren must call setBlockParent to
        // fully restore DOM placement, parent contentIds, and visibility.
        expect(mockHandlers.setBlockParent).toHaveBeenCalledWith(childBlock, 'toggle-id');
      });

      it('calls setBlockParent handler (not just updateIndentation) when parentId is defined', () => {
        /**
         * Regression test for Fix 2:
         * When a Yjs 'add' event fires for a block with a parentId (redo restoring a
         * toggle child), handleYjsAdd() must call setBlockParent() so that:
         * 1. The block is moved into the toggle's [data-blok-toggle-children] container
         * 2. The parent's contentIds array is updated
         *
         * Previously only updateIndentation() was called, which only applied visual
         * indentation — the block was never actually placed inside the toggle container.
         */
        const parentBlock = createMockBlock({ id: 'toggle-id' });
        const testBlocksStore = createBlocksStore([parentBlock]);

        repository = new BlockRepository();
        repository.initialize(testBlocksStore);

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

        const yblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: 'child text' }),
          parentId: 'toggle-id',
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);
        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'toggle-id', type: 'toggle' },
          { id: 'child-block', type: 'paragraph', parentId: 'toggle-id' },
        ]);

        const childBlock = createMockBlock({ id: 'child-block' });
        vi.spyOn(factory, 'composeBlock').mockReturnValue(childBlock);

        callback({ blockId: 'child-block', type: 'add', origin: 'redo' });

        // setBlockParent must be called to move the block into the toggle container
        // and update parent's contentIds
        expect(mockHandlers.setBlockParent).toHaveBeenCalledWith(childBlock, 'toggle-id');

        // updateIndentation should NOT be called separately (setBlockParent handles it)
        expect(mockHandlers.updateIndentation).not.toHaveBeenCalled();
      });

      it('does not call setBlockParent when parentId is not defined', () => {
        const yblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: 'root block' }),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(yblock);
        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'new-block', type: 'paragraph' },
        ]);

        const newBlock = createMockBlock({ id: 'new-block' });
        vi.spyOn(factory, 'composeBlock').mockReturnValue(newBlock);

        callback({ blockId: 'new-block', type: 'add', origin: 'redo' });

        expect(mockHandlers.setBlockParent).not.toHaveBeenCalled();
        expect(mockHandlers.updateIndentation).not.toHaveBeenCalled();
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

      it('re-triggers rendered lifecycle on restored block after reconcileOrphanedChildren adds children', () => {
        /**
         * Bug: When handleYjsAdd restores a toggle parent via undo:
         * 1. Toggle is created and rendered() fires — sees 0 children, shows placeholder
         * 2. reconcileOrphanedChildren fixes orphaned children via setBlockParent
         * 3. Nobody notifies the toggle to re-check visibility
         *
         * Fix: After reconcileOrphanedChildren, if the restored block received
         * any reconciled children, call block.call('rendered') to trigger
         * the toggle to update its visibility state.
         */

        // Setup: child block exists with stale parentId
        const childBlock = createMockBlock({ id: 'child-id', parentId: 'old-parent-id' });
        const testBlocksStore = createBlocksStore([childBlock]);

        repository = new BlockRepository();
        repository.initialize(testBlocksStore);

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

        // Yjs state: child has parentId = 'toggle-id' (correct), toggle has no parent
        const childYblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: '' }),
          parentId: 'toggle-id',
        });

        const toggleYblock = createMockYMap({
          type: 'toggle',
          data: createMockYMap({}),
        });

        mockGetBlockById(mockYjsManager).mockImplementation((id: string) => {
          if (id === 'toggle-id') return toggleYblock;
          if (id === 'child-id') return childYblock;
          return undefined;
        });

        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'toggle-id', type: 'toggle' },
          { id: 'child-id', type: 'paragraph', parentId: 'toggle-id' },
        ]);

        const restoredToggle = createMockBlock({ id: 'toggle-id' });
        vi.spyOn(factory, 'composeBlock').mockReturnValue(restoredToggle);

        // Act: simulate undo restoring the toggle
        callback({ blockId: 'toggle-id', type: 'add', origin: 'undo' });

        // Assert: block.call('rendered') must be called TWICE on the restored toggle:
        // 1. Once by blocksStore.insert (normal lifecycle during DOM insertion)
        // 2. Once AFTER reconcileOrphanedChildren (so the toggle re-checks children
        //    and hides the body placeholder)
        const renderedCalls = (restoredToggle.call as ReturnType<typeof vi.fn>).mock.calls
          .filter((args: unknown[]) => args[0] === 'rendered');

        expect(renderedCalls).toHaveLength(2);
      });

      it('does NOT re-trigger rendered when no children were reconciled', () => {
        /**
         * If reconcileOrphanedChildren doesn't find any orphaned children,
         * there's no need to re-trigger rendered. The only rendered call
         * should be from blocksStore.insert (the normal lifecycle).
         */
        const testBlocksStore = createBlocksStore([]);

        repository = new BlockRepository();
        repository.initialize(testBlocksStore);

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

        const toggleYblock = createMockYMap({
          type: 'toggle',
          data: createMockYMap({}),
        });

        mockGetBlockById(mockYjsManager).mockReturnValue(toggleYblock);
        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'toggle-id', type: 'toggle' },
        ]);

        const restoredToggle = createMockBlock({ id: 'toggle-id' });
        vi.spyOn(factory, 'composeBlock').mockReturnValue(restoredToggle);

        callback({ blockId: 'toggle-id', type: 'add', origin: 'undo' });

        // No orphaned children exist, so setBlockParent should not be called
        // by reconcileOrphanedChildren
        expect(mockHandlers.setBlockParent).not.toHaveBeenCalled();
        // block.call('rendered') should only be called once — by blocksStore.insert.
        // Our fix should NOT add an extra rendered call when no children were reconciled.
        const renderedCalls = (restoredToggle.call as ReturnType<typeof vi.fn>).mock.calls
          .filter((args: unknown[]) => args[0] === 'rendered');

        expect(renderedCalls).toHaveLength(1);
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

      it('calls setBlockParent (not updateIndentation) for each block with parentId', () => {
        /**
         * Regression test for Fix 2 (batch-add path):
         * When multiple blocks are restored via batch-add (e.g. toggle + its children),
         * handleYjsBatchAdd() must call setBlockParent() for blocks with a parentId so that:
         * 1. The block is moved into the toggle's [data-blok-toggle-children] container
         * 2. The parent's contentIds array is updated
         *
         * Previously only updateIndentation() was called for the parent-id path.
         */
        const toggleBlock = createMockBlock({ id: 'toggle-1' });
        const childBlock2 = createMockBlock({ id: 'child-2' });

        vi.spyOn(factory, 'composeBlock').mockImplementation((options) => {
          if ((options as { id: string }).id === 'toggle-1') return toggleBlock;
          return childBlock2;
        });

        const toggleYblock = createMockYMap({
          type: 'toggle',
          data: createMockYMap({}),
        });
        const childYblock2 = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: '' }),
          parentId: 'toggle-1',
        });
        mockGetBlockById(mockYjsManager).mockImplementation((id: string) => {
          if (id === 'toggle-1') return toggleYblock;
          if (id === 'child-2') return childYblock2;
          return undefined;
        });

        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'block-1' },
          { id: 'block-2' },
          { id: 'block-3' },
          { id: 'toggle-1', type: 'toggle' },
          { id: 'child-2', type: 'paragraph', parentId: 'toggle-1' },
        ]);

        mockHandlers.setBlockParent = vi.fn();

        callback({ blockIds: ['toggle-1', 'child-2'], type: 'batch-add', origin: 'redo' });

        // setBlockParent must be called for the child block with parentId
        expect(mockHandlers.setBlockParent).toHaveBeenCalledWith(childBlock2, 'toggle-1');

        // updateIndentation should NOT be called separately (setBlockParent handles it)
        expect(mockHandlers.updateIndentation).not.toHaveBeenCalled();

        // setBlockParent should NOT be called for the toggle block (no parentId)
        expect(mockHandlers.setBlockParent).not.toHaveBeenCalledWith(toggleBlock, expect.anything());
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

        // Mock RAF so cleanup is deferred
        let rafCallback: FrameRequestCallback | undefined;
        const originalRAF = globalThis.requestAnimationFrame;

        globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
          rafCallback = cb;
          return 0;
        });

        try {
          callback({ blockId: 'to-remove', type: 'remove', origin: 'undo' });

          // During execution, isSyncingFromYjs was true
          expect(syncStates).toEqual([true, true]);
          // After synchronous return, still true (RAF extension)
          expect(yjsSync.isSyncingFromYjs).toBe(true);
          // After RAF fires, drops to false
          rafCallback!(0);
          expect(yjsSync.isSyncingFromYjs).toBe(false);
        } finally {
          globalThis.requestAnimationFrame = originalRAF;
        }
      });

      it('extends isSyncingFromYjs through RAF after removing a block', () => {
        /**
         * handleYjsRemove must use extendThroughRAF so that deferred DOM
         * callbacks (e.g., toggle's updateBodyPlaceholderVisibility triggered
         * by the block-removed event) run while isSyncingFromYjs is still
         * true. Without this, those callbacks can trigger syncBlockDataToYjs
         * with 'local' origin, clearing the redo stack.
         */
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

        mockOnBlocksChanged(mockYjsManager).mockImplementation((cb) => {
          callback = cb as (event: BlockChangeEvent) => void;
          return vi.fn();
        });
        yjsSync.subscribe();

        // Mock requestAnimationFrame for deterministic control
        let rafCallback: FrameRequestCallback | undefined;
        const originalRAF = globalThis.requestAnimationFrame;

        globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
          rafCallback = cb;
          return 0;
        });

        try {
          callback({ blockId: 'to-remove', type: 'remove', origin: 'undo' });

          // After synchronous execution, isSyncingFromYjs should STILL be true
          // because cleanup is deferred through RAF
          expect(yjsSync.isSyncingFromYjs).toBe(true);

          // After RAF fires, isSyncingFromYjs should drop to false
          expect(rafCallback).toBeDefined();
          rafCallback!(0);
          expect(yjsSync.isSyncingFromYjs).toBe(false);
        } finally {
          globalThis.requestAnimationFrame = originalRAF;
        }
      });

      it('promotes children to root level when removing a parent block', () => {
        /**
         * When handleYjsRemove removes a block that has children (contentIds),
         * it must promote those children to root level (set parentId = null and
         * remove the hidden class) — matching the behavior of removeBlock() in
         * operations.ts.
         *
         * Without this, children whose DOM is inside the toggle's container are
         * destroyed with the parent, and children in the blocks array become
         * orphaned with a stale parentId pointing to a deleted block.
         */
        const childA = createMockBlock({ id: 'child-a', parentId: 'toggle-id' });
        const childB = createMockBlock({ id: 'child-b', parentId: 'toggle-id' });

        childA.holder.classList.add('hidden');
        childB.holder.classList.add('hidden');

        const toggleBlock = createMockBlock({
          id: 'toggle-id',
          contentIds: ['child-a', 'child-b'],
        });

        const testBlocksStore = createBlocksStore([toggleBlock, childA, childB]);

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

        mockOnBlocksChanged(mockYjsManager).mockImplementation((cb) => {
          callback = cb as (event: BlockChangeEvent) => void;
          return vi.fn();
        });
        yjsSync.subscribe();

        callback({ blockId: 'toggle-id', type: 'remove', origin: 'redo' });

        // Children must be promoted: parentId = null, hidden class removed
        expect(childA.parentId).toBe(null);
        expect(childB.parentId).toBe(null);
        expect(childA.holder.classList.contains('hidden')).toBe(false);
        expect(childB.holder.classList.contains('hidden')).toBe(false);
      });
    });

    describe('reconcileOrphanedChildren', () => {
      it('calls setBlockParent for orphaned children to restore full DOM placement', () => {
        /**
         * When reconcileOrphanedChildren finds a child whose Yjs parentId matches
         * the restored block but whose in-memory parentId does not, it must call
         * handlers.setBlockParent() — not just set block.parentId directly.
         *
         * setBlockParent() moves the child's DOM into the toggle's container,
         * updates the parent's contentIds, and adjusts visibility. Without it,
         * the toggle appears empty after undo even though children have the
         * correct parentId in memory.
         */
        const childA = createMockBlock({ id: 'child-a', parentId: null });
        const childB = createMockBlock({ id: 'child-b', parentId: null });
        const testBlocksStore = createBlocksStore([childA, childB]);

        repository = new BlockRepository();
        repository.initialize(testBlocksStore);

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

        // Yjs state: children have parentId = 'toggle-id' (authoritative)
        const childAYblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: '' }),
          parentId: 'toggle-id',
        });
        const childBYblock = createMockYMap({
          type: 'paragraph',
          data: createMockYMap({ text: '' }),
          parentId: 'toggle-id',
        });
        const toggleYblock = createMockYMap({
          type: 'toggle',
          data: createMockYMap({}),
        });

        mockGetBlockById(mockYjsManager).mockImplementation((id: string) => {
          if (id === 'toggle-id') return toggleYblock;
          if (id === 'child-a') return childAYblock;
          if (id === 'child-b') return childBYblock;
          return undefined;
        });

        mockToJSON(mockYjsManager).mockReturnValue([
          { id: 'toggle-id', type: 'toggle' },
          { id: 'child-a', type: 'paragraph', parentId: 'toggle-id' },
          { id: 'child-b', type: 'paragraph', parentId: 'toggle-id' },
        ]);

        const restoredToggle = createMockBlock({ id: 'toggle-id' });
        vi.spyOn(factory, 'composeBlock').mockReturnValue(restoredToggle);

        // Simulate undo: Yjs re-adds the toggle
        callback({ blockId: 'toggle-id', type: 'add', origin: 'undo' });

        // setBlockParent must be called for EACH orphaned child
        expect(mockHandlers.setBlockParent).toHaveBeenCalledWith(childA, 'toggle-id');
        expect(mockHandlers.setBlockParent).toHaveBeenCalledWith(childB, 'toggle-id');
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
