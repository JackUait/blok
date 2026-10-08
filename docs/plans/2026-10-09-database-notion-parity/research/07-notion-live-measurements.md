# 07 — Notion database live measurements

Measured on 2026-10-09 with a headless Chrome session (`playwright-cli -s=notion-measure`, no extension, signed out). The viewport was 1440×900 unless noted.

Every value below comes from `getComputedStyle` / `getBoundingClientRect` run through `eval`, or from a screenshot taken in this session. Rect format: `[x, y, w, h]` in CSS px. Shots are in `shots/`. Raw dumps are in `data/` (`pills-*.json`, `peek-anim.txt`, `table.json`).

## Sources

| Key | URL | Views measured |
|---|---|---|
| A | https://notion-templates.notion.site/f1337a6daf6e4577b393b1b951b29caf (Blog Editorial Calendar, by Notion) | table, grouped table, calendar, board, center peek, dark mode (table + board) |
| B | https://notion.notion.site/29d47fbeefc84054a98a3f8005c377ad?v=757452d53e294d898728039068a8205c (Lenny's Product Roadmap) | timeline, empty state |
| C | https://efficient-flannel-6da.notion.site/Design-Mood-Board-d7db4a53eeb84d6aa132cc52313433b1 | gallery (cover only), grouped gallery pills (red, pink, purple) |
| D | https://notion-templates.notion.site/7ea58f0d22f44c96818842319c1509ae?v=c821be36936e46f0a8917fae6721b22d (Docs, by Notion) | list, gallery with page-content preview, gallery width behaviour |
| E | https://salimahmed.notion.site/Assignments-Template-Salim-dd35edb9fed34203b38ce978d3837300 | **inline** DB (`.notion-collection_view-block`): board + table, width behaviour, header/cell hover |

A–D are full-page databases (`.notion-collection_view_page-block`). E is the only inline database measured. Its page renders a 1248px text column at 1440 (`.notion-page-content` `max-width: 100%`), so it looks like a full-width page. **An inline DB in a default-width (narrow) page was not measured.**

Access notes:
- After about 5 quick page loads, *.notion.site served a Cloudflare Turnstile "Verify you are human" page (`shots/_challenge.png`). It was not bypassed. After a 10-minute cooldown, loads spaced 30–45 s apart worked.
- Public pages are read-only. No "+ New" button, no "New" row, and no row-hover background were rendered. **"+ New" styling could not be measured.**
- Images in gallery C were 1×1 GIF placeholders (`data:image/gif…`), so covers render empty (`shots/15-gallery.png`).
- The calendar in A shows the current month (Oct 2026). Its items are in Nov 2022, so **calendar event cards were not measured.**

## Global tokens seen everywhere (light)

| Token | Value |
|---|---|
| Font family | `ui-sans-serif, -apple-system, "system-ui", "Segoe UI Variable Display", "Segoe UI", Helvetica, "Apple Color Emoji", "Noto Sans Arabic", "Noto Sans Hebrew", Arial, sans-serif, "Segoe UI Emoji", "Segoe UI Symbol"` |
| Primary ink | `rgb(44, 44, 43)` |
| Secondary ink (header text, inactive tab, OPEN label) | `rgb(125, 122, 117)` |
| Icon gray (header icons, filter/sort/search) | `rgb(142, 139, 134)` |
| Tertiary ink (calendar weekdays, group count, "Empty") | `rgb(161, 158, 153)` |
| Divider / cell border | `rgba(42, 28, 0, 0.07)` (1px) |
| Page background | `rgb(255, 255, 255)` |
| Accent blue (checked checkbox, active filter icon) | `rgb(39, 131, 222)` |
| Today red | `rgb(229, 100, 88)` |
| Page side padding (full-page DB) | 96px (table, board margin) / 104px (calendar, gallery, list padding) |

## View tabs bar (A, D)

| Item | Value |
|---|---|
| Tab wrapper `.notion-collection-view-tab-button` | 40px tall, `margin-right: 1px` |
| Tab pill `[role=tab]` | 32px tall, `padding: 6px 12px`, `border-radius: 20px` |
| Active tab | bg `rgba(33, 27, 23, 0.05)`, text + icon `rgb(44, 44, 43)` |
| Inactive tab | bg transparent, text + icon `rgb(125, 122, 117)` |
| Hover inactive | bg `color(srgb 0.129 0.106 0.090 / 0.051)` = `rgba(33,27,23,0.05)`, read 0.5 s after hover (settled). Same as the active bg. Text stays gray. |
| Tab label | 14px / 16.8px, weight 500 |
| Tab icon | 20×20 svg (`viewTable`, `viewCalendar`, `bulletedList`, `squareGrid2X2`…), `margin-right: 6px` |
| Transition | `background 0.1s ease-in-out` |
| Active indicator | No underline. Active = filled gray pill (`::after` box-shadow `none`). |
| Filter / Sort / Search buttons | 28×28, `padding: 6px`, `border-radius: 6px`, 16px svg fill `rgb(142,139,134)`; `transition: background 0.1s ease-in-out` |
| Filter active (B) | svg fill `rgb(39, 131, 222)` |
| "Edit filters" (empty state, B) | 28px tall, `padding: 0 8px`, radius 6px, `border: 1px solid rgba(28, 19, 1, 0.11)`, 14px weight 500, color `rgb(142,139,134)` |

## Table (A) — `shots/01-editorial-default.png`, `02`, `03`, `05`

| Item | Value |
|---|---|
| Width | `.notion-table-view` width 1677px in a 1440 viewport, `padding: 0 96px 180px`. It overflows; the ancestor `.notion-scroller` has `overflow-x: auto`. Rows start at x=104 (`margin-left: 8px` on the row). |
| Column widths (from data) | Name 276, Status 108, Type 168, Audience 200, Writer 157, Reviewer 157, Publish date 126, Checkbox 85, URL 200 |
| Header row `.notion-table-view-header-row` | height 36px, bg white, `box-shadow: rgb(255,255,255) -3px 0 0 0, rgba(42,28,0,0.07) 0 -1px 0 0 inset` (bottom line is an inset shadow, not a border) |
| Header cell `.notion-table-view-header-cell` | 36px; inner `[role=button]` `padding: 0 8px`; `transition: background 0.02s ease-in` |
| Header text | 14px / 16.8px, weight 400, `rgb(125, 122, 117)` |
| Header icon | 16×16 svg in an 18px slot, fill `rgb(142, 139, 134)`, 6px gap to the label |
| Header hover | none. In E, with the pointer on the header cell (`:hover` true on the cell and its `[role=button]`), every element read had bg `rgba(0,0,0,0)`. |
| Body cell `.notion-table-view-cell` | `border-right: 1px solid rgba(42,28,0,0.07)`, `border-bottom: 1px solid rgba(42,28,0,0.07)`. No top or left borders on cells. |
| Cell padding | text / title / date: `7.5px 8px`; select / multi-select / person: `8px`; checkbox: `10px 8px` |
| Row height | 58px here, because the date wraps to 2 lines (cell content 42px + padding). Single-line row measured in E: **37px** (36px content + 1px bottom border). |
| Cell text | 14px / 21px, weight 400, `rgb(44, 44, 43)` |
| Title cell | 14px / 21px, **weight 500**, ink; page icon 22×22 box (emoji 14px glyph in 20px box), `margin: -2px 3px 0 -2px`, `border-radius: 3.5px` |
| Date format | "November 14, 2022" (long month, no time), wraps in a 126px column |
| Person | avatar 20×20, round, 6px right margin, name 14px/21px |
| Checkbox | 16×16, `border-radius: 3px`. Unchecked: `1px solid rgba(27, 21, 0, 0.19)`. Checked: bg `rgb(39, 131, 222)`, white 14px checkmark svg (`checkmarkFillSmall`). `transition: background 0.2s ease-out`. Left-aligned in the cell. |
| Row hover | none. In E, `elementFromPoint` ancestors of the hovered cell (cell, row) kept bg `rgba(0,0,0,0)`. Hovering the title cell shows the OPEN button (A). |
| OPEN button (hover, `shots/03`) | outer 68.6×24, bg white, radius 6px, `box-shadow: rgba(25,25,25,0.027) 0 8px 12px, rgba(25,25,25,0.027) 0 2px 6px, rgba(42,28,0,0.07) 0 0 0 1px`, padding 2px. Inner 20px tall, `padding: 0 4px`, radius 4px, 12px / 18px weight 500, `rgb(125,122,117)`, `transition: background 0.02s ease-in`. Sits at the right of the title cell. |
| Number alignment | not measured: no number column on any page loaded |

### Grouped table (A "By content type") — `shots/05-by-content-type.png`

| Item | Value |
|---|---|
| Group header row | 42px tall, `margin-left: 8px` |
| Collapse caret | 24×24 button, radius 4px; svg `arrowCaretDownFillSmall` 11.2px, ink; `transition: transform 0.2s ease-out` |
| Group pill | wrapper `padding: 3px`, radius 6px; pill 20px, `padding: 0 6px`, radius 4px, **14px/20px weight 500** |
| Count | 14px / 16.8px, weight 500, `rgb(161, 158, 153)`, inside a 24px button `padding: 0 8px` |
| Gap between groups | `margin-bottom: 12px` |

## Select / multi-select / status pills (A, B, C, D)

| Shape | Height | Padding | Radius | Font |
|---|---|---|---|---|
| Select / multi-select in a table cell | 20px | `0 6px` | 4px | 14px/20px 400 |
| Same in a board card | 18px | `0 6px` | 4px | 12px/18px 400 |
| Same in a timeline bar / list row | 18px | `0 8px` | 4px | 13px/18px 400 |
| Status (all contexts seen) | 20px | `0 9px 0 7px` | 10px | 14px/20px 400, plus an 8×8 dot (`border-radius: 99px`, `margin-right: 5px`) |
| Multi-select spacing in a table | 8px between pill boxes (x 577.8 → 585.8) | | | |

Color names are **verified**. The page's `/api/v3/` responses list each option with its `color` (A: Newsletter default, Email/Launch brown, Inspiration orange, Podcast yellow, Blog/Published green, Drafting blue; C: Character red, Graphics pink, Logo purple, Arrangement orange, Colour Palette brown, Typography blue, Vibe default). Saved in `data/api-colors.txt` and `data/api-colors-C.txt`.

| Color | Light bg | Light text | Dark bg | Dark text | Seen on |
|---|---|---|---|---|---|
| default | `rgba(42, 28, 0, 0.07)` | `rgb(44, 44, 43)` | `rgba(255, 255, 243, 0.082)` | `rgb(240, 239, 237)` | Newsletter, Everyone, Vibe, Tech spec |
| status with no color key ("Backlog"; its API option has no `color`) | `rgba(28, 19, 1, 0.11)` | `rgb(73, 72, 70)` (dot `rgb(142,139,134)`) | `rgba(255, 252, 235, 0.306)` | `rgb(240, 239, 237)` | Backlog |
| brown | `rgba(127, 51, 0, 0.157)` | `rgb(88, 68, 55)` | `rgba(255, 184, 132, 0.365)` | `rgb(245, 237, 233)` | Email, Launch, Colour Palette |
| orange | `rgba(196, 88, 0, 0.204)` | `rgb(106, 66, 34)` | `rgba(255, 143, 71, 0.482)` | `rgb(251, 235, 222)` | Inspiration, In Design |
| yellow | `rgba(209, 156, 0, 0.282)` | `rgb(101, 81, 33)` | `rgba(255, 188, 53, 0.46)` | `rgb(249, 243, 220)` | Podcast, In Engineering |
| green | `rgba(0, 96, 38, 0.157)` | `rgb(42, 83, 60)` (status dot `rgb(70,161,113)`) | `rgba(113, 255, 175, 0.337)` | `rgb(232, 241, 236)` | Blog, Published |
| blue | `rgba(0, 118, 217, 0.204)` | `rgb(38, 74, 114)` (status dot `rgb(39,131,222)`) | `rgba(81, 166, 255, 0.494)` | `rgb(229, 242, 252)` | Drafting, Typography |
| purple | `rgba(92, 0, 163, 0.14)` | `rgb(85, 59, 105)` | not measured | not measured | Logo (C) |
| pink | `rgba(183, 0, 78, 0.153)` | `rgb(104, 53, 78)` | not measured | not measured | Graphics, Strategy doc |
| red | `rgba(206, 24, 0, 0.165)` | `rgb(109, 53, 49)` | not measured | not measured | Character, Decision doc |

No option using the "gray" color was found. The "Backlog" row is a status option with no color key, and it renders darker than a default select pill. Dark pill values come from page A only, which had no purple, pink or red.

## Board (A "By status") — `shots/06-board-by-status.png`, `07-board-card-hover.png`

| Item | Value |
|---|---|
| `.notion-board-view` | `margin: 0 96px`, `padding-left: 8px`; scrolls horizontally |
| Column width | 276px (260px card + 8px padding each side) |
| Column gap | `margin-right: 12px` |
| Column header (sticky strip) | 40px, `padding: 0 8px`, radius `10px 10px 0 0`, bg = tinted group color |
| Column body `.notion-board-group` | `padding: 0 8px 8px`, `margin: 0 12px 16px 0`, radius `0 0 10px 10px`, same tint |
| Group tints (light) | gray `rgba(66, 35, 3, 0.03)`; blue `rgba(0, 128, 213, 0.047)`; green `rgba(3, 87, 31, 0.035)` |
| Group tints (dark) | gray `rgba(252, 252, 252, 0.03)`; blue `rgba(41, 139, 253, 0.063)`; green `rgba(83, 255, 140, 0.035)` |
| Column header pill | wrapper `padding: 3px`, radius 6px, `transition: background 0.02s ease-in`; status pill as in the pill table |
| Count text in column header | not rendered on this board |
| Card | bg white, radius 10px, `box-shadow: rgba(25,25,25,0.027) 0 4px 12px 0, rgba(25,25,25,0.02) 0 1px 2px 0, rgba(42,28,0,0.07) 0 0 0 1px`, no border, `transition: background 0.1s ease-out` |
| Card gap | `margin-bottom: 8px` |
| Card title row | `padding: 8px 10px 6px`; icon 24×24 box (`margin: 0 4px 0 -2px`, radius 5px); title 15px / 22.5px weight 500 ink |
| Card property rows | 28px each, `padding: 5px`, `margin: 0 6px`, radius 5px; text 12px / 18px; avatar 18px; card bottom `padding-bottom: 8px` |
| Card hover | bg → `color(srgb 0.211 0.112 0.0096 / 0.031)` (≈ `rgba(54, 29, 2, 0.031)`, still the same after 1 s); shadow unchanged; "…" button opacity 0 → 1 |
| Card "…" button | 28×24, white, radius 4px, menu shadow (same as OPEN), `padding: 4px 6px`, 16px `ellipsisSmall` svg `rgb(125,122,117)`; wrapper `transition: opacity 0.2s ease` |
| Dark card | bg `rgb(32, 32, 32)`, `box-shadow: rgba(25,25,25,0.08) 0 2px 4px 0, rgba(255,255,243,0.082) 0 0 0 1px`; title `rgb(240,239,237)` |

## Gallery (C, D) — `shots/15-gallery.png`, `16-gallery-scrolled.png`, `17-moodboard-bytag.png`, `22-gallery-with-titles.png`

| Item | Value |
|---|---|
| `.notion-gallery-view` | `padding: 0 104px` (D adds 180px at the bottom) |
| Grid | `display: grid`, `gap: 16px`, `grid-template-columns: 296px ×4` at 1440 (1232px content width) |
| Width behaviour (D) | viewport 1000 → `388px 388px`; 700 → `492px` (one column). Side padding stays 104px. |
| Card | 296 wide; same bg, radius 10px, shadow and transition as the board card |
| Cover (image) | 296 × 146.25, `object-fit: cover`, `object-position: 50% 50%` (one card 50% 73.34%), radius `1px 1px 0 0`; a 1px `rgba(42,28,0,0.07)` bottom line under the cover |
| Cover (page-content preview, D) | 146.3 tall, bg `rgba(66, 35, 3, 0.03)`, `padding: 8px 8px 0`, bottom border `1px solid rgba(42,28,0,0.07)`. It renders the page body: h2 22.5px/29.25 600, h3 18px/23.4 600, text 12px/18 `rgb(125,122,117)` |
| Card height | 186.3 at 296w (146.3 cover + 40 title); 206.5 at 388w; 258.3 at 492w |
| Title area | 40px, `padding: 8px 10px`; icon 24px box; title 15px / 22.5px weight 500 |
| Card hover (C) | bg `rgba(55, 53, 47, 0.04)`; "…" opacity → 1 |
| Grouped gallery header pill (C) | 20px, `padding: 0 6px`, radius 4px, 14px/20px **500** |

## List (D) — `shots/18-list.png`, `19-list-hover.png`

| Item | Value |
|---|---|
| `.notion-list-view` | `padding: 0 104px 180px`; inner collection `padding: 4px 0` |
| Row | 30px tall, `margin: 1px 0` (32px pitch) |
| Row link `a[role=link]` | `padding-left: 4px`, radius 6px, `transition: background 0.02s ease-in` |
| Row hover | bg `rgba(55, 53, 47, 0.06)` |
| Icon | 22×22, `margin-right: 5px`, radius 3.5px |
| Title | 14px / 21px weight 500 ink |
| Properties | right-aligned. Each slot is 30px tall, `padding: 0 8px`, radius 5px. Person = 20px avatar only. Select pill 18px, `padding: 0 8px`, 13px/18px. |

## Calendar (A) — `shots/04-calendar.png`

| Item | Value |
|---|---|
| `.notion-calendar-view` | `padding: 0 104px 180px`; grid 1232 wide (+1px left padding) |
| Month title | "October 2026", 14px / 14px **600** ink, `margin: 0 8px`; title bar 42px |
| Prev / Next | 24×24, radius 6px, 20px chevron fill `rgb(142,139,134)`, `transition: background 0.1s ease-in-out` |
| "Today" button | 24px tall, `padding: 0 6px`, radius 6px, 14px / 16.8px ink |
| Weekday header `.notion-calendar-header-days` | 24px tall, `box-shadow: rgb(230,229,227) 0 1px 0 0`; labels 12px / 18px, centered, `rgb(161,158,153)`, "Sun … Sat" |
| Day cell | 175.9 × 140, `border-right` + `border-bottom: 1px solid rgb(230, 229, 227)`; grid left edge `box-shadow: rgb(230,229,227) -1px 0 0 0` |
| Weekend cell bg | `rgb(249, 248, 247)` (Sat and Sun) |
| Day number `.notion-calendar-view-day` | 14px / 24px, right-aligned, about 10px from the right and 4px from the top; other month `rgb(161,158,153)`; this month ink; first of month "Oct 1"; `transition: color 0.1s ease-out`; `animation: shimmer-calendar-transition 0.7s ease-in-out` |
| Today | 24×24 circle, bg `rgb(229, 100, 88)`, white 14px |

## Timeline (B) — `shots/11-timeline.png`, `12-timeline-bars.png`, `13-timeline-bar-hover.png`

| Item | Value |
|---|---|
| `.notion-timeline-view` | very wide canvas (9440px at x=-4000), `padding-bottom: 96px`; a left table panel (~305px) holds the property columns |
| Row `.notion-timeline-item-row` | 36px |
| Month label | 14px / 21px weight 500 ink, `padding-left: 16px` |
| Week / day numbers | 12px, `rgb(161,158,153)`, in a 28px line box |
| Today marker | 22×22 circle `rgb(229,100,88)` (radius 11px), white 12px/18px **500** text; a vertical 1px `rgb(229,100,88)` line runs down the canvas |
| Month gridlines | 1px wide, `border-right: 1px solid rgba(42,28,0,0.07)` |
| Header row bottom | `box-shadow: rgb(230,229,227) 0 -1px 0 0 inset` |
| Bar `.notion-timeline-item` | 34px tall (inside a 36px row), bg white, radius 6px, `box-shadow: rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px` |
| Bar content | `padding-left: 24px` (room for a toggle caret); emoji icon 20px box; title 14px / 21px **500** ink; person avatar 20px round (initial letter 11px `rgb(142,139,134)`); select pill 18px, `0 8px`, 13px/18px |
| Range readout on the date axis | pill bg `rgb(247,247,247)`, radius 11px, `padding: 0 6px`, 22px tall, shows "Mar 23 … Jul 11" |
| Selected item halo `.notion-selectable-halo` | bg `rgba(35, 131, 226, 0.14)`, radius 6px (Notion selection) |
| Off-screen arrow | 16×16, bg `rgb(142,139,134)`, radius 4px |
| Zoom control | "Year ⌄" 24px, `padding: 0 6px`, radius 6px, 14px `rgb(142,139,134)` |
| Bar hover | bg and shadow unchanged (read after hover) |

## Peek / open page (A) — `shots/09-peek.png`

| Item | Value |
|---|---|
| How it opens (this DB) | Clicking the row title does nothing. Clicking the hover **OPEN** button opens a **center peek** (`&p=<id>&pm=c` added to the URL, no reload). `pm=c` is this database's open-mode setting; other DBs may use side peek. |
| Backdrop `.notion-peek-renderer` | full viewport, bg `rgba(15, 15, 15, 0.6)` |
| Panel | 960 × 756 at (240, 72), i.e. 72px top/bottom margin; bg white; radius 12px; shadow `rgba(25,25,25,0.027) 0 8px 12px, rgba(25,25,25,0.027) 0 2px 6px, rgba(42,28,0,0.07) 0 0 0 1px` |
| Top bar `.peek-top-hover-area` | 44px, `padding: 0 10px 0 12px`, radius `12px 12px 0 0` |
| Page title | 40px / 48px weight 700 ink |
| Property row | 34px tall; label column 160px; label 14px/20px `rgb(125,122,117)` with a 16px icon; value 14px/21px ink; empty value "Empty" `rgb(161,158,153)` |
| Open animation | none detected. `document.getAnimations()` sampled every ~45ms from the click held only a 20ms background transition and the 1000ms `shimmer` loader (translate -100% → 100%, linear). Backdrop and panel were already final at the first sample. |
| Peek renderer before opening | `.notion-peek-renderer` 720px wide, `transform: translateX(720px)`, `transition: width 0.2s, transform 0.2s`. Hypothesis (unverified): this is the side-peek slide-in. A side peek was never observed. |

## Dark mode (A) — `shots/20-dark-table.png`, `21-dark-board.png`

- `page.emulateMedia({colorScheme:'dark'})` on an already loaded page did **not** re-theme it (`.notion-light-theme` stayed).
- Reloading with dark emulation did re-theme it: `.notion-dark-theme`, app bg `rgb(25, 25, 25)`.

| Item | Dark value |
|---|---|
| Header row | bg `rgb(25,25,25)`, inset line `rgba(255, 255, 243, 0.082)` |
| Header text + icon | `rgb(173, 169, 163)` |
| Cell borders | `1px solid rgba(255, 255, 243, 0.082)` |
| Title / cell text | `rgb(240, 239, 237)` |
| Active tab | bg `rgba(255, 255, 255, 0.055)`, text `rgb(240,239,237)`; inactive `rgb(173,169,163)` |
| Checkbox unchecked | `1px solid rgba(255, 252, 235, 0.306)`, radius 3px; checked bg `rgb(39,131,222)` |
| Board card / tints | see Board table |
| Pills | see pill table |

## Inline database (E) — `shots/23-inline-board-salim.png`, `24-inline-board-1000.png`, `25-inline-table-salim.png`, `26-inline-table-header-hover.png`

| Item | Value |
|---|---|
| Block | `.notion-collection_view-block` at x=96, same width as `.notion-page-content` (1248 at 1440; 808 at 1000) |
| DB title | "Assignments", 24px / 31.2px, weight 600, ink |
| Horizontal scroller | `.notion-scroller.horizontal` spans the **whole viewport** (x 0 → 1440, and 0 → 1000), `overflow-x: auto`. The view inside has `margin: 0 96px` (board) or `padding: 0 96px` (table), so content lines up with the text column but scrolls edge to edge. |
| Table filler | header row and row lines run to the end of the text column (header row 1240 wide), past the last column (columns sum 680: Name 280, Assign 200, Status 200) |
| Table rows | 37px each (single line) |
| Board column header (status group style) | no pill. 20px status icon + label 14px / 21px **weight 500** in the group color (gray `rgb(142,139,134)`, blue `rgb(39,131,222)`, green `rgb(70,161,113)`) |
| Board count | 14px / 16.8px weight 400, `padding: 0 6px`, colored like the label (`rgb(142,139,134)` / `rgb(39,131,222)` / `rgb(70,161,113)`) |
| Board columns / card | same as page A: 276 wide, 12px gap, tints `rgba(66,35,3,0.03)` / `rgba(0,128,213,0.047)` / `rgba(3,87,31,0.035)`; card title 15px / 22.5px 500 |

## DOM structure / class names (for later measurement)

- Inline DB: `.notion-collection_view-block`. Full-page DB: `.notion-collection_view_page-block` inside `.notion-frame`.
- Tabs: `.notion-collection-view-tab` › `.notion-collection-view-tab-button` › `[role=tab]`. Toolbar: `.notion-collection-filter`, `.notion-collection-sort`, `[aria-label=Search]`.
- Body: `.notion-collection-view-body` (also a `.notion-scroller`).
- Per layout: `.notion-table-view`, `.notion-board-view`, `.notion-gallery-view`, `.notion-list-view`, `.notion-calendar-view`, `.notion-timeline-view`.
- Table: `.notion-table-view-header-row`, `.notion-table-view-header-cell`, `.notion-table-view-row` (+ `.notion-collection-item`), `.notion-table-view-cell`, `.notion-collection-result-wrapper`.
- Board: `.notion-board-group`; cards are `.notion-page-block` › `[role=presentation]` › `a[role=link]`.
- Calendar: `.notion-calendar-header-days`, `.notion-calendar-view-day`, `.notion-shimmer-calendar-transition`.
- Timeline: `.notion-timeline-item-row`, `.notion-timeline-item`, `.notion-timeline-item-properties`, `.notion-shimmer-timeline-transition`.
- Shared: `.notion-record-icon`, `.content-editable-leaf-rtl` (titles), `.notion-selectable`, `.notion-selectable-halo`, `.notion-peek-renderer`, `.notion-collection-view-empty-state`, `.notion-light-theme` / `.notion-dark-theme`.
- Most other elements use atomic hashed classes (`x87ps6o x1b7c0jy …`, StyleX-style). They are not stable selectors. Use `role`, `aria-label` or the `notion-*` classes.

## Not measured

- "+ New" button and new-row affordance. Public pages do not render them.
- Number column alignment. No number property on the pages loaded.
- Calendar event cards. No items in the visible month.
- Side-peek panel (open state). The one DB opened uses center peek.
- Dark values for purple, pink and red pills; dark list, gallery, calendar and timeline.
- Inline DB inside a default-width (narrow) page. The only inline DB (E) sits on a full-width page.
- Column header pill + count for a board grouped by a select property with pills (A's board shows no count; E uses the status icon style).
