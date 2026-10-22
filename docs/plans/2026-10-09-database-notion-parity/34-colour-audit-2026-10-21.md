# 34 · Database colour audit against Notion (2026-10-21)

USER DECISION 2026-10-21: "use exactly the same colors Notion uses for databases", and tooltips take Notion's colours everywhere (this overrides the 2026-10-20 "keep Blok's tooltip colours").

Two exceptions hold:

- **AA.** Where Notion's colour fails WCAG AA for text (4.5:1, normal size), Blok keeps the nearest passing value. Each case is listed with both ratios.
- **No blue selected states** (CLAUDE.md). Notion's blue selection halos, rings, active pills and selected tiles stay neutral.

## Method

- **Notion values** come from the research docs in `research/` (07, 08, 09, 10, 12, 21, 22, 23, 26, 27, 28, 30, 31). Each row cites one.
- **Blok values** were read two ways and labelled:
  - `computed`: `getComputedStyle` in a built page (`dist` from origin/main 70f41a9c, `vite build --mode test`), headless Chromium, `emulateMedia` light and dark. Fixture: a database with one select option per colour (10 colours), dates, checkboxes, text; views table, board, gallery, calendar, timeline, list. Probe scripts and raw dumps: scratchpad `r13-probe.tpl.js`, `r13-probe2.tpl.js`, `r13-before-*.json`.
  - `source`: the token's declared value in `src/styles/database.css` / `colors.css` when no probe reached the element.
- **Rounding.** Chrome reports Notion's hover fill as `color(srgb 0.129 0.106 0.090 / 0.051)`. Research/07 wrote it as 0.05. The audit treats 0.051 as Notion's hover value. The active-tab fill was read as 0.05 (research/07:46, 21:44) and stays 0.05.
- **Contrast** is measured on the composited background the text sits on (tint over page, hover fill over page, menu bg in dark). Script: scratchpad `r13-cr.mjs`. "Large text" (24px, or 18.7px bold) never occurs here: every database label is 11–16px.
- **Page background.** Blok's page background is the host's (`--blok-bg-primary`, 29,29,28 in dark). Surfaces that paint "the page" (table header row, timeline body in dark) follow it, not Notion's 25,25,25. Otherwise a stripe would show on every host page. Listed as `HOST`.

Status codes: `MATCH` · `CHANGE` (to Notion) · `AA` (Notion fails AA, Blok keeps the nearest passing value) · `BLUE` (kept neutral, blue law) · `PRIOR` (kept by an earlier recorded decision) · `HOST` · `UNMEASURED` (no Notion value; Blok unchanged).

## AA steps used

One step per ink role, computed as the nearest value on Notion's own hue that passes 4.5:1 on the worst surface it sits on.

| Role | Notion | Ratio | Blok step | Ratio | Worst surface |
|---|---|---|---|---|---|
| Light secondary ink (header text, tabs, values, OPEN) | 125,122,117 | 4.27 on white | **114,111,106** | 5.00 white / 4.53 hover | hover fill 0.051 over white |
| Light tertiary ink ("Empty", "+ New page", weekdays, other-month days, timeline days, calc label) | 161,158,153 | 2.67 | **114,111,106** | 5.00 / 4.53 | same |
| Light icon gray used as TEXT ("+ Add property", "Today", zoom label, "+ New" on timeline, "Edit filters") | 142,139,134 | 3.39 | **114,111,106** | 5.00 / 4.53 | same. Icons keep 142,139,134 (3:1 non-text rule passes). |
| Dark tertiary ink | 125,122,117 | 4.11 on 25 / 3.59 on 37 / 3.13 on 47 | **143,140,135** | 5.25 / 4.58 / 4.52 on 38 | card hover 38. Prior dark steps (138,135,130; 135,132,127; 142,139,134) fold into this one. |
| Calendar event text, light (hover rgba(84,72,49,0.08)) | 161,158,153 | 2.6 | **112,109,104** | 4.54 | hovered event card |
| Calendar event text, dark (card 47, hover 55) | 125,122,117 | 3.13 / 2.8 | **162,159,154** | 4.51 on 55 | hovered event card |
| Light blue text (reminder date) | 39,131,222 | 3.90 | **35,119,211** | 4.52 | white |
| Dark blue text (reminder on a card, blue column count) | 39,131,222 | 4.18 on 32 / 4.20 on the blue tint | **41,137,232** | 4.53 / 4.55 | card 32 |
| Light red text (destructive button "Remove", danger rows) | 229,100,88 | 3.34 | **182,79,70** | 4.53 on hover | hover fill over white |
| Light board blue / green count, "+ New page" | 39,131,222 / 70,161,113 | 3.67 / 3.01 on tint | pill text 38,74,114 / 42,83,60 | 8.58 / 8.26 | column tint (already the rule for yellow and brown) |
| Primary button text on blue ("New", Apply, Save, Import, Submit) | 243,249,253 on 39,131,222 | 3.67 | bg **30,110,195** (PRIOR, research/08 note in database.css) | 4.86 | — |

Not changed, flagged for a decision (text on a Notion fill, where the only passing fix changes the fill or flips the ink):

- **Calendar / timeline / date-picker today digit**: white on 229,100,88 = 3.34. A passing ink is near-black (Notion's own dark-mode digit). Kept white.
- **Discard / Reset / Delete view** filled red buttons: 253,246,246 on 229,100,88 = 3.13. Blok has no filled red button today (its destructive actions are outline buttons), so nothing renders this.

## 1 · Global inks, fills and lines

| Surface | Notion L / D | Blok rule / token | Blok L / D (before) | Status |
|---|---|---|---|---|
| Primary ink (cell text, titles, menu items, list rows, card properties, panel rows) | 44,44,43 / 240,239,237 (07:30, 21:28) | most database rules: `--blok-database-table-cell-text` etc. (match); ~65 rules and every inherited text use `--blok-text-primary` | computed: black / 226,224,220 on wrapper, list rows, card properties, panel rows, peek, gallery card | CHANGE (new `--blok-database-ink`, wrapper `color`) |
| Secondary ink (text) | 125,122,117 / 173,169,163 (21:29) | ~101 rules use `--blok-text-secondary`; tokens `table-header-text`, `tab-text`, `table-calc-value`, `peek-label`, `gallery-preview-text` hold Notion's value | computed: 100,106,121 / 163,158,152 (core) and 125,122,117 / 173,169,163 (tokens) | Light: AA (4.27 → 114,111,106). Dark: CHANGE core uses to 173,169,163; tokens MATCH |
| Tertiary ink | 161,158,153 / 125,122,117 (21:30) | tokens `table-muted-text`, `calendar-muted-text`, `timeline-muted-text`, `gallery-muted-text`; 16 rules use `--blok-text-tertiary` (163,163,158 / 110,110,104) | computed | AA both themes (steps above) |
| Icon gray | 142,139,134 / 173,169,163 (07:32, 21:29) | `table-header-icon`, `calendar-nav-icon`, `timeline-control-text`, toolbar icons | computed: MATCH on toolbar and header icons; calendar prev/next 44,44,43 / 240,239,237 | MATCH; calendar prev/next CHANGE |
| Divider / cell border | rgba(42,28,0,0.07) / rgba(255,255,243,0.082) (07:34, 21:31) | `--blok-database-table-border`, `card-ring` | computed: MATCH | MATCH |
| Outline button border | rgba(28,19,1,0.11) / rgba(255,255,235,0.1) (21:32) | `--blok-database-table-control-border` (match); 17 rules use `--blok-popover-border` (rgba(55,53,47,0.09) / rgba(255,255,255,0.14)): confirm dialog buttons, CSV import, template repeat, form share | source | MATCH token; CHANGE the `--blok-popover-border` uses |
| Hover fill (menu item, button, header cell, calc cell) | ≈rgba(33,27,23,0.051) / rgba(255,255,255,0.055) (21:33) | tokens at 0.05; ~50 rules use `--blok-item-hover-bg` (rgba(55,53,47,0.08) light) | computed: menu row 0.05; core uses 0.08 | CHANGE (0.051, and core uses → database hover) |
| Focus ring | 35,131,226 both themes (08:117, 21:36) | `--blok-focus-ring` #2383e2 / #4c9fff | source | Light MATCH. Dark: PRIOR (core focus-ring token, a published core variable; out of database scope). |
| Page bg | 255 / 25,25,25 | `--blok-bg-primary` | computed 255 / 29,29,28 | HOST |

## 2 · Option pills (all 10 colours)

Measured research/07:104-113, 08:287-296, 21:84-86, 22:240-244, 26:203-204, 31:191.

| Colour | Notion L bg / text | Notion D bg / text | Blok (computed, table + board header) | Status | AA (text on pill over page) |
|---|---|---|---|---|---|
| default | rgba(42,28,0,0.07) / 44,44,43 | rgba(255,255,243,0.082) / 240,239,237 | same | MATCH | pass |
| gray | rgba(28,19,1,0.11) / 73,72,70 | rgba(255,252,235,0.306) / 240,239,237 | same | MATCH | pass |
| brown | rgba(127,51,0,0.157) / 88,68,55 | rgba(255,184,132,0.365) / 245,237,233 | same | MATCH | pass |
| orange | rgba(196,88,0,0.204) / 106,66,34 | rgba(255,143,71,0.482) / 251,235,222 | same | MATCH | pass |
| yellow | rgba(209,156,0,0.282) / 101,81,33 | rgba(255,188,53,0.46) / 249,243,220 | same | MATCH | pass |
| green | rgba(0,96,38,0.157) / 42,83,60 | rgba(113,255,175,0.337) / 232,241,236 | same | MATCH | pass |
| blue | rgba(0,118,217,0.204) / 38,74,114 | rgba(81,166,255,0.494) / 229,242,252 | same | MATCH | pass |
| purple | rgba(92,0,163,0.14) / 85,59,105 | rgba(208,147,255,0.427) / 243,235,249 | same | MATCH | pass |
| pink | rgba(183,0,78,0.153) / 104,53,78 | rgba(255,133,192,0.427) / 250,233,241 | same | MATCH | pass |
| red | rgba(206,24,0,0.165) / 109,53,49 | rgba(255,116,105,0.525) / 252,233,231 | same | MATCH | pass |
| Status dots gray / blue / green | 142,139,134 / 39,131,222 / 70,161,113 (08:300, 21:84-86) | same | source | MATCH | non-text |
| "New" badge (slash menu) | text 39,131,222 on rgba(0,124,215,0.094) (28:51) | — | — | UNMEASURED in Blok (no such badge on database surfaces) | — |

## 3 · Table

| Surface | Notion L / D | Blok token / rule | Blok L / D (computed) | Status |
|---|---|---|---|---|
| Header row bottom line | rgba(42,28,0,0.07) / rgba(255,255,243,0.082) inset (07:63, 21:70) | `table-border` | same | MATCH |
| Header row bg | white / 25,25,25 | `table-bg` = `--blok-bg-primary` | 255 / 29,29,28 | HOST |
| Header text | 125,122,117 / 173,169,163 (07:65, 21:29) | `table-header-text` | same | Light AA → 114,111,106 (4.27 → 5.00). Dark MATCH (7.52). |
| Header icon | 142,139,134 / 173,169,163 (07:66) | `table-header-icon` | same | MATCH (non-text) |
| Header cell hover | rgba(33,27,23,0.05) / rgba(255,255,255,0.055) (08:263, 21:71) | `table-header-hover-bg` | 0.05 / 0.055 | CHANGE light 0.05 → 0.051 |
| Cell borders | rgba(42,28,0,0.07) / rgba(255,255,243,0.082) | `table-border` | same | MATCH |
| Cell text | 44,44,43 / 240,239,237 | `table-cell-text` | same | MATCH |
| Row hover | none (07:76) | — | none | MATCH |
| Checkbox unchecked border | rgba(27,21,0,0.19) / rgba(255,252,235,0.306) (07:75, 21:74) | `checkbox-border` | same | MATCH |
| Checkbox checked bg | 39,131,222 both (07:75, 07:223) | `--blok-active-icon` | 35,131,226 / 82,156,202 | CHANGE |
| "+ New page" row | text 161,158,153 / 125,122,117; icon 173,169,163 / 125,122,117 (08:262, 22:234) | `table-muted-text`, `table-gutter-icon` | same | Text AA both themes. Icon MATCH. |
| "+ New page" hover | rgba(33,27,23,0.051) / rgba(255,255,255,0.055) (22:234) | `table-header-hover-bg` | 0.05 / 0.055 | CHANGE light 0.051 |
| "+ Add property" | 142,139,134 (08:261) | `table-header-icon` | 142,139,134 / 173,169,163 | MATCH (Blok renders it icon-only, 28×28 "+": non-text) |
| OPEN button | white + 3-layer shadow; text 125,122,117 (07:77); dark bg 37 inner, text 173,169,163 (22:232) | `table-open-*`, `card-actions-icon` | bg/shadow MATCH; text 125,122,117 / 173,169,163 | bg/shadow MATCH. Light text AA → 114,111,106. |
| Row handle ⋮⋮ | 173,169,163 (08:178) | `table-gutter-icon` | 173,169,163 / 125,122,117 | MATCH (dark UNMEASURED) |
| Calc row label | 161,158,153 / 125,122,117 (21:75) | `table-muted-text` | — | AA both |
| Calc value | 125,122,117 / 173,169,163 (08:215, 08:340) | `table-calc-value` | same | Light AA. Dark MATCH. |
| ID column ink | 161,158,153 (08:274) | `--blok-text-tertiary` | 163,163,158 | AA → 114,111,106 |
| File chip | bg rgba(42,28,0,0.07) (08:278) | — | — | UNMEASURED in this probe; not changed |
| URL underline | rgba(28,19,1,0.11) / rgba(255,255,235,0.1) (26:243) | `cell-link-underline` | source | MATCH |
| Selected cell | Notion: rgba(35,131,226,0.07) fill + 2px blue ring (08:25) | `table-cell-ring` gray | rgba(55,53,47,0.35) | BLUE |
| Selected row halo | rgba(35,131,226,0.14) (08:27) | neutral selection tokens | — | BLUE |
| Fill handle | white / 25,25,25 + blue border (08:26, 08:344) | `fill-handle-bg` | source | bg MATCH; border BLUE |
| Drop line | rgba(35,131,226,0.43) (08:35) | `table-drop-line` | source | MATCH (a drop target, not a selected state) |
| Column resize | rgba(35,131,226,0.8) (08:138) | `table-resize` | source | MATCH |
| Selection bar | white + 3-layer shadow / 37 + dark shadow; divider rgba(42,28,0,0.07) (26:147-181) | `table-selection-shadow` | source | MATCH |
| "N selected" | 39,131,222 both (26:148) | `--blok-icon-active-text` (primary ink) | 0,0,0 / 226,224,220 | BLUE (kept neutral); ink becomes `--blok-database-ink` |

## 4 · View tabs, toolbar, "New"

| Surface | Notion L / D | Blok | Blok L / D (computed) | Status |
|---|---|---|---|---|
| Active tab | bg rgba(33,27,23,0.05) / rgba(255,255,255,0.055); ink 44,44,43 / 240,239,237 (07:46, 21:44) | `tab-bg-active`, `tab-text-active` | same | MATCH |
| Inactive tab ink | 125,122,117 / 173,169,163 | `tab-text` | same | Light AA → 114,111,106. Dark MATCH. |
| Tab hover | ≈0.051 / rgba(255,255,235,0.1) (21:46) | `tab-bg-hover` | 0.05 / 0.1 | CHANGE light 0.051 |
| Toolbar icons | 142,139,134 / 173,169,163; hover 0.051 / 0.055 (21:49) | `table-header-icon` | 142 / 173; hover 0.05 / 0.055 | icons MATCH; hover CHANGE light 0.051 |
| Filter/sort icon with a rule | 39,131,222 (07:54, 21:50) | — | source: neutral | BLUE (an "active" state) |
| Filter/sort pill active | bg rgba(0,124,215,0.094) / rgba(67,155,255,0.24), ink 39,131,222 (21:57) | `--blok-icon-active-*` | neutral | BLUE |
| Filter pill without value | bg rgba(33,27,23,0.05), ink 125,122,117 (08:233) | `--blok-text-secondary` | 100,106,121 | Light AA → 114,111,106 |
| "+ Filter" | 161,158,153 / 125,122,117 (21:59) | `filter-add-text` | 100,106,121 / 135,132,127 | AA both (step) |
| "New" button | bg 39,131,222, text 243,249,253; hover 31,118,204 / dark 61,144,225 (08:259, 21:51) | `new-bg` 30,110,195 | computed 30,110,195 | PRIOR (AA: 3.67 → 4.86) |
| "New" divider | rgba(28,19,1,0.11) / rgba(255,255,235,0.1) | `new-divider` | same | MATCH |
| Database title | primary ink | inherits `--blok-text-primary` | black / 226,224,220 | CHANGE (ink) |

## 5 · Board

Measured research/07:126-150, 08:69-87, 08:345-348, 21:105-115, 26:231-238.

| Surface | Notion L | Notion D | Blok L / D (computed) | Status |
|---|---|---|---|---|
| Gray column tint | rgba(66,35,3,0.03) | rgba(252,252,252,0.03) | same | MATCH |
| Default column tint (08:72 "default and no-value") | rgba(66,35,3,0.03) | rgba(252,252,252,0.03) (08:345) | derived from the default pill: rgba(42,28,0,0.016) / rgba(255,255,243,0.018) | CHANGE |
| Blue column tint | rgba(0,128,213,0.047) | rgba(41,139,253,0.063) | derived rgba(0,118,217,0.045) / MATCH | CHANGE light |
| Green column tint | rgba(3,87,31,0.035) | rgba(83,255,140,0.035) | derived rgba(0,96,38,0.035) / MATCH | CHANGE light |
| Yellow tint | rgba(207,175,0,0.063) | rgba(255,232,48,0.043) | same | MATCH |
| Brown tint | rgba(115,59,3,0.035) | rgba(253,158,101,0.05) | same | MATCH |
| Pink tint | UNMEASURED | rgba(255,78,149,0.055) | derived / MATCH | dark MATCH, light UNMEASURED |
| Orange, purple, red tints | UNMEASURED | UNMEASURED | derived from pill bg | UNMEASURED |
| Card bg / shadow (plain) | white, `rgba(25,25,25,0.027) 0 4px 12px, rgba(25,25,25,0.02) 0 1px 2px, rgba(42,28,0,0.07) 0 0 0 1px` | 32,32,32, `rgba(25,25,25,0.08) 0 2px 4px, rgba(255,255,243,0.082) 0 0 0 1px` | same in gray column | MATCH |
| Card ring, default column | rgba(42,28,0,0.07) (plain card) | rgba(255,255,243,0.082) | derived rgba(42,28,0,0.035) / rgba(255,255,243,0.040) | CHANGE |
| Card ring, blue column | rgba(0,124,215,0.094) (21:110) | rgba(71,157,255,0.173) | derived rgba(0,118,217,0.10) / MATCH | CHANGE light |
| Card ring, green column | rgba(0,100,45,0.09) (21:111) | rgba(119,255,179,0.118) | derived rgba(0,96,38,0.077) / MATCH | CHANGE light |
| Card ring, yellow | rgba(211,168,0,0.137) | rgba(255,225,117,0.13) | same | MATCH |
| Card ring, brown | UNMEASURED | rgba(255,174,122,0.133) | derived / MATCH | dark MATCH |
| Dark card bg in blue / green / brown column | — | 33,48,65 / 36,52,43 / 56,45,38 | same | MATCH |
| Dark card hover blue / brown | — | 37,54,73 / 64,51,43 (26:235) | same | MATCH |
| Card hover (plain) | ≈rgba(54,29,2,0.031) (07:134, 21:112) | 38,38,38 | 247,247,245 / 38,38,38 | CHANGE light |
| Card title | 44,44,43 / 240,239,237 (26:200) | | same | MATCH |
| Card property text | 44,44,43 / 240,239,237 (26:201) | | black / 226,224,220 (inherited) | CHANGE (ink) |
| Count / "+ New page", gray | 95,94,89 | 188,186,182 | same | MATCH (6.50 / 8.43) |
| Count / "+ New page", default column | 95,94,89 (08:69) | 188,186,182 (08:347) | 44,44,43 / 240,239,237 (pill text) | CHANGE |
| Count, blue | 39,131,222 (21:108) | 39,131,222 | 38,74,114 / 39,131,222 | Light AA (3.67, keep pill text 8.58). Dark AA (4.20 → 41,137,232). |
| Count, green | 70,161,113 | 70,161,113 | 42,83,60 / 70,161,113 | Light AA (3.01, keep pill text 8.26). Dark MATCH (5.14). |
| Count, yellow | 216,163,47 | 216,163,47 | 101,81,33 / 216,163,47 | Light AA (2.18, PRIOR keep pill text). Dark MATCH (7.00). |
| Count, brown | 182,137,101 | 182,137,101 | 88,68,55 / 182,137,101 | Light AA (2.94, PRIOR). Dark MATCH (5.21). |
| Count, pink | UNMEASURED | 219,105,153 | pill text / same | dark MATCH |
| Card hover action pill | white + OPEN shadow, divider rgba(42,28,0,0.07) / 37 + dark shadow | | same | MATCH |
| Card "…" icon | 125,122,117 (07:135) | 173,169,163 | same | MATCH (icon) |
| Board calc results (22:121) | gray 142,139,134, green 70,161,113, purple 181,119,214, no-value 95,94,89 | — | not probed (needs the calc menu) | UNMEASURED in Blok probe; not changed |

## 6 · Gallery

| Surface | Notion L / D | Blok | Blok L / D (computed) | Status |
|---|---|---|---|---|
| Card bg / shadow | white + card shadow / rgba(255,255,255,0.055) + dark shadow (07:130, 21:124) | `gallery-card-*` | same | MATCH |
| Cover area | rgba(66,35,3,0.03) + 1px rgba(42,28,0,0.07) / rgba(252,252,252,0.03) + transparent | `gallery-preview-*` | same | MATCH |
| Cover preview text | 125,122,117 (07:147) / unmeasured | `gallery-preview-text` | 125,122,117 / 163,158,152 | Light AA (12px, 4.27 → 114,111,106). Dark UNMEASURED. |
| Card hover | rgba(55,53,47,0.04) / 47,47,47 (21:125) | `gallery-card-hover-bg` | same | MATCH |
| Title / property text | 44,44,43 / 240,239,237 (26:200-201) | | same | MATCH |
| "New page" card | ring rgba(42,28,0,0.07) / rgba(255,255,235,0.1); + icon 173,169,163 / 125,122,117 (26:207) | `gallery-muted-text` | text 161,158,153 / 125,122,117 | icon MATCH; its text AA both |

## 7 · Calendar

| Surface | Notion L / D | Blok | Blok L / D (computed) | Status |
|---|---|---|---|---|
| Grid lines | 230,229,227 / 56,56,54 (07:174, 21:131) | `calendar-border` | same | MATCH |
| Weekend cells | 249,248,247 / 32,32,32 | `calendar-weekend-bg` | same | MATCH |
| Weekday labels | 161,158,153 / 125,122,117 | `calendar-muted-text` | same | AA both |
| Other-month day numbers | 161,158,153 / 125,122,117 | `calendar-muted-text` | same | AA both |
| This-month day number | 44,44,43 / 240,239,237 | `calendar-day-text` | same | MATCH |
| Today circle | 229,100,88, digit white (07:177, 21:137) | `today`, `calendar-today-text` | same | MATCH; digit AA-flagged (3.34), kept |
| Prev / next chevrons | 142,139,134 / UNMEASURED dark (07:171) | `calendar-nav-icon` existed, but the nav's `button` rule (0,1,1) out-ranked it | 44,44,43 / 240,239,237 | CHANGE (specificity fix: 142,139,134 / 173,169,163) |
| Event card | white + `rgba(0,0,0,0.04) 0 2px 4px, rgba(42,28,0,0.07) 0 0 0 1px` / 47 + `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 2px 4px` | `calendar-event-*` | same | MATCH |
| Event hover | rgba(84,72,49,0.08) / 55,55,55 | `calendar-event-hover-bg` | same | MATCH |
| Event title | 14px 600, ink | | same | MATCH |
| Event property text | UNMEASURED (Blok uses tertiary) | `calendar-event-muted-text` (new) | 161,158,153 / 125,122,117 | AA (112,109,104 / 162,159,154, passing on the hovered card) |
| "No date (N)" | 142,139,134 / 173,169,163 (21:139) | `calendar-nav-icon` | source | Light AA → 114,111,106. Dark MATCH. |
| "Manage in Calendar" border | rgba(28,19,1,0.11) / rgba(255,255,235,0.1) | `table-control-border` | source | MATCH |
| Event selection overlay / lasso | rgba(35,131,226,0.14) (22:30) | neutral | — | BLUE |

## 8 · Timeline

| Surface | Notion L / D | Blok | Blok L / D (computed) | Status |
|---|---|---|---|---|
| Body bg | 253,253,253 / 25,25,25 (21:145, 26:215) | none (page) | page | HOST |
| Header bottom line | 230,229,227 / 56,56,54 inset | `timeline-header-line` | same | MATCH |
| Weekend columns | 247,247,247 / rgba(255,255,255,0.03) | `timeline-weekend-bg` | same | MATCH |
| Day labels | 161,158,153 / 125,122,117 | `timeline-muted-text` | same | AA both |
| Today line + chip | 229,100,88, digit white 500 | `today` | same | MATCH; digit AA-flagged |
| Bar | white + `rgba(0,0,0,0.04) 0 2px 4px, rgba(42,28,0,0.07) 0 0 0 1px` / 37 + dark shadow | `timeline-bar-*` | same | MATCH |
| Bar hover overlay | ≈0.051 / 0.055 (21:150) | — | none measured in probe (bar keeps its bg) | UNMEASURED in Blok; not changed |
| Off-screen arrow chip | 142,139,134 + 1px white, hover 56,56,54 / 173,169,163 + 25 border | `timeline-arrow-*` | source | MATCH |
| Zoom control "Month ⌄" | 14px 142,139,134 (07:195) | `timeline-control-text`, out-ranked by the toolbar `button` rule | 44,44,43 / 240,239,237 | Light AA → 114,111,106. Dark CHANGE → 173,169,163 (icon-gray role, 7.52). |
| "+ New" | 142,139,134 text | `timeline-control-text` | 142,139,134 / 173,169,163 | Light AA. Dark MATCH. |
| Range readout pill | 247,247,247 (07:192) | — | not probed | UNMEASURED in Blok |
| Selected halo | rgba(35,131,226,0.14) | neutral | — | BLUE |

## 9 · List

| Surface | Notion L / D | Blok | Blok L / D (computed) | Status |
|---|---|---|---|---|
| Row hover | rgba(55,53,47,0.06) / rgba(255,255,255,0.055) (07:160, 21:122) | `add-hover-bg` | same | MATCH |
| Row title / property ink | primary ink | `--blok-text-primary` | black / 226,224,220 | CHANGE |

## 10 · Feed, form, map

| Surface | Notion L / D | Blok | Status |
|---|---|---|---|
| Feed card | white + `rgba(0,0,0,0.02) 0 12px 32px, rgba(0,0,0,0.05) 0 0 0 1px` / 32 + inset ring (08:321, 21:157) | `feed-card-*` | MATCH (source) |
| Feed card hover | ring 0.086 / 0.1 inset (21:158) | `feed-card-hover-shadow` | MATCH |
| Feed hover pill | white, border 240,239,237 / 47 + border 44,44,43 | `feed-actions-*` | MATCH |
| Reaction button | 249,248,247 / 32,32,32 | `feed-reaction-bg` | MATCH |
| Feed time stamp | 161,158,153 / 125,122,117 (21:161) | `--blok-text-tertiary` | AA both |
| Form question card | white, ring 182,212,243 / 25 + ring 53,95,139 (21:168) | `form-question-*` | MATCH |
| Form answer field ring | 240,239,237 / 44,44,43 (21:169) | `form-answer-border` | Light: `--blok-border-primary` 224,221,214 → CHANGE. Dark MATCH. |
| "Only members…" notice | rgba(66,35,3,0.03) / rgba(252,252,252,0.03) | — | UNMEASURED in Blok (not probed) |
| Anonymous pill | rgba(84,72,49,0.04), text 125,122,117 (23:233) | — | not probed; text would be AA |
| Form submit / primary | 39,131,222 + 243,249,253 | `--blok-accent` + white | CHANGE to the AA-kept `new-bg` / `new-text` (white on 35,131,226 is 3.88) |
| Map pin | 35,131,226 (#2383E2) default, rule colour otherwise (23:209) | — | not probed | UNMEASURED in this audit |
| Map pin shadow | rgba(0,0,0,0.35) | `map-pin-shadow` | MATCH |
| Map pin card | white + menu shadow, title 44,44,43 | — | not probed |

## 11 · Menus, panels, popovers, dialogs

| Surface | Notion L / D | Blok | Blok L / D | Status |
|---|---|---|---|---|
| Menu / panel surface | white + `rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px` / 37 + `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px` (21:34, 26:176) | View settings, cell editors (`blok-database-cell-editor`) | computed: same | MATCH |
| Shared-popover database menus (`blok-database-menu`: property header menu, add-view, card/row "…", group, tab menus) | same menu surface; items 44,44,43 / 240,239,237; hover 0.051 / 0.055 (08:266-267) | core `--blok-popover-box-shadow`, `--blok-text-primary`, `--blok-item-hover-bg` | computed: core shadow, items black / 226,224,220, hover 0.08 / 0.055 | CHANGE (core tokens re-set on the menu root) |
| Overflow tab list (`tab-overflow-dropdown`) | same menu surface | `--blok-database-popover-shadow` (colors.css light `0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)`) | source | CHANGE light |
| Menu row ink | 44,44,43 / 240,239,237 (26:32, 27:282) | `[data-blok-database-panel]` `--blok-text-primary` | computed black / 226,224,220 | CHANGE |
| Menu row value | 161,158,153 / 125,122,117 (26:32) | `panel-value-text` | 100,106,121 / 142,139,134 | AA both (light step; dark 142 PRIOR → step 143,140,135) |
| Menu section label / root title | 125,122,117 / 173,169,163 12px 500 (26:25, 26:33) | `--blok-text-secondary` | 100,106,121 / 163,158,152 | Light AA. Dark CHANGE → 173,169,163. |
| Menu row hover | 0.051 / 0.055 | | 0.05 / 0.055 | CHANGE light |
| Menu row pressed | rgba(33,27,23,0.102) / rgba(255,255,255,0.11) (27:281) | `panel-row-active-bg` | MATCH |
| Panel × | rgba(42,28,0,0.07) → 0.106 / rgba(255,255,235,0.1) → 0.153 (26:38) | `panel-close-*` | MATCH |
| Checked option (submenus) | checkmark in primary ink, no fill (23:23) | neutral | MATCH |
| Search / input in a menu | bg rgba(66,35,3,0.03), ring rgba(28,19,1,0.11) / bg rgba(252,252,252,0.03) (26:156, 26:183) | `panel-input-bg` = `table-header-hover-bg` (0.05) | CHANGE light to rgba(66,35,3,0.03) |
| Select editor head | rgba(242,241,238,0.6) / rgba(255,255,255,0.03) (08:306, 22:108) | `select-head-bg` | light MATCH; dark rgba(255,255,255,0.055) → CHANGE 0.03 |
| Select hint "Select an option…" | 125,122,117 12px 500 | `--blok-text-secondary` | Light AA. Dark CHANGE → 173,169,163. |
| Sort panel buttons | white + rgba(28,19,1,0.11), hover 244,243,243 / 25 + rgba(255,255,235,0.1), hover 38 (26:136, 26:177) | `sort-button-*` | MATCH |
| Change-icon button | border rgba(28,19,1,0.11), glyph 85,83,78, hover 249,248,247 / dark 211,211,211, hover 32 | `property-icon-button-*` | MATCH |
| Date picker selected day | 39,131,222 + white (26:47) | neutral | BLUE |
| Date picker today | 24px circle 229,100,88, white digit (26:46) | `today` | MATCH; digit flagged |
| Date picker weekday header | 139,152,152 (08:307, 21:181) | `date-weekday-text` light `--blok-text-tertiary` / 139,152,152 | Light CHANGE → 139,152,152 is 2.94 → AA → 114,111,106. Dark MATCH (6.0 on 37). |
| Date picker "Today" / "Now" | 142,139,134 12px 500 both (27:284) | `date-today-text` light secondary / 142,139,134 | Light AA → 114,111,106. Dark MATCH (4.52 on 37). |
| Toggle switch on | 39,131,222 (08:109) | `--blok-toggle-on-bg` #2383e2 | CHANGE (scoped; stays blue per USER DECISION "switch on stays blue") |
| Layout tiles selected | blue ring + blue text (08:108) | neutral | BLUE |
| Builder canvas frame, module ring, module strip | blue (10:44-46, 21:204-205) | neutral | BLUE (plan 11 Q6) |
| Builder backdrop | 249,248,247 / 32,32,32 | `builder-backdrop` | MATCH |
| Structure tiles | white, label 115,114,110 → active 29,27,22 / 32 + label 90,90,90 → white (10:76, 21:207) | `builder-tile-*` | Light MATCH. Dark unselected label 90,90,90 on 32 = 2.49 → AA → 143,140,135 (on 32). |
| Dialog surface | white, `rgba(25,25,25,0.24) 0 24px 48px, rgba(25,25,25,0.14) 0 4px 12px, rgba(42,28,0,0.07) 0 0 0 1px`; backdrop rgba(15,15,15,0.6) (08:39) | `confirm-*` | MATCH |
| Dialog dark | 32 + `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.64) 0 24px 48px, rgba(25,25,25,0.56) 0 4px 12px` (26:251) | `confirm-bg` 37, `confirm-shadow` menu shadow | CHANGE dark |
| Dialog outline button | border rgba(28,19,1,0.11) / rgba(255,255,235,0.1), ink 44,44,43 (22:163) | `--blok-popover-border`, `--blok-text-primary` | CHANGE |
| Destructive outline "Remove" | text 229,100,88, border rgba(206,24,0,0.165) (22:162) | `confirm-destructive-*` | border MATCH; light text AA → 182,79,70 (3.34 → 4.53). Dark MATCH (4.60 on 37). |
| Dialog primary | 39,131,222 + 243,249,253 | `--blok-accent` + white (3.88) | CHANGE to AA-kept `new-bg` |
| Template tiles (Suggested) | 232,241,236 / 229,242,252 / 240,239,237; glyphs 68,131,97 / 51,126,169 / 85,83,78; dark 38,61,48 / 35,56,80 / 56,56,54 (26:105-107, 26:185) | `starter-tile-*` | MATCH |
| "More templates" modal | bg 249,248,247; search rgba(249,249,248,0.8); card border 230,229,227 (26:118) | `tpl-gallery-bg`; cards `--blok-border-primary` 224,221,214 | bg MATCH; borders CHANGE → 230,229,227 (dark UNMEASURED) |
| AI prompt box | border 240,239,237, placeholder rgba(21,14,0,0.286) / 25 + border 44,44,43, placeholder rgba(255,252,235,0.306) (26:188) | `ai-prompt-placeholder` | light MATCH (placeholder exempt? no: 2.0:1 — Notion's own placeholder; flagged); dark placeholder `--blok-text-tertiary` → UNMEASURED-ish, kept |
| Comment underline + fill | rgba(255,203,0,0.35) / 0.12 (09:132) | — | UNMEASURED in this probe |
| Favourite star | 246,192,80 (22:275) | `favorite-star` | MATCH |

## 12 · Peek

| Surface | Notion L / D | Blok | Blok L / D | Status |
|---|---|---|---|---|
| Side peek panel | white + 3-layer shadow / 32 + `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px` (08:329, 21:187) | `peek-bg`, `peek-shadow` | MATCH (source) |
| Center backdrop | rgba(15,15,15,0.6) / 0.8 | `peek-backdrop` | MATCH |
| Title | 44,44,43 (26:62) / 240,239,237 | `peek-title` light = `--blok-text-primary` | black / MATCH | CHANGE light |
| Property label | 125,122,117 / 173,169,163 (08:329, 21:189) | `peek-label` | same | Light AA. Dark MATCH. |
| "Empty" | 161,158,153 / 125,122,117 | `cell-empty-text` | 163,163,158 / 138,135,130 | AA both (step) |
| Label hover | 0.051 / 0.055 (26:300) | `peek-hover-bg` | MATCH |
| Comments heading | 125,122,117 / 173,169,163 | | Light AA. Dark MATCH. |

## 13 · Tooltips / hints (global)

Measured research/21:35, 22:233, 26:194, 28:61, 30:498, 31:33-36. **Identical in light and dark.**

| Part | Notion | Blok before (computed) | Status | AA |
|---|---|---|---|---|
| Box bg | rgb(44,44,43) | `--blok-tooltip-bg` #1d202b (29,32,43) / #2e2e2d (46,46,45) | CHANGE (global, BREAKING) | — |
| Ink | rgb(240,239,237) | `--blok-tooltip-font` #cdd1e0 / #e8e6e3 | CHANGE (global, BREAKING) | 12.16 |
| Second line (description, shortcut) | rgb(173,169,163) | `TOOLTIP_MUTED_INK` rgba(255,255,255,0.55); lightbox `--blok-image-lightbox-shortcut-fg` rgba(255,255,255,0.45) | CHANGE (both) | 5.98 |
| Highlighted word (toolbar hints) | name line 240,239,237 (31:35) | inline `white` | CHANGE → `var(--blok-tooltip-font)` | 12.16 |
| Toolbox preview card text | 240,239,237 (28:61) | `--blok-text-on-dark` white | CHANGE → `var(--blok-tooltip-font)` | 12.16 |
| Video seek time bubble | — | video chrome over the frame, not a hint | UNMEASURED (kept) | — |
| Shadow | `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset` | `--shadow-tooltip` `0 8px 12px rgba(29,32,43,0.17), 0 4px 5px -3px rgba(5,6,12,0.49)` | CHANGE (global) | — |
| Radius | 6px | 6px | MATCH | — |

Coupling: the toolbox preview card (`block-preview.css`) paints its frame with `--blok-tooltip-bg`, so it moves to rgb(44,44,43) too. That matches Notion: its slash-menu hover hint, the same role, is the dark rgb(44,44,43) box (research/28:61, research/30:498).

## 14 · Database surfaces with NO measured Notion colour

For a future measuring session:

- Board column tints, rings and accents for **orange, purple, red** (both themes) and **pink** (light); brown ring (light).
- Board calculation result inks in dark; the board "hidden groups" control.
- Timeline: bar hover overlay on Blok's bar, range readout pill in dark, dependency arrows (both themes), timeline table panel.
- Calendar: prev/next chevrons in dark, event property text (both), "Today" nav button.
- Chart view (paywalled in research/08): every mark colour.
- Map view: pin card, "no place" list, add-pin button.
- Form: builder chrome in dark, file-upload error, share dialog badges.
- Comments: thread popover, composer, badge hover, comment underline in dark.
- CSV import dialog in dark; "More templates" modal in dark; template repeat editor.
- Peek: side-peek top bar buttons, page-info panel in dark, details panel border in dark.
- Formula editor, relation picker, person picker, rollup editor (all themes).
- Selection bar property segments hover in light.
- Dark row handle ⋮⋮ and dark "+ New page" table icon (Blok uses 125,122,117).
- Gallery cover preview text in dark.
- Light focus-ring halo detail on dark backgrounds beyond the toolbar button.

## Counts

Verdicts in the Status column of the 184 table rows in sections 1–13, counted by script. A row with separate light and dark verdicts counts each. "PRIOR (AA …)" counts as PRIOR only; the today-digit flag is not counted.

| Status | Count |
|---|---|
| MATCH | 85 |
| CHANGE (to Notion) | 37 |
| AA (Notion fails AA for text; nearest passing step) | 32 |
| BLUE (kept neutral, blue law) | 8 |
| PRIOR | 5 |
| HOST | 3 |
| UNMEASURED (rows) | 11, plus the §14 list |

## Phase 2 result (after)

Re-probed in a fresh build (same fixture, both schemes, scratchpad `r13-after*.json`, `p3.js`, `p4.js`).

**Computed-verified after the change** (getComputedStyle in the built page):

- Table: header text, inactive tab, calc value, "+ New page" text, OPEN text, checked checkbox (39,131,222 both themes), wrapper ink.
- Board: default / blue / green column tints, card rings and counts in light; default count and ring in dark; dark blue count 41,137,232; card property ink; light hovered card rgba(54,29,2,0.031).
- Gallery: cover text, "New page" text, card ink. Calendar: weekday labels, other-month days, prev/next chevrons, event property text. Timeline: day labels, zoom label, "+ New". List: row title and property ink.
- Menus: View settings panel row ink and value; shared-popover database menus (property header menu, add-view) shadow, item ink and hover fill.
- Tooltip: bg, name ink, second-line ink, shadow, radius in both themes.

**Checked from source only** (unit tests pin the declarations; not re-read in a browser): reminder blue steps, light destructive red, dark dialog surface and shadow, dark select head, light menu field fill, tab-overflow menu shadow, light form answer ring, "More templates" borders, switch-on blue, dark structure tile label, "Edit filters", "No date (N)", lightbox shortcut ink, toolbox preview card text, toolbar hint highlight. The e2e specs updated in 5c77bfe5 read several of these in a browser (reminder, form ring, tile label) and pass.

Notes:

- Chrome serialises the 0.051 hover alpha as `0.05` (8-bit alpha: 13/255). The source holds 0.051.
- Unchanged on purpose: BLUE rows, PRIOR rows, HOST rows, and every UNMEASURED surface.
- New database tokens: `--blok-database-ink`, `-ink-secondary`, `-ink-tertiary`, `-hover-bg`, `-checkbox-checked-bg`, `-switch-on-bg`, `-tpl-border`, `-calendar-event-muted-text`, `-column-default-*`, light `-column-blue-*` / `-column-green-*`. Database-only, so not breaking.
- `[data-blok-database-wrapper]` sets `color` and `--blok-icon-active-text` to the database ink. Database menus re-set `--blok-text-primary`, `--blok-text-secondary`, `--blok-item-hover-bg`, `--blok-popover-box-shadow` and `--blok-icon-active-text`. A host override of those core tokens no longer reaches database surfaces.

## Pass 2 (2026-10-22): research 33 §4 colour dump

Source: `research/33-notion-round12.md` §4 (light and dark sweeps of the same elements; raw JSON in `notion-measure33/colours/`).

Method: Blok's values were read with `getComputedStyle` in a built page (`vite build --mode test` from origin/main ae96e482), headless Chromium, light and dark. Fixture: one database with a select and a status option in each of the 10 colours, dates, checkboxes, text; views table, board (Color columns on), status board, gallery, calendar, timeline, feed. Hover and pressed were read with the mouse held 0.25 s. Scratchpad: `r14c/probe.tpl.js`, `inter.tpl.js`, `inter2.tpl.js`, `before.txt`, `after.txt`; the table and counts below come from `r14c/pass2.py`.

Notion values that research 33 corrected:

- Calendar weekday names are 125,122,117 in light too (research 21 read 161,158,153). Both fail AA on white, so Blok's step 114,111,106 is unchanged.
- The dark calendar today digit is black, measured again. Research 21 called it a bug. Black is 6.30:1 on the red circle, white is 3.34:1, so Blok now uses black in dark. The date picker and the timeline today chip keep white (their dark digit is unmeasured), so the calendar has its own token.

Contrast for the dark board counts is taken on their worst surface: the hovered "+ New" row (column tint plus the 0.055 hover over Blok's dark page, 29). There Notion's orange, purple and red dot inks are 4.47, 4.23 and 4.06:1, so they take the nearest passing step on the same hue. The accents pass 1 shipped (blue 41,137,232, green, brown, pink) also fall to 3.7–4.2:1 on that surface; they are left for a decision.

| Surface | Notion L / D | Blok before | Status |
|---|---|---|---|
| Page / frame bg | 255 / 25,25,25 | 255 / 29,29,28 (host) | HOST |
| Primary ink | 44,44,43 / 240,239,237 | same | MATCH |
| Secondary ink (tabs, header, property names) | 125,122,117 / 173,169,163 | 114,111,106 / 173,169,163 | AA (light) + MATCH (dark) |
| Tertiary ink | 161,158,153 / 125,122,117 | 114,111,106 / 143,140,135 | AA |
| Toolbar icon | 142,139,134 / 173,169,163 | same | MATCH |
| Uncoloured board count / "+ New" ink | 95,94,89 / 188,186,182 | same | MATCH |
| Cell borders, dividers | rgba(42,28,0,0.07) / rgba(255,255,243,0.082) | same | MATCH |
| Outlined button border | rgba(28,19,1,0.11) / rgba(255,255,235,0.1) | same (table-control-border) | MATCH |
| Row page property divider | rgba(55,53,47,0.09) / rgba(255,255,255,0.094) | 232,232,235 / rgba(255,255,255,0.1) | CHANGE |
| Header cell hover | 0.051 / 0.055 | same | MATCH |
| Header cell pressed | rgba(33,27,23,0.102) / rgba(255,255,255,0.11) | stayed at hover | CHANGE |
| Toolbar icon pressed | 0.102 / 0.110 | stayed at hover | CHANGE |
| Gallery card hover | rgba(55,53,47,0.04) / 47,47,47 | same | MATCH |
| Gallery card pressed | rgba(55,53,47,0.06) / 37,37,37 | stayed at hover | CHANGE |
| Row selection halo | rgba(35,131,226,0.14) | rgba(55,53,47,0.1) / rgba(255,255,255,0.09) | BLUE |
| Column resize / drag guides (1x144 0.21, 2x144 0.32, 4x28 solid, left table edge) | see §4.2 | table-resize 0.8 | AMBIGUOUS |
| Option pills, 10 colours, bg + text | §4.3 | same (computed, table + board header) | MATCH |
| Status dot, no-colour / gray, blue, green | 142,139,134 / 39,131,222 / 70,161,113 | same | MATCH |
| Status dot brown, orange, yellow, purple, pink, red | dot inks, both themes | the pill text | CHANGE |
| Status DEFAULT pill (no colour) = gray pill | gray pill | gray pill (shownStatusOption) | MATCH |
| Board tint gray / default | rgba(66,35,3,0.03) / rgba(252,252,252,0.03) | same | MATCH |
| Board tint + ring brown | ring rgba(139,46,0,0.086) / rgba(255,174,122,0.133) | light ring derived 0.077; tint and dark MATCH | CHANGE (light ring) |
| Board tint + ring orange | rgba(186,72,3,0.043) + rgba(224,101,1,0.13) / rgba(254,139,71,0.043) + rgba(255,134,51,0.157) | derived from the pill | CHANGE |
| Board tint + ring yellow | §4.4 | same | MATCH |
| Board tint + ring green | §4.4 | same | MATCH |
| Board tint + ring blue | §4.4 | same | MATCH |
| Board tint + ring purple | rgba(98,3,161,0.03) + rgba(102,0,178,0.08) / rgba(196,101,253,0.05) + rgba(201,122,255,0.165) | derived | CHANGE |
| Board tint + ring pink | rgba(161,3,66,0.03) + rgba(197,0,93,0.086) / tint MATCH + rgba(255,104,171,0.165) | derived | CHANGE |
| Board tint + ring red | rgba(199,3,3,0.035) + rgba(223,22,0,0.094) / rgba(251,107,107,0.047) + rgba(255,106,94,0.173) | derived | CHANGE |
| Count + "+ New" ink, coloured columns, light | the dot ink (2.2-3.7:1 on the tint) | the pill text | AA |
| Count + "+ New" ink, dark orange / purple / red | 213,128,59 / 181,119,214 / 229,100,88: 4.47 / 4.23 / 4.06 on the hovered "+ New" row (tint + 0.055 over 29) | the pill text; now 216,131,62 / 187,125,220 / 238,109,97 (4.63 / 4.56 / 4.51) | AA |
| Count + "+ New" ink, dark brown / yellow / green / pink | dot ink | same | MATCH |
| Count + "+ New" ink, dark blue | 39,131,222 (4.2:1) | 41,137,232 | AA |
| Card bg + shadow, plain | §4.4 | same | MATCH |
| Dark card bg yellow / red | 55,51,37 / 65,39,37 | 32,32,32 | CHANGE |
| Dark card bg blue / green | 33,48,65 / 36,52,43 | same | MATCH |
| Gallery card bg + shadow | §4.5 | same | MATCH |
| Feed post card | §4.5 | same | MATCH |
| Feed hover pill / small control | white + 240,239,237 / 47 + 44,44,43 | same (source) | MATCH |
| Calendar weekend cell | 249,248,247 / 32,32,32 | same | MATCH |
| Calendar grid lines + weekday row line | 230,229,227 / 56,56,54 | same (Blok draws a border, Notion a shadow) | MATCH |
| Calendar weekday names | 125,122,117 both (research 33; research 21 read 161 light) | 114,111,106 / 143,140,135 | AA |
| Calendar today marker, light | 229,100,88 + white digit (3.34:1) | same | MATCH |
| Calendar today marker, dark digit | black (6.30:1) | white (3.34:1) | CHANGE |
| Timeline view bg | 253,253,253 / 25,25,25 | page | HOST |
| Timeline header bottom | 230,229,227 / 56,56,54 inset | same | MATCH |
| Timeline today dot | 229,100,88 | same | MATCH |
| Timeline edge fades (30x30 gradients) | §4.6 | no such element in Blok | NOT BUILT |
| Side peek panel | white + 3-layer / 32 + dark shadow, radius 0 | same | MATCH |
| Center peek panel | radius 12, shadow as side, backdrop 0.6 / 0.8 | --blok-radius-dialog, peek shadow, backdrop tokens (source) | MATCH |
| Menu / popover surface | §4.7 | same (header menu computed: bg, shadow, radius 10) | MATCH |
| Card hover action bar | §4.7 | same | MATCH |
| Tooltip bg, ink, shadow, radius | 44,44,43 / 240,239,237, identical in dark | same | MATCH |
| Tooltip second line | 173,169,163 | same (TOOLTIP_MUTED_INK) | MATCH |
| "New" button | 39,131,222 + 243,249,253 (3.67:1) | 30,110,195 | AA |
| "New" chevron split | rgba(28,19,1,0.11) / rgba(255,255,235,0.1) | same | MATCH |
| Table row checkbox border | rgba(27,21,0,0.19) / rgba(255,252,235,0.306) | same | MATCH |
| Card layout tile, not picked | 1px 230,229,227, label 125,122,117 | same border; label 114,111,106 | AA |
| Card layout tile, picked ring | 2px rgb(39,131,222) | 1px border + 1px shadow in the database ink | BLUE |
| Card layout tile, picked label | 44,44,43 | 114,111,106 | CHANGE |
| Confirm dialog, light | white, radius 12, backdrop 0.6 | same (source) | MATCH |
| "View details", "Clear search" ink | 142,139,134 both | not reached by the probe (no matching Blok control found) | NOT PROBED |
| Feed avatar ring | rgba(42,28,0,0.07) / rgba(255,255,243,0.082) | not reached (fixture has no comments) | NOT PROBED |
| Map view | canvas not captured | — | UNMEASURED |

| Status | Count |
|---|---|
| MATCH | 35 |
| CHANGE | 13 |
| AA | 8 |
| BLUE | 2 |
| HOST | 2 |
| AMBIGUOUS | 1 |
| NOT BUILT | 1 |
| NOT PROBED | 2 |
| UNMEASURED | 1 |

Rows: 64; verdicts: 65

A row with a light and a dark verdict counts each. NOT PROBED: Notion has a value, but the probe did not reach the Blok element. UNMEASURED: Notion has no value. The center peek was not opened in the browser; its row is read from source.

What changed (all in `database.css`, database-scoped tokens; no published core variable changed):

- New tokens: `--blok-database-pressed-bg`, `-page-divider`, `-gallery-card-active-bg`, `-calendar-day-today-text`, `-status-dot-{brown,orange,yellow,purple,pink,red}`, `-column-{orange,purple,pink,red}-{bg,ring}`, light `-column-brown-ring`, dark `-column-{orange,purple,red}-accent` (AA steps 216,131,62 / 187,125,220 / 238,109,97), dark `-column-{yellow,red}-card-bg` and `-card-hover-bg`.
- Dark yellow and red card hover is unmeasured. The hovered card keeps its tint instead of falling back to the gray 38.
- Blue kept neutral: the picked Card layout tile. Notion draws a 2px rgb(39,131,222) outline (research 33 §3.2); Blok keeps its ink ring and now uses Notion's 44,44,43 label.
- Not a colour, not changed: the tooltip padding is 6px 10px (Notion 5px 8px).

Surfaces research 33 could not measure (Blok unchanged):

- Default and Gray board columns (not on any swept board).
- Calendar events.
- Timeline bars.
- Toasts.
- Card hover.
- New and Filter hover.
- Map canvas.
- Dark confirm dialog.
