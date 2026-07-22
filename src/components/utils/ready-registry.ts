/**
 * Module-level registry of live Blok instances and their readiness.
 *
 * Powers the static `Blok.whenAllReady()` / `Blok.readyState()` /
 * `Blok.subscribeReady()` trio. Every constructed instance registers here,
 * flips to "booted" when its `isReady` settles (resolve or reject alike) and
 * unregisters on `destroy()`.
 *
 * Two axes make the aggregate answer a caller's real question:
 *
 * - **Scope** (`within`): only instances whose wrapper is a DOM descendant of
 *   the given element count. A comments list can wait for its own bodies
 *   without an unrelated editor in an open drawer holding it back.
 * - **Depth** (`settleOn`): `'ready'` waits for construction to finish;
 *   `'rendered'` additionally waits for content to be in the DOM, which
 *   re-arms on every post-boot re-render (`editor.render(data)`) instead of
 *   latching once at boot.
 *
 * Entries are held until `destroy()` runs — the same contract that frees the
 * instance's listeners and DOM. Entries are never pruned on detachment: a
 * wrapper can leave and re-enter the document (StrictMode remounts, tab
 * switches) while the instance stays live, and dropping it would silently stop
 * tracking an editor a scoped wait must still cover.
 */

import { DATA_ATTR } from '../constants';

/** How deep a readiness query looks: boot completion, or content in the DOM. */
export type ReadySettleOn = 'ready' | 'rendered';

/** Narrows a readiness query to a DOM subtree and a readiness depth. */
export interface ReadyScopeOptions {
  /** Only count instances whose wrapper lives inside this element. */
  within?: Element | null;
  /** Readiness depth. Defaults to `'ready'`. */
  settleOn?: ReadySettleOn;
}

/** Synchronous readiness snapshot for a scope. */
export interface ReadyStateSnapshot {
  /** Instances matching the scope. */
  total: number;
  /** Matching instances that are not settled yet. */
  pending: number;
  /** True when nothing in the scope is pending (an empty scope is settled). */
  ready: boolean;
}

/** One registered instance. */
interface RegistryEntry {
  /** True once the instance's `isReady` has settled. */
  booted: boolean;
  /** Late-bound wrapper lookup — the UI module does not exist at construction. */
  getWrapper: () => HTMLElement | undefined;
  /** Watches the wrapper's render-readiness attribute once booted. */
  observer: MutationObserver | null;
}

/** A pending `whenAllReady()` call and the scope it asked about. */
interface Waiter {
  options: ReadyScopeOptions;
  resolve: () => void;
}

const entries = new Map<unknown, RegistryEntry>();
const waiters: Waiter[] = [];
const listeners = new Set<() => void>();
const scheduler = { queued: false };

/**
 * Decides whether an entry participates in a scoped query.
 * @param entry - registered instance under test
 * @param within - scope element, or null for the page-global scope
 */
function isInScope(entry: RegistryEntry, within: Element | null): boolean {
  if (within === null) {
    return true;
  }

  const wrapper = entry.getWrapper();

  /**
   * LAW — over-wait, never under-wait. An instance that has not finished
   * booting *and* whose wrapper is not attached to the document counts in
   * EVERY scope: the React adapter builds the holder detached and only
   * `BlokContent` appends it, so this instance may still turn out to live
   * inside `within`. Without this branch a scoped wait can resolve before its
   * own children register — precisely the bug scoped readiness exists to
   * prevent. Do not "optimise" it away as dead code.
   */
  if (!entry.booted && (wrapper === undefined || !wrapper.isConnected)) {
    return true;
  }

  if (wrapper === undefined) {
    return false;
  }

  return within.contains(wrapper);
}

/**
 * Decides whether an entry is settled at the requested depth.
 * @param entry - registered instance under test
 * @param settleOn - readiness depth
 */
function isEntrySettled(entry: RegistryEntry, settleOn: ReadySettleOn): boolean {
  if (!entry.booted) {
    return false;
  }

  if (settleOn !== 'rendered') {
    return true;
  }

  const wrapper = entry.getWrapper();

  return wrapper !== undefined && wrapper.hasAttribute(DATA_ATTR.rendered);
}

/**
 * Synchronous readiness snapshot for the given scope.
 *
 * An empty scope is a settled scope: `total === 0` reports `ready: true`, so
 * callers need no hand-written "nothing to wait for" special case.
 * @param options - scope and readiness depth
 */
export function readyState(options: ReadyScopeOptions = {}): ReadyStateSnapshot {
  const within = options.within ?? null;
  const settleOn = options.settleOn ?? 'ready';

  const inScope = [ ...entries.values() ].filter((entry) => isInScope(entry, within));
  const pending = inScope.filter((entry) => !isEntrySettled(entry, settleOn)).length;

  return {
    total: inScope.length,
    pending,
    ready: pending === 0,
  };
}

/**
 * Releases satisfied waiters and pings subscribers.
 *
 * Deferred by one microtask and coalesced, so an instance constructed in the
 * same tick as the last settle (a `.then()` continuation of the settling
 * instance's `isReady`) is seen before waiters are released.
 */
function notify(): void {
  if (scheduler.queued) {
    return;
  }

  scheduler.queued = true;

  void Promise.resolve().then(() => {
    scheduler.queued = false;

    const released = waiters.filter((waiter) => readyState(waiter.options).ready);

    if (released.length > 0) {
      const stillWaiting = waiters.filter((waiter) => !released.includes(waiter));

      waiters.splice(0, waiters.length, ...stillWaiting);
      released.forEach((waiter) => waiter.resolve());
    }

    [ ...listeners ].forEach((listener) => listener());
  });
}

/**
 * Watches the wrapper's render-readiness attribute so `'rendered'` queries and
 * subscribers react to post-boot re-renders. Returns null when there is
 * nothing to watch.
 * @param wrapper - the booted instance's UI wrapper element
 */
function createRenderStateObserver(wrapper: HTMLElement | undefined): MutationObserver | null {
  if (wrapper === undefined || typeof MutationObserver === 'undefined') {
    return null;
  }

  const observer = new MutationObserver(() => notify());

  observer.observe(wrapper, {
    attributes: true,
    attributeFilter: [ DATA_ATTR.rendered ],
  });

  return observer;
}

/**
 * Registers a booting instance and returns its settle callback.
 *
 * The returned function is idempotent — a second call is a no-op.
 * @param instance - key object identifying the instance (the Blok facade)
 * @param getWrapper - late-bound lookup of the instance's UI wrapper element
 */
export function registerInstance(instance: unknown, getWrapper: () => HTMLElement | undefined): () => void {
  entries.set(instance, {
    booted: false,
    getWrapper,
    observer: null,
  });

  notify();

  return (): void => {
    const entry = entries.get(instance);

    if (entry === undefined || entry.booted) {
      return;
    }

    entries.set(instance, {
      ...entry,
      booted: true,
      observer: createRenderStateObserver(entry.getWrapper()),
    });

    notify();
  };
}

/**
 * Drops a destroyed instance so it stops holding aggregates back.
 * @param instance - key object the instance registered with
 */
export function unregisterInstance(instance: unknown): void {
  const entry = entries.get(instance);

  if (entry === undefined) {
    return;
  }

  entry.observer?.disconnect();
  entries.delete(instance);

  notify();
}

/**
 * Resolves once every instance in the given scope is settled at the requested
 * depth. Instances that appear while the promise is pending extend the wait.
 * @param options - scope and readiness depth
 */
export function whenAllReady(options: ReadyScopeOptions = {}): Promise<void> {
  if (readyState(options).ready) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    waiters.push({
      options,
      resolve,
    });
  });
}

/**
 * Subscribes to registry changes (construction, boot, render-state flip,
 * destroy). The listener takes no arguments — re-read `readyState()` for the
 * scope you care about. Returns an unsubscribe function.
 * @param listener - called after every registry change
 */
export function subscribeReady(listener: () => void): () => void {
  listeners.add(listener);

  return (): void => {
    listeners.delete(listener);
  };
}
