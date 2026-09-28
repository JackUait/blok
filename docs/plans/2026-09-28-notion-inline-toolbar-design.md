# Notion-style inline toolbar — design

Date: 2026-09-28. Status: approved in brainstorming, awaiting spec review.

## Goal

Rebuild the inline (selection) toolbar to look, feel and behave like Notion's.
Today it is a single wrapping row (`f20a150b`, 2026-09-07). It becomes a
vertical card with a convert row and a 5×2 grid of formatting cells, a clear
active state, real entrance and move motion, and a Notion-style color panel.

## Reference: Notion, measured

Measured in the live Notion app (build 23.13, 2026-09-28) through the user's
signed-in browser. These numbers are the target.

- Card: 192px wide, 8px padding, 14px radius, white.
- Shadow: `0 20px 24px rgba(25,25,25,.05), 0 5px 8px rgba(25,25,25,.027), 0 0 0 1px rgba(42,28,0,.07)`.
- Convert row: full width, 28px tall, 14px text, chevron `›`.
- Grid: 5 columns, cells 32×28, 4px gaps, 6px radius.
- Hover: background about 5% ink (`rgba(33,27,23,.05)`), `transition: background 20ms ease-in`.
- Color "A" opens one panel under the cell, overlapping the card: Recently used,
  Text color (5×2), Background color (5×2). The current color has a dark ring.
- Entrance: a ~3px upward drift was observed. Where the fade runs was not found.

Not verified: tooltips (never appeared over the extension relay) and Notion's
active-format color (checking it would have edited the user's page).

Out of scope: Notion's Comment row, AI skills, and the "…" block-actions cell.
Blok has nothing behind the first two, and the ☰ handle already opens block
actions.

## 1. Layout and look

```
┌──────────────────────────────┐
│ T  Text                    › │  convert row, spans all 5 columns
├──────────────────────────────┤  horizontal hairline
│ [A]   B    I    U    Tx      │  marker, bold, italic, underline, clearFormat
│  🔗   S   </>   √x   x²      │  link, strikethrough, inlineCode, equation, supSub
└──────────────────────────────┘
```

- Grid: `grid-cols-[repeat(5,32px)]`, 4px gaps, cells 32×28, 6px radius.
- Cell order: marker, bold, italic, underline, clearFormat / link, strikethrough,
  inlineCode, equation, supSub. This is Notion's order with supSub in the "…"
  slot. `INLINE_TOOL_ORDER` and `defaultInlineTools` change to match.
- Consumer custom tools go on extra rows of five below. The card width never
  grows past five cells.
- Card: 14px radius, 8px padding, Notion's three-layer shadow. Dark mode gets
  matching values from existing color tokens.
- Hover: ~5% ink fill, ~20ms.
- Active format: the icon turns the accent (blue) color on a faint accent fill.
- Convert row: current block icon + name (medium weight) + `›` chevron.
- Separators are horizontal again; `aria-orientation` becomes `horizontal`.
- Mobile keeps the same card; it only follows the existing mobile placement.

Lives in: `cssInline` (`src/components/utils/popover/popover.const.ts`),
`PopoverInline.styleConvertControl` (`src/components/utils/popover/popover-inline.ts`),
separator const, `src/styles/colors.css` for the shadow and state tokens.

## 2. Behavior and motion

**Placement.** Below the selection, left edge at the selection start. Flips
above only when it does not fit (existing `InlinePositioner` logic). Anchored
to the selection, not the pointer, so a keyboard selection places it the same.

**Entrance.** About 140ms: opacity 0→1, 4px rise, scale 0.98→1. Transform
origin is top-left when below the selection, bottom-left when flipped above.
Exit is a ~100ms fade. The existing ghost hand-off (`toolbar-ghost.ts`) stays.
This replaces the "inline toolbar appears instantly" rule in
`src/styles/popover-animation.css`. `prefers-reduced-motion`: no animation.

**Moving while open.** A new selection while the toolbar is open makes it
glide to the new place, about 160ms ease-out. If the side changes
(below ↔ above) it snaps instead.

**Submenus.**
- Color (A): panel opens under the A cell, overlapping the lower card.
- Convert row: "Turn into" opens beside the card on the right, flipping left at
  the viewport edge.
- Link: unchanged (URL field under the card).
- Clicking the same cell again closes its submenu (unchanged).

**Unchanged.** Hints (name + shortcut, above the cell). Keyboard: Tab / Up /
Down / Enter. Left/Right stay with the caret on purpose.

Must not regress: the stale-selectionchange / Escape fix (`25882910`) and the
`PopoverEvent.Closed` state sync in `src/components/modules/toolbar/inline/index.ts`.

## 3. Color panel

The shared `createColorPicker` (`src/components/shared/color-picker.ts`) drops
the Text / Background tabs (`c822540e`) and becomes one untabbed panel,
everywhere it is used (marker, table cells, callout, block settings).

- Sections, stacked: Recently used (if any), Text color, Background color.
- Each grid is 5×2: `[default, ...9 presets]`, as today. No data change.
- Text swatches show "A" in the color. Background swatches are filled squares.
- The current color has a dark ring. There is no "selected" row or reset
  button; choosing the default swatch resets.
- Recently used keeps its storage (`blok-recent-colors`) and behavior.
- The toolbar's A cell reflects the selection: glyph in the text color, tile in
  the background color.
- The panel is ~250px tall. Near the viewport bottom it flips above the cell.

Breaking check before implementation: the `<prefix>-reset-*` test ids go away.
Confirm they are not a published surface (`types/`, docs) with
`git log v1.15.2..HEAD` and a search of `types/` and `docs/`. If they are
published, flag it to the user as BREAKING before landing.

## 4. Testing

TDD: each change starts with a failing test.

1. Unit, `test/unit/utils/popover-inline.test.ts`: 5-column grid, convert row
   spans all columns, horizontal separators, extra rows for custom tools with
   fixed width, `›` chevron.
2. Unit, `inline-tools-order.test.ts`: the new cell order.
3. Unit, color picker: untabbed sections, 10 swatches per section, no reset
   row, ring on the current color, A cell reflects the selection.
4. Unit, positioner: glide on same side, snap on flip, entrance origin by side.
5. E2E (chromium), new spec: cell and card geometry, below/above placement,
   active state color, color panel under the A cell, Turn into beside the card
   and flipping at the right edge, viewport extremes (narrow width; selection
   at top, bottom and right edges).
6. Motion: entrance and glide via computed styles; none under reduced motion.

Test rot to rewrite (not patch): `test/playwright/tests/inline-tools/menu-grid-redesign.spec.ts`,
`control-redesign.spec.ts`, `color-picker-redesign.spec.ts`, the
`activateColorTab` helper and its callers, and the picker stories.

Known pre-existing flake, not ours: `inline-toolbar.spec.ts` "reflects inline
tool state changes".

Final check: build, then compare against Notion side by side (element
screenshots and measured numbers).
