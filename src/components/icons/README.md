# Keyline

Blok's editor icons form one light line family, Keyline. Every icon is built
from the same few frames, so a circle icon, a square icon and a tall icon look
equally big. Design each icon for a menu at 20 px, not for a large
illustration. Keep silhouettes familiar and interiors open.

## Construction

| Part | Rule |
| --- | --- |
| Standard canvas | `viewBox="0 0 20 20"`, width and height 20 |
| Stroke | 1.25 units, `currentColor`, round caps and joins |
| Live area | x/y 3–17; coordinates snap to 0.25 |
| Circle | Center (10, 10), radius 7 |
| Square | x 3.5, y 3.5, 13 × 13, radius 2.5 |
| Landscape panel | x 3, y 4.5, 14 × 11, radius 2.5 (table, image, callout, calendar, views, layouts) |
| Page | x 4.5, y 3, 11 × 14, radius 2, no fold. A Blok page |
| File | The page with a folded corner (`M11 3v2.5a2 2 0 0 0 2 2h2.5`). A file on disk; every file type uses it |
| Inner content | Inside a panel: x 5.5–14.5, y 7–13. Small inner rects use radius 1.5 |
| Chevron | 3.5-unit arms at 90°, e.g. `M8.25 6.5 11.75 10l-3.5 3.5`; rotate or mirror the same skeleton |
| Arrow | 12-unit shaft with a 3.5-unit 90° head. Short arrows: an 8-unit shaft. The timeline's small arrows are the exception: a 12.5-unit shaft and 5.5-unit head, so they still read in a 14 × 12 px box |
| Plus, cross | Plus 12 long; cross 9 per axis |
| Dots | Accent dot radius 1. Radius 1.25 when the dots are the whole icon (more menu, grips) |
| Type | Cap 4.5, baseline 15.5. H stems at x 3.5 and 10. Heading numerals sit in x 12.75–16.25, y 9.5–15.5 at the same 1.25 stroke |
| Toggle headings | The toggle-list triangle at x 3–6, H stems at x 8.25 and 11.75, numerals in x 14–17 |
| Lists | Bulleted and checklist: three rows at y 5, 10 and 15, rules from x 9 to 16.5. Numbered and toggle lists: two rows at y 6.5 and 13.5 |
| Table | Grid lines at y 9 and 12.25, column at x 7.5. A header row or column is marked by a short rule inside its band, never a solid bar |
| Gaps | Neighboring features at least 2.25 apart centre to centre (one stroke of clear space) |

These are key shapes. They do not mean every icon must sit in a box. A document
is tall, a screen is wide. A disclosure chevron is deliberately smaller than
a framed tool icon.

Use one path per continuous stroke. Do not draw a shared edge twice.

Solid fills are allowed only where they carry meaning: accent dots, play and
toggle triangles, the quote marks, and the filled state of a twin (star, pin,
checkbox). A filled twin is the same outline with `fill="currentColor"` added,
so both states are the same size. Never use a solid bar or panel for structure.
Do not use opacity tints, gradients, font glyphs, embedded images, or external
SVG references.

The quote marks are one filled shape each: a round bowl with a tail that
tapers to a point. Draw the bowl and the tail as one outline, so no seam shows
where they meet.

## Optical sizes

Existing exports keep their sizing contracts:

- Standard icons: 20-unit canvas / 1.25 stroke, intrinsic width and height 20.
- Overlay icons: 24-unit canvas / 1.5 stroke and no intrinsic width or height,
  so CSS sizes them. They use the same 6.25% stroke ratio, so they look
  identical to the 20-unit icons at the same display size. This is why an
  overlay icon must never be a 1.2x copy of one. Import the 20-unit export
  instead. The overlay container already sets a pixel size.
- Heading and script numerals may use 1.1 or 1.05; numbered-list markers use 1.05.
  These small counters need more space than full-size letters.

One family has its own weight: the emoji picker's category row
(`IconEmojiNav*`) uses a 1.5 stroke. The row is read at 18 and 20 px with no
labels, and a 1.25 stroke smudges there. Where a category has an `IconEmoji*`
twin, the nav icon reuses its geometry; check the gaps at 1.5, because they
shrink by a quarter unit. Do not use the 1.5 weight anywhere else.

Do not copy a micro-icon's thicker proportional stroke into a normal menu
icon. Do not change a published icon's intrinsic dimensions to fix a drawing.
Adjust its geometry instead.

## Authoring

1. Find the closest relative in `index.ts`. If an existing icon already draws
   what you need, import that one. The same export may be used in as many
   places as it fits. A second name for one drawing is rejected by
   `test/unit/architecture/icon-no-duplicate-drawings.test.ts`. Otherwise reuse
   its frame, arrow, numeral, or circle before drawing a new one.
   Heading/toggle numerals match exactly. Script numerals are scaled from the
   heading skeleton.
2. Draw the fewest features that clearly explain the action. Look at the
   result without its label. Neighboring icons must remain distinguishable.
3. Export a static SVG string from `index.ts`. Keep paint inside the SVG:
   `fill="none"`, explicit `stroke="currentColor"` on stroked shapes, and
   `fill="currentColor"` on solid accents.
4. Add `aria-hidden="true"` and `focusable="false"` to the root. The enclosing
   control supplies its accessible name.
5. Add the name to `iconGroups` in the playground's `index.html`.
6. Run `node scripts/generate-icons-dts.mjs` after adding, removing, or
   renaming an export. Never rename a public icon just to refresh its drawing.
7. Add a test for the relationship the new drawing relies on, such as matching
   frames, shared numeral geometry, or the gap between two outlines.

## Copies and couplings

Some drawings are copied or reached into outside this file. Change them
together:

- `src/shared/tool-classes/page.ts`: `PAGE_FALLBACK_ICON` equals `IconPage`
  and `PAGE_LOCK_ICON` equals `IconLock`. The Go server embeds them, so rebuild
  its runtime bundle and the documents fixture after a change.
- `src/styles/field.css` draws `IconSearch` as a mask; `src/styles/checklist.css`
  draws `IconCheck` at half size.
- `src/components/utils/volume-icon.ts` rebuilds the two wave arcs of
  `IconPlayerVolume`; keep them as two absolute arcs.
- `src/components/modules/assistant/skill-icons.ts` names each shape of the
  `IconAskAi*` icons in order and draws extra strokes on their grid.
- `src/styles/assistant.css` hides `IconCheck` with a dash at least as long as
  its stroke.
- `src/tools/file/ui.ts` splits `IconDownload` at its tray (`M3.5 13`).
- `IconPaintRoller`'s first `rect` is the colour chip the marker tool fills.
- `IconTrash` keeps `data-blok-icon-lid` and `IconEmojiDice` keeps its
  `data-blok-dice-*` hooks for their animations.

## Review

Open `/icons` in the playground. Use the size controls to compare the whole
group at 16, 20 and 24 px. Then inspect individual icons in the lightbox.
Check light and dark backgrounds. Large previews help find rough curves.
Small previews decide whether the icon works.

Ask:

- Does it have the same apparent weight as its neighbors?
- Are openings still visible at 16 px?
- Do repeated parts match their relatives?
- Is its meaning clear without adding tiny decorative details?
- Do custom host colors work without relying on surrounding SVG CSS?

`test/unit/components/icons/icon-line-system.test.ts` checks every exported
icon's grid, paint and allowed stroke weights. The type, layout and media
tests check relationships within each family. Mechanical checks prevent
drift. They do not replace looking at the actual pixels.

This guide covers editor-owned icons. Host-supplied toolbox icons, brand
marks, keyboard keycaps and the docs site's separate React icons are not
rewritten or constrained by this contract.
