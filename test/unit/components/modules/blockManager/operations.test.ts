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
import { validateHierarchy } from '../../../../../src/components/utils/hierarchy-invariant';
import type { OutputBlockData } from '@/types';

/**
 * Projects the BlockRepository state into the OutputBlockData shape that
 * `validateHierarchy` consumes, so tests can reuse the canonical invariant
 * checker instead of hand-rolling parent/content cross-checks.
 */
const projectRepositoryForInvariant = (repo: BlockRepository): OutputBlockData[] =>
  repo.blocks.map(b => ({
    id: b.id,
    type: b.name,
    data: {},
    ...(b.parentId !== null ? { parent: b.parentId } : {}),
    ...(b.contentIds.length > 0 ? { content: [...b.contentIds] } : {}),
  } as OutputBlockData));

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

  // Add toggle tool (needed for hierarchy-aware replace tests)
  const toggleAdapter = createMockBlockToolAdapter('toggle');
  mockTools.set('toggle', toggleAdapter);

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

      try {
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
      } finally {
        document.body.removeChild(tableCellContainer);
      }
    });

    it('allows non-restricted tools to insert inside a table cell', () => {
      // Create a table cell container in the DOM
      const tableCellContainer = document.createElement('div');
      tableCellContainer.setAttribute('data-blok-table-cell-blocks', '');
      document.body.appendChild(tableCellContainer);

      try {
        const cellBlock = createMockBlock({ id: 'cell-block', name: 'paragraph' });
        blocksStore = createBlocksStore([cellBlock]);
        // Move holder into the table cell container after createBlocksStore moves it to workingArea
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

        // Insert a 'paragraph' tool — should remain paragraph (not restricted)
        const newBlock = operations.insert({ tool: 'paragraph' }, blocksStore);

        expect(newBlock).toBeDefined();
        expect(newBlock.name).toBe('paragraph');
      } finally {
        document.body.removeChild(tableCellContainer);
      }
    });

    it('does not demote restricted tools when inserting after a table block whose children are inside cells', () => {
      // Scenario: table block at index 0, child paragraph at index 1 inside a cell container.
      // Inserting a 'table' tool after the table (targetIndex = 0 + 1 = 1) should NOT demote,
      // because the new block is placed at the top level, not inside the table cell.
      const tableCellContainer = document.createElement('div');
      tableCellContainer.setAttribute('data-blok-table-cell-blocks', '');
      document.body.appendChild(tableCellContainer);

      try {
        const tableBlock = createMockBlock({ id: 'table-block', name: 'table' });
        const cellParagraph = createMockBlock({ id: 'cell-para', name: 'paragraph', parentId: 'table-block' });

        blocksStore = createBlocksStore([tableBlock, cellParagraph]);

        // Move the child paragraph's holder into the table cell container
        // to simulate it being inside a table cell in the DOM
        tableCellContainer.appendChild(cellParagraph.holder);

        repository = new BlockRepository();
        repository.initialize(blocksStore);
        hierarchy = new BlockHierarchy(repository);

        // Register 'table' tool in the factory
        const tableAdapter = createMockBlockToolAdapter('table');
        (factory as unknown as { dependencies: { tools: ToolsCollection<BlockToolAdapter> } })
          .dependencies.tools.set('table', tableAdapter);

        operations = new BlockOperations(
          dependencies,
          repository,
          factory,
          hierarchy,
          blockDidMutatedSpy,
          0 // currentBlockIndex = 0 (the table block)
        );
        operations.setYjsSync(yjsSync);

        // Insert 'table' tool — targetIndex = 0 + 1 = 1.
        // The block at index 1 is the child paragraph inside a cell, but the
        // new block should be placed at the top level (after the table block).
        const newBlock = operations.insert({ tool: 'table' }, blocksStore);

        expect(newBlock).toBeDefined();
        expect(newBlock.name).toBe('table');
      } finally {
        document.body.removeChild(tableCellContainer);
      }
    });

    it('allows restricted tools to insert outside table cells', () => {
      // Register 'header' tool in the factory so it can be composed
      const headerAdapter = createMockBlockToolAdapter('header');
      (factory as unknown as { dependencies: { tools: ToolsCollection<BlockToolAdapter> } })
        .dependencies.tools.set('header', headerAdapter);

      // No table cell container — blocks are in normal editor area
      const newBlock = operations.insert({ tool: 'header', index: 0 }, blocksStore);

      expect(newBlock).toBeDefined();
      expect(newBlock.name).toBe('header');
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
      // 'block-1' is not a valid nanoid, so use a block with a valid nanoid id
      // to verify that update() preserves the original id in the new block.
      const validNanoid = 'V1StGXR8_Z';
      const mockBlock = createMockBlock({ id: validNanoid, name: 'paragraph' });

      // Add to the shared blocksStore and reinitialize repository so operations can find it
      const newBlocksStore = createBlocksStore([
        mockBlock,
        ...blocksStore.array,
      ]);
      repository.initialize(newBlocksStore);

      const oldId = mockBlock.id;
      const newBlock = await operations.update(mockBlock, newBlocksStore, { text: 'New' });

      expect(newBlock.id).toBe(oldId);
      expect(repository.getBlockById(oldId)).toBe(newBlock);
    });

    /**
     * Layer 16 regression (wrong-block-dropped family).
     *
     * If `block` has been removed from the store between the caller obtaining
     * its reference and `update()` executing (e.g., a Yjs remote delete while
     * `await block.data` resolves), `getBlockIndex(block)` returns -1 and
     * `blocksStore.replace(-1, newBlock)` throws `Incorrect index`, aborting
     * the surrounding batch mid-flight and leaving the flat array inconsistent
     * with the DOM — the soil that grows wrong-block-dropped.
     *
     * Abort cleanly when the source is stale: return the original block and
     * fire no mutation or Yjs side effects.
     */
    it('aborts cleanly when source block is stale (not in store)', async () => {
      const staleBlock = createMockBlock({ id: 'stale-id', name: 'paragraph' });

      const result = await operations.update(staleBlock, blocksStore, { text: 'New' });

      expect(result).toBe(staleBlock);
      expect(blockDidMutatedSpy).not.toHaveBeenCalledWith(
        BlockChangedMutationType,
        expect.any(Object),
        expect.any(Object)
      );
      expect(dependencies.YjsManager.updateBlockData).not.toHaveBeenCalled();
      expect(dependencies.YjsManager.updateBlockTune).not.toHaveBeenCalled();
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

    /**
     * Layer 16 regression (wrong-block-dropped family).
     *
     * If `block` has been removed between the caller obtaining its reference
     * and `replace()` executing (e.g., Yjs remote delete while
     * `await block.save()` resolves during `convert()`), `getBlockIndex`
     * returns -1, then `YjsManager.addBlock({...}, -1)` and
     * `insert({ index: -1, replace: true })` corrupt downstream state.
     *
     * Abort cleanly when the source is stale: return the original block and
     * fire no Yjs side effects.
     */
    it('aborts cleanly when source block is stale (not in store)', () => {
      const staleBlock = createMockBlock({ id: 'stale-id', name: 'paragraph' });

      const result = operations.replace(staleBlock, 'paragraph', { text: 'New' }, blocksStore);

      expect(result).toBe(staleBlock);
      expect(dependencies.YjsManager.removeBlock).not.toHaveBeenCalled();
      expect(dependencies.YjsManager.addBlock).not.toHaveBeenCalled();
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

    it('promotes children to sibling level after new block when replacing toggle with non-hosting tool', () => {
      // Set up a toggle block with 2 child blocks
      const child1 = createMockBlock({ id: 'child-1', name: 'paragraph', parentId: 'toggle-1' });
      const child2 = createMockBlock({ id: 'child-2', name: 'paragraph', parentId: 'toggle-1' });
      const toggleBlock = createMockBlock({ id: 'toggle-1', name: 'toggle', contentIds: ['child-1', 'child-2'] });

      const testBlocks = [toggleBlock, child1, child2];
      const testStore = createBlocksStore(testBlocks);
      const testRepo = new BlockRepository();
      testRepo.initialize(testStore);
      const testHierarchy = new BlockHierarchy(testRepo);
      const testOps = new BlockOperations(
        dependencies,
        testRepo,
        factory,
        testHierarchy,
        blockDidMutatedSpy,
        0
      );
      testOps.setYjsSync(yjsSync);

      // Replace the toggle with a paragraph (a non-hosting tool)
      const newBlock = testOps.replace(toggleBlock, 'paragraph', { text: '' }, testStore);

      // The new block should not have contentIds pointing to children
      expect(newBlock.contentIds).toHaveLength(0);

      // Children should have parentId set to null (promoted to root level)
      expect(child1.parentId).toBeNull();
      expect(child2.parentId).toBeNull();

      // Children should appear after the new paragraph in the block list
      const newBlockIndex = testRepo.getBlockIndex(newBlock);
      const child1Index = testRepo.getBlockIndex(child1);
      const child2Index = testRepo.getBlockIndex(child2);

      expect(child1Index).toBeGreaterThan(newBlockIndex);
      expect(child2Index).toBeGreaterThan(child1Index);
    });

    it('keeps children when replacing toggle with another hosting tool (toggle→toggle)', () => {
      const child1 = createMockBlock({ id: 'child-1', name: 'paragraph', parentId: 'toggle-1' });
      const toggleBlock = createMockBlock({ id: 'toggle-1', name: 'toggle', contentIds: ['child-1'] });

      const testStore = createBlocksStore([toggleBlock, child1]);
      const testRepo = new BlockRepository();
      testRepo.initialize(testStore);
      const testHierarchy = new BlockHierarchy(testRepo);
      const testOps = new BlockOperations(
        dependencies,
        testRepo,
        factory,
        testHierarchy,
        blockDidMutatedSpy,
        0
      );
      testOps.setYjsSync(yjsSync);

      // Replace the toggle with another toggle (a hosting tool) — children stay
      const newBlock = testOps.replace(toggleBlock, 'toggle', { text: '' }, testStore);

      // Children should remain attached to the new toggle block
      expect(newBlock.contentIds).toHaveLength(1);
      expect(child1.parentId).toBe(newBlock.id);
    });

    it('promotes children to root level when replacing toggle header with regular header', () => {
      // Register header tool in the factory
      const headerAdapter = createMockBlockToolAdapter('header');

      (factory as unknown as { dependencies: { tools: ToolsCollection<BlockToolAdapter> } })
        .dependencies.tools.set('header', headerAdapter);

      // Set up a toggle header block with 2 child blocks
      const child1 = createMockBlock({ id: 'child-1', name: 'paragraph', parentId: 'toggle-header-1' });
      const child2 = createMockBlock({ id: 'child-2', name: 'paragraph', parentId: 'toggle-header-1' });
      const toggleHeader = createMockBlock({
        id: 'toggle-header-1',
        name: 'header',
        contentIds: ['child-1', 'child-2'],
        data: { text: 'My heading', level: 2, isToggleable: true },
      });

      const testStore = createBlocksStore([toggleHeader, child1, child2]);
      const testRepo = new BlockRepository();
      testRepo.initialize(testStore);
      const testHierarchy = new BlockHierarchy(testRepo);
      const testOps = new BlockOperations(
        dependencies,
        testRepo,
        factory,
        testHierarchy,
        blockDidMutatedSpy,
        0
      );
      testOps.setYjsSync(yjsSync);

      // Replace toggle header with a regular (non-toggleable) header via Backspace
      const newBlock = testOps.replace(toggleHeader, 'header', { text: '', level: 2 }, testStore);

      // Children should be promoted to root level (parentId = null)
      expect(child1.parentId).toBeNull();
      expect(child2.parentId).toBeNull();

      // New block should have no children
      expect(newBlock.contentIds).toHaveLength(0);

      // Children should appear after the new header in the block list
      const newBlockIndex = testRepo.getBlockIndex(newBlock);
      const child1Index = testRepo.getBlockIndex(child1);
      const child2Index = testRepo.getBlockIndex(child2);

      expect(child1Index).toBeGreaterThan(newBlockIndex);
      expect(child2Index).toBeGreaterThan(child1Index);
    });

    it('keeps children when replacing regular header with toggle header', () => {
      // Register header tool in the factory
      const headerAdapter = createMockBlockToolAdapter('header');

      (factory as unknown as { dependencies: { tools: ToolsCollection<BlockToolAdapter> } })
        .dependencies.tools.set('header', headerAdapter);

      // Set up a toggle header block with a child
      const child1 = createMockBlock({ id: 'child-1', name: 'paragraph', parentId: 'header-1' });
      const headerBlock = createMockBlock({
        id: 'header-1',
        name: 'header',
        contentIds: ['child-1'],
        data: { text: 'My heading', level: 2, isToggleable: true },
      });

      const testStore = createBlocksStore([headerBlock, child1]);
      const testRepo = new BlockRepository();
      testRepo.initialize(testStore);
      const testHierarchy = new BlockHierarchy(testRepo);
      const testOps = new BlockOperations(
        dependencies,
        testRepo,
        factory,
        testHierarchy,
        blockDidMutatedSpy,
        0
      );
      testOps.setYjsSync(yjsSync);

      // Replace header with a toggle header — children should stay
      const newBlock = testOps.replace(headerBlock, 'header', { text: 'My heading', level: 2, isToggleable: true }, testStore);

      // Children should remain attached to the new toggle header
      expect(newBlock.contentIds).toHaveLength(1);
      expect(child1.parentId).toBe(newBlock.id);
    });

    /**
     * Angle 2 (callout paste-ejection family, gap after Layer 18).
     *
     * `replace()` used to mutate `newBlock.parentId` and `parentBlock.contentIds`
     * directly instead of routing through `BlockHierarchy.setBlockParent()`. The
     * invariant still held, but the DOM side effects owned by `setBlockParent`
     * (reparenting the block's holder into the parent's toggle-children
     * container, hiding it when the parent is collapsed) were skipped. Result:
     * a block replaced inside a callout/toggle would render at the wrong DOM
     * position (sibling of the callout, not child of it) until the next full
     * render pass.
     *
     * These tests lock the DOM behaviour and the invariant together.
     */
    it('routes the replaced child through setBlockParent so its holder is reparented into the container', () => {
      const container = createMockBlock({ id: 'callout-1', name: 'callout', contentIds: ['child-1'] });
      const childContainer = document.createElement('div');

      childContainer.setAttribute('data-blok-toggle-children', '');
      container.holder.appendChild(childContainer);

      const child = createMockBlock({ id: 'child-1', name: 'paragraph', parentId: 'callout-1' });

      childContainer.appendChild(child.holder);

      const testStore = createBlocksStore([container, child]);
      const testRepo = new BlockRepository();

      testRepo.initialize(testStore);
      const testHierarchy = new BlockHierarchy(testRepo);
      const testOps = new BlockOperations(
        dependencies,
        testRepo,
        factory,
        testHierarchy,
        blockDidMutatedSpy,
        1
      );

      testOps.setYjsSync(yjsSync);

      const newBlock = testOps.replace(child, 'paragraph', { text: 'converted' }, testStore);

      expect(newBlock.parentId).toBe('callout-1');
      expect(container.contentIds).toEqual([newBlock.id]);
      expect(newBlock.holder.parentElement).toBe(childContainer);
      expect(validateHierarchy(projectRepositoryForInvariant(testRepo))).toEqual([]);
    });

    it('routes reparentChildren through setBlockParent so DOM side effects run for surviving children', () => {
      const oldToggle = createMockBlock({ id: 'toggle-1', name: 'toggle', contentIds: ['child-1'] });
      const oldChildContainer = document.createElement('div');

      oldChildContainer.setAttribute('data-blok-toggle-children', '');
      oldToggle.holder.appendChild(oldChildContainer);

      const child = createMockBlock({ id: 'child-1', name: 'paragraph', parentId: 'toggle-1' });

      oldChildContainer.appendChild(child.holder);

      const testStore = createBlocksStore([oldToggle, child]);
      const testRepo = new BlockRepository();

      testRepo.initialize(testStore);
      const testHierarchy = new BlockHierarchy(testRepo);

      // Spy on setBlockParent — production code must call it for each surviving
      // child when reparenting from the old container to the new one.
      const setBlockParentSpy = vi.spyOn(testHierarchy, 'setBlockParent');

      const testOps = new BlockOperations(
        dependencies,
        testRepo,
        factory,
        testHierarchy,
        blockDidMutatedSpy,
        0
      );

      testOps.setYjsSync(yjsSync);

      const newToggle = testOps.replace(oldToggle, 'toggle', { text: '' }, testStore);

      // Production fix: reparentChildren must go through setBlockParent rather
      // than mutating childBlock.parentId directly.
      const childCalls = setBlockParentSpy.mock.calls.filter(([block]) => block === child);

      expect(childCalls.length).toBeGreaterThanOrEqual(1);
      expect(childCalls.at(-1)?.[1]).toBe(newToggle.id);
      expect(child.parentId).toBe(newToggle.id);
      expect(newToggle.contentIds).toContain('child-1');
      expect(validateHierarchy(projectRepositoryForInvariant(testRepo))).toEqual([]);
    });

    it('hides the replaced child when the container is collapsed', () => {
      const container = createMockBlock({ id: 'toggle-1', name: 'toggle', contentIds: ['child-1', 'child-2'] });
      const childContainer = document.createElement('div');

      childContainer.setAttribute('data-blok-toggle-children', '');
      container.holder.appendChild(childContainer);

      const childA = createMockBlock({ id: 'child-1', name: 'paragraph', parentId: 'toggle-1' });
      const childB = createMockBlock({ id: 'child-2', name: 'paragraph', parentId: 'toggle-1' });

      // Collapsed toggle: existing children are marked hidden in the DOM.
      childA.holder.classList.add('hidden');
      childB.holder.classList.add('hidden');
      childContainer.appendChild(childA.holder);
      childContainer.appendChild(childB.holder);

      const testStore = createBlocksStore([container, childA, childB]);
      const testRepo = new BlockRepository();

      testRepo.initialize(testStore);
      const testHierarchy = new BlockHierarchy(testRepo);
      const testOps = new BlockOperations(
        dependencies,
        testRepo,
        factory,
        testHierarchy,
        blockDidMutatedSpy,
        1
      );

      testOps.setYjsSync(yjsSync);

      const newChildA = testOps.replace(childA, 'paragraph', { text: 'converted' }, testStore);

      expect(newChildA.parentId).toBe('toggle-1');
      expect(newChildA.holder.classList.contains('hidden')).toBe(true);
      expect(validateHierarchy(projectRepositoryForInvariant(testRepo))).toEqual([]);
    });
  });

  describe('mergeBlocks', () => {
    /**
     * Layer 17 regression (wrong-block-dropped family).
     *
     * `mergeBlocks` awaits `blockToMerge.data` then `targetBlock.data`. During
     * those awaits, either block can be destroyed by a Yjs remote delete,
     * undo/redo, or a tool-conversion callback. The original code held closure
     * references and used them after the awaits, which drove:
     *   - `YjsManager.transact` + `updateBlockData(targetBlock.id, ...)` with a
     *     dead target id → merged data silently applied to nothing
     *   - `removeBlock(blockToMerge)` → throws `Can't find a Block to remove`
     *     inside a `void ... .then(...)` chain → unhandled rejection
     *   - `currentBlockIndexValue = getBlockIndex(targetBlock)` → -1 when
     *     targetBlock is gone, corrupting caret state
     *
     * Abort cleanly when either block is stale (not in store) — no Yjs side
     * effects, no block removal, no currentBlockIndex mutation.
     */
    it('aborts cleanly when targetBlock is stale (not in store)', async () => {
      const staleTarget = createMockBlock({
        id: 'stale-target',
        name: 'paragraph',
        mergeable: true,
        data: { text: 'target content' },
      });
      // Replace blocks store's block-2 with a fresh mergeable one carrying real data
      const freshSource = createMockBlock({
        id: 'block-2',
        name: 'paragraph',
        data: { text: 'source content' },
      });
      // Put it in the store by reinitializing with the same ids
      const testStore = createBlocksStore([
        createMockBlock({ id: 'block-1', name: 'paragraph' }),
        freshSource,
        createMockBlock({ id: 'block-3', name: 'paragraph' }),
      ]);
      const testRepo = new BlockRepository();
      testRepo.initialize(testStore);
      const testOps = new BlockOperations(
        dependencies,
        testRepo,
        factory,
        new BlockHierarchy(testRepo),
        blockDidMutatedSpy,
        0
      );
      testOps.setYjsSync(yjsSync);

      await testOps.mergeBlocks(staleTarget, freshSource, testStore);

      expect(dependencies.YjsManager.transact).not.toHaveBeenCalled();
      expect(dependencies.YjsManager.updateBlockData).not.toHaveBeenCalled();
      expect(dependencies.YjsManager.removeBlock).not.toHaveBeenCalled();
    });

    it('aborts cleanly when blockToMerge is stale (not in store)', async () => {
      const freshTarget = createMockBlock({
        id: 'block-1',
        name: 'paragraph',
        mergeable: true,
        data: { text: 'target content' },
      });
      const staleSource = createMockBlock({
        id: 'stale-source',
        name: 'paragraph',
        data: { text: 'source content' },
      });
      const testStore = createBlocksStore([
        freshTarget,
        createMockBlock({ id: 'block-2', name: 'paragraph' }),
        createMockBlock({ id: 'block-3', name: 'paragraph' }),
      ]);
      const testRepo = new BlockRepository();
      testRepo.initialize(testStore);
      const testOps = new BlockOperations(
        dependencies,
        testRepo,
        factory,
        new BlockHierarchy(testRepo),
        blockDidMutatedSpy,
        0
      );
      testOps.setYjsSync(yjsSync);

      await testOps.mergeBlocks(freshTarget, staleSource, testStore);

      expect(dependencies.YjsManager.transact).not.toHaveBeenCalled();
      expect(dependencies.YjsManager.updateBlockData).not.toHaveBeenCalled();
      expect(dependencies.YjsManager.removeBlock).not.toHaveBeenCalled();
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

    it('defers currentBlockIndex update so blockDidMutated sees original block as current', () => {
      operations.currentBlockIndexValue = 1; // block-2

      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode('split content'));
      (dependencies.Caret.extractFragmentFromCaretPosition as ReturnType<typeof vi.fn>).mockReturnValue(fragment);

      // Capture currentBlockIndexValue at the moment BlockAddedMutationType fires
      let indexDuringMutation: number | undefined;

      blockDidMutatedSpy.mockImplementation(<Type extends BlockMutationType>(
        mutationType: Type,
        block: Block,
        _detailData: unknown
      ) => {
        if (mutationType === BlockAddedMutationType) {
          indexDuringMutation = operations.currentBlockIndexValue;
        }

        return block;
      });

      operations.split(blocksStore);

      // During mutation, currentBlockIndex should still point at the ORIGINAL block (index 1)
      expect(indexDuringMutation).toBe(1);
      // After split completes, currentBlockIndex should point at the NEW block (index 2)
      expect(operations.currentBlockIndexValue).toBe(2);
    });

    it('includes parent field in YjsManager.addBlock call when splitting a nested block', () => {
      // Setup parent-child relationship: block-2 is a child of block-1
      const childBlock = repository.getBlockById('block-2');
      if (!childBlock) {
        throw new Error('Test setup failed: block-2 not found');
      }

      hierarchy.setBlockParent(childBlock, 'block-1');

      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode('split content'));
      (dependencies.Caret.extractFragmentFromCaretPosition as ReturnType<typeof vi.fn>).mockReturnValue(fragment);

      operations.currentBlockIndexValue = 1; // block-2
      operations.split(blocksStore);

      // YjsManager.addBlock must be called with parent: 'block-1' so the child's
      // own YMap entry records the parentId — required for correct redo behaviour.
      const addBlockCalls = (dependencies.YjsManager.addBlock as ReturnType<typeof vi.fn>).mock.calls;
      const splitAddCall = addBlockCalls.find(
        (call: unknown[]) => (call[0] as { parent?: string })?.parent === 'block-1'
      );

      expect(splitAddCall).toBeDefined();
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

    it('defers currentBlockIndex update so blockDidMutated sees original block as current', () => {
      operations.currentBlockIndexValue = 0; // block-1

      // Capture currentBlockIndexValue at the moment BlockAddedMutationType fires
      let indexDuringMutation: number | undefined;

      blockDidMutatedSpy.mockImplementation(<Type extends BlockMutationType>(
        mutationType: Type,
        block: Block,
        _detailData: unknown
      ) => {
        if (mutationType === BlockAddedMutationType) {
          indexDuringMutation = operations.currentBlockIndexValue;
        }

        return block;
      });

      operations.splitBlockWithData(
        'block-1',
        { text: 'Remaining' },
        'paragraph',
        { text: 'Extracted' },
        1,
        blocksStore
      );

      // During mutation, currentBlockIndex should still point at the ORIGINAL block (index 0)
      expect(indexDuringMutation).toBe(0);
      // After split completes, currentBlockIndex should point at the NEW block (index 1)
      expect(operations.currentBlockIndexValue).toBe(1);
    });

    it('inherits parentId from the current block when splitting', () => {
      // Setup parent-child relationship
      const parentBlock = repository.getBlockById('block-1');
      const childBlock = repository.getBlockById('block-2');
      if (!parentBlock || !childBlock) {
        throw new Error('Test setup failed: blocks not found');
      }

      // Make block-2 a child of block-1
      hierarchy.setBlockParent(childBlock, 'block-1');

      operations.currentBlockIndexValue = 1; // block-2
      const newBlock = operations.splitBlockWithData(
        'block-2',
        { text: 'Remaining' },
        'paragraph',
        { text: 'Extracted' },
        2,
        blocksStore
      );

      // The new block should inherit the same parentId as block-2
      expect(newBlock.parentId).toBe('block-1');
      // The parent should have the new block in its contentIds
      expect(parentBlock.contentIds).toContain(newBlock.id);
    });

    it('includes parent field in YjsManager.addBlock call when splitting a nested block', () => {
      // Setup parent-child relationship: block-2 is a child of block-1
      const childBlock = repository.getBlockById('block-2');
      if (!childBlock) {
        throw new Error('Test setup failed: block-2 not found');
      }

      hierarchy.setBlockParent(childBlock, 'block-1');

      operations.currentBlockIndexValue = 1; // block-2
      operations.splitBlockWithData(
        'block-2',
        { text: 'Remaining' },
        'paragraph',
        { text: 'Extracted' },
        2,
        blocksStore
      );

      // YjsManager.addBlock must be called with parent: 'block-1' so the child's
      // own YMap entry records the parentId — required for correct redo behaviour.
      const addBlockCalls = (dependencies.YjsManager.addBlock as ReturnType<typeof vi.fn>).mock.calls;
      const splitAddCall = addBlockCalls.find(
        (call: unknown[]) => (call[0] as { type?: string })?.type === 'paragraph' &&
          (call[0] as { parent?: string })?.parent === 'block-1'
      );

      expect(splitAddCall).toBeDefined();
    });
  });

  describe('insertInsideParent', () => {
    it('throws error when parent block is not found', () => {
      expect(() => {
        operations.insertInsideParent('unknown-parent', 1, blocksStore);
      }).toThrow('Parent block with id "unknown-parent" not found');
    });

    it('inserts a new paragraph block at the given index', () => {
      const initialCount = repository.length;

      operations.insertInsideParent('block-1', 1, blocksStore);

      expect(repository.length).toBe(initialCount + 1);
    });

    it('calls YjsManager.transact for atomic operation', () => {
      const newBlock = operations.insertInsideParent('block-1', 1, blocksStore);

      expect(dependencies.YjsManager.transact).toHaveBeenCalled();

      // The transacted operation must still produce a valid block
      expect(newBlock).toBeDefined();
      expect(newBlock.parentId).toBe('block-1');
    });

    it('calls YjsManager.addBlock with parent id', () => {
      operations.insertInsideParent('block-1', 1, blocksStore);

      const addBlockCalls = (dependencies.YjsManager.addBlock as ReturnType<typeof vi.fn>).mock.calls;
      const callWithParent = addBlockCalls.find(
        (call: unknown[]) => (call[0] as { parent?: string })?.parent === 'block-1'
      );

      expect(callWithParent).toBeDefined();
    });

    it('sets parentId on the newly created block', () => {
      const newBlock = operations.insertInsideParent('block-1', 1, blocksStore);

      expect(newBlock.parentId).toBe('block-1');
    });

    it('adds new block id to parent contentIds', () => {
      const parentBlock = repository.getBlockById('block-1');
      if (!parentBlock) {
        throw new Error('Test setup failed: block-1 not found');
      }

      const newBlock = operations.insertInsideParent('block-1', 1, blocksStore);

      expect(parentBlock.contentIds).toContain(newBlock.id);
    });

    it('does NOT call YjsManager.stopCapturing (atomic - no undo split)', () => {
      operations.insertInsideParent('block-1', 1, blocksStore);

      expect(dependencies.YjsManager.stopCapturing).not.toHaveBeenCalled();
    });

    it('wraps operation in withAtomicOperation', () => {
      const initialCount = repository.length;

      operations.insertInsideParent('block-1', 1, blocksStore);

      expect(yjsSync.withAtomicOperation).toHaveBeenCalled();

      // The atomic wrapper must still allow the block to be created
      expect(repository.length).toBe(initialCount + 1);
    });

    it('returns the newly created block', () => {
      const newBlock = operations.insertInsideParent('block-1', 1, blocksStore);

      expect(newBlock).toBeDefined();
      expect(newBlock.id).toBeTruthy();
    });

    it('updates currentBlockIndex to the inserted block index', () => {
      operations.currentBlockIndexValue = 0;
      operations.insertInsideParent('block-1', 1, blocksStore);

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

    /**
     * Architectural invariant. `convert()` MUST wrap the tool-swap in
     * `yjsSync.withAtomicOperation({ extendThroughRAF: true })` so the
     * mutation-triggered first `save()` of the new block (which may emit
     * fields beyond what `conversionConfig.import` seeded — e.g. toggle's
     * `isOpen`, code's `language`, header's `level`) is suppressed through
     * the next animation frame. Without this, that first save lands as a
     * separate Yjs transaction → phantom second undo entry, and the user
     * needs two Cmd+Z presses to undo the conversion.
     *
     * Locking the exact option here so a future refactor cannot silently
     * remove `extendThroughRAF` and resurrect the bug class.
     */
    it('wraps replace() in withAtomicOperation with extendThroughRAF: true', async () => {
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }
      (block.exportDataAsString as ReturnType<typeof vi.fn>).mockResolvedValue('<p>Hello</p>');

      await operations.convert(block, 'paragraph', blocksStore);

      expect(yjsSync.withAtomicOperation).toHaveBeenCalledWith(
        expect.any(Function),
        { extendThroughRAF: true }
      );
    });

    /**
     * Architectural invariant. The tool-swap executes under
     * `suppressStopCapturing = true` so container tools whose `rendered()`
     * hooks call `insertInsideParent` (callout, future container tools) do
     * not force a new undo boundary mid-convert.
     */
    it('runs replace() under suppressStopCapturing', async () => {
      const block = repository.getBlockById('block-1');
      if (!block) {
        throw new Error('Test setup failed: block-1 not found');
      }
      (block.exportDataAsString as ReturnType<typeof vi.fn>).mockResolvedValue('<p>Hello</p>');

      let suppressDuringReplace: boolean | null = null;

      (yjsSync.withAtomicOperation as Mock).mockImplementationOnce(<T>(fn: () => T): T => {
        suppressDuringReplace = operations.suppressStopCapturing;

        return fn();
      });

      await operations.convert(block, 'paragraph', blocksStore);

      expect(suppressDuringReplace).toBe(true);
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

    /**
     * Architectural invariant (mirrors convert()). `paste()` creates a fresh
     * block whose first `save()` pass may emit fields beyond what the paste
     * handler seeded. Without `extendThroughRAF: true` on the insert-time
     * atomic op, the RAF-scheduled `beginAtomicOperation` cleanup fires
     * before `await block.ready` + `onPaste` + the manual `addBlock()` Yjs
     * write land — meaning `isSyncingFromYjs` flips back to false mid-paste
     * and MutationObserver-triggered `syncBlockDataToYjs` calls on the
     * fresh block become a separate Yjs transaction, producing a phantom
     * post-paste undo entry.
     *
     * Locking the option here so future refactors cannot silently drop it.
     */
    it('wraps the insert-time atomic op in extendThroughRAF to suppress phantom first-save', async () => {
      const pasteEvent = { detail: { data: '<p>pasted</p>' } } as unknown as PasteEvent;

      await operations.paste('paragraph', pasteEvent, false, blocksStore);

      expect(yjsSync.withAtomicOperation).toHaveBeenCalledWith(
        expect.any(Function),
        { extendThroughRAF: true }
      );
    });

    /**
     * Architectural invariant (companion to the insert-time lock above).
     *
     * `paste()` calls the tool's `onPaste` hook inside a *second*
     * `withAtomicOperation` call — see `operations.ts:~1309`. Some tools
     * (database card drawer → dynamic `import('../../blok')`, code tool →
     * async highlighter/mermaid/katex imports) perform async DOM mutation
     * from inside `onPaste`. If that RAF is dropped, the async work runs
     * after `isSyncingFromYjs` flips back to false and any
     * MutationObserver-triggered `syncBlockDataToYjs` lands as a separate
     * Yjs transaction, reintroducing the phantom-undo bug class for
     * async-onPaste tools.
     *
     * Lock: every single `withAtomicOperation` call issued during paste()
     * must carry `{ extendThroughRAF: true }`. If a future refactor adds
     * another wrap without the option, this test fails.
     */
    it('wraps every paste-time atomic op in extendThroughRAF (including the onPaste wrap)', async () => {
      const pasteEvent = { detail: { data: '<p>pasted</p>' } } as unknown as PasteEvent;

      await operations.paste('paragraph', pasteEvent, false, blocksStore);

      const mock = yjsSync.withAtomicOperation as Mock;

      expect(mock.mock.calls.length).toBeGreaterThanOrEqual(2);

      for (const call of mock.mock.calls) {
        expect(call[1]).toEqual({ extendThroughRAF: true });
      }
    });

    it('awaits block.ready before calling onPaste', async () => {
      const callOrder: string[] = [];
      let resolveReady: () => void;
      const readyPromise = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });

      const mockBlock = createMockBlock();

      // Override ready to be a delayed promise
      Object.defineProperty(mockBlock, 'ready', {
        get: () => readyPromise,
      });

      // Track when onPaste is called
      (mockBlock.call as Mock).mockImplementation((methodName: string) => {
        callOrder.push(methodName);
      });

      // Override factory to return our mock block
      const originalInsert = operations.insert.bind(operations);

      vi.spyOn(operations, 'insert').mockImplementation((opts, store) => {
        originalInsert(opts, store);

        return mockBlock;
      });

      const pasteEvent: PasteEvent = {
        detail: { data: { text: 'test' } },
      } as unknown as PasteEvent;

      // Start paste (don't await yet)
      const pastePromise = operations.paste('paragraph', pasteEvent, false, blocksStore);

      // onPaste should not have been called yet (block.ready hasn't resolved)
      expect(mockBlock.call).not.toHaveBeenCalled();

      // Now resolve block.ready
      resolveReady!();
      await pastePromise;

      // onPaste should have been called after ready resolved
      expect(callOrder).toContain('onPaste');
    });

    it('suppresses Yjs sync for child blocks created during onPaste', async () => {
      // Track whether isSyncingFromYjs was true during atomic operation
      let syncingDuringAtomic = false;

      (yjsSync.withAtomicOperation as Mock).mockImplementation(<T>(fn: () => T): T => {
        // Simulate setting isSyncingFromYjs during atomic operation
        const origValue = yjsSync.isSyncingFromYjs;

        Object.defineProperty(yjsSync, 'isSyncingFromYjs', { value: true, configurable: true });
        syncingDuringAtomic = true;

        try {
          return fn();
        } finally {
          Object.defineProperty(yjsSync, 'isSyncingFromYjs', { value: origValue, configurable: true });
        }
      });

      const pasteEvent: PasteEvent = {
        detail: { data: { text: 'test' } },
      } as unknown as PasteEvent;

      await operations.paste('paragraph', pasteEvent, false, blocksStore);

      // withAtomicOperation should have been called (wrapping both insert and onPaste)
      expect(yjsSync.withAtomicOperation).toHaveBeenCalled();
      expect(syncingDuringAtomic).toBe(true);
    });

    it('defers currentBlockIndex update for non-replace paste so blockDidMutated sees original block', async () => {
      operations.currentBlockIndexValue = 0; // block-1

      let indexDuringMutation: number | undefined;

      blockDidMutatedSpy.mockImplementation(<Type extends BlockMutationType>(
        mutationType: Type,
        block: Block,
        _detailData: unknown
      ) => {
        if (mutationType === BlockAddedMutationType) {
          indexDuringMutation = operations.currentBlockIndexValue;
        }

        return block;
      });

      const pasteEvent = { detail: { data: '<p>pasted</p>' } } as unknown as PasteEvent;

      await operations.paste('paragraph', pasteEvent, false, blocksStore);

      // During the mutation event, index should point at the ORIGINAL block (0)
      expect(indexDuringMutation).toBe(0);
    });

    it('inherits parentId from predecessor block when pasting non-replace', async () => {
      // Setup: block-2 is a child of block-1 (simulating a table cell paragraph)
      const childBlock = repository.getBlockById('block-2');

      if (!childBlock) {
        throw new Error('block-2 not found');
      }
      hierarchy.setBlockParent(childBlock, 'block-1');

      operations.currentBlockIndexValue = 1; // block-2 (child of block-1)

      const pasteEvent = { detail: { data: '<p>pasted</p>' } } as unknown as PasteEvent;
      const newBlock = await operations.paste('paragraph', pasteEvent, false, blocksStore);

      // The pasted block should inherit block-2's parentId
      expect(newBlock.parentId).toBe('block-1');
    });

    it('inherits parentId from replaced block when pasting with replace=true (callout-child-paste defense)', async () => {
      // Setup: block-2 is a child of block-1 (e.g., an empty paragraph inside a callout).
      // Pasting a different block onto that empty paragraph triggers the replace=true
      // path in BasePasteHandler.processSingleBlock. The new block must inherit
      // block-1 as its parent, otherwise Saver re-derives content[] from live parentId
      // and the pasted block is ejected out of the callout at save time.
      const childBlock = repository.getBlockById('block-2');

      if (!childBlock) {
        throw new Error('block-2 not found');
      }
      hierarchy.setBlockParent(childBlock, 'block-1');

      operations.currentBlockIndexValue = 1; // block-2 (child of block-1)

      const pasteEvent = { detail: { data: '<p>pasted</p>' } } as unknown as PasteEvent;
      const newBlock = await operations.paste('paragraph', pasteEvent, true, blocksStore);

      // The new block must inherit block-1 as its parent.
      expect(newBlock.parentId).toBe('block-1');

      // Hierarchy must stay consistent: block-1's contentIds now reference the
      // new block in place of the replaced block-2.
      const parentBlock = repository.getBlockById('block-1');

      expect(parentBlock?.contentIds).toContain(newBlock.id);
    });

    it('transferParentLinkToNewBlock swaps old->new id in parent contentIds when pasting with replace', async () => {
      const childBlock = repository.getBlockById('block-2');

      if (!childBlock) {
        throw new Error('block-2 not found');
      }
      hierarchy.setBlockParent(childBlock, 'block-1');

      operations.currentBlockIndexValue = 1; // block-2 (child of block-1)

      const pasteEvent = { detail: { data: '<p>pasted</p>' } } as unknown as PasteEvent;
      const newBlock = await operations.paste('paragraph', pasteEvent, true, blocksStore);

      const parentBlock = repository.getBlockById('block-1');

      // block-2's id must be fully removed from the parent's contentIds and
      // replaced by the new block's id at the same position.
      expect(parentBlock?.contentIds).toContain(newBlock.id);
      expect(parentBlock?.contentIds).not.toContain('block-2');
    });

    it('paste() into container title inherits container id as parent (title-vs-child defense)', async () => {
      // The caret is inside a container BLOCK's title input (e.g. the header
      // of a toggle/callout), NOT inside one of its children. In that case the
      // pasted block should become a CHILD of the container — its parent must
      // be the container's id, NOT the container's own parentId.
      //
      // This mirrors the `contextParentId` title-vs-child logic already
      // present in BasePasteHandler.insertPasteData and BlokDataHandler.
      const container = createMockBlock({ id: 'container-1', name: 'toggle' });
      const childContainer = document.createElement('div');

      childContainer.setAttribute('data-blok-toggle-children', '');
      // Important: do NOT place the container's input inside childContainer.
      // The input stays at the top of holder (the title), so currentInput is
      // NOT a descendant of [data-blok-toggle-children].
      container.holder.appendChild(childContainer);

      const testStore = createBlocksStore([container]);
      const testRepo = new BlockRepository();

      testRepo.initialize(testStore);
      const testHierarchy = new BlockHierarchy(testRepo);
      const testOps = new BlockOperations(
        dependencies,
        testRepo,
        factory,
        testHierarchy,
        blockDidMutatedSpy,
        0
      );

      testOps.setYjsSync(yjsSync);

      const pasteEvent = { detail: { data: '<p>pasted</p>' } } as unknown as PasteEvent;
      const newBlock = await testOps.paste('paragraph', pasteEvent, false, testStore);

      // The pasted block must become a child of the container block, not a
      // sibling. Its parent must be the container's id (null parentId on the
      // container must NOT leak through as the new block's parent).
      expect(newBlock.parentId).toBe('container-1');
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
