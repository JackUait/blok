# Image Block Toolbar — Float Above Block

**Date:** 2026-04-19
**Status:** Approved

## Problem

The image block's inline toolbar (`.blok-image-toolbar`) is appended to `.blok-image-frame` and positioned at `top: 10px; right: 10px`. When the image is narrower than the frame (e.g. `width: 40%`), the toolbar floats over empty frame space far from the image, visually disconnected and perceived as being "next to the caption area".

## Goal

Position the toolbar at the top edge of the image block, floating above the frame, anchored to the block root. The toolbar is always visually associated with the block's top boundary regardless of image size or alignment.

## Design

### DOM change

- Append the overlay element as a child of the tool root (`[data-blok-tool="image"]`) instead of `.blok-image-frame`.
- Tool root already has `position: relative` implied; ensure CSS sets it explicitly.
- The more-popover stays relative to the same root (absolute, positioned under the toolbar).

### CSS change

```css
[data-blok-tool="image"] { position: relative; }

[data-blok-tool="image"] .blok-image-toolbar {
  position: absolute;
  top: -44px;             /* float above the top border */
  right: 0;
  /* other props unchanged: bg, backdrop, radius, padding, opacity */
}

[data-blok-tool="image"] .blok-image-popover {
  position: absolute;
  top: 4px;               /* sits just below the toolbar row */
  right: 0;
  /* width/bg unchanged */
}
```

- Hover/selected opacity rules unchanged; selectors still match.
- Z-index not needed — block itself establishes stacking; toolbar already above frame via source order.

### Horizontal alignment

Right-aligned at block edge. Matches existing user expectation; no ambiguity with caption (which is centered below).

### Edge cases

- **First block in editor:** toolbar at `top: -44px` may overlap preceding UI. Accept — toolbar only visible on hover/select, and editor canvas already has vertical breathing room above the first block.
- **Resize handles:** still children of `.blok-image-frame`. No overlap since handles are on left/right edges, toolbar on top.
- **Readonly:** overlay not rendered in readonly mode — no change.

### Out of scope

- Changing toolbar shape, buttons, or interactions.
- Changing popover contents.
- Responsive breakpoints for narrow viewports.

## Tests (TDD)

### Unit

`test/unit/tools/image/overlay-position.test.ts`:

1. `renderOverlay` result can be appended as child of tool root; DOM structure places overlay as sibling of `.blok-image-inner` figure (NOT child of frame).
2. Toolbar `data-role="image-overlay"` is reachable via `root.querySelector('[data-role="image-overlay"]')`.
3. Popover `data-role="image-popover"` is sibling of overlay under the root, not inside frame.

### E2E (existing suite update)

`test/e2e/tools/image.spec.ts` (or current spec):

- Locator for toolbar changes from frame-child to block-child. Use semantic `data-role` unchanged.
- Assert toolbar's bounding box `top` is ≤ frame's `top` (i.e. sits at or above frame top border).

### Regression test first

Write a failing test asserting: when image block renders with `width: 40, alignment: center`, the toolbar's `getBoundingClientRect().top` is less than the frame's `getBoundingClientRect().top`. Current code fails this. Fix makes it pass.

## Implementation steps

1. Write failing regression test (position assertion).
2. Move `frame.appendChild(overlay)` → `this.root.appendChild(overlay)` in `renderRendered` (`src/tools/image/index.ts:287`).
3. Same for popover: `frame.appendChild(popover)` → `this.root.appendChild(popover)` (`src/tools/image/index.ts:309`).
4. Update CSS: add `position: relative` on root, change toolbar `top: 10px` → `top: -44px`, popover `top: 44px` → `top: 4px`.
5. Run suite, verify green.
6. Manual verify in playground.
