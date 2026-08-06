import { DATA_ATTR } from '../components/constants/data-attributes';

/**
 * One child's decoration: attribute name → value. `null`/`undefined` removes the
 * attribute; a boolean or number is stringified (so `false` writes
 * `data-active="false"`, which CSS can select, rather than dropping the hook).
 */
export type ChildAttributes = Record<string, string | number | boolean | null | undefined>;

/** The minimum a child must expose for a decoration pass. */
export interface DecoratableChild {
  id: string;
  holder: HTMLElement;
}

/**
 * A per-child decorator: what to write for the child at `index`.
 *
 * Generic over the child so an adapter can declare its decorators in terms of the
 * full `BlockAPI` its authors receive. A non-generic `(child: DecoratableChild)`
 * parameter would REJECT those: a function that demands a full BlockAPI is not
 * assignable to one promising to accept the structural minimum.
 */
export type ChildAttributesFn<Child extends DecoratableChild = DecoratableChild> = (
  child: Child,
  index: number
) => ChildAttributes;

/** What the previous decoration pass wrote for one child, so it can be undone. */
interface StampedChild {
  /** The element written to — a holder for one ledger, a content wrapper for the other. */
  target: HTMLElement;
  names: string[];
}

/** The ledgers a container keeps between passes; create one per child slot. */
export interface ChildDecorationLedger {
  holders: Map<string, StampedChild>;
  contents: Map<string, StampedChild>;
}

/**
 * A fresh pair of ledgers for one container's child slot.
 * @returns empty holder/content ledgers
 */
export const createChildDecorationLedger = (): ChildDecorationLedger => ({
  holders: new Map(),
  contents: new Map(),
});

/**
 * The child's OWN content wrapper, or null when its DOM has not committed yet.
 *
 * The first `[data-blok-element-content]` in document order under a holder is
 * always that block's own: a descendant block's wrapper necessarily sits INSIDE
 * it. Not `firstElementChild` — block tunes wrap the content node, so it is not
 * reliably a direct child (this is the same lookup core's own
 * `refreshToolRootElement` uses).
 * @param holder - the child block's holder
 * @returns the content wrapper, or null
 */
const contentWrapperOf = (holder: HTMLElement): HTMLElement | null =>
  holder.querySelector<HTMLElement>(`[${DATA_ATTR.elementContent}]`);

/**
 * Apply one decoration pass and clear the previous pass's leftovers — including
 * on a child that has since left the container, which would otherwise keep a
 * dead index forever.
 * @param ledger - what the last pass wrote (mutated)
 * @param children - the container's model children, in model order
 * @param decorate - the per-child decorator for the child HOLDERS, if any
 * @param resolveTarget - which element of a child this pass writes to
 */
const applyPass = <Child extends DecoratableChild>(
  ledger: Map<string, StampedChild>,
  children: Child[],
  decorate: ChildAttributesFn<Child> | undefined,
  resolveTarget: (holder: HTMLElement) => HTMLElement | null
): void => {
  const next = new Map<string, StampedChild>();

  children.forEach((child, index) => {
    const target = resolveTarget(child.holder);

    /**
     * A portal-rendered child commits its DOM a frame after core inserts it, so
     * its content wrapper can legitimately be missing on this pass. Skipping
     * (rather than throwing) leaves the next pass to stamp it.
     */
    if (target === null) {
      return;
    }

    const names: string[] = [];

    for (const [name, value] of Object.entries(decorate?.(child, index) ?? {})) {
      if (value === null || value === undefined) {
        target.removeAttribute(name);
        continue;
      }

      target.setAttribute(name, String(value));
      names.push(name);
    }

    next.set(child.id, { target, names });
  });

  for (const [id, previous] of ledger) {
    const current = next.get(id);

    previous.names
      .filter(name => current === undefined || !current.names.includes(name))
      .forEach(name => previous.target.removeAttribute(name));
  }

  ledger.clear();
  next.forEach((entry, id) => ledger.set(id, entry));
};

/**
 * Decorate a container's children: named attributes on each child's HOLDER and,
 * separately, on each child's `[data-blok-element-content]` wrapper.
 *
 * The single implementation behind the React, Vue and Angular per-child
 * decoration channels, so the three cannot drift on which element a hook lands
 * on or on when a dropped hook is cleaned up.
 *
 * BOTH levels exist because core's child-holder decoration law blesses both, and
 * a container needs both: the holder is the child's outer box (rails, indices,
 * hover states), while the content wrapper is where the child's own text box
 * begins — which is what a numbered rail or a connector line has to align to.
 * With only the holder reachable, a container had to encode core's wrapper chain
 * in its own CSS (`[data-step] > [data-blok-element-content] > …`) and broke
 * whenever that chain changed. Neither hook may introduce an element: holders
 * stay DIRECT children of the slot because core's reparenting and caret
 * sibling checks compare `holder.parentElement` by identity.
 *
 * Both are inert with respect to change tracking: core's mutation filter drops a
 * holder- or content-targeted attribute record for the CHILD block (both are
 * ancestors of the child's tool element, not descendants) and scores it
 * mutation-free for the CONTAINER (whose own `data-blok-mutation-free` host is
 * the nearest such ancestor).
 * @param ledger - the slot's ledgers from {@link createChildDecorationLedger}
 * @param children - the container's model children, in model order
 * @param decorators - the authored per-child decorators
 * @param decorators.childAttributes - written on each child's holder
 * @param decorators.childContentAttributes - written on each child's content wrapper
 */
export const applyChildDecoration = <Child extends DecoratableChild>(
  ledger: ChildDecorationLedger,
  children: Child[],
  decorators: {
    childAttributes?: ChildAttributesFn<Child>;
    childContentAttributes?: ChildAttributesFn<Child>;
  }
): void => {
  applyPass(ledger.holders, children, decorators.childAttributes, holder => holder);
  applyPass(ledger.contents, children, decorators.childContentAttributes, contentWrapperOf);
};
