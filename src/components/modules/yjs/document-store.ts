import * as Y from 'yjs';

import type { YBlockSerializer, YjsOutputBlockData } from './serializer';
import { LOCAL_ORIGIN_TAGS, type BlockPlacement, type LocalOriginTag, type UndoScopeType } from './types';
import { equals } from '../../utils/object';

// Re-export YjsOutputBlockData as DocumentStoreBlockData for consistency
type DocumentStoreBlockData = YjsOutputBlockData;

/**
 * Default transaction origin for updates applied through the binary seam
 * when the provider passes none. Not a LocalOriginTag, so BlockObserver
 * classifies these transactions 'remote' and the UndoManager ignores them.
 */
const REMOTE_APPLY_ORIGIN = Object.freeze({ source: 'blok-remote-apply' });

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
export class DocumentStore {
  /**
   * Yjs document instance.
   *
   * PRIVATE by design: all writes MUST route through `transact` or
   * `transactWithoutCapture` so the origin passes the `LocalOriginTag`
   * type barrier. Exposing the raw Y.Doc lets callers bypass the
   * whitelist and silently reintroduce the class of bugs that
   * `BlockObserver.mapTransactionOrigin` exists to prevent.
   */
  private readonly ydoc: Y.Doc = new Y.Doc();

  /**
   * id → per-block Y.Map. Membership lives here; order lives in the order
   * arrays (`yRootOrder` + each block's `contentIds`).
   */
  private readonly yBlocksMap: Y.Map<Y.Map<unknown>> = this.ydoc.getMap('blocks');

  /**
   * Top-level block ids in document order.
   */
  private readonly yRootOrder: Y.Array<string> = this.ydoc.getArray('root');

  /**
   * Serializer for converting between Yjs and DocumentStoreBlockData formats
   */
  private serializer: YBlockSerializer;

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
  public fromJSON(blocks: DocumentStoreBlockData[]): void {
    this.ydoc.transact(() => {
      this.yRootOrder.delete(0, this.yRootOrder.length);

      for (const key of Array.from(this.yBlocksMap.keys())) {
        this.yBlocksMap.delete(key);
      }

      for (const block of blocks) {
        if (typeof block.id !== 'string') {
          continue;
        }

        this.yBlocksMap.set(block.id, this.serializer.outputDataToYBlock(block));
      }

      const topLevelIds = blocks.flatMap((block) =>
        block.parent === undefined && typeof block.id === 'string' ? [block.id] : []
      );

      this.yRootOrder.push(topLevelIds);
    }, 'load');
  }

  /**
   * Serialize blocks to JSON format, in derived flat document order.
   */
  public toJSON(): DocumentStoreBlockData[] {
    return this.deriveOrderedIds()
      .map((id) => this.yBlocksMap.get(id))
      .filter((yblock): yblock is Y.Map<unknown> => yblock instanceof Y.Map)
      .map((yblock) => this.serializer.yBlockToOutputData(yblock));
  }

  /**
   * Flat document order: DFS from the root order, descending through each
   * block's contentIds. Laws (cross-peer deterministic):
   * - duplicate id across order arrays → FIRST occurrence wins;
   * - id with no map entry → skipped;
   * - map entries reachable from no order array → appended at the END,
   *   sorted by id (Y.Map iteration order is not a cross-peer guarantee).
   */
  private deriveOrderedIds(): string[] {
    const ordered = this.deriveReachableIds();
    const seen = new Set(ordered);
    const orphans = Array.from(this.yBlocksMap.keys())
      .filter((id) => !seen.has(id))
      .sort();

    for (const id of orphans) {
      this.visitBlock(id, seen, ordered);
    }

    return ordered;
  }

  /**
   * Flat order of blocks reachable from the root order only (no orphan
   * tail). Placement math uses this so an id mid-move never pollutes the
   * positions it is measured against.
   */
  private deriveReachableIds(): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>();

    for (const id of this.yRootOrder.toArray()) {
      this.visitBlock(id, seen, ordered);
    }

    return ordered;
  }

  /**
   * DFS step: emit the id (first occurrence only, and only when a map
   * entry exists), then descend into its contentIds. The seen-set makes
   * cycles terminate.
   */
  private visitBlock(id: unknown, seen: Set<string>, ordered: string[]): void {
    if (typeof id !== 'string' || seen.has(id)) {
      return;
    }

    const yblock = this.yBlocksMap.get(id);

    if (!(yblock instanceof Y.Map)) {
      return;
    }

    seen.add(id);
    ordered.push(id);

    const contentIds = yblock.get('contentIds');

    if (!(contentIds instanceof Y.Array)) {
      return;
    }

    for (const childId of contentIds.toArray()) {
      this.visitBlock(childId, seen, ordered);
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
  public addBlock(blockData: DocumentStoreBlockData, index?: number): Y.Map<unknown> {
    const yblock = this.serializer.outputDataToYBlock(blockData);
    const id = blockData.id;

    if (typeof id !== 'string') {
      return yblock;
    }

    this.transact(() => {
      const flatIds = this.deriveReachableIds();
      const desired = Math.max(0, Math.min(index ?? flatIds.length, flatIds.length));

      this.yBlocksMap.set(id, yblock);

      const target = this.resolveTargetOrder(blockData.parent);

      if (target !== null) {
        target.insert(this.orderSlotForFlatIndex(target, flatIds, desired), [id]);
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
   * Backs `BlockMutation.replace()` (turn-into + markdown conversion). The prior
   * approach removed the yblock and inserted a NEW one that REUSED the same
   * logical id; `BlockObserver` saw the id in both the added and removed sets and
   * classified it as a no-op MOVE, so undoing a conversion never re-rendered the
   * block back to its prior tool. Mutating the existing Y.Map instead emits an
   * `update` event carrying the id, which the reconciler resolves against the
   * yblock's `type` and re-renders the correct tool. The single transaction keeps
   * it one undo entry.
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

    this.transact(() => {
      yblock.set('type', type);
      yblock.set('data', this.serializer.objectToYMap(this.serializer.normalizeBlockData(type, data)));
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
   * @param origin - Transaction origin
   */
  public moveBlock(
    id: string,
    toIndex: number,
    origin: 'local'
  ): void {
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
    const transactionOrigin: LocalOriginTag = origin === 'local' ? 'move' : origin;

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
    }, transactionOrigin);
  }

  /**
   * Place a block: one transaction owning the parentId key AND order-array
   * membership. Root placement DELETES the parentId key (root = absent
   * key, never a null value). The id is removed from every order array
   * first, then inserted after `afterId` in the target array (afterId null
   * → first child; afterId not found → append; parent map entry missing →
   * left in no array, orphan tolerance).
   * @param id - Block id to place
   * @param placement - Target parent (null = root) and preceding sibling (null = first)
   * @param origin - Transaction origin
   */
  public applyPlacement(id: string, placement: BlockPlacement, origin: LocalOriginTag): void {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return;
    }

    this.transact(() => {
      // Idempotent parentId write: an agreeing value writes nothing, so the
      // transaction touches order arrays ONLY and the observer emits a pure
      // 'move'. Move replay relies on this — a spurious parentId item would
      // emit an 'update' whose undo/redo-origin handling re-runs setData on
      // the block mid-replay. (delete on an absent key is already a no-op.)
      if (placement.parentId === null) {
        yblock.delete('parentId');
      } else if (yblock.get('parentId') !== placement.parentId) {
        yblock.set('parentId', placement.parentId);
      }

      this.removeFromOrderArrays(id);

      const target = this.resolveTargetOrder(placement.parentId ?? undefined);

      if (target === null) {
        return;
      }

      target.insert(this.placementSlot(target, placement.afterId), [id]);
    }, origin);
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
   * Delete occurrences back-to-front so earlier indices stay valid.
   */
  private removeAllOccurrences(order: Y.Array<string>, id: string): void {
    const index = order.toArray().lastIndexOf(id);

    if (index === -1) {
      return;
    }

    order.delete(index, 1);
    this.removeAllOccurrences(order, id);
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
   * Get a block's contentIds Y.Array, creating it when missing.
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
    return order.toArray().reduce<number>((slot, entryId, position) => {
      const flatIndex = flatIds.indexOf(entryId);

      return flatIndex !== -1 && flatIndex < desiredFlatIndex ? position + 1 : slot;
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
   * @returns true if a Yjs write actually occurred (value changed), false if the
   *          equality guard short-circuited the write.
   */
  public updateBlockData(id: string, key: string, value: unknown): boolean {
    const yblock = this.getBlockById(id);

    if (yblock === undefined) {
      return false;
    }

    const ydata = yblock.get('data') as Y.Map<unknown>;
    const currentValue = ydata.get(key);

    const valueIsPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);

    // Nested OBJECT value backed by a nested Y.Map: deep-merge into the existing
    // Y.Map instead of replacing it. This (a) compares by ENTRIES so an unchanged
    // nested key writes nothing — equals(Y.Map, plainObject) was a false-negative
    // that bumped a spurious first-save undo entry — and (b) keeps the nested
    // value a Y.Map and touches only changed sub-fields, so concurrent edits to
    // DIFFERENT sub-fields merge (field-level CRDT) rather than last-writer-wins.
    if (valueIsPlainObject && currentValue instanceof Y.Map) {
      if (equals(this.serializer.yMapToObject(currentValue), value)) {
        return false;
      }

      this.transact(() => {
        this.deepAssignYMap(currentValue, value as Record<string, unknown>);
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
          this.deepAssignYArray(currentValue, value);
        } else {
          // Emptied or turned primitive — no longer qualifies for Y.Array;
          // downshift to a plain leaf so the write path matches the load path.
          ydata.set(key, value);
        }
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
      ydata.set(key, this.serializer.plainToYValue(value));
    }, 'local');

    return true;
  }

  /**
   * Recursively assign `source` onto `target` Y.Map, writing ONLY changed leaves
   * (so untouched sub-fields keep their CRDT identity and merge across peers) and
   * deleting keys absent from `source`. Nested objects recurse into existing
   * child Y.Maps; new nested objects are serialized fresh. Must run inside a
   * transaction (the caller wraps it).
   */
  private deepAssignYMap(target: Y.Map<unknown>, source: Record<string, unknown>): void {
    // Remove keys no longer present.
    for (const key of Array.from(target.keys())) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) {
        target.delete(key);
      }
    }

    for (const [key, value] of Object.entries(source)) {
      this.assignYMapEntry(target, key, value);
    }
  }

  /** Assign one key of a nested Y.Map, recursing into child Y.Maps/Y.Arrays. */
  private assignYMapEntry(target: Y.Map<unknown>, key: string, value: unknown): void {
    const isPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);
    const existing = target.get(key);

    if (Array.isArray(value) && existing instanceof Y.Array) {
      if (this.serializer.isConvertibleArray(value)) {
        this.deepAssignYArray(existing, value);
      } else if (!equals(this.serializer.yArrayToPlain(existing), value)) {
        // No longer qualifies for Y.Array — downshift to a plain leaf.
        target.set(key, value);
      }

      return;
    }

    if (!isPlainObject) {
      // Primitive/array leaf: write only when it actually changed. A first
      // write of a qualifying array converts via plainToYValue.
      const comparable = this.serializer.yValueToPlain(existing);

      if (!equals(comparable, value)) {
        target.set(key, this.serializer.plainToYValue(value));
      }

      return;
    }

    if (existing instanceof Y.Map) {
      this.deepAssignYMap(existing, value as Record<string, unknown>);

      return;
    }

    target.set(key, this.serializer.objectToYMap(value as Record<string, unknown>));
  }

  /**
   * Element-wise assign `source` onto `target` Y.Array with a TWO-ENDED diff:
   * skip the deeply-equal prefix and suffix, recurse per element when the
   * changed middles have equal length, otherwise replace the middle with ONE
   * splice. Y.Array item identity is what lets a concurrent row insert and a
   * cell edit both apply, so untouched elements must never be rewritten.
   * `source` must satisfy `isConvertibleArray`; must run inside a transaction
   * (the caller wraps it).
   */
  private deepAssignYArray(target: Y.Array<unknown>, source: unknown[]): void {
    const targetLength = target.length;
    const sourceLength = source.length;
    const plainAt = (index: number): unknown => this.serializer.yValueToPlain(target.get(index));
    const maxPrefix = Math.min(targetLength, sourceLength);
    const range = (length: number): number[] => Array.from({ length }, (_, index) => index);

    const prefix = range(maxPrefix)
      .find((index) => !equals(plainAt(index), source[index])) ?? maxPrefix;

    const maxSuffix = maxPrefix - prefix;
    const suffix = range(maxSuffix)
      .find((index) => !equals(plainAt(targetLength - 1 - index), source[sourceLength - 1 - index])) ?? maxSuffix;

    const targetMiddle = targetLength - prefix - suffix;
    const sourceMiddle = sourceLength - prefix - suffix;

    if (targetMiddle === 0 && sourceMiddle === 0) {
      return;
    }

    if (targetMiddle === sourceMiddle) {
      source
        .slice(prefix, prefix + sourceMiddle)
        .forEach((value, offset) => this.assignYArrayElement(target, prefix + offset, value));

      return;
    }

    // Unequal-length middles: one splice, so a row insert/delete lands as a
    // single Y.Array event instead of N element rewrites.
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
  private assignYArrayElement(target: Y.Array<unknown>, index: number, value: unknown): void {
    const existing = target.get(index);
    const valueIsPlainObject = value !== null && typeof value === 'object' && !Array.isArray(value);

    if (valueIsPlainObject && existing instanceof Y.Map) {
      this.deepAssignYMap(existing, value as Record<string, unknown>);

      return;
    }

    if (Array.isArray(value) && existing instanceof Y.Array && this.serializer.isConvertibleArray(value)) {
      this.deepAssignYArray(existing, value);

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
      ytunes.set(tuneName, tuneData);
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
    const currentEditedBy = yblock.get('lastEditedBy');
    const editedByMatches = lastEditedBy === null || currentEditedBy === lastEditedBy;

    if (currentEditedAt === lastEditedAt && editedByMatches) {
      return false;
    }

    this.transact(() => {
      yblock.set('lastEditedAt', lastEditedAt);

      if (lastEditedBy !== null) {
        yblock.set('lastEditedBy', lastEditedBy);
      }
    }, 'local');

    return true;
  }

  /**
   * Find a block's index in the derived flat document order.
   * @param id - Block id to find
   * @returns Index or -1 if not found
   */
  public findBlockIndex(id: string): number {
    return this.deriveOrderedIds().indexOf(id);
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
    const existing = yblock.get('tunes') as Y.Map<unknown> | undefined;

    if (existing !== undefined) {
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
   * Origins that entered through `applyRemoteUpdate`. `onUpdate` skips
   * their transactions (echo suppression). Growth is bounded: one entry
   * per provider origin, and origins are few and long-lived.
   */
  private readonly remoteOrigins = new Set<unknown>([REMOTE_APPLY_ORIGIN]);

  /**
   * Wrapped 'update' handlers registered via `onUpdate`, kept so
   * `destroy()` can unhook them before the doc is destroyed.
   */
  private readonly updateHandlers = new Set<(update: Uint8Array, origin: unknown) => void>();

  /**
   * Apply a binary Yjs update coming from outside this editor.
   * @param update - Encoded Yjs update (as produced by `encodeStateAsUpdate`
   *   or an `onUpdate` callback on a peer)
   * @param origin - Provider origin recorded on the transaction; defaults to
   *   a module-level remote sentinel. Must NOT be a LocalOriginTag — those
   *   mark this editor's own writes and are tracked by the undo scope.
   */
  public applyRemoteUpdate(update: Uint8Array, origin?: unknown): void {
    const effectiveOrigin = origin ?? REMOTE_APPLY_ORIGIN;

    // Throw BEFORE registering the origin: a local tag in remoteOrigins
    // would silently swallow every later local write in onUpdate.
    if (typeof effectiveOrigin === 'string' && (LOCAL_ORIGIN_TAGS as readonly string[]).includes(effectiveOrigin)) {
      throw new Error(
        `applyRemoteUpdate: "${effectiveOrigin}" is a local origin tag; ` +
        'remote updates must carry a provider origin so undo scoping and remote classification stay correct'
      );
    }

    // Register before applying: the 'update' event fires synchronously
    // inside Y.applyUpdate, so a late add would echo the first message.
    this.remoteOrigins.add(effectiveOrigin);

    Y.applyUpdate(this.ydoc, update, effectiveOrigin);
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
      if (this.remoteOrigins.has(origin)) {
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

  /**
   * Cleanup on destroy.
   */
  public destroy(): void {
    // Unhook providers before the doc is torn down.
    for (const handler of this.updateHandlers) {
      this.ydoc.off('update', handler);
    }
    this.updateHandlers.clear();

    this.ydoc.destroy();
  }
}
