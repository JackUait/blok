# Blok Line

Blok's editor icons are one light, precise line family. Design for a menu at
16 px, not a large illustration. Keep silhouettes familiar and interiors open.

## Construction

| Part | Rule |
| --- | --- |
| Standard canvas | `viewBox="0 0 20 20"`, width and height 20 |
| Stroke | 1.25 units, `currentColor`, round caps and joins |
| Main content | Usually inside x/y 3–17; optically center the drawing |
| Panel | x 3, y 4, width 14, height 12, radius 2 |
| Small panel | Radius 1; leave room between neighboring outlines |
| Circle | Center (10, 10), radius 6.5 for a standalone circular symbol |
| Type | Cap 5, baseline 15; B, I, H and T share the same weight |
| Lists | Two rows at 6.5 and 13.5, rules from x 8.5 to 16.5 |
| Disclosure chevron | Four-unit arms on the 20-unit canvas; rotate or mirror the same skeleton |
| Detail | Prefer fewer, larger details over dense miniatures |

These are key shapes, not a command to put every icon in a box. A document is
tall, a screen is wide, and a disclosure chevron is deliberately smaller than
a framed tool icon.

Use one path per continuous stroke. Do not draw a shared edge twice. Keep
separate features at least one stroke width apart where possible. Filled dots,
play controls and highlighted regions carry meaning; do not use solid fills
to make a letter or outline heavier. No opacity tints, gradients, font glyphs,
embedded images, or external SVG references.

## Optical sizes

Existing exports keep their sizing contracts:

- Standard icons: 20-unit canvas / 1.25 stroke, intrinsic width and height 20.
- Overlay icons: 24-unit canvas / 1.5 stroke and no intrinsic width or height,
  so CSS sizes them. Same 6.25% stroke ratio, so they look identical to the
  20-unit icons at the same display size — which is why an overlay icon must
  never be a 1.2x copy of one. Import the 20-unit export instead; the overlay
  container already sets a pixel size.
- `IconDice`: 14-unit canvas / 1 stroke.
- `IconChevronRightSmall`: 12-unit canvas / 1 stroke.
- `IconCloseThick`: 24-unit canvas / 1.75 stroke, displayed intrinsically at 14 px.
- Heading and script numerals may use 1.1 or 1.05; numbered-list markers use 1.05.
  These small counters need more space than full-size letters.

Do not copy a micro-icon's thicker proportional stroke into a normal menu
icon. Do not change a published icon's intrinsic dimensions to fix a drawing.
Adjust its geometry instead.

## Authoring

1. Find the closest relative in `index.ts`. If an existing icon already draws
   what you need, import that one — the same export may be used in as many
   places as it fits, and a second name for one drawing is rejected by
   `test/unit/architecture/icon-no-duplicate-drawings.test.ts`. Otherwise reuse
   its frame, arrow, numeral, or circle before drawing a new one.
   Heading/toggle numerals match exactly; script numerals are scaled from the
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

## Review

Open `/icons` in the playground. Compare the whole group at 16, 20 and 24 px
using the size controls, then inspect individual icons in the lightbox.
Check light and dark backgrounds. Large previews help find rough curves;
small previews decide whether the icon works.

Ask:

- Does it have the same apparent weight as its neighbors?
- Are openings still visible at 16 px?
- Do repeated parts match their relatives?
- Is its meaning clear without adding tiny decorative details?
- Do custom host colors work without relying on surrounding SVG CSS?

`test/unit/components/icons/icon-line-system.test.ts` checks every exported
icon's grid, paint and allowed stroke weights. The type, layout and media
tests check relationships within each family. Mechanical checks prevent
drift; they do not replace looking at the actual pixels.

This guide covers editor-owned icons. Host-supplied toolbox icons, brand
marks, keyboard keycaps and the docs site's separate React icons are not
rewritten or constrained by this contract.
