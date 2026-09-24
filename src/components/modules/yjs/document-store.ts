import { getUnixTime } from 'lib0/time';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';

import { GRID_ORDER_KEY, GRID_ROWS_KEY, isDiffableTextKey, isOrderedIdArrayKey, stripNul, toSerializableValue, type YBlockSerializer, type YjsOutputBlockData, stripNulIfString } from './serializer';
import { diffText } from './text-diff';
import { LOCAL_ORIGIN_TAGS, type AwarenessChange, type BlockPlacement, type LocalOriginTag, type UndoScopeType } from './types';
// The narrow module, not the utils barrel: the collab fixture generator
// bundles this file for node.
import { logLabeled } from '../../utils/logger';
import { equals } from '../../utils/object';

/**
 * Default transaction origin for updates applied through the binary seam
 * when the provider passes none. Not a LocalOriginTag, so BlockObserver
 * classifies these transactions 'remote' and the UndoManager ignores them.
 */
const REMOTE_APPLY_ORIGIN = Object.freeze({ source: 'blok-remote-apply' });

/**
 * How long a departed client's meta row is kept before the flood guard may
 * drop it — three times y-protocols' 30s outdated window.
 *
 * The row is the tombstone that keeps a relayed state from re-adding a peer
 * who is gone, so it has to outlive every browser that could still be
 * relaying that peer. One 30s window is not enough: a browser that learned
 * the departed client from another browser's queryAwareness reply holds it
 * for a further 30s, and that hop can chain. Two numbers per dead id is a
 * cheap margin.
 */
const AWARENESS_TOMBSTONE_TTL_MS = 90_000;

/**
 * Lengths of the equal prefix and equal suffix of two sequences, the suffix
 * measured only past the prefix so the two never overlap. Every two-ended
 * diff in the store shares this accounting.
 */
const commonEnds = (
  leftLength: number,
  rightLength: number,
  isEqualAt: (leftIndex: number, rightIndex: number) => boolean
): { prefix: number; suffix: number } => {
  const range = (length: number): number[] => Array.from({ length }, (_, index) => index);
  const maxPrefix = Math.min(leftLength, rightLength);
  const prefix = range(maxPrefix).find((index) => !isEqualAt(index, index)) ?? maxPrefix;
  const maxSuffix = maxPrefix - prefix;
  const suffix = range(maxSuffix)
    .find((index) => !isEqualAt(leftLength - 1 - index, rightLength - 1 - index)) ?? maxSuffix;

  return { prefix, suffix };
};

/**
 * What a block's nested containers held at the moment a save was captured.
 *
 * Keyed by the live `Y.Map` ITSELF, not by a path: a container's identity is
 * what this store preserves across every merge, while an index or a grid row
 * key moves under a concurrent insert. So the lookup answers exactly "did THIS
 * container have that key when we looked", with no alignment to get wrong.
 *
 * A container absent from the snapshot was created after the capture, so every
 * key in it is someone else's and none of them may be deleted.
 */
export type DataKeySnapshot = WeakMap<Y.Map<unknown>, ReadonlySet<string>>;

/**
 * Record the key set of every `Y.Map` reachable from a block's live `data`.
 *
 * Read straight off the shared types — no plain clone of the values — so the
 * cost is one `keys()` per container and nothing proportional to the text in
 * it. Deliberately NOT routed through `YjsManager.getBlockDataObject`: that
 * reader drains the write buffer, which would end the 400ms coalescing of the
 * very save this snapshot belongs to.
 * @param value - the block's `data` Y.Map (anything else yields an empty snapshot)
 * @returns the snapshot to hand back to `updateBlockData`
 */
export const captureDataKeySnapshot = (value: unknown): DataKeySnapshot => {
  const snapshot: DataKeySnapshot = new WeakMap();
  const visit = (node: unknown): void => {
    if (node instanceof Y.Map) {
      // A cycle is impossible in a Yjs tree, so `seen`-tracking is not needed.
      snapshot.set(node, new Set(node.keys()));
      node.forEach((child) => visit(child));

      return;
    }

    if (node instanceof Y.Array) {
      node.forEach((child) => visit(child));
    }
  };

  visit(value);

  return snapshot;
};

/**
 * DocumentStore manages the Yjs document and provides atomic block operations.
 *
 * Doc schema v2 — order as data:
 * - `Y.Map('blocks')`: id → per-block Y.Map (same per-block keys as v1).
 *   A block's Y.Map is NEVER deleted-and-recreated by a move, so a
 *   concurrent remote edit to a moved block merges instead of vanishing.
 * - `Y.Array('root')`: top-level block ids in order. Children keep their
 *   order in each parent's `contentIds` exactly as before.
 * The flat document order is DERIVED (DFS from root through contentIds);
 * see `deriveOrderedIds` for the dedupe/orphan laws.
 */
/**
 * One block whose parent link and order-array membership disagreed after a
 * merge: the parentId to end up with (null = root), and whether the block
 * still has to be attached to that parent's order array.
 */
interface Rehoming {
  id: string;
  parentId: string | null;
  attach: boolean;
}

/**
 * The order arrays as they stood before a remote update: which ids were in
 * SOME array, and how many copies of each id each array held.
 */
interface StructuralSnapshot {
  placed: Set<string>;
  counts: Map<Y.Array<string>, Map<string, number>>;
}

export class DocumentStore {
  /**
   * Yjs document instance.
   *
   * PRIVATE by design: all writes MUST route through `transact` or
   * `transactWithoutCapture` so the origin passes the `LocalOriginTag`
   * type barrier. Exposing the raw Y.Doc lets callers bypass the
   * whitelist and silently reintroduce the class of bugs that
   * `BlockObserver.mapTransactionOrigin` exists to prevent.
   *
   * MUTABLE (with the two root types below) only for `resetForRelineage`,
   * which swaps the whole document. Nothing else may reassign it.
   */
  private ydoc: Y.Doc = new Y.Doc();

  /**
   * id → per-block Y.Map. Membership lives here; order lives in the order
   * arrays (`yRootOrder` + each block's `contentIds`).
   */
  private yBlocksMap: Y.Map<Y.Map<unknown>> = this.ydoc.getMap('blocks');

  /**
   * Top-level block ids in document order.
   */
  private yRootOrder: Y.Array<string> = this.ydoc.getArray('root');

  /**
   * Serializer for converting between Yjs and OutputBlockData formats
   */
  private serializer: YBlockSerializer;

  /**
   * Presence substrate, created LAZILY on the first `enableAwareness()`.
   *
   * NOT built in the constructor: `Awareness` schedules a 3s `setInterval` the
   * moment it exists (its outdated-state sweep), which would violate the collab
   * config's "absent = zero cost" contract for the single-player editor. Null
   * until a provider turns presence on.
   */
  private awareness: Awareness | null = null;

  constructor(serializer: YBlockSerializer) {
    this.serializer = serializer;
  }

  /**
   * The blocks map (id → block Y.Map). Read/observe surface — writes must
   * go through the typed operations or `transact`.
   */
  public get blocksMap(): Y.Map<Y.Map<unknown>> {
    return this.yBlocksMap;
  }

  /**
   * The root order array (top-level ids). Read/observe surface — writes
   * must go through the typed operations or `transact`.
   */
  public get rootOrder(): Y.Array<string> {
    return this.yRootOrder;
  }

  /**
   * Shared types the Y.UndoManager must track. contentIds arrays nest
   * inside `blocksMap` values, so the two roots cover every block write.
   */
  public get undoScope(): UndoScopeType[] {
    return [this.yBlocksMap, this.yRootOrder];
  }

  /**
   * Load blocks from JSON data.
   * Clears existing blocks and replaces them with the provided data.
   * Uses 'load' origin which is not tracked by undo manager.
   */
  public fromJSON(blocks: YjsOutputBlockData[]): void {
    this.ydoc.transact(() => {
      const identified = blocks.filter(
        (block): block is YjsOutputBlockData & { id: string } => typeof block.id === 'string'
      );
      // The map KEY is scrubbed too — a NUL here (not just in the yblock's
      // id field) is what aborts the .NET server's yrs read.
      const rendered = identified.map((block) => ({ block,
        id: stripNul(block.id) }));
      const keptIds = new Set(rendered.map(({ id }) => id));

      for (const key of Array.from(this.yBlocksMap.keys())) {
        if (!keptIds.has(key)) {
          this.yBlocksMap.delete(key);
        }
      }

      for (const { block, id } of rendered) {
        const existing = this.yBlocksMap.get(id);

        // A block the document ALREADY holds is rewritten in place, never
        // deleted and rebuilt. A rebuild puts a fresh Y.Map under the id, and
        // everything a peer is typing at that moment lives inside the map being
        // thrown away — so `editor.render()` over the same ids erased their
        // edit every time, with no race to lose. In place, a carried-over text
        // field is EDITED, so their characters keep their identity.
        if (existing instanceof Y.Map) {
          this.rewriteBlockInPlace(existing, id, block);
        } else {
          this.yBlocksMap.set(id, this.serializer.outputDataToYBlock(block));
        }
      }

      const topLevelIds = rendered.flatMap(({ block, id }) => block.parent === undefined ? [id] : []);

      // Spliced, not cleared and re-pushed: an id that stays keeps its item, so
      // a peer's concurrent insert next to it lands where they put it.
      this.assignKeySequence(this.yRootOrder, topLevelIds);
    }, 'load');
  }

  /**
   * Rewrite an existing block's fields from rendered JSON, keeping the block's
   * Y.Map (and every shared type inside it that survives the rewrite).
   *
   * Every field `outputDataToYBlock` writes is covered here, and a field the
   * new JSON omits is REMOVED — rendering a document replaces it, so a tune or
   * a parent link that is no longer in the data must not linger.
   * @param yblock - the block's existing Y.Map
   * @param id - the block's scrubbed id
   * @param block - the rendered block data
   */
  private rewriteBlockInPlace(yblock: Y.Map<unknown>, id: string, block: YjsOutputBlockData): void {
    yblock.set('id', id);
    // Per key, and through the same path a turn-into takes.
    this.replaceBlockContent(id, block.type, block.data);

    const tunes = yblock.get('tunes');
    // CLEARED, never deleted: `tunes` is minted eagerly by the one peer that
    // creates the block (`outputDataToYBlock`) precisely so two peers cannot
    // each `set` a fresh map over the key — map-set is last-writer-wins and the
    // loser's tune goes with the discarded map. Deleting the key here put every
    // rendered block back into that hazard. Read-back still drops an empty map,
    // so a render that carries no tunes emits none.
    const nextTunes = block.tunes ?? {};

    if (tunes instanceof Y.Map) {
      this.deepAssignYMap(tunes, nextTunes);
    } else {
      yblock.set('tunes', this.serializer.objectToYMap(nextTunes));
    }

    if (block.parent === undefined) {
      yblock.delete('parentId');
    } else {
      yblock.set('parentId', stripNulIfString(block.parent));
    }

    const contentIds: unknown = yblock.get('contentIds');
    const renderedContentIds = Array.from(
      (block.content ?? []) as Iterable<unknown>
    ).map(stripNulIfString) as string[];

    if (contentIds instanceof Y.Array) {
      this.assignKeySequence(contentIds as Y.Array<string>, renderedContentIds);
    } else {
      yblock.set('contentIds', Y.Array.from(renderedContentIds));
    }

    this.rewriteOptionalField(yblock, 'lastEditedAt', block.lastEditedAt);
    this.rewriteOptionalField(yblock, 'lastEditedBy', stripNulIfString(block.lastEditedBy));
  }

  /**
   * Set a block field, or remove it when the rendered data does not carry it.
   * @param yblock - the block's Y.Map
   * @param key - the field name
   * @param value - the rendered value, or undefined to remove the field
   */
  private rewriteOptionalField(yblock: Y.Map<unknown>, key: string, value: unknown): void {
    if (value === undefined) {
      yblock.delete(key);
    } else {
      yblock.set(key, value);
    }
  }

  /**
   * Serialize blocks to JSON format, in derived flat document order.
   *
   * The hierarchy view is computed ONCE and used for both the order and the
   * emitted `parent`/`content`, so a consumer can never read a position that
   * contradicts the parent link (or a child listed under two parents).
   */
  public toJSON(): YjsOutputBlockData[] {
    const hierarchy = this.hierarchyView();

    return this.deriveOrderedIds(hierarchy).flatMap((id) => {
      const yblock = this.yBlocksMap.get(id);
      const block = yblock instanceof Y.Map ? this.serializer.yBlockToOutputData(yblock) : null;

      // A peer can write any shape; the readers run inside the observer, so a
      // malformed block is skipped (order slot included), never thrown on.
      if (block === null) {
        logLabeled(`Block «${id}» is malformed (id/type must be strings, data a map) and was skipped`, 'warn');

        return [];
      }

      return [this.projectHierarchy(block, hierarchy)];
    });
  }

  /**
   * The ids `toJSON` would emit, in the same order, without serializing any
   * block data. For readers that run per remote event and need only the
   * order. Silent about malformed blocks — `toJSON` owns the warning.
   */
  public orderedIds(): string[] {
    return this.deriveOrderedIds().filter((id) => this.serializer.isWellFormedBlock(this.yBlocksMap.get(id)));
  }

  /**
   * Effective parent of every block in the map: its doc `parentId`, except
   * where a cycle broke the link (null). `parentId` is the LWW arbiter of
   * membership — an id sitting in two parents' contentIds after a concurrent
   * reparent belongs to whichever parent the block itself names.
   *
   * `parentId` is single-valued, so the parent graph is functional and its
   * cycles are disjoint: each block belongs to at most one cycle, and the
   * per-cycle keeper rule below can never conflict with another cycle's.
   *
   * Cycle rule (deterministic on every peer — content-derived, never
   * iteration-order-derived): the member with the LEXICOGRAPHICALLY SMALLEST
   * id keeps its parent, every other member's link is broken to null. A
   * self-parent (`parentId === own id`) is always broken — the keeper rule
   * alone would let it stand.
   *
   * A DANGLING parentId (no map entry for the parent) is kept as-is: that is
   * the orphan tolerance a not-yet-arrived remote parent depends on.
   */
  private hierarchyView(): Map<string, string | null> {
    const broken = this.brokenCycleMembers();

    return new Map(
      Array.from(this.yBlocksMap.keys())
        .map((id): [string, string | null] => [id, broken.has(id) ? null : this.rawParentId(id)])
    );
  }

  /**
   * Blocks whose parentId is part of a cycle and is NOT the cycle's keeper —
   * their link is the one that gets broken.
   */
  private brokenCycleMembers(): Set<string> {
    const broken = new Set<string>();
    const state = new Map<string, 'visiting' | 'done'>();

    for (const id of this.yBlocksMap.keys()) {
      this.markParentChain(id, state, broken);
    }

    return broken;
  }

  /**
   * Colour one parentId chain: 'visiting' while it is on the current path,
   * 'done' once its top (root, dangling parent, or a cycle) is known. Meeting
   * a 'visiting' node closes a loop, and everything from that node onward on
   * the path IS the cycle. Iterative: a peer can write a chain deeper than
   * the stack, and this runs inside the observer.
   * @param start - block whose chain to follow
   * @param state - per-block colour, shared across the whole sweep
   * @param broken - collects the members that lose their parent link
   */
  private markParentChain(
    start: string,
    state: Map<string, 'visiting' | 'done'>,
    broken: Set<string>
  ): void {
    const path: string[] = [];
    const cursor: { id: string | null } = { id: start };

    while (cursor.id !== null) {
      const id = cursor.id;
      const colour = state.get(id);

      if (colour === 'visiting') {
        // Only this walk's own path is 'visiting', so the node is on it.
        this.breakCycle(path.slice(path.indexOf(id)), broken);
        break;
      }

      if (colour === 'done' || !this.yBlocksMap.has(id)) {
        break;
      }

      state.set(id, 'visiting');
      path.push(id);
      cursor.id = this.rawParentId(id);
    }

    for (const member of path) {
      state.set(member, 'done');
    }
  }

  /**
   * A block's stored parentId, or null when absent, non-string, or naming
   * the block itself (a self-parent is never a real link).
   */
  private rawParentId(id: string): string | null {
    const yblock = this.yBlocksMap.get(id);
    const parentId = yblock instanceof Y.Map ? yblock.get('parentId') : undefined;

    return typeof parentId === 'string' && parentId !== id ? parentId : null;
  }

  /**
   * Break every link in one cycle except the lexicographically smallest
   * member's, leaving that member parented under the block that follows it
   * around the loop and the rest at root.
   */
  private breakCycle(members: string[], broken: Set<string>): void {
    const keeper = members.reduce((smallest, id) => (id < smallest ? id : smallest));

    for (const member of members) {
      if (member !== keeper) {
        broken.add(member);
      }
    }
  }

  /**
   * Rewrite one emitted block against the hierarchy view: report the
   * effective parent, and list only the children that name THIS block as
   * their parent. Child ids with no map entry stay (they cannot double-count,
   * and dropping them would lose a not-yet-arrived peer's slot).
   */
  private projectHierarchy(
    block: YjsOutputBlockData,
    hierarchy: Map<string, string | null>
  ): YjsOutputBlockData {
    const id = block.id;

    if (typeof id !== 'string') {
      return block;
    }

    const projected: YjsOutputBlockData = { ...block };
    const parentId = hierarchy.get(id) ?? null;
    const owned = (block.content ?? []).filter(
      (childId) => !hierarchy.has(childId) || hierarchy.get(childId) === id
    );

    if (parentId === null) {
      delete projected.parent;
    } else {
      projected.parent = parentId;
    }

    if (owned.length > 0) {
      projected.content = owned;
    } else {
      delete projected.content;
    }

    return projected;
  }

  /**
   * Flat document order: DFS from the root order, descending through each
   * block's contentIds. Laws (cross-peer deterministic):
   * - an order-array entry counts ONLY where the block's effective parent
   *   agrees with the array it sits in (root order ⇒ no parent) — the
   *   write-side dedupe cannot heal a concurrent cross-parent move, so the
   *   read side resolves it by parentId;
   * - duplicate id across order arrays → FIRST agreeing occurrence wins;
   * - id with no map entry → skipped;
   * - map entries reachable from no order array → appended at the END, in
   *   two passes (Y.Map iteration order is not a cross-peer guarantee):
   *   first the tops of unreached subtrees (no parent, or a parent with no
   *   map entry) sorted by id, then anything still unreached sorted by id.
   *   The first pass is what makes the order ROUND-TRIP: entering at a
   *   descendant would emit it ahead of its own parent, and reloading that
   *   JSON would then produce a different order.
   */
  private deriveOrderedIds(hierarchy: Map<string, string | null> = this.hierarchyView()): string[] {
    const ordered = this.deriveReachableIds(hierarchy);
    const seen = new Set(ordered);
    const unreached = (): string[] => Array.from(this.yBlocksMap.keys())
      .filter((id) => !seen.has(id))
      .sort();

    for (const id of unreached()) {
      const parentId = hierarchy.get(id) ?? null;

      if (parentId === null || !this.yBlocksMap.has(parentId)) {
        this.visitBlock(id, parentId, hierarchy, seen, ordered);
      }
    }

    for (const id of unreached()) {
      this.visitBlock(id, hierarchy.get(id) ?? null, hierarchy, seen, ordered);
    }

    return ordered;
  }

  /**
   * Flat order of blocks reachable from the root order only (no orphan
   * tail). Placement math uses this so an id mid-move never pollutes the
   * positions it is measured against.
   */
  private deriveReachableIds(hierarchy: Map<string, string | null> = this.hierarchyView()): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>();

    for (const id of this.yRootOrder.toArray()) {
      this.visitBlock(id, null, hierarchy, seen, ordered);
    }

    return ordered;
  }

  /**
   * DFS from one id: emit it (first occurrence only, only when a map entry
   * exists, and only when its effective parent is the one whose order array
   * we are walking), then descend into its contentIds. The seen-set makes
   * cycles terminate. Iterative with an explicit stack — a peer can nest
   * content deeper than the call stack, and this runs inside the observer.
   * Children are pushed in reverse and checked when popped, so the emitted
   * order and the duplicate handling match a recursive pre-order walk.
   */
  private visitBlock(
    id: unknown,
    expectedParentId: string | null,
    hierarchy: Map<string, string | null>,
    seen: Set<string>,
    ordered: string[]
  ): void {
    const stack: Array<{ id: unknown; parentId: string | null }> = [{ id, parentId: expectedParentId }];

    while (stack.length > 0) {
      const next = stack.pop();

      if (next === undefined || typeof next.id !== 'string' || seen.has(next.id)) {
        continue;
      }

      const yblock = this.yBlocksMap.get(next.id);

      if (!(yblock instanceof Y.Map) || (hierarchy.get(next.id) ?? null) !== next.parentId) {
        continue;
      }

      seen.add(next.id);
      ordered.push(next.id);

      const contentIds = yblock.get('contentIds');

      if (!(contentIds instanceof Y.Array)) {
        continue;
      }

      const children: unknown[] = contentIds.toArray();

      for (const childId of children.slice().reverse()) {
        stack.push({ id: childId, parentId: next.id });
      }
    }
  }

  /**
   * Add a new block.
   * @param blockData - Block data to add
   * @param index - Optional flat index to insert at (defaults to end);
   *   translated to a slot in the root order (no parent) or the parent's
   *   contentIds, with the same clamping semantics as before
   * @returns The created Y.Map
   */
  public addBlock(blockData: YjsOutputBlockData, index?: number): Y.Map<unknown> {
    const yblock = this.serializer.outputDataToYBlock(blockData);
    // Strip so the map KEY and the order-array id match the yblock's scrubbed
    // id field (and never carry a yrs-aborting NUL to the server).
    const id = typeof blockData.id === 'string' ? stripNul(blockData.id) : blockData.id;

    if (typeof id !== 'string') {
      return yblock;
    }

    this.transact(() => {
      const flatIds = this.deriveReachableIds();
      const desired = Math.max(0, Math.min(index ?? flatIds.length, flatIds.length));

      this.yBlocksMap.set(id, yblock);

      // Stripped like the map key and the yblock's parentId field, or a NUL in the
      // parent id misses the parent and orphans the child.
      const target = this.resolveTargetOrder(stripNulIfString(blockData.parent));

      if (target !== null) {
        target.insert(this.orderSlotForFlatIndex(target, flatIds, desired), [id]);
      }
    }, 'local');

    return yblock;
  }

  /**
   * Add a new block at a placement: under `placement.parentId` (null = root),
   * right after `placement.afterId` (null = first; not found = append).
   *
   * The placement's parent WINS over `blockData.parent`: the derived order
   * only counts an entry whose parentId agrees with the array holding it, so
   * a disagreeing parentId would drop the block into the orphan tail.
   * Same refusals as `applyPlacement`: a dangling parent or a cyclic one
   * leaves the block in no order array (a cyclic parentId is not written).
   * @param blockData - Block data to add
   * @param placement - Target parent and preceding sibling
   * @returns The created Y.Map
   */
  public addBlockAt(blockData: YjsOutputBlockData, placement: BlockPlacement): Y.Map<unknown> {
    const unparented = { ...blockData };

    delete unparented.parent;

    const yblock = this.serializer.outputDataToYBlock(unparented);
    const id = typeof blockData.id === 'string' ? stripNul(blockData.id) : blockData.id;

    if (typeof id !== 'string') {
      return yblock;
    }

    const parentId = typeof placement.parentId === 'string' ? stripNul(placement.parentId) : null;
    const wouldCycle = parentId !== null && this.wouldFormCycle(id, parentId);

    this.transact(() => {
      this.yBlocksMap.set(id, yblock);

      if (wouldCycle) {
        return;
      }

      if (parentId !== null) {
        yblock.set('parentId', parentId);
      }

      const target = this.resolveTargetOrder(parentId ?? undefined);

      if (target !== null) {
        target.insert(this.placementSlot(target, placement.afterId), [id]);
      }
    }, 'local');

    return yblock;
  }

  /**
   * Remove a block by id: delete its map entry and remove the id string
   * from the root order and every contentIds array containing it.
   * @param id - Block id to remove
   */
  public removeBlock(id: string): void {
    const isKnown = this.yBlocksMap.has(id) ||
      this.orderArrays().some((order) => order.toArray().includes(id));

    if (!isKnown) {
      return;
    }

    this.transact(() => {
      this.yBlocksMap.delete(id);
      this.removeFromOrderArrays(id);
    }, 'local');
  }

  /**
   * Replace a block's tool TYPE and DATA in place, keeping the SAME Y.Map entry
   * — and therefore the same block id, Yjs item identity, position, parentId,
   * contentIds and tunes.
   *
   * Backs `BlockMutation.replace()` (turn-into + markdown conversion). Must
   * mutate the existing Y.Map, never remove and re-insert under the same id:
   * `BlockObserver` reads an id in both the added and removed sets as a no-op
   * MOVE, and an undo of the conversion then never re-renders the prior tool.
   * The single transaction keeps it one undo entry.
   * @param id - Block id whose content to replace
   * @param type - New tool name
   * @param data - New tool data
   * @returns true if the block existed and was mutated
   */
  public replaceBlockContent(id: string, type: string, data: Record<string, unknown>): boolean {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return false;
    }

    const normalized = this.serializer.normalizeBlockData(type, data);
    const ydata = yblock.get('data');

    this.transact(() => {
      yblock.set('type', stripNulIfString(type));

      // No readable data map to merge into (a peer wrote a non-map, or the
      // block never carried one): build one, which is what this always did.
      if (!(ydata instanceof Y.Map)) {
        yblock.set('data', this.serializer.blockDataToYMap(normalized));

        return;
      }

      // Per KEY, never a fresh map over the old one. A whole-key `set` on
      // `data` is last-writer-wins, and the other person's edits live INSIDE
      // the value it replaces — so converting a paragraph while someone typed
      // in it discarded their Y.Text with everything in it. Writing per key
      // routes a carried-over field through `updateBlockData`, which EDITS the
      // live Y.Text, so both survive. The .NET `EditStep.ReplaceData` was given
      // the same treatment in the same release; the two must stay alike.
      //
      // What this can and cannot preserve: a conversion carrying the same field
      // (paragraph → header, list item → quote) keeps the peer's characters. A
      // conversion to a different shape (paragraph → image) does not, and must
      // not — the field is gone from the new tool's data, so the prune below
      // removes it on both peers. Replace still replaces.
      for (const [key, value] of Object.entries(normalized)) {
        this.updateBlockData(id, key, value);
      }

      this.pruneBlockData(id, new Set(Object.keys(normalized)));
    }, 'local');

    return true;
  }

  /**
   * Move a block to a new flat index by editing order arrays ONLY — the
   * block's Y.Map is never touched, so its identity (and any concurrent
   * remote edit to it) survives the move.
   *
   * The flat toIndex is translated to a placement among the block's
   * same-parent siblings: insert after the last sibling whose derived
   * flat position is below the (clamped) target. For a flat root-level
   * document this reproduces the old clamping semantics exactly.
   * @param id - Block id to move
   * @param toIndex - Target flat index (the final position in derived order)
   */
  public moveBlock(id: string, toIndex: number): void {
    const fromIndex = this.deriveOrderedIds().indexOf(id);

    if (fromIndex === -1) {
      return;
    }

    // Skip if no actual movement needed
    if (fromIndex === toIndex) {
      return;
    }

    // 'move' keeps the Y.UndoManager from tracking the order edit — the
    // placement-based move stacks own its history. Replay never comes back
    // through here: move-undo/move-redo drive `applyPlacement` instead.
    this.transact(() => {
      this.removeFromOrderArrays(id);

      const yblock = this.yBlocksMap.get(id);
      const target = this.resolveTargetOrder(
        yblock instanceof Y.Map ? yblock.get('parentId') : undefined
      );

      // Dangling parent: leave the block in no order array (orphan
      // tolerance — it renders at the end until the parent arrives).
      if (target === null) {
        return;
      }

      const flatIds = this.deriveReachableIds();
      const desired = Math.max(0, Math.min(toIndex, flatIds.length));

      target.insert(this.orderSlotForFlatIndex(target, flatIds, desired), [id]);
    }, 'move');
  }

  /**
   * Move a block to a placement under the untracked 'move' origin, like
   * `moveBlock`: the move stacks own its history. Unlike `moveBlock` it may
   * change the parent; the parentId write rides the same untracked
   * transaction, so the caller's move entry must carry both sides.
   * A no-op (see `isNoOpMove`) writes nothing, as `moveBlock` does for an
   * unchanged index. Otherwise the semantics and refusals are
   * `applyPlacement`'s.
   * @param id - Block id to move
   * @param placement - Target parent and preceding sibling
   */
  public moveBlockTo(id: string, placement: BlockPlacement): void {
    if (this.getBlockById(id) === undefined || this.isNoOpMove(id, placement)) {
      return;
    }

    this.applyPlacement(id, placement, 'move');
  }

  /**
   * Whether moving the block to this placement would change nothing: it
   * already holds it, or the placement anchors after the block itself.
   * @param id - Block id
   * @param placement - Target parent and preceding sibling
   */
  public isNoOpMove(id: string, placement: BlockPlacement): boolean {
    if (placement.afterId === id) {
      return true;
    }

    const current = this.getPlacement(id);
    const parentId = typeof placement.parentId === 'string' ? stripNul(placement.parentId) : null;

    // An unlisted block reports { parent, null } too; it still needs placing.
    return current !== null &&
      current.parentId === parentId &&
      current.afterId === placement.afterId &&
      this.orderArrays().some((order) => order.toArray().includes(id));
  }

  /**
   * Place a block: one transaction owning the parentId key AND order-array
   * membership. Root placement DELETES the parentId key (root = absent
   * key, never a null value). The id is removed from every order array
   * first, then inserted after `afterId` in the target array (afterId null
   * → first child; afterId not found → append; parent map entry missing →
   * left in no array, orphan tolerance).
   *
   * A placement that would parent the block under its own descendant is
   * REFUSED — non-throwing counterpart of `BlockHierarchy.setBlockParent`'s
   * cycle guard, which this path can be driven past by move replay. Refusing
   * means: the cyclic parentId is never written, and the id is left in no
   * order array (the same orphan tolerance a dangling parent gets), so LOCAL
   * code cannot put a cycle in the doc. Concurrent peers still can — that is
   * what `hierarchyView`'s read-side cycle break exists for.
   * @param id - Block id to place
   * @param placement - Target parent (null = root) and preceding sibling (null = first)
   * @param origin - Transaction origin
   */
  public applyPlacement(id: string, placement: BlockPlacement, origin: LocalOriginTag): void {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return;
    }

    // Scrub ONCE, then work in doc space: the doc's map keys are stripped on
    // the way in (`addBlock`, `fromJSON`), so an unscrubbed parentId misses the
    // cycle check and the parent lookup as well as writing a server-aborting
    // NUL into the doc.
    const parentId = typeof placement.parentId === 'string'
      ? stripNul(placement.parentId)
      : placement.parentId;
    const wouldCycle = parentId !== null && this.wouldFormCycle(id, parentId);

    this.transact(() => {
      // Idempotent parentId write: an agreeing value writes nothing, so the
      // transaction touches order arrays ONLY and the observer emits a pure
      // 'move'. Move replay relies on this — a spurious parentId item would
      // emit an 'update' whose undo/redo-origin handling re-runs setData on
      // the block mid-replay. (delete on an absent key is already a no-op.)
      // A refused placement leaves parentId alone — writing it is the thing
      // being refused.
      if (!wouldCycle) {
        if (parentId === null) {
          yblock.delete('parentId');
        } else if (yblock.get('parentId') !== parentId) {
          yblock.set('parentId', parentId);
        }
      }

      this.removeFromOrderArrays(id);

      const target = wouldCycle ? null : this.resolveTargetOrder(parentId ?? undefined);

      if (target === null) {
        return;
      }

      target.insert(this.placementSlot(target, placement.afterId), [id]);
    }, origin);
  }

  /**
   * Whether parenting `id` under `targetParentId` would close a parent cycle:
   * the target's parent chain reaches `id` itself (self-parent included), or
   * revisits a node — a pre-existing cycle disqualifies the reparent too.
   * Mirrors `BlockHierarchy.wouldFormCycle` against the doc instead of memory.
   */
  private wouldFormCycle(id: string, targetParentId: string): boolean {
    const visited = new Set<string>();
    const cursor: { id: string | null } = { id: targetParentId };

    // A loop, not recursion: this is the local drag path, and the chain can
    // be as deep as a peer made it.
    while (cursor.id !== null) {
      if (cursor.id === id || visited.has(cursor.id)) {
        return true;
      }

      visited.add(cursor.id);
      cursor.id = this.rawParentId(cursor.id);
    }

    return false;
  }

  /**
   * Get block Y.Map by id.
   * @param id - Block id
   * @returns Y.Map or undefined if not found
   */
  public getBlockById(id: string): Y.Map<unknown> | undefined {
    const yblock = this.yBlocksMap.get(id);

    return yblock instanceof Y.Map ? yblock : undefined;
  }

  /**
   * A block's current placement: its doc parentId (possibly dangling) plus
   * the sibling it follows in whichever order array holds it (null = first
   * slot, or an orphan held by no array).
   * @param id - Block id
   * @returns The placement, or null when the block has no map entry
   */
  public getPlacement(id: string): BlockPlacement | null {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return null;
    }

    const rawParentId = yblock.get('parentId');
    const parentId = typeof rawParentId === 'string' ? rawParentId : null;

    for (const order of this.orderArrays()) {
      const ids = order.toArray();
      const index = ids.indexOf(id);

      if (index !== -1) {
        return { parentId, afterId: index > 0 ? ids[index - 1] : null };
      }
    }

    return { parentId, afterId: null };
  }

  /**
   * Every order array in the doc: the root order plus each block's
   * contentIds Y.Array.
   */
  private orderArrays(): Y.Array<string>[] {
    const arrays: Y.Array<string>[] = [this.yRootOrder];

    this.yBlocksMap.forEach((yblock) => {
      if (!(yblock instanceof Y.Map)) {
        return;
      }

      const contentIds = yblock.get('contentIds');

      if (contentIds instanceof Y.Array) {
        arrays.push(contentIds as Y.Array<string>);
      }
    });

    return arrays;
  }

  /**
   * Remove EVERY occurrence of the id from every order array (duplicate
   * ids can appear after concurrent moves merge — this is the write-side
   * half of the read-side dedupe). Must run inside a transaction.
   */
  private removeFromOrderArrays(id: string): void {
    for (const order of this.orderArrays()) {
      this.removeAllOccurrences(order, id);
    }
  }

  /**
   * One read, then deletes back-to-front so earlier indices stay valid, a
   * contiguous run per delete. Never recurse or re-read per occurrence:
   * concurrent moves can leave thousands of duplicates in one array.
   */
  private removeAllOccurrences(order: Y.Array<string>, id: string): void {
    // Walked from the right, so runs come out highest-index first and each
    // run grows leftwards.
    const runs = order.toArray().reduceRight<Array<{ start: number; length: number }>>((acc, entryId, index) => {
      if (entryId !== id) {
        return acc;
      }

      const current = acc.at(-1);

      if (current !== undefined && current.start === index + 1) {
        current.start = index;
        current.length += 1;
      } else {
        acc.push({ start: index, length: 1 });
      }

      return acc;
    }, []);

    for (const run of runs) {
      order.delete(run.start, run.length);
    }
  }

  /**
   * Whether the blocks map holds a TOMBSTONE for this id — an entry someone
   * DELETED — as opposed to one this peer has simply never seen. Yjs keeps the
   * deleted item in the map's internal key index and drops it from `keys()`,
   * so that index is the ONLY place the two cases differ.
   *
   * The distinction is load-bearing: every repair below keys off it, and
   * treating a not-yet-arrived peer's block as deleted would be a NEW loss
   * path, worse than the dead id it would tidy away.
   */
  private isTombstonedBlock(id: string): boolean {
    const item = this.yBlocksMap._map.get(id);

    return item !== undefined && item.deleted;
  }

  /**
   * What the order arrays held BEFORE a remote update is applied. The repair
   * below is allowed to undo damage it watched happen, and nothing else: a
   * document that ARRIVES malformed is read leniently, exactly as before, and
   * is never rewritten. That is what keeps a foreign or older writer's
   * document — say, a child that names a parent but is missing from its
   * `contentIds` — untouched.
   */
  private structuralSnapshot(): StructuralSnapshot {
    const placed = new Set<string>();
    const counts = new Map<Y.Array<string>, Map<string, number>>();

    for (const order of this.orderArrays()) {
      const perArray = new Map<string, number>();

      for (const entryId of order.toArray().filter((entry) => typeof entry === 'string')) {
        placed.add(entryId);
        perArray.set(entryId, (perArray.get(entryId) ?? 0) + 1);
      }

      counts.set(order, perArray);
    }

    return { placed,
      counts };
  }

  /**
   * Repair the structural damage a merge leaves behind, in its OWN
   * transaction carrying the remote origin:
   * - writing inside the remote transaction itself advances this doc's own
   *   clientID state on a transaction yjs flagged non-local, which makes yjs
   *   regenerate the clientID ("another client seems to be using it");
   * - a LOCAL origin would broadcast the repair, so two peers repairing the
   *   same damage would each insert their own copy of the repair.
   *
   * Every decision is derived from converged content only (array order,
   * tombstones, the pre-update snapshot, sorted ids), so every peer performs
   * the same deletes and the same inserts and the repair converges without
   * ever being exchanged.
   *
   * Nothing here ever removes a block from `blocksMap`; the only writes are
   * order-array deletes/appends and clearing a `parentId` that names a
   * deleted block.
   * @param before - the order arrays as they stood before the update
   * @param origin - the remote origin the triggering update carried
   */
  private reconcileStructure(before: StructuralSnapshot, origin: unknown): void {
    const compaction = this.planOrderCompaction(before);
    const rehoming = this.planRehoming(before);

    // Nothing to do is the common case; an empty transaction would still make
    // the observer dispatch a change.
    if (compaction.length === 0 && rehoming.length === 0) {
      return;
    }

    this.ydoc.transact(() => {
      for (const { order, indices } of compaction) {
        // Back to front, so the earlier indices stay valid.
        for (const index of indices.slice().reverse()) {
          order.delete(index, 1);
        }
      }

      for (const { id, parentId, attach } of rehoming) {
        const yblock = this.yBlocksMap.get(id);

        if (!(yblock instanceof Y.Map)) {
          continue;
        }

        if (parentId === null) {
          yblock.delete('parentId');
        }

        const target = attach ? this.resolveTargetOrder(parentId ?? undefined) : null;

        if (target !== null && !target.toArray().includes(id)) {
          target.push([id]);
        }
      }
    }, origin);
  }

  /**
   * Entries to delete from each order array, per array, ascending.
   *
   * Two peers moving the same block each delete the item THEY saw and insert
   * their own, so neither delete covers the other's insert and the id ends up
   * in the array twice. The read side hides the duplicate, but the WRITE side
   * measures against the raw array, so the corruption stays in the document
   * and surfaces on the next insert. It has to leave the document.
   *
   * Dropped:
   * - an id whose block is TOMBSTONED — it names nothing and never will
   *   (a concurrent re-add clears the tombstone, so a resurrected block
   *   keeps its slot). An id with NO map item is KEPT: that is a
   *   not-yet-arrived peer's slot, and dropping it would be a new loss path.
   * - a repeat BEYOND the number of copies this array already held. Array
   *   order is converged, so "the first ones" name the same items on every
   *   peer. Repeats that were already there when the update arrived are left
   *   alone — see `structuralSnapshot`.
   * @param before - the order arrays as they stood before the update
   */
  private planOrderCompaction(before: StructuralSnapshot): Array<{ order: Y.Array<string>; indices: number[] }> {
    const plan: Array<{ order: Y.Array<string>; indices: number[] }> = [];

    for (const order of this.orderArrays()) {
      const known = before.counts.get(order);
      const allowance = new Map(known ?? []);
      const indices: number[] = [];

      order.toArray().forEach((entryId, index) => {
        if (typeof entryId !== 'string') {
          return;
        }

        if (this.isTombstonedBlock(entryId)) {
          indices.push(index);

          return;
        }

        // An array this peer had not seen before the update arrived that way
        // and is taken as given — only an array whose earlier contents we
        // watched can tell a merge duplicate from one that was always there.
        if (known === undefined) {
          return;
        }

        const remaining = allowance.get(entryId) ?? 1;

        if (remaining <= 0) {
          indices.push(index);

          return;
        }

        allowance.set(entryId, remaining - 1);
      });

      if (indices.length > 0) {
        plan.push({ order, indices });
      }
    }

    return plan;
  }

  /**
   * Blocks the update knocked out of every order array, and what to do with
   * each. Only a block that WAS placed before the update qualifies — a block
   * that arrived unplaced is left where the reader's orphan handling puts it.
   *
   * - parent TOMBSTONED → cut the link (`parentId: null`) and put the block
   *   back at root. A deleted parent is not a parent, and leaving the link
   *   makes `resolveTargetOrder` answer null for every later drag, so
   *   `moveBlock` removes the id and re-inserts it nowhere: the block keeps
   *   its text and can never be moved again.
   * - parent PRESENT → append to that parent's contentIds. The membership was
   *   discarded by a last-writer-wins `set` on `contentIds`; the block's own
   *   parentId is the surviving record of it.
   * - parent NEVER SEEN → left alone. That is the orphan tolerance a
   *   not-yet-arrived remote parent depends on.
   *
   * The parentId cut also applies to a block that is still placed — a link to
   * a deleted block is dead either way — but nothing is appended for it.
   *
   * Sorted by id: appends must land in the same order on every peer, and
   * Y.Map iteration order is not a cross-peer guarantee.
   * @param before - the order arrays as they stood before the update
   */
  private planRehoming(before: StructuralSnapshot): Rehoming[] {
    const placed = new Set(
      this.orderArrays()
        .flatMap((order) => order.toArray())
        .filter((entryId) => typeof entryId === 'string' && !this.isTombstonedBlock(entryId))
    );

    return Array.from(this.yBlocksMap.keys()).sort().flatMap((id): Rehoming[] => {
      const parentId = this.rawParentId(id);
      const knockedOut = before.placed.has(id) && !placed.has(id);

      if (parentId !== null && this.isTombstonedBlock(parentId)) {
        return [{ id,
          parentId: null,
          attach: knockedOut }];
      }

      if (knockedOut && parentId !== null && this.yBlocksMap.has(parentId)) {
        return [{ id,
          parentId,
          attach: true }];
      }

      return [];
    });
  }

  /**
   * The order array a block belongs to per its parentId: the root order
   * when there is no parentId, the parent's contentIds (created if
   * missing) when the parent exists, and NONE when the parentId dangles.
   */
  private resolveTargetOrder(parentId: unknown): Y.Array<string> | null {
    if (typeof parentId !== 'string') {
      return this.yRootOrder;
    }

    const parent = this.yBlocksMap.get(parentId);

    return parent instanceof Y.Map ? this.getOrCreateContentOrder(parent) : null;
  }

  /**
   * A block's contentIds Y.Array. Every block Y.Map is created WITH one
   * (`YBlockSerializer.outputDataToYBlock`), so the normal path always finds
   * the existing array and inserts into it — which is what lets two peers'
   * concurrent first children merge instead of one map-set clobbering the
   * other's array (and the child id inside it).
   *
   * The create branch is a HEALING path only: a doc written by an older
   * session, or a block whose contentIds key was overwritten with a non-array.
   * Never turn it back into the normal path.
   */
  private getOrCreateContentOrder(parent: Y.Map<unknown>): Y.Array<string> {
    const existing = parent.get('contentIds');

    if (existing instanceof Y.Array) {
      return existing as Y.Array<string>;
    }

    const created = new Y.Array<string>();

    parent.set('contentIds', created);

    return created;
  }

  /**
   * Translate a desired flat position into a slot in `order`: after the
   * LAST entry whose flat position (in `flatIds`, which must not contain
   * the id being placed) is below `desiredFlatIndex`. Entries absent from
   * `flatIds` (dangling ids) don't count.
   */
  private orderSlotForFlatIndex(
    order: Y.Array<string>,
    flatIds: string[],
    desiredFlatIndex: number
  ): number {
    // Indexed once: an indexOf per order entry made one Enter in a flat 10k
    // document cost seconds.
    const flatIndexOf = new Map(flatIds.map((id, index) => [id, index]));
    // A REPEAT of an id already counted is not another sibling. Counting it
    // advances the slot past a block the caller asked to insert before, which
    // is how a duplicate left by two concurrent drags put the next Enter one
    // place too late. Repairs keep the doc clean going forward; this keeps a
    // document that already arrived duplicated placing correctly.
    const counted = new Set<string>();

    return order.toArray().reduce<number>((slot, entryId, position) => {
      if (counted.has(entryId)) {
        return slot;
      }

      counted.add(entryId);

      const flatIndex = flatIndexOf.get(entryId);

      return flatIndex !== undefined && flatIndex < desiredFlatIndex ? position + 1 : slot;
    }, 0);
  }

  /**
   * Slot right after `afterId` (null → first slot; not found → append).
   */
  private placementSlot(order: Y.Array<string>, afterId: string | null): number {
    if (afterId === null) {
      return 0;
    }

    const anchor = order.toArray().indexOf(afterId);

    return anchor === -1 ? order.length : anchor + 1;
  }

  /**
   * Update a property in block data.
   * @param id - Block id
   * @param key - Data property key
   * @param value - New value
   * @param seen - what the block's nested containers held when this value was
   *   captured. A nested key missing from it appeared AFTER the capture — a
   *   peer's write that landed while the async `save()` was in flight — so the
   *   deep assign below may not delete it. This is `pruneBlockData`'s `seen`
   *   one level DOWN, and it is omitted wherever the value is captured
   *   synchronously with the write (`replaceBlockContent`, a tune, a patch).
   * @returns true if a Yjs write actually occurred (value changed), false if the
   *          equality guard short-circuited the write.
   */
  public updateBlockData(id: string, key: string, input: unknown, seen?: DataKeySnapshot): boolean {
    // A Date/Map/Set has no own enumerable entries, so every branch below
    // would read it as an EMPTY object — deep-merging one onto a live Y.Map
    // deletes every key in it. Substituted here for the JSON shape.
    const value = toSerializableValue(input);
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return false;
    }

    const ydata = yblock.get('data');

    // A peer may have written a non-map `data`; such a block is unreadable and
    // never materialised, so there is nothing to update.
    if (!(ydata instanceof Y.Map)) {
      return false;
    }

    // Scrub the data KEY once — a NUL key aborts the .NET server's yrs read.
    const dataKey = stripNul(key);
    const currentValue: unknown = ydata.get(dataKey);

    const valueIsPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);

    // Plain array meeting a keyed grid wrapper: pair rows by identity and diff
    // per row. Runs BEFORE the Y.Map branch below — a grid IS a Y.Map, and
    // deep-merging an array onto it would rewrite the wrapper's own keys.
    if (Array.isArray(value) && this.serializer.isGridMap(currentValue)) {
      if (equals(this.serializer.gridMapToPlain(currentValue), value)) {
        return false;
      }

      this.transact(() => {
        if (this.serializer.isGridArray(value)) {
          this.deepAssignYGrid(currentValue, value, seen);
        } else if (this.serializer.isIdentityArray(value)) {
          this.deepAssignYIdentity(currentValue, value, seen);
        } else {
          // Neither shape any more (emptied, or the elements lost their ids) —
          // rebuild so the write path matches the load path.
          ydata.set(dataKey, this.serializer.plainToYValue(value));
        }
      }, 'local');

      return true;
    }

    // Nested OBJECT value backed by a nested Y.Map: deep-merge into the existing
    // Y.Map instead of replacing it. Compare by ENTRIES — equals(Y.Map, plain)
    // is a false negative that would write (and record an undo entry) for an
    // unchanged value — and touch only changed sub-fields, so concurrent edits
    // to DIFFERENT sub-fields merge instead of last-writer-wins.
    if (valueIsPlainObject && currentValue instanceof Y.Map) {
      if (equals(this.serializer.yMapToObject(currentValue), value)) {
        return false;
      }

      this.transact(() => {
        this.deepAssignYMap(currentValue, value as Record<string, unknown>, seen);
      }, 'local');

      return true;
    }

    // Plain array meeting an existing Y.Array: element-wise diff in place, so
    // one cell edit writes one nested key instead of re-broadcasting the whole
    // grid. equals(Y.Array, plainArray) is a false-negative, so this must run
    // BEFORE the generic equality guard below.
    if (Array.isArray(value) && currentValue instanceof Y.Array) {
      if (equals(this.serializer.yArrayToPlain(currentValue), value)) {
        return false;
      }

      this.transact(() => {
        if (this.serializer.isConvertibleArray(value)) {
          this.deepAssignYArray(currentValue, value, seen);
        } else {
          // Emptied or turned primitive — no longer qualifies for Y.Array;
          // downshift to a plain leaf so the write path matches the load path.
          // Through plainToYValue so a primitive-array leaf is NUL-scrubbed.
          ydata.set(dataKey, this.serializer.plainToYValue(value));
        }
      }, 'local');

      return true;
    }

    // Mergeable text over a live Y.Text: apply the whole saved string as a
    // diff, so two peers typing in one block keep both bursts instead of the
    // later write taking the paragraph. Runs BEFORE the generic guard below —
    // `equals(Y.Text, string)` is a false negative exactly like the Y.Map and
    // Y.Array cases above, and falling through would `set` a plain string over
    // the Y.Text and silently end the merging.
    //
    // A plain string under the key is deliberately NOT upgraded here. Upgrading
    // means `set`ting a fresh Y.Text over the key, and a whole-key set is
    // last-writer-wins: a peer editing the same block loses its container with
    // everything typed into it — measured. Only the single creation site
    // (`blockDataToYMap`) mints one, so exactly one peer ever does. A document
    // the server seeded carries a plain string and keeps today's behaviour
    // until `YDocConverter.Seed` mints one too.
    //
    // NUL is stripped here because this is a write chokepoint of its own: the
    // string never passes through `plainToYValue`.
    if (isDiffableTextKey(dataKey) && typeof value === 'string' && currentValue instanceof Y.Text) {
      const nextText = stripNul(value);

      if (currentValue.toJSON() === nextText) {
        return false;
      }

      this.transact(() => {
        // Right to left, so an earlier edit's offsets stay valid.
        diffText(currentValue.toJSON(), nextText).reverse().forEach((op) => {
          // INSERT FIRST, then delete what it replaces. The other order anchors
          // the new text to the right of the run it replaces — the characters
          // it is anchored to are the ones being tombstoned — so a peer's
          // concurrent keystroke inside that run surfaces in FRONT of the whole
          // replacement. Measured on a paste over a paragraph: the block read
          // "!Completely different…".
          if (op.insert.length > 0) {
            currentValue.insert(op.index, op.insert);
          }

          if (op.remove > 0) {
            currentValue.delete(op.index + op.insert.length, op.remove);
          }
        });
      }, 'local');

      return true;
    }

    // Mergeable text under a key the block did not carry yet (an image gains a
    // caption long after it was inserted): mint the Y.Text here, not a plain
    // string, or the field never merges for the rest of the document's life.
    // Safe where UPGRADING is not: `set` is last-writer-wins either way, but on
    // an ABSENT key there is no accumulated text for the loser to lose — two
    // peers first-typing a caption at the same instant lose one burst exactly as
    // they do today with plain strings.
    if (isDiffableTextKey(dataKey) && typeof value === 'string' && currentValue === undefined) {
      this.transact(() => {
        ydata.set(dataKey, new Y.Text(stripNul(value)));
      }, 'local');

      return true;
    }

    // Skip if value hasn't changed - this prevents creating unnecessary undo entries
    // when block data is synced after mutations that don't actually change data
    // (e.g., marker updates in list items during undo/redo, or table content
    // arrays that are reference-different but structurally identical)
    if (equals(currentValue, value)) {
      return false;
    }

    this.transact(() => {
      // plainToYValue serializes nested objects into Y.Maps and qualifying
      // arrays into Y.Arrays so later sub-edits can merge; primitive and
      // empty arrays stay atomic plain leaves.
      ydata.set(dataKey, this.serializer.plainToYValue(value));
    }, 'local');

    return true;
  }

  /**
   * Delete every top-level data key of `id` that `keep` does not name.
   *
   * The counterpart, one level up, of the deletion `deepAssignYMap` already
   * performs for a nested value: `updateBlockData` is per-KEY by signature, so
   * it can set but never unset, and a caller writing a full save() had no way
   * to say "these are ALL the keys there are". Only a full-save flush may call
   * this — a partial patch names a subset by design.
   * @param id - Block id
   * @param keep - the keys the new data carries. Compared after NUL-scrubbing,
   *   because that is the form `updateBlockData` stored them in.
   * @param seen - the keys the block's data ALREADY HAD when that save was
   *   captured. A key missing from it appeared afterwards — a peer's write that
   *   landed while the async `save()` was in flight — and is not this save's to
   *   delete. Omit it only when the data is captured synchronously with the
   *   prune (`replaceBlockContent`), where no such gap exists.
   * @returns true if any key was deleted
   */
  public pruneBlockData(id: string, keep: ReadonlySet<string>, seen?: ReadonlySet<string>): boolean {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return false;
    }

    const ydata = yblock.get('data');

    if (!(ydata instanceof Y.Map)) {
      return false;
    }

    const kept = new Set(Array.from(keep, stripNul));
    const known = seen === undefined ? undefined : new Set(Array.from(seen, stripNul));
    const stale = Array.from(ydata.keys())
      .filter((key) => !kept.has(key) && (known === undefined || known.has(key)));

    if (stale.length === 0) {
      return false;
    }

    this.transact(() => {
      for (const key of stale) {
        ydata.delete(key);
      }
    }, 'local');

    return true;
  }

  /**
   * Recursively assign `source` onto `target` Y.Map, writing ONLY changed leaves
   * (so untouched sub-fields keep their CRDT identity and merge across peers) and
   * deleting keys absent from `source`. Nested objects recurse into existing
   * child Y.Maps; new nested objects are serialized fresh. Must run inside a
   * transaction (the caller wraps it).
   *
   * With a `seen` snapshot, a key is deletable only if `target` already held it
   * when the source was captured — a key that appeared since is a peer's write
   * that raced this (asynchronous) save, and `source` omits it because it never
   * saw it, not because anyone removed it. Without a snapshot every absent key
   * is deleted, which is right for a source captured synchronously.
   *
   * LOCKSTEP: `DeepAssign.Map` in
   * packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs is the port of
   * this walk (and of `deepAssignYArray`/`deepAssignYGrid`/`deepAssignYIdentity`
   * beside it). Both sides must edit the live container IN PLACE, per key, at
   * every depth: a whole-key set is last-writer-wins, so a peer's edit INSIDE
   * the container goes with the container it replaces.
   */
  private deepAssignYMap(target: Y.Map<unknown>, source: Record<string, unknown>, seen?: DataKeySnapshot): void {
    const known = seen?.get(target);

    // Remove keys no longer present.
    for (const key of Array.from(target.keys())) {
      const deletable = seen === undefined || known?.has(key) === true;

      if (deletable && !Object.prototype.hasOwnProperty.call(source, key)) {
        target.delete(key);
      }
    }

    for (const [key, value] of Object.entries(source)) {
      this.assignYMapEntry(target, key, value, seen);
    }
  }

  /** Assign one key of a nested Y.Map, recursing into child Y.Maps/Y.Arrays. */
  private assignYMapEntry(target: Y.Map<unknown>, key: string, input: unknown, seen?: DataKeySnapshot): void {
    // Same substitution as `updateBlockData`, one level down.
    const value = toSerializableValue(input);
    // Scrub the nested KEY here — deep-merge writes bypass objectToYMap, so this
    // is the single chokepoint that keeps a NUL out of a nested map key.
    const mapKey = stripNul(key);
    const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    const existing = target.get(mapKey);

    // Keyed grid first: a grid wrapper IS a Y.Map, so the plain-object branch
    // below would tear its container keys apart.
    if (Array.isArray(value) && this.serializer.isGridMap(existing)) {
      if (this.serializer.isGridArray(value)) {
        this.deepAssignYGrid(existing, value, seen);
      } else if (this.serializer.isIdentityArray(value)) {
        this.deepAssignYIdentity(existing, value, seen);
      } else if (!equals(this.serializer.gridMapToPlain(existing), value)) {
        target.set(mapKey, this.serializer.plainToYValue(value));
      }

      return;
    }

    // An ordered id list is a Y.Array at ANY depth, even empty or all-string,
    // so two peers inserting a block into ONE table cell keep both ids. Runs
    // BEFORE the generic Y.Array branch, which would downshift an all-string
    // value back to a plain leaf because it fails `isConvertibleArray`.
    // Defers to the KEYED wrapper, same as `objectToYMap`: a grid or an
    // id-bearing array pairs by key, which is strictly better than by
    // position, and the key's NAME must not take that away.
    if (isOrderedIdArrayKey(mapKey) && Array.isArray(value) &&
      !this.serializer.isGridArray(value) && !this.serializer.isIdentityArray(value)) {
      if (existing instanceof Y.Array) {
        this.deepAssignYArray(existing, value, seen);
      } else {
        // A cell from a doc written before this rule (or by an older client)
        // still holds a plain array. Promote it — unconditionally, so the
        // migration happens on the first write rather than never. This single
        // promotion IS last-writer-wins, exactly as the whole-value write it
        // replaces was, so it costs no more than today; every write after it
        // merges.
        target.set(mapKey, this.serializer.plainToYArray(value));
      }

      return;
    }

    if (Array.isArray(value) && existing instanceof Y.Array) {
      if (this.serializer.isConvertibleArray(value)) {
        this.deepAssignYArray(existing, value, seen);
      } else if (!equals(this.serializer.yArrayToPlain(existing), value)) {
        // No longer qualifies for Y.Array — downshift to a plain leaf. Through
        // plainToYValue so a primitive-array leaf is NUL-scrubbed.
        target.set(mapKey, this.serializer.plainToYValue(value));
      }

      return;
    }

    if (!isPlainObject) {
      // Primitive/array leaf: write only when it actually changed. A first
      // write of a qualifying array converts via plainToYValue.
      const comparable = this.serializer.yValueToPlain(existing);

      if (!equals(comparable, value)) {
        target.set(mapKey, this.serializer.plainToYValue(value));
      }

      return;
    }

    if (existing instanceof Y.Map) {
      this.deepAssignYMap(existing, value as Record<string, unknown>, seen);

      return;
    }

    target.set(mapKey, this.serializer.objectToYMap(value as Record<string, unknown>));
  }

  /**
   * Element-wise assign `source` onto `target` Y.Array with a TWO-ENDED diff:
   * skip the deeply-equal prefix and suffix, recurse per element when the
   * changed middles have equal length, otherwise replace the middle with ONE
   * splice. Y.Array item identity is what lets a concurrent row insert and a
   * cell edit both apply, so untouched elements must never be rewritten.
   * `source` must satisfy `isConvertibleArray`, or be an ordered id list (whose
   * elements are compared and replaced as plain leaves); must run inside a
   * transaction (the caller wraps it).
   */
  private deepAssignYArray(target: Y.Array<unknown>, source: unknown[], seen?: DataKeySnapshot): void {
    const targetLength = target.length;
    const sourceLength = source.length;
    const plainAt = (index: number): unknown => this.serializer.yValueToPlain(target.get(index));
    const { prefix, suffix } = commonEnds(
      targetLength,
      sourceLength,
      (targetIndex, sourceIndex) => equals(plainAt(targetIndex), source[sourceIndex])
    );

    const targetMiddle = targetLength - prefix - suffix;
    const sourceMiddle = sourceLength - prefix - suffix;

    if (targetMiddle === 0 && sourceMiddle === 0) {
      return;
    }

    if (targetMiddle === sourceMiddle) {
      source
        .slice(prefix, prefix + sourceMiddle)
        .forEach((value, offset) => this.assignYArrayElement(target, prefix + offset, value, seen));

      return;
    }

    // Unequal-length middles. Pair them by content FIRST: an element that is
    // still the same element must keep its Y container. A blanket
    // delete+insert of the middle recreates every container in it, so a column
    // inserted beside a cell a peer is concurrently editing threw that peer's
    // cell write away. Only an order-preserving pairing (inserts and deletes,
    // no move) can be expressed without a splice; a genuine reorder still
    // falls back to one, because Y.Array has no move.
    const targetSlice = Array.from({ length: targetMiddle }, (_, offset) => plainAt(prefix + offset));
    const sourceSlice = source.slice(prefix, prefix + sourceMiddle);
    const assignment = this.pairGridRows(targetSlice, sourceSlice, true);
    const pairedTargets = assignment.filter((index): index is number => index !== null);
    const isOrdered = pairedTargets.every((index, rank) => rank === 0 || index > pairedTargets[rank - 1]);

    if (pairedTargets.length > 0 && isOrdered) {
      const kept = new Set(pairedTargets);

      // Backwards, so an earlier delete cannot shift a later offset.
      Array.from({ length: targetMiddle }, (_, offset) => targetMiddle - 1 - offset)
        .filter((offset) => !kept.has(offset))
        .forEach((offset) => target.delete(prefix + offset, 1));

      sourceSlice.forEach((element, offset) => {
        if (assignment[offset] === null) {
          target.insert(prefix + offset, [this.serializer.plainToYValue(element)]);
        } else {
          this.assignYArrayElement(target, prefix + offset, element, seen);
        }
      });

      return;
    }

    // Nothing pairs, or the pairing is a reorder: one splice, so the change
    // lands as a single Y.Array event instead of N element rewrites.
    if (targetMiddle > 0) {
      target.delete(prefix, targetMiddle);
    }

    if (sourceMiddle > 0) {
      target.insert(
        prefix,
        source.slice(prefix, prefix + sourceMiddle).map((element) => this.serializer.plainToYValue(element))
      );
    }
  }

  /** Assign one Y.Array element in place, recursing into Y.Map/Y.Array elements. */
  private assignYArrayElement(target: Y.Array<unknown>, index: number, input: unknown, seen?: DataKeySnapshot): void {
    // The fifth chokepoint, same substitution as `updateBlockData` and
    // `assignYMapEntry`: a `Date`/`Map`/`Set` ARRAY ELEMENT reaches
    // `deepAssignYMap` below, whose `Object.entries` walk is empty for it and
    // would delete every key of the live element Y.Map.
    const value = toSerializableValue(input);
    const existing = target.get(index);
    const valueIsPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);

    if (Array.isArray(value) && this.serializer.isGridMap(existing)) {
      if (this.serializer.isGridArray(value)) {
        this.deepAssignYGrid(existing, value, seen);

        return;
      }

      if (this.serializer.isIdentityArray(value)) {
        this.deepAssignYIdentity(existing, value, seen);

        return;
      }
    }

    if (valueIsPlainObject && existing instanceof Y.Map) {
      this.deepAssignYMap(existing, value as Record<string, unknown>, seen);

      return;
    }

    if (Array.isArray(value) && existing instanceof Y.Array && this.serializer.isConvertibleArray(value)) {
      this.deepAssignYArray(existing, value, seen);

      return;
    }

    // Equal-length middles can still hold individually-equal elements
    // between changed ones — don't rewrite those.
    if (equals(this.serializer.yValueToPlain(existing), value)) {
      return;
    }

    target.delete(index, 1);
    target.insert(index, [this.serializer.plainToYValue(value)]);
  }

  /**
   * Assign plain rows onto a keyed grid wrapper.
   *
   * A local write carries no row keys — it is the whole grid as plain arrays —
   * so the rows must be RE-ASSOCIATED with the keys already in the doc. Once
   * paired, a row is diffed in place and its Y container survives; only the
   * order array records that rows moved. That is the whole point: Y.Array has
   * no move, so a positional diff expresses a reorder as delete+insert and
   * throws away whatever a peer concurrently typed into the deleted row.
   *
   * `source` must satisfy `isGridArray`; must run inside a transaction.
   */
  private deepAssignYGrid(target: Y.Map<unknown>, source: unknown[], seen?: DataKeySnapshot): void {
    const rows = target.get(GRID_ROWS_KEY) as Y.Map<unknown>;
    const order = target.get(GRID_ORDER_KEY) as Y.Array<string>;
    const currentKeys = this.serializer.gridRowKeys(target);
    const currentRows = currentKeys.map((key) => this.serializer.yValueToPlain(rows.get(key)));
    // NOT order-preserving: a crossing pair is exactly what this wrapper
    // exists to express. A grid records a move in the `__rowKeys` order array,
    // so a row that crossed its neighbours keeps its container; rejecting the
    // pair instead mints a fresh key and `rows.delete`s the old container —
    // the delete+insert the wrapper was built to avoid.
    const assignment = this.pairGridRowsById(currentKeys, currentRows, source);
    const paired = new Set(assignment.filter((index): index is number => index !== null));
    const known = seen?.get(rows);

    currentKeys.forEach((key, index) => {
      // Same snapshot law as `deepAssignYMap`: a row container that did not
      // exist when this save was captured is a peer's insert that raced it,
      // and `source` omits it because it never saw it.
      const deletable = seen === undefined || known?.has(key) === true;

      if (deletable && !paired.has(index)) {
        rows.delete(key);
      }
    });

    const taken = new Set(rows.keys());
    const nextKeys = source.map((row, index) => {
      const targetIndex = assignment[index];

      if (targetIndex === null) {
        const key = this.serializer.newGridRowKey(row, taken);

        taken.add(key);
        rows.set(key, this.serializer.plainToYValue(row));

        return key;
      }

      const key = currentKeys[targetIndex];

      this.assignYMapEntry(rows, key, row, seen);

      return key;
    });

    this.assignKeySequence(order, nextKeys);
  }

  /**
   * Pair saved rows with the doc's rows: first by row id (a row whose key IS
   * the id it carries), then by content for the rest. Content alone misreads a
   * save that both edits a row and inserts one beside it — the new row takes
   * the edited row's container, and a peer's concurrent edit lands in it.
   * @returns for each source row, the index into `currentKeys`, or null when new
   */
  private pairGridRowsById(currentKeys: string[], currentRows: unknown[], source: unknown[]): (number | null)[] {
    const indexByKey = new Map(currentKeys.map((key, index) => [key, index]));
    const claimed = new Set<number>();
    const assignment = source.map((row): number | null => {
      const id = this.serializer.gridRowId(row);
      const index = id === undefined ? undefined : indexByKey.get(id);

      if (index === undefined || claimed.has(index)) {
        return null;
      }

      claimed.add(index);

      return index;
    });

    const restSources = source.map((_, index) => index).filter((index) => assignment[index] === null);
    const restTargets = currentKeys.map((_, index) => index).filter((index) => !claimed.has(index));
    const rest = this.pairGridRows(
      restTargets.map((index) => currentRows[index]),
      restSources.map((index) => source[index]),
      false
    );

    rest.forEach((target, rank) => {
      assignment[restSources[rank]] = target === null ? null : restTargets[target];
    });

    return assignment;
  }

  /**
   * Assign plain id-bearing objects onto an identity-keyed wrapper.
   *
   * Nothing has to be re-associated here — unlike a grid row, the element
   * carries its own key — so a reorder is just a new order array and every
   * element's Y.Map survives it. That is the whole point: diffed by POSITION,
   * a reorder racing a field edit applied that edit to whichever element took
   * the index, and both peers converged on the same wrong value.
   *
   * `source` must satisfy `isIdentityArray` (so every element has a unique
   * string id); must run inside a transaction.
   */
  private deepAssignYIdentity(target: Y.Map<unknown>, source: Record<string, unknown>[], seen?: DataKeySnapshot): void {
    const rows = target.get(GRID_ROWS_KEY) as Y.Map<unknown>;
    const order = target.get(GRID_ORDER_KEY) as Y.Array<string>;
    // `isIdentityArray` guarantees a non-empty string id on every element.
    const nextKeys = source.map((element) => stripNul(String(element.id)));
    const kept = new Set(nextKeys);
    const known = seen?.get(rows);

    Array.from(rows.keys())
      // Same snapshot law as `deepAssignYMap`: an element the container gained
      // after this save was captured belongs to the peer that added it.
      .filter((key) => !kept.has(key) && (seen === undefined || known?.has(key) === true))
      .forEach((key) => rows.delete(key));

    source.forEach((element, index) => this.assignYMapEntry(rows, nextKeys[index], element, seen));

    this.assignKeySequence(order, nextKeys);
  }

  /**
   * Re-associate keyless plain rows with the doc's existing rows, in four
   * passes, each cheaper and more certain than the next:
   *
   * 1. Two-ended anchors — the deeply-equal prefix and suffix pair 1:1. Rows
   *    outside the edited span never enter the search.
   * 2. Exact content match across the middle — this is how a MOVED row is
   *    recognized as the same row rather than a delete plus an insert.
   * 3. Cell-level similarity, only when the leftover counts DIFFER (a row was
   *    added or removed in the same write that edited one): the edited row
   *    still shares most of its cells with itself, a brand-new row shares
   *    none. Equal counts skip straight to 4: equal-length middles rewrite
   *    in place.
   * 4. Positional remainder, rank against rank. With `enforceOrder`, a pair is
   *    taken only where it does not CROSS the pairs already made; without it,
   *    rank pairs with rank unconditionally.
   *
   * Rows with identical content are interchangeable by definition, so pass 2
   * pairing an arbitrary one of them is not a defect.
   * @param current - the doc's rows, in display order
   * @param source - the saved rows, keyless
   * @param enforceOrder - reject a pass-4 pair that crosses the pairs already
   *   made. TRUE only for `deepAssignYArray`, whose caller falls back to a
   *   splice the moment the pairing is not monotonic. FALSE for
   *   `deepAssignYGrid`, which expresses a move through its order array and
   *   NEEDS crossing pairs — a rejected one there costs the row its container.
   * @returns for each source row, the index into `current` it pairs with, or
   *          null when it is a new row.
   */
  private pairGridRows(current: unknown[], source: unknown[], enforceOrder: boolean): (number | null)[] {
    const assignment: (number | null)[] = source.map(() => null);
    const takenTarget = new Set<number>();
    const range = (length: number): number[] => Array.from({ length }, (_, index) => index);
    const pair = (sourceIndex: number, targetIndex: number): void => {
      assignment[sourceIndex] = targetIndex;
      takenTarget.add(targetIndex);
    };

    const { prefix, suffix } = commonEnds(
      current.length,
      source.length,
      (currentIndex, sourceIndex) => equals(current[currentIndex], source[sourceIndex])
    );

    range(prefix).forEach((index) => pair(index, index));
    range(suffix).forEach((index) => pair(source.length - 1 - index, current.length - 1 - index));

    const middleSources = range(source.length).filter((index) => assignment[index] === null);
    const middleTargets = range(current.length).filter((index) => !takenTarget.has(index));

    for (const sourceIndex of middleSources) {
      const match = middleTargets
        .find((index) => !takenTarget.has(index) && equals(current[index], source[sourceIndex]));

      if (match !== undefined) {
        pair(sourceIndex, match);
      }
    }

    const restSources = middleSources.filter((index) => assignment[index] === null);
    const restTargets = middleTargets.filter((index) => !takenTarget.has(index));

    // Rank window: an unmatched row can only have shifted by the number of
    // unmatched inserts/deletes around it, so scoring further afield finds
    // nothing and would make the pass quadratic on a large grid. A row that
    // moved further than that was already caught by the exact pass above.
    const window = Math.abs(restSources.length - restTargets.length) + 1;

    if (restSources.length !== restTargets.length) {
      restSources.forEach((sourceIndex, rank) => {
        const free = restTargets
          .filter((index, targetRank) => !takenTarget.has(index) && Math.abs(targetRank - rank) <= window);
        const match = this.mostSimilarRow(current, source[sourceIndex], free);

        if (match !== -1) {
          pair(sourceIndex, match);
        }
      });
    }

    // Whether pairing `sourceIndex` with `targetIndex` keeps the pairing
    // MONOTONIC — every pair already made stays on the side of it that source
    // order and target order agree on.
    const keepsOrder = (sourceIndex: number, targetIndex: number): boolean =>
      assignment.every((target, index) => target === null ||
        (index < sourceIndex ? target < targetIndex : target > targetIndex));

    // Pass 4, positional remainder — rank against rank. Under `enforceOrder` a
    // pair is taken ONLY if it does not CROSS the pairs already made. A
    // crossing pair is exactly what flips `isOrdered` false in
    // `deepAssignYArray` and drops control to the splice, which re-creates
    // every element container in the middle: an add-and-remove, which moves
    // nothing, then threw away whatever a peer had concurrently written inside
    // a SURVIVING element.
    //
    // Crossing, not a similarity score, is the discriminator. A genuinely new
    // element shares its KEYS with the element it would displace exactly as
    // much as an edited one does, so no score separates an insert from an edit
    // — but an insert's rank pair crosses the pairs around it and an edit's
    // does not. Rejecting a candidate never crosses anything either, so the
    // element simply stays an insert and its neighbours keep their containers.
    const finalTargets = restTargets.filter((index) => !takenTarget.has(index));

    restSources
      .filter((index) => assignment[index] === null)
      .forEach((sourceIndex, rank) => {
        if (rank < finalTargets.length && (!enforceOrder || keepsOrder(sourceIndex, finalTargets[rank]))) {
          pair(sourceIndex, finalTargets[rank]);
        }
      });

    return assignment;
  }

  /**
   * The candidate doc row sharing the most cells with `row`, or -1 when none
   * shares any: a brand-new row has nothing in common with an existing one.
   */
  private mostSimilarRow(current: unknown[], row: unknown, candidates: number[]): number {
    return candidates.reduce<{ index: number; score: number }>(
      (winner, index) => {
        const score = this.rowSimilarity(current[index], row);

        return score > winner.score ? { index, score } : winner;
      },
      { index: -1, score: 0 }
    ).index;
  }

  /**
   * How much two rows look like the same row: the length of their common cell
   * prefix plus common suffix. Measured from BOTH ends, never per position — a
   * column inserted or deleted at the FRONT shifts every cell, so a positional
   * score reads such a row as sharing nothing with itself and the pairing then
   * hands a peer's concurrent edit to the wrong row.
   */
  private rowSimilarity(current: unknown, source: unknown): number {
    if (Array.isArray(current) && Array.isArray(source)) {
      const { prefix, suffix } = commonEnds(
        current.length,
        source.length,
        (currentIndex, sourceIndex) => equals(current[currentIndex], source[sourceIndex])
      );

      return prefix + suffix;
    }

    const isRecord = (value: unknown): value is Record<string, unknown> =>
      value !== null && typeof value === 'object' && !Array.isArray(value);

    // Two objects: how much of what they both carry still agrees. A grid ROW is
    // always an array, so this branch only serves the element pairing in
    // `deepAssignYArray` — where an element is a table cell, not a row.
    if (isRecord(current) && isRecord(source)) {
      return Object.keys(current)
        .filter((key) => Object.prototype.hasOwnProperty.call(source, key))
        .reduce((score, key) => score + this.rowSimilarity(current[key], source[key]), 0);
    }

    return equals(current, source) ? 1 : 0;
  }

  /**
   * Rewrite a grid's row-order array with one two-ended splice. The elements
   * are plain key STRINGS, so delete+insert here costs nothing — no CRDT
   * container is destroyed. Also self-heals: keys the read path normalized
   * away (duplicated by concurrent reorders, or stranded by a concurrent
   * delete) are absent from `keys` and get spliced out.
   */
  private assignKeySequence(order: Y.Array<string>, keys: string[]): void {
    const current = order.toArray();

    if (equals(current, keys)) {
      return;
    }

    const { prefix, suffix } = commonEnds(
      current.length,
      keys.length,
      (currentIndex, keyIndex) => current[currentIndex] === keys[keyIndex]
    );

    const currentMiddle = current.length - prefix - suffix;
    const nextMiddle = keys.length - prefix - suffix;

    if (currentMiddle > 0) {
      order.delete(prefix, currentMiddle);
    }

    if (nextMiddle > 0) {
      order.insert(prefix, keys.slice(prefix, prefix + nextMiddle));
    }
  }

  /**
   * Update a tune in block tunes.
   * @param id - Block id
   * @param tuneName - Tune name
   * @param tuneData - Tune data value
   */
  public updateBlockTune(id: string, tuneName: string, tuneData: unknown): void {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return;
    }

    this.transact(() => {
      const ytunes = this.getOrCreateTunesMap(yblock);

      // Through the same per-key assign a nested data value takes: an OBJECT
      // tune becomes a Y.Map, so two peers changing DIFFERENT fields of one
      // tune (colour and background) keep both instead of the later write
      // taking the whole tune. Stored as a plain leaf it was one value.
      // The key is scrubbed by `assignYMapEntry` and the value by
      // `plainToYValue`/`objectToYMap`, so the NUL chokepoint is unchanged;
      // read-back of a Y.Map tune is `yMapToObject`, the same plain object,
      // so `tunes` in OutputData is unchanged.
      this.assignYMapEntry(ytunes, tuneName, tuneData);
    }, 'local');
  }

  /**
   * Update a block's edit metadata fields directly on the Y.Map.
   * @param id - Block id
   * @param lastEditedAt - Timestamp in milliseconds
   * @param lastEditedBy - User ID, or null
   */
  public updateBlockMetadata(id: string, lastEditedAt: number, lastEditedBy: string | null): boolean {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return false;
    }

    // Defensive equality guard — if both fields already match, skip the write to avoid
    // adding an empty/no-op entry to the Yjs undo stack.
    const currentEditedAt = yblock.get('lastEditedAt');
    const currentEditedBy = yblock.get('lastEditedBy') ?? null;

    if (currentEditedAt === lastEditedAt && currentEditedBy === lastEditedBy) {
      return false;
    }

    this.transact(() => {
      yblock.set('lastEditedAt', lastEditedAt);

      if (lastEditedBy === null) {
        // An editor with no identity made this edit, so the previous author
        // must go: keeping the key would credit them with somebody else's work.
        yblock.delete('lastEditedBy');
      } else {
        yblock.set('lastEditedBy', stripNulIfString(lastEditedBy));
      }
    }, 'local');

    return true;
  }

  /**
   * Execute multiple Yjs operations as a single atomic transaction.
   * All operations within the callback will be grouped into one undo entry.
   * @param fn - Function containing Yjs operations to execute atomically
   * @param origin - Transaction origin
   */
  public transact(fn: () => void, origin: LocalOriginTag): void {
    this.ydoc.transact(fn, origin);
  }

  /**
   * Execute Yjs operations without adding them to the undo history.
   * Uses a non-tracked origin so the UndoManager ignores these changes.
   * Use this for auto-repair operations (e.g. ensuring empty cells have a block)
   * that should never be undoable by the user.
   * @param fn - Function containing Yjs operations to execute
   */
  public transactWithoutCapture(fn: () => void): void {
    this.ydoc.transact(fn, 'no-capture');
  }

  /**
   * Get existing tunes Y.Map or create a new one.
   * @param yblock - The block Y.Map
   * @returns The tunes Y.Map
   */
  private getOrCreateTunesMap(yblock: Y.Map<unknown>): Y.Map<unknown> {
    const existing = yblock.get('tunes');

    // A peer may have written a non-map `tunes`; the local tune write
    // replaces it, the same way an absent one is created.
    if (existing instanceof Y.Map) {
      return existing;
    }

    const newTunes = new Y.Map<unknown>();
    yblock.set('tunes', newTunes);

    return newTunes;
  }

  // ========== Binary provider seam ==========
  // Binary-only on purpose: yjs is bundled into dist, so exposing the raw
  // Y.Doc to a host-side provider crosses two yjs module instances (the
  // documented dual-import footgun). Uint8Array payloads are copy-safe.

  /**
   * Origins that entered through `applyRemoteUpdate`; `onUpdate` skips their
   * transactions (echo suppression). Object origins are held weakly, so a
   * provider minting one per connection cannot grow the set; primitive
   * origins are retained, so those must be a few long-lived tags.
   */
  private remoteObjectOrigins: WeakSet<WeakKey> = new WeakSet([REMOTE_APPLY_ORIGIN]);

  private readonly remotePrimitiveOrigins = new Set<unknown>();

  private rememberRemoteOrigin(origin: unknown): void {
    if (typeof origin === 'object' && origin !== null) {
      this.remoteObjectOrigins.add(origin);
    } else {
      this.remotePrimitiveOrigins.add(origin);
    }
  }

  private isRemoteOrigin(origin: unknown): boolean {
    return typeof origin === 'object' && origin !== null
      ? this.remoteObjectOrigins.has(origin)
      : this.remotePrimitiveOrigins.has(origin);
  }

  /**
   * Wrapped 'update' handlers registered via `onUpdate`, kept so
   * `destroy()` can unhook them before the doc is destroyed.
   */
  private readonly updateHandlers = new Set<(update: Uint8Array, origin: unknown) => void>();

  /**
   * Apply a binary Yjs update coming from outside this editor.
   *
   * Object origins are held weakly; a primitive origin is retained for the
   * doc's lifetime, so use a few long-lived tags.
   * @param update - Encoded Yjs update (as produced by `encodeStateAsUpdate`
   *   or an `onUpdate` callback on a peer)
   * @param origin - Provider origin recorded on the transaction; defaults to
   *   a module-level remote sentinel. Must NOT be a LocalOriginTag — those
   *   mark this editor's own writes and are tracked by the undo scope.
   */
  public applyRemoteUpdate(update: Uint8Array, origin?: unknown): void {
    const effectiveOrigin = origin ?? REMOTE_APPLY_ORIGIN;

    // Throw BEFORE registering the origin: a local tag in the remote set
    // would silently swallow every later local write in onUpdate.
    if (typeof effectiveOrigin === 'string' && (LOCAL_ORIGIN_TAGS as readonly string[]).includes(effectiveOrigin)) {
      throw new Error(
        `applyRemoteUpdate: "${effectiveOrigin}" is a local origin tag; ` +
        'remote updates must carry a provider origin so undo scoping and remote classification stay correct'
      );
    }

    // Register before applying: the 'update' event fires synchronously
    // inside Y.applyUpdate, so a late add would echo the first message.
    this.rememberRemoteOrigin(effectiveOrigin);

    const before = this.structuralSnapshot();

    Y.applyUpdate(this.ydoc, update, effectiveOrigin);

    // Separate transaction, same origin — see `reconcileStructure` for why it
    // can be neither inside the remote transaction nor a local one.
    this.reconcileStructure(before, effectiveOrigin);
  }

  /**
   * Subscribe to this document's binary updates. Transactions applied via
   * `applyRemoteUpdate` are skipped, so a provider can broadcast every
   * delivery without echoing remote updates back to their source.
   * @param cb - Receives the encoded update and its transaction origin
   * @returns Unsubscribe function
   */
  public onUpdate(cb: (update: Uint8Array, origin: unknown) => void): () => void {
    const handler = (update: Uint8Array, origin: unknown): void => {
      if (this.isRemoteOrigin(origin)) {
        return;
      }

      cb(update, origin);
    };

    this.updateHandlers.add(handler);
    this.ydoc.on('update', handler);

    return (): void => {
      this.updateHandlers.delete(handler);
      this.ydoc.off('update', handler);
    };
  }

  /**
   * Subscribe to EVERY binary update, including the ones `applyRemoteUpdate`
   * brought in — the ones {@link onUpdate} exists to hide.
   *
   * For persistence, not for broadcast. A cache fed by the filtered hook would
   * store only what this tab typed and reload a document missing every peer's
   * work; a provider using THIS hook would echo remote updates back at their
   * source. Subscribers must skip their own writes by origin.
   * @param cb - Receives the encoded update and its transaction origin
   * @returns Unsubscribe function
   */
  public onAnyUpdate(cb: (update: Uint8Array, origin: unknown) => void): () => void {
    // Registered in the same set as `onUpdate`'s handlers, so a lineage reset
    // re-attaches it to the fresh doc and destroy() unhooks it.
    this.updateHandlers.add(cb);
    this.ydoc.on('update', cb);

    return (): void => {
      this.updateHandlers.delete(cb);
      this.ydoc.off('update', cb);
    };
  }

  /**
   * Encode this document's state vector (for requesting a diff from a peer).
   */
  public getStateVector(): Uint8Array {
    return Y.encodeStateVector(this.ydoc);
  }

  /**
   * Encode document state as a binary update.
   * @param stateVector - When given, only the changes the peer at that state
   *   vector is missing are encoded; otherwise the full document.
   */
  public encodeStateAsUpdate(stateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc, stateVector);
  }

  // ========== Awareness seam ==========
  // JSON at the presence face (getStates/onChange/setField), binary at the
  // provider face (encode/apply). Lazy: nothing here exists until a provider
  // calls `enableAwareness`. Awareness binds to `doc.clientID`, so a lineage
  // reset that swaps the Y.Doc must recreate it (owner: the reset lever).

  /**
   * Turn presence on. Idempotent — the first call creates the Awareness (and
   * its 3s sweep timer), later calls are no-ops. A provider MUST call this
   * before `onAwarenessChange`/`encodeAwarenessUpdate`.
   */
  public enableAwareness(): void {
    if (this.awareness !== null) {
      return;
    }

    this.awareness = new Awareness(this.ydoc);
  }

  /**
   * Set one field of THIS peer's presence state (e.g. `user`, `blockId`).
   * No-op before `enableAwareness`, so a caret move under single-player costs
   * nothing.
   * @param field - Field name
   * @param value - Field value
   */
  public setAwarenessField(field: string, value: unknown): void {
    this.awareness?.setLocalStateField(field, value);
  }

  /**
   * Every known peer's presence state, keyed by Yjs client id (the JSON
   * presence face for the renderer). Empty map when presence is off.
   */
  public getAwarenessStates(): Map<number, Record<string, unknown>> {
    return this.awareness?.getStates() ?? new Map<number, Record<string, unknown>>();
  }

  /**
   * Subscribe to presence deltas (added/updated/removed client ids).
   * @param callback - Receives the change delta and its origin
   * @returns Unsubscribe function
   */
  public onAwarenessChange(callback: (changes: AwarenessChange, origin: unknown) => void): () => void {
    const awareness = this.requireAwareness('onAwarenessChange');

    awareness.on('change', callback);

    return (): void => {
      awareness.off('change', callback);
    };
  }

  /**
   * Subscribe to EVERY presence emission, including the 3s keepalive that
   * renews the local state with equal content. `onAwarenessChange` rides
   * y-protocols' 'change', which is emitted only when the delta survives an
   * equality filter — so a keepalive never reaches it. A provider that
   * rebroadcasts only 'change' lets every standard peer prune this client
   * after its 30s outdated timeout, and an idle collaborator's presence
   * silently disappears. Broadcasting rides this; rendering rides 'change'.
   * @param callback - Receives the raw delta and its origin
   * @returns Unsubscribe function
   */
  public onAwarenessUpdate(callback: (changes: AwarenessChange, origin: unknown) => void): () => void {
    const awareness = this.requireAwareness('onAwarenessUpdate');

    awareness.on('update', callback);

    return (): void => {
      awareness.off('update', callback);
    };
  }

  /**
   * Encode a binary awareness update for the provider to broadcast.
   * @param clients - Client ids to include; defaults to every known state
   *   (this peer plus any it has learned about).
   */
  public encodeAwarenessUpdate(clients?: number[]): Uint8Array {
    const awareness = this.requireAwareness('encodeAwarenessUpdate');
    // A client `pruneAwarenessMeta` dropped has no row for y-protocols to
    // read, and the provider may still list it (it queues removed ids for a
    // deferred broadcast).
    const known = (clients ?? Array.from(awareness.getStates().keys())).filter((id) => awareness.meta.has(id));

    return encodeAwarenessUpdate(awareness, known);
  }

  /**
   * The frame that tells the room this client is gone: its id, its current
   * clock, and a null state. y-protocols asks for exactly this — "before a
   * client disconnects, it should propagate a null state with an updated
   * clock" — and without it a departed peer lingers on every other browser
   * until their own 30s sweep expires it, which is what makes one reload look
   * like a second person joining.
   *
   * Encoded from an EMPTY state map, so nothing local is mutated: a page that
   * turns out to survive (a bfcache restore) keeps publishing presence, and a
   * peer applies the null through the same clock branch it applies any
   * removal through. Null before `enableAwareness` — single-player has nobody
   * to tell.
   */
  public encodeLocalAwarenessDeparture(): Uint8Array | null {
    const awareness = this.awareness;

    if (awareness === null || !awareness.meta.has(awareness.clientID)) {
      return null;
    }

    return encodeAwarenessUpdate(awareness, [awareness.clientID], new Map());
  }

  /**
   * Apply a binary awareness update received from a peer. No-op before
   * `enableAwareness` — a stray inbound frame during single-player is ignored.
   * @param update - Encoded awareness update
   * @param origin - Provider origin carried on the emitted change
   */
  public applyAwarenessUpdate(update: Uint8Array, origin: unknown): void {
    if (this.awareness === null) {
      return;
    }

    this.pruneAwarenessMeta(this.awareness);
    applyAwarenessUpdate(this.awareness, update, origin);
  }

  /**
   * y-protocols keeps a meta row (clock, last seen) for every client id it
   * has ever heard of, and its outdated sweep removes STATES only — so a
   * flood of fake client ids would grow `meta` forever. Drop the rows of
   * remote clients that hold no state AND have been silent past
   * {@link AWARENESS_TOMBSTONE_TTL_MS}.
   *
   * The age test is the whole point. A stateless row is y-protocols'
   * TOMBSTONE: `applyAwarenessUpdate` rejects a relayed state whose clock the
   * row already holds, and `encodeAwarenessUpdate` reads the row to encode a
   * removal at all. Pruning on statelessness alone let any peer's
   * queryAwareness reply resurrect a departed client, and emptied the removal
   * the provider was about to broadcast.
   *
   * Runs at the start of each inbound apply, NOT on 'change': the provider
   * encodes a change's removed ids later (deferred broadcast) and needs
   * their rows until then.
   */
  private pruneAwarenessMeta(awareness: Awareness): void {
    // The same clock y-protocols stamps `lastUpdated` with. `Date.now` read
    // here instead would drift under fake timers, which replace the global
    // but not the binding lib0 captured at import.
    const staleBefore = getUnixTime() - AWARENESS_TOMBSTONE_TTL_MS;

    for (const [clientId, row] of Array.from(awareness.meta)) {
      if (clientId !== awareness.clientID && !awareness.states.has(clientId) && row.lastUpdated < staleBefore) {
        awareness.meta.delete(clientId);
      }
    }
  }

  /**
   * Drop every REMOTE peer's presence but keep this peer's own state. Used on
   * disconnect so ghost cursors clear without erasing the local presence the
   * next connection will re-broadcast. No-op before `enableAwareness`.
   */
  public clearRemoteAwarenessStates(): void {
    if (this.awareness === null) {
      return;
    }

    const localClientId = this.awareness.clientID;
    const remote = Array.from(this.awareness.getStates().keys()).filter((id) => id !== localClientId);

    if (remote.length > 0) {
      removeAwarenessStates(this.awareness, remote, 'local');
    }
  }

  /**
   * The Awareness, or throw naming the caller — for the operations that are
   * meaningless without presence (subscribe, encode). Mutators/reads no-op
   * instead, which is what keeps teardown ordering safe.
   */
  private requireAwareness(method: string): Awareness {
    if (this.awareness === null) {
      throw new Error(`DocumentStore.${method}: awareness not enabled; call enableAwareness() first`);
    }

    return this.awareness;
  }

  // ========== Lineage reset ==========

  /**
   * Replace this store's document with a genuinely FRESH Y.Doc, for the case
   * where the server reset the room and our history no longer belongs to it.
   *
   * It CANNOT be `fromJSON([])`. That deletes the content but keeps the CRDT
   * history: the deleted items, their clock, and this peer's client id all
   * survive, so the very next sync merges the stale history back into the reset
   * room and re-poisons it. Only a new document has no history to leak.
   *
   * Order is load-bearing:
   * 1. detach the seam's update handlers — they are registered on the DYING doc;
   * 2. read the local presence state, then destroy Awareness — it binds
   *    `doc.clientID`, and its own `doc.on('destroy')` hook would otherwise
   *    reach a half-torn-down instance (same rule as `destroy()`);
   * 3. swap in the new doc and its two roots, THEN destroy the old one;
   * 4. reset echo suppression — a fresh doc has no remote origins yet;
   * 5. re-attach the same handler objects, so every `onUpdate` subscription made
   *    before the reset keeps working (and its unsubscribe still detaches,
   *    because the closure reads `this.ydoc` at call time);
   * 6. rebuild Awareness only if it existed, restoring the local state so a
   *    reset does not silently drop this peer's presence. Its subscriptions
   *    are NOT carried over (they were bound to the destroyed instance);
   *    callers re-subscribe.
   *
   * The new doc's clientID is Yjs's own random one — never seeded, so two peers
   * that reset at the same moment cannot collide.
   *
   * The caller owns everything bound to the OLD doc from outside: the undo
   * manager's scope and the block observer's roots (see
   * `YjsManager.resetForRelineage`), and the rendered DOM.
   */
  public resetForRelineage(): void {
    for (const handler of this.updateHandlers) {
      this.ydoc.off('update', handler);
    }

    const localAwarenessState = this.awareness?.getLocalState() ?? null;
    const hadAwareness = this.awareness !== null;

    if (this.awareness !== null) {
      this.awareness.destroy();
      this.awareness = null;
    }

    const previous = this.ydoc;

    this.ydoc = new Y.Doc();
    this.yBlocksMap = this.ydoc.getMap('blocks');
    this.yRootOrder = this.ydoc.getArray('root');

    previous.destroy();

    this.remoteObjectOrigins = new WeakSet([REMOTE_APPLY_ORIGIN]);
    this.remotePrimitiveOrigins.clear();

    for (const handler of this.updateHandlers) {
      this.ydoc.on('update', handler);
    }

    if (hadAwareness) {
      this.awareness = new Awareness(this.ydoc);

      if (localAwarenessState !== null) {
        this.awareness.setLocalState(localAwarenessState);
      }
    }
  }

  /**
   * Cleanup on destroy.
   */
  public destroy(): void {
    // Unhook providers before the doc is torn down.
    for (const handler of this.updateHandlers) {
      this.ydoc.off('update', handler);
    }
    this.updateHandlers.clear();

    // Destroy awareness BEFORE the doc: its own `doc.on('destroy')` hook would
    // otherwise reach a half-torn-down instance. Clears the sweep timer.
    if (this.awareness !== null) {
      this.awareness.destroy();
      this.awareness = null;
    }

    this.ydoc.destroy();
  }
}
