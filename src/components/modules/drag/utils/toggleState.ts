import type { Block } from '../../../block';
import { DATA_ATTR } from '../../../constants/data-attributes';
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
 * Whether the block's own holder shows a drop-into zone (an empty tab), so a
 * drop on it nests as its first child. A zone with the `hidden` class is off.
 * Only an unnamed zone counts: a named one (a tab pill) routes to the block it
 * names, not to the block that hosts it.
 */
export const hasOwnDropIntoZone = (block: Block): boolean =>
  findOwn(block.holder, `[${DATA_ATTR.dropInto}=""]:not(.hidden)`) !== null;

/**
 * The named drop-into zone under the pointer, with the id of the block it
 * names, or null when the pointer is not on one.
 * @param element - the element under the pointer
 */
export const findNamedDropIntoZone = (element: Element): { zone: HTMLElement; blockId: string } | null => {
  const zone = element.closest<HTMLElement>(`[${DATA_ATTR.dropInto}]:not([${DATA_ATTR.dropInto}=""]):not(.hidden)`);
  const blockId = zone?.getAttribute(DATA_ATTR.dropInto);

  return zone === null || blockId == null ? null : { zone, blockId };
};

/**
 * Whether a bottom-edge drop on the block nests inside it as its first child:
 * an open toggle, or a block showing its own drop-into zone.
 */
export const takesDropAsFirstChild = (block: Block): boolean =>
  isOpenToggleBlock(block) || hasOwnDropIntoZone(block);

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
