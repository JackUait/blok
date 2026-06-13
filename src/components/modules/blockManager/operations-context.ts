/**
 * Shared contract between the BlockOperations coordinator and its focused
 * worker classes (BlockInsertion, BlockRemoval, BlockMutation).
 *
 * BlockOperations owns the mutable shared state (currentBlockIndex,
 * suppressStopCapturing), the navigation accessors and a few cross-cutting
 * helpers. The workers receive it as an `OperationsContext` so they can read
 * and mutate that shared state without each re-implementing it.
 */
import type { BlockToolData, BlokConfig } from '../../../../types';
import type { BlockMutationType } from '../../../../types/events/block';
import type { Block } from '../../block';
import type { BlokEventMap } from '../../events';
import type { EventsDispatcher } from '../../utils/events';
import type { Caret } from '../caret';
import type { I18n } from '../i18n';
import type { YjsManager } from '../yjs';
import type { BlockFactory } from './factory';
import type { BlockHierarchy } from './hierarchy';
import type { BlockRepository } from './repository';
import type { InsertBlockOptions, BlockMutationEventDetailWithoutTarget, BlocksStore } from './types';
import type { BlockYjsSync } from './yjs-sync';

/**
 * Dependencies needed by BlockOperations
 */
export interface BlockOperationsDependencies {
  /** Blok configuration */
  config: BlokConfig;
  /** YjsManager instance */
  YjsManager: YjsManager;
  /** Caret module */
  Caret: Caret;
  /** I18n module */
  I18n: I18n;
  /** Events dispatcher */
  eventsDispatcher: EventsDispatcher<BlokEventMap>;
}

/**
 * Block mutation callback signature
 */
export type BlockDidMutated = <Type extends BlockMutationType>(
  mutationType: Type,
  block: Block,
  detailData: BlockMutationEventDetailWithoutTarget<Type>
) => Block;

/**
 * Surface the worker classes rely on. Implemented by BlockOperations.
 */
export interface OperationsContext {
  /** Required dependencies */
  readonly dependencies: BlockOperationsDependencies;
  /** BlockRepository for block lookups */
  readonly repository: BlockRepository;
  /** BlockFactory for creating blocks */
  readonly factory: BlockFactory;
  /** BlockHierarchy for parent/child operations */
  readonly hierarchy: BlockHierarchy;
  /** YjsSync instance (set after initialization) */
  readonly yjsSync: BlockYjsSync;
  /** Callback for block mutations */
  readonly blockDidMutated: BlockDidMutated;

  /**
   * Raw current block index access — no stopCapturing side effect.
   * Used where the original code wrote `this.currentBlockIndex` directly to
   * defer stopCapturing until after Yjs sync.
   */
  rawCurrentBlockIndex: number;

  /**
   * Current block index with stopCapturing side effect on change.
   */
  currentBlockIndexValue: number;

  /**
   * Flag to suppress stopCapturing during atomic operations (like split).
   */
  suppressStopCapturing: boolean;

  /** Current block (undefined when no block is selected) */
  readonly currentBlock: Block | undefined;

  /** Insert a new block (delegated to BlockInsertion) */
  insert(options: InsertBlockOptions, blocksStore: BlocksStore): Block;

  /** Remove a block (delegated to BlockRemoval) */
  removeBlock(block: Block, addLastBlock: boolean, skipYjsSync: boolean, blocksStore: BlocksStore): Promise<void>;

  /** Replace a block with a new tool (delegated to BlockMutation) */
  replace(block: Block, newTool: string, data: BlockToolData, blocksStore: BlocksStore): Block;

  /**
   * Attach `newBlock` to the old parent in place of the old block id,
   * preserving the original position in the parent's contentIds[].
   */
  transferParentLinkToNewBlock(oldBlockId: string, newBlock: Block, oldParentId: string): void;

  /** Dev/test invariant gate run after each mutation */
  assertHierarchyInvariantInDev(context: string): void;
}
