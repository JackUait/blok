import * as Y from 'yjs';

import { getCaretOffset } from '../../../components/utils/caret/index';
import { resolveCaretRange } from '../collaboration/caret-position';
import type { BlokModules } from '../../../types-internal/blok-modules';

import { dropPeerPaddingOfRemovedColumn, isPaddingCell, namesOnlyPaddingCells } from './grid-padding';
import { CAPTURE_TIMEOUT_MS, BOUNDARY_TIMEOUT_MS } from './serializer';
import type { BlockPlacement, CaretSnapshot, CaretHistoryEntry, MoveHistoryEntry, MoveReplayCallback, SingleMoveEntry, UndoScopeType } from './types';

type StackItem = Y.UndoManager['undoStack'][number];

/**
 * Stop Yjs from freeing a deleted item, as Y.UndoManager does for the items
 * its steps delete (yjs `keepItem`, which is not exported).
 * @param item - a deleted item a step may bring back
 */
const keepWithParents = (item: Y.Item | null): void => {
  if (item === null || item.keep) {
    return;
  }
  // eslint-disable-next-line no-param-reassign -- the flag lives on the item
  item.keep = true;
  keepWithParents(item.parent instanceof Y.AbstractType ? item.parent._item : null);
};

/**
 * @param item - a Y item
 * @returns whether it is a block's edit metadata (see DocumentStore.updateBlockMetadata)
 */
const isEditMetadata = (item: Y.Item): boolean =>
  (item.parentSub === 'lastEditedAt' || item.parentSub === 'lastEditedBy')
  && item.parent instanceof Y.Map && item.parent.get('data') instanceof Y.Map;

/**
 * @param a - a map entry
 * @param b - another map entry
 * @returns whether both hold the same plain value; a nested type never counts
 */
const sameValue = (a: Y.Item, b: Y.Item): boolean =>
  a.content instanceof Y.ContentAny && b.content instanceof Y.ContentAny
  && JSON.stringify(a.content.getContent()) === JSON.stringify(b.content.getContent());

/** One entry taken off the top of the undo stacks: its caret entry and its yjs item or move group. */
interface CaretStackTop {
  entry: CaretHistoryEntry | undefined;
  item?: StackItem;
  group?: MoveHistoryEntry;
}

/**
 * The state a move entry was last left in: where its block actually landed,
 * and which blocks existed at that moment.
 */
interface ReplayAnchor {
  placement: BlockPlacement | null;
  known: Set<string>;
}

/** What the newest yjs undo entry would create and bring back, by block id. */
interface PoppedEntryScan {
  born: Set<string>;
  resurrected: Set<string>;
}

/** The step a gesture start closed, and where it ends on both stacks. */
export interface ClosedStep {
  /** The closed step when a write could still have joined it, else null. */
  open: StackItem | null;
  /** The undo stack's top right after the split. */
  top: StackItem | null;
  undoLength: number;
  caretLength: number;
}

interface StackItemEvent {
  type: 'undo' | 'redo';
  stackItem: StackItem;
  /** Every type the transaction changed, and each of their ancestors. */
  changedParentTypes: ReadonlyMap<unknown, unknown>;
}

/**
 * What a finished transaction inserted and deleted, as a stack item holds it.
 * Keeps the deleted content: yjs frees it when the transaction ends, and undo
 * needs it back.
 * @param transaction - the finished transaction
 */
const writtenBy = (transaction: Y.Transaction): Pick<StackItem, 'insertions' | 'deletions'> => {
  const insertions = Y.createDeleteSet();

  transaction.afterState.forEach((end, client) => {
    const start = transaction.beforeState.get(client) ?? 0;

    if (end > start) {
      insertions.clients.set(client, [{ clock: start, len: end - start }]);
    }
  });
  Y.iterateDeletedStructs(transaction, transaction.deleteSet, (struct) => {
    if (struct instanceof Y.Item) {
      keepWithParents(struct);
    }
  });

  return { insertions,
    deletions: transaction.deleteSet };
};

/**
 * UndoHistory manages all undo/redo state.
 *
 * Responsibilities:
 * - Wraps Yjs UndoManager for standard undo/redo
 * - Manages custom move history (Yjs UndoManager doesn't handle moves correctly)
 * - Tracks caret positions before/after undoable actions
 * - Implements smart undo grouping at word boundaries
 */
export class UndoHistory {
  /**
   * Undo manager for history operations.
   *
   * Backed by a field rather than a readonly property because a lineage reset
   * swaps the whole Y.Doc: an UndoManager is bound to its scope's document at
   * construction, so it has to be rebuilt (see {@link rebindScope}).
   */
  private currentUndoManager: Y.UndoManager;

  /**
   * The blocks map of the tracked scope, or null when the scope has none (the
   * unit fixtures hand UndoHistory a bare array). The delete filter reads it to
   * tell which block an item belongs to; kept in sync by `createUndoManager`.
   */
  private blocksScope: Y.Map<Y.Map<unknown>> | null = null;

  /**
   * The root order array of the tracked scope, or null when the scope has none.
   * Read by {@link currentPlacement} to tell whether a recorded move is still
   * the last word on where a block sits; kept in sync by `createUndoManager`.
   */
  private rootOrderScope: Y.Array<string> | null = null;

  /**
   * The blocks the yjs entry currently being undone brought into being, as
   * collected by {@link scanTopEntry}. Empty outside an in-flight
   * undo or redo, so ordinary writes see no extra sparing.
   */
  private blocksBornInPoppedEntry = new Set<string>();

  /**
   * What the stack item being replayed inserted. Null outside a replay.
   */
  private poppedInsertions: StackItem['insertions'] | null = null;

  /**
   * Whether the in-flight replay spares the TEXT inside a block it spares, and
   * not just that block's structure. True for a redo, false for an undo.
   *
   * An undo unwinds what this editor did, down to the characters they typed
   * into a block a peer has since written in — that is the undo they asked
   * for. A redo RE-APPLIES an action, and when the action was a delete the
   * peer has made impossible, emptying the text out of a block that stays is
   * not a smaller version of removing it: it is content destroyed with no
   * gesture behind it. So a redo removes the block or does nothing, and the
   * entry stays on the stack (see {@link keepIfWaiting}).
   */
  private sparesTextOfBornBlocks = false;

  /**
   * The live undo manager. Callers MUST read it through this getter rather
   * than caching it — `rebindScope` replaces the instance.
   */
  public get undoManager(): Y.UndoManager {
    return this.currentUndoManager;
  }

  /**
   * Blok modules (for caret operations)
   */
  private blok: BlokModules;

  /**
   * Move history, kept apart from Y.UndoManager: to yjs a move is a
   * delete+insert, which undoes as a resurrection rather than a move. Each
   * entry is one group undone together.
   */
  private moveUndoStack: MoveHistoryEntry[] = [];

  /**
   * Custom move history stack for redo.
   */
  private moveRedoStack: MoveHistoryEntry[] = [];

  /**
   * Where each recorded move left its block, and which blocks existed, the
   * last time the move was written or replayed. Keyed by the entry itself so
   * no shared type has to carry it. Read by {@link groupWasDisplacedSince};
   * written by {@link stampReplayAnchor}.
   */
  private readonly replayAnchors = new WeakMap<SingleMoveEntry, ReplayAnchor>();

  /**
   * Where each block a stack item deleted sat when it was deleted, read from
   * the order array before any later move could change the tombstone's
   * neighbours. See {@link putBackRestoredBlocks}.
   */
  private readonly deletedPlacements = new WeakMap<StackItem, Map<string, BlockPlacement>>();

  /**
   * Temporary buffer for collecting moves during a grouped operation.
   * When not null, moves are collected here instead of pushed to moveUndoStack.
   */
  private pendingMoveGroup: SingleMoveEntry[] | null = null;

  /**
   * Caret position history stack for undo.
   * Tracks caret position before/after each undoable action.
   */
  private caretUndoStack: CaretHistoryEntry[] = [];

  /**
   * Caret position history stack for redo.
   */
  private caretRedoStack: CaretHistoryEntry[] = [];

  /**
   * Pending caret snapshot captured before a change starts.
   * Used because Yjs 'stack-item-added' fires after the change.
   */
  private pendingCaretBefore: CaretSnapshot | null = null;

  /**
   * Flag indicating we have a pending caret snapshot.
   */
  private hasPendingCaret = false;

  /**
   * The caret entry recorded for each yjs stack item, by identity. One
   * `undo()` can pop SEVERAL items — yjs skips an item whose changes a peer
   * has since deleted and keeps popping until one performs a change — so
   * the caret stacks shed exactly the entries whose items left the yjs
   * stack, never "the top one".
   */
  private readonly entryByStackItem = new WeakMap<StackItem, CaretHistoryEntry>();

  /**
   * The item the in-flight undo/redo transaction added to the opposite yjs
   * stack; the caret entry carried across is keyed to it.
   */
  private replayStackItem: StackItem | null = null;

  /**
   * The popped item that actually changed the document during the in-flight
   * undo/redo — the one whose caret entry is worth restoring.
   */
  private poppedStackItem: StackItem | null = null;

  /**
   * For an entry a press reached past other entries to replay: the entries it
   * reached past. They stayed on the stack it left, so when it comes back to
   * that stack it goes under them (see {@link putBackUnderReachedPast}).
   */
  private readonly reachedPast = new WeakMap<CaretHistoryEntry, Set<CaretHistoryEntry>>();

  /**
   * Set when a press walked the whole undo stack and nothing could apply.
   * Any doc change clears it: the peer's content that blocked the stack may be gone.
   */
  private nothingUndoable = false;

  /** Stops the doc listener that clears {@link nothingUndoable}. */
  private stopDocWatch: (() => void) | null = null;

  /**
   * Flag to skip caret stack updates during explicit undo/redo operations.
   * When true, the stack-item-added listener won't modify caret stacks.
   */
  private isPerformingUndoRedo = false;

  /**
   * Whether the last typed character was a boundary (space, punctuation).
   * Used for smart undo grouping.
   */
  private pendingBoundary = false;

  /**
   * Timestamp when the boundary character was typed.
   * Used to check if 100ms has elapsed.
   */
  private boundaryTimestamp = 0;

  /**
   * Timer ID for the boundary timeout.
   * Fires stopCapturing() after 100ms idle at a boundary.
   */
  private boundaryTimeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * Set by the first {@link beginGesture}. From then on only a gesture start
   * (or the capture clock) closes a step, and {@link stopCapturing} only
   * flushes. Before it, stopCapturing still splits: code that drives the
   * editor with no user gesture keeps its old step boundaries.
   */
  private gesturesDriveSteps = false;

  /** `blockId#inputIndex` of the open typing run; null when the open step is not typing. */
  private typingInputKey: string | null = null;

  /** True from a gesture start until the end of its task (microtasks included). */
  private gestureTaskOpen = false;

  /** Nesting depth of {@link holdCapture}. */
  private captureHolds = 0;

  /** Where the step the last gesture start closed ends; see {@link landLateWrite}. */
  private lastClosedStep: ClosedStep | null = null;

  /** The step {@link insertStepUnder} made for a closed step that was not open. */
  private readonly stepUnderGesture = new WeakMap<ClosedStep, StackItem>();

  /**
   * Nesting depth of {@link addToStepThatWrote}. While above 0 nothing may
   * open a step or reopen the newest one: a derived write leaves the stack as it was.
   */
  private joiningDepth = 0;

  /**
   * The caret entry recorded since the last gesture start. The next gesture
   * start sets its `after`: the caret is still where this gesture left it.
   */
  private openEntry: CaretHistoryEntry | null = null;

  /** Set when an undo/redo placed a caret, for {@link restoreScrollIfJumped} to reveal. */
  private caretJustRestored = false;

  private readonly selectionChangeHandler = (): void => this.dropPendingCaretIfMoved();

  /**
   * The ONE placement callback replaying a recorded move step (parent
   * restore + position) during move-undo/move-redo.
   *
   * Must not record its own history entry — the call is part of replaying
   * an existing `SingleMoveEntry`. Set by YjsManager.
   */
  private placementCallback: MoveReplayCallback;

  /**
   * Flush barrier for coalesced typing writes (see BlockWriteBuffer). Runs at
   * the START of stopCapturing/undo/redo so buffered writes join the capture
   * group being closed or unwound. Living here (not only on YjsManager) is
   * load-bearing: the 100ms word-boundary timer calls stopCapturing internally,
   * and without the flush-first ordering a 400ms trailing write could land
   * AFTER the boundary split it belongs before.
   */
  private flushPendingWritesHook: () => void = () => {
    // No-op until YjsManager wires the write buffer.
  };

  constructor(
    scope: UndoScopeType[],
    blok: BlokModules
  ) {
    this.blok = blok;

    this.currentUndoManager = this.createUndoManager(scope);

    this.setupCaretTracking();
    this.setupDeletedPlacementTracking();
    document.addEventListener('selectionchange', this.selectionChangeHandler);

    // Placement callback will be set by YjsManager
    this.placementCallback = () => {
      // Placeholder, will be set by setPlacementCallback
    };
  }

  /**
   * Build an UndoManager over the given roots. One place, so the constructor
   * and {@link rebindScope} can never drift on captureTimeout / trackedOrigins.
   * @param scope - the shared types to track
   */
  private createUndoManager(scope: UndoScopeType[]): Y.UndoManager {
    // The blocks map is the first Y.Map of the scope (see DocumentStore.undoScope).
    this.blocksScope = scope.find((root): root is Y.Map<Y.Map<unknown>> => root instanceof Y.Map) ?? null;
    this.rootOrderScope = scope.find((root): root is Y.Array<string> => root instanceof Y.Array) ?? null;
    this.watchDoc(this.blocksScope?.doc ?? null);

    return new Y.UndoManager(scope, {
      captureTimeout: this.captureHolds > 0 ? Infinity : CAPTURE_TIMEOUT_MS,
      trackedOrigins: new Set(['local']),
      deleteFilter: (item) => {
        const mayDelete = this.mayUndoDelete(item);

        if (mayDelete) {
          dropPeerPaddingOfRemovedColumn(item, this.poppedInsertions);
        }

        return mayDelete;
      },
    });
  }

  /**
   * Clear {@link nothingUndoable} on every change to `doc`.
   * @param doc - the doc the undo scope lives in
   */
  private watchDoc(doc: Y.Doc | null): void {
    this.stopDocWatch?.();
    this.stopDocWatch = null;

    if (doc === null) {
      return;
    }

    // A read-only transact (see `scanTopEntry`) changes nothing and must not clear it.
    const clear = (transaction: Y.Transaction): void => {
      if (transaction.changed.size > 0 || transaction.deleteSet.clients.size > 0) {
        this.nothingUndoable = false;
      }
    };

    doc.on('afterTransaction', clear);
    this.stopDocWatch = () => doc.off('afterTransaction', clear);
  }

  /**
   * Whether undo/redo may delete this item.
   *
   * Yjs undoes an insert by deleting the items it created — and deleting the
   * item that holds a block's Y.Map deletes EVERYTHING below it, including the
   * sentence a peer typed into that block after the insert. Undo must unwind
   * what the undoing person did, never what somebody else wrote, so an item is
   * spared when removing it would take a peer's live content with it:
   *
   * - the item's own value still holds a peer's content (the block map, its
   *   `data` map, the `Y.Text` a peer typed into);
   * - it is a block id inside an order array naming such a block — that id has
   *   no subtree of its own, and dropping it would leave the block unreachable,
   *   which is the same loss by another route;
   * - it is a structural key (`id`, `type`, `data`…) of such a block, whose
   *   loss would leave a husk no tool can render;
   * - it is anywhere inside a block THIS VERY ENTRY created and the filter
   *   is therefore sparing (see {@link isInsideBlockBornInPoppedEntry}).
   *
   * Everything else is deleted as before — including the undoing peer's own
   * characters inside a block a peer also typed in, so undoing your own typing
   * keeps working in a shared paragraph.
   *
   * Solo editing is untouched: every item then belongs to the local client, no
   * block is ever peer-occupied, and the filter always says yes.
   *
   * When this spares every item of a stack item, yjs's own loop moves on to the
   * next one — the same skip it already performs for an insertion a peer has
   * deleted (see {@link entryByStackItem}). One press then unwinds the newest
   * action that still CAN be unwound, which is preferable to destroying the
   * peer's writing.
   * @param item - the item yjs is about to delete while unwinding a stack item
   */
  private mayUndoDelete(item: Y.Item): boolean {
    if (this.blocksScope === null) {
      return true;
    }

    if (this.isOrderArray(item.parent)) {
      const namesKeptBlock = item.content
        .getContent()
        .some((value) => typeof value === 'string' && this.blockHoldsPeerContent(value));

      if (namesKeptBlock) {
        return false;
      }
    }

    const owner = this.blockOwningKey(item);

    if (owner !== null && this.blockHoldsPeerContent(owner)) {
      return false;
    }

    // Asked BEFORE the shared-type split: a spared block's `items` array, its
    // grid map and its Y.Text are fields of that block just as much as its
    // primitives are, and a shared type this editor alone wrote answers "no
    // peer item" — which would strip the list of a spared list block and leave
    // the grid without the `__order` that makes it readable at all.
    if (this.isInsideBlockBornInPoppedEntry(item)) {
      return false;
    }

    const value = (item.content as { type?: unknown }).type;

    if (!(value instanceof Y.AbstractType)) {
      return true;
    }

    return !this.holdsPeerItem(value, new Set());
  }

  /**
   * Whether this item lives INSIDE a block that this undo both created and is
   * about to spare.
   *
   * Sparing the block and then emptying it out is the same loss by another
   * route: the image that keeps its caption and loses its `url`, the list that
   * keeps its style and loses every item, the table whose grid loses the
   * `__order` that makes it readable at all. So the whole subtree of a spared
   * block is spared — every depth, not just its map keys: a list's items are
   * ARRAY elements and a paragraph's words are TEXT characters, and neither
   * has a `parentSub` to be recognised by.
   *
   * Narrow by construction: `blocksBornInPoppedEntry` holds only the blocks
   * the popped entry itself put in the blocks map. A field written into a
   * block that already existed — a turn-into's `level`, an alignment, a
   * language switch — is not in it, so undoing your OWN change to a block a
   * peer writes in still removes exactly that change.
   * @param item - the item yjs is about to delete
   */
  private isInsideBlockBornInPoppedEntry(item: Y.Item): boolean {
    if (this.blocksBornInPoppedEntry.size === 0) {
      return false;
    }

    // The one thing an UNDO still takes out of a block it spares: the
    // characters this editor typed into it. A Y.Text merges per character, so
    // removing them is a true undo of this editor's typing and leaves the
    // peer's words untouched — see the last paragraph of `mayUndoDelete`. A
    // REDO has no such reading (see {@link sparesTextOfBornBlocks}).
    if (!this.sparesTextOfBornBlocks && item.parent instanceof Y.Text) {
      return false;
    }

    const owner = this.blockOwningNestedItem(item);

    return owner !== null && this.blocksBornInPoppedEntry.has(owner) && this.blockHoldsPeerContent(owner);
  }

  /**
   * The id of the block whose subtree holds this item BELOW the block's own
   * Y.Map (`data.url`, a list item, a character of a text). Null for a direct
   * block key — that is {@link blockOwningKey}'s answer — and for anything
   * outside a block.
   */
  private blockOwningNestedItem(item: Y.Item): string | null {
    if (!(item.parent instanceof Y.AbstractType)) {
      return null;
    }

    return this.blockOfOwningItem(item.parent._item, 0);
  }

  /**
   * Walk the chain of owning items up to the blocks map and name the block it
   * arrives at. `depth` counts the types crossed on the way, so a direct block
   * key (depth 0) answers null — see {@link blockOwningNestedItem}.
   * @param owner - the item holding the type the walk is currently inside
   * @param depth - how many types have been crossed so far
   */
  private blockOfOwningItem(owner: Y.Item | null, depth: number): string | null {
    if (owner === null || this.blocksScope === null) {
      return null;
    }

    if (owner.parent === this.blocksScope) {
      return depth > 0 ? owner.parentSub : null;
    }

    const next = owner.parent instanceof Y.AbstractType ? owner.parent._item : null;

    return this.blockOfOwningItem(next, depth + 1);
  }

  /**
   * The ids of the blocks the newest entry of `stack` BROUGHT INTO BEING —
   * the entry holds the item that put each of them in the blocks map.
   *
   * This is the context `mayUndoDelete` cannot see on its own: it is handed
   * one item at a time and has no way to tell a field written into a block
   * that already existed (a turn-into's `level`, an alignment the person set)
   * from a field that only exists because this very entry created the block
   * around it. The first must go when the entry is unwound; the second is part
   * of a block the filter is about to spare, so it has to stay.
   *
   * Read-only: the transaction exists because `iterateDeletedStructs` splits
   * items to address them, and it writes nothing, so yjs emits no update.
   */
  private scanTopEntry(stack: readonly StackItem[]): PoppedEntryScan {
    const top = stack[stack.length - 1];
    const blocks = this.blocksScope;
    const scan: PoppedEntryScan = { born: new Set<string>(),
      resurrected: new Set<string>() };

    if (top === undefined || blocks === null || blocks.doc === null) {
      return scan;
    }

    // A block's OWN entry in the blocks map is the only item that makes it
    // exist, so an item with that parent names a block the entry created
    // (insertions) or removed (deletions).
    const collect = (into: Set<string>) => (struct: Y.AbstractStruct): void => {
      if (struct instanceof Y.Item && struct.parent === blocks && struct.parentSub !== null) {
        into.add(struct.parentSub);
      }
    };

    blocks.doc.transact((transaction) => {
      Y.iterateDeletedStructs(transaction, top.insertions, collect(scan.born));
      Y.iterateDeletedStructs(transaction, top.deletions, collect(scan.resurrected));
    });

    return scan;
  }

  /**
   * Whether unwinding this entry would BRING A BLOCK BACK while leaving the
   * block that displaced it in place.
   *
   * An undo that only fails to remove things is survivable: the person sees
   * less of their action undone than they asked for, and every block on screen
   * is one that was already there. A replace gesture is one entry holding a
   * delete AND an insert, and when the peer writes into the inserted block the
   * insert half cannot be unwound — so the delete half alone resurrects the
   * block the gesture removed and the document ends up holding TWO copies of
   * the same idea, one of which nobody has seen since the gesture. That is
   * content APPEARING, which no undo should ever produce.
   *
   * So the line is not "all or nothing". Two spared inserts may still partly
   * apply (the block the peer never touched is still removed). Resurrection
   * and sparing are what must not co-occur, and when they would, the entry is
   * left alone — still on the stack, still undoable once the peer's content
   * is gone.
   * @param scan - the blocks the newest entry created and removed
   */
  private wouldResurrectBesideASparedBlock(scan: PoppedEntryScan): boolean {
    if (scan.resurrected.size === 0) {
      return false;
    }

    // A born block is spared for exactly one reason: a peer's content lives in
    // it (see `mayUndoDelete` via `blockOwningKey`).
    return [...scan.born].some((blockId) => this.blockHoldsPeerContent(blockId));
  }

  /**
   * Put back the stack item this press popped without applying, when it is
   * still waiting for its turn rather than spent.
   *
   * `Y.UndoManager.popStackItem` DISCARDS an item that applies nothing. Two
   * kinds of such item must survive, or an action is gone from the history
   * for good:
   * - one THE FILTER held back (see {@link wasBlockedBySparing}): it applies
   *   once the peer's content is gone;
   * - one this editor's own history shadows (see {@link isShadowed}): it
   *   applies once the entry that removed its content is replayed.
   *
   * Anything else is spent: a peer deleted everything it touched, and putting
   * it back would leave an entry no press can ever replay.
   *
   * Called BEFORE `settleReplayedEntries`, whose job is to shed the caret
   * entries of items that left the stack: an item put back keeps its caret
   * entry, because it is still an action awaiting its replay.
   * @param item - the one item the press showed yjs
   * @param stack - the live stack it was popped from
   * @param shadowers - entries set aside above it, off every stack for now
   */
  private keepIfWaiting(item: StackItem | undefined, stack: StackItem[], shadowers: readonly StackItem[]): void {
    if (item === undefined || item === this.poppedStackItem || stack.includes(item)) {
      return;
    }
    if (this.wasBlockedBySparing(item) || this.isShadowed(item, shadowers)) {
      stack.push(item);
    }
  }

  /**
   * Whether something this item inserted is gone because an entry of this
   * editor's own history removed it (a replace that deleted the block it
   * typed in). Replaying that entry brings the content back.
   * @param stackItem - an item that applied nothing
   * @param shadowers - history entries off the stacks for now
   */
  private isShadowed(stackItem: StackItem, shadowers: readonly StackItem[]): boolean {
    const doc = this.blocksScope?.doc ?? null;

    if (doc === null) {
      return false;
    }

    const history = [...shadowers, ...this.undoManager.undoStack, ...this.undoManager.redoStack];
    const removed: Y.Item[] = [];

    doc.transact((transaction) => {
      Y.iterateDeletedStructs(transaction, stackItem.insertions, (struct) => {
        if (struct instanceof Y.Item && struct.deleted) {
          removed.push(struct);
        }
      });
    });

    return removed.some((struct) =>
      history.some((other) => other !== stackItem && Y.isDeleted(other.deletions, struct.id)));
  }

  /**
   * Whether this stack item performed nothing because THE FILTER held it back,
   * rather than because there was nothing left to hold back.
   *
   * The two look identical from outside `popStackItem` — both simply perform
   * no change — and they need opposite treatment, so they are told apart at
   * the source: an entry is blocked when it still has a LIVE item that
   * `mayUndoDelete` refuses. When every item it inserted is already deleted,
   * the peer took the content away and the entry is spent.
   * @param stackItem - an item this press popped without applying
   */
  private wasBlockedBySparing(stackItem: StackItem): boolean {
    const doc = this.blocksScope?.doc ?? null;

    if (doc === null) {
      return false;
    }

    const candidates: Y.Item[] = [];

    doc.transact((transaction) => {
      Y.iterateDeletedStructs(transaction, stackItem.insertions, (struct) => {
        // A redone item is addressed through its redo chain, which only yjs
        // can follow; leave it out rather than guess wrong.
        if (struct instanceof Y.Item && !struct.deleted && struct.redone === null) {
          candidates.push(struct);
        }
      });
    });

    return candidates.some((item) => !this.mayUndoDelete(item));
  }

  /**
   * Whether any block in a recorded move group has been moved AGAIN since the
   * group was recorded.
   *
   * A move entry records where the block was (`from`) and where this editor
   * put it (`to`). Replaying `from` is only "undo" while `to` is still true:
   * once the peer has moved that block somewhere else, `to` is stale and
   * replaying `from` does not reverse this editor's move — it overrules the
   * peer's, yanking a block out from under them.
   *
   * Checked for the WHOLE group before anything is replayed, not per entry as
   * the replay walks: a group's own replays shift the siblings of the entries
   * still to come, which would read as displacement and half-apply the group.
   *
   * Only a `to` whose anchors are both still in the doc can say anything. When
   * the recorded parent or sibling has since been DELETED, the block's
   * placement differs for a reason that is not a move, and the existing
   * degradation laws (append to the parent, keep the orphan) own that case.
   *
   * Blocks that did not exist when the group was recorded are INVISIBLE to the
   * comparison (see {@link replayAnchors}). A peer merely inserting a block
   * in front of the moved one changes which sibling it follows without moving
   * it; reading that as displacement refused a move-undo that was still this
   * editor's to reverse — and, because the refusal returns before the yjs
   * branch, wedged every earlier action behind it for the rest of the session.
   *
   * The anchor is where the block ACTUALLY landed ({@link stampReplayAnchor}),
   * not the recorded `from`/`to`. Inside a group of two or more moves each
   * entry's `from` is read just before its own write, so it describes the
   * half-applied document, not the one the group's undo restores: adopting
   * `p1` and `p2` under a heading records `p2` as following the heading,
   * because `p1` had already left. Comparing the redo against that read the
   * group's own undo as a peer move and refused every redo of it.
   * @param group - the move group about to be replayed
   * @param expected - the recorded placement to fall back on when the block
   *   was outside the document at the last stamp: `to` for an undo (where this
   *   editor put it), `from` for a redo (where the undo put it back)
   */
  private groupWasDisplacedSince(group: MoveHistoryEntry, expected: 'from' | 'to'): boolean {
    return group.some((move) => {
      const stamped = this.replayAnchors.get(move);
      const anchor = stamped?.placement ?? move[expected];
      const placement = this.currentPlacement(move.blockId, stamped?.known ?? null);

      // Gone from the doc: nothing to reverse, and nothing to overrule.
      if (placement === null || !this.placementAnchorsExist(anchor)) {
        return false;
      }

      return placement.parentId !== anchor.parentId || placement.afterId !== anchor.afterId;
    });
  }

  /**
   * Record where every entry of a move group has just left its block, and
   * which blocks exist around it, so a later displacement test can tell "the
   * peer moved my block" from "the peer inserted one next to it".
   *
   * MUST run after the writes it describes — the original recording, an undo
   * replay and a redo replay all call it once the document already carries
   * their result.
   * @param group - the group whose entries to stamp
   */
  private stampReplayAnchor(group: MoveHistoryEntry): void {
    const known = new Set<string>(this.blocksScope === null ? [] : this.blocksScope.keys());

    group.forEach((move) => this.replayAnchors.set(move, {
      placement: this.currentPlacement(move.blockId),
      known,
    }));
  }

  /**
   * Whether both anchors of a recorded placement are still in the doc. A null
   * anchor is the root / the first slot, which always is.
   */
  private placementAnchorsExist(placement: BlockPlacement): boolean {
    return [placement.parentId, placement.afterId].every(
      (id) => id === null || this.blocksScope?.get(id) instanceof Y.Map
    );
  }

  /**
   * Where a block sits right now: its parent and the sibling it follows.
   * Mirrors `DocumentStore.getPlacement` over the tracked scope, which is all
   * UndoHistory holds.
   * @param blockId - the block to locate
   * @param known - when given, only these ids may be reported as the preceding
   *   sibling; anything else in front of the block is skipped over as a block
   *   that did not exist when the caller's reference placement was recorded
   */
  private currentPlacement(blockId: string, known: Set<string> | null = null): BlockPlacement | null {
    const block = this.blocksScope?.get(blockId);

    if (!(block instanceof Y.Map)) {
      return null;
    }

    const rawParentId = block.get('parentId');
    const parentId = typeof rawParentId === 'string' ? rawParentId : null;

    for (const order of this.orderArrays()) {
      const ids = order.toArray();
      const index = ids.indexOf(blockId);

      if (index !== -1) {
        const preceding = ids.slice(0, index).filter((id) => known === null || known.has(id));

        return { parentId,
          afterId: preceding.at(-1) ?? null };
      }
    }

    return { parentId,
      afterId: null };
  }

  /**
   * Every order array in the tracked scope: the root order plus each block's
   * `contentIds`.
   */
  private orderArrays(): Y.Array<string>[] {
    const arrays: Y.Array<string>[] = this.rootOrderScope === null ? [] : [this.rootOrderScope];

    this.blocksScope?.forEach((block) => {
      const contentIds = block instanceof Y.Map ? block.get('contentIds') : null;

      if (contentIds instanceof Y.Array) {
        arrays.push(contentIds as Y.Array<string>);
      }
    });

    return arrays;
  }

  /**
   * The id of the block whose own Y.Map holds this item as a direct key — the
   * block's entry in the blocks map counts as its own key. Null for anything
   * deeper (a `data` key, a character in a text) or outside a block.
   */
  private blockOwningKey(item: Y.Item): string | null {
    const blocks = this.blocksScope;
    const { parent } = item;

    if (parent === blocks) {
      return item.parentSub;
    }

    const owner = parent instanceof Y.Map ? parent._item : null;

    return owner !== null && owner.parent === blocks ? owner.parentSub : null;
  }

  /**
   * Whether `parent` is one of the arrays that carry block ids: the root order,
   * or a block's `contentIds`.
   */
  private isOrderArray(parent: Y.AbstractType<unknown> | Y.ID | null): boolean {
    if (!(parent instanceof Y.Array)) {
      return false;
    }

    const owner = parent._item;

    return owner === null || owner.parentSub === 'contentIds';
  }

  /**
   * Whether the block (or, through `contentIds`, one of its descendants) holds
   * live content authored by a client other than this document's own.
   * @param blockId - id of the block to inspect
   * @param visited - ids already inspected, so a cyclic contentIds cannot loop
   */
  private blockHoldsPeerContent(blockId: string, visited = new Set<string>()): boolean {
    const blocks = this.blocksScope;

    if (blocks === null || visited.has(blockId)) {
      return false;
    }
    visited.add(blockId);

    const block = blocks.get(blockId);

    return block instanceof Y.Map && this.holdsPeerItem(block, visited);
  }

  /**
   * Every item a shared type holds: its sequence chain (array elements, text
   * characters) plus its map entries, deleted ones included.
   */
  private itemsOf<T>(type: Y.AbstractType<T>): Y.Item[] {
    const items: Y.Item[] = [];
    const chain: Array<Y.Item | null> = [type._start];

    while (chain.length > 0) {
      const node = chain.pop() ?? null;

      if (node !== null) {
        items.push(node);
        chain.push(node.right);
      }
    }

    type._map.forEach((node) => items.push(node));

    return items;
  }

  /**
   * Walk one shared type's live items looking for a foreign author, following
   * nested types and the child blocks a `contentIds` array names.
   */
  private holdsPeerItem<T>(type: Y.AbstractType<T>, visited: Set<string>): boolean {
    const local = type.doc?.clientID;

    if (local === undefined) {
      return false;
    }

    // Child blocks live in the blocks map, not below this type: the ids in a
    // `contentIds` array are the only link, so they are followed.
    const namesChildBlocks = type instanceof Y.Array && type._item?.parentSub === 'contentIds';

    return this.itemsOf(type).some((node) => {
      // A deleted item's children are deleted with it, so nothing below it is
      // live content worth protecting.
      if (node.deleted) {
        return false;
      }

      if (node.id.client !== local) {
        return !isPaddingCell((node.content as { type?: unknown }).type) && !namesOnlyPaddingCells(node);
      }

      const value = (node.content as { type?: unknown }).type;

      if (value instanceof Y.AbstractType) {
        return this.holdsPeerItem(value, visited);
      }

      if (namesChildBlocks) {
        return node.content
          .getContent()
          .some((childId) => typeof childId === 'string' && this.blockHoldsPeerContent(childId, visited));
      }

      return false;
    });
  }

  /**
   * Rebuild the undo manager over a NEW document's roots (lineage reset).
   *
   * Deliberately does NOT call `clear()`: `Y.UndoManager.clear` transacts on its
   * document, and by the time this runs the old document is already destroyed.
   * The caller clears the history BEFORE the swap — see
   * `YjsManager.resetForRelineage`, whose step order this method depends on.
   *
   * Caret tracking is re-armed here because its listeners live on the manager
   * instance that is being replaced.
   * @param scope - the fresh document's shared types
   */
  public rebindScope(scope: UndoScopeType[]): void {
    this.currentUndoManager.destroy();
    this.currentUndoManager = this.createUndoManager(scope);

    this.setupCaretTracking();
    this.setupDeletedPlacementTracking();
  }

  /**
   * Set the placement callback used by move-undo/move-redo to replay
   * recorded moves. See `placementCallback`.
   */
  public setPlacementCallback(callback: MoveReplayCallback): void {
    this.placementCallback = callback;
  }

  /**
   * Set the Blok modules. Called when Blok modules are initialized.
   */
  public setBlok(blok: BlokModules): void {
    this.blok = blok;
  }

  /**
   * Set the flush barrier for coalesced typing writes.
   * See `flushPendingWritesHook`.
   */
  public setFlushPendingWritesHook(hook: () => void): void {
    this.flushPendingWritesHook = hook;
  }

  /**
   * Set up caret tracking via Yjs UndoManager events.
   * Captures caret position after each undoable change.
   */
  private setupCaretTracking(): void {
    this.undoManager.on('stack-item-added', (event: StackItemEvent) => {
      // Skip if we're in the middle of an explicit undo/redo operation.
      // During redo, Yjs fires stack-item-added with type='undo' which would
      // incorrectly add entries to our caret stack.
      if (this.isPerformingUndoRedo) {
        this.replayStackItem = event.stackItem;

        return;
      }

      if (event.type === 'undo') {
        // New undo entry was created - record caret positions
        const entry: CaretHistoryEntry = {
          before: this.pendingCaretBefore,
          after: this.captureCaretSnapshot(),
          kind: 'edit',
        };

        this.entryByStackItem.set(event.stackItem, entry);
        this.caretUndoStack.push(entry);
        this.openEntry = entry;
        // Clear redo stack on new action (standard undo/redo behavior).
        // BOTH redo stacks, in lockstep: `redo()` reads the CARET stack to
        // decide whether the next redo is a move, so a move group left behind
        // here is unreachable — while `canRedo()` answers from the MOVE stack
        // and keeps saying yes. Only a new move ever cleared it, so the UI
        // advertised a redo that did nothing, indefinitely.
        this.caretRedoStack = [];
        this.moveRedoStack = [];

        // Defense-in-depth backstop for "redo caret does not catch up to the new
        // block". This listener runs mid-transaction, BEFORE a structural handler
        // (Enter split, paste, tool insert) calls Caret.setToBlock on the newly
        // created block — so `after` above still points at the original block.
        // Re-capture once the synchronous gesture has settled focus, making redo
        // land on the right block AUTOMATICALLY for every tool, instead of relying
        // on each handler to remember updateLastCaretAfterPosition() by hand.
        this.scheduleAfterSnapshotRefresh(entry);
      }
      this.resetPendingCaretState();
    });

    this.undoManager.on('stack-item-popped', (event: StackItemEvent) => {
      this.poppedStackItem = event.stackItem;
    });

    // Listen for stack-item-updated to update the 'after' position when changes
    // are merged into an existing stack item (due to captureTimeout batching).
    this.undoManager.on('stack-item-updated', (event: StackItemEvent) => {
      if (this.isPerformingUndoRedo) {
        return;
      }

      if (event.type === 'undo' && this.caretUndoStack.length > 0) {
        const lastEntry = this.caretUndoStack[this.caretUndoStack.length - 1];

        // Backfill the 'before' position if the initial capture failed
        // (e.g., for table cell paragraphs where the debounced selectionchange
        // hadn't set currentBlock yet when the first character was typed)
        if (lastEntry.before === null && this.pendingCaretBefore !== null) {
          lastEntry.before = this.pendingCaretBefore;
        }

        // Update the 'after' position of the most recent undo entry
        lastEntry.after = this.captureCaretSnapshot();
        this.openEntry = lastEntry;
      }

      this.resetPendingCaretState();
    });
  }

  /**
   * Record, for every stack item, where the blocks it deleted sat. Runs for
   * the items a replay creates too: a redo deletes blocks as well.
   */
  private setupDeletedPlacementTracking(): void {
    const record = (event: StackItemEvent): void => {
      // A block delete always writes an order array. Typing never does, so
      // a keystroke costs no scan and no extra transaction.
      if ([...event.changedParentTypes.keys()].some((type) => type instanceof Y.AbstractType && this.isOrderArray(type))) {
        this.recordDeletedPlacements(event.stackItem);
      }
    };

    this.undoManager.on('stack-item-added', record);
    this.undoManager.on('stack-item-updated', record);
  }

  /**
   * Read each deleted block's parent and preceding sibling off its deleted
   * order-array item. Must run right after the delete: later moves insert new
   * items next to the tombstone and change what sits left of it.
   * @param stackItem - the item that just recorded a delete
   */
  private recordDeletedPlacements(stackItem: StackItem): void {
    const blocks = this.blocksScope;

    if (blocks === null || blocks.doc === null) {
      return;
    }

    const deletedBlocks = new Set<string>();
    const orderItems: Y.Item[] = [];

    blocks.doc.transact((transaction) => {
      Y.iterateDeletedStructs(transaction, stackItem.deletions, (struct) => {
        if (!(struct instanceof Y.Item)) {
          return;
        }
        if (struct.parent === blocks && struct.parentSub !== null) {
          deletedBlocks.add(struct.parentSub);
        } else if (this.isOrderArray(struct.parent)) {
          orderItems.push(struct);
        }
      });
    });

    const placements = this.deletedPlacements.get(stackItem) ?? new Map<string, BlockPlacement>();

    for (const item of orderItems) {
      const ids: unknown[] = item.content.getContent();
      const parentId = this.parentOfOrderArray(item.parent);

      ids.forEach((id, index) => {
        if (typeof id === 'string' && deletedBlocks.has(id) && !placements.has(id)) {
          const previous = ids[index - 1];

          placements.set(id, { parentId,
            afterId: typeof previous === 'string' ? previous : this.idLeftOf(item, stackItem) });
        }
      });
    }

    this.deletedPlacements.set(stackItem, placements);
  }

  /**
   * The block id right before a deleted order item: the nearest live item, or
   * one deleted by the same stack item (blocks deleted together keep their
   * order). Tombstones of earlier moves and deletes are skipped, and so are
   * items the same stack item inserted (a child lifted into the deleted
   * block's place): undo removes them again, so they cannot be an anchor.
   */
  private idLeftOf(item: Y.Item, stackItem: StackItem): string | null {
    const { left } = item;

    if (left === null) {
      return null;
    }

    const insertedHere = Y.isDeleted(stackItem.insertions, left.id);

    if (insertedHere || (left.deleted && !Y.isDeleted(stackItem.deletions, left.id))) {
      return this.idLeftOf(left, stackItem);
    }

    const last: unknown = left.content.getContent().at(-1);

    return typeof last === 'string' ? last : null;
  }

  /**
   * The block whose `contentIds` is this order array, or null for the root.
   */
  private parentOfOrderArray(order: Y.AbstractType<unknown> | Y.ID | null): string | null {
    const owner = order instanceof Y.Array ? order._item : null;
    const block = owner?.parent instanceof Y.Map ? owner.parent._item : null;

    return block?.parentSub ?? null;
  }

  /**
   * Re-place one restored block, see {@link putBackRestoredBlocks}.
   */
  private putBackRestoredBlock(id: string, target: BlockPlacement | undefined, direction: 'undo' | 'redo'): void {
    const current = this.currentPlacement(id);

    if (
      target !== undefined
      && current !== null
      && current.parentId === target.parentId
      && current.afterId !== target.afterId
      && this.placementAnchorsExist(target)
    ) {
      this.placementCallback(id, target, direction === 'undo' ? 'move-undo' : 'move-redo');
    }
  }

  /**
   * Put each block the replay brought back where it sat when it was deleted.
   *
   * Yjs restores a deleted id after its CURRENT left neighbour. A move writes
   * the moved id as a new item, and a move back to its old slot puts that new
   * item left of the tombstone, so the restored block lands after the moved
   * block instead of where it was. No insert index avoids this, so the block
   * is placed again from the placement read at delete time.
   *
   * The correction's items are merged into the stack item the replay just
   * created. Otherwise the opposite replay would delete the block but leave
   * the corrected id in the order array, and peers would receive it.
   *
   * Anchor law: acts only when the observed placement differs and both
   * recorded anchors still exist. Never changes the parent.
   * @param direction - the replay that just ran
   */
  private putBackRestoredBlocks(direction: 'undo' | 'redo'): void {
    const recorded = this.poppedStackItem === null ? undefined : this.deletedPlacements.get(this.poppedStackItem);
    const replayItem = this.replayStackItem;
    const doc = this.blocksScope?.doc ?? null;

    if (recorded === undefined || replayItem === null || doc === null) {
      return;
    }

    const pending = [...recorded.keys()];
    const transactions: Y.Transaction[] = [];
    const collect = (transaction: Y.Transaction): void => {
      transactions.push(transaction);
    };

    doc.on('afterTransaction', collect);
    try {
      while (pending.length > 0) {
        // Place a block before any block recorded right after it.
        const ready = pending.findIndex((id) => {
          const afterId = recorded.get(id)?.afterId ?? null;

          return afterId === null || !pending.includes(afterId);
        });
        const [id] = pending.splice(Math.max(ready, 0), 1);

        this.putBackRestoredBlock(id, recorded.get(id), direction);
      }
    } finally {
      doc.off('afterTransaction', collect);
    }

    for (const transaction of transactions) {
      const insertions = Y.createDeleteSet();

      transaction.afterState.forEach((end, client) => {
        const start = transaction.beforeState.get(client) ?? 0;

        if (end > start) {
          insertions.clients.set(client, [{ clock: start,
            len: end - start }]);
        }
      });

      replayItem.insertions = Y.mergeDeleteSets([replayItem.insertions, insertions]);
      replayItem.deletions = Y.mergeDeleteSets([replayItem.deletions, transaction.deleteSet]);
    }
  }

  /**
   * Re-capture the "after" snapshot of a freshly recorded undo entry once the
   * current synchronous gesture has settled focus.
   *
   * Yjs fires `stack-item-added` mid-transaction, before control returns to the
   * handler that created the block and moved the caret into it. A microtask
   * drains after that handler completes (still before any user interaction or
   * undo/redo), so by then `Caret.setToBlock` has run and the live selection
   * reflects where the caret truly ended up. Updating the captured entry there
   * is what makes redo restore the caret to the new block for ANY tool — the
   * generalized form of the per-handler updateLastCaretAfterPosition() calls.
   *
   * The scheduled entry's identity is checked against the current top of the
   * stack so a later unrelated entry can't be clobbered if more changes land
   * before the drain.
   */
  private scheduleAfterSnapshotRefresh(entry: CaretHistoryEntry): void {
    queueMicrotask(() => {
      // Never fight an in-flight undo/redo (it owns caret restoration).
      if (this.isPerformingUndoRedo) {
        return;
      }

      // Only refresh while the scheduled entry is still the most recent one — if
      // another change (or a clear) landed before this microtask drained, leave
      // it alone rather than rewriting an unrelated entry.
      const lastIndex = this.caretUndoStack.length - 1;

      if (lastIndex < 0 || this.caretUndoStack[lastIndex] !== entry) {
        return;
      }

      const settled = this.captureCaretSnapshot();

      // Never downgrade a good snapshot to null if focus has since left every
      // block (e.g. moved to a toolbar control) by the time the microtask runs.
      if (settled !== null) {
        this.caretUndoStack[lastIndex].after = settled;
      }
    });
  }

  /**
   * Run `fn` without leaving a caret mark behind. Writes mark the caret lazily
   * and only a new undo entry clears the mark, so a mark taken by an untracked
   * write would become the caret-before of the user's next, unrelated edit.
   * @param fn - untracked work
   */
  public withoutCaretMark(fn: () => void): void {
    const pending = this.pendingCaretBefore;
    const hasPending = this.hasPendingCaret;

    try {
      fn();
    } finally {
      this.pendingCaretBefore = pending;
      this.hasPendingCaret = hasPending;
    }
  }

  /**
   * Reset pending caret capture state.
   * Called after caret positions are recorded or when batching completes.
   */
  private resetPendingCaretState(): void {
    this.hasPendingCaret = false;
    this.pendingCaretBefore = null;
  }

  /**
   * Undo the newest action that can apply.
   *
   * Blok walks the history itself, one entry at a time, in the order of the
   * caret stack (so moves and yjs edits unwind reverse-chronologically). yjs
   * only ever sees the one item Blok has checked (see `replayTrackedEntry`):
   * its own walk would pass over entries Blok must keep or refuse.
   *
   * Each entry that cannot apply is handled so no press loses, reorders or
   * half-applies history:
   * - a move the peer overruled, a refused yjs item (see
   *   {@link wouldResurrectBesideASparedBlock}) and an item that is waiting
   *   (see {@link keepIfWaiting}) are set aside, and go back in their order
   *   with their caret entries once the press is over;
   * - a spent item leaves the history.
   *
   * When nothing applies, `canUndo()` says so until the doc changes.
   */
  public undo(): void {
    // Land buffered typing writes first so they are part of the group we pop.
    this.flushPendingWritesHook();

    // Save scroll position before DOM manipulation. Removing focused elements
    // from the DOM (e.g., undoing an Enter in a table cell removes cell paragraph
    // blocks) can cause the browser to scroll to the top. We restore scroll after
    // caret restoration to catch cases where the referenced block no longer exists.
    const savedScrollY = window.scrollY;
    const setAside: CaretStackTop[] = [];
    const carriedBefore = this.caretRedoStack.at(-1);
    const applied = ((): boolean => {
      try {
        return this.undoFirstThatApplies(setAside);
      } finally {
        [...setAside].reverse().forEach((top) => this.putUndoTopBack(top));
      }
    })();
    const carried = this.caretRedoStack.at(-1);

    if (applied && setAside.length > 0 && carried !== undefined && carried !== carriedBefore) {
      this.noteReachedPast(carried, setAside);
    }
    if (!applied) {
      this.nothingUndoable = true;
    }
    this.restoreScrollIfJumped(savedScrollY);
  }

  /**
   * Undo the newest entry that applies, setting aside each one that must stay.
   * @param setAside - collects the entries set aside, newest first
   * @returns whether an entry applied
   */
  private undoFirstThatApplies(setAside: CaretStackTop[]): boolean {
    while (this.caretUndoStack.length > 0 || this.undoManager.undoStack.length > 0) {
      if (this.undoTopIfItApplies(setAside)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Undo the top entry if it applies. Otherwise set it aside, or let it leave
   * the history when it is spent.
   * @param setAside - collects the entries set aside, newest first
   * @returns whether it applied
   */
  private undoTopIfItApplies(setAside: CaretStackTop[]): boolean {
    if (this.caretUndoStack.at(-1)?.kind === 'move') {
      const group = this.moveUndoStack.at(-1);

      // A move the peer has since overruled is no longer ours to reverse —
      // see `groupWasDisplacedSince`.
      if (group !== undefined && group.length > 0 && !this.groupWasDisplacedSince(group, 'to')) {
        this.undoMoveGroup();

        return true;
      }
      setAside.push(this.takeUndoTop());

      return false;
    }

    const item = this.undoManager.undoStack.at(-1);

    if (item !== undefined && this.topStackItemIsRefused('undo')) {
      setAside.push(this.takeUndoTop());

      return false;
    }

    const caretEntry = this.replayTrackedEntry('undo', setAside.flatMap((top) => top.item ?? []));

    // No item: the caret entries left have none either. The replay shed them
    // and carries the newest, whose caret the press still restores.
    if (this.poppedStackItem !== null || item === undefined) {
      this.pushCaretAndRestore(caretEntry, this.caretRedoStack, 'before');
      this.putBackUnderReachedPast(caretEntry, this.caretRedoStack, this.undoManager.redoStack, this.moveRedoStack);

      return true;
    }
    // Waiting: it is back on top. Spent: it left the history.
    if (this.undoManager.undoStack.at(-1) === item) {
      setAside.push(this.takeUndoTop());
    }

    return false;
  }

  /** Reverse the top move group, newest move first. */
  private undoMoveGroup(): void {
    const group = this.moveUndoStack.pop() ?? [];

    this.moveRedoStack.push(group);

    // Each entry replays its full FROM placement (parent + preceding
    // sibling) through the one placement callback.
    [...group].reverse().forEach((move) => {
      this.placementCallback(move.blockId, move.from, 'move-undo');
    });

    // The group now waits on the redo stack: its next displacement test reads
    // placement over the blocks that exist AFTER this replay.
    this.stampReplayAnchor(group);

    const caretEntry = this.caretUndoStack.pop();

    this.pushCaretAndRestore(caretEntry, this.caretRedoStack, 'before');
    this.putBackUnderReachedPast(caretEntry, this.caretRedoStack, this.undoManager.redoStack, this.moveRedoStack);
  }

  /**
   * Replay the top yjs stack item in either direction, with the peer-safety
   * guards BOTH directions need.
   *
   * yjs sees that one item only: `popStackItem` pops until one item applies
   * and drops every item it passes, so with more in view it would replay an
   * entry Blok never checked — half-apply a refused replace, undo an older
   * step and lose the one between, redo a later step first.
   *
   * Redo is the undo of an undo: the item it pops carries the same insertions
   * and deletions, so a peer writing into a block the redo would remove blocks
   * it exactly as it blocks an undo. Every guard therefore lives here:
   * - `blocksBornInPoppedEntry`, so a spared block keeps its own fields;
   * - `keepIfWaiting`, so an action that applied nothing and may apply later
   *   stays on the stack instead of being thrown away.
   *
   * The resurrection scan (so a replace is never half-applied) is the
   * caller's: it decides whether to replay at all.
   * @param direction - which stack to pop from
   * @param shadowers - entries set aside above the item, off every stack for now
   * @returns the caret entry to carry to the opposite stack: the replayed
   *   item's, or when nothing applied the newest one shed
   */
  private replayTrackedEntry(direction: 'undo' | 'redo', shadowers: readonly StackItem[] = []): CaretHistoryEntry | undefined {
    const stackOf = (): StackItem[] =>
      direction === 'undo' ? this.undoManager.undoStack : this.undoManager.redoStack;
    const scan = this.scanTopEntry(stackOf());
    const hidden = stackOf().splice(0, stackOf().length - 1);
    const item = stackOf().at(-1);

    this.blocksBornInPoppedEntry = scan.born;
    this.poppedInsertions = item?.insertions ?? null;
    this.sparesTextOfBornBlocks = direction === 'redo';
    try {
      this.performYjsUndoRedo(() => {
        if (direction === 'undo') {
          this.undoManager.undo();
        } else {
          this.undoManager.redo();
        }
      });
    } finally {
      stackOf().unshift(...hidden);
      this.blocksBornInPoppedEntry = new Set();
      this.poppedInsertions = null;
      this.sparesTextOfBornBlocks = false;
    }

    this.putBackRestoredBlocks(direction);
    // Before `settleReplayedEntries`: an item put back keeps its caret entry.
    this.keepIfWaiting(item, stackOf(), shadowers);

    return this.settleReplayedEntries(
      direction === 'undo' ? this.caretUndoStack : this.caretRedoStack,
      stackOf()
    );
  }

  /**
   * Replay the entry under a refused move group, then put the group back on
   * top. The refusal is by design, but an entry that stays on top and is
   * refused on every press would block every older action for good.
   * @param carets - the caret stack whose top is the refused group's entry
   * @param moves - the move stack whose top is the refused group
   * @param replay - replays the next entry down
   */
  private reachPastRefusedMove(
    carets: CaretHistoryEntry[],
    moves: MoveHistoryEntry[],
    replay: () => void
  ): void {
    const caret = carets.pop();
    const group = moves.pop();
    const opposite = carets === this.caretUndoStack ? this.caretRedoStack : this.caretUndoStack;
    const carriedBefore = opposite.at(-1);

    try {
      replay();
    } finally {
      if (caret !== undefined) {
        carets.push(caret);
      }
      if (group !== undefined) {
        moves.push(group);
      }
    }

    const carried = opposite.at(-1);

    if (carried !== undefined && carried !== carriedBefore) {
      this.noteReachedPast(carried, [{ entry: caret }]);
    }
  }

  /**
   * Whether the top yjs item of this direction's stack must be refused: see
   * {@link wouldResurrectBesideASparedBlock}.
   * @param direction - which stack to read
   */
  private topStackItemIsRefused(direction: 'undo' | 'redo'): boolean {
    const stack = direction === 'undo' ? this.undoManager.undoStack : this.undoManager.redoStack;

    return this.wouldResurrectBesideASparedBlock(this.scanTopEntry(stack));
  }

  /**
   * Take the newest undo entry off its stack and its caret entry off the
   * caret stack, whichever timeline it belongs to.
   */
  private takeUndoTop(): CaretStackTop {
    const carets = this.caretUndoStack;

    if (carets.at(-1)?.kind === 'move') {
      return { entry: carets.pop(),
        group: this.moveUndoStack.pop() };
    }

    const item = this.undoManager.undoStack.pop();

    if (item === undefined) {
      return { entry: carets.pop() };
    }

    const entry = this.entryByStackItem.get(item);
    const index = entry === undefined ? -1 : carets.lastIndexOf(entry);

    if (index !== -1) {
      carets.splice(index, 1);
    }

    return { entry: index === -1 ? undefined : entry,
      item };
  }

  /**
   * Undo {@link takeUndoTop}.
   * @param top - what it took
   */
  private putUndoTopBack(top: CaretStackTop): void {
    if (top.item !== undefined) {
      this.undoManager.undoStack.push(top.item);
    }
    if (top.group !== undefined) {
      this.moveUndoStack.push(top.group);
    }
    if (top.entry !== undefined) {
      this.caretUndoStack.push(top.entry);
    }
  }

  /**
   * Remember that `entry` was replayed from under `tops`.
   * @param entry - the caret entry the replay carried to the other stack
   * @param tops - what stayed on the stack it left, above it
   */
  private noteReachedPast(entry: CaretHistoryEntry, tops: readonly CaretStackTop[]): void {
    const above = this.reachedPast.get(entry) ?? new Set<CaretHistoryEntry>();

    tops.forEach((top) => {
      if (top.entry !== undefined) {
        above.add(top.entry);
      }
    });
    this.reachedPast.set(entry, above);
  }

  /**
   * An entry replayed from under other entries is newer on the stack it
   * returns to than it should be: the replay pushed it on top. Put it, and
   * its yjs item or move group, under the lowest entry it reached past that
   * is still there, so the stack is in its original order again.
   * @param entry - the caret entry just pushed on `carets`
   * @param carets - the caret stack it returned to
   * @param items - the yjs stack of the same direction
   * @param moves - the move stack of the same direction
   */
  private putBackUnderReachedPast(
    entry: CaretHistoryEntry | undefined,
    carets: CaretHistoryEntry[],
    items: StackItem[],
    moves: MoveHistoryEntry[]
  ): void {
    const above = entry === undefined ? undefined : this.reachedPast.get(entry);

    if (entry === undefined || above === undefined) {
      return;
    }
    this.reachedPast.delete(entry);

    const at = carets.findIndex((candidate) => above.has(candidate));
    const group = entry.kind === 'move' ? moves.at(-1) : undefined;
    const item = entry.kind === 'move' ? undefined : items.at(-1);
    // Only a stack whose top is this entry's own replay can be reordered.
    const ownsTop = group !== undefined || (item !== undefined && this.entryByStackItem.get(item) === entry);

    if (at === -1 || carets.at(-1) !== entry || !ownsTop) {
      return;
    }

    const below = carets.slice(0, at);

    carets.pop();
    carets.splice(at, 0, entry);

    if (group !== undefined) {
      moves.pop();
      moves.splice(below.filter((candidate) => candidate.kind === 'move').length, 0, group);
    }
    if (item === undefined) {
      return;
    }

    const itemAt = items.findIndex((candidate) => {
      const candidateEntry = this.entryByStackItem.get(candidate);

      return candidateEntry !== undefined && above.has(candidateEntry);
    });
    items.pop();
    // Reached past moves only: count the yjs entries under it instead.
    items.splice(itemAt !== -1 ? itemAt : below.filter((candidate) => candidate.kind !== 'move').length, 0, item);
  }

  /**
   * Redo the last undone operation.
   * Checks move stack first since moves are handled separately from Yjs UndoManager.
   * Restores caret position after the redo operation.
   */
  public redo(): void {
    // Same barrier as undo: buffered writes must not outlive the replay.
    this.flushPendingWritesHook();

    // Save scroll position before DOM manipulation (same rationale as undo).
    const savedScrollY = window.scrollY;

    // Mirror undo(): the caret redo stack's top entry tells us whether the next
    // redo is a move or a Yjs edit, so they replay in the same chronological order
    // they were undone.
    const nextIsMove = this.caretRedoStack[this.caretRedoStack.length - 1]?.kind === 'move';

    // Never reach past on redo: every item under the top is LATER and may
    // depend on it (typing in the block the refused replace creates). The
    // refused item and everything after it wait on the stack.
    if (!nextIsMove && this.topStackItemIsRefused('redo')) {
      return;
    }

    if (nextIsMove) {
      const pending = this.moveRedoStack[this.moveRedoStack.length - 1];

      // Same law as undo, read against `from`: the undo put the block back
      // there, and once the peer has moved it somewhere else replaying `to`
      // overrules them rather than repeating this editor's move.
      if (pending !== undefined && pending.length > 0 && this.groupWasDisplacedSince(pending, 'from')) {
        this.reachPastRefusedMove(this.caretRedoStack, this.moveRedoStack, () => this.redo());

        return;
      }
    }

    const lastMoveGroup = nextIsMove ? this.moveRedoStack.pop() : undefined;

    if (lastMoveGroup !== undefined && lastMoveGroup.length > 0) {
      // Push back to undo stack
      this.moveUndoStack.push(lastMoveGroup);

      // Redo all moves in the group, in original order: each entry
      // replays its full TO placement through the placement callback.
      for (const move of lastMoveGroup) {
        this.placementCallback(move.blockId, move.to, 'move-redo');
      }

      this.stampReplayAnchor(lastMoveGroup);

      // Pop caret entry only after move succeeds
      const caretEntry = this.caretRedoStack.pop();

      this.pushCaretAndRestore(caretEntry, this.caretUndoStack, 'after');
      this.putBackUnderReachedPast(caretEntry, this.caretUndoStack, this.undoManager.undoStack, this.moveUndoStack);
      this.restoreScrollIfJumped(savedScrollY);

      return;
    }

    const item = this.undoManager.redoStack.at(-1);
    const caretEntry = this.replayTrackedEntry('redo');

    if (this.poppedStackItem !== null || item === undefined) {
      this.pushCaretAndRestore(caretEntry, this.caretUndoStack, 'after');
      this.putBackUnderReachedPast(caretEntry, this.caretUndoStack, this.undoManager.undoStack, this.moveUndoStack);
      this.restoreScrollIfJumped(savedScrollY);

      return;
    }

    // A spent item left the history and nothing later can depend on it: try
    // the next. One that is waiting stays on top and, like a refused one,
    // holds every later step back.
    if (item !== undefined && !this.undoManager.redoStack.includes(item)) {
      this.redo();
    }
  }

  /**
   * After a yjs undo/redo: drop every non-move entry whose stack item is no
   * longer on `live` (move entries belong to the move stacks and stay), and
   * return the entry to carry to the opposite caret stack — the popped
   * item's own when one performed a change, else the newest shed entry.
   * That entry is keyed to the item the replay added, so the next press in
   * the other direction can settle it the same way.
   * @param entries - the caret stack that was just unwound
   * @param live - the yjs stack it mirrors, after the replay
   */
  private settleReplayedEntries(entries: CaretHistoryEntry[], live: readonly StackItem[]): CaretHistoryEntry | undefined {
    const liveEntries = new Set(live.map((item) => this.entryByStackItem.get(item)));
    const shed = new Set(entries.filter((entry) => entry.kind !== 'move' && !liveEntries.has(entry)));

    entries.splice(0, entries.length, ...entries.filter((entry) => !shed.has(entry)));

    const performed = this.poppedStackItem === null ? undefined : this.entryByStackItem.get(this.poppedStackItem);
    const carried = performed ?? [...shed].at(-1);

    if (carried !== undefined && this.replayStackItem !== null) {
      this.entryByStackItem.set(this.replayStackItem, carried);
    }

    return carried;
  }

  /**
   * Helper to push caret entry to a stack and restore caret position.
   */
  private pushCaretAndRestore(
    entry: CaretHistoryEntry | undefined,
    stack: CaretHistoryEntry[],
    position: 'before' | 'after'
  ): void {
    // The pending snapshot of the undo key press must not outlive the replay.
    this.resetPendingCaretState();
    this.openEntry = null;

    if (entry === undefined) {
      return;
    }

    stack.push(entry);

    // Use the requested position, falling back to the other one when the
    // requested snapshot wasn't captured (e.g., the debounced selectionchange
    // hadn't set currentBlock for table cell paragraphs).
    // The fallback offset will be clamped to the actual text length by the
    // caret restore logic, so the caret ends up at a reasonable position.
    const snapshot = position === 'before'
      ? entry.before ?? entry.after
      : entry.after ?? entry.before;

    this.caretJustRestored = this.restoreCaretSnapshot(snapshot);
  }

  /**
   * Execute a Yjs UndoManager operation with the isPerformingUndoRedo flag set.
   * This prevents the stack-item-added listener from modifying caret stacks during
   * explicit undo/redo operations.
   */
  private performYjsUndoRedo(operation: () => void): void {
    this.isPerformingUndoRedo = true;
    this.replayStackItem = null;
    this.poppedStackItem = null;
    try {
      operation();
    } finally {
      this.isPerformingUndoRedo = false;
    }
  }

  /**
   * Re-anchor the capture-merge clock to when the change actually happened.
   *
   * A coalesced trailing flush transacts up to 400ms after the typing it
   * carries; Y.UndoManager stamps `lastChange` with the FLUSH time, so the
   * captureTimeout would measure the next action's gap from the flush and
   * merge actions the user separated by more than the capture window (two
   * typing pauses, or typing followed by a tune change). Rewind only —
   * never push the clock forward, and never touch the `0` sentinel a
   * stopCapturing leaves (`0` means "always split next"; every real
   * timestamp exceeds a rewind target).
   * @param toTime - the wall-clock time of the flushed writes' last enqueue
   */
  public rewindCaptureClock(toTime: number): void {
    if (this.undoManager.lastChange > toTime) {
      this.undoManager.lastChange = toTime;
    }
  }

  /**
   * Re-open the newest undo entry when the block about to be replaced is one
   * that very entry created.
   *
   * A replace-insert removes the block it replaces (see `BlockInsertion`), and
   * Y.UndoManager only skips resurrecting a deleted item when the SAME stack
   * item also holds its insertion. A scaffold slot — the empty paragraph the
   * plus button builds before the toolbox opens — is created in one entry and
   * replaced in the next as soon as the user takes longer than `captureTimeout`
   * to pick a tool, so undoing the pick brought the scaffold back and the
   * gesture needed two presses. Merging the two makes it one press again, and
   * redo then restores only the chosen block.
   *
   * The check is exact, not a heuristic: only a block whose creation is still
   * the newest entry never existed as a state of its own. A slot the user made
   * earlier (their own Enter, then typing) or one that came from the loaded
   * document is buried under later entries — no merge, and undo restores it.
   * @param creationId - id of the Y item holding the block, or null when the
   *   block is not in the doc
   */
  public continueEntryThatCreated(creationId: Y.ID | null): void {
    const { undoStack } = this.undoManager;
    const newestEntry = undoStack[undoStack.length - 1];

    if (creationId === null || newestEntry === undefined || this.joiningDepth > 0) {
      return;
    }

    if (!Y.isDeleted(newestEntry.insertions, creationId)) {
      return;
    }

    this.undoManager.lastChange = Date.now();
  }

  /**
   * Run the untracked write `fn` as part of the undo step that wrote the
   * current value of one of `from`'s keys in `data` (the edit the write was
   * worked out from), so undoing that step removes the write and redo brings
   * it back. It stays out of the history (redo is kept, no new step). When no
   * step on the undo stack wrote those values (none named, or that edit was
   * undone), the write is just untracked.
   *
   * Only `fn`'s first transaction joins the step; call it outside any
   * transaction and after the write buffer is flushed.
   * @param data - the block's data map (anything else means no step)
   * @param fn - the untracked write
   * @param from - the keys of `data` the write was worked out from
   */
  public addToStepThatWrote(data: unknown, fn: () => void, from: readonly string[] = []): void {
    this.joiningDepth += 1;
    try {
      this.joinStepThatWrote(data instanceof Y.Map ? this.stepThatWrote(data, from) : undefined, fn);
    } finally {
      this.joiningDepth -= 1;
    }
  }

  /**
   * See {@link addToStepThatWrote}.
   * @param step - the step to join, if any
   * @param fn - the untracked write
   */
  private joinStepThatWrote(step: StackItem | undefined, fn: () => void): void {
    const doc = this.undoManager.doc;

    if (step === undefined || doc._transaction !== null) {
      fn();

      return;
    }

    const join = (transaction: Y.Transaction): void => {
      doc.off('afterTransaction', join);

      const insertions = Y.createDeleteSet();

      transaction.afterState.forEach((end, client) => {
        const start = transaction.beforeState.get(client) ?? 0;

        if (end > start) {
          insertions.clients.set(client, [{ clock: start, len: end - start }]);
        }
      });
      // Yjs frees deleted content when the transaction ends; undo needs it back.
      Y.iterateDeletedStructs(transaction, transaction.deleteSet, (struct) => {
        if (struct instanceof Y.Item) {
          keepWithParents(struct);
        }
      });
      /* eslint-disable no-param-reassign -- the write joins the step in place */
      step.insertions = Y.mergeDeleteSets([step.insertions, insertions]);
      step.deletions = Y.mergeDeleteSets([step.deletions, transaction.deleteSet]);
      /* eslint-enable no-param-reassign */
    };

    doc.on('afterTransaction', join);
    try {
      fn();
    } finally {
      doc.off('afterTransaction', join);
    }
    if (this.changesNothing(step)) {
      this.dropStep(step);
    }
  }

  /**
   * @param step - an undo step
   * @returns whether undoing it would change nothing but edit metadata: every
   *   value it wrote is gone again or equals the value it replaced (a failed
   *   upload putting back the link it was started from)
   */
  private changesNothing(step: StackItem): boolean {
    const inserted = this.itemsIn(step.insertions);
    const live = inserted.filter((item) => !item.deleted && !isEditMetadata(item));

    // Text, list or block content: checked first, it keeps a large step cheap.
    if (live.some((item) => item.parentSub === null)) {
      return false;
    }

    const written = new Set(inserted);
    const replaced = this.itemsIn(step.deletions).filter((item) => !written.has(item) && !isEditMetadata(item));
    const sameEntry = (a: Y.Item, b: Y.Item): boolean => a.parent === b.parent && a.parentSub === b.parentSub;

    return live.every((item) => replaced.some((old) => sameEntry(old, item) && sameValue(old, item)))
      && replaced.every((old) => live.some((item) => sameEntry(old, item)));
  }

  /**
   * @param set - insertions or deletions of a step
   * @returns the items it covers
   */
  private itemsIn(set: StackItem['insertions']): Y.Item[] {
    const { store } = this.undoManager.doc;
    const items: Y.Item[] = [];

    set.clients.forEach((ranges, client) => {
      const structs = store.clients.get(client) ?? [];

      ranges.forEach(({ clock, len }) => {
        if (structs.length === 0) {
          return;
        }
        const range = structs.slice(Y.findIndexSS(structs, clock), Y.findIndexSS(structs, clock + len - 1) + 1);

        range.forEach((struct) => {
          if (struct instanceof Y.Item) {
            items.push(struct);
          }
        });
      });
    });

    return items;
  }

  /**
   * Take a step off the undo stack with its caret entry. Redo is untouched.
   * @param step - a step on the undo stack
   */
  private dropStep(step: StackItem): void {
    const { undoStack } = this.undoManager;
    const index = undoStack.indexOf(step);

    if (index === -1) {
      return;
    }
    undoStack.splice(index, 1);
    // Nothing may merge into the step below: it closed before this one opened.
    if (index === undoStack.length) {
      this.undoManager.stopCapturing();
    }

    const entry = this.entryByStackItem.get(step);

    if (entry === undefined) {
      return;
    }
    this.caretUndoStack = this.caretUndoStack.filter((candidate) => candidate !== entry);
    if (this.openEntry === entry) {
      this.openEntry = null;
    }
  }

  /**
   * @param data - a block's data map
   * @param keys - keys of `data`
   * @returns the undo step that inserted the current value of one of `keys`
   */
  private stepThatWrote(data: Y.Map<unknown>, keys: readonly string[]): StackItem | undefined {
    const current = keys.flatMap((key) => {
      const item = data._map.get(key);

      return item === undefined || item.deleted ? [] : [item.id];
    });

    return [...this.undoManager.undoStack].reverse().find((step) => current.some((id) => Y.isDeleted(step.insertions, id)));
  }

  /**
   * The implicit step boundary many write paths call. Once gestures drive the
   * steps it only flushes: a write a gesture causes (its deferred save-back,
   * its second half) then stays in that gesture's step. Use
   * {@link startSubStep} for a split the user must see.
   */
  public stopCapturing(): void {
    if (this.gesturesDriveSteps) {
      this.flushPendingWritesHook();

      return;
    }

    this.splitStep();
  }

  /**
   * Close the open step for real.
   */
  public splitStep(): void {
    // Flush BEFORE closing the group: a word-boundary checkpoint must carry
    // the buffered tail of the word it ends (100ms boundary vs 400ms trailing).
    this.flushPendingWritesHook();

    this.undoManager.stopCapturing();
  }

  /**
   * A user gesture starts (a key, a pointer press, a paste, an API call).
   * Only here does a step close, and here the step's caret-before is taken,
   * before any handler moves the caret.
   * @param kind - 'typing' continues a typing run in the same input; any
   *   other gesture always closes the open step
   * @returns whether the open step was closed
   */
  public beginGesture(kind: 'typing' | 'discrete'): boolean {
    return this.startGesture(kind, false);
  }

  /**
   * A public API call that writes. Outside a gesture it is a gesture of its
   * own (host code driving the editor). Inside one, it is part of that
   * gesture: a tool calling the API from its key handler, or the block menu
   * inserting the picked tool while its session holds the step.
   */
  public beginApiCall(): void {
    if (!this.gestureTaskOpen && this.captureHolds === 0 && this.joiningDepth === 0) {
      this.startGesture('discrete', true);
    }
  }

  /**
   * @param kind - see {@link beginGesture}
   * @param keepPending - keep a caret-before that is still pending instead of
   *   taking the live caret
   */
  private startGesture(kind: 'typing' | 'discrete', keepPending: boolean): boolean {
    if (this.isPerformingUndoRedo) {
      return false;
    }

    this.gesturesDriveSteps = true;

    if (!this.gestureTaskOpen) {
      this.gestureTaskOpen = true;
      setTimeout(() => {
        this.gestureTaskOpen = false;
      }, 0);
    }

    const live = this.liveCaretSnapshot();

    if (live !== null && this.openEntry !== null && this.openEntry === this.caretUndoStack.at(-1)) {
      this.openEntry.after = live;
    }
    this.openEntry = null;

    const liveKey = live === null ? null : `${live.blockId}#${live.inputIndex}`;
    const continuesTyping = kind === 'typing' && liveKey !== null && liveKey === this.typingInputKey;

    if (!continuesTyping) {
      this.closeStepForGesture();
    }
    this.typingInputKey = kind === 'typing' ? liveKey : null;

    // After the split: its flush can consume (and reset) the pending snapshot.
    if (live !== null && !(keepPending && this.hasPendingCaret)) {
      this.pendingCaretBefore = live;
      this.hasPendingCaret = true;
    }

    return !continuesTyping;
  }

  /**
   * Split, and remember where the closed step ends. The step counts as open
   * when yjs would still have merged a write into it, or when the split's own
   * flush just created it.
   */
  private closeStepForGesture(): void {
    const { undoManager } = this;
    const lengthBefore = undoManager.undoStack.length;
    // yjs stamps `lastChange` with the Date.now lib0 saved at import. Fake
    // timers swap only the global one, so there the two clocks can differ.
    const wasOpen = undoManager.lastChange !== 0 && Date.now() - undoManager.lastChange < undoManager.captureTimeout;

    this.splitStep();

    const stack = undoManager.undoStack;
    const top = stack.at(-1) ?? null;

    this.lastClosedStep = {
      open: wasOpen || stack.length > lengthBefore ? top : null,
      top,
      undoLength: stack.length,
      caretLength: this.caretUndoStack.length,
    };
  }

  /**
   * The step the last gesture start closed. Read it right after
   * {@link beginGesture} returns true.
   */
  public get closedStep(): ClosedStep | null {
    return this.lastClosedStep;
  }

  /**
   * Land a write that belongs to the step `closed` ended (a save that was in
   * flight when the gesture started) without joining the gesture's step.
   *
   * - The gesture has not written yet: `tracked` lands as usual. The caller
   *   closes the step after it.
   * - The closed step was open: `untracked` joins it.
   * - It was not: `tracked` becomes a step of its own, under the gesture's.
   * - History moved under the gesture (an undo): the write is not landed.
   * @param closed - from {@link closedStep}
   * @param tracked - the write
   * @param untracked - the same write, run without capture
   * @returns false when the caller must land the write as usual
   */
  public landLateWrite(closed: ClosedStep, tracked: () => void, untracked: () => void): boolean {
    if (!this.gestureWroteSince(closed)) {
      return false;
    }

    if (closed.open !== null || this.stepUnderGesture.has(closed)) {
      this.addToClosedStep(closed, untracked);
    } else {
      this.insertStepUnder(closed, tracked);
    }

    return true;
  }

  /**
   * Whether the gesture that closed `closed` has written its own step, with
   * the history under it untouched since.
   * @param closed - from {@link closedStep}
   */
  public gestureWroteSince(closed: ClosedStep): boolean {
    const stack = this.undoManager.undoStack;
    const intact = stack.length >= closed.undoLength && (closed.top === null || stack[closed.undoLength - 1] === closed.top);

    return intact && (stack.length > closed.undoLength || this.caretUndoStack.length > closed.caretLength);
  }

  /**
   * Run the tracked write `fn` as a step of its own at `closed`'s end, under
   * the steps written since. The step on top stays open.
   * @param closed - where the step goes
   * @param fn - the tracked write
   */
  private insertStepUnder(closed: ClosedStep, fn: () => void): void {
    const { undoManager } = this;
    const stack = undoManager.undoStack;
    const lastChange = undoManager.lastChange;
    const openEntry = this.openEntry;
    const gestureEntry = this.caretUndoStack[closed.caretLength];
    const lengthBefore = stack.length;

    undoManager.stopCapturing();
    this.withoutCaretMark(fn);
    undoManager.lastChange = lastChange;
    this.openEntry = openEntry;

    if (stack.length === lengthBefore) {
      return;
    }

    const item = stack.pop();

    if (item === undefined) {
      return;
    }

    stack.splice(closed.undoLength, 0, item);
    // More late writes of the same typing join it.
    this.stepUnderGesture.set(closed, item);

    const entry = this.entryByStackItem.get(item);

    if (entry === undefined) {
      return;
    }

    this.caretUndoStack.splice(this.caretUndoStack.lastIndexOf(entry), 1);
    this.caretUndoStack.splice(closed.caretLength, 0, entry);
    // The caret the gesture started from is where this write's typing ended.
    entry.before = gestureEntry?.before ?? entry.before;
    entry.after = gestureEntry?.before ?? entry.after;
  }

  /**
   * Run the untracked write `fn` as part of the step `closed` ended.
   *
   * Only `fn`'s first transaction joins the step; call it outside any
   * transaction and after the write buffer is flushed.
   * @param closed - the closed step
   * @param fn - the untracked write
   */
  private addToClosedStep(closed: ClosedStep, fn: () => void): void {
    const step = this.stepUnderGesture.get(closed) ?? closed.open;
    const doc = this.undoManager.doc;

    if (step === null || doc._transaction !== null) {
      fn();

      return;
    }

    const join = (transaction: Y.Transaction): void => {
      doc.off('afterTransaction', join);

      const written = writtenBy(transaction);

      step.insertions = Y.mergeDeleteSets([step.insertions, written.insertions]);
      step.deletions = Y.mergeDeleteSets([step.deletions, written.deletions]);
    };

    doc.on('afterTransaction', join);
    try {
      fn();
    } finally {
      doc.off('afterTransaction', join);
    }
  }

  /**
   * A split inside one gesture, for a conversion the user undoes on its own
   * (a markdown shortcut, an emoji). Its caret-before is the caret from before
   * the flush: the handler moves the caret before its write marks one. It
   * also ends the typing run, so the next keystroke starts a new step.
   */
  public startSubStep(): void {
    const caret = this.captureCaretSnapshot();

    this.splitStep();
    this.typingInputKey = null;

    if (!this.hasPendingCaret) {
      this.pendingCaretBefore = caret;
      this.hasPendingCaret = true;
    }
  }

  /**
   * Keep the open step open past the capture timeout, for a gesture the user
   * can pause in the middle of (a pointer drag, an IME composition). Every
   * hold must be released.
   */
  public holdCapture(): void {
    this.captureHolds++;
    this.undoManager.captureTimeout = Infinity;
  }

  /**
   * Release one {@link holdCapture}.
   */
  public releaseCapture(): void {
    this.captureHolds = Math.max(0, this.captureHolds - 1);

    if (this.captureHolds === 0) {
      this.undoManager.captureTimeout = CAPTURE_TIMEOUT_MS;
    }
  }

  /**
   * The caret snapshot, only when the live selection is in one of this
   * editor's blocks. The `currentBlock` fallback of {@link captureCaretSnapshot}
   * would invent an offset from a selection that lives elsewhere.
   */
  private liveCaretSnapshot(): CaretSnapshot | null {
    const anchorNode = window.getSelection()?.anchorNode ?? null;

    if (anchorNode === null || this.blok?.BlockManager?.getBlockByChildNode(anchorNode) === undefined) {
      return null;
    }

    return this.captureCaretSnapshot();
  }

  /**
   * A pending caret-before belongs to the caret it was taken from. Once the
   * caret is in another block or input, a later write with no gesture of its
   * own (an API call) must not inherit it.
   */
  private dropPendingCaretIfMoved(): void {
    const pending = this.pendingCaretBefore;

    if (!this.hasPendingCaret || pending === null) {
      return;
    }

    const live = this.liveCaretSnapshot();

    if (live !== null && (live.blockId !== pending.blockId || live.inputIndex !== pending.inputIndex)) {
      this.resetPendingCaretState();
    }
  }

  /**
   * Whether `undo()` would apply something: the same walk, read without
   * changing the doc. The entries it sets aside are skipped here.
   */
  public canUndo(): boolean {
    if (this.nothingUndoable) {
      return false;
    }

    return this.walkOrder('undo').some(({ group, item }) => group !== undefined
      ? group.length > 0 && !this.groupWasDisplacedSince(group, 'to')
      : item !== undefined && this.itemWouldApply(item, 'undo'));
  }

  /**
   * The entries of one direction newest first, the way `undo()`/`redo()`
   * reach them: in caret stack order, then any yjs item left without one.
   * @param direction - which stacks to read
   */
  private walkOrder(direction: 'undo' | 'redo'): Array<{ group?: MoveHistoryEntry; item?: StackItem }> {
    const undo = direction === 'undo';
    const groups = [...(undo ? this.moveUndoStack : this.moveRedoStack)].reverse();
    const items = [...(undo ? this.undoManager.undoStack : this.undoManager.redoStack)].reverse();
    const carets = [...(undo ? this.caretUndoStack : this.caretRedoStack)].reverse();
    const inOrder = carets.map((entry) => entry.kind === 'move' ? { group: groups.shift() } : { item: items.shift() });

    return [...inOrder, ...items.map((item) => ({ item }))];
  }

  /**
   * Whether replaying this yjs item on its own would change the doc and is
   * not refused.
   * @param stackItem - an undo or redo stack item
   * @param direction - which stack it is on
   */
  private itemWouldApply(stackItem: StackItem, direction: 'undo' | 'redo'): boolean {
    return !this.wouldResurrectBesideASparedBlock(this.scanTopEntry([stackItem])) &&
      this.undoWouldApply(stackItem, direction);
  }

  /**
   * Whether undoing `stackItem` would change the doc, read without changing
   * it. Mirrors `popStackItem` and `redoItem` of yjs 13.6: an item it
   * inserted that is live and the filter lets go, or an item it deleted that
   * yjs can bring back (its parent is live or comes back too, and no other
   * client wrote the same map key since). Where yjs follows a redo chain this
   * answers yes, so a mismatch errs toward "can undo"; the press then
   * measures the truth (see {@link nothingUndoable}).
   * @param stackItem - an undo or redo stack item
   * @param direction - which stack it is on
   */
  private undoWouldApply(stackItem: StackItem, direction: 'undo' | 'redo'): boolean {
    const doc = this.blocksScope?.doc ?? null;

    if (doc === null) {
      return true;
    }

    const { scope, undoStack, redoStack } = this.undoManager;
    const inScope = (item: Y.Item): boolean =>
      scope.some((type) => (type as unknown) === doc || Y.isParentOf(type as Y.AbstractType<unknown>, item));
    const deletedByStacks = (id: Y.ID): boolean =>
      [...undoStack, ...redoStack].some((other) => Y.isDeleted(other.deletions, id));
    // yjs gives up on a map key another client wrote after this item, unless
    // that write is one undo/redo would remove anyway.
    const keyIsFree = (item: Y.Item): boolean => {
      const right = item.right;

      if (right === null || right.redone !== null) {
        return true;
      }

      return (Y.isDeleted(stackItem.insertions, right.id) || deletedByStacks(right.id)) && keyIsFree(right);
    };
    const born = this.blocksBornInPoppedEntry;
    const spares = this.sparesTextOfBornBlocks;
    const deletable: Y.Item[] = [];
    const toRedo = new Set<Y.Item>();
    const canBringBack = (item: Y.Item): boolean => {
      const parentItem = item.parent instanceof Y.AbstractType ? item.parent._item : null;
      const parentStaysDeleted = parentItem !== null && parentItem.deleted && parentItem.redone === null &&
        (!toRedo.has(parentItem) || !canBringBack(parentItem));

      return item.redone !== null || (!parentStaysDeleted && (item.parentSub === null || keyIsFree(item)));
    };

    this.blocksBornInPoppedEntry = this.scanTopEntry([stackItem]).born;
    this.sparesTextOfBornBlocks = direction === 'redo';
    try {
      doc.transact((transaction) => {
        Y.iterateDeletedStructs(transaction, stackItem.insertions, (struct) => {
          if (struct instanceof Y.Item && (struct.redone !== null || (!struct.deleted && inScope(struct) && this.mayUndoDelete(struct)))) {
            deletable.push(struct);
          }
        });
        Y.iterateDeletedStructs(transaction, stackItem.deletions, (struct) => {
          if (struct instanceof Y.Item && inScope(struct) && !Y.isDeleted(stackItem.insertions, struct.id)) {
            toRedo.add(struct);
          }
        });
      });
    } finally {
      this.blocksBornInPoppedEntry = born;
      this.sparesTextOfBornBlocks = spares;
    }

    return deletable.length > 0 || [...toRedo].some(canBringBack);
  }

  /**
   * Whether `redo()` would apply something: the same walk, read without
   * changing the doc. Redo reaches past an overruled move and a spent item
   * only; a refused or waiting item holds every later step back.
   */
  public canRedo(): boolean {
    for (const { group, item } of this.walkOrder('redo')) {
      const verdict = this.redoVerdict(group, item);

      if (verdict !== null) {
        return verdict;
      }
    }

    return false;
  }

  /**
   * What a redo walk decides at one entry: true when it applies, false when
   * it stops the walk, null when the walk goes on past it.
   * @param group - the entry's move group, if it is a move
   * @param item - the entry's yjs item, if it is an edit
   */
  private redoVerdict(group: MoveHistoryEntry | undefined, item: StackItem | undefined): boolean | null {
    if (group !== undefined) {
      return group.length > 0 && !this.groupWasDisplacedSince(group, 'from') ? true : null;
    }
    if (item === undefined) {
      return null;
    }
    if (this.itemWouldApply(item, 'redo')) {
      return true;
    }

    const waits = this.wouldResurrectBesideASparedBlock(this.scanTopEntry([item])) ||
      this.wasBlockedBySparing(item) || this.isShadowed(item, []);

    return waits ? false : null;
  }

  /**
   * Record a move entry for undo and clear the redo stack.
   * This is the standard undo/redo behavior: new actions invalidate the redo stack.
   * Also records caret position before/after the move(s).
   * @param entry - Move history entry to record
   * @param skipCaretCapture - If true, skip caret capture (used by endMoveGroup which handles it separately)
   */
  private recordMoveForUndo(entry: MoveHistoryEntry, skipCaretCapture = false): void {
    this.moveUndoStack.push(entry);
    this.moveRedoStack = [];
    this.stampReplayAnchor(entry);

    // The yjs redo branch has to die with it. A move's own transaction uses the
    // UNTRACKED 'move' origin (the placement stacks own its history, and a
    // tracked one would record every move twice), so yjs bails out of
    // `addStackItem` before the `else if (!redoing) this.clear(false, true)`
    // that normally drops its redoStack on a new action. Left alone, the next
    // `redo()` sees an empty caret redo stack, concludes "not a move", and
    // delegates to `undoManager.redo()` — replaying an edit the user already
    // undid. Inert when there is nothing to clear, and its transaction is
    // origin-less + touches no shared type, so no observer event escapes.
    this.undoManager.clear(false, true);

    // And a capture boundary. Without it the next tracked write merges into the
    // stack item recorded BEFORE the move ('stack-item-updated', so no new
    // caret entry), leaving the caret stack's top the move — one undo then
    // reverses the move instead of the edit typed after it.
    this.undoManager.stopCapturing();

    // Record caret positions for this move entry (single moves only)
    // Grouped moves handle caret tracking via startMoveGroup/endMoveGroup
    if (!skipCaretCapture) {
      this.finalizeCaretEntry();
    }
  }

  /**
   * Finalize and record a caret history entry.
   * Captures the current caret position as the "after" state,
   * pushes the entry to the undo stack, clears redo stack, and resets pending state.
   */
  private finalizeCaretEntry(): void {
    this.caretUndoStack.push({
      before: this.pendingCaretBefore,
      after: this.captureCaretSnapshot(),
      kind: 'move',
    });
    this.caretRedoStack = [];
    this.resetPendingCaretState();
  }

  /**
   * Start collecting move operations into a single undo group.
   * All moveBlock calls after this will be collected until endMoveGroup() is called.
   * Also captures caret position before the group starts.
   */
  public startMoveGroup(): void {
    this.markCaretBeforeChange();
    this.pendingMoveGroup = [];
  }

  /**
   * End the current move group and push all collected moves as a single undo entry.
   * If no moves were collected, nothing is added to the undo stack.
   * Also captures caret position after the group completes.
   */
  public endMoveGroup(): void {
    if (this.pendingMoveGroup !== null && this.pendingMoveGroup.length > 0) {
      // Record moves without auto-caret capture (we handle it here)
      this.recordMoveForUndo(this.pendingMoveGroup, true);
      this.finalizeCaretEntry();
    }
    this.pendingMoveGroup = null;
  }

  /**
   * Execute multiple move operations as a single atomic undo group.
   * Provides exception safety: endMoveGroup is always called even if fn throws.
   * @param fn - Function containing move operations to execute atomically
   */
  public transactMoves(fn: () => void): void {
    // A nested call rides the open group; starting another would discard
    // the moves collected so far.
    if (this.pendingMoveGroup !== null) {
      fn();

      return;
    }

    this.startMoveGroup();
    try {
      fn();
    } finally {
      this.endMoveGroup();
    }
  }

  /**
   * Record a move operation. Called by YjsManager during moveBlock.
   * The entry's `from` placement must be captured from the doc BEFORE the
   * mutation and `to` after it.
   * @param entry - Move entry carrying both placements
   * @param isGrouped - Whether this is part of a grouped move operation
   */
  public recordMove(entry: SingleMoveEntry, isGrouped: boolean): void {
    if (isGrouped && this.pendingMoveGroup !== null) {
      // Grouped move: collect into pending group
      this.pendingMoveGroup.push(entry);
    } else {
      // Single move: record immediately
      this.markCaretBeforeChange();
      this.recordMoveForUndo([entry]);
    }
  }

  /**
   * Add a reparent to the in-flight move group as its own entry.
   *
   * Used by drag-reparent so that `undo` restores the parent relationship
   * atomically with the position. The caller (`BlockManager.setBlockParent`
   * when `YjsManager.isInMoveGroup` is true) is responsible for writing the
   * placement to Yjs through the no-capture flavor so the Y.UndoManager
   * does not also record the change.
   *
   * Never merged into an earlier entry of the same block: the group replays
   * its entries in reverse, and each `from` is only true while every later
   * entry is already undone. A merged entry jumps over the moves recorded
   * between its two writes, so its replay reads anchors that are not there.
   * @param blockId - id of the reparented block
   * @param from - the block's doc placement BEFORE the reparent write
   * @param to - the placement the reparent wrote
   */
  public recordParentChangeForPendingMove(
    blockId: string,
    from: BlockPlacement,
    to: BlockPlacement
  ): void {
    // Not inside a move group — nothing to attach to. Drop the hint.
    this.pendingMoveGroup?.push({ blockId, from, to });
  }

  /**
   * Capture the current caret position as a snapshot.
   * @returns CaretSnapshot or null if no block is focused
   */
  public captureCaretSnapshot(): CaretSnapshot | null {
    // Guard against being called before Blok is fully initialized
    if (this.blok === undefined || this.blok.BlockManager === undefined) {
      return null;
    }

    const { BlockManager } = this.blok;

    // Prefer the block the caret is *actually* in (the live DOM selection) over
    // `BlockManager.currentBlock`. The latter is updated by a debounced (180ms)
    // selectionchange handler, so it can lag behind the real caret — e.g. when
    // the caret just moved into another block and an undoable change fires before
    // the debounce. Trusting the stale block records a snapshot whose blockId
    // belongs to one block while the offset is read from another, sending the
    // caret to the wrong block on undo/redo.
    //
    // Resolution must stay side-effect free: this runs inside the Yjs
    // `stack-item-added` / `stack-item-updated` listeners (mid-transaction), so
    // it uses the read-only `getBlockByChildNode` rather than
    // `setCurrentBlockByChildNode`, which would mutate `currentBlockIndex` and
    // corrupt in-flight merge/undo operations.
    //
    // Fall back to currentBlock when there is no in-block selection (e.g. focus
    // is on a toolbar control, or selectionchange hasn't set it yet for nested
    // blocks like table cell paragraphs).
    const anchorNode = window.getSelection()?.anchorNode ?? null;
    const selectionBlock = anchorNode !== null
      ? BlockManager.getBlockByChildNode(anchorNode)
      : undefined;

    const currentBlock = selectionBlock ?? BlockManager.currentBlock;

    if (currentBlock === undefined) {
      return null;
    }

    // When the snapshot comes from the live selection, derive the input + offset
    // from that same selection so the inputIndex/offset stay consistent with the
    // block id (a multi-input block records the input the caret is actually in).
    // Otherwise fall back to the block's tracked current input.
    const selectedIndex = selectionBlock !== undefined && anchorNode !== null
      ? currentBlock.inputs.findIndex(
        candidate => candidate === anchorNode || candidate.contains(anchorNode)
      )
      : -1;

    const inputIndex = selectedIndex !== -1 ? selectedIndex : currentBlock.currentInputIndex;
    const input = selectedIndex !== -1 ? currentBlock.inputs[selectedIndex] : currentBlock.currentInput;

    const offset = input !== undefined ? getCaretOffset(input) : 0;
    const end = input !== undefined ? UndoHistory.selectionEndIn(input) : null;

    return {
      blockId: currentBlock.id,
      inputIndex,
      offset,
      ...(end === null ? {} : { end }),
    };
  }

  /**
   * Text offset of the selection's end, when the selection is a range that
   * starts and ends inside `input`
   * @param input - the input the snapshot is taken in
   */
  private static selectionEndIn(input: HTMLElement): number | null {
    const selection = window.getSelection();
    const range = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    if (range === null || range.collapsed || !input.contains(range.startContainer) || !input.contains(range.endContainer)) {
      return null;
    }

    const preEnd = document.createRange();

    preEnd.selectNodeContents(input);
    preEnd.setEnd(range.endContainer, range.endOffset);

    return preEnd.toString().length;
  }

  /**
   * Mark the caret position before a change starts.
   * Call this before any operation that might be undoable.
   *
   * By default only the first call captures; subsequent calls are ignored until
   * the pending state is reset (when a change is recorded). This dedupes the
   * keydown + beforeinput pair for one keystroke and, crucially, prevents a
   * change's own follow-up writes (e.g. the deferred `syncBlockDataToYjs` after
   * an Enter split) from overwriting the genuine pre-change caret with the
   * post-change one.
   *
   * @param force - When true, always (re)capture, discarding any existing
   *   pending snapshot. Pass this from keyboard gesture handlers (keydown /
   *   beforeinput): a new gesture means the caret-before is the caret *now*, so
   *   a stale pending left dangling by a prior operation's no-op follow-up write
   *   must not survive into this one. Without it, the caret would restore to that
   *   stale position (e.g. the start of the wrong block) on undo.
   */
  public markCaretBeforeChange(force = false): void {
    if (this.hasPendingCaret && !force) {
      return;
    }

    this.pendingCaretBefore = this.captureCaretSnapshot();
    this.hasPendingCaret = true;
  }

  /**
   * Map every stored caret snapshot of one block, after a peer rewrote its text.
   * @param blockId - the rewritten block
   * @param rebase - maps a snapshot taken against the old text
   */
  public rebaseCaretSnapshots(blockId: string, rebase: (snapshot: CaretSnapshot) => CaretSnapshot): void {
    const apply = (snapshot: CaretSnapshot | null): CaretSnapshot | null =>
      snapshot !== null && snapshot.blockId === blockId ? rebase(snapshot) : snapshot;

    for (const entry of [...this.caretUndoStack, ...this.caretRedoStack]) {
      entry.before = apply(entry.before);
      entry.after = apply(entry.after);
    }
    this.pendingCaretBefore = apply(this.pendingCaretBefore);
  }

  /**
   * Update the "after" position of the most recent caret undo entry.
   * This is used when the caret is moved asynchronously (e.g., via requestAnimationFrame)
   * after a Yjs transaction has already captured the initial "after" position.
   */
  public updateLastCaretAfterPosition(): void {
    if (this.caretUndoStack.length === 0) {
      return;
    }

    const lastEntry = this.caretUndoStack[this.caretUndoStack.length - 1];
    lastEntry.after = this.captureCaretSnapshot();
  }

  /**
   * Restore scroll position if it jumped far from the original position.
   * This catches cases where caret restoration focused a distant block
   * (e.g., the referenced block was removed during undo and the fallback
   * set focus to the first block at the top of the article).
   */
  private restoreScrollIfJumped(savedScrollY: number): void {
    if (Math.abs(window.scrollY - savedScrollY) > window.innerHeight) {
      window.scrollTo(0, savedScrollY);
    }

    if (this.caretJustRestored) {
      this.caretJustRestored = false;
      UndoHistory.revealCaret();
    }
  }

  /**
   * Restore caret position from a snapshot.
   * Handles edge cases: null snapshot, deleted block, invalid input index,
   * and disconnected inputs (e.g., after table DOM rebuild during undo).
   */
  private restoreCaretSnapshot(snapshot: CaretSnapshot | null): boolean {
    if (snapshot === null) {
      // No snapshot available — preserve whatever focus state exists after the
      // DOM update rather than actively destroying the selection.
      return false;
    }

    const { BlockManager, Caret } = this.blok;
    const block = BlockManager.getBlockById(snapshot.blockId);

    // Block no longer exists. Do NOT yank the caret to the first block at the
    // document START — that is the user-visible "caret jumps to the very
    // beginning on undo/redo" bug. The snapshot recorded a position deep in the
    // document; teleporting to the top is never the right recovery and loses the
    // user's place. Preserve whatever focus state exists after the DOM update
    // instead (same philosophy as the null-snapshot branch above).
    if (block === undefined) {
      return false;
    }

    // Get the specific input within the block
    const input = block.inputs[snapshot.inputIndex];

    if (input !== undefined && input.isConnected) {
      // A block selection left from before would take the next key, and a
      // stale current block the next edit.
      this.blok.BlockSelection.clearSelection();
      BlockManager.setCurrentBlockByChildNode(input);
      Caret.setToInput(input, Caret.positions.DEFAULT, snapshot.offset);
      this.selectRange(input, snapshot);

      return true;
    }

    // Input is disconnected or doesn't exist (e.g., the block was removed from
    // a table cell during undo but still exists in BlockManager). Try to find
    // a connected sibling block in the same parent context.
    if (block.parentId != null) {
      const lastConnectedSibling = BlockManager.blocks
        .filter(b => b.parentId === block.parentId && b.id !== block.id && b.inputs.length > 0 && b.inputs[0].isConnected)
        .at(-1);

      if (lastConnectedSibling !== undefined) {
        Caret.setToBlock(lastConnectedSibling, Caret.positions.END);

        return true;
      }

      // No connected siblings — try the parent block itself
      const parentBlock = BlockManager.getBlockById(block.parentId);

      if (parentBlock !== undefined) {
        Caret.setToBlock(parentBlock, Caret.positions.START);

        return true;
      }
    }

    // Fall back to block start
    Caret.setToBlock(block, Caret.positions.START);

    return true;
  }

  /**
   * Re-select a range the snapshot recorded (collapsed carets have no `end`)
   * @param input - the restored input
   * @param snapshot - the snapshot being restored
   */
  private selectRange(input: HTMLElement, snapshot: CaretSnapshot): void {
    if (snapshot.end === undefined) {
      return;
    }

    // An open inline toolbar still shows the marks from before the replay.
    if (this.blok.InlineToolbar.opened) {
      this.blok.InlineToolbar.close();
    }

    const start = resolveCaretRange(input, snapshot.offset);
    const end = resolveCaretRange(input, snapshot.end);

    if (start !== null && end !== null) {
      window.getSelection()?.setBaseAndExtent(start.startContainer, start.startOffset, end.startContainer, end.startOffset);
    }
  }

  /**
   * Scroll just enough to show a restored caret. Runs after
   * {@link restoreScrollIfJumped}, which can throw the page back past it.
   * Same arithmetic as `Caret.set`.
   */
  private static revealCaret(): void {
    const selection = window.getSelection();

    if (selection === null || selection.rangeCount === 0) {
      return;
    }

    const margin = 30;
    const { top, bottom } = selection.getRangeAt(0).getBoundingClientRect();

    if (top < 0) {
      window.scrollBy(0, top - margin);
    } else if (bottom > window.innerHeight) {
      window.scrollBy(0, bottom - window.innerHeight + margin);
    }
  }


  /**
   * Check if there is a pending boundary waiting for timeout.
   * @returns true if a boundary character was typed and hasn't timed out yet
   */
  public hasPendingBoundary(): boolean {
    return this.pendingBoundary;
  }

  /**
   * Mark that a boundary character (space, punctuation) was just typed.
   * Starts a timer that will call stopCapturing() after BOUNDARY_TIMEOUT_MS
   * if no new input arrives.
   */
  public markBoundary(): void {
    this.pendingBoundary = true;
    this.boundaryTimestamp = Date.now();

    // Clear any existing timeout
    if (this.boundaryTimeoutId !== null) {
      clearTimeout(this.boundaryTimeoutId);
    }

    // Set new timeout to create checkpoint if no more input
    this.boundaryTimeoutId = setTimeout(() => {
      if (this.pendingBoundary) {
        this.splitStep();
        this.pendingBoundary = false;
      }
      this.boundaryTimeoutId = null;
    }, BOUNDARY_TIMEOUT_MS);
  }

  /**
   * Clear the pending boundary state without creating a checkpoint.
   * Called when the user continues typing before the timeout.
   */
  public clearBoundary(): void {
    this.pendingBoundary = false;

    if (this.boundaryTimeoutId !== null) {
      clearTimeout(this.boundaryTimeoutId);
      this.boundaryTimeoutId = null;
    }
  }

  /**
   * Check if a pending boundary has timed out and create a checkpoint if so.
   * Called on each keystroke to handle the case where the user resumes typing
   * after a pause longer than BOUNDARY_TIMEOUT_MS.
   */
  public checkAndHandleBoundary(): void {
    if (!this.pendingBoundary) {
      return;
    }

    const elapsed = Date.now() - this.boundaryTimestamp;

    if (elapsed >= BOUNDARY_TIMEOUT_MS) {
      this.splitStep();
      this.clearBoundary();
    }
  }

  /**
   * Clear all history stacks (move, caret, and Yjs UndoManager) and pending state.
   * Used when loading new data or destroying the manager.
   */
  public clear(): void {
    this.moveUndoStack = [];
    this.moveRedoStack = [];
    this.pendingMoveGroup = null;
    this.caretUndoStack = [];
    this.caretRedoStack = [];
    this.pendingCaretBefore = null;
    this.hasPendingCaret = false;
    this.isPerformingUndoRedo = false;
    this.replayStackItem = null;
    this.poppedStackItem = null;
    this.openEntry = null;
    this.typingInputKey = null;
    this.nothingUndoable = false;
    // Holds are left alone: each holder still owns its release.
    // Clear smart grouping state
    this.clearBoundary();
    this.undoManager.clear();
  }

  /**
   * Cleanup on destroy.
   */
  public destroy(): void {
    document.removeEventListener('selectionchange', this.selectionChangeHandler);
    this.stopDocWatch?.();
    this.stopDocWatch = null;
    this.clear();
    this.undoManager.destroy();
  }
}
