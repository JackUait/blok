import { inject, shallowRef, type InjectionKey, type ShallowRef } from 'vue';
import type { Blok } from '@/types';

/**
 * Injection key carrying the LIVE editor instance down to everything
 * `BlokContent` renders — which, because `<Teleport>` preserves the COMPONENT
 * render context (not the DOM target's), includes every `createVueBlock` block
 * mounted through the editor's shared `BlockPortalHost`.
 *
 * The provided ref is null until the instance exists, matching `useBlok`'s own
 * pre-ready contract.
 */
export const BLOK_EDITOR_INSTANCE: InjectionKey<Readonly<ShallowRef<Blok | null>>> =
  Symbol('BLOK_EDITOR_INSTANCE');

/** Stable "no editor here" ref for components rendered outside a BlokContent. */
const NO_EDITOR: Readonly<ShallowRef<Blok | null>> = shallowRef(null);

/**
 * The live Blok instance a component is rendered inside, as a ref, or a ref of
 * null before it exists. Inside a `createVueBlock` block this is the block's OWN
 * editor — so a block can drive the tree it lives in without the host
 * prop-drilling the instance into it:
 *
 * ```ts
 * const blocks = useBlocks(useBlokInstance());
 * const children = computed(() => blocks.getChildren(ctx.block.id));
 * ```
 *
 * That pairing is also what makes a container block REACTIVE to its own child
 * tree: `useBlocks` refreshes on the editor's `block changed` event, which core
 * emits for every structural mutation — including children the adapter itself
 * never sees (a pasted paragraph, a Tab-indent from the keyboard).
 *
 * Call it inside `setup`. Outside a `BlokContent`/`BlokEditor` subtree it
 * returns a ref of null.
 */
export function useBlokInstance(): Readonly<ShallowRef<Blok | null>> {
  return inject(BLOK_EDITOR_INSTANCE, NO_EDITOR);
}
