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
