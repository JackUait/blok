// packages/angular/src/blok-instance.ts
import { inject, InjectionToken, signal, type Signal } from '@angular/core';

import type { Blok } from '@/types';

/**
 * DI token carrying the LIVE editor instance (as a signal) into every block
 * mounted by `createAngularBlock`. `BlokContentDirective` publishes its own
 * `instance` signal through it, so the value is null before the editor is ready
 * and after teardown — matching the React/Vue adapters' pre-ready contract.
 *
 * Provided on the block's ELEMENT injector by the portal registry, so it is
 * per-EDITOR: two editors on one page each publish their own instance.
 */
export const BLOK_EDITOR_INSTANCE = new InjectionToken<Signal<Blok | null>>(
  'BLOK_EDITOR_INSTANCE'
);

/** Stable "no editor here" signal for components mounted outside an editor. */
const NO_EDITOR: Signal<Blok | null> = signal(null).asReadonly();

/**
 * The live Blok instance the component is mounted inside, as a signal, or a
 * signal of null before it exists. Inside a `createAngularBlock` component this
 * is the block's OWN editor — so a block can drive the tree it lives in without
 * the host prop-drilling the instance into it:
 *
 * ```ts
 * private readonly editor = injectBlokInstance();
 * private readonly blocks = injectBlocks(this.editor);
 * ```
 *
 * That pairing is also what makes a container block REACTIVE to its own child
 * tree: `injectBlocks` refreshes on the editor's `block changed` event, which
 * core emits for every structural mutation — including children the adapter
 * itself never sees (a pasted paragraph, a Tab-indent from the keyboard).
 *
 * Call it in an injection context (a field initializer or the constructor).
 * Outside an editor it returns a signal of null.
 */
export function injectBlokInstance(): Signal<Blok | null> {
  return inject(BLOK_EDITOR_INSTANCE, { optional: true }) ?? NO_EDITOR;
}
