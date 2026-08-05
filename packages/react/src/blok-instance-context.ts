import { createContext, useContext } from 'react';
import type { Blok } from '@/types';

/**
 * Carries the LIVE editor instance down to everything `BlokContent` renders —
 * which, because `createPortal` preserves the COMPONENT tree's context (not the
 * DOM target's), includes every `createReactBlock` block mounted through the
 * editor's shared `BlockPortalHost`.
 *
 * Null until the instance exists (SSR, first render, between recreations),
 * matching `useBlok`'s own pre-ready contract.
 */
export const BlokInstanceContext = createContext<Blok | null>(null);

/**
 * The live Blok instance a component is rendered inside, or null before it
 * exists. Inside a `createReactBlock` component this is the block's OWN editor —
 * so a block can drive the tree it lives in without the host prop-drilling the
 * instance into it:
 *
 * ```tsx
 * const blocks = useBlocks(useBlokInstance());
 * const children = blocks.getChildren(block.id);
 * ```
 *
 * That pairing is also what makes a container block REACTIVE to its own child
 * tree: `useBlocks` re-renders on the editor's `block changed` event, which core
 * emits for every structural mutation — including children the adapter itself
 * never sees (a pasted paragraph, a Tab-indent from the keyboard).
 *
 * Outside a `BlokContent`/`BlokEditor` subtree it returns null.
 */
export function useBlokInstance(): Blok | null {
  return useContext(BlokInstanceContext);
}
