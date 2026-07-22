import { useEffect, useState, type RefObject } from 'react';
import { Blok as BlokRuntime } from '@bloklabs/core';

/** Options accepted by {@link useBlokReady}. */
export interface UseBlokReadyOptions {
  /**
   * Restrict the wait to editors mounted inside this element. Accepts the ref
   * you already hold on the container (read on every notification, so a ref
   * that attaches after the first render is picked up).
   *
   * Omit it to observe every editor on the page. Passing it while it still
   * resolves to null reports NOT ready — an unresolved scope must never fall
   * back to the page-global one.
   */
  within?: RefObject<Element | null> | Element | null;
  /**
   * `'ready'` (default) settles when each editor has finished booting.
   * `'rendered'` also waits for its content to be in the DOM and re-arms on
   * every post-boot re-render.
   */
  settleOn?: 'ready' | 'rendered';
}

/**
 * Live readiness of the Blok editors in a DOM scope.
 *
 * Returns `false` until every editor inside `within` is settled, and follows
 * the scope afterwards: editors mounted later re-close the gate, and with
 * `settleOn: 'rendered'` so does each re-render. A scope holding no editors is
 * ready, so callers need no "nothing to wait for" special case.
 *
 * The first render always reports `false` — the scope element is not attached
 * yet, and over-waiting is safe while under-waiting is a bug.
 * @param options - scope and readiness depth
 */
export function useBlokReady(options: UseBlokReadyOptions = {}): boolean {
  const { within, settleOn } = options;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const read = (): void => {
      const scope = within instanceof Element ? within : (within?.current ?? null);

      // A scope that was asked for but has not resolved yet is NOT the global
      // scope — reporting ready here would gate on the wrong set of editors.
      setReady(within !== undefined && scope === null
        ? false
        : BlokRuntime.readyState({
          within: scope,
          settleOn,
        }).ready);
    };

    read();

    return BlokRuntime.subscribeReady(read);
  }, [within, settleOn]);

  return ready;
}
