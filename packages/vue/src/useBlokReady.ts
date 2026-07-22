// packages/vue/src/useBlokReady.ts
import {
  onMounted,
  onScopeDispose,
  shallowRef,
  toValue,
  type MaybeRefOrGetter,
  type ShallowRef,
} from 'vue';

import { Blok as BlokRuntime } from '@bloklabs/core';

/** Options accepted by {@link useBlokReady}. */
export interface UseBlokReadyOptions {
  /**
   * Restrict the wait to editors mounted inside this element. Accepts the
   * template ref you already hold on the container (or a getter); it is
   * re-read on every readiness change, so a ref that fills in on mount is
   * picked up.
   *
   * Omit it to observe every editor on the page. Passing it while it still
   * resolves to null reports NOT ready — an unresolved scope must never fall
   * back to the page-global one.
   */
  within?: MaybeRefOrGetter<Element | null | undefined>;
  /**
   * `'ready'` (default) settles when each editor has finished booting.
   * `'rendered'` also waits for its content to be in the DOM and re-arms on
   * every post-boot re-render.
   */
  settleOn?: 'ready' | 'rendered';
}

/**
 * Vue composable exposing the live readiness of the Blok editors in a DOM
 * scope as a boolean ref.
 *
 * The readiness logic itself is framework-agnostic and lives in core
 * (`Blok.readyState` / `Blok.subscribeReady`) — the SAME implementation behind
 * React's `useBlokReady` and Angular's `injectBlokReady`, so the three adapters
 * cannot drift. This composable supplies only Vue's reactivity wrapper: a
 * `shallowRef` re-read on every registry change, with the subscription
 * disposed by the surrounding effect scope.
 *
 * The ref starts `false` and takes its first real reading on mount, once the
 * template ref has filled in. Over-waiting is safe; under-waiting is a bug.
 * @param options - scope and readiness depth
 */
export function useBlokReady(options: UseBlokReadyOptions = {}): Readonly<ShallowRef<boolean>> {
  const { within, settleOn } = options;
  const ready = shallowRef(false);

  const read = (): void => {
    const scope = within === undefined ? null : (toValue(within) ?? null);

    // A scope that was asked for but has not resolved yet is NOT the global
    // scope — reporting ready here would gate on the wrong set of editors.
    ready.value = within !== undefined && scope === null
      ? false
      : BlokRuntime.readyState({
        within: scope,
        settleOn,
      }).ready;
  };

  onScopeDispose(BlokRuntime.subscribeReady(read));
  onMounted(read);

  return ready;
}
