# Floating Positioning Hardening Design

## Objective

Make the reported class of failure structurally difficult to reintroduce: every
root anchored surface must use one explicit coordinate-space contract, remain
attached across window and nested scrolling, and be covered by a non-vacuous CI
law that catches future hand-written positioning paths.

## Considered approaches

### 1. Only expand the bookmark regression

Add more `body`/`html` variants around the existing Playwright test. This is
low-risk but protects only code that already reaches `PopoverDesktop`; a new
body-mounted menu can still hand-write coordinates and silently repeat the bug.

### 2. Harden the shared contract and enforce it (selected)

Keep locally-contained and independently viewport-safe surfaces in their
appropriate coordinate spaces, but centralize all body-mounted anchored
position calculations and tracking. Add an architecture law that inventories
every exception and rejects new bypasses. This closes the known gaps without
rewriting unrelated overlays or modal UI.

### 3. Replace every floating surface with `PopoverDesktop`

This would maximize implementation uniformity but force menus, dialogs,
tooltips, hover cards, and emoji pickers into one component despite different
interaction and accessibility contracts. The regression surface is much larger
than the positioning benefit.

## Coordinate-space contract

1. `getBoundingClientRect()` inputs are viewport-relative.
2. `body`, `html`, and an omitted collision boundary mean the live layout
   viewport, regardless of their CSS boxes.
3. Explicit non-root elements and `DOMRect`s keep their own collision bounds.
4. Absolute body/top-layer surfaces receive document coordinates.
5. Fixed surfaces receive viewport coordinates through a shared adapter that
   converts the shared engine's document result exactly once.
6. Every open root anchor either repositions on capture-phase ancestor scroll,
   window resize, and content resize, or intentionally dismisses on those
   events.

## Moving snapshot anchors

A raw `DOMRect` is a snapshot in viewport coordinates. Reusing it with a later
`window.scrollY` pins the menu to the viewport instead of its document content.
The same occurs when a trigger becomes `display:none` and `PopoverDesktop`
falls back to its construction-time rect.

Store an anchor snapshot as:

- the anchor rect in document coordinates at capture time;
- the capture-time window scroll offset;
- an optional live context element and its document-coordinate rect.

Resolution works as follows:

- a still-measurable trigger remains authoritative;
- an explicit virtual rect moves by the live context element's document-space
  delta (covering nested scrolling and layout movement);
- a collapsed trigger uses the nearest measurable ancestor as that context;
- without a live context, the stored document point is converted back to the
  current viewport using the latest window scroll.

This preserves the public `DOMRect` API while giving the tracker a stable,
document-attached meaning. `updatePosition()` resets the snapshot baseline.

## Root surface migration

Add `positionFixedAnchored()` beside `positionAnchored()`. It calls the same
boundary/flip/clamp engine with `apply:false`, converts the result from document
to viewport coordinates once, and writes the fixed element's styles.

Migrate the database property-type and tab-overflow menus to this helper and
attach `createPositionTracker()`. Preserve their DOM, styling, activation, and
dismissal behavior. Other fixed surfaces remain independently safe only when
their existing contract is explicit: tooltip dismisses on any capture-phase
scroll; the emoji picker locks page scroll; locally-contained menus move with
their parent.

## Defense in depth

Add an architecture law that:

- bans direct root `body`/`html` geometry as a floating collision boundary;
- detects body-mounted/top-layer anchored implementations that both read an
  anchor rect and write `top`/`left`;
- requires each detected implementation to use the shared anchored engine or
  appear in a small reasoned registry for an independently safe contract;
- asserts every known implementation and every exemption is still discovered,
  preventing a vacuous or stale whitelist;
- fingerprints all `PopoverDesktop` construction sites, which are safe by
  construction through the shared class.

## Verification design

Unit matrices cover every boundary kind, all four sides, both window scroll
axes, explicit element/rect preservation, fixed-coordinate conversion, live,
virtual, and collapsed anchors. Browser matrices cover `body`, `html`, and both
fixed-height roots, window scrolling before and after open, nested scrolling
after open, and all three engines. Each new repair is observed red before
production changes, then mutation-tested by temporarily disabling the central
normalization or architecture classifier.
