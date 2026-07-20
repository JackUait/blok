/**
 * Module-level registry of Blok instances that are still booting.
 *
 * Powers the static `Blok.whenAllReady()` aggregate: every constructed
 * instance registers here and settles (resolve or reject alike) when its
 * `isReady` promise settles. Waiters are released only when the pending
 * counter reaches zero — i.e. when every instance constructed so far has
 * finished booting.
 *
 * Scope is page-global by design: the registry cannot know which instances a
 * caller cares about, and "everything currently booting" is the honest
 * collective signal (e.g. a comments composer waiting for all read-only
 * comment bodies to render before autofocusing).
 */

/**
 * Registry state: the number of registered instances whose isReady has not
 * settled yet, and the callbacks queued by whenAllReady() while that count
 * is above zero.
 */
const state = {
  pendingCount: 0,
  waiters: [] as Array<() => void>,
};

/**
 * Registers a booting instance and returns its settle callback.
 *
 * The returned function is idempotent — calling it more than once decrements
 * the counter only once. When the counter reaches zero, waiter release is
 * deferred by one microtask and the counter re-checked, so registrations made
 * in the same tick keep waiters pending instead of resolving early.
 */
export function registerPendingInstance(): () => void {
  state.pendingCount += 1;

  const instance = { settled: false };

  return (): void => {
    if (instance.settled) {
      return;
    }

    instance.settled = true;
    state.pendingCount -= 1;

    if (state.pendingCount > 0) {
      return;
    }

    void Promise.resolve().then(() => {
      // Re-check: an instance constructed after the count hit zero (but
      // before this microtask ran) keeps the aggregate pending.
      if (state.pendingCount === 0) {
        const toRelease = state.waiters.splice(0);

        toRelease.forEach((release) => release());
      }
    });
  };
}

/**
 * Resolves once every currently-registered instance has settled.
 *
 * Resolves immediately when nothing is booting. Instances constructed while
 * the returned promise is pending extend the wait; instances constructed
 * after it resolves are not covered — call again for a fresh aggregate.
 */
export function whenAllReady(): Promise<void> {
  if (state.pendingCount === 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    state.waiters.push(resolve);
  });
}
