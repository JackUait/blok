import type { BlockId } from '../../../types';
import type { BlockMutationEvent, BlockMutationType } from '../../../types/events/block';
import type { ModuleConfig } from '../../types-internal/module-config';
import { Module } from '../__module';
import { modificationsObserverBatchTimeout } from '../constants';
import { BlockChanged, FakeCursorAboutToBeToggled, FakeCursorHaveBeenSet, RedactorDomChanged } from '../events';
import { isFunction } from '../utils';
import { registerUnsavedWork } from '../utils/persistence';

/**
 * We use map of block mutations to filter only unique events
 */
type UniqueBlockMutationKey = `block:${BlockId}:event:${BlockMutationType}`;

/**
 * Single entry point for Block mutation events
 */
export class ModificationsObserver extends Module {
  /**
   * Flag shows onChange event is disabled.
   *
   * Starts `true`: the observer is inert until the editor's boot sequence calls
   * `enable()` (see core.ts, right after the initial render). The `BlockChanged`
   * subscription below is live from construction, so any block mutation produced
   * by the editor's own mount-time bookkeeping (nested-block inserts during the
   * seed render, etc.) would otherwise be delivered as a spurious onChange/onSave
   * on a pristine document — arming a consumer's unsaved-changes guard before the
   * user has touched anything.
   */
  private disabled = true;

  /**
   * How many suspensions are outstanding.
   *
   * `disable()`/`enable()` nest: a host-driven rewrite takes the mutex and an
   * i18n repaint or a `blocks.render()` running inside it takes its own. Only
   * the outermost `enable()` may re-arm the observer.
   */
  private suspendDepth = 0;

  /**
   * Blocks wrapper mutation observer instance
   */
  private readonly mutationObserver: MutationObserver;

  /**
   * Holds the current batch window open. Non-null means "a window is open".
   *
   * It is nulled the instant it fires, so the next change opens a FRESH window
   * and leads it. A change arriving inside an open window never extends it:
   * extending (the classic `clearTimeout` + `setTimeout` debounce) starves the
   * callback outright during sustained typing, because every keystroke pushes
   * delivery another full window into the future.
   */
  private batchingTimeout: null | ReturnType<typeof setTimeout> = null;

  /**
   * True while a leading-edge delivery is already queued on the microtask queue.
   */
  private leadingFlushScheduled = false;

  /**
   * Set when a change enters the open window, cleared once a serialization for
   * it has STARTED. onSave cannot key off the event queue like onChange does,
   * because the leading-edge delivery drains that queue before the window
   * closes.
   *
   * Restored by {@link emitOnSave} whenever the serialization never reached the
   * host, so the edit rides the next window instead of vanishing with it.
   */
  private pendingSave = false;

  /**
   * How many serializations have started and not yet settled. The host does not
   * have those documents yet, so they still count as unsaved.
   *
   * A count, not a flag: two windows overlap whenever a change lands while the
   * previous serialization is still running, and with a flag the FIRST one to
   * settle cleared it — reporting the document clean while a serialization the
   * host never received was still outstanding.
   */
  private savesInFlight = 0;

  /**
   * Array of onChange events used to batch them
   *
   * Map is used to filter duplicated events related to the same block
   */
  private batchingOnChangeQueue = new Map<UniqueBlockMutationKey, BlockMutationEvent>();

  /**
   * Fired onChange events will be batched by this time
   */
  private readonly batchTime = modificationsObserverBatchTimeout;

  /**
   * Set once the module is destroyed so an in-flight serialization (onSave)
   * doesn't call back into a torn-down editor after its promise resolves.
   */
  private destroyed = false;

  /**
   * Re-evaluates the tab's unload prompt. Registered with the save queue, which
   * arms that prompt only once it holds a payload — so an edit still inside its
   * batch window, or a serialization still running, is invisible to it without
   * this. A no-op for an editor configured without `persistence`.
   */
  private readonly syncUnloadGuard: () => void;

  /**
   * Prepare the module
   * @param options - options used by the modification observer module
   * @param options.config - Blok configuration object
   * @param options.eventsDispatcher - common Blok event bus
   */
  constructor({ config, eventsDispatcher }: ModuleConfig) {
    super({
      config,
      eventsDispatcher,
    });

    this.syncUnloadGuard = registerUnsavedWork(this.config.persistence, () => this.hasUnsavedChanges);

    this.mutationObserver = new MutationObserver((mutations) => {
      this.redactorChanged(mutations);
    });

    this.eventsDispatcher.on(BlockChanged, (payload) => {
      this.particularBlockChanged(payload.event);
    });

    /**
     * Mutex for fake cursor setting/removing operation
     */
    this.eventsDispatcher.on(FakeCursorAboutToBeToggled, () => {
      this.disable();
    });

    this.eventsDispatcher.on(FakeCursorHaveBeenSet, () => {
      this.enable();
    });
  }

  /**
   * Whether the document holds an edit the host has not received yet: a batch
   * still waiting for its window to close, a serialization still in flight, or
   * one that never reached `onSave` — rejected, suppressed by a read-only flip,
   * or cut short by teardown.
   *
   * This is what the tab's unload guard reads to decide whether leaving loses
   * work — see the {@link registerUnsavedWork} call in the constructor, which is
   * what actually wires it to the guard.
   */
  public get hasUnsavedChanges(): boolean {
    return this.pendingSave || this.savesInFlight > 0;
  }

  /**
   * Whether onChange/onSave may reach the host right now.
   *
   * Read at DELIVERY time, never at enqueue time: a batch window and a
   * serialization both outlive the moment the edit was made, and the host can
   * freeze the document, take the observer out of service for a DOM rewrite, or
   * tear the editor down in between.
   */
  private get isDeliverySuppressed(): boolean {
    return this.destroyed || this.disabled || this.Blok.ReadOnly.isEnabled;
  }

  /**
   * Releases one suspension, re-arming onChange/onSave only once the last one is
   * gone — see {@link suspendDepth}.
   */
  public enable(): void {
    this.suspendDepth = Math.max(0, this.suspendDepth - 1);

    if (this.suspendDepth > 0) {
      return;
    }

    this.mutationObserver.observe(
      this.Blok.UI.nodes.redactor,
      {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      }
    );
    this.disabled = false;

    /**
     * The edit that opened the window before the suspension is still
     * undelivered: `disable()` cancelled its timer and nothing else arms one.
     * Without a fresh window it waits for the user's NEXT edit — and when none
     * comes, the host never receives it at all.
     */
    if (this.pendingSave && this.batchingTimeout === null) {
      this.openBatchWindow();
    }
  }

  /**
   * Throws away every undelivered change: the queued onChange events, the open
   * window and the dirty bit `enable()` would otherwise re-arm a window for.
   *
   * For a caller that REPLACES the document — `blocks.render()`. An edit still
   * waiting out its window was made against the document being replaced, so
   * saving it hands the host its own pushed document back to its save endpoint.
   * A caller that keeps the same document (the read-only toggle, an i18n
   * repaint) must NOT call this: the pending edit there is still the user's, and
   * still has to be delivered.
   */
  public discardPendingChanges(): void {
    this.pendingSave = false;
    this.batchingOnChangeQueue.clear();

    if (this.batchingTimeout !== null) {
      clearTimeout(this.batchingTimeout);
      this.batchingTimeout = null;
    }

    this.syncUnloadGuard();
  }

  /**
   * Takes onChange/onSave out of service for the caller's DOM rewrite. Nests:
   * see {@link suspendDepth}.
   */
  public disable(): void {
    this.suspendDepth += 1;
    this.mutationObserver.disconnect();
    this.disabled = true;

    /**
     * The open window has to close with the observer. `disable()` is the mutex
     * every host-driven rewrite takes (blocks.render, the read-only toggle, a
     * repaint), and a surviving timer fires INSIDE that rewrite — serializing a
     * document that is mid-clear, which is how an empty save reaches the host.
     *
     * `pendingSave` deliberately survives: the edit that opened the window was
     * made while the document was still editable, so it stays dirty and rides
     * the fresh window the outermost `enable()` opens for it.
     */
    if (this.batchingTimeout !== null) {
      clearTimeout(this.batchingTimeout);
      this.batchingTimeout = null;
    }
  }

  /**
   * Call onChange event passed to Blok configuration
   * @param event - some of our custom change events
   */
  private particularBlockChanged(event: BlockMutationEvent): void {
    if (
      this.disabled ||
      this.Blok.ReadOnly.isEnabled ||
      (!isFunction(this.config.onChange) && !isFunction(this.config.onSave))
    ) {
      return;
    }

    this.batchingOnChangeQueue.set(`block:${event.detail.target.id}:event:${event.type as BlockMutationType}`, event);
    this.pendingSave = true;
    this.syncUnloadGuard();

    /**
     * A window is already open — this change rides its trailing edge. Leaving
     * the timer alone is what bounds latency at one window: hosts drive UI off
     * onChange ("document is dirty" -> reveal the Save button), and a change
     * still sitting in the queue is indistinguishable from no change at all.
     */
    if (this.batchingTimeout !== null) {
      return;
    }

    this.scheduleLeadingFlush();

    this.openBatchWindow();
  }

  /**
   * Arms the trailing edge of a batch window.
   */
  private openBatchWindow(): void {
    this.batchingTimeout = setTimeout(() => {
      this.batchingTimeout = null;
      this.flushTrailing();
    }, this.batchTime);
  }

  /**
   * Queues the leading-edge onChange delivery for the window just opened.
   *
   * A microtask rather than a synchronous call, for two reasons: onChange must
   * not run re-entrantly inside the MutationObserver/input dispatch that
   * produced the mutation, and one tick of deferral coalesces every mutation of
   * the same task (a paste touching ten blocks) into a single delivery. It still
   * runs before the next paint, so a host revealing UI on change does it in the
   * same frame the user typed in.
   */
  private scheduleLeadingFlush(): void {
    if (this.leadingFlushScheduled) {
      return;
    }

    this.leadingFlushScheduled = true;

    void Promise.resolve().then(() => {
      this.leadingFlushScheduled = false;
      this.deliverQueuedChanges();
    });
  }

  /**
   * Closes the batch window: delivers whatever accumulated after the leading
   * edge, then serializes once for onSave.
   *
   * onSave deliberately has no leading edge — it serializes the whole document,
   * so it stays at most one serialization per window.
   */
  private flushTrailing(): void {
    this.deliverQueuedChanges();
    this.flushPendingSave();
  }

  /**
   * Serializes once for the batch that just closed, if the host can still
   * receive it.
   */
  private flushPendingSave(): void {
    if (!this.pendingSave || this.isDeliverySuppressed) {
      return;
    }

    if (!isFunction(this.config.onSave)) {
      this.pendingSave = false;
      this.syncUnloadGuard();

      return;
    }

    /**
     * Cleared as the serialization STARTS, not when it succeeds: a change
     * arriving while it is in flight re-arms the flag for its own window, and
     * clearing on success would wipe that newer edit's dirty bit. emitOnSave
     * puts the flag back whenever the data never reached the host.
     */
    this.pendingSave = false;
    this.emitOnSave();
  }

  /**
   * Hands the queued mutations to onChange and empties the queue, so a change
   * delivered on the leading edge is never redelivered when the window closes.
   */
  private deliverQueuedChanges(): void {
    /**
     * Read-only is honored at DELIVERY time, not just at enqueue: a change can
     * be queued while editable and read-only toggled on before this batch
     * fires. Consumers can therefore rely on onChange/onSave never firing in
     * read-only mode without guarding on `api.readOnly.isEnabled` themselves.
     *
     * `destroyed` and `disabled` are checked here too because a queued
     * microtask, unlike the batching timeout, cannot be cancelled.
     *
     * The queue goes, but `pendingSave` stays: suppressing the NOTIFICATION is
     * the contract, discarding the fact that the document holds an unsaved edit
     * is not — that edit was made while the document was still editable.
     */
    if (this.isDeliverySuppressed) {
      this.batchingOnChangeQueue.clear();

      return;
    }

    const queuedEvents = Array.from(this.batchingOnChangeQueue.values());

    if (queuedEvents.length === 0) {
      return;
    }

    this.batchingOnChangeQueue.clear();

    const { onChange } = this.config;

    if (isFunction(onChange)) {
      /**
       * If we have only 1 event in a queue, unwrap it
       */
      onChange(this.Blok.API.methods, queuedEvents.length === 1 ? queuedEvents[0] : queuedEvents);
    }
  }

  /**
   * Serializes the editor and delivers the full OutputData to the consumer's
   * `onSave` callback. Invoked once per batched change window, so a burst of
   * edits results in a single serialization. Skips delivery if the editor was
   * frozen, paused or destroyed while the (async) serialization was in flight,
   * and puts the document back to dirty when it does.
   */
  private emitOnSave(): void {
    this.savesInFlight += 1;

    void this.Blok.Saver.save()
      .then((data) => {
        this.savesInFlight = Math.max(0, this.savesInFlight - 1);

        /**
         * Re-checked after the await: the host can freeze or tear down the
         * document while the serialization runs. `data` is undefined when the
         * Saver swallowed a failure of its own.
         *
         * Either way the host never saw this batch, so the document goes back
         * to dirty and the next window retries it.
         */
        if (this.isDeliverySuppressed || data === undefined) {
          this.pendingSave = true;
          this.syncUnloadGuard();

          return;
        }

        const { onSave } = this.config;

        if (isFunction(onSave)) {
          onSave(data, this.Blok.API.methods);
        }

        // After onSave, never before: the queue's pump IS an onSave, so syncing
        // first would drop the guard for an instant and re-attach it — and a
        // browser that unloads in that gap asks nothing.
        this.syncUnloadGuard();
      })
      .catch(() => {
        /**
         * Serialization failed — the Saver already surfaces the error via its
         * own channel, so swallow here to avoid an unhandled rejection. The
         * batch is not swallowed with it.
         */
        this.savesInFlight = Math.max(0, this.savesInFlight - 1);
        this.pendingSave = true;
        this.syncUnloadGuard();
      });
  }

  /**
   * Cleans up the module: disconnects the MutationObserver and cancels any
   * pending batching timeout.  Called by the editor's destroy() chain so that
   * webkit (and other browsers) can close the page cleanly without the
   * MutationObserver firing on an already-destroyed instance or the pending
   * setTimeout keeping the JS engine alive.
   */
  public destroy(): void {
    if (this.batchingTimeout !== null) {
      clearTimeout(this.batchingTimeout);
      this.batchingTimeout = null;
    }

    /**
     * Before the flags below gate delivery: an edit made inside the last batch
     * window is real, and tearing the editor down must not be the thing that
     * loses it. Only the save half — the queued onChange events are dropped, as
     * they always were.
     */
    this.flushPendingSave();

    this.disabled = true;
    this.destroyed = true;
    this.mutationObserver.disconnect();

    this.batchingOnChangeQueue.clear();
  }

  /**
   * Fired on every blocks wrapper dom change
   * @param mutations - mutations happened
   */
  private redactorChanged(mutations: MutationRecord[]): void {
    this.eventsDispatcher.emit(RedactorDomChanged, {
      mutations,
    });
  }
}
