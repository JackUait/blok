import type { BlockPosition } from '../../../../types/api';
import { isInsideTableCell, isRestrictedInTableCell } from '../../../tools/table/table-restrictions';
import type { Block } from '../../block';
import { isChildToolAllowed } from '../../utils/child-tools';

/**
 * Thrown by `blocks.insertAt` / `blocks.moveTo` when the requested place does
 * not exist or does not accept the block. Nothing has been changed when it is
 * thrown.
 */
export class BlockPlacementError extends Error {
  /**
   * @param message - what is wrong with the requested place
   */
  constructor(message: string) {
    super(message);
    this.name = 'BlockPlacementError';
  }
}

/** The slice of BlockManager the placement helpers read. */
export interface BlockTree {
  blocks: Block[];
  getBlockById(id: string): Block | undefined;
}

/** A resolved place: the parent, and the flat index the block goes to before any removal. */
export interface ResolvedPlacement {
  parentId: string | null;
  index: number;
}

const nameOf = (parentId: string | null): string => parentId === null ? 'the root' : `"${parentId}"`;

/**
 * The block with this id, or a thrown BlockPlacementError.
 * @param tree - the blocks
 * @param id - the block id
 * @param what - how to name the block in the error
 */
export const findBlock = (tree: BlockTree, id: string, what = 'block'): Block => {
  const block = tree.getBlockById(id);

  if (block === undefined) {
    throw new BlockPlacementError(`${what} "${id}" not found`);
  }

  return block;
};

/**
 * Whether `block` sits somewhere below `ancestorId`.
 * @param tree - the blocks
 * @param block - the block to test
 * @param ancestorId - the possible ancestor
 */
export const isUnder = (tree: BlockTree, block: Block, ancestorId: string): boolean => {
  const walk = (cursor: string | null, seen: Set<string>): boolean => {
    if (cursor === null || seen.has(cursor)) {
      return false;
    }

    return cursor === ancestorId || walk(tree.getBlockById(cursor)?.parentId ?? null, seen.add(cursor));
  };

  return walk(block.parentId, new Set<string>());
};

/**
 * The flat index right after the last block of `block`'s subtree.
 * @param tree - the blocks
 * @param block - the subtree root
 */
const subtreeEnd = (tree: BlockTree, block: Block): number => {
  const start = tree.blocks.indexOf(block);
  const firstOutside = tree.blocks.slice(start + 1).findIndex(candidate => !isUnder(tree, candidate, block.id));

  return firstOutside === -1 ? tree.blocks.length : start + 1 + firstOutside;
};

/**
 * Turns a parent + sibling-relative position into a parent + flat index.
 *
 * `parentId` omitted means the sibling's parent for `before`/`after`, and the
 * root for `'start'`/`'end'`. `{ after }` lands after the sibling's whole
 * subtree.
 * @param tree - the blocks
 * @param parentId - the requested parent; undefined = inferred
 * @param position - where among the parent's children
 */
export const resolvePlacement = (
  tree: BlockTree,
  parentId: string | null | undefined,
  position: BlockPosition
): ResolvedPlacement => {
  if (parentId !== undefined && parentId !== null) {
    findBlock(tree, parentId, 'parent block');
  }

  if (typeof position === 'object') {
    const refId = 'before' in position ? position.before : position.after;
    const ref = findBlock(tree, refId);

    if (parentId !== undefined && parentId !== ref.parentId) {
      throw new BlockPlacementError(`block "${refId}" is not a child of ${nameOf(parentId)}`);
    }

    return {
      parentId: ref.parentId,
      index: 'before' in position ? tree.blocks.indexOf(ref) : subtreeEnd(tree, ref),
    };
  }

  if (parentId === undefined || parentId === null) {
    return { parentId: null, index: position === 'start' ? 0 : tree.blocks.length };
  }

  const parent = findBlock(tree, parentId, 'parent block');

  return {
    parentId,
    index: position === 'start' ? tree.blocks.indexOf(parent) + 1 : subtreeEnd(tree, parent),
  };
};

const isColumnPart = (block: Block | undefined): boolean =>
  block?.name === 'column' || block?.name === 'column_list';

/**
 * The table cell a block sits in, or null.
 * @param block - the block
 * @param asParent - true when `block` is a prospective parent: its children sit in its own cell too
 */
const cellOf = (block: Block, asParent = false): Element | null =>
  (asParent ? block.holder : block.holder.parentElement)?.closest('[data-blok-table-cell-blocks]') ?? null;

/**
 * Throws when `block` may not move under `parentId`. A move group skips the
 * refusals of `BlockManager.move`, so they are checked here, for leaving the
 * old parent as well as for entering the new one: owning containers (tables,
 * column lists), column membership (drag UI only) and table cells (their
 * blocks are listed in the table's data).
 * @param tree - the blocks
 * @param block - the block being moved
 * @param parentId - its new parent
 * @param refId - the `before`/`after` sibling, if any
 */
export const assertCanMoveUnder = (tree: BlockTree, block: Block, parentId: string | null, refId?: string): void => {
  const parent = parentId === null ? undefined : findBlock(tree, parentId, 'parent block');

  if (parent !== undefined && (parent === block || isUnder(tree, parent, block.id))) {
    throw new BlockPlacementError(`cannot move "${block.id}" inside its own subtree`);
  }

  // Before the same-parent return: the cells of one table share the table as
  // parent. A table parent with no sibling names no cell at all.
  const ref = refId === undefined ? undefined : tree.getBlockById(refId);
  const parentCell = parent === undefined ? null : cellOf(parent, true);
  const targetCell = ref === undefined ? parentCell : cellOf(ref);

  if (cellOf(block) !== targetCell) {
    throw new BlockPlacementError(`cannot move "${block.id}" into, out of or between table cells`);
  }

  if (parentId === block.parentId) {
    return;
  }

  const oldParent = block.parentId === null ? undefined : tree.getBlockById(block.parentId);

  if (parent?.tool.ownsChildren === true) {
    throw new BlockPlacementError(`${nameOf(parentId)} owns its children`);
  }

  if (oldParent?.tool.ownsChildren === true) {
    throw new BlockPlacementError(`"${oldParent.id}" owns its children; "${block.id}" cannot leave it`);
  }

  if (isColumnPart(oldParent) || isColumnPart(parent)) {
    throw new BlockPlacementError(`cannot move "${block.id}" into or out of a column`);
  }

  if (!isChildToolAllowed(parent, block.name)) {
    throw new BlockPlacementError(`${nameOf(parentId)} does not allow "${block.name}" children`);
  }

  if (parent !== undefined && isInsideTableCell(parent) && isRestrictedInTableCell(block.name)) {
    throw new BlockPlacementError(`"${block.name}" is not allowed inside a table cell`);
  }
};
