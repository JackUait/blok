import type { KanbanAdapter, KanbanCardData } from './types';

/**
 * Debounce delay for card text updates (ms).
 */
const UPDATE_DEBOUNCE_MS = 500;

/**
 * Orchestrates communication between the DatabaseTool and an optional KanbanAdapter.
 *
 * - Immediate sync for discrete actions (drag, create, delete)
 * - Debounced sync for text edits (title changes at 500ms)
 * - No-adapter mode: all methods are silent no-ops
 */
export class DatabaseBackendSync {
  private readonly adapter: KanbanAdapter | undefined;
  private readonly onError: ((error: unknown) => void) | undefined;

  /**
   * Map of cardId → pending debounce timer for updateCard calls.
   */
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Map of cardId → latest params for a pending updateCard call.
   */
  private readonly pendingUpdates = new Map<string, Parameters<KanbanAdapter['updateCard']>[0]>();

  constructor(adapter?: KanbanAdapter, onError?: (error: unknown) => void) {
    this.adapter = adapter;
    this.onError = onError;
  }

  /**
   * Safe wrapper: if no adapter, returns undefined. If adapter throws, calls onError.
   */
  private async safeCall<T>(fn: (adapter: KanbanAdapter) => Promise<T>): Promise<T | undefined> {
    if (this.adapter === undefined) {
      return undefined;
    }

    try {
      return await fn(this.adapter);
    } catch (error) {
      this.onError?.(error);

      return undefined;
    }
  }

  async syncMoveCard(params: Parameters<KanbanAdapter['moveCard']>[0]): Promise<KanbanCardData | undefined> {
    return this.safeCall((adapter) => adapter.moveCard(params));
  }

  async syncCreateCard(params: Parameters<KanbanAdapter['createCard']>[0]): Promise<KanbanCardData | undefined> {
    return this.safeCall((adapter) => adapter.createCard(params));
  }

  async syncDeleteCard(params: Parameters<KanbanAdapter['deleteCard']>[0]): Promise<void> {
    await this.safeCall((adapter) => adapter.deleteCard(params));
  }

  async syncCreateColumn(params: Parameters<KanbanAdapter['createColumn']>[0]): Promise<ReturnType<KanbanAdapter['createColumn']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((adapter) => adapter.createColumn(params));
  }

  async syncUpdateColumn(params: Parameters<KanbanAdapter['updateColumn']>[0]): Promise<ReturnType<KanbanAdapter['updateColumn']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((adapter) => adapter.updateColumn(params));
  }

  async syncMoveColumn(params: Parameters<KanbanAdapter['moveColumn']>[0]): Promise<ReturnType<KanbanAdapter['moveColumn']> extends Promise<infer R> ? R | undefined : never> {
    return this.safeCall((adapter) => adapter.moveColumn(params));
  }

  async syncDeleteColumn(params: Parameters<KanbanAdapter['deleteColumn']>[0]): Promise<void> {
    await this.safeCall((adapter) => adapter.deleteColumn(params));
  }

  /**
   * Debounced card update. Multiple calls for the same cardId within 500ms
   * are coalesced — only the last set of params is sent.
   */
  syncUpdateCard(params: Parameters<KanbanAdapter['updateCard']>[0]): void {
    if (this.adapter === undefined) {
      return;
    }

    const { cardId } = params;

    const existingTimer = this.pendingTimers.get(cardId);

    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    this.pendingUpdates.set(cardId, params);

    const timer = setTimeout(() => {
      this.flushCard(cardId);
    }, UPDATE_DEBOUNCE_MS);

    this.pendingTimers.set(cardId, timer);
  }

  /**
   * Flush all pending debounced updates immediately.
   */
  flushPendingUpdates(): void {
    for (const cardId of this.pendingTimers.keys()) {
      this.flushCard(cardId);
    }
  }

  /**
   * Clear all pending timers. Call on teardown.
   */
  destroy(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
    this.pendingUpdates.clear();
  }

  /**
   * Flush a single card's pending update.
   */
  private flushCard(cardId: string): void {
    const timer = this.pendingTimers.get(cardId);

    if (timer !== undefined) {
      clearTimeout(timer);
    }

    this.pendingTimers.delete(cardId);

    const params = this.pendingUpdates.get(cardId);

    this.pendingUpdates.delete(cardId);

    if (params !== undefined) {
      void this.safeCall((adapter) => adapter.updateCard(params));
    }
  }
}
