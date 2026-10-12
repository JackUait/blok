import type { BlockReplayCapture } from '../../../types/events/editor-events';
import type { DatabaseAdapter, DatabaseRow, PropertyDefinition, DatabaseViewConfig, PropertyValue } from './types';
import { adapterRowValues } from './property-values';

const UPDATE_DEBOUNCE_MS = 500;

const isReplayScalar = (value: unknown): value is string | number | boolean | null =>
  value === null || typeof value === 'string' || typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value));

const isReplayUpdateValue = (value: unknown): value is PropertyValue => {
  if (isReplayScalar(value)) return true;
  if (!Array.isArray(value)) return false;

  const entries: unknown[] = value;
  const ids = new Set<string>();
  const shapes = new Set<number>();

  for (const entry of entries) {
    if (
      typeof entry !== 'object' || entry === null || Array.isArray(entry) ||
      (Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null)
    ) return false;
    if (
      !Object.hasOwn(entry, 'id') || !('id' in entry) ||
      typeof entry.id !== 'string' || entry.id.length === 0 || ids.has(entry.id)
    ) return false;

    const keys = Object.keys(entry);

    if (keys.length !== 1 && keys.length !== 3) return false;
    if (
      keys.length === 3 &&
      (!Object.hasOwn(entry, 'name') || !Object.hasOwn(entry, 'url') ||
        !('name' in entry) || !('url' in entry) ||
        typeof entry.name !== 'string' || typeof entry.url !== 'string')
    ) return false;

    ids.add(entry.id);
    shapes.add(keys.length);
  }

  return shapes.size <= 1;
};

const getReplayProperties = (
  value: unknown,
  isValue: (entry: unknown) => entry is PropertyValue = isReplayScalar,
): Array<[string, PropertyValue]> | undefined => {
  if (
    typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) return;

  const capturedEntries: Array<[string, unknown]> = Object.entries(value);
  const entries: Array<[string, PropertyValue]> = [];

  for (const [propertyId, propertyValue] of capturedEntries) {
    if (!isValue(propertyValue)) return;
    entries.push([propertyId, propertyValue]);
  }

  return entries;
};

const getReplayCreateParams = (
  capture: BlockReplayCapture,
  rowId: string,
): Parameters<DatabaseAdapter['createRow']>[0] | undefined => {
  const native = capture.native;

  if (native === undefined) return;

  const captured: {
    properties: Array<[string, PropertyValue]> | undefined;
    position: string | undefined;
  } = { properties: undefined, position: undefined };
  const seen = new Set<string>();

  for (const change of capture.changes) {
    const key = change.path[0];

    if (
      change.path.length !== 1 || typeof key !== 'string' ||
      seen.has(key) || change.beforePresent || !change.afterPresent ||
      !Object.hasOwn(change, 'after')
    ) return;

    seen.add(key);

    if (key !== 'properties' && key !== 'position' && key !== 'template' && key !== 'title') return;

    const properties = key === 'properties' ? getReplayProperties(change.after) : undefined;

    if (key === 'properties' && properties === undefined) return;
    if (key === 'position' && typeof change.after !== 'string') return;
    if (
      key === 'template' &&
      (typeof change.after !== 'boolean' || !native.template.present ||
        change.after !== native.template.value)
    ) return;
    if (key === 'title' && typeof change.after !== 'string') return;
    if (properties !== undefined) captured.properties = properties;
    if (key === 'position' && typeof change.after === 'string') captured.position = change.after;
  }

  if (captured.properties === undefined || captured.position === undefined) return;

  return {
    id: rowId,
    properties: Object.fromEntries(captured.properties),
    position: captured.position,
    ...(native.template.present ? { template: native.template.value } : {}),
  };
};

type ReplayNative = NonNullable<BlockReplayCapture['native']>;

const sameNative = (left: ReplayNative, right: ReplayNative): boolean =>
  left.type === right.type &&
  left.parent.present === right.parent.present &&
  (!left.parent.present || !right.parent.present || left.parent.value === right.parent.value) &&
  left.template.present === right.template.present &&
  (!left.template.present || !right.template.present || left.template.value === right.template.value);

const getReplayUpdateParams = (capture: BlockReplayCapture): {
  entries: Array<[string, PropertyValue]>;
  seen: Set<string>;
  position: string | undefined;
} | undefined => {
  const entries: Array<[string, PropertyValue]> = [];
  const seen = new Set<string>();
  const captured: { position: string | undefined } = { position: undefined };

  for (const change of capture.changes) {
    if (change.afterPresent !== Object.hasOwn(change, 'after')) return;

    const propertyId = change.path.length === 2 && change.path[0] === 'properties' &&
      typeof change.path[1] === 'string' ? change.path[1] : undefined;
    const isPosition = change.path.length === 1 && change.path[0] === 'position';

    if (propertyId === undefined && !isPosition) return;
    if (propertyId !== undefined && seen.has(propertyId)) return;
    if (
      isPosition &&
      (captured.position !== undefined || !change.afterPresent || typeof change.after !== 'string')
    ) return;

    const value = change.afterPresent ? change.after : null;

    if (!isReplayUpdateValue(value)) return;
    if (propertyId !== undefined) {
      seen.add(propertyId);
      entries.push([propertyId, value]);
    }
    if (isPosition && typeof value === 'string') captured.position = value;
  }

  return { entries, seen, position: captured.position };
};

/** Replay bypasses this observer so automation does not run twice. */
export interface RowWriteObserver {
  created(params: Parameters<DatabaseAdapter['createRow']>[0]): void;
  updated(params: Parameters<DatabaseAdapter['updateRow']>[0]): void;
}

export class DatabaseBackendSync {
  private readonly adapter: DatabaseAdapter | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly observer: RowWriteObserver | undefined;
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingUpdates = new Map<string, Parameters<DatabaseAdapter['updateRow']>[0]>();
  private readonly pendingRowRecoveries = new Set<Parameters<DatabaseAdapter['updateRow']>[0]>();
  private readonly inFlightRowWrites = new Map<string, Promise<unknown>>();
  private readonly deletingRows = new Map<string, number>();
  private generation = 0;
  private readonly pendingPropertyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingPropertyUpdates = new Map<string, Parameters<DatabaseAdapter['updateProperty']>[0]>();
  private readonly heldRows: Set<string>;

  /** `heldRows` outlives this sync: the tool builds a new sync on every view switch. */
  constructor(adapter?: DatabaseAdapter, onError?: (error: unknown) => void, observer?: RowWriteObserver, heldRows = new Set<string>()) {
    this.adapter = adapter;
    this.onError = onError;
    this.observer = observer;
    this.heldRows = heldRows;
  }

  private async safeCall<T>(
    fn: (adapter: DatabaseAdapter) => Promise<T>,
    onError?: (error: unknown) => void,
  ): Promise<T | undefined> {
    if (this.adapter === undefined) return undefined;
    try { return await fn(this.adapter); }
    catch (error) { (onError ?? this.onError)?.(error); return undefined; }
  }

  // ─── Load ───

  async syncLoadDatabase(): Promise<{ schema: PropertyDefinition[]; views: DatabaseViewConfig[] } | undefined> {
    return this.safeCall((a) => a.loadDatabase());
  }

  // ─── Row operations ───

  async syncCreateRow(params: Parameters<DatabaseAdapter['createRow']>[0]): Promise<ReturnType<DatabaseAdapter['createRow']> extends Promise<infer R> ? R | undefined : never> {
    this.observer?.created(params);
    this.heldRows.add(params.id);
    return this.sendRowWrite(params.id, () => this.safeCall((a) => a.createRow(params), (error) => {
      this.heldRows.delete(params.id);
      this.onError?.(error);
    }));
  }

  syncUpdateRow(params: Parameters<DatabaseAdapter['updateRow']>[0]): void {
    this.observer?.updated(params);
    if (this.adapter === undefined || this.deletingRows.has(params.rowId)) return;
    const { rowId } = params;
    const existing = this.pendingTimers.get(rowId);
    if (existing !== undefined) clearTimeout(existing);
    const pending = this.pendingUpdates.get(rowId);
    this.pendingUpdates.set(rowId, pending === undefined ? params : { ...pending, ...params, properties: { ...pending.properties, ...params.properties } });
    this.pendingTimers.set(rowId, setTimeout(() => {
      this.pendingTimers.delete(rowId);
      this.flushRow(rowId);
    }, UPDATE_DEBOUNCE_MS));
  }

  async syncUpdateRowNow(
    params: Parameters<DatabaseAdapter['updateRow']>[0],
    onError?: (error: unknown) => void,
  ): Promise<DatabaseRow | undefined> {
    const generation = this.generation;
    const pending = this.cancelRow(params.rowId);

    for (const recovery of this.pendingRowRecoveries) {
      if (pending === undefined || recovery.rowId !== params.rowId) continue;
      recovery.properties = Object.fromEntries(
        Object.entries(recovery.properties).filter(
          ([propertyId]) => !Object.hasOwn(pending.properties, propertyId),
        ),
      );
    }

    const merged = pending === undefined
      ? params
      : { ...pending, ...params, properties: { ...pending.properties, ...params.properties } };
    const recovery = pending === undefined
      ? undefined
      : { ...pending, properties: { ...pending.properties } };

    if (recovery !== undefined) this.pendingRowRecoveries.add(recovery);

    return this.sendRowWrite(params.rowId, async () => {
      const written = await this.safeCall((adapter) => adapter.updateRow(merged), onError);

      if (
        written !== undefined || recovery === undefined || generation !== this.generation ||
        this.adapter === undefined || this.deletingRows.has(params.rowId)
      ) return written;

      const queuedProperties = Object.fromEntries(
        Object.entries(recovery.properties).filter(
          ([propertyId]) => !Object.hasOwn(params.properties, propertyId),
        ),
      );

      if (Object.keys(queuedProperties).length === 0) return written;

      const newer = this.pendingUpdates.get(params.rowId);

      this.pendingUpdates.set(params.rowId, {
        rowId: params.rowId,
        properties: { ...queuedProperties, ...newer?.properties },
      });
      if (newer === undefined) {
        this.pendingTimers.set(params.rowId, setTimeout(() => {
          this.pendingTimers.delete(params.rowId);
          this.flushRow(params.rowId);
        }, UPDATE_DEBOUNCE_MS));
      }

      return written;
    }).finally(() => {
      if (recovery !== undefined) this.pendingRowRecoveries.delete(recovery);
    });
  }

  async syncMoveRow(params: Parameters<DatabaseAdapter['moveRow']>[0]): Promise<ReturnType<DatabaseAdapter['moveRow']> extends Promise<infer R> ? R | undefined : never> {
    return this.sendRowWrite(params.rowId, async () => {
      const pending = this.cancelRow(params.rowId);

      if (pending !== undefined) await this.safeCall((a) => a.updateRow(pending));
      return this.safeCall((a) => a.moveRow(params));
    });
  }

  /** `schema` is the owning database's: writes keep only its writable properties. */
  syncReplayRow(capture: BlockReplayCapture, schema?: readonly PropertyDefinition[]): void {
    if (
      (capture.origin !== 'undo' && capture.origin !== 'redo') ||
      capture.scope !== 'keys' ||
      capture.native?.type !== 'database-row'
    ) return;

    const rowId = capture.blockId;

    if (capture.type === 'remove') {
      if (capture.changes.length > 0) return;
      void this.syncDeleteRow({ rowId });
      return;
    }

    if (capture.type === 'add') {
      const captured = getReplayCreateParams(capture, rowId);

      if (captured === undefined) return;
      // A create is cleaned, never skipped: a skipped create leaves the row out of the backend for good.
      const params = { ...captured, properties: adapterRowValues(captured.properties, schema).properties };

      this.cancelRow(rowId);
      void this.sendRowWrite(
        rowId,
        () => this.safeCall((adapter) => adapter.createRow(params)),
        true,
      );
      return;
    }

    const parsed = getReplayUpdateParams(capture);

    if (parsed === undefined) return;

    const { entries, seen, position } = parsed;
    const safe = adapterRowValues(Object.fromEntries(entries), schema);

    if (safe.altered) return;
    const { properties } = safe;
    const sending = Object.keys(properties).length > 0;

    if (sending) this.pruneReplayRow(rowId, properties, seen);

    const updateParams = sending ? { rowId, properties } : undefined;
    const moveParams = position === undefined ? undefined : { rowId, position };

    if (updateParams === undefined && moveParams === undefined) return;

    void this.sendRowWrite(rowId, async () => {
      const updated = updateParams === undefined
        ? undefined
        : await this.safeCall((adapter) => adapter.updateRow(updateParams));

      return moveParams === undefined
        ? updated
        : this.safeCall((adapter) => adapter.moveRow(moveParams));
    }, true);
  }

  /**
   * Undo or redo moved a row between databases. Its old owner deletes it, its
   * new owner creates it from the receipt. Both go through the row queue, so
   * each one waits for the forward move's write still in flight.
   */
  /** The new owner's createRow for a relocation receipt, or undefined when the receipt is not usable. */
  relocationCreateParams(
    capture: BlockReplayCapture,
    schema?: readonly PropertyDefinition[],
  ): Parameters<DatabaseAdapter['createRow']>[0] | undefined {
    const { native, relocation } = capture;

    if (
      (capture.origin !== 'undo' && capture.origin !== 'redo') ||
      native?.type !== 'database-row' || relocation === undefined ||
      !sameNative(relocation.after, native) || relocation.before.type !== native.type ||
      !relocation.before.parent.present || !relocation.after.parent.present ||
      relocation.before.parent.value === relocation.after.parent.value
    ) return undefined;

    const properties = getReplayProperties(relocation.row.properties, isReplayUpdateValue);

    if (properties === undefined || typeof relocation.row.position !== 'string') return undefined;
    const safe = adapterRowValues(Object.fromEntries(properties), schema);

    if (safe.altered) return undefined;

    return {
      id: capture.blockId,
      properties: safe.properties,
      position: relocation.row.position,
      ...(native.template.present ? { template: native.template.value } : {}),
    };
  }

  /** Creates a relocated row without telling the observer, so pageAdded does not fire. */
  createRelocatedRow(params: Parameters<DatabaseAdapter['createRow']>[0]): void {
    this.heldRows.add(params.id);
    this.cancelRow(params.id);
    void this.sendRowWrite(params.id, () => this.safeCall((adapter) => adapter.createRow(params), (error) => {
      this.heldRows.delete(params.id);
      this.onError?.(error);
    }), true);
  }

  holdsRow(rowId: string): boolean {
    return this.heldRows.has(rowId);
  }

  private pruneReplayRow(
    rowId: string,
    properties: Parameters<DatabaseAdapter['updateRow']>[0]['properties'],
    seen: ReadonlySet<string>,
  ): void {
    for (const recovery of this.pendingRowRecoveries) {
      if (recovery.rowId !== rowId) continue;
      for (const propertyId of seen) Reflect.deleteProperty(recovery.properties, propertyId);
    }

    const pending = this.pendingUpdates.get(rowId);

    if (pending === undefined) return;

    const remaining = Object.fromEntries(
      Object.entries(pending.properties).filter(
        ([propertyId]) => !Object.hasOwn(properties, propertyId),
      ),
    );

    if (Object.keys(remaining).length === 0) this.cancelRow(rowId);
    else this.pendingUpdates.set(rowId, { ...pending, properties: remaining });
  }

  async syncDeleteRow(params: Parameters<DatabaseAdapter['deleteRow']>[0]): Promise<void> {
    const { rowId } = params;

    this.heldRows.delete(rowId);
    this.cancelRow(rowId);
    this.deletingRows.set(rowId, (this.deletingRows.get(rowId) ?? 0) + 1);

    try {
      await this.sendRowWrite(
        rowId,
        () => this.safeCall((adapter) => adapter.deleteRow(params), (error) => {
          this.heldRows.add(rowId);
          this.onError?.(error);
        }),
        true,
      );
    } finally {
      const remaining = (this.deletingRows.get(rowId) ?? 1) - 1;

      if (remaining === 0) this.deletingRows.delete(rowId);
      else this.deletingRows.set(rowId, remaining);
    }
  }

  // ─── Property operations ───

  async syncCreateProperty(params: Parameters<DatabaseAdapter['createProperty']>[0]): Promise<ReturnType<DatabaseAdapter['createProperty']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((a) => a.createProperty(params));
  }

  async syncUpdateProperty(params: Parameters<DatabaseAdapter['updateProperty']>[0]): Promise<ReturnType<DatabaseAdapter['updateProperty']> extends Promise<infer R> ? R | undefined : never> {
    // An immediate write must not be overtaken by an older debounced one.
    // `changes` carries whole arrays (the full option list), so the pending
    // snapshot is stale wherever the two overlap: drain it and let this call's
    // fields win, instead of flushing it separately and losing what is newer.
    const pending = this.cancelProperty(params.propertyId);
    const merged = pending === undefined
      ? params
      : { ...pending, ...params, changes: { ...pending.changes, ...params.changes } };

    return this.safeCall((a) => a.updateProperty(merged));
  }

  syncUpdatePropertyDebounced(params: Parameters<DatabaseAdapter['updateProperty']>[0]): void {
    if (this.adapter === undefined) return;
    const { propertyId } = params;
    const existing = this.pendingPropertyTimers.get(propertyId);
    if (existing !== undefined) clearTimeout(existing);
    this.pendingPropertyUpdates.set(propertyId, params);
    this.pendingPropertyTimers.set(
      propertyId,
      setTimeout(() => { this.flushProperty(propertyId); }, UPDATE_DEBOUNCE_MS),
    );
  }

  async syncDeleteProperty(params: Parameters<DatabaseAdapter['deleteProperty']>[0]): Promise<void> {
    this.cancelProperty(params.propertyId);

    await this.safeCall((a) => a.deleteProperty(params));
  }

  // ─── View operations ───

  async syncCreateView(params: Parameters<DatabaseAdapter['createView']>[0]): Promise<ReturnType<DatabaseAdapter['createView']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((a) => a.createView(params));
  }

  async syncUpdateView(params: Parameters<DatabaseAdapter['updateView']>[0]): Promise<ReturnType<DatabaseAdapter['updateView']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((a) => a.updateView(params));
  }

  async syncDeleteView(params: Parameters<DatabaseAdapter['deleteView']>[0]): Promise<void> {
    await this.safeCall((a) => a.deleteView(params));
  }

  // ─── Flush & destroy ───

  flushPendingUpdates(): void {
    for (const rowId of this.pendingUpdates.keys()) { this.flushRow(rowId, true); }
  }

  flushPendingPropertyUpdates(): void {
    for (const propertyId of this.pendingPropertyTimers.keys()) { this.flushProperty(propertyId); }
  }

  destroy(): void {
    this.generation += 1;
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.pendingTimers.clear();
    this.pendingUpdates.clear();
    this.pendingRowRecoveries.clear();
    for (const timer of this.pendingPropertyTimers.values()) clearTimeout(timer);
    this.pendingPropertyTimers.clear();
    this.pendingPropertyUpdates.clear();
  }

  private sendRowWrite<T>(
    rowId: string,
    run: () => Promise<T>,
    allowWhileDeleting = false,
  ): Promise<T | undefined> {
    if (!allowWhileDeleting && this.deletingRows.has(rowId)) return Promise.resolve(undefined);
    const previous = this.inFlightRowWrites.get(rowId);
    const startWrite: { run?: () => void } = {};
    const write = new Promise<T>((resolve, reject) => {
      startWrite.run = () => {
        void (async () => {
          if (previous !== undefined) await previous;
          return run();
        })().then(resolve, reject);
      };
    });
    const tracked = write.finally(() => {
      if (this.inFlightRowWrites.get(rowId) !== tracked) return;
      this.inFlightRowWrites.delete(rowId);
      if (this.pendingUpdates.has(rowId) && !this.pendingTimers.has(rowId)) {
        this.flushRow(rowId);
      }
    });

    this.inFlightRowWrites.set(rowId, tracked);
    startWrite.run?.();
    return tracked;
  }

  private flushRow(rowId: string, includeInFlight = false): void {
    if (!includeInFlight && this.inFlightRowWrites.has(rowId)) return;
    const params = this.cancelRow(rowId);

    if (params === undefined) return;

    for (const recovery of this.pendingRowRecoveries) {
      if (recovery.rowId !== rowId) continue;
      recovery.properties = Object.fromEntries(
        Object.entries(recovery.properties).filter(
          ([propertyId]) => !Object.hasOwn(params.properties, propertyId),
        ),
      );
    }

    void this.sendRowWrite(rowId, () => this.safeCall((a) => a.updateRow(params)));
  }

  private flushProperty(propertyId: string): void {
    const params = this.cancelProperty(propertyId);

    if (params !== undefined) void this.safeCall((a) => a.updateProperty(params));
  }

  /** Drops the row's pending write and returns it, sending nothing. */
  private cancelRow(rowId: string): Parameters<DatabaseAdapter['updateRow']>[0] | undefined {
    const timer = this.pendingTimers.get(rowId);
    if (timer !== undefined) clearTimeout(timer);
    this.pendingTimers.delete(rowId);
    const params = this.pendingUpdates.get(rowId);
    this.pendingUpdates.delete(rowId);

    return params;
  }

  /** Drops the property's pending write and returns it, sending nothing. */
  private cancelProperty(propertyId: string): Parameters<DatabaseAdapter['updateProperty']>[0] | undefined {
    const timer = this.pendingPropertyTimers.get(propertyId);
    if (timer !== undefined) clearTimeout(timer);
    this.pendingPropertyTimers.delete(propertyId);
    const params = this.pendingPropertyUpdates.get(propertyId);
    this.pendingPropertyUpdates.delete(propertyId);

    return params;
  }
}
