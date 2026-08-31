import * as Y from 'yjs';

import type { YBlockSerializer, YjsOutputBlockData } from './serializer';
import { LOCAL_ORIGIN_TAGS, type LocalOriginTag } from './types';
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
 * Responsibilities:
 * - Owns the Y.Doc and Y.Array instances
 * - Provides CRUD operations for blocks
 * - Wraps operations in transactions with proper origins
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
   * Yjs array containing all blocks
   */
  public readonly yblocks: Y.Array<Y.Map<unknown>> = this.ydoc.getArray('blocks');

  /**
   * Serializer for converting between Yjs and DocumentStoreBlockData formats
   */
  private serializer: YBlockSerializer;

  constructor(serializer: YBlockSerializer) {
    this.serializer = serializer;
  }

  /**
   * Load blocks from JSON data.
   * Clears existing blocks and replaces them with the provided data.
   * Uses 'load' origin which is not tracked by undo manager.
   */
  public fromJSON(blocks: DocumentStoreBlockData[]): void {
    this.ydoc.transact(() => {
      this.yblocks.delete(0, this.yblocks.length);

      for (const block of blocks) {
        const yblock = this.serializer.outputDataToYBlock(block);
        this.yblocks.push([yblock]);
      }
    }, 'load');
  }

  /**
   * Serialize blocks to JSON format.
   */
  public toJSON(): DocumentStoreBlockData[] {
    return this.yblocks.toArray().map((yblock) => this.serializer.yBlockToOutputData(yblock));
  }

  /**
   * Add a new block.
   * @param blockData - Block data to add
   * @param index - Optional index to insert at (defaults to end)
   * @returns The created Y.Map
   */
  public addBlock(blockData: DocumentStoreBlockData, index?: number): Y.Map<unknown> {
    const yblock = this.serializer.outputDataToYBlock(blockData);

    this.transact(() => {
      const insertIndex = Math.max(0, Math.min(index ?? this.yblocks.length, this.yblocks.length));
      this.yblocks.insert(insertIndex, [yblock]);
    }, 'local');

    return yblock;
  }

  /**
   * Remove a block by id.
   * @param id - Block id to remove
   */
  public removeBlock(id: string): void {
    const index = this.findBlockIndex(id);

    if (index === -1) {
      return;
    }

    this.transact(() => {
      this.yblocks.delete(index, 1);
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
   * Move a block to a new index.
   * @param id - Block id to move
   * @param toIndex - Target index (the final position where the block should end up)
   * @param origin - Transaction origin
   */
  public moveBlock(
    id: string,
    toIndex: number,
    origin: 'local' | 'move-undo' | 'move-redo'
  ): void {
    const fromIndex = this.findBlockIndex(id);

    if (fromIndex === -1) {
      return;
    }

    // Skip if no actual movement needed
    if (fromIndex === toIndex) {
      return;
    }

    // Use the origin for the transaction:
    // - 'local' for user-initiated moves (we use 'move' so Yjs UndoManager doesn't track them)
    // - 'move-undo' / 'move-redo' for our custom undo/redo (maps to 'undo'/'redo' for DOM sync)
    const transactionOrigin: LocalOriginTag = origin === 'local' ? 'move' : origin;

    this.transact(() => {
      const yblock = this.yblocks.get(fromIndex);

      // Clone the block data before deletion since Y.Map can't be reinserted after deletion
      const blockData = this.serializer.yBlockToOutputData(yblock);

      this.yblocks.delete(fromIndex, 1);

      // Clamp toIndex to valid range after deletion shortened the array.
      // An out-of-bounds toIndex means the caller had stale state — clamp
      // to array bounds rather than letting Yjs throw "Length exceeded!".
      const clampedToIndex = Math.max(0, Math.min(toIndex, this.yblocks.length));
      this.yblocks.insert(clampedToIndex, [this.serializer.outputDataToYBlock(blockData)]);
    }, transactionOrigin);
  }

  /**
   * Get block Y.Map by id.
   * @param id - Block id
   * @returns Y.Map or undefined if not found
   */
  public getBlockById(id: string): Y.Map<unknown> | undefined {
    const index = this.findBlockIndex(id);

    if (index === -1) {
      return undefined;
    }

    return this.yblocks.get(index);
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
   * Find block index by id.
   * @param id - Block id to find
   * @returns Index or -1 if not found
   */
  public findBlockIndex(id: string): number {
    return this.yblocks.toArray().findIndex((yblock) => yblock.get('id') === id);
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
