# Corner radius: external research for Blok's radius tokens

Gathered 2026-09-30. Every value below comes from a primary source fetched or measured in this session. The source is linked next to each claim. Anything I could not verify is labelled **UNVERIFIED**.

Method notes:
- WebSearch and WebFetch were unavailable (quota). I pulled token source files straight from GitHub, npm (unpkg / registry tarballs) and vendor CDNs with `curl`. I read spec text from the CSSWG drafts.
- Notion values came from two places:
  - Notion's production JS bundle, downloaded from a public notion.site (2,413 chunks).
  - Computed styles on public notion.site pages, read in headless Chromium through `playwright-cli`.
- rem values are converted at a 16px root.

---

## 1. Notion's actual radii

### 1a. Notion's own radius token object (production bundle)

Module `152996` in `https://brickspacelab.notion.site/_assets/7761-d5ea67d9202a3e10.js` contains:

```js
Vq: { mini: 3, small: 4, default: 6, medium: 8, large: 12, max: 16 }
```

Chunk hashes change on every Notion deploy, so this exact URL will rot.

The scale is real, but code rarely references it. I counted 14 `Vq.*` references across the whole bundle. Components mostly hard-code literals:

| literal | occurrences |
|---|---|
| `borderRadius:6` | 581 |
| `borderRadius:4` | 515 |
| `borderRadius:8` | 418 |
| `borderRadius:12` | 258 |
| `borderRadius:10` | 148 |
| `borderRadius:3` | 68 |
| `borderRadius:999` | 66 |
| `borderRadius:2` | 59 |
| `borderRadius:16` | 54 |

The popover's measured 10px is **not** on the `Vq` scale.

### 1b. Notion's button size table (production bundle)

Module `399411` in `https://www.notion.so/_assets/99676-3b72b92f44842479.js` defines radius by size:

```js
radius  = { xxs:4, xs:4, sm:6, md:6, lg:6, xl:8 }
height  = { xxs:16, xs:20, sm:24, md:28, lg:32, xl:36 }
padX    = { xxs:4, xs:6, sm:6, md:8, lg:12, xl:12 }
// shape "pill" → borderRadius 9999, padX + 2
```

This is direct evidence of **size-dependent radius**:

| button height | radius |
|---|---|
| 16–20px | 4 |
| 24–32px | 6 |
| 36px | 8 |

### 1c. Measured computed radii on public notion.site pages

Measured in headless Chromium, 2026-09-30. These are published-page renders, not the logged-in editor, so the editor may differ in places (**UNVERIFIED**).

Pages used:
- https://brickspacelab.notion.site/Adding-custom-CSS-3121c6e89c384649b329164edbf389b4
- https://brickspacelab.notion.site/Paper-Help-center-84ce6b9217574833a7d9b9f4053cb403
- https://brickspacelab.notion.site/Installing-a-custom-font-ace1184beabc440ca7bd49dd7fc7b269
- https://brickspacelab.notion.site/p/cdfeea8101ae465f8880ac90ce22e951
- https://notion.notion.site/77dd69d1250d4d48b3bfe6a74356d503
- https://joicedigitals.notion.site/Reading-Tracker-17adcda426104f309993162396fc3f38

| Element | Radius | Size / notes | Confidence |
|---|---|---|---|
| Popover / menu card (sort menu, `role=dialog`) | **10px** | 290 wide, shadow, padding 0 | High (measured) |
| Menu item (`role=menuitem`) | **6px** | 282×28. 4px inset each side inside the 290px card | High (measured) |
| Buttons inside popover | 6px | 28–32 tall | High |
| Tooltip | **6px** | 27 tall, dark fill, padding 5px 8px | High (measured) |
| Callout block | **10px** | Filled, 1px border. Icon button inside is 4px | High (measured, 5 pages) |
| Code block | **10px** | Wrapper and fill both 10px | High (measured, 2 pages) |
| Generic block hover/selection surface | 6px | Same 6px DIV on text, header, list and toggle blocks, so it is not toggle-specific | High |
| Toggle arrow button | 4px | The toggle's own control | High |
| Database view tabs | 20px on 32px height | Effectively a pill (20 > 32/2) | High |
| Filter / sort icon buttons | 6px | 28×28 | High |
| Select / multi-select tag | 4px | 20 tall | High |
| Status pill | 9px | 18 tall, so h/2 (pill) | High |
| Checkbox | 3px on 14px; 1.5px on 16px (two variants seen) | | Medium |
| Page icon (record icon) | 3.5–5px | 18–24px icons. 4px on 36–140px icons | High |
| Calendar event card | 6px | Shadow | Medium |
| Cookie toast (not editor UI) | 8px | | High |
| Image block, embed, gallery card | **NOT MEASURED.** Cloudflare's "Just a moment…" challenge blocked the gallery/mood-board template pages. Bundle style-key tallies only: `galleryCard`→6, `imageContainer`→4/"6px", `video`→12, `imagePreview`→4/6/8 | | **Low** |
| Modal / dialog | Bundle keys `modalStyle`→12 (×15), `modalInner`→12, `dialog`→12 | | Medium (bundle only, not measured) |

Observation, not Notion's stated intent: the popover follows the concentric rule exactly. Card 10 − inset 4 = item 6, with the item 282 wide inside a 290 card.

---

## 2. Radius scales of major systems

### 2a. Per-system scales, with sources

| System | Steps (name = px) | Source |
|---|---|---|
| **Notion** (internal `Vq`) | mini 3, small 4, default 6, medium 8, large 12, max 16 | bundle module 152996 (§1a) |
| **Material Design 3** | none 0, extra-small 4, small 8, medium 12, large 16, large-increased 20, extra-large 28, extra-large-increased 32, extra-extra-large 48, full | Web tokens v0.192 (none…extra-large, full = 9999px): https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-shape.scss. Expressive additions 20/32/48: https://github.com/material-components/material-components-android/blob/master/lib/java/com/google/android/material/shape/res/values/dimens.xml. Android `Corner.Full` = **50%**, while web uses 9999px. On a non-square box, a percentage gives an ellipse, not a pill. |
| **Tailwind CSS v4** | xs 2, sm 4, md 6, lg 8, xl 12, 2xl 16, 3xl 24, 4xl 32 (rem ×16) | https://github.com/tailwindlabs/tailwindcss/blob/main/packages/tailwindcss/theme.css. Bare `--radius: 0.25rem` sits in the file's `/* Deprecated */` block. |
| **Radix Themes** | radius-1…6 = 3, 4, 6, 8, 12, 16 × `--scaling` × `--radius-factor` | https://github.com/radix-ui/themes/blob/main/packages/radix-ui-themes/src/styles/tokens/radius.css |
| Radix `radius` prop → factor | none 0, small 0.75, medium 1 (default), large 1.5, full 1.5 plus `--radius-full: 9999px` | same file; default `medium` in https://github.com/radix-ui/themes/blob/main/packages/radix-ui-themes/src/components/theme.props.tsx. Scaling options 90–110%, default 100%. |
| **shadcn/ui** (current) | `--radius` = 0.625rem (10). sm ×0.6 = 6, md ×0.8 = 8, lg ×1 = 10, xl ×1.4 = 14, 2xl ×1.8 = 18, 3xl ×2.2 = 22, 4xl ×2.6 = 26 | https://ui.shadcn.com/docs/theming ; https://github.com/shadcn-ui/ui/blob/main/apps/v4/app/globals.css |
| shadcn/ui (before 2026-02-20) | sm = r−4, md = r−2, lg = r, xl = r+4, 2xl = r+8, 3xl = r+12, 4xl = r+16. So at 10: 6, 8, 10, 14, 18, 22, 26 | Commit `76ba624d` changed the formula from additive to multiplicative: https://github.com/shadcn-ui/ui/commit/76ba624d (packages/shadcn/src/utils/updaters/update-css-vars.ts) |
| **GitHub Primer** | small 3, medium 6 (= `default`), large 12, full 9999 | https://github.com/primer/primitives/blob/main/src/tokens/functional/size/radius.json5. Usage: small = "badge, tag, label, small-input… under 16px height"; medium = "button, input, textarea, select, card"; large = "dialog, modal"; full = "avatar, pill-badge". |
| **Atlassian** (@atlaskit/tokens 20.1.0) | radius.xsmall 2, small 4, medium 6, large 8, xlarge 12, xxlarge 16, full 9999, tile 25% | https://unpkg.com/@atlaskit/tokens@20.1.0/dist/esm/artifacts/tokens-raw/atlassian-shape.js. Usage text is in §2c. The legacy `border.radius.*` names are **not present** in 20.1.0's token-names file; their old values are **UNVERIFIED**. |
| **IBM Carbon** (@carbon/layout, styles 1.116.0) | border-radius-00 0, -02 2, -04 4, -08 8, -16 16, -24 24, -max 999999px | https://unpkg.com/@carbon/layout/scss/generated/_border-radius.scss. Default v11 buttons are **square** (`$button-border-radius: 0`). Radius appears mostly behind the `enable-v12-release` flag. |
| **Fluent 2** (@fluentui/tokens) | None 0, Small 2, Medium 4, Large 6, XLarge 8, 2XLarge 12, 3XLarge 16, 4XLarge 24, 5XLarge 32, 6XLarge 40, Circular 10000px | https://github.com/microsoft/fluentui/blob/master/packages/tokens/src/global/borderRadius.ts |
| **Ant Design** (seed 6) | borderRadiusXS 2, SM 4, (base) 6, LG 8, borderRadiusOuter 4 | seed: https://github.com/ant-design/ant-design/blob/master/components/theme/themes/seed.ts ; derivation: https://github.com/ant-design/ant-design/blob/master/components/theme/themes/shared/genRadius.ts (LG = base+2 for 6–15, capped at 16; SM stepped 4/5/6/7/8; XS 1 or 2) |
| **Open Props** | radius-1 2, -2 5, -3 16, -4 32, -5 64, -6 128, round 1e5px, plus `--radius-conditional-*` = `clamp(0px, calc(100vw - 100%) * 1e5, var(--radius-N))` (drops to 0 when the box is full-bleed) | https://github.com/argyleink/open-props/blob/main/src/props.borders.js |
| **Linear** (marketing site only) | --radius-4, -6, -8, -12, -16, -24, -32, rounded 9999px, circle 50% | CSS served on https://linear.app/ (static.linear.app/web/_next/static/css/*.css, fetched 2026-09-30). **The in-app scale is UNVERIFIED.** |
| **Figma UI3** | **UNVERIFIED.** I found no published source. | — |
| **Apple HIG / Liquid Glass** | No published px scale. Apple defines three shape *types* instead (§3a). **UNVERIFIED:** any px scale for Apple. | WWDC25 session 356; SwiftUI `ConcentricRectangle` docs |

### 2b. Comparison matrix, aligned by px value

Cells hold the system's token name. "—" means the system has no step at that value. Defaults are used: Radix medium ×1, shadcn `--radius` 10px, Ant seed 6.

| px | Notion Vq | Notion measured | MD3 | Tailwind v4 | Radix | shadcn | Primer | Atlassian | Carbon | Fluent 2 | Ant | Open Props | Linear (site) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | — | — | none | (rounded-none) | none factor | — | — | — | 00 | None | — | — | — |
| 2 | — | checkbox (1.5–3) | — | xs | — | — | — | xsmall | 02 | Small | XS | 1 | — |
| 3 | mini | checkbox 3 | — | — | 1 | — | small | — | — | — | — | — | — |
| 4 | small | tag, toggle arrow, small buttons | extra-small | sm | 2 | — | — | small | 04 | Medium | SM, Outer | — | 4 |
| 5 | — | — | — | — | — | — | — | — | — | — | — | 2 | — |
| 6 | default | menu item, tooltip, buttons 24–32, hover surface | — | md | 3 | sm | medium/default | medium | — | Large | base | — | 6 |
| 8 | medium | toast, 36px button | small | lg | 4 | md | — | large | 08 | XLarge | LG | — | 8 |
| 10 | — | **popover, callout, code block** | — | — | — | lg (= --radius) | — | — | — | — | — | — | — |
| 12 | large | modal (bundle) | medium | xl | 5 | — | large | xlarge | — | 2XLarge | — | — | 12 |
| 14 | — | — | — | — | — | xl | — | — | — | — | — | — | — |
| 16 | max | — | large | 2xl | 6 | — | — | xxlarge | 16 | 3XLarge | — | 3 | 16 |
| 18 | — | status pill (h/2) | — | — | — | 2xl | — | — | — | — | — | — | — |
| 20 | — | view tabs (pill) | large-increased | — | — | — | — | — | — | — | — | — | — |
| 24 | — | — | — | 3xl | — | — | — | — | 24 | 4XLarge | — | — | 24 |
| 28 | — | — | extra-large | — | — | — | — | — | — | — | — | — | — |
| 32 | — | — | extra-large-increased | 4xl | — | — | — | — | — | 5XLarge | — | 4 | 32 |
| 48 | — | — | extra-extra-large | — | — | — | — | — | — | — | — | — | — |
| full | (999/9999 literals) | pills | full | full | --radius-full 9999 | — | full | full | max | Circular | — | round | rounded |

Pattern: almost every desktop system has a 2 / 4 / 6 / 8 / 12 / 16 core. Notion's measured UI adds **10** for floating surfaces and content blocks.

### 2c. How systems map component classes to steps

- **Atlassian**, verbatim token descriptions:
  - xsmall 2 = "badges, checkboxes, avatar labels, keyboard shortcuts".
  - small 4 = "labels, lozenges, timestamps, tags, dates, tooltip containers, imagery inside a table, compact buttons".
  - medium 6 = "buttons, inputs, text areas, selects, navigation items, smart links".
  - large 8 = "cards, in-page containers, floating UI, dropdown menus".
  - xlarge 12 = "full-page containers, large containers, modals, Kanban columns, tables".
  - xxlarge 16 = "video player containers".
  - full = "avatars, … emoji reactions".
- **Primer**: see §2a. Small is for elements "under 16px height", and the rule text says "Do NOT use for buttons or cards".
- **Notion** (measured): 4 for tags and small controls, 6 for items, tooltips and controls, 10 for popovers and callout/code containers, 12 for modals (bundle).

---

## 3. The nested / concentric radius rule

### 3a. Primary sources for the rule

- **CSS Backgrounds 3, §4.2 Corner Shaping** (https://drafts.csswg.org/css-backgrounds-3/#corner-shaping). The browser applies the rule itself inside one box:
  > "The padding edge (inner border) radius is the outer border radius minus the corresponding border thickness. In the case where this results in a negative value, the inner radius is zero. … Likewise the content edge radius is the padding edge radius minus the corresponding padding, or if that is negative, zero."

  So **the border width counts toward the gap**. A child that fills a bordered, padded box should get `outer − border − padding`, clamped at 0.
- **Apple, WWDC25 session 356 "Get to know the new design system"** (transcript at https://developer.apple.com/videos/play/wwdc2025/356/):
  - "By aligning radii and margins around a shared center, shapes can comfortably nest within each other."
  - "We use three shape types to build concentric layouts: fixed shapes have a constant corner radius. Capsules use a radius that's half the height of the container. And concentric shapes calculate their radius by subtracting padding from the parent's."
  - Fallback: "use a concentric shape with a fallback radius. The concentric value adapts when nested, and the fallback kicks in when the component stands alone."
  - Desktop density: "in dense desktop environments, [capsules are] best used for standout actions. On macOS, Mini, Small, and Medium controls will continue using rounded rectangles … a great fit for compact, high-density layouts."
- **SwiftUI `ConcentricRectangle`** (https://developer.apple.com/documentation/swiftui/concentricrectangle):
  - Definition: a corner is concentric "when the corner's radius shares a common center with the containing shape's rounded corner radius".
  - When the shape's corners are far from the container's corners, "the corner radius the system calculates may be zero. When that happens, the corner is square". The docs offer a concentric corner "constrained with a minimum radius".
  - Note: the HIG *Layout* page (fetched as JSON) does **not** contain the concentric guidance. Cite the WWDC session and the SwiftUI docs instead.
- **Cloud Four, Paul Hebert, "The Math Behind Nesting Rounded Corners"** (2022-10-26, https://cloudfour.com/thinks/the-math-behind-nesting-rounded-corners/):
  - Gives `outerRadius - gap = innerRadius` and `--inner-radius: calc(var(--outer-radius) - var(--padding))`.
  - Raises the open design-token question: store inner and outer tokens, or one token plus `calc`?
- **Chris Coyier, "The Classic Border Radius Advice, Plus an Unusual Trick"** (Frontend Masters, 2024-05-13, https://frontendmasters.com/blog/the-classic-border-radius-advice-plus-an-unusual-trick/):
  - Gives `outer = inner + padding`.
  - The caveat: "If your outer is 10px and the padding is any more than 10px (highly common), that means the inner is 0 and zero just doesn't feel right either."
- **Adam Argyle, "A use case for CSS overflow-clip-margin, nested border radii"** (2023-03-07, https://nerdy.dev/perfect-nested-radius-with-overflow-clip-margin): `overflow: clip; overflow-clip-margin: content-box` clips children to the content-edge curve, so children need no radius at all. He notes "no Safari".
- **30 seconds of code, "Perfect nested border radius in CSS"** (https://www.30secondsofcode.org/css/s/nested-border-radius/): the same formula with a custom-property example.
- Secondary only: 92learns, "Border Radius Rules Every Designer Must Know" (2026-02-11, https://blog.92learns.com/border-radius-rules/). It suggests a 2–4px floor instead of 0. That is opinion, not a primary source.

### 3b. Edge cases

| Case | What the sources say | Token/CSS consequence |
|---|---|---|
| padding (+ border) ≥ outer radius | CSS clamps to 0 (Backgrounds 3). Apple: the radius "may be zero … the corner is square", with an optional minimum. Coyier: 0 "doesn't feel right". | `max(var(--radius-floor), calc(outer - border - pad))`. Choosing the floor value is a design call, not a sourced rule. |
| Inner element is a pill or circle | Apple: capsule radius = height / 2, and "the capsule's geometry naturally supports concentricity". | Use a full token (9999px), not the subtraction. CSS clamps oversize radii to fit the box, so 9999px renders as h/2. Backgrounds 3 "Overlapping Curves": when adjacent radii exceed the box, UAs "proportionally reduce the used values of all border radii". This also means one huge radius on a non-pill side can shrink the other corners. Avoid `50%`: on a non-square box it gives an ellipse (MD3 Android uses 50%; MD3 web uses 9999px). |
| Border width | Backgrounds 3: inner = outer − border thickness. | Subtract the border as well as the padding. shadcn's dropdown has a 1px border plus `p-1`. |
| Negative values | CSS already clamps a negative *used* radius to 0 inside one box. A child's `calc()` that goes negative is not valid for `border-radius`, so wrap it. | Use `max(0px, …)` or a floor. |
| Stand-alone vs nested component | Apple's "fallback radius". | `var(--parent-inner-radius, var(--radius-md))`, so the fallback applies when there is no parent. |
| `corner-shape` / superellipse | CSS Borders 4 (https://drafts.csswg.org/css-borders-4/): for shaped corners, "The inner edge of the border follows the curve of the outer edge (in a way that's not necessarily expressible as a superellipse curve), with a nearly consistent distance". `squircle` = `superellipse(2)`. MDN BCD: `corner-shape` ships in Chrome 139; Firefox and Safari "preview" only; marked experimental (https://github.com/mdn/browser-compat-data/blob/main/css/properties/corner-shape.json). | For `corner-shape: round` the subtraction is exact. For squircle/superellipse, a child with the same shape and radius `outer − pad` is only approximately parallel, because the true offset curve is not a superellipse. That conclusion is inferred from the spec text, not measured. |
| `overflow-clip-margin: content-box` | BCD: Chrome 104+, Firefox 148+, Safari **not supported** (https://github.com/mdn/browser-compat-data/blob/main/css/properties/overflow-clip-margin.json). | Not usable as the main mechanism while Safari lacks it. |

### 3c. CSS custom-property patterns, tested in HeadlessChrome 154

I built fixtures and read `getComputedStyle().borderTopLeftRadius`:

| Pattern | Result | Why |
|---|---|---|
| `.n { --r: calc(var(--r) - var(--pad)); border-radius: var(--r) }` (self-reference) | Level 2+ → **0px** | A dependency cycle. css-variables-1 says cycles make the property "guaranteed-invalid" (https://drafts.csswg.org/css-variables-1/, the `--one`/`--two` example). |
| Container publishes `--child-radius: calc(var(--radius) - pad)`, and `.n .n { --radius: var(--child-radius) }` | Level 2+ → **0px** | Still a cycle: the same element declares both `--radius` and `--child-radius`, and each depends on the other. |
| One-level: `.e { --inner-radius: max(0px, calc(var(--radius) - 4px)) } .e > .e { border-radius: var(--inner-radius) }` | 10 → 6 → **6** (wrong at level 3) | Works for one level only. The grandchild inherits the same `--inner-radius`. |
| `inherit()` notation: `--radius: calc(inherit(--radius) - 4px)` | Declaration **dropped at parse**; all levels 16 | `inherit()` is in the CSS Values 5 draft (https://drafts.csswg.org/css-values-5/, "Inherited Value References"). It has no BCD entry, and Chrome 154 did not accept it. |
| **Parity alternation**: `.odd { --from-odd: max(0px, calc(var(--r) - 5px)) }` `.even { --r: var(--from-odd); --from-even: max(0px, calc(var(--r) - 5px)) }` `.even .odd { --r: var(--from-even) }` (4px padding + 1px border) | 20 → 15 → 10 → 5 → 0 → 0 ✔ | No cycle: each level reads the *other* name, which it inherits and does not declare. Arbitrary depth works, but it needs depth parity marked in the DOM. |

In practice: a single-level "parent publishes `--inner-radius`, child reads it" pattern is robust. It covers popover → item, card → image, and callout → selection fill. True multi-level derivation in plain CSS needs parity alternation, or `inherit()` once it ships.

### 3d. Real systems vs. the strict rule (keep these counterexamples)

| Container → child | Outer | Inset (+border) | Child | Strict rule would give |
|---|---|---|---|---|
| Notion popover → menu item (measured) | 10 | 4 | 6 | 6 ✔ |
| Carbon v12 menu → item (`_menu.scss`, `enable-v12-release`) | 8 | 4 (`$spacing-02`) | 4 | 4 ✔ |
| Radix menu size-1 (`base-menu.css`) | 6 (radius-3) | 4 (space-1) | 3 (radius-1) | 2 ✘ |
| Radix menu size-2 | 8 (radius-4) | 8 (space-2) | 4 (radius-2) | 0 ✘ (Radix keeps 4 instead of going square) |
| shadcn dropdown (`dropdown-menu.tsx`) | 8 (`rounded-md`) | 4 + 1px border | 6 (`rounded-sm`) | 3 ✘ |

Radix sources: https://github.com/radix-ui/themes/blob/main/packages/radix-ui-themes/src/components/_internal/base-menu.css and the space tokens in `styles/tokens/space.css` (space-1 = 4, space-2 = 8). shadcn source: https://github.com/shadcn-ui/ui/blob/main/apps/v4/registry/new-york-v4/ui/dropdown-menu.tsx. Carbon source: `@carbon/styles/scss/components/menu/_menu.scss`.

### 3e. How systems encode size-dependent radius

- **Notion**: an explicit radius-by-size table on buttons (§1b): 16–20px tall → 4, 24–32 → 6, 36 → 8. The pill variant uses 9999.
- **Radix**: button radius steps with size: `max(var(--radius-1..4), var(--radius-full))` for sizes 1–4 (`_internal/base-button.css`). The `max()` with `--radius-full` turns every button into a pill when the theme is `radius="full"`. Cards step too (radius-4/5/6).
- **Primer**: rule text ties `small` to elements under 16px tall.
- **Apple**: capsule = h/2. macOS Mini/Small/Medium controls stay rounded rectangles; Large/X-Large become capsules.
- **Ant**: `borderRadiusSM/LG/XS` are derived from one seed, with small controls using SM (`genRadius.ts`).
- **shadcn**: one seed with multiplicative derivation (×0.6 … ×2.6).

---

## 4. Recommendation for Blok (drawn from the sources above)

Evidence behind the choice:
- Notion's measured UI uses 4 / 6 / 10 / 12 plus pills.
- Notion's internal scale is 3 / 4 / 6 / 8 / 12 / 16.
- Atlassian, Tailwind and Fluent share 2 / 4 / 6 / 8 / 12 / 16.
- Only Notion and shadcn put a 10px step where floating cards live.

Proposed 7-step scale plus full:

| Token | px | Component class (with the source it follows) |
|---|---|---|
| `--blok-radius-xs` | 2 | checkbox, keyboard-shortcut chips, inline-code, focus-ring inner (Atlassian xsmall; Notion checkbox 1.5–3) |
| `--blok-radius-sm` | 4 | tags/select options, small icon buttons ≤ 20–24px tall, toggle arrow, inline mentions, images inside tables (Notion tag / arrow / xs buttons; Atlassian small) |
| `--blok-radius-md` | 6 | menu items, buttons and inputs 24–32px, tooltips, block hover/selection surface (Notion measured; Primer default; Atlassian medium) |
| `--blok-radius-lg` | 8 | toasts, small cards, 36px buttons, inline embeds/image frames (Notion xl button, toast; Atlassian large) |
| `--blok-radius-xl` | 10 | popovers/menus, callout, code block (Notion measured) |
| `--blok-radius-2xl` | 12 | modals/dialogs, large panels (Notion bundle; Primer large; Atlassian xlarge) |
| `--blok-radius-3xl` | 16 | full-width media/video frames, large cards (Notion `Vq.max`; Atlassian xxlarge) — optional |
| `--blok-radius-full` | 9999px | pills, status chips, avatars, view tabs (Notion; Primer / Atlassian full) |

Nesting rule as tokens. This combines Backgrounds 3, Apple's minimum/fallback, and the one-level pattern tested in §3c:

```css
/* set on a container that insets its children */
.container {
  border-radius: var(--blok-radius-xl);
  padding: var(--pad);
  --blok-radius-inner: max(
    var(--blok-radius-floor, 2px),
    calc(var(--blok-radius-xl) - var(--pad) - var(--border-width, 0px))
  );
}
/* children read it, with a fallback for stand-alone use */
.item { border-radius: var(--blok-radius-inner, var(--blok-radius-md)); }
/* pills never subtract */
.pill { border-radius: var(--blok-radius-full); }
```

Worked checks:
- Popover 10, inset 4 → 6 = `md`. This matches Notion's measured item.
- Callout 10 with ~12–16px padding → the formula floors out, so children use their own scale step. Apple's docs describe this as the case where "the corner radius … may be zero".
- The floor value (2px vs 0 vs 4px) is a design judgment. Coyier says 0 "doesn't feel right"; Apple offers a "minimum radius". No primary source fixes a number.

Caveats:
- Pick the rule on purpose. Radix and shadcn do *not* follow strict concentricity. Notion's popover and Carbon v12's menu do.
- Multi-level derivation in plain CSS is not free (§3c). Use one level, or parity alternation.
- Consistency across 3+ levels of nesting is only guaranteed if Blok marks depth parity or waits for `inherit()`.

---

## Unverified / not found

- Figma UI3 radius values: no source found.
- Linear in-app radii: only the marketing site's CSS was checked.
- Atlassian legacy `border.radius.*` values: not in @atlaskit/tokens 20.1.0.
- Notion image/embed/gallery card radii: not measured (Cloudflare challenge). Bundle hints only.
- Notion logged-in editor vs published notion.site: assumed the same renderer; not verified.
- Apple px values for any control: Apple publishes shape types, not a px scale.
