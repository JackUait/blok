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
