import { BlockToolAdapter } from '../tools/adapters/block-tool-adapter';

/**
 * Describes methods for accessing installed Blok tools
 */
export interface Tools {
  /**
   * Returns all available Block Tools
   */
  getBlockTools(): BlockToolAdapter[];
}
