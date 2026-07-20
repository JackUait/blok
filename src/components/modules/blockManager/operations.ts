/**
 * @class BlockOperations
 * @classdesc Coordinator for state-changing operations on blocks. Owns the
 * shared mutable state (currentBlockIndex, suppressStopCapturing), the block
 * navigation accessors and a few cross-cutting helpers, and delegates the
 * actual work to focused worker classes:
 *   - BlockInsertion — insert / split / paste
 *   - BlockRemoval   — removeBlock + descendant teardown/promotion
 *   - BlockMutation  — update / replace / move / merge / convert
 * @module BlockOperations
 */
import type { BlockToolData, PasteEvent, OutputBlockData } from '../../../../types';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import type { Block } from '../../block';
import { resolveRuntimeEnv, validateHierarchy } from '../../utils/hierarchy-invariant';
import { BlockInsertion } from './block-insertion';
import { BlockMutation } from './block-mutation';
import { BlockRemoval } from './block-removal';
import type { BlockFactory } from './factory';
import type { BlockHierarchy } from './hierarchy';
import type {
  BlockDidMutated,
  BlockOperationsDependencies,
  OperationsContext,
} from './operations-context';
import type { BlockRepository } from './repository';
import type { InsertBlockOptions, BlocksStore } from './types';
import type { BlockYjsSync } from './yjs-sync';

export type { BlockOperationsDependencies, BlockDidMutated } from './operations-context';

/**
 * BlockOperations coordinates all state-changing operations on blocks.
 */
export class BlockOperations implements OperationsContext {
  public readonly dependencies: BlockOperationsDependencies;
  public readonly repository: BlockRepository;
  public readonly factory: BlockFactory;
  public readonly hierarchy: BlockHierarchy;
  private _yjsSync!: BlockYjsSync; // Set via setter after initialization
  public readonly blockDidMutated: BlockDidMutated;

  private readonly insertion: BlockInsertion;
  private readonly removal: BlockRemoval;
  private readonly mutation: BlockMutation;

  /**
   * Current block index state (managed externally, passed in for operations)
   */
  private currentBlockIndex: number;

  /**
   * Flag to suppress stopCapturing during atomic operations (like split)
   * This prevents breaking undo grouping when currentBlockIndex changes
   */
  public suppressStopCapturing = false;

  /**
   * @param dependencies - Required dependencies
   * @param repository - BlockRepository for block lookups
   * @param factory - BlockFactory for creating blocks
   * @param hierarchy - BlockHierarchy for parent/child operations
   * @param blockDidMutated - Callback for block mutations
   * @param initialCurrentBlockIndex - Initial current block index
   */
  constructor(
    dependencies: BlockOperationsDependencies,
    repository: BlockRepository,
    factory: BlockFactory,
    hierarchy: BlockHierarchy,
    blockDidMutated: BlockDidMutated,
    initialCurrentBlockIndex: number = -1
  ) {
    this.dependencies = dependencies;
    this.repository = repository;
    this.factory = factory;
    this.hierarchy = hierarchy;
    this.blockDidMutated = blockDidMutated;
    this.currentBlockIndex = initialCurrentBlockIndex;

    this.insertion = new BlockInsertion(this);
    this.removal = new BlockRemoval(this);
    this.mutation = new BlockMutation(this);
  }

  /**
   * Set the YjsSync instance (called after initialization to break circular dependency)
   * @param yjsSync - The YjsSync instance
   */
  public setYjsSync(yjsSync: BlockYjsSync): void {
    this._yjsSync = yjsSync;
  }

  /**
   * YjsSync instance (set after initialization)
   */
  public get yjsSync(): BlockYjsSync {
    return this._yjsSync;
  }

  /**
   * Raw current block index access — no stopCapturing side effect.
   */
  public get rawCurrentBlockIndex(): number {
    return this.currentBlockIndex;
  }

  public set rawCurrentBlockIndex(newIndex: number) {
    this.currentBlockIndex = newIndex;
  }

  /**
   * Get current block index
   */
  public get currentBlockIndexValue(): number {
    return this.currentBlockIndex;
  }

  /**
   * Set current block index (with stopCapturing side effect)
   */
  public set currentBlockIndexValue(newIndex: number) {
    if (this.currentBlockIndex !== newIndex && !this.suppressStopCapturing) {
      this.dependencies.YjsManager?.stopCapturing();
    }
    this.currentBlockIndex = newIndex;
  }

  /**
   * Get current block
   * Returns undefined when no block is selected (currentBlockIndex === -1)
   */
  public get currentBlock(): Block | undefined {
    if (this.currentBlockIndex === -1) {
      return undefined;
    }

    return this.repository.getBlockByIndex(this.currentBlockIndex);
  }

  /**
   * Get next block
   * Returns null when no block is selected or already at the last block
   */
  public get nextBlock(): Block | null {
    if (this.currentBlockIndex === -1) {
      return null;
    }

    const isLastBlock = this.currentBlockIndex === (this.repository.length - 1);

    if (isLastBlock) {
      return null;
    }

    const nextBlock = this.repository.getBlockByIndex(this.currentBlockIndex + 1);

    return nextBlock ?? null;
  }

  /**
   * Get previous block
   * Returns null when no block is selected or already at the first block
   */
  public get previousBlock(): Block | null {
    if (this.currentBlockIndex === -1) {
      return null;
    }

    const isFirstBlock = this.currentBlockIndex === 0;

    if (isFirstBlock) {
      return null;
    }

    const previousBlock = this.repository.getBlockByIndex(this.currentBlockIndex - 1);

    return previousBlock ?? null;
  }

  /**
   * Get next visible block (skips blocks whose holder has 'hidden' class)
   * Returns null when no visible block is found after the current one
   */
  public get nextVisibleBlock(): Block | null {
    if (this.currentBlockIndex === -1) {
      return null;
    }

    return this.repository.blocks
      .slice(this.currentBlockIndex + 1)
      .find(block => !block.holder.classList.contains('hidden')) ?? null;
  }

  /**
   * Get previous visible block (skips blocks whose holder has 'hidden' class)
   * Returns null when no visible block is found before the current one
   */
  public get previousVisibleBlock(): Block | null {
    if (this.currentBlockIndex === -1) {
      return null;
    }

    return this.repository.blocks
      .slice(0, this.currentBlockIndex)
      .reverse()
      .find(block => !block.holder.classList.contains('hidden')) ?? null;
  }

  /**
   * Insert new block
   * @param options - Insert options
   * @param blocksStore - The blocks store to modify
   * @returns The inserted block
   */
  public insert(options: InsertBlockOptions = {}, blocksStore: BlocksStore): Block {
    return this.insertion.insert(options, blocksStore);
  }

  /**
   * Insert new default block at passed index
   * @param index - Index where Block should be inserted
   * @param needToFocus - If true, updates current Block index
   * @param skipYjsSync - If true, skip syncing to Yjs
   * @param blocksStore - The blocks store to modify
   * @param forceTopLevel - If true, place new block at workingArea root level
   * @returns Inserted Block
   */
  public insertDefaultBlockAtIndex(
    index: number,
    needToFocus = false,
    skipYjsSync = false,
    blocksStore: BlocksStore,
    forceTopLevel = false
  ): Block {
    return this.insertion.insertDefaultBlockAtIndex(index, needToFocus, skipYjsSync, blocksStore, forceTopLevel);
  }

  /**
   * Always inserts at the end
   * @param blocksStore - The blocks store to modify
   * @returns Inserted Block
   */
  public insertAtEnd(blocksStore: BlocksStore): Block {
    return this.insertion.insertAtEnd(blocksStore);
  }

  /**
   * Insert a new paragraph block as a child of the given parent, atomically.
   * @param parentId - id of the parent block
   * @param insertIndex - flat block index where the new block should appear
   * @param blocksStore - The blocks store to modify
   * @param childData - optional data for the new child block
   * @returns the newly created child block
   */
  public insertInsideParent(parentId: string, insertIndex: number, blocksStore: BlocksStore, childData?: BlockToolData): Block {
    return this.insertion.insertInsideParent(parentId, insertIndex, blocksStore, childData);
  }

  /**
   * Split current Block
   * @param blocksStore - The blocks store to modify
   * @returns Split block
   */
  public split(blocksStore: BlocksStore): Block {
    return this.insertion.split(blocksStore);
  }

  /**
   * Splits a block by updating the current block's data and inserting a new block.
   * @param currentBlockId - id of the block to update
   * @param currentBlockData - new data for the current block
   * @param newBlockType - tool type for the new block
   * @param newBlockData - data for the new block
   * @param insertIndex - index where to insert the new block
   * @param blocksStore - The blocks store to modify
   * @returns the newly created block
   */
  public splitBlockWithData(
    currentBlockId: string,
    currentBlockData: Partial<BlockToolData>,
    newBlockType: string,
    newBlockData: BlockToolData,
    insertIndex: number,
    blocksStore: BlocksStore
  ): Block {
    return this.insertion.splitBlockWithData(currentBlockId, currentBlockData, newBlockType, newBlockData, insertIndex, blocksStore);
  }

  /**
   * Insert pasted content. Call onPaste callback after insert.
   * @param toolName - Name of Tool to insert
   * @param pasteEvent - Pasted data
   * @param replace - Should replace current block
   * @param blocksStore - The blocks store to modify
   * @param data - Initial tool data for the inserted block
   */
  public paste(
    toolName: string,
    pasteEvent: PasteEvent,
    replace = false,
    blocksStore: BlocksStore,
    data?: BlockToolData
  ): Promise<Block> {
    return this.insertion.paste(toolName, pasteEvent, replace, blocksStore, data);
  }

  /**
   * Remove passed Block
   * @param block - Block to remove
   * @param addLastBlock - If true, inserts a new default block when the last block is removed
   * @param skipYjsSync - If true, skip syncing to Yjs
   * @param blocksStore - The blocks store to modify
   */
  public removeBlock(block: Block, addLastBlock = true, skipYjsSync = false, blocksStore: BlocksStore): Promise<void> {
    return this.removal.removeBlock(block, addLastBlock, skipYjsSync, blocksStore);
  }

  /**
   * Update Block data
   * @param block - Block to update
   * @param blocksStore - The blocks store to modify
   * @param data - New data
   * @param tunes - New tune data
   */
  public update(block: Block, blocksStore: BlocksStore, data?: Partial<BlockToolData>, tunes?: { [name: string]: BlockTuneData }): Promise<Block> {
    return this.mutation.update(block, blocksStore, data, tunes);
  }

  /**
   * Replace passed Block with the new one with specified Tool and data
   * @param block - Block to replace
   * @param newTool - New Tool name
   * @param data - New Tool data
   * @param blocksStore - The blocks store to modify
   */
  public replace(block: Block, newTool: string, data: BlockToolData, blocksStore: BlocksStore): Block {
    return this.mutation.replace(block, newTool, data, blocksStore);
  }

  /**
   * Move a block to a new index
   * @param toIndex - Index where to move Block
   * @param fromIndex - Index of Block to move
   * @param skipDOM - If true, do not manipulate DOM
   * @param blocksStore - The blocks store to modify
   * @param skipMovedHook - If true, do not fire the moved() lifecycle hook
   */
  public move(toIndex: number, fromIndex: number, skipDOM: boolean, blocksStore: BlocksStore, skipMovedHook = false): void {
    this.mutation.move(toIndex, fromIndex, skipDOM, blocksStore, skipMovedHook);
  }

  /**
   * Merge two blocks
   * @param targetBlock - Previous block will be append to this block
   * @param blockToMerge - Block that will be merged with target block
   * @param blocksStore - The blocks store to modify
   */
  public mergeBlocks(targetBlock: Block, blockToMerge: Block, blocksStore: BlocksStore): Promise<void> {
    return this.mutation.mergeBlocks(targetBlock, blockToMerge, blocksStore);
  }

  /**
   * Converts passed Block to the new Tool
   * @param blockToConvert - Block that should be converted
   * @param targetToolName - Name of the Tool to convert to
   * @param blocksStore - The blocks store to modify
   * @param blockDataOverrides - Optional new Block data overrides
   */
  public convert(blockToConvert: Block, targetToolName: string, blocksStore: BlocksStore, blockDataOverrides?: BlockToolData): Promise<Block> {
    return this.mutation.convert(blockToConvert, targetToolName, blocksStore, blockDataOverrides);
  }

  /**
   * Moves the current block up by one position
   * @param blocksStore - The blocks store to modify
   * @param selectedBlocks - blocks under block-level selection (moved together)
   */
  public moveCurrentBlockUp(blocksStore: BlocksStore, selectedBlocks?: Block[]): void {
    this.mutation.moveCurrentBlockUp(blocksStore, selectedBlocks);
  }

  /**
   * Moves the current block down by one position
   * @param blocksStore - The blocks store to modify
   * @param selectedBlocks - blocks under block-level selection (moved together)
   */
  public moveCurrentBlockDown(blocksStore: BlocksStore, selectedBlocks?: Block[]): void {
    this.mutation.moveCurrentBlockDown(blocksStore, selectedBlocks);
  }

  /**
   * Attach `newBlock` to the old parent in place of the old block id,
   * routing through `setBlockParent` so the DOM reparent/hide side effects
   * run, then restoring the original position in the parent's contentIds[].
   *
   * Shared by BlockInsertion (insert/paste) and BlockMutation (replace).
   * @param oldBlockId - The id of the block being replaced
   * @param newBlock - The newly composed replacement block
   * @param oldParentId - The parent id to transfer onto `newBlock`
   */
  public transferParentLinkToNewBlock(oldBlockId: string, newBlock: Block, oldParentId: string): void {
    const parentBlock = this.repository.getBlockById(oldParentId);

    if (parentBlock === undefined) {
      // Parent already gone from the repository (e.g. race) — fall back to
      // the bare parentId assignment so the new block at least carries the
      // parent link for save/serialization.
      // eslint-disable-next-line no-param-reassign
      newBlock.parentId = oldParentId;

      return;
    }

    const oldPositionInParent = parentBlock.contentIds.indexOf(oldBlockId);

    this.hierarchy.setBlockParent(newBlock, oldParentId);

    if (oldPositionInParent < 0) {
      return;
    }

    const withoutStale = parentBlock.contentIds.filter(id => id !== oldBlockId && id !== newBlock.id);

    withoutStale.splice(oldPositionInParent, 0, newBlock.id);
    parentBlock.contentIds = withoutStale;
  }

  /**
   * Dev/test invariant gate.
   *
   * Validates the parent/contentIds bidirectional invariant against the live
   * repository. Gated behind NODE_ENV so prod stays free, but every test run
   * and dev session asserts it after every BlockOperations mutation. Catches
   * any future regression that would corrupt the hierarchy at the point of
   * introduction instead of one save cycle later — closing the last gap in
   * the "callout/table/toggle ejection" bug family by instrumenting the
   * mutation pipeline itself.
   *
   * The save-time gate (saver) and the setBlockParent dangling-id guard are
   * defenses at the boundaries; this is the defense at the core.
   *
   * Filters out the saver-repairable violation kinds (`child-parent-missing`,
   * `content-id-dangling`) because complex multi-step ops legitimately pass
   * through transient orphan states between sub-operations. The gate fires
   * only on the irreversible drift kinds: bidirectional divergence
   * (`child-not-in-parent-content`, `content-parent-mismatch`) and duplicate
   * content ids (`content-duplicate`) — the patterns the callout/table/toggle
   * ejection bug family exhibits.
   * @param context - label of the operation that just ran (for error messages)
   */
  public assertHierarchyInvariantInDev(context: string): void {
    // Browser-aware env resolution: the old `typeof process` pattern silently
    // disabled this gate in every real-browser (e2e/dev-serve) session.
    const env = resolveRuntimeEnv();

    if (env !== 'test' && env !== 'development') {
      return;
    }

    const blocks: OutputBlockData[] = this.repository.blocks.map(b => ({
      id: b.id,
      type: b.name,
      data: {},
      ...(b.parentId !== null && b.parentId !== undefined ? { parent: b.parentId } : {}),
      ...(Array.isArray(b.contentIds) && b.contentIds.length > 0 ? { content: [...b.contentIds] } : {}),
    }));

    const violations = validateHierarchy(blocks).filter(v =>
      v.kind === 'child-not-in-parent-content' ||
      v.kind === 'content-parent-mismatch' ||
      v.kind === 'content-duplicate'
    );

    /**
     * NOTE: the stranded-holder check (validateHolderAttachment) deliberately
     * does NOT run here. Composite teardowns pass through legitimate transient
     * strands mid-operation — e.g. removing a table inside a toggle promotes
     * the cell blocks in the model while their holders stay in the table's
     * subtree until the table's own async teardown removes them. The settled
     * chokepoint for that class is Saver.doSave (a save that emits blocks the
     * user cannot see IS the bug).
     */
    if (violations.length === 0) {
      return;
    }

    const summary = violations.map(v => `  - ${v.message}`).join('\n');

    throw new Error(`Hierarchy invariant violated at BlockOperations.${context}:\n${summary}`);
  }
}
