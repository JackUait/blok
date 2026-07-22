// packages/angular/src/useBlokReady.ts
import { DestroyRef, ElementRef, afterNextRender, inject, signal, type Signal } from '@angular/core';

import { Blok as BlokRuntime } from '@bloklabs/core';

/** How the caller names the DOM scope to observe. */
export type BlokReadyScope =
  | (() => Element | ElementRef<Element> | null | undefined)
  | ElementRef<Element>
  | Element
  | null;

/** Options accepted by {@link injectBlokReady}. */
export interface InjectBlokReadyOptions {
  /**
   * Restrict the wait to editors mounted inside this element. Accepts an
   * element, an `ElementRef`, or a getter/signal returning either — the getter
   * form lets you pass `() => this.scopeRef?.nativeElement` from a field
   * initializer, before the view exists. It is re-read on every readiness
   * change.
   *
   * Omit it to observe every editor on the page. Passing it while it still
   * resolves to null reports NOT ready — an unresolved scope must never fall
   * back to the page-global one.
   */
  within?: BlokReadyScope;
  /**
   * `'ready'` (default) settles when each editor has finished booting.
   * `'rendered'` also waits for its content to be in the DOM and re-arms on
   * every post-boot re-render.
   */
  settleOn?: 'ready' | 'rendered';
}

/**
 * Resolves the caller's scope description to an element, or null when it is
 * not available yet.
 * @param within - the scope description passed in options
 */
function resolveScope(within: BlokReadyScope): Element | null {
  const value = typeof within === 'function' ? within() : within;

  if (value === null || value === undefined) {
    return null;
  }

  return value instanceof ElementRef ? value.nativeElement : value;
}

/**
 * Angular factory exposing the live readiness of the Blok editors in a DOM
 * scope as a boolean signal.
 *
 * The readiness logic itself is framework-agnostic and lives in core
 * (`Blok.readyState` / `Blok.subscribeReady`) — the SAME implementation behind
 * React's and Vue's `useBlokReady`, so the three adapters cannot drift. This
 * wrapper supplies only Angular's reactivity: a signal re-read on every
 * registry change, unsubscribed through the injector's `DestroyRef`.
 *
 * Call it in an injection context (component constructor / field initializer).
 * The signal starts `false` and takes its first real reading in
 * `afterNextRender` — browser-only by contract, and late enough for a
 * `@ViewChild` scope to exist. Over-waiting is safe; under-waiting is a bug.
 * @param options - scope and readiness depth
 */
export function injectBlokReady(options: InjectBlokReadyOptions = {}): Signal<boolean> {
  const { within, settleOn } = options;
  const ready = signal(false);

  const read = (): void => {
    const scope = within === undefined ? null : resolveScope(within);

    // A scope that was asked for but has not resolved yet is NOT the global
    // scope — reporting ready here would gate on the wrong set of editors.
    ready.set(within !== undefined && scope === null
      ? false
      : BlokRuntime.readyState({
        within: scope,
        settleOn,
      }).ready);
  };

  inject(DestroyRef).onDestroy(BlokRuntime.subscribeReady(read));
  afterNextRender(read);

  return ready.asReadonly();
}
