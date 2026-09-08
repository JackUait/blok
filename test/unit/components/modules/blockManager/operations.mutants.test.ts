import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { BlockOperations } from '../../../../../src/components/modules/blockManager/operations';
import type { BlockOperationsDependencies } from '../../../../../src/components/modules/blockManager/operations';
import type { Block } from '../../../../../src/components/block';
import type { BlokEventMap } from '../../../../../src/components/events';
import type { BlockFactory } from '../../../../../src/components/modules/blockManager/factory';
import type { BlockHierarchy } from '../../../../../src/components/modules/blockManager/hierarchy';
import type { BlockRepository } from '../../../../../src/components/modules/blockManager/repository';
import type { BlocksStore } from '../../../../../src/components/modules/blockManager/types';
import type { Caret } from '../../../../../src/components/modules/caret';
import type { I18n } from '../../../../../src/components/modules/i18n';
import type { YjsManager } from '../../../../../src/components/modules/yjs';
import type { EventsDispatcher } from '../../../../../src/components/utils/events';
import type * as HierarchyInvariantModule from '../../../../../src/components/utils/hierarchy-invariant';
import type { HierarchyViolation } from '../../../../../src/components/utils/hierarchy-invariant';
import type { OutputBlockData, PasteEvent } from '@/types';

/**
 * The three worker classes are replaced wholesale: this suite exercises the
 * BlockOperations coordinator itself — the shared state, the navigation
 * accessors and the argument defaults it forwards — not the work the workers do.
 */
const workers = vi.hoisted(() => ({
  insertion: {
    insert: vi.fn(),
    insertDefaultBlockAtIndex: vi.fn(),
    insertAtEnd: vi.fn(),
    insertInsideParent: vi.fn(),
    split: vi.fn(),
    splitBlockWithData: vi.fn(),
    paste: vi.fn(),
  },
  removal: {
    removeBlock: vi.fn(),
  },
  mutation: {
    update: vi.fn(),
    replace: vi.fn(),
    move: vi.fn(),
    mergeBlocks: vi.fn(),
    convert: vi.fn(),
    moveCurrentBlockUp: vi.fn(),
    moveCurrentBlockDown: vi.fn(),
  },
}));

const invariant = vi.hoisted(() => ({
  validateHierarchy: vi.fn(),
}));

vi.mock('../../../../../src/components/modules/blockManager/block-insertion', () => ({
  BlockInsertion: class {
    public constructor() {
      return workers.insertion;
    }
  },
}));

vi.mock('../../../../../src/components/modules/blockManager/block-removal', () => ({
  BlockRemoval: class {
    public constructor() {
      return workers.removal;
    }
  },
}));

vi.mock('../../../../../src/components/modules/blockManager/block-mutation', () => ({
  BlockMutation: class {
    public constructor() {
      return workers.mutation;
    }
  },
}));

vi.mock('../../../../../src/components/utils/hierarchy-invariant', async (importOriginal) => {
  const actual = await importOriginal<typeof HierarchyInvariantModule>();

  return {
    ...actual,
    validateHierarchy: invariant.validateHierarchy,
  };
});

interface BlockStubOptions {
  name?: string;
  hidden?: boolean;
  parentId?: string | null;
  contentIds?: string[];
}

const createBlock = (id: string, options: BlockStubOptions = {}): Block => {
  const holder = document.createElement('div');

  if (options.hidden === true) {
    holder.classList.add('hidden');
  }

  return {
    id,
    name: options.name ?? 'paragraph',
    holder,
    parentId: options.parentId ?? null,
    contentIds: options.contentIds ?? [],
  } as unknown as Block;
};

/** A block whose `parentId` key is absent entirely, not null. */
const createBlockWithoutParentIdKey = (id: string): Block => ({
  id,
  name: 'paragraph',
  holder: document.createElement('div'),
  contentIds: [],
} as unknown as Block);

const createDependencies = (yjsManager: YjsManager | undefined): BlockOperationsDependencies => ({
  config: { defaultBlock: 'paragraph' },
  YjsManager: yjsManager as unknown as YjsManager,
  Caret: {} as unknown as Caret,
  I18n: {} as unknown as I18n,
  eventsDispatcher: {
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as EventsDispatcher<BlokEventMap>,
});

interface Harness {
  operations: BlockOperations;
  blocks: Block[];
  getBlockByIndex: ReturnType<typeof vi.fn>;
  setBlockParent: ReturnType<typeof vi.fn>;
  stopCapturing: ReturnType<typeof vi.fn>;
  blocksStore: BlocksStore;
}

/**
 * The repository is a hand-written double rather than a real BlockRepository so
 * `length` and `getBlockByIndex` can be observed independently: several accessor
 * branches return early WITHOUT consulting the store, and "was the store asked?"
 * is the only signal that separates them from the branch that asks and gets
 * `undefined` back.
 */
const createHarness = (options: {
  blocks?: Block[];
  currentBlockIndex?: number;
  withYjsManager?: boolean;
} = {}): Harness => {
  const blocks = options.blocks ?? [];
  const getBlockByIndex = vi.fn((index: number): Block | undefined => blocks[index]);
  const getBlockById = vi.fn((id: string): Block | undefined => blocks.find(block => block.id === id));
  const repository = {
    get blocks(): Block[] {
      return blocks;
    },
    get length(): number {
      return blocks.length;
    },
    getBlockByIndex,
    getBlockById,
  } as unknown as BlockRepository;

  const setBlockParent = vi.fn();
  const hierarchy = { setBlockParent } as unknown as BlockHierarchy;
  const stopCapturing = vi.fn();
  const yjsManager = options.withYjsManager === false
    ? undefined
    : ({ stopCapturing } as unknown as YjsManager);

  const operations = new BlockOperations(
    createDependencies(yjsManager),
    repository,
    {} as unknown as BlockFactory,
    hierarchy,
    vi.fn(),
    options.currentBlockIndex ?? -1
  );

  return {
    operations,
    blocks,
    getBlockByIndex,
    setBlockParent,
    stopCapturing,
    blocksStore: { marker: 'blocks-store' } as unknown as BlocksStore,
  };
};

const violation = (kind: HierarchyViolation['kind'], message: string): HierarchyViolation => ({
  kind,
  blockId: 'a',
  message,
});

describe('BlockOperations — coordinator state and delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invariant.validateHierarchy.mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe('constructor', () => {
    it('defaults the current block index to -1 when the caller omits it', () => {
      const repository = {
        get blocks(): Block[] {
          return [];
        },
        get length(): number {
          return 0;
        },
        getBlockByIndex: vi.fn(),
        getBlockById: vi.fn(),
      } as unknown as BlockRepository;

      const operations = new BlockOperations(
        createDependencies({ stopCapturing: vi.fn() } as unknown as YjsManager),
        repository,
        {} as unknown as BlockFactory,
        { setBlockParent: vi.fn() } as unknown as BlockHierarchy,
        vi.fn()
      );

      expect(operations.rawCurrentBlockIndex).toBe(-1);
      expect(operations.currentBlockIndexValue).toBe(-1);
    });
  });

  describe('currentBlockIndexValue', () => {
    it('survives a missing YjsManager when the index changes', () => {
      const { operations } = createHarness({
        blocks: [createBlock('a'), createBlock('b')],
        currentBlockIndex: 0,
        withYjsManager: false,
      });

      expect(() => {
        operations.currentBlockIndexValue = 1;
      }).not.toThrow();
      expect(operations.currentBlockIndexValue).toBe(1);
    });

    it('stops undo capturing on a real change and stays quiet on a no-op', () => {
      const { operations, stopCapturing } = createHarness({
        blocks: [createBlock('a'), createBlock('b')],
        currentBlockIndex: 0,
      });

      operations.currentBlockIndexValue = 0;
      expect(stopCapturing).not.toHaveBeenCalled();

      operations.currentBlockIndexValue = 1;
      expect(stopCapturing).toHaveBeenCalledTimes(1);
    });
  });

  describe('currentBlock', () => {
    it('returns undefined without consulting the repository when nothing is selected', () => {
      const { operations, getBlockByIndex } = createHarness({
        blocks: [createBlock('a'), createBlock('b')],
        currentBlockIndex: -1,
      });

      expect(operations.currentBlock).toBeUndefined();
      expect(getBlockByIndex).not.toHaveBeenCalled();
    });

    it('returns the block at the current index', () => {
      const blocks = [createBlock('a'), createBlock('b')];
      const { operations, getBlockByIndex } = createHarness({ blocks, currentBlockIndex: 1 });

      expect(operations.currentBlock).toBe(blocks[1]);
      expect(getBlockByIndex).toHaveBeenCalledWith(1);
    });
  });

  describe('nextBlock', () => {
    it('returns null without consulting the repository when nothing is selected', () => {
      const { operations, getBlockByIndex } = createHarness({
        blocks: [createBlock('a'), createBlock('b'), createBlock('c')],
        currentBlockIndex: -1,
      });

      expect(operations.nextBlock).toBeNull();
      expect(getBlockByIndex).not.toHaveBeenCalled();
    });

    it('returns null without consulting the repository on the last block', () => {
      const { operations, getBlockByIndex } = createHarness({
        blocks: [createBlock('a'), createBlock('b'), createBlock('c')],
        currentBlockIndex: 2,
      });

      expect(operations.nextBlock).toBeNull();
      expect(getBlockByIndex).not.toHaveBeenCalled();
    });

    it('returns the block one index further on', () => {
      const blocks = [createBlock('a'), createBlock('b'), createBlock('c')];
      const { operations, getBlockByIndex } = createHarness({ blocks, currentBlockIndex: 0 });

      expect(operations.nextBlock).toBe(blocks[1]);
      expect(getBlockByIndex).toHaveBeenCalledWith(1);
    });
  });

  describe('previousBlock', () => {
    it('returns null without consulting the repository when nothing is selected', () => {
      const { operations, getBlockByIndex } = createHarness({
        blocks: [createBlock('a'), createBlock('b'), createBlock('c')],
        currentBlockIndex: -1,
      });

      expect(operations.previousBlock).toBeNull();
      expect(getBlockByIndex).not.toHaveBeenCalled();
    });

    it('returns null without consulting the repository on the first block', () => {
      const { operations, getBlockByIndex } = createHarness({
        blocks: [createBlock('a'), createBlock('b'), createBlock('c')],
        currentBlockIndex: 0,
      });

      expect(operations.previousBlock).toBeNull();
      expect(getBlockByIndex).not.toHaveBeenCalled();
    });

    it('returns the block one index back', () => {
      const blocks = [createBlock('a'), createBlock('b'), createBlock('c')];
      const { operations, getBlockByIndex } = createHarness({ blocks, currentBlockIndex: 2 });

      expect(operations.previousBlock).toBe(blocks[1]);
      expect(getBlockByIndex).toHaveBeenCalledWith(1);
    });
  });

  describe('nextVisibleBlock', () => {
    const visibilityFixture = (): Block[] => [
      createBlock('v0'),
      createBlock('h1', { hidden: true }),
      createBlock('v2'),
      createBlock('v3'),
    ];

    it('skips hidden holders and starts strictly after the current block', () => {
      const blocks = visibilityFixture();
      const { operations } = createHarness({ blocks, currentBlockIndex: 0 });

      expect(operations.nextVisibleBlock).toBe(blocks[2]);
    });

    it('starts after the current index rather than at a fixed one', () => {
      const blocks = visibilityFixture();
      const { operations } = createHarness({ blocks, currentBlockIndex: 1 });

      expect(operations.nextVisibleBlock).toBe(blocks[2]);
    });

    it('returns null when nothing is selected', () => {
      const { operations } = createHarness({ blocks: visibilityFixture(), currentBlockIndex: -1 });

      expect(operations.nextVisibleBlock).toBeNull();
    });

    it('returns null when every later block is hidden', () => {
      const blocks = [createBlock('v0'), createBlock('h1', { hidden: true })];
      const { operations } = createHarness({ blocks, currentBlockIndex: 0 });

      expect(operations.nextVisibleBlock).toBeNull();
    });
  });

  describe('previousVisibleBlock', () => {
    const visibilityFixture = (): Block[] => [
      createBlock('v0'),
      createBlock('v1'),
      createBlock('h2', { hidden: true }),
      createBlock('v3'),
    ];

    it('walks backwards from the current block and skips hidden holders', () => {
      const blocks = visibilityFixture();
      const expected = blocks[1];
      const { operations } = createHarness({ blocks, currentBlockIndex: 3 });

      expect(operations.previousVisibleBlock).toBe(expected);
    });

    it('stops at the current index rather than at a fixed one', () => {
      const blocks = visibilityFixture();
      const expected = blocks[0];
      const { operations } = createHarness({ blocks, currentBlockIndex: 1 });

      expect(operations.previousVisibleBlock).toBe(expected);
    });

    it('returns null when nothing is selected', () => {
      const { operations } = createHarness({ blocks: visibilityFixture(), currentBlockIndex: -1 });

      expect(operations.previousVisibleBlock).toBeNull();
    });

    it('returns null when every earlier block is hidden', () => {
      const blocks = [createBlock('h0', { hidden: true }), createBlock('v1')];
      const { operations } = createHarness({ blocks, currentBlockIndex: 1 });

      expect(operations.previousVisibleBlock).toBeNull();
    });
  });

  describe('delegation defaults', () => {
    it('forwards insertDefaultBlockAtIndex defaults unchanged', () => {
      const { operations, blocksStore } = createHarness();

      operations.insertDefaultBlockAtIndex(2, undefined, undefined, blocksStore, undefined);

      expect(workers.insertion.insertDefaultBlockAtIndex).toHaveBeenCalledWith(2, false, false, blocksStore, false);
    });

    it('forwards paste defaults unchanged', () => {
      const { operations, blocksStore } = createHarness();
      const pasteEvent = { type: 'tag', detail: { data: document.createElement('p') } } as unknown as PasteEvent;

      void operations.paste('paragraph', pasteEvent, undefined, blocksStore);

      expect(workers.insertion.paste).toHaveBeenCalledWith('paragraph', pasteEvent, false, blocksStore, undefined);
    });

    it('forwards removeBlock defaults unchanged', () => {
      const { operations, blocksStore } = createHarness();
      const block = createBlock('a');

      void operations.removeBlock(block, undefined, undefined, blocksStore);

      expect(workers.removal.removeBlock).toHaveBeenCalledWith(block, true, false, blocksStore);
    });

    it('forwards move defaults unchanged', () => {
      const { operations, blocksStore } = createHarness();

      operations.move(3, 1, false, blocksStore, undefined);

      expect(workers.mutation.move).toHaveBeenCalledWith(3, 1, false, blocksStore, false);
    });
  });

  describe('transferParentLinkToNewBlock', () => {
    it('falls back to a bare parentId when the parent is gone from the repository', () => {
      const newBlock = createBlock('new');
      const { operations, setBlockParent } = createHarness({ blocks: [newBlock] });

      expect(() => {
        operations.transferParentLinkToNewBlock('old', newBlock, 'ghost-parent');
      }).not.toThrow();

      expect(newBlock.parentId).toBe('ghost-parent');
      expect(setBlockParent).not.toHaveBeenCalled();
    });

    it('leaves the parent content untouched when the old id is not listed there', () => {
      const parent = createBlock('parent', { contentIds: ['x', 'y'] });
      const newBlock = createBlock('new');
      const { operations, setBlockParent } = createHarness({ blocks: [parent, newBlock] });

      operations.transferParentLinkToNewBlock('old', newBlock, 'parent');

      expect(setBlockParent).toHaveBeenCalledWith(newBlock, 'parent');
      expect(parent.contentIds).toStrictEqual(['x', 'y']);
    });

    it('restores the replacement at the head position the old block held', () => {
      const parent = createBlock('parent', { contentIds: ['old', 'x'] });
      const newBlock = createBlock('new');
      const { operations } = createHarness({ blocks: [parent, newBlock] });

      operations.transferParentLinkToNewBlock('old', newBlock, 'parent');

      expect(parent.contentIds).toStrictEqual(['new', 'x']);
    });

    it('restores the replacement at an interior position the old block held', () => {
      const parent = createBlock('parent', { contentIds: ['x', 'old', 'y'] });
      const newBlock = createBlock('new');
      const { operations } = createHarness({ blocks: [parent, newBlock] });

      operations.transferParentLinkToNewBlock('old', newBlock, 'parent');

      expect(parent.contentIds).toStrictEqual(['x', 'new', 'y']);
    });
  });

  describe('assertHierarchyInvariantInDev', () => {
    const withViolations = (...kinds: [HierarchyViolation['kind'], string][]): void => {
      invariant.validateHierarchy.mockReturnValue(kinds.map(([kind, message]) => violation(kind, message)));
    };

    it('projects the repository into OutputBlockData, omitting empty parent and content keys', () => {
      const blocks = [
        createBlock('root', { contentIds: [] }),
        createBlock('child', { name: 'list', parentId: 'root', contentIds: ['grand'] }),
        createBlockWithoutParentIdKey('grand'),
      ];
      const { operations } = createHarness({ blocks });

      operations.assertHierarchyInvariantInDev('render');

      const projected = invariant.validateHierarchy.mock.calls[0][0] as OutputBlockData[];

      expect(projected).toStrictEqual([
        {
          id: 'root',
          type: 'paragraph',
          data: {},
        },
        {
          id: 'child',
          type: 'list',
          data: {},
          parent: 'root',
          content: ['grand'],
        },
        {
          id: 'grand',
          type: 'paragraph',
          data: {},
        },
      ]);
    });

    it('throws with every violation message joined by newlines', () => {
      withViolations(
        ['content-duplicate', 'first problem'],
        ['content-duplicate', 'second problem']
      );
      const { operations } = createHarness({ blocks: [createBlock('a')] });

      expect(() => {
        operations.assertHierarchyInvariantInDev('convert');
      }).toThrowError(
        new Error('Hierarchy invariant violated at BlockOperations.convert:\n  - first problem\n  - second problem')
      );
    });

    it('throws on a child-not-in-parent-content violation alone', () => {
      withViolations(['child-not-in-parent-content', 'orphan child']);
      const { operations } = createHarness({ blocks: [createBlock('a')] });

      expect(() => {
        operations.assertHierarchyInvariantInDev('insert');
      }).toThrowError(new Error('Hierarchy invariant violated at BlockOperations.insert:\n  - orphan child'));
    });

    it('throws on a content-parent-mismatch violation alone', () => {
      withViolations(['content-parent-mismatch', 'mismatched parent']);
      const { operations } = createHarness({ blocks: [createBlock('a')] });

      expect(() => {
        operations.assertHierarchyInvariantInDev('move');
      }).toThrowError(new Error('Hierarchy invariant violated at BlockOperations.move:\n  - mismatched parent'));
    });

    it('ignores the saver-repairable violation kinds', () => {
      withViolations(
        ['child-parent-missing', 'missing parent'],
        ['content-id-dangling', 'dangling id']
      );
      const { operations } = createHarness({ blocks: [createBlock('a')] });

      expect(() => {
        operations.assertHierarchyInvariantInDev('remove');
      }).not.toThrow();
    });

    it('still gates in a development build', () => {
      vi.stubEnv('NODE_ENV', 'development');
      withViolations(['content-duplicate', 'duplicate id']);
      const { operations } = createHarness({ blocks: [createBlock('a')] });

      expect(() => {
        operations.assertHierarchyInvariantInDev('paste');
      }).toThrowError(new Error('Hierarchy invariant violated at BlockOperations.paste:\n  - duplicate id'));
    });

    it('stays silent in a production build', () => {
      vi.stubEnv('NODE_ENV', 'production');
      withViolations(['content-duplicate', 'duplicate id']);
      const { operations } = createHarness({ blocks: [createBlock('a')] });

      expect(() => {
        operations.assertHierarchyInvariantInDev('paste');
      }).not.toThrow();
      expect(invariant.validateHierarchy).not.toHaveBeenCalled();
    });
  });
});
