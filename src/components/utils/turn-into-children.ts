import type { BlockToolData } from '../../../types';
import type { Block } from '../block';
import { SELF_PLACING_PARENTS } from '../../tools/nested-blocks';
import { isChildToolAllowed } from './child-tools';
import { findOwn } from './own-element';

/**
 * Whether turning `source` into `targetTool` moves its children up to its own
 * level instead of keeping them nested. Only a toggle heading does (Notion);
 * a toggle list keeps them. Read `source` before it is swapped out: the
 * check needs its rendered toggle marker.
 * @param source - the block being turned into another tool
 * @param targetTool - the tool it becomes
 * @param targetData - the new block's data
 */
export const releasesChildrenOnTurnInto = (
  source: Block,
  targetTool: string,
  targetData?: BlockToolData
): boolean => {
  const sourceIsToggleHeading = source.name !== 'toggle'
    && findOwn(source.holder, '[data-blok-toggle-open]') !== null;
  const targetIsToggleHeading = targetTool === 'header' && targetData?.isToggleable === true;

  return sourceIsToggleHeading && !targetIsToggleHeading;
};

/**
 * Whether `target` may keep `child` nested under it after a turn-into.
 * A table or database places only its own blocks.
 * @param target - the block that replaced the old parent
 * @param child - a child of the replaced block
 */
export const canAdoptChild = (target: Block, child: Block): boolean =>
  !SELF_PLACING_PARENTS.has(target.name) && isChildToolAllowed(target, child.name);
