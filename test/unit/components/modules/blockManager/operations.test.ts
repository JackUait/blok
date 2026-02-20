import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { BlockOperations } from '../../../../../src/components/modules/blockManager/operations';
import type { BlockOperationsDependencies, BlockDidMutated } from '../../../../../src/components/modules/blockManager/operations';
import { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import { BlockHierarchy } from '../../../../../src/components/modules/blockManager/hierarchy';
import type { BlockYjsSync } from '../../../../../src/components/modules/blockManager/yjs-sync';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import { Blocks } from '../../../../../src/components/blocks';
import type { Block } from '../../../../../src/components/block';
import type { BlockToolAdapter } from '../../../../../src/components/tools/block';
import { ToolsCollection } from '../../../../../src/components/tools/collection';
import { ToolType } from '@/types/tools/adapters/tool-type';
import type { BlockTool } from '@/types/tools/block-tool';
import type { BlockToolConstructable } from '@/types/tools/block-tool';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlokConfig } from '@/types/configs';
import type { API } from '../../../../../src/components/modules/api';
import type { YjsManager } from '../../../../../src/components/modules/yjs';
import type { Caret } from '../../../../../src/components/modules/caret';
import type { I18n } from '../../../../../src/components/modules/i18n';
import type { BlockMutationType, BlockToolData, PasteEvent } from '@/types';
import { BlockAddedMutationType } from '../../../../../types/events/block/BlockAdded';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import { BlockMovedMutationType } from '../../../../../types/events/block/BlockMoved';
import { BlockRemovedMutationType } from '../../../../../types/events/block/BlockRemoved';

/**
 * Create a mock Block for testing
 */
const createMockBlock = (options: {
  id?: string;
  name?: string;
  parentId?: string | null;
  contentIds?: string[];
  data?: BlockToolData;
  tunes?: Record<string, unknown>;
  mergeable?: boolean;
  isEmpty?: boolean;
} = {}): Block => {
  const holder = document.createElement('div');
  holder.setAttribute('data-blok-element', '');
  const input = document.createElement('div');
  input.contentEditable = 'true';
  input.setAttribute('contenteditable', 'true'); // Set attribute for querySelector to work in JSDOM
  holder.appendChild(input);

  const blockData = options.data ?? {};
  const tunes = options.tunes ?? {};

  const block = {
    id: options.id ?? `block-${Math.random().toString(16).slice(2)}`,
    name: options.name ?? 'paragraph',
    holder,
    inputs: [input],
    parentId: options.parentId ?? null,
    contentIds: options.contentIds ?? [],
    mergeable: options.mergeable ?? false,
    mergeWith: vi.fn(),
    exportDataAsString: vi.fn().mockResolvedValue('<p>Test</p>'),
    isEmpty: options.isEmpty ?? false,
    data: Promise.resolve(blockData),
    preservedData: blockData,
    preservedTunes: tunes,
    save: vi.fn().mockResolvedValue({ data: blockData }),
    unwatchBlockMutations: vi.fn(),
    ready: Promise.resolve(),
    call: vi.fn(),
    refreshToolRootElement: vi.fn(),
    destroy: vi.fn(),
    tool: {
      name: options.name ?? 'paragraph',
      sanitizeConfig: {},
      conversionConfig: {
        import: 'text',
        export: 'text',
      },
      settings: {},
    },
    tunes,
  } as unknown as Block;

  Object.defineProperty(block, 'preservedData', {
    get: () => blockData,
  });

  Object.defineProperty(block, 'preservedTunes', {
    get: () => tunes,
  });

  return block;
};

/**
 * Create a BlocksStore with mock blocks
 */
const createBlocksStore = (blocks: Block[]): BlocksStore => {
  const workingArea = document.createElement('div');
  const blocksStore = new Blocks(workingArea);

  for (const block of blocks) {
    blocksStore.push(block);
  }

  // Return proxied BlocksStore to match actual BlockManager setup
  return new Proxy(blocksStore, {
    set: Blocks.set,
    get: Blocks.get,
  }) as unknown as BlocksStore;
};

/**
 * Create mock dependencies for BlockOperations
 */
const createMockDependencies = (): BlockOperationsDependencies => {
  const eventsDispatcher = new EventsDispatcher<BlokEventMap>();

  return {
    config: {
      defaultBlock: 'paragraph',
      sanitizer: {},
    } as BlokConfig,
    YjsManager: {
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
    } as unknown as YjsManager,
    Caret: {
      extractFragmentFromCaretPosition: vi.fn(() => document.createDocumentFragment()),
      setToBlock: vi.fn(),
      positions: { START: 'start', END: 'end' },
    } as unknown as Caret,
    I18n: {
      t: vi.fn((key: string) => key),
    } as unknown as I18n,
    eventsDispatcher,
  };
};

/**
 * Create a properly typed mock BlockToolAdapter for testing
 */
const createMockBlockToolAdapter = (name: string): BlockToolAdapter => {
  // Create a mock BlockTool constructable class
  const MockBlockTool = class implements BlockTool {
    render = vi.fn(() => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.setAttribute('contenteditable', 'true');
      return div;
    });

    save = vi.fn(() => ({}));

    rendered() {}

    sanitize = {};
  };

  // Build a partial adapter object then cast to BlockToolAdapter
  // Using a flexible type first to avoid property conflicts
  const partialAdapter = {
    constructable: MockBlockTool as BlockToolConstructable,
    create: vi.fn((_data, _block, _readOnly) => new MockBlockTool()),
    sanitizeConfig: {},
    conversionConfig: {
      import: 'text',
      export: 'text',
    },
    settings: {},
    toolbox: undefined,
    tunes: new ToolsCollection(),
    inlineTools: new ToolsCollection(),
    api: {},
    config: {},
    isInternal: false,
    isDefault: false,
    prepare: vi.fn(),
    reset: vi.fn(),
    enabledInlineTools: true,
    enabledBlockTunes: undefined,
    pasteConfig: {},
    hasOnPasteHandler: false,
    isReadOnlySupported: false,
    isLineBreaksEnabled: false,
    baseSanitizeConfig: {},
  };

  // Cast to BlockToolAdapter with proper method signatures
  const adapter = {
    type: ToolType.Block,
    name,
    ...partialAdapter,
    isBlock(this: BlockToolAdapter): this is BlockToolAdapter {
      return this.type === ToolType.Block;
    },
    isInline(this: { type: ToolType }): this is { type: ToolType.Inline } {
      return this.type === ToolType.Inline;
    },
    isTune(this: { type: ToolType }): this is { type: ToolType.Tune } {
      return this.type === ToolType.Tune;
    },
  } as unknown as BlockToolAdapter;

  return adapter;
};

/**
 * Create mock BlockFactory
 */
const createMockBlockFactory = (): BlockFactory => {
  const mockAPI = {} as unknown as API;
  const mockEventsDispatcher = new EventsDispatcher<BlokEventMap>();
  const mockTools = new ToolsCollection<BlockToolAdapter>();

  // Add default tool
  const defaultAdapter = createMockBlockToolAdapter('paragraph');
  mockTools.set('paragraph', defaultAdapter);

  const bindBlockEvents = vi.fn();

  return new BlockFactory({
    API: mockAPI,
    eventsDispatcher: mockEventsDispatcher,
    tools: mockTools,
    moduleInstances: {
      ReadOnly: { isEnabled: false },
    } as never,
  }, bindBlockEvents);
};

/**
 * Create mock BlockYjsSync
 */
const createMockYjsSync = (): BlockYjsSync => {
  const mockYjsSync = {
    isSyncingFromYjs: false,
    withAtomicOperation: vi.fn(<T>(fn: () => T): T => fn()),
    subscribe: vi.fn(() => vi.fn()),
    updateBlocksStore: vi.fn(),
    syncBlockDataToYjs: vi.fn(),
    isBlockDataChanged: vi.fn(() => false),
  } as unknown as BlockYjsSync;

  return mockYjsSync;
};

describe('BlockOperations', () => {
  let repository: BlockRepository;
  let factory: BlockFactory;
  let hierarchy: BlockHierarchy;
  let yjsSync: BlockYjsSync;
  let operations: BlockOperations;
  let dependencies: BlockOperationsDependencies;
  let blocksStore: BlocksStore;
  let blockDidMutatedSpy: Mock<BlockDidMutated>;

  beforeEach(() => {
    dependencies = createMockDependencies();

    // Setup blocks
    const blocks = [
      createMockBlock({ id: 'block-1', name: 'paragraph' }),
      createMockBlock({ id: 'block-2', name: 'paragraph' }),
      createMockBlock({ id: 'block-3', name: 'paragraph' }),
    ];
    blocksStore = createBlocksStore(blocks);

    // Setup repository
    repository = new BlockRepository();
    repository.initialize(blocksStore);

    // Setup factory
    factory = createMockBlockFactory();

    // Setup hierarchy
    hierarchy = new BlockHierarchy(repository);

    // Setup YjsSync
    yjsSync = createMockYjsSync();

    // Setup block mutation callback
    blockDidMutatedSpy = vi.fn(<Type extends BlockMutationType>(
      _mutationType: Type,
      block: Block,
      _detailData: unknown
    ) => block);

    // Create operations
    operations = new BlockOperations(
      dependencies,
      repository,
      factory,
      hierarchy,
      blockDidMutatedSpy,
      0
    );
    operations.setYjsSync(yjsSync);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('currentBlockIndexValue getter/setter', () => {
    it('returns the current block index', () => {
      expect(operations.currentBlockIndexValue).toBe(0);
    });

    it('sets the current block index', () => {
      operations.currentBlockIndexValue = 2;
      expect(operations.currentBlockIndexValue).toBe(2);
    });

    it('calls stopCapturing when index changes', () => {
      operations.currentBlockIndexValue = 1;
      expect(dependencies.YjsManager.stopCapturing).toHaveBeenCalledTimes(1);
      expect(operations.currentBlockIndexValue).toBe(1);
    });

    it('does not call stopCapturing when suppressStopCapturing is true', () => {
      operations.suppressStopCapturing = true;
      operations.currentBlockIndexValue = 1;
      expect(dependencies.YjsManager.stopCapturing).not.toHaveBeenCalled();
    });
  });

  describe('currentBlock getter', () => {
    it('returns the block at current index', () => {
      expect(operations.currentBlock?.id).toBe('block-1');
    });

    it('returns undefined when index is out of range', () => {
      operations.currentBlockIndexValue = 10;
      expect(operations.currentBlock).toBeUndefined();
    });
  });

  describe('nextBlock getter', () => {
    it('returns the next block when not at end', () => {
      expect(operations.nextBlock?.id).toBe('block-2');
    });

    it('returns null when at the last block', () => {
      operations.currentBlockIndexValue = 2;
      expect(operations.nextBlock).toBeNull();
    });

    it('returns null when blocks are empty', () => {
      const emptyRepo = new BlockRepository();
      emptyRepo.initialize(new Blocks(document.createElement('div')) as unknown as BlocksStore);
      const emptyOps = new BlockOperations(
        dependencies,
        emptyRepo,
        factory,
        hierarchy,
        blockDidMutatedSpy,
        -1
      );
      emptyOps.setYjsSync(yjsSync);

      expect(emptyOps.nextBlock).toBeNull();
    });
  });

  describe('previousBlock getter', () => {
    it('returns null when at the first block', () => {
      expect(operations.previousBlock).toBeNull();
    });

    it('returns the previous block when not at start', () => {
      operations.currentBlockIndexValue = 1;
      expect(operations.previousBlock?.id).toBe('block-1');
    });

    it('returns null when no blocks exist', () => {
      const emptyRepo = new BlockRepository();
      emptyRepo.initialize(new Blocks(document.createElement('div')) as unknown as BlocksStore);
      const emptyOps = new BlockOperations(
        dependencies,
        emptyRepo,
        factory,
        hierarchy,
        blockDidMutatedSpy,
        -1
      );
      emptyOps.setYjsSync(yjsSync);

      expect(emptyOps.previousBlock).toBeNull();
    });
  });

  describe('insert', () => {
    it('inserts a new block using default tool', () => {
      const newBlock = operations.insert({}, blocksStore);

      expect(newBlock).toBeDefined();
      expect(dependencies.YjsManager.addBlock).toHaveBeenCalled();
    });

    it('inserts a block with specified tool', () => {
      const newBlock = operations.insert({ tool: 'paragraph' }, blocksStore);

      expect(newBlock).toBeDefined();
    });

    it('throws error when tool is not specified and no default tool', () => {
      dependencies.config.defaultBlock = undefined;

      expect(() => operations.insert({ tool: undefined }, blocksStore)).toThrow(
        'Could not insert Block. Tool name is not specified.'
      );
    });

    it('dispatches block-removed event when replacing', () => {
      operations.insert({ tool: 'paragraph', index: 0, replace: true }, blocksStore);

      expect(blockDidMutatedSpy).toHaveBeenCalledWith(
        BlockRemovedMutationType,
        expect.any(Object),
        { index: 0 }
      );
    });

    it('dispatches block-added event', () => {
      operations.insert({ tool: 'paragraph' }, blocksStore);

       
      const expectedDetail = expect.objectContaining({ index: expect.any(Number) });

      expect(blockDidMutatedSpy).toHaveBeenCalledWith(
        BlockAddedMutationType,
        expect.any(Object),
        expectedDetail
      );
      expect(blockDidMutatedSpy).toHaveBeenCalledTimes(1);
    });

    it('updates currentBlockIndex when needToFocus is true', () => {
      operations.insert({ tool: 'paragraph', needToFocus: true }, blocksStore);

      expect(operations.currentBlockIndexValue).toBe(1);
    });

    it('increments currentBlockIndex when inserting before current', () => {
      operations.currentBlockIndexValue = 2;
      operations.insert({ tool: 'paragraph', index: 1, needToFocus: false }, blocksStore);

      expect(operations.currentBlockIndexValue).toBe(3);
    });

    it('demotes restricted tools to paragraph when inserting inside a table cell', () => {
      // Create a table cell container in the DOM
      const tableCellContainer = document.createElement('div');
      tableCellContainer.setAttribute('data-blok-table-cell-blocks', '');
      document.body.appendChild(tableCellContainer);

      // Create a block and set up the store first (push appends holder to workingArea)
      const cellBlock = createMockBlock({ id: 'cell-block', name: 'paragraph' });
      blocksStore = createBlocksStore([cellBlock]);

      // Move the holder into the table cell container AFTER the store is created
      // (createBlocksStore's push() would otherwise move it to the workingArea)
      tableCellContainer.appendChild(cellBlock.holder);

      repository = new BlockRepository();
      repository.initialize(blocksStore);
      hierarchy = new BlockHierarchy(repository);
      operations = new BlockOperations(
        dependencies,
        repository,
        factory,
        hierarchy,
        blockDidMutatedSpy,
        0
      );
      operations.setYjsSync(yjsSync);

      // Insert a 'header' tool — should be demoted to 'paragraph'
      const newBlock = operations.insert({ tool: 'header' }, blocksStore);

      expect(newBlock).toBeDefined();
      expect(newBlock.name).toBe('paragraph');

      // Cleanup
      document.body.removeChild(tableCellContainer);
    });
  });

  describe('insertDefaultBlockAtIndex', () => {
    it('inserts default block at specified index', () => {
      const block = operations.insertDefaultBlockAtIndex(1, false, false, blocksStore);

      expect(block).toBeDefined();
      expect(dependencies.YjsManager.addBlock).toHaveBeenCalled();
    });

    it('throws error when default tool is not defined', () => {
      dependencies.config.defaultBlock = undefined;

      expect(() => operations.insertDefaultBlockAtIndex(0, false, false, blocksStore)).toThrow(
        'Could not insert default Block. Default block tool is not defined in the configuration.'
      );
    });

    it('updates currentBlockIndex when needToFocus is true', () => {
      operations.insertDefaultBlockAtIndex(1, true, false, blocksStore);

      expect(operations.currentBlockIndexValue).toBe(1);
    });
  });

  describe('insertAtEnd', () => {
    it('inserts block at the end of blocks list', () => {
      operations.currentBlockIndexValue = 2;
      const block = operations.insertAtEnd(blocksStore);

      expect(block).toBeDefined();
      expect(repository.length).toBe(4);
    });
  });

  describe('removeBlock', () => {
    it('removes the specified block', async () => {
      const blockToRemove = repository.getBlockById('block-1');
      if (!blockToRemove) {
        throw new Error('Test setup failed: block-1 not found');
      }

      await operations.removeBlock(blockToRemove, false, false, blocksStore);

      expect(repository.blocks.length).toBe(2);
      expect(repository.getBlockById('block-1')).toBeUndefined();
    });

    it('throws error when block is not found', async () => {
      const unknownBlock = createMockBlock({ id: 'unknown' });

      await expect(operations.removeBlock(unknownBlock, false, false, blocksStore)).rejects.toThrow(
        "Can't find a Block to remove"
      );
    });

    it('dispatches block-removed event', async () => {
      const blockToRemove = repository.getBlockById('block-1');
      if (!blockToRemove) {
        throw new Error('Test setup failed: block-1 not found');
      }

      await operations.removeBlock(blockToRemove, false, false, blocksStore);

      expect(blockDidMutatedSpy).toHaveBeenCalledWith(
        BlockRemovedMutationType,
        blockToRemove,
        expect.any(Object)
      );
    });

    it('syncs to Yjs when skipYjsSync is false', async () => {
      const blockToRemove = repository.getBlockById('block-1');
      if (!blockToRemove) {
        throw new Error('Test setup failed: block-1 not found');
      }

      await operations.removeBlock(blockToRemove, false, false, blocksStore);

      expect(dependencies.YjsManager.removeBlock).toHaveBeenCalledWith('block-1');
    });

    it('does not sync to Yjs when skipYjsSync is true', async () => {
      const blockToRemove = repository.getBlockById('block-1');
      if (!blockToRemove) {
        throw new Error('Test setup failed: block-1 not found');
      }

      await operations.removeBlock(blockToRemove, false, true, blocksStore);

      expect(dependencies.YjsManager.removeBlock).not.toHaveBeenCalled();
    });

    it('decrements currentBlockIndex when removing block before current', async () => {
      operations.currentBlockIndexValue = 2;
      const blockToRemove = repository.getBlockById('block-1');
      if (!blockToRemove) {
        throw new Error('Test setup failed: block-1 not found');
      }

      await operations.removeBlock(blockToRemove, false, false, blocksStore);

      expect(operations.currentBlockIndexValue).toBe(1);
    });

    it('inserts default block when last block is removed and addLastBlock is true', async () => {
      const singleBlockStore = createBlocksStore([createMockBlock({ id: 'single' })]);
      repository.initialize(singleBlockStore);
      operations.currentBlockIndexValue = 0;

      const singleBlock = repository.getBlockById('single');
      if (!singleBlock) {
        throw new Error('Test setup failed: single block not found');
      }
      await operations.removeBlock(singleBlock, true, false, singleBlockStore);

      expect(repository.length).toBeGreaterThan(0);
    });
  });

  describe('update', () => {
    it('returns original block when no data or tunes provided', async () => {
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }

      const result = await operations.update(block, blocksStore);

      expect(result).toBe(block);
    });

    it('creates new block with updated data', async () => {
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }
      const newData = { text: 'Updated text' };

      const result = await operations.update(block, blocksStore, newData);

      expect(result).not.toBe(block);
      expect(dependencies.YjsManager.updateBlockData).toHaveBeenCalledWith('block-1', 'text', 'Updated text');
    });

    it('creates new block with updated tunes', async () => {
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }
      const newTunes = { alignment: 'center' };

      await operations.update(block, blocksStore, undefined, newTunes);

      expect(dependencies.YjsManager.updateBlockTune).toHaveBeenCalledWith('block-1', 'alignment', 'center');
    });

    it('dispatches block-changed event', async () => {
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }

      await operations.update(block, blocksStore, { text: 'New' });

      expect(blockDidMutatedSpy).toHaveBeenCalledWith(
        BlockChangedMutationType,
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('replaces block in blocksStore', async () => {
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }
      const oldId = block.id;

      const newBlock = await operations.update(block, blocksStore, { text: 'New' });

      expect(newBlock.id).toBe(oldId);
      expect(repository.getBlockById(oldId)).toBe(newBlock);
    });
  });

  describe('replace', () => {
    it('replaces block with new tool', () => {
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }

      const newBlock = operations.replace(block, 'paragraph', { text: 'New' }, blocksStore);

      expect(newBlock).toBeDefined();
      expect(dependencies.YjsManager.removeBlock).toHaveBeenCalledWith(block.id);
      expect(dependencies.YjsManager.addBlock).toHaveBeenCalled();
    });

    it('uses Yjs transaction for atomic undo', () => {
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }

      const newBlock = operations.replace(block, 'paragraph', { text: 'New' }, blocksStore);

      expect(dependencies.YjsManager.transact).toHaveBeenCalled();
      expect(newBlock).toBeDefined();
    });

    it('inserts with skipYjsSync since transaction handles sync', () => {
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }
      const transactSpy = vi.fn((fn: () => void) => fn());

      (dependencies.YjsManager.transact as ReturnType<typeof vi.fn>).mockImplementation(transactSpy);

      const newBlock = operations.replace(block, 'paragraph', { text: 'New' }, blocksStore);

      expect(transactSpy).toHaveBeenCalled();
      expect(newBlock).toBeDefined();
    });
  });

  describe('move', () => {
    it('moves block to new index', () => {
      operations.move(2, 0, false, blocksStore);

      expect(repository.blocks[0].id).toBe('block-2');
    });

    it('does nothing when indices are NaN', () => {
      const initialLength = repository.length;

      operations.move(NaN, NaN, false, blocksStore);

      expect(repository.length).toBe(initialLength);
    });

    it('does nothing when indices are out of range', () => {
      const initialLength = repository.length;

      operations.move(100, 0, false, blocksStore);

      expect(repository.length).toBe(initialLength);
    });

    it('updates currentBlockIndex to toIndex', () => {
      operations.currentBlockIndexValue = 0;
      operations.move(2, 0, false, blocksStore);

      expect(operations.currentBlockIndexValue).toBe(2);
    });

    it('suppresses stopCapturing during move', () => {
      operations.currentBlockIndexValue = 0;
      operations.move(1, 0, false, blocksStore);

      expect(dependencies.YjsManager.stopCapturing).not.toHaveBeenCalled();
    });

    it('syncs move to Yjs', () => {
      operations.currentBlockIndexValue = 0;
      operations.move(1, 0, false, blocksStore);

      expect(dependencies.YjsManager.moveBlock).toHaveBeenCalled();
      expect(repository.blocks[0].id).toBe('block-2');
    });

    it('dispatches block-moved event', () => {
      operations.currentBlockIndexValue = 0;
      operations.move(1, 0, false, blocksStore);

      expect(blockDidMutatedSpy).toHaveBeenCalledWith(
        BlockMovedMutationType,
        expect.any(Object),
        expect.objectContaining({
          fromIndex: 0,
          toIndex: 1,
        })
      );
    });
  });

  describe('split', () => {
    it('throws error when no current block', () => {
      operations.currentBlockIndexValue = -1;

      expect(() => operations.split(blocksStore)).toThrow('Cannot split: no current block');
    });

    it('extracts fragment from caret position', () => {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode('split content'));

      (dependencies.Caret.extractFragmentFromCaretPosition as ReturnType<typeof vi.fn>).mockReturnValue(fragment);

      operations.currentBlockIndexValue = 0;
      const newBlock = operations.split(blocksStore);

      expect(dependencies.Caret.extractFragmentFromCaretPosition).toHaveBeenCalled();
      expect(newBlock).toBeDefined();
    });

    it('uses atomic Yjs transaction', () => {
      operations.currentBlockIndexValue = 0;
      const fragment = document.createDocumentFragment();

      (dependencies.Caret.extractFragmentFromCaretPosition as ReturnType<typeof vi.fn>).mockReturnValue(fragment);

      const newBlock = operations.split(blocksStore);

      expect(dependencies.YjsManager.transact).toHaveBeenCalled();
      expect(newBlock).toBeDefined();
    });

    it('inserts new block with skipYjsSync', () => {
      operations.currentBlockIndexValue = 0;
      const fragment = document.createDocumentFragment();

      (dependencies.Caret.extractFragmentFromCaretPosition as ReturnType<typeof vi.fn>).mockReturnValue(fragment);

      const newBlock = operations.split(blocksStore);

      expect(yjsSync.withAtomicOperation).toHaveBeenCalled();
      expect(newBlock).toBeDefined();
    });
  });

  describe('splitBlockWithData', () => {
    it('throws error when block not found', () => {
      expect(() => {
        operations.splitBlockWithData('unknown', {}, 'paragraph', {}, 0, blocksStore);
      }).toThrow('Block with id "unknown" not found');
    });

    it('splits block with provided data', () => {
      operations.currentBlockIndexValue = 0;
      const newBlock = operations.splitBlockWithData(
        'block-1',
        { text: 'Remaining' },
        'paragraph',
        { text: 'Extracted' },
        1,
        blocksStore
      );

      expect(newBlock).toBeDefined();
    });

    it('uses Yjs transaction', () => {
      operations.currentBlockIndexValue = 0;
      const newBlock = operations.splitBlockWithData('block-1', {}, 'paragraph', {}, 1, blocksStore);

      expect(dependencies.YjsManager.transact).toHaveBeenCalled();
      expect(newBlock).toBeDefined();
    });

    it('updates current block content element when text is provided', () => {
      operations.currentBlockIndexValue = 0;
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }

      operations.splitBlockWithData('block-1', { text: 'New content' }, 'paragraph', {}, 1, blocksStore);

      const contentEl = block.holder.querySelector('[contenteditable="true"]');
      expect(contentEl?.innerHTML).toBe('New content');
    });

    it('updates currentBlockIndex to focus new block', () => {
      operations.currentBlockIndexValue = 0;
      operations.splitBlockWithData('block-1', {}, 'paragraph', {}, 1, blocksStore);

      expect(operations.currentBlockIndexValue).toBe(1);
    });
  });

  describe('convert', () => {
    it('throws error when block save fails', async () => {
      const block = createMockBlock({ id: 'convert-me' });
      (block.save as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

      await expect(
        operations.convert(block, 'paragraph', blocksStore)
      ).rejects.toThrow('Could not convert Block. Failed to extract original Block data.');
    });

    it('throws error when target tool not found', async () => {
      const block = createMockBlock({ id: 'convert-me' });

      await expect(
        operations.convert(block, 'unknown-tool', blocksStore)
      ).rejects.toThrow('Could not convert Block. Tool «unknown-tool» not found.');
    });

    it('converts block using conversion config', async () => {
      // Use existing block from store instead of creating a new one
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }
      (block.exportDataAsString as ReturnType<typeof vi.fn>).mockResolvedValue('<p>Hello</p>');

      const result = await operations.convert(block, 'paragraph', blocksStore);

      expect(result).toBeDefined();
    });

    it('applies block data overrides', async () => {
      // Use existing block from store instead of creating a new one
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }
      (block.exportDataAsString as ReturnType<typeof vi.fn>).mockResolvedValue('<p>Hello</p>');

      const result = await operations.convert(block, 'paragraph', blocksStore, { level: 2 });

      expect(result).toBeDefined();
    });
  });

  describe('paste', () => {
    it('inserts block and calls onPaste callback', async () => {
      const pasteEvent: PasteEvent = {
        detail: {
          data: {
            text: 'Pasted content',
          },
        },
      } as unknown as PasteEvent;

      const result = await operations.paste('paragraph', pasteEvent, false, blocksStore);

      expect(result).toBeDefined();
    });

    it('syncs final state to Yjs after paste', async () => {
      const pasteEvent: PasteEvent = {
        detail: {
          data: {
            text: 'Pasted',
          },
        },
      } as unknown as PasteEvent;

      const result = await operations.paste('paragraph', pasteEvent, false, blocksStore);

      expect(dependencies.YjsManager.addBlock).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('uses atomic operation during paste processing', async () => {
      const pasteEvent: PasteEvent = {} as PasteEvent;

      const result = await operations.paste('paragraph', pasteEvent, false, blocksStore);

      expect(yjsSync.withAtomicOperation).toHaveBeenCalled();
      expect(result).toBeDefined();
    });
  });

  describe('moveCurrentBlockUp', () => {
    it('does nothing when already at top', () => {
      operations.currentBlockIndexValue = 0;

      operations.moveCurrentBlockUp(blocksStore);

      expect(dependencies.YjsManager.moveBlock).not.toHaveBeenCalled();
      expect(dependencies.I18n.t).toHaveBeenCalledWith('a11y.atTop');
    });

    it('moves block up when not at top', () => {
      operations.currentBlockIndexValue = 1;

      operations.moveCurrentBlockUp(blocksStore);

      expect(dependencies.YjsManager.moveBlock).toHaveBeenCalled();
      expect(dependencies.I18n.t).toHaveBeenCalledWith('a11y.movedUp', expect.any(Object));
    });

    it('refocuses current block after move', () => {
      operations.currentBlockIndexValue = 1;

      operations.moveCurrentBlockUp(blocksStore);

      expect(dependencies.Caret.setToBlock).toHaveBeenCalled();
      expect(operations.currentBlockIndexValue).toBe(0);
    });
  });

  describe('moveCurrentBlockDown', () => {
    it('does nothing when at bottom', () => {
      operations.currentBlockIndexValue = 2;

      operations.moveCurrentBlockDown(blocksStore);

      expect(dependencies.YjsManager.moveBlock).not.toHaveBeenCalled();
      expect(dependencies.I18n.t).toHaveBeenCalledWith('a11y.atBottom');
    });

    it('moves block down when not at bottom', () => {
      operations.currentBlockIndexValue = 0;

      operations.moveCurrentBlockDown(blocksStore);

      expect(dependencies.YjsManager.moveBlock).toHaveBeenCalled();
      expect(dependencies.I18n.t).toHaveBeenCalledWith('a11y.movedDown', expect.any(Object));
    });

    it('refocuses current block after move', () => {
      operations.currentBlockIndexValue = 0;

      operations.moveCurrentBlockDown(blocksStore);

      expect(dependencies.Caret.setToBlock).toHaveBeenCalled();
      expect(operations.currentBlockIndexValue).toBe(1);
    });
  });

  describe('suppressStopCapturing flag', () => {
    it('prevents stopCapturing during atomic operations', () => {
      operations.suppressStopCapturing = true;
      operations.currentBlockIndexValue = 1;

      expect(dependencies.YjsManager.stopCapturing).not.toHaveBeenCalled();
      operations.suppressStopCapturing = false;
    });
  });
});
