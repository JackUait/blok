/**
 * Pure reads over the block tree: parentId is membership, contentIds is
 * sibling order, and the flat array is expected to be a depth-first walk.
 */

/** What these functions read from a block. */
export interface TreeBlock {
  id: string;
  parentId: string | null;
  contentIds: string[];
}

/** The flat array plus an id lookup (the Blocks store fits). */
export interface BlockTreeView<T extends TreeBlock = TreeBlock> {
  readonly blocks: readonly T[];
  getById(id: string): T | undefined;
}

/** A place in the tree: under `parentId`, right after sibling `afterId` (null = first). */
export interface TreePlacement {
  parentId: string | null;
  afterId: string | null;
}

/**
 * The block's parent when the lookup knows it, else null: a dangling parent
 * reads as the root, as in the saver output.
 * @param tree - the blocks
 * @param block - the block
 */
const effectiveParentId = (tree: BlockTreeView, block: TreeBlock): string | null =>
  block.parentId !== null && tree.getById(block.parentId) !== undefined ? block.parentId : null;

/**
 * Whether `block` sits somewhere below `ancestorId`. Cycle-safe; a dangling
 * parent ends the chain.
 * @param tree - the blocks
 * @param block - the block to test
 * @param ancestorId - the possible ancestor
 */
const isUnder = (tree: BlockTreeView, block: TreeBlock, ancestorId: string): boolean => {
  const walk = (cursor: string | null, seen: Set<string>): boolean => {
    if (cursor === null || seen.has(cursor)) {
      return false;
    }

    return cursor === ancestorId || walk(tree.getById(cursor)?.parentId ?? null, seen.add(cursor));
  };

  return walk(block.parentId, new Set<string>());
};

/**
 * The flat index right after the subtree that starts at `index`: the first
 * later block that is not a descendant of `blocks[index]`, or the array end.
 * @param tree - the blocks
 * @param index - where the subtree starts
 */
export const subtreeEnd = (tree: BlockTreeView, index: number): number => {
  const { blocks } = tree;

  if (index < 0 || index >= blocks.length) {
    throw new RangeError(`subtreeEnd: index ${index} is outside the array (length ${blocks.length})`);
  }

  const root = blocks[index];
  const firstOutside = blocks.slice(index + 1).findIndex(candidate => !isUnder(tree, candidate, root.id));

  return firstOutside === -1 ? blocks.length : index + 1 + firstOutside;
};

const indexInArray = (tree: BlockTreeView, id: string, what: string): number => {
  const block = tree.getById(id);
  const index = block === undefined ? -1 : tree.blocks.indexOf(block);

  if (index === -1) {
    throw new Error(`${what} "${id}" is not in the block array`);
  }

  return index;
};

/**
 * The flat index a block (with its subtree) goes to for `placement`: right
 * after the parent (or at 0 for the root) when `afterId` is null, else right
 * after `afterId`'s whole subtree. The array must not hold the block being
 * placed.
 * @param tree - the blocks, without the one being placed
 * @param placement - parent + previous sibling
 */
export const flatIndexForPlacement = (tree: BlockTreeView, placement: TreePlacement): number => {
  const { parentId, afterId } = placement;
  const parentIndex = parentId === null ? -1 : indexInArray(tree, parentId, 'parent');

  if (afterId === null) {
    return parentIndex + 1;
  }

  const afterIndex = indexInArray(tree, afterId, 'sibling');

  if (effectiveParentId(tree, tree.blocks[afterIndex]) !== parentId) {
    throw new Error(`block "${afterId}" is not a child of ${parentId === null ? 'the root' : `"${parentId}"`}`);
  }

  return subtreeEnd(tree, afterIndex);
};

/**
 * `children` (the parent's children, in flat order) in tree order: those the
 * parent's contentIds list, in that order, then the rest.
 * @param tree - the blocks
 * @param parent - the parent
 * @param children - its children in flat order
 */
const orderChildren = <T extends TreeBlock>(tree: BlockTreeView<T>, parent: TreeBlock, children: T[]): T[] => {
  const listed = [...new Set(parent.contentIds)]
    .map(id => tree.getById(id))
    .filter((child): child is T => child !== undefined && children.includes(child));

  return [...listed, ...children.filter(child => !listed.includes(child))];
};

/**
 * A parent's children in tree order, by the rule {@link dfsOrder} follows.
 * @param tree - the blocks
 * @param parent - the parent
 */
export const childrenInTreeOrder = <T extends TreeBlock>(tree: BlockTreeView<T>, parent: TreeBlock): T[] =>
  orderChildren(tree, parent, tree.blocks.filter(block => block.parentId === parent.id));

/**
 * The tree's depth-first order. Roots keep array order. A parent's children
 * are the blocks whose parentId names it: first those its contentIds list, in
 * that order, then the unlisted ones in flat order. A contentIds entry that
 * dangles, repeats, or names a block with another parent is skipped. Blocks a
 * parent cycle keeps out of reach go last, in flat order.
 * @param tree - the blocks
 */
export const dfsOrder = <T extends TreeBlock>(tree: BlockTreeView<T>): T[] => {
  const inArray = new Set<TreeBlock>(tree.blocks);
  const parentOf = (block: T): string | null => {
    const parentId = effectiveParentId(tree, block);
    const parent = parentId === null ? undefined : tree.getById(parentId);

    return parent !== undefined && inArray.has(parent) ? parentId : null;
  };
  const childrenInFlatOrder = new Map<string, T[]>();

  tree.blocks.forEach(block => {
    const parentId = parentOf(block);

    if (parentId !== null) {
      childrenInFlatOrder.set(parentId, [...(childrenInFlatOrder.get(parentId) ?? []), block]);
    }
  });

  const order: T[] = [];
  const visited = new Set<T>();
  const walk = (block: T): void => {
    if (visited.has(block)) {
      return;
    }
    visited.add(block);
    order.push(block);

    orderChildren(tree, block, childrenInFlatOrder.get(block.id) ?? []).forEach(walk);
  };

  tree.blocks.filter(block => parentOf(block) === null).forEach(walk);

  return [...order, ...tree.blocks.filter(block => !visited.has(block))];
};

/**
 * The placement `block`'s current flat position implies: its parent, and the
 * nearest earlier block in the array with the same parent (null if none).
 * @param tree - the blocks
 * @param block - a block the array holds
 */
export const placementImpliedByFlat = (tree: BlockTreeView, block: TreeBlock): TreePlacement => {
  const index = tree.blocks.indexOf(block);

  if (index === -1) {
    throw new Error(`block "${block.id}" is not in the block array`);
  }

  const parentId = effectiveParentId(tree, block);
  const previous = tree.blocks.slice(0, index).filter(candidate => effectiveParentId(tree, candidate) === parentId).pop();

  return { parentId, afterId: previous?.id ?? null };
};
