/**
 * @class BlockMutation
 * @classdesc In-place block mutations: update, replace, move, merge and convert.
 * @module BlockMutation
 */
import type { BlockToolData, SanitizerConfig } from '../../../../types';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';
import { BlockMovedMutationType } from '../../../../types/events/block/BlockMoved';
import type { Block } from '../../block';
import { isEmpty, isObject, isString, log, generateBlockId } from '../../utils';
import { announce } from '../../utils/announcer';
import { convertStringToBlockData, isBlockConvertable } from '../../utils/blocks';
import { sanitizeBlocks, clean, composeSanitizerConfig } from '../../utils/sanitizer';
import { isInsideTableCell, isRestrictedInTableCell } from '../../../tools/table/table-restrictions';
import { ToolNotFoundError } from '../../errors/tool-not-found';
import { getBlockNestingDepth } from '../drag/utils/depthUtils';
import type { BlockFactory } from './factory';
import type { BlockHierarchy } from './hierarchy';
import type { BlockRepository } from './repository';
import type { BlockDidMutated, BlockOperationsDependencies, OperationsContext } from './operations-context';
import type { BlockMutationEventDetailWithoutTarget, BlocksStore } from './types';
import type { BlockYjsSync } from './yjs-sync';

/**
 * Handles in-place mutations of existing blocks: data/tune updates, tool
 * replacement, reordering, merging and conversion. Reads/writes shared state
 * via the OperationsContext.
 */
export class BlockMutation {
  private readonly ctx: OperationsContext;

  /**
   * @param ctx - Shared operations context (state + cross-cutting helpers)
   */
  constructor(ctx: OperationsContext) {
    this.ctx = ctx;
  }

  private get dependencies(): BlockOperationsDependencies {
    return this.ctx.dependencies;
  }

  private get repository(): BlockRepository {
    return this.ctx.repository;
  }

  private get factory(): BlockFactory {
    return this.ctx.factory;
  }

  private get hierarchy(): BlockHierarchy {
    return this.ctx.hierarchy;
  }

  private get yjsSync(): BlockYjsSync {
    return this.ctx.yjsSync;
  }

  private get blockDidMutated(): BlockDidMutated {
    return this.ctx.blockDidMutated;
  }

  /**
   * Update Block data
   * @param block - Block to update
   * @param blocksStore - The blocks store to modify
   * @param data - New data
   * @param tunes - New tune data
   */
  public async update(block: Block, blocksStore: BlocksStore, data?: Partial<BlockToolData>, tunes?: { [name: string]: BlockTuneData }): Promise<Block> {
    if (!data && !tunes) {
      return block;
    }

    const existingData = await block.data;

    /**
     * Layer 16: stale-source guard (regression: wrong-block-dropped family).
     *
     * `await block.data` is async — during that await, `block` can be removed
     * by a Yjs remote delete, undo/redo, or tool conversion. When that happens
     * `getBlockIndex(block)` returns -1 and `blocksStore.replace(-1, newBlock)`
     * throws `Incorrect index`, aborting the surrounding batch mid-flight and
     * leaving the flat blocks array inconsistent with the DOM — exactly the
     * stale-state condition that lets drag drop an unrelated block.
     *
     * Abort cleanly: return the original block with no mutation or Yjs side
     * effects. Revalidate AFTER the await, not before, so the guard covers
     * the full async gap.
     */
    const blockIndex = this.repository.getBlockIndex(block);

    if (blockIndex === -1) {
      return block;
    }

    const newBlock = this.factory.composeBlock({
      id: block.id,
      tool: block.name,
      data: Object.assign({}, existingData, data ?? {}),
      tunes: tunes ?? block.preservedTunes,
      parentId: block.parentId ?? undefined,
      contentIds: block.contentIds.length > 0 ? [...block.contentIds] : undefined,
      bindEventsImmediately: true,
    });

    blocksStore.replace(blockIndex, newBlock);

    this.blockDidMutated(BlockChangedMutationType, newBlock, {
      index: blockIndex,
    });

    // Sync changed data to Yjs
    if (data !== undefined) {
      for (const [key, value] of Object.entries(data)) {
        this.dependencies.YjsManager.updateBlockData(block.id, key, value);
      }
    }

    // Sync changed tunes to Yjs
    if (tunes !== undefined) {
      for (const [tuneName, tuneData] of Object.entries(tunes)) {
        this.dependencies.YjsManager.updateBlockTune(block.id, tuneName, tuneData);
      }
    }

    return newBlock;
  }

  /**
   * Replace passed Block with the new one with specified Tool and data
   * @param block - Block to replace
   * @param newTool - New Tool name
   * @param data - New Tool data
   * @param blocksStore - The blocks store to modify
   */
  public replace(block: Block, newTool: string, data: BlockToolData, blocksStore: BlocksStore): Block {
    const blockIndex = this.repository.getBlockIndex(block);

    /**
     * Layer 16: stale-source guard (regression: wrong-block-dropped family).
     *
     * `convert()` calls this after `await block.save()` — during that await
     * the block can be removed by a Yjs remote delete or undo. A stale source
     * here would drive `YjsManager.addBlock({...}, -1)` and
     * `insert({ index: -1, replace: true })` — both feed negative indices
     * into downstream splice paths that silently corrupt the flat array.
     *
     * Abort cleanly: return the original block with no Yjs or DOM side
     * effects. The caller (conversion dropdown, paste) already tolerates a
     * no-op outcome for a destroyed source.
     */
    if (blockIndex === -1) {
      return block;
    }

    const newBlockId = generateBlockId();

    // Capture hierarchy before replacement
    const oldParentId = block.parentId;
    const oldContentIds = [...block.contentIds];

    // Atomic transaction: remove old block + add new block as single undo entry
    this.dependencies.YjsManager.transact(() => {
      this.dependencies.YjsManager.removeBlock(block.id);
      this.dependencies.YjsManager.addBlock({
        id: newBlockId,
        type: newTool,
        data,
      }, blockIndex);
    });

    // DOM update (skip Yjs sync — already done above)
    const newBlock = this.ctx.insert({
      id: newBlockId,
      tool: newTool,
      data,
      index: blockIndex,
      replace: true,
      skipYjsSync: true,
    }, blocksStore);

    // Transfer hierarchy to new block.
    //
    // Route through `BlockHierarchy.setBlockParent` rather than mutating
    // `newBlock.parentId` / `parentBlock.contentIds` directly, so that DOM
    // reparenting (into the parent's toggle-children container) and
    // collapsed-state propagation happen atomically. Direct mutation was the
    // last remaining path that could leave a replaced child inside a
    // callout/toggle rendered at the wrong DOM position until the next full
    // render pass — same architectural shape as the callout paste-ejection
    // bug family.
    //
    // Ordering concern: `setBlockParent` appends the new id to the parent's
    // contentIds[], but `replace()` must preserve the OLD block's position.
    // Capture the old index first, then run setBlockParent, then move the new
    // id back into the captured slot and drop the (now-stale) old id.
    if (oldParentId !== null) {
      this.ctx.transferParentLinkToNewBlock(block.id, newBlock, oldParentId);
    }

    /**
     * Nesting is structural (parentId/contentIds) and tool-agnostic — any block,
     * including a plain paragraph or header, can host children, which render as
     * margin-indented siblings when the tool has no children container. So "turn
     * into" keeps the children nested under the retyped block (matching Notion)
     * regardless of the target tool: just re-home them onto the new block.
     *
     * `reparentChildren` uses setBlockParent, which pushes each child id onto
     * `newBlock.contentIds`. Reset it first so we don't end up with a pre-existing
     * array plus appended ids.
     */
    newBlock.contentIds = [];
    this.reparentChildren(oldContentIds, newBlock.id);

    this.ctx.assertHierarchyInvariantInDev('replace');

    return newBlock;
  }

  /**
   * Route each child through `BlockHierarchy.setBlockParent` so that DOM
   * reparenting (into the new parent's toggle-children container) and
   * collapsed-state propagation run as a single atomic side effect per child.
   *
   * Direct `childBlock.parentId = ...` mutation is the same architectural bug
   * as the callout paste-ejection family: the parent/content invariant is
   * maintained but the DOM drifts from the logical tree until the next render.
   * @param childIds - Array of child block IDs to reparent
   * @param newParentId - New parent block ID
   */
  private reparentChildren(childIds: string[], newParentId: string): void {
    for (const childId of childIds) {
      const childBlock = this.repository.getBlockById(childId);

      if (childBlock !== undefined) {
        this.hierarchy.setBlockParent(childBlock, newParentId);
      }
    }
  }

  /**
   * Move a block to a new index
   * @param toIndex - Index where to move Block
   * @param fromIndex - Index of Block to move
   * @param skipDOM - If true, do not manipulate DOM
   * @param blocksStore - The blocks store to modify
   * @param skipMovedHook - If true, do not fire the moved() lifecycle hook
   * @param skipAutoHeal - If true, do not auto-heal the moved block's parentId from
   *   its destination neighbour. Callers that perform an in-container reorder of a
   *   whole subtree (keyboard moveUp/Down) must set this: their per-block lifts make
   *   a subtree's inner child briefly neighbour an unrelated block, and the heal
   *   would re-parent it to that transient neighbour, flattening the subtree.
   */
  public move(toIndex: number, fromIndex: number, skipDOM: boolean, blocksStore: BlocksStore, skipMovedHook = false, skipAutoHeal = false): void {
    // Make sure indexes are valid and within a valid range
    if (isNaN(toIndex) || isNaN(fromIndex)) {
      log(`Warning during 'move' call: incorrect indices provided.`, 'warn');

      return;
    }

    if (!this.repository.validateIndex(toIndex) || !this.repository.validateIndex(fromIndex)) {
      log(`Warning during 'move' call: indices cannot be lower than 0 or greater than the amount of blocks.`, 'warn');

      return;
    }

    // Check if the move would place a restricted tool inside a table cell
    const movingBlock = this.repository.getBlockByIndex(fromIndex);
    const neighborBlock = this.repository.getBlockByIndex(toIndex);

    if (movingBlock !== undefined && neighborBlock !== undefined &&
        isInsideTableCell(neighborBlock) && isRestrictedInTableCell(movingBlock.name)) {
      log(`Warning during 'move' call: '${movingBlock.name}' is restricted in table cells.`, 'warn');

      return;
    }

    /**
     * Defense-in-depth: capture the destination's parentId BEFORE the flat
     * reorder so we can auto-heal cross-container moves below.
     *
     * `move()` is only a flat-array reorder — it does NOT touch parentId or
     * the source/destination container `contentIds`. Without an auto-heal,
     * any caller that drags or keyboard-shuffles a block past a container
     * boundary leaves `parentId` stale: the block lands visually inside the
     * new container but still claims the old one. That's the exact drift
     * the cross-parent merge guard already blocks at the merge layer; we
     * mirror the defense here so the same bug family can never re-enter
     * via the move pipeline. DragController already calls setBlockParent
     * after move(); the auto-heal below makes that a no-op (idempotent),
     * and rescues every other caller (keyboard moveUp/Down, public api).
     */
    const destinationParentId = neighborBlock !== undefined ? neighborBlock.parentId : null;

    /**
     * Column-boundary clamp (keyboard / public-api move only).
     *
     * A column's blocks sit contiguously in the flat array, immediately
     * before the next sibling column's blocks. A naive flat move-down on the
     * LAST block of a column (or move-up on the FIRST) lands it next to a
     * block in the ADJACENT column; the cross-container auto-heal below would
     * then re-parent it into that sibling column — ejecting it out of its own
     * column. Block-settings "move down/up" and the keyboard shortcuts must
     * reorder WITHIN the column only, never cross the column edge.
     *
     * Clamp to a no-op when: the moving block lives in a `column`, and the
     * destination neighbour belongs to a DIFFERENT parent (the move would
     * cross the column boundary). Within-column reorders keep the same parent,
     * so they are never clamped.
     *
     * Skipped while a Yjs move group is open (the drag path): DragController
     * legitimately drags blocks across columns and assigns the parent itself.
     */
    if (
      movingBlock !== undefined
      && !this.dependencies.YjsManager.isInMoveGroup
    ) {
      const movingParent = movingBlock.parentId !== null
        ? this.repository.getBlockById(movingBlock.parentId)
        : undefined;

      if (
        movingParent !== undefined
        && movingParent.name === 'column'
        && destinationParentId !== movingBlock.parentId
      ) {
        return;
      }
    }

    // Suppress stopCapturing to keep DOM + Yjs move as single undo entry
    this.ctx.suppressStopCapturing = true;
    try {
      /** Move up current Block */
      blocksStore.move(toIndex, fromIndex, skipDOM, skipMovedHook);

      /**
       * After the move, the moved block may be at a different index than toIndex
       * if nested blocks (e.g. table cell blocks) were re-sorted by resortNestedBlocks.
       * Use the saved block reference to find its actual new position.
       */
      const actualIndex = movingBlock !== undefined
        ? this.repository.getBlockIndex(movingBlock)
        : -1;
      const resolvedIndex = actualIndex >= 0 ? actualIndex : toIndex;

      this.ctx.currentBlockIndexValue = resolvedIndex;
      const movedBlock = movingBlock ?? this.ctx.currentBlock;

      if (movedBlock === undefined) {
        throw new Error(`Could not move Block. Block at index ${toIndex} is not available.`);
      }

      /**
       * Cross-container auto-heal — see the comment above destinationParentId.
       *
       * Routes through `setBlockParent`, which is the canonical chokepoint
       * that updates BOTH the moved block's `parentId` AND the source/dest
       * container `contentIds` arrays. Idempotent when the parent already
       * matches, so DragController's existing post-move setBlockParent call
       * remains a safe no-op.
       *
       * Skip inside a Yjs move group (drag path): DragController.handleDropImpl
       * calls the undo-aware `BlockManager.setBlockParent` after `move()` and
       * relies on reading the pre-move `parentId` to record the correct
       * `fromParentId` on the in-flight move entry. Mutating `parentId` here
       * via `hierarchy.setBlockParent` (which bypasses the undo bookkeeping)
       * would clobber that baseline and leave undo unable to restore the
       * original parent. The non-drag callers (keyboard moveUp/Down, public
       * api) still get the auto-heal — `isInMoveGroup` is only true while
       * DragController's `transactMoves` wrapper is open.
       */
      if (
        !skipAutoHeal
        && movedBlock.parentId !== destinationParentId
        && !this.dependencies.YjsManager.isInMoveGroup
      ) {
        this.hierarchy.setBlockParent(movedBlock, destinationParentId);
      }

      /**
       * Force call of didMutated event on Block movement
       */
      this.blockDidMutated(BlockMovedMutationType, movedBlock, {
        fromIndex,
        toIndex: resolvedIndex,
      } as BlockMutationEventDetailWithoutTarget<typeof BlockMovedMutationType>);

      // Sync to Yjs using the actual resolved index
      this.dependencies.YjsManager.moveBlock(movedBlock.id, resolvedIndex);

      this.ctx.assertHierarchyInvariantInDev('move');
    } finally {
      this.ctx.suppressStopCapturing = false;
    }
  }

  /**
   * Merge two blocks
   * @param targetBlock - Previous block will be append to this block
   * @param blockToMerge - Block that will be merged with target block
   * @param blocksStore - The blocks store to modify
   */
  public async mergeBlocks(targetBlock: Block, blockToMerge: Block, blocksStore: BlocksStore): Promise<void> {
    /**
     * Layer 17: stale-source guard (regression: wrong-block-dropped family).
     *
     * `mergeBlocks` awaits `blockToMerge.data` (and `blockToMerge.exportDataAsString`
     * in the conversion path), then re-awaits `targetBlock.data` inside
     * `completeMerge`. During those awaits, either block can be removed by a
     * Yjs remote delete, undo/redo, or a tool-conversion callback. The original
     * code held closure references and used them unguarded after the awaits,
     * which drove:
     *   - `YjsManager.transact` + `updateBlockData(targetBlock.id, …)` against a
     *     dead target id (silent no-op but still a mutation attempt)
     *   - `targetBlock.mergeWith(mergeData).then(…)` on a destroyed Block where
     *     `mergeWith` returns undefined → `.then` crash
     *   - `removeBlock(blockToMerge, …)` → `Can't find a Block to remove` thrown
     *     inside a `void ... .then(...)` chain → unhandled rejection
     *   - `currentBlockIndexValue = getBlockIndex(targetBlock)` → -1, corrupting
     *     caret state downstream
     *
     * Verify both blocks are still in the store before starting and also before
     * each mutation step so a remote delete during any of the awaits aborts
     * cleanly rather than propagating the stale reference into Yjs and the DOM.
     */
    if (
      this.repository.getBlockIndex(targetBlock) === -1 ||
      this.repository.getBlockIndex(blockToMerge) === -1
    ) {
      return;
    }

    /**
     * Defense-in-depth: refuse to merge across container boundaries.
     *
     * Every block belongs to a logical container identified by `parentId`
     * (null = root, or the id of a table/toggle/callout/header/database-row
     * block). Merging across containers silently mangles the hierarchy —
     * the source block's data is appended to a target in a DIFFERENT
     * container, and the source is then deleted, losing content and
     * breaking the invariant that a block lives under exactly one parent.
     *
     * keyboardNavigation already guards Backspace/Delete at cell/toggle
     * boundaries, but a missed guard (or a future composer that forgets
     * the check) must fail safe at this layer instead of corrupting data.
     * This is the root-cause fix for the "Enter-then-Backspace-inside-a-
     * table-cell" bug family — any similar bug in any nested-container
     * tool is prevented here.
     */
    if (targetBlock.parentId !== blockToMerge.parentId) {
      return;
    }

    /**
     * Complete the merge operation with the prepared data
     * Syncs to Yjs atomically, then updates DOM without re-syncing
     */
    const completeMerge = async (mergeData: BlockToolData): Promise<void> => {
      // Layer 17 re-check: post-await staleness window. Both blocks must still
      // be in the store, otherwise abort before any Yjs/DOM mutation.
      if (
        this.repository.getBlockIndex(targetBlock) === -1 ||
        this.repository.getBlockIndex(blockToMerge) === -1
      ) {
        return;
      }

      // Get current target data to compute merged result for Yjs
      const targetData = await targetBlock.data;
      const mergedData = { ...targetData, ...mergeData };

      // Layer 17 re-check after the second await.
      if (
        this.repository.getBlockIndex(targetBlock) === -1 ||
        this.repository.getBlockIndex(blockToMerge) === -1
      ) {
        return;
      }

      // Sync to Yjs atomically: update target + remove source as single undo entry
      this.dependencies.YjsManager.transact(() => {
        for (const [key, value] of Object.entries(mergedData)) {
          this.dependencies.YjsManager.updateBlockData(targetBlock.id, key, value);
        }
        this.dependencies.YjsManager.removeBlock(blockToMerge.id);
      });

      // DOM updates and index change (skip Yjs sync — already done above)
      // The entire operation is wrapped in withAtomicOperation to suppress stopCapturing
      // when currentBlockIndexValue is set at the end
      this.yjsSync.withAtomicOperation(() => {
        void targetBlock.mergeWith(mergeData).then(() => {
          return this.ctx.removeBlock(blockToMerge, true, true, blocksStore);
        });

        this.ctx.currentBlockIndexValue = this.repository.getBlockIndex(targetBlock);
      });
    };

    /**
     * We can merge:
     * 1) Blocks with the same Tool if tool provides merge method
     */
    const canMergeBlocksDirectly = targetBlock.name === blockToMerge.name && targetBlock.mergeable;
    const blockToMergeDataRaw = canMergeBlocksDirectly ? await blockToMerge.data : undefined;

    if (canMergeBlocksDirectly && isEmpty(blockToMergeDataRaw)) {
      console.error('Could not merge Block. Failed to extract original Block data.');

      return;
    }

    if (canMergeBlocksDirectly && blockToMergeDataRaw !== undefined) {
      const [cleanBlock] = sanitizeBlocks(
        [{ data: blockToMergeDataRaw, tool: blockToMerge.name }],
        targetBlock.tool.sanitizeConfig,
        this.dependencies.config.sanitizer as SanitizerConfig
      );

      await completeMerge(cleanBlock.data);

      return;
    }

    /**
     * 2) Blocks with different Tools if they provides conversionConfig
     */
    if (targetBlock.mergeable && isBlockConvertable(blockToMerge, 'export') && isBlockConvertable(targetBlock, 'import')) {
      const blockToMergeDataStringified = await blockToMerge.exportDataAsString();

      /**
       * Extract the field-specific sanitize rules for the field that will receive the imported content.
       */
      const importProp = targetBlock.tool.conversionConfig?.import;
      const fieldSanitizeConfig = isString(importProp) && isObject(targetBlock.tool.sanitizeConfig[importProp])
        ? targetBlock.tool.sanitizeConfig[importProp] as SanitizerConfig
        : targetBlock.tool.sanitizeConfig;

      const cleanData = clean(blockToMergeDataStringified, fieldSanitizeConfig);
      const blockToMergeData = convertStringToBlockData(cleanData, targetBlock.tool.conversionConfig);

      await completeMerge(blockToMergeData);
    }
  }

  /**
   * Converts passed Block to the new Tool
   * Uses Conversion Config
   * @param blockToConvert - Block that should be converted
   * @param targetToolName - Name of the Tool to convert to
   * @param blocksStore - The blocks store to modify
   * @param blockDataOverrides - Optional new Block data overrides
   */
  public async convert(blockToConvert: Block, targetToolName: string, blocksStore: BlocksStore, blockDataOverrides?: BlockToolData): Promise<Block> {
    /**
     * At first, we get current Block data
     */
    const savedBlock = await blockToConvert.save();

    if (!savedBlock || savedBlock.data === undefined) {
      throw new Error('Could not convert Block. Failed to extract original Block data.');
    }

    /**
     * Getting a class of the replacing Tool
     */
    const replacingTool = this.factory.getTool(targetToolName);

    if (!replacingTool) {
      throw new ToolNotFoundError(targetToolName, `Could not convert Block. Tool «${targetToolName}» not found.`);
    }

    /**
     * Using Conversion Config "export" we get a stringified version of the Block data
     */
    const exportedData = await blockToConvert.exportDataAsString();

    /**
     * Clean exported data with replacing sanitizer config.
     * We need to extract the field-specific sanitize rules for the field that will receive the imported content.
     * The tool's sanitizeConfig has the format { fieldName: { tagRules } }, but clean() expects just { tagRules }.
     */
    const importProp = replacingTool.conversionConfig?.import;
    const fieldSanitizeConfig = isString(importProp) && isObject(replacingTool.sanitizeConfig[importProp])
      ? replacingTool.sanitizeConfig[importProp] as SanitizerConfig
      : replacingTool.sanitizeConfig;

    const cleanData = clean(
      exportedData,
      composeSanitizerConfig(this.dependencies.config.sanitizer as SanitizerConfig, fieldSanitizeConfig)
    );

    /**
     * Now using Conversion Config "import" we compose a new Block data
     */
    const baseBlockData = convertStringToBlockData(cleanData, replacingTool.conversionConfig, replacingTool.settings);

    const newBlockData = blockDataOverrides
      ? Object.assign(baseBlockData, blockDataOverrides)
      : baseBlockData;

    /**
     * Block-level color (textColor / backgroundColor) is a separate data field
     * that lives OUTSIDE the conversionConfig `text` export/import contract, so
     * it is never carried by the exported string and would be dropped on every
     * "turn into". Preserve it from the source block's saved data onto the
     * converted block — generically, for ANY target tool — so Notion's "color
     * survives turn-into" behavior holds. Explicit overrides win.
     */
    for (const colorField of ['textColor', 'backgroundColor'] as const) {
      const sourceValue = savedBlock.data[colorField];

      if (typeof sourceValue === 'string' && newBlockData[colorField] === undefined) {
        newBlockData[colorField] = sourceValue;
      }
    }

    /**
     * Bracket the whole convert in a single undo group.
     *
     * Two things can split a convert across multiple Cmd+Z entries if left
     * unchecked:
     *
     * 1. Container tools (callout) seed a first child paragraph inside their
     *    `rendered()` hook via `api.blocks.insertInsideParent`, which normally
     *    forces a new undo boundary via `stopCapturing()`.
     *
     * 2. ANY tool can accept `{text}` on conversion but then populate extra
     *    fields (e.g. toggle's `isOpen: true`) during its first `save()` pass.
     *    That first save is triggered by the MutationObserver watching the
     *    brand-new block's DOM, and its `syncBlockDataToYjs` would write the
     *    extra fields as a *separate* Yjs transaction — creating a phantom
     *    post-convert undo entry so Cmd+Z needs two presses.
     *
     * We solve (1) with `suppressStopCapturing` (no new undo boundary) and
     * (2) with `yjsSync.withAtomicOperation({ extendThroughRAF: true })` which
     * keeps `isSyncingFromYjs = true` through the next animation frame, so
     * mutation-triggered `syncBlockDataToYjs` calls are suppressed for
     * rendered()/first-save writes. The tool's real data persists because
     * `replace()` already wrote it into Yjs via its own transaction.
     */
    this.dependencies.YjsManager.stopCapturing();
    const prevSuppress = this.ctx.suppressStopCapturing;

    this.ctx.suppressStopCapturing = true;

    try {
      return this.yjsSync.withAtomicOperation(
        () => this.ctx.replace(blockToConvert, replacingTool.name, newBlockData, blocksStore),
        { extendThroughRAF: true }
      );
    } finally {
      // Close the undo group after the sync `replace()` and any synchronous
      // `rendered()` → `insertInsideParent` have landed, but wait one microtask
      // so DOM MutationObserver-triggered Yjs writes settle inside the same
      // entry.
      queueMicrotask(() => {
        this.ctx.suppressStopCapturing = prevSuppress;
        this.dependencies.YjsManager.stopCapturing();
      });
    }
  }

  /**
   * Returns the flat-array index of the LAST block belonging to the subtree
   * rooted at `startIndex`. A block's subtree spans the contiguous run of
   * following blocks that are either:
   *   - flat-indent followers — deeper {@link getBlockNestingDepth} than the
   *     root (Notion's structural Tab nesting), or
   *   - container children — reachable from the root through the
   *     `parentId`/`contentIds` hierarchy (toggle/callout/column descendants).
   *
   * Both nesting carriers are unified here so a move treats any block plus its
   * whole subtree as one indivisible group. A root block with no descendants
   * returns `startIndex` itself.
   * @param startIndex - index of the subtree's root block
   * @returns index of the subtree's last block (>= startIndex)
   */
  private subtreeEndIndex(startIndex: number): number {
    const start = this.repository.getBlockByIndex(startIndex);

    if (start === undefined || start === null) {
      return startIndex;
    }

    const rootDepth = getBlockNestingDepth(start) ?? 0;
    const subtreeIds = new Set<string>([start.id]);
    const followers = Array.from(
      { length: this.repository.length - startIndex - 1 },
      (_, offset) => this.repository.getBlockByIndex(startIndex + 1 + offset)
    );

    // Walk the contiguous followers, growing the subtree id set as each block is
    // accepted; the first block that is neither a container child nor a deeper
    // flat-indent follower stops the run.
    const accepted = followers.reduce<{ count: number; stopped: boolean }>((acc, block) => {
      if (acc.stopped || block === undefined || block === null) {
        return { count: acc.count, stopped: true };
      }

      const isContainerChild = block.parentId !== null && subtreeIds.has(block.parentId);
      const isDepthFollower = (getBlockNestingDepth(block) ?? 0) > rootDepth;

      if (!isContainerChild && !isDepthFollower) {
        return { count: acc.count, stopped: true };
      }

      subtreeIds.add(block.id);

      return { count: acc.count + 1, stopped: false };
    }, { count: 0, stopped: false });

    return startIndex + accepted.count;
  }

  /**
   * Resolves the contiguous block group a move operates on. With no selection
   * it is the current block plus its subtree; with a block-level selection it
   * spans from the first selected block to the end of the last selected block's
   * subtree. The container is the group's shared `parentId` — moves are bounded
   * by it (a child never escapes its toggle/callout/column).
   * @param selectedBlocks - blocks under block-level selection (empty/none for caret moves)
   * @returns group span, anchor block and container parentId, or null when nothing is movable
   */
  private resolveMoveGroup(selectedBlocks: Block[] | undefined): {
    start: number;
    end: number;
    anchor: Block;
    containerParentId: string | null;
  } | null {
    const indices = (selectedBlocks ?? [])
      .map((block) => this.repository.getBlockIndex(block))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b);

    if (indices.length > 0) {
      const start = indices[0];
      const anchor = this.repository.getBlockByIndex(start);

      if (anchor === undefined) {
        return null;
      }

      return {
        start,
        end: this.subtreeEndIndex(indices[indices.length - 1]),
        anchor,
        containerParentId: anchor.parentId,
      };
    }

    const start = this.ctx.currentBlockIndexValue;
    const anchor = this.ctx.currentBlock;

    if (start < 0 || anchor === undefined) {
      return null;
    }

    return {
      start,
      end: this.subtreeEndIndex(start),
      anchor,
      containerParentId: anchor.parentId,
    };
  }

  /**
   * Moves the current block (or block-level selection) up by one sibling
   * position, stepping over the previous sibling's whole subtree and staying
   * within the current container. Does nothing at the container's top edge.
   * @param blocksStore - The blocks store to modify
   * @param selectedBlocks - blocks under block-level selection (move them together)
   */
  public moveCurrentBlockUp(blocksStore: BlocksStore, selectedBlocks?: Block[]): void {
    const group = this.resolveMoveGroup(selectedBlocks);

    // Find the ROOT of the previous sibling subtree: the nearest block before the
    // group, in the SAME container, at the same/shallower depth — skipping that
    // sibling's own deeper descendants (whether nested via flat depth OR a
    // structural parentId chain) so the whole subtree is hopped. `undefined` means
    // there is no preceding sibling in the container, i.e. the group is already its
    // first child (top edge / first block of a toggle/callout/column).
    const predStart = ((): number | undefined => {
      if (group === null) {
        return undefined;
      }

      const movingDepth = getBlockNestingDepth(group.anchor) ?? 0;
      const precedingIndices = Array.from({ length: group.start }, (_, offset) => group.start - 1 - offset);

      return precedingIndices.find((index) => {
        const candidate = this.repository.getBlockByIndex(index);

        return candidate !== undefined &&
          candidate.parentId === group.containerParentId &&
          (getBlockNestingDepth(candidate) ?? 0) <= movingDepth;
      });
    })();

    // Boundary: top of document, or the group is the first child of its container.
    if (group === null || predStart === undefined) {
      announce(this.dependencies.I18n.t('a11y.atTop'), { politeness: 'polite' });

      return;
    }

    // Slide the group up so each member lands at predStart..(predStart + size).
    const size = group.end - group.start + 1;

    Array.from({ length: size }).forEach((_, offset) => {
      // skipAutoHeal: this is an in-container reorder (boundary-checked above), so
      // the group's parentId is unchanged and the per-block heal would only corrupt
      // a moved subtree's inner children.
      this.move(predStart + offset, group.start + offset, false, blocksStore, false, true);
    });

    this.finishMove(group.anchor, selectedBlocks, 'a11y.movedUp');
  }

  /**
   * Moves the current block (or block-level selection) down by one sibling
   * position, stepping over the next sibling's whole subtree and staying within
   * the current container. Does nothing at the container's bottom edge.
   * @param blocksStore - The blocks store to modify
   * @param selectedBlocks - blocks under block-level selection (move them together)
   */
  public moveCurrentBlockDown(blocksStore: BlocksStore, selectedBlocks?: Block[]): void {
    const group = this.resolveMoveGroup(selectedBlocks);
    const successor = group !== null
      ? this.repository.getBlockByIndex(group.end + 1)
      : undefined;

    // Boundary: bottom of document, or the block below belongs to a different
    // container (the group is the last child of its toggle/callout/column).
    if (group === null || successor === undefined ||
        successor.parentId !== group.containerParentId) {
      announce(this.dependencies.I18n.t('a11y.atBottom'), { politeness: 'polite' });

      return;
    }

    // Lift the next sibling's whole subtree to just before the group, which
    // descends the group past it by one sibling position.
    const neighbourStart = group.end + 1;
    const neighbourSize = this.subtreeEndIndex(neighbourStart) - neighbourStart + 1;

    Array.from({ length: neighbourSize }).forEach((_, offset) => {
      // skipAutoHeal: in-container reorder (boundary-checked above) — see moveCurrentBlockUp.
      this.move(group.start + offset, neighbourStart + offset, false, blocksStore, false, true);
    });

    this.finishMove(group.anchor, selectedBlocks, 'a11y.movedDown');
  }

  /**
   * Shared post-move bookkeeping: re-point the current index at the moved
   * anchor, restore the user's interaction mode (block selection survives so
   * the move can be repeated; otherwise the caret returns to the block), and
   * announce the result.
   * @param anchor - the group's anchor block (first block in document order)
   * @param selectedBlocks - block-level selection that drove the move, if any
   * @param messageKey - i18n key for the success announcement
   */
  private finishMove(anchor: Block, selectedBlocks: Block[] | undefined, messageKey: string): void {
    this.ctx.currentBlockIndexValue = this.repository.getBlockIndex(anchor);

    // A block-level selection must persist after the move so the user can keep
    // pressing the shortcut. Re-seating the caret (setToBlock) tears the block
    // selection down into a text caret, so skip it for selection moves and let
    // BlockManager re-apply the selection; only caret moves refocus.
    if (selectedBlocks === undefined || selectedBlocks.length === 0) {
      this.refocusCurrentBlock();
    }

    const message = this.dependencies.I18n.t(messageKey, {
      position: this.ctx.currentBlockIndexValue + 1, // 1-indexed for the user
      total: this.repository.length,
    });

    announce(message, { politeness: 'assertive' });
  }

  /**
   * Refocuses the current block at the end position
   * Used after block movement to allow consecutive moves
   */
  private refocusCurrentBlock(): void {
    const block = this.ctx.currentBlock;

    if (block !== undefined) {
      this.dependencies.Caret.setToBlock(block, this.dependencies.Caret.positions.END);
    }
  }
}
