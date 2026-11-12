import type { BlockPosition, MoveToTarget } from '../../../../types/api';
import { checkMove, type PlacementTree } from '../../../shared/agent/placement-rules';
import { isInsideTableCell, isRestrictedInTableCell } from '../../../tools/table/table-restrictions';
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

/**
 * Every check `blocks.moveTo` makes, without moving anything. Returns the
 * resolved place, or throws a BlockPlacementError.
 * @param tree - the blocks
 * @param block - the block to move
 * @param target - new parent and position
 */
export const resolveMoveTo = (tree: BlockTree, block: Block, target: MoveToTarget): ResolvedPlacement => {
  const { position } = target;
  const relative = typeof position === 'object' ? position : undefined;
  const refId = relative !== undefined && 'before' in relative ? relative.before : relative?.after;

  if (refId === block.id) {
    throw new BlockPlacementError(`cannot place "${block.id}" relative to itself`);
  }

  const placement = resolvePlacement(tree, target.parentId, position);

  assertCanMoveUnder(tree, block, placement.parentId, refId);

  const from = tree.blocks.indexOf(block);
  const end = from + tree.blocks.filter(candidate => isUnder(tree, candidate, block.id)).length;
  // A slot inside or right after its own subtree needs no flat move.
  const movesFlat = placement.index <= from || placement.index > end + 1;
  const toIndex = from < placement.index ? placement.index - 1 : placement.index;

  // move() silently refuses a restricted tool whose slot neighbour is a
  // table cell block, even for the slot right after a table. Drop this when
  // the pin "blocks.move puts a header right after a table" passes.
  if (movesFlat && isRestrictedInTableCell(block.name) && isInsideTableCell(tree.blocks[toIndex])) {
    throw new BlockPlacementError(`cannot move "${block.name}" to a slot next to a table cell block`);
  }

  return placement;
};

/**
 * A dry run of `blocks.moveTo(id, target)` for each block in turn: each check
 * sees the blocks before it already moved. Throws the first refusal.
 * @param tree - the blocks
 * @param blocks - the blocks to move, in move order, none inside another
 * @param target - new parent and position, the same for each
 */
export const assertCanMoveAll = (tree: BlockTree, blocks: Block[], target: MoveToTarget): void => {
  const byId = new Map(tree.blocks.map(block => [block.id, block]));
  const state = { order: [...tree.blocks] };
  const view: BlockTree = {
    get blocks() {
      return state.order;
    },
    getBlockById: id => byId.get(id),
  };

  blocks.forEach(original => {
    const block = byId.get(original.id) ?? original;
    const placement = resolveMoveTo(view, block, target);
    const members = state.order.filter(candidate => candidate === block || isUnder(view, candidate, block.id));
    // Only the parent changes. The holder stays where it is, which the table
    // cell checks can bear: a moved block's cell blocks stay in its own table.
    const moved = Object.create(block, { parentId: { value: placement.parentId } }) as Block;
    const kept = state.order.filter(candidate => !members.includes(candidate));
    const at = state.order.slice(0, placement.index).filter(candidate => !members.includes(candidate)).length;

    byId.set(block.id, moved);
    state.order = [...kept.slice(0, at), ...members.map(member => (member === block ? moved : member)), ...kept.slice(at)];
  });
};
