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

### 1.9 A second toast kind: the bottom-left notice (dark)

After "Turn into task database" (§0), a notice sat at the **bottom left** of the page frame and was still there about 15 minutes later (it does not time out; closed with its ×):

| Part | Dark |
|---|---|
| Box | 280x78 at (282, 627) (10px right of the sidebar edge, 12px above the window bottom), bg **rgb(32, 32, 32)**, border **1px rgb(44, 44, 43)**, radius 8px, padding 8px 8px 4px, no shadow |
| Icon | 16x16 check-circle, fill **rgb(70, 161, 113)** (green) |
| Title | "Turned into task database" 12px / 16px / **600**, rgb(240, 239, 237) |
| Body | "You can now add it as a source for My Tasks" 12px / 16px / 400, rgb(240, 239, 237) |
| × | `role=button aria-label="Close"` 24x24, radius 6px; glyph 14x14 fill rgba(255, 255, 255, 0.81) |

Light: not read (it appeared while dark was on).

## 2. B5: "/" menu

### 2.1 What makes the Table view insert skip the "New database" panel

All inserts by typing "/table view" (or "/database inline") and Enter on the highlighted row. Pages are new child pages of the scratch page.

| Page state at the insert | Entry | Panel? |
|---|---|---|
| Scratch page: title only, caret on the first body line (§0) | Table view | **No panel** (database inserted at once) |
| S1: line 1 "hello", insert on line 2 (the page's first database) | Table view | **Panel** (290x465 at x 1210) |
| S2: line 1 empty, line 2 "below", insert on line 1 (first block, first database, but the page is not empty) | Table view | **Panel** |
| S3: title only, caret on the first body line | **Database - Inline** | **Panel** |

So the skip needs **a page with no other block** (first block alone does not do it, first database alone does not do it), and it applies to the **Table view** entry only: Database - Inline on the same kind of empty page opened the panel. Together with research 28 / 30 that is three "empty page + Table view" samples, all skipping.

### 2.2 Why Feed lists no properties

S3 › "/feed view" › panel › New empty data source. View settings: "Property visibility **0**"; its page reads "Property visibility | **No results**". "Edit properties" reads "Properties | **No results** | New property | Learn about properties": the title property "Name" is not listed in a Feed's lists at all.
Added a Text property "Note" (Edit properties › New property › name › Text). Property visibility then read "**1**", page "Shown in feed | Hide all | **Note**".
So Feed's lists leave out the title property; a fresh database has only the title, hence "No results".

### 2.3 The full-page database's View settings

S3 › "/database full" › **Database - Full page**. The browser moved to the new database page. The "New database" panel showed as a **docked right panel** (not a popover): the AI prompt box focused (not typed into), then New empty data source, Import CSV, Suggested (Tasks Tracker, Projects, Skills), More templates, Link to existing data source. Picking **New empty data source** turned the same docked panel into **View settings** (Layout Table, Property visibility 1, Filter, Sort, Group, Conditional color, Copy link to view; Data source settings: Source, Edit properties, Automations, AI Autofill, Turn into, More settings, Manage data sources, Lock database).

The docked panel: `position: absolute`, at x **1125**, from y 166 (right below the 40px sticky toolbar) to the window bottom, 483 wide to the window edge with the content column **290** wide; bg = the page bg (rgb(25, 25, 25) in dark); **border-left 1px rgb(56, 56, 54)** (dark); no shadow; not `role=dialog`. A "Close" × sits at its top right. The toolbar's Settings button **toggles** it (a second click closed it; a third reopened it). Theme: dark (light not read).

### 2.4 Cold hint delay

On S3, "/" with no query (25 rendered options). Pointer parked outside the menu (x 300) for 1.5 s, then moved onto an option; a 5 ms poll looked for the hint text ("Just start writing" for Text). `coldhint2.sh`:

| Path | Hint |
|---|---|
| From outside onto "Text", nudged 5px after 0 / 0.2 / 1 s, then 4 s wait (3 runs) | **none** |
| From outside onto "Board view" in "/board" filtered results (1 and 8 small moves, 3 s) | none |
| Rest on "Database - Full page" 1.5 s, then move to "Text" (`warmhint.sh`) | **15 ms** after `pointerover` |

A screenshot taken after moving from one option to "Text" and waiting 2.5 s showed the hint card (preview image and "Just start writing with plain text") to the right of the menu. A keyboard-highlighted row (the first row on open) showed no hint.
So, measured: **a hint never appeared for the first option entered from outside the menu** (6 tries this round, plus research 30's 3); it appears at ~15 ms when moving from one option to another. Whether some longer rest or another pointer path shows it cold: not found.

### 2.5 A read-only one-view database's tab

S3's first database (one Table view) › View settings › **Lock database** (the row then reads "Unlock database"). After closing View settings: **no tab** is drawn (tabs: none), the database title row shows the title as plain heading text ("New database", primary ink in the screenshot) with a **"🔒 Locked"** label before the toolbar icons; the "Add property" header cell is gone. So a locked one-view database still renders no view tab.
Side note: after Escape closed View settings, focus went back to the Settings button, which drew a blue focus ring and its "Settings" tooltip without a hover (same as the template "…" in §1.8).

## 3. B2: bulk editors and the single date cell

Database R13 (table view). Extra properties added for this: **Notes** (Text), **Num** (Number), **Link** (URL). Rows E1–E3 selected with their checkboxes. The selection bar ("3 selected", Date, Tag, St, Assignee, Move to Trash, "…") had no room for Notes / Num / Link (their buttons were 0 wide), so each editor was opened through the bar's **"…" › Edit property › <property>** (the submenu lists Name, Assignee, Date, Link, Notes, Num, St, Tag).

| Editor | Rows before | On open | While typing | Close | Cells after | Selection after |
|---|---|---|---|---|---|---|
| Text (Notes), **mixed values** | alpha / beta / empty | contenteditable prefilled with the **first row's value "alpha"**, caret at the end (offset 5); cells unchanged on open | first key "X": **all 3 cells "alphaX" at once** (beta lost) | **Enter** | all "alphaX"; editor closed | **cleared** (bar gone) |
| Text (Notes), press outside | alphaX ×3 | "alphaX" | "alphaXY" live | **click outside** at (1400, 600) on the page | all "alphaXY" (kept) | **cleared** |
| Select (Tag), **mixed** | Def / Gry / Blu | input empty, the first row's option **"Def" shown as the chip** in the editor | — | **click** on the option "Gry" | all 3 **Gry** (replaced); menu closed | **kept** (3 selected) |
| Number (Num) | empty ×3 | `INPUT`, empty | "42": all 3 cells **42 live** | **Escape** | all 42 (kept) | **kept** |
| URL (Link) | empty ×3 | `INPUT`, empty | "example.com": all 3 live | **Enter** | all "example.com" | **cleared** |
| Date, **first row empty** (E1 cleared; E2 Oct 15, E3 Oct 28) | — | picker, input "**Oct 22, 2026**" (today); End date switch off; cells unchanged on open | switch **End date on**: inputs "Oct 22, 2026" / "Oct 22, 2026", and **all 3 rows became "October 22, 2026 → October 22, 2026"** at once (E2's and E3's own dates replaced) | Escape | all three today → today | not read |

**Board live preview.** Board view, View settings › Property visibility › Notes and Num shown on cards. Cards selected with a drag box from the empty board area (each card got a halo rgba(35, 131, 226, 0.14), **radius 10px**, 256x97). No selection bar on a board; **Cmd+/** opened the action menu (Page, Edit icon, Edit property, Copy links to all, Duplicate, Move to, Move to Trash, Ask AI). Edit property › Notes: contenteditable prefilled "alphaXY"; typing "Z" changed **every card's Notes line to "alphaXYZ" live**. Escape kept it; afterwards one card (the top one) still showed a halo.
**List live preview** (read later, dark): List view with Notes switched on, rows E1–E3 selected with a drag box from the right margin (halos rgba(35, 131, 226, 0.14), radius 6px, 688x26), Cmd+/ › Edit property › Notes (prefilled "alphaXYZ"), typed "W": **every list row showed "alphaXYZW" live**; Escape kept it.

**Single date cell** (before the bulk tests, light):
- **Empty cell, open**: the picker's input reads **today, "Oct 22, 2026"**, focused; the cell stays empty. **Escape** without typing: the cell **stays empty**.
- **Escape with typed text**: Cmd+A in the input, typed "Oct 25, 2026", Escape (no Enter): the cell **saved "October 25, 2026"**, and the one Escape closed the picker.
- Enter on a typed date in the start input saved it and kept the picker open. A date typed into the **End** input followed by Enter did **not** change the end (twice); clicking a day in the grid with the End input focused did.

## 4. B9: header (i) and description hints (dark)

Tag property, table header menu (220 wide). The name input row has the (i) at its right end.

- **The (i)**: `role=button aria-label="Add property description"`, radius 20px, box **15.3x20** (= the svg box; `infoCircleFill`, viewBox "2.37 0 15.26 20"). Dark fill **rgb(173, 169, 163)** at rest; on hover the button gets ≈ rgba(255, 255, 255, 0.055) and the glyph ink turns **rgb(230, 229, 227)**. No tooltip on hover.
- **Click**: opens a **textarea** under the name ("Add a description…" placeholder), focused at once. Its wrapper (204x26, padding 3px 6px, radius 6px) has bg rgba(252, 252, 252, 0.03) and, while focused, a **blue ring** `rgb(35, 131, 226) 0 0 0 1px inset, rgb(35, 131, 226) 0 0 0 1px`. Textarea 13px / 20px, ink rgb(240, 239, 237), transparent.
- **Description hint, dark** (table header with a description, pointer on the right part, after 2 s): box bg rgb(44, 44, 43), radius 6px, padding 5px 8px, shadow `rgba(0,0,0,0.08) 0 4px 12px -2px, rgba(255,255,255,0.05) 0 0 0 1px inset`; line 1 the name 12px rgb(240, 239, 237); line 2 the description 12px **rgb(173, 169, 163)**, the typed newline kept. With a long description the box was **296x128** (so about 280px of text width), placed above the header.

Description hints in other places (Tag has a description; Date, Notes have none). Pointer away 1.5 s, then onto the target, 2.5 s:

| Where | Target | Hint |
|---|---|---|
| Row page (side peek) property label | "Tag" | name + description, 296x128, **left of the label**, vertically centred on it |
| Row page property label, no description | "Date" | **"Date" alone** (42x27), left of the label |
| Board card property value | Tag pill "Gry" | name + description, left of the card |
| Board card property value, no description | Notes line | "Notes" alone (49x27), left of the card |
| List row property value | Tag pill | name + description, **below** the value |
| List row property value, no description | Date | "Date" alone, below the value |
| Gallery card property value | Tag pill | name + description, left of the card |

So outside the table header, a property **value or label always has a hint** (its name), and the description is added under the name when there is one. Only the table header shows nothing without a description (research 31 §1, research 33 §1). Hint delay in these places: not timed.

## 5. B10: the description field

Same Tag header menu, dark.
- **Reopen**: after a description was saved, the header menu reopened with **no field showing** (focus in the name input). The (i) has to be clicked again. The header gained `infoCircleSmall`.
- **(i) clicks**: click 1 opens the field with the text and focuses it; **click 2 closes it** (focus to body, text kept); click 3 opens it again.
- **Shift+Enter** inserts a newline ("Tag desc line one\nline two").
- **Enter** leaves the field (focus moves off the textarea); the menu stays open; the text is kept.
- **Growth**: 1 line 20px; 2 lines 40px; from 3 lines on the textarea stays **60px** (inline `style="height: 60px"`) and scrolls (`overflow-y: auto`, scrollHeight 100 then 180).
- **Dark**: see §4 (wrapper rgba(252, 252, 252, 0.03), blue focus ring, radius 6px).

## 6. B12: calendar clicks (dark)

R13's Calendar view (Month). Its View settings › Layout › "Open pages in" lists Side peek ("Open pages on the side. Keeps the view behind interactive."), **Center peek ("… Default for Calendar")**, Full page. `peektype.sh` reads the URL's `p` / `pm` (`pm=c` center, `pm=s` side) and the peek box.

| Action | Open mode setting | Result |
|---|---|---|
| Hover an empty day: a 20x20 **"Add an item"** `plus` button shows at the cell's top left | — | — |
| Click "Add an item" (day 28) | Center peek | new page "New task" on that day, opened in a **center peek** (`pm=c`) |
| Click an event (E1) | **Side peek** | side peek (`pm=s`, 756x717 at x 756) |
| Click "Add an item" (day 29) | Side peek | new page, **side peek** (`pm=s`), with the template picker row "TplA / Empty / New template" at the bottom |
| Real double-click (`page.mouse.dblclick`) on an empty part of day 30 | Side peek | **one** new page (item count 6 → 7), **side peek** |
| **Shift** + double-click, day 31 | Side peek | same as plain: one new page, side peek |
| **Alt** + double-click, day 27 | Side peek | same as plain: one new page, side peek |
| Cmd + double-click | — | **not tried**: a Cmd-click may open a new tab, which takes the extension relay |

So "+" and the double-click open the new page **in the view's own open mode** (center by default, side after the change).

Single clicks on an empty day, Side peek mode: **no page was created** (3 tries: two CLI mouse down/up, one `page.mouse.click`). Research 30 §B11 saw a single click create a page with the view in Center peek mode. Whether the single-click create depends on the open mode was not separated.

Events selected (drag box over E1–E3, 3 halos), then:

| Step | Menu | Selection |
|---|---|---|
| Click the toolbar Sort button | Sort menu opens | **kept** (3) |
| Click outside (page margin, x 400) | menu closes | **kept** (3) |
| Click outside again | — | kept (3) |
| Reselect; open Sort; click an **empty day cell** | menu closes, **no page created** | **kept** (3) |
| Then click the same empty day (no menu open) | — | **cleared** (0); no page created |

## 7. B4: board on a 120-row database (dark)

`r13-big.csv` (generated): `Name,When,Grp,Score`, 120 rows "Row 001" … "Row 120"; When = `MM/DD/YYYY` in October 2026; Grp = **Big** for rows 1–105, **Small** for 106–115, empty for 116–120; Score = row number. Imported on child page S1: "/table view" › panel › **Import CSV** › Choose file (fed by `hook.sh`, no native dialog) › Map CSV headers › Import. The step showed When → "Date • Full date", Grp → "Select", Score → "Number". A modal "**Import complete** / Your CSV import was successful / **Go to import**" followed; "Go to import" opened the database as a full page, 120 rows.

New Board view (tab bar "+" › Board): it grouped by **Grp** at once, Color columns on.

| Read | Value |
|---|---|
| Group header counts on open | Big **"99+"**, Small **10**, **No Grp 5** |
| Click the "99+" count | menu Count / Percent / More options / Date; hover **Count** › submenu: "Show large counts as 99+" / "This improves performance for large databases." with a `role=switch`, **on and enabled** (`checked = true`, `disabled = false`), then Count all, Count values, Count unique values, Count empty, Count not empty |
| Switch off | Big's count reads **105** at once |
| Same view, the Small column's Count submenu | switch **off** too: one setting for the whole view, not per column |
| A second new Board view on the same database | Big **"99+"** again: the setting is **per view**, and a new view starts **on**; the first view kept 105 |
| Where "No Grp" goes (select grouping, manual order) | **last**, after Big and Small |

So research 30's disabled switch was the 3-row case; on a 105-row group it is enabled, on by default, and per view.
Also seen: after the "Count all" switch, focus returned to the count button with a blue ring and the "Count all" tooltip showing (focus, no hover).

- **Date spans under a day** (25caf2c3): **could not measure**. The ledger's wording does not say which grouping this means, and 25caf2c3 is about number ranges; not attempted.
- **"No <property>" in a number range grouping**: **could not measure** (Score has no empty value; time).

## 8. B7: help links and CSV

| Link | Theme | Rest | Hover |
|---|---|---|---|
| "Learn about reminders" (date picker footer) | dark | `A` (a link), text 14px **rgb(125, 122, 117)**; `questionMarkCircle` fill **rgb(173, 169, 163)** | text and glyph unchanged; cursor pointer; no fill on the link's parent |
| "Learn about imports" (Import CSV modal, step 1) | dark | `DIV role=button` 322x32, radius 6px, text 14px / 400 **rgb(142, 139, 134)**; `questionMarkCircleSmall` 16px fill **rgb(142, 139, 134)** | row bg ≈ rgba(255, 255, 255, 0.055); text and glyph unchanged |
| The Setup step ("Setup CSV columns") | dark | **has no "Learn about imports"** (its text: "Setup CSV columns / Choose the property type for each column in your CSV file / Use first row as headers / CSV File Columns / Property Type / … / Import CSV / Cancel") | — |

Neither link was clicked (a click may open a new tab).

CSV, from the import above:
- The created Date property ("When", from `10/02/2026`-style text) displays **"October 2, 2026"**. Its header menu › Edit property submenu reads **"Date format: Full date | Time format: 12 hour | Notifications: None"**.
- The step's preview listed the rows in the order Row 002, Row 001, Row 005, Row 004, Row 003; the imported table (no sort) started Row 120, 119, 118, 116, 117, then the Small rows. Neither is the file order.
- Not measured (time): unmapped column names with headers off in a merge; two columns onto one property; no column matching the title; a taken name; the "Existing property" list for computed, person and file properties; ISO dates under Day/Month/Year; the doubled-"Name" case.

## 9. B8: Place editor in a peek, press outside, Escape in titles (dark)

The 120-row database got a **Where** (Place) property.

**Place editor inside a side peek** (Row 120 › OPEN › side peek; click the "Empty" value of Where):
- Opens a popover **435x73 at (1001, 240)**, over the value (the value column's width), input "Search for a location..." focused, one row "Current Location" (not clicked). Typing "Paris" listed results (first "Paris, Ile-de-France, France"; the others near the user's location are not recorded) and the popover grew to 435x275 with a footer "Results may be limited. Learn more."
- **After a click on a result the popover stays open in view state**, 435x213: a name chip `role=button aria-label="Edit place name"` (192x20, radius 4px, text 14px), a **"Clear location field"** button 20x20 (radius 4px, `xMarkFill` 14px, fill rgb(173, 169, 163)), a **map** (`CANVAS role=region aria-label="Map"`) **427x168**, inset 4px, radius 6px, with a 22x26 pin in the middle, and an **"Open in Google Maps"** link (`A`, 24x24 at the map's bottom right, bg rgb(25, 25, 25), radius 6px, `maps` icon 16px). The peek's value read "Paris, Ile-de-France, France".
- One Escape closed the popover; the peek stayed open.

So in a peek the map takes the popover's width (427 wide); the table cell's popover in research 31 §4a was 232x168. Table cell popover this round: 240 wide.

**Press outside an unpicked search** (table cells):
| Cell before | Action | Cell after |
|---|---|---|
| Row 119 empty | typed "Lond" (results listed), click outside on the page | **empty** (nothing saved), popover closed |
| Row 120 "Paris, Ile-de-France, France" | opened (view state, focus on body), typed **one key "L"** | the cell **cleared at once** (input "L") |
| | then click outside | **stays empty**: Paris is lost |

**Escape in titles**:
- **Board card inline rename** (hover a card › `pencilLineSmall` button › title becomes editable, caret placed with End; typed "X"; **Escape**): the title **saved** ("Row 105X"); focus went to the body; no card selected.
- **Row page heading in a side peek** (click at the end of the H1, typed "Y", **Escape**): **one Escape saved the title and closed the peek** at once (the board card then read "Row 105XY"); focus on the body; nothing selected.

## 10. B11: delete-last-view dialog, light × and position

Measured in §1.7: × "Close" **24x24, bg rgba(42, 28, 0, 0.07)** (a filled circle at rest), radius 100%, glyph fill rgb(142, 139, 134), placed **10px from the box's top and right edges** (box 400x368 at (556, 175), centred in the window). Focus on open: the ×. Dark: bg rgba(255, 255, 243, 0.082), glyph rgb(173, 169, 163).

## 11. B13: sub-group band toggle hint (dark)

R13 board, View settings › Sub-group › **St**. Each band row starts with a toggle: `role=button aria-label="Close"` (while the band is open), 24x24, glyph `arrowCaretDownFillSmall` fill rgb(240, 239, 237). Hover: bg ≈ rgba(255, 255, 255, 0.055), cursor pointer.
**No hint**: nothing in `[role=tooltip]` / `[role=dialog]` after 2.5 s (one sample) and after 4 s (second sample, a different approach path).

## 12. B14: side peek handle, drags under ~10px (dark)

Board card E3 › side peek 756x717. Handle = `role=separator` 12x717 at the peek's left edge. Mouse down at the handle centre (left edge + 6), then mouse moves, then mouse up (`peekdrag.sh`):

| Moves after mouse down | Result |
|---|---|
| +9, +6, +3, +2, +1 px (two move events each) | **resized**, not closed (each time) |
| two move events of **0 px** (to the same point) | **resized** (the edge jumped 6px to the pointer), not closed |
| −6 px (back to the left edge) | resized to the same width, not closed |
| **no move event** (down, up) | **closed** |

So it is not a distance threshold: **any pointer move between down and up starts a resize**, and the peek's left edge follows the pointer's x (not the offset where the handle was grabbed). Only a press with no move closes.
The width carried over when the peek was closed and reopened; after the test it was dragged back to **756** (read back 756,0,756,717) and closed with a click on the handle.

## 13. B15: "Edit cadence" (template "Duplicate every…", dark)

Template TplA › "…" › **Duplicate every… Off** (`arrowSquareLeftRight`, value "Off" with `arrowChevronSingleDownSmall`) › a 180x239 list: **Day, Weekday, Week, 2 Weeks, Month, 3 Months, 6 Months, Year**. Picking **Month** opened the **"Edit cadence"** panel (260x325, never saved):

"Edit cadence | Save | Every **Month** | On the **23rd** **Day** | At **Around midnight** | Starting **Tomorrow** | Ending **Never** | Timezone **GMT+2** | Cancel recurrence | Next occurrence: **Tomorrow between 12–3 AM**" (today Thu Oct 22).

| Control | Its submenu |
|---|---|
| "23rd" (first list, with "Day") | 1st … 31st (31 rows), check on 23rd. No "Last" while the second list is "Day". |
| "Day" (second list) | **Day, Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday** |
| After picking **Monday** | the first list became **1st, 2nd, 3rd, 4th, Last**, set to **Last**; "Next occurrence: Next Mon between 12–3 AM" |
| At "Around midnight" | **"Around midnight / 12–3AM"** (checked), then **3:15 AM, 3:30 AM … 11:45 PM** in 15-minute steps (no 12:00–3:00 AM rows) |
| Starting "Tomorrow" | a month grid picker (Oct 2026), 268x294; no Today button, no time |
| Ending "Never" | **Never, Number of runs, Specific date** (check on Never) |
| Timezone "GMT+2" | 342x595, search input "Search cities, timezones…" focused; "Current timezone" (the user's zone, GMT+2:00, checked), "Select a timezone", then the same **568**-row zone list as the date editor (Abidjan, Accra, Addis Ababa, Algiers, Asmara, Asmera, …) |

**"Around midnight" means a 12–3 AM window** (the At list's first row and the "Next occurrence" line both say so).

Escape on the unsaved panel raised **"Discard unsaved changes?"** (dark): 324x187 centred, bg rgb(32, 32, 32), radius 12px, the dark dialog shadow of §1.7, backdrop rgba(15, 15, 15, 0.8); a 32x32 icon fill rgb(173, 169, 163); title 16px / **600**; buttons 284x32: **"Discard"** red (ink rgb(253, 246, 246)), **focused on open with a ring drawn** (`rgb(25,25,25) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgb(25,25,25) 0 0 0 6px`) and its fill read as `color(srgb 0.911511 0.472468 0.431627)` ≈ rgb(232, 120, 110) while focused; "Cancel" outlined (1px rgba(255, 255, 235, 0.1)). Discard closed it; "Duplicate every…" still read **Off** (nothing saved).

## 14. B16: a flipped submenu (dark)

Full-page database (the 120-row import), New chevron at x 1396 › "Templates for New database" menu at x **1048–1408** › template **TplB** › click its "…" (x 1380–1404). The submenu opened **flipped, over the list: 250x152 at x 1114, right edge 1364** (just left of the "…"), top 204 (same as research 30 §X1's right edge 1364). Focus moved into the submenu (`role=menu`), no row highlighted.

| Key | Result |
|---|---|
| ArrowDown | highlights "Duplicate every…" (first row) |
| ArrowDown | "Set as default" |
| **ArrowRight** (on the first row, and again on "Set as default") | **nothing**: same highlight, submenu stays |
| **ArrowLeft** (same two rows) | **nothing** |
| Escape | closes only the submenu; the templates menu stays |

The trigger is the "…" (`ellipsisSmall`); no chevron on it. Inside, "Duplicate every… Off" ends with `arrowChevronSingleDownSmall` (a dropdown, not a side submenu). Arrow keys in the **unflipped** submenu were not tried, so whether Left/Right differ by side is not known.

## 15. B18: "Hide data source titles" on a non-linked two-source database

R13 after "New data source › New empty data source" (two sources, not linked). The **tab's view menu** (click a selected tab) lists: Rename, Display as ›, Edit view, Source › (New data source / R13), Copy link to view, Add view to sidebar, Open as full page, **"Hide data source titles"** (`eye` icon, plain `menuitem`, no switch), Duplicate view, Delete view. It showed on the second source's view tab (light). A Calendar tab of R13's own source (dark) also had a row after "Open as full page" starting "Hide"; the read cut the text there, so its full label is not confirmed. The "New view" layout pages show **"Show data source titles"** as a switch (board, calendar, timeline). The row was not clicked, so whether it acts per view or per block was not read.

## 16. B19: an added property in other views (dark)

R13 (views Table, Board, Calendar, Timeline, List, Gallery). In the **table**, header "+" › "Extra" › Text; E1 got a value. Then each other view's View settings › Property visibility:

| View | "Extra" |
|---|---|
| Board | **hidden** (shown: Name, Notes, Num, Tag; the earlier-added Notes / Num were shown only because they were switched on in §4) |
| List | **hidden** (shown: Name, Date, Tag) |
| Gallery | **hidden** (shown: Name, Tag) |
| Calendar | **hidden** (shown: Name) |
| Timeline | **hidden** (shown: Name) |

So a property added from the table is hidden in every other existing view (board matches research 30 §B28). Relation tabs: **could not measure** (no relation property; time).

## 17. B20: a formula with mixed branch types (dark)

R13 table, new Formula property **F** = `if(prop("Num") > 40, prop("Num"), "low")` (typed into "Edit formula"; the editor showed the chips "Num"; preview "Type: **unknown**"; no save button: Escape kept it). Num: E1 4277, E2 100, E3 42; the six untitled rows empty.

- **Render**: F shows 4277 / 100 / 42 / "low". The number-branch values are **left-aligned** like text (text box 8px from the cell's left), while the Num column right-aligns the same numbers (9px from the right). Both columns use `font-variant-numeric: lining-nums tabular-nums`; same ink.
- **Sort** (toolbar Sort › F, ascending): **42, 100, 4277, low, low, …**: numbers sort **as numbers** (a text sort would put "100" before "42"), and the text values come after them.
- **Filter** (toolbar Filter › F): default condition "contains"; the condition list is the **text** one: Is, Is not, Contains, Does not contain, Starts with, Ends with, Is empty, Is not empty.
- **Calculate** (F header menu › Calculate): **None, Count ›, Percent ›** only (Percent › Percent empty, Percent not empty). No Sum / Average / Min / Max. The Count submenu did not open on hover in two tries, so its rows were not read.

## 18. B22: "Manage in Calendar" button (dark)

Calendar view toolbar. Button 166.9x24, transparent, **border 1px rgba(255, 255, 235, 0.1)**, radius 6px, padding 0 6px, gap 6px, text 14px / 500 rgb(240, 239, 237). Icon: svg class `calendarDate22`, **16x16** box (its path 12.5x13.1), fill rgb(240, 239, 237). Light border was research 33 §4.1 (1px rgba(28, 19, 1, 0.11)).

## 19. B3: relative dates

- **Workspace "start week on Monday"**: see §22 (read in Settings at the end, not changed).
- **Yesterday on a Monday / Tomorrow on a Sunday**: **could not measure: clock** (the session ran on Thursday Oct 22).
- **Row menu "last edited"** (table row handle ⋮⋮ menu, light, row made a few minutes before): the footer reads "Last edited | <user> | **Today at 4:54 AM**", then "1 word, 2 characters". So the row menu uses "Today at h:mm AM", not "N minutes ago".
- **Feed byline** (Feed view added to R13, dark): the time after the author reads **"31m" / "32m"** (12px, rgb(125, 122, 117)) for pages made about half an hour earlier. Hover (2.5 s) shows a hint "**Created October 22, 2026 at 5:43:51 AM**" (12px, rgb(173, 169, 163)). Research 33 saw "5h" on older posts.
- The "Full date" cell format shows dates as "October 25, 2026" even for days inside this week (§3); words like "Sunday" appear only with the Relative format (research 30 §B6).

## 20. B17: the time zone menu's top edge and bottom margin (dark)

Date editor (E2) › Include time on › **Timezone** row. Two samples with the trigger row at different heights:

| Date editor box | Timezone row | Menu |
|---|---|---|
| (818, 12) 248x594 | y 471 | **342x595 at (1062, 110)**; bottom gap **12px** |
| (818, 111) 248x594 (page scrolled 250px) | y 570 | **342x595 at (1062, 110)**; bottom gap **12px** |

The template cadence's Timezone menu (§13) was also 342x595 at y 110. So in a 717px window the menu does not follow the trigger: it sits **12px above the window bottom** with a fixed **595px** height (search input at y 126; the list scroller 547 tall over 568 rows), which puts its top at 110. Its left edge is the editor's right edge minus 4px (1062 vs 1066). Whether 595 is a cap or the window minus 122: **blocked** (window size cannot change).

Side read for B1: at **06:16:28** local, turning Include time on in an empty-time date gave **7:00 AM** (start and end).

## 21. B21: carried items (dark, partial)

**Map pins** (120-row database; Row 119 Where = London, Row 118 = Paris; new Map view):
- A pin is a DOM marker, `div.maplibregl-marker aria-label="Map marker"`, box **22x32**, holding an svg **22x26** with two paths: outline **rgb(25, 25, 25)** (the dark page bg) and fill **rgb(35, 131, 226)**. Inside is an `A` linking to the row page (`/p/Row-119-<id>?pvs=25`). The map itself is one `CANVAS aria-label="Map"` (1026x400 here). The city names under the pins in the screenshot belong to the map tiles, not to the pins.
- Toolbar: a **"No place (99+)"** button (14px, rgb(173, 169, 163), transparent) for the 118 rows without a place.
- **Hover card**: 260x119, bg rgb(37, 37, 37), above the pin: breadcrumb (page › … › database, 11–12px rgb(125, 122, 117)) then the row title 13px rgb(240, 239, 237). Delay from `pointerover` on the marker to the card's text: **166 ms** from outside the map, **173 ms** moving pin to pin, **164 ms** again from outside. So **no warm window**: every pin waits about the same.
- 100+ pins and pin colours by rule: **not measured** (two places only; time).

**Reminders** (R13, E1 date › Remind › "On day of event (9:00 AM)"; the Remind list is None / On day of event (9:00 AM) / 1 day before (9:00 AM) / 2 days before (9:00 AM) / 1 week before (9:00 AM)):
- Table cell: an **`alarmSmall` icon, 17px, fill rgb(39, 131, 222)** after the date text (129px into the cell); the date text did not change.
- Row page (side peek) Date value: the same `alarmSmall` 17px rgb(39, 131, 222).
- Feed: **could not measure** (the Feed view shows no properties by default, and switching Date on failed: the Settings button was not found in the view's scrolled toolbar; time).
- Lane gap, bulk, paste default: not measured.

**Timeline snap at other zooms: could not measure.** In Month zoom a horizontal mouse drag of E3's bar (6 move events, +60px, at the view's lowest bar row) **moved the row out of the database onto the page** as a page block below the database instead of moving its date. Cmd+Z put it back (E3 back in the timeline at Oct 22, the page block gone, the table row intact). No further bar drags were tried.

Not attempted (time): backlinks with 20+ sources; form "Created by" with anonymous off; the layout builder items; sort-row drag motion; the light leftovers (c7b979bb, 218fec5b, b8cddcef, 8396d0eb).

