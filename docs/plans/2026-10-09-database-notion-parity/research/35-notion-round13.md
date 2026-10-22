# Research 35: round 13 measurements

Measured 2026-10-22 (local, from 04:36 CEST) in the user's signed-in Chrome via `playwright-cli -s=notion35 open --extension`, on app.notion.com.
Workspace on the Free plan. Viewport 1512x717 CSS px, DPR 2. Theme: light unless a section says dark.
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure35/` (not in the repo). Helpers copied from `notion-measure33/` (research 33), session renamed. Raw JSON: `notion-measure35/colours/`.
Every value is DOM text, `getComputedStyle` / `getBoundingClientRect`, or a screenshot. Anything not observed is **UNMEASURED**. Names of the user's own pages are not written here.

Input: the colour gaps of research 33 §4 / §5, then list B of `32-parity-status-2026-10-21-r12.md` in the order B5, B2, B9, B10, B12, B4, B7, B8, B11, B13, B14, B15, B16, B18, B19, B20, B22, B3, B17, B21, B1.

Colour notation: Chrome reports some computed colours as `color(srgb r g b / a)` with 0-1 channels. They are given as read, with the 0-255 value after "≈" where it helps.

## 0. Setup

- Stored theme at the start: `appearanceSettingStorageKey` = **"system"** (system light).
- Sidebar "New page" › "Page". Private scratch page. (A click on the cover area added a random page icon; harmless, the page is trashed at the end.)
- First body line: "/table view" › Enter → database **R13** (this insert opened **no** "New database" panel; see B5).
- Properties added: **Date** (Date; the "Add property" type menu named it "Date"), **Tag** (Select), **St** (Status).
- Rows: **E1** (Date Oct 22 → Oct 24, 2026; Tag **Def**), **E2** (Oct 15; Tag **Gry**), **E3** (Oct 28; Tag **Blu**). Option colours set in the cell editor's option "…" › Colors: Def = **Default**, Gry = **Gray**, Blu kept its random colour (**Yellow**, pill rgba(209, 156, 0, 0.282)).
- Views added from the tab bar "+" (`aria-label="Add view"`): **Board** (Group by Tag, "Color columns" on by default, "Hide empty groups" on by default), **Calendar** (by Date, Month), **Timeline** (by Date). Today is Thu Oct 22, 2026.
- A template **TplA** (chevron "More add options" › "New template").
- Later (§1.7): "New data source" › "New empty data source" (a second source, one view "Table"), and View settings › Data source settings › Turn into › **Turn into Tasks database** (setup dialog: assignee "Create new", status **St**, due date **Date**). After this the board / table add rows read **"New task"** instead of "New page".
- Dark: **Cmd+Shift+L** (stores "dark"); read back body bg rgb(25, 25, 25).

## 1. Colour gaps (priority 1)

Method: `board.js`, `cal.js`, `toast.js`, `dlg2.js` read `getComputedStyle` of the target and its parts; `hovdiff.sh x y` reads the element chain under the point at rest, after **1.5 s** hover, and while the mouse is held 0.4 s (then moved off before release, so nothing is clicked). Cards and bars were read with hover only (no press), so a press could not start a drag. A hover value read once at 0.7 s on a board card was a mid-transition colour; every value below was read after 1.5 s and was stable across two reads.

### 1.1 Board columns: Default and Gray (Color columns on)

| Part | Default (Def) light | Default dark | Gray (Gry) light | Gray dark |
|---|---|---|---|---|
| Column bg (`.notion-board-group`, radius 0 0 10px 10px; header strip above it 10px 10px 0 0, same bg) | rgba(66, 35, 3, 0.03) | rgba(252, 252, 252, 0.03) | rgba(66, 35, 3, 0.03) | rgba(252, 252, 252, 0.03) |
| Header pill bg / text (20 tall, radius 4px) | rgba(42, 28, 0, 0.07) / rgb(44, 44, 43) | rgba(255, 255, 243, 0.082) / rgb(240, 239, 237) | rgba(28, 19, 1, 0.11) / rgb(73, 72, 70) | rgba(255, 252, 235, 0.306) / rgb(240, 239, 237) |
| Count ink ("1", 20x20 box) | **rgb(95, 94, 89)** | **rgb(188, 186, 182)** | **rgb(142, 139, 134)** | **rgb(142, 139, 134)** |
| "+ New page" / "+ New task" row ink and its `plusSmall` fill | rgb(95, 94, 89) | rgb(188, 186, 182) | rgb(142, 139, 134) | rgb(142, 139, 134) |
| That row's ring (260x40, radius 10px) | `rgba(42, 28, 0, 0.07) 0 0 0 1px` | `rgba(255, 255, 243, 0.082) 0 0 0 1px` | `rgba(42, 28, 0, 0.07) 0 0 0 1px` | `rgba(255, 255, 243, 0.082) 0 0 0 1px` |
| Card bg (260x40, radius 10px) | rgb(255, 255, 255) | **rgb(32, 32, 32)** | rgb(255, 255, 255) | **rgb(44, 44, 43)** |
| Card shadow | `rgba(25,25,25,0.027) 0 4px 12px 0, rgba(25,25,25,0.02) 0 1px 2px 0, rgba(42,28,0,0.07) 0 0 0 1px` | `rgba(25,25,25,0.08) 0 2px 4px 0, rgba(255,255,243,0.082) 0 0 0 1px` | same as Default light | same as Default dark |
| Card title ink | rgb(44, 44, 43) | rgb(240, 239, 237) | rgb(44, 44, 43) | rgb(240, 239, 237) |

So Default and Gray share the uncoloured column bg and ring; they differ in the count / "New" ink (95,94,89 vs 142,139,134 light) and, in dark, in the card fill (32 vs 44,44,43). The control column (Yellow, Blu) matched research 33 §4.4 (bg rgba(207, 175, 0, 0.063), count rgb(216, 163, 47), ring rgba(211, 168, 0, 0.137); dark bg rgba(255, 232, 48, 0.043), card rgb(55, 51, 37), ring rgba(255, 225, 117, 0.13)).

### 1.2 Board card hover

The card's own fill changes; the shadow does not. Light cards go from opaque white to a **translucent** fill, so the column tint shows through.

| Column | Light rest → hover | Dark rest → hover |
|---|---|---|
| Default | rgb(255, 255, 255) → `color(srgb 0.210997 0.111893 0.00959079 / 0.0313726)` ≈ rgba(54, 29, 2, 0.031) | rgb(32, 32, 32) → `color(srgb 0.15049 0.15049 0.15049)` ≈ rgb(38, 38, 38) |
| Gray | rgb(255, 255, 255) → same as Default ≈ rgba(54, 29, 2, 0.031) | rgb(44, 44, 43) → `color(srgb 0.197836 0.197836 0.19334)` ≈ rgb(50, 50, 49) |
| Yellow (control) | rgb(255, 255, 255) → `color(srgb 0.761765 0.644004 0 / 0.0627451)` ≈ rgba(194, 164, 0, 0.063) | rgb(55, 51, 37) → `color(srgb 0.245578 0.227717 0.165207)` ≈ rgb(63, 58, 42) |

Element: `DIV[role=presentation]` 260x40 (the card box; the `A[role=link]` inside stays transparent). Gallery card hover is in research 33 §4.2 and was not re-read.

### 1.3 Toolbar buttons: Filter, Sort, New, the New chevron

| Button | State | Light | Dark |
|---|---|---|---|
| Filter / Sort (28x28 `role=button`, radius 6px; icon fill light rgb(142, 139, 134), dark rgb(173, 169, 163); unchanged on hover) | rest | transparent | transparent |
| | hover | `color(srgb 0.129412 0.105882 0.0901961 / 0.0509804)` ≈ rgba(33, 27, 23, 0.051) | `color(srgb 1 1 1 / 0.054902)` ≈ rgba(255, 255, 255, 0.055) |
| | pressed | same colour / **0.101961** | white / **0.109804** |
| "New" (45x28, radius 6px 0 0 6px; ink rgb(243, 249, 253)) | rest | rgb(39, 131, 222) | rgb(39, 131, 222) |
| | hover | `color(srgb 0.122395 0.463619 0.801134)` ≈ rgb(31, 118, 204) (**darker**) | `color(srgb 0.239688 0.563525 0.883841)` ≈ rgb(61, 144, 225) (**lighter**) |
| | pressed | `color(srgb 0.109142 0.413418 0.714387)` ≈ rgb(28, 105, 182) | `color(srgb 0.326435 0.613324 0.897094)` ≈ rgb(83, 156, 229) |
| Chevron "More add options" (24x28, radius 0 6px 6px 0; split `rgba(28,19,1,0.11) 1px 0 0 0 inset` light, `rgba(255,255,235,0.1) …` dark) | rest / hover / pressed | same three fills as "New" | same three fills as "New" |

Each half was hovered on its own; whether hovering one half tints the other was not read.

### 1.4 Calendar events

Event = `A[role=link]` inside `.notion-collection-item`, radius 6px, 28 tall (1-day: 87 wide; E1, 3 days: 284 wide). Title 14px / **600**.

| State | Light | Dark |
|---|---|---|
| Rest bg | rgb(255, 255, 255) | **rgb(47, 47, 47)** |
| Rest shadow | `rgba(0, 0, 0, 0.04) 0 2px 4px 0, rgba(42, 28, 0, 0.07) 0 0 0 1px` | `rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 2px 4px 0` |
| Text | rgb(44, 44, 43) | rgb(240, 239, 237) |
| **Hover** bg (shadow unchanged) | **rgba(84, 72, 49, 0.08)** (replaces the white; the cell shows through) | **rgb(55, 55, 55)** |
| **Selected** (drag box from an empty part of the Thu 22 cell to over E1, then pointer moved away) | bg stays rgb(255, 255, 255); a `.notion-selectable-halo` overlay **rgba(35, 131, 226, 0.14)**, radius 6px, 282x26 (the event inset by 1px) | bg stays rgb(47, 47, 47); same halo rgba(35, 131, 226, 0.14), radius 6px, 282x26 |

The drag box itself during the drag: rgba(35, 131, 226, 0.14) in both themes. With the pointer still over the event after the drag, the event showed the hover bg under the halo. One Escape cleared the selection.

### 1.5 Timeline bars

Bar = `.notion-timeline-item` (`notion-selectable notion-page-block`), radius 6px, 34 tall (1 day 37 wide, 3 days 117 wide). The title label is a separate leaf: 14px / **500**, rgb(44, 44, 43) light, rgb(240, 239, 237) dark. The hover fill is on the bar's inner `A[role=link]` (same box), not on the bar.

| State | Light | Dark |
|---|---|---|
| Bar bg | rgb(255, 255, 255) | **rgb(37, 37, 37)** |
| Bar shadow | `rgba(0, 0, 0, 0.04) 0 2px 4px 0, rgba(42, 28, 0, 0.07) 0 0 0 1px` | `rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px` |
| **Hover** (inner link, over the bar bg) | `color(srgb 0.129412 0.105882 0.0901961 / 0.0509804)` ≈ rgba(33, 27, 23, 0.051) | `color(srgb 1 1 1 / 0.054902)` ≈ rgba(255, 255, 255, 0.055) |
| **Selected**: how | Drag box from an empty part of the bar's row / the row below it (mouse down at (1150, 440), 4 steps to (920, 395)) | same |
| Selected look | bar bg unchanged; halo **rgba(35, 131, 226, 0.14)**, radius 6px, **113x30** (the bar inset by 2px) | same halo, 113x30; bar bg rgb(37, 37, 37) |

In light, after the pointer left (to (1500, 700)), the last-hovered bar kept its hover fill on one read; the dark read cleared. Not investigated further.

### 1.6 Toast

Trigger: table row handle (⋮⋮) › **Move to Trash** (rows T2, T3, T4 made for it). Toast "**Moved to Trash**" + "**Restore**" button. (A body MutationObserver was on while a row was created and trashed: only the trash raised a toast. Research 33 saw none for database creation, "Remove" and row creation.) An `role=alert aria-live=assertive` 1x1 node off-screen carries the text for screen readers.

| Part | Light | Dark |
|---|---|---|
| Box | bg **rgb(44, 44, 43)**, ink **rgb(240, 239, 237)**, radius **8px**, padding **11px 16px**, 14px / 21px / 400 | bg rgb(44, 44, 43), ink rgb(240, 239, 237), same box |
| Shadow | `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px` | `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px` |
| Size / place | 198x43 at (657, 646): centred on the viewport (centre x 756), bottom 28px above the window edge | 191x41 at (661, 647) (read once, may have been mid-entry) |
| "Restore" | `role=button`, transparent, ink rgb(240, 239, 237), 14px / 500, padding 0 8px, radius 6px, 67x17 | same |
| "Restore" hover | `color(srgb 0.129412 0.105882 0.0901961 / 0.0509804)` ≈ rgba(33, 27, 23, 0.051) (the light hover tint, on the dark box), cursor pointer | `color(srgb 1 1 1 / 0.054902)` |

Lifetime: gone **11.7 s** after the click on "Move to Trash", with the pointer on "Restore" for the first 0.8 s (whether hover pauses the timer was not separated). Restore was never clicked.

### 1.7 Dark confirm dialogs

**"Undo Task Database?"** (View settings › Data source settings › "Undo Task database" after the Tasks conversion):

| Part | Dark | Light (research 33 §3.10) |
|---|---|---|
| Box | 324x193 at (594, 262), bg **rgb(32, 32, 32)**, radius 12px | bg white |
| Shadow | `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.64) 0 24px 48px 0, rgba(25,25,25,0.56) 0 4px 12px 0` | `rgba(25,25,25,0.24) 0 24px 48px 0, rgba(25,25,25,0.14) 0 4px 12px 0, rgba(42,28,0,0.07) 0 0 0 1px` |
| Backdrop | rgba(15, 15, 15, **0.8**) | 0.6 |
| Title | 16px / 500 rgb(240, 239, 237) | rgb(44, 44, 43) |
| Text | 12px / 400 **rgb(173, 169, 163)** | rgb(125, 122, 117) |
| "Remove" | ink rgb(229, 100, 88), border 1px **rgba(255, 104, 92, 0.24)**; hover bg `color(srgb 1 0.411765 0.376471 / 0.113725)` ≈ rgba(255, 105, 96, 0.114) | border rgba(206, 24, 0, 0.165) |
| "Cancel" | ink rgb(240, 239, 237), border 1px rgba(255, 255, 235, 0.1); hover bg ≈ rgba(255, 255, 255, 0.055) | border rgba(28, 19, 1, 0.11) |
| Focus on open | **"Remove"** (no ring drawn) | not read |

Closed with Cancel.

**"Delete the last view for this data source?"** (the second source's only view › tab menu › Delete view). Light and dark, same visit order:

| Part | Light | Dark |
|---|---|---|
| Box | `role=dialog` **400x368 at (556, 175)**: centred both ways (centre (756, 359) in a 1512x717 window); bg white; radius 12px | bg rgb(32, 32, 32) |
| Shadow | `rgba(25,25,25,0.24) 0 24px 48px 0, rgba(25,25,25,0.14) 0 4px 12px 0, rgba(42,28,0,0.07) 0 0 0 1px` | `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.64) 0 24px 48px 0, rgba(25,25,25,0.56) 0 4px 12px 0` |
| Backdrop | rgba(15, 15, 15, 0.6) | rgba(15, 15, 15, 0.8) |
| **× "Close"** (24x24 at (922, 185): **10px** from the box's top and right edges; radius 100%) | **bg rgba(42, 28, 0, 0.07)** (a filled circle at rest); glyph svg 16x16, fill rgb(142, 139, 134) | bg **rgba(255, 255, 243, 0.082)**; glyph fill rgb(173, 169, 163) |
| Focus on open | × "Close" (as research 30 §B3) | × "Close" |
| Trash icon | 32x32 at (740, 195), fill rgb(142, 139, 134) | rgb(173, 169, 163) |
| Title | 17px / 500, ink primary, 360 wide at y 237 | rgb(240, 239, 237) |
| Dividers (400x1, at y 273 and 430) | 1px rgba(42, 28, 0, 0.07) | 1px rgba(255, 255, 243, 0.082) |
| Picked card "Delete view only" (360x78, radius 8px) | ring `rgb(229, 100, 88) 0 0 0 1px inset`; radio 16x16 filled rgb(229, 100, 88) with a 6x6 dot rgb(240, 239, 237) | same ring and radio |
| Other card (360x70) | ring `rgb(230, 229, 227) 0 0 0 1px inset`; radio white, border 1px rgba(27, 21, 0, 0.19) | ring `rgb(56, 56, 54) …`; radio bg rgb(37, 37, 37), border 1px rgba(255, 252, 235, 0.306) |
| Card subtitle | 12px / 500 rgb(125, 122, 117) | rgb(173, 169, 163) |
| "Delete view" | 360x32, bg rgb(229, 100, 88), ink rgb(253, 246, 246), radius 6px | same |
| "Cancel" | 360x32, border 1px rgba(28, 19, 1, 0.11), radius 6px | border 1px rgba(255, 255, 235, 0.1); hover ≈ rgba(255, 255, 255, 0.055) |

After Cancel the tab's view menu was still open behind it (light read; matches research 30 §B3).

### 1.8 The template row "…" button and its submenu

"New" chevron › "Templates for R13" menu (360 wide at x 871). Row **TplA** 352x28 at x 875. Its "…" is a 24x24 `role=button` (no aria-label), radius 6px, at the row's right end (x 1199, 2px below the row top), glyph `ellipsisSmall` 16x16.

| State | Light | Dark |
|---|---|---|
| Glyph fill (all states) | rgb(142, 139, 134) | rgb(173, 169, 163) |
| Button at rest (row not hovered) | transparent; present and visible (opacity 1) | transparent |
| Row hovered, pointer not on "…" | button transparent | button transparent; **row** bg ≈ rgba(255, 255, 255, 0.055) |
| "…" hovered | button `color(srgb 0.129412 0.105882 0.0901961 / 0.0509804)` | `color(srgb 1 1 1 / 0.054902)` |
| "…" pressed | same colour / 0.101961 | white / 0.109804 |
| Submenu open, pointer on the submenu | button keeps the hover fill (0.051 / 0.055) and the row keeps the row hover fill | same |

**Submenu alignment** (both themes the same): the submenu (250x152, "Duplicate every… Off | Set as default | Edit | Duplicate | Delete") opens to the right with **its top edge at the "…" button's top** (light: button y 280, submenu y 280, row y 278; dark after a different scroll: 336 / 336 / 334). So the submenu top is **2px below the row's top**; the first submenu row starts 4px lower (y 284). Its left edge is 4px right of the templates menu's right edge (1231 → 1235).

Keyboard after it opened with the mouse: one **Escape** closed only the submenu and put focus on the "…" button (`role=button`), and the tooltip "**Edit this template**" (115x27, bg rgb(44, 44, 43), ink rgb(240, 239, 237)) appeared above it with the pointer elsewhere, so it came from focus. A second Escape removed the tooltip with the menu still open; a third closed the menu.

