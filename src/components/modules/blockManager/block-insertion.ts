/**
 * @class BlockInsertion
 * @classdesc Block creation operations: insert, split and paste.
 * @module BlockInsertion
 */
import type { BlockToolData, PasteEvent } from '../../../../types';
import { BlockAddedMutationType } from '../../../../types/events/block/BlockAdded';
import { BlockRemovedMutationType } from '../../../../types/events/block/BlockRemoved';
import type { Block } from '../../block';
import { BlockToolAPI } from '../../block';
import { Dom as $ } from '../../dom';
import { generateBlockId } from '../../utils';
import { ToolNotFoundError } from '../../errors/tool-not-found';
import { isInsideTableCell, isRestrictedInTableCell } from '../../../tools/table/table-restrictions';
import { resolveChildTool } from '../../utils/child-tools';
import { subtreeEndIndex } from '../../utils/blocks-tree';
import { SELF_PLACING_PARENTS } from '../../../tools/nested-blocks';
import { findOwn } from '../../utils/own-element';
import { canAdoptChild, releasesChildrenOnTurnInto } from '../../utils/turn-into-children';
import { flatIndexForPlacement, type TreePlacement } from '../../utils/tree-order';
import { lastChildBefore } from '../api/block-placement';
import type { BlockFactory } from './factory';
import { hideUnderCollapsedParent, isSelfPlacedParent } from './new-block-placement';
import type { BlockHierarchy } from './hierarchy';
import type { BlockRepository } from './repository';
import type { BlockDidMutated, BlockOperationsDependencies, OperationsContext } from './operations-context';
import type { InsertBlockOptions, InsertInsideParentOptions, BlocksStore } from './types';
import type { BlockYjsSync } from './yjs-sync';

/**
 * Handles block creation: plain inserts, default-block inserts, child inserts,
 * splits and paste. Reads/writes shared state via the OperationsContext.
 */
export class BlockInsertion {
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

  private readonly getBlock = (id: string): Block | undefined => this.repository.getBlockById(id);

  /**
   * Re-home each child onto a new parent via `setBlockParent` so DOM reparenting
   * and collapsed-state propagation run atomically per child. Mirrors
   * BlockMutation.reparentChildren — used by the insert-replace path to keep a
   * replaced container's children instead of orphaning them.
   * @param childIds - ids of the children to reparent
   * @param newParentId - the block to reparent them onto
   */
  private reparentChildrenTo(childIds: string[], newParentId: string | null): void {
    for (const childId of childIds) {
      const childBlock = this.repository.getBlockById(childId);

      if (childBlock !== undefined) {
        this.hierarchy.setBlockParent(childBlock, newParentId);
      }
    }
  }

  /**
   * Writes each block's in-memory parent and position to the shared document.
   * @param childIds - ids of the blocks to write
   */
  private writeChildPlacements(childIds: string[]): void {
    for (const childId of childIds) {
      const childBlock = this.repository.getBlockById(childId);

      if (childBlock !== undefined) {
        this.ctx.parentWriter(childBlock, childBlock.parentId);
      }
    }
  }

  /**
   * Insert new block
   * @param options - Insert options
   * @param blocksStore - The blocks store to modify
   * @returns The inserted block
   */
  public insert(options: InsertBlockOptions = {}, blocksStore: BlocksStore): Block {
    if (options.placement !== undefined) {
      return this.insertAtPlacement(options, options.placement, blocksStore);
    }

    const {
      id = undefined,
      tool,
      data,
      index,
      needToFocus = true,
      replace = false,
      tunes,
      skipYjsSync = false,
      appendToWorkingArea = false,
      forceTopLevel = false,
      origin = 'api',
      inferParent = false,
      eventParentId,
    } = options;

    const prevIndex = this.ctx.rawCurrentBlockIndex;
    const current = this.ctx.currentBlock;
    // "After the current block" is after its whole run when it is a table or
    // database: current + 1 is its first cell's slot.
    const afterCurrentRun = index === undefined && !replace && current !== undefined && this.isOutermostSelfPlacing(current)
      ? current
      : undefined;
    const requestedIndex = index
      ?? (afterCurrentRun !== undefined ? this.subtreeEnd(afterCurrentRun) : prevIndex + (replace ? 0 : 1));
    const slot = inferParent && !replace && !forceTopLevel && !appendToWorkingArea
      ? this.inferredSlot(requestedIndex)
      : undefined;
    const targetIndex = slot?.index ?? requestedIndex;
    const impliedParent = slot?.parent;
    // The block follows a table/database, so it must not join that container's last cell.
    const exited = afterCurrentRun ?? slot?.exited;

    /**
     * If we're replacing a block, stop watching for mutations immediately to prevent
     * spurious block-changed events from DOM manipulations (like focus restoration)
     * that may occur before the block is fully replaced.
     */
    if (replace) {
      this.repository.getBlockByIndex(targetIndex)?.unwatchBlockMutations();
    }

    const resolvedToolName = (() => {
      const name = tool ?? this.dependencies.config.defaultBlock;

      if (name === undefined) {
        throw new Error('Could not insert Block. Tool name is not specified.');
      }

      // Demote restricted tools to paragraph when inserting inside a table cell.
      // For replace: check the block being replaced (new block takes its DOM position).
      // For insert: check the predecessor block (new block is placed after it in the DOM).
      // Using the block AT targetIndex for non-replace inserts is wrong because that
      // block may be a child paragraph inside a table cell that gets displaced, while
      // the new block actually lands at the top level.
      //
      // The predecessor lookup MUST be bounds-checked: `getBlockByIndex(-1)` is the
      // repository's legacy "give me the LAST block" shorthand, not "no block". An
      // insert at index 0 has no predecessor, so an unguarded `targetIndex - 1` asked
      // about the last block in the document — and when the document ended with a
      // table, that block is a cell child, so every restricted tool (header, table,
      // column_list) inserted at the TOP of the document was silently demoted to a
      // paragraph. That is how a table side-dropped beside a top block produced a
      // paragraph instead of a column_list.
      const predecessorBlock = targetIndex > 0
        ? this.repository.getBlockByIndex(targetIndex - 1)
        : undefined;

      const neighborBlock = replace
        ? this.repository.getBlockByIndex(targetIndex)
        : (predecessorBlock ?? this.repository.getBlockByIndex(targetIndex));

      if (exited === undefined && neighborBlock !== undefined && isInsideTableCell(neighborBlock) && isRestrictedInTableCell(name)) {
        return this.dependencies.config.defaultBlock ?? 'paragraph';
      }

      // A root result falls through: callers such as useBlocks' insert at a
      // container's end nest the block right after, and still need the demotion.
      if (impliedParent !== undefined && impliedParent !== null) {
        return resolveChildTool(impliedParent, name, this.dependencies.config.defaultBlock ?? 'paragraph');
      }

      /**
       * Generic per-container child restrictions (`static childTools`) — the
       * table rule above is the hard-wired special case of this.
       *
       * The container is derived from the SAME neighbour: the new block joins
       * its parent (for a replace, it takes the replaced block's place; for an
       * insert, it lands beside the predecessor and inherits its container).
       * `forceTopLevel` is the explicit "this belongs at root" signal, so it
       * opts out — that is what keeps Enter-at-the-end-of-a-top-level-block from
       * being read as "append to whatever container ends above me".
       *
       * A disallowed tool is demoted, never refused: this path runs for the
       * Enter key and the toolbox, which must always produce a block.
       */
      if (!forceTopLevel && neighborBlock !== undefined && neighborBlock.parentId !== null) {
        return resolveChildTool(
          this.repository.getBlockById(neighborBlock.parentId),
          name,
          this.dependencies.config.defaultBlock ?? 'paragraph'
        );
      }

      return name;
    })();

    // Bind events immediately for user-created blocks so mutations are tracked right away
    const block = this.factory.composeBlock({
      tool: resolvedToolName,
      bindEventsImmediately: true,
      origin,
      ...(id !== undefined && { id }),
      ...(data !== undefined && { data }),
      ...(tunes !== undefined && { tunes }),
    });

    /**
     * In case of block replacing (Converting OR from Toolbox or Shortcut on empty block OR on-paste to empty block)
     * we need to dispatch the 'block-removing' event for the replacing block
     */
    const blockToReplace = replace ? this.repository.getBlockByIndex(targetIndex) : undefined;

    if (replace && blockToReplace === undefined) {
      throw new Error(`Could not replace Block at index ${targetIndex}. Block not found.`);
    }

    /**
     * Capture the replaced block's parent link BEFORE it leaves the
     * repository so the new block inherits the same container membership.
     * Without this, a replace-insert inside a callout/toggle/table-cell
     * child drops parentId and the Saver's derive-from-live-parentId
     * fallback then emits the new block as a root sibling — the "callout
     * paste ejection" regression family. Defense-in-depth counterpart to
     * the paste() method's inheritance handling.
     */
    const replacedParentId = blockToReplace?.parentId ?? null;
    const replacedBlockId = blockToReplace?.id;
    /**
     * Capture the replaced block's children BEFORE it leaves the repository so
     * they can be re-homed onto the new block. A replaced CONTAINER (toggle,
     * callout, header/paragraph with nested blocks) would otherwise leave its
     * children with a parentId pointing at the now-removed block — orphaned and
     * unreachable via getChildren. Mirrors block-mutation.replace() (the convert
     * path), which already re-parents children; this is the missing counterpart
     * on the generic insert-replace path (toolbox/shortcut turn-into and
     * useBlocks.insert({ replace })).
     */
    const replacedContentIds = blockToReplace !== undefined ? [...blockToReplace.contentIds] : [];

    if (replace && blockToReplace !== undefined) {
      this.blockDidMutated(BlockRemovedMutationType, blockToReplace, {
        index: targetIndex,
      });
    }

    // A root block after a nested one would otherwise be mounted after it, in its slot.
    const mountAtRoot = impliedParent === null && this.repository.getBlockByIndex(targetIndex - 1)?.parentId !== null;

    // The swap below takes the old holder out of the document with the child
    // holders inside it, and setBlockParent never re-mounts a holder whose new
    // home is the root. Lift the children to the old block's level first, while
    // the old block still exists; they are re-nested after the swap.
    const rehomesChildren = blockToReplace !== undefined
      && replacedContentIds.length > 0
      && !SELF_PLACING_PARENTS.has(blockToReplace.name);
    const releasesChildren = rehomesChildren && releasesChildrenOnTurnInto(blockToReplace, resolvedToolName, data);

    // Last child first: each one leaving goes to the end of the old block's run.
    if (rehomesChildren) {
      this.reparentChildrenTo([...replacedContentIds].reverse(), replacedParentId);
    }

    blocksStore.insert(targetIndex, block, replace, appendToWorkingArea, forceTopLevel || mountAtRoot || exited !== undefined);

    /**
     * Transfer the parent link to the new block BEFORE Yjs sync so
     * `addBlock` writes the final parentId in a single shot. Routing
     * through `transferParentLinkToNewBlock` swaps the old id for the new
     * one in the parent's contentIds while preserving its original
     * position, matching the semantics used by `replace()`.
     */
    if (replace && replacedParentId !== null && replacedBlockId !== undefined) {
      this.ctx.transferParentLinkToNewBlock(replacedBlockId, block, replacedParentId);
    }

    /**
     * Nest the replaced block's children under the new block, after any
     * children it made for itself. A child it may not hold stays where the
     * release above put it: right after it, at its level.
     */
    if (rehomesChildren && !releasesChildren) {
      this.reparentChildrenTo(
        replacedContentIds.filter(childId => {
          const child = this.repository.getBlockById(childId);

          return child !== undefined && canAdoptChild(block, child);
        }),
        block.id
      );
    }

    /**
     * Non-replace insert positioned directly after a block that lives inside a
     * `column` must inherit that column as its parent. The block-settings
     * "Duplicate" action inserts the copy at the source block's index + 1 with
     * no follow-up reparent; without this, the copy keeps a null parentId and
     * the Saver emits it as a root sibling — orphaned out of the column even
     * though the store already mounted its holder inside the column DOM.
     *
     * Scoped to a column predecessor (not every parented predecessor) so that
     * internal callers which seed/reparent explicitly — split, paste,
     * insertInsideParent, column seeding (whose predecessor is the column_list,
     * not a column) — are untouched and never see a transient wrong-parent
     * state. `forceTopLevel` callers opt out entirely.
     */
    if (impliedParent !== undefined && impliedParent !== null) {
      this.hierarchy.setBlockParent(block, impliedParent.id);
    }

    if (!replace && !forceTopLevel && block.parentId === null && impliedParent === undefined) {
      const predecessor = exited ?? this.repository.getBlockByIndex(targetIndex - 1);
      const predecessorParent = predecessor?.parentId !== null && predecessor?.parentId !== undefined
        ? this.repository.getBlockById(predecessor.parentId)
        : undefined;

      if (predecessorParent !== undefined && predecessorParent.name === 'column') {
        this.hierarchy.setBlockParent(block, predecessorParent.id);
      }
    }

    /**
     * Point at the new block BEFORE firing the mutation event so listeners
     * (e.g. TableCellBlocks.handleBlockMutation) see it as current. The raw
     * setter defers stopCapturing until after Yjs sync.
     */
    if (needToFocus || (blockToReplace !== undefined && blockToReplace === current)) {
      this.ctx.setCurrentBlockRaw(block);
    }

    /**
     * Force call of didMutated event on Block insertion
     */
    this.blockDidMutated(BlockAddedMutationType, block, {
      index: targetIndex,
      // Placement only when it is final here: an inferring insert has set it,
      // other callers name it, the rest (paste, replay) set it later.
      ...(eventParentId !== undefined && { parentId: eventParentId }),
      ...(eventParentId === undefined && inferParent && { parentId: block.parentId }),
    });

    /**
     * Sync to Yjs data layer (unless caller is handling sync separately,
     * or we're inside an atomic operation like paste where all Yjs sync
     * is deferred until the operation completes).
     *
     * When isSyncingFromYjs is true, still add blocks that don't yet exist
     * in Yjs — e.g., table cell paragraphs created during rendered() lifecycle
     * hooks need to be tracked for undo/redo even though the parent block's
     * insertion is already being synced.
     */
    if (!skipYjsSync && (!this.yjsSync.isSyncingFromYjs || this.dependencies.YjsManager.getBlockById(block.id) === undefined)) {
      /**
       * A replace drops the old block from memory AND the DOM (`Blocks.insert`
       * splices + destroys it), so the doc must drop it in the same breath.
       * Otherwise its map entry survives as a ghost `save()` cannot see but a
       * syncing peer or a reload from the persisted doc resurrects — a stray
       * empty paragraph at root, since the toolbox detaches the slot to root
       * before replacing it.
       *
       * ONE transaction with the add, so undo is a single step that brings the
       * slot back. The toolbox's `transact` wrapper cannot supply that: it only
       * suppresses `stopCapturing`, and a root-level replace is not wrapped.
       *
       * The removal rides the add's gate on purpose — it is the same write. An
       * extra `isSyncingFromYjs` check would silence it for the whole
       * initial-render RAF window (where a GIF image block replaces itself with
       * a video block), and no Yjs replay path inserts with `replace`.
       *
       * Same id means no removal: `convertToParagraph` (table-cell demotion)
       * and `BlockMutation.replace` reuse the id, and a remove+add of one id
       * reads as a no-op move to `BlockObserver`.
       */
      const replacedIdToRemove = replace
        && replacedBlockId !== undefined
        && replacedBlockId !== block.id
        ? replacedBlockId
        : undefined;

      /**
       * When the replaced block is a scaffold this same gesture just built (the
       * plus button's empty paragraph), the removal joins the entry that created
       * it so the whole gesture is one undo press.
       */
      if (replacedIdToRemove !== undefined) {
        this.dependencies.YjsManager.continueUndoEntryThatCreated(replacedIdToRemove);
      }

      this.dependencies.YjsManager.transact(() => {
        if (replacedIdToRemove !== undefined) {
          this.dependencies.YjsManager.removeBlock(replacedIdToRemove);
        }

        this.dependencies.YjsManager.addBlock({
          id: block.id,
          type: block.name,
          data: block.preservedData,
          parent: block.parentId ?? undefined,
        }, targetIndex);

        // The doc still points the children at the removed id.
        if (rehomesChildren && replacedIdToRemove !== undefined) {
          this.writeChildPlacements(replacedContentIds);
        }

        this.writeRenderedChildPlacements(block, replacedContentIds);
      });
    }

    /**
     * Trigger stopCapturing for the index change now that Yjs sync is done.
     * This preserves undo group boundaries at the original timing.
     */
    this.ctx.endUndoStepIfCurrentIndexChanged(prevIndex);

    this.ctx.assertHierarchyInvariantInDev('insert');

    return block;
  }

  /**
   * {@link insert} for a caller that names the block's place in the tree:
   * the model, the holder, the event and the shared doc all take `placement`
   * as given, nothing is inferred from flat neighbours.
   * @param options - insert options; `index` and `replace` are refused
   * @param placement - parent + previous sibling
   * @param blocksStore - The blocks store to modify
   */
  private insertAtPlacement(options: InsertBlockOptions, placement: TreePlacement, blocksStore: BlocksStore): Block {
    const { id, tool, data, tunes, needToFocus = true, skipYjsSync = false, origin = 'api' } = options;

    if (options.index !== undefined || options.replace === true) {
      throw new Error('Could not insert Block. A placement cannot be combined with an index or a replace.');
    }

    const name = tool ?? this.dependencies.config.defaultBlock;

    if (name === undefined) {
      throw new Error('Could not insert Block. Tool name is not specified.');
    }

    const prevIndex = this.ctx.rawCurrentBlockIndex;
    // Throws on an unknown parent or sibling, before anything changes.
    const index = flatIndexForPlacement({ blocks: this.repository.blocks, getById: this.getBlock }, placement);
    const parent = placement.parentId === null ? undefined : this.repository.getBlockById(placement.parentId);
    const defaultTool = this.dependencies.config.defaultBlock ?? 'paragraph';
    const resolvedToolName = resolveChildTool(parent, name, defaultTool);

    const block = this.factory.composeBlock({
      tool: resolvedToolName,
      bindEventsImmediately: true,
      origin,
      ...(id !== undefined && { id }),
      ...(data !== undefined && { data }),
      ...(tunes !== undefined && { tunes }),
    });

    // Appended at the root end, then mounted in its home slot by placeBlock.
    blocksStore.insert(index, block, false, true);
    this.hierarchy.placeBlock(block, placement);
    hideUnderCollapsedParent(block, this.getBlock);

    if (needToFocus) {
      this.ctx.setCurrentBlockRaw(block);
    }

    this.blockDidMutated(BlockAddedMutationType, block, {
      index: this.repository.getBlockIndex(block),
      parentId: placement.parentId,
    });

    // Same gate as insert(): a Yjs replay still adds a block the doc lacks.
    if (!skipYjsSync && (!this.yjsSync.isSyncingFromYjs || this.dependencies.YjsManager.getBlockById(block.id) === undefined)) {
      this.dependencies.YjsManager.transact(() => {
        this.dependencies.YjsManager.addBlockAt({
          id: block.id,
          type: block.name,
          data: block.preservedData,
        }, placement);
        this.writeRenderedChildPlacements(block);
      });
    }

    this.ctx.endUndoStepIfCurrentIndexChanged(prevIndex);
    this.ctx.assertHierarchyInvariantInDev('insert');

    return block;
  }

  /**
   * Writes the doc placement of each child a tool's rendered() added before
   * `block` existed in the doc (callout's first line): those got no order slot.
   * @param block - the new block
   * @param skipIds - children the doc already places
   */
  private writeRenderedChildPlacements(block: Block, skipIds: string[] = []): void {
    block.contentIds.forEach((childId, position) => {
      if (!skipIds.includes(childId)) {
        this.dependencies.YjsManager.applyBlockPlacement(childId, {
          parentId: block.id,
          afterId: position > 0 ? block.contentIds[position - 1] : null,
        });
      }
    });
  }

  /**
   * Insert new default block at passed index
   * @param index - Index where Block should be inserted
   * @param needToFocus - If true, updates current Block index
   * @param skipYjsSync - If true, skip syncing to Yjs
   * @param blocksStore - The blocks store to modify
   * @param forceTopLevel - If true, place new block at workingArea root level regardless of
   *   whether the predecessor in the flat array is nested. Used by Enter-at-start and
   *   Enter-at-end handlers when the current block is top-level.
   * @returns Inserted Block
   */
  public insertDefaultBlockAtIndex(
    index: number,
    needToFocus = false,
    skipYjsSync = false,
    blocksStore: BlocksStore,
    forceTopLevel = false
  ): Block {
    const defaultTool = this.dependencies.config.defaultBlock;

    if (defaultTool === undefined) {
      throw new Error('Could not insert default Block. Default block tool is not defined in the configuration.');
    }

    return this.ctx.insert({
      tool: defaultTool,
      index,
      needToFocus,
      skipYjsSync,
      forceTopLevel,
      // Every caller is a direct editing gesture: Enter, the plus button, a
      // markdown shortcut, a click in the editor's bottom zone.
      origin: 'user',
    }, blocksStore);
  }

  /**
   * Always inserts at the end of the DOCUMENT.
   *
   * `forceTopLevel` is mandatory here: nested-block tools keep their children at
   * the TAIL of the flat store, so the raw predecessor of the append slot is a
   * column child / table cell paragraph. Without it, insert()'s
   * column-inheritance rescue adopts the appended block INTO the last column,
   * and the store places its holder inside that container — i.e. "add a block
   * below the document" would write inside the columns instead.
   * @param blocksStore - The blocks store to modify
   * @returns Inserted Block
   */
  public insertAtEnd(blocksStore: BlocksStore): Block {
    this.ctx.currentBlockIndexValue = this.repository.length - 1;

    return this.ctx.insert({
      appendToWorkingArea: true,
      forceTopLevel: true,
      // Only reached from a click in the editor's bottom zone / the toolbar's
      // "add block below the document" affordance.
      origin: 'user',
    }, blocksStore);
  }

  /**
   * The flat index for a new sibling of `block` asked for at `index`.
   * The doc places a sibling after `block`'s whole subtree, so an index
   * between `block` and its own children moves past them. Otherwise the
   * editor order and save() differ from the doc until a redo or reload.
   */
  private siblingIndexAfter(block: Block, index: number): number {
    const reader = {
      getBlocksCount: (): number => this.repository.length,
      getBlockByIndex: (i: number): Block | undefined => this.repository.getBlockByIndex(i),
    };
    const start = this.repository.getBlockIndex(block);
    const end = subtreeEndIndex(reader, start);

    return index > start && index <= end ? end + 1 : index;
  }

  /**
   * Split current Block
   * 1. Extract content from Caret position to the Block`s end
   * 2. Insert a new Block below current one with extracted content
   *
   * Uses atomic Yjs transaction to ensure split is a single undo entry.
   * @param blocksStore - The blocks store to modify
   * @returns Split block
   */
  public split(blocksStore: BlocksStore): Block {
    const currentBlock = this.ctx.currentBlock;

    if (currentBlock === undefined) {
      throw new Error('Cannot split: no current block');
    }

    // Generate new block ID upfront for the transaction
    const newBlockId = generateBlockId();
    const placement = this.splitTailPlacement(currentBlock);
    const insertIndex = this.siblingIndexAfter(currentBlock, this.ctx.rawCurrentBlockIndex + 1);

    // The new block must inherit ALL of the source block's tool data (e.g. a
    // header's `level`), not just its text. Creating it with only `{ text }`
    // leaves other keys missing in Yjs; the new block then renders with default
    // data and a deferred didMutated→syncBlockDataToYjs writes the missing keys
    // in a SEPARATE transaction. That extra, no-op undo entry pollutes the undo
    // stack and desyncs caret restoration — the heading undo-caret bug. A
    // paragraph has no extra keys, so its split never hit this. Reading the data
    // before the transaction keeps the snapshot free of the truncation write.
    const sourceData = this.dependencies.YjsManager.getBlockDataObject(currentBlock.id) ?? {};

    return this.yjsSync.withAtomicOperation(() => {
      // Extract fragment (mutates DOM - removes text after caret)
      const extractedFragment = this.dependencies.Caret.extractFragmentFromCaretPosition();
      const wrapper = document.createElement('div');

      wrapper.appendChild(extractedFragment as DocumentFragment);

      const extractedText = $.isEmpty(wrapper) ? '' : wrapper.innerHTML;

      // Get truncated text (what remains in original block after extraction).
      // Exclude mutation-free decorations (e.g. a list item's bullet/number
      // marker, which should be non-editable): if one is ever flipped
      // contenteditable="true", a bare [contenteditable="true"] selector would
      // read/overwrite the marker instead of the real content — duplicating the
      // item text into the bullet and rendering a large ghost. See
      // updateBlocksContentEditable for the source-side guard.
      const truncatedText = currentBlock.holder
        .querySelector('[contenteditable="true"]:not([data-blok-mutation-free])')?.innerHTML ?? '';

      // New block carries the source block's full data with only `text` replaced
      // by the extracted content, so it is complete in a single transaction.
      const newBlockData = { ...sourceData, text: extractedText };

      // Atomic Yjs transaction: update original + add new (single undo entry)
      this.dependencies.YjsManager.transact(() => {
        this.dependencies.YjsManager.updateBlockData(currentBlock.id, 'text', truncatedText);
        this.addSplitTailToYjs({ id: newBlockId, type: currentBlock.name, data: newBlockData }, currentBlock, placement, insertIndex);
      });

      // Insert DOM block (skip Yjs sync - already done above)
      const newBlock = this.ctx.insert({
        id: newBlockId,
        tool: currentBlock.name,
        data: newBlockData,
        needToFocus: false,
        skipYjsSync: true,
        // Only reachable from the Enter key handler.
        origin: 'user',
        ...(placement !== undefined ? { placement } : { index: insertIndex }),
      }, blocksStore);

      // Update the current block AFTER insert (and handleBlockMutation) completes.
      // This allows the table cell claiming logic to see the original block as
      // "current" during the mutation event, so it correctly claims the new block.
      this.ctx.setCurrentBlockRaw(newBlock);

      // Inherit parentId from the split block so nested blocks stay nested
      if (placement === undefined && currentBlock.parentId !== null) {
        this.hierarchy.setBlockParent(newBlock, currentBlock.parentId);
      }

      return newBlock;
    });
  }

  /**
   * Splits a block by updating the current block's data and inserting a new block.
   * Both operations are grouped into a single undo entry.
   * Used by tools that need to specify exact data for both blocks (e.g., list items).
   *
   * @param currentBlockId - id of the block to update
   * @param currentBlockData - new data for the current block (typically truncated content)
   * @param newBlockType - tool type for the new block
   * @param newBlockData - data for the new block (typically extracted content)
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
    const currentBlock = this.repository.getBlockById(currentBlockId);

    if (currentBlock === undefined) {
      throw new Error(`Block with id "${currentBlockId}" not found`);
    }

    // Validate the NEW block's tool BEFORE any mutation runs. If the tool is
    // unregistered, throw here so the document is left completely unchanged —
    // otherwise the Yjs truncation + addBlock below would commit a partial,
    // corrupt mutation before the tool error surfaces from the DOM insert.
    if (this.factory.getTool(newBlockType) === undefined) {
      throw new ToolNotFoundError(newBlockType, `Could not split Block. Tool «${newBlockType}» not found.`);
    }

    const newBlockId = generateBlockId();
    // Every caller passes the slot right after the block; any other index
    // keeps the index path.
    const placement = insertIndex === this.repository.getBlockIndex(currentBlock) + 1
      ? this.splitTailPlacement(currentBlock)
      : undefined;
    const index = this.siblingIndexAfter(currentBlock, insertIndex);

    return this.yjsSync.withAtomicOperation(() => {
      // Atomic Yjs transaction: update original + add new (single undo entry)
      this.dependencies.YjsManager.transact(() => {
        for (const [key, value] of Object.entries(currentBlockData)) {
          this.dependencies.YjsManager.updateBlockData(currentBlockId, key, value);
        }
        this.addSplitTailToYjs({ id: newBlockId, type: newBlockType, data: newBlockData }, currentBlock, placement, index);
      });

      // Update DOM for the current block (auto-sync is suppressed by yjsSyncCount).
      // Scope past mutation-free decorations (e.g. a list marker) so the truncated
      // text is written into the real content element, never a bullet/number span.
      const currentContentEl = currentBlock.holder.querySelector('[contenteditable="true"]:not([data-blok-mutation-free])');

      if (currentContentEl !== null && typeof currentBlockData.text === 'string') {
        currentContentEl.innerHTML = currentBlockData.text;
      }

      // Insert DOM block (skip Yjs sync - already done above)
      const newBlock = this.ctx.insert({
        id: newBlockId,
        tool: newBlockType,
        data: newBlockData,
        needToFocus: false,
        skipYjsSync: true,
        ...(placement !== undefined ? { placement } : {
          index,
          // A root block's new sibling can follow its children: mount it at root, not in their slot.
          forceTopLevel: currentBlock.parentId === null,
          eventParentId: currentBlock.parentId,
        }),
      }, blocksStore);

      // Update the current block AFTER insert (and handleBlockMutation) completes.
      // This allows the table cell claiming logic to see the original block as
      // "current" during the mutation event, so it correctly claims the new block.
      this.ctx.setCurrentBlockRaw(newBlock);

      // Inherit parentId from the split block so nested blocks stay nested
      if (placement === undefined && currentBlock.parentId !== null) {
        this.hierarchy.setBlockParent(newBlock, currentBlock.parentId);
      }

      this.ctx.assertHierarchyInvariantInDev('splitBlockWithData');

      return newBlock;
    });
  }

  /**
   * Where a split's tail goes: right after the split block's whole subtree,
   * as its next sibling. Undefined under a table or database, whose cells
   * claim the tail through the index path.
   * @param current - the block being split
   */
  private splitTailPlacement(current: Block): TreePlacement | undefined {
    const parent = current.parentId === null ? undefined : this.repository.getBlockById(current.parentId);

    if (parent !== undefined && isSelfPlacedParent(parent, this.getBlock)) {
      return undefined;
    }

    return { parentId: parent?.id ?? null, afterId: current.id };
  }

  /**
   * Adds a split's tail to Yjs: at `placement`, or at the flat index when
   * there is none.
   * @param blockData - the tail's id, type and data
   * @param current - the block being split
   * @param placement - from {@link splitTailPlacement}
   * @param insertIndex - the flat index for the index path
   */
  private addSplitTailToYjs(
    blockData: { id: string; type: string; data: BlockToolData },
    current: Block,
    placement: TreePlacement | undefined,
    insertIndex: number
  ): void {
    if (placement !== undefined) {
      this.dependencies.YjsManager.addBlockAt(blockData, placement);

      return;
    }

    this.dependencies.YjsManager.addBlock({ ...blockData, parent: current.parentId ?? undefined }, insertIndex);
  }

  /**
   * The parent a new block inserted at flat `index` must take so the flat
   * array stays depth-first. Undefined means "keep the old placement": no
   * predecessor, a table/database on the way, or no container that may hold it.
   *
   * - The block right after the slot is the predecessor's child: the new block
   *   must be a child of the predecessor too.
   * - Otherwise every level from the predecessor's parent up to the next
   *   block's parent (root at the document end) is valid; the SHALLOWEST one
   *   wins. That is where the block was already drawn when the next block is
   *   shallower, and at the document end it is what a caller appending after
   *   a container means (header-toggle-keyboard's collapsed-heading Enter
   *   relies on it).
   * - A column predecessor keeps its column, the rule unflagged inserts use.
   * - A container that owns its children (column_list) is skipped.
   * @param index - the flat index the block is inserted at
   */
  private parentImpliedByIndex(index: number): Block | null | undefined {
    const blocks = this.repository.blocks;
    const at = Math.min(index, blocks.length);
    // Past the end of a table/database run, the block follows that container.
    const closed = this.selfPlacingClosedAt(at);
    const previous = closed ?? (at > 0 ? blocks[at - 1] : undefined);

    if (previous === undefined) {
      return undefined;
    }

    const next = blocks[at] as Block | undefined;
    const parentOf = (block: Block): Block | null =>
      block.parentId === null ? null : this.repository.getBlockById(block.parentId) ?? null;
    const previousParent = parentOf(previous);
    const nextIsChildOfPrevious = next !== undefined && next.parentId === previous.id;

    if (!nextIsChildOfPrevious && previousParent?.name === 'column') {
      return previousParent;
    }

    const collectAncestors = (cursor: Block | null, found: Block[]): Block[] =>
      cursor === null || found.includes(cursor) ? found : collectAncestors(parentOf(cursor), [...found, cursor]);
    const ancestors = collectAncestors(previousParent, []);

    if ([...(closed === undefined ? [previous] : []), ...ancestors].some(block => SELF_PLACING_PARENTS.has(block.name))) {
      return undefined;
    }

    const shallowest = next === undefined ? null : parentOf(next);
    const candidates: Array<Block | null> = nextIsChildOfPrevious
      ? [previous]
      : [...ancestors.slice(0, shallowest === null ? ancestors.length : ancestors.indexOf(shallowest) + 1), null]
        .filter(candidate => candidate !== null || shallowest === null)
        .reverse();

    return candidates.find(candidate => candidate === null || !candidate.tool.ownsChildren);
  }

  /**
   * A flat index at which a new child of `parent` keeps the array depth-first:
   * right after the parent at the earliest, right after its last descendant
   * at the latest. Anything outside that range would put the child before its
   * parent or split another block's subtree.
   * @param parent - the parent the child joins
   * @param index - the index the caller asked for
   */
  private clampIntoSubtree(parent: Block, index: number): number {
    return Math.min(Math.max(index, this.repository.blocks.indexOf(parent) + 1), this.subtreeEnd(parent));
  }

  /**
   * The flat index right after the last descendant of `parent`.
   * @param parent - the subtree root
   */
  private subtreeEnd(parent: Block): number {
    const blocks = this.repository.blocks;
    const parentIndex = blocks.indexOf(parent);
    const isUnderParent = (cursor: string | null, seen: Set<string>): boolean => {
      if (cursor === null || seen.has(cursor)) {
        return false;
      }

      return cursor === parent.id || isUnderParent(this.repository.getBlockById(cursor)?.parentId ?? null, seen.add(cursor));
    };
    const firstOutside = blocks.slice(parentIndex + 1)
      .findIndex(candidate => !isUnderParent(candidate.parentId, new Set()));

    return firstOutside === -1 ? blocks.length : parentIndex + 1 + firstOutside;
  }

  /**
   * Where an inferred-parent insert lands, and under which parent. The slot
   * right after a COLLAPSED container is its first-child slot, where the new
   * block would be hidden the moment it is created; it goes after the
   * container's subtree instead, which is also where the holder used to be
   * drawn (the toolbox inserts at the current index + 1 from a toggle title).
   * @param index - the flat index the caller asked for
   */
  private inferredSlot(index: number): { index: number; parent: Block | null | undefined; exited: Block | undefined } {
    const blocks = this.repository.blocks;
    const at = Math.min(index, blocks.length);
    const previous = at > 0 ? blocks[at - 1] : undefined;
    const opensChildren = previous !== undefined && (blocks[at] as Block | undefined)?.parentId === previous.id;
    const skipsChildren = opensChildren && (
      findOwn(previous.holder, '[data-blok-toggle-open="false"]') !== null || this.isOutermostSelfPlacing(previous)
    );
    const slotIndex = skipsChildren ? this.subtreeEnd(previous) : index;

    return {
      index: slotIndex,
      parent: this.parentImpliedByIndex(slotIndex),
      exited: this.selfPlacingClosedAt(Math.min(slotIndex, blocks.length)),
    };
  }

  /**
   * Whether `block` is a table/database with no table/database above it. Only
   * then is "after its run" a place outside every self-placing container.
   * @param block - the block to test
   */
  private isOutermostSelfPlacing(block: Block): boolean {
    const hasSelfPlacingAncestor = (cursor: string | null, seen: Set<string>): boolean => {
      const ancestor = cursor === null || seen.has(cursor) ? undefined : this.repository.getBlockById(cursor);

      return ancestor !== undefined
        && (SELF_PLACING_PARENTS.has(ancestor.name) || hasSelfPlacingAncestor(ancestor.parentId, seen.add(cursor ?? '')));
    };

    return SELF_PLACING_PARENTS.has(block.name) && !hasSelfPlacingAncestor(block.parentId, new Set());
  }

  /**
   * The outermost table/database whose run ends at flat index `at` and holds
   * the block before it. A block inserted at `at` follows that container: its
   * cells place their children themselves, so the flat predecessor (the last
   * cell's last block) says nothing about where the new block belongs.
   * @param at - the flat index the block is inserted at
   */
  private selfPlacingClosedAt(at: number): Block | undefined {
    const blocks = this.repository.blocks;
    const previous = at > 0 ? blocks[at - 1] : undefined;
    const chain = (cursor: Block | undefined, found: Block[]): Block[] =>
      cursor === undefined || found.includes(cursor)
        ? found
        : chain(cursor.parentId === null ? undefined : this.repository.getBlockById(cursor.parentId), [...found, cursor]);

    return chain(previous, []).find(block => this.isOutermostSelfPlacing(block) && this.subtreeEnd(block) === at);
  }

  /**
   * Insert a new block as a child of the given parent, atomically.
   *
   * Wraps the Yjs addBlock call and DOM insert inside a single
   * `withAtomicOperation` + `YjsManager.transact` so that the block
   * creation and parent assignment form ONE undo entry.
   *
   * Use this instead of calling `insert()` followed by `setBlockParent()`
   * from a tool keyboard handler, which would create two separate Yjs
   * undo steps.
   *
   * @param parentId - id of the parent block
   * @param requestedIndex - flat block index where the new block should appear;
   *   clamped into the parent's subtree (see {@link clampIntoSubtree})
   * @param blocksStore - The blocks store to modify
   * @param childData - optional data for the new child block
   * @param toolName - optional tool to create; defaults to `config.defaultBlock`
   * @returns the newly created child block
   */
  public insertInsideParent(
    parentId: string,
    requestedIndex: number,
    blocksStore: BlocksStore,
    childData?: BlockToolData,
    toolName?: string,
    options: InsertInsideParentOptions = {}
  ): Block {
    const parentBlock = this.repository.getBlockById(parentId);

    if (parentBlock === undefined) {
      throw new Error(`Parent block with id "${parentId}" not found`);
    }

    const { id: requestedId, tunes, focus = false } = options;
    const insertIndex = this.clampIntoSubtree(parentBlock, requestedIndex);
    const newBlockId = requestedId ?? generateBlockId();
    const defaultBlockTool = this.dependencies.config.defaultBlock ?? 'paragraph';
    // Tables and databases place their children in their own cells/views.
    const selfPlaced = isSelfPlacedParent(parentBlock, this.getBlock);
    /**
     * Resolve the tool name ONCE, BEFORE the Yjs write, so the CRDT and the
     * DOM get the same type. On the index path `ctx.insert()` also demotes by
     * the block the new one lands after, so that neighbour is checked too.
     */
    const requestedTool = toolName ?? defaultBlockTool;
    const slotNeighbour = selfPlaced ? this.repository.getBlockByIndex(insertIndex > 0 ? insertIndex - 1 : 0) : undefined;
    const landsInsideTableCell = isInsideTableCell(parentBlock) || isInsideTableCell(slotNeighbour);
    /**
     * The parent is EXPLICIT here, so the generic per-container child
     * restrictions (`static childTools`) apply without any neighbour guesswork:
     * a tool the container does not permit is demoted to its first `allow`
     * entry. Layered after the table rule so a table cell keeps its own
     * (differently-scoped, ancestor-based) demotion.
     */
    const resolvedTool = landsInsideTableCell && isRestrictedInTableCell(requestedTool)
      ? defaultBlockTool
      : resolveChildTool(parentBlock, requestedTool, defaultBlockTool);
    /**
     * `{ text: '' }` is the empty-paragraph seed; handing it to a tool that has
     * no `text` field would write junk into the saved document. An explicitly
     * requested tool starts from `{}` so its own defaults / propSchema apply.
     */
    const resolvedChildData = childData ?? (toolName === undefined ? { text: '' } : {});

    // Validate the requested tool BEFORE any mutation runs, mirroring
    // splitBlockWithData: the Yjs write below happens before the DOM insert, so
    // an unregistered tool would otherwise commit a phantom CRDT block and only
    // then surface the error from composeBlock.
    if (toolName !== undefined && this.factory.getTool(resolvedTool) === undefined) {
      throw new ToolNotFoundError(resolvedTool, `Could not insert child Block. Tool «${resolvedTool}» not found.`);
    }

    // The child the new block follows: the last one before the slot. A slot
    // inside that child's subtree lands after the subtree.
    const placement: TreePlacement = {
      parentId,
      afterId: lastChildBefore({ blocks: this.repository.blocks, getBlockById: this.getBlock }, parentId, insertIndex),
    };

    // extendThroughRAF keeps isSyncingFromYjs=true through RAF, so the
    // MutationObserver writes that mounting into a toggle's children container
    // triggers stay out of Yjs (they would split the undo entry).
    return this.yjsSync.withAtomicOperation(() => {
      // Atomic Yjs transaction: add new block with parent (single undo entry)
      this.dependencies.YjsManager.transact(() => {
        const blockData = { id: newBlockId, type: resolvedTool, data: resolvedChildData };

        if (selfPlaced) {
          this.dependencies.YjsManager.addBlock({ ...blockData, parent: parentId }, insertIndex);
        } else {
          this.dependencies.YjsManager.addBlockAt(blockData, placement);
        }
      });

      // Insert DOM block (skip Yjs sync — already done above)
      const newBlock = this.ctx.insert({
        id: newBlockId,
        tool: resolvedTool,
        data: resolvedChildData,
        needToFocus: focus,
        skipYjsSync: true,
        ...(selfPlaced ? { index: insertIndex, eventParentId: parentId } : { placement }),
        ...(tunes !== undefined && { tunes }),
      }, blocksStore);

      // Update the current block AFTER insert so blockDidMutated sees original as current
      this.ctx.setCurrentBlockRaw(newBlock);

      if (selfPlaced) {
        this.hierarchy.setBlockParent(newBlock, parentId);
      }

      this.ctx.assertHierarchyInvariantInDev('insertInsideParent');

      return newBlock;
    }, { extendThroughRAF: true });
  }

  /**
   * Insert pasted content. Call onPaste callback after insert.
   * Syncs final state to Yjs as single operation to ensure single undo entry.
   * @param toolName - Name of Tool to insert
   * @param pasteEvent - Pasted data
   * @param replace - Should replace current block
   * @param blocksStore - The blocks store to modify
   * @param data - Initial tool data for the inserted block, available to the
   * tool's constructor/render BEFORE onPaste runs (creation-time hints such
   * as `noSeed` on column containers)
   */
  public async paste(
    toolName: string,
    pasteEvent: PasteEvent,
    replace = false,
    blocksStore: BlocksStore,
    data?: BlockToolData
  ): Promise<Block> {
    // Capture predecessor's parentId and id BEFORE insert. The predecessor is
    // the current block — whether we're replacing it in place or inserting
    // after it, the new block belongs to the same parent. Without this, pasting
    // into a nested empty block (e.g. a paragraph inside a callout) via the
    // replace=true path strands the new block as a root sibling once Saver
    // re-derives content[] from live parentIds.
    //
    // Title-vs-child defense: when the caret is in the CONTAINER's own title
    // input (the header of a toggle/callout) rather than inside one of its
    // children, the new block should become a CHILD of the container — its
    // parent must be the container's id, NOT the container's parentId.
    // Mirrors the `contextParentId` logic in BasePasteHandler.insertPasteData
    // and BlokDataHandler so all paste entry points agree.
    const currentBlock = this.ctx.currentBlock;
    const childContainer = currentBlock?.holder?.querySelector('[data-blok-toggle-children]') ?? null;
    const isInContainerTitle = childContainer !== null &&
      !childContainer.contains(currentBlock?.currentInput ?? null);
    const predecessorParentId = isInContainerTitle
      ? (currentBlock?.id ?? null)
      : (currentBlock?.parentId ?? null);
    const oldBlockId = replace ? currentBlock?.id : undefined;

    // Insert block without syncing to Yjs yet.
    // Wrap in atomic operation so that child blocks created during rendered()
    // (e.g., table cell paragraph blocks) also skip Yjs sync.
    //
    // `extendThroughRAF: true` keeps `isSyncingFromYjs` elevated past the end
    // of this sync closure and through the next animation frame. Without it,
    // the cleanup runs immediately on return and the subsequent
    // `await block.ready` → `onPaste` → `addBlock` microtask chain would see
    // `isSyncingFromYjs === false`. Any MutationObserver-triggered first
    // `save()` on the freshly rendered block would then land as a separate
    // Yjs transaction *before* the authoritative `YjsManager.addBlock()` call
    // below, producing a phantom post-paste undo entry. Mirrors the guard in
    // `convert()` for the same bug class.
    const block = this.yjsSync.withAtomicOperation(() => {
      return this.ctx.insert({
        tool: toolName,
        data,
        replace,
        needToFocus: false,
        skipYjsSync: true,
        // Pasted content brings its own children (they are parented right after
        // this insert), so a container Tool must never seed its defaults here.
        origin: 'paste',
      }, blocksStore);
    }, { extendThroughRAF: true });

    // Update the current block AFTER insert (and handleBlockMutation) completes.
    this.ctx.setCurrentBlockRaw(block);

    // Wait for the block to be fully rendered before calling onPaste,
    // because onPaste may change the tool's root element and needs
    // mutation watchers to be bound first.
    await block.ready;

    // Call onPaste within atomic operation so child blocks created
    // during cell initialization also skip Yjs sync.
    //
    // `extendThroughRAF: true` is critical for tools whose `onPaste()`
    // performs async DOM mutation — e.g. database card drawer dynamic
    // `import('../../blok')`, code tool shiki/mermaid/katex imports.
    // Without it, the atomic-op cleanup fires synchronously on return
    // and the async work lands after `isSyncingFromYjs` flips back to
    // false, letting MutationObserver-triggered `syncBlockDataToYjs`
    // calls on the fresh block become a separate Yjs transaction — the
    // same phantom-undo bug class as the insert-time wrap above.
    this.yjsSync.withAtomicOperation(() => {
      block.call(BlockToolAPI.ON_PASTE, pasteEvent as unknown as Record<string, unknown>);
      block.refreshToolRootElement();
    }, { extendThroughRAF: true });

    // Wire the new block into the predecessor's parent BEFORE the Yjs addBlock
    // call below so Yjs sees the final parentId in one shot. For replace we
    // route through `transferParentLinkToNewBlock` which swaps the old id for
    // the new id inside the parent's contentIds while preserving position.
    if (predecessorParentId !== null) {
      if (replace && oldBlockId !== undefined) {
        this.ctx.transferParentLinkToNewBlock(oldBlockId, block, predecessorParentId);
      } else {
        this.hierarchy.setBlockParent(block, predecessorParentId);
      }
    }

    // Sync final state to Yjs as single operation
    const savedData = await block.save();

    if (savedData !== undefined) {
      /**
       * Same law as the replace branch of `insert()`: the replaced block is
       * gone from memory and the DOM, so its doc entry rides out on the add's
       * transaction. Without this, pasting onto an empty block leaves that
       * block behind in the Y.Doc for peers and reloads.
       */
      const replacedIdToRemove = replace && oldBlockId !== undefined && oldBlockId !== block.id
        ? oldBlockId
        : undefined;

      // Same gesture-merge rule as insert()'s replace branch.
      if (replacedIdToRemove !== undefined) {
        this.dependencies.YjsManager.continueUndoEntryThatCreated(replacedIdToRemove);
      }

      this.dependencies.YjsManager.transact(() => {
        if (replacedIdToRemove !== undefined) {
          this.dependencies.YjsManager.removeBlock(replacedIdToRemove);
        }

        this.dependencies.YjsManager.addBlock({
          id: block.id,
          type: block.name,
          data: savedData.data,
          parent: block.parentId ?? undefined,
        }, this.repository.getBlockIndex(block));
      });
    }

    return block;
  }
}
