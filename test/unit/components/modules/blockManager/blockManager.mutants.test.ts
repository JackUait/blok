import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BlockManager } from '../../../../../src/components/modules/blockManager/blockManager';
import type { Block } from '../../../../../src/components/block';
import { EventsDispatcher } from '../../../../../src/components/utils/events';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { ModuleConfig } from '../../../../../src/types-internal/module-config';
import type { BlokModules } from '../../../../../src/types-internal/blok-modules';
import { BlockChanged } from '../../../../../src/components/events';
import { BlockRemovedMutationType } from '../../../../../types/events/block/BlockRemoved';

type BlockStubOptions = {
  id: string;
  /** written to `data-blok-depth`; omitted means a plain root block */
  depth?: number;
  selected?: boolean;
  withInput?: boolean;
};

/**
 * Minimal Block double. `getBlockNestingDepth` reads the depth off the holder,
 * so nesting is expressed purely through the `data-blok-depth` attribute.
 */
const createBlockStub = (options: BlockStubOptions): Block => {
  const holder = document.createElement('div');

  if (options.depth !== undefined) {
    holder.setAttribute('data-blok-depth', String(options.depth));
  }

  const input = document.createElement('div');

  input.contentEditable = 'true';

  return {
    id: options.id,
    holder,
    selected: options.selected ?? false,
    firstInput: options.withInput === false ? undefined : input,
  } as unknown as Block;
};

type Harness = {
  blockManager: BlockManager;
  store: Block[];
  yjs: {
    transact: ReturnType<typeof vi.fn>;
    removeBlock: ReturnType<typeof vi.fn>;
    addBlock: ReturnType<typeof vi.fn>;
    stopCapturing: ReturnType<typeof vi.fn>;
  };
  operationsRemoveBlock: ReturnType<typeof vi.fn>;
  operationsInsert: ReturnType<typeof vi.fn>;
  operationsMove: ReturnType<typeof vi.fn>;
  operationsSplit: ReturnType<typeof vi.fn>;
  checkEmptiness: ReturnType<typeof vi.fn>;
  removedIndices: number[];
  mutations: { type: string; index: unknown }[];
};

type HarnessOptions = {
  blocks: Block[];
  defaultBlock?: string | undefined;
  currentBlock?: Block | undefined;
  /** stands in for a REMOVED hook that drains siblings out of the store */
  cascadeRemove?: (removed: Block, store: Block[]) => void;
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

  const yjs = {
    transact: vi.fn((fn: () => void) => fn()),
    removeBlock: vi.fn(),
    addBlock: vi.fn(),
    stopCapturing: vi.fn(),
  };

  const operationsRemoveBlock = vi.fn().mockResolvedValue(undefined);
  const operationsMove = vi.fn();
  const operationsSplit = vi.fn(() => createBlockStub({ id: 'split-tail' }));
  const checkEmptiness = vi.fn();
  const mutations: { type: string; index: unknown }[] = [];

  config.eventsDispatcher.on(BlockChanged, ({ event }) => {
    const detail = event.detail as { index?: unknown };

    mutations.push({ type: event.type, index: detail.index });
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
  };

  const privateFields = blockManager as unknown as Record<string, unknown>;

  privateFields.repository = {
    get blocks(): Block[] {
      return store;
    },
    getBlockIndex: (block: Block): number => store.indexOf(block),
  };
  privateFields.yjsSync = {
    isSyncingFromYjs: false,
    isReconciling: (): boolean => false,
  };
  privateFields.operations = {
    suppressStopCapturing: false,
    currentBlockIndexValue: 0,
    currentBlock: 'currentBlock' in options ? options.currentBlock : undefined,
    removeBlock: operationsRemoveBlock,
    insert: operationsInsert,
    move: operationsMove,
    split: operationsSplit,
  };
  privateFields._blocks = blocksStore;

  blockManager.state = {
    YjsManager: yjs,
    UI: { checkEmptiness },
    API: {},
  } as unknown as BlokModules;

  return {
    blockManager,
    store,
    yjs,
    operationsRemoveBlock,
    operationsInsert,
    operationsMove,
    operationsSplit,
    checkEmptiness,
    removedIndices,
    mutations,
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
