/**
 * Helpers for code that places a new block with `BlockHierarchy.placeBlock`,
 * which leaves tables/databases and visibility to its caller.
 */
import { SELF_PLACING_PARENTS } from '../../../tools/nested-blocks';
import type { Block } from '../../block';
import { findOwn } from '../../utils/own-element';

type GetBlock = (id: string) => Block | undefined;

/**
 * Whether `block` is a table/database or sits under one: the tool places its
 * children, so inserts under it keep the flat-index path. Cycle-safe.
 * @param block - the prospective parent
 * @param getBlock - block lookup by id
 */
export const isSelfPlacedParent = (block: Block, getBlock: GetBlock): boolean => {
  const walk = (cursor: Block | undefined, seen: Set<string>): boolean =>
    cursor !== undefined && !seen.has(cursor.id) && (
      SELF_PLACING_PARENTS.has(cursor.name)
      || walk(cursor.parentId === null ? undefined : getBlock(cursor.parentId), seen.add(cursor.id))
    );

  return walk(block, new Set<string>());
};

/**
 * Whether a child's own `hidden` class says its parent is collapsed. A layout
 * piece (`isLayout`, like a tab) is hidden by its own parent tool while its
 * siblings stay visible, so its flag says nothing about the parent.
 * @param child - a child of the parent being checked
 */
export const isHiddenByCollapsedParent = (child: Block): boolean =>
  child.holder.classList.contains('hidden') && !child.tool.isLayout;

/**
 * Whether the block is invisible: its own holder or any ancestor block's
 * holder has the `hidden` class. A hidden ancestor (an inactive tab) does not
 * flag its descendants, so the walk must go up the tree. Cycle-safe.
 * @param block - the block to test
 * @param getBlock - block lookup by id
 */
export const isHiddenInTree = (block: Block, getBlock: GetBlock): boolean => {
  const walk = (cursor: Block | undefined, seen: Set<string>): boolean =>
    cursor !== undefined && !seen.has(cursor.id) && (
      cursor.holder.classList.contains('hidden')
      || walk(cursor.parentId === null ? undefined : getBlock(cursor.parentId), seen.add(cursor.id))
    );

  return walk(block, new Set<string>());
};

/**
 * The ancestors hiding `block`, innermost first: a collapsed toggle, or a block
 * whose holder is `hidden` (an inactive tab). Reveal them with `call('expand')`
 * outermost first. The block itself does not count: its own text shows even
 * when it is collapsed. Cycle-safe.
 * @param block - the block to reveal
 * @param getBlock - block lookup by id
 */
export const hiddenAncestors = (block: Block, getBlock: GetBlock): Block[] => {
  const walk = (parentId: string | null, seen: Set<string>): Block[] => {
    const parent = parentId === null ? undefined : getBlock(parentId);

    return parent === undefined || seen.has(parent.id) ? [] : [parent, ...walk(parent.parentId, seen.add(parent.id))];
  };

  return walk(block.parentId, new Set<string>([block.id])).filter((parent) =>
    parent.holder.classList.contains('hidden')
    || findOwn(parent.holder, '[data-blok-toggle-open]')?.getAttribute('data-blok-toggle-open') === 'false'
  );
};

/**
 * Hides a placed block whose parent is collapsed, by the rule setBlockParent
 * uses: the parent's own toggle marker is closed, or every other non-layout
 * child is hidden.
 * @param block - the block, already placed
 * @param getBlock - block lookup by id
 */
export const hideUnderCollapsedParent = (block: Block, getBlock: GetBlock): void => {
  const parent = block.parentId === null ? undefined : getBlock(block.parentId);

  if (parent === undefined) {
    return;
  }

  const siblings = parent.contentIds
    .filter(childId => childId !== block.id)
    .map(childId => getBlock(childId))
    .filter((sibling): sibling is Block => sibling !== undefined)
    .filter(sibling => !(sibling.holder.classList.contains('hidden') && sibling.tool.isLayout));
  const collapsed = findOwn(parent.holder, '[data-blok-toggle-open="false"]') !== null
    || (siblings.length > 0 && siblings.every(sibling => sibling.holder.classList.contains('hidden')));

  if (collapsed) {
    block.holder.classList.add('hidden');
  }
};
