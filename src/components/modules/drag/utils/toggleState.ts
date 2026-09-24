import type { Block } from '../../../block';
import { findOwn } from '../../../utils/own-element';

const TOGGLE_OPEN_ATTR = 'data-blok-toggle-open';

const findOwnToggleMarker = (block: Block): Element | null =>
  findOwn(block.holder, `[${TOGGLE_OPEN_ATTR}]`);

/**
 * Whether the block itself is a toggle (toggle list or toggle heading).
 */
export const isToggleBlock = (block: Block): boolean =>
  findOwnToggleMarker(block) !== null;

/**
 * Whether the block itself is an expanded toggle.
 */
export const isOpenToggleBlock = (block: Block): boolean =>
  findOwnToggleMarker(block)?.getAttribute(TOGGLE_OPEN_ATTR) === 'true';

/**
 * Whether the block itself is a collapsed toggle.
 */
export const isCollapsedToggleBlock = (block: Block): boolean =>
  findOwnToggleMarker(block)?.getAttribute(TOGGLE_OPEN_ATTR) === 'false';

/**
 * Whether every dragged ROOT is a direct child of `parentId`. A dragged
 * toggle carries its descendants; their parent is the toggle itself, so
 * judging every source would never let a nested toggle leave its parent.
 *
 * @param sourceBlocks - every dragged block
 * @param parentId - the candidate parent id
 * @param parentIdOf - parent reader (pass a pre-move snapshot when the move already ran)
 */
export const areSourceRootsChildrenOf = (
  sourceBlocks: readonly Block[],
  parentId: string,
  parentIdOf: (block: Block) => string | null = block => block.parentId
): boolean => {
  const sourceIds = new Set(sourceBlocks.map(block => block.id));
  const roots = sourceBlocks.filter(block => {
    const blockParentId = parentIdOf(block);

    return blockParentId === null || !sourceIds.has(blockParentId);
  });

  return roots.length > 0 && roots.every(block => parentIdOf(block) === parentId);
};
