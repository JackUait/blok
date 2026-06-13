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
import { isInsideTableCell, isRestrictedInTableCell } from '../../../tools/table/table-restrictions';
import type { BlockFactory } from './factory';
import type { BlockHierarchy } from './hierarchy';
import type { BlockRepository } from './repository';
import type { BlockDidMutated, BlockOperationsDependencies, OperationsContext } from './operations-context';
import type { InsertBlockOptions, BlocksStore } from './types';
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

  /**
   * Insert new block
   * @param options - Insert options
   * @param blocksStore - The blocks store to modify
   * @returns The inserted block
   */
  public insert(options: InsertBlockOptions = {}, blocksStore: BlocksStore): Block {
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
    } = options;

    const targetIndex = index ?? this.ctx.rawCurrentBlockIndex + (replace ? 0 : 1);

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
      const neighborBlock = replace
        ? this.repository.getBlockByIndex(targetIndex)
        : (this.repository.getBlockByIndex(targetIndex - 1) ?? this.repository.getBlockByIndex(targetIndex));

      if (neighborBlock !== undefined && isInsideTableCell(neighborBlock) && isRestrictedInTableCell(name)) {
        return this.dependencies.config.defaultBlock ?? 'paragraph';
      }

      return name;
    })();

    // Bind events immediately for user-created blocks so mutations are tracked right away
    const block = this.factory.composeBlock({
      tool: resolvedToolName,
      bindEventsImmediately: true,
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

    if (replace && blockToReplace !== undefined) {
      this.blockDidMutated(BlockRemovedMutationType, blockToReplace, {
        index: targetIndex,
      });
    }

    blocksStore.insert(targetIndex, block, replace, appendToWorkingArea, forceTopLevel);

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
    if (!replace && !forceTopLevel && block.parentId === null) {
      const predecessor = this.repository.getBlockByIndex(targetIndex - 1);
      const predecessorParent = predecessor?.parentId !== null && predecessor?.parentId !== undefined
        ? this.repository.getBlockById(predecessor.parentId)
        : undefined;

      if (predecessorParent !== undefined && predecessorParent.name === 'column') {
        this.hierarchy.setBlockParent(block, predecessorParent.id);
      }
    }

    /**
     * Update the raw currentBlockIndex BEFORE firing the mutation event so
     * that listeners (e.g. TableCellBlocks.handleBlockMutation) see the
     * index of the newly inserted block. We bypass the setter to avoid
     * triggering stopCapturing prematurely — that happens after Yjs sync.
     */
    const prevIndex = this.ctx.rawCurrentBlockIndex;

    if (needToFocus) {
      this.ctx.rawCurrentBlockIndex = targetIndex;
    } else if (targetIndex <= this.ctx.rawCurrentBlockIndex) {
      this.ctx.rawCurrentBlockIndex++;
    }

    /**
     * Force call of didMutated event on Block insertion
     */
    this.blockDidMutated(BlockAddedMutationType, block, {
      index: targetIndex,
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
      this.dependencies.YjsManager.addBlock({
        id: block.id,
        type: block.name,
        data: block.preservedData,
        parent: block.parentId ?? undefined,
      }, targetIndex);
    }

    /**
     * Trigger stopCapturing for the index change now that Yjs sync is done.
     * This preserves undo group boundaries at the original timing.
     */
    if (this.ctx.rawCurrentBlockIndex !== prevIndex && !this.ctx.suppressStopCapturing) {
      this.dependencies.YjsManager?.stopCapturing();
    }

    this.ctx.assertHierarchyInvariantInDev('insert');

    return block;
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
    }, blocksStore);
  }

  /**
   * Always inserts at the end
   * @param blocksStore - The blocks store to modify
   * @returns Inserted Block
   */
  public insertAtEnd(blocksStore: BlocksStore): Block {
    this.ctx.currentBlockIndexValue = this.repository.length - 1;

    return this.ctx.insert({ appendToWorkingArea: true }, blocksStore);
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
    const insertIndex = this.ctx.rawCurrentBlockIndex + 1;

    return this.yjsSync.withAtomicOperation(() => {
      // Extract fragment (mutates DOM - removes text after caret)
      const extractedFragment = this.dependencies.Caret.extractFragmentFromCaretPosition();
      const wrapper = document.createElement('div');

      wrapper.appendChild(extractedFragment as DocumentFragment);

      const extractedText = $.isEmpty(wrapper) ? '' : wrapper.innerHTML;

      // Get truncated text (what remains in original block after extraction)
      const truncatedText = currentBlock.holder
        .querySelector('[contenteditable="true"]')?.innerHTML ?? '';

      // Atomic Yjs transaction: update original + add new (single undo entry)
      this.dependencies.YjsManager.transact(() => {
        this.dependencies.YjsManager.updateBlockData(currentBlock.id, 'text', truncatedText);
        this.dependencies.YjsManager.addBlock({
          id: newBlockId,
          type: currentBlock.name,
          data: { text: extractedText },
          parent: currentBlock.parentId ?? undefined,
        }, insertIndex);
      });

      // Insert DOM block (skip Yjs sync - already done above)
      const newBlock = this.ctx.insert({
        id: newBlockId,
        tool: currentBlock.name,
        data: { text: extractedText },
        needToFocus: false,
        skipYjsSync: true,
      }, blocksStore);

      // Update currentBlockIndex AFTER insert (and handleBlockMutation) completes.
      // This allows the table cell claiming logic to see the original block as
      // "current" during the mutation event, so it correctly claims the new block.
      this.ctx.rawCurrentBlockIndex = insertIndex;

      // Inherit parentId from the split block so nested blocks stay nested
      if (currentBlock.parentId !== null) {
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

    const newBlockId = generateBlockId();

    return this.yjsSync.withAtomicOperation(() => {
      // Atomic Yjs transaction: update original + add new (single undo entry)
      this.dependencies.YjsManager.transact(() => {
        for (const [key, value] of Object.entries(currentBlockData)) {
          this.dependencies.YjsManager.updateBlockData(currentBlockId, key, value);
        }
        this.dependencies.YjsManager.addBlock({
          id: newBlockId,
          type: newBlockType,
          data: newBlockData,
          parent: currentBlock.parentId ?? undefined,
        }, insertIndex);
      });

      // Update DOM for the current block (auto-sync is suppressed by yjsSyncCount)
      const currentContentEl = currentBlock.holder.querySelector('[contenteditable="true"]');

      if (currentContentEl !== null && typeof currentBlockData.text === 'string') {
        currentContentEl.innerHTML = currentBlockData.text;
      }

      // Insert DOM block (skip Yjs sync - already done above)
      const newBlock = this.ctx.insert({
        id: newBlockId,
        tool: newBlockType,
        data: newBlockData,
        index: insertIndex,
        needToFocus: false,
        skipYjsSync: true,
      }, blocksStore);

      // Update currentBlockIndex AFTER insert (and handleBlockMutation) completes.
      // This allows the table cell claiming logic to see the original block as
      // "current" during the mutation event, so it correctly claims the new block.
      this.ctx.rawCurrentBlockIndex = insertIndex;

      // Inherit parentId from the split block so nested blocks stay nested
      if (currentBlock.parentId !== null) {
        this.hierarchy.setBlockParent(newBlock, currentBlock.parentId);
      }

      this.ctx.assertHierarchyInvariantInDev('splitBlockWithData');

      return newBlock;
    });
  }

  /**
   * Insert a new paragraph block as a child of the given parent, atomically.
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
   * @param insertIndex - flat block index where the new block should appear
   * @param blocksStore - The blocks store to modify
   * @param childData - optional data for the new child block
   * @returns the newly created child block
   */
  public insertInsideParent(parentId: string, insertIndex: number, blocksStore: BlocksStore, childData?: BlockToolData): Block {
    const parentBlock = this.repository.getBlockById(parentId);

    if (parentBlock === undefined) {
      throw new Error(`Parent block with id "${parentId}" not found`);
    }

    const newBlockId = generateBlockId();
    const defaultBlockTool = this.dependencies.config.defaultBlock ?? 'paragraph';
    const resolvedChildData = childData ?? { text: '' };

    return this.yjsSync.withAtomicOperation(() => {
      // Atomic Yjs transaction: add new block with parent (single undo entry)
      this.dependencies.YjsManager.transact(() => {
        this.dependencies.YjsManager.addBlock({
          id: newBlockId,
          type: defaultBlockTool,
          data: resolvedChildData,
          parent: parentId,
        }, insertIndex);
      });

      // Insert DOM block (skip Yjs sync — already done above)
      const newBlock = this.ctx.insert({
        id: newBlockId,
        tool: defaultBlockTool,
        data: resolvedChildData,
        index: insertIndex,
        needToFocus: false,
        skipYjsSync: true,
      }, blocksStore);

      // Update currentBlockIndex AFTER insert so blockDidMutated sees original as current
      this.ctx.rawCurrentBlockIndex = insertIndex;

      // Set parent relationship (updates parentId, contentIds, and DOM placement).
      // Moving the block into the toggle's children container triggers a MutationObserver
      // on the toggle holder. extendThroughRAF keeps isSyncingFromYjs=true through RAF so
      // that MutationObserver-triggered blockDidMutated calls are suppressed (they would
      // otherwise create a second Yjs undo entry for the toggle data update, splitting undo).
      this.hierarchy.setBlockParent(newBlock, parentId);

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
   */
  public async paste(
    toolName: string,
    pasteEvent: PasteEvent,
    replace = false,
    blocksStore: BlocksStore
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
        replace,
        needToFocus: false,
        skipYjsSync: true,
      }, blocksStore);
    }, { extendThroughRAF: true });

    // Update currentBlockIndex AFTER insert (and handleBlockMutation) completes.
    this.ctx.rawCurrentBlockIndex = this.repository.getBlockIndex(block);

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
      this.dependencies.YjsManager.addBlock({
        id: block.id,
        type: block.name,
        data: savedData.data,
        parent: block.parentId ?? undefined,
      }, this.repository.getBlockIndex(block));
    }

    return block;
  }
}
