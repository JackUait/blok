import type { DatabaseAdapter } from './types';

const UPDATE_DEBOUNCE_MS = 500;

export class DatabaseBackendSync {
  private readonly adapter: DatabaseAdapter | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingUpdates = new Map<string, Parameters<DatabaseAdapter['updateRow']>[0]>();

  constructor(adapter?: DatabaseAdapter, onError?: (error: unknown) => void) {
    this.adapter = adapter;
    this.onError = onError;
  }

  private async safeCall<T>(fn: (adapter: DatabaseAdapter) => Promise<T>): Promise<T | undefined> {
    if (this.adapter === undefined) return undefined;
    try { return await fn(this.adapter); }
    catch (error) { this.onError?.(error); return undefined; }
  }

  // ─── Row operations ───

  async syncCreateRow(params: Parameters<DatabaseAdapter['createRow']>[0]): Promise<ReturnType<DatabaseAdapter['createRow']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((a) => a.createRow(params));
  }

  syncUpdateRow(params: Parameters<DatabaseAdapter['updateRow']>[0]): void {
    if (this.adapter === undefined) return;
    const { rowId } = params;
    const existing = this.pendingTimers.get(rowId);
    if (existing !== undefined) clearTimeout(existing);
    this.pendingUpdates.set(rowId, params);
    this.pendingTimers.set(rowId, setTimeout(() => { this.flushRow(rowId); }, UPDATE_DEBOUNCE_MS));
  }

  async syncMoveRow(params: Parameters<DatabaseAdapter['moveRow']>[0]): Promise<ReturnType<DatabaseAdapter['moveRow']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((a) => a.moveRow(params));
  }

  async syncDeleteRow(params: Parameters<DatabaseAdapter['deleteRow']>[0]): Promise<void> {
    await this.safeCall((a) => a.deleteRow(params));
  }

  // ─── Property operations ───

  async syncCreateProperty(params: Parameters<DatabaseAdapter['createProperty']>[0]): Promise<ReturnType<DatabaseAdapter['createProperty']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((a) => a.createProperty(params));
  }

  async syncUpdateProperty(params: Parameters<DatabaseAdapter['updateProperty']>[0]): Promise<ReturnType<DatabaseAdapter['updateProperty']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((a) => a.updateProperty(params));
  }

  async syncDeleteProperty(params: Parameters<DatabaseAdapter['deleteProperty']>[0]): Promise<void> {
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
    for (const rowId of this.pendingTimers.keys()) { this.flushRow(rowId); }
  }

  destroy(): void {
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    this.pendingTimers.clear();
    this.pendingUpdates.clear();
  }

  private flushRow(rowId: string): void {
    const timer = this.pendingTimers.get(rowId);
    if (timer !== undefined) clearTimeout(timer);
    this.pendingTimers.delete(rowId);
    const params = this.pendingUpdates.get(rowId);
    this.pendingUpdates.delete(rowId);
    if (params !== undefined) void this.safeCall((a) => a.updateRow(params));
  }
}
