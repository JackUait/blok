/**
 * Mutation-directed tests for DragOperations: 51 of the 53 recorded live
 * mutants die here. The two that stay alive are equivalent.
 *
 * 1. Line 270, left operand `originalParentId !== null` replaced by `true`.
 *    The mutant can only diverge when `originalParentId` is null, and then the
 *    guard reduces to `prep.sourceIds.has(null)` followed by
 *    `originalIdToDupId.get(null)`. Every key of that map is a `Block['id']`,
 *    declared `string`, so `get(null)` is always undefined and the inner
 *    `dupParentId !== undefined` check on line 273 rejects the block anyway.
 *    That holds even for a caller that hands in a `Set` subclass whose `has`
 *    answers true for everything, so no input reaches `setBlockParent`.
 *
 * 2. Line 375, `this.blockSelection?.selectBlock` losing its optional chain.
 *    `blockSelection` is a private field written once by the constructor; the
 *    class declares no setter and never reassigns it. Line 370 has already
 *    proved it truthy, and the `forEach` that follows runs synchronously with
 *    nothing in between that could clear the field, so the chain never
 *    short-circuits and dropping it cannot change behaviour.
 *
 * Techniques that made the rest observable: a `getBlockIndex` that disagrees
 * with the `blocks` array (staleness without removing the block), a `save()`
 * that goes stale mid-flight, a partial module mock of `resolveMoveDestination`
 * for a destination with no source roots, hand-built `DuplicatePreparation`
 * plans, and an accessor-backed `setBlockParent` that answers only its first
 * read.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DragOperations } from '../../../../../../src/components/modules/drag/operations/DragOperations';
import type {
  BlockManagerAdapter,
  DuplicatePreparation,
} from '../../../../../../src/components/modules/drag/operations/DragOperations';
import type { MoveDestination } from '../../../../../../src/components/modules/drag/utils/moveDestination';
import { BlockToolAPI } from '../../../../../../src/components/block';
import type { Block } from '../../../../../../src/components/block';

const destinationStub = vi.hoisted(() => ({
  enabled: false,
  value: null as MoveDestination | null,
}));

interface MoveDestinationModule {
  resolveMoveDestination: (
    blocks: readonly Block[],
    sourceBlocks: readonly Block[],
    targetBlock: Block,
    edge: 'top' | 'bottom'
  ) => MoveDestination | null;
}

vi.mock('../../../../../../src/components/modules/drag/utils/moveDestination', async (importOriginal) => {
  const actual = await importOriginal<MoveDestinationModule>();

  return {
    ...actual,
    resolveMoveDestination: (
      blocks: readonly Block[],
      sourceBlocks: readonly Block[],
      targetBlock: Block,
      edge: 'top' | 'bottom'
    ): MoveDestination | null => (
      destinationStub.enabled
        ? destinationStub.value
        : actual.resolveMoveDestination(blocks, sourceBlocks, targetBlock, edge)
    ),
  };
});

/** What `getBlockIndex` answers for a value that is not a block at all. */
const UNKNOWN_BLOCK_INDEX = 42;

interface SavedPayload {
  data: Record<string, unknown>;
  tunes: Record<string, unknown>;
}

interface InsertConfig {
  tool: string;
  data: Record<string, unknown>;
  tunes: Record<string, unknown>;
  index: number;
  needToFocus: boolean;
}

interface TestBlock {
  id: string;
  name: string;
  parentId: string | null;
  holder: HTMLElement;
  save: Mock<() => Promise<SavedPayload | false>>;
  call: Mock<(method: string, params?: Record<string, unknown>) => void>;
}

interface ManagerHarness {
  adapter: BlockManagerAdapter;
  live: Block[];
  staleIds: Set<string>;
  move: Mock<(toIndex: number, fromIndex: number, needToFocus: boolean, skipMovedHook?: boolean) => void>;
  insert: Mock<(config: InsertConfig) => Block>;
  setBlockParent: Mock<(block: Block, parentId: string | null) => void>;
}

interface SelectionHarness {
  adapter: { clearSelection: () => void; selectBlock: (block: Block) => void };
  clearSelection: Mock<() => void>;
  selectBlock: Mock<(block: Block) => void>;
}

const asBlock = (block: TestBlock): Block => block as unknown as Block;

const createBlock = (id: string, parentId: string | null = null): TestBlock => ({
  id,
  name: 'paragraph',
  parentId,
  holder: document.createElement('div'),
  save: vi.fn<() => Promise<SavedPayload | false>>(async () => ({
    data: { text: id },
    tunes: {},
  })),
  call: vi.fn<(method: string, params?: Record<string, unknown>) => void>(),
});

const createManager = (
  order: TestBlock[],
  options: { withSetBlockParent?: boolean } = {}
): ManagerHarness => {
  const live: Block[] = order.map(asBlock);
  const staleIds = new Set<string>();
  const created = { count: 0 };

  const move = vi.fn<(toIndex: number, fromIndex: number, needToFocus: boolean, skipMovedHook?: boolean) => void>(
    (toIndex, fromIndex) => {
      const [moved] = live.splice(fromIndex, 1);

      if (moved !== undefined) {
        live.splice(toIndex, 0, moved);
      }
    }
  );

  const insert = vi.fn<(config: InsertConfig) => Block>(() => {
    created.count += 1;

    return asBlock(createBlock(`dup-${created.count}`));
  });

  const setBlockParent = vi.fn<(block: Block, parentId: string | null) => void>();

  // Widened parameter so the stub can answer for the `undefined` the source
  // reads out of an empty `sourceRoots`.
  const getBlockIndex = (block: Block | undefined): number => {
    if (block === undefined) {
      return UNKNOWN_BLOCK_INDEX;
    }

    if (staleIds.has(block.id)) {
      return -1;
    }

    return live.indexOf(block);
  };

  const adapter: BlockManagerAdapter = {
    blocks: live,
    getBlockIndex,
    getBlockByIndex: (index: number): Block | undefined => live[index],
    move,
    insert,
    ...(options.withSetBlockParent === true ? { setBlockParent } : {}),
  };

  return {
    adapter,
    live,
    staleIds,
    move,
    insert,
    setBlockParent,
  };
};

const createSelection = (): SelectionHarness => {
  const clearSelection = vi.fn<() => void>();
  const selectBlock = vi.fn<(block: Block) => void>();

  return {
    adapter: {
      clearSelection,
      selectBlock,
    },
    clearSelection,
    selectBlock,
  };
};

const nest = (parent: TestBlock, child: TestBlock): void => {
  parent.holder.appendChild(child.holder);
};

const abortedPrep = {
  sortedBlocks: [],
  sourceIds: new Set<string>(),
  validResults: [],
  baseInsertIndex: -1,
  aborted: true,
};

describe('DragOperations mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    destinationStub.enabled = false;
    destinationStub.value = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('moveBlocks stale-participant guard', () => {
    it('refuses the move when the target index is stale', () => {
      const source = createBlock('s');
      const middle = createBlock('a');
      const target = createBlock('t');
      const manager = createManager([source, middle, target]);
      const selection = createSelection();

      manager.staleIds.add(target.id);

      const operations = new DragOperations(manager.adapter, undefined, selection.adapter);
      const result = operations.moveBlocks([asBlock(source)], asBlock(target), 'bottom');

      expect(result).toEqual({
        movedBlocks: [],
        targetIndex: -1,
      });
      expect(selection.selectBlock).not.toHaveBeenCalled();
      expect(manager.move).not.toHaveBeenCalled();
    });

    it('refuses the move when only one of several sources is stale', () => {
      const first = createBlock('s1');
      const second = createBlock('s2');
      const target = createBlock('t');
      const manager = createManager([first, second, target]);
      const selection = createSelection();

      manager.staleIds.add(second.id);

      const operations = new DragOperations(manager.adapter, undefined, selection.adapter);
      const result = operations.moveBlocks(
        [asBlock(first), asBlock(second)],
        asBlock(target),
        'bottom'
      );

      expect(result).toEqual({
        movedBlocks: [],
        targetIndex: -1,
      });
      expect(selection.selectBlock).not.toHaveBeenCalled();
      expect(manager.move).not.toHaveBeenCalled();
    });
  });

  describe('moveBlocks with an unresolvable destination', () => {
    it('reports minus one when the destination carries no source roots', () => {
      const source = createBlock('s');
      const target = createBlock('t');
      const manager = createManager([source, target]);
      const operations = new DragOperations(manager.adapter);

      destinationStub.enabled = true;
      destinationStub.value = {
        rawInsertionIndex: 1,
        finalFirstIndex: 0,
        total: 2,
        footprint: [],
        sourceRoots: [],
      };

      const result = operations.moveBlocks([asBlock(source)], asBlock(target), 'bottom');

      expect(result.targetIndex).toBe(-1);
      expect(result.movedBlocks).toEqual([asBlock(source)]);
    });
  });

  describe('applyMoveDestination ordering', () => {
    it('reports the moved blocks in document order regardless of selection order', () => {
      const first = createBlock('a');
      const second = createBlock('b');
      const target = createBlock('t');
      const manager = createManager([first, second, target]);
      const operations = new DragOperations(manager.adapter);

      const result = operations.moveBlocks(
        [asBlock(second), asBlock(first)],
        asBlock(target),
        'top'
      );

      expect(result.movedBlocks).toEqual([asBlock(first), asBlock(second)]);
    });

    it('skips every move when the whole footprint already sits at its final slot', () => {
      const first = createBlock('a');
      const second = createBlock('b');
      const target = createBlock('t');
      const manager = createManager([first, second, target]);
      const selection = createSelection();
      const operations = new DragOperations(manager.adapter, undefined, selection.adapter);

      const result = operations.moveBlocks(
        [asBlock(first), asBlock(second)],
        asBlock(target),
        'top'
      );

      expect(manager.move).not.toHaveBeenCalled();
      expect(result.targetIndex).toBe(0);
      expect(first.call).toHaveBeenCalledWith(BlockToolAPI.MOVED, {
        fromIndex: 0,
        toIndex: 0,
        isGroupMove: true,
      });
      expect(second.call).toHaveBeenCalledWith(BlockToolAPI.MOVED, {
        fromIndex: 1,
        toIndex: 1,
        isGroupMove: true,
      });
      expect(selection.clearSelection).toHaveBeenCalledTimes(1);
    });

    it('moves a group whose footprint is only partially settled', () => {
      const first = createBlock('a');
      const stranger = createBlock('x');
      const second = createBlock('b');
      const target = createBlock('t');
      const manager = createManager([first, stranger, second, target]);
      const operations = new DragOperations(manager.adapter);

      operations.moveBlocks(
        [asBlock(first), asBlock(second)],
        asBlock(target),
        'top'
      );

      expect(manager.move).toHaveBeenCalledTimes(2);
      expect(manager.move).toHaveBeenNthCalledWith(1, 2, 0, false, true);
      expect(manager.move).toHaveBeenNthCalledWith(2, 2, 1, false, true);
    });

    it('leaves a root alone when it already sits on the insertion boundary', () => {
      const target = createBlock('t');
      const source = createBlock('s');
      const stranger = createBlock('x');
      const child = createBlock('c', 's');

      nest(source, child);

      const manager = createManager([target, source, stranger, child]);
      const operations = new DragOperations(manager.adapter);
      const result = operations.moveBlocks([asBlock(source)], asBlock(target), 'bottom');

      expect(manager.move).not.toHaveBeenCalled();
      expect(result.targetIndex).toBe(1);
    });

    it('leaves the moved hook to BlockManager for an unsettled single-block move', () => {
      const source = createBlock('s');
      const middle = createBlock('a');
      const target = createBlock('t');
      const manager = createManager([source, middle, target]);
      const selection = createSelection();
      const operations = new DragOperations(manager.adapter, undefined, selection.adapter);

      operations.moveBlocks([asBlock(source)], asBlock(target), 'bottom');

      expect(manager.move).toHaveBeenCalledTimes(1);
      expect(source.call).not.toHaveBeenCalled();
      expect(selection.clearSelection).not.toHaveBeenCalled();
      expect(selection.selectBlock).toHaveBeenCalledWith(asBlock(source));
    });

    it('completes a group move with no block selection wired up', () => {
      const first = createBlock('a');
      const stranger = createBlock('x');
      const second = createBlock('b');
      const target = createBlock('t');
      const manager = createManager([first, stranger, second, target]);
      const operations = new DragOperations(manager.adapter);

      const result = operations.moveBlocks(
        [asBlock(first), asBlock(second)],
        asBlock(target),
        'top'
      );

      expect(result.movedBlocks).toEqual([asBlock(first), asBlock(second)]);
    });
  });

  describe('prepareDuplicates guards', () => {
    it('aborts without saving anything when the target is already gone', async () => {
      const source = createBlock('s');
      const target = createBlock('t');
      const manager = createManager([source, target]);

      manager.staleIds.add(target.id);

      const operations = new DragOperations(manager.adapter);
      const prep = await operations.prepareDuplicates([asBlock(source)], asBlock(target), 'bottom');

      expect(prep).toEqual(abortedPrep);
      expect(source.save).not.toHaveBeenCalled();
    });

    it('aborts when one of the sources is already gone', async () => {
      const first = createBlock('s1');
      const second = createBlock('s2');
      const target = createBlock('t');
      const manager = createManager([first, second, target]);

      manager.staleIds.add(second.id);

      const operations = new DragOperations(manager.adapter);
      const prep = await operations.prepareDuplicates(
        [asBlock(first), asBlock(second)],
        asBlock(target),
        'bottom'
      );

      expect(prep).toEqual(abortedPrep);
      expect(first.save).not.toHaveBeenCalled();
    });

    it('aborts when the target disappears while the saves are in flight', async () => {
      const source = createBlock('s');
      const target = createBlock('t');
      const manager = createManager([source, target]);

      source.save.mockImplementation(async () => {
        manager.staleIds.add(target.id);

        return {
          data: { text: 's' },
          tunes: {},
        };
      });

      const operations = new DragOperations(manager.adapter);
      const prep = await operations.prepareDuplicates([asBlock(source)], asBlock(target), 'bottom');

      expect(prep).toEqual(abortedPrep);
      expect(source.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('prepareDuplicates plan', () => {
    it('orders the plan by document index, not by selection order', async () => {
      const first = createBlock('a');
      const second = createBlock('b');
      const target = createBlock('t');
      const manager = createManager([first, second, target]);
      const operations = new DragOperations(manager.adapter);

      const prep = await operations.prepareDuplicates(
        [asBlock(second), asBlock(first)],
        asBlock(target),
        'bottom'
      );

      expect(prep.sortedBlocks).toEqual([asBlock(first), asBlock(second)]);
      expect(prep.validResults.map((result) => result.saved.data)).toEqual([
        { text: 'a' },
        { text: 'b' },
      ]);
      expect(prep.aborted).toBe(false);
      expect(prep.baseInsertIndex).toBe(3);
    });

    it('drops sources whose save returned nothing', async () => {
      const first = createBlock('a');
      const second = createBlock('b');
      const target = createBlock('t');
      const manager = createManager([first, second, target]);

      first.save.mockResolvedValue(false);

      const operations = new DragOperations(manager.adapter);
      const prep = await operations.prepareDuplicates(
        [asBlock(first), asBlock(second)],
        asBlock(target),
        'bottom'
      );

      expect(prep.validResults).toEqual([
        {
          saved: {
            data: { text: 'b' },
            tunes: {},
          },
          toolName: 'paragraph',
        },
      ]);
    });

    it('anchors a top-edge duplicate at the target index itself', async () => {
      const source = createBlock('a');
      const target = createBlock('t');
      const trailing = createBlock('b');
      const manager = createManager([source, target, trailing]);
      const operations = new DragOperations(manager.adapter);

      const prep = await operations.prepareDuplicates([asBlock(source)], asBlock(target), 'top');

      expect(prep.baseInsertIndex).toBe(1);
      expect(prep.aborted).toBe(false);
    });
  });

  describe('applyDuplicates', () => {
    it('inserts nothing for an aborted plan even when it carries save results', () => {
      const source = createBlock('a');
      const manager = createManager([source], { withSetBlockParent: true });
      const selection = createSelection();
      const operations = new DragOperations(manager.adapter, undefined, selection.adapter);

      const prep: DuplicatePreparation = {
        sortedBlocks: [asBlock(source)],
        sourceIds: new Set([source.id]),
        validResults: [
          {
            saved: {
              data: { text: 'a' },
              tunes: {},
            },
            toolName: 'paragraph',
          },
        ],
        baseInsertIndex: 2,
        aborted: true,
      };

      const result = operations.applyDuplicates(prep);

      expect(result).toEqual({
        duplicatedBlocks: [],
        targetIndex: 2,
      });
      expect(manager.insert).not.toHaveBeenCalled();
      expect(selection.clearSelection).not.toHaveBeenCalled();
    });

    it('leaves the selection untouched for a plan with no save results', () => {
      const manager = createManager([], { withSetBlockParent: true });
      const selection = createSelection();
      const operations = new DragOperations(manager.adapter, undefined, selection.adapter);

      const prep: DuplicatePreparation = {
        sortedBlocks: [],
        sourceIds: new Set<string>(),
        validResults: [],
        baseInsertIndex: 4,
        aborted: false,
      };

      const result = operations.applyDuplicates(prep);

      expect(result).toEqual({
        duplicatedBlocks: [],
        targetIndex: 4,
      });
      expect(selection.clearSelection).not.toHaveBeenCalled();
      expect(manager.insert).not.toHaveBeenCalled();
    });

    it('reparents a duplicate whose original parent is part of the duplicated set', () => {
      const parent = createBlock('p');
      const child = createBlock('c', 'p');

      nest(parent, child);

      const manager = createManager([parent, child], { withSetBlockParent: true });
      const operations = new DragOperations(manager.adapter);

      const prep: DuplicatePreparation = {
        sortedBlocks: [asBlock(parent), asBlock(child)],
        sourceIds: new Set([parent.id, child.id]),
        validResults: [
          {
            saved: {
              data: { text: 'p' },
              tunes: {},
            },
            toolName: 'paragraph',
          },
          {
            saved: {
              data: { text: 'c' },
              tunes: {},
            },
            toolName: 'paragraph',
          },
        ],
        baseInsertIndex: 0,
        aborted: false,
      };

      const result = operations.applyDuplicates(prep);

      expect(manager.setBlockParent).toHaveBeenCalledTimes(1);
      expect(manager.setBlockParent).toHaveBeenCalledWith(result.duplicatedBlocks[1], 'dup-1');
    });

    it('reparents nothing when the parent id is outside the plan source ids', () => {
      const parent = createBlock('p');
      const child = createBlock('c', 'p');

      nest(parent, child);

      const manager = createManager([parent, child], { withSetBlockParent: true });
      const operations = new DragOperations(manager.adapter);

      const prep: DuplicatePreparation = {
        sortedBlocks: [asBlock(parent), asBlock(child)],
        sourceIds: new Set([child.id]),
        validResults: [
          {
            saved: {
              data: { text: 'p' },
              tunes: {},
            },
            toolName: 'paragraph',
          },
          {
            saved: {
              data: { text: 'c' },
              tunes: {},
            },
            toolName: 'paragraph',
          },
        ],
        baseInsertIndex: 0,
        aborted: false,
      };

      operations.applyDuplicates(prep);

      expect(manager.setBlockParent).not.toHaveBeenCalled();
    });

    it('reparents nothing when the plan never duplicated the named parent', () => {
      const child = createBlock('c', 'ghost-parent');
      const manager = createManager([child], { withSetBlockParent: true });
      const operations = new DragOperations(manager.adapter);

      const prep: DuplicatePreparation = {
        sortedBlocks: [asBlock(child)],
        sourceIds: new Set([child.id, 'ghost-parent']),
        validResults: [
          {
            saved: {
              data: { text: 'c' },
              tunes: {},
            },
            toolName: 'paragraph',
          },
        ],
        baseInsertIndex: 0,
        aborted: false,
      };

      operations.applyDuplicates(prep);

      expect(manager.setBlockParent).not.toHaveBeenCalled();
    });

    it('re-reads setBlockParent per child and skips one that vanished', () => {
      const parent = createBlock('p');
      const child = createBlock('c', 'p');

      nest(parent, child);

      const reads = { count: 0 };
      const setBlockParent = vi.fn<(block: Block, parentId: string | null) => void>();
      const created = { count: 0 };
      const insert = vi.fn<(config: InsertConfig) => Block>(() => {
        created.count += 1;

        return asBlock(createBlock(`dup-${created.count}`));
      });

      const adapter: BlockManagerAdapter = {
        blocks: [],
        getBlockIndex: (): number => -1,
        getBlockByIndex: (): Block | undefined => undefined,
        move: vi.fn<(toIndex: number, fromIndex: number, needToFocus: boolean) => void>(),
        insert,
        // The container check and the per-child check are separate reads; this
        // accessor answers only the first one.
        get setBlockParent(): ((block: Block, parentId: string | null) => void) | undefined {
          reads.count += 1;

          return reads.count === 1 ? setBlockParent : undefined;
        },
      };

      const operations = new DragOperations(adapter);

      const prep: DuplicatePreparation = {
        sortedBlocks: [asBlock(parent), asBlock(child)],
        sourceIds: new Set([parent.id, child.id]),
        validResults: [
          {
            saved: {
              data: { text: 'p' },
              tunes: {},
            },
            toolName: 'paragraph',
          },
          {
            saved: {
              data: { text: 'c' },
              tunes: {},
            },
            toolName: 'paragraph',
          },
        ],
        baseInsertIndex: 0,
        aborted: false,
      };

      const result = operations.applyDuplicates(prep);

      expect(result.duplicatedBlocks).toHaveLength(2);
      expect(setBlockParent).not.toHaveBeenCalled();
    });
  });
});
