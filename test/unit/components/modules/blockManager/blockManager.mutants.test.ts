import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import type { Block } from '../../../../../src/components/block';
import { Blocks } from '../../../../../src/components/blocks';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import type { PasteEvent } from '../../../../../types';
import { Map as YMap } from 'yjs';
import { BlockChanged } from '../../../../../src/components/events';
import { BlockRemovedMutationType } from '../../../../../types/events/block/BlockRemoved';
import { BlockAddedMutationType } from '../../../../../types/events/block/BlockAdded';
import { BlockChangedMutationType } from '../../../../../types/events/block/BlockChanged';
import { BlockMovedMutationType } from '../../../../../types/events/block/BlockMoved';
import { BlockShortcuts } from '../../../../../src/components/modules/blockManager/shortcuts';

type BlockStubOptions = {
  id: string;
  /** written to `data-blok-depth`; omitted means a plain root block */
  depth?: number;
  selected?: boolean;
  withInput?: boolean;
  /** tool name; defaults to 'paragraph' */
  name?: string;
  parentId?: string | null;
  contentIds?: string[];
  preservedTunes?: Record<string, unknown>;
  preservedData?: Record<string, unknown>;
  /** `block.save()` resolves to `{ data: saveData }`; undefined means save() resolves undefined */
  saveData?: Record<string, unknown>;
  /** extra markup rendered inside the holder (toggle markers, heading tags) */
  holderHtml?: string;
};

/**
 * Calls a private method. Only used where the public path runs the full
 * editor boot (initializeServices wires the real collaborators), which the
 * stub harness cannot provide.
 */
const invokePrivate = (instance: unknown, method: string, ...args: unknown[]): unknown => {
  const fn = (instance as Record<string, (...args: unknown[]) => unknown>)[method];

  return fn.call(instance, ...args);
};

/** Flushes every queued microtask before resolving. */
const settle = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * Minimal Block double. `getBlockNestingDepth` reads the depth off the holder,
 * so nesting is expressed purely through the `data-blok-depth` attribute.
 */
const createBlockStub = (options: BlockStubOptions): Block => {
  const holder = document.createElement('div');

  holder.setAttribute('data-stub-id', options.id);

  if (options.depth !== undefined) {
    holder.setAttribute('data-blok-depth', String(options.depth));
  }

  if (options.holderHtml !== undefined) {
    holder.innerHTML = options.holderHtml;
  }

  const input = document.createElement('div');

  input.contentEditable = 'true';

  return {
    id: options.id,
    holder,
    selected: options.selected ?? false,
    firstInput: options.withInput === false ? undefined : input,
    name: options.name ?? 'paragraph',
    parentId: options.parentId ?? null,
    contentIds: [...(options.contentIds ?? [])],
    preservedTunes: options.preservedTunes ?? {},
    preservedData: options.preservedData ?? {},
    save: vi.fn(() => Promise.resolve(options.saveData === undefined ? undefined : { data: options.saveData })),
    call: vi.fn(),
    destroy: vi.fn(() => Promise.resolve()),
    setPlaceholder: vi.fn(),
  } as unknown as Block;
};

type Mock = ReturnType<typeof vi.fn>;

type YjsStub = {
  transact: Mock;
  transactWithoutCapture: Mock;
  transactMoves: Mock;
  removeBlock: Mock;
  addBlock: Mock;
  stopCapturing: Mock;
  fromJSON: Mock;
  onBlocksChanged: Mock;
  getBlockById: Mock;
  getBlockPlacement: Mock;
  applyBlockPlacement: Mock;
  recordParentChangeForPendingMove: Mock;
  updateBlockData: Mock;
  pruneBlockData: Mock;
  updateBlockMetadata: Mock;
  enqueueBlockDataWrite: Mock;
  isInMoveGroup: boolean;
  isDragMoveGroupActive: boolean;
};

type Harness = {
  blockManager: BlockManager;
  store: Block[];
  yjs: YjsStub;
  yjsSync: Record<string, unknown>;
  operations: Record<string, unknown>;
  hierarchy: Record<string, unknown>;
  eventBinder: Record<string, unknown>;
  shortcuts: Record<string, unknown>;
  factory: Record<string, unknown>;
  operationsRemoveBlock: Mock;
  operationsInsert: Mock;
  operationsMove: Mock;
  operationsSplit: Mock;
  checkEmptiness: Mock;
  removedIndices: number[];
  mutations: Record<string, unknown>[];
  events: CustomEvent<unknown>[];
};

type HarnessOptions = {
  blocks: Block[];
  defaultBlock?: string | undefined;
  currentBlock?: Block | undefined;
  /** stands in for a REMOVED hook that drains siblings out of the store */
  cascadeRemove?: (removed: Block, store: Block[]) => void;
  /** merged over the default repository stub */
  repository?: Record<string, unknown>;
  /** merged over the default YjsManager stub */
  yjs?: Record<string, unknown>;
  /** merged over the default operations stub */
  operations?: Record<string, unknown>;
  /** merged over the default yjsSync stub */
  yjsSync?: Record<string, unknown>;
  /** merged over the default hierarchy stub */
  hierarchy?: Record<string, unknown>;
  /** merged into blockManager.state */
  state?: Record<string, unknown>;
  /** leave the operations module unset (pre-prepare state) */
  omitOperations?: boolean;
  /** leave the blocks store unset, so the blocksStore getter throws */
  omitStore?: boolean;
};

/**
 * Builds a BlockManager whose collaborators are doubles, without prepare().
 * Only the private fields the exercised public methods reach are filled in —
 * same technique as blockManager.test.ts.
 */
const createHarness = (options: HarnessOptions): Harness => {
  const config: ModuleConfig = {
    config: 'defaultBlock' in options
      ? { defaultBlock: options.defaultBlock }
      : { defaultBlock: 'paragraph' },
    eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
  };

  const blockManager = new BlockManager(config);
  const store = [...options.blocks];
  const removedIndices: number[] = [];

  const yjs: YjsStub = {
    transact: vi.fn((fn: () => void) => fn()),
    transactWithoutCapture: vi.fn((fn: () => void) => fn()),
    transactMoves: vi.fn((fn: () => void) => fn()),
    removeBlock: vi.fn(),
    addBlock: vi.fn(),
    stopCapturing: vi.fn(),
    fromJSON: vi.fn(),
    onBlocksChanged: vi.fn(() => () => undefined),
    // A minimal Yjs record: without it setBlockParent exits before the doc write.
    getBlockById: vi.fn(() => ({ get: () => undefined })),
    getBlockPlacement: vi.fn(() => null),
    applyBlockPlacement: vi.fn(),
    recordParentChangeForPendingMove: vi.fn(),
    updateBlockData: vi.fn(() => true),
    pruneBlockData: vi.fn(() => false),
    updateBlockMetadata: vi.fn(),
    enqueueBlockDataWrite: vi.fn(),
    isInMoveGroup: false,
    isDragMoveGroupActive: false,
    ...(options.yjs as Partial<YjsStub>),
  };

  const operationsRemoveBlock = vi.fn().mockResolvedValue(undefined);
  const operationsMove = vi.fn();
  const operationsSplit = vi.fn(() => createBlockStub({ id: 'split-tail' }));
  const checkEmptiness = vi.fn();
  const mutations: Record<string, unknown>[] = [];
  const events: CustomEvent<unknown>[] = [];

  config.eventsDispatcher.on(BlockChanged, ({ event }) => {
    const detail = event.detail as unknown as Record<string, unknown>;
    const entry: Record<string, unknown> = { type: event.type, index: detail.index };

    if (detail.fromIndex !== undefined) {
      entry.fromIndex = detail.fromIndex;
    }
    if (detail.toIndex !== undefined) {
      entry.toIndex = detail.toIndex;
    }
    mutations.push(entry);
    events.push(event);
  });
  const operationsInsert = vi.fn((insertOptions: { id?: string }) =>
    createBlockStub({ id: insertOptions.id ?? 'inserted' }));

  const blocksStore = {
    get length(): number {
      return store.length;
    },
    /**
     * The production code must never ask for an out-of-range index. Throwing
     * (instead of the real store's silent return) turns an off-by-one loop
     * into a failing test rather than an endless one.
     */
    remove: (index: number): void => {
      if (index < 0 || index >= store.length) {
        throw new RangeError(`remove() called with out-of-range index ${index}`);
      }
      removedIndices.push(index);
      const [removed] = store.splice(index, 1);

      if (removed !== undefined) {
        options.cascadeRemove?.(removed, store);
      }
    },
    insertMany: (inserted: Block[], index: number): void => {
      store.splice(index, 0, ...inserted);
    },
  };

  const privateFields = blockManager as unknown as Record<string, unknown>;

  const hierarchy = {
    setBlockParent: vi.fn((block: Block, parentId: string | null) => {
      const writable = block as { parentId: string | null };
      writable.parentId = parentId;
    }),
    updateBlockIndentation: vi.fn(),
    getBlockDepth: vi.fn(() => 0),
    ...options.hierarchy,
  };
  const eventBinder = {
    bindBlockEvents: vi.fn(),
    enableBindings: vi.fn(),
    disableBindings: vi.fn(),
  };
  const shortcuts = {
    register: vi.fn(),
    unregister: vi.fn(),
  };
  const factory = {
    composeBlock: vi.fn(() => createBlockStub({ id: 'composed' })),
  };

  privateFields.repository = {
    get blocks(): Block[] {
      return store;
    },
    get firstBlock(): Block | undefined {
      return store[0];
    },
    get lastBlock(): Block | undefined {
      return store[store.length - 1];
    },
    get topLevelBlocks(): Block[] {
      return store.filter((block) => block.parentId === null);
    },
    getBlockIndex: (block: Block): number => store.indexOf(block),
    getBlockByIndex: (index: number): Block | undefined => store[index],
    getBlockById: (id: string): Block | undefined => store.find((block) => block.id === id),
    getBlockByChildNode: (): Block | undefined => undefined,
    getBlock: (): Block | undefined => undefined,
    getNextContentfulBlock: (): Block | undefined => undefined,
    getPreviousContentfulBlock: (): Block | undefined => undefined,
    resolveToRootBlock: (block: Block): Block => block,
    resolveToSelectableBlock: (block: Block): Block => block,
    isSelectionUnit: (): boolean => true,
    getSelectionSiblingRange: (): Block[] => [],
    isBlokEmpty: (): boolean => store.length === 0,
    ...options.repository,
  };
  privateFields.yjsSync = {
    isSyncingFromYjs: false,
    isReconciling: (): boolean => false,
    isMaterializing: (): boolean => false,
    settleMaterialization: vi.fn(),
    withAtomicOperation: vi.fn((fn: () => void): void => fn()),
    withAtomicOperationAsync: vi.fn((fn: () => Promise<void>): Promise<void> => fn()),
    subscribe: vi.fn(),
    destroy: vi.fn(),
    ...options.yjsSync,
  };
  if (!options.omitOperations) {
    privateFields.operations = {
      suppressStopCapturing: false,
      currentBlockIndexValue: 0,
      currentBlock: 'currentBlock' in options ? options.currentBlock : undefined,
      removeBlock: operationsRemoveBlock,
      insert: operationsInsert,
      move: operationsMove,
      split: operationsSplit,
      insertDefaultBlockAtIndex: vi.fn(() => createBlockStub({ id: 'index-inserted' })),
      paste: vi.fn(async () => createBlockStub({ id: 'pasted' })),
      update: vi.fn(async () => createBlockStub({ id: 'updated' })),
      replace: vi.fn(() => createBlockStub({ id: 'replaced' })),
      mergeBlocks: vi.fn(async () => undefined),
      insertAtEnd: vi.fn(() => createBlockStub({ id: 'end-inserted' })),
      moveCurrentBlockUp: vi.fn(),
      moveCurrentBlockDown: vi.fn(),
      insertInsideParent: vi.fn(() => createBlockStub({ id: 'inside-inserted' })),
      splitBlockWithData: vi.fn(() => createBlockStub({ id: 'split-data' })),
      ...options.operations,
    };
  }
  if (!options.omitStore) {
    privateFields._blocks = blocksStore;
  }
  privateFields.hierarchy = hierarchy;
  privateFields.eventBinder = eventBinder;
  privateFields.shortcuts = shortcuts;
  privateFields.factory = factory;

  blockManager.state = {
    YjsManager: yjs,
    UI: { checkEmptiness, nodes: { wrapper: document.createElement('div') } },
    API: {},
    ...options.state,
  } as unknown as BlokModules;

  return {
    blockManager,
    store,
    yjs,
    yjsSync: privateFields.yjsSync as Record<string, unknown>,
    operations: privateFields.operations as Record<string, unknown>,
    hierarchy,
    eventBinder,
    shortcuts,
    factory,
    operationsRemoveBlock,
    operationsInsert,
    operationsMove,
    operationsSplit,
    checkEmptiness,
    removedIndices,
    mutations,
    events,
  };
};

const removedIds = (harness: Harness): string[] =>
  harness.yjs.removeBlock.mock.calls.map(([id]) => id as string);

const removedBlockIdsInOrder = (harness: Harness): string[] =>
  harness.operationsRemoveBlock.mock.calls.map(([block]) => (block as Block).id);

/**
 * Deleting a selected block must carry its Tab-nested followers with it —
 * no more, no less. Over-reaching loses unrelated blocks; under-reaching
 * strands orphans at a depth whose parent is gone.
 */
describe('BlockManager.deleteSelectedBlocksAndInsertReplacement — flat-indent followers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const nestedDocument = (selectedId: string): Harness => createHarness({
    blocks: [
      createBlockStub({ id: 'root-a', selected: selectedId === 'root-a' }),
      createBlockStub({ id: 'child-1', depth: 1, selected: selectedId === 'child-1' }),
      createBlockStub({ id: 'child-2', depth: 2, selected: selectedId === 'child-2' }),
      createBlockStub({ id: 'root-b', selected: selectedId === 'root-b' }),
      createBlockStub({ id: 'tail-child', depth: 1, selected: selectedId === 'tail-child' }),
    ],
  });

  it('takes the deeper blocks that follow the selected root, and stops at the next root', () => {
    const harness = nestedDocument('root-a');

    harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    expect(removedIds(harness)).toEqual(['child-2', 'child-1', 'root-a']);
  });

  it('takes only blocks deeper than the selected one, not its equal-depth sibling', () => {
    const harness = createHarness({
      blocks: [
        createBlockStub({ id: 'root-a' }),
        createBlockStub({ id: 'child-1', depth: 1, selected: true }),
        createBlockStub({ id: 'grand-1', depth: 2 }),
        createBlockStub({ id: 'child-2', depth: 1 }),
      ],
    });

    harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    expect(removedIds(harness)).toEqual(['grand-1', 'child-1']);
  });

  it('takes every follower to the end of the document when none returns to the shallower depth', () => {
    const harness = nestedDocument('root-b');

    harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    expect(removedIds(harness)).toEqual(['tail-child', 'root-b']);
  });

  it('deduplicates when a parent and one of its own followers are both selected', () => {
    const harness = createHarness({
      blocks: [
        createBlockStub({ id: 'root-a', selected: true }),
        createBlockStub({ id: 'child-1', depth: 1 }),
        createBlockStub({ id: 'child-2', depth: 1, selected: true }),
        createBlockStub({ id: 'root-b' }),
      ],
    });

    harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    expect(removedIds(harness)).toEqual(['child-2', 'child-1', 'root-a']);
  });
});

/**
 * The delete itself: one Yjs transaction, removals from the bottom up so
 * indices stay valid, and a replacement block only where it is wanted.
 */
describe('BlockManager.deleteSelectedBlocksAndInsertReplacement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const partialSelection = (): Harness => createHarness({
    blocks: [
      createBlockStub({ id: 'keep-0' }),
      createBlockStub({ id: 'gone-1', selected: true }),
      createBlockStub({ id: 'gone-2', selected: true }),
      createBlockStub({ id: 'keep-3' }),
    ],
  });

  const wholeSelection = (): Harness => createHarness({
    blocks: [
      createBlockStub({ id: 'gone-0', selected: true }),
      createBlockStub({ id: 'gone-1', selected: true }),
    ],
  });

  it('does nothing at all when no block is selected', () => {
    const harness = createHarness({ blocks: [createBlockStub({ id: 'only' })] });

    const result = harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    expect(result).toBeUndefined();
    expect(harness.yjs.transact).not.toHaveBeenCalled();
    expect(harness.operationsRemoveBlock).not.toHaveBeenCalled();
  });

  it('removes the DOM blocks from the highest index down so earlier indices stay valid', () => {
    const harness = partialSelection();

    harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    expect(removedBlockIdsInOrder(harness)).toEqual(['gone-2', 'gone-1']);
  });

  it('removes each selected block from the document inside a single transaction', () => {
    const harness = partialSelection();

    harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    expect(harness.yjs.transact).toHaveBeenCalledOnce();
    expect(removedIds(harness)).toEqual(['gone-2', 'gone-1']);
  });

  it('leaves Yjs to the caller when tearing the blocks out of the DOM', () => {
    const harness = partialSelection();

    harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    expect(harness.operationsRemoveBlock).toHaveBeenCalledWith(
      expect.anything(),
      false,
      true,
      expect.anything()
    );
  });

  it('inserts no replacement for a partial delete', () => {
    const harness = partialSelection();

    const result = harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    expect(result).toBeUndefined();
    expect(harness.yjs.addBlock).not.toHaveBeenCalled();
    expect(harness.operationsInsert).not.toHaveBeenCalled();
  });

  it('inserts a replacement for a partial delete when the caller forces one', () => {
    const harness = partialSelection();

    const result = harness.blockManager.deleteSelectedBlocksAndInsertReplacement(true);

    expect(result).toBeDefined();
    expect(harness.yjs.addBlock).toHaveBeenCalledOnce();
  });

  it('inserts a replacement at the first deleted position when the whole document goes', () => {
    const harness = createHarness({
      blocks: [
        createBlockStub({ id: 'gone-0', selected: true }),
        createBlockStub({ id: 'gone-1', selected: true }),
        createBlockStub({ id: 'gone-2', selected: true }),
      ],
    });

    harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    expect(harness.yjs.addBlock).toHaveBeenCalledWith(
      { id: expect.any(String), type: 'paragraph', data: {} },
      0
    );
  });

  it('inserts the replacement at the top of a forced partial delete, not at its end', () => {
    const harness = partialSelection();

    harness.blockManager.deleteSelectedBlocksAndInsertReplacement(true);

    expect(harness.yjs.addBlock).toHaveBeenCalledWith(expect.anything(), 1);
  });

  it('renders the replacement with the very id it wrote to the document, focused, without a second sync', () => {
    const harness = wholeSelection();

    harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    const [addedData, addedIndex] = harness.yjs.addBlock.mock.calls[0] as [{ id: string }, number];

    expect(harness.operationsInsert).toHaveBeenCalledWith(
      {
        id: addedData.id,
        tool: 'paragraph',
        index: addedIndex,
        needToFocus: true,
        skipYjsSync: true,
      },
      expect.anything()
    );
  });

  it('returns the inserted replacement block', () => {
    const harness = wholeSelection();

    const result = harness.blockManager.deleteSelectedBlocksAndInsertReplacement();

    expect(result).toBe(harness.operationsInsert.mock.results[0]?.value);
  });

  it('refuses to delete when no default block tool is configured', () => {
    const harness = createHarness({
      blocks: [createBlockStub({ id: 'gone', selected: true })],
      defaultBlock: undefined,
    });

    expect(() => harness.blockManager.deleteSelectedBlocksAndInsertReplacement())
      .toThrow(/Default block tool is not defined/);
    expect(harness.yjs.transact).not.toHaveBeenCalled();
  });
});

/**
 * removeAllBlocks empties the store and hands the user a focused empty block.
 */
describe('BlockManager.removeAllBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const threeBlocks = (currentBlock?: Block): Harness => createHarness({
    blocks: [
      createBlockStub({ id: 'a' }),
      createBlockStub({ id: 'b' }),
      createBlockStub({ id: 'c' }),
    ],
    currentBlock,
  });

  it('removes every block from the document', () => {
    const harness = threeBlocks();

    harness.blockManager.removeAllBlocks();

    expect(removedIds(harness)).toEqual(['a', 'b', 'c']);
    expect(harness.yjs.transact).toHaveBeenCalledOnce();
  });

  it('empties the store from the tail so no index shifts underneath the loop', () => {
    const harness = threeBlocks();

    harness.blockManager.removeAllBlocks();

    expect(harness.removedIndices).toEqual([2, 1, 0]);
    expect(harness.store).toHaveLength(0);
  });

  it('drops the current block index before inserting the fresh one', () => {
    const harness = threeBlocks();

    harness.blockManager.removeAllBlocks();

    expect(harness.blockManager.currentBlockIndex).toBe(-1);
    expect(harness.operationsInsert).toHaveBeenCalledOnce();
  });

  it('focuses the first input of the replacement block', () => {
    const current = createBlockStub({ id: 'fresh' });
    const harness = threeBlocks(current);
    const focusSpy = vi.spyOn(current.firstInput as HTMLElement, 'focus');

    harness.blockManager.removeAllBlocks();

    expect(focusSpy).toHaveBeenCalledOnce();
  });

  it('survives a replacement block that has no input yet', () => {
    const harness = threeBlocks(undefined);

    expect(() => harness.blockManager.removeAllBlocks()).not.toThrow();
  });
});

/**
 * Duplicating must copy the block the user would call "the one I am on":
 * the LAST block of a block-level selection, else the caret's block.
 */
describe('BlockManager.duplicateCurrentBlock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type DuplicateHarness = {
    blockManager: BlockManager;
    duplicateBlocksInPlace: ReturnType<typeof vi.fn>;
  };

  const createDuplicateHarness = (options: {
    isDragging?: boolean;
    selectedBlocks?: Block[];
    currentBlock?: Block | undefined;
    withDragManager?: boolean;
  }): DuplicateHarness => {
    const blockManager = new BlockManager({
      config: { defaultBlock: 'paragraph' },
      eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
    });
    const duplicateBlocksInPlace = vi.fn();
    const selectedBlocks = options.selectedBlocks ?? [];

    (blockManager as unknown as Record<string, unknown>).operations = {
      suppressStopCapturing: false,
      currentBlockIndexValue: 0,
      currentBlock: options.currentBlock,
    };

    blockManager.state = {
      YjsManager: { stopCapturing: vi.fn() },
      DragManager: options.withDragManager === false
        ? undefined
        : { isDragging: options.isDragging ?? false, duplicateBlocksInPlace },
      BlockSelection: {
        anyBlockSelected: selectedBlocks.length > 0,
        selectedBlocks,
      },
    } as unknown as BlokModules;

    return { blockManager, duplicateBlocksInPlace };
  };

  it('duplicates the caret block when nothing is block-selected', () => {
    const current = createBlockStub({ id: 'caret' });
    const harness = createDuplicateHarness({ currentBlock: current });

    harness.blockManager.duplicateCurrentBlock();

    expect(harness.duplicateBlocksInPlace).toHaveBeenCalledWith(current);
  });

  it('anchors on the last block of a block-level selection', () => {
    const selected = [createBlockStub({ id: 'first' }), createBlockStub({ id: 'last' })];
    const harness = createDuplicateHarness({ selectedBlocks: selected });

    harness.blockManager.duplicateCurrentBlock();

    expect(harness.duplicateBlocksInPlace).toHaveBeenCalledWith(selected[1]);
  });

  it('does nothing mid-drag, so a duplicate never lands on the dragged block', () => {
    const harness = createDuplicateHarness({
      isDragging: true,
      currentBlock: createBlockStub({ id: 'caret' }),
    });

    harness.blockManager.duplicateCurrentBlock();

    expect(harness.duplicateBlocksInPlace).not.toHaveBeenCalled();
  });

  it('does nothing when there is no block to anchor on', () => {
    const harness = createDuplicateHarness({ currentBlock: undefined });

    harness.blockManager.duplicateCurrentBlock();

    expect(harness.duplicateBlocksInPlace).not.toHaveBeenCalled();
  });

  it('does not throw when the drag manager is absent', () => {
    const harness = createDuplicateHarness({
      withDragManager: false,
      currentBlock: createBlockStub({ id: 'caret' }),
    });

    expect(() => harness.blockManager.duplicateCurrentBlock()).not.toThrow();
  });
});

/**
 * clear() empties the document and, on demand, seeds one fresh default block —
 * both halves inside a single undo entry.
 */
describe('BlockManager.clear', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const threeBlocks = (): Harness => createHarness({
    blocks: [
      createBlockStub({ id: 'a' }),
      createBlockStub({ id: 'b' }),
      createBlockStub({ id: 'c' }),
    ],
  });

  it('removes every block from the document and from the store', async () => {
    const harness = threeBlocks();

    harness.blockManager.currentBlockIndex = 2;

    await harness.blockManager.clear();

    expect(harness.yjs.transact).toHaveBeenCalledOnce();
    expect(removedIds(harness)).toEqual(['a', 'b', 'c']);
    expect(harness.store).toHaveLength(0);
    expect(harness.blockManager.currentBlockIndex).toBe(-1);
    expect(harness.checkEmptiness).toHaveBeenCalledOnce();
  });

  it('adds no default block unless asked', async () => {
    const harness = threeBlocks();

    await harness.blockManager.clear();

    expect(harness.yjs.addBlock).not.toHaveBeenCalled();
    expect(harness.operationsInsert).not.toHaveBeenCalled();
  });

  it('announces each removal with the index the block sat at', async () => {
    const harness = threeBlocks();

    await harness.blockManager.clear();

    expect(harness.mutations).toEqual([
      { type: BlockRemovedMutationType, index: 0 },
      { type: BlockRemovedMutationType, index: 0 },
      { type: BlockRemovedMutationType, index: 0 },
    ]);
  });

  it('seeds the default block into the document and renders the same id', async () => {
    const harness = threeBlocks();

    await harness.blockManager.clear(true);

    expect(harness.yjs.addBlock).toHaveBeenCalledWith(
      { id: expect.any(String), type: 'paragraph', data: {} },
      0
    );

    const [addedData] = harness.yjs.addBlock.mock.calls[0] as [{ id: string }];

    expect(harness.operationsInsert).toHaveBeenCalledWith(
      { id: addedData.id, skipYjsSync: true },
      expect.anything()
    );
  });

  it('adds no default block when no default tool is configured', async () => {
    const harness = createHarness({
      blocks: [createBlockStub({ id: 'a' })],
      defaultBlock: undefined,
    });

    await harness.blockManager.clear(true);

    expect(harness.yjs.addBlock).not.toHaveBeenCalled();
  });

  it('skips a block a sibling teardown already pulled out of the store', async () => {
    const harness = createHarness({
      blocks: [
        createBlockStub({ id: 'parent' }),
        createBlockStub({ id: 'child' }),
        createBlockStub({ id: 'last' }),
      ],
      cascadeRemove: (removed, store) => {
        if (removed.id === 'parent') {
          store.splice(store.findIndex((block) => block.id === 'child'), 1);
        }
      },
    });

    await harness.blockManager.clear();

    expect(harness.mutations.map(({ type }) => type)).toEqual([
      BlockRemovedMutationType,
      BlockRemovedMutationType,
    ]);
  });

  it('leaves the document untouched when the caller keeps the Yjs side', async () => {
    const harness = threeBlocks();

    await harness.blockManager.clear(false, { skipYjsSync: true });

    expect(harness.yjs.transact).not.toHaveBeenCalled();
    expect(harness.store).toHaveLength(0);
  });
});

/**
 * setCurrentBlockByChildNode must refuse a node that belongs to a DIFFERENT
 * Blok instance on the same page — otherwise one editor steals the other's caret.
 */
describe('BlockManager.setCurrentBlockByChildNode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  type ChildNodeHarness = {
    blockManager: BlockManager;
    block: Block;
    childNode: Node;
    updateCurrentInput: ReturnType<typeof vi.fn>;
  };

  const createChildNodeHarness = (options: {
    found?: boolean;
    inWrapper?: boolean;
    sameInstance?: boolean;
  }): ChildNodeHarness => {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-editor', '');

    const holder = document.createElement('div');
    const childNode = document.createElement('span');

    holder.appendChild(childNode);

    if (options.inWrapper !== false) {
      const host = options.sameInstance === false
        ? (() => {
          const other = document.createElement('div');

          other.setAttribute('data-blok-editor', 'other');

          return other;
        })()
        : wrapper;

      host.appendChild(holder);
    }

    const updateCurrentInput = vi.fn();
    const block = { id: 'found', holder, updateCurrentInput } as unknown as Block;

    const blockManager = new BlockManager({
      config: { defaultBlock: 'paragraph' },
      eventsDispatcher: new EventsDispatcher<BlokEventMap>(),
    });

    (blockManager as unknown as Record<string, unknown>).repository = {
      getBlockByChildNode: () => (options.found === false ? undefined : block),
      getBlockIndex: () => 7,
    };
    (blockManager as unknown as Record<string, unknown>).operations = {
      suppressStopCapturing: false,
      currentBlockIndexValue: 0,
    };

    blockManager.state = {
      YjsManager: { stopCapturing: vi.fn() },
      UI: { nodes: { wrapper } },
    } as unknown as BlokModules;

    return { blockManager, block, childNode, updateCurrentInput };
  };

  it('marks the found block as current and refreshes its input', () => {
    const harness = createChildNodeHarness({});

    const result = harness.blockManager.setCurrentBlockByChildNode(harness.childNode);

    expect(result).toBe(harness.block);
    expect(harness.blockManager.currentBlockIndex).toBe(7);
    expect(harness.updateCurrentInput).toHaveBeenCalledOnce();
  });

  it('returns undefined when no block owns the node', () => {
    const harness = createChildNodeHarness({ found: false });

    expect(harness.blockManager.setCurrentBlockByChildNode(harness.childNode)).toBeUndefined();
    expect(harness.blockManager.currentBlockIndex).toBe(-1);
  });

  it('refuses a block that belongs to another Blok instance', () => {
    const harness = createChildNodeHarness({ sameInstance: false });

    expect(harness.blockManager.setCurrentBlockByChildNode(harness.childNode)).toBeUndefined();
    expect(harness.updateCurrentInput).not.toHaveBeenCalled();
  });

  it('refuses a block whose holder sits outside any editor wrapper', () => {
    const harness = createChildNodeHarness({ inWrapper: false });

    expect(harness.blockManager.setCurrentBlockByChildNode(harness.childNode)).toBeUndefined();
  });
});

/**
 * move() delegates, and must not silently opt out of the DOM move or the
 * moved-hook — a skipped DOM move leaves the array and the DOM disagreeing.
 */
describe('BlockManager.move', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('moves in the DOM and fires the moved hook by default', () => {
    const harness = createHarness({
      blocks: [createBlockStub({ id: 'a' }), createBlockStub({ id: 'b' })],
    });

    harness.blockManager.move(1, 0);

    expect(harness.operationsMove).toHaveBeenCalledWith(1, 0, false, expect.anything(), false);
  });

  it('moves the current block when no source index is given', () => {
    const harness = createHarness({
      blocks: [createBlockStub({ id: 'a' }), createBlockStub({ id: 'b' })],
    });

    harness.blockManager.currentBlockIndex = 1;
    harness.blockManager.move(0);

    expect(harness.operationsMove).toHaveBeenCalledWith(0, 1, false, expect.anything(), false);
  });
});


/**
 * split() delegates to operations and must hand back the block it made —
 * swallowing it leaves the caller without the half the caret should land in.
 */
describe('BlockManager.split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the block operations produced', () => {
    const harness = createHarness({ blocks: [createBlockStub({ id: 'a' })] });

    const result = harness.blockManager.split();

    expect(harness.operationsSplit).toHaveBeenCalledOnce();
    expect(result).toBe(harness.operationsSplit.mock.results[0]?.value);
  });
});
/*
 * Mutation-campaign notes. Survivors left alive after the sweep, each with a
 * one-line proof.
 *
 * EQUIVALENT (no behaviour test can distinguish them):
 * - 2794 `?.` on yjsSync in the hierarchy's isSyncing getter: initializeServices
 *   assigns yjsSync (L437) right after the hierarchy (L410), before any callback
 *   can fire, so the chain never sees undefined.
 * - 2904/2907/2908 withFlatIndentFollowers' startIndex guard: the only caller
 *   passes members of the same array the helper indexOf's, so startIndex < 0 is
 *   unreachable.
 * - 3277/3278/3302/3303 clear() default-block guards: defaultBlockId is derived
 *   from needToAddDefaultBlock, so conjunct 2 is true whenever conjunct 1 is;
 *   && vs || vs true are indistinguishable.
 * - 3332/3334 selectedBlocksForMove: empty array and undefined both yield a
 *   zero-iteration reselect loop.
 * - 3362/3363 breaking the CustomEvent's detail at construction is inert: the
 *   enumerability fix-up below re-installs detail from eventDetail (jsdom keeps
 *   detail non-enumerable, so the fix-up always runs).
 * - 3365/3367/3375/3377 forcing the enumerability guard either way runs the same
 *   defineProperty, because CustomEvent type/detail are non-enumerable here.
 * - 3373/3383 mutate `configurable`, an attribute nothing re-reads.
 * - 3402/3404 reconcileChildrenToParents' null-parent skip: get(null) is
 *   undefined, so the fall-through assigns parentId = null (no-op) and continues.
 * - 3417/3419 reconcileParentsToChildren's empty-contentIds skip: filtering []
 *   is identity.
 * - 3208 first conjunct `candidateParentId !== null` -> true: sectionIds never
 *   contains null, so has(candidateParentId) is false exactly when the conjunct
 *   was false.
 * - 3442/3448/3449 snapshot spreads forced always-on add `parent: null` /
 *   `content: []`, which the validators treat exactly like absent keys.
 * - 3452/3455/3456 typeof-process / env guards: process always exists under
 *   node/vitest, so all three forms read the same NODE_ENV.
 * - 3479 size===0 forced true: the extra microtask flushes an empty set.
 * - 3487 promises array seeded with a non-thenable: Promise.all timing is
 *   unchanged and the resolution value is never read.
 * - 3495/3497 pending assigned on empty promises: Promise.all([]) settles before
 *   the double-microtask reader in endToolTransaction observes it.
 * - 3500 dropping the pending=null reset leaves a resolved promise in the field;
 *   every reader path still calls stopCapturing exactly once.
 * - 3510 dataChangedRef {} vs {value:false}: falsy-identical at every read.
 * - 3554 resolveHeadingLevel's parentId-null guard is duplicated by the callee:
 *   getBlockById(null) is undefined so the depth lookup is false anyway.
 *
 * The 34 former "unresolved" closure mutants (2767, 2772-2785, 2787-2814) and
 * crash-class 3489 are all KILLED by the "prepared boot — real sub-module
 * closures" describe below, which boots prepare() with real sub-modules.
 */

/**
 * Getter and delegate one-liners. Identity assertions: every early return and
 * optional chain here fails into a value that only identity can tell apart.
 */
describe('BlockManager getters and delegate one-liners', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the repository views by identity', () => {
    const harness = createHarness({
      blocks: [
        createBlockStub({ id: 'a' }),
        createBlockStub({ id: 'b' }),
        createBlockStub({ id: 'c', parentId: 'a' }),
      ],
    });

    expect(harness.blockManager.firstBlock).toBe(harness.store[0]);
    expect(harness.blockManager.lastBlock).toBe(harness.store[2]);
    expect(harness.blockManager.isBlokEmpty).toBe(false);
    expect(harness.blockManager.topLevelBlocks).toEqual([harness.store[0], harness.store[1]]);
  });

  it('surfaces repository sentinels through the query delegates', () => {
    const target = createBlockStub({ id: 'target' });
    const root = createBlockStub({ id: 'root' });
    const selectable = createBlockStub({ id: 'selectable' });
    const siblingRange = [root, selectable];
    const harness = createHarness({
      blocks: [target],
      repository: {
        getBlockByIndex: () => target,
        getBlockById: () => target,
        getBlock: () => target,
        getBlockByChildNode: () => target,
        resolveToRootBlock: () => root,
        resolveToSelectableBlock: () => selectable,
        isSelectionUnit: () => true,
        getSelectionSiblingRange: () => siblingRange,
      },
      hierarchy: {
        getBlockDepth: () => 3,
      },
    });

    expect(harness.blockManager.getBlockByIndex(0)).toBe(target);
    expect(harness.blockManager.getBlockById('x')).toBe(target);
    expect(harness.blockManager.getBlock(document.createElement('div'))).toBe(target);
    expect(harness.blockManager.getBlockByChildNode(document.createElement('span'))).toBe(target);
    expect(harness.blockManager.resolveToRootBlock(target)).toBe(root);
    expect(harness.blockManager.resolveToSelectableBlock(target)).toBe(selectable);
    expect(harness.blockManager.isSelectionUnit(target)).toBe(true);
    expect(harness.blockManager.getSelectionSiblingRange(target, root)).toBe(siblingRange);
    expect(harness.blockManager.getBlockDepth(target)).toBe(3);
  });

  it('reads operation-backed neighbours through to the operations stub', () => {
    const next = createBlockStub({ id: 'next' });
    const prev = createBlockStub({ id: 'prev' });
    const nextVisible = createBlockStub({ id: 'next-visible' });
    const prevVisible = createBlockStub({ id: 'prev-visible' });
    const harness = createHarness({
      blocks: [],
      operations: {
        nextBlock: next,
        previousBlock: prev,
        nextVisibleBlock: nextVisible,
        previousVisibleBlock: prevVisible,
      },
    });

    expect(harness.blockManager.nextBlock).toBe(next);
    expect(harness.blockManager.previousBlock).toBe(prev);
    expect(harness.blockManager.nextVisibleBlock).toBe(nextVisible);
    expect(harness.blockManager.previousVisibleBlock).toBe(prevVisible);
  });

  it('answers null neighbours before the operations module exists', () => {
    const { blockManager } = createHarness({ blocks: [], omitOperations: true });

    expect(blockManager.nextBlock).toBeNull();
    expect(blockManager.previousBlock).toBeNull();
    expect(blockManager.nextVisibleBlock).toBeNull();
    expect(blockManager.previousVisibleBlock).toBeNull();
    expect(blockManager.currentBlock).toBeUndefined();
  });

  it('surfaces the repository contentful-block sentinels', () => {
    const nextContentful = createBlockStub({ id: 'nc' });
    const prevContentful = createBlockStub({ id: 'pc' });
    const harness = createHarness({
      blocks: [],
      repository: {
        getNextContentfulBlock: () => nextContentful,
        getPreviousContentfulBlock: () => prevContentful,
      },
    });

    expect(harness.blockManager.nextContentfulBlock).toBe(nextContentful);
    expect(harness.blockManager.previousContentfulBlock).toBe(prevContentful);
  });

  it('reports the current block and a raised suppression flag', () => {
    const current = createBlockStub({ id: 'current' });
    const harness = createHarness({
      blocks: [],
      operations: { currentBlock: current, suppressStopCapturing: true },
    });

    expect(harness.blockManager.currentBlock).toBe(current);
    expect(harness.blockManager.suppressStopCapturing).toBe(true);
  });

  it('defaults suppression to false with and without an operations module', () => {
    const without = createHarness({ blocks: [], omitOperations: true });
    const withUnsetFlag = createHarness({ blocks: [], operations: {} });

    // The flag is genuinely absent, not false: the ?? fallback is the behavior.
    delete (withUnsetFlag.operations).suppressStopCapturing;

    expect(without.blockManager.suppressStopCapturing).toBe(false);
    expect(withUnsetFlag.blockManager.suppressStopCapturing).toBe(false);
  });

  it('tracks the pointer-drag flag', () => {
    const harness = createHarness({ blocks: [] });

    expect(harness.blockManager.isPointerDragActive).toBe(false);
    harness.blockManager.setPointerDragActive(true);
    expect(harness.blockManager.isPointerDragActive).toBe(true);
  });
});

/**
 * The index/block setters. Setting currentBlock = undefined must short-circuit
 * to unsetCurrentBlock without consulting the repository.
 */
describe('BlockManager.currentBlockIndex and currentBlock setters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores the index without an operations module', () => {
    const { blockManager } = createHarness({ blocks: [], omitOperations: true });

    blockManager.currentBlockIndex = 5;

    expect(blockManager.currentBlockIndex).toBe(5);
  });

  it('mirrors the index into operations when present', () => {
    const harness = createHarness({ blocks: [] });

    harness.blockManager.currentBlockIndex = 3;

    expect(harness.blockManager.currentBlockIndex).toBe(3);
    expect((harness.operations as { currentBlockIndexValue: number }).currentBlockIndexValue).toBe(3);
  });

  it('unsets through undefined without asking the repository where the block was', () => {
    const block = createBlockStub({ id: 'b' });
    const getBlockIndex = vi.fn(() => 1);
    const harness = createHarness({ blocks: [block], repository: { getBlockIndex } });

    harness.blockManager.currentBlockIndex = 2;
    harness.blockManager.currentBlock = undefined;

    expect(harness.blockManager.currentBlockIndex).toBe(-1);
    expect(getBlockIndex).not.toHaveBeenCalled();
    expect((harness.operations as { currentBlockIndexValue: number }).currentBlockIndexValue).toBe(-1);
  });
});

describe('BlockManager.setPlaceholder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('pushes the placeholder into the default tool and every block', () => {
    const setDefaultPlaceholder = vi.fn();
    const a = createBlockStub({ id: 'a' });
    const b = createBlockStub({ id: 'b' });
    const harness = createHarness({
      blocks: [a, b],
      state: { Tools: { blockTools: new Map([['paragraph', { setDefaultPlaceholder }]]) } },
    });

    harness.blockManager.setPlaceholder('Type here');

    expect(setDefaultPlaceholder).toHaveBeenCalledOnce();
    expect(setDefaultPlaceholder).toHaveBeenCalledWith('Type here');
    expect(a.setPlaceholder).toHaveBeenCalledWith('Type here');
    expect(b.setPlaceholder).toHaveBeenCalledWith('Type here');
  });

  it('falls back to the paragraph tool when no default block is configured', () => {
    const setDefaultPlaceholder = vi.fn();
    const harness = createHarness({
      blocks: [],
      defaultBlock: undefined,
      state: { Tools: { blockTools: new Map([['paragraph', { setDefaultPlaceholder }]]) } },
    });

    harness.blockManager.setPlaceholder('Hi');

    expect(setDefaultPlaceholder).toHaveBeenCalledWith('Hi');
  });

  it('survives a tool map without the default tool', () => {
    const a = createBlockStub({ id: 'a' });
    const harness = createHarness({
      blocks: [a],
      state: { Tools: { blockTools: new Map() } },
    });

    expect(() => harness.blockManager.setPlaceholder('Hi')).not.toThrow();
    expect(a.setPlaceholder).toHaveBeenCalledWith('Hi');
  });
});

describe('BlockManager.withViewRebuild', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('holds the sync window open through the next animation frame', async () => {
    const harness = createHarness({ blocks: [] });
    let ran = false;
    const rebuild = async (): Promise<void> => {
      ran = true;
    };

    await harness.blockManager.withViewRebuild(rebuild);

    const atomicAsync = harness.yjsSync.withAtomicOperationAsync as Mock;

    expect(atomicAsync).toHaveBeenCalledOnce();
    expect(atomicAsync.mock.calls[0]?.[1]).toEqual({ extendThroughRAF: true });
    expect(ran).toBe(true);
  });
});

describe('BlockManager.toggleReadOnly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds events back when leaving read-only, on the exact blocks array', () => {
    const harness = createHarness({ blocks: [createBlockStub({ id: 'a' })] });

    harness.blockManager.toggleReadOnly(false);

    expect(harness.eventBinder.enableBindings).toHaveBeenCalledOnce();
    expect((harness.eventBinder.enableBindings as Mock).mock.calls[0]?.[0]).toBe(harness.store);
    expect(harness.eventBinder.disableBindings).not.toHaveBeenCalled();
  });

  it('unbinds events when entering read-only', () => {
    const harness = createHarness({ blocks: [createBlockStub({ id: 'a' })] });

    harness.blockManager.toggleReadOnly(true);

    expect(harness.eventBinder.disableBindings).toHaveBeenCalledOnce();
    expect(harness.eventBinder.enableBindings).not.toHaveBeenCalled();
  });
});

describe('BlockManager.blocksStore guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses block operations before prepare() built the store', async () => {
    const harness = createHarness({ blocks: [], omitStore: true });

    await expect(harness.blockManager.update(createBlockStub({ id: 'a' })))
      .rejects.toThrowError(new Error('BlockManager: blocks store is not initialized. Call prepare() before accessing blocks.'));
  });
});

describe('BlockManager thin delegations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults insertDefaultBlockAtIndex to unfocused, yjs-synced, top-level', () => {
    const insertDefaultBlockAtIndex = vi.fn(() => createBlockStub({ id: 'inserted' }));
    const harness = createHarness({ blocks: [], operations: { insertDefaultBlockAtIndex } });

    harness.blockManager.insertDefaultBlockAtIndex(2);

    expect(insertDefaultBlockAtIndex).toHaveBeenCalledWith(2, false, false, expect.anything(), false);
  });

  it('defaults paste to the non-replacing variant', async () => {
    const paste = vi.fn(async () => createBlockStub({ id: 'pasted' }));
    const harness = createHarness({ blocks: [], operations: { paste } });
    const pasteEvent = { detail: { data: '' } } as unknown as PasteEvent;

    await harness.blockManager.paste('heading', pasteEvent);

    expect(paste).toHaveBeenCalledWith('heading', pasteEvent, false, expect.anything(), undefined);
  });

  it('hands mergeBlocks the target, the donor and the store, and returns the continuation', async () => {
    const continuation = Symbol('continuation');
    const mergeBlocks = vi.fn(() => continuation);
    const a = createBlockStub({ id: 'a' });
    const b = createBlockStub({ id: 'b' });
    const harness = createHarness({ blocks: [a, b], operations: { mergeBlocks } });

    const result = await harness.blockManager.mergeBlocks(a, b);

    expect(result).toBe(continuation);
    expect(mergeBlocks).toHaveBeenCalledWith(a, b, expect.anything());
  });

  it('defaults removeBlock to adding a replacement last block', () => {
    const block = createBlockStub({ id: 'gone' });
    const harness = createHarness({ blocks: [block] });

    void harness.blockManager.removeBlock(block);

    expect(harness.operationsRemoveBlock).toHaveBeenCalledWith(block, true, false, expect.anything());
  });
});

/**
 * insertMany serialization: the Yjs payload must carry tunes / parent /
 * content keys exactly when they are non-empty, and the side effects
 * (indentation, atomic window, notification) must fire.
 */
describe('BlockManager.insertMany serialization and side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serializes tunes, parent and content onto the document payload', () => {
    const parent = createBlockStub({ id: 'p0', contentIds: ['c9'] });
    const child = createBlockStub({
      id: 'c9',
      parentId: 'p0',
      preservedTunes: { mark: { bold: true } },
      preservedData: { text: 'hi' },
    });
    const harness = createHarness({ blocks: [parent, child] });

    harness.blockManager.insertMany([parent, child], 0);

    const payloads = ((harness.yjs.fromJSON).mock.calls[0]?.[0] ?? []) as Array<Record<string, unknown>>;

    expect(payloads[0]).toStrictEqual({ id: 'p0', type: 'paragraph', data: {}, content: ['c9'] });
    expect(payloads[1]).toStrictEqual({
      id: 'c9',
      type: 'paragraph',
      data: { text: 'hi' },
      parent: 'p0',
      tunes: { mark: { bold: true } },
    });
    expect(harness.mutations).toHaveLength(0);
  });

  it('omits empty tunes and absent content keys entirely', () => {
    const plain = createBlockStub({ id: 'plain' });
    const harness = createHarness({ blocks: [plain] });

    harness.blockManager.insertMany([plain], 0);

    const payloads = ((harness.yjs.fromJSON).mock.calls[0]?.[0] ?? []) as Array<Record<string, unknown>>;

    expect(payloads[0]).toStrictEqual({ id: 'plain', type: 'paragraph', data: {} });
  });

  it('re-indents every block that carried a parent, and only those', () => {
    const parent = createBlockStub({ id: 'p0', contentIds: ['c9'] });
    const child = createBlockStub({ id: 'c9', parentId: 'p0' });
    const harness = createHarness({ blocks: [parent, child] });

    harness.blockManager.insertMany([parent, child], 0);

    expect(harness.hierarchy.updateBlockIndentation).toHaveBeenCalledOnce();
    expect((harness.hierarchy.updateBlockIndentation as Mock).mock.calls[0]?.[0]).toBe(child);
  });

  it('keeps the whole store write inside one RAF-extended atomic window', () => {
    const plain = createBlockStub({ id: 'plain' });
    const harness = createHarness({ blocks: [plain] });

    harness.blockManager.insertMany([plain], 0);

    const atomic = harness.yjsSync.withAtomicOperation as Mock;

    expect(atomic).toHaveBeenCalledOnce();
    expect(atomic.mock.calls[0]?.[1]).toEqual({ extendThroughRAF: true });
  });

  it('announces a notified batch with the batch insertion index', () => {
    const a = createBlockStub({ id: 'a' });
    const b = createBlockStub({ id: 'b' });
    const harness = createHarness({ blocks: [a, b] });

    harness.blockManager.insertMany([a, b], 2, { notify: true });

    expect(harness.mutations).toHaveLength(1);
    expect(harness.mutations[0]?.type).toBe(BlockAddedMutationType);
    expect(harness.mutations[0]?.index).toBe(2);
  });

  it('stays silent for a notified batch that carries no blocks', () => {
    const harness = createHarness({ blocks: [] });

    harness.blockManager.insertMany([], 3, { notify: true });

    expect(harness.mutations).toHaveLength(0);
  });

  it('leaves Yjs untouched when the caller owns the sync', () => {
    const plain = createBlockStub({ id: 'plain' });
    const harness = createHarness({ blocks: [plain] });

    harness.blockManager.insertMany([plain], 0, { skipYjsSync: true });

    expect(harness.yjs.fromJSON).not.toHaveBeenCalled();
  });
});

/**
 * assertInsertManyHierarchy picks its strategy from NODE_ENV: assert and throw
 * in test/development, validate and log in production. These tests move the
 * environment to reach both branches. Duplicate content ids survive the
 * insertMany reconcilers, so they are the drift signal here.
 */
describe('BlockManager.insertMany hierarchy assertion (environment-dependent)', () => {
  const originalEnv = process.env.NODE_ENV;
  let consoleError: Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  it('logs drift instead of throwing outside test and development environments', () => {
    process.env.NODE_ENV = 'production';
    const parent = createBlockStub({ id: 'p0', contentIds: ['c1', 'c1', 'c2', 'c2'] });
    const c1 = createBlockStub({ id: 'c1', parentId: 'p0' });
    const c2 = createBlockStub({ id: 'c2', parentId: 'p0' });
    const harness = createHarness({ blocks: [parent, c1, c2] });

    harness.blockManager.insertMany([parent, c1, c2], 0);

    expect(consoleError).toHaveBeenCalledOnce();
    const firstArg = consoleError.mock.calls[0]?.[0] as string;

    expect(firstArg).toContain('hierarchy drift');
    expect(firstArg).toContain('contains duplicate id c1; Block');
    expect(firstArg).toContain('contains duplicate id c2');
  });

  it('logs nothing when the reconciled batch is consistent', () => {
    process.env.NODE_ENV = 'production';
    const plain = createBlockStub({ id: 'plain' });
    const harness = createHarness({ blocks: [plain] });

    harness.blockManager.insertMany([plain], 0);

    expect(consoleError).not.toHaveBeenCalled();
  });

  it('throws on drift in a development environment', () => {
    process.env.NODE_ENV = 'development';
    const parent = createBlockStub({ id: 'p0', contentIds: ['c1', 'c1'] });
    const c1 = createBlockStub({ id: 'c1', parentId: 'p0' });
    const harness = createHarness({ blocks: [parent, c1] });

    expect(() => harness.blockManager.insertMany([parent, c1], 0))
      .toThrowError(new Error('Hierarchy invariant violated at BlockManager.insertMany:\n  - Block p0.content[] contains duplicate id c1'));
  });
});

/**
 * The undo-group plumbing: suppression must survive a begin/end pair, restore
 * on a bare end, and stopCapturing must wait for a pending parent sync.
 */
describe('BlockManager tool transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores the outer suppression level after a begin/end pair', async () => {
    const harness = createHarness({ blocks: [], operations: { suppressStopCapturing: true } });

    harness.blockManager.beginToolTransaction();
    harness.blockManager.endToolTransaction();
    await settle();

    expect((harness.operations as { suppressStopCapturing: boolean }).suppressStopCapturing).toBe(true);
    // begin() opens the group, end() closes it after the parent-sync window.
    expect(harness.yjs.stopCapturing).toHaveBeenCalledTimes(2);
  });

  it('restores plain false when an end has no matching begin', async () => {
    const harness = createHarness({ blocks: [] });

    harness.blockManager.endToolTransaction();
    await settle();

    expect((harness.operations as { suppressStopCapturing: boolean }).suppressStopCapturing).toBe(false);
    expect(harness.yjs.stopCapturing).toHaveBeenCalledOnce();
  });

  it('keeps the undo group open until a pre-set pending parent sync settles', async () => {
    const harness = createHarness({ blocks: [] });
    let resolvePending: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });

    (harness.blockManager as unknown as Record<string, unknown>).pendingParentSyncPromise = pending;

    harness.blockManager.endToolTransaction();
    await settle();

    expect(harness.yjs.stopCapturing).not.toHaveBeenCalled();

    resolvePending?.();
    await settle();
    await settle();

    expect(harness.yjs.stopCapturing).toHaveBeenCalledOnce();
  });

  it('delays stopCapturing until a scheduled parent sync has flushed', async () => {
    const parent = createBlockStub({ id: 'parent', saveData: {} });
    let releaseSave: (() => void) | undefined;

    (parent as unknown as { save: () => Promise<unknown> }).save = () => new Promise((resolve) => {
      releaseSave = () => resolve({ data: { text: 'x' } });
    });
    const harness = createHarness({ blocks: [parent] });

    invokePrivate(harness.blockManager, 'scheduleParentSync', 'parent');
    harness.blockManager.endToolTransaction();
    await settle();

    expect(harness.yjs.stopCapturing).not.toHaveBeenCalled();

    releaseSave?.();
    await settle();
    await settle();

    expect(harness.yjs.stopCapturing).toHaveBeenCalledOnce();
    expect(harness.yjs.enqueueBlockDataWrite).toHaveBeenCalledOnce();
  });

  it('flushes each scheduled parent once per batch, and again next batch', async () => {
    const parent = createBlockStub({ id: 'parent', saveData: { text: 'x' } });
    const harness = createHarness({ blocks: [parent] });

    invokePrivate(harness.blockManager, 'scheduleParentSync', 'parent');
    await settle();
    invokePrivate(harness.blockManager, 'scheduleParentSync', 'parent');
    await settle();

    expect(harness.yjs.enqueueBlockDataWrite).toHaveBeenCalledTimes(2);
  });

  it('ignores a scheduled parent that is no longer in the document', async () => {
    const harness = createHarness({ blocks: [] });

    expect(() => invokePrivate(harness.blockManager, 'scheduleParentSync', 'ghost')).not.toThrow();
    await settle();

    expect(harness.yjs.enqueueBlockDataWrite).not.toHaveBeenCalled();
  });
});

/**
 * setBlockParent: emission guards (same parent, drag, sync replay), the doc
 * write (capture / no-capture / pending-move), and resolveYjsPlacement's
 * sibling resolution.
 */
describe('BlockManager.setBlockParent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits BlockMoved and fires the MOVED hook with the flat index', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const harness = createHarness({ blocks: [block] });

    harness.blockManager.setBlockParent(block, 'new');

    expect(harness.hierarchy.setBlockParent).toHaveBeenCalledWith(block, 'new');
    expect(harness.mutations).toHaveLength(1);
    expect(harness.mutations[0]?.type).toBe(BlockMovedMutationType);
    expect(harness.mutations[0]?.fromIndex).toBe(0);
    expect(harness.mutations[0]?.toIndex).toBe(0);
    expect(block.call).toHaveBeenCalledWith(expect.anything(), { fromIndex: 0, toIndex: 0 });
  });

  it('emits nothing when the parent did not actually change', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'same' });
    const harness = createHarness({ blocks: [block] });

    harness.blockManager.setBlockParent(block, 'same');

    expect(harness.mutations).toHaveLength(0);
    expect(block.call).not.toHaveBeenCalled();
  });

  it('stays silent while a pointer drag owns the move', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const harness = createHarness({ blocks: [block] });

    harness.blockManager.setPointerDragActive(true);
    harness.blockManager.setBlockParent(block, 'new');

    expect(harness.mutations).toHaveLength(0);
    expect(block.call).not.toHaveBeenCalled();
    expect(harness.hierarchy.setBlockParent).toHaveBeenCalledOnce();
  });

  it('stays silent while a drag move group owns the move', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const harness = createHarness({ blocks: [block], yjs: { isDragMoveGroupActive: true } });

    harness.blockManager.setBlockParent(block, 'new');

    expect(harness.mutations).toHaveLength(0);
    expect(block.call).not.toHaveBeenCalled();
  });

  it('skips the doc write when a sync replay already agrees', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const harness = createHarness({
      blocks: [block],
      yjs: { getBlockById: vi.fn(() => ({ id: 'mover', get: () => 'new' })) },
    });

    (harness.yjsSync as { isSyncingFromYjs: boolean }).isSyncingFromYjs = true;
    harness.blockManager.setBlockParent(block, 'new');

    expect(harness.yjs.applyBlockPlacement).not.toHaveBeenCalled();
  });

  it('still writes the doc when a non-sync re-assert already agrees', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'same' });
    const harness = createHarness({
      blocks: [block],
      yjs: { getBlockById: vi.fn(() => ({ id: 'mover', get: () => 'same' })) },
    });

    harness.blockManager.setBlockParent(block, 'same');

    expect(harness.yjs.applyBlockPlacement).toHaveBeenCalledOnce();
  });

  it('treats an undefined Yjs parent as agreement with a root move during replay', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const harness = createHarness({
      blocks: [block],
      yjs: { getBlockById: vi.fn(() => ({ id: 'mover', get: () => undefined })) },
    });

    (harness.yjsSync as { isSyncingFromYjs: boolean }).isSyncingFromYjs = true;
    harness.blockManager.setBlockParent(block, null);

    expect(harness.yjs.applyBlockPlacement).not.toHaveBeenCalled();
  });

  it('attaches the placement to an in-flight move group without capture', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const fromPlacement = { parentId: 'old', afterId: null };
    const harness = createHarness({
      blocks: [block],
      yjs: {
        isInMoveGroup: true,
        getBlockPlacement: vi.fn(() => fromPlacement),
      },
    });

    harness.blockManager.setBlockParent(block, 'new');

    expect(harness.yjs.applyBlockPlacement).toHaveBeenCalledWith(block.id, { parentId: 'new', afterId: null }, { capture: false });
    expect(harness.yjs.recordParentChangeForPendingMove).toHaveBeenCalledWith(block.id, fromPlacement, { parentId: 'new', afterId: null });
  });

  it('skips pending-move recording when the old placement is unknown', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const harness = createHarness({
      blocks: [block],
      yjs: { isInMoveGroup: true, getBlockPlacement: vi.fn(() => null) },
    });

    harness.blockManager.setBlockParent(block, 'new');

    expect(harness.yjs.applyBlockPlacement).toHaveBeenCalledOnce();
    expect(harness.yjs.recordParentChangeForPendingMove).not.toHaveBeenCalled();
  });

  it('writes the placement with capture on the normal path', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const parentInStore = createBlockStub({ id: 'p0', contentIds: ['sib1', 'mover'] });
    const harness = createHarness({ blocks: [parentInStore, block] });

    harness.blockManager.setBlockParent(block, 'p0');

    expect(harness.yjs.applyBlockPlacement).toHaveBeenCalledOnce();
    expect(harness.yjs.applyBlockPlacement).toHaveBeenCalledWith(block.id, { parentId: 'p0', afterId: 'sib1' }, { capture: true });
  });

  it('appends after the last listed sibling when the hierarchy lost the child', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const parentInStore = createBlockStub({ id: 'p0', contentIds: ['other'] });
    const harness = createHarness({ blocks: [parentInStore, block] });

    harness.blockManager.setBlockParent(block, 'p0');

    expect(harness.yjs.applyBlockPlacement).toHaveBeenCalledWith(block.id, { parentId: 'p0', afterId: 'other' }, { capture: true });
  });

  it('gives a first-child placement no predecessor', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const parentInStore = createBlockStub({ id: 'p0', contentIds: ['mover', 'other'] });
    const harness = createHarness({ blocks: [parentInStore, block] });

    harness.blockManager.setBlockParent(block, 'p0');

    expect(harness.yjs.applyBlockPlacement).toHaveBeenCalledWith(block.id, { parentId: 'p0', afterId: null }, { capture: true });
  });

  it('resolves a dangling child with an empty sibling list to a null predecessor', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const parentInStore = createBlockStub({ id: 'p0', contentIds: [] });
    const harness = createHarness({ blocks: [parentInStore, block] });

    harness.blockManager.setBlockParent(block, 'p0');

    expect(harness.yjs.applyBlockPlacement).toHaveBeenCalledWith(block.id, { parentId: 'p0', afterId: null }, { capture: true });
  });

  it('keeps a dangling parent id in the doc placement', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const harness = createHarness({ blocks: [block] });

    harness.blockManager.setBlockParent(block, 'ghost');

    expect(harness.yjs.applyBlockPlacement).toHaveBeenCalledWith(block.id, { parentId: 'ghost', afterId: null }, { capture: true });
  });

  it('anchors a root move after the nearest preceding root block', () => {
    const rootA = createBlockStub({ id: 'root-a', parentId: null });
    const rootB = createBlockStub({ id: 'root-b', parentId: null });
    const child = createBlockStub({ id: 'child', parentId: 'root-a' });
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const harness = createHarness({ blocks: [rootA, rootB, child, block] });

    harness.blockManager.setBlockParent(block, null);

    expect(harness.yjs.applyBlockPlacement).toHaveBeenCalledWith(block.id, { parentId: null, afterId: 'root-b' }, { capture: true });
  });

  it('gives a leading root move no predecessor', () => {
    const block = createBlockStub({ id: 'mover', parentId: 'old' });
    const harness = createHarness({ blocks: [block] });

    harness.blockManager.setBlockParent(block, null);

    expect(harness.yjs.applyBlockPlacement).toHaveBeenCalledWith(block.id, { parentId: null, afterId: null }, { capture: true });
  });
});

/**
 * Indentation delegate, history-replay hook, teardown, and the private event
 * binding (whose only public path is the factory callback wired at boot).
 */
describe('BlockManager.indentation, history replay, teardown and binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates indentation to the hierarchy module', () => {
    const block = createBlockStub({ id: 'a' });
    const harness = createHarness({ blocks: [block] });

    harness.blockManager.updateBlockIndentation(block);

    expect(harness.hierarchy.updateBlockIndentation).toHaveBeenCalledWith(block);
  });

  it('replays a structural move into the tool hook', () => {
    const block = createBlockStub({ id: 'moved', parentId: 'p1' });
    const harness = createHarness({ blocks: [block] });

    harness.blockManager.reparentFromHistoryReplay(block, null);

    expect(harness.hierarchy.setBlockParent).toHaveBeenCalledWith(block, null);
    expect(block.call).toHaveBeenCalledOnce();
    expect(block.call).toHaveBeenCalledWith(expect.anything(), { fromIndex: 0, toIndex: 0, structural: true });
  });

  it('tears down shortcuts, sync and every block', async () => {
    const a = createBlockStub({ id: 'a' });
    const b = createBlockStub({ id: 'b' });
    const harness = createHarness({ blocks: [a, b] });

    await harness.blockManager.destroy();

    expect(harness.shortcuts.unregister).toHaveBeenCalledOnce();
    expect(harness.yjsSync.destroy).toHaveBeenCalledOnce();
    expect(a.destroy).toHaveBeenCalledOnce();
    expect(b.destroy).toHaveBeenCalledOnce();
  });

  it('routes composed-block event binding through the event binder', () => {
    const block = createBlockStub({ id: 'a' });
    const harness = createHarness({ blocks: [] });

    invokePrivate(harness.blockManager, 'bindBlockEvents', block);

    expect(harness.eventBinder.bindBlockEvents).toHaveBeenCalledWith(block);
  });

  it('moves blocks without a drag manager present', () => {
    const harness = createHarness({
      blocks: [createBlockStub({ id: 'a' }), createBlockStub({ id: 'b' })],
    });

    expect(() => harness.blockManager.moveCurrentBlockUp()).not.toThrow();
    expect(() => harness.blockManager.moveCurrentBlockDown()).not.toThrow();
    expect(harness.operations.moveCurrentBlockUp).toHaveBeenCalledOnce();
    expect(harness.operations.moveCurrentBlockDown).toHaveBeenCalledOnce();
  });

  it('reselects the moved selection after a keyboard move', () => {
    const selected = createBlockStub({ id: 'sel' });
    const selectBlock = vi.fn();
    const harness = createHarness({
      blocks: [selected, createBlockStub({ id: 'b' })],
      state: {
        BlockSelection: { anyBlockSelected: true, selectedBlocks: [selected], selectBlock },
        DragManager: { isDragging: false },
      },
    });

    harness.blockManager.moveCurrentBlockUp();

    expect(selectBlock).toHaveBeenCalledWith(selected);
  });
});

/**
 * convert(): a standalone toggle LIST keeps its children nested (M-5); a
 * toggle HEADING releases them; converting INTO a toggle heading adopts the
 * following section up to the next same-rank heading.
 */
describe('BlockManager.convert — toggle handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const toggleMarker = '<div data-blok-toggle-open=""></div>';
  const setIdOfFirst = (harness: Harness): string[] =>
    ((harness.hierarchy.setBlockParent as Mock).mock.calls.map((call) => (call[0] as Block).id));

  it('keeps a standalone toggle list children nested on convert', async () => {
    const source = createBlockStub({ id: 'src', name: 'toggle', contentIds: ['c1'], holderHtml: toggleMarker });
    const child = createBlockStub({ id: 'c1', parentId: 'src' });
    const converted = createBlockStub({ id: 'converted' });
    const harness = createHarness({
      blocks: [source, child],
      operations: { convert: vi.fn(async () => converted) },
    });

    const result = await harness.blockManager.convert(source, 'paragraph');

    expect(result).toBe(converted);
    expect(harness.hierarchy.setBlockParent).not.toHaveBeenCalled();
  });

  it('releases a toggle heading children as root siblings', async () => {
    const source = createBlockStub({ id: 'src', name: 'header', contentIds: ['c1', 'ghost'], holderHtml: toggleMarker });
    const child = createBlockStub({ id: 'c1', parentId: 'src' });
    const converted = createBlockStub({ id: 'converted' });
    const harness = createHarness({
      blocks: [source, child],
      operations: { convert: vi.fn(async () => converted) },
    });

    await harness.blockManager.convert(source, 'paragraph');

    const setParent = harness.hierarchy.setBlockParent as Mock;

    expect(setParent).toHaveBeenCalledOnce();
    expect(setParent.mock.calls[0]?.[0]).toBe(child);
    expect(setParent.mock.calls[0]?.[1]).toBeNull();
  });

  it('does not adopt a section when the target header carries no toggle override', async () => {
    const source = createBlockStub({ id: 'src' });
    const converted = createBlockStub({ id: 'converted', name: 'header', holderHtml: '<h2>H</h2>' });
    const follower = createBlockStub({ id: 'follower' });
    const harness = createHarness({
      blocks: [source, follower],
      operations: { convert: vi.fn(async () => converted) },
    });

    harness.store.splice(1, 0, converted);
    await harness.blockManager.convert(source, 'header');

    expect(harness.hierarchy.setBlockParent).not.toHaveBeenCalled();
    expect(harness.yjs.transactMoves).not.toHaveBeenCalled();
  });

  it('does not adopt a section when the target tool is not a header, override or not', async () => {
    const source = createBlockStub({ id: 'src' });
    const converted = createBlockStub({ id: 'converted', name: 'header', holderHtml: '<h2>H</h2>' });
    const follower = createBlockStub({ id: 'follower' });
    const harness = createHarness({
      blocks: [source, follower],
      operations: { convert: vi.fn(async () => converted) },
    });

    harness.store.splice(1, 0, converted);
    await harness.blockManager.convert(source, 'paragraph', { isToggleable: true });

    expect(harness.hierarchy.setBlockParent).not.toHaveBeenCalled();
  });

  it('adopts the following section into a fresh toggle heading', async () => {
    const source = createBlockStub({ id: 'src' });
    const converted = createBlockStub({ id: 'converted', name: 'header', holderHtml: '<h2>H</h2>' });
    const para = createBlockStub({ id: 'para' });
    const deep = createBlockStub({ id: 'deep', parentId: 'para' });
    const otherHeader = createBlockStub({ id: 'other', name: 'header', holderHtml: '<h2>Stop</h2>' });
    const tail = createBlockStub({ id: 'tail' });
    const harness = createHarness({
      blocks: [source, para, deep, otherHeader, tail],
      operations: { convert: vi.fn(async () => converted) },
    });

    harness.store.splice(1, 0, converted);

    const result = await harness.blockManager.convert(source, 'header', { isToggleable: true });

    expect(result).toBe(converted);
    // Deep descendants ride along with their container; only the top sibling
    // of each subtree is reparented directly.
    expect(setIdOfFirst(harness)).toEqual(['para']);
    expect((harness.hierarchy.setBlockParent as Mock).mock.calls.every((call) => call[1] === 'converted')).toBe(true);
    expect(harness.yjs.transactMoves).toHaveBeenCalledOnce();
  });

  it('adopts grandchildren that ride under an adopted sibling', async () => {
    const source = createBlockStub({ id: 'src' });
    const converted = createBlockStub({ id: 'converted', name: 'header', holderHtml: '<h2>H</h2>' });
    const para = createBlockStub({ id: 'para' });
    const child = createBlockStub({ id: 'child', parentId: 'para' });
    const grand = createBlockStub({ id: 'grand', parentId: 'child' });
    const tail = createBlockStub({ id: 'tail' });
    const harness = createHarness({
      blocks: [source, para, child, grand, tail],
      operations: { convert: vi.fn(async () => converted) },
    });

    harness.store.splice(1, 0, converted);
    await harness.blockManager.convert(source, 'header', { isToggleable: true });

    // The whole para subtree is section members, so the tail after it is
    // still inside the section and gets adopted too.
    expect(setIdOfFirst(harness)).toEqual(['para', 'tail']);
  });

  it('adopts nothing when the converted block is not a header', async () => {
    const source = createBlockStub({ id: 'src' });
    const converted = createBlockStub({ id: 'converted', name: 'paragraph' });
    const follower = createBlockStub({ id: 'follower' });
    const harness = createHarness({
      blocks: [source, follower],
      operations: { convert: vi.fn(async () => converted) },
    });

    harness.store.splice(1, 0, converted);
    await harness.blockManager.convert(source, 'header', { isToggleable: true });

    expect(harness.hierarchy.setBlockParent).not.toHaveBeenCalled();
  });

  it('adopts nothing when the converted block never entered the document', async () => {
    const source = createBlockStub({ id: 'src' });
    const converted = createBlockStub({ id: 'converted', name: 'header', holderHtml: '<h2>H</h2>' });
    const follower = createBlockStub({ id: 'follower' });
    const harness = createHarness({
      blocks: [source, follower],
      operations: { convert: vi.fn(async () => converted) },
    });

    await harness.blockManager.convert(source, 'header', { isToggleable: true });

    expect(harness.hierarchy.setBlockParent).not.toHaveBeenCalled();
  });

  it('adopts from the block right after a first-position heading', async () => {
    const source = createBlockStub({ id: 'src' });
    const converted = createBlockStub({ id: 'converted', name: 'header', holderHtml: '<h2>H</h2>' });
    const follower = createBlockStub({ id: 'follower' });
    const harness = createHarness({
      blocks: [source, follower],
      operations: { convert: vi.fn(async () => converted) },
    });

    harness.store.splice(1, 0, converted);
    await harness.blockManager.convert(source, 'header', { isToggleable: true });

    expect(setIdOfFirst(harness)).toEqual(['follower']);
  });

  it('skips the move transaction when no sibling follows the heading', async () => {
    const source = createBlockStub({ id: 'src' });
    const converted = createBlockStub({ id: 'converted', name: 'header', holderHtml: '<h2>H</h2>' });
    const harness = createHarness({
      blocks: [source],
      operations: { convert: vi.fn(async () => converted) },
    });

    harness.store.splice(1, 0, converted);
    await harness.blockManager.convert(source, 'header', { isToggleable: true });

    expect(harness.yjs.transactMoves).not.toHaveBeenCalled();
  });

  it('ignores a heading tag inside a non-header follower', async () => {
    const source = createBlockStub({ id: 'src' });
    const converted = createBlockStub({ id: 'converted', name: 'header', holderHtml: '<h2>H</h2>' });
    const paraWithHeading = createBlockStub({ id: 'para-h2', holderHtml: '<h2>Inside</h2>' });
    const after = createBlockStub({ id: 'after' });
    const harness = createHarness({
      blocks: [source, paraWithHeading, after],
      operations: { convert: vi.fn(async () => converted) },
    });

    harness.store.splice(1, 0, converted);
    await harness.blockManager.convert(source, 'header', { isToggleable: true });

    expect(setIdOfFirst(harness)).toEqual(['para-h2', 'after']);
  });

  it('does not crash resolving the level of a header block without a heading tag', async () => {
    const source = createBlockStub({ id: 'src' });
    const converted = createBlockStub({ id: 'converted', name: 'header' });
    const follower = createBlockStub({ id: 'follower' });
    const harness = createHarness({
      blocks: [source, follower],
      operations: { convert: vi.fn(async () => converted) },
    });

    harness.store.splice(1, 0, converted);

    await expect(harness.blockManager.convert(source, 'header', { isToggleable: true })).resolves.toBe(converted);
    expect(harness.hierarchy.setBlockParent).not.toHaveBeenCalled();
  });
});

/**
 * prepare() wires the document copy listener to BlockEvents. The real service
 * constructors only store dependencies, so they boot cleanly over stubs.
 */
describe('BlockManager.prepare copy wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes the document copy event to BlockEvents.handleCommandC', async () => {
    const handleCommandC = vi.fn();
    const checkEmptiness = vi.fn();
    const harness = createHarness({
      blocks: [],
      state: {
        UI: { checkEmptiness, nodes: { redactor: document.createElement('div'), wrapper: document.createElement('div') } },
        BlockEvents: { handleCommandC },
        Tools: { blockTools: new Map() },
        Caret: {},
        I18n: {},
        ReadOnly: { isEnabled: false },
      },
    });

    harness.blockManager.prepare();

    const copyEvent = new Event('copy');

    document.dispatchEvent(copyEvent);

    expect(handleCommandC).toHaveBeenCalledOnce();
    expect(handleCommandC.mock.calls[0]?.[0]).toBe(copyEvent);

    await harness.blockManager.destroy();
  });
});

describe('BlockManager.clear event shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes enumerable type and detail on mutation events', async () => {
    const harness = createHarness({ blocks: [createBlockStub({ id: 'a' })] });

    await harness.blockManager.clear();

    const event = harness.events[0];

    expect(event).toBeDefined();
    expect(Object.prototype.propertyIsEnumerable.call(event, 'type')).toBe(true);
    expect(Object.prototype.propertyIsEnumerable.call(event, 'detail')).toBe(true);
  });

  it('carries the removal index on a non-null detail object', async () => {
    const harness = createHarness({ blocks: [createBlockStub({ id: 'a' })] });

    await harness.blockManager.clear();

    const event = harness.events[0];

    expect(event).toBeDefined();
    expect(event.detail).not.toBeNull();
    expect(event.detail).toBeTypeOf('object');
    expect((event.detail as { index?: unknown }).index).toBe(0);
  });
});

/**
 * blockDidMutated → syncBlockDataToYjs → flushBlockDataWrites: saved keys go
 * to Yjs through the coalescing buffer, prune-only changes still count as
 * changes, and a structurally nested list item derives its depth instead of
 * persisting it.
 */
describe('BlockManager block-change to Yjs data flush', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const emitChanged = (harness: Harness, block: Block): void => {
    invokePrivate(harness.blockManager, 'blockDidMutated', BlockChangedMutationType, block, {});
  };

  const flushOf = (harness: Harness): ((entries: ReadonlyMap<string, unknown>) => boolean) => {
    const enqueue = harness.yjs.enqueueBlockDataWrite;

    expect(enqueue).toHaveBeenCalledOnce();

    return enqueue.mock.calls[0]?.[2] as (entries: ReadonlyMap<string, unknown>) => boolean;
  };

  it('writes saved data keys and bumps edit metadata', async () => {
    const block = createBlockStub({ id: 'b', saveData: { text: 'y' } });
    const harness = createHarness({ blocks: [block] });

    emitChanged(harness, block);
    await settle();

    flushOf(harness)(new Map([['text', 'y']]));

    expect(harness.yjs.updateBlockData).toHaveBeenCalledWith('b', 'text', 'y');
    expect(harness.yjs.pruneBlockData).toHaveBeenCalledWith('b', new Set(['text']));
    expect(harness.yjs.updateBlockMetadata).toHaveBeenCalledWith('b', expect.any(Number), null);
    expect(block.lastEditedAt).toEqual(expect.any(Number));
  });

  it('counts a prune-only change as a real change', async () => {
    const block = createBlockStub({ id: 'b', saveData: { text: 'y' } });
    const harness = createHarness({
      blocks: [block],
      yjs: { updateBlockData: vi.fn(() => false), pruneBlockData: vi.fn(() => true) },
    });

    emitChanged(harness, block);
    await settle();

    const before = block.lastEditedAt;

    flushOf(harness)(new Map([['text', 'y']]));

    expect(harness.yjs.updateBlockMetadata).toHaveBeenCalledOnce();
    expect(block.lastEditedAt).not.toBe(before);
  });

  it('derives a nested list item depth instead of persisting it', async () => {
    const parent = createBlockStub({ id: 'p1', name: 'list' });
    const block = createBlockStub({ id: 'li', name: 'list', parentId: 'p1', saveData: { text: 'x', depth: 2 } });
    const harness = createHarness({ blocks: [parent, block] });

    emitChanged(harness, block);
    await settle();

    flushOf(harness)(new Map<string, unknown>([['text', 'x'], ['depth', 2]]));

    expect(harness.yjs.updateBlockData).toHaveBeenCalledTimes(1);
    expect(harness.yjs.updateBlockData).toHaveBeenCalledWith('li', 'text', 'x');
    expect(harness.yjs.pruneBlockData).toHaveBeenCalledWith('li', new Set(['text', 'depth']));
  });

  it('keeps depth as source of truth for a root-level list item', async () => {
    const block = createBlockStub({ id: 'li', name: 'list', saveData: { text: 'x', depth: 2 } });
    const harness = createHarness({ blocks: [block] });

    emitChanged(harness, block);
    await settle();

    flushOf(harness)(new Map<string, unknown>([['depth', 2]]));

    expect(harness.yjs.updateBlockData).toHaveBeenCalledWith('li', 'depth', 2);
  });

  it('still writes depth when the parent is a list but the block is not', async () => {
    const parent = createBlockStub({ id: 'p1', name: 'list' });
    const block = createBlockStub({ id: 'p', name: 'paragraph', parentId: 'p1', saveData: { text: 'x', depth: 2 } });
    const harness = createHarness({ blocks: [parent, block] });

    emitChanged(harness, block);
    await settle();

    flushOf(harness)(new Map<string, unknown>([['depth', 2]]));

    expect(harness.yjs.updateBlockData).toHaveBeenCalledWith('p', 'depth', 2);
  });

  it('keeps depth for a list item whose parent is not a list', async () => {
    const column = createBlockStub({ id: 'c1', name: 'column' });
    const block = createBlockStub({ id: 'li', name: 'list', parentId: 'c1', saveData: { text: 'x', depth: 2 } });
    const harness = createHarness({ blocks: [column, block] });

    emitChanged(harness, block);
    await settle();

    flushOf(harness)(new Map<string, unknown>([['depth', 2]]));

    expect(harness.yjs.updateBlockData).toHaveBeenCalledWith('li', 'depth', 2);
  });

  it('survives a dangling list parent without throwing', async () => {
    const block = createBlockStub({ id: 'li', name: 'list', parentId: 'ghost', saveData: { text: 'x', depth: 2 } });
    const harness = createHarness({ blocks: [block] });

    emitChanged(harness, block);
    await settle();

    expect(() => flushOf(harness)(new Map<string, unknown>([['depth', 2]]))).not.toThrow();
    expect(harness.yjs.updateBlockData).toHaveBeenCalledWith('li', 'depth', 2);
  });
});

/**
 * Second pass: the closure survivors. These mutants live inside the arrow
 * functions initializeServices hands to the REAL sub-modules, so every test
 * here boots BlockManager with prepare() (real BlockRepository / BlockEventBinder
 * / BlockFactory / BlockHierarchy / BlockOperations / BlockYjsSync /
 * BlockShortcuts over stub module state) and drives real sub-module methods.
 */
describe('BlockManager prepared boot — real sub-module closures', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    vi.restoreAllMocks();
  });

  type BootOptions = {
    readOnly?: boolean;
    blocks?: Block[];
    yjs?: Record<string, unknown>;
    state?: Record<string, unknown>;
    beforePrepare?: (harness: Harness) => void;
  };

  const editorState = (readOnly: boolean, extra: Record<string, unknown> = {}): Record<string, unknown> => {
    const wrapper = document.createElement('div');

    wrapper.setAttribute('data-blok-testid', 'blok-editor');

    const redactor = document.createElement('div');

    wrapper.appendChild(redactor);

    return {
      UI: { checkEmptiness: vi.fn(), nodes: { redactor, wrapper } },
      BlockEvents: { keydown: vi.fn(), keyup: vi.fn(), input: vi.fn(), handleCommandC: vi.fn(), handleCommandX: vi.fn() },
      Tools: { blockTools: new Map([['paragraph', {}]]) },
      Caret: {},
      I18n: {},
      ReadOnly: { isEnabled: readOnly },
      ...extra,
    };
  };

  /** A harness booted with prepare(): every sub-module below the manager is real. */
  const buildBooted = (options: BootOptions = {}): Harness => {
    const harness = createHarness({
      blocks: options.blocks ?? [],
      yjs: {
        orderedIds: vi.fn(() => []),
        yMapToObject: vi.fn((map: { toJSON: () => unknown }) => map.toJSON()),
        ...(options.yjs ?? {}),
      },
      state: editorState(options.readOnly ?? false, options.state),
    });

    options.beforePrepare?.(harness);
    harness.blockManager.prepare();

    return harness;
  };

  const privateOf = (harness: Harness): Record<string, unknown> =>
    harness.blockManager as unknown as Record<string, unknown>;

  const realYjsSyncOf = (harness: Harness): Record<string, (...args: unknown[]) => unknown> =>
    privateOf(harness).yjsSync as Record<string, (...args: unknown[]) => unknown>;

  const binderOf = (harness: Harness): { bindBlockEvents: (b: Block) => void } =>
    privateOf(harness).eventBinder as { bindBlockEvents: (b: Block) => void };

  const stubOperationsAfterBoot = (harness: Harness): Mock => {
    const insert = vi.fn(() => createBlockStub({ id: 'repair', name: 'paragraph' }));

    privateOf(harness).operations = { insert };

    return insert;
  };

  /** The REAL post-prepare blocks array (Blocks instance behind the proxy). */
  const rawArrayOf = (harness: Harness): Block[] =>
    (privateOf(harness)._blocks as { array: Block[] }).array;

  const blokOf = (harness: Harness): { BlockEvents: Record<string, Mock> } =>
    (harness.blockManager as unknown as { Blok: { BlockEvents: Record<string, Mock> } }).Blok;

  it('registers shortcuts and routes the four handler callbacks', async () => {
    const copySelected = vi.fn();
    const harness = createHarness({
      blocks: [],
      yjs: { orderedIds: vi.fn(() => []) },
      state: editorState(false, {
        BlockSelection: { anyBlockSelected: false, selectedBlocks: [], copySelectedBlocksAsMarkdown: copySelected },
      }),
    });
    const registerSpy = vi.spyOn(BlockShortcuts.prototype, 'register');
    const moveUpSpy = vi.spyOn(harness.blockManager, 'moveCurrentBlockUp').mockImplementation(() => undefined);

    harness.blockManager.prepare();

    expect(registerSpy).toHaveBeenCalledOnce();

    const shortcuts = privateOf(harness).shortcuts as { handlers: Record<string, () => void> };

    expect(typeof shortcuts.handlers.onMoveUp).toBe('function');
    expect(typeof shortcuts.handlers.onCopyAsMarkdown).toBe('function');

    shortcuts.handlers.onMoveUp();
    expect(moveUpSpy).toHaveBeenCalledOnce();

    shortcuts.handlers.onCopyAsMarkdown();
    expect(copySelected).toHaveBeenCalledOnce();

    await harness.blockManager.destroy();
  });

  it('routes a block didMutated callback through the repository index', async () => {
    const block = createBlockStub({ id: 'bound' });
    const harness = buildBooted({ blocks: [block] });

    const didMutatedCallbacks: Array<(b: Block) => unknown> = [];
    const bindable = {
      ...block,
      on: vi.fn((_event: string, cb: (b: Block) => unknown) => {
        didMutatedCallbacks.push(cb);
      }),
    } as unknown as Block;

    rawArrayOf(harness).push(bindable);
    binderOf(harness).bindBlockEvents(bindable);

    expect(didMutatedCallbacks).toHaveLength(1);
    didMutatedCallbacks[0]?.(bindable);
    await settle();

    expect(harness.mutations[0]?.type).toBe(BlockChangedMutationType);
    expect(harness.mutations[0]?.index).toBe(0);

    await harness.blockManager.destroy();
  });

  describe('shouldHandleEvent — which editor owns the event', () => {
    const bootBoundHolder = async (harness: Harness, holderParent: HTMLElement, holder: HTMLElement): Promise<Harness> => {
      holderParent.appendChild(holder);
      binderOf(harness).bindBlockEvents({ holder, on: vi.fn() } as unknown as Block);

      return harness;
    };

    it('handles events from a block inside the booted editor', async () => {
      const holder = document.createElement('div');
      const target = document.createElement('p');

      holder.appendChild(target);

      const harness = buildBooted();
      const redactor = ((harness.blockManager as unknown as { Blok: { UI: { nodes: { redactor: HTMLElement } } } }).Blok).UI.nodes.redactor;
      await bootBoundHolder(harness, redactor, holder);
      const blockEvents = blokOf(harness).BlockEvents as { input: Mock };

      target.dispatchEvent(new InputEvent('input', { bubbles: true }));

      expect(blockEvents.input).toHaveBeenCalledOnce();
      await harness.blockManager.destroy();
    });

    it('ignores events from a block inside a foreign editor', async () => {
      const holder = document.createElement('div');
      const target = document.createElement('p');

      holder.appendChild(target);

      const foreign = document.createElement('div');

      foreign.setAttribute('data-blok-testid', 'blok-editor');

      const harness = buildBooted();

      await bootBoundHolder(harness, foreign, holder);
      const blockEvents = blokOf(harness).BlockEvents as { input: Mock };

      target.dispatchEvent(new InputEvent('input', { bubbles: true }));

      expect(blockEvents.input).not.toHaveBeenCalled();
      await harness.blockManager.destroy();
    });

    it('handles events from a block under no editor at all', async () => {
      const holder = document.createElement('div');
      const target = document.createElement('p');

      holder.appendChild(target);

      const harness = buildBooted();

      await bootBoundHolder(harness, document.createElement('div'), holder);
      const blockEvents = blokOf(harness).BlockEvents as { input: Mock };

      target.dispatchEvent(new InputEvent('input', { bubbles: true }));

      expect(blockEvents.input).toHaveBeenCalledOnce();
      await harness.blockManager.destroy();
    });

    it('handles events whose target is a text node', async () => {
      const holder = document.createElement('div');
      const text = document.createTextNode('hi');

      holder.appendChild(text);

      const harness = buildBooted();
      const redactor = ((harness.blockManager as unknown as { Blok: { UI: { nodes: { redactor: HTMLElement } } } }).Blok).UI.nodes.redactor;

      await bootBoundHolder(harness, redactor, holder);
      const blockEvents = blokOf(harness).BlockEvents as { input: Mock };

      text.dispatchEvent(new InputEvent('input', { bubbles: true }));

      expect(blockEvents.input).toHaveBeenCalledOnce();
      await harness.blockManager.destroy();
    });
  });

  it('schedules a parent sync when a real reparent assigns a parent', async () => {
    const parent = createBlockStub({ id: 'parent', saveData: {} });
    const child = createBlockStub({ id: 'child', parentId: null });
    const harness = buildBooted();

    rawArrayOf(harness).push(parent, child);
    harness.blockManager.setBlockParent(child, 'parent');
    await settle();

    expect(harness.yjs.enqueueBlockDataWrite).toHaveBeenCalledOnce();
    expect((harness.yjs.enqueueBlockDataWrite).mock.calls[0]?.[0]).toBe('parent');

    await harness.blockManager.destroy();
  });

  it('skips the parent sync while a real atomic sync window is open', async () => {
    const parent = createBlockStub({ id: 'parent', saveData: {} });
    const child = createBlockStub({ id: 'child', parentId: null });
    const harness = buildBooted();

    rawArrayOf(harness).push(parent, child);
    await harness.blockManager.withViewRebuild(async () => {
      harness.blockManager.setBlockParent(child, 'parent');
    });
    await settle();

    expect(harness.yjs.enqueueBlockDataWrite).not.toHaveBeenCalled();

    await harness.blockManager.destroy();
  });

  it('exempts a dangling parent id during a real sync replay', async () => {
    process.env.NODE_ENV = 'test';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const child = createBlockStub({ id: 'child', parentId: null });
    const harness = buildBooted({ blocks: [child] });

    rawArrayOf(harness).push(child);

    await harness.blockManager.withViewRebuild(async () => {
      expect(() => harness.blockManager.setBlockParent(child, 'ghost')).not.toThrow();
    });

    expect(child.parentId).toBeNull();
    expect(errorSpy).toHaveBeenCalled();

    await harness.blockManager.destroy();
  });

  it('gates the empty-document repair on the read-only state', async () => {
    // The store stays EMPTY: the gate fires before the emptiness check, so a
    // broken gate is visible only when nothing else returns early.
    const harness = buildBooted({ readOnly: true });
    const insert = stubOperationsAfterBoot(harness);

    invokePrivate(realYjsSyncOf(harness), 'restoreDefaultBlockIfDocEmptied', 'b1');
    await settle();

    expect(insert).not.toHaveBeenCalled();
    expect(harness.yjs.addBlock).not.toHaveBeenCalled();

    await harness.blockManager.destroy();
  });

  it('repairs an emptied document with one default block after a replayed removal', async () => {
    const block = createBlockStub({ id: 'b1' });
    const harness = buildBooted();

    rawArrayOf(harness).push(block);
    const insert = stubOperationsAfterBoot(harness);

    invokePrivate(realYjsSyncOf(harness), 'handleYjsRemove', 'b1');
    await settle();

    expect(harness.mutations[0]?.type).toBe(BlockRemovedMutationType);
    expect(harness.mutations[0]?.index).toBe(0);
    expect((insert).mock.calls[0]?.[0]).toEqual({ skipYjsSync: true, id: 'after-b1' });
    expect(harness.yjs.addBlock).toHaveBeenCalledWith({ id: 'repair', type: 'paragraph', data: {} });

    await harness.blockManager.destroy();
  });

  it('rematerializes a block through the store replace path', async () => {
    const block = createBlockStub({ id: 'b1' });
    const harness = buildBooted();

    rawArrayOf(harness).push(block);
    const newBlock = createBlockStub({ id: 'b1' });
    const composeSpy = vi.spyOn(
      privateOf(harness).factory as { composeBlock: (o: unknown) => Block },
      'composeBlock'
    ).mockReturnValue(newBlock);
    const replaceSpy = vi.spyOn(Blocks.prototype, 'replace');

    invokePrivate(realYjsSyncOf(harness), 'rematerialize', block, {
      tool: 'paragraph',
      data: {},
      tunes: {},
      lastEditedAt: undefined,
      lastEditedBy: null,
    });

    expect(composeSpy).toHaveBeenCalledOnce();
    expect(replaceSpy).toHaveBeenCalledWith(0, newBlock);

    await harness.blockManager.destroy();
  });

  it('materialises an undo add and announces the block-added index', async () => {
    const block = createBlockStub({ id: 'b1' });
    const harness = buildBooted({
      blocks: [block],
      yjs: { orderedIds: vi.fn(() => ['b1']) },
    });
    const newBlock = createBlockStub({ id: 'b1' });
    const composeSpy = vi.spyOn(
      privateOf(harness).factory as { composeBlock: (o: unknown) => Block },
      'composeBlock'
    ).mockReturnValue(newBlock);

    const dataMap = new YMap<unknown>();

    dataMap.set('text', 'x');

    const record: Record<string, unknown> = { id: 'b1', type: 'paragraph', data: dataMap };

    (harness.yjs.getBlockById).mockImplementation((_id: string) => ({
      get: (key: string): unknown => record[key],
    }));

    invokePrivate(realYjsSyncOf(harness), 'handleYjsAdd', 'b1', 'undo');

    expect(composeSpy).toHaveBeenCalledOnce();
    expect(harness.mutations[0]?.type).toBe(BlockAddedMutationType);
    expect(harness.mutations[0]?.index).toBe(0);

    await harness.blockManager.destroy();
  });

  it('never syncs a scheduled parent that is missing from the document', async () => {
    const harness = createHarness({ blocks: [] });
    const syncSpy = vi.spyOn(
      harness.blockManager as unknown as { syncBlockDataToYjs: (b: Block) => Promise<void> },
      'syncBlockDataToYjs'
    );

    invokePrivate(harness.blockManager, 'scheduleParentSync', 'ghost');
    await settle();

    expect(syncSpy).not.toHaveBeenCalled();
    expect(syncSpy).not.toHaveBeenCalledWith(undefined);
  });
});
