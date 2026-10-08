import type { BlockPosition } from '../../../../types/api';
import { checkMove, type PlacementTree } from '../../../shared/agent/placement-rules';
import { isRestrictedInTableCell } from '../../../tools/table/table-restrictions';
import type { Block } from '../../block';
import { acceptsChildren, getChildToolRestrictions } from '../../utils/child-tools';
import { subtreeEnd } from '../../utils/tree-order';

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

/**
 * A resolved place: the parent, the sibling the block follows (null = first),
 * and the flat index the block goes to before any removal.
 */
export interface ResolvedPlacement {
  parentId: string | null;
  afterId: string | null;
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
 * @param block - the subtree root, in `tree.blocks`
 */
const subtreeEndOf = (tree: BlockTree, block: Block): number =>
  subtreeEnd({ blocks: tree.blocks, getById: id => tree.getBlockById(id) }, tree.blocks.indexOf(block));

/**
 * The last child of `parentId` (null = a root block) in flat order before
 * flat index `end`, or null.
 * @param tree - the blocks
 * @param parentId - the parent
 * @param end - where to stop looking (exclusive)
 */
export const lastChildBefore = (tree: BlockTree, parentId: string | null, end: number): string | null =>
  tree.blocks.slice(0, end).filter(candidate => candidate.parentId === parentId).pop()?.id ?? null;

/**
 * Turns a parent + sibling-relative position into a parent, the sibling the
 * block follows and a flat index.
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

    const refIndex = tree.blocks.indexOf(ref);

    return 'before' in position
      ? { parentId: ref.parentId, afterId: lastChildBefore(tree, ref.parentId, refIndex), index: refIndex }
      : { parentId: ref.parentId, afterId: ref.id, index: subtreeEndOf(tree, ref) };
  }

  if (parentId === undefined || parentId === null) {
    return position === 'start'
      ? { parentId: null, afterId: null, index: 0 }
      : { parentId: null, afterId: lastChildBefore(tree, null, tree.blocks.length), index: tree.blocks.length };
  }

  const parent = findBlock(tree, parentId, 'parent block');

  if (position === 'start') {
    return { parentId, afterId: null, index: tree.blocks.indexOf(parent) + 1 };
  }

  const end = subtreeEndOf(tree, parent);

  return { parentId, afterId: lastChildBefore(tree, parentId, end), index: end };
};

const blockPlacementTree = (tree: BlockTree): PlacementTree => ({
  parentOf: id => tree.getBlockById(id)?.parentId ?? null,
  typeOf: id => tree.getBlockById(id)?.name ?? '',
  cellOf: (id, asParent) => {
    const block = tree.getBlockById(id);

    return block === undefined ? null
      : (asParent ? block.holder : block.holder.parentElement)?.closest('[data-blok-table-cell-blocks]') ?? null;
  },
  containerFacts: id => {
    const block = tree.getBlockById(id);
    const restrictions = getChildToolRestrictions(block);

    return {
      accepts: acceptsChildren(block),
      allow: restrictions?.allow,
      deny: restrictions?.deny,
      ownedByTool: block?.tool.ownsChildren === true,
    };
  },
  restrictedInCell: isRestrictedInTableCell,
});

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
export const assertCanMoveUnder = (
  tree: BlockTree,
  block: Block,
  parentId: string | null,
  refId?: string,
  options: { allowColumnMoves?: boolean } = {}
): void => {
  if (parentId !== null) {
    findBlock(tree, parentId, 'parent block');
  }

  // Unknown references fall back to the prospective parent's cell.
  const referenceId = refId !== undefined && tree.getBlockById(refId) !== undefined ? refId : undefined;
  const refusal = checkMove(blockPlacementTree(tree), block.id, parentId, referenceId, options);

  if (refusal !== null) {
    throw new BlockPlacementError(refusal.message);
  }
};
