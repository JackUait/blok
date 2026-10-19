# Research 21: Notion dark mode, view overflow keys, template repeat wording, CSV duplicate headers, row ••• menu, reminders — measured

Measured 2026-10-20 (local) in the user's signed-in Chrome via `playwright-cli -s=notion-measure11 open --extension`, on app.notion.com.
Workspace "Personal", Free plan. Viewport 1512x717 CSS px, never changed.
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure11/` (not in the repo). Screenshots `NN-*.png`, DOM dumps `*.json`, palettes `pal/L-*.txt` (light) and `pal/D-*.txt` (dark).
Helpers: copied from research-20, plus `sty.sh` (styles of a list of elements), `pal.sh` (every unique bg / ink / border / shadow inside the database block), `peekpal.sh`, `bodypal.sh`, `hov.sh` / `hovtxt.sh` / `hovsel.sh` (hover with a 4px pointer jiggle, then dump the element chain), `goview.sh`, `dlg.sh`, `cad.sh` (template cadence), `badge.sh`, `today.sh`.
Every value is `getComputedStyle` / `getBoundingClientRect` read in the page, or a screenshot. Anything not observed is **UNMEASURED**. Research-08 values were read first; this file only adds or corrects.

**Theme: original value "Use system setting" (Settings › Preferences › Appearance › Theme, "Choose a theme for Notion on this device"; High contrast also "Use system setting"). Switched to Dark for the dark pass, then set back to "Use system setting" and read back from the dropdown; body bg back to rgb(255, 255, 255).** Computed `color-scheme` on `<html>` was `light` in both themes, so Notion does not switch it for dark.

## 0. Setup

- Sidebar "New page" › Page. Private page **"Blok measure scratch 11 2026-10-20"**. Caret checked in the H1 before typing.
- `/table view` › New empty data source. Database left untitled (placeholder "New database").
- Properties: Stage (Select), Tags (Multi-select, T1–T10, random colours), Progress (Status), Due (Date), Owner (Person), Done (Checkbox), Amount (Number), Link (URL).
- Rows Alpha…Foxtrot. Due Oct 12 / 20 / 22 / 27 / 5 2026 (today = Tue Oct 20 2026). Calculation: Stage › Count › Count values.
- Views: Table, Board, List, Gallery, Calendar, Timeline, Feed, Form ("Form builder", "Create 7 questions"). **Chart not added**: research-08 hit "Your workspace has already used its 1 free chart". Its Add-view tile tooltip is just "Chart" (no badge). Chart is UNMEASURED.

## 1. Dark mode (and light where research-08 lacked it)

Notation: L = light, D = dark. `srgb(a b c / x)` values from Chrome are converted to rgba where shown with ≈.

### 1a. Shared surfaces (`33-table-dark.png`, `pal/D-*.txt`)

| Item | Light | Dark |
|---|---|---|
| Page bg | rgb(255, 255, 255) | rgb(25, 25, 25) |
| Primary ink | rgb(44, 44, 43) | rgb(240, 239, 237) |
| Secondary ink (header text, inactive tab, toolbar icon) | rgb(125, 122, 117) text / rgb(142, 139, 134) icons | rgb(173, 169, 163) (text and icons) |
| Tertiary ink ("Empty", calc label, time stamps) | rgb(161, 158, 153) | rgb(125, 122, 117) |
| Divider / cell border | rgba(42, 28, 0, 0.07) | rgba(255, 255, 243, 0.082) |
| Button border (outline buttons) | rgba(28, 19, 1, 0.11) | rgba(255, 255, 235, 0.1) |
| Hover fill (buttons, menu items, header cell, calc cell) | ≈ rgba(33, 27, 23, 0.051) | ≈ rgba(255, 255, 255, 0.055) |
| Menu / popover | bg white, radius 10px, shadow `rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px` | bg rgb(37, 37, 37), radius 10px, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px` |
| Tooltip | bg rgb(44, 44, 43), ink rgb(240, 239, 237) 12px/16.8px, radius 6px, `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset` (read in light) | UNMEASURED |
| Focus ring (keyboard) | `rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, …` on toolbar button | `rgb(25,25,25) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgb(25,25,25) 0 0 0 6px` on the filter token field |
| Search field inside a menu (focused) | — | bg rgba(252, 252, 252, 0.03), radius 6px, ring `rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px` |

### 1b. View tabs and toolbar (`pal/*-table-hover.txt`, `pal/L-toolbar-hover.txt`)

| Item | Light | Dark |
|---|---|---|
| Tab | 32px tall, radius 20px, 14px/16.8px weight 500, 20px icon | same |
| Active tab | bg rgba(33, 27, 23, 0.05), ink + icon rgb(44, 44, 43) | bg rgba(255, 255, 255, 0.055), ink + icon rgb(240, 239, 237) |
| Inactive tab | ink + icon rgb(125, 122, 117) | rgb(173, 169, 163) |
| Tab hover | ≈ rgba(33, 27, 23, 0.051) | rgba(255, 255, 235, 0.1) |
| Active tab right after a click | ≈ rgba(33, 27, 23, 0.076) | rgba(255, 255, 235, 0.1) (read with the pointer away; hover or focus state, cause not isolated) |
| "N more…" | 14px weight 400, rgb(125, 122, 117) | rgb(173, 169, 163) |
| Toolbar icon buttons (Filter, Sort, Automations, AI Autofill, Search, Open as full page, Settings) | 28x28, radius 6px, icon 16px rgb(142, 139, 134); hover ≈ rgba(33, 27, 23, 0.051) | icon rgb(173, 169, 163); hover ≈ rgba(255, 255, 255, 0.055) |
| Filter / Sort icon while a rule exists | fill rgb(39, 131, 222) | fill rgb(39, 131, 222) |
| "New" split button | rgb(39, 131, 222) / text rgb(243, 249, 253); hover ≈ rgb(31, 118, 204); divider `rgba(28,19,1,0.11) 1px 0 0 0 inset` | same fill; **hover lighter ≈ rgb(61, 144, 225)**; divider `rgba(255,255,235,0.1) 1px 0 0 0 inset` |

### 1c. Filter and sort (`27-filter-pill-light.png`, `34-pills-dark.png`, `35-filter-rule-dark.png`, `36-sort-dark.png`)

| Item | Light | Dark |
|---|---|---|
| Filter / sort pill | 24px tall, radius 32px, 14px/24px, ink rgb(39, 131, 222); bg rgba(0, 124, 215, 0.094) | bg rgba(67, 155, 255, 0.24) |
| Pill hover | ≈ rgba(0, 124, 215, 0.141) | ≈ rgba(67, 155, 255, 0.359) |
| "+ Filter" | 62x24, radius 12px, rgb(161, 158, 153) | rgb(125, 122, 117); hover ≈ rgba(255, 255, 255, 0.055) |
| Filter property list | 290 wide, search input on top, options 28px radius 6px; first option highlighted on open | bg rgb(37, 37, 37) |
| Filter rule editor (select) | — | 260x167; operator "is" 12px/18px rgb(125, 122, 117); token field 236x30 bg rgba(252, 252, 252, 0.03) radius 6px; chosen option as a pill inside it (12px); option checkbox 14x14 checked bg rgb(39, 131, 222) radius 3px; "More actions" ⋯ opens **Delete filter / Add to advanced filter** |
| Sort panel | 304x107; property + direction buttons 32px tall, radius 6px, bg white, border rgba(28, 19, 1, 0.11), 14px weight 500; "Add sort" / "Delete sort" rows rgb(125, 122, 117) | buttons bg rgb(25, 25, 25), border rgba(255, 255, 235, 0.1); rows rgb(173, 169, 163) |

Clicking the Filter icon while a rule exists toggles the pill bar on and off.

### 1d. Table (`08-table-light.png`, `23-calc-row-light.png`, `33-table-dark.png`)

| Item | Light | Dark |
|---|---|---|
| Header row | bg white, `rgb(255,255,255) -3px 0 0 0, rgba(42,28,0,0.07) 0 -1px 0 0 inset` | bg rgb(25, 25, 25), `rgb(25,25,25) -3px 0 0 0, rgba(255,255,243,0.082) 0 -1px 0 0 inset` |
| Header cell hover | ≈ rgba(33, 27, 23, 0.051) | ≈ rgba(255, 255, 255, 0.055) |
| Row hover | **no fill** (OPEN button appears) | **no fill** |
| OPEN button | white, radius 6px, `rgba(25,25,25,0.027) 0 8px 12px, rgba(25,25,25,0.027) 0 2px 6px, rgba(42,28,0,0.07) 0 0 0 1px`, 69x24 | UNMEASURED |
| Row checkbox | 16x16 radius 3px, border rgba(27, 21, 0, 0.19); checked bg rgb(39, 131, 222) | border rgba(255, 252, 235, 0.306) |
| Calculation row | top border rgba(42, 28, 0, 0.07); label "VALUES" 10px/15px weight 500 uppercase rgb(161, 158, 153); value 14px rgb(125, 122, 117); cell 70x21 radius 6px; hover ≈ rgba(33, 27, 23, 0.051); empty cell shows "Calculate" rgb(161, 158, 153) on hover | top border rgba(255, 255, 243, 0.082); label rgb(125, 122, 117); hover ≈ rgba(255, 255, 255, 0.055) |
| Selected row halo | rgba(35, 131, 226, 0.14) | rgba(35, 131, 226, 0.14) (same as research-08) |
| Selected cell ring | not re-measured; research-08: identical in both themes | — |
| "+ New page" row hover | UNMEASURED (helper missed the leaf) | UNMEASURED |

Status pills (20px, radius 10px, 8px dot):

| Status | Light bg / ink | Dark bg / ink | Dot (both) |
|---|---|---|---|
| Not started (gray) | rgba(28, 19, 1, 0.11) / rgb(73, 72, 70) | rgba(255, 252, 235, 0.306) / rgb(240, 239, 237) | rgb(142, 139, 134) |
| In progress (blue) | rgba(0, 118, 217, 0.204) / rgb(38, 74, 114) | rgba(81, 166, 255, 0.494) / rgb(229, 242, 252) | rgb(39, 131, 222) |
| Done (green) | rgba(0, 96, 38, 0.157) / rgb(42, 83, 60) | rgba(113, 255, 175, 0.337) / rgb(232, 241, 236) | rgb(70, 161, 113) |

Select / multi-select pills matched research-08's 10-colour table for every colour seen:

- Light: default, brown, orange, yellow, green, blue, purple, pink, red.
- Dark: green, yellow, purple, orange (table), pink (list), gray (side-peek T9). Blue only via the In progress status pill. Default, brown and red were not seen in dark.

### 1e. Selection bar (bulk actions) (`08-table-light.png`, `39-selection-dark.png`)

| Item | Light | Dark |
|---|---|---|
| Bar | 32px tall, radius 5px, bg white, `rgba(25,25,25,0.027) 0 8px 12px, rgba(25,25,25,0.027) 0 2px 6px, rgba(42,28,0,0.07) 0 0 0 1px` | bg rgb(37, 37, 37), `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px` |
| "N selected" | 88 wide, 14px/21px, rgb(39, 131, 222), radius `5px 0 0 5px` | same |
| Segments (Stage, Tags, Progress, Due, trash, ⋯) | 16px icon rgb(142, 139, 134), label ink; divider `rgba(42,28,0,0.07) 1px 0 0 0` | divider `rgba(255,255,243,0.082) 1px 0 0 0`; hover ≈ rgba(255, 255, 255, 0.055) |

### 1f. Board (`pal/L-board.txt`, `pal/D-board.txt`, `47-board-comment-dark.png`)

| Item | Light | Dark |
|---|---|---|
| Column tint, gray ("Not started") | rgba(66, 35, 3, 0.03) | rgba(252, 252, 252, 0.03) |
| Column tint, blue | rgba(0, 128, 213, 0.047) | rgba(41, 139, 253, 0.063) |
| Column tint, green | rgba(3, 87, 31, 0.035) | rgba(83, 255, 140, 0.035) |
| Column count | gray rgb(95, 94, 89); blue rgb(39, 131, 222); green rgb(70, 161, 113) | gray rgb(188, 186, 182); blue / green same as light |
| Card in gray column | bg white, `rgba(25,25,25,0.027) 0 4px 12px, rgba(25,25,25,0.02) 0 1px 2px, rgba(42,28,0,0.07) 0 0 0 1px`, radius 10px, 260x40 | bg rgb(32, 32, 32), `rgba(25,25,25,0.08) 0 2px 4px, rgba(255,255,243,0.082) 0 0 0 1px` |
| Card in blue column | white, ring rgba(0, 124, 215, 0.094) | bg rgb(33, 48, 65), ring rgba(71, 157, 255, 0.173) |
| Card in green column | white, ring rgba(0, 100, 45, 0.09) | bg rgb(36, 52, 43), ring rgba(119, 255, 179, 0.118) |
| Card hover | ≈ rgba(54, 29, 2, 0.031) | ≈ rgb(38, 38, 38) |
| Card hover action pill (Edit + ⋯) | 57x24, radius 4px, white + OPEN shadow; divider rgba(42, 28, 0, 0.07) | bg rgb(37, 37, 37), `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px`; divider rgba(255, 255, 243, 0.082) |
| "+ New page" tile | ring only, same tint as its column's card ring; icon in the column's count colour | same rule |
| Card title | 15px/22.5px weight 500 | rgb(240, 239, 237) |

### 1g. List, Gallery (`pal/*-list*`, `pal/*-gallery*`)

| Item | Light | Dark |
|---|---|---|
| List row | 30px, title 14px/16.8px weight 500 | — |
| List row hover | rgba(55, 53, 47, 0.06) | rgba(255, 255, 255, 0.055) |
| List property pills | 18px tall, 13px/18px (smaller than table's 20px / 14px) | dark pill colours |
| Gallery card | white + board-card shadow, radius 10px, 338x185; cover rgba(66, 35, 3, 0.03) with bottom line rgba(42, 28, 0, 0.07) | bg rgba(255, 255, 255, 0.055), `rgba(25,25,25,0.08) 0 2px 4px, rgba(255,255,243,0.082) 0 0 0 1px`; cover rgba(252, 252, 252, 0.03), bottom line transparent |
| Gallery card hover | rgba(55, 53, 47, 0.04) | rgb(47, 47, 47) |

### 1h. Calendar (`pal/*-calendar*`, `54-calendar-today-dark.png`)

| Item | Light | Dark |
|---|---|---|
| Grid lines | rgb(230, 229, 227) | rgb(56, 56, 54) |
| Weekend cells | bg rgb(249, 248, 247) | bg rgb(32, 32, 32) |
| Weekday labels | 12px/18px rgb(161, 158, 153) | rgb(125, 122, 117) |
| Other-month day numbers | rgb(161, 158, 153) | rgb(125, 122, 117) |
| Event card | white, `rgba(0,0,0,0.04) 0 2px 4px, rgba(42,28,0,0.07) 0 0 0 1px`, radius 6px, 87x28, title 14px weight 600 | bg rgb(47, 47, 47), `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 2px 4px` |
| Event hover | rgba(84, 72, 49, 0.08) | rgb(55, 55, 55) |
| Today marker | 24x24 circle `background: var(--c-redBacAccPri)` = rgb(229, 100, 88), digit 14px rgb(255, 255, 255) | same circle; **digit computed rgb(0, 0, 0)** (inline `color: var(--c-whi)` does not resolve in dark); pixels confirm black text on red |
| "Manage in Calendar" | border rgba(28, 19, 1, 0.11) | border rgba(255, 255, 235, 0.1) |
| "No date (N)" | 14px rgb(142, 139, 134) | rgb(173, 169, 163) |

### 1i. Timeline (`pal/*-timeline*`)

| Item | Light | Dark |
|---|---|---|
| Canvas | bg rgb(253, 253, 253), bottom line rgb(230, 229, 227) | bg rgb(25, 25, 25), line rgb(56, 56, 54) |
| Weekend columns | rgb(247, 247, 247) | rgba(255, 255, 255, 0.03) |
| Day labels | 12px rgb(161, 158, 153) | rgb(125, 122, 117) |
| Today | 1px line rgb(229, 100, 88); 22x22 chip rgb(229, 100, 88), digit 12px weight 500 white | same, digit white |
| Bar (single day, 37x34) | white, `rgba(0,0,0,0.04) 0 2px 4px, rgba(42,28,0,0.07) 0 0 0 1px`, radius 6px | bg rgb(37, 37, 37), `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px` |
| Bar hover overlay | ≈ rgba(33, 27, 23, 0.051) | ≈ rgba(255, 255, 255, 0.055) |
| Off-screen item chips (←) | 16x16 bg rgb(142, 139, 134), 1px white border, radius 4px | bg rgb(173, 169, 163), border rgb(25, 25, 25) |

### 1j. Feed (`pal/*-feed*`, `48-feed-reply-dark.png`)

| Item | Light | Dark |
|---|---|---|
| Card | white, `rgba(0,0,0,0.02) 0 12px 32px, rgba(0,0,0,0.05) 0 0 0 1px`, radius 12px | bg rgb(32, 32, 32), `rgba(255,255,255,0.05) 0 0 0 1px inset` |
| Card hover | `rgba(0,0,0,0.03) 0 12px 32px, rgba(0,0,0,0.086) 0 0 0 1px` | ring `rgba(255,255,255,0.1) 0 0 0 1px inset` |
| Hover action pill | 55x30, white, border rgb(240, 239, 237), `rgba(29,27,22,0.06) 0 2px 12px`, radius 6px | bg rgb(47, 47, 47), border rgb(44, 44, 43) |
| Reaction button | 40x25, radius 13px, bg rgb(249, 248, 247) | bg rgb(32, 32, 32) |
| Time stamp | 12px/16px rgb(161, 158, 153) | rgb(125, 122, 117) |
| Comment summary under a post | — | "1 reply" 14px ink + time 12px rgb(125, 122, 117) |

### 1k. Form builder (`pal/*-formbuilder.txt`)

| Item | Light | Dark |
|---|---|---|
| Question card | white, inset ring rgb(182, 212, 243) 0.5px, radius 12px | bg rgb(25, 25, 25), ring rgb(53, 95, 139) |
| Answer field | ring rgb(240, 239, 237) 1px inset, radius 6px | ring rgb(44, 44, 43) |
| "Only members…" notice | bg rgba(66, 35, 3, 0.03), radius 6px | rgba(252, 252, 252, 0.03) |
| "Edit question" chip | rgba(35, 131, 226, 0.07) | rgba(35, 131, 226, 0.14) |

### 1l. Panels and menus (`30-view-settings-light.png`, `37-view-settings-dark.png`, `38-prop-menu-dark.png`, `19-more-list-light.png`, `49-overflow-dark.png`, `50-addview-dark.png`)

| Item | Light | Dark |
|---|---|---|
| View settings | 290x574 at the right edge, radius 10px, white | bg rgb(37, 37, 37); header "View settings" 12px weight 500 rgb(173, 169, 163); row values rgb(125, 122, 117); row hover ≈ rgba(255, 255, 255, 0.055); close button 20x20 round bg rgba(255, 255, 235, 0.1) (light rgba(42, 28, 0, 0.07)) |
| Property header menu | 220 wide, items 28px | bg rgb(37, 37, 37); icon button border rgba(255, 255, 235, 0.1) |
| View overflow list | 290 wide, options 28px radius 6px, highlight ≈ rgba(33, 27, 23, 0.051) | bg rgb(37, 37, 37); search field rgba(252, 252, 252, 0.03) |
| Add-a-new-view grid | 390 wide | bg rgb(37, 37, 37) |
| Date picker | research-08 | bg rgb(37, 37, 37); selected day rgb(39, 131, 222) + white; **today = `::after` 24x24 circle rgb(229, 100, 88) with white digit**; weekday header rgb(139, 152, 152); "Today" 12px weight 500 rgb(142, 139, 134); Remind value rgb(173, 169, 163); "Learn about reminders" rgb(125, 122, 117) |

### 1m. Side peek and center peek, dark (`41-sidepeek-dark.png`, `45-centerpeek-dark.png`)

| Item | Dark |
|---|---|
| Side peek panel | 756x717, **bg rgb(32, 32, 32)** (page is rgb(25, 25, 25)), shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px`; top bar 44px same bg |
| Title | 32px/38.4px weight 700 rgb(240, 239, 237) |
| Property label | 14px/20px rgb(173, 169, 163), 19px icon rgb(173, 169, 163) |
| "Empty" | rgb(125, 122, 117) |
| Property label hover | ≈ rgba(255, 255, 255, 0.055), radius 6px, 160x34 |
| Value hover | no fill seen (three rows tried) |
| "Add a property" hover | ≈ rgba(255, 255, 255, 0.055), 132x34 |
| "Comments" heading | 13px/18px weight 500 rgb(173, 169, 163) |
| Center peek backdrop | **rgba(15, 15, 15, 0.8)** (research-08 light: 0.6) |
| Center peek panel | 960x573, radius 12px, bg rgb(32, 32, 32), same shadow; title **40px/48px** weight 700 |
| Opened board card | blue ring (focus) seen in `51-tmp.png`; not measured |

Light peek values: research-08.

### 1n. Page-layout builder chrome, dark (reachable on Free; `53-builder-dark.png`, `pal/D-builder.txt`)

- Opened from center peek › "Customize layout" (no tooltip, no badge). Cancelled with "Cancel"; nothing applied.
- Backdrop rgb(32, 32, 32); canvas rgb(25, 25, 25) with frame `rgb(35,56,80) 0 0 0 3px, rgba(15,15,15,0.1) 0 9px 12px`, radius `12px 12px 0 0`.
- Module cards: bg rgb(25, 25, 25), `rgb(53,95,139) 0 0 0 0.5px inset`, radius 8px; module header strip rgba(35, 131, 226, 0.14), 32px; module name 14px weight 500 rgb(39, 131, 222).
- Panel side: left border rgba(71, 157, 255, 0.173); "Add to panel" pill rgba(67, 155, 255, 0.24), radius 9999px, 132x36.
- Structure tiles 117x80 radius 6px bg rgb(32, 32, 32): selected "Simple" ring rgb(39, 131, 222) + label 12px weight 600 white; unselected "Tabbed" ring rgb(55, 55, 55) + label rgb(90, 90, 90).
- "Apply to all pages" split button rgb(39, 131, 222), 156x32 radius `6px 0 0 6px`.

### 1o. Comment badge (`47-board-comment-dark.png`, `pal/D-badge-*.txt`)

- One comment on row Echo. A badge shows in **Table** (after the title), **Board** card (own line under the title), **List** (after the title), **Gallery** card, **Calendar** event ("Echo 💬 1", `54-calendar-today-dark.png`). **Feed** shows "1 reply" + time instead.
- Badge: 32–34x20 button, radius 4px, comment icon 16px + count 12px/14.4px.
- Light: count rgb(44, 44, 43), icon rgb(142, 139, 134). Dark: count rgb(240, 239, 237), icon rgb(173, 169, 163); hover ≈ rgba(255, 255, 255, 0.055).

**Blok should:** take the dark tokens above as-is. Note three dark-only rules: raised surfaces (peek panel, board card, feed card) are rgb(32, 32, 32), menus rgb(37, 37, 37), and coloured board columns tint their cards (rgb(33, 48, 65) blue, rgb(36, 52, 43) green). Keep the filter/sort pill blue in both themes. Do not copy Notion's black "today" digit in dark; use white like light.

## 2. View overflow list ("N more…") — keyboard (`16-more-open.png`, `16-more-down2.png`, `17-*`, `18-more-enter.png`)

- At normal page width 2–3 tabs fit, depending on label widths (seen: "Table | Calendar | 3 more…", "Table | Board | List | 5 more…", "Table | Form builder | 6 more…"). The current view always shows as a tab. The rest go under **"N more…"**.
- Opening it focuses the search input **"Search for a view..."** (input stays focused the whole time).
- **The current view is highlighted on open** (Form builder when Form was current; Board when Board was current). Highlight = ≈ rgba(33, 27, 23, 0.051), radius 6px. `aria-selected` stays null.
- **ArrowDown / ArrowUp move the highlight** through all rows, **including "New view" and "New data source"**, and **wrap** both ways (Down from "New data source" → "Table"; Up from "Table" → "New data source").
- **Typing filters**: "ca" → Calendar + New view + New data source, Calendar highlighted. "zzz" → "No results" + New view + New data source, nothing highlighted.
- **Enter opens** the highlighted view and closes the list ("bo" + Enter → Board; Down + Enter → List).

**Blok should:** focus the search on open, highlight the current view, let arrows cycle with wrap over views and the two footer actions, filter as you type, open on Enter.

## 3. Template repeat wording (`59-…`–`74-…`)

- Template editor banner: "You're editing a template in [db] ⓘ" + dropdown **"Duplicate every…"** (no repeat set). No plan gate, tooltip or badge.
- Preset list: **Day, Weekday, Week, 2 Weeks, Month, 3 Months, 6 Months, Year**.
- Picking a preset opens **"Edit cadence"** (260x327) with **Save**: Every [N] [unit ▾]; weekday chips Mo…Su for weeks; "On the [1st] [Day]" for months; At › Around midnight; Starting › Tomorrow; Ending › Never; Timezone › GMT+2; Cancel recurrence; "Next occurrence: Nov 2 between 12–3 AM".
- Unit list: **Days, Weeks, Months, Years** (singular **Day, Week, Month, Year** when N = 1).
- Weekday chips: on = rgb(39, 131, 222) + white, off = rgba(84, 72, 49, 0.08) + rgb(95, 94, 89), 28x28 round, 12px. "Weekday" preset = Every 1 Week with Mo–Fr on.

Banner label after Save, and the template list tooltip (hover the blue ↻ icon next to the template name):

| Cadence | Banner | List tooltip |
|---|---|---|
| 2 weeks | Duplicate every 2 weeks | **Duplicate weekly** |
| 3 days | Duplicate every 3 days | **Duplicate daily** |
| 2 months | Duplicate every 2 months | **Duplicate monthly** |
| 3 years / 2 years | Duplicate every 3 years / every 2 years | **Duplicate yearly** (2 years) |
| 1 day | Duplicate every day | — |
| 1 week | Duplicate every week | Duplicate weekly |
| Weekday preset | Duplicate every weekday | Duplicate weekly |

- So the banner shows the interval, but the list tooltip drops it.
- The template's "⋯" menu has only **Set as default, Edit, Duplicate, Delete**. No "Repeat" item (research-06's doc claim does not match this build).
- Repeat was set back with **Cancel recurrence** (banner back to "Duplicate every…", no ↻ icon, `74-templates-no-repeat.png`). No occurrence fired.

**Blok should:** word the summary "Every N units" with plural units and singular for N = 1 ("every day", "every 2 weeks"). Do not copy the tooltip that drops N.

## 4. CSV import with duplicate headers (`88-…`–`92-imported-db.png`)

- File: `csv/dup-headers.csv` = `Name,Tag,Tag,Tag` + rows `RowA,a1,a2,a3`, `RowB,b1,b2,b3`.
- Path: `/table view` on the scratch page › "Import CSV" › modal **"Import CSV into Notion"** › "Choose file".
- `playwright-cli upload` failed ("can only be used when there is related modal state present"). A synthetic drop did nothing. What worked: a page-side hook on `HTMLInputElement.prototype.click` that filled the file input with an in-page `File` and fired `change` (no native dialog). Page reloaded afterwards to remove the hook.
- Step 2 **"Setup CSV columns"**: "Use first row as headers" (on); each CSV column → type (Name → Name, each Tag → Text). The right-hand preview showed headers `Name | Tag | Tag | Tag` but only one Tag cell filled (b3 / a3).
- **Result after "Import CSV": properties `Name, Tag, Tag 1, Tag 2`**, values kept per column (`b1, b2, b3`). Rows came in **reversed** (RowB above RowA). Dialog "Import complete / Your CSV import was successful / Go to import".
- The imported block kept the placeholder title "New database".

**Blok should:** rename later duplicates with " 1", " 2" suffixes (first keeps the plain name) and keep every column's values. Keep CSV row order. Why Notion reversed the rows is not known (hypothesis: newest-first insert).

## 5. Row "•••" menu — "Add to Favorites"? (`42-peek-actions-dark.png`, `56-…`, `57-fullpage-actions-light.png`)

Side peek and full page show the **same** menu (button `aria-label="Actions"`, tooltip "Page settings & actions"), with a "Search actions…" field:

Copy link ⌘⌥L · Copy page contents · Duplicate ⌘D · Move to ⌘⇧P · Version history · Updates & analytics · Appearance & layout · Use with AI · Suggest edits · Notify me › Comments · Lock page · ─ · Move to Trash · More › (Translate, Import, Export, Connections › None, Open in Mac app). Footer: "Last edited / Jack Uait / Today at …".

- **No "Add to Favorites" in this menu.** Favorites is a separate star button in the top bar, `aria-label="Favorite"`, tooltip **"Add to your favorites"** (side peek and full page, read from the DOM; the star is also visible in the center peek top bar in `45-centerpeek-dark.png`).
- The row handle menu / board-card ⋯ / list right-click (research-08, -12, -19) **do** list "Add to Favorites" first.

**Blok should:** put Favorite as a top-bar star on the opened row page, and "Add to Favorites" in the row's handle / card menu, not in the page ••• menu.

## 6. Date reminders (`40-bulk-due-dark.png`, `75-…`–`86-…`)

- **Form (Form view):** builder question options for a Date: Required, Description, End date, Include time, Question type › Date, View linked property, Sync with property name, Move / Duplicate / Delete question. **No Remind.** The live form's date picker (248x339) is only month grid + Today + Clear. **No Remind, End date, Date format or Include time.** Submit never pressed, so whether the property default reaches a form-made row is UNMEASURED.
- **Bulk edit** (2 rows selected › selection bar "Due"): the full picker (248x500) with **Remind › None**. It pre-fills the date of the first selected row (Oct 12, 2026). Escape writes nothing.
- **Property default applies in bulk:** with Due › Edit property › Notifications = "2 days before (9:00 AM)", the bulk picker showed **Remind "2 days before"**, and setting the date to Jun 20, 2027 gave **both** rows the alarm icon.
- Remind options (per cell and default): None, On day of event (9:00 AM), 1 day before (9:00 AM), 2 days before (9:00 AM), 1 week before (9:00 AM). Same as research-17.
- **Alarm icon (`alarmSmall`) next to a date with a reminder, and the date turns blue rgb(39, 131, 222):**

| View | Shows it? | Size |
|---|---|---|
| Table | yes | icon 17px, date 14px |
| Board card (Due made visible) | yes | icon 14px, date 12px/18px |
| List (Due made visible) | yes | icon 17px, date 14px |
| Gallery card (Due made visible) | yes | icon 14px, date 12px/18px |
| Calendar event | only once Due is shown on cards (Property visibility); title-only card has no icon | — |
| Timeline bar (Due made visible) | yes, after the bar ("Foxtrot June 15, 2027 ⏰", `80-alarm-timeline.png`) | — |
| Feed | UNMEASURED (Feed cards show no properties by default; not toggled) | — |

- Cleanup: Alpha, Delta, Foxtrot set back to Remind None (no icon), Due's Notifications back to None. All reminder dates were in June 2027.

**Blok should:** show Remind in the full picker and in bulk edit, not in form answers. Apply the property's default when a bulk edit sets a date. Show the alarm icon + blue date wherever the date property is visible.

## Teardown and side effects

- Scratch page: top-bar Actions › **Move to Trash**. Reloading its URL shows "Jack Uait moved this page to Trash just now. It will be permanently deleted in 30 days." The sidebar no longer lists it. Trash not emptied, "Permanently delete" never clicked.
- After trashing, Notion opened the user's "New database" page. Nothing was clicked there.
- **Theme:** "Use system setting" → Dark → back to **"Use system setting"** (dropdown read back; body rgb(255, 255, 255)). High contrast never touched. The setting is per device ("on this device").
- **No billing surface was opened.** No Upgrade / Plus / Business item was clicked. The Settings modal was opened twice (theme only); its snapshots were deleted.
- Accidents, all inside the scratch page and fixed:
  - A "1" was typed into the untitled database title when a helper's Escape closed the template modal first. Cleared at once (`66-title-fixed.png`).
  - Clicking the template name in the templates list created one untitled row from the template. Moved to Trash at once.
  - Hovering near the sidebar's "View all" opened its page list popover. Nothing was clicked.
- Template repeat was saved several times (2 weeks, 3 days, 2 months, 3 years, 1 day/week/month/year, weekday), then removed with **Cancel recurrence** within minutes. Earliest "next occurrence" shown was "Tomorrow between 12–3 AM", so none fired.
- Reminders existed for a few minutes on June 2027 dates only (Foxtrot, then Alpha + Delta through bulk edit). All set back to None; Due's Notifications default set to "2 days before" and back to None.
- One comment "measure comment" on row Echo (in Trash with the page).
- Scratch view settings changed: Due shown on Board / List / Gallery / Calendar / Timeline; Board peek switched to Center peek via "Switch peek mode"; filter + sort added then deleted.
- CSV import: a page-side hook on `HTMLInputElement.prototype.click` was installed to feed the file; the page was reloaded afterwards and the hook was gone. No native file dialog opened.
- After the import the sidebar Inbox showed a "1" badge. It was not opened, so its content is unverified (likely the import notice).
- Form: the live form was opened in preview and its date picker opened. **Submit was never pressed.**
- Session `notion-measure11` was opened by this run (no session was open at start) and closed at the end.

## UNMEASURED (collected)

- Chart view (Free plan already used its one chart; not added).
- Dark: OPEN button on table row hover, "+ New page" table row hover, cell-editing look, conditional colour, filter pills of other types, board drag ghost.
- Light: side-peek hover values (research-08 has static ones only).
- Whether a property default reminder applies to a row created by form submission (Submit never pressed).
- Feed alarm icon.
- Tab "active right after click" fill: hover vs focus not separated.
