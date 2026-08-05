/**
 * Shared types for BlockManager modules
 */

import type { BlockOrigin, BlockToolData } from '../../../../types';
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
  /** Timestamp of the last edit (milliseconds since epoch) */
  lastEditedAt?: number;
  /** ID of the user who last edited this block */
  lastEditedBy?: string | null;
  /**
   * Why this Block is being composed — a creation the author just made, or a
   * re-materialisation of a block the document already describes. Handed to the
   * Tool constructor so container Tools can seed default children on creation
   * only. Defaults to `'api'`; a caller that forgets it is never mistaken for a
   * user gesture.
   */
  origin?: BlockOrigin;
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
  /** When true, append block to workingArea instead of positioning relative to adjacent blocks */
  appendToWorkingArea?: boolean;
  /**
   * When true, force DOM placement at workingArea root level even if the previous block
   * in the flat array is nested. Prevents the Enter-after-callout regression family where
   * a top-level insertion would otherwise land inside a nested container.
   */
  forceTopLevel?: boolean;
  /**
   * Why this Block is being created — see {@link ComposeBlockOptions.origin}.
   * Defaults to `'api'`.
   */
  origin?: BlockOrigin;
}

/**
 * Block mutation event detail without target field
 */
export type BlockMutationEventDetailWithoutTarget<Type extends BlockMutationType> = Omit<
  BlockMutationEventMap[Type]['detail'],
  'target'
>;

/**
 * Block storage with indexed access
 */
export type BlocksStore = Blocks & {
  [index: number]: Block | undefined;
  insert(
    index: number,
    block: Block,
    replace?: boolean,
    appendToWorkingArea?: boolean,
    forceTopLevel?: boolean
  ): void;
  remove(index: number): void;
  move(toIndex: number, fromIndex: number, skipDOM?: boolean, skipMovedHook?: boolean): void;
};
