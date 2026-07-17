# Floating Positioning Inventory

This is the authoritative inventory of production surfaces that mount at the
document root, read live geometry, or write screen coordinates. It distinguishes
viewport-relative anchor rectangles from the positioned element's coordinate
space and records the movement lifecycle for every virtual anchor.

The inventory is enforced bidirectionally by
`test/unit/architecture/floating-positioning-law.test.ts`. Its TypeScript AST
analyzer follows ordinary and computed aliases, local mount helpers,
constructor aliases, `Object.assign`, `cssText`, `setAttribute`, and dynamic
style access. A newly discovered path fails CI until it receives an exact,
reasoned classification here and in the executable registry.

## Shared root popovers

Root `PopoverDesktop` instances mount on `document.body`, enter the CSS Top
Layer, use document-coordinate absolute positioning, normalize a root collision
boundary to the live viewport, and attach the shared position tracker.

| Consumer | Source | Anchor and lifecycle | Direct evidence | Status |
| --- | --- | --- | --- | --- |
| Block settings, bookmark menu, and context menu | `components/modules/toolbar/blockSettings.ts` | Live trigger, or virtual cursor/keyboard rect tracked through `block.holder` | `popover-desktop-tracker.test.ts`; `popover-root-boundary.spec.ts` | Safe |
| Toolbox and slash menu | `components/ui/toolbox.ts` | Live trigger; virtual caret/slash rect tracks `currentBlock.holder`; missing-block fallback explicitly dismisses on nested scroll | `popover-desktop.test.ts`; `popover-desktop-tracker.test.ts`; architecture lifecycle law | Safe |
| Code language picker | `tools/code/index.ts` | Live trigger and live left-align element | shared tracker tests and exact consumer registry | Safe |
| Link-paste choice menu | `tools/link/paste-menu/controller.ts` | Virtual link-end rect tracks the inserted link block; missing-trigger fallback explicitly dismisses on nested scroll | `paste-menu-controller.test.ts`; `link-paste.spec.ts` | Safe |
| Database tab context menu | `tools/database/database-tab-bar.ts` | Live tab trigger | shared tracker and exact consumer registry | Safe |
| Database add-view menu | `tools/database/database-view-popover.ts` | Live trigger | shared tracker and exact consumer registry | Safe |
| Database card menu | `tools/database/index.ts` | Live trigger | shared tracker and exact consumer registry | Safe |
| Table selection pill menu | `tools/table/table-cell-selection.ts` | Live pill trigger | shared tracker and exact consumer registry | Safe |
| Table row/column menu | `tools/table/table-row-col-popover.ts` | Live grip trigger | shared tracker and exact consumer registry | Safe |

The public `PopoverParams` type is a discriminated union: a virtual `position`
must be accompanied by either `positionContext` or
`positionLifecycle: 'dismiss-on-nested-scroll'`. `updatePosition()` requires the
same explicit choice and clears stale context. Runtime JavaScript callers also
fail closed: an untrackable virtual anchor is dismissed when nested scrolling
invalidates its snapshot.

Nested `PopoverDesktop` instances are mounted inside their parent popover and
use the parent's local coordinate space. `PopoverInline` is mounted inside the
inline-toolbar wrapper and moves with that wrapper. Neither is a document-root
boundary consumer.

## Other shared-engine root surfaces

| Surface | Source | Positioned space and lifecycle | Direct evidence | Status |
| --- | --- | --- | --- | --- |
| Audio cover picker | `tools/audio/cover-picker.ts` | Document-coordinate absolute top-layer surface using `positionAnchored()` and `createPositionTracker()` | exact shared-caller/root-contract law; audio browser suite | Safe |
| Image alt editor | `tools/image/alt-popover.ts` | Viewport-fixed top-layer surface using `positionFixedAnchored()` and `createPositionTracker()` | exact shared-caller/root-contract law; image browser suite | Safe |
| Database property-type menu | `tools/database/database-property-type-popover.ts` | Viewport-fixed root surface using `positionFixedAnchored()` and `createPositionTracker()` | `database-property-type-popover.test.ts` nested-scroll and collision cases | Safe |
| Database tab overflow menu | `tools/database/database-tab-bar.ts` | Viewport-fixed root surface using `positionFixedAnchored()` and `createPositionTracker()` | `database-tab-bar.test.ts` nested-scroll case; database tab browser suite | Safe |

`tools/table/table-operations.ts` also calls the shared pure resolver, but its
surface is locally contained rather than root-mounted.

## Independently safe root surfaces

| Surface | Source | Contract | Direct evidence | Status |
| --- | --- | --- | --- | --- |
| Tooltip | `components/utils/tooltip.ts` | Viewport rect to fixed top-layer coordinates; capture-phase scroll dismisses on window or nested scrolling | `tooltip-scroll-anchoring.spec.ts`; exact dismiss-on-scroll law | Safe |
| Link hover card | `components/utils/link-hover-card.ts` | Viewport rect/pointer to fixed top-layer coordinates; continuous position tracker follows the live anchor | `link-hover-card.test.ts` nested-scroll case; `link-hover-card.spec.ts` | Safe |
| Callout emoji picker | `tools/callout/emoji-picker/index.ts` | Fixed surface in a fixed backdrop; continuous position tracker follows the callout anchor; page scroll is locked while open | `emoji-picker.test.ts` fixed, nested-scroll, and scroll-lock cases | Safe |

Link hover intent is armed only by genuine pointer motion. A synthesized
post-layout `mouseover` from inserting a link beneath a stationary pointer
cannot open the hover card over a paste menu; `link-paste.spec.ts` models that
browser event explicitly.

## Local, pointer-following, and non-anchored classifications

The exact architecture registry reviews every geometry-read plus coordinate-write
path. The remaining paths are outside the root-anchor failure class:

- inline and nested popovers, the inline toolbar, block toolbar, image toolbar,
  table overlays/grips/add controls, crop handles, and rectangle selection write
  offsets in a measured local container;
- drag previews, database drag ghosts, table drag ghosts, spacer alignment
  guides, and column-drop animations use fixed viewport coordinates refreshed
  by pointer movement or removed after the animation;
- modal lightboxes, notifier regions, and modal backdrops are viewport UI with
  no live element anchor;
- ARIA announcers and hidden caret-measurement nodes have no visible anchored
  placement;
- download anchors are styleless, clicked, and removed synchronously.

These are not informal exclusions. The law contains exact reasoned registries
for all 21 physical root mounts and all 21 geometry-to-coordinate files, so a
new or removed path changes the discovered set and fails the test.

## Closed root-cause variants

1. Omitted boundary, `document.body`, and `document.documentElement` all resolve
   to the live viewport, independent of authored `height: 100vh`.
2. `window.scrollX` and `window.scrollY` are added exactly once for
   document-coordinate placement on all four sides.
3. Explicit non-root elements and explicit `DOMRect` boundaries preserve their
   clipping semantics.
4. Live triggers follow window scrolling, ordinary nested scrolling,
   transformed nested scrolling, viewport resize, and surface resize.
5. A collapsed live trigger follows its last document point on window scroll
   and its measurable ancestor on nested scroll.
6. Every virtual `DOMRect` is either delta-tracked through a live context or
   explicitly dismissed when nested scrolling makes it unknowable.
7. Root popovers remain contained and attached before and after Top Layer
   promotion in Chromium, Firefox, and WebKit, including horizontal document
   scrolling.
8. New body-mounted/manual surfaces and new `PopoverDesktop` construction paths
   cannot bypass review through common alias, helper, computed-property, or
   dynamic-style forms.

## Direct proof map

| Invariant | Evidence |
| --- | --- |
| Root aliases, four sides, two scroll axes, explicit element/rect boundaries | `test/unit/utils/anchored-position-boundary.test.ts` |
| Live, collapsed, tracked virtual, dismissible virtual, and unmeasurable-context lifecycles | `test/unit/utils/popover-desktop-tracker.test.ts` and `test/unit/utils/popover-desktop.test.ts` |
| Link-paste controller passes its live holder context | `test/unit/tools/link/paste-menu-controller.test.ts` |
| Published type surface rejects position-only calls | `test/unit/types/popover-virtual-position-typecheck.ts` and `published-types-selfconsistent.test.ts` |
| Root CSS, window X/Y scroll, ordinary/transformed nested hosts, live/virtual anchors | `test/playwright/tests/ui/popover-root-boundary.spec.ts` in Chromium, Firefox, and WebKit |
| Link-paste tracking in a transformed nested host and stationary-pointer overlay guard | `test/playwright/tests/tools/link-paste.spec.ts` in Chromium, Firefox, and WebKit |
| Syntax families and adversarial bypass forms | `test/unit/architecture/floating-positioning-analyzer.test.ts` |
| Exact repository inventory and explicit virtual lifecycles | `test/unit/architecture/floating-positioning-law.test.ts` |

## Executable discovery totals

The current exact AST-derived sets are:

- 21 physical body/html mount files;
- 21 geometry-read plus coordinate-write files;
- 6 dynamic style-access files;
- 7 shared placement-engine callers;
- 2 capture-phase scroll-listener files;
- 9 external `PopoverDesktop` consumer files;
- 3 tracked-virtual-position files;
- 2 explicitly dismissible-virtual-position files;
- zero unclassified virtual-position files;
- zero body/html collision-geometry reads.

Discovery covers all production TypeScript/TSX outside playground and story
fixtures. The searched primitives include root append/mount helpers,
`PopoverDesktop`, `positionAnchored`, `positionFixedAnchored`,
`resolvePosition`, `createPositionTracker`, `promoteToTopLayer`, live geometry
reads, direct/computed coordinate writes, `Object.assign`, `cssText`,
`setAttribute`, and dynamic root/style access.
