import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blok } from '../../../../../src/blok';
import { Paragraph } from '../../../../../src/tools/paragraph';
import { ColumnList } from '../../../../../src/tools/column-list';
import { Column } from '../../../../../src/tools/column';
import { YjsManager } from '../../../../../src/components/modules/yjs';
import { BlockManager } from '../../../../../src/components/modules/blockManager';
import type { OutputBlockData, OutputData } from '../../../../../types';

/**
 * Move replay must leave the container's IN-MEMORY child order agreeing with
 * the doc.
 *
 * `replayMovePlacement` writes the doc first (correct), then reparents in
 * memory through `BlockHierarchy.setBlockParent`, which derives the child's
 * slot from the block's CURRENT FLAT-ARRAY position. At that instant the flat
 * array is still the PRE-replay one: the repair (`syncBlockOrderFromYjs`) is
 * scheduled on a microtask by the 'move' event the replay's own second
 * transaction emits. So the slot is computed against a stale neighbour order
 * and the container ends up holding its children in the opposite order to the
 * doc — permanently, because the move path never mirrored `contentIds` back
 * from the doc the way `handleYjsUpdate` does for a captured reparent.
 *
 * The forward gesture is immune: DragController does the flat move FIRST,
 * inside the same `transactMoves` group, so `setBlockParent` reads an already
 * correct flat array. Only the replay inverts.
 *
 * The user-visible damage is twofold: the block renders at the wrong position
 * inside the container, and `save()` refuses the document from then on
 * ("children of block(s) ... are saved in a different order than their DOM
 * order").
 */

interface TestEditor {
  isReady: Promise<unknown>;
  save: () => Promise<OutputData>;
  destroy: () => void;
  blocks: {
    move: (toIndex: number, fromIndex?: number) => void;
    getBlockIndex: (id: string) => number | undefined;
    setBlockParent: (id: string, parentId: string | null) => void;
  };
  history: { undo: () => void; redo: () => void };
}

/**
 * `mover` sits ABOVE the column list, so after the undo puts it back at root
 * its stale flat index is BELOW `child1`'s — the redo then computes slot 0 and
 * inverts the pair.
 */
const buildMoveIntoContainerDocument = (): OutputData => ({
  blocks: [
    { id: 'mover', type: 'paragraph', data: { text: 'Mover' } },
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['child1'] },
    { id: 'child1', type: 'paragraph', data: { text: 'Child one' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['child2'] },
    { id: 'child2', type: 'paragraph', data: { text: 'Child two' }, parent: 'c2' },
  ],
});

/**
 * `first` is c1's FIRST child, so its from-placement is `afterId: null`. After
 * the outdent it sits below `second` in the flat array, so the undo's stale
 * slot appends it last while the doc restores it first.
 */
const buildOutdentDocument = (): OutputData => ({
  blocks: [
    { id: 'cl1', type: 'column_list', data: {}, content: ['c1', 'c2'] },
    { id: 'c1', type: 'column', data: {}, parent: 'cl1', content: ['first', 'second'] },
    { id: 'first', type: 'paragraph', data: { text: 'First child' }, parent: 'c1' },
    { id: 'second', type: 'paragraph', data: { text: 'Second child' }, parent: 'c1' },
    { id: 'c2', type: 'column', data: {}, parent: 'cl1', content: ['other'] },
    { id: 'other', type: 'paragraph', data: { text: 'Other column' }, parent: 'c2' },
    { id: 'tail', type: 'paragraph', data: { text: 'Tail' } },
  ],
});

let editor: TestEditor | undefined;
let holder: HTMLDivElement | undefined;
let capturedYjs: YjsManager | undefined;
let capturedBlockManager: BlockManager | undefined;

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
  }
};

/**
 * Undo/redo rebuilds memory from the doc across an animation frame, so the
 * microtask flush alone reads a half-applied tree.
 */
const flushThroughFrame = async (): Promise<void> => {
  await flush();
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  await flush();
};

const docChildrenOf = (id: string): string[] | undefined =>
  (capturedYjs?.toJSON() ?? []).find((block: OutputBlockData) => block.id === id)?.content;

const memoryChildrenOf = (id: string): string[] | undefined =>
  capturedBlockManager?.getBlockById(id)?.contentIds;

describe('move replay — the container keeps the doc order in memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder = document.createElement('div');
    document.body.appendChild(holder);

    const originalFromJSON = YjsManager.prototype.fromJSON;

    vi.spyOn(YjsManager.prototype, 'fromJSON').mockImplementation(function (
      this: YjsManager,
      blocks: Parameters<YjsManager['fromJSON']>[0]
    ) {
      capturedYjs = this;

      return originalFromJSON.call(this, blocks);
    });

    const originalPrepare = BlockManager.prototype.prepare;

    vi.spyOn(BlockManager.prototype, 'prepare').mockImplementation(function (this: BlockManager) {
      capturedBlockManager = this;

      return originalPrepare.call(this);
    });
  });

  afterEach(async () => {
    editor?.destroy();
    // Let the sync's scheduled holder-order reconcile run while the holders are
    // still mounted: it settles across a RAF, and detaching the holder first
    // leaves it reading a half-dismantled DOM and throwing out of band.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await flush();
    holder?.remove();
    editor = undefined;
    holder = undefined;
    capturedYjs = undefined;
    capturedBlockManager = undefined;
    vi.restoreAllMocks();
  });

  const createEditor = async (data: OutputData): Promise<TestEditor> => {
    const instance = new Blok({
      holder,
      tools: {
        paragraph: Paragraph,
        column_list: ColumnList,
        column: Column,
      },
      data,
    }) as unknown as TestEditor;

    editor = instance;
    await instance.isReady;
    await flush();

    return instance;
  };

  /**
   * The drag drop sequence, verbatim from `DragController.handleDrop`: ONE
   * `transactMoves` group holding the flat move and the reparent, so both land
   * on a single move history entry.
   */
  const dragInto = (
    instance: TestEditor,
    blockId: string,
    toIndex: number,
    parentId: string | null
  ): void => {
    capturedYjs?.transactMoves(() => {
      instance.blocks.move(toIndex, instance.blocks.getBlockIndex(blockId));
      instance.blocks.setBlockParent(blockId, parentId);
    }, true);
  };

  it('redo of a move into a container keeps the child order the doc records', async () => {
    const instance = await createEditor(buildMoveIntoContainerDocument());

    dragInto(instance, 'mover', 3, 'c1');
    await flushThroughFrame();

    // The forward gesture is correct — the defect is replay-only.
    expect(docChildrenOf('c1')).toEqual(['child1', 'mover']);
    expect(memoryChildrenOf('c1')).toEqual(['child1', 'mover']);

    instance.history.undo();
    await flushThroughFrame();

    expect(docChildrenOf('c1')).toEqual(['child1']);
    expect(memoryChildrenOf('c1')).toEqual(['child1']);

    instance.history.redo();
    await flushThroughFrame();

    expect(docChildrenOf('c1')).toEqual(['child1', 'mover']);
    expect(memoryChildrenOf('c1')).toEqual(['child1', 'mover']);

    // save() re-derives the tree from memory and refuses a document whose child
    // order disagrees with the DOM, so it is the second, independent witness.
    const saved = await instance.save();

    expect(
      saved.blocks.filter((block) => block.parent === 'c1').map((block) => block.id)
    ).toEqual(['child1', 'mover']);
  });

  it('undo of an outdent restores the child at the slot the doc records', async () => {
    const instance = await createEditor(buildOutdentDocument());

    dragInto(instance, 'first', 6, null);
    await flushThroughFrame();

    expect(docChildrenOf('c1')).toEqual(['second']);
    expect(memoryChildrenOf('c1')).toEqual(['second']);

    instance.history.undo();
    await flushThroughFrame();

    expect(docChildrenOf('c1')).toEqual(['first', 'second']);
    expect(memoryChildrenOf('c1')).toEqual(['first', 'second']);

    const saved = await instance.save();

    expect(
      saved.blocks.filter((block) => block.parent === 'c1').map((block) => block.id)
    ).toEqual(['first', 'second']);
  });
});
