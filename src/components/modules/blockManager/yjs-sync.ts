/**
 * @class BlockYjsSync
 * @classdesc Handles Yjs synchronization for blocks
 * @module BlockYjsSync
 */
import { Array as YArray, Map as YMap } from 'yjs';

import type { BlockToolData, SanitizerConfig } from '../../../../types';
import { BlockToolAPI } from '../../block';
import type { Block } from '../../block';
import { modificationsObserverBatchTimeout } from '../../constants';
import { DATA_ATTR } from '../../constants/data-attributes';
import { logLabeled } from '../../utils';
import { isChildToolAllowed } from '../../utils/child-tools';
import { moveElementAfter, moveElementBefore } from '../../utils/html';
import { equals } from '../../utils/object';
import { sanitizeBlocks, stripUnsafeUrlsDeep } from '../../utils/sanitizer';
import type { YjsManager } from '../yjs';
import type { BlockChangeEvent, TransactionOrigin } from '../yjs/types';

import type { BlockFactory } from './factory';
import { adjustCaretOffset, captureCaretAcrossRewrite } from './remote-edit-caret';
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
 * A block record narrowed off the doc. Peers are untrusted: handing a
 * non-Y.Map `data` to `yMapToObject` throws inside the observer and takes
 * every other block in the same dispatch down with it.
 */
interface BlockRecord {
  type: string;
  data: YMap<unknown>;
  tunes: YMap<unknown> | undefined;
  parentId: string | undefined;
  lastEditedAt: number | undefined;
  lastEditedBy: string | null;
}

interface AtomicOperationOptions {
  /** Keep the sync window open through the next animation frame */
  extendThroughRAF?: boolean;
  /**
   * Scope the window to this block's subtree (see `isReconciling`). Omit for
   * structural work, which suppresses every block's write-back.
   */
  blockId?: string;
}

/**
 * Sync handler callbacks for DOM updates
 */
export interface SyncHandlers {
  /** Called to get current block index */
  getBlockIndex: (block: Block) => number;
  /**
   * Called to insert a default block. `id` pins the new block's id — the
   * remove-the-last-block auto-repair derives a deterministic one so two peers
   * reacting to the same removal converge on ONE block.
   */
  insertDefaultBlock: (skipYjsSync: boolean, id?: string) => Block;
  /** Called to set the parent of a block, updating contentIds and DOM placement */
  setBlockParent: (block: Block, parentId: string | null) => void;
  /** Called to replace a block at a specific index with a new block instance */
  replaceBlock: (index: number, newBlock: Block) => void;
  /** Called when a block is removed during undo/redo (before DOM removal) */
  onBlockRemoved: (block: Block, index: number) => void;
  /** Called when a block is added during undo/redo (after insertion) */
  onBlockAdded: (block: Block, index: number) => void;
  /**
   * Called, inside the reconcile window, when undo/redo or a peer changed a
   * block's data. A tool with no editable DOM (a database row) makes no
   * mutation of its own, so without this nothing tells its parent to redraw.
   */
  onBlockChanged?: (block: Block) => void;
  /**
   * Write a block's current content back to the document, bypassing the echo
   * gate. Used to replay a mutation that was suppressed as a reconciler echo
   * but turned out to be the user's — see `noteSuppressedMutation`.
   */
  resyncBlockData: (block: Block, options?: { untracked?: boolean }) => void;
}

/**
 * BlockYjsSync handles synchronization between DOM blocks and Yjs document
 */
/**
 * Whether an add event is the editor materialising a change it did not make.
 *
 * Only a REMOTE add opens a settling window. An undo/redo add is replaying the
 * user's own history, and a restored block normalises nothing — so opening a
 * window there bought nothing and left the caret inside it, which made the
 * first keystroke typed within 400ms of a Ctrl+Z land untracked and therefore
 * un-undoable.
 * @param origin - origin of the block change event, when the caller knows it
 */
const isMaterializingOrigin = (origin?: BlockChangeEvent['origin']): boolean => origin === 'remote';

/**
 * Who a replayed block is rebuilt for, handed to the tool as `replaySource`:
 * this client's own undo/redo, or a peer's change.
 * @param origin - origin of the block change event
 */
const replaySourceOf = (origin?: BlockChangeEvent['origin']): 'history' | 'remote' | undefined => {
  if (origin === 'remote') {
    return 'remote';
  }

  return origin === 'undo' || origin === 'redo' ? 'history' : undefined;
};

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
   * Operations not scoped to one block: structural batches, holder
   * reconciles, view rebuilds. While one is open EVERY block's write-back is
   * an echo.
   */
  private unscopedSyncCount = 0;

  /**
   * Blocks whose own update (remote or replayed) is in flight, counted per
   * id for overlapping windows. Only that block's subtree is an echo — a
   * peer typing in one block must not drop the local user's keystrokes in
   * another.
   */
  private readonly reconcilingBlocks = new Map<string, number>();

  /**
   * Blocks that mutated while their reconcile window was open, so the
   * write-back was dropped as the reconciler's own echo.
   *
   * The window covers `setData`'s await AND one animation frame, which is long
   * enough for the user to type into — and that keystroke looks exactly like
   * the echo. Dropping it lost the character for good: the next peer rewrite
   * replaces the block's DOM from the document, which never received it.
   *
   * So the drop is deferred, not final: when the window closes, the block is
   * saved once more. A real echo diffs to nothing and writes nothing, so this
   * costs one save and adds no undo step; a keystroke reaches the document.
   */
  private readonly suppressedMutations = new Set<string>();

  /**
   * Blocks the user typed into while their reconcile window was open.
   *
   * `beforeinput` is the provenance the DOM alone does not carry: only the
   * user produces one, so a mutation that follows it inside the window is a
   * keystroke and not the reconciler's rewrite. Without it a replay cannot
   * tell the two apart, and replaying the reconciler's own normalisation
   * (a convert to toggle rewrites the block's content) lands a second undo
   * step, so one CMD+Z no longer reverts the convert.
   */
  private readonly userTypedWhileReconciling = new Set<string>();

  /**
   * Blocks whose write-back was dropped inside a window that had already
   * finished its own work — the RAF/await TAIL, where nothing is rewriting
   * the DOM any more.
   *
   * Provenance the DOM does not carry cannot be had for these: a paste
   * (`Paste.processDataTransfer` preventDefaults the clipboard event) and an
   * inline tool (the mark engine rewrites nodes directly) fire no
   * `beforeinput`, so `userTypedWhileReconciling` can never see them. What IS
   * knowable is CAUSALITY: a mutation that arrives while no reconcile body is
   * on the stack was not produced by one. It is replayed, but UNTRACKED — a
   * true echo diffs to nothing and writes nothing, a tool's own late
   * normalisation lands without becoming an undo step (which is what kept a
   * convert to toggle at one CMD+Z), and a user edit reaches the document
   * instead of being lost.
   */
  private readonly deferredMutations = new Set<string>();

  /**
   * How many reconcile BODIES are executing right now.
   *
   * `yjsSyncCount` stays up through the RAF extension, so it cannot tell
   * "the reconciler is rewriting this block" from "the window is only still
   * open in case a tool echoes late". This counter can: it drops the moment
   * the operation's function returns (or its promise settles).
   */
  private activeOperationDepth = 0;

  /**
   * Blocks this reconciler has rewritten from the document during a window
   * that is still open.
   *
   * The echo is, by definition, the DOM reflecting what the reconciler just
   * wrote. For these blocks that baseline exists — the document itself — so a
   * dropped write-back can be replayed and let the diff decide: identical to
   * what was applied, it writes nothing; different, it is content the document
   * does not have and losing it is the data loss. That covers the edit paths
   * `beforeinput` provably cannot see (paste, inline tools), without guessing.
   *
   * A window nobody applied data through carries no such baseline (a convert's
   * structural window is one), and those keep the old, conservative drop.
   *
   * The value is the data that was APPLIED — the document's record after this
   * client's sanitizer ran, which is what the DOM is meant to end up holding.
   * Not the document's own value: the two differ for anything the sanitizer
   * strips (a peer's `sup` from a build that registers it) AND for anything it
   * merely normalises (`a & b` comes back `a &amp; b`, which is every
   * host-seeded block). Diffing the replay against the DOCUMENT would make
   * both of those look like user edits and write this client's view back over
   * the peer's content; diffing against what was applied tells them apart.
   */
  private readonly rewrittenFromDocument = new Map<string, BlockToolData>();

  /**
   * Blocks whose change the host was already told about in a window still
   * open. A rewrite reaches `blockDidMutated` twice: through the DOM echo and
   * through `onBlockChanged`, in either order. See `claimChangeAnnouncement`.
   */
  private readonly announcedChanges = new Set<string>();

  /** How many peer changes are materialising blocks right now. */
  private peerMaterializeDepth = 0;

  /**
   * Returns true if any Yjs sync operation is in progress
   */
  public get isSyncingFromYjs(): boolean {
    return this.yjsSyncCount > 0;
  }

  /**
   * Whether a mutation of `block` right now is the reconciler's own echo:
   * a structural batch is open, or the block or one of its ancestors is
   * being updated from the doc. Gates the write-back in
   * `BlockManager.blockDidMutated`.
   * @param block - the block that mutated
   */
  public isReconciling(block: Block): boolean {
    if (this.unscopedSyncCount > 0) {
      return true;
    }

    return this.reconcilingBlocks.size > 0 && this.isInReconciledSubtree(block, new Set());
  }

  /**
   * Whether the document is rewriting `block`'s content in a window still
   * open. Narrower than `isReconciling`: an unscoped window only adds, moves
   * or removes blocks, so it never makes a save of an existing block stale.
   * @param block - the block whose save is about to be written
   */
  public isRewritingFromDocument(block: Block): boolean {
    return (this.reconcilingBlocks.size > 0 && this.isInReconciledSubtree(block, new Set()))
      || this.wasRewrittenFromDocument(block, new Set());
  }

  /**
   * Whether the blocks rendering right now come from a peer's change. Only
   * the client that authored a block may normalise it into the shared
   * document: a receiver's write of a default races the author's own choice
   * of that key, and Y.Map picks the winner by client id.
   */
  public get isMaterializingFromPeer(): boolean {
    return this.peerMaterializeDepth > 0;
  }

  /**
   * Run `fn` marked as a peer's materialisation when `origin` is remote.
   * @param origin - who made the change
   * @param fn - the work that renders blocks
   */
  private asPeerChange(origin: TransactionOrigin | undefined, fn: () => void): void {
    if (origin !== 'remote') {
      fn();

      return;
    }

    this.peerMaterializeDepth++;

    try {
      fn();
    } finally {
      this.peerMaterializeDepth--;
    }
  }

  /**
   * Whether a change of `block` should be announced to the host now. Inside a
   * reconcile window only the first announcement per block goes out, so one
   * undo or one remote update is one onChange. A keystroke in the window is
   * the user's own change and always goes out.
   * @param block - the block that changed
   */
  public claimChangeAnnouncement(block: Block): boolean {
    if (!this.isReconciling(block) || this.userTypedWhileReconciling.has(block.id)) {
      return true;
    }

    if (this.announcedChanges.has(block.id)) {
      return false;
    }

    this.announcedChanges.add(block.id);

    return true;
  }

  /**
   * Record that `block` mutated while it was being reconciled, so the drop can
   * be re-checked once the window closes. See `suppressedMutations`.
   * @param block - the block whose mutation was dropped as an echo
   */
  public noteSuppressedMutation(block: Block): void {
    if (this.userTypedWhileReconciling.has(block.id)) {
      this.suppressedMutations.add(block.id);

      return;
    }

    // Recorded when nothing here could have produced this mutation (no
    // reconcile body is running), or when a baseline to diff against exists
    // because this block WAS rewritten from the document. Both replay
    // untracked — see `deferredMutations` and `rewrittenFromDocument`.
    if (this.activeOperationDepth === 0 || this.wasRewrittenFromDocument(block, new Set())) {
      this.deferredMutations.add(block.id);
    }
  }

  /**
   * Record that the reconciler is applying the document's data to `block`'s
   * DOM, so a write-back dropped inside that window has a baseline to be
   * diffed against on replay. Cleared when the block leaves every window.
   * @param blockId - id of the block being rewritten from the document
   * @param appliedData - the sanitized record the block's DOM is being set to
   */
  private markRewrittenFromDocument(blockId: string, appliedData: BlockToolData): void {
    this.rewrittenFromDocument.set(blockId, appliedData);
  }

  /**
   * Whether `block` or one of its ancestors was rewritten from the document
   * in a still-open window — a container's rewrite re-renders its children.
   * @param block - the block whose mutation is being classified
   * @param visited - ids already walked, guarding a cyclic parent chain
   */
  private wasRewrittenFromDocument(block: Block | undefined, visited: Set<string>): boolean {
    if (block === undefined || visited.has(block.id)) {
      return false;
    }

    if (this.rewrittenFromDocument.has(block.id)) {
      return true;
    }

    visited.add(block.id);

    const parent = block.parentId === null ? undefined : this.repository.getBlockById(block.parentId);

    return this.wasRewrittenFromDocument(parent, visited);
  }

  /**
   * Record that the user typed into `block`. Only meaningful while the block
   * is reconciling — that is the window whose mutations are otherwise dropped.
   * @param block - the block the input event targeted
   */
  public noteUserInput(block: Block): void {
    if (this.isReconciling(block)) {
      this.userTypedWhileReconciling.add(block.id);
    }
  }

  /**
   * Re-save every block whose suppressed mutation has left ALL open windows.
   *
   * Driven by `isReconciling`, never by the id the closing window carried.
   * The window is SUBTREE-scoped, so a container's window suppresses its
   * children too; keying the replay on the window's own id left every nested
   * block's keystroke stranded — which is most of Blok, since a table cell, a
   * toggle child and a column child are all children of a container that
   * reconciles as a whole.
   *
   * The same check covers an unscoped (structural) window, which suppresses
   * every block: while one is open `isReconciling` is true for everything, so
   * nothing is consumed and the record survives to be replayed when it closes.
   */
  private drainSuppressedMutations(): void {
    this.announcedChanges.forEach((blockId) => {
      const block = this.repository.getBlockById(blockId);

      if (block === undefined || !this.isReconciling(block)) {
        this.announcedChanges.delete(blockId);
      }
    });

    const pending = new Set([
      ...this.suppressedMutations,
      ...this.deferredMutations,
      ...this.userTypedWhileReconciling,
      ...this.rewrittenFromDocument.keys(),
    ]);

    pending.forEach((blockId) => {
      // Looked up fresh: a rematerialise replaces the instance that mutated,
      // and saving the dead one would write a block the document no longer has.
      const block = this.repository.getBlockById(blockId);

      if (block !== undefined && this.isReconciling(block)) {
        return;
      }

      const suppressed = this.suppressedMutations.delete(blockId);
      const deferred = this.deferredMutations.delete(blockId);
      const appliedFromDocument = this.rewrittenFromDocument.get(blockId);

      // The baseline belongs to the window that just closed; a later window
      // must arm itself.
      this.rewrittenFromDocument.delete(blockId);

      // Cleared together with the record, or a stale "the user typed here"
      // flag would make this block's every later reconciler rewrite replay.
      this.userTypedWhileReconciling.delete(blockId);

      if ((suppressed || deferred) && block !== undefined && !this.destroyed) {
        // No user provenance, but a baseline to diff against: the block may be
        // holding nothing but the reconciler's own rewrite, and writing that
        // back would push this client's sanitized view over the peer's
        // content. Let the applied value decide.
        if (!suppressed && appliedFromDocument !== undefined) {
          void this.replayUnlessItIsTheRewrite(block, appliedFromDocument);

          return;
        }

        // A record with no user provenance goes back untracked: it may still
        // be the editor's own late rewrite, and that must not become an undo
        // step of its own.
        this.handlers.resyncBlockData(block, { untracked: !suppressed });
      }
    });
  }

  /**
   * Replay a dropped write-back, unless what the block holds is exactly what
   * the reconciler put there.
   *
   * The baseline is the data that was applied, so this is the diff the replay
   * always meant to take: identical means the DOM is still showing the
   * reconciler's own rewrite and writing it back could only overwrite the
   * document with this client's reading of it — the sanitize-write-back data
   * loss. Different means content arrived that the rewrite did not put there
   * (a paste, an inline tool), and dropping it would lose it for good.
   *
   * Failure mode: a user edit that really does land here is still written as a
   * whole save, so a peer's markup this client strips is lost with it. That is
   * the same trade every ordinary user edit on such a block makes — `save()`
   * reads the DOM, and the DOM never had it — and it is bounded to the block
   * the user actually edited.
   *
   * @param block - the block whose dropped write-back is being re-checked
   * @param appliedFromDocument - the sanitized record the reconciler applied
   */
  private async replayUnlessItIsTheRewrite(block: Block, appliedFromDocument: BlockToolData): Promise<void> {
    // The only caller voids this promise, so a tool whose `save()` throws has
    // no catcher anywhere and surfaces as an unhandled rejection the host reads
    // as an unattributed page error. Reported, not swallowed — the same
    // treatment `syncBlockDataToYjs` gives the resync path it hands off to.
    // `null` only ever comes from the catch — `save()` itself returns a record
    // or `undefined`, and both mean "carry on".
    const saved = await block.save().catch((error: unknown): null => {
      logLabeled(`Blok: saving block «${block.id}» to replay its write-back failed`, 'error', error);

      return null;
    });

    if (saved === null) {
      return;
    }

    // A rematerialise can land while the save is in flight, and the instance
    // that mutated is then no longer the document's.
    if (this.destroyed || this.repository.getBlockById(block.id) !== block) {
      return;
    }

    if (saved !== undefined && equals(saved.data, appliedFromDocument)) {
      return;
    }

    this.handlers.resyncBlockData(block, { untracked: true });
  }

  private isInReconciledSubtree(block: Block | undefined, visited: Set<string>): boolean {
    if (block === undefined || visited.has(block.id)) {
      return false;
    }

    if (this.reconcilingBlocks.has(block.id)) {
      return true;
    }

    visited.add(block.id);

    const parent = block.parentId === null ? undefined : this.repository.getBlockById(block.parentId);

    return this.isInReconciledSubtree(parent, visited);
  }

  /**
   * Blocks materialised from the document whose tool has not finished
   * normalising them yet, each with the timer that ends its window.
   *
   * `isReconciling` closes at the animation frame after the render, but a
   * tool's own normalisation — stamping a default, rewriting legacy rows into
   * block references — lands AFTER it, and the resulting write-back is the
   * EDITOR's, not the user's. Undoing it replays the editor's materialisation
   * against the document, which is not a state the user was ever in.
   *
   * Deliberately NARROWER and WEAKER than `isReconciling`: narrower because it
   * is scoped to the materialised subtree instead of suppressing every block,
   * weaker because it does not DROP the write — the value still reaches the
   * document, it just does not become an undo step.
   */
  private readonly settlingBlocks = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Whether a write-back for `block` right now belongs to the editor's own
   * materialisation of it (or of one of its ancestors) rather than to the user.
   * Gates the capture flavour in `BlockManager.flushBlockDataWrites`.
   * @param block - the block whose write-back is being classified
   */
  public isMaterializing(block: Block): boolean {
    return this.settlingBlocks.size > 0 && this.isInSettlingSubtree(block, new Set());
  }

  private isInSettlingSubtree(block: Block | undefined, visited: Set<string>): boolean {
    if (block === undefined || visited.has(block.id)) {
      return false;
    }

    if (this.settlingBlocks.has(block.id)) {
      return true;
    }

    visited.add(block.id);

    const parent = block.parentId === null ? undefined : this.repository.getBlockById(block.parentId);

    return this.isInSettlingSubtree(parent, visited);
  }

  /**
   * Open the settling window for a block the reconciler just materialised.
   * The window is bounded by the same 400ms mutation batch the write buffer
   * uses, so a block whose tool normalises nothing still settles — and the
   * first flushed write-back closes it earlier (see `settleMaterialization`),
   * keeping the window off a user edit that follows.
   * @param blockId - id of the block being materialised
   */
  private markMaterializing(blockId: string): void {
    const open = this.settlingBlocks.get(blockId);

    if (open !== undefined) {
      clearTimeout(open);
    }

    this.settlingBlocks.set(
      blockId,
      setTimeout(() => this.settleMaterialization(blockId), modificationsObserverBatchTimeout)
    );
  }

  /**
   * Close one block's settling window.
   *
   * When the last one closes, capture is stopped: that is the SEAL. Y.UndoManager
   * merges anything that lands within its 500ms captureTimeout into the newest
   * entry, and the measured gap between the last hydration write and the user's
   * first keystroke was 11ms — so without the boundary one Ctrl+Z reverted the
   * user's word AND the editor's materialisation together. The boundary makes
   * the user's edit its own entry even if a hydration entry somehow exists.
   *
   * The delete precedes `stopCapturing` on purpose: `stopCapturing` drains the
   * write buffer, whose flush bodies call back into here.
   * @param blockId - id of the block that has settled
   */
  public settleMaterialization(blockId: string): void {
    const timer = this.settlingBlocks.get(blockId);

    if (timer === undefined) {
      return;
    }

    clearTimeout(timer);
    this.settlingBlocks.delete(blockId);

    if (this.settlingBlocks.size === 0) {
      this.dependencies.YjsManager.stopCapturing();
    }
  }

  /**
   * Flag to prevent multiple move syncs in the same event batch
   */
  private moveSyncScheduled = false;

  /**
   * Ids the current batch's 'move' events named, drained by the scheduled
   * move sync so it can mirror each one's parent contentIds (see
   * {@link handleYjsMove}).
   */
  private readonly pendingMovedBlockIds = new Set<string>();

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
   * Begin an atomic operation by incrementing sync count and suppressing stop capturing.
   *
   * @returns cleanup function to call when operation completes
   */
  private beginAtomicOperation(blockId?: string): () => void {
    this.yjsSyncCount++;
    this.activeOperationDepth++;
    this.trackScope(blockId, 1);
    const operations = this.dependencies.operations;

    if (operations) {
      operations.suppressStopCapturing = true;
    }

    return (): void => {
      this.yjsSyncCount--;
      this.trackScope(blockId, -1);
      if (operations && this.yjsSyncCount === 0) {
        operations.suppressStopCapturing = false;
      }
    };
  }

  private trackScope(blockId: string | undefined, delta: 1 | -1): void {
    if (blockId === undefined) {
      this.unscopedSyncCount += delta;
    } else {
      const count = (this.reconcilingBlocks.get(blockId) ?? 0) + delta;

      if (count > 0) {
        this.reconcilingBlocks.set(blockId, count);
      } else {
        this.reconcilingBlocks.delete(blockId);
      }
    }

    // Any close can be the one that frees a block — including a container's,
    // which is the only window a nested block's record ever sits under.
    if (delta === -1) {
      this.drainSuppressedMutations();
    }
  }

  /**
   * End an atomic operation, optionally deferring cleanup through RAF.
   *
   * @param cleanup - function to call to decrement sync count
   * @param extendThroughRAF - if true, defer cleanup until after next animation frame
   */
  private endAtomicOperation(cleanup: () => void, extendThroughRAF: boolean): void {
    // The body is done here, whether or not the window stays open for a frame.
    this.activeOperationDepth--;

    if (extendThroughRAF) {
      requestAnimationFrame(cleanup);
    } else {
      cleanup();
    }
  }

  /**
   * Run `fn` with the write-back to Yjs and `stopCapturing` both suppressed,
   * for work that updates Yjs and the DOM together.
   * @param fn - Function to execute
   * @param options - Scope and RAF extension of the sync window
   */
  public withAtomicOperation<T>(fn: () => T, options?: AtomicOperationOptions): T {
    const cleanup = this.beginAtomicOperation(options?.blockId);

    try {
      const result = fn();

      // If extendThroughRAF is true, delay decrementing yjsSyncCount until after requestAnimationFrame callbacks
      // This ensures that DOM updates scheduled by rendered() hooks don't trigger
      // block data sync to Yjs, which would create new undo entries and clear the redo stack
      this.endAtomicOperation(cleanup, options?.extendThroughRAF === true);

      return result;
    } catch (error) {
      this.endAtomicOperation(cleanup, false);
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
    options?: AtomicOperationOptions
  ): Promise<void> {
    const cleanup = this.beginAtomicOperation(options?.blockId);

    try {
      await fn();
      this.endAtomicOperation(cleanup, options?.extendThroughRAF === true);
    } catch (error) {
      this.endAtomicOperation(cleanup, false);
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

    // Drop the settling timers WITHOUT sealing: a torn-down editor must not
    // reach back into the Yjs manager it no longer owns.
    this.settlingBlocks.forEach((timer) => clearTimeout(timer));
    this.settlingBlocks.clear();
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
    this.asPeerChange(event.origin, () => {
      if (event.type === 'update') {
        this.handleYjsUpdate(event.blockId, event.origin);
      } else if (event.type === 'move') {
        this.handleYjsMove(event.blockId);
      } else if (event.type === 'add') {
        this.handleYjsAdd(event.blockId, event.origin);
      } else if (event.type === 'batch-add') {
        this.handleYjsBatchAdd(event.blockIds, event.origin);
      } else if (event.type === 'remove') {
        this.handleYjsRemove(event.blockId, event.origin);
        this.batchHadRemove = true;
      }
    });

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
   * @param blockId - the block the doc changed
   * @param origin - who changed it, which decides whether the local caret is
   * preserved across the rewrite
   */
  private handleYjsUpdate(blockId: string, origin: TransactionOrigin): void {
    const block = this.repository.getBlockById(blockId);
    const yblock = this.dependencies.YjsManager.getBlockById(blockId);

    if (block === undefined || yblock === undefined) {
      return;
    }

    const record = this.readBlockRecord(blockId, yblock);

    if (record === null) {
      return;
    }

    const yjsType = record.type;
    const documentData = this.dependencies.YjsManager.yMapToObject(record.data);
    // What the DOM is about to hold — the document's record AFTER this client's
    // sanitizer. `markRewrittenFromDocument` is armed with this value, never
    // with `documentData`, so a replayed write-back that merely echoes the
    // rewrite diffs to nothing even when the sanitize was not a no-op.
    const data = this.sanitizeToolData(yjsType, documentData);
    const tunes = record.tunes !== undefined
      ? stripUnsafeUrlsDeep(this.dependencies.YjsManager.yMapToObject(record.tunes))
      : {};
    const { lastEditedAt, lastEditedBy } = record;

    // Mirror a parentId the doc changed BEFORE any recreate below, so a
    // replacement never carries a stale parent. A missing key is "no
    // authoritative value" (no-op); explicit null is "root". Runs inside the
    // sync window so the hierarchy's parent-change listener does not echo a
    // fresh doc write.
    if (yblock.has('parentId')) {
      const rawParentId = yblock.get('parentId');
      const remoteParentId = typeof rawParentId === 'string' ? rawParentId : null;

      if (remoteParentId !== block.parentId) {
        this.withAtomicOperation(() => {
          this.handlers.setBlockParent(block, remoteParentId);
          this.reconcileParentChildOrderFromDoc(remoteParentId);
          this.callStructuralMoved(block);
        });
        this.batchReparentedInto.add(remoteParentId);
        this.warnIfChildToolDenied(block, remoteParentId);
      }
    } else if (block.parentId !== null || block.holder.closest(`[${DATA_ATTR.nestedBlocks}]`) !== null) {
      // A root block whose holder still sits in a container slot takes this
      // branch too: a removed column promotes its children in memory but lifts
      // their holders only one level, into the columns row.
      //
      // A non-root → root move DELETES the parentId key (the serializer never
      // writes null for root), so the branch above cannot see it. Every replay
      // origin lands here: only DRAG moves restore the parent through
      // UndoHistory's placement callback; a reparent from the captured path
      // (blocks API, Tab nesting, toolbox insert) has no placement record.
      // Idempotent where the callback DID run — block.parentId is already null.
      this.withAtomicOperation(() => {
        this.handlers.setBlockParent(block, null);
        this.callStructuralMoved(block);
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

      this.markRewrittenFromDocument(blockId, data);
      this.withAtomicOperation(() => {
        this.rematerialize(block, { tool: yjsType, data, tunes, lastEditedAt, lastEditedBy, replaySource: replaySourceOf(origin) });
      }, { extendThroughRAF: true, blockId });

      return;
    }

    // Tunes are instantiated during block construction, so a tune change
    // means a recreate.
    if (!equals(tunes, block.preservedTunes)) {
      this.markRewrittenFromDocument(blockId, data);
      this.withAtomicOperation(() => {
        this.rematerialize(block, { tool: block.name, data, tunes, lastEditedAt, lastEditedBy, replaySource: replaySourceOf(origin) });
      }, { extendThroughRAF: true, blockId });

      return;
    }

    /**
     * Adopt who edited last. Only this branch needs it: both recreate paths
     * above hand the record to `composeBlock`, and everything that returned
     * earlier left the block's DATA untouched, so stamping it there would make
     * `Saver` — which reads these off the live block — persist an edit the
     * block never took. The data-identical return BELOW is stamped on purpose:
     * the block already holds the doc's data, so the stamp describes an edit
     * it really is showing.
     *
     * Gated on the time, and both fields move together: they describe ONE
     * edit. A record carrying no time carries no edit either (a peer's pure
     * reparent looks exactly like that), and wiping the block's stamps for it
     * would erase an author the document simply does not talk about.
     */
    if (lastEditedAt !== undefined) {
      block.lastEditedAt = lastEditedAt;
      block.lastEditedBy = lastEditedBy;
    }

    // Nothing in the data changed — a peer touching a record key outside
    // `data`, or a key this block already holds. setData rewrites the tool's
    // content wholesale, which throws away the local user's caret, so a
    // rewrite that would change nothing must not happen at all.
    //
    // Compared against `preservedData` — what the block was last rendered or
    // set with — not a live `save()`: save() is async and OVERWRITES that same
    // cache, so reading it here would make the baseline depend on how often
    // this ran. Stale it can only be when the user has typed since the last
    // save, and then skipping is what you want anyway: the local text is
    // newer than the doc, and its own write is already on its way.
    if (equals(data, block.preservedData)) {
      // A container whose children moved in the doc while its own data did
      // not — a peer adding or removing a child block produces exactly that.
      // The only path that re-homes those children is `rematerialize`, which
      // this return would otherwise close off, so run the reconcile here. It
      // mirrors the doc's sibling order itself once it has re-homed anything;
      // RENDERED is re-fired for the same reason rematerialize re-fires it —
      // a container that saw no children still shows its empty-body state.
      this.withAtomicOperation(() => {
        if (this.reconcileOrphanedChildren(blockId)) {
          block.call(BlockToolAPI.RENDERED);
        }
      });

      return;
    }

    // Update data in-place; if the tool can't take it, recreate the block.
    // The window stays open through setData and one RAF so the DOM mutation
    // observers cannot write back to Yjs and clear the redo stack.
    this.markRewrittenFromDocument(blockId, data);
    void this.withAtomicOperationAsync(async () => {
      // Only for a PEER's edit. Undo and redo carry a caret of their own —
      // `UndoHistory` restores the snapshot it captured, synchronously, while
      // this runs after `setData`'s await and would therefore win. It would
      // put the caret back where the text was BEFORE the redo, so redoing
      // typed text left the caret at the end of the old text.
      const restoreCaret = origin === 'remote'
        ? captureCaretAcrossRewrite(block, document.getSelection())
        : null;
      const rebaseHistory = origin === 'remote' ? this.captureHistoryCaretsAcrossRewrite(block) : null;
      const success = await block.setData(data);

      if (success) {
        restoreCaret?.();
        rebaseHistory?.();
        this.handlers.onBlockChanged?.(block);
      } else {
        // After an await, so outside `syncBlockFromYjs`'s mark.
        this.asPeerChange(origin, () => {
          this.rematerialize(block, {
            tool: block.name,
            data,
            tunes: block.preservedTunes,
            lastEditedAt,
            lastEditedBy,
            replaySource: replaySourceOf(origin),
          });
        });
      }
    }, { extendThroughRAF: true, blockId });
  }

  /**
   * The caret offsets the undo history stored for `block` count characters of
   * its text as it is now. Returns a callback that carries them across a
   * peer's rewrite the way the live caret is carried, so an undo lands past
   * the peer's text rather than inside it.
   * @param block - the block about to be rewritten
   */
  private captureHistoryCaretsAcrossRewrite(block: Block): () => void {
    // By element, not index, as in `captureCaretAcrossRewrite`.
    const inputs = [...block.inputs];
    const befores = inputs.map((input) => input.textContent ?? '');

    return (): void => {
      this.dependencies.YjsManager.rebaseCaretSnapshots(block.id, (snapshot) => {
        const input = inputs[snapshot.inputIndex];
        const inputIndex = input === undefined ? -1 : block.inputs.indexOf(input);

        if (input === undefined || inputIndex === -1) {
          return snapshot;
        }

        const before = befores[snapshot.inputIndex];
        const after = input.textContent ?? '';

        return {
          ...snapshot,
          inputIndex,
          offset: adjustCaretOffset(before, after, snapshot.offset),
          ...(snapshot.end === undefined ? {} : { end: adjustCaretOffset(before, after, snapshot.end) }),
        };
      });
    };
  }

  /**
   * Replace `block` in place with a freshly composed one carrying the doc's
   * current record. Everything this reconciler builds is a RE-MATERIALISATION
   * — an undo/redo replay or a remote peer's change — never a creation: a
   * restored container's children arrive through their OWN add events, after
   * its rendered() hook runs, so without `origin: 'replay'` it would seed
   * phantom children beside the real ones ("2 columns became 4").
   *
   * A remove of the block can land while an awaited setData is pending; there
   * is then no slot to replace into, so nothing is composed.
   *
   * `block` is only an ID CARRIER, never the thing replaced: two remote
   * updates for one block in a single frame both reach `setData`'s await
   * holding the same instance, and the first one's fallback here already
   * swapped it out. Matching on instance identity dropped the second update,
   * and the DOM then showed the older text until some later update for that
   * block arrived — long enough for one keystroke to save the stale view back
   * over the peer's newer characters.
   */
  private rematerialize(
    block: Block,
    record: {
      tool: string;
      data: BlockToolData;
      tunes: Record<string, unknown>;
      lastEditedAt: number | undefined;
      lastEditedBy: string | null;
      replaySource: 'history' | 'remote' | undefined;
    }
  ): void {
    const target = this.repository.getBlockById(block.id);

    if (target === undefined) {
      return;
    }

    const blockIndex = this.handlers.getBlockIndex(target);

    if (blockIndex === -1) {
      return;
    }

    const newBlock = this.factory.composeBlock({
      id: target.id,
      tool: record.tool,
      data: record.data,
      tunes: record.tunes,
      contentIds: target.contentIds.length > 0 ? [...target.contentIds] : undefined,
      parentId: target.parentId ?? undefined,
      bindEventsImmediately: true,
      origin: 'replay',
      replaySource: record.replaySource,
      lastEditedAt: record.lastEditedAt,
      lastEditedBy: record.lastEditedBy,
    });

    const oldHolder = target.holder;

    this.handlers.replaceBlock(blockIndex, newBlock);
    this.remountDescendantsLeftIn(oldHolder, target.id);
    this.handlers.onBlockChanged?.(newBlock);

    // Children re-homed here were not there when the insert's rendered()
    // fired; a second call lets the container see them.
    if (this.reconcileOrphanedChildren(target.id)) {
      newBlock.call(BlockToolAPI.RENDERED);
    }
  }

  /**
   * Re-seat every descendant whose holder was left inside a replaced block's
   * old holder. The swap takes the child slot with it, and the children keep
   * the same parentId, so `reconcileOrphanedChildren` does not see them.
   * Depth-first, so a slotless child's own children follow it.
   * @param oldHolder - the replaced block's holder, now out of the DOM
   * @param blockId - the rebuilt block
   */
  private remountDescendantsLeftIn(oldHolder: HTMLElement, blockId: string): void {
    const visit = (parentId: string, visited: Set<string>): void => {
      const parent = this.repository.getBlockById(parentId);

      if (parent === undefined || visited.has(parentId)) {
        return;
      }
      visited.add(parentId);

      for (const childId of [...parent.contentIds]) {
        const child = this.repository.getBlockById(childId);

        if (child === undefined) {
          continue;
        }

        if (oldHolder.contains(child.holder)) {
          this.handlers.setBlockParent(child, parentId);
        }

        visit(childId, visited);
      }
    };

    visit(blockId, new Set<string>());
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

    return this.dependencies.YjsManager.orderedIds()
      .filter((id) => inMemory.has(id) || materializing?.has(id) === true);
  }

  /**
   * Where a block the doc is adding goes in the flat array: right after its
   * doc predecessor's place in memory, never at the doc's raw index. Memory
   * and doc can disagree about where OTHER blocks sit (a delete lifts the
   * children in memory while the doc still names the removed parent, so they
   * sort to the doc's end), and every such block before the raw index shifts
   * the insert out of its parent's run.
   *
   * The predecessor is the parent (first child), or the block's previous
   * sibling or a descendant of it; the insert goes after that sibling's whole
   * run in memory. When memory and doc agree this is the raw index.
   * @param blockId - the block being added
   * @param parentId - its doc parent
   * @param order - the doc order known to memory, including `blockId`
   * @returns a flat index, or -1 when the doc does not list the block
   */
  private memoryIndexFromDocNeighbour(blockId: string, parentId: string | undefined, order: string[]): number {
    const docIndex = order.indexOf(blockId);

    if (docIndex <= 0) {
      return docIndex;
    }

    const blocks = this.repository.blocks;
    const predecessor = this.repository.getBlockById(order[docIndex - 1]);

    if (predecessor === undefined) {
      return docIndex;
    }

    const ancestry = (block: Block | undefined, chain: Block[] = []): Block[] => {
      if (block === undefined || chain.includes(block)) {
        return chain;
      }

      return ancestry(block.parentId === null ? undefined : this.repository.getBlockById(block.parentId), [...chain, block]);
    };
    const afterRunOf = (sibling: Block): number => {
      const start = blocks.indexOf(sibling);

      if (start === -1) {
        return docIndex;
      }

      const runLength = blocks.slice(start + 1)
        .findIndex(block => !ancestry(block).slice(1).includes(sibling));

      return runLength === -1 ? blocks.length : start + 1 + runLength;
    };

    // Walk back past doc predecessors memory has not put in the parent yet: a
    // redo adds a column before the move that fills its left neighbour.
    for (const id of order.slice(0, docIndex).reverse()) {
      const candidate = this.repository.getBlockById(id);

      if (candidate !== undefined && candidate.id === parentId) {
        return blocks.indexOf(candidate) + 1;
      }

      const sibling = ancestry(candidate).find(block => block.parentId === (parentId ?? null));

      if (sibling !== undefined) {
        return afterRunOf(sibling);
      }
    }

    return afterRunOf(predecessor);
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
   * Narrow a block record off the doc, or refuse it the way an unknown tool
   * is refused: warn once naming the block, leave it doc-only. The blocks-map
   * KEY is the id the reconciler works with, so the record's own `id` only
   * has to be absent or a string.
   *
   * @param blockId - the blocks-map key of the record
   * @param yblock - the record to narrow
   */
  private readBlockRecord(blockId: string, yblock: YMap<unknown>): BlockRecord | null {
    const id = yblock.get('id');
    const type = yblock.get('type');
    const data = yblock.get('data');
    const tunes = yblock.get('tunes');
    const wellFormed =
      (id === undefined || typeof id === 'string') &&
      typeof type === 'string' &&
      data instanceof YMap &&
      (tunes === undefined || tunes instanceof YMap);

    if (!wellFormed) {
      logLabeled(`Block «${blockId}» carries a malformed record and was left out of the editor.`, 'warn');

      return null;
    }

    const parentId = yblock.get('parentId');
    const lastEditedAt = yblock.get('lastEditedAt');
    const lastEditedBy = yblock.get('lastEditedBy');

    return {
      type,
      data,
      tunes,
      parentId: typeof parentId === 'string' ? parentId : undefined,
      lastEditedAt: typeof lastEditedAt === 'number' ? lastEditedAt : undefined,
      lastEditedBy: typeof lastEditedBy === 'string' ? lastEditedBy : null,
    };
  }

  /**
   * `childTools` is enforced on the local insert and move paths only. A
   * child the container denies that arrives through the doc is placed as
   * the doc says — demoting it here would write back and loop against the
   * peer — so the host is told instead.
   */
  private warnIfChildToolDenied(child: Block, parentId: string | null | undefined): void {
    if (parentId === null || parentId === undefined) {
      return;
    }

    const parent = this.repository.getBlockById(parentId);

    if (parent === undefined || isChildToolAllowed(parent, child.name)) {
      return;
    }

    logLabeled(
      `Block «${child.id}» (${child.name}) was placed under «${parentId}» by the document, but that container's childTools does not allow it.`,
      'warn'
    );
  }

  /**
   * Handle block add from Yjs (undo/redo - restoring a removed block, or a remote insert)
   */
  private handleYjsAdd(blockId: string, origin?: BlockChangeEvent['origin']): void {
    // Block already exists in DOM, no need to add
    if (this.repository.getBlockById(blockId) !== undefined) {
      return;
    }

    const yblock = this.dependencies.YjsManager.getBlockById(blockId);

    if (yblock === undefined) {
      return;
    }

    const record = this.readBlockRecord(blockId, yblock);

    if (record === null) {
      return;
    }

    const toolName = record.type;

    if (!this.canMaterializeTool(toolName)) {
      return;
    }

    const data = this.sanitizeToolData(toolName, this.dependencies.YjsManager.yMapToObject(record.data));
    const { parentId, lastEditedAt, lastEditedBy } = record;

    // A MEMORY index — see memoryIndexFromDocNeighbour.
    const targetIndex = this.memoryIndexFromDocNeighbour(blockId, parentId, this.docOrderKnownToMemory(new Set([blockId])));

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
        parentId,
        bindEventsImmediately: true,
        origin: 'replay',
        replaySource: replaySourceOf(origin),
        lastEditedAt,
        lastEditedBy,
      });

      // A root block after a nested one would land in that block's slot (see activateBlock).
      this.blocksStore.insert(targetIndex, block, false, false, parentId === undefined);

      // The tool's own normalisation of what the document handed us lands
      // after this window closes — see `settlingBlocks`.
      if (isMaterializingOrigin(origin)) {
        this.markMaterializing(blockId);
      }

      // Emit block-added event so listeners (e.g., TableCellBlocks) can
      // claim the block for the correct cell during undo/redo
      this.handlers.onBlockAdded(block, targetIndex);

      // Set parent relationship if needed — this moves the block into the toggle's
      // DOM child container, updates parent's contentIds, and applies indentation.
      if (parentId !== undefined) {
        this.handlers.setBlockParent(block, parentId);
        this.reconcileParentChildOrderFromDoc(parentId);
        this.warnIfChildToolDenied(block, parentId);
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
   * The doc names the restored block's children in its contentIds; each one
   * that exists in memory, says parentId = restored block in the doc, and says
   * otherwise in memory is re-homed.
   *
   * @param restoredBlockId - the ID of the block that was just re-added to the DOM
   */
  private reconcileOrphanedChildren(restoredBlockId: string): boolean {
    const contentIds = this.dependencies.YjsManager.getBlockById(restoredBlockId)?.get('contentIds');

    if (!(contentIds instanceof YArray)) {
      return false;
    }

    const orphanedChildren = contentIds.toArray()
      .map((childId) => (typeof childId === 'string' ? this.repository.getBlockById(childId) : undefined))
      .filter((child): child is Block => child !== undefined && child.parentId !== restoredBlockId)
      .filter((child) => this.dependencies.YjsManager.getBlockById(child.id)?.get('parentId') === restoredBlockId);

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
  private handleYjsBatchAdd(blockIds: string[], origin?: BlockChangeEvent['origin']): void {
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

      const record = this.readBlockRecord(blockId, yblock);

      if (record === null) {
        continue;
      }

      const toolName = record.type;

      if (!this.canMaterializeTool(toolName)) {
        continue;
      }

      const data = this.sanitizeToolData(toolName, this.dependencies.YjsManager.yMapToObject(record.data));
      const { parentId, lastEditedAt, lastEditedBy } = record;

      candidates.push({ blockId, toolName, data, parentId, lastEditedAt, lastEditedBy });
    }

    // ONE basis snapshot for the whole batch (see docOrderKnownToMemory): pass 1
    // inserts into the memory array as it goes, so a per-block recompute would
    // shift the indices of the blocks still to come.
    const order = this.docOrderKnownToMemory(new Set(candidates.map((entry) => entry.blockId)));
    const toCreate = candidates
      .map((entry) => ({ ...entry, docIndex: order.indexOf(entry.blockId) }))
      .filter((entry) => entry.docIndex !== -1);

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
    toCreate.sort((a, b) => a.docIndex - b.docIndex);

    this.withAtomicOperation(() => {
      // Pass 1 — create blocks and add to array (no DOM, no RENDERED)
      const created: Array<{ block: Block; targetIndex: number; parentId: string | undefined }> = [];

      for (const entry of toCreate) {
        // Against the live array: earlier entries of this batch are in it and
        // may be this entry's doc neighbour.
        const targetIndex = this.memoryIndexFromDocNeighbour(entry.blockId, entry.parentId, order);
        const block = this.factory.composeBlock({
          id: entry.blockId,
          tool: entry.toolName,
          data: entry.data,
          parentId: entry.parentId,
          bindEventsImmediately: true,
          origin: 'replay',
          replaySource: replaySourceOf(origin),
          lastEditedAt: entry.lastEditedAt,
          lastEditedBy: entry.lastEditedBy,
        });

        this.blocksStore.addToArray(targetIndex, block);

        // Same as the single add: the tool normalises after this window — see
        // `settlingBlocks`. Marked in pass 1 so a container's rendered() hook
        // in pass 2 is already inside every child's window.
        if (isMaterializingOrigin(origin)) {
          this.markMaterializing(entry.blockId);
        }

        created.push({ block, targetIndex, parentId: entry.parentId });
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
          this.warnIfChildToolDenied(block, parentId);
        }
      }
    }, { extendThroughRAF: true });
  }

  /**
   * Handle block remove from Yjs (undo/redo - removing a previously added block)
   */
  private handleYjsRemove(blockId: string, origin: TransactionOrigin): void {
    const block = this.repository.getBlockById(blockId);

    if (block === undefined) {
      return;
    }

    // A peer deleted the block holding our caret. Removing the holder moves
    // the range without a selectionchange, so presence would keep publishing
    // a caret in a block that no longer exists.
    const selection = document.getSelection();
    const loseCaret = origin === 'remote' && selection?.anchorNode != null && block.holder.contains(selection.anchorNode);

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
      const parentBlock = block.parentId !== null ? this.repository.getBlockById(block.parentId) : undefined;
      const indexInParent = parentBlock?.contentIds.indexOf(block.id) ?? -1;

      if (parentBlock !== undefined) {
        parentBlock.contentIds = parentBlock.contentIds.filter(id => id !== block.id);
      }

      // Children move up ONE level, into the removed block's slot in its
      // parent, as the local delete does (block-removal
      // promoteChildrenToParent); otherwise a redo or a peer puts them at root.
      // A column parent is layout only, so they go to root there.
      const grandParent = parentBlock !== undefined && parentBlock.name !== 'column' && parentBlock.name !== 'column_list'
        ? parentBlock
        : undefined;
      const promoted = block.contentIds.filter(childId => this.repository.getBlockById(childId) !== undefined);

      if (grandParent !== undefined && indexInParent >= 0) {
        grandParent.contentIds.splice(indexInParent, 0, ...promoted.filter(id => !grandParent.contentIds.includes(id)));
      }

      // Promote children before removing the parent block. Without this,
      // children whose DOM is inside the parent's container are destroyed
      // along with the parent, and children in the blocks array become
      // orphaned with a stale parentId pointing to a deleted block.
      //
      // Beyond the model promotion, the child's DOM holder
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

        childBlock.parentId = grandParent?.id ?? null;
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
      // parentId is already promoted past it, and this block's contentIds
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

      if (loseCaret) {
        selection?.removeAllRanges();
      }

      // A column's children go to root, but the lift above left them in the
      // surviving columns row. Re-seat them in the root area.
      if (parentBlock !== undefined && grandParent === undefined) {
        promoted
          .map(childId => this.repository.getBlockById(childId))
          .filter((child): child is Block => child !== undefined && child.parentId === null)
          .forEach(child => this.handlers.setBlockParent(child, null));
      }

      this.restoreDefaultBlockIfDocEmptied();
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
   * The id is the block factory's ordinary fresh one, NOT one derived from the
   * removed block. A derived id is the same on every peer, and `addBlock` sets
   * the whole Y.Map key: two peers repairing the SAME removal (any room with
   * two receivers — the deleting peer never repairs, it filters its own local
   * removal out) each build their own Y.Map, last-writer-wins discards one
   * WHOLE map, and everything typed into the losing paragraph before the two
   * repairs met is gone with no error anywhere. The window is one network
   * round trip wide, and it is silent.
   *
   * The cost of a fresh id is that N receivers leave N empty paragraphs
   * instead of one. That is a visible, editable document — the deterministic
   * id bought one paragraph at the price of losing a peer's typing, and an
   * extra empty paragraph is the cheaper of the two by far. No local check can
   * collapse them: at the moment each peer repairs, its own doc IS still empty.
   *
   * The write is 'no-capture' because this is reactive infrastructure, not a
   * user edit — it must not become an undo step. It still broadcasts, which is
   * correct: peers materialise it through their ordinary remote-add path.
   *
   * A client that may not write authors NOTHING — not the doc entry, and not
   * the in-memory block either. This fires on REMOTE removals too, so without
   * the gate a read-only collaborator watching a peer empty the document would
   * broadcast a repair the server drops, diverging from the room forever; a
   * memory-only block would be just as invisible to the doc (see above).
   * Empty is a legal read-only state — the writable peer's repair materialises
   * here through the ordinary remote-add path.
   */
  private restoreDefaultBlockIfDocEmptied(): void {
    if (this.dependencies.isReadOnly?.() === true) {
      return;
    }

    if (this.blocksStore.length > 0 || this.dependencies.YjsManager.orderedIds().length > 0) {
      return;
    }

    const restored = this.handlers.insertDefaultBlock(true);

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
   *
   * The reconcile that follows the flat resync is what keeps a move REPLAY
   * from inverting a container's children. `replayMovePlacement` writes the
   * doc, then reparents in memory through `BlockHierarchy.setBlockParent`,
   * which derives the child's slot from the block's flat-array position — and
   * at that instant the flat array is still the PRE-replay one, because the
   * repair below is what fixes it and it is a microtask away. So the slot is
   * computed against stale neighbours and `contentIds` lands in the opposite
   * order to the doc; nothing healed it, since a replay's second transaction
   * is a PURE 'move' (parentId already agrees by design) and only
   * `handleYjsUpdate`'s reparent branch mirrored sibling order back.
   *
   * Runs AFTER `syncBlockOrderFromYjs` on purpose: the doc is authoritative
   * for both, and the flat array must already agree before the invariant
   * check downstream compares them.
   * @param blockId - the block the move event named
   */
  private handleYjsMove(blockId: string): void {
    this.pendingMovedBlockIds.add(blockId);

    // Only schedule one sync per microtask to handle batched move events
    if (this.moveSyncScheduled) {
      return;
    }

    this.moveSyncScheduled = true;

    // Use queueMicrotask to defer sync until all move events are processed
    queueMicrotask(() => {
      this.moveSyncScheduled = false;

      const movedIds = [...this.pendingMovedBlockIds];

      this.pendingMovedBlockIds.clear();

      if (this.destroyed) {
        return;
      }

      this.syncBlockOrderFromYjs();

      const movedIntoParents = new Set(movedIds.map((movedId) => {
        const rawParentId = this.dependencies.YjsManager.getBlockById(movedId)?.get('parentId');

        return typeof rawParentId === 'string' ? rawParentId : null;
      }));

      // Holder moves must not echo back to Yjs as fresh local writes, which
      // would pollute the undo/redo stacks — same window the batch reconcile
      // uses.
      this.withAtomicOperation(() => {
        movedIntoParents.forEach((parentId) => {
          this.reconcileParentChildOrderFromDoc(parentId);
          // The stale-flat-array reparent misplaced the HOLDER too, and the
          // flat resync above does not move nested holders. Re-assert the
          // parent's sibling order against the (now correct) array, exactly
          // as the batch reconcile does for a captured reparent.
          this.reconcileHolderOrderForParent(parentId);
        });
      });
    });
  }

  /**
   * Re-syncs the entire block order from Yjs to handle multiple simultaneous moves correctly
   */
  private syncBlockOrderFromYjs(): void {
    const blockById = new Map(this.repository.blocks.map((block) => [block.id, block]));

    // Doc order filtered to memory (see docOrderKnownToMemory): enumerating the
    // raw doc order would make every doc-only id shift the indices of
    // everything after it, so a move replay reorders blocks nobody touched (an
    // undo in one column rearranged the OTHER column's blocks).
    const orderedBlocks = this.docOrderKnownToMemory()
      .map((id) => blockById.get(id))
      .filter((block): block is Block => block !== undefined);

    // Asking the store for each block's index is a scan per block, quadratic
    // per resync. Index once, and again only after a move: `Blocks.move`
    // also re-sorts the moved block's nested blocks, so the array after a
    // move cannot be predicted from the two indices alone.
    orderedBlocks.reduce((positions, block, targetIndex) => {
      const currentIndex = positions.get(block);

      if (currentIndex === undefined || currentIndex === targetIndex) {
        return positions;
      }

      this.blocksStore.move(targetIndex, currentIndex);

      return this.indexBlockPositions();
    }, this.indexBlockPositions());
  }

  private indexBlockPositions(): Map<Block, number> {
    return new Map(this.repository.blocks.map((block, index) => [block, index]));
  }

  /**
   * Fires the MOVED hook after a replayed parent change. hierarchy.reindentSubtree
   * fires it only for descendants and leaves the root to its caller; a replay has
   * no other caller, so a list item would keep its old depth glyph.
   * @param block - the block whose parent the replay changed
   */
  private callStructuralMoved(block: Block): void {
    const index = this.handlers.getBlockIndex(block);

    block.call(BlockToolAPI.MOVED, { fromIndex: index, toIndex: index, structural: true });
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
}
