/**
 * @class BlockManager
 * @classdesc Manage blok`s blocks storage and appearance (Orchestrator)
 * @module BlockManager
 * @version 2.0.0
 */
import type { BlockToolData, OutputBlockData, PasteEvent } from '../../../../types';
import type { BlockTuneData } from '../../../../types/block-tunes/block-tune-data';
import type { BlockMutationEventMap, BlockMutationType } from '../../../../types/events/block';
import { BlockAddedMutationType } from '../../../../types/events/block/BlockAdded';
import { BlockChangedMutationType } from '../../../../types/events/block/BlockChanged';
import { BlockMovedMutationType } from '../../../../types/events/block/BlockMoved';
import { BlockRemovedMutationType } from '../../../../types/events/block/BlockRemoved';
import { Module } from '../../__module';
import type { Block } from '../../block';
import { BlockToolAPI } from '../../block';
import { BlockAPI } from '../../block/api';
import { Blocks } from '../../blocks';
import { DATA_ATTR } from '../../constants';
import { BlockChanged } from '../../events';
import { generateBlockId, logLabeled } from '../../utils';
import { assertHierarchy, validateHierarchy } from '../../utils/hierarchy-invariant';
import { getBlockNestingDepth } from '../drag/utils/depthUtils';

// Imported modules
import { BlockEventBinder } from './event-binder';
import { BlockFactory } from './factory';
import { BlockHierarchy } from './hierarchy';
import { BlockOperations } from './operations';
import { BlockRepository } from './repository';
import { BlockShortcuts } from './shortcuts';
import type { BlocksStore, BlockMutationEventDetailWithoutTarget, ComposeBlockOptions, InsertBlockOptions, InsertInsideParentOptions } from './types';
import { BlockYjsSync } from './yjs-sync';

type BlocksStoreProxy = BlocksStore & {
  [index: number]: Block | undefined;
};

/**
 * Tool name of the standalone collapsible "toggle list" tool. Used by convert()
 * to distinguish a toggle LIST source (children stay nested on convert, M-5)
 * from a toggle HEADING source (children released, like the header tune switch).
 * Kept as a local literal to avoid a core → tool import dependency.
 */
const TOGGLE_TOOL_NAME = 'toggle';

/**
 * @typedef {BlockManager} BlockManager
 * @property {number} currentBlockIndex - Index of current working block
 * @property {Proxy} _blocks - Proxy for Blocks instance {@link Blocks}
 */
export class BlockManager extends Module {
  /**
   * Returns current Block index
   * @returns {number}
   */
  public get currentBlockIndex(): number {
    return this._currentBlockIndex;
  }

  /**
   * Set current Block index and fire Block lifecycle callbacks
   * @param {number} newIndex - index of Block to set as current
   */
  public set currentBlockIndex(newIndex: number) {
    if (this.operations) {
      this.operations.currentBlockIndexValue = newIndex;
    }
    this._currentBlockIndex = newIndex;
  }

  /**
   * Returns first Block
   * @returns {Block}
   */
  public get firstBlock(): Block | undefined {
    return this.repository.firstBlock;
  }

  /**
   * Returns last Block of the DOCUMENT (last top-level block).
   *
   * Nested-block children (table cells, column children, toggle children) live
   * at the tail of the same flat store and are skipped — see
   * BlockRepository.lastBlock.
   * @returns {Block}
   */
  public get lastBlock(): Block | undefined {
    return this.repository.lastBlock;
  }

  /**
   * Blocks that live at the document root (no parent container).
   * @returns {Block[]}
   */
  public get topLevelBlocks(): Block[] {
    return this.repository.topLevelBlocks;
  }

  /**
   * Get current Block instance
   * @returns {Block}
   */
  public get currentBlock(): Block | undefined {
    return this.operations?.currentBlock;
  }

  /**
   * Set passed Block as a current
   * @param block - block to set as a current
   */
  public set currentBlock(block: Block | undefined) {
    if (block === undefined) {
      this.unsetCurrentBlock();

      return;
    }

    this.currentBlockIndex = this.repository.getBlockIndex(block);
  }

  /**
   * Returns next Block instance
   * @returns {Block|null}
   */
  public get nextBlock(): Block | null {
    return this.operations?.nextBlock ?? null;
  }

  /**
   * Return first Block with inputs after current Block
   * @returns {Block | undefined}
   */
  public get nextContentfulBlock(): Block | undefined {
    return this.repository.getNextContentfulBlock(this.currentBlockIndex);
  }

  /**
   * Return first Block with inputs before current Block
   * @returns {Block | undefined}
   */
  public get previousContentfulBlock(): Block | undefined {
    return this.repository.getPreviousContentfulBlock(this.currentBlockIndex);
  }

  /**
   * Returns previous Block instance
   * @returns {Block|null}
   */
  public get previousBlock(): Block | null {
    return this.operations?.previousBlock ?? null;
  }

  /**
   * Returns next visible Block instance (skips hidden blocks)
   * @returns {Block|null}
   */
  public get nextVisibleBlock(): Block | null {
    return this.operations?.nextVisibleBlock ?? null;
  }

  /**
   * Returns previous visible Block instance (skips hidden blocks)
   * @returns {Block|null}
   */
  public get previousVisibleBlock(): Block | null {
    return this.operations?.previousVisibleBlock ?? null;
  }

  /**
   * Get array of Block instances
   * @returns {Block[]} {@link Blocks#array}
   */
  public get blocks(): Block[] {
    return this.repository.blocks;
  }

  /**
   * Apply a new editor-level placeholder to existing blocks and future ones.
   * Backs the reactive `editor.placeholder` API: mutates the shared config,
   * updates the default tool adapter (so blocks created afterward use it), and
   * sweeps existing blocks for an in-place update.
   * @param value - new placeholder text, or false to clear it
   */
  public setPlaceholder(value: string | false): void {
    this.config.placeholder = value;

    const defaultToolName = this.config.defaultBlock ?? 'paragraph';

    this.Blok.Tools.blockTools.get(defaultToolName)?.setDefaultPlaceholder(value);

    for (const block of this.blocks) {
      block.setPlaceholder(value);
    }
  }

  /**
   * Check if each Block is empty
   * @returns {boolean}
   */
  public get isBlokEmpty(): boolean {
    return this.repository.isBlokEmpty();
  }

  /**
   * Runs a view rebuild — a clear + render of blocks that are already in the
   * document — with document writes suppressed for its whole (async) duration.
   *
   * `clear`/`render` take `skipYjsSync` for their own explicit writes, but the
   * `rendered()` hooks they fire also write: tools re-create nested children
   * and re-sync parent references, each landing as a fresh undo entry that
   * buries the user's real edits. Holding `isSyncingFromYjs` across the whole
   * cycle is what makes the rebuild invisible to the document.
   * @param rebuild - the clear + render cycle to run
   */
  public async withViewRebuild(rebuild: () => Promise<void>): Promise<void> {
    await this.yjsSync.withAtomicOperationAsync(rebuild, { extendThroughRAF: true });
  }

  /**
   * Returns true when a Yjs sync operation (undo/redo) is in progress.
   * Used by the Blocks API to expose sync state to tools.
   */
  public get isSyncingFromYjs(): boolean {
    return this.yjsSync.isSyncingFromYjs;
  }

  /**
   * When true, suppresses DOM-mutation-triggered Yjs syncs.
   * Set by the table tool's cell-selection handler during a pointer drag
   * to prevent cross-cell browser DOM mutations from corrupting Yjs state.
   */
  private _isPointerDragActive = false;

  /**
   * Sets whether a pointer drag interaction is currently active.
   * While true, `syncBlockDataToYjs` is suppressed so that any incidental
   * DOM mutations caused by the browser during a drag do not corrupt Yjs.
   */
  public setPointerDragActive(active: boolean): void {
    this._isPointerDragActive = active;
  }

  /**
   * Returns true while a pointer drag interaction is active.
   * The read-only counterpart of {@link setPointerDragActive}; exposed so
   * framework adapters can defer a programmatic `dispatchChange` mid-drag
   * (a change dispatched while this is true is silently dropped by the
   * `blockDidMutated` gate) and re-dispatch it on drag-end.
   */
  public get isPointerDragActive(): boolean {
    return this._isPointerDragActive;
  }

  /**
   * Index of current working block
   * @type {number}
   */
  private _currentBlockIndex = -1;

  /**
   * Proxy for Blocks instance {@link Blocks}
   * @type {Proxy}
   * @private
   */
  private _blocks: BlocksStoreProxy | null = null;

  /**
   * Event binder for block-level events
   */
  private eventBinder!: BlockEventBinder;

  /**
   * Keyboard shortcuts handler
   */
  private shortcuts!: BlockShortcuts;

  /**
   * Repository for block queries
   */
  private repository!: BlockRepository;

  /**
   * Factory for creating blocks
   */
  private factory!: BlockFactory;

  /**
   * Hierarchy manager for parent/child relationships
   */
  private hierarchy!: BlockHierarchy;

  /**
   * Yjs synchronization handler
   */
  private yjsSync!: BlockYjsSync;

  /**
   * Set of parent block IDs awaiting deferred Yjs sync.
   * Batched via queueMicrotask to avoid multiple syncs during batch operations.
   */
  private parentsSyncScheduled = new Set<string>();

  /**
   * Tracks the in-flight promise from flushParentSyncs so that transactForTool
   * can chain stopCapturing after all parent data has been written to Yjs.
   */
  private pendingParentSyncPromise: Promise<void> | null = null;

  /**
   * Saved `suppressStopCapturing` values, one per open tool transaction.
   * A stack rather than a single field so a synchronous `transactForTool`
   * nested inside an open gesture group restores the outer group instead of
   * closing it.
   */
  private toolTransactionStack: boolean[] = [];

  /**
   * Operations handler for state changes
   */
  private operations!: BlockOperations;

  /**
   * Should be called after Blok.UI preparation
   * Define this._blocks property
   */
  public prepare(): void {
    const blocks = new Blocks(this.Blok.UI.nodes.redactor, this.eventsDispatcher);

    /**
     * We need to use Proxy to overload set/get [] operator.
     * So we can use array-like syntax to access blocks
     * @example
     * this._blocks[0] = new Block(...);
     *
     * block = this._blocks[0];
     * @todo proxy the enumerate method
     * @type {Proxy}
     * @private
     */
    this._blocks = new Proxy(blocks, {
      set: Blocks.set,
      get: Blocks.get,
    }) as BlocksStoreProxy;

    // Initialize services
    this.initializeServices();

    /** Copy event */
    this.listeners.on(
      document,
      'copy',
      (event: Event) => {
        this.Blok.BlockEvents.handleCommandC(event as ClipboardEvent);
      }
    );

    // Register keyboard shortcuts
    this.shortcuts.register();

    // Subscribe to Yjs changes for undo/redo DOM synchronization
    this.yjsSync.subscribe();
  }

  /**
   * Initialize all service modules
   */
  private initializeServices(): void {
    // Initialize repository
    this.repository = new BlockRepository();
    this.repository.initialize(this.blocksStore);

    // Initialize event binder
    this.eventBinder = new BlockEventBinder({
      blockEvents: this.Blok.BlockEvents,
      listeners: this.readOnlyMutableListeners,
      eventsDispatcher: this.eventsDispatcher,
      getBlockIndex: (block) => this.repository.getBlockIndex(block),
      onBlockMutated: this.blockDidMutated.bind(this),
      shouldHandleEvent: (event: Event) => {
        const target = event.target;

        if (target instanceof Element) {
          const closestEditor = target.closest('[data-blok-testid="blok-editor"]');

          return closestEditor === null || closestEditor === this.Blok.UI.nodes.wrapper;
        }

        return true;
      },
    });

    // Initialize factory
    this.factory = new BlockFactory(
      {
        API: this.Blok.API,
        eventsDispatcher: this.eventsDispatcher,
        tools: this.Blok.Tools.blockTools,
        moduleInstances: this.Blok,
        migrations: this.config.migrations,
      },
      this.bindBlockEvents.bind(this)
    );

    // Initialize hierarchy with callback to sync parent data to Yjs.
    // The third argument exposes `yjsSync.isSyncingFromYjs` lazily (yjsSync is
    // constructed later in this ctor) so the Layer 7 dangling-parentId guard
    // can exempt remote sync paths from throwing — a remote peer may legally
    // deliver a transiently-dangling parent id during conflict resolution.
    this.hierarchy = new BlockHierarchy(
      this.repository,
      (parentId) => {
        if (!this.yjsSync.isSyncingFromYjs) {
          this.scheduleParentSync(parentId);
        }
      },
      () => Boolean(this.yjsSync?.isSyncingFromYjs)
    );

    // Initialize operations first (before yjsSync) to allow circular dependency resolution
    this.operations = new BlockOperations(
      {
        config: this.config,
        YjsManager: this.Blok.YjsManager,
        Caret: this.Blok.Caret,
        I18n: this.Blok.I18n,
        eventsDispatcher: this.eventsDispatcher,
      },
      this.repository,
      this.factory,
      this.hierarchy,
      this.blockDidMutated.bind(this),
      this._currentBlockIndex
    );

    // Initialize yjs sync with reference to operations for suppressStopCapturing
    this.yjsSync = new BlockYjsSync(
      {
        YjsManager: this.Blok.YjsManager,
        operations: this.operations,
        sanitizer: this.config.sanitizer,
        // Lazy: `ReadOnly` arbitrates the host's wish against collaboration's
        // veto, and that answer changes over the editor's life (a ticket
        // refresh can revoke write access), so it must be read per call.
        isReadOnly: () => this.Blok.ReadOnly.isEnabled,
      },
      this.repository,
      this.factory,
      {
        addToDom: (block, index) => {
          this.blocksStore.insert(index, block);
        },
        removeFromDom: (index) => {
          this.blocksStore.remove(index);
        },
        moveInDom: (toIndex, fromIndex) => {
          this.blocksStore.move(toIndex, fromIndex);
        },
        getBlockIndex: (block) => this.repository.getBlockIndex(block),
        insertDefaultBlock: (skipYjsSync, id) => {
          return this.insert({ skipYjsSync, id });
        },
        updateIndentation: (block) => {
          this.hierarchy.updateBlockIndentation(block);
        },
        setBlockParent: (block, parentId) => {
          this.hierarchy.setBlockParent(block, parentId);
        },
        replaceBlock: (index, newBlock) => {
          this.blocksStore.replace(index, newBlock);
        },
        onBlockRemoved: (block, index) => {
          this.blockDidMutated(BlockRemovedMutationType, block, { index });
        },
        onBlockAdded: (block, index) => {
          this.blockDidMutated(BlockAddedMutationType, block, { index });
        },
      },
      this.blocksStore
    );

    // Set yjsSync on operations to complete circular dependency
    this.operations.setYjsSync(this.yjsSync);

    // Initialize shortcuts
    this.shortcuts = new BlockShortcuts(
      this.Blok.UI.nodes.wrapper,
      {
        onMoveUp: this.moveCurrentBlockUp.bind(this),
        onMoveDown: this.moveCurrentBlockDown.bind(this),
        onCopyAsMarkdown: () => void this.Blok.BlockSelection.copySelectedBlocksAsMarkdown(),
        onDuplicate: this.duplicateCurrentBlock.bind(this),
      }
    );
  }

  /**
   * Returns the proxied Blocks storage ensuring it is initialized.
   * @throws {Error} if the storage is not prepared.
   */
  private get blocksStore(): BlocksStore {
    if (this._blocks === null) {
      throw new Error('BlockManager: blocks store is not initialized. Call prepare() before accessing blocks.');
    }

    return this._blocks;
  }

  /**
   * Toggle read-only state
   *
   * If readOnly is true:
   * - Unbind event handlers from created Blocks
   *
   * if readOnly is false:
   * - Bind event handlers to all existing Blocks
   * @param {boolean} readOnlyEnabled - "read only" state
   */
  public toggleReadOnly(readOnlyEnabled: boolean): void {
    if (!readOnlyEnabled) {
      this.eventBinder.enableBindings(this.blocks);
    } else {
      this.eventBinder.disableBindings();
    }
  }

  /**
   * Creates Block instance by tool name
   * @param {object} options - block creation options
   * @param {string} options.tool - tools passed in blok config {@link BlokConfig#tools}
   * @param {string} [options.id] - unique id for this block
   * @param {BlockToolData} [options.data] - constructor params
   * @param {string} [options.parentId] - parent block id for hierarchical structure
   * @param {string[]} [options.contentIds] - array of child block ids
   * @param [options.origin] - why the Block is being composed (creation vs restore); defaults to 'api'
   * @returns {Block}
   */
  public composeBlock(options: ComposeBlockOptions): Block {
    return this.factory.composeBlock(options);
  }

  /**
   * Insert new block into _blocks
   * @param {object} options - insert options
   * @param {string} [options.id] - block's unique id
   * @param {string} [options.tool] - plugin name, by default method inserts the default block type
   * @param {object} [options.data] - plugin data
   * @param {number} [options.index] - index where to insert new Block
   * @param {boolean} [options.needToFocus] - flag shows if needed to update current Block index
   * @param {boolean} [options.replace] - flag shows if block by passed index should be replaced with inserted one
   * @param {boolean} [options.skipYjsSync] - if true, skip syncing to Yjs (caller handles sync separately)
   * @param [options.origin] - why the Block is being created (creation vs restore); defaults to 'api'
   * @returns {Block}
   */
  public insert(options: InsertBlockOptions = {}): Block {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    const result = this.operations.insert(options, this.blocksStore);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    return result;
  }

  /**
   * Inserts several blocks at once
   * Used during initial rendering of the editor
   * @param blocks - blocks to insert
   * @param index - index where to insert
   * @param options - extra behavior
   * @param options.notify - when true, emit ONE BlockChanged (block-added) mutation
   *   for the whole batch so reactive consumers (e.g. the React useBlocks hook)
   *   re-render. Defaults to false: the render/seed path (Renderer.render) loads a
   *   document without firing a change mutation. The public api.blocks.insertMany
   *   wrapper passes true so a programmatic bulk insert mirrors single insert().
   */
  public insertMany(
    blocks: Block[],
    index = 0,
    { notify = false, skipYjsSync = false }: { notify?: boolean; skipYjsSync?: boolean } = {}
  ): void {
    const blockById = new Map<string, Block>();

    for (const block of blocks) {
      blockById.set(block.id, block);
    }

    this.reconcileChildrenToParents(blocks, blockById);
    this.reconcileParentsToChildren(blocks, blockById);
    this.assertInsertManyHierarchy(blocks);

    // Load blocks into Yjs BEFORE adding to the store.
    // blocksStore.insertMany() triggers rendered() on each block, which may
    // create nested blocks (e.g., table cell paragraphs) via api.blocks.insert().
    // Those nested inserts sync to Yjs. If fromJSON() ran after, it would wipe
    // them (fromJSON replaces the entire Yjs array). Running fromJSON first
    // ensures nested blocks created during rendered() persist in Yjs.
    const blockDataArray: OutputBlockData[] = blocks.map(block => {
      const tunes = block.preservedTunes;

      return {
        id: block.id,
        type: block.name,
        data: block.preservedData,
        ...(Object.keys(tunes).length > 0 && { tunes }),
        ...(block.parentId !== null && { parent: block.parentId }),
        ...(block.contentIds.length > 0 && { content: block.contentIds }),
      };
    });

    /*
     * `fromJSON` replaces the whole Yjs array and clears the undo history —
     * right when a document is being loaded, wrong when the view is merely
     * being rebuilt from blocks that are already in the document. The blocks
     * keep their ids, so the existing Yjs state already describes them.
     */
    if (!skipYjsSync) {
      this.Blok.YjsManager.fromJSON(blockDataArray);
    }

    // Wrap in atomic operation so that RENDERED lifecycle hooks (which may
    // create nested blocks, e.g. table cell paragraphs, or call setBlockParent)
    // run with isSyncingFromYjs = true. This prevents:
    // 1. operations.insert() from syncing duplicate blocks to Yjs
    // 2. scheduleParentSync from writing back data already in Yjs
    // Both would create 'local' origin transactions that pollute the undo stack.
    this.yjsSync.withAtomicOperation(() => {
      this.blocksStore.insertMany(blocks, index);
    }, { extendThroughRAF: true });

    // Apply indentation for blocks with parentId (hierarchical structure).
    blocks.forEach(block => {
      if (block.parentId !== null) {
        this.updateBlockIndentation(block);
      }
    });

    // Notify reactive consumers (React useBlocks hook) that blocks were added.
    // Single insert() fires one BlockAdded mutation per block; a bulk insert
    // fires ONE for the whole atomic batch — enough to bump a subscription
    // version without an event storm. Gated on `notify` so the render/seed path
    // (Renderer.render) stays silent (it has its own block:rendered events).
    if (notify && blocks.length > 0) {
      this.blockDidMutated(BlockAddedMutationType, blocks[0], {
        index,
      });
    }
  }

  /**
   * Update Block data
   * @param block - block to update
   * @param data - (optional) new data
   * @param tunes - (optional) tune data
   */
  public async update(block: Block, data?: Partial<BlockToolData>, tunes?: { [name: string]: BlockTuneData }): Promise<Block> {
    return this.operations.update(block, this.blocksStore, data, tunes);
  }

  /**
   * Replace passed Block with the new one with specified Tool and data
   * @param block - block to replace
   * @param newTool - new Tool name
   * @param data - new Tool data
   */
  public replace(block: Block, newTool: string, data: BlockToolData): Block {
    return this.operations.replace(block, newTool, data, this.blocksStore);
  }

  /**
   * Insert pasted content. Call onPaste callback after insert.
   * @param {string} toolName - name of Tool to insert
   * @param {PasteEvent} pasteEvent - pasted data
   * @param {boolean} replace - should replace current block
   * @param {BlockToolData} data - initial tool data for the inserted block
   */
  public async paste(
    toolName: string,
    pasteEvent: PasteEvent,
    replace = false,
    data?: BlockToolData
  ): Promise<Block> {
    return this.operations.paste(toolName, pasteEvent, replace, this.blocksStore, data);
  }

  /**
   * Insert new default block at passed index
   * @param {number} index - index where Block should be inserted
   * @param {boolean} needToFocus - if true, updates current Block index
   * @param {boolean} skipYjsSync - if true, skip syncing to Yjs (caller handles sync separately)
   * @returns {Block} inserted Block
   */
  public insertDefaultBlockAtIndex(
    index: number,
    needToFocus = false,
    skipYjsSync = false,
    forceTopLevel = false
  ): Block {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    const result = this.operations.insertDefaultBlockAtIndex(index, needToFocus, skipYjsSync, this.blocksStore, forceTopLevel);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    return result;
  }

  /**
   * Always inserts at the end
   * @returns {Block}
   */
  public insertAtEnd(): Block {
    return this.operations.insertAtEnd(this.blocksStore);
  }

  /**
   * Merge two blocks
   * @param {Block} targetBlock - previous block will be append to this block
   * @param {Block} blockToMerge - block that will be merged with target block
   * @returns {Promise} - the sequence that can be continued
   */
  public async mergeBlocks(targetBlock: Block, blockToMerge: Block): Promise<void> {
    return this.operations.mergeBlocks(targetBlock, blockToMerge, this.blocksStore);
  }

  /**
   * Remove passed Block
   * @param block - Block to remove
   * @param addLastBlock - if true, inserts a new default block when the last block is removed
   * @param skipYjsSync - if true, skip syncing to Yjs (caller handles sync separately)
   */
  public removeBlock(block: Block, addLastBlock = true, skipYjsSync = false): Promise<void> {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    const result = this.operations.removeBlock(block, addLastBlock, skipYjsSync, this.blocksStore);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    return result;
  }

  /**
   * Expand a set of blocks to include each block's flat-indent followers — the
   * consecutive following blocks nested more deeply via the unified list-nesting
   * depth ({@link getBlockNestingDepth}). This mirrors Notion, where selecting a
   * Tab-indented parent also selects everything nested under it, so a delete on
   * the parent carries its nested children as a unit.
   * @param blocks - the explicitly selected blocks
   * @returns the expanded set, in document order, deduplicated
   */
  private withFlatIndentFollowers(blocks: Block[]): Block[] {
    const all = this.blocks;
    const included = new Set<Block>();

    const followersOf = (block: Block): Block[] => {
      const startIndex = all.indexOf(block);

      if (startIndex < 0) {
        return [];
      }

      const parentDepth = getBlockNestingDepth(block) ?? 0;
      const rest = all.slice(startIndex + 1);
      const boundary = rest.findIndex((follower) => (getBlockNestingDepth(follower) ?? 0) <= parentDepth);

      return boundary === -1 ? rest : rest.slice(0, boundary);
    };

    for (const block of blocks) {
      included.add(block);

      for (const follower of followersOf(block)) {
        included.add(follower);
      }
    }

    return all.filter((block) => included.has(block));
  }

  /**
   * Delete all selected blocks and insert a replacement block at their position.
   *
   * A replacement block is inserted when the whole document was selected (so the
   * editor is never left empty) or when {@link forceReplacement} is set. Typing
   * over a cross-block selection passes `forceReplacement` so the typed character
   * always lands in ONE clean block at the seam of the deleted span, instead of
   * merging into whichever adjacent block still holds the caret (Notion parity).
   * Backspace/Delete leaves it `false` so a partial multi-block delete does not
   * spawn a stray empty paragraph.
   * @param forceReplacement - always insert a replacement block, even for a
   *   partial (non-whole-document) selection
   */
  public deleteSelectedBlocksAndInsertReplacement(forceReplacement = false): Block | undefined {
    // Collect selected blocks, expanded to include each one's flat-indent
    // followers (Notion deletes a Tab-nested parent together with its children),
    // then attach indices sorted descending for safe removal.
    const expandedBlocks = this.withFlatIndentFollowers(this.blocks.filter((block) => block.selected));
    const selectedBlockEntries = expandedBlocks
      .map((block) => ({ block, index: this.blocks.indexOf(block) }))
      .sort((a, b) => b.index - a.index);

    if (selectedBlockEntries.length === 0) {
      return undefined;
    }

    // Insert a replacement when the whole document is being cleared (never leave
    // an empty editor) or when the caller demands one (typing over the selection).
    const allBlocksDeleted = selectedBlockEntries.length === this.blocks.length;
    const shouldInsertReplacement = allBlocksDeleted || forceReplacement;

    // Get insertion index (minimum index among selected blocks)
    const insertionIndex = selectedBlockEntries[selectedBlockEntries.length - 1].index;
    const blockIds = selectedBlockEntries.map(({ block }) => block.id);

    const defaultToolName = this.config.defaultBlock;

    if (defaultToolName === undefined) {
      throw new Error('Could not insert default Block. Default block tool is not defined in the configuration.');
    }

    // Generate new block ID upfront for the transaction (only if needed)
    const newBlockId = shouldInsertReplacement ? generateBlockId() : undefined;

    // Single Yjs transaction for all removals + insertion (single undo entry)
    this.Blok.YjsManager.transact(() => {
      for (const id of blockIds) {
        this.Blok.YjsManager.removeBlock(id);
      }

      if (newBlockId !== undefined) {
        this.Blok.YjsManager.addBlock({
          id: newBlockId,
          type: defaultToolName,
          data: {},
        }, insertionIndex);
      }
    });

    // DOM cleanup - remove selected blocks (skip Yjs sync since we handled it above)
    // Iterate in reverse order (highest index first) to avoid index shifting issues
    for (const { block } of selectedBlockEntries) {
      void this.removeBlock(block, false, true);
    }

    // Insert replacement block (skip Yjs sync since we handled it above)
    if (newBlockId !== undefined) {
      return this.insert({
        id: newBlockId,
        tool: defaultToolName,
        index: insertionIndex,
        needToFocus: true,
        skipYjsSync: true,
      });
    }

    return undefined;
  }

  /**
   * Attention!
   * After removing insert the new default typed Block and focus on it
   * Removes all blocks
   */
  public removeAllBlocks(): void {
    // Create a copy of the blocks array
    const blocksToRemove = [...this.blocks];
    const blockIds = blocksToRemove.map(block => block.id);

    // Single Yjs transaction for all removals (single undo entry)
    this.Blok.YjsManager.transact(() => {
      for (const id of blockIds) {
        this.Blok.YjsManager.removeBlock(id);
      }
    });

    // DOM cleanup - remove all blocks (from end to avoid index shifting)
    while (this.blocksStore.length > 0) {
      this.blocksStore.remove(this.blocksStore.length - 1);
    }

    this.unsetCurrentBlock();
    this.insert();
    const currentBlock = this.currentBlock;
    const firstInput = currentBlock?.firstInput;

    if (firstInput !== undefined) {
      firstInput.focus();
    }
  }

  /**
   * Split current Block
   */
  public split(): Block {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    const result = this.operations.split(this.blocksStore);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    return result;
  }

  /**
   * Execute a function with stopCapturing suppressed.
   * All block operations within fn are kept in the same undo group.
   * Used by tools that perform multi-step structural operations
   * (e.g., table add row = multiple block inserts).
   */
  public transactForTool(fn: () => void): void {
    this.beginToolTransaction();

    try {
      fn();
    } finally {
      this.endToolTransaction();
    }
  }

  /**
   * Open an undo group that block operations will not split.
   *
   * Unlike `transactForTool`, this may stay open across async boundaries, so a
   * pointer gesture (table corner drag, "+" button drag) commits as a single
   * undo entry instead of one per row or column. Block operations otherwise
   * call `stopCapturing()` per operation, and the 500ms Yjs `captureTimeout`
   * does not merge them.
   *
   * Every call MUST be paired with `endToolTransaction()`.
   */
  public beginToolTransaction(): void {
    this.Blok.YjsManager.stopCapturing();

    this.toolTransactionStack.push(this.operations.suppressStopCapturing);
    this.operations.suppressStopCapturing = true;
  }

  /**
   * Close the undo group opened by `beginToolTransaction()`.
   */
  public endToolTransaction(): void {
    const prevSuppress = this.toolTransactionStack.pop() ?? false;

    // Closing boundary uses two nested queueMicrotask calls to ensure correct ordering.
    //
    // Microtask ordering after the operation returns:
    //   [D1..D4 continuations, C (schedulePendingCellCheck), T (outer)]
    //
    // C runs BEFORE T (outer). During C, ensureCellHasBlock inserts fire, and
    // scheduleParentSync queues P2 (flushParentSyncs). P2 is appended to the queue
    // AFTER T (outer), so when T (outer) runs, P2 hasn't run yet.
    //
    // By queueing T_inner from inside T (outer), T_inner lands AFTER P2 in the queue:
    //   After C runs: [T (outer), P2]
    //   T (outer) runs, queues T_inner: [P2, T_inner]
    //   P2 runs: sets pendingParentSyncPromise
    //   T_inner runs: finds pendingParentSyncPromise set → waits for it → stopCapturing()
    //
    // This ensures the parent sync's updateBlockData fires inside the same undo group
    // as the structural operation (deletes + empty cell inserts + table data update).
    queueMicrotask(() => {
      queueMicrotask(() => {
        if (this.pendingParentSyncPromise !== null) {
          void this.pendingParentSyncPromise.then(() => {
            this.Blok.YjsManager.stopCapturing();
            this.operations.suppressStopCapturing = prevSuppress;
          });
        } else {
          this.Blok.YjsManager.stopCapturing();
          this.operations.suppressStopCapturing = prevSuppress;
        }
      });
    });
  }

  /**
   * Insert a new block as a child of the given parent, atomically.
   * Block creation and parent assignment are grouped into a single undo entry.
   *
   * @param parentId - id of the parent block
   * @param insertIndex - flat block index where the new block should appear
   * @param childData - optional data for the new child block
   * @param toolName - optional tool to create; defaults to `config.defaultBlock`
   * @returns the newly created child block
   */
  public insertInsideParent(
    parentId: string,
    insertIndex: number,
    childData?: BlockToolData,
    toolName?: string,
    options?: InsertInsideParentOptions
  ): Block {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    const result = this.operations.insertInsideParent(parentId, insertIndex, this.blocksStore, childData, toolName, options);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    return result;
  }

  /**
   * True when an atomic operation (convert, split, drag, etc.) is in progress
   * and callers should NOT break the current undo group with `stopCapturing()`.
   * Consumed by api-layer wrappers like `insertInsideParent` that normally
   * force a new undo entry.
   */
  public get suppressStopCapturing(): boolean {
    return this.operations?.suppressStopCapturing ?? false;
  }

  /**
   * Splits a block by updating the current block's data and inserting a new block.
   * Both operations are grouped into a single undo entry.
   */
  public splitBlockWithData(
    currentBlockId: string,
    currentBlockData: Partial<BlockToolData>,
    newBlockType: string,
    newBlockData: BlockToolData,
    insertIndex: number
  ): Block {
    return this.operations.splitBlockWithData(
      currentBlockId,
      currentBlockData,
      newBlockType,
      newBlockData,
      insertIndex,
      this.blocksStore
    );
  }

  /**
   * Returns Block by passed index
   */
  public getBlockByIndex(index: number): Block | undefined {
    return this.repository.getBlockByIndex(index);
  }

  /**
   * Returns an index for passed Block
   * @param block - block to find index
   */
  public getBlockIndex(block: Block): number {
    return this.repository.getBlockIndex(block);
  }

  /**
   * Returns the Block by passed id
   * @param id - id of block to get
   * @returns {Block}
   */
  public getBlockById(id: string): Block | undefined {
    return this.repository.getBlockById(id);
  }

  /**
   * Walks up the parentId chain and returns the top-level (root) block.
   * If the block has no parent, returns it as-is.
   * @param block - the block to resolve
   * @returns {Block} the root ancestor block
   */
  public resolveToRootBlock(block: Block): Block {
    return this.repository.resolveToRootBlock(block);
  }

  /**
   * The block a selection gesture aimed at `block` actually targets — the same
   * unit the block toolbar anchors to. See
   * {@link BlockRepository.resolveToSelectableBlock}.
   * @param block - the block a gesture landed on
   * @returns {Block} the block that owns the gesture
   */
  public resolveToSelectableBlock(block: Block): Block {
    return this.repository.resolveToSelectableBlock(block);
  }

  /**
   * Whether the block is a unit a selection gesture may target on its own.
   * See {@link BlockRepository.isSelectionUnit}.
   * @param block - the block to test
   * @returns {boolean}
   */
  public isSelectionUnit(block: Block): boolean {
    return this.repository.isSelectionUnit(block);
  }

  /**
   * The blocks a range gesture spanning `anchor`→`target` selects. See
   * {@link BlockRepository.getSelectionSiblingRange}.
   * @param anchor - the block the gesture started on
   * @param target - the block the gesture currently reaches
   * @returns {Block[]} the blocks to select, in document order
   */
  public getSelectionSiblingRange(anchor: Block, target: Block): Block[] {
    return this.repository.getSelectionSiblingRange(anchor, target);
  }

  /**
   * Returns the depth (nesting level) of a block in the hierarchy.
   * @param block - the block to get depth for
   * @returns {number} - depth level (0 for root, 1 for first level children, etc.)
   */
  public getBlockDepth(block: Block): number {
    return this.hierarchy.getBlockDepth(block);
  }

  /**
   * Sets the parent of a block, updating both the block's parentId and the parent's contentIds.
   *
   * The doc write delegates to `YjsManager.applyBlockPlacement` — ONE
   * transaction owning the parentId set/delete AND order-array membership
   * (old parent's contentIds, new parent's contentIds, and the root order).
   * The parentId write and the order writes must never split across
   * transactions: concurrent peers reparenting siblings would drift on both
   * parents, and undo snapshots would restore a child no parent claims.
   * BlockManager itself never touches contentIds Y.Arrays — DocumentStore
   * owns every order-array write.
   * @param block - the block to reparent
   * @param newParentId - the new parent block id, or null for root level
   */
  public setBlockParent(block: Block, newParentId: string | null): void {
    // Capture the old parent id BEFORE hierarchy.setBlockParent mutates it —
    // the BlockMoved emission guard below compares against it.
    const oldParentId = block.parentId;

    this.hierarchy.setBlockParent(block, newParentId);

    // Notify 'block changed' listeners that the tree structure changed, so
    // consumers like the React `useBlocks` hook re-render on a programmatic
    // nest/unnest. A reparent is a move in the tree — emit BlockMoved (which,
    // unlike BlockChanged, does not re-sync block data to Yjs; setBlockParent
    // owns its own parentId/contentIds Yjs writes below).
    //
    // Guard against the paths that emit their own structural events:
    //   - reparents that do not actually change the parent (drag re-asserts the
    //     same parent to fix DOM placement; tools re-claim already-owned blocks),
    //   - the drag move pipeline (pointer drag / open move group) which fires
    //     BlockMoved through `move()` already,
    //   - Yjs sync (undo/redo/remote) which drives re-renders via its own path.
    const actualNewParentId = block.parentId;
    /**
     * Only a DRAG move group (or an adapter-flagged pointer drag) fires the tool
     * MOVED hook itself via the drag `move()` pipeline, so skip it here to avoid a
     * double-fire. A KEYBOARD move group (Tab/Shift+Tab nesting) does NOT fire
     * MOVED elsewhere, so this path must fire it — otherwise a list item nested via
     * the keyboard updates its model (parentId) but never re-renders its indent.
     */
    const isDragMove = this.Blok.YjsManager.isDragMoveGroupActive || this._isPointerDragActive;

    if (actualNewParentId !== oldParentId && !this.yjsSync.isSyncingFromYjs && !isDragMove) {
      const index = this.repository.getBlockIndex(block);

      this.blockDidMutated(BlockMovedMutationType, block, {
        fromIndex: index,
        toIndex: index,
      });

      // A reparent IS a move in the tree, so fire the tool's MOVED lifecycle hook
      // too — not just the BlockMoved mutation event. Tools re-render their
      // nesting-dependent UI here (e.g. the list tool recomputes its structural
      // depth and applies the indent margin in moved()). Without this, keyboard
      // Tab/Shift+Tab nesting changed the model but left the block visually
      // un-indented. The drag path fires MOVED itself (and is excluded above via
      // isDragMove), so this never double-fires.
      block.call(BlockToolAPI.MOVED, {
        fromIndex: index,
        toIndex: index,
      });
    }

    // Sync the child block's parentId to Yjs so undo/redo can restore the relationship.
    // Without this, blocks created via insertDefaultBlockAtIndex + setBlockParent (e.g.,
    // pressing Enter in a child paragraph) lose their parentId on redo because the
    // initial addBlock wrote to Yjs before setBlockParent was called.
    const yblock = this.Blok.YjsManager.getBlockById(block.id);

    if (yblock === undefined) {
      return;
    }

    // During a genuine undo/redo/remote REPLAY the Yjs record already carries the
    // authoritative parentId (the replay handlers read it FROM the doc and call
    // setBlockParent only to mirror it into memory), so re-writing would be
    // redundant and could pollute the undo stack — skip it.
    //
    // But `isSyncingFromYjs` is ALSO elevated by the RENDERED-hook atomic wrapper
    // (blockManager.renderBlocks / operations insert), under which a tool's
    // rendered() may ESTABLISH a brand-new relationship the doc does not have yet
    // — the canonical case is ColumnList.seedColumns → setBlockParent(column,
    // column_list). Blanket-skipping there strands the columns parent-less IN THE
    // DOC, so they re-materialise orphaned at root on the next undo/redo (the
    // "2 columns became 4 / columns escaped their list" corruption). The precise
    // discriminator is the doc itself: only skip when Yjs ALREADY agrees; if it
    // does not, this is a new relationship that must be persisted. (A true replay
    // always already agrees, so this stays a no-op there.)
    if (this.yjsSync.isSyncingFromYjs) {
      const yParent = yblock.get('parentId') as string | null | undefined;
      const yParentNormalized = yParent === undefined ? null : yParent;

      if (yParentNormalized === newParentId) {
        return;
      }
    }

    // Doc write: ONE applyPlacement transaction owning the parentId
    // set/delete + order-array membership (old parent, new parent, AND the
    // root array — the delegation is what retires the stale-root-entry
    // hole and the addBlock/helper double-writer). The placement's afterId
    // comes from the in-memory hierarchy, which `hierarchy.setBlockParent`
    // above already updated. The REQUESTED newParentId goes to the doc even
    // when the hierarchy sanitized a dangling parent to null in memory —
    // the doc's orphan tolerance keeps the relationship for when the parent
    // arrives from a peer.
    const placement = this.resolveYjsPlacement(block, newParentId);

    // Drag-reparent path: when a move group is open (DragController wraps
    // its drop handler in `YjsManager.transactMoves`), the write must not
    // land on Y.UndoManager as a separate stack item — no-capture, and the
    // parent change attaches to the in-flight move entry instead so
    // undo/redo rewinds both atomically.
    if (this.Blok.YjsManager.isInMoveGroup) {
      // From-placement must be read BEFORE the write below mutates the doc.
      const fromPlacement = this.Blok.YjsManager.getBlockPlacement(block.id);

      this.Blok.YjsManager.applyBlockPlacement(block.id, placement, { capture: false });

      if (fromPlacement !== null) {
        this.Blok.YjsManager.recordParentChangeForPendingMove(block.id, fromPlacement, placement);
      }

      return;
    }

    this.Blok.YjsManager.applyBlockPlacement(block.id, placement, { capture: true });
  }

  /**
   * The block's placement per the in-memory hierarchy: its parent plus the
   * sibling it follows (null = first). For root placement the preceding
   * sibling is the nearest ROOT-LEVEL block before it in the flat order.
   * @param block - the block whose placement to resolve
   * @param parentId - the block's (already updated) parent id, or null for root
   */
  private resolveYjsPlacement(block: Block, parentId: string | null): { parentId: string | null; afterId: string | null } {
    if (parentId !== null) {
      const siblings = this.repository.getBlockById(parentId)?.contentIds ?? [];
      const position = siblings.indexOf(block.id);

      if (position > 0) {
        return { parentId, afterId: siblings[position - 1] };
      }

      // Not listed (dangling in-memory state) → append after the last sibling.
      if (position === -1 && siblings.length > 0) {
        return { parentId, afterId: siblings[siblings.length - 1] };
      }

      return { parentId, afterId: null };
    }

    const blocks = this.repository.blocks;
    const index = blocks.indexOf(block);
    const precedingRootBlock = blocks
      .slice(0, Math.max(index, 0))
      .reverse()
      .find((candidate) => candidate.parentId === null);

    return { parentId: null, afterId: precedingRootBlock?.id ?? null };
  }

  /**
   * Reparent a block in response to UndoHistory replaying a drag move.
   *
   * The replay path has ALREADY written the new parentId to Yjs under
   * `transactWithoutCapture`. This method exists so UndoHistory has a
   * stable entry point for the in-memory reparent that:
   *   - routes through `BlockHierarchy.setBlockParent` so contentIds, DOM
   *     placement, and indentation all stay consistent
   *   - does NOT re-write Yjs (that would double-emit or re-enter capture)
   * @param block - the block being reparented during move-undo/move-redo
   * @param newParentId - the parent id to restore
   */
  public reparentFromHistoryReplay(block: Block, newParentId: string | null): void {
    // Run inside withAtomicOperation so `isSyncingFromYjs` is true for the
    // duration of the hierarchy update. This suppresses:
    //   - `onParentChanged` → `scheduleParentSync` → a fresh Yjs write that
    //     would land on Y.UndoManager (polluting the undo stack)
    //   - any DOM mutation observer write-back into Yjs
    //
    // extendThroughRAF: reparenting a block out of (or into) a container makes
    // the container re-render its empty/placeholder state on a DEFERRED DOM
    // callback. Without the RAF extension that callback fires
    // syncBlockDataToYjs with 'local' origin after this window closed — a
    // fresh TRACKED undo item that clears the caret redo stack, so the move
    // entry being replayed here could never be redone. Same window the
    // block-removal replay uses (yjs-sync removeBlockForUndoRedo).
    this.yjsSync.withAtomicOperation(() => {
      this.hierarchy.setBlockParent(block, newParentId);

      // Fire the tool's MOVED lifecycle hook, mirroring the public
      // setBlockParent path (~1053). The public path recomputes nesting-dependent
      // UI here (e.g. the list tool re-derives its structural depth in moved()).
      // Undo/redo replays a keyboard reparent through THIS method, so without
      // firing MOVED the block's parentId is restored but the tool's cached
      // structural state (list _data.depth) stays stale and save() returns the
      // wrong depth. Runs inside withAtomicOperation (isSyncingFromYjs === true),
      // so the handler only mutates tool-local _data/DOM and never emits an extra
      // Yjs write.
      const index = this.repository.getBlockIndex(block);

      block.call(BlockToolAPI.MOVED, {
        fromIndex: index,
        toIndex: index,
        // Mark this a STRUCTURAL move so a depth-carrying tool (list) recomputes
        // its depth from the restored tree position instead of a stale in-memory
        // carrier — essential on undo, where the block may be a freshly-rendered
        // instance that lost its "was nested" flag.
        structural: true,
      });
    }, { extendThroughRAF: true });
  }

  /**
   * Updates the visual indentation of a block based on its depth in the hierarchy.
   * @param block - the block to update indentation for
   */
  public updateBlockIndentation(block: Block): void {
    return this.hierarchy.updateBlockIndentation(block);
  }

  /**
   * Get Block instance by html element
   */
  public getBlock(element: HTMLElement): Block | undefined {
    return this.repository.getBlock(element);
  }

  /**
   * 1) Find first-level Block from passed child Node
   * 2) Mark it as current
   */
  public setCurrentBlockByChildNode(childNode: Node): Block | undefined {
    /**
     * Find the block whose holder contains this child node.
     * Uses the blocks array (not DOM children of the working area)
     * so that blocks inside table cells are found correctly.
     */
    const block = this.repository.getBlockByChildNode(childNode);

    if (!block) {
      return undefined;
    }

    /**
     * Support multiple Blok instances,
     * by checking whether the found block belongs to the current instance
     */
    const blokWrapper = block.holder.closest(`[${DATA_ATTR.editor}]`);
    const wrapper = this.Blok.UI.nodes.wrapper;
    const isBlockBelongsToCurrentInstance = blokWrapper?.isEqualNode(wrapper);

    if (!isBlockBelongsToCurrentInstance) {
      return undefined;
    }

    this.currentBlockIndex = this.repository.getBlockIndex(block);

    block.updateCurrentInput();

    return block;
  }

  /**
   * Return block which contents passed node
   */
  public getBlockByChildNode(childNode: Node): Block | undefined {
    return this.repository.getBlockByChildNode(childNode);
  }

  /**
   * Move a block to a new index
   */
  public move(toIndex: number, fromIndex: number = this.currentBlockIndex, skipDOM = false, skipMovedHook = false): void {
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    this.operations.move(toIndex, fromIndex, skipDOM, this.blocksStore, skipMovedHook);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;
  }

  /**
   * Converts passed Block to the new Tool
   * @param block - Block to convert
   * @param targetToolName - Tool to convert to
   * @param blockDataOverrides - optional new Block data overrides
   * @param options - options.skipSectionAdoption disables the toggle-heading
   *   section adoption; the multi-select convert loop passes it so each block
   *   in the selection becomes its OWN toggle heading instead of the earlier
   *   conversions swallowing the later ones.
   */
  public async convert(
    block: Block,
    targetToolName: string,
    blockDataOverrides?: BlockToolData,
    options: { skipSectionAdoption?: boolean } = {}
  ): Promise<Block> {
    /**
     * Notion parity: turning a TOGGLE HEADING into a non-toggle target via the
     * "Turn into" menu must RELEASE its children as following siblings — exactly
     * what the "Toggle heading" tune switch already does (setToggleable(false) →
     * releaseChildrenAsSiblings). Without this, the generic convert() → replace()
     * path RE-NESTS the children under the now-plain heading, so the two UIs
     * disagree. Notion releases heading children on this conversion.
     *
     * Notion parity M-5: a TOGGLE LIST (the standalone `toggle` tool) is the
     * opposite — converting it to a non-toggle type keeps its children NESTED one
     * level under the new block; only the collapse affordance disappears. So the
     * toggle-list source must fall through to the generic convert() → replace()
     * path, which re-nests children (block-mutation.replace → reparentChildren).
     *
     * Both sources render the same `data-blok-toggle-open` marker, so the
     * heading-only release is gated additionally on the source NOT being the
     * toggle-list tool. (callout/column render no toggle marker at all.)
     */
    const sourceIsToggle = block.holder.querySelector('[data-blok-toggle-open]') !== null;
    const sourceIsToggleList = block.name === TOGGLE_TOOL_NAME;
    const targetIsToggleHeader = targetToolName === 'header' && blockDataOverrides?.isToggleable === true;

    if (sourceIsToggle && !sourceIsToggleList && !targetIsToggleHeader) {
      this.releaseChildrenToRoot(block);
    }

    const newBlock = await this.operations.convert(block, targetToolName, this.blocksStore, blockDataOverrides);

    /**
     * Notion parity, the ON direction: turning a NON-toggle block into a toggle
     * heading adopts its whole section — every following sibling until the next
     * heading of the same or higher rank — as children ("all of the content
     * within those headings will now be collapsible"). Sources that are already
     * a toggle (toggle heading level change, toggle list) keep exactly the
     * children they had and adopt nothing new.
     */
    if (targetIsToggleHeader && !sourceIsToggle && options.skipSectionAdoption !== true) {
      this.adoptFollowingSectionIntoToggleHeading(newBlock);
    }

    return newBlock;
  }

  /**
   * Move every following sibling of `toggleHeading` — up to, but not including,
   * the next heading of the same or higher rank — inside it, in document order.
   *
   * Siblings are the flat-array followers sharing the heading's `parentId`, so
   * a heading inside a column adopts only within that column. A descendant of
   * an adopted sibling (or a child the convert already re-nested onto the new
   * heading) rides along with its container and is never reparented directly.
   * @param toggleHeading - the freshly converted toggle heading block
   */
  private adoptFollowingSectionIntoToggleHeading(toggleHeading: Block): void {
    const level = this.resolveHeadingLevel(toggleHeading);

    if (level === null) {
      return;
    }

    const flat = this.blocks;
    const startIndex = flat.indexOf(toggleHeading);

    if (startIndex === -1) {
      return;
    }

    const sectionParentId = toggleHeading.parentId ?? null;
    const sectionIds = new Set<string>([toggleHeading.id]);
    const siblingsToAdopt: Block[] = [];

    for (const candidate of flat.slice(startIndex + 1)) {
      const candidateParentId = candidate.parentId ?? null;

      if (candidateParentId !== null && sectionIds.has(candidateParentId)) {
        sectionIds.add(candidate.id);
        continue;
      }

      if (candidateParentId !== sectionParentId) {
        break;
      }

      const candidateLevel = this.resolveHeadingLevel(candidate);

      if (candidateLevel !== null && candidateLevel <= level) {
        break;
      }

      siblingsToAdopt.push(candidate);
      sectionIds.add(candidate.id);
    }

    if (siblingsToAdopt.length === 0) {
      return;
    }

    /**
     * A bare setBlockParent loop splits across two history stacks (the move
     * stack plus the parentId/contentIds writes on Y.UndoManager), so undoing
     * the convert would leave the section nested under a PLAIN heading.
     * transactMoves attaches the parent writes to one atomic move entry —
     * same wrapper Tab-indent and drag-drop use.
     */
    const { YjsManager } = this.Blok;
    const applyAdoption = (): void => {
      for (const sibling of siblingsToAdopt) {
        this.setBlockParent(sibling, toggleHeading.id);
      }
    };

    if (typeof YjsManager?.transactMoves === 'function') {
      YjsManager.transactMoves(applyAdoption);
    } else {
      applyAdoption();
    }
  }

  /**
   * Read a header block's level from its rendered <hN> tag. The block's own
   * heading element always precedes any child header's in document order, so
   * the first match is the block's own. Returns null for non-header blocks.
   * @param block - block whose heading level to read
   */
  private resolveHeadingLevel(block: Block): number | null {
    if (block.name !== 'header') {
      return null;
    }

    const heading = block.holder.querySelector('h1, h2, h3, h4, h5, h6');

    return heading !== null ? Number(heading.tagName.charAt(1)) : null;
  }

  /**
   * Release every child of `block` to the document root (parentId = null) via the
   * Yjs-correct `setBlockParent`, as following siblings. Snapshot the ids first
   * since `setBlockParent` mutates the parent's contentIds while iterating.
   * @param block - the (toggle) container whose children are released
   */
  private releaseChildrenToRoot(block: Block): void {
    for (const childId of [...block.contentIds]) {
      const child = this.getBlockById(childId);

      if (child !== undefined) {
        this.setBlockParent(child, null);
      }
    }
  }

  /**
   * Sets current Block Index -1 which means unknown
   * and clear highlights
   */
  public unsetCurrentBlock(): void {
    this.currentBlockIndex = -1;
  }

  /**
   * Clears Blok
   * @param needToAddDefaultBlock - insert an empty default block afterwards
   * @param options - clear behaviour
   * @param options.skipYjsSync - tear down the rendered blocks only, leaving
   *   the Yjs document (and the undo history) untouched. For view rebuilds
   *   that render the very same blocks again — see `repaintBlocks`.
   */
  public async clear(
    needToAddDefaultBlock = false,
    { skipYjsSync = false }: { skipYjsSync?: boolean } = {}
  ): Promise<void> {
    // Create a copy of the blocks array to avoid issues with array modification during iteration
    const blocksToRemove = [...this.blocks];
    const blockIds = blocksToRemove.map(block => block.id);

    // Generate ID for default block if needed (so we can include it in the transaction)
    const defaultBlockId = needToAddDefaultBlock ? generateBlockId() : undefined;
    const defaultToolName = this.config.defaultBlock;

    // Single Yjs transaction for all removals + default block add (single undo entry)
    const syncRemovalsToYjs = (): void => this.Blok.YjsManager.transact(() => {
      for (const id of blockIds) {
        this.Blok.YjsManager.removeBlock(id);
      }

      // Include default block in transaction so undo removes it along with restoring original blocks
      if (needToAddDefaultBlock && defaultBlockId !== undefined && defaultToolName !== undefined) {
        this.Blok.YjsManager.addBlock({
          id: defaultBlockId,
          type: defaultToolName,
          data: {},
        }, 0);
      }
    });

    if (!skipYjsSync) {
      syncRemovalsToYjs();
    }

    // DOM cleanup (skip Yjs sync — already done above)
    for (const block of blocksToRemove) {
      const index = this.getBlockIndex(block);

      if (index !== -1) {
        this.blocksStore.remove(index);

        // Emit BlockRemoved event so onChange gets notified
        this.blockDidMutated(BlockRemovedMutationType, block, {
          index,
        });
      }
    }

    this.unsetCurrentBlock();

    if (needToAddDefaultBlock && defaultBlockId !== undefined) {
      // Insert with skipYjsSync since we already synced in the transaction above
      this.insert({ id: defaultBlockId, skipYjsSync: true });
    }

    /**
     * Add empty modifier
     */
    this.Blok.UI.checkEmptiness();
  }

  /**
   * Moves the current block up by one position
   */
  public moveCurrentBlockUp(): void {
    /**
     * Layer 21: block move shortcuts while a drag is in progress.
     *
     * Regression: "wrong block dropped" family. Cmd/Ctrl+Shift+ArrowUp routes
     * through BlockShortcuts → this method → BlockOperations.moveCurrentBlockUp,
     * which mutates the flat blocks array. If DragController is mid-drag (it
     * holds live source/target Block references captured on dragstart), the
     * array reshuffle leaves its stored indices pointing at the wrong rows
     * and handleDrop silently drops an unrelated block.
     *
     * Mirrors the Cmd+Z-during-drag guard (layer 18) and the paste-during-drag
     * guard (layer 20): swallow the shortcut so the drag completes cleanly,
     * then the user can retry the move.
     */
    if (this.Blok.DragManager?.isDragging) {
      return;
    }

    const selectedBlocks = this.selectedBlocksForMove();

    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    this.operations.moveCurrentBlockUp(this.blocksStore, selectedBlocks);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;

    this.reselectAfterMove(selectedBlocks);
  }

  /**
   * Moves the current block down by one position
   */
  public moveCurrentBlockDown(): void {
    // Layer 21: see moveCurrentBlockUp above for rationale.
    if (this.Blok.DragManager?.isDragging) {
      return;
    }

    const selectedBlocks = this.selectedBlocksForMove();

    this._currentBlockIndex = this.operations.currentBlockIndexValue;
    this.operations.moveCurrentBlockDown(this.blocksStore, selectedBlocks);
    this._currentBlockIndex = this.operations.currentBlockIndexValue;

    this.reselectAfterMove(selectedBlocks);
  }

  /**
   * Block-level selection that a keyboard move should carry as one group, or
   * undefined for a plain caret move. Returns the selected blocks in document
   * order so the move resolves a contiguous span.
   */
  private selectedBlocksForMove(): Block[] | undefined {
    const { BlockSelection } = this.Blok;

    if (BlockSelection === undefined || !BlockSelection.anyBlockSelected) {
      return undefined;
    }

    const selected = BlockSelection.selectedBlocks;

    return selected.length > 0 ? selected : undefined;
  }

  /**
   * Re-applies block-level selection to the moved blocks so a multi/single
   * block selection survives the move and the user can repeat the shortcut.
   * No-op for caret moves (selectedBlocks undefined).
   * @param selectedBlocks - the selection captured before the move
   */
  private reselectAfterMove(selectedBlocks: Block[] | undefined): void {
    if (selectedBlocks === undefined) {
      return;
    }

    const { BlockSelection } = this.Blok;

    for (const block of selectedBlocks) {
      BlockSelection.selectBlock(block);
    }
  }

  /**
   * Duplicate the current block (or the whole block selection) right below it,
   * carrying nested children/flat-indent followers — Notion's Cmd/Ctrl+D. Reuses
   * the drag module's duplicate pipeline so saves, deep-clones and internal
   * reparenting stay consistent with alt-drag duplication.
   */
  public duplicateCurrentBlock(): void {
    // Layer 21: see moveCurrentBlockUp above — never mutate mid-drag.
    if (this.Blok.DragManager?.isDragging) {
      return;
    }

    const { BlockSelection } = this.Blok;
    const selected = BlockSelection.selectedBlocks;
    const anchor = BlockSelection.anyBlockSelected
      ? selected[selected.length - 1]
      : this.currentBlock;

    if (anchor === undefined) {
      return;
    }

    void this.Blok.DragManager?.duplicateBlocksInPlace(anchor);
  }

  /**
   * Cleans up all the block tools' resources
   */
  public async destroy(): Promise<void> {
    // Unregister keyboard shortcuts
    this.shortcuts.unregister();

    // Before the blocks go: a reconcile queued for the current batch would
    // otherwise run against the half-dismantled DOM below.
    this.yjsSync.destroy();

    await Promise.all(this.blocks.map((block) => {
      return block.destroy();
    }));
  }

  /**
   * Bind Block events
   */
  private bindBlockEvents(block: Block): void {
    this.eventBinder.bindBlockEvents(block);
  }

  /**
   * Block mutation callback
   */
  private blockDidMutated<Type extends BlockMutationType>(
    mutationType: Type,
    block: Block,
    detailData: BlockMutationEventDetailWithoutTarget<Type>
  ): Block {
    const eventDetail = {
      target: new BlockAPI(block, this.Blok.API),
      ...detailData,
    };

    const event = new CustomEvent(mutationType, {
      detail: {
        ...eventDetail,
      },
    });

    /**
     * The CustomEvent#type getter is not enumerable by default, so it gets lost during structured cloning.
     * Define it explicitly to keep the type available for consumers like Playwright tests.
     */
    if (!Object.prototype.propertyIsEnumerable.call(event, 'type')) {
      Object.defineProperty(event, 'type', {
        value: mutationType,
        enumerable: true,
        configurable: true,
      });
    }

    /**
     * CustomEvent#detail is also non-enumerable, so preserve it for consumers outside of the browser context.
     */
    if (!Object.prototype.propertyIsEnumerable.call(event, 'detail')) {
      Object.defineProperty(event, 'detail', {
        value: eventDetail,
        enumerable: true,
        configurable: true,
      });
    }

    this.eventsDispatcher.emit(BlockChanged, {
      event: event as BlockMutationEventMap[Type],
    });

    // Sync content changes to Yjs for undo/redo support
    // Skip if we're currently syncing from Yjs (undo/redo) to avoid corrupting the undo stack.
    // Also skip if a pointer drag is active — the browser can mutate contenteditable DOM across
    // cell boundaries during a drag, and we must not write that corrupted state to Yjs.
    if (mutationType === BlockChangedMutationType && !this.yjsSync.isSyncingFromYjs && !this._isPointerDragActive) {
      void this.syncBlockDataToYjs(block);
    }

    return block;
  }

  /**
   * insertMany helper: fills parent.contentIds from child.parentId.
   *
   * Hierarchical input JSON may carry `parent` on children without a matching
   * `content` on the parent (valid hierarchical data, but leaves the parent's
   * contentIds empty after composeBlock). Downstream code treats
   * `parent.contentIds` as the authoritative child list, so reconciling here
   * makes the invariant `child.parentId ⇒ parent.contentIds.includes(child.id)`
   * hold from the moment blocks enter the editor.
   *
   * If a child's parentId points to a block id that is not in the input, the
   * parentId is cleared — matching the editor's pre-existing permissive
   * behaviour of dropping dangling cross-references so the subsequent Fix 3
   * `assertHierarchy` pass can run on a consistent snapshot.
   * @param blocks - blocks being inserted
   * @param blockById - id→block lookup built from `blocks`
   */
  private reconcileChildrenToParents(blocks: Block[], blockById: Map<string, Block>): void {
    for (const block of blocks) {
      if (block.parentId === null) {
        continue;
      }
      const parent = blockById.get(block.parentId);

      if (parent === undefined) {
        // Dangling parentId: the referenced parent is missing from the input.
        // Clear the orphan reference so the block becomes root-level instead
        // of carrying a stale pointer into the editor state.
        block.parentId = null;

        continue;
      }
      if (!parent.contentIds.includes(block.id)) {
        parent.contentIds.push(block.id);
      }
    }
  }

  /**
   * Fix 2: inverse reconcile — sanitise parent.contentIds against the children.
   *
   * The symmetric case: a parent with `content: ['c1']` whose child c1 has no
   * `parent` field (or points at a different parent). Child is the source of
   * truth, because the block physically carries the back-pointer downstream.
   * For every parent→child claim:
   *   - child missing from the input: drop the dangling id from parent.contentIds
   *   - child has no parentId: set child.parentId = parent.id (keep the claim)
   *   - child has a different parentId: trust the child, sanitise the parent
   * @param blocks - blocks being inserted
   * @param blockById - id→block lookup built from `blocks`
   */
  private reconcileParentsToChildren(blocks: Block[], blockById: Map<string, Block>): void {
    for (const block of blocks) {
      if (block.contentIds.length === 0) {
        continue;
      }
      block.contentIds = block.contentIds.filter((childId) =>
        this.resolveChildForParent(block, childId, blockById)
      );
    }
  }

  /**
   * Fix 2 helper: decide whether a parent.contentIds entry should be kept.
   *
   * Side effect: when a child exists and has no parentId, its parentId is set
   * to the claiming parent id (keeping the entry in the parent's contentIds).
   * @param parent - the parent block whose contentIds we are sanitising
   * @param childId - candidate child id from parent.contentIds
   * @param blockById - id→block lookup built from the insertMany input
   * @returns true when the child id should remain in parent.contentIds
   */
  private resolveChildForParent(
    parent: Block,
    childId: string,
    blockById: Map<string, Block>
  ): boolean {
    const child = blockById.get(childId);

    if (child === undefined) {
      return false;
    }
    if (child.parentId === null) {
      child.parentId = parent.id;

      return true;
    }

    return child.parentId === parent.id;
  }

  /**
   * Fix 3: assert the hierarchy invariant before handing the blocks off to Yjs.
   *
   * Matches the saver pattern (`saver.ts:287-295`): in test and development
   * builds, any residual drift throws loudly so the regression is caught at
   * the point of introduction; in production we only log, so an edge-case
   * drift never breaks user loads.
   * @param blocks - the fully reconciled blocks about to be handed to Yjs
   */
  private assertInsertManyHierarchy(blocks: Block[]): void {
    const snapshot: OutputBlockData[] = blocks.map((block) => ({
      id: block.id,
      type: block.name,
      data: {},
      ...(block.parentId !== null && { parent: block.parentId }),
      ...(block.contentIds.length > 0 && { content: block.contentIds }),
    }));
    const env = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;

    if (env === 'test' || env === 'development') {
      assertHierarchy(snapshot, 'BlockManager.insertMany');

      return;
    }
    const violations = validateHierarchy(snapshot);

    if (violations.length === 0) {
      return;
    }
    const summary = violations.map((v) => v.message).join('; ');

    logLabeled(`BlockManager.insertMany produced output with hierarchy drift: ${summary}`, 'error');
  }

  /**
   * Schedule a deferred sync of a parent block's data to Yjs.
   * Uses queueMicrotask to batch multiple parent changes (e.g. when initializing
   * all cells in a new table row) into a single flush.
   */
  private scheduleParentSync(parentId: string): void {
    if (this.parentsSyncScheduled.size === 0) {
      queueMicrotask(() => this.flushParentSyncs());
    }
    this.parentsSyncScheduled.add(parentId);
  }

  /**
   * Flush all scheduled parent syncs to Yjs.
   * Called from the microtask scheduled by scheduleParentSync.
   */
  private flushParentSyncs(): void {
    const promises: Promise<void>[] = [];

    for (const parentId of this.parentsSyncScheduled) {
      const parent = this.repository.getBlockById(parentId);

      if (parent !== undefined) {
        promises.push(this.syncBlockDataToYjs(parent));
      }
    }
    this.parentsSyncScheduled.clear();

    if (promises.length > 0) {
      this.pendingParentSyncPromise = Promise.all(promises).then(() => {
        this.pendingParentSyncPromise = null;
      });
    }
  }

  /**
   * Sync block data to Yjs after DOM mutation.
   *
   * The save() + equality diff stay per-mutation, but the resulting writes go
   * through YjsManager's coalescing buffer: the first write of an idle block
   * flushes immediately (today's timing), follow-ups coalesce into one trailing
   * flush per 400ms window. `flushBlockDataWrites` is the flush body.
   */
  private async syncBlockDataToYjs(block: Block): Promise<void> {
    const savedData = await block.save();

    if (savedData === undefined) {
      return;
    }

    this.Blok.YjsManager.enqueueBlockDataWrite(block.id, savedData.data, (entries) => {
      return this.flushBlockDataWrites(block, entries);
    });
  }

  /**
   * Flush body for coalesced block data writes.
   *
   * Only writes metadata (lastEditedAt / lastEditedBy) if at least one data field
   * actually changed. This preserves the invariant "no data change → no Yjs write →
   * no undo entry." Without this guard, a spurious metadata-only transaction lands
   * on the Yjs undo stack after every user operation, causing a single CMD+Z to pop
   * only the metadata entry instead of the actual data change.
   * @param block - the block whose buffered writes are being flushed
   * @param entries - coalesced {key → latest value} data entries
   * @returns whether any Yjs write actually happened — the buffer skips its
   *   capture-clock rewind for a flush that wrote nothing (see BlockWriteBuffer).
   */
  private flushBlockDataWrites(block: Block, entries: ReadonlyMap<string, unknown>): boolean {
    // Wrap data + metadata writes into a single Yjs transaction. Without this,
    // each updateBlockData / updateBlockMetadata call opens its own transaction
    // and fires a stack-item-added event, which runs caret capture that may
    // trigger stopCapturing() as a side effect — splitting a single logical
    // save across multiple undo groups (so a single CMD+Z only reverts the
    // metadata bump instead of the data change).
    const dataChangedRef = { value: false };

    this.Blok.YjsManager.transact(() => {
      for (const [key, value] of entries) {
        // A list item structurally nested under another list item derives its
        // `depth` from the parentId chain (getStructuralListDepth), so persisting
        // depth to the CRDT is redundant — and harmful: the derived value lands as
        // a TRACKED write that pollutes the undo stack with a stray "depth-mirror"
        // entry a Cmd+Z would pop instead of the real structural move (the bug
        // behind "undo after Tab indentation restores original depth"). save()
        // still reports depth for the public output and reload re-derives it from
        // structure, so skipping the CRDT write is safe. Flat-carrier list items
        // (authored/drag-nested via data.depth with no LIST parent) keep depth as
        // their source of truth and are left untouched. Evaluated at FLUSH so a
        // Tab-nesting that happened mid-window uses the block's current parent.
        if (key === 'depth' && this.isStructurallyNestedListItem(block)) {
          continue;
        }

        if (this.Blok.YjsManager.updateBlockData(block.id, key, value)) {
          dataChangedRef.value = true;
        }
      }

      if (!dataChangedRef.value) {
        return;
      }

      // Bump edit metadata only when data actually changed, so we don't add
      // a spurious metadata-only entry to the Yjs undo stack.
      // eslint-disable-next-line no-param-reassign
      block.lastEditedAt = Date.now();
      // eslint-disable-next-line no-param-reassign
      block.lastEditedBy = this.config.user?.id ?? null;

      this.Blok.YjsManager.updateBlockMetadata(block.id, block.lastEditedAt, block.lastEditedBy);
    });

    return dataChangedRef.value;
  }

  /**
   * True when `block` is a list item nested directly under ANOTHER list item —
   * i.e. its `depth` is derived from the structural parentId chain rather than an
   * authored flat carrier. A list item at the root or directly inside a non-list
   * container (column, table cell) keeps `depth` as its own source of truth and
   * is NOT considered structurally nested here.
   * @param block - the block to test
   * @returns whether the block's list depth is structurally derived
   */
  private isStructurallyNestedListItem(block: Block): boolean {
    if (block.name !== 'list' || block.parentId === null) {
      return false;
    }

    return this.repository.getBlockById(block.parentId)?.name === 'list';
  }
}
