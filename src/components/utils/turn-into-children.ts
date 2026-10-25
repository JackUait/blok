import type { BlockToolData } from '../../../types';
import type { Block } from '../block';
import { releasesChildrenOnConvert, textLivesInFirstChild as textLivesInFirstChildOf } from '../../shared/turn-into';
import { SELF_PLACING_PARENTS } from '../../tools/nested-blocks';
import { isChildToolAllowed } from './child-tools';
import { findOwn } from './own-element';

/**
 * Whether `block` keeps its own text in its first child block, not in its
 * data. Only a callout does. A turn-into hoists that child's text.
 * @param block - the block being turned into another tool
 */
export const textLivesInFirstChild = (block: Block): boolean => textLivesInFirstChildOf(block.name);

/**
 * Whether turning `source` into `targetTool` moves its children up to its own
 * level (see `releasesChildrenOnConvert`). Read `source` before it is swapped
 * out: the check needs its rendered toggle marker.
 * @param source - the block being turned into another tool
 * @param targetTool - the tool it becomes
 * @param targetData - the new block's data
 */
export const releasesChildrenOnTurnInto = (
  source: Block,
  targetTool: string,
  targetData?: BlockToolData
): boolean => releasesChildrenOnConvert({
  type: source.name,
  isToggleHeading: source.name !== 'toggle' && findOwn(source.holder, '[data-blok-toggle-open]') !== null,
}, targetTool, targetData);

/**
 * Whether `target` may keep `child` nested under it after a turn-into.
 * A table or database places only its own blocks.
 * @param target - the block that replaced the old parent
 * @param child - a child of the replaced block
 */
export const canAdoptChild = (target: Block, child: Block): boolean =>
  !SELF_PLACING_PARENTS.has(target.name) && isChildToolAllowed(target, child.name);
