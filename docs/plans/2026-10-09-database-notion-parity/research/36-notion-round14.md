# Research 36: round 14 measurements

Measured 2026-10-22 (local, from 09:29 CEST) in the user's signed-in Chrome via `playwright-cli -s=notion36 open --extension`, on app.notion.com.
Workspace on the Free plan. Viewport 1512x717 CSS px, DPR 2. Theme: light unless a section says dark.
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure36/` (not in the repo). Helpers copied from `notion-measure35/` (research 35), session renamed. Raw output: `notion-measure36/raw/`.
Every value is DOM text, `getComputedStyle` / `getBoundingClientRect`, or a screenshot. Anything not observed is **UNMEASURED**. Names of the user's own pages are not written here.

Input: the 12 items of the round-14 brief (gaps left by research 35 and questions from the Blok lanes).

Colour notation: Chrome reports some computed colours as `color(srgb r g b / a)` with 0-1 channels. They are given as read, with the 0-255 value after "≈".

## 0. Setup

- Stored theme at the start: `appearanceSettingStorageKey` = **"system"** (system light).
- Sidebar "New page" › "Page". Private scratch page **M36**.
- First body line: "/table view" › Enter → database **R14** (inline, no "New database" panel).
- Properties: **Select** (Select), **Text** (Text), **Place** (Place).
- Rows **F1**, **F2**, **F3**. Select options: **Def** = Default, **Gry** = Gray, **Red** = Red (set in the cell editor's option "…" › Colors). Pill fills read back: Def rgba(42, 28, 0, 0.07), Gry rgba(28, 19, 1, 0.11), Red rgba(206, 24, 0, 0.165).
- Views from the tab bar "+" (`aria-label="Add view"`): **Feed**, **Board** (grouped by Select at once, Color columns on).
- Helper change from round 13: the CLI now prints `### Snapshot` / `### Events` blocks before `### Result` when the page logs to the console, so every helper reads the line after `### Result` instead of line 2. A new `diffhov.sh` snapshots the computed style of every element in a scope (keyed by element identity), hovers, and prints only what changed.

## 1. Board: Red card hover, column hover (item 1)

### 1.1 Light

Board columns 276 wide (`.notion-board-group`), cards 260x40. Pointer parked at (1500, 700) for 0.8 s, then on the target for 1.5 s; every element of `.notion-board-view` compared.

| Target hovered | What changed (light) |
|---|---|
| **Red card** | card box `DIV[role=presentation]` 260x40 bg rgb(255, 255, 255) → **`color(srgb 0.731135 0.0110221 0.0110221 / 0.0352941)` ≈ rgba(186, 3, 3, 0.035)**; shadow unchanged (`rgba(25,25,25,0.027) 0 4px 12px 0, rgba(25,25,25,0.02) 0 1px 2px 0, rgba(223, 22, 0, 0.094) 0 0 0 1px`). The card's hover tool pill (57x24, white, its own shadow) goes opacity 0 → 1. |
| Default card / Gray card | ≈ rgba(54, 29, 2, 0.031) (same as research 35 §1.2) |
| **Column itself** (pointer in the column's empty bottom padding, or anywhere in it) | **The column fill does not change.** Def/Gry stay rgba(66, 35, 3, 0.03); Red stays **rgba(199, 3, 3, 0.035)**. The only change: the header's two buttons appear (`visibility` hidden → visible, opacity 0 → 1). |
| Header buttons that appear | `"More group options"` (`…`, 24x24) and `"New page"` (`+`, 24x24), at the header's right end (Red: x 1335 and 1359). Glyph fill = the column's count ink: Default **rgb(95, 94, 89)**, Gray **rgb(142, 139, 134)**, Red **rgb(229, 100, 88)**. |
| One header button hovered | its own bg → `color(srgb 0.129412 0.105882 0.0901961 / 0.0509804)` ≈ rgba(33, 27, 23, 0.051) — the **neutral** tint in every column, also in Red. Glyph fill unchanged. |
| "+ New page" row at the column bottom (260x40) | bg transparent → the column's card-hover fill: Default and Gray `color(srgb 0.210997 0.111893 0.00959079 / 0.0313726)` ≈ rgba(54, 29, 2, 0.031); Red **`color(srgb 0.731135 0.0110221 0.0110221 / 0.0352941)`** ≈ rgba(186, 3, 3, 0.035). Ink and ring unchanged (Red: ink rgb(229, 100, 88), ring `rgba(223, 22, 0, 0.094) 0 0 0 1px`). |

Raw: `raw/board-light.txt`, `raw/board-hdrbtn-light.txt`.

## 2. Description field: focus after plain Enter (item 4)

Select property, table header menu (220 wide), (i) `aria-label="Add property description"` (after a save: `"Edit property description"`). `activeElement` read after every step. Three tries:

| Try | Before Enter | After **plain Enter** in the textarea |
|---|---|---|
| 1 | Menu opened by a click on the header, so the pointer landed on the **"Change type"** row and highlighted it (bg ≈ rgba(33, 27, 23, 0.051)). Pointer then moved to the (i) and clicked it. Highlight state at Enter: not read. Typed "Desc one". | Focus **left the textarea** and went into the **"Change type" submenu** (`DIV[role=menu]` 200x645 at (1029, 119)), whose first row **"Text"** had the keyboard ring `rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgba(255,255,255,0.25) 0 0 0 6px`. "Change type" in the parent: `aria-expanded="true"`. Text kept ("Desc one"), no newline. |
| 2 | Menu reopened the same way; the pointer moved onto the (i), which **cleared the highlight** (no highlighted row, read). (i) clicked; caret placed with End; typed " two". | **Focus stayed in the `TEXTAREA`.** No newline (value "Desc one two"). Menu stayed open. A second Enter: same. ArrowDown: same (no row highlighted). |
| 3 | Menu reopened; the (i) opened with `element.click()` so the pointer never left the menu; the field's row pushed the menu down by 29px, so the pointer now highlighted **"Property access"** (read). | Focus **left the textarea** and **"Property access" opened**: a panel with focus on its `"Dismiss"` button. That panel is a Business-plan upsell ("Unlock property access … Get the Business plan … Upgrade now"). Nothing in it was clicked; Escape closed everything (focus to body). |

So plain Enter in the description textarea **does not move focus by itself**. It leaves the field only when a menu row is highlighted, and then it **activates that row** (opens its submenu or its panel). Research 35 §5's "Enter leaves the field" was most likely this case. Shift+Enter (newline) was not re-tested.

## 3. Submenus and ArrowLeft / ArrowRight / Escape (item 6)

### 3.1 The template row "…" submenu

"New" chevron (`More add options`) › "Templates for R14" › row **TplA** › its "…" (24x24 at (1199, 343)), opened with the mouse. Submenu 250x152 at (1235, 343): Duplicate every… Off | Set as default | Edit | Duplicate | Delete.

| Step | Focus after | Submenu |
|---|---|---|
| Open by click | the submenu itself (`DIV[role=menu]`), no row highlighted | open |
| **ArrowLeft** (twice) | unchanged | **stays open** |
| ArrowDown | unchanged; "Duplicate every…" highlighted (≈ rgba(33, 27, 23, 0.051)) | open |
| **ArrowLeft** with a row highlighted | unchanged | **stays open** |
| **ArrowRight** on "Duplicate every…" | unchanged | stays open; nothing else opens |
| **Escape** | the "…" `DIV[role=button]`, ring `rgb(248,248,247) 0 0 0 2px, rgb(35,131,226) 0 0 0 4px, rgba(255,255,255,0.25) 0 0 0 6px`; hint "Edit this template" (115x27) shows from focus | **closed**; the templates menu stays |
| ArrowLeft / ArrowRight on the focused "…" | unchanged | does not open |
| Enter on the focused "…" | **the row's action ran**: a **new row was created from TplA** and opened in a side peek (`pm=s`, title "TplA") | — |

So in the template submenu **ArrowLeft does not close it**; only Escape does. Enter on the focused "…" does not open the submenu (it acts on the row). The extra row "TplA" stayed in R14 until cleanup.

### 3.2 A property-menu submenu (header menu › Change type)

Text property header menu (focus in the name `INPUT`).

| How it was opened | Focus while open | **ArrowLeft** |
|---|---|---|
| Keyboard: ArrowDown ×3 from the name input highlights "Change type", **ArrowRight** opens it | the submenu (`DIV[role=menu]` 200x645 at (1229, 88)); its first row "Text" has the keyboard ring above | **closes the submenu**; focus back to the **name `INPUT`**; "Change type" stays highlighted |
| Mouse: hover "Change type" 1 s | the submenu, "Text" highlighted | (not pressed in this state alone; see next row) |
| Mouse: hover, then click "Change type" | the parent row `DIV[role=menuitem]` "Change type" (no ring drawn) | **closes the submenu**; focus stays on the "Change type" row |
| Mouse: hover again (focus moves into the submenu) | the submenu | **closes the submenu**; focus to the "Change type" row |

So property-menu submenus **do close on ArrowLeft**, opened either way. The template "…" submenu does not.

## 4. Board card rename, then Escape: where focus goes (item 7, light)

Board, card F1: hover › `pencilLineSmall` button (at the card's right, (757, 376)) › the title becomes `DIV[role=textbox]` (contenteditable leaf, 214x23), caret at the end. End, typed "X", **Escape**:
- Title **saved** ("F1X").
- `document.activeElement` = **`BODY`** (`notion-body`). No `.notion-selectable-halo` anywhere (no card selected). No focus ring.
- The DOM selection stays collapsed inside the card's title text node ("F1X", offset 0) though nothing is focused.
- Same after the pointer moved away. Matches research 35 §9 (dark).

## 5. Bulk Text editor: which row's value shows first (item 9)

R14 table, Text values: F1X "alpha", F2 "beta", F3 "gamma" (row order TplA, F1X, F2, F3). Rows ticked with the row checkbox (hover the row, then click the box at x 522). Bar "2 selected" › **Text** button. The editor opened focused (contenteditable). Escape without typing each time (it closed the editor and **cleared the selection**; no value changed).

| View order | Ticked | Prefill |
|---|---|---|
| default (F1X above F3) | **F3, then F1X** | "alpha" (F1X) |
| default | F1X, then F3 | "alpha" (F1X) |
| sorted Text Z → A (F3 above F1X) | F1X, then F3 | **"gamma"** (F3) |
| sorted Text Z → A | F3, then F1X | "gamma" (F3) |

So the editor shows the value of the selected row that is **highest in the current view**. Tick order does not matter. The sort was deleted afterwards.

## 6. "Moved to Trash" toast in light (item 12)

Trigger: table row handle (`"Drag to move, click to open menu"`) › **Move to Trash** on rows made for it (T1–T5). An in-page poller (every 50 ms) logged the toast's "Restore" leaf; times are from the click on "Move to Trash".

**Look (light).** The same box as research 35 §1.6 (which was read in light too): bg **rgb(44, 44, 43)**, ink **rgb(240, 239, 237)**, radius **8px**, padding **11px 16px**, 14px / 21px / 400, shadow `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px`, **198x43 at (657, 646)** in a 1512x717 window (centred on x 756, bottom 28px above the window edge). Text "Moved to Trash" (a text node, no icon, no svg in the box) then a **"Restore"** `role=button` (transparent, ink rgb(240, 239, 237), 14px / 500, padding 0 8px, radius 6px, 67x17). "Restore" hover: `color(srgb 0.129412 0.105882 0.0901961 / 0.0509804)` ≈ rgba(33, 27, 23, 0.051). It has a Restore button, **no "Undo"** label and no close ×. Restore was never clicked.

**Motion.** Enters by sliding up: the "Restore" leaf at y 703 → 686 → 671 → 663 → 660 → 659 in 50 ms steps, so about **250 ms**, from about 0.5–0.7 s after the click. Exit: the leaf shrinks 67 → 64 px wide over about 250 ms, then the toast is gone.

| Case | Visible from | Exit starts | Gone |
|---|---|---|---|
| Pointer parked at (1500, 120) from the click on | 0.67 s | **5.67 s** | 5.92 s |
| Pointer moved onto "Restore" at about 1.5 s and held there | 0.48 s | still on screen at 26.0 s (pointer still on it) | — |
| … then pointer moved away at **26.0 s** | | **30.0 s** (4.0 s after leaving) | 30.13 s |

So the toast lives about **5 s** after it appears, **hover pauses the timer**, and leaving resumes it with the time that was left (about 1 s had passed before the hover, about 4 s ran after). Research 35's 11.7 s had the pointer on "Restore" only for 0.8 s, so it does not fit this; that run was not repeated.
A second visible text "1 block deleted" exists in a 1x1 live region next to the off-screen "Moved to Trash" alert (screen-reader only).

## 7. Place editor after a pick, light (item 2)

R14 row F2, property **Place**, search "Paris", click "Paris, Ile-de-France, France". Note: while results show, **"Current Location" is the highlighted row** by default (Enter would pick it; not pressed). The window was set to **1400x717** with `playwright-cli resize` (it emulates the viewport: `innerWidth` read back 1400, `outerWidth` stayed 1512), then back to 1512 (read back).

| Part (view state after the pick) | Light |
|---|---|
| Popover | bg rgb(255, 255, 255), radius **6px**, shadow `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px` |
| Name chip `"Edit place name"` | 191.7x20, radius 4px, ink rgb(44, 44, 43); hover ≈ rgba(33, 27, 23, 0.051) |
| **×** `"Clear location field"` | 20x20, radius 4px, transparent; `xMarkFill` 14px, **fill rgb(142, 139, 134)**; hover bg `color(srgb 0.129412 0.105882 0.0901961 / 0.0509804)`, glyph unchanged |
| Map | `CANVAS[role=region][aria-label=Map]`, 168 tall; its wrapper radius **6px**, `overflow: hidden`; inset **4px** on every side |
| Pin | `"Map marker"` 22x31.5, svg 22x26: outline path fill **rgb(255, 255, 255)** (`var(--c-bacPri)`, the page bg), body **rgb(35, 131, 226)** (`#2383E2`) |
| **"Open in Google Maps"** | `A[role=link]` 24x24, radius 6px, **bg rgb(255, 255, 255)**, shadow `rgba(25,25,25,0.027) 0 8px 12px 0, rgba(25,25,25,0.027) 0 2px 6px 0, rgba(42,28,0,0.07) 0 0 0 1px`; `maps` glyph 16px, **fill rgb(142, 139, 134)**; ink rgb(44, 44, 43). Placed **8px** from the map's right edge and **10px** from its bottom. Hover bg **`color(srgb 0.956863 0.952941 0.952941)` ≈ rgb(244, 243, 243)** (opaque), shadow and glyph unchanged. Not clicked. |

Research 35 read this button in dark as bg rgb(25, 25, 25) (the dark page bg), so it follows the page background, with a raised shadow in light.

**Width** (popover = the property value column):

| Where | Window | Peek box | Popover | Map |
|---|---|---|---|---|
| Side peek | 1400 | 756 wide (x 644) | **435** at x 889 | **427** (= 435 − 8) |
| Center peek | 1400 | 960x573 at (220, 72) | **539** at x 515 | **531** (= 539 − 8) |
| Center peek | 1512 | 960x573 at (276, 72) | 539 at x 571 | 531 |
| Side peek | 1512 (research 35 §9) | 756 | 435 | 427 |

So **map width = editor width − 8** in both peeks (4px inset each side), and neither peek changes width between 1400 and 1512. The peek was switched with the peek header's `"Switch peek mode"` › Center peek (this also set the Table view to open in center peek; scratch only).

## 8. Confirm dialogs in light (item 3)

### 8.1 "Undo Task Database?"

Reached as in research 35 §0: a second data source ("New data source" › "New empty data source"), View settings › Turn into › Turn into Tasks database › setup dialog › "Turn into task database"; then View settings › **Undo Task database**. After reading, **Remove** was clicked (the conversion is undone; View settings shows "Turn into" again).

| Part | Light |
|---|---|
| Box | 324x193 at (594, 262), bg white, radius 12px; shadow `rgba(25,25,25,0.24) 0 24px 48px 0, rgba(25,25,25,0.14) 0 4px 12px 0, rgba(42,28,0,0.07) 0 0 0 1px`; backdrop rgba(15, 15, 15, 0.6) |
| **×** | **none**: the dialog has no close button and **no svg at all** (0 svgs, 0 `aria-label="Close"`), and no icon above the title |
| Title | "Undo Task Database?" 16px / 500, centred |
| Text | 12px / 400, rgb(125, 122, 117) |
| **"Remove"** (284x32, radius 6px) | ink rgb(229, 100, 88), border 1px rgba(206, 24, 0, 0.165), transparent; **hover bg `color(srgb 0.87451 0.0627451 0 / 0.0627451)` ≈ rgba(223, 16, 0, 0.063)**; ink and border unchanged. Focused on open (no ring drawn: `box-shadow: none`). |
| "Cancel" | ink rgb(44, 44, 43), border 1px rgba(28, 19, 1, 0.11); hover ≈ rgba(33, 27, 23, 0.051) |

Dark "Remove" hover (research 35 §1.7) was ≈ rgba(255, 105, 96, 0.114).

### 8.2 "Reset to original page layout?" (layout builder)

Row F3's page › "Customize layout" (`layoutFillSmall`, no badge) › builder › "More save options" (chevron at top right) › "Reset to original page layout" ("No properties will be deleted") › dialog. Closed with Cancel; the builder was left with its own "Cancel" (nothing applied).

| Part | Light |
|---|---|
| Box | **300x226 at (606, 246)**, bg white, same shadow and backdrop (0.6) as 8.1 |
| **×** `aria-label="Dismiss"` | **22x22** at (874, 256): **10px** from the top and from the right edge; radius 100%; **bg rgba(55, 53, 47, 0.06)** at rest, **rgba(55, 53, 47, 0.16)** on hover; `xMarkFill` 16px fill rgb(142, 139, 134). **Focused on open** (no ring drawn). |
| Icon | `arrowUTurnUpLeft` **32x32** at (740, 266): centred, **20px** below the box top; fill rgb(142, 139, 134) |
| Title | 17px / **600**, centred, 234 wide at y 306 |
| Text | "No properties will be deleted." 14px / 400, rgb(125, 122, 117) |
| "Reset" | 260x32, bg rgb(229, 100, 88), ink **rgb(255, 255, 255)**, radius 6px; hover `color(srgb 0.911511 0.472468 0.431627)` ≈ rgb(232, 120, 110) (lighter) |
| "Cancel" | 260x32, **no border**, ink **rgb(125, 122, 117)**, radius 6px; hover ≈ rgba(33, 27, 23, 0.051) |

So the "10px top/right × + 32px icon" rule **does hold here** (× 10px in, icon 20px below the top, as in the delete-last-view dialog, research 35 §1.7), but this × is **22px with the older rgba(55, 53, 47, …) fills**, not the 24px rgba(42, 28, 0, 0.07) circle of the delete-last-view dialog. "Undo Task Database?" has neither × nor icon.

### 8.3 Delete-last-view dialog: the unselected radio's dot (light)

Second data source's only view › tab menu › Delete view. Same box as research 35 §1.7 (400x368, × "Close" 24x24 bg rgba(42, 28, 0, 0.07) 10px in, focused on open).

| Radio | Ring | Inner dot (6x6, radius 6px) |
|---|---|---|
| Picked ("Delete view only") | 16x16, bg rgb(229, 100, 88) | bg rgb(240, 239, 237), **opacity 1** |
| Unpicked ("Delete view and data source") | 16x16, bg white, border 1px rgba(27, 21, 0, 0.19) | **present in the DOM** (bg rgb(240, 239, 237), `display: block`, `visibility: visible`) but **opacity 0** |

Screenshot pixels (DPR 2) agree: unpicked radio centre rgb(255, 255, 255), picked centre rgb(240, 239, 237). So the unpicked dot is **not visible**. Hovering the unpicked card changed nothing. Closed with Cancel (the view menu stayed open behind it).

### 8.4 The bottom-left notice in light

"Turned into task database" (after 8.1's conversion), read in light: **the same dark box as research 35 §1.9 read in dark**: 280x78 at (282, 627), bg **rgb(32, 32, 32)**, border 1px rgb(44, 44, 43), radius 8px, padding 8px 8px 4px, no shadow; `checkmarkCircleSmall` 16px fill rgb(70, 161, 113); title 12px / 16px / 600 and body 12px / 16px / 400, both rgb(240, 239, 237); × `"Close"` 24x24 radius 6px, `xMark` 14px fill rgba(255, 255, 255, 0.81). So this notice does **not** follow the theme.

## 9. "Show large counts as 99+": when the switch is enabled (item 5)

Two databases:
- **CSV import**: `r14-101.csv` (`Name,Grp,Score`, rows "Row 001" … "Row 101", Grp = **A** for all, Score = row number), imported as a new data source of R14 ("3 more…" › New data source › Import CSV › Choose file, fed by `hook.sh` › Map CSV headers › Import CSV › "Import complete"). Its Table view was switched to Board (View settings › Layout › Board; it grouped by Grp at once). One group **A** of 101, plus "No Grp 0".
- **R14** itself: 5 rows, Board grouped by Select, groups of 1, 1, 1 and "No Select 2".

A view filter on **Score ≤ N** shrinks the visible group while the database keeps 101 rows. Each read: click the group count › hover "Count" › read the switch (`INPUT[role=switch]`, opacity 0 over a 30x18 track) `checked` / `disabled`.

| Database rows | Filter | Group A count shown | Switch `checked` | `disabled` | Track |
|---|---|---|---|---|---|
| 101 | none | **"99+"** | true | **false** | rgb(39, 131, 222) |
| 101 | Score ≤ 100 | **"99+"** (100 rows) | true | false | |
| 101 | Score ≤ 99 | **"99"** | true | false | |
| 101 | Score ≤ 50 | "50" | true | false | |
| 101 | Score ≤ 3 | "3" | true | false | |
| **5** (R14) | none | "1" (Def column) | true | **false** | rgb(39, 131, 222); a click turned it **off** (`checked=false`), a second click back on |

So the switch was **enabled in every case tried**, down to a 5-row database with one row in the group. Research 30's "disabled on 3 rows" was **not reproduced**; whether it depended on something else on that database (or changed since) is unknown. The count label switches to "99+" only at **100** rows in the group (99 shows "99"; 100 shows "99+"). No ancestor of the switch had `aria-disabled`, reduced opacity, or `pointer-events: none`.
Not tried: a fresh database of exactly 3 rows (the 5-row R14 stands in for it).

## 10. Feed byline age (item 8)

Feed view of R14. An in-page `setInterval` (1 s) stored the byline text of every "(edited)" card when it changed (`raw/feed-ages-*.json`). The age's hover hint gives the exact time: **"Created October 22, 2026 at 9:32:17 AM"** (F1) and "Created … 9:34:50 AM" (F2), so **the age counts from the page's creation time**, not the last edit. The "(edited)" label's hint is "Last edited October 22, 2026 at 9:35:12 AM".

| Wall clock (local) | F1 (created 09:32:17) | F2 (created 09:34:50) | Note |
|---|---|---|---|
| ~09:33 | **"Just now"** | — | read in a screenshot right after creation |
| 09:34:39 | 1m | — | |
| **09:34:45** | → **2m** (age 148 s) | | |
| 09:35:13 | 2m | **"Just now"** | F2 created from the feed's "+ New page" |
| **09:35:45** | → 3m (208 s) | Just now (55 s) | |
| **09:36:15** | 3m (238 s) | → **1m** (85 s) | |
| **09:36:45** | → 4m | 1m (115 s) | |
| 09:37:08 (view re-rendered by switching tabs) | 4m (291 s) | **1m** (138 s, not 2m) | |
| **09:37:15** | 4m | → 2m (145 s) | |
| 10:31:45 | 59m | 56m | |
| **10:32:15** | **59m** (age 3598 s) | 57m | |
| **10:32:45** | → **"1h"** (age 3628 s) | 57m | |

What this shows:
- **It updates live**: with the page left open, the text changed on its own every minute for 3+ minutes (09:34–09:37) and again at 10:31–10:32.
- **Under 1 minute: "Just now"** (not "now", not "0m"). From 1 minute: **"1m" … "59m"**, then **"1h"** (not "60m").
- **Every change happened on the wall-clock second :15 or :45**, for both cards, so the app re-reads the time on a **30 s tick** (phase set by the app, not by each card). The shown value is **floor(age ÷ 60 s) at the last tick**: the fresh render at 09:37:08 still showed F2 "1m" at 138 s, because the last tick (09:36:45) had seen 115 s. So a byline can lag up to 30 s.
- Not read: when "1h" turns into "2h" or into a date; the 24 h / day boundary (clock).

## 11. Board hover in dark (item 1, continued)

Dark via **Cmd+Shift+L** (stored "dark", body bg rgb(25, 25, 25)). The sidebar was closed at this point, so the columns sit 135px further left than in §1.1; sizes are the same. Same `diffhov.sh` method.

| Part | Default (Def) dark | Gray (Gry) dark | **Red** dark |
|---|---|---|---|
| Column bg (rest = hover: **no change on column hover**) | rgba(252, 252, 252, 0.03) | rgba(252, 252, 252, 0.03) | **rgba(251, 107, 107, 0.047)** |
| Card rest bg / ring | rgb(32, 32, 32) / `rgba(255, 255, 243, 0.082) 0 0 0 1px` | rgb(44, 44, 43) / same | **rgb(65, 39, 37)** / **`rgba(255, 106, 94, 0.173) 0 0 0 1px`** |
| Card shadow (all) | `rgba(25, 25, 25, 0.08) 0 2px 4px 0` + the ring | | |
| **Card hover** bg (shadow unchanged) | `color(srgb 0.15049 0.15049 0.15049)` ≈ rgb(38, 38, 38) | `color(srgb 0.197836 0.197836 0.19334)` ≈ rgb(50, 50, 49) | **`color(srgb 0.286765 0.172059 0.163235)` ≈ rgb(73, 44, 42)** |
| "+ New page" row: ink / ring | rgb(188, 186, 182) / `rgba(255, 255, 243, 0.082) 0 0 0 1px` | rgb(142, 139, 134) / same | rgb(229, 100, 88) / `rgba(255, 106, 94, 0.173) 0 0 0 1px` |
| "+ New page" row **hover** bg | ≈ rgb(38, 38, 38) (the card hover, opaque) | ≈ rgb(50, 50, 49) | ≈ rgb(73, 44, 42) |
| Header "…" / "+" glyph fill (appear on column hover) | rgb(188, 186, 182) | rgb(142, 139, 134) | rgb(229, 100, 88) |
| One header button hovered | `color(srgb 1 1 1 / 0.054902)` ≈ rgba(255, 255, 255, 0.055), every column | | |
| Card hover tool pill (57x24, opacity 0 → 1) | bg rgb(37, 37, 37), shadow `rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px` | | |

So in both themes: the column fill never changes on hover; the hovered card and the hovered "New page" row take **the same fill** (translucent in light, opaque in dark); the header buttons are the only thing the column hover reveals, and their own hover is the neutral tint.
Raw: `raw/board-dark.txt`.

## 12. Relation tabs (item 10)

Relation property **"Related R14"** added from the table header "+" › Relation › Suggested "R14" (this database; Limit "No limit", "Add related property" off) › Add relation. F2 related to **F3** and **T4** (cell picker "In R14 / Select a page"). On the row pages, the relation's property menu (Rename, Edit property, Comment, Property visibility, Delete property, Customize layout) and its Edit property panel (Type, Property access, Related to, Limit, Add related property, Delete property, Learn about relations) have **no "show as" option**. A relation tab is made in the layout builder:

- F2 › "Customize layout" › Structure **Tabbed** (tab "Content" appears) › hover the tab bar › **"Add tab"** (`aria-label`, at the right of the last tab) › menu 270 wide: a section label **"Related to R14"** (12px / 500, rgb(125, 122, 117)) with the row **"Related R14"** (14px / 400), then **"Link existing data source"** (`viewTable`). So **every relation property is offered as a tab**, above the linked-view option.
- Picking "Related R14" adds a tab named **"Related R14"**, selects it, and opens its View settings at once: Layout Table · Property visibility **5** · **Filter "Related R14"** (the view is filtered to this row's relation) · Sort · Group · Conditional color · Data source settings: Source R14 · Edit properties · AI Autofill · More settings · Duplicate view · Delete view.
- The tab's table: columns **Name, Place, Related R14, Select, Text** (Name first, then **alphabetical**, not the database's column order Select, Text, Place, Related R14); rows **T4, F3** (the related pages only).
- Applied with "Apply to all pages". Then a **Number** property was added from the **main** table's header "+". Reopening F2's side peek (the "Related R14" tab stayed selected): columns **Name, Number, Place, Related R14, Select, Text**. So **a property added elsewhere does show in an existing relation tab**, placed alphabetically. Research 35 §16 found the opposite for ordinary existing views (hidden there).
- Not read: the tab's colours, its "Add new relation" path, deleting a relation tab, relation tabs in center peek / full page.

## 13. Form view: who a response is from (item 11, dark)

R14 › "3 more…" › New view › **Form** › "New form / Select data source" › R14. A modal "Auto-create form questions based on existing properties? / Only supported property types will create new questions. / **Create 5 questions** | **Start from scratch**" (the count = the database's supported properties); "Start from scratch" was picked (one question, Name).
- Builder line under the cover: "Only members at Personal can fill out this form. **Change**" (Change = the form's access; not clicked: sharing).
- Form settings (`"Edit form, add questions and more…"`, `slidersSmall`): New question · Automations · Submit screen (**Plus** badge, not opened) · Source R14 · Delete form · Learn about forms. **No anonymous switch here**; it is not in the builder at all (likely behind "Share form", which was not opened).
- **Preview** (`eye`) opens the form in a **center peek** (960 wide at (276, 72)). Above the first question a chip **"Submitting response as [avatar] <user name>"**: 264x33, bg **rgba(255, 255, 255, 0.03)**, radius **6px**, padding **6px 10px**, text 14px / 21px / 400 **rgb(173, 169, 163)**; avatar `IMG` **20x20, radius 100%**. So with the default access (members only, not anonymous) the respondent is shown **before** submitting. Question input 600x38, padding 5px 10px, 16px / 28px, placeholder "Your answer". **"Submit"** 77x36, bg rgb(44, 44, 43), ink rgb(240, 239, 237), 16px / 28px / 500, padding 4px 12px, radius 6px.
- Submitting from Preview (answer "FormResp") **creates a real row**, and shows: `formCheck` 56px glyph rgb(173, 169, 163); **"Thank you!"** H2 24px / 700; "Your response has been submitted successfully." 16px / 400; **"View my response"** (144x32, bg rgb(44, 44, 43), 14px / 500, radius 6px) and **"Email me a copy"** (137x32, transparent, border 1px rgba(255, 255, 235, 0.1), 15px / 400; not clicked).
- **"View my response"** navigated the tab to the new row **as a full page** (`/p/FormResp-<id>`, breadcrumb … / R14 / FormResp), with the row's own layout (here the Tabbed layout from §12). So "View my response" **is** reachable without a share link, from Preview.
- **"Created by"** (added afterwards from the table header "+"): the FormResp row shows **the same person as every other row** (the user who submitted from Preview; compared in-page, name not recorded). So with anonymous off, a response's Created by is the respondent.
- Anonymous on: **UNMEASURED** (its switch was not found outside the share panel).
