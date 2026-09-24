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
 * Hides a placed block whose parent is collapsed, by the rule setBlockParent
 * uses: the parent's own toggle marker is closed, or every other child is hidden.
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
    .filter((sibling): sibling is Block => sibling !== undefined);
  const collapsed = findOwn(parent.holder, '[data-blok-toggle-open="false"]') !== null
    || (siblings.length > 0 && siblings.every(sibling => sibling.holder.classList.contains('hidden')));

  if (collapsed) {
    block.holder.classList.add('hidden');
  }
};
