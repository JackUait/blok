/**
 * Flush callback for one block's coalesced writes. Receives the merged
 * {key → latest value} entries buffered during the window.
 */
export type BufferedBlockWriteFlush = (entries: ReadonlyMap<string, unknown>) => void;

interface BlockWriteWindow {
  /** Latest buffered value per data key (last write wins). */
  pending: Map<string, unknown>;
  /** Flush callback from the most recent enqueue. */
  flush: BufferedBlockWriteFlush;
  /** Trailing-edge timer; the window NEVER extends on further enqueues. */
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Per-block value buffer that coalesces typing-driven Yjs writes.
 *
 * Leading + trailing window: the first write of an idle block dispatches
 * immediately (preserving today's undo captureTimeout anchor and caret-listener
 * timing); follow-up writes within `windowMs` merge into a pending map that a
 * single trailing flush dispatches. Net: at most 2 transactions per window.
 *
 * `flushAll()` is the barrier entry point — every structural chokepoint
 * (undo/redo/stopCapturing, block CRUD, serialization, destroy) drains the
 * buffer synchronously at its start. Because enqueues only ever arrive from
 * async `block.save()` resolutions between events, the buffer is empty during
 * any synchronous structural flow — that invariant is what makes stale writes
 * against moved/removed/replaced blocks structurally impossible.
 */
export class BlockWriteBuffer {
  private readonly windows = new Map<string, BlockWriteWindow>();

  /**
   * True while a flush callback runs. Flush bodies wrap their writes in the
   * (barrier-guarded) public transact, so `flushAll` must be a no-op during a
   * dispatch — otherwise a LEADING dispatch would drain (and close) its own
   * freshly opened window and kill coalescing entirely.
   */
  private isDispatching = false;

  /**
   * @param windowMs - coalescing window length (the 400ms mutation batch constant)
   */
  constructor(private readonly windowMs: number) {}

  /**
   * Buffer one block's {key → value} writes.
   * Idle block: opens a window and dispatches immediately (leading edge).
   * Open window: merges into pending for the trailing flush.
   * @param blockId - block whose data is being written
   * @param data - saved data entries from block.save()
   * @param flush - callback that performs the actual Yjs writes
   */
  public enqueue(blockId: string, data: Record<string, unknown>, flush: BufferedBlockWriteFlush): void {
    const openWindow = this.windows.get(blockId);

    if (openWindow !== undefined) {
      for (const [key, value] of Object.entries(data)) {
        openWindow.pending.set(key, value);
      }
      openWindow.flush = flush;

      return;
    }

    const timer = setTimeout(() => this.closeWindow(blockId), this.windowMs);

    this.windows.set(blockId, { pending: new Map(), flush, timer });

    this.dispatch(flush, new Map(Object.entries(data)));
  }

  /**
   * Barrier: synchronously drain every open window (dispatching non-empty
   * pendings) and cancel their timers. No-op while a dispatch is in flight —
   * the in-flight dispatch IS the flush the nested barrier would perform.
   */
  public flushAll(): void {
    if (this.isDispatching) {
      return;
    }

    for (const blockId of Array.from(this.windows.keys())) {
      this.closeWindow(blockId);
    }
  }

  /**
   * Close one block's window: cancel the timer and dispatch buffered writes.
   * @param blockId - block whose window to close
   */
  private closeWindow(blockId: string): void {
    const openWindow = this.windows.get(blockId);

    if (openWindow === undefined) {
      return;
    }

    clearTimeout(openWindow.timer);
    this.windows.delete(blockId);

    if (openWindow.pending.size > 0) {
      this.dispatch(openWindow.flush, openWindow.pending);
    }
  }

  /**
   * Run a flush callback with the re-entrancy guard held.
   * @param flush - flush callback to run
   * @param entries - merged entries to hand it
   */
  private dispatch(flush: BufferedBlockWriteFlush, entries: ReadonlyMap<string, unknown>): void {
    const previous = this.isDispatching;

    this.isDispatching = true;
    try {
      flush(entries);
    } finally {
      this.isDispatching = previous;
    }
  }
}
