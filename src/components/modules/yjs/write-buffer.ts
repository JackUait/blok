/**
 * Flush callback for one block's coalesced writes. Receives the merged
 * {key → latest value} entries buffered during the window and reports whether
 * a Yjs write actually happened — an equality-guarded flush writes nothing, and
 * a capture-clock rewind for a transaction that never existed would merge two
 * unrelated user actions into one undo entry.
 */
export type BufferedBlockWriteFlush = (entries: ReadonlyMap<string, unknown>) => boolean;

interface BlockWriteWindow {
  /** Latest buffered value per data key (last write wins). */
  pending: Map<string, unknown>;
  /** Flush callback from the most recent enqueue. */
  flush: BufferedBlockWriteFlush;
  /** Trailing-edge timer; the window NEVER extends on further enqueues. */
  timer: ReturnType<typeof setTimeout>;
  /** When the most recent enqueue happened — the time the typing it carries occurred. */
  lastEnqueueAt: number;
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
   * Called after a TRAILING dispatch that WROTE, with the typing time it
   * carries. A trailing flush lands up to `windowMs` after that typing —
   * without re-anchoring, the undo captureTimeout would measure the gap to
   * the NEXT action from the flush instead of from the typing, silently
   * merging user actions separated by more than the capture window.
   *
   * `flushAll` fires it AT MOST ONCE, for the newest typing among the windows
   * that wrote: windows are iterated in creation order, so rewinding per
   * window would leave the clock at the last-iterated one, not the newest.
   */
  private trailingFlushListener: ((lastEnqueueAt: number) => void) | null = null;

  /**
   * @param windowMs - coalescing window length (the 400ms mutation batch constant)
   */
  constructor(private readonly windowMs: number) {}

  /**
   * Register the trailing-flush listener. See `trailingFlushListener`.
   */
  public onTrailingFlush(listener: (lastEnqueueAt: number) => void): void {
    this.trailingFlushListener = listener;
  }

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
      openWindow.lastEnqueueAt = Date.now();

      return;
    }

    const timer = setTimeout(() => {
      const wroteAt = this.closeWindow(blockId);

      if (wroteAt !== null) {
        this.trailingFlushListener?.(wroteAt);
      }
    }, this.windowMs);

    this.windows.set(blockId, { pending: new Map(), flush, timer, lastEnqueueAt: Date.now() });

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

    // Windows are iterated in CREATION order, so the rewind target is the max,
    // not the last one closed. Snapshot the keys first: closeWindow deletes.
    const writeTimes = Array.from(this.windows.keys())
      .map((blockId) => this.closeWindow(blockId))
      .filter((wroteAt): wroteAt is number => wroteAt !== null);

    if (writeTimes.length > 0) {
      this.trailingFlushListener?.(Math.max(...writeTimes));
    }
  }

  /**
   * Close one block's window: cancel the timer and dispatch buffered writes.
   * @param blockId - block whose window to close
   * @returns the window's last-enqueue time when the dispatch actually wrote,
   *   otherwise null (nothing pending, or every write hit an equality guard).
   *   Callers own the rewind so `flushAll` can collapse many windows into one.
   */
  private closeWindow(blockId: string): number | null {
    const openWindow = this.windows.get(blockId);

    if (openWindow === undefined) {
      return null;
    }

    clearTimeout(openWindow.timer);
    this.windows.delete(blockId);

    if (openWindow.pending.size === 0) {
      return null;
    }

    return this.dispatch(openWindow.flush, openWindow.pending) ? openWindow.lastEnqueueAt : null;
  }

  /**
   * Run a flush callback with the re-entrancy guard held.
   * @param flush - flush callback to run
   * @param entries - merged entries to hand it
   * @returns whether the flush reported an actual Yjs write
   */
  private dispatch(flush: BufferedBlockWriteFlush, entries: ReadonlyMap<string, unknown>): boolean {
    const previous = this.isDispatching;

    this.isDispatching = true;
    try {
      return flush(entries);
    } finally {
      this.isDispatching = previous;
    }
  }
}
