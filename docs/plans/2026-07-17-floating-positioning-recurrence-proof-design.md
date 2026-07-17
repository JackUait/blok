# Floating Positioning Recurrence-Proof Design

## Objective

Close the remaining ways the original root-boundary bug class could return.
Future code must not be able to introduce a snapshot virtual anchor, root mount,
root collision boundary, or hand-written root coordinate path without making
its lifecycle and coordinate space explicit and passing an adversarial CI law.

This design extends the existing floating-positioning hardening. It does not
replace unrelated overlays with one component.

## Remaining findings

The current shared engine normalizes omitted, `body`, and `html` boundaries to
the live viewport; tracks live, collapsed, and contextual virtual anchors; and
fails closed when an untrackable virtual anchor moves inside a nested scroller.
The deeper audit nevertheless found four incomplete defenses:

1. `PasteMenuController` passes a caret `DOMRect` without the block element that
   owns it. Nested scrolling therefore dismisses the menu instead of keeping it
   attached.
2. `PopoverParams.position` and `updatePosition()` allow callers to omit an
   anchor lifecycle. Untyped JavaScript fails closed at runtime, but TypeScript
   does not force an intentional choice.
3. The architecture law uses regular expressions. Root/style aliases, computed
   properties, `Object.assign`, `cssText`, `setAttribute`, and helper mount
   functions can evade it.
4. Browser evidence lacks horizontal document scrolling, transformed overflow
   ancestors, and link-paste movement after nested scrolling.

## Considered approaches

### Patch only

Pass the link-paste block holder and add one browser test. This repairs the
known path but permits the same omission in the next virtual-anchor consumer.

### Explicit lifecycle plus syntax-aware enforcement (selected)

Make every virtual anchor declare whether it tracks a live context or
intentionally dismisses when nested scrolling invalidates its snapshot. Replace
the regex discovery law with a TypeScript-AST analyzer and adversarial fixtures.
This closes the known bypasses while retaining runtime fail-closed behavior for
untyped consumers.

### Centralize every overlay

Force drag previews, modals, announcers, tooltips, downloads, and menus through
one root-floating controller. This would remove some variation but conflate
pointer-following, viewport-fixed, transient, modal, and anchored contracts. It
adds a broad regression surface without strengthening the relevant invariant
more than the selected approach.

## Virtual-anchor contract

`PopoverParams` becomes a discriminated union over a shared base:

- no `position`: ordinary live-trigger or inline placement;
- `position` plus `positionContext`: the snapshot follows that live element;
- `position` plus `positionLifecycle: 'dismiss-on-nested-scroll'`: the caller
  explicitly accepts dismissal when a nested scroller moves.

Supplying `position` alone, supplying a context without a position, or combining
the context and dismissal policy is a TypeScript error. The declaration is
public, so package type fixtures must prove both accepted and rejected shapes.

`updatePosition()` receives the same explicit lifecycle choice. Existing
toolbox calls use their block holder. Positioning-only unit tests declare the
dismissal policy unless they are specifically testing contextual tracking.

Runtime JavaScript remains defensive. A position-only object from an untyped
consumer is treated as untrackable and dismissed on nested scroll. Missing or
collapsed contexts also fail closed. The runtime does not infer a toolbar
trigger as the virtual anchor context because that trigger can be unrelated to
the caret or pointer that produced the rectangle.

## Link-paste data flow

The link pattern handler already passes the inserted link block holder as the
menu trigger. `PasteMenuController` will use that holder as
`positionContext` whenever it supplies the caret rectangle. The rectangle is
captured in viewport coordinates, converted to a document snapshot by
`PopoverDesktop`, and then moved by the holder's document-space delta while the
menu remains open. Escape registration remains attached to the same element and
selection behavior does not change.

## Syntax-aware architecture law

Move discovery into a small tested analyzer that parses every production
`.ts`/`.tsx` file with the TypeScript compiler API. It reports evidence rather
than deciding whether a surface is approved.

The analyzer resolves straightforward lexical aliases and detects:

- aliases of `document.body` and `document.documentElement`;
- root mount methods through direct, optional, and computed property access;
- root arguments passed to local helper functions that perform a mount;
- direct and aliased root `getBoundingClientRect()` reads;
- coordinate writes through property assignment, computed properties,
  `style.setProperty`, `Object.assign`, `cssText`, and `setAttribute('style')`;
- viewport/root signals such as fixed positioning and top-layer promotion;
- calls to shared positioning and tracking helpers;
- `PopoverDesktop` construction and explicit virtual-anchor lifecycle fields.

The repository law keeps exact, reasoned classifications for all physical root
mounts, manual root-positioning candidates, shared-engine callers, root-surface
lifecycle contracts, and `PopoverDesktop` consumers. It asserts both directions:
every discovery is classified and every classification still exists.

Adversarial unit fixtures cover every supported evasion form. Dynamic execution
and dynamically assembled property names are outside useful static inference;
the law rejects suspicious dynamic root/style access rather than silently
classifying it as safe. The shared runtime fail-closed behavior remains the
second line of defense.

## Browser and mutation proof

Playwright cases will add:

- horizontal document scrolling with fixed-height root CSS;
- an editor inside a transformed overflow ancestor;
- link-paste opened in nested content and kept aligned after that ancestor
  scrolls.

Each asserts anchor alignment and viewport containment after movement, and runs
in Chromium, Firefox, and WebKit through the existing cross-browser routing.

Mutation checks must demonstrate that the proof is non-vacuous:

- replacing root-boundary normalization with the root element's CSS box fails;
- removing link-paste `positionContext` fails its nested-scroll browser/unit
  regression;
- disabling each architecture-analysis detection family makes its adversarial
  fixture fail;
- changing a classified production path to an unsafe alias form is discovered.

Completion requires fresh focused tests, the full unit suite, lint/typecheck,
test builds, bundle/type artifact checks, the complete cross-browser root and
nearby floating-surface suites, `git diff --check`, and a row-by-row inventory
reconciliation. Any unsafe or indirect-evidence row keeps the goal incomplete.
