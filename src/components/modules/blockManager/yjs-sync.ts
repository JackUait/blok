/**
 * @class BlockYjsSync
 * @classdesc Handles Yjs synchronization for blocks
 * @module BlockYjsSync
 */
import { Array as YArray } from 'yjs';
import type { Map as YMap } from 'yjs';

import type { BlockToolData, SanitizerConfig } from '../../../../types';
import { BlockToolAPI } from '../../block';
import type { Block } from '../../block';
import { logLabeled } from '../../utils';
import { moveElementAfter, moveElementBefore } from '../../utils/html';
import { sanitizeBlocks, stripUnsafeUrlsDeep } from '../../utils/sanitizer';
import type { YjsManager } from '../yjs';
import type { BlockChangeEvent } from '../yjs/types';

import type { BlockFactory } from './factory';
import type { BlockOperations } from './operations';
import type { BlockRepository } from './repository';
import type { BlocksStore } from './types';


/**
 * Dependencies needed by BlockYjsSync
 */
export interface BlockYjsSyncDependencies {
  /** YjsManager instance */
  YjsManager: YjsManager;
  /** BlockOperations instance for suppressing stopCapturing during atomic operations */
  operations?: BlockOperations;
  /** Editor-level sanitizer config (`config.sanitizer`), applied to remote block data */
  sanitizer?: SanitizerConfig;
  /**
   * Effective read-only state of the editor, read lazily at the moment it
   * matters. Read-only is the ARBITRATED answer — the host's own wish OR
   * collaboration's veto (unsynced, write-denied, terminally disconnected) —
   * so this one lever also covers a write-denied collaboration member.
   * Omitted in harnesses; absent means "writable".
   */
  isReadOnly?: () => boolean;
}

/**
 * Sync handler callbacks for DOM updates
 */
export interface SyncHandlers {
  /** Called when a block needs to be added to DOM */
  addToDom: (block: Block, index: number) => void;
  /** Called when a block needs to be removed from DOM */
  removeFromDom: (index: number) => void;
  /** Called when blocks need to be reordered */
  moveInDom: (toIndex: number, fromIndex: number) => void;
  /** Called to get current block index */
  getBlockIndex: (block: Block) => number;
  /**
   * Called to insert a default block. `id` pins the new block's id — the
   * remove-the-last-block auto-repair derives a deterministic one so two peers
   * reacting to the same removal converge on ONE block.
   */
  insertDefaultBlock: (skipYjsSync: boolean, id?: string) => Block;
  /** Called to update block indentation */
  updateIndentation: (block: Block) => void;
  /** Called to set the parent of a block, updating contentIds and DOM placement */
  setBlockParent: (block: Block, parentId: string | null) => void;
  /** Called to replace a block at a specific index with a new block instance */
  replaceBlock: (index: number, newBlock: Block) => void;
  /** Called when a block is removed during undo/redo (before DOM removal) */
  onBlockRemoved: (block: Block, index: number) => void;
  /** Called when a block is added during undo/redo (after insertion) */
  onBlockAdded: (block: Block, index: number) => void;
}

/**
 * BlockYjsSync handles synchronization between DOM blocks and Yjs document
 */
export class BlockYjsSync {
  private readonly dependencies: BlockYjsSyncDependencies;
  private readonly repository: BlockRepository;
  private readonly factory: BlockFactory;
  private readonly handlers: SyncHandlers;

  /**
   * Counter to track active Yjs sync operations (undo/redo) to prevent re-syncing back.
   * Uses a counter instead of boolean to handle overlapping async operations safely.
   */
  private yjsSyncCount = 0;

  /**
   * Returns true if any Yjs sync operation is in progress
   */
  public get isSyncingFromYjs(): boolean {
    return this.yjsSyncCount > 0;
  }

  /**
   * Flag to prevent multiple move syncs in the same event batch
   */
  private moveSyncScheduled = false;

  /**
   * Flag to prevent multiple holder-order reconciles in the same event batch
   */
  private orderReconcileScheduled = false;

  /**
   * Whether the current event batch removed a block. Only a removal can promote
   * a surviving descendant back to root and strand its holder, so the holder
   * auto-fix runs ONLY for remove-driven batches. Reconstruction batches
   * (add/batch-add during redo) settle their own DOM across a RAF; reordering
   * holders mid-rebuild corrupts the layout, so they are never auto-moved here.
   */
  private batchHadRemove = false;

  /**
   * Parents a replay reparent moved a block into during the current event
   * batch (null = root). `setBlockParent` APPENDS the holder, so a replay that
   * restores a block to a mid-container slot lands it visually last while the
   * flat array (already re-ordered from the doc) says otherwise. Only these
   * groups get the holder fix — a reconstruction batch's other containers are
   * still settling their own DOM and must not be touched (see batchHadRemove).
   */
  private readonly batchReparentedInto = new Set<string | null>();

  /**
   * Unsubscribe handle for the Yjs change subscription, released on destroy.
   */
  private unsubscribeFromYjs: (() => void) | null = null;

  /**
   * Set once the owning BlockManager is torn down.
   */
  private destroyed = false;

  /**
   * Blocks store access
   */
  private blocksStore: BlocksStore;

  /**
   * @param dependencies - YjsManager and other dependencies
   * @param repository - BlockRepository for block lookups
   * @param factory - BlockFactory for creating blocks
   * @param handlers - Callbacks for DOM updates
   * @param blocksStore - The blocks store
   */
  constructor(
    dependencies: BlockYjsSyncDependencies,
    repository: BlockRepository,
    factory: BlockFactory,
    handlers: SyncHandlers,
    blocksStore: BlocksStore
  ) {
    this.dependencies = dependencies;
    this.repository = repository;
    this.factory = factory;
    this.handlers = handlers;
    this.blocksStore = blocksStore;
  }

  /**
   * Execute a function within a sync context where:
   * - Yjs auto-sync is suppressed (DOM changes won't trigger sync back to Yjs)
   * - stopCapturing is suppressed (block index changes won't break undo grouping)
   *
   * Use this for operations that need to update both Yjs and DOM atomically.
   *
   * @param fn - Function to execute
   * @param options - Options for controlling the atomic operation behavior
   */
  /**
   * Begin an atomic operation by incrementing sync count and suppressing stop capturing.
   *
   * @returns cleanup function to call when operation completes
   */
  private beginAtomicOperation(): () => void {
    this.yjsSyncCount++;
    const operations = this.dependencies.operations;

    if (operations) {
      operations.suppressStopCapturing = true;
    }

    return (): void => {
      this.yjsSyncCount--;
      if (operations && this.yjsSyncCount === 0) {
        operations.suppressStopCapturing = false;
      }
    };
  }

  /**
   * End an atomic operation, optionally deferring cleanup through RAF.
   *
   * @param cleanup - function to call to decrement sync count
   * @param extendThroughRAF - if true, defer cleanup until after next animation frame
   */
  private endAtomicOperation(cleanup: () => void, extendThroughRAF: boolean): void {
    if (extendThroughRAF) {
      requestAnimationFrame(cleanup);
    } else {
      cleanup();
    }
  }

  public withAtomicOperation<T>(fn: () => T, options?: { extendThroughRAF?: boolean }): T {
    const cleanup = this.beginAtomicOperation();

    try {
      const result = fn();

      // If extendThroughRAF is true, delay decrementing yjsSyncCount until after requestAnimationFrame callbacks
      // This ensures that DOM updates scheduled by rendered() hooks don't trigger
      // block data sync to Yjs, which would create new undo entries and clear the redo stack
      this.endAtomicOperation(cleanup, options?.extendThroughRAF === true);

      return result;
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  /**
   * Async version of withAtomicOperation for operations that return promises.
   * Keeps yjsSyncCount elevated until the async work completes, then optionally
   * extends through RAF to cover deferred DOM callbacks.
   *
   * @param fn - Async function to execute
   * @param options - Options for controlling the atomic operation behavior
   */
  public async withAtomicOperationAsync(
    fn: () => Promise<void>,
    options?: { extendThroughRAF?: boolean }
  ): Promise<void> {
    const cleanup = this.beginAtomicOperation();

    try {
      await fn();
      this.endAtomicOperation(cleanup, options?.extendThroughRAF === true);
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  /**
   * Subscribe to Yjs changes for undo/redo and remote DOM synchronization.
   *
   * Accepts undo/redo (local-history replay) AND remote origins (changes
   * from other clients). Local-origin events are filtered because the
   * in-memory state was already mutated before the Yjs write landed —
   * re-applying would thrash DOM and undo stacks.
   *
   * @returns unsubscribe function
   */
  public subscribe(): () => void {
    this.unsubscribeFromYjs = this.dependencies.YjsManager.onBlocksChanged((event: BlockChangeEvent) => {
      if (
        event.origin === 'undo' ||
        event.origin === 'redo' ||
        event.origin === 'remote'
      ) {
        this.syncBlockFromYjs(event);
      }
    });

    return this.unsubscribeFromYjs;
  }

  /**
   * Release the Yjs subscription and disarm any reconcile still queued for the
   * current batch. A torn-down editor has nothing to reconcile, and its dev
   * tripwire would read a half-dismantled DOM and throw with no test owning it.
   */
  public destroy(): void {
    this.destroyed = true;
    this.unsubscribeFromYjs?.();
    this.unsubscribeFromYjs = null;
  }

  /**
   * Sync a block from Yjs data after undo/redo (or a remote change).
   *
   * Every event type ends by scheduling a holder-order reconcile: any undo,
   * redo, or remote teardown/rebuild can leave a block's holder at a DOM
   * position that no longer matches the (authoritative) block array — and
   * blocksStore.move() can't catch it because it keys on the array index, which
   * is already correct. The reconcile is the single chokepoint that re-asserts
   * DOM order against the array, then asserts the invariant in dev/test.
   *
   * @param event - the block change event from YjsManager
   */
  private syncBlockFromYjs(event: BlockChangeEvent): void {
    if (event.type === 'update') {
      this.handleYjsUpdate(event.blockId);
    } else if (event.type === 'move') {
      this.handleYjsMove();
    } else if (event.type === 'add') {
      this.handleYjsAdd(event.blockId);
    } else if (event.type === 'batch-add') {
      this.handleYjsBatchAdd(event.blockIds);
    } else if (event.type === 'remove') {
      this.handleYjsRemove(event.blockId);
      this.batchHadRemove = true;
    }

    this.scheduleHolderReconcile();
  }

  /**
   * Schedule a single holder-order reconcile + invariant check for the current
   * event batch. Debounced via a microtask so a multi-event sync (e.g. a
   * column_list + its columns being torn down) settles exactly once, after the
   * block array and parent relationships have stabilised.
   *
   * The auto-fix only runs for remove-driven batches (see {@link batchHadRemove})
   * — the proven, safe case. The invariant check runs for EVERY batch: it never
   * touches the DOM, so it can't disturb a redo reconstruction, but it WILL trip
   * a test the instant any sync leaves the holder order diverged from the array.
   */
  private scheduleHolderReconcile(): void {
    if (this.orderReconcileScheduled) {
      return;
    }

    this.orderReconcileScheduled = true;

    queueMicrotask(() => {
      this.orderReconcileScheduled = false;

      if (this.destroyed) {
        return;
      }

      const shouldFix = this.batchHadRemove;
      const reparentedInto = [ ...this.batchReparentedInto ];

      this.batchHadRemove = false;
      this.batchReparentedInto.clear();

      // Run inside an atomic operation so the holder moves don't echo back to
      // Yjs as fresh local writes (which would pollute the undo/redo stacks).
      this.withAtomicOperation(() => {
        if (shouldFix) {
          this.reconcileHolderOrder();
        } else {
          reparentedInto.forEach((parentId) => this.reconcileHolderOrderForParent(parentId));
        }

        this.assertDomOrderInvariantInDev('yjs-sync reconcile');
      });
    });
  }

  /**
   * Re-assert that every block's holder sits in document order matching the
   * block array, scoped to true DOM siblings.
   *
   * Blocks are grouped by `parentId` (preserving array order); within each
   * group the holders must appear in document order. Any holder that drifted
   * is moved back into place. The `parentElement` guard means ONLY genuine DOM
   * siblings are ever reordered — a stray holder can never be yanked across a
   * container boundary here, so the pass is safe for every tool (columns,
   * toggles, tables, databases) regardless of how each manages its own subtree.
   *
   * This repairs the model-vs-DOM divergence left when an undo/redo/remote sync
   * promotes or relocates a block but leaves its holder at the position it held
   * in the now-changed structure: the array order is authoritative, the holder
   * position is not.
   */
  private reconcileHolderOrder(): void {
    for (const siblings of this.groupByParent().values()) {
      this.reconcileSiblingOrder(siblings);
    }
  }

  /**
   * The same re-assertion, scoped to ONE parent's children (null = root).
   *
   * @param parentId - the parent whose children just took a replay reparent
   */
  private reconcileHolderOrderForParent(parentId: string | null): void {
    const siblings = this.groupByParent().get(parentId);

    if (siblings !== undefined) {
      this.reconcileSiblingOrder(siblings);
    }
  }

  /**
   * Re-assert document order within a single group of true DOM siblings,
   * moving any holder that drifted back after its array-order predecessor.
   */
  private reconcileSiblingOrder(siblings: Block[]): void {
    siblings.slice(1).forEach((block, index) => {
      const prevHolder = siblings[index].holder;
      const currHolder = block.holder;

      if (prevHolder.parentElement === null || currHolder.parentElement !== prevHolder.parentElement) {
        return;
      }

      if ((prevHolder.compareDocumentPosition(currHolder) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) {
        moveElementAfter(currHolder, prevHolder);
      }
    });
  }

  /**
   * Dev/test tripwire: throw if any block's holder is out of document order
   * relative to its array-order sibling. This is the DOM-order analogue of
   * assertHierarchyInvariantInDev — it catches a model-vs-DOM divergence at the
   * point of introduction (a failing test) instead of as a silent visual bug
   * the user only sees after an undo. No-op outside test/development.
   *
   * @param context - label of the sync that just ran (for error messages)
   */
  private assertDomOrderInvariantInDev(context: string): void {
    const env = typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined;

    if (env !== 'test' && env !== 'development') {
      return;
    }

    const violations: string[] = [];

    for (const siblings of this.groupByParent().values()) {
      violations.push(...this.collectDomOrderViolations(siblings));
    }

    if (violations.length === 0) {
      return;
    }

    throw new Error(
      `Block DOM order diverged from the block array after ${context}:\n${violations.join('\n')}`
    );
  }

  /**
   * Collect DOM-order violations within a single group of array-order siblings.
   * Only genuine DOM siblings are compared — cross-container placement is a
   * hierarchy concern covered by assertHierarchyInvariantInDev, not a
   * sibling-order one.
   */
  private collectDomOrderViolations(siblings: Block[]): string[] {
    return siblings.slice(1).reduce<string[]>((violations, curr, index) => {
      const prev = siblings[index];
      const prevHolder = prev.holder;
      const currHolder = curr.holder;

      if (prevHolder.parentElement === null || prevHolder.parentElement !== currHolder.parentElement) {
        return violations;
      }

      if ((prevHolder.compareDocumentPosition(currHolder) & Node.DOCUMENT_POSITION_FOLLOWING) === 0) {
        violations.push(
          `  - "${prev.id}" must precede "${curr.id}" in the DOM ` +
          `(parent: ${curr.parentId ?? 'root'})`
        );
      }

      return violations;
    }, []);
  }

  /**
   * Group all blocks by `parentId` (null = root), preserving array order within
   * each group. Shared by the holder-order reconcile and its invariant check.
   */
  private groupByParent(): Map<string | null, Block[]> {
    const groups = new Map<string | null, Block[]>();

    for (const block of this.repository.blocks) {
      const key = block.parentId ?? null;
      const siblings = groups.get(key);

      if (siblings === undefined) {
        groups.set(key, [block]);
      } else {
        siblings.push(block);
      }
    }

    return groups;
  }

  /**
   * Handle block update from Yjs (undo/redo or a remote peer)
   */
  private handleYjsUpdate(blockId: string): void {
    const block = this.repository.getBlockById(blockId);
    const yblock = this.dependencies.YjsManager.getBlockById(blockId);

    if (block === undefined || yblock === undefined) {
      return;
    }

    const yjsType = yblock.get('type') as string;
    const data = this.sanitizeToolData(yjsType, this.dependencies.YjsManager.yMapToObject(yblock.get('data') as YMap<unknown>));
    const ytunes = yblock.get('tunes') as YMap<unknown> | undefined;
    const tunes = ytunes !== undefined ? this.dependencies.YjsManager.yMapToObject(ytunes) : {};
    const lastEditedAt = yblock.get('lastEditedAt') as number | undefined;
    const lastEditedBy = (yblock.get('lastEditedBy') as string | undefined) ?? null;

    /**
     * Angle 1 fix: reconcile parentId drift BEFORE data/tunes updates.
     *
     * A remote client may have reparented this block (e.g. dragged it into a
     * callout) and the Yjs record now reflects the new `parentId`, but the
     * local mirror's `block.parentId` is stale. Without this reconciliation
     * the next save runs hierarchy validation, finds the parent's contentIds
     * does not list the child, and ejects the child from its parent — the
     * same corruption family as the callout paste bug.
     *
     * Route through the canonical setBlockParent handler so contentIds, DOM
     * placement, and indentation all stay consistent. Must run BEFORE any
     * composeBlock fallback below, otherwise the replacement would carry
     * over the stale `block.parentId`.
     *
     * Fix 4: distinguish "key missing" from "explicit null". A missing
     * `parentId` key means the Yjs record has no authoritative value —
     * treat as a no-op. Explicit null means "reparent to root".
     *
     * Fix 3: run the reconcile inside withAtomicOperation so
     * isSyncingFromYjs is true for the duration. Without this, the
     * hierarchy's onParentChanged listener echoes a fresh Yjs write,
     * polluting the undo stack and potentially looping.
     */
    if (yblock.has('parentId')) {
      const rawParentId = yblock.get('parentId') as string | null | undefined;
      const remoteParentId: string | null = rawParentId === undefined ? null : rawParentId;

      if (remoteParentId !== block.parentId) {
        this.withAtomicOperation(() => {
          this.handlers.setBlockParent(block, remoteParentId);
          this.reconcileParentChildOrderFromDoc(remoteParentId);
        });
        this.batchReparentedInto.add(remoteParentId);
      }
    } else if (block.parentId !== null) {
      /**
       * A non-root → root move DELETES the parentId key (the serializer never
       * writes null for root), so the branch above cannot see it.
       *
       * Every replay origin lands here, not just 'remote'. UndoHistory's
       * placement callback restores the parent for DRAG moves only (writes
       * made inside a move group); a reparent from the plain captured path —
       * the blocks API, keyboard Tab/Shift+Tab nesting, the toolbox's
       * insert-into-a-container — carries no placement record, so undoing it
       * left the block parented in memory while the doc said root. The flat
       * array followed the doc, contentIds and the DOM did not, and save()
       * then emitted a document that did not match the screen.
       *
       * Idempotent where the placement callback DID run: it reparents in
       * memory before the visible transaction, so `block.parentId` is already
       * null by the time this sees the event.
       */
      this.withAtomicOperation(() => {
        this.handlers.setBlockParent(block, null);
      });
      this.batchReparentedInto.add(null);
    }

    // Tool TYPE changed (a turn-into / markdown conversion being undone, redone,
    // or applied by a remote peer). The in-memory block is still the OLD tool
    // instance, so `setData` below can't accept the new tool's data — recreate
    // the block with the tool the Yjs record now names. This mirrors the tunes
    // recreate path and is the counterpart to `replaceBlockContent`, which
    // mutates a block's type in place rather than remove+add (the old approach
    // the observer misclassified as a no-op move, so undo never re-rendered).
    if (yjsType !== block.name) {
      // A recreate with an unregistered tool would throw out of composeBlock
      // and abort the rest of this dispatch. Keep the stale view instead —
      // the doc stays authoritative and heals on the next materialization.
      if (!this.canMaterializeTool(yjsType)) {
        return;
      }

      const blockIndex = this.handlers.getBlockIndex(block);
      const newBlock = this.factory.composeBlock({
        id: block.id,
        tool: yjsType,
        data,
        tunes,
        contentIds: block.contentIds.length > 0 ? [...block.contentIds] : undefined,
        parentId: block.parentId ?? undefined,
        bindEventsImmediately: true,
        /**
         * Everything this reconciler builds is a RE-MATERIALISATION — an
         * undo/redo replay or a remote peer's change — never a creation. A
         * restored container's children arrive through their OWN add events,
         * which land after its rendered() hook runs, so it sees a transiently
         * empty getChildren(); without this signal it seeds phantom children
         * beside the real ones ("2 columns silently became 4"). Every
         * TransactionOrigin the observer classifies (undo/redo/remote/load/move)
         * collapses to the same answer here: do not seed.
         */
        origin: 'replay',
        lastEditedAt,
        lastEditedBy,
      });

      this.withAtomicOperation(() => {
        this.handlers.replaceBlock(blockIndex, newBlock);

        const hadOrphanedChildren = this.reconcileOrphanedChildren(blockId);

        if (hadOrphanedChildren) {
          newBlock.call(BlockToolAPI.RENDERED);
        }
      }, { extendThroughRAF: true });

      return;
    }

    // Check if tunes have changed - if so, we need to recreate the block
    // because tunes are instantiated during block construction
    const currentTunes = block.preservedTunes;
    const tuneKeys = Object.keys(tunes);
    const currentKeys = Object.keys(currentTunes);
    const tunesChanged = tuneKeys.length !== currentKeys.length ||
      tuneKeys.some(key => tunes[key] !== currentTunes[key]);

    if (tunesChanged) {
      // Recreate block with updated tunes
      const blockIndex = this.handlers.getBlockIndex(block);
      const newBlock = this.factory.composeBlock({
        id: block.id,
        tool: block.name,
        data,
        tunes,
        contentIds: block.contentIds.length > 0 ? [...block.contentIds] : undefined,
        parentId: block.parentId ?? undefined,
        bindEventsImmediately: true,
        origin: 'replay',
        lastEditedAt,
        lastEditedBy,
      });

      // Use atomic operation with RAF extension to prevent DOM mutation observers
      // from syncing back to Yjs after block replacement
      this.withAtomicOperation(() => {
        this.handlers.replaceBlock(blockIndex, newBlock);

        const hadOrphanedChildren = this.reconcileOrphanedChildren(blockId);

        if (hadOrphanedChildren) {
          newBlock.call(BlockToolAPI.RENDERED);
        }
      }, { extendThroughRAF: true });
    } else {
      // Update data in-place; if tool can't handle it, recreate the block.
      // Use async atomic operation with RAF extension to keep isSyncingFromYjs
      // true through the entire setData lifecycle + one RAF frame, preventing
      // DOM mutation observers from writing back to Yjs and clearing the redo stack.
      void this.withAtomicOperationAsync(async () => {
        const success = await block.setData(data);

        if (!success) {
          const blockIndex = this.handlers.getBlockIndex(block);
          const newBlock = this.factory.composeBlock({
            id: block.id,
            tool: block.name,
            data,
            tunes: block.preservedTunes,
            contentIds: block.contentIds.length > 0 ? [...block.contentIds] : undefined,
            parentId: block.parentId ?? undefined,
            bindEventsImmediately: true,
            origin: 'replay',
            lastEditedAt,
            lastEditedBy,
          });

          this.handlers.replaceBlock(blockIndex, newBlock);

          const hadOrphanedChildren = this.reconcileOrphanedChildren(blockId);

          if (hadOrphanedChildren) {
            newBlock.call(BlockToolAPI.RENDERED);
          }
        }
      }, { extendThroughRAF: true });
    }
  }

  /**
   * The doc's flat order, filtered to the ids memory can actually hold, plus
   * the ids the current event is about to materialise.
   *
   * A doc index is NOT a memory index. The doc legally carries ids memory does
   * not: a peer's block whose parent has not arrived yet (`applyPlacement`'s
   * orphan tolerance), one a local replace dropped from memory while the doc
   * kept it, or one naming a tool this client's registry lacks (permanent —
   * nothing ever repairs it). Every such id BEFORE an insertion point shifts
   * everything after it, so handing a raw doc index to a memory insert
   * silently misplaces the block (memory [A,B] against a doc implying [B,A]),
   * and an adds-only flow runs no repair afterwards. With identical id sets
   * the filtered order is the doc order unchanged.
   *
   * @param materializing - ids being created right now, so not yet in memory
   */
  private docOrderKnownToMemory(materializing?: ReadonlySet<string>): string[] {
    const inMemory = new Set(this.repository.blocks.map((block) => block.id));

    return this.dependencies.YjsManager.toJSON()
      .map((yjsBlock) => yjsBlock.id)
      .filter((id): id is string => (
        id !== undefined && (inMemory.has(id) || materializing?.has(id) === true)
      ));
  }

  /**
   * Whether this client can materialise `toolName`, warning (once per add) when
   * it cannot. A peer may insert a tool this registry lacks; composing it throws
   * ToolNotFoundError, which the observer's subscriber guard swallows — silently
   * for a single add, and for a BATCH taking every other block in the same
   * transaction down with it. Refusing up front keeps the rest of the batch and
   * names the tool, matching the renderer's load-path warning for the same
   * cause (the renderer can substitute a stub because it owns the render; this
   * reconciler leaves the id doc-only, which `docOrderKnownToMemory` handles).
   *
   * @param toolName - tool the doc names for the block being materialised
   */
  private canMaterializeTool(toolName: string): boolean {
    if (this.factory.hasTool(toolName)) {
      return true;
    }

    logLabeled(`Tool «${toolName}» is not found. Check 'tools' property at the Blok config.`, 'warn');

    return false;
  }

  /**
   * Handle block add from Yjs (undo/redo - restoring a removed block, or a remote insert)
   */
  private handleYjsAdd(blockId: string): void {
    // Block already exists in DOM, no need to add
    if (this.repository.getBlockById(blockId) !== undefined) {
      return;
    }

    const yblock = this.dependencies.YjsManager.getBlockById(blockId);

    if (yblock === undefined) {
      return;
    }

    const toolName = yblock.get('type') as string;

    if (!this.canMaterializeTool(toolName)) {
      return;
    }

    const data = this.sanitizeToolData(toolName, this.dependencies.YjsManager.yMapToObject(yblock.get('data') as YMap<unknown>));
    const parentId = yblock.get('parentId') as string | undefined;
    const lastEditedAt = yblock.get('lastEditedAt') as number | undefined;
    const lastEditedBy = (yblock.get('lastEditedBy') as string | undefined) ?? null;

    // A MEMORY index — see docOrderKnownToMemory.
    const targetIndex = this.docOrderKnownToMemory(new Set([blockId])).indexOf(blockId);

    if (targetIndex === -1) {
      return;
    }

    // Wrap all operations in atomic context to prevent DOM updates from syncing back to Yjs
    // This is critical for preserving the redo stack during undo operations
    // Use extendThroughRAF to handle DOM updates scheduled by rendered() hooks
    this.withAtomicOperation(() => {
      // Create the block with immediate event binding for undo/redo responsiveness
      const block = this.factory.composeBlock({
        id: blockId,
        tool: toolName,
        data,
        parentId: parentId ?? undefined,
        bindEventsImmediately: true,
        origin: 'replay',
        lastEditedAt,
        lastEditedBy,
      });

      this.blocksStore.insert(targetIndex, block);

      // Emit block-added event so listeners (e.g., TableCellBlocks) can
      // claim the block for the correct cell during undo/redo
      this.handlers.onBlockAdded(block, targetIndex);

      // Set parent relationship if needed — this moves the block into the toggle's
      // DOM child container, updates parent's contentIds, and applies indentation.
      if (parentId !== undefined) {
        this.handlers.setBlockParent(block, parentId);
        this.reconcileParentChildOrderFromDoc(parentId);
      }

      // Reconcile orphaned children: when a parent block is restored via undo,
      // children may have stale in-memory parentId pointing to the block that
      // replaced it (e.g. after replace() mutated children's parentId outside
      // the Yjs transaction). Fix their in-memory parentId to match Yjs state.
      // Re-trigger rendered() if any children were reconciled, because the
      // initial rendered() during insert() fires BEFORE reconciliation — the
      // toggle sees 0 children and shows the body placeholder. The second
      // rendered() call lets the toggle update its visibility state.
      const hadOrphanedChildren = this.reconcileOrphanedChildren(blockId);

      if (hadOrphanedChildren) {
        block.call(BlockToolAPI.RENDERED);
      }
    }, { extendThroughRAF: true });
  }

  /**
   * Mirror the DOC's child order onto the in-memory parent after a replay
   * reparent. `hierarchy.setBlockParent` derives the slot from the FLAT
   * array — right for a forward edit, which writes the doc FROM memory
   * afterwards — but during undo/redo/remote sync the DOC is authoritative
   * and the flat position may not agree yet (a re-homing loop runs in
   * repository-scan order; a remote parentId change carries no flat move at
   * all), and save() reads memory. Ids memory holds but the doc does not are
   * kept, after the doc-ordered ones: mid-dispatch a sibling's own remove
   * event may not have run yet.
   */
  private reconcileParentChildOrderFromDoc(parentId: string | null | undefined): void {
    if (parentId === null || parentId === undefined) {
      return;
    }

    const parentBlock = this.repository.getBlockById(parentId);
    const yParent = this.dependencies.YjsManager.getBlockById(parentId);

    if (parentBlock === undefined || yParent === undefined) {
      return;
    }

    const rawOrder = yParent.get('contentIds');

    if (!(rawOrder instanceof YArray)) {
      return;
    }

    const inMemory = parentBlock.contentIds;
    const memberSet = new Set(inMemory);
    const ordered = rawOrder.toArray()
      .filter((id): id is string => typeof id === 'string' && memberSet.has(id));
    const orderedSet = new Set(ordered);
    const next = [...ordered, ...inMemory.filter((id) => !orderedSet.has(id))];

    if (next.length !== inMemory.length || next.some((id, index) => id !== inMemory[index])) {
      parentBlock.contentIds = next;
    }
  }

  /**
   * Reconcile orphaned children after a parent block is restored via undo/redo.
   *
   * When replace() converts a block (e.g. toggle → paragraph), it updates
   * children's in-memory parentId to the new block ID OUTSIDE the Yjs transaction.
   * After undo, Yjs restores the original parent (this block) but children in
   * memory still reference the now-removed replacement block — they are orphaned.
   *
   * This method scans all blocks in the repository and fixes any whose Yjs
   * parentId matches the restored blockId but whose in-memory parentId does not.
   *
   * @param restoredBlockId - the ID of the block that was just re-added to the DOM
   */
  private reconcileOrphanedChildren(restoredBlockId: string): boolean {
    const orphanedChildren = Array.from(this.repository.blocks).filter((block) => {
      if (block.parentId === restoredBlockId) {
        // Already pointing to the correct parent — no action needed.
        return false;
      }

      // Check the authoritative Yjs state for this block's parentId.
      const yblock = this.dependencies.YjsManager.getBlockById(block.id);

      if (yblock === undefined) {
        return false;
      }

      const yjsParentId = yblock.get('parentId') as string | undefined;

      return yjsParentId === restoredBlockId;
    });

    // In-memory state is stale — use setBlockParent to fully restore:
    // moves DOM into toggle container, updates parent's contentIds,
    // adjusts visibility based on toggle state, and updates indentation.
    for (const child of orphanedChildren) {
      this.handlers.setBlockParent(child, restoredBlockId);
    }

    // The loop above re-homed children in repository-scan order, which the
    // flat array need not match — mirror the doc's sibling order (same law
    // as the add/batch-add reparents).
    if (orphanedChildren.length > 0) {
      this.reconcileParentChildOrderFromDoc(restoredBlockId);
    }

    return orphanedChildren.length > 0;
  }

  /**
   * Handle batch block add from Yjs (undo/redo).
   *
   * When multiple blocks are restored at once (e.g. a table + its cell
   * paragraphs), we use a two-pass approach:
   *   1. Create ALL blocks and insert them into the blocks array (no DOM).
   *   2. Activate each block (DOM insert + RENDERED lifecycle hook).
   *
   * This ensures that when a parent tool's `rendered()` hook fires (pass 2),
   * child blocks already exist in BlockManager, so helpers like
   * `mountBlocksInCell()` can find them by ID.
   */
  private handleYjsBatchAdd(blockIds: string[]): void {
    // Collect blocks to create — skip any that already exist
    const candidates: Array<{ blockId: string; toolName: string; data: Record<string, unknown>; parentId: string | undefined; lastEditedAt: number | undefined; lastEditedBy: string | null }> = [];

    for (const blockId of blockIds) {
      if (this.repository.getBlockById(blockId) !== undefined) {
        continue;
      }

      const yblock = this.dependencies.YjsManager.getBlockById(blockId);

      if (yblock === undefined) {
        continue;
      }

      const toolName = yblock.get('type') as string;

      if (!this.canMaterializeTool(toolName)) {
        continue;
      }

      const data = this.sanitizeToolData(toolName, this.dependencies.YjsManager.yMapToObject(yblock.get('data') as YMap<unknown>));
      const parentId = yblock.get('parentId') as string | undefined;
      const lastEditedAt = yblock.get('lastEditedAt') as number | undefined;
      const lastEditedBy = (yblock.get('lastEditedBy') as string | undefined) ?? null;

      candidates.push({ blockId, toolName, data, parentId: parentId ?? undefined, lastEditedAt, lastEditedBy });
    }

    // ONE basis snapshot for the whole batch (see docOrderKnownToMemory): pass 1
    // inserts into the memory array as it goes, so a per-block recompute would
    // shift the indices of the blocks still to come.
    const order = this.docOrderKnownToMemory(new Set(candidates.map((entry) => entry.blockId)));
    const toCreate = candidates
      .map((entry) => ({ ...entry, targetIndex: order.indexOf(entry.blockId) }))
      .filter((entry) => entry.targetIndex !== -1);

    if (toCreate.length === 0) {
      return;
    }

    // Restore DOCUMENT order: the observer lists a redo's adds in yjs's
    // re-application order (REVERSE insertion — children before their
    // container). Pass 1's positional array inserts need ascending indices
    // to land where targetIndex says, and pass 2's activation order is what
    // lets a container's rendered() hook ADOPT its children — activating a
    // child first mounts it via the generic hierarchy path, and the
    // container's own mount then sees a block "already claimed by a nested
    // container" and duplicates it (table cells minted fresh ids on redo).
    // Flat doc order is DFS parent-before-child, so sorting by targetIndex
    // restores both invariants.
    toCreate.sort((a, b) => a.targetIndex - b.targetIndex);

    this.withAtomicOperation(() => {
      // Pass 1 — create blocks and add to array (no DOM, no RENDERED)
      const created: Array<{ block: Block; targetIndex: number; parentId: string | undefined }> = [];

      for (const entry of toCreate) {
        const block = this.factory.composeBlock({
          id: entry.blockId,
          tool: entry.toolName,
          data: entry.data,
          parentId: entry.parentId,
          bindEventsImmediately: true,
          origin: 'replay',
          lastEditedAt: entry.lastEditedAt,
          lastEditedBy: entry.lastEditedBy,
        });

        this.blocksStore.addToArray(entry.targetIndex, block);
        created.push({ block, targetIndex: entry.targetIndex, parentId: entry.parentId });
      }

      // Pass 2 — activate blocks (DOM insert + RENDERED), then emit events
      for (const { block, targetIndex, parentId } of created) {
        this.blocksStore.activateBlock(block);
        this.handlers.onBlockAdded(block, targetIndex);

        // Set parent relationship if needed — this moves the block into the toggle's
        // DOM child container, updates parent's contentIds, and applies indentation.
        if (parentId !== undefined) {
          this.handlers.setBlockParent(block, parentId);
          this.reconcileParentChildOrderFromDoc(parentId);
        }
      }
    }, { extendThroughRAF: true });
  }

  /**
   * Handle block remove from Yjs (undo/redo - removing a previously added block)
   */
  private handleYjsRemove(blockId: string): void {
    const block = this.repository.getBlockById(blockId);

    if (block === undefined) {
      return;
    }

    const index = this.handlers.getBlockIndex(block);

    if (index === -1) {
      return;
    }

    // Keep Yjs sync state active for the full remove lifecycle so listeners
    // and block.destroy handlers can detect undo/redo-originated removals.
    // Use extendThroughRAF to keep isSyncingFromYjs true through deferred
    // DOM callbacks (e.g., toggle's updateBodyPlaceholderVisibility triggered
    // by the block-removed event). Without this, those callbacks trigger
    // syncBlockDataToYjs with 'local' origin, clearing the redo stack.
    this.withAtomicOperation(() => {
      // Emit block-removed event BEFORE removal so listeners can inspect
      // the block's DOM position (e.g., which table cell it's in)
      this.handlers.onBlockRemoved(block, index);

      // Clean up parent's contentIds so the parent block reports
      // no children after undo removes a child block.
      if (block.parentId !== null) {
        const parentBlock = this.repository.getBlockById(block.parentId);

        if (parentBlock !== undefined) {
          parentBlock.contentIds = parentBlock.contentIds.filter(id => id !== block.id);
        }
      }

      // Promote children to root level before removing the parent block.
      // This matches removeBlock() in operations.ts — without this,
      // children whose DOM is inside the parent's container are destroyed
      // along with the parent, and children in the blocks array become
      // orphaned with a stale parentId pointing to a deleted block.
      //
      // Beyond the model promotion (parentId = null), the child's DOM holder
      // must be LIFTED out of the parent's subtree before blocksStore.remove()
      // calls parent.holder.remove() — that destroys EVERY descendant holder,
      // including children that survive at root (e.g. when undo tears down a
      // column_list and its columns, the leaf holders nested inside the doomed
      // column subtree would be wiped even though the model promotes them to
      // root, leaving model "at root" but the live holder gone).
      //
      // Scope the lift to children whose IMMEDIATE container is a preserve-body
      // container: a toggle-children container (toggle/callout/header) or a
      // columns structure (a column inside the columns row, or a leaf inside a
      // column's own container). Self-managing containers (table/database) keep
      // their children in their own cell containers and tear that subtree down
      // themselves — their cells must stay nested, so they are not lifted (a
      // table deleted inside a column would otherwise leak its cells to root).
      const parentHolderInDom = block.holder.parentElement !== null;

      for (const childId of block.contentIds) {
        const childBlock = this.repository.getBlockById(childId);

        if (childBlock === undefined) {
          continue;
        }

        childBlock.parentId = null;
        childBlock.holder.classList.remove('hidden');

        if (parentHolderInDom && this.isLiftableFromRemovedSubtree(childBlock.holder) && block.holder.contains(childBlock.holder)) {
          moveElementBefore(childBlock.holder, block.holder);
        }
      }

      // Removes within one batch arrive in ANY order — undo deletes a stack
      // item's insertions in REVERSE insertion order, so a container's remove
      // lands AFTER its children's (child-first). By then the children's own
      // removes lifted THEIR survivors only one level — into THIS subtree —
      // and no model link ties those survivors to this block anymore (their
      // parentId is already promoted to null, and this block's contentIds
      // names only the removed children). Lift every surviving stray holder
      // still inside this subtree, outermost only (a nested survivor rides
      // along inside its surviving container), same immediate-container guard.
      if (parentHolderInDom) {
        const strays = this.repository.blocks.filter((candidate) =>
          candidate !== block &&
          block.holder.contains(candidate.holder) &&
          this.isLiftableFromRemovedSubtree(candidate.holder)
        );
        const outermost = strays.filter((candidate) =>
          !strays.some((other) => other !== candidate && other.holder.contains(candidate.holder))
        );

        for (const stray of outermost) {
          moveElementBefore(stray.holder, block.holder);
        }
      }

      // Remove from DOM
      this.blocksStore.remove(index);

      this.restoreDefaultBlockIfDocEmptied(blockId);
    }, { extendThroughRAF: true });
  }

  /**
   * Re-establish the editor's "always at least one block" floor after a removal
   * emptied it — in the DOC as well as in memory.
   *
   * The auto-inserted paragraph MUST reach the doc. A memory-only one has no
   * Y.Map, so `updateBlockData` returns false and everything typed into it is
   * dropped from the doc, from the undo history and from every peer, with no
   * error anywhere.
   *
   * The gate is the DOC being empty, not memory: the doc legally carries ids
   * memory cannot hold (a tool this registry lacks), so memory can empty while
   * the doc has not — and a memory-only paragraph THERE would reproduce exactly
   * the silent drop this fixes. It is also what keeps two peers from stacking
   * repairs on each other's.
   *
   * The id is derived from the removed block so two peers reacting to the SAME
   * removal write the SAME id: the Y.Map set converges last-writer-wins, and
   * the doubled order entry is dropped by the doc's flat-order derivation
   * (first occurrence only) — the race lands one paragraph, not one per peer.
   * Uniqueness is free here: the doc is empty at this point.
   *
   * The write is 'no-capture' because this is reactive infrastructure, not a
   * user edit — it must not become an undo step. It still broadcasts, which is
   * correct: peers materialise it through their ordinary remote-add path.
   *
   * A client that may not write authors NOTHING — not the doc entry, and not
   * the in-memory block either. This fires on REMOTE removals too, so without
   * the gate a read-only collaborator watching a peer empty the document would
   * broadcast a repair the server drops, diverging from the room forever; a
   * memory-only block would be just as invisible to the doc (see above) and
   * would collide with the writable peer's identically-named repair when it
   * arrives as a remote add. Empty is a legal read-only state — the writable
   * peer's repair materialises here through the ordinary remote-add path.
   *
   * @param removedBlockId - id of the block whose removal emptied the document
   */
  private restoreDefaultBlockIfDocEmptied(removedBlockId: string): void {
    if (this.dependencies.isReadOnly?.() === true) {
      return;
    }

    if (this.blocksStore.length > 0 || this.dependencies.YjsManager.toJSON().length > 0) {
      return;
    }

    const restored = this.handlers.insertDefaultBlock(true, `after-${removedBlockId}`);

    this.dependencies.YjsManager.transactWithoutCapture(() => {
      this.dependencies.YjsManager.addBlock({
        id: restored.id,
        type: restored.name,
        data: restored.preservedData,
      });
    });
  }

  /**
   * Whether a holder may be lifted out of a removed block's subtree: its
   * IMMEDIATE container (never an ancestor) must be a preserve-body
   * container — a toggle-children container, the columns row, or a column's
   * own child container. A table/database cell sitting inside a toggle or
   * column has a preserve-body ANCESTOR but its immediate container is the
   * cell — lifting it would leak the self-managing container's cells to root.
   */
  private isLiftableFromRemovedSubtree(holder: HTMLElement): boolean {
    const immediateContainer = holder.parentElement;

    return (
      immediateContainer?.matches('[data-blok-toggle-children]') === true ||
      immediateContainer?.matches('[data-blok-columns]') === true ||
      immediateContainer?.parentElement?.matches('[data-blok-column]') === true
    );
  }

  /**
   * Handle block move from Yjs (undo/redo - repositioning a moved block)
   * Uses microtask scheduling to batch multiple move events into a single sync
   */
  private handleYjsMove(): void {
    // Only schedule one sync per microtask to handle batched move events
    if (this.moveSyncScheduled) {
      return;
    }

    this.moveSyncScheduled = true;

    // Use queueMicrotask to defer sync until all move events are processed
    queueMicrotask(() => {
      this.moveSyncScheduled = false;
      this.syncBlockOrderFromYjs();
    });
  }

  /**
   * Re-syncs the entire block order from Yjs to handle multiple simultaneous moves correctly
   */
  private syncBlockOrderFromYjs(): void {
    // Build id→block map for O(1) lookups instead of O(n) getBlockById calls
    const blockById = new Map<string, Block>();

    for (const block of this.repository.blocks) {
      blockById.set(block.id, block);
    }

    // Doc order filtered to memory (see docOrderKnownToMemory): enumerating the
    // raw doc order would make every doc-only id shift the indices of
    // everything after it, so a move replay reorders blocks nobody touched (an
    // undo in one column rearranged the OTHER column's blocks).
    const orderedBlocks = this.docOrderKnownToMemory()
      .map((id) => blockById.get(id))
      .filter((block): block is Block => block !== undefined);

    orderedBlocks.forEach((block, targetIndex) => {
      const currentIndex = this.handlers.getBlockIndex(block);

      if (currentIndex !== targetIndex) {
        this.blocksStore.move(targetIndex, currentIndex);
      }
    });
  }

  /**
   * Clean block data coming off the shared doc — mirror of
   * `Renderer.sanitizeToolData` (tool sanitize config + global sanitizer,
   * then the unconditional URL-scheme pass). Applied to EVERY origin that
   * reaches these handlers, not just 'remote': a hostile peer's raw payload
   * lives in the Y.Doc, and a local undo restoring that prior state would
   * launder it past a remote-only gate. The renderer sanitizes all data on
   * load, so a replay cannot lose anything a reload would keep.
   * @param tool - tool name the block will be rendered with
   * @param data - block data read from the Y.Map
   */
  private sanitizeToolData(tool: string, data: BlockToolData): BlockToolData {
    const toolSanitizeConfig = this.factory.getTool(tool)?.sanitizeConfig;

    const [sanitized] = sanitizeBlocks(
      [{ tool, data }],
      () => toolSanitizeConfig,
      this.dependencies.sanitizer
    );

    return stripUnsafeUrlsDeep(sanitized.data, toolSanitizeConfig);
  }

  /**
   * Update the blocks store (used when blocks store changes)
   * @param blocksStore - New blocks store
   */
  public updateBlocksStore(blocksStore: BlocksStore): void {
    this.blocksStore = blocksStore;
  }

  /**
   * Check if block data is different from Yjs data
   * @param blockId - Block id
   * @param key - Data key
   * @param value - New value
   * @returns true if value is different
   */
  public isBlockDataChanged(blockId: string, key: string, value: unknown): boolean {
    const yblock = this.dependencies.YjsManager.getBlockById(blockId);

    if (yblock === undefined) {
      return true;
    }

    const ydata = yblock.get('data') as YMap<unknown>;
    const currentValue = ydata.get(key);

    return currentValue !== value;
  }
}
