import type { BlockAPI } from '../../../types/api/block';
import type { BlokModules } from '../../types-internal/blok-modules';
import type { Block } from '../block';

/**
 * Returns Block instance by passed Block index or Block id
 * @param attribute - either BlockAPI or Block id or Block index
 * @param blok - Blok instance
 */
export const resolveBlock = (attribute: BlockAPI | BlockAPI['id'] | number, blok: BlokModules): Block | undefined => {
  if (typeof attribute === 'number') {
    return blok.BlockManager.getBlockByIndex(attribute);
  }

  if (typeof attribute === 'string') {
    return blok.BlockManager.getBlockById(attribute);
  }

  return blok.BlockManager.getBlockById(attribute.id);
};
