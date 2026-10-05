# Image chrome: paper and graphite — design

Date: 2026-10-05. Status: approved in chat, awaiting spec review.
Replaces the look from `2026-09-28-image-chrome-frame-islands-design.md`.

## Goal

The image block's chrome is calm and reads the picture.
The chrome is the toolbar, the resize handles and the Alt control.
Each control is light ("paper") or dark ("graphite"), picked from the pixels under it.
No tints, glows or outlines. Saved data and features do not change.

## Decisions (made with the user)

1. Direction: **image-aware**, then **calm**. Colour-tinted, glowing and outline variants were rejected as "slop".
2. Variant: **paper and graphite**. The image decides only light or dark.
3. Unreadable image: chrome **follows the editor theme**.
3a. Cross-origin images are read through a hidden **sampling copy** loaded with `crossOrigin="anonymous"`.
    Measured in Chromium: an `<img>` without `crossOrigin` taints the canvas for EVERY cross-origin
    image, even one whose server sends CORS. Without the copy only same-origin images could be read.
4. Each control reads **the area under itself**, not the whole image.
5. Take all of mockup A's shapes: **one bar**, **thin bar handles inside the picture**, **ALT tag**.
6. Selection keeps today's soft grey frame.

Mockups: `.superpowers/brainstorm/93642-1791153043/content/image-aware-calm.html` (option A). Not committed.

Not breaking: the islands, the split and the Alt pill landed after v1.15.2 (last tag).

## Look

### Toolbar

- One compact bar, centred, 8 px inside the top edge of the picture.
- Groups stay: layout (align, caption), edit (Edit, Replace), view (fullscreen, download, "…").
  A 1 px divider separates groups. No per-group cards.
- `data-island` wrappers stay as plain groups, so tier rules keep working.
- Tiers keep today's thresholds and hide lists (`OVERLAY_MEDIUM_THRESHOLD` 360,
  `OVERLAY_COMPACT_THRESHOLD` 230, height < 80 → compact).
- Motion: opacity fade, ~120 ms. No rise, no split. Buttons never move, so tooltips need no re-anchor.
  `prefers-reduced-motion`: no fade.

### Resize handles

- Bars 3 × 32 px, 8 px inside the left and right edges of the picture.
- Invisible 16 px wide hit area around each.
- Inside the picture, so a table cell's `overflow: hidden` no longer clips them.
- The dragged handle gets stronger ink. Readout and snap guides stay.

### Alt

- A small tag in the picture's bottom-left corner: **ALT** (caps) then the alt text, ellipsised.
- Missing alt: today's "add" string, dimmed.
- Hint and alt editor unchanged.

### Paper and graphite

| Tone | Card | Ink | Hairline |
|---|---|---|---|
| paper | `#fff` | primary text | rgba(15,15,15,.06) + light shadow |
| graphite | `#252525` (lightbox toolbar grey) | light text | rgba(255,255,255,.08) |

Handles have no card, so their ink is inverted: a bright area gets a dark grey bar, a dark area a white bar.

Paper and graphite values live in two `.blok-image-inner [data-tone="…"]` rules in `image.css`, which
repoint the existing `--blok-overlay-*` tokens. No root tokens: `view.css` keeps every root token and
every attribute-only token rule, it sat at 55,881 of its 56,000-byte budget, and a static view has no
chrome. Keyed under a class, the rules prune from it (view.css stays byte-identical).
Handles paint with `--blok-overlay-fg`, which already inverts against the card. None may be blue.

## Reading the picture

### When

- On the image's `load`. Every edit re-renders the figure and loads again, so this covers edits.
- Not on resize. The result is stored in relative coordinates; resize and tier changes only re-map.

### What

1. Draw the visible picture into a canvas about 24 px on its long side:
   - only the cropped region;
   - the frame's rotation and flip, from the existing geometry helpers in `geometry.ts`, not read back from the DOM;
   - the image's CSS filter string as `ctx.filter`. **Measured 2026-10-05:** Chromium applies it;
     WebKit 26.5 accepts the property but ignores it, so Safari reads the unfiltered picture.
   - markup strokes are ignored.
2. Composite transparent pixels over the page colour behind the image.
3. Keep a brightness grid of the result.

### How a control decides

- Average the grid cells under the control's box: toolbar, Alt tag, left handle, right handle.
- Pick the tone that sits closer to the area: paper or graphite, whichever has LESS WCAG contrast
  against that average. A light area gets paper, a dark area graphite (as in mockup A).
  The switch point is at relative luminance ≈ 0.218.
- Write `data-tone="paper" | "graphite"` on the control.
- Re-map on resize (`observeOverlayWidth` sync) and tier change.

### Source of the pixels

- Same-origin, `data:` or `blob:` URL: read the visible `<img>` itself. No extra request.
- Cross-origin: load a hidden `Image` with `crossOrigin="anonymous"` and the visible image's
  `currentSrc`. The visible `<img>` never gets `crossOrigin`, so nothing that loads today stops loading.
  **Measured 2026-10-05** (CORS host, `Cache-Control: max-age=3600`): Chromium serves the copy from
  cache (one request to the host); WebKit makes a second request with an `Origin` header.

### Can't read

- The copy fails to load (host sends no CORS), or the canvas read throws: write no `data-tone`.
- No `data-tone` → CSS uses theme tokens: paper in light, graphite in dark. Same before load.

### Code

- `src/tools/image/tone.ts`: pure functions — brightness grid from pixel data, region average, tone choice.
- `src/tools/image/tone-sampler.ts`: picks the pixel source, draws the canvas, catches
  `SecurityError`, finds the page colour, stamps `data-tone`.
- `index.ts` calls it from the existing `load` handler and from `observeOverlayWidth`'s sync.

## Removed

- The liquid split: island `::before` cards, `::after` hourglass necks, merged `toolbar::after` bar.
- `reanchorTooltipAfterSplit` in `ui.ts`.
- The check-mark Alt pill look.

Kept: every `data-action` name (including the hidden `delete` alias), readout, snap guides,
alt hint, alt editor, block settings menu.

## Testing (TDD: each test fails first)

1. `tone.ts` units on synthetic pixels: white → paper; near-black → graphite; transparent takes the
   page colour; sky-over-ground gives toolbar and Alt different tones; a boundary case checked
   against the WCAG formula.
2. Sampler units: a throwing canvas read and a failed copy both give no grid; a cross-origin URL
   loads a copy with `crossOrigin="anonymous"`; a same-origin URL loads none.
3. CSS: paper/graphite tokens defined once and not blue; handle-ink token defined three times; no `::before`/`::after` card
   animation left on the toolbar; tier test still hides the same groups.
4. `test/playwright/tests/tools/image-chrome.spec.ts` rewritten:
   dark same-origin image → graphite toolbar; bright → paper; handles inverted;
   cross-origin with CORS (`127.0.0.1:4444` via `page.route` adding the header) → toned;
   cross-origin without CORS (`127.0.0.1:4444` as served) → no `data-tone`, theme look; "buttons don't move while the toolbar fades in";
   table-cell, first-block, resize, alt and reduced-motion tests kept and updated.
5. Runtime check in a real browser at DPR 2: Blok logo and a dark photo, light and dark themes,
   plus a WebKit pass for `ctx.filter`.

## Out of scope

Video and embed chrome, the darkroom, the block settings menu.

## Release note (owed, not BREAKING)

Image toolbar is one bar; handles sit inside the picture; Alt is a tag;
the chrome picks light or dark from the picture, and follows the editor theme when it can't read it.
