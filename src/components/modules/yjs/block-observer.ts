import * as Y from 'yjs';

import { logLabeled } from '../../utils';
import { GRID_ROWS_KEY, MAX_VALUE_DEPTH, YBlockSerializer } from './serializer';
import {
  LOCAL_ORIGIN_TAGS,
  type BlockChangeEvent,
  type BlockChangeCallback,
  type BlockReplayCapture,
  type BlockReplayChange,
  type BlockReplayNative,
  type BlockReplayRelocation,
  type DocumentScope,
  type LocalOriginTag,
  type TransactionOrigin,
} from './types';

/**
 * Per-transaction classification buckets.
 */
interface ReplayKeys {
  scope: BlockReplayCapture['scope'];
  changes: BlockReplayChange[];
}

interface ChangeBuckets {
  adds: string[];
  removes: string[];
  orderTouched: Set<string>;
  updates: Set<string>;
  replayKeys: Map<string, ReplayKeys>;
  removedBlocks: Map<string, Y.Map<unknown>>;
  /** Relocation evidence, keyed by the exact shared types it came from. */
  parentBefore: Map<Y.Map<unknown>, unknown>;
  orderDeltas: Map<Y.Array<unknown>, { added: Set<string>; deleted: Set<string> }>;
  unsafeBlocks: Set<Y.Map<unknown>>;
}

type RelocationValue = BlockReplayRelocation['row']['properties'][string];

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRelocationScalar = (value: unknown): value is string | number | boolean | null =>
  value === null || typeof value === 'string' || typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

const detachReplayValue = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_VALUE_DEPTH) {
    throw new Error('Replay value exceeds the block depth limit');
  }

  if (value === null || value === undefined ||
      typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry: unknown) => detachReplayValue(entry, depth + 1)));
  }

  if (typeof value !== 'object' ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error('Unsupported replay value');
  }

  const detached: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    Object.defineProperty(detached, key, {
      value: detachReplayValue(entry, depth + 1),
      enumerable: true,
    });
  }

  return Object.freeze(detached);
};

/**
 * Event type observed on either root. The union is nominal — every branch
 * narrows by identity/instanceof, never by this annotation.
 */
type ObservedEvent = Y.YEvent<Y.Array<Y.Map<unknown>> | Y.Map<unknown>>;

/**
 * Whether a transaction looks like yjs's own format cleanup: it inserted no
 * struct and deleted only format items. Must run before the transaction's GC
 * (inside `afterTransaction`): GC replaces deleted content and hides its kind.
 * @param transaction - a finished transaction, still in its cleanup
 */
const isFormatCleanup = (transaction: Y.Transaction): boolean => {
  const { beforeState, afterState } = transaction;

  if (afterState.size !== beforeState.size) {
    return false;
  }

  for (const [client, clock] of afterState) {
    if (beforeState.get(client) !== clock) {
      return false;
    }
  }

  const deletes = { formatOnly: true };

  Y.iterateDeletedStructs(transaction, transaction.deleteSet, (struct) => {
    if (!(struct instanceof Y.Item) || !(struct.content instanceof Y.ContentFormat)) {
      deletes.formatOnly = false;
    }
  });

  return deletes.formatOnly;
};

/**
 * BlockObserver observes Yjs events and emits domain events.
 *
 * Doc schema v2 mapping:
 * - blocks-map key add/delete → 'add'/'remove' (the key IS the block id)
 * - order-array edits (root order or a contentIds array) whose id was not
 *   added/removed in the same transaction → 'move'
 * - any other nested event — nested Y.Maps AND nested Y.Arrays (per-cell
 *   grids) — → 'update' on the owning block via the identity walk
 *
 * EMISSION-ORDER CONTRACT: within one transaction, events are emitted
 * moves → add/batch-add → removes → updates, regardless of which root each
 * change came through. Both roots' deep observers only CLASSIFY into a
 * per-transaction buffer; the ordered dispatch runs once per transaction
 * from the doc's 'afterTransaction' hook (still synchronous, inside the
 * same transaction cleanup). Do not rely on yjs firing plain observers
 * before deep ones — that is an internal, not a contract.
 */
export class BlockObserver {
  /**
   * Callbacks for block changes
   */
  private changeCallbacks: BlockChangeCallback[] = [];

  /**
   * Blocks map being observed (id → block Y.Map)
   */
  private blocksMap: Y.Map<Y.Map<unknown>> | null = null;

  /**
   * Root order array being observed (top-level ids)
   */
  private rootOrder: Y.Array<string> | null = null;

  /**
   * Undo manager reference (needed to detect undo/redo state)
   */
  private undoManager: Y.UndoManager | null = null;

  /**
   * The observed doc — source of the 'afterTransaction' dispatch hook.
   */
  private doc: Y.Doc | null = null;

  /**
   * Classifications buffered per transaction between the deep-observer
   * callbacks and the 'afterTransaction' dispatch. WeakMap so a
   * transaction whose dispatch never runs (doc torn down mid-cleanup)
   * cannot leak its buckets.
   */
  private readonly pendingBuckets = new WeakMap<Y.Transaction, ChangeBuckets>();

  /**
   * The single deep observer registered on BOTH roots (kept for detach).
   */
  private deepObserver:
    | ((events: ObservedEvent[], transaction: Y.Transaction) => void)
    | null = null;

  /**
   * The per-transaction dispatch hook (kept for detach).
   */
  private afterTransactionHandler: ((transaction: Y.Transaction) => void) | null = null;

  constructor(private readonly serializer = new YBlockSerializer()) {}

  /**
   * Set up Yjs observers for change tracking.
   */
  public observe(scope: DocumentScope, undoManager: Y.UndoManager): void {
    this.blocksMap = scope.blocksMap;
    this.rootOrder = scope.rootOrder;
    this.undoManager = undoManager;
    this.doc = scope.blocksMap.doc;

    const deepObserver = (events: ObservedEvent[], transaction: Y.Transaction): void => {
      this.collectTransactionEvents(events, transaction);
    };

    this.deepObserver = deepObserver;
    scope.blocksMap.observeDeep(deepObserver);
    scope.rootOrder.observeDeep(deepObserver);

    this.afterTransactionHandler = (transaction: Y.Transaction): void => {
      this.dispatchTransaction(transaction);
    };
    this.doc?.on('afterTransaction', this.afterTransactionHandler);
  }

  /**
   * Register callback for block changes.
   * @param callback - Function to call on changes
   * @returns Unsubscribe function
   */
  public onBlocksChanged(callback: BlockChangeCallback): () => void {
    this.changeCallbacks.push(callback);

    return (): void => {
      const index = this.changeCallbacks.indexOf(callback);

      if (index !== -1) {
        this.changeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Map transaction origin to event origin.
   *
   * Input shapes:
   *  - `Y.UndoManager` instance → `'undo'` or `'redo'`
   *  - `null` with a transaction that only deletes format items (yjs format
   *    cleanup) → `'local'`; any other `null` → `'remote'`
   *  - `LocalOriginTag` string  → mapped by the exhaustive switch below
   *  - anything else            → `'remote'` (treated as a peer update)
   *
   * IMPORTANT: the switch is exhaustive over `LOCAL_ORIGIN_TAGS`. Adding a
   * new tag there without teaching this switch is a compile error via the
   * `satisfies never` guard, and the enumeration test in
   * `block-observer.test.ts` catches any runtime drift. Do not add a local
   * origin tag that silently falls through to `'remote'` — that is the
   * exact bug class that broke `ensureCellHasBlock` → table row deletion.
   */
  public mapTransactionOrigin(origin: unknown, transaction?: Y.Transaction): TransactionOrigin {
    if (this.undoManager && origin === this.undoManager) {
      return this.undoManager.undoing ? 'undo' : 'redo';
    }

    // yjs's own format cleanup (a peer's change left redundant format items
    // here) runs with no origin. It changes no segments, so 'remote' would
    // rerender the block for nothing. Any other null-origin write (a bare Y
    // mutation outside a transaction) stays 'remote' so the DOM follows it.
    if (origin === null) {
      return transaction !== undefined && isFormatCleanup(transaction) ? 'local' : 'remote';
    }

    if (!this.isLocalOriginTag(origin)) {
      return 'remote';
    }

    switch (origin) {
      case 'local':
        return 'local';
      case 'load':
        return 'load';
      // `no-capture` is used by `DocumentStore.transactWithoutCapture` for
      // local writes that must bypass the undo stack (auto-repair inserts,
      // drag-move parent rewrites replayed by undo/redo, etc). They are
      // LOCAL authoring writes — mapping them to `'remote'` would make
      // `BlockYjsSync` call `setData(staleYjsData)` on the authoring block
      // mid-operation and wipe any in-memory state the tool had written
      // ahead of Yjs (e.g. Table's local model after `model.addRow()`).
      case 'no-capture':
        return 'local';
      case 'move':
        return 'local';
      case 'move-undo':
        return 'undo';
      case 'move-redo':
        return 'redo';
      default: {
        const _exhaustive: never = origin;

        return _exhaustive;
      }
    }
  }

  /**
   * Type guard for known local-authored origin tags.
   */
  private isLocalOriginTag(value: unknown): value is LocalOriginTag {
    return (
      typeof value === 'string' &&
      (LOCAL_ORIGIN_TAGS as readonly string[]).includes(value)
    );
  }

  /**
   * Deep-observer callback for either root: classify this root's events
   * into the transaction's buckets. Emits nothing — the ordered dispatch
   * runs once per transaction in `dispatchTransaction`.
   */
  private collectTransactionEvents(
    events: ObservedEvent[],
    transaction: Y.Transaction
  ): void {
    const buckets = this.pendingBuckets.get(transaction) ?? {
      adds: [],
      removes: [],
      orderTouched: new Set<string>(),
      updates: new Set<string>(),
      replayKeys: new Map<string, ReplayKeys>(),
      removedBlocks: new Map<string, Y.Map<unknown>>(),
      parentBefore: new Map<Y.Map<unknown>, unknown>(),
      orderDeltas: new Map<Y.Array<unknown>, { added: Set<string>; deleted: Set<string> }>(),
      unsafeBlocks: new Set<Y.Map<unknown>>(),
    };

    this.pendingBuckets.set(transaction, buckets);

    for (const event of events) {
      // One bad event must not desync the rest of the transaction's blocks
      // — remote payloads are untrusted input.
      try {
        this.collectEvent(event, buckets);
      } catch (error) {
        logLabeled('Failed to process a document change event.', 'error', error);
      }
    }
  }

  /**
   * Sort one event into the buckets:
   * - target === blocksMap → key adds/deletes/updates (the key is the id)
   * - target === rootOrder, or a block's contentIds Y.Array → the id
   *   STRINGS in its delta are move candidates
   * - any other target reachable from a block — nested Y.Maps AND nested
   *   Y.Arrays (grid rows/cells) — → 'update' for the owning block
   * - targets that never reach a block Y.Map (hostile shapes) drop silently
   */
  private collectEvent(event: ObservedEvent, buckets: ChangeBuckets): void {
    if (this.blocksMap === null || this.rootOrder === null) {
      return;
    }

    // Widen before comparing: the nominal event annotation says nothing
    // about which shared type actually changed.
    const target: unknown = event.target;

    if (target === this.blocksMap) {
      event.changes.keys.forEach((change, key) => {
        if (change.action === 'add') {
          buckets.adds.push(key);
        } else if (change.action === 'delete') {
          buckets.removes.push(key);
          const removed: unknown = change.oldValue;

          if (removed instanceof Y.Map) {
            buckets.removedBlocks.set(key, removed);
          }
        } else {
          buckets.updates.add(key);
          buckets.replayKeys.set(key, { scope: 'replacement', changes: [] });
        }
      });

      return;
    }

    const isOrderArray =
      target === this.rootOrder ||
      (target instanceof Y.Array && this.isContentIdsArray(target));

    if (isOrderArray) {
      const added = this.extractStrings(event.changes.added);
      const deleted = this.extractStrings(event.changes.deleted);

      for (const id of [...added, ...deleted]) {
        buckets.orderTouched.add(id);
      }

      if (target instanceof Y.Array && target !== this.rootOrder) {
        buckets.orderDeltas.set(target, { added: new Set(added), deleted: new Set(deleted) });
      }

      return;
    }

    this.collectRelocationEvidence(event, target, buckets);

    const yblock = this.walkToOwningBlock(target);

    if (yblock === null) {
      return;
    }

    const id: unknown = yblock.get('id');

    if (typeof id === 'string') {
      buckets.updates.add(id);
      this.collectReplayKeys(event, target, yblock, id, buckets);
    }
  }

  /** Reads the lazy key changes now: subscribers may write before dispatch. */
  private collectRelocationEvidence(event: ObservedEvent, target: unknown, buckets: ChangeBuckets): void {
    if (!(target instanceof Y.Map)) return;
    const parent: unknown = target.parent;
    const dataOwner = parent instanceof Y.Map && parent.parent === this.blocksMap && parent.get('data') === target
      ? parent : null;
    const block = parent === this.blocksMap ? target : dataOwner;

    if (block === null) return;
    event.changes.keys.forEach((change, key) => {
      if (block === target && key === 'parentId' && change.action === 'update') {
        buckets.parentBefore.set(block, change.oldValue);
      } else if (block === target
        ? ['type', 'contentIds', 'data', 'parentId'].includes(key)
        : ['properties', 'template'].includes(key)) {
        buckets.unsafeBlocks.add(block);
      }
    });
  }

  /**
   * The row as this replay left it, only when the same transaction changed its
   * parent, removed it from the old owner's contentIds and added it to the new one's.
   */
  private captureRelocation(
    blockId: string,
    after: BlockReplayNative | undefined,
    buckets: ChangeBuckets
  ): BlockReplayRelocation | undefined {
    // A peer can write any value at a block id; only a map is a block.
    const row: unknown = this.blocksMap?.get(blockId);
    const before: unknown = row instanceof Y.Map ? buckets.parentBefore.get(row) : undefined;

    if (!(row instanceof Y.Map) || after?.type !== 'database-row' || !after.parent.present ||
        typeof before !== 'string' || before === after.parent.value) return undefined;
    // A replaced or restored owner is a new type with no events, so identity alone rejects it.
    const [from, to]: unknown[] = [before, after.parent.value].map((id) => this.blocksMap?.get(id));

    if (!(from instanceof Y.Map) || !(to instanceof Y.Map) ||
        [row, from, to].some((map) => buckets.unsafeBlocks.has(map))) return undefined;
    const fromOrder: unknown = from.get('contentIds');
    const toOrder: unknown = to.get('contentIds');
    const removed = fromOrder instanceof Y.Array ? buckets.orderDeltas.get(fromOrder) : undefined;
    const inserted = toOrder instanceof Y.Array ? buckets.orderDeltas.get(toOrder) : undefined;

    if (removed?.deleted.has(blockId) !== true || removed.added.has(blockId) ||
        inserted?.added.has(blockId) !== true || inserted.deleted.has(blockId)) return undefined;
    const data: unknown = row.get('data');
    const properties: unknown = data instanceof Y.Map ? data.get('properties') : undefined;
    const position: unknown = data instanceof Y.Map ? data.get('position') : undefined;

    if (!(properties instanceof Y.Map) || typeof position !== 'string') return undefined;
    const plain: Record<string, RelocationValue> = {};

    for (const [key, value] of properties.entries()) {
      const detached = this.relocationValue(value);

      if (detached === undefined) return undefined;
      // defineProperty keeps an own '__proto__' key as data.
      Object.defineProperty(plain, key, { value: detached, enumerable: true });
    }

    return Object.freeze({
      before: Object.freeze({ ...after, parent: Object.freeze({ present: true, value: before }) }),
      after,
      row: Object.freeze({ properties: Object.freeze(plain), position }),
    });
  }

  /**
   * A scalar, or a keyed person/relation/file list. Raw values are checked first:
   * serializing turns a Y.Doc into null and a Y.Text into a string.
   */
  private relocationValue(value: unknown): RelocationValue | undefined {
    if (isRelocationScalar(value)) return value;
    if (!this.serializer.isGridMap(value)) return undefined;
    const items: unknown = value.get(GRID_ROWS_KEY);

    if (!(items instanceof Y.Map) || Array.from(items.values()).some((item: unknown) =>
      !(item instanceof Y.Map) || Array.from(item.values()).some((field: unknown) => typeof field !== 'string'))) {
      return undefined;
    }
    const list = this.serializer.gridMapToPlain(value);

    if (list.length > 0 && !this.serializer.isIdentityArray(list)) return undefined;

    return Object.freeze(list.map((item: unknown) => {
      const fields: Record<string, string> = {};

      Object.entries(isPlainRecord(item) ? item : {}).forEach(([field, text]) => {
        // defineProperty keeps an own '__proto__' key as data.
        if (typeof text === 'string') Object.defineProperty(fields, field, { value: text, enumerable: true });
      });

      return Object.freeze(fields);
    }));
  }

  private collectReplayKeys(
    event: ObservedEvent,
    target: unknown,
    yblock: Y.Map<unknown>,
    blockId: string,
    buckets: ChangeBuckets
  ): void {
    if (target === yblock) {
      const changedKeys = [...event.changes.keys.keys()];

      // Edit stamps do not own exported data keys.
      if (changedKeys.length > 0 && changedKeys.every((key) => key === 'lastEditedAt' || key === 'lastEditedBy' || key === 'lastEditedWith')) return;
    }

    const keys: ReplayKeys = buckets.replayKeys.get(blockId) ?? { scope: 'keys', changes: [] };

    buckets.replayKeys.set(blockId, keys);
    if (keys.scope !== 'keys') return;

    try {
      const listChange = this.captureRowListChange(target, yblock);

      if (listChange !== null && target instanceof Y.Map &&
          Array.from(event.changes.keys).some(([key, change]) =>
            change.action === 'update' &&
            (change.oldValue instanceof Y.AbstractType || target.get(key) instanceof Y.AbstractType))) {
        keys.scope = 'replacement';
        keys.changes = [];
        return;
      }
      if (listChange !== null && !keys.changes.some((change) => change.path.length === 2 &&
          change.path[0] === 'properties' && change.path[1] === listChange.path[1])) {
        keys.changes.push(listChange);
      }
      if (listChange !== null) return;
      const path = this.relativeDataPath(target, yblock);

      if (!(target instanceof Y.Map) || path === null) {
        keys.scope = target === yblock && event.changes.keys.has('data') ? 'replacement' : 'unknown';
        keys.changes = [];
        return;
      }

      // Yjs key actions are lazy; copy them before subscriber writes.
      event.changes.keys.forEach((change, key) => {
        if (keys.scope !== 'keys') return;
        const present = target.has(key);
        const value: unknown = target.get(key);

        if (change.action === 'update' &&
            (change.oldValue instanceof Y.AbstractType || value instanceof Y.AbstractType)) {
          keys.scope = 'replacement';
          keys.changes = [];
          return;
        }

        keys.changes.push(Object.freeze({
          path: Object.freeze([...path, key]),
          beforePresent: change.action !== 'add',
          afterPresent: present,
          ...(present ? { after: this.captureValue(value) } : {}),
        }));
      });
    } catch {
      keys.scope = 'unknown';
      keys.changes = [];
    }
  }

  private captureRowListChange(
    target: unknown,
    yblock: Y.Map<unknown>,
    depth = 0
  ): BlockReplayChange | null {
    const data: unknown = yblock.get('data');
    const properties: unknown = data instanceof Y.Map ? data.get('properties') : undefined;

    if (
      yblock.get('type') !== 'database-row' || !(properties instanceof Y.Map) ||
      depth > MAX_VALUE_DEPTH || !(target instanceof Y.AbstractType)
    ) return null;
    if (target.parent !== properties) {
      return this.captureRowListChange(target.parent, yblock, depth + 1);
    }
    if (!this.serializer.isGridMap(target)) return null;
    const wrapper = target;
    const propertyId = Array.from(properties.entries())
      .find(([, value]: [string, unknown]) => value === wrapper)?.[0];

    if (propertyId === undefined) return null;
    const value = this.serializer.gridMapToPlain(wrapper);

    if (value.length > 0 && !this.serializer.isIdentityArray(value)) return null;
    return Object.freeze({
      path: Object.freeze(['properties', propertyId]),
      beforePresent: true,
      afterPresent: true,
      after: detachReplayValue(value),
    });
  }

  private relativeDataPath(target: unknown, yblock: Y.Map<unknown>, path: string[] = []): string[] | null {
    const data: unknown = yblock.get('data');

    if (target === data) return data instanceof Y.Map ? path : null;
    if (!(target instanceof Y.AbstractType) || path.length > MAX_VALUE_DEPTH) return null;
    // Wrapper slots do not exist in exported data.
    if (this.serializer.isGridMap(target)) return null;
    const parent: unknown = target.parent;

    if (!(parent instanceof Y.Map) || parent === yblock) return null;
    const key = Array.from(parent.entries()).reduce<string | undefined>(
      (found, [slot, value]: [string, unknown]) => value === target ? slot : found,
      undefined
    );

    return key === undefined ? null : this.relativeDataPath(parent, yblock, [key, ...path]);
  }

  private captureValue(value: unknown): unknown {
    if (value instanceof Y.Doc ||
        (value instanceof Y.AbstractType && !(value instanceof Y.Map) &&
         !(value instanceof Y.Array) && !(value instanceof Y.Text) && !(value instanceof Y.XmlText))) {
      throw new Error('Unsupported shared replay value');
    }

    return detachReplayValue(this.serializer.yValueToPlain(value));
  }

  private replayNative(
    block: Y.Map<unknown>,
    priorSlots?: Map<Y.Map<unknown>, Map<string, unknown>>
  ): BlockReplayNative | undefined {
    const slotsOf = (map: Y.Map<unknown>) => priorSlots === undefined ? map : priorSlots.get(map);
    const slots = slotsOf(block);
    const type: unknown = slots?.get('type');
    const data: unknown = slots?.get('data');

    if (typeof type !== 'string' || !(data instanceof Y.Map)) return undefined;
    const parentPresent = slots?.has('parentId') ?? false;
    const parent: unknown = slots?.get('parentId');
    const dataSlots = slotsOf(data);
    const templatePresent = dataSlots?.has('template') ?? false;
    const template: unknown = dataSlots?.get('template');

    if ((parentPresent && typeof parent !== 'string') ||
        (templatePresent && typeof template !== 'boolean')) return undefined;

    const parentState: BlockReplayNative['parent'] =
      typeof parent === 'string' && parentPresent ? { present: true, value: parent } : { present: false };
    const templateState: BlockReplayNative['template'] =
      typeof template === 'boolean' && templatePresent ? { present: true, value: template } : { present: false };

    return Object.freeze({
      type,
      parent: Object.freeze(parentState),
      template: Object.freeze(templateState),
    });
  }

  private captureBlock(
    blockId: string,
    type: BlockReplayCapture['type'],
    origin: TransactionOrigin,
    buckets: ChangeBuckets,
    priorSlots: Map<Y.Map<unknown>, Map<string, unknown>>
  ): BlockReplayCapture {
    const block = type === 'remove'
      ? buckets.removedBlocks.get(blockId) : this.blocksMap?.get(blockId);
    const native = block instanceof Y.Map
      ? this.replayNative(block, type === 'remove' ? priorSlots : undefined) : undefined;
    const keys = buckets.replayKeys.get(blockId);
    const nativeScope: BlockReplayCapture['scope'] = native === undefined ? 'unknown' : 'keys';
    const scope: BlockReplayCapture['scope'] = type === 'update' && native !== undefined
      ? keys?.scope ?? 'unknown' : nativeScope;
    const changes = type === 'update' && scope === 'keys' ? keys?.changes ?? [] : [];
    const record = Object.freeze<BlockReplayCapture>({
      blockId,
      type,
      origin,
      scope,
      ...(native === undefined ? {} : { native }),
      changes: Object.freeze([...changes]),
    });

    if (type !== 'add' || scope !== 'keys') return record;
    const data: unknown = block?.get('data');

    if (!(data instanceof Y.Map)) return record;
    try {
      const added = Array.from(data.entries(), ([key, value]): BlockReplayChange => Object.freeze({
        path: Object.freeze([key]),
        beforePresent: false,
        afterPresent: true,
        after: this.captureValue(value),
      }));

      return Object.freeze({ ...record, changes: Object.freeze(added) });
    } catch {
      return Object.freeze<BlockReplayCapture>({ ...record, scope: 'unknown', changes: Object.freeze([]) });
    }
  }

  /**
   * Whether the array is a block's `contentIds` — the array directly under
   * a block Y.Map, stored under the 'contentIds' key. Any other nested
   * Y.Array (grid rows/cells, tool data) is block content, not order.
   */
  private isContentIdsArray(target: Y.Array<unknown>): boolean {
    const parentBlock: unknown = target.parent;

    return (
      parentBlock instanceof Y.Map &&
      parentBlock.parent === this.blocksMap &&
      parentBlock.get('contentIds') === target
    );
  }

  /**
   * Ordered dispatch for one transaction: moves → adds → removes → updates,
   * so the DOM can reposition before other changes land. Runs from the
   * doc's 'afterTransaction' hook — after BOTH roots' deep observers have
   * classified, still synchronously inside the transaction cleanup.
   */
  private dispatchTransaction(transaction: Y.Transaction): void {
    const buckets = this.pendingBuckets.get(transaction);

    if (buckets === undefined) {
      return;
    }

    this.pendingBuckets.delete(transaction);

    const origin = this.mapTransactionOrigin(transaction.origin, transaction);
    const addSet = new Set(buckets.adds);
    const removeSet = new Set(buckets.removes);
    const moves = [...buckets.orderTouched]
      .filter((id) => !addSet.has(id) && !removeSet.has(id));
    const updates = [...buckets.updates]
      .filter((id) => !addSet.has(id) && !removeSet.has(id));
    const priorSlots = new Map<Y.Map<unknown>, Map<string, unknown>>();

    if (buckets.removes.length > 0) {
      const removedMaps = new Set(buckets.removedBlocks.values());
      const templateItems: Y.Item[] = [];

      // Read only native identity slots while deleted content survives GC.
      Y.iterateDeletedStructs(transaction, transaction.deleteSet, (struct) => {
        if (!(struct instanceof Y.Item) || !(struct.parent instanceof Y.Map) ||
            struct.parentSub === null ||
            struct.id.clock >= (transaction.beforeState.get(struct.id.client) ?? 0)) return;

        if (removedMaps.has(struct.parent) &&
            ['type', 'parentId', 'data'].includes(struct.parentSub)) {
          const slots = priorSlots.get(struct.parent) ?? new Map<string, unknown>();
          const value: unknown = struct.content.getContent()[0];

          if (!slots.has(struct.parentSub)) slots.set(struct.parentSub, value);
          priorSlots.set(struct.parent, slots);
        } else if (struct.parentSub === 'template') {
          templateItems.push(struct);
        }
      });
      const removedData = new Set<unknown>(
        [...priorSlots.values()].map((slots) => slots.get('data'))
      );

      templateItems.forEach((item) => {
        if (!(item.parent instanceof Y.Map) || !removedData.has(item.parent)) return;
        const slots = priorSlots.get(item.parent) ?? new Map<string, unknown>();
        const value: unknown = item.content.getContent()[0];

        if (!slots.has('template')) slots.set('template', value);
        priorSlots.set(item.parent, slots);
      });
    }

    // Snapshot every affected value before even the first move subscriber.
    const captures = new Map<string, BlockReplayCapture>();

    for (const id of buckets.adds) {
      captures.set(id, this.captureBlock(id, 'add', origin, buckets, priorSlots));
    }
    for (const id of buckets.removes) {
      captures.set(id, this.captureBlock(id, 'remove', origin, buckets, priorSlots));
    }
    // Only this editor's own history replay; a remote update can reuse the manager as origin.
    const ownReplay = this.undoManager !== null && transaction.origin === this.undoManager && transaction.local;

    for (const id of updates) {
      const capture = this.captureBlock(id, 'update', origin, buckets, priorSlots);
      const relocation = ownReplay ? this.captureRelocation(id, capture.native, buckets) : undefined;

      captures.set(id, relocation === undefined ? capture : Object.freeze({ ...capture, relocation }));
    }
    const capturesFor = (ids: readonly string[]): readonly BlockReplayCapture[] =>
      Object.freeze(ids.flatMap((id) => {
        const capture = captures.get(id);

        return capture === undefined ? [] : [capture];
      }));

    for (const blockId of moves) {
      this.emitChange({ type: 'move', blockId, origin });
    }

    if (buckets.adds.length === 1) {
      const blockId = buckets.adds[0];

      this.emitChange({ type: 'add', blockId, origin, captures: capturesFor([blockId]) });
    }

    if (buckets.adds.length > 1) {
      this.emitChange({
        type: 'batch-add', blockIds: buckets.adds, origin, captures: capturesFor(buckets.adds),
      });
    }

    for (const blockId of buckets.removes) {
      this.emitChange({ type: 'remove', blockId, origin, captures: capturesFor([blockId]) });
    }

    for (const blockId of updates) {
      this.emitChange({ type: 'update', blockId, origin, captures: capturesFor([blockId]) });
    }
  }

  /**
   * Extract string values from an event delta's item set. Deleted items
   * keep their content readable via `getContent()`.
   */
  private extractStrings(items: Set<Y.Item>): string[] {
    const result: string[] = [];

    items.forEach((item) => {
      for (const value of item.content.getContent()) {
        if (typeof value === 'string') {
          result.push(value);
        }
      }
    });

    return result;
  }

  /**
   * Resolve the yblock owning a changed nested type BY IDENTITY: walk the
   * node up its parent chain until the parent is the blocks map.
   *
   * NOT by `event.path`: yjs freezes every event's path BEFORE dispatch
   * (events are sorted by path length and `YEvent.path` memoizes), while a
   * subscriber may legally grow the doc mid-dispatch (yjs-sync inserts a
   * remote block → a container tool's rendered() hook inserts a child). A
   * frozen key resolved against the live map then points at the wrong
   * block. The parent chain is immune to sibling structural writes.
   *
   * Returns null when the chain never reaches the blocks map, or when the
   * member directly under it is not a Y.Map (hostile shapes drop silently).
   *
   * Any shared type is a legal STARTING node. A block's mergeable text is a
   * Y.Text, and its delta events target that Y.Text rather than the data map,
   * so rejecting a non-map here would drop every keystroke a peer sends. The
   * member-under-blocks-must-be-a-Y.Map gate below is what keeps hostile
   * shapes out, not this check.
   */
  private walkToOwningBlock(node: unknown): Y.Map<unknown> | null {
    if (this.blocksMap === null) {
      return null;
    }

    if (!(node instanceof Y.AbstractType)) {
      return null;
    }

    const parent: unknown = node.parent;

    if (parent === this.blocksMap) {
      return node instanceof Y.Map ? node : null;
    }

    return this.walkToOwningBlock(parent);
  }

  /**
   * Emit change event to all callbacks.
   *
   * Note: We do NOT skip events during undo/redo. The isPerformingUndoRedo flag
   * is only used in UndoHistory to prevent the stack-item-added listener from
   * modifying caret stacks. Change events during undo/redo must be emitted so
   * the DOM can be updated to reflect the Yjs state.
   */
  private emitChange(event: BlockChangeEvent): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback(event);
      } catch (error) {
        logLabeled('A block-change subscriber threw.', 'error', error);
      }
    }
  }

  /**
   * Detach from the observed document, KEEPING the change subscribers.
   *
   * This is the half of `destroy` a lineage reset needs: the Y.Doc is being
   * swapped, but every subscriber (BlockYjsSync above all) must survive the
   * swap — re-registering them would mean reaching into BlockManager to rebuild
   * a subscription that never had to break. Pair it with a fresh `observe`.
   */
  public unobserve(): void {
    if (this.deepObserver !== null) {
      this.blocksMap?.unobserveDeep(this.deepObserver);
      this.rootOrder?.unobserveDeep(this.deepObserver);
    }

    if (this.afterTransactionHandler !== null) {
      this.doc?.off('afterTransaction', this.afterTransactionHandler);
    }

    this.blocksMap = null;
    this.rootOrder = null;
    this.undoManager = null;
    this.doc = null;
    this.deepObserver = null;
    this.afterTransactionHandler = null;
  }

  /**
   * Cleanup on destroy.
   */
  public destroy(): void {
    this.unobserve();

    this.changeCallbacks = [];
  }
}
