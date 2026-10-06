import type { DatabaseAdapter, DatabaseRow, PropertyDefinition, DatabaseViewConfig } from './types';

const UPDATE_DEBOUNCE_MS = 500;

export class DatabaseBackendSync {
  private readonly adapter: DatabaseAdapter | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingUpdates = new Map<string, Parameters<DatabaseAdapter['updateRow']>[0]>();
  private readonly inFlightRowWrites = new Map<string, Promise<DatabaseRow | undefined>>();
  private readonly deletingRows = new Set<string>();
  private generation = 0;
  private readonly pendingPropertyTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingPropertyUpdates = new Map<string, Parameters<DatabaseAdapter['updateProperty']>[0]>();

  constructor(adapter?: DatabaseAdapter, onError?: (error: unknown) => void) {
    this.adapter = adapter;
    this.onError = onError;
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
    return this.sendRowWrite(params.id, () => this.safeCall((a) => a.createRow(params)));
  }

  syncUpdateRow(params: Parameters<DatabaseAdapter['updateRow']>[0]): void {
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
    const merged = pending === undefined
      ? params
      : { ...pending, ...params, properties: { ...pending.properties, ...params.properties } };

    return this.sendRowWrite(params.rowId, async () => {
      const written = await this.safeCall((adapter) => adapter.updateRow(merged), onError);

      if (written === undefined && pending !== undefined && generation === this.generation) {
        const queuedProperties = Object.fromEntries(
          Object.entries(pending.properties).filter(
            ([propertyId]) => !Object.prototype.hasOwnProperty.call(params.properties, propertyId),
          ),
        );
        if (Object.keys(queuedProperties).length > 0) {
          const newer = this.cancelRow(params.rowId);

          this.syncUpdateRow({
            rowId: params.rowId,
            properties: { ...queuedProperties, ...newer?.properties },
          });
        }
      }

      return written;
    });
  }

  async syncMoveRow(params: Parameters<DatabaseAdapter['moveRow']>[0]): Promise<ReturnType<DatabaseAdapter['moveRow']> extends Promise<infer R> ? R | undefined : never> {
    return this.sendRowWrite(params.rowId, async () => {
      const pending = this.cancelRow(params.rowId);

      if (pending !== undefined) await this.safeCall((a) => a.updateRow(pending));
      return this.safeCall((a) => a.moveRow(params));
    });
  }

  async syncDeleteRow(params: Parameters<DatabaseAdapter['deleteRow']>[0]): Promise<void> {
    // A delete supersedes anything still waiting for this row. Leaving the
    // timer armed lets the pending update land after the delete, which an
    // upserting backend turns back into a row the user deleted.
    this.cancelRow(params.rowId);
    while (true) {
      const inFlight = this.inFlightRowWrites.get(params.rowId);

      if (inFlight === undefined) break;
      await inFlight;
    }
    this.cancelRow(params.rowId);
    this.deletingRows.add(params.rowId);
    try {
      await this.safeCall((a) => a.deleteRow(params));
    } finally {
      this.deletingRows.delete(params.rowId);
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
    for (const timer of this.pendingPropertyTimers.values()) clearTimeout(timer);
    this.pendingPropertyTimers.clear();
    this.pendingPropertyUpdates.clear();
  }

  private sendRowWrite(rowId: string, run: () => Promise<DatabaseRow | undefined>): Promise<DatabaseRow | undefined> {
    if (this.deletingRows.has(rowId)) return Promise.resolve(undefined);
    const previous = this.inFlightRowWrites.get(rowId);
    const write = (async () => {
      if (previous !== undefined) await previous;
      return run();
    })();
    const tracked = write.finally(() => {
      if (this.inFlightRowWrites.get(rowId) !== tracked) return;
      this.inFlightRowWrites.delete(rowId);
      if (this.pendingUpdates.has(rowId) && !this.pendingTimers.has(rowId)) {
        this.pendingTimers.set(rowId, setTimeout(() => {
          this.pendingTimers.delete(rowId);
          this.flushRow(rowId);
        }, UPDATE_DEBOUNCE_MS));
      }
    });

    this.inFlightRowWrites.set(rowId, tracked);
    return tracked;
  }

  private flushRow(rowId: string, includeInFlight = false): void {
    if (!includeInFlight && this.inFlightRowWrites.has(rowId)) return;
    const params = this.cancelRow(rowId);

    if (params !== undefined) void this.sendRowWrite(rowId, () => this.safeCall((a) => a.updateRow(params)));
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
