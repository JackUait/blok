# Floating Positioning Inventory

This inventory classifies every production floating surface that writes screen
coordinates or mounts outside its local tool. It distinguishes the coordinate
space of the anchor (`getBoundingClientRect()` is viewport-relative) from the
coordinate space of the positioned element.

## Shared root popovers

All rows below construct `PopoverDesktop`, which body-mounts a root popover,
promotes it to the CSS Top Layer, writes document-coordinate `top`/`left`, and
uses `resolveBoundaryRect()` plus `resolvePosition()`.

| Consumer | Source | Anchor form | Continuous tracking | Root-boundary status |
| --- | --- | --- | --- | --- |
| Block settings / bookmark menu / context menu | `components/modules/toolbar/blockSettings.ts` | element or explicit `DOMRect`; trigger can collapse while open | window resize, capture-phase any scroll, content resize | Root boundary safe; snapshot tracking requires proof |
| Toolbox / slash menu | `components/ui/toolbox.ts` | trigger plus explicit rect refreshed by owner | same shared tracker plus owner updates | Root boundary safe; explicit rect tracking requires proof |
| Code language picker | `tools/code/index.ts` | live trigger + live left-align element | shared tracker | Safe |
| Link-paste choice menu | `tools/link/paste-menu/controller.ts` | block trigger plus explicit caret/link-end rect | shared tracker | Root boundary safe; explicit rect tracking requires proof |
| Database tab context menu | `tools/database/database-tab-bar.ts` | live tab | shared tracker | Safe |
| Database add-view menu | `tools/database/database-view-popover.ts` | live trigger | shared tracker | Safe |
| Database card menu | `tools/database/index.ts` | live trigger | shared tracker | Safe |
| Table selection pill menu | `tools/table/table-cell-selection.ts` | live pill | shared tracker | Safe |
| Table row/column menu | `tools/table/table-row-col-popover.ts` | live grip | shared tracker | Safe |

Nested `PopoverDesktop` instances are mounted inside the parent popover and are
positioned in the parent's local coordinate space. `PopoverInline` is mounted
inside the inline-toolbar wrapper and likewise moves with that wrapper. Neither
uses a document root as a collision boundary.

## Other shared-engine anchored surfaces

| Surface | Source | Positioned space | Tracking | Status |
| --- | --- | --- | --- | --- |
| Audio cover picker | `tools/audio/cover-picker.ts` | document-coordinate absolute top-layer element | capture-phase any scroll, resize, own resize | Safe through `positionAnchored()` |
| Image alt editor | `tools/image/alt-popover.ts` | viewport-fixed top-layer element; shared document result converted back by subtracting window scroll | capture-phase any scroll, resize, own resize | Safe through `positionAnchored()` |

## Independently viewport-safe surfaces

These do not consume body/html rectangles, so the reported `height: 100vh`
failure cannot affect their initial placement.

| Surface | Source | Contract | Remaining audit result |
| --- | --- | --- | --- |
| Tooltip | `components/utils/tooltip.ts` | viewport rect -> fixed top-layer coordinates; hides on window scroll | Initial root scrolling safe; nested-scroll dismissal is not covered |
| Link hover card | `components/utils/link-hover-card.ts` | viewport rect/pointer -> fixed top-layer coordinates | Initial root scrolling safe; no scroll/resize tracking after open |
| Callout emoji picker | `tools/callout/emoji-picker/index.ts` | viewport rect -> element inside a fixed backdrop | Window scrolling is locked while open; root scrolling safe |
| Database property-type menu | `tools/database/database-property-type-popover.ts` | viewport rect -> body-mounted fixed element | No collision handling, top-layer promotion, or scroll/resize tracking: unsafe |
| Database tab overflow menu | `tools/database/database-tab-bar.ts` | viewport rect -> body-mounted fixed element | No collision handling, top-layer promotion, or scroll/resize tracking: unsafe |

## Locally-contained surfaces

The following menus/overlays are absolute descendants of the tool or editor
surface they describe, so their coordinates are local offsets and naturally
move with document and nested scrolling:

- inline toolbar and its nested menus;
- image alignment menu and image toolbar;
- link embed option overlay;
- audio speed controls;
- video settings/context menus;
- table selection overlays, grips, add controls, and resize handles;
- database in-view buttons;
- file/image modal contents and notifier dialog contents.

Pointer drag ghosts, selection rectangles, alignment guides, media lightboxes,
and modal backdrops are fixed viewport UI rather than anchor menus. They are not
boundary consumers and are out of the root-boundary failure class.

## Root cause variants still requiring proof

1. `document.body`, `document.documentElement`, and omitted boundary must all
   mean the live viewport for vertical and horizontal shared-engine placement.
2. Window `scrollX` and `scrollY` must be added exactly once.
3. An explicit non-root element or `DOMRect` must retain its clipping semantics.
4. A live trigger must follow window and nested ancestor scrolling.
5. A collapsed trigger currently falls back to a construction-time viewport
   rect. Re-running placement with a new scroll offset can keep the menu fixed
   on screen rather than attached to the content; this is unproven/likely unsafe.
6. An explicit `DOMRect` is also a viewport snapshot. The shared tracker
   currently reuses it with the latest scroll offset; this is unproven/likely
   unsafe for block-context, toolbox, and link-paste menus.
7. Root popovers must remain correct before and after top-layer promotion and
   after their opening transform settles in all three browser engines.
8. New body-mounted anchored menus must not be allowed to bypass the shared
   resolver/tracker contract.

## Searches used to keep the inventory complete

- all `new PopoverDesktop` and `new PopoverInline` sites;
- all `positionAnchored`, `resolvePosition`, and `createPositionTracker` calls;
- all production `getBoundingClientRect()` calls paired with `style.top` or
  `style.left` writes;
- all `document.body.append*`, `openModalDialog`, and `promoteToTopLayer` sites;
- all authored and inline `position: fixed` / `position: absolute` declarations.

The architecture regression will encode the non-vacuous source lists above so
a new root floating implementation cannot silently appear outside this audit.
