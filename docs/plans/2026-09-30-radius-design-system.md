# Radius design system

Status: accepted 2026-09-30 (decisions in §5). Foundation shipped in 490597d1; migration in progress.

Research behind it (all read from source or measured, 2026-09-30):

- `radius-research/radius-inventory-css.md` — every CSS radius (275 rows).
- `radius-research/radius-inventory-ts.md` — every radius set from TS (74 live).
- `radius-research/radius-nesting-audit.md` — 124 nested pairs, 58 violations.
- `radius-research/radius-external-research.md` — Notion measurements, 11 design systems, nesting sources.

## 1. What is wrong today

1. **Two scales share names but not values.** Blok: xs 4, sm 3, md 6, lg 12, xl 16. Tailwind: xs 2, sm 4, md 6, lg 8, xl 12. `rounded-lg` is 8px, `--blok-radius-lg` is 12px.
2. **The Blok scale is out of order.** `--blok-radius-xs` (4px) is bigger than `--blok-radius-sm` (3px).
3. **Radii come from anywhere.** 68 CSS rules use `--blok-space-*` spacing tokens as radii. 12 CSS rules and 14 TS inline styles use raw px. 23 TS classes use `rounded-[Npx]`. One rule uses a border-width token.
4. **One role, many values.** Popover cards are 10, 12 or 14. Menu rows are 6, 8 or 10. Small floating toolbars are 8, 9 or 12. Toolbar buttons are 5 (desktop) and 6 (mobile).
5. **Nested corners are not concentric.** 58 of 124 nested pairs break the rule. The most-seen one: popover items are 8px inside a 12px card with a 6px gap. They should be 6.
6. **Dev and build disagree.** The inline toolbar card is 12px in dev and 14px in the build, because the build flattens `@layer`.
7. **The Tailwind re-pin does not reach every root.** `isolation.css` pins `--radius-*` on the editor root, tooltip and popovers only. The link hover card and drag previews can be changed by a host page.

## 2. The three layers

Components use **role tokens** (layer 2). Role tokens use **primitives** (layer 1). Children of a rounded container use the **nesting rule** (layer 3). Nothing else sets a radius.

### Layer 1 — primitives

One ordered scale. Names are px values, like the spacing scale (`--blok-space-1-5`), so there is no clash with Tailwind names and no ordering trap.

| Token | Value | Tailwind class it backs |
|---|---|---|
| `--blok-radius-0` | 0 | `rounded-none` |
| `--blok-radius-2` | 0.125rem | `rounded-xs` |
| `--blok-radius-4` | 0.25rem | `rounded-sm`, `rounded` |
| `--blok-radius-6` | 0.375rem | `rounded-md` |
| `--blok-radius-8` | 0.5rem | `rounded-lg` |
| `--blok-radius-12` | 0.75rem | `rounded-xl` |
| `--blok-radius-16` | 1rem | `rounded-2xl` |
| `--blok-radius-full` | 9999px | `rounded-full` |

Names give the px at a 16px root. Values are in **rem** on purpose: Tailwind's radii and the `isolation.css` re-pin are rem, so they follow the host's root font size. Primitives in px would move every `rounded-*` class on a host whose root is not 16px. That would change a default.

- Micro notches (crop handles, find caret) keep `--blok-radius-hairline` (1.5px). It is not a step.
- Circles use `50%`. That is a shape, not a size, and stays a literal.
- Why these steps: they are Tailwind's own values, so re-pointing Tailwind's `--radius-*` at them changes nothing, at any root font size. They also cover Notion's measured values except 10 (see Decision 1).
- **Tailwind wiring.** `isolation.css` sets `--radius-xs: var(--blok-radius-2)` … `--radius-2xl: var(--blok-radius-16)` instead of literal rems. One scale, and a host that overrides a Blok primitive moves the Tailwind class with it. Add the link hover card and drag preview roots to that selector list.
- **Old tokens stay.** `--blok-radius-xs/sm/md/lg/xl/pill/md-plus/hairline/none` shipped in v1.15.2, so their values cannot change without a BREAKING release. They keep their exact current declarations (`xs` is already 0.25rem = `--blok-radius-4`; `sm` 3px, `md` 6px, `lg` 12px and the rest stay literal px) and are marked deprecated. Nothing in `src/` uses them after migration.

### Layer 2 — role tokens

A component picks its role, never a primitive.

| Role token | Value | Used by |
|---|---|---|
| `--blok-radius-dialog` | 12 | modal, leave banner, crop dialog, lightbox |
| `--blok-radius-surface` | 10 | popover and menu cards (desktop and mobile), inline toolbar card, toast card, emoji picker, link hover card, find bar, floating media toolbars, cards (bookmark, file, database column/add-card) |
| `--blok-radius-block` | 10 | block frames: callout, code, media-empty panel, audio, image, video, embed frames |
| `--blok-radius-field` | 8 | text inputs and search fields (32–36px tall) |
| `--blok-radius-control-lg` | 8 | buttons 36px and taller |
| `--blok-radius-control` | 6 | buttons 24–32px, menu rows, tabs, tooltips, block hover and selection fill around a square block |
| `--blok-radius-control-sm` | 4 | buttons and toggles up to 20px, tags, keyboard hints, toggle arrow, scrollbar thumb |
| `--blok-radius-mark` | 2 | inline marks: code span, find match, highlight, checkbox |
| `--blok-radius-pill` | full | pills, status chips, badges, avatars, round handles, progress tracks |

Height rule for controls (from Notion's button sizes): **≤20px → 4, 24–32px → 6, ≥36px → 8.** A control between these sizes takes the nearer step.

A mobile variant uses the same role. It does not get a separate radius (today the plus button is 5 on desktop and 6 on mobile; it becomes `control` on both).

### Layer 3 — the nesting rule

A child near a rounded parent's corner uses:

```
inner = max(floor, outer − border − gap)
```

`gap` is the distance from the parent's padding edge to the child's edge along that corner: parent padding plus child margin. `border` is the parent's border width. This is the CSS spec's own rule for the inner edge of one box (Backgrounds 3 §4.2), applied one box further.

- **Floor is 4px** (`--blok-radius-floor`). Below 4 a menu row looks square next to its card.
- **When `border + gap` is at least `outer`**, the child's corner sits outside the parent's curve. The child uses its own role token.
- **Pills and circles never derive.** Height/2 is their shape.
- **Derived values are exact, not snapped.** The scale governs radii that stand alone. A derived radius may land off the scale (12 − 7 = 5). The CSS below is a plain `calc()`, and the built-bundle check asserts the exact value.
- **The rule also runs outward.** A fill *around* a rounded child must be `child + gap`. The block selection fill lives on the content wrapper, an ancestor of the tool root, and CSS variables do not flow up. So a tool declares its frame radius and core writes it on the content wrapper as `--blok-radius-frame` (Decision 5). The fill uses `frame + gap`, or `control` when the block is square.

**How it is written in CSS.** The container publishes one variable for its children:

```css
[data-blok-popover-container] {
  border-radius: var(--blok-radius-surface);
  padding: var(--blok-space-1);
  --blok-radius-inner: max(
    var(--blok-radius-floor),
    calc(var(--blok-radius-surface) - var(--blok-space-1))
  );
}
[data-blok-popover-item] {
  border-radius: var(--blok-radius-inner, var(--blok-radius-control));
}
```

- The container computes `--blok-radius-inner` from its **own role and padding tokens**, never from `--blok-radius-inner`. Measured in Chrome 154: a variable defined from itself is a cycle and resolves to 0 from level 2 on.
- The fallback is the child's standalone role, so the same component still looks right outside a container.
- One level is enough. Nested menus are separate top-layer cards, not geometric children. A child that is itself a container sets its own radius from a role token, not from `--blok-radius-inner`, and publishes a fresh `--blok-radius-inner`.
- A container whose padding differs per side publishes the value for the **smallest** gap that reaches a corner.

### Worked values for the common gaps

| Container | Outer | Border + gap | Inner |
|---|---|---|---|
| Popover card (padding goes 6 → 4) | 10 | 4 | **6** (today card 12, items 8) |
| Popover card, mobile | 10 | 4 | **6** (today card 10, items 8) |
| Inline toolbar card | 10 | 8 | **4** (floor; today card 14 in build) |
| Find bar, lightbox bar | 10 | 6 | **4** |
| Video menu (1px border) | 10 | 7 | **4** (floor) |
| Small overlay toolbar (image align, embed) | 8 | 4 | **4** |
| Media-empty card, audio picker | 10 | 9 | **4** (floor; today 12) |
| Toast card | 10 | 11–13 | own role (gap ≥ outer; tile today 10) |
| Emoji picker | 10 | 11 | own role |
| Database column | 10 | 8 | **4** (floor; add-card today 12) |
| Segmented control track | 8 | 2–3 | **6 / 5** |

## 3. Enforcement (to build with the migration)

Same shape as the other architecture laws (`paste-stamp-law`, `table-cell-content-law`).

1. **`test/unit/architecture/radius-token-law.test.ts`** — static scan of tracked files in `src/` (skip untracked build scratch):
   - `border-radius` in CSS must be a `--blok-radius-*` role token, `var(--blok-radius-inner, …)`, `0`, `50%`, `inherit`, or `--blok-radius-hairline`.
   - No `--blok-space-*` or `--blok-border-width-*` inside a radius.
   - No `rounded-[…]` arbitrary class in TS or `@apply`.
   - No literal `borderRadius` in TS style objects.
   - Every exemption lists a reason. The scan is mutation-checked (plant a violation, see it fail).
2. **Built-bundle check** for the most-seen nested pairs: popover item, inline toolbar button, toast tile, find bar button. It reads computed `border-radius` and padding in a real browser and asserts `inner = max(4, outer − border − gap)`. jsdom returns empty CSS, so this must be e2e against the build.
3. **Order test**: the primitive scale is strictly increasing, and every Tailwind `--radius-*` re-pin resolves to a Blok primitive.

## 4. Migration plan

Per area, one subagent each, in this order (each is a small commit with its own test):

1. Primitives, role tokens, Tailwind re-pin, deprecated aliases (`colors.css`, `isolation.css`). No pixel changes.
2. Popover family: card, items, search field, mobile sheet, inline toolbar card and its menus, link tool rows, equation field.
3. Block chrome: toolbar plus/settings buttons, stub card, callout, code. The selection fill waits for Decision 5.
4. Media: image, video, audio, embed, bookmark, file, media-empty, crop editor, lightbox.
5. Database: cards, columns, pills, drag ghosts (inline styles move to CSS).
6. Toasts, emoji picker, find bar, table handles and pills, presence.
7. Turn on the law test with an empty exemption list.

Dead code found on the way. Delete it, do not migrate it:

- `toolbar/styles.ts` plusButton/settingsToggler keys.
- `database-view.ts` radii (only unit tests import it).
- `.blok-image-popover*` and `.blok-image-toolbar__pill` in `image.css`.
- `--blok-audio-radius` (never read).

Conflicts that must end with one source:

- Inline toolbar card: `rounded-[14px]` vs the popover's 12px rule.
- `[data-blok-database-add-card]`: declared as 8 then 12 in `database.css`.
- Database board card: CSS 8 vs inline 10.
- Audio vs video speed chips: 3 vs 6 for the same control.
- `embed.css:20` fallback `8px` vs `--blok-radius-md` 6px.

## 5. Decisions (user, 2026-09-30)

1. **Cards are 10px** (Notion). Popover padding goes from 6 to 4 so items stay at 6.
2. **The old `--blok-radius-*` names are removed** (xs, sm, md, lg, xl, md-plus, hairline, none). BREAKING, labelled in the commit that removes them. `--blok-radius-pill` stays as a role (now `var(--blok-radius-full)`).
3. **Floor is 4px.**
4. **Media frames use `--blok-radius-block` (10px)**, the same as callout and code, so every block frame has one radius. Chosen by Claude; Notion's image frame could not be measured.
5. **The selection fill follows a rounded block.** A tool declares its frame radius; core writes it on the content wrapper as `--blok-radius-frame`; the fill is `frame + gap`. `:has()` is avoided (subtree invalidation).

## 6. Unverified points

- The file Cancel/Retry pill heights, the database column pill height and the emoji footer height are estimates. Their deltas in the audit (+11, +9) depend on them.
- The selection-fill rows assume vertical margins collapse through the content wrapper.
- `corner-shape: superellipse` is Chrome-only. Subtraction is only approximately right for it. Blok does not use it.
