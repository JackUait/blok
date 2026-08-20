import type { BlockId } from '../../../types';
import type { BlockMutationEvent, BlockMutationType } from '../../../types/events/block';
import type { ModuleConfig } from '../../types-internal/module-config';
import { Module } from '../__module';
import { modificationsObserverBatchTimeout } from '../constants';
import { BlockChanged, FakeCursorAboutToBeToggled, FakeCursorHaveBeenSet, RedactorDomChanged } from '../events';
import { isFunction } from '../utils';

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
   * Set when a change enters the open window, cleared once onSave has seen it.
   * onSave cannot key off the event queue like onChange does, because the
   * leading-edge delivery drains that queue before the window closes.
   */
  private pendingSave = false;

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
   * Enables onChange event
   */
  public enable(): void {
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
  }

  /**
   * Disables onChange event
   */
  public disable(): void {
    this.mutationObserver.disconnect();
    this.disabled = true;
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

    if (!this.pendingSave) {
      return;
    }

    this.pendingSave = false;

    if (isFunction(this.config.onSave)) {
      this.emitOnSave();
    }
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
     * `destroyed` is checked here too because a queued microtask, unlike the
     * batching timeout, cannot be cancelled by destroy().
     */
    if (this.destroyed || this.Blok.ReadOnly.isEnabled) {
      this.batchingOnChangeQueue.clear();
      this.pendingSave = false;

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
   * edits results in a single serialization. Skips delivery if the module was
   * destroyed while the (async) serialization was in flight.
   */
  private emitOnSave(): void {
    void this.Blok.Saver.save()
      .then((data) => {
        if (this.destroyed || data === undefined) {
          return;
        }

        const { onSave } = this.config;

        if (isFunction(onSave)) {
          onSave(data, this.Blok.API.methods);
        }
      })
      .catch(() => {
        /**
         * Serialization failed — the Saver already surfaces the error via its
         * own channel, so swallow here to avoid an unhandled rejection.
         */
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
    this.disabled = true;
    this.destroyed = true;
    this.mutationObserver.disconnect();

    if (this.batchingTimeout !== null) {
      clearTimeout(this.batchingTimeout);
      this.batchingTimeout = null;
    }

    this.batchingOnChangeQueue.clear();
    this.pendingSave = false;
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
