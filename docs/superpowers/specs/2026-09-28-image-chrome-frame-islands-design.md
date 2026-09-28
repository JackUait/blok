# Image chrome: frame and islands — design

Date: 2026-09-28. Status: approved in chat, awaiting spec review.

## Goal

Rework the image block's chrome so it feels crafted, not generic.
The chrome is the toolbar, the resize handles and the Alt control.
The image itself, its saved data and its features do not change.

## Decisions (made with the user)

1. Direction: **frame and islands**. Selecting draws a soft frame around the image.
   Tools float above it in three small groups ("islands").
2. Scope: **image block only**. Embed and video keep today's chrome.
3. Motion: **split**. One bar rises, then comes apart into the islands.
4. Resize gets a live **readout** and **snap guides**.
5. Alt moves onto the image as a **pill** with a hover **hint** that explains alt text.
6. The alt editor stays **light**: one field, one quiet line. No tips, no checkbox.
7. The hint never shows while the alt editor is open.

Mockups from the session: `.superpowers/brainstorm/53400-1790604706/content/`
(`direction.html`, `motion.html`, `details-v4.html`). Not committed.

## Islands

| Island | Buttons (`data-action`) |
|---|---|
| Layout | `align-trigger`, `caption-toggle` |
| Edit | `crop`, `replace` |
| View | `fullscreen`, `download`, `more` |

- `more` holds copy link and delete, as today.
- Every existing `data-action` name stays, including the hidden `delete` alias.
- The block settings menu does not change.

Tiers keep today's thresholds (`OVERLAY_MEDIUM_THRESHOLD` 360, `OVERLAY_COMPACT_THRESHOLD` 230,
`OVERLAY_COMPACT_HEIGHT_THRESHOLD` 80). They now choose islands, not single buttons:

- **full** (≥ 360 px wide): Layout, Edit, View.
- **medium** (230–360 px): Edit and a `more` island. `more` also holds align, caption, fullscreen and download.
- **compact** (< 230 px wide or < 80 px tall): one island with `more` only.

## When things show

| State | Frame | Islands | Handle dots | Alt pill |
|---|---|---|---|---|
| Resting | — | — | — | — |
| Hover | — | split in | pop in | fades in |
| Selected, or settings / align / alt open | draws in | stay | pop in | stays |
| Dragging a handle | stronger ring | step aside | dragged one grows | stays |
| Loading, crop, error, empty, read-only | — | — | — | — |

- Hover → select does not replay the split. Only the frame is added.
- Dots show on hover, as the resize handles do today (`.blok-image-inner:hover` in `image.css`).
  The chat design said "selected only"; that misread today's CSS and would have been a regression.
- `prefers-reduced-motion`: everything appears in its final state, no animation.

## Placement

- Islands float 20 px above the image's top edge, over the content above it.
- If there is no room above (first block, or top edge scrolled off screen),
  they sit just inside the image's top edge. Same look, same animation.
- Placement is checked when the islands show, and on scroll while they are visible.
- The toolbar carries `data-islands-placement="above" | "inside"`.
- A table cell clips its overflow, so its top counts as a boundary too, and inside a cell the ring
  and the dots move inside the figure.
- While the islands float above, an invisible 20 px strip under them keeps the figure hovered,
  so a pointer climbing from the picture reaches them.

## Motion: split

- The row of islands rises about 14 px into place (~380 ms, ease-out).
- For the first moment the islands sit on one shared card, so they read as one bar.
- Then that shared card fades while each island's own card fades in and its corners round
  (~500 ms, slight overshoot). The seams between islands appear to open.
- Buttons never move sideways. A tooltip is placed once, where its button is at that moment,
  so a sliding button would leave its tooltip off-centre. (Found in e2e: an earlier version
  animated the gap and left tooltips 6 px off.) When the rise ends, the hovered button's
  tooltip is shown again at its final spot.
- While a handle is dragged, the animation is switched off so the islands can hide;
  they rise back in when the drag ends.
- The frame fades in. The dots pop in with a small overshoot.
- With fewer islands (medium, compact) the same motion runs with two or one.

## Resize

- Handles are small white dots on the frame's left and right midpoints.
  The hit area is at least as large as today's bars.
- While dragging:
  - the root carries `data-resizing`, and the islands fade out;
  - a dark readout next to the dragged dot shows `NN%` and the width in px;
  - faint guides show 25, 50, 75 and 100 %;
  - the width snaps to a guide within 2 %.
- At the minimum width the figure gives a short shake. It keys off the existing
  `data-resize-blocked` attribute.
- Saved data is unchanged: `data.width` is still a percent. One drag is one undo step.

## Alt pill

- Sits on the image, bottom-left, 10 px in. Shown on hover and while selected.
- Missing alt: gray dot, "Add alt text", and a small "?".
- Set alt: a check, "Alt", and the start of the text, cut with an ellipsis.
- Keeps `data-action="alt-edit"` and `aria-pressed`. Click opens the existing alt popover.
- Shown in every tier, compact included. (An earlier draft hid it in compact on the belief that
  the block settings menu has an alt entry. It has none, so hiding it would remove alt editing
  from small images.)
- Shown whether or not the caption is visible. Today the Alt chip disappears with the caption,
  because it lives in the caption row.
- **Hint.** A Blok tooltip after a short hover delay, or on keyboard focus:
  "What is alt text?" / "A short description of the image. Screen readers read it aloud,
  and browsers show it when the image can't load. Search engines use it too."
- The hint is off while `data-alt-open` is set.

## Alt editor

- One field. The placeholder is an example (new key `tools.image.altExample`), not the word "Alt text".
- One quiet line under it. It reuses the existing `tools.image.altDescription`
  ("Describe this image for people who can't see it."), moved below the field and set small and gray.
  Reusing it avoids re-translating a line that already exists in 71 locales.
- The old placeholder key `tools.image.altPlaceholder` becomes the field's `aria-label`.
- Enter saves. Clicking away saves. Escape closes. Same as today.

## Code

All inside `src/tools/image/` and `src/styles/image.css`, except the shared resizer.

- `ui.ts` `renderOverlay`: wraps buttons in `data-island="layout" | "edit" | "view"` wrappers.
  Dividers go. `updateOverlayTier` keeps setting `data-tier` and `data-compact`.
- New `island-placement.ts`: a pure function from the figure rect and the room above
  to `'above' | 'inside'`.
- New ring element `data-role="image-selection-ring"` inside the figure. CSS only.
  Not called "frame": `data.frame` / `data-frame` already means the image's border/shadow style.
- "Selected" means the block holder carries `data-blok-selected="true"` (set by core's
  `selection-manager.ts`). The tool's own `data-selected` attribute is always `"false"` today,
  so existing `[data-selected="true"]` rules never match. New rules must not key off it.
- `resizer.ts` `attachResizeHandle`: new optional `snapPoints?: number[]`
  (and the 2 % tolerance). Default is no snapping, so video and embed are unchanged.
- Readout: a small element the image block updates from `onPreview`.
- `renderCaptionRow`: loses the Alt button. The pill is rendered on the figure.
- `alt-popover.ts`: new placeholder and note line; description line removed.
- Islands reuse the toolbar's existing tokens: `--blok-overlay-surface`, `--blok-overlay-ring`,
  `--blok-image-shadow-toolbar` (already light and dark). Dots use `--blok-overlay-surface` too.
- New tokens in `src/styles/colors.css`, light and dark: `--blok-image-frame-ring`,
  `--blok-image-frame-ring-strong`, `--blok-image-readout-bg`, `--blok-image-readout-fg`. Pressed buttons use `--blok-icon-active-bg` / `--blok-icon-active-text`.
  Nothing selected is blue.
- i18n, all locales: four new keys — `tools.image.altAdd` ("Add alt text"),
  `tools.image.altHintTitle`, `tools.image.altHintBody`, `tools.image.altExample`.

## Testing

TDD. Each test fails before its code is written.

Unit (Vitest):
- `renderOverlay`: each `data-action` sits in its island, in order; the `delete` alias stays;
  tiers show three, two, one island.
- `island-placement`: room above → above; first block or off screen → inside;
  room exactly equal to the island height.
- `resizer`: no `snapPoints` → same results as today; with snap points it snaps within 2 %
  and not outside; `clampedToMin` still reported.
- Alt pill: missing and set states, text preview, opens the popover, hint off while open.
- Tokens: light and dark values exist; the neutral-selection test still passes.
- i18n: new keys exist in every locale.

E2E (Playwright):
- Hover shows islands. Select adds frame and dots. Escape clears.
- First-block image puts islands inside.
- Drag a dot: readout shows, snaps to 50 %, `width` saved, one undo step.
- Alt: hover shows hint; click opens editor with no hint; Enter saves; pill shows "set".
- Reduced motion shows the final state at once.

Visual check with the `verify` skill: light, dark, a narrow column, first block.

## Compatibility

Not breaking.
- Saved data: unchanged.
- `data-action` names: unchanged.
- CSS variables: only added, none removed.
- Visual change for the release notes: the Alt control moves from the caption row onto the image.
  Consumer CSS aimed at `.blok-image-caption-row__alt` will no longer match.

## Out of scope

- Embed and video chrome.
- A "decorative image" option for alt.
- Any change to the lightbox, crop editor, empty, uploading or error states.
