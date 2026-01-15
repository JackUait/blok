/**
 * Shared types for BlockManager modules
 */

import type { BlockToolData } from '../../../../types';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import type { BlockMutationType, BlockMutationEventMap } from '../../../../types/events/block';
import type { Block } from '../../block';
import type { Blocks } from '../../blocks';

/**
 * Block creation options
 */
export interface ComposeBlockOptions {
  /** Tool name from config */
  tool: string;
  /** Unique id for this block */
  id?: string;
  /** Constructor params */
  data?: BlockToolData;
  /** Block tune data */
  tunes?: { [name: string]: BlockTuneData };
  /** Parent block id for hierarchical structure */
  parentId?: string;
  /** Array of child block ids */
  contentIds?: string[];
  /** Bind events immediately instead of deferring via requestIdleCallback */
  bindEventsImmediately?: boolean;
}

/**
 * Block insert options
 */
export interface InsertBlockOptions {
  /** Block's unique id */
  id?: string;
  /** Plugin name, by default method inserts the default block type */
  tool?: string;
  /** Plugin data */
  data?: BlockToolData;
  /** Index where to insert new Block */
  index?: number;
  /** Flag shows if needed to update current Block index */
  needToFocus?: boolean;
  /** Flag shows if block by passed index should be replaced with inserted one */
  replace?: boolean;
  /** Block tune data */
  tunes?: { [name: string]: BlockTuneData };
  /** Skip syncing to Yjs (caller handles sync separately) */
  skipYjsSync?: boolean;
}

/**
 * Result of a block operation
 */
export interface BlockOperationResult {
  /** Type of operation */
  type: 'insert' | 'remove' | 'update' | 'move' | 'replace' | 'split' | 'merge';
  /** Block affected by operation */
  block?: Block;
  /** Block id */
  blockId?: string;
  /** Index in the blocks array */
  index: number;
  /** Block that was removed */
  removedBlock?: Block;
  /** From index (for move operations) */
  fromIndex?: number;
  /** To index (for move operations) */
  toIndex?: number;
  /** New block created by operation */
  newBlock?: Block;
}

/**
 * Block mutation event detail without target field
 */
export type BlockMutationEventDetailWithoutTarget<Type extends BlockMutationType> = Omit<
  BlockMutationEventMap[Type]['detail'],
  'target'
>;

/**
 * Options for updating a block
 */
export interface UpdateBlockOptions {
  /** New data (optional) */
  data?: Partial<BlockToolData>;
  /** New tune data (optional) */
  tunes?: { [name: string]: BlockTuneData };
}

/**
 * Options for converting a block
 */
export interface ConvertBlockOptions {
  /** Target tool name */
  targetToolName: string;
  /** Optional new Block data overrides */
  blockDataOverrides?: BlockToolData;
}

/**
 * Block storage with indexed access
 */
export type BlocksStore = Blocks & {
  [index: number]: Block | undefined;
  insert(index: number, block: Block, replace?: boolean): void;
  remove(index: number): void;
  move(toIndex: number, fromIndex: number, skipDOM?: boolean): void;
};
