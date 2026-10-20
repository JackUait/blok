# Research 26: the last unmeasured Notion behaviours (light values, "New data source" panel, bordered controls, dark leftovers)

Measured 2026-10-20 (local) in the user's signed-in Chrome via `playwright-cli -s=notion-measure14 open --extension`, on app.notion.com.
Workspace on the Free plan. Viewport 1512x717 CSS px, DPR 2, never changed. Theme at start: light (body bg rgb(255, 255, 255)).
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure14/` (not in the repo). Helpers copied from research/23 (`notion-measure13/`), session renamed; `sty.sh` now also prints `padding` and `gap`; new `picktoday.sh` (date picker day cells with `::before`/`::after`) and `todaybtn.sh`.
Every value is `getComputedStyle` / `getBoundingClientRect` read in the page, a tooltip read from the DOM, or a screenshot. Anything not observed is **UNMEASURED**.
Names of the user's own pages and databases are not written here; lists of them are given as a count and a row shape.

Input: ledger `25-parity-status-final-2026-10-20.md` §4 ("Open / not built" and every UNMEASURED item), plus ledger 24 §4's list.

## 0. Setup

- Sidebar "New page" button (tooltip **"New…"**) › menu Page / Chat / AI Meeting Notes / Database › **Page**. Private page **"Blok measure scratch 14 2026-10-20"**. Caret checked in the H1 before typing.
- `/table view` › Enter. This opened the **"New database"** side panel (section 2). Then "New empty data source".
- Properties: Name, Due (Date), Stage (Select). Rows Alpha, Bravo. Alpha's Due set to **Oct 12 2026** so the selected day is not today (today = Tue Oct 20 2026).

## 1. Light-mode values

### 1a. "View settings" panel header: the 12px / 14px conflict is two different elements (`13-view-settings-light.png`)

Opened from the database toolbar's settings button (`aria-label="Settings"`, tooltip "Settings").

| Element | Light | Dark (research 21) |
|---|---|---|
| Root page title **"View settings"** (no Back arrow) | **12px / 16px, weight 500, rgb(125, 122, 117)** (secondary ink) | 12px weight 500, rgb(173, 169, 163) |
| Sub-page title with a Back arrow (e.g. **"Layout"**) | **14px / 21px, weight 600, rgb(44, 44, 43)** (`SPAN`) | not re-read |
| Creation panel title (**"New database"**, **"Link to existing data source"**, section 2) | **14px / 21px, weight 600, rgb(44, 44, 43)** | not re-read |

- So research 08's "14px/21px weight 600" is the title of a **sub-page or a creation panel** ("New view" / "New database"). The **root** "View settings" title is a 12px/500 label in secondary ink, in both themes. Same font size in both themes; only the ink differs.
- Root panel: 290x574 at x 1210, white, radius 10px, menu shadow `rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px`.
- Root rows, in order (14px/16.8px rgb(44, 44, 43); values rgb(161, 158, 153)): **Layout** "Table", **Property visibility** "3", **Filter**, **Sort**, **Group**, **Conditional color**, **Copy link to view**, section label **"Data source settings"**, **Source** "New database", **Edit properties**, **Automations**, **AI Autofill**, **Turn into**, **More settings**, then **Manage data sources**, **Lock database**, **Manage in Calendar**.
- **"Data source settings" label:** 12px/14.4px weight 500, rgb(125, 122, 117); its row is 274x19 with padding `4px 8px 0`. A "Loading..." status spinner (16x16) sits at its right end while the panel loads.
- **Source row with one source: greyed.** `role=menuitem`, **`aria-disabled="true"`, opacity 0.4, cursor default**, 274x28, icon `pathRoundEnds`. Hover shows **no tooltip**.

### 1b. View settings close (×) button

- `role=button`, `aria-label="Close"`, **20x20, radius 100%, bg rgba(42, 28, 0, 0.07)**, padding 0. Icon `xMarkSmall` (viewBox 0 0 16 16) drawn 14x14, fill rgb(142, 139, 134). At the header's right end (x 1464 in a 1210–1500 panel; 16px from the right edge).
- Hover: bg **rgba(42, 28, 0, 0.106)** (`color(srgb 0.165 0.11 0 / 0.106)`). **No tooltip.** Cursor pointer.
- The same 20x20 round button closes the "New database" panel and the "Link to existing data source" page.
- Sub-pages put a **Back** button at the left: 24x22, radius 6px, no fill at rest.

### 1c. Date picker "today" circle, light (`10-picker-today-light.txt`)

- Today (Oct 20) is a 28x28 `BUTTON` (radius 6px, `aria-label="20th October (Tuesday)"`), digit 14px/16.8px weight 400 **rgb(255, 255, 255)**.
- The circle is the button's **`::after`: 24x24, `border-radius: 100%`, bg rgb(229, 100, 88)**, `position: absolute`, top 14px / left 14px (centred), `z-index: -1`. Same as dark (research 21).
- Selected day (Oct 12): 28x28, **bg rgb(39, 131, 222), radius 6px**, digit white. No circle.
- Same after Include time turned on.

### 1d. Date picker "Today" / "Now" button box, light (`11-…`, `12-…`)

| | Box | Text | Hover |
|---|---|---|---|
| **Today** (Include time off) | `role=button`, **51x20, radius 3px, padding 0 8px**, no border, no fill | 12px / 14.4px weight 500, rgb(142, 139, 134) | bg ≈ rgba(33, 27, 23, 0.051) |
| **Now** (Include time on) | **43x20**, same radius, padding, ink | same | (same class) |

- It sits in the month header row (224x25), in a group with **Go to previous month** and **Go to next month** (each 20x20, radius 3px), gap 8px.

### 1e. Center peek page title, light (`18-center-peek-light.png`)

- View settings › Layout › **Open pages in** › Center peek. URL gets `?p=…&pm=c`.
- Title `H1`: **40px / 48px, weight 700, rgb(44, 44, 43)**, padding 0 8px, 708 wide. Same size as dark.
- Panel: **960x573** at (276, 72), white, radius 12px, shadow `rgba(25,25,25,0.027) 0 8px 12px, rgba(25,25,25,0.027) 0 2px 6px, rgba(42,28,0,0.07) 0 0 0 1px`. Backdrop **rgba(15, 15, 15, 0.6)** (dark: 0.8).
- "Open pages in" menu: 250 wide. Options with a description line: **Side peek** "Open pages on the side. Keeps the view behind interactive." + "Default for Table", **Center peek** "Open pages in a focused, centered modal.", **Full page** "Open pages in full page."

### 1f. Date-format submenu width: 180 **and** 250, by entry point

| Entry | Submenu | Width |
|---|---|---|
| Date picker › Date format | Full date … Relative | **180** (x 1062, picker ends at 1066) |
| Date picker › Time format | Hidden / 12 hour / 24 hour | **180** |
| Date picker › Remind | None … 2 days before (9:00 AM) | **250** |
| Property header menu › Edit property › **Date format** | same six options | **250** |
| Property header menu › Edit property (the submenu itself: Date format / Time format / Notifications) | | 300 |

- So Blok's 250 (`database.css:5180`) matches the **property menu** path and the picker's **Remind** submenu. The picker's own Date format / Time format menus are 180.
- Escape in a picker submenu closes only that submenu; a second Escape closes the picker.

## 2. The "New database" / "New data source" side panel (`00-…`, `01-…`, `02-…`, `20-…`, `21-…`, `22-…`)

Two entries open the same right-hand panel (290 wide, x 1210, white, radius 10px, menu shadow). Both put the new view on screen at once with a schema of only **Name** + "Add property".

| | `/table view` on a page (a new database) | Add view (+, tooltip **"Add a new view"**) › last row **"New data source"** (icon `squareOnSquarePlus`; no tooltip, no badge, no upgrade glyph; not gated) |
|---|---|---|
| Panel | 290x465 | 290x433 |
| Title | **"New database"** | **"New data source"** |
| Top field | **AI prompt box** (below) | **search input "Search…"**, focused on open |
| Rows | same list | same list |

Title in both: 14px / 21px weight 600 rgb(44, 44, 43). Close: the 20x20 round × of §1b.

**AI prompt box ("New database" only):** 268x56, **border 1px solid rgb(240, 239, 237), radius 12px, bg white**. Left: an 18x18 image `alt="Notion AI face"`. Middle: a `contenteditable` `role=textbox`, `aria-multiline="true"`, 14px/20px, padding-right 30px, **placeholder "Describe what you want to build"** (drawn as `::after`, ink rgba(21, 14, 0, 0.286)), **focused on open**. Right: **"Submit AI message"** button 20x20, radius 30px, bg rgba(42, 28, 0, 0.07), icon `arrowStraightUpFillSmall` fill rgb(173, 169, 163), **`aria-disabled="true"`** while empty, cursor default. Nothing typed (AI not used).

**Search input ("New data source" only):** wrapper 266x28, radius 6px, bg rgba(66, 35, 3, 0.03), padding 3px 6px, focus ring `rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px`; input 14px/20px.
- Typing filters the list to **two rows: `New “<query>” data source`** (curly quotes U+201C/U+201D, replacing "New empty data source") and **Import CSV**. "csv" → `New “csv” data source` + Import CSV; "csvzzqx" → `New “csvzzqx” data source` + Import CSV (no "No results"). Deleting the text brings the full list back.

**Rows, top to bottom** (items 282 wide, radius 6px, label 14px/16.8px rgb(44, 44, 43), hover bg ≈ rgba(33, 27, 23, 0.051), no tooltips, no badges):

| Row | Height | Icon |
|---|---|---|
| **New empty data source** | 44 | `plusSmall` 16x16 fill rgb(142, 139, 134) in a **32x32 tile, radius 6px** (tile bg rgba(42, 28, 0, 0.07) seen on the highlighted row) |
| **Import CSV** | 45 | `arrowLineDown` 20x20, fill rgb(44, 44, 43), in a 32x32 tile |
| section label **"Suggested"** | — | 12px/14.4px weight 500 rgb(125, 122, 117); a 16x16 "Loading..." spinner at its right end while templates load |
| **Tasks Tracker** | 45 | 32x32 tile bg **rgb(232, 241, 236)**, 17x17 glyph rgb(68, 131, 97) |
| **Projects** | 45 | tile **rgb(229, 242, 252)**, glyph rgb(51, 126, 169) |
| **Skills** | 45 | tile **rgb(240, 239, 237)**, glyph rgb(85, 83, 78) |
| **More templates** | 32 | `ellipsis` 20x20 fill rgb(142, 139, 134); **label ink rgb(125, 122, 117)** (secondary) |
| 1px divider | — | 266x1, bg rgba(42, 28, 0, 0.07) |
| **Link to existing data source** | 32 | `arrowDiagonalUpRightFill` 16x16 fill rgb(125, 122, 117) |

The first row is highlighted on open (`New empty data source`, keyboard focus look).

**What each click does** (nothing imported, no template used, AI not used):

- **New empty data source**: the panel closes; the view stays with Name only. **Closing with × does the same**: the new tab and its empty source stay (`21-after-close-panel.png`). The title line above the tabs shows the placeholder **"New data source"** (a new database showed "New database").
- **Import CSV**: a centred modal 1000x637 (radius 12px, **bg rgb(249, 248, 247)**, shadow `rgba(25,25,25,0.24) 0 24px 48px, rgba(25,25,25,0.14) 0 4px 12px, rgba(42,28,0,0.07) 0 0 0 1px`, backdrop rgba(15, 15, 15, 0.6)). Left column: title **"Import CSV into Notion"** 26px/36px weight 600; text **"Create a new database with your CSV or merge it into an existing one"** 14px/20px rgb(125, 122, 117); label **"Upload CSV"** 12px/20px weight 500; button **"Choose file"** (`paperClip`, 322x32, bg rgba(42, 28, 0, 0.07), radius 6px, 14px weight 500); primary **"Map CSV headers"** (322x36, bg rgb(39, 131, 222), **disabled: `aria-disabled`, opacity 0.4** until a file is picked); **"Learn about imports"** (`questionMarkCircleSmall`, rgb(142, 139, 134)). Right column: a grey skeleton preview titled **"New table"** (22px/26px weight 600 rgb(125, 122, 117), bars rgb(166, 166, 166) radius 5px). Close: an 18x18 round `xMarkFill` button at the top left, **focused on open**. Escape closed the modal and left the panel open. No file chosen.
- **More templates**: a centred 1000x637 modal with a focused **"Search"** field (296x36, radius 10px, bg rgba(249, 249, 248, 0.8)), then **"Empty database"** card (576x81, border 1px solid rgb(230, 229, 227), radius 12px, padding 16px 18px), section **"Existing data sources"** (the user's own databases as 280x174 preview cards, bg rgba(66, 35, 3, 0.03), border 1px rgb(230, 229, 227), radius 12px, title 14px/20px weight 500 + page name 12px), section **"Templates"** (Tasks Tracker, Projects, Skills, Document Hub, Brainstorm Session, Meeting Notes, each with a one-line description and a coloured preview), and a **"More templates"** link at the end. Closed with Escape; nothing clicked inside.
- **Link to existing data source**: a page in the same panel, title "Link to existing data source" (14px/21px/600) with a Back button (24x22). Search **"Link…"** (focused, 266x28, same input look). From a new database: section **"Existing data sources"** only (4 rows, the user's databases, names not recorded). From "New data source": section **"Suggested"** (both sources of *this* database, each "New data source" with breadcrumb "Blok measure scratch 14 2026-10-20 / New data source and New data source") then **"Existing data sources"** (the user's other databases; 3 rows seen, names not recorded). Row shape: `collection` icon 20x20 + title 14px/16.8px + breadcrumb 12px/16.8px **rgb(161, 158, 153)** with a "/" separator (padding 0 4px); rows with a breadcrumb are 45 tall, a top-level one 28. Nothing picked.
- **Back from "Link to existing data source"** (entered from "New data source") returned to a panel titled **"New database" with the AI prompt box**, not to "New data source" with the search field. One sample.
- The database title became **"New data source and New data source"** once the second source existed (both sources untitled), as research 23 saw.

**Source picker** (View settings › Source on the second source's view, `22-source-picker.png`): panel 290x331, title **"Source"** (14px/21px/600) with Back, search **"Link to a data source…"**, section **"Suggested"** (the *other* source of this database, 1 row), section **"Existing data sources"** (the user's other databases, 3 rows). The current source is not listed. Labels 12px weight 500 rgb(125, 122, 117), each with a "Loading..." spinner while it fills.
- With **two** sources, the Source row is enabled (`aria-disabled` absent, opacity 1, value "New data source"). With one it is greyed (§1a).

**Blok should:** if it builds this panel, use one component with a top slot (AI box for a new database, search for an added source), the fixed row list above, and a "Link to existing" sub-page with Suggested (same block's other sources) and Existing (other databases) sections. Closing the panel must keep the empty source, as Notion does. The AI box, Import CSV and templates need host levers; without them, keep "New empty data source" and "Link to existing" only.

## 3. Elements Blok lacks, light

### 3a. Bordered sort-panel buttons (`16-sort-panel-light.png`)

Sort button (tooltip "Sort") › Due. Panel 321x107, radius 10px, menu shadow.

| Element | Box | Rest | Hover |
|---|---|---|---|
| Property button "Due" (calendar icon + label + chevron) | **85x32, radius 6px, padding 0 8px, gap 8px** | **bg rgb(255, 255, 255), border 1px solid rgba(28, 19, 1, 0.11)**; label 14px weight 500 rgb(44, 44, 43); icon 16x16 fill rgb(142, 139, 134) | bg **rgb(244, 243, 243)**, border unchanged |
| Direction button "Sort old → new" | **134x32**, same box | same; chevron 9x14 fill rgb(173, 169, 163) | (same class) |
| "Remove sort rule" × | **24x24, radius 6px**, no border | icon 16x16 fill rgb(142, 139, 134) | bg ≈ rgba(33, 27, 23, 0.051) |
| "Add sort", "Delete sort" rows | 313x28, radius 6px | 14px rgb(125, 122, 117) | |

No tooltips on any of them. The ⋮⋮ drag handle sits left of the property button.

### 3b. Selection bar dividers (`17-selection-bar-light.png`)

Two rows checked. Bar above the table at (531, 220):

- Bar **218x32, radius 5px, bg white**, shadow `rgba(25,25,25,0.027) 0 8px 12px, rgba(25,25,25,0.027) 0 2px 6px, rgba(42,28,0,0.07) 0 0 0 1px`.
- Segments left to right: **"2 selected"** (88x32, 14px/21px weight 400 **rgb(39, 131, 222)**, padding 0 10px, radius 5px 0 0 5px) · **Due** (34x32, property-icon button, padding 0 8px) · **Stage** (34x32) · **Move to Trash** (28x32, `trash` 20x20) · **…** (30x32, `ellipsisSmall`, radius 0 5px 5px 0).
- **Divider = `box-shadow: rgba(42, 28, 0, 0.07) 1px 0 0 0`** on every segment but the last. No border, no separate element. Segments are spaced 1px apart so the shadow shows.

### 3c. Bordered icon button in the property header menu (`08-prop-header-menu.png`)

Click on the "Due" header. Menu 220x498 at (813, 207).

- Top row: **icon button `aria-label="Change icon"`: 28x28, radius 6px, border 1px solid rgba(28, 19, 1, 0.11), no fill**, padding 0. Glyph is a 17x17 mask filled rgb(85, 83, 78). **Hover bg rgb(249, 248, 247)**. No tooltip.
- Name input beside it: wrapper 168x28, radius 6px, bg rgba(66, 35, 3, 0.03), ring `rgba(28, 19, 1, 0.11) 0 0 0 1px`, padding 3px 6px; input 14px/20px. At its right end an **(i) button `aria-label="Add property description"`** (15x20, glyph fill rgb(142, 139, 134)).
- Menu items, in order: Edit property ›, Property access, Change type ›, AI Autofill ›, Filter, Sort ›, Group, Calculate ›, Freeze, Hide, Unwrap content, Insert left, Insert right, Duplicate property, Delete property. Edit property opens at once (300 wide).

### 3d. "Manage in Calendar" (`15-manage-in-calendar-hover.png`)

- Last row of the View settings root (below Manage data sources, Lock database). `role=menuitem` 274x28, radius 6px. Icon `calendarDate20` 20x20 fill rgb(56, 56, 54); label 14px rgb(44, 44, 43); **trailing `arrowDiagonalUpRightSmall` 16x16, fill rgb(173, 169, 163)** (the "leaves this app" arrow). No `href`.
- Hover bg ≈ rgba(33, 27, 23, 0.051). **No tooltip, no badge.**
- **Not clicked**: it leaves for Notion Calendar. What it opens: UNMEASURED.

## 4. Dark-mode values (`40-…`–`48-…`)

Theme set Settings › Preferences › Theme from **"Use system setting"** to **Dark** for this pass, then back (section 7).

### 4a. The light/dark pairs measured this round

| Element | Light | Dark |
|---|---|---|
| View settings root title | 12px/16px/500 rgb(125, 122, 117) | 12px/16px/500 **rgb(173, 169, 163)** |
| View settings × (rest / hover) | rgba(42, 28, 0, 0.07) / rgba(42, 28, 0, 0.106) | **rgba(255, 255, 235, 0.1) / rgba(255, 255, 235, 0.153)**; glyph fill rgb(173, 169, 163) |
| View settings × after a keyboard action | — | it took focus on open and showed the ring `rgb(25,25,25) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgb(25,25,25) 0 0 0 6px` with the hover fill. In light, opened by a click, it had no ring. |
| Menu surface (panels, sort panel) | white, shadow `rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px` | **rgb(37, 37, 37)**, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px` |
| Sort panel property / direction buttons (rest / hover) | white, border rgba(28, 19, 1, 0.11) / rgb(244, 243, 243) | **rgb(25, 25, 25), border 1px solid rgba(255, 255, 235, 0.1) / rgb(38, 38, 38)**; label rgb(240, 239, 237); icon rgb(173, 169, 163); chevron rgb(125, 122, 117) |
| "Add sort" / "Delete sort" ink | rgb(125, 122, 117) | rgb(173, 169, 163) |
| Selection bar | white, 3-layer shadow (§3b) | **rgb(37, 37, 37)**, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px` |
| Selection bar divider | `rgba(42, 28, 0, 0.07) 1px 0 0 0` | **`rgba(255, 255, 243, 0.082) 1px 0 0 0`** |
| Selection bar "N selected" | rgb(39, 131, 222) | rgb(39, 131, 222) (same) |
| Property-menu "Change icon" button (rest / hover) | border rgba(28, 19, 1, 0.11), glyph rgb(85, 83, 78) / rgb(249, 248, 247) | **border 1px solid rgba(255, 255, 235, 0.1), glyph rgb(211, 211, 211) / rgb(32, 32, 32)** |
| Property-menu name input | bg rgba(66, 35, 3, 0.03), ring rgba(28, 19, 1, 0.11) | bg rgba(252, 252, 252, 0.03) (focused: blue ring) |
| "New data source" panel search | bg rgba(66, 35, 3, 0.03) | bg rgba(252, 252, 252, 0.03) |
| Panel template tiles (Tasks Tracker / Projects / Skills) | rgb(232, 241, 236) / rgb(229, 242, 252) / rgb(240, 239, 237) | **rgb(38, 61, 48) / rgb(35, 56, 80) / rgb(56, 56, 54)**; highlighted row's tile rgba(255, 255, 243, 0.082) |
| Panel "Suggested" label, "More templates" ink | rgb(125, 122, 117) | rgb(173, 169, 163) |
| Panel divider | rgba(42, 28, 0, 0.07) | rgba(255, 255, 243, 0.082) |
| "New database" AI box | white, border rgb(240, 239, 237); placeholder rgba(21, 14, 0, 0.286); submit bg rgba(42, 28, 0, 0.07), arrow rgb(173, 169, 163) | **rgb(25, 25, 25), border 1px solid rgb(44, 44, 43)**; placeholder rgba(255, 252, 235, 0.306); submit bg rgba(255, 255, 243, 0.082), arrow rgb(125, 122, 117) |
| "Link to existing" breadcrumb | rgb(161, 158, 153) | rgb(125, 122, 117) |
| Timeline "Manage in Calendar" button border | rgba(28, 19, 1, 0.11) | rgba(255, 255, 235, 0.1) |

### 4b. Tooltip: the same in both themes (`30-…`, `41-…`)

Two samples per theme ("Sort", "Settings" toolbar buttons): `role=dialog`, **bg rgb(44, 44, 43), text rgb(240, 239, 237) 12px/16.8px weight 400, radius 6px, padding 5px 8px**, shadow `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset`. **Identical in light and dark.** Blok can keep one tooltip look for both themes.

### 4c. Gallery text inks (`29-…`, `40-…`; all properties shown)

| | Light | Dark |
|---|---|---|
| Card title | 15px/22.5px/500 rgb(44, 44, 43) | 15px/22.5px/500 rgb(240, 239, 237) |
| Property text (date, url) | 12px/18px/400 rgb(44, 44, 43) | 12px/18px/400 rgb(240, 239, 237) |
| Date with a reminder | rgb(39, 131, 222) + `alarmSmall` 14x14 rgb(39, 131, 222) | same blue |
| Select pill (Blue) | bg rgba(0, 118, 217, 0.204), text rgb(38, 74, 114) | bg rgba(81, 166, 255, 0.494), text rgb(229, 242, 252) |
| Select pill (Brown) | bg rgba(127, 51, 0, 0.157), text rgb(88, 68, 55) | bg rgba(255, 184, 132, 0.365), text rgb(245, 237, 233) |
| Card | white, radius 10px, shadow `rgba(25,25,25,0.027) 0 4px 12px, rgba(25,25,25,0.02) 0 1px 2px, rgba(42,28,0,0.07) 0 0 0 1px` | bg rgba(255, 255, 255, 0.055), shadow `rgba(25,25,25,0.08) 0 2px 4px, rgba(255,255,243,0.082) 0 0 0 1px` |
| Cover area | rgba(66, 35, 3, 0.03), bottom border rgba(42, 28, 0, 0.07) | rgba(252, 252, 252, 0.03), bottom border transparent |
| "New page" card | ring rgba(42, 28, 0, 0.07), + icon rgb(173, 169, 163) | ring rgba(255, 255, 235, 0.1), + icon rgb(125, 122, 117) |

Property text is primary ink in both themes, not secondary.

### 4d. Timeline grid line and arrow chip (`25-…`, `28-…`, `42-…`)

| | Light | Dark |
|---|---|---|
| Body | rgb(253, 253, 253), bottom border 1px rgb(230, 229, 227) | rgb(25, 25, 25), bottom border 1px rgb(56, 56, 54) |
| Weekend columns (80 wide at Month zoom) | rgb(247, 247, 247) | rgba(255, 255, 255, 0.03) |
| Per-day vertical lines | **none found** (only the weekend fills mark columns) | none found |
| Header bottom line | `box-shadow: rgb(230, 229, 227) 0 -1px 0 0 inset` | `rgb(56, 56, 54) 0 -1px 0 0 inset` |
| Day numbers | 12px/28px rgb(161, 158, 153) | rgb(125, 122, 117) |
| Today line | 1px rgb(229, 100, 88); chip 22x22 rgb(229, 100, 88), digit 12px/500 white | same |
| Card | white, radius 6px, shadow `rgba(0,0,0,0.04) 0 2px 4px, rgba(42,28,0,0.07) 0 0 0 1px` | rgb(37, 37, 37), shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px` |
| **Arrow chip** (item off-screen to the left; shown after "next" moved past Alpha and Bravo) | **16x16, radius 4px, bg rgb(142, 139, 134), border 1px solid rgb(255, 255, 255)**; icon `arrowStraightLeftFillSmall` 14x12 fill white; at the row's left edge (x 539); cursor pointer; **hover bg rgb(56, 56, 54)**; no tooltip | **bg rgb(173, 169, 163), border 1px solid rgb(25, 25, 25)**; icon fill rgb(25, 25, 25); **hover bg rgb(230, 229, 227)** |

- While the item is on screen the chip exists at 5x5 with opacity 0. A right-pointing twin (`arrowStraightRightFillSmall`) sits at the right edge (x 1221) the same way.
- **Timeline toolbar "Manage in Calendar"**: a bordered button, **167x24, radius 6px, border 1px solid rgba(28, 19, 1, 0.11), no fill, padding 0 6px, gap 6px**, icon `calendarDate20` 16x16 fill rgb(44, 44, 43), label 14px weight 500. Hover bg ≈ rgba(33, 27, 23, 0.051). No tooltip. Not clicked.

### 4e. Board hues in dark: Brown and Blue (`43-…`)

| | Blue column | Brown column | No Stage |
|---|---|---|---|
| Column (header + body) | rgba(41, 139, 253, 0.063) | **rgba(253, 158, 101, 0.05)** | rgba(252, 252, 252, 0.03) |
| Header pill | bg rgba(81, 166, 255, 0.494), text rgb(229, 242, 252) 14px/20px/500 | bg rgba(255, 184, 132, 0.365), text rgb(245, 237, 233) | (no pill) rgb(240, 239, 237) |
| Count | rgb(39, 131, 222) | **rgb(182, 137, 101)** | rgb(188, 186, 182) |
| Card | rgb(33, 48, 65), ring rgba(71, 157, 255, 0.173) | **rgb(56, 45, 38), ring rgba(255, 174, 122, 0.133)** | — |
| **Card hover** | **≈ rgb(37, 54, 73)** (`color(srgb 0.146 0.213 0.288)`) | **≈ rgb(64, 51, 43)** (`color(srgb 0.249 0.200 0.169)`) | — |
| "+ New page" | text and icon rgb(39, 131, 222), ring rgba(71, 157, 255, 0.173) | text and icon rgb(182, 137, 101), ring rgba(255, 174, 122, 0.133) | ring rgba(255, 255, 243, 0.082), icon rgb(188, 186, 182) |

Card shadow in both coloured columns: `rgba(25,25,25,0.08) 0 2px 4px` plus the ring.

### 4f. Reminder blue and link underline in dark

- **Reminder:** a date with a reminder draws text and `alarmSmall` (17x17 in the table, 14x14 on cards) in **rgb(39, 131, 222)** in **both** themes.
- **Link underline** (URL cell, table and gallery): not `text-decoration`. It is `background-image: linear-gradient(to right, C, C)`, `background-size: 100% 1px`, `background-position: 0 100%`, `repeat-x`, text in primary ink. **C = rgba(28, 19, 1, 0.11) light, rgba(255, 255, 235, 0.1) dark.** A url typed with no scheme got `href="http://example.com/"`.

## 5. Other ledger 25 UNMEASURED items a Free workspace could show

### 5a. Deleting the last view of a data source (`51-delete-last-view.png`)

View tab › click again › menu (Rename, Display as, Edit view, Source "New data source", Copy link to view, Add view to sidebar, Open as full page, Hide data source titles, Duplicate view, **Delete view**). Delete view on the **only** view of a second source opens a dialog (no undo toast first):

- 400x368, radius 12px (dark: bg rgb(32, 32, 32), shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.64) 0 24px 48px, rgba(25,25,25,0.56) 0 4px 12px`). Trash icon on top, a 24x24 round × (bg rgba(255, 255, 243, 0.082) dark).
- Title **"Delete the last view for this data source?"** 17px/22px weight 500.
- Two radio cards, 360 wide, radius 8px, padding 12px 6px 12px 14px, gap 10px:
  - **"Delete view only"** / "The data source and all of its pages will be kept in this database" (**selected by default**: ring `rgb(229, 100, 88) 0 0 0 1px inset`, red radio dot)
  - **"Delete view and data source"** / "The data source and all of its pages will be deleted" (ring rgb(56, 56, 54) dark)
  - Option title 14px/20px/500, description 12px/16px/500 rgb(173, 169, 163) dark.
- **"Delete view"** button 360x32, bg rgb(229, 100, 88), text rgb(253, 246, 246) 14px/500, radius 6px; **"Cancel"** 360x32, border 1px rgba(255, 255, 235, 0.1) dark.
- Picked the default (view only): the tab went away; the source stayed (the Source picker still listed it, and the database title still read "New data source, New data source, and New data source"). Screen-reader text **"Deleted view"** (a 1x1 status node). No visible toast was found.

So Blok's rule (keep the source and its rows, hidden; 34f20350) matches Notion's **default**. Notion also offers "Delete view and data source".

### 5b. What picking another source does to a view's sorts

First Table view had the sort "Due ↑" (View settings row "Sort | Due"). View settings › Source › a sibling source (empty):
- The Sort row went blank ("Sort"), the toolbar Sort icon lost its blue, no pill; headers became "Name" only.
- Switching the view **back** to the original source: rows came back in manual order, **the sort did not come back** (Sort row still blank).

So **Notion drops the view's sorts when its source changes.** Blok keeps them and lets unknown ids match nothing (34f20350). Filters: not tested (the view had none): UNMEASURED.

### 5c. How a Range grouping switches back to Unique (`53-range-page.png`)

Board grouped by a Number property (Amount 5 / 150): Group page reads "Number by | Unique", "Sort | Ascending", Hide empty groups.
- "Number by" › a 250-wide menu **Unique / Range**. Picking **Range** opens a **"Number by" sub-page**: "Group range" `0` – `1000`, "Group every" `100`, hint "0 to 100, 100 to 200, ...". No Unique/Range rows on that page.
- **Back** returns to the Group page, whose row now reads **"Number by | Range"**. Clicking that row opens the **same 250-wide Unique / Range menu**, with a `checkmarkSmall` on Range. Picking **Unique** closes the menu, stays on the Group page, and the groups become 5 and 150 at once.

So the way back is the Group page's "Number by" row, not the Range page. Blok keeps Unique/Range rows on the Range page (b615919e); Notion does not, but both reach Unique.

### 5d. Default time when Include time turns on (three samples now)

| Cell before | Clock | Time filled |
|---|---|---|
| empty (today shown), research 23 | 5:49 AM | 6:00 AM |
| empty (today shown), Charlie | 1:58 PM | **2:00 PM** |
| a set date, no time (Oct 12, Alpha) | ≈ 1:10 PM | **9:00 AM** |
| a set date, no time, with a "1 day before (9:00 AM)" reminder (Oct 25, Bravo) | 1:58 PM | **9:00 AM** |

So an empty cell takes **the next whole hour** (or the nearest: both samples fit both rules; UNMEASURED which), and a cell that **already has a date** takes **9:00 AM**.

### 5e. Short date for another year

Alpha set to **Oct 12, 2025** (picker header "Oct 2025", selected "12th October (Sunday)"), date format **Short date**: the cell reads **"Oct 12 9:00 AM"**, the picker field **"Oct 12"**. **No year**, even for another year (one sample, a past year). Blok keeps the year there (206f2d25).

### 5f. Light side peek hovers (`60-side-peek-light.png`)

Board card › side peek (`?pm=s`), panel bg white, shadow `rgba(25,25,25,0.027) 0 8px 12px, rgba(25,25,25,0.027) 0 2px 6px, rgba(42,28,0,0.07) 0 0 0 1px`. Title H1 32px/38.4px/700.
- Property label cell (160x34): hover bg **≈ rgba(33, 27, 23, 0.051)**; label 14px rgb(125, 122, 117).
- "Add a property" (132x34): same hover bg; ink rgb(161, 158, 153).
- Top-bar Close (24x24) and Actions (28x28): same hover bg.
- Value cell (434x34): **no hover fill seen** after 1s.

## 6. UNMEASURED (this round)

- **Manage in Calendar**: what it opens (not clicked; it leaves for Notion Calendar).
- **Dark favorite star**: needs favoriting a page, which the task forbids.
- **"Now" button hover** and dark Today/Now box: not read (same class as Today; light only).
- Default time rule: "next whole hour" vs "nearest hour" (samples fit both).
- Short date for a **future** year.
- Picking another source: what happens to **filters**.
- AI prompt box: what typing or submitting does (would spend AI credits); Import CSV after choosing a file (already in research 21); template rows (Tasks Tracker…) when clicked.
- Calendar: Escape after an inside-grid drag box (not repeated).
- Still open from ledgers 24/25, not attempted here: undo on a read-only block (Cmd/Ctrl combos are not forwarded through the extension); 99+ toggle scope; side peek at a narrow window (cannot resize the user's window); table undo scroll; backlinks 20+; map pins (100+, colours, link); form anonymous / "View my response" / "Email me a copy"; builder sidebar-leave; gallery Cmd-click tab; feed alarm; other users' reaction pills; sort-row drag motion; "Out of range" under a descending sort; ranges under a day; timeline snap at other zooms; whether the Content tab moves in the layout list; "Hide data source titles" scope.

## 7. Account state and safety

- **No billing surface opened.** Every new control was hovered first; none showed a "New" / "Plus" / "Business" / "Upgrade" badge or lock. In the workspace menu, "Upgrade" sits at (158, 237) and "Settings" at (158, 265); the point was checked to be "Settings" before each click.
- **Theme:** "Use system setting" → Dark → back to **"Use system setting"** (dropdown read back; body rgb(255, 255, 255)). High contrast not touched.
- Not used: AI (nothing typed in the prompt box), Import CSV (no file chosen), templates (none clicked), chart quota, Copy-to-Clipboard buttons, favorites.
- The scratch page **"Blok measure scratch 14 2026-10-20"** was moved to Trash (page Actions › Move to Trash; toast "Moved to Trash"; the URL shows the Trash banner). Trashing navigated the tab to another recent page; nothing was clicked there.
- `.playwright-cli/` auto-snapshots (which hold sidebar page names) were deleted. The session `notion-measure14` was closed; no other session was touched.
