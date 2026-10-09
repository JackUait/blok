# 08 — Notion signed-in measurements (Task M)

Measured 2026-10-09 in the user's signed-in Notion (`app.notion.com`), driven by `playwright-cli -s=notion-m open --extension`. Viewport 1512×717 (the user's real window; not resized. research/07 used 1440×900). Light theme unless stated.

Scratch page: a private top-level page "Blok parity scratch (delete me)" (normal width, text column 720px at x=531). One inline database (`.notion-collection_view-block`), 22 properties, 6 rows.

Every value comes from `getComputedStyle` / `getBoundingClientRect` / `document.getAnimations()` read in-page, or from a screenshot in `shots-08/`. Rect format `[x, y, w, h]` CSS px.

Notion build note: this workspace runs the "data source" generation of databases. Inserting `/database inline` opens a "New database" side menu (AI prompt, "New empty data source", Import CSV, templates). The "+ New" button is a blue split button, not the gray text button older docs describe.

## Scratch database contents

Properties (header order): Name (title), Notes (Text), Amount (Number, format "US Dollar"), Stage (Select: Idea / Build / Ship), Tags (Multi-select, 10 options, one per color), Progress (Status), Due (Date), Owner (Person, only the user), Done (Checkbox), Link (URL), Mail (Email), Tel (Phone), Attachment (Files & media, one embed link), Created (Created time), Creator (Created by), Edited (Last edited time), Editor (Last edited by), Code (ID), Double (Formula `prop("Amount") * 2`), Related (Relation to the same database), Roll (Rollup: Related → Amount → Sum), Act (Button, no actions).

Rows: Alpha, Bravo, Charlie, Delta, Echo, Foxtrot. Amount $1,200.00 / $35.50 / empty / -$40.00 / $7.00 / empty. Stage Idea / Build / Ship / Idea / empty / Build. Due Oct 12 / Oct 9 / empty / Oct 20 / Oct 3 / empty (2026).

The property type menu (`shots-08/01-add-property-menu.png`) lists, in order: AI Autofill (Summarize, Translate), then "Select type": Text, Number, Select, Multi-select, Status, Date, Person, Files & media, Checkbox, URL, Phone, Email, Relation, Rollup, Formula, Button, ID, Place, Created time, Last edited time, Created by, Last edited by, Google Drive File, Figma File, GitHub Pull Requests, Zendesk Ticket.

## Decision answers (D3, D7, D8, D9)

### D3 — selection colour: BLUE (measured)

| State | Element | Value |
|---|---|---|
| Cell selected (after Enter commits a title, or after Enter in a cell editor) | overlay div over the cell, `pointer-events: none`, `z-index: 84` | bg `rgba(35, 131, 226, 0.07)`, `box-shadow: rgb(39, 131, 222) 0 0 0 2px inset`, `border-radius: 2px`. Same rect as the cell (279×37). No transition. `shots-08/10-enter-in-last-row.png` |
| Cell selected: fill handle | 9×9 circle at the bottom-right corner | bg white, `border: 2px solid rgb(39, 131, 222)`, `border-radius: 50%`, `transition: transform 0.2s` |
| Row selected (reached by Escape from a selected cell, by clicking the row's ⋮⋮, and by drag start; a direct click on the row checkbox was not tried) | `.notion-selectable-halo`, full row width, `pointer-events: none`, `z-index: 86` | bg `rgba(35, 131, 226, 0.14)`, radius 0, `transition: opacity 0.2s` (fades 0 → 1 in 200 ms `ease`, seen in `getAnimations()`). `shots-08/11-amount-values.png` |
| Row checkbox (checked) | 16×16 at the row's left gutter | bg `rgb(39, 131, 222)`, radius 3px, `transition: background 0.2s ease-out`. Header checkbox shows the indeterminate "–" state. |
| Selection action bar ("1 selected") | replaces the view toolbar row, 32px tall | container bg white, radius 5px, shadow `rgba(25,25,25,0.027) 0 8px 12px, rgba(25,25,25,0.027) 0 2px 6px, rgba(42,28,0,0.07) 0 0 0 1px`; "1 selected" label 14px/21px **blue** `rgb(39, 131, 222)`, `padding: 0 10px`; then one button per visible property (Notes, Amount, Stage, Tags), a trash icon and "…" |

So Notion paints every selection blue: cell, row and the count label. Blok's "no blue selected states" law conflicts with Notion here. Recommendation D3 (gray fill, primary ink) is a deliberate divergence.

### D7 — dragging a row in a sorted view: Notion asks

Sorted by Amount ascending. Dragging Echo's ⋮⋮ handle below Alpha shows the normal drag (ghost row at `opacity: 0.4`, `pointer-events: none`; drop line 4px tall, bg `rgba(35, 131, 226, 0.43)`, `z-index: 88`, `shots-08/36-row-drag-sorted-mid.png`). On release, Notion opens a centred modal: **"Would you like to remove sorting?"** with **Remove** (red text `rgb(229,100,88)`, border `1px solid rgba(206,24,0,0.165)`) and **Don't remove** (`shots-08/37-row-drop-sorted.png`).
- **Don't remove**: the drop is discarded. Order and sort stay as they were.
- **Remove**: the sort is deleted, the current sorted order becomes the manual order, and the dragged row lands where it was dropped. Result: Delta, Bravo, Alpha, Echo, Charlie, Foxtrot (`shots-08/38-row-drop-after-remove-sort.png`).

Dialog: `.notion-dialog` 324×145, `padding: 20px`, radius 12px, shadow `rgba(25,25,25,0.24) 0 24px 48px, rgba(25,25,25,0.14) 0 4px 12px, rgba(42,28,0,0.07) 0 0 0 1px`, title 16px/24px weight 600 centred, buttons 284×32 radius 6px 14px weight 500 with 8px top margin. Backdrop `rgba(15, 15, 15, 0.6)`. Enter motion: dialog `transform` `translateZ(0) scale(0.97)` → identity, 200 ms `ease`; wrapper `opacity` 0 → 1, 200 ms `ease` (`transition: opacity 0.2s, transform 0.2s`).

### D8 — empty values in a sort: last in BOTH directions

| Property | Ascending order | Descending order |
|---|---|---|
| Number (Amount) | -40, 7, 35.5, 1200, **empty, empty** | 1200, 35.5, 7, -40, **empty, empty** |
| Date (Due) | Oct 3, 9, 12, 20, **empty, empty** | Oct 20, 12, 9, 3, **empty, empty** |
| Select (Stage) | Idea, Idea, Build, Build, Ship, **empty** | Ship, Build, Build, Idea, Idea, **empty** |
| Text (Notes) | "A longer…", "short", **4× empty** | "short", "A longer…", **4× empty** |

- Select sorts by **option order** (Idea, Build, Ship is creation order), not alphabetically.
- Ties keep manual order (Charlie before Foxtrot in both directions; Alpha before Delta for Idea in both).
- Sort labels in the header menu differ per type: Number "Sort low → high / high → low"; Date "Sort old → new / new → old"; Select "Sort ascending / descending"; Text "Sort A → Z / Z → A".
- A sort chosen from a column header **replaces** the existing sort (one pill remains).
- Sort pill (active): 24px tall, `padding: 0 8px`, radius 32px, bg `rgba(0, 124, 215, 0.094)`, text and arrow `rgb(39, 131, 222)` 14px/24px. The toolbar sort icon turns blue (`fill rgb(39,131,222)`). "+ Filter" ghost button next to it: 24px, `padding: 0 9px 0 5px`, radius 12px, `rgb(161,158,153)`.

### D9 — deleting a select option a board groups by: the cards move to "No ⟨property⟩"

Board grouped by Stage (Build 2, Idea 2, Ship 1 = Charlie, No Stage 1 = Echo). Deleting the option "Ship" from the select editor's option menu (⋯ → Delete) shows a confirm, **"Are you sure you want to delete this option?"** with Delete / Cancel (`shots-08/50-delete-option-confirm.png`). After Delete:
- Charlie keeps existing. Its Stage cell is now empty.
- The Ship column is gone. The board reads Build 2, Idea 2, **No Stage 2** (Echo, Charlie) (`shots-08/51-board-after-option-delete.png`).

A different action lives in the board column's "More group options" menu: Edit groups, Hide aggregation, Hide group, **Move to Trash**, then the 10 colors. "Move to Trash" asks **"Are you sure? All pages inside this group will be moved to Trash."** (Move to Trash / Cancel, `shots-08/48-board-group-trash-confirm.png`). It was cancelled. So Notion keeps "delete the option" (rows survive, value cleared) apart from "trash the group's pages" (explicit, confirmed). This matches the D9 recommendation.

## Board (inline, normal-width page) — grouped by a select

| Item | Value |
|---|---|
| Column header pill (select) | 20px, `padding: 0 6px`, radius 4px, **14px/16.8px weight 500**, option colors as in the pill table |
| Count next to the pill | 20px box, `padding: 0 6px`, radius 4px, 14px weight 400, `transition: background 0.1s ease-in-out`. Colored per group: yellow `rgb(216, 163, 47)`, default `rgb(95, 94, 89)` |
| "No Stage" label | plain text, no pill, 14px/16.8px **weight 500**, ink `rgb(44,44,43)`, `margin-left: 4px` |
| No-value group position | **last**, after every option column (Build, Idea, Ship, No Stage) |
| Column body tints | yellow `rgba(207, 175, 0, 0.063)`, brown `rgba(115, 59, 3, 0.035)`, default and no-value `rgba(66, 35, 3, 0.03)`; radius `0 0 10px 10px`, `padding: 0 8px 8px`, 276 wide |
| Card in a colored column | 260×40, radius 10px, bg white, shadow `rgba(25,25,25,0.027) 0 4px 12px, rgba(25,25,25,0.02) 0 1px 2px, rgba(211, 168, 0, 0.137) 0 0 0 1px` (the 1px ring takes the column hue), `margin-bottom: 8px`, `transition: background 0.1s ease-out` |
| Card title | 15px/22.5px weight 500, `padding: 0 1px` |
| "+ New page" at the column foot | 260×40, radius 10px, `padding: 0 10px`, ring `rgba(211,168,0,0.137) 0 0 0 1px` in the yellow column, text colored by the group (yellow `rgb(216,163,47)`, brown `rgb(182,137,101)`, default `rgb(95,94,89)`), `transition: background 0.1s ease-in-out` |
| Column header hover buttons | "More group options" (⋯) 24×24 and "New page" (+) 24×24 at the right end of the header |
| After the last column | a "New group" button; when groups exceed the load limit, "Load more groups" |

### Multi-select board (grouped by Tags)

A card shows in **every** option's column. Alpha (10 tags) appeared in all 10 columns; Blue held Foxtrot, Echo, Bravo, Alpha (`shots-08/44-board-by-tags.png`). Columns came out alphabetical (Blue, Brown, Default, Gray, Green, Orange, Pink, Purple, Red, Yellow). Delta (no tags) was not visible: the board showed 10 groups and a **"Load more groups"** button, so the "No Tags" group sits past the first 10.

## Group settings per type

Panel "Group": Group by ⟨prop⟩, then type-specific rows, Sort, Hide empty groups, Color columns (select/status only), Groups list (with Hide all), "Learn about grouping".

| Grouped by | Type-specific row | Sort options | Groups listed |
|---|---|---|---|
| Status | "Status by": Group / Option | Ascending (default) | Not started, In progress, Done |
| Select | — | Manual (default) / Alphabetical / Reverse alphabetical | Build, Idea, Ship, No Stage |
| Multi-select | — | Manual / Alphabetical / Reverse alphabetical | one per option |
| Date | "Date by": Relative (default) / Day / Week / Month / Year | Oldest first / Newest first | No Due, Last 7 days, Today, Next 7 days, Next 30 days |
| Number | "Number by": Unique (default) / Range | Ascending / Descending | No Amount, -$40.00, $7.00, $35.50, $1,200.00 |
| Text | "Text by": Exact (default) / Alphabetical | Manual / Alphabetical / Reverse alphabetical | No Notes, then each value |
| Checkbox | — | — | two groups |
| Person | — | — | Jack Uait, No Owner |
| Created time | as Date | Oldest first | Today |

The group-by property list excluded Files, Button and ID (list: Name, Amount, Created, Creator, Done, Double, Due, Edited, Editor, Link, Mail, Notes, Owner, Progress, Related, Roll, Stage, Tags, Tel).

## View settings panel (`shots-08/41-board-created.png`, `45-board-by-stage.png`)

| Item | Value |
|---|---|
| Panel | 290 wide, radius 10px, bg white, shadow `rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px`; anchored under the toolbar's settings button, right-aligned |
| Title ("View settings" / "New view") | 14px/21px weight 600 |
| Rows | 28px, `padding: 0 8px`, gap 8px, 14px/16.8px ink; value on the right `rgb(161,158,153)` + chevron |
| Layout tiles (new view) | 83×56.5, `padding: 6px`, radius 6px, label 11px/16.5px. Unselected: inset ring `rgb(230,229,227) 0 0 0 1px`, text `rgb(125,122,117)` weight 400. Selected: inset ring `rgb(39,131,222) 0 0 0 2px`, text **blue** weight 500 |
| Toggle | 30×18 track (26×14 + 2px padding), radius 44px, on = `rgb(39,131,222)`, `transition: background 0.2s, box-shadow 0.2s`; knob 14×14 white, `transform: translateX(12px)` when on, `transition: transform 0.2s ease-out, background 0.2s ease-out` |
| Main rows (existing view) | Layout, Property visibility, Filter, Sort, Group, Sub-group, Conditional color, Copy link to view; "Data source settings": Source, Edit properties, Automations, AI Autofill, More settings; Manage data sources, Lock database, Manage in Calendar |
| New-view rows (board) | Show data source titles, Show page icon, Wrap all content, Group by, Color columns, Open pages in (Side peek), Load limit (25), Card preview (None), Card size (Medium), Card layout (Compact / List), Source |

Add-view menu ("+" beside the database title): Table, Board, Gallery, List, Chart, Dashboard, Timeline, Feed, Map, Calendar, Form, New data source.

## Focus ring after keyboard navigation

On the toolbar settings button after Escape returned focus (`:focus-visible` true): `box-shadow: rgb(248, 248, 247) 0 0 0 2px, rgb(35, 131, 226) 0 0 0 4px, rgba(255, 255, 255, 0.25) 0 0 0 6px`, `outline: 2px solid transparent`, plus the hover bg `rgba(33,27,23,0.05)`. A 2px off-white gap, then a 2px blue ring.

## Motion

Method: before each gesture, an in-page `requestAnimationFrame` loop sampled `document.getAnimations()` every frame (effect keyframes, `getTiming()`), plus the target's rect / opacity / transform, and a MutationObserver read the computed `transition` / `animation` of newly added nodes. The gesture was a trusted Playwright mouse or key event in the same `run-code` call. "t" is ms from the start of sampling; the gesture fires about 20 ms in. Two kinds of noise appear in every capture and are left out below: the top bar's 700 ms `ease` opacity fade (Notion hides the top bar while you type and shows it on pointer move), and the 1000 ms `linear` `shimmer` / 1200 ms `spin` loaders.

| Gesture | What animates | Duration / easing | Keyframes |
|---|---|---|---|
| Menu / popover **open** (column header property menu, board group "⋯" menu, "New group" popover) | menu wrapper (`transform-origin: 0 0`, i.e. the corner nearest the anchor) | `opacity` 200 ms `ease`; `transform` 200 ms `ease` | opacity 0 → 1; `scale(0.96)` → `scale(1)` |
| Menu **close** (Escape) | same wrapper | 200 ms `ease` both | opacity 1 → 0; `scale(1)` → `scale(0.96)` |
| Menu item hover | item bg | `background` 20 ms `ease-in` | transparent → `rgba(33,27,23,0.05)` |
| **Cell editor** open: select (search-or-create), date picker, person, text | nothing on the popover. It mounts at its final opacity and size. The cell's selection ring fades | ring/halo `opacity` 200 ms `ease`; the previous row selection clearing (row checkbox bg `rgb(39,131,222)` → transparent, 200 ms `ease-out`); one unidentified element opacity 1 → 0.4, 200 ms `ease-in` | — |
| Cell editor close (Escape) | nothing (popover unmounts) | — | — |
| **Side peek open** (`shots-08/53-side-peek-open.png`) | `.notion-peek-renderer` slides in; `main.notion-frame` narrows at the same time | `transform` 200 ms `ease`; `width` 200 ms `ease` | `translateX(1512px)` → `translateX(0)`; frame width 1242 → 486 px. Panel = 756 px (half the 1512 viewport). Also a 150 ms `linear` opacity fade on a top-bar element |
| **Side peek close** (Escape) | same, reversed | 200 ms `ease` | sampled translateX: t=8 173 px, 48 537, 81 662, 105 714, 129 743, 155 755, 180 756 (= own width, done). Frame width 486 → 1242 |
| **Center peek open / close** | **none**. The 960×573 panel is at its final rect `[276, 72, 960, 573]`, opacity 1, `transform: none` from the first frame after mount (92 ms); close unmounts in one frame | — | — (matches research/07) |
| Modal dialog ("Would you like to remove sorting?") | `.notion-dialog` + wrapper | `transform` 200 ms `ease`, `opacity` 200 ms `ease` | `translateZ(0) scale(0.97)` → identity; 0 → 1 |
| **Group collapse / expand** (grouped table caret) | caret svg only. Rows unmount / mount instantly, no height animation | `transform` 200 ms `ease-out` | `rotateZ(0deg)` → `rotateZ(-90deg)` (collapse) and back |
| **Card drag start** (board) | ghost appears at `opacity: 0.4`, `pointer-events: none`, no shadow, no rotation, no scale; the source card stays in place with the hover tint; a 4px drop line `rgba(35,131,226,0.43)` shows between cards | drop line `opacity` 200 ms (`transition: opacity 0.2s`) | — (`shots-08/57-card-drag-mid.png`) |
| **Card drop** | no FLIP / reflow animation; the card is in its new column on the next frame. Drop line fades out; the dropped card's selection halo fades in | `opacity` 200 ms `ease` | 1 → 0 (line), 0 → 1 (halo) |
| **Row drag** (table) | same model as cards: ghost row `opacity: 0.4`, drop line 4px `rgba(35,131,226,0.43)` `z-index: 88`; drag start also selects the row: its checkbox bg goes transparent → `rgb(39,131,222)` in 200 ms `ease-out` | 200 ms | — |
| **Column resize** | handle 5×36 at the header cell's right edge, cursor `col-resize`. Hover: bg transparent → `rgba(35, 131, 226, 0.8)` 200 ms `ease-out`. Dragging: width follows the pointer live (200 → 280 px), no transition; the blue bar stays header-height (36 px), it does not run down the column | 200 ms `ease-out` (hover only) | — |
| **Board column add** ("New group") | the name popover opens and closes with the menu motion (scale 0.96, 200 ms `ease`). The new column appears instantly | — | — (`shots-08/62-board-group-added.png`) |
| **View tab switch** (Table ↔ Board) | tab bg only: old tab `rgba(33,27,23,0.05)` → transparent, new tab → active, 100 ms `ease-in-out`. The view body swaps in one frame (no cross-fade) | 100 ms `ease-in-out` | — |
| Toggle switch (view settings) | knob `transform` 200 ms `ease-out`, track `background` 200 ms | 200 ms | `translateX(0)` → `translateX(12px)` |
| Date picker / select / person **open** | see "Cell editor open": no popover motion | — | — |
| Row selection halo | `opacity` 200 ms `ease` | 0 → 1 | — |

A new group added from "New group" was placed **after** "No Stage" (Build, Idea, No Stage, Review). So the no-value group is last only until a group is added.

## Behaviours observed

D7, D8 and D9 are answered under "Decision answers" above. The no-value group label and position, and the multi-select board, are under "Board" above. Enter in the last row is in the keyboard table below.

### Cell keyboard model (table)

Driven with real key presses; the state after each key was read from the DOM (selection overlay rect mapped to row/column, `document.activeElement`, open popovers, row halos).

| Start state | Input | Result |
|---|---|---|
| nothing | **click** a Text, Number, Select, Date, Person or title cell | the **editor opens at once** (text: an overlay contenteditable holding the value; number: an `<input>` holding "$35.50"; select: search-or-create popover; date: picker). There is no "select first" click |
| nothing | click a Checkbox cell | toggles the checkbox |
| editing | **Escape** | editor closes, the cell becomes **selected** (blue ring) |
| cell selected | **Escape** | the cell selection becomes a **row selection** (row halo + row checkbox ticked + "1 selected" bar) |
| row selected | Escape | clears |
| cell selected | **Arrow keys** | move the selected cell (Down from Bravo/Amount → Alpha/Amount, then Right → Alpha/Stage, Up → Bravo/Stage, Left → Bravo/Amount) |
| cell selected | **Tab** | moves one cell right. At the last row Tab still moves right along the row |
| cell selected | **Shift+Tab** | extends the range one cell left (range Amount..Stage, anchor kept); it does not move the cell |
| cell selected | **Enter** | opens the editor of that cell (select: popover with search focused) |
| editing | **Enter** | commits and moves the selection **down one row** (select editor and text editor both) |
| editing in the **last row** | Enter | commits; the selection **stays** on the same cell. No new row is created |
| cell selected in the last row | ArrowDown | nothing (stays) |
| creating a row via "+ New page" and typing a title | Enter | commits the title; the title cell stays selected. No new row |
| cell selected | **typing a character** | opens the editor with that character replacing the value ("Z" replaced "short"; on a select it becomes the search text "S" with "Create S") |
| cell selected | **Backspace** | clears the cell; selection stays |
| cell selected | **Shift+Arrow** | extends a rectangular range. Anchor keeps the 2px ring + 0.07 fill; every other cell in the range gets only the fill `rgba(35,131,226,0.07)` (one overlay per run, no ring) (`shots-08/63-multi-cell-selection.png`) |
| range selected | Escape | becomes a row selection of every row in the range (2 halos for 2 rows) |
| range selected | **Cmd+C / Cmd+V** | **unmeasured**. Meta combos are not forwarded through the extension relay: Cmd+C fired no copy (`DataTransfer.setData` hook captured nothing) and Cmd+V changed nothing. `document.execCommand('copy')` also produced no `setData` call, so Notion's copy path likely uses the async Clipboard API (unverified) |

### Row ⋮⋮ menu (`shots-08/65-row-handle-menu.png`)

Hovering a row shows, left of the row: "+" (24×24, aria "Click to add below. Option-click to add a block above"), ⋮⋮ (18×24, aria "Drag to move, click to open menu", icon fill `rgb(173,169,163)`, cursor `grab`) and the row checkbox (16×16, border `1px solid rgba(27,21,0,0.19)`, radius 3px). Clicking ⋮⋮ also selects the row. Menu: search box "Search actions…", section "Page": Add to Favorites, Edit icon, Edit property ›; Open in ›; Comment (⌘⇧M); Copy link, Duplicate (⌘D), Move to (⌘⇧P), Move to Trash (Del); footer "Last edited by ⟨name⟩ / Today at 3:02 AM / 1 word, 5 characters".

The OPEN button on title hover now carries a side-peek icon before "OPEN" (`shots-08/35-row-hover-handles.png`).

### Column header menu (per type)

All start with the name field + icon. Rows below, in order:

| Type | Header menu |
|---|---|
| Title (Name) | Show page icon, AI Autofill, Filter, Sort, Group, Calculate, Freeze, Unwrap content, Insert left, Insert right (no Hide / Delete / Change type) |
| Text | Property access, Change type, AI Autofill, Filter, Sort, Group, Calculate, Freeze, Hide, Unwrap content, Insert left, Insert right, Duplicate property, Delete property |
| Number / Select / Multi-select / Date / Person / Relation | Edit property, Property access, Change type, AI Autofill, Filter, Sort, Group, Calculate, Freeze, Hide, Unwrap content, Insert left, Insert right, Duplicate property, Delete property (Relation: no Duplicate) |
| Status | as Select, plus "Display as: Select" |
| Checkbox | no Edit property, no Unwrap content |
| Files | no AI Autofill, no Group |
| Created time | no Property access, no AI Autofill |
| ID | Edit property, Filter, Sort, Calculate, Freeze, Hide, Unwrap content, Insert left/right, Delete property |
| Formula / Rollup | no AI Autofill |
| Button | Edit automation, Property access, Change type, Freeze, Hide, Insert left/right, Duplicate, Delete (no Filter / Sort / Calculate) |

"Edit property" for Number opens: Number format ›, Decimal places ›, "Show as" tiles Number / Bar / Ring, note "Changes apply to all views showing this property." The number-format list: Number, Number with separators, Percent, then 41 currencies (US Dollar … Bitcoin).

### "+" add-property flow

Header "+" (28×28, radius 6px, icon `rgb(142,139,134)`, `transition: background 0.1s ease-in-out`) puts a "Type property name…" field in the header and opens the type menu below it (400 wide). Typing names it; clicking a type creates it and closes the menu. Formula, Rollup and Button are created unconfigured; Relation opens "Related to" (Existing data sources / New database), then a "New relation" panel (Related to, Limit: No limit, Add related property toggle, "Add relation"). A self-relation is one property shown both ways (Bravo and Delta showed "Alpha" after relating Alpha to them).

### Calculation footer menu per type

| Type | Top level | Count › | Percent › | More options › / Date › |
|---|---|---|---|---|
| Title, Text, Select, Multi-select, Status, Person, Files, Relation, ID | None, Count, Percent | "Show large counts as 99+", Count all, Count values, Count unique values, Count empty, Count not empty | Percent empty, Percent not empty | — |
| Number, Formula (number), Rollup (number) | None, Count, Percent, **More options** | as above | as above | Sum, Average, Median, Min, Max, Range |
| Date, Created time | None, Count, Percent, **Date** | as above | as above | Earliest date, Latest date, Date range |
| Checkbox | None, Count, Percent | Count all, **Checked, Unchecked** | **Percent checked, Percent unchecked** | — |
| Button | (no Calculate) | | | |

The Count/Percent lists above are from Number and Checkbox; the other types were only read at the top level. Footer (Sum on Amount, `shots-08/66-calc-footer.png`): row 35px; label "SUM" 10px/15px weight 500 `uppercase`, `letter-spacing: 1px`, `rgb(161,158,153)`, `margin-right: 4px`; value 14px/21px `rgb(125,122,117)`; right-aligned (`justify-content: flex-end`) for numbers; inner box `padding: 0 6px`, `transition: background 0.2s`.

### Filter operators per type and advanced filter

| Type | Operators |
|---|---|
| Number | =, ≠, >, <, ≥, ≤, Is empty, Is not empty |
| Text | Is, Is not, Contains, Does not contain, Starts with, Ends with, Is empty, Is not empty |
| Select | Is, Is not, Is empty, Is not empty |
| Multi-select, Person | Contains, Does not contain, Is empty, Is not empty |
| Status | Is, Is not |
| Checkbox | Is, Is not |
| Files | Is empty, Is not empty |
| Date | default pill "Due: This week" (operator list not captured) |

Other types (URL, Relation, Created time, Created by, Formula, Rollup, ID) were not read: the filter bar overflowed and the script stopped finding the "+ Filter" button.

- Filter popover (simple): 220 wide, radius 10px, menu shadow. Header "⟨Prop⟩ ⟨op⟩ ⌄" + "⋯"; value input 196×28, `padding: 3px 6px`, radius 6px, bg `rgba(66,35,3,0.03)`, focus ring `rgb(35,131,226) 0 0 0 1px inset, rgb(35,131,226) 0 0 0 1px`.
- Filter pill, no value: 24px, `padding: 0 8px`, radius 32px, bg `rgba(33,27,23,0.05)`, text `rgb(125,122,117)`. With a value: bg `rgba(0, 124, 215, 0.094)`, text **blue** `rgb(39,131,222)` ("Attachment: Is not empty").
- Several filters: a horizontally scrolling pill row; "Edit filters" opens a "Filters" panel listing each filter with a ⋮⋮ reorder handle, plus "Add filter".
- Advanced filter ("Add filter" › "Add advanced filter"): a pill "N rules ⌄" and a panel: `Where [Name ⌄] [Contains ⌄] [Value] ⋯`, then "+ Add filter rule ⌄" (Add filter rule / Add filter group "A group to nest more filters") and "Delete filter". Second row starts with a conjunction: **And** "All filters must match" / **Or** "At least one filter must match" (`shots-08/75-advanced-filter-two-rules.png`).

### New row in a filtered view

Filters "Due: This week" and "Attachment: Is not empty" (zero rows, `shots-08/69-filter-pills.png`). The empty table shows **"Edit filters"** (28px, `padding: 0 8px`, `border: 1px solid rgba(28,19,1,0.11)`, radius 6px, 14px weight 500 `rgb(142,139,134)`) and **"+ New page"** centred under the header. Clicking "+ New page" opened the new row in a side peek (`&pm=s`) with **Due pre-filled to today (Oct 9, 2026)**, which satisfies "This week". Attachment cannot be pre-filled. After closing the peek the row is **not shown** (still zero rows), because it fails "Attachment is not empty".

### Conditional color (`shots-08/77…`, `78-conditional-color-rule.png`)

View settings › Conditional color: blurb "Customize page colors to easily distinguish categories, highlight overdue events, and bring clarity to your work." + "New color setting" → property list (excludes Files, URL, Email, Phone, ID, Button) → a rule card: "⟨Amount⟩ is not empty ⌄" + trash, "Page background: Green ›", "Apply to: Entire row ›", then "+ Add another". The rule painted every matching row's cells `rgb(232, 241, 236)` (opaque). Deleting the rule removed the tint.

### Load limit

View settings › Layout › Load limit: **10, 25, 50, 100** (board default 25).

### Open pages in

Side peek ("Open pages on the side. Keeps the view behind interactive.", "Default for Board"), Center peek ("Open pages in a focused, centered modal."), Full page ("Open pages in full page.").

## Static styles (light unless stated)

### Buttons and toolbar

| Item | Value |
|---|---|
| "New" split button (main part) | 45×28, `padding: 0 8px`, radius `6px 0 0 6px`, bg `rgb(39, 131, 222)`, text `rgb(243, 249, 253)` 14px/21px weight 500, `transition: background 0.02s ease-in`. Hover bg `color(srgb 0.122 0.464 0.801)` ≈ `rgb(31, 118, 204)` |
| "New" split button (chevron part) | 24×28, radius `0 6px 6px 0`, same bg, divider `box-shadow: rgba(28,19,1,0.11) 1px 0 0 0 inset` |
| Empty DB header "+ Add property" | 115.8×28, `padding: 0 6px`, radius 6px, gap 6px, 14px/16.8px `rgb(142,139,134)`, `transition: background 0.1s ease-in-out`. Once a property exists it becomes a 28×28 "+" plus a 28×28 "⋯" (`transition: background 0.02s ease-in`) |
| Table "+ New page" row (bottom) | 36px tall, `padding-left: 8px`, 14px/20px `rgb(161,158,153)`; 16px "+" icon `rgb(173,169,163)`, `margin: 0 7px 0 1px`. No hover background |
| Header cell hover | bg `rgba(33, 27, 23, 0.05)` (research/07 saw none on a read-only public page) |
| Table row hover | **no background**. Hover shows the left-gutter "+", ⋮⋮ and checkbox, and the OPEN button |
| Database title placeholder | "New database", gray, inline in the block header |
| Highlighted menu item | bg `rgba(33, 27, 23, 0.05)`, radius 6px, `transition: background 0.02s ease-in` |
| Menus (property type menu, cell popovers, view settings) | bg white, radius 10px (menus) / 6px (cell popovers), shadow `rgba(25,25,25,0.05) 0 20px 24px, rgba(25,25,25,0.027) 0 5px 8px, rgba(42,28,0,0.07) 0 0 0 1px`; section labels 12px/14.4px weight 500 `rgb(125,122,117)`; items 28px (single column) or 32px (two-column type grid), `padding: 0 8px`, gap 8px, 14px/16.8px |

### Cells (table, `shots-08/11-amount-values.png`)

| Type | Value |
|---|---|
| Number | **right-aligned** (`text-align: end`), 14px/21px ink, currency formatting "$1,200.00", "-$40.00" |
| ID | 14px/21px **`rgb(161, 158, 153)`** (tertiary), left-aligned |
| Date | "October 12, 2026" 14px/21px ink; created/edited time "October 9, 2026 2:35 AM" |
| Checkbox | 16×16 radius 3px; unchecked `1px solid rgba(27,21,0,0.19)`; checked bg `rgb(39,131,222)` + white 14px check, `transition: background 0.2s ease-out` |
| Person chip | avatar 20×20, `border-radius: 100%`, `outline: 1px solid rgba(42,28,0,0.07)`, name 14px/21px, 6px gap |
| File chip | 24px tall, `padding: 0 6px`, radius 4px, bg `rgba(42, 28, 0, 0.07)`, 14px/24px ink; 12×15 file icon `rgb(56,56,54)`; shows the URL text |
| URL / Email / Phone | 14px/21px ink, `text-decoration: none` on the `<a>`, `white-space: pre-wrap` |
| Button property | 24px, `padding: 0 6px`, `border: 1px solid rgba(28,19,1,0.11)`, radius 6px, 14px/16.8px weight 500 ink |
| Long text | wraps; the row grows (Alpha row 115px with 4 lines of tags) |

### Option colors, all 10 (select / multi-select pill, 20px, `padding: 0 6px`, radius 4px, 14px/20px weight 400)

| Color | Light bg | Light text | Dark bg | Dark text |
|---|---|---|---|---|
| default | `rgba(42, 28, 0, 0.07)` | `rgb(44, 44, 43)` | `rgba(255, 255, 243, 0.082)` | `rgb(240, 239, 237)` |
| gray | `rgba(28, 19, 1, 0.11)` | `rgb(73, 72, 70)` | `rgba(255, 252, 235, 0.306)` | `rgb(240, 239, 237)` |
| brown | `rgba(127, 51, 0, 0.157)` | `rgb(88, 68, 55)` | `rgba(255, 184, 132, 0.365)` | `rgb(245, 237, 233)` |
| orange | `rgba(196, 88, 0, 0.204)` | `rgb(106, 66, 34)` | `rgba(255, 143, 71, 0.482)` | `rgb(251, 235, 222)` |
| yellow | `rgba(209, 156, 0, 0.282)` | `rgb(101, 81, 33)` | `rgba(255, 188, 53, 0.46)` | `rgb(249, 243, 220)` |
| green | `rgba(0, 96, 38, 0.157)` | `rgb(42, 83, 60)` | `rgba(113, 255, 175, 0.337)` | `rgb(232, 241, 236)` |
| blue | `rgba(0, 118, 217, 0.204)` | `rgb(38, 74, 114)` | `rgba(81, 166, 255, 0.494)` | `rgb(229, 242, 252)` |
| purple | `rgba(92, 0, 163, 0.14)` | `rgb(85, 59, 105)` | `rgba(208, 147, 255, 0.427)` | `rgb(243, 235, 249)` |
| pink | `rgba(183, 0, 78, 0.153)` | `rgb(104, 53, 78)` | `rgba(255, 133, 192, 0.427)` | `rgb(250, 233, 241)` |
| red | `rgba(206, 24, 0, 0.165)` | `rgb(109, 53, 49)` | `rgba(255, 116, 105, 0.525)` | `rgb(252, 233, 231)` |

Option names were set to their colours through the option menu, so the mapping is verified (`shots-08/18-ten-colors-editor.png`). "Gray" equals research/07's colourless "Backlog" status. New options get a random colour. Light values match research/07 where they overlap.

Status pills: 20px, `padding: 0 9px 0 7px`, radius 10px, 8×8 dot. Not started = gray (`rgba(28,19,1,0.11)` / `rgb(73,72,70)`, dot `rgb(142,139,134)`), In progress = blue (dot `rgb(39,131,222)`), Done = green (dot `rgb(70,161,113)`). The status editor groups options under To-do / In progress / Complete (12px weight 500 `rgb(125,122,117)`) and ends with "Edit property".

### Cell editor popovers

| Editor | Value |
|---|---|
| Select / multi-select (search-or-create) | anchored at the cell's top-left, **300 wide** (cell is 200), radius 6px, menu shadow. Top: chips + input area bg `rgba(242, 241, 238, 0.6)`, `padding: 4px`, inset bottom line `rgba(28,19,1,0.11) 0 -1px 0 0 inset`; input 14px/20px. Hint "Select an option or create one" 12px/14.4px weight 500 `rgb(125,122,117)`. Typing an unknown name shows "Create ⟨pill⟩". Option rows 28px with a ⋮⋮ reorder handle and a "⋯" (24×24) that opens: name field, Delete, "Colors" list of 10. Multi-select chips carry an "×" |
| Date picker | 248×500, radius 6px. Text field "Oct 9, 2026" 14px/16.8px (focused + selected on open). Month "Oct 2026" 14px/21px weight 500; "Today" 20px, `padding: 0 8px`, radius 3px, 12px weight 500 `rgb(142,139,134)`; ‹ › arrows. Weekday header "Su…Sa" 12px/18px `rgb(139, 152, 152)`. Day button 28×28, radius 6px, 14px. **Selected day: bg `rgb(39,131,222)`, white text.** Hovered day: bg `rgba(35,131,226,0.15)` + `2px solid rgb(39,131,222)` border. Other-month days `rgb(139,152,152)`. Below: End date (toggle), Date format › "Full date", Include time (toggle), Remind › None, Clear, "Learn about reminders". Opening the picker does **not** write a value; Escape leaves the cell empty |
| Number | in-cell `<input>` holding the formatted value ("$35.50"); no popover |
| Person | 240 wide, radius 6px; hint "Select as many as you like"; rows avatar 20px + name; "Jack Uait (You)" listed first |
| Text | overlay contenteditable over the cell |
| Files | "Add a file or image" panel with tabs Upload / Link; Upload shows "Upload file" button + "or ⌘+V to paste an image" |

### Gallery / list / calendar / timeline / feed in a normal-width page (inline)

| View | Value |
|---|---|
| Gallery (`shots-08/79-gallery.png`) | `.notion-gallery-view` `padding: 0 275px` (so content aligns with the 720px text column), grid `338px 338px`, gap 16px, `padding: 16px 0 4px`. Card 338×184.8, radius 10px, card shadow, `transition: background 0.1s ease-out`. Empty cover 146.25 tall, bg `rgba(66,35,3,0.03)`, `padding: 8px 8px 0`, bottom `1px solid rgba(42,28,0,0.07)`. Title row 38.5 tall `padding: 8px 10px`, 15px/22.5px weight 500. Hover shows a 57×24 white action pill (Edit + ⋯) top-right with the OPEN-button shadow, `transition: opacity 0.2s` |
| List (`shots-08/81-list.png`) | `padding: 0 275px`; rows 30px, radius 5px, title 14px/21px weight 500. A new list view shows no properties by default |
| Calendar (`shots-08/82-calendar.png`) | grid 7 × ~99px columns at this width; event card: `<a>` 28px tall, `padding: 2px 0`, radius 6px, bg white, shadow `rgba(0,0,0,0.04) 0 2px 4px, rgba(42,28,0,0.07) 0 0 0 1px`, title **14px/21px weight 600**, `transition: background 0.02s ease-in`; hover bg `rgba(84, 72, 49, 0.08)`. "No date (2)" button in the toolbar (28px, `padding: 6px`, radius 6px, `rgb(142,139,134)`). "Manage in Calendar" outline button (24px, border `1px solid rgba(28,19,1,0.11)`, radius 6px, 14px weight 500). New calendar defaults: Show calendar by Due, Month, Show weekends, Center peek |
| Timeline (`shots-08/83-timeline.png`) | Month zoom: 40px per day; weekend columns bg `rgb(247, 247, 247)`; rows 36px; day labels 12px `rgb(161,158,153)`; today = red circle + red vertical line; "+ New" at the bottom-left; defaults: Show timeline by Due, Show table off, Side peek, load limit 50 |
| Feed (`shots-08/85-feed.png`) | one card per row, 692 wide, `padding: 16px`, radius **12px**, bg white, shadow `rgba(0,0,0,0.02) 0 12px 32px, rgba(0,0,0,0.05) 0 0 0 1px`; author 14px/21px weight 500 + relative time; title 26px/26px weight 600; reactions button and "Add a comment…" row. Defaults: Show author byline, Center peek, load limit 10 |
| Chart | **paywalled**: "Your workspace has already used its 1 free chart. Upgrade to get unlimited charts." with "Upgrade now" (`shots-08/84-chart.png`). Not clicked, not measured |
| Tab overflow | with more views than fit, tabs collapse into "N more…" which opens a searchable view list (each with ⋮⋮ and ⋯) plus "New view" / "New data source" |

### Side peek and center peek (light)

| Item | Value |
|---|---|
| Side peek | `.notion-peek-renderer` 756×717 at x=756 (half the viewport); inner panel bg white, shadow `rgba(25,25,25,0.027) 0 8px 12px, rgba(25,25,25,0.027) 0 2px 6px, rgba(42,28,0,0.07) 0 0 0 1px`, no radius; the page beside it stays interactive and narrows to 486px. Title H1 32px/38.4px weight 700, `padding: 0 8px`. Property rows 34px + 4px gap; label 14px/20px `rgb(125,122,117)` with a 16px icon; empty value "Empty" `rgb(161,158,153)`. The opened card gets a halo `rgba(35,131,226,0.024)` + `rgb(39,131,222) 0 0 0 1.5px inset`, radius 10px |
| Center peek | backdrop `rgba(15, 15, 15, 0.6)` full viewport; panel 960×573 at (276, 72), `margin: 0 204px`, radius 12px, same shadow; top bar 44px radius `12px 12px 0 0` |

### Dark mode (Settings › Preferences › Theme = Dark; restored to "Use system setting" afterwards)

| Item | Dark value |
|---|---|
| Page / header row bg | `rgb(25, 25, 25)`; header inset line `rgba(255, 255, 243, 0.082)`; header text `rgb(173, 169, 163)` |
| Cell border | `1px solid rgba(255, 255, 243, 0.082)` |
| Cell text / number | `rgb(240, 239, 237)` |
| Active tab | bg `rgba(255, 255, 255, 0.055)` |
| Calc footer | "SUM" `rgb(125,122,117)`, value `rgb(173,169,163)` |
| "New" button | unchanged: `rgb(39,131,222)` / `rgb(243,249,253)` |
| Menu | bg `rgb(37, 37, 37)`, radius 10px, shadow `rgb(56, 56, 54) 0 0 0 1px, rgba(25,25,25,0.2) 0 14px 28px -6px, rgba(25,25,25,0.118) 0 2px 4px -1px`; items `rgb(240,239,237)`; highlighted item `rgba(255, 255, 255, 0.055)` |
| Selection (cell / range / row) | **identical to light**: cell `rgba(35,131,226,0.07)` + `rgb(39,131,222) 0 0 0 2px inset`; range fill `rgba(35,131,226,0.07)`; row halo `rgba(35,131,226,0.14)`; fill handle bg `rgb(25,25,25)` + `2px solid rgb(39,131,222)` |
| Selection bar | bg `rgb(37,37,37)`, shadow `rgb(56,56,54) 0 0 0 1px, rgba(25,25,25,0.08) 0 4px 12px -2px`; "N selected" `rgb(39,131,222)` |
| Board column tints | yellow `rgba(255, 232, 48, 0.043)`, default / no-value `rgba(252, 252, 252, 0.03)`, pink `rgba(255, 78, 149, 0.055)` |
| Board card | default column: bg `rgb(32,32,32)`, shadow `rgba(25,25,25,0.08) 0 2px 4px, rgba(255,255,243,0.082) 0 0 0 1px`. Yellow column: bg `rgb(55, 51, 37)`, ring `rgba(255, 225, 117, 0.13) 0 0 0 1px` (read with the pointer away from the card) |
| Board count / "+ New page" | yellow `rgb(216,163,47)`; default `rgb(188, 186, 182)`; pink "+ New page" `rgb(219, 105, 153)`; "No Stage" label `rgb(240,239,237)` |
| Gallery card | bg `rgba(255, 255, 255, 0.055)`, shadow `rgba(25,25,25,0.08) 0 2px 4px, rgba(255,255,243,0.082) 0 0 0 1px`; empty cover `rgba(252,252,252,0.03)` |
| Pills | see the option colour table |

### Empty states

- Table with filters that match nothing: "Edit filters" + "+ New page" centred under the header row (measured above, `shots-08/69-filter-pills.png`).
- Chart: plan gate instead of a chart (see Chart row).
- A brand-new database shows three blank rows under the header with "+ New page" in the first (`shots-08/02-property-config-panel.png`).
- No-data empty states of Board, Gallery, List, Calendar, Timeline and Feed were **not** captured (see Still unmeasured).

## Account actions and cleanup

- One private top-level page was created from the sidebar "New page" › Page. It was never nested under another page. Another page ("Demo Page") was shown by Notion after trashing; nothing on it was clicked or edited.
- Person values used only the signed-in user. The Button property has no actions. Files used one embed link (no upload). The relation is a self-relation.
- Theme was switched from **"Use system setting"** to Dark for the dark pass and set back to **"Use system setting"** (read back from the dropdown).
- The scratch page was moved to Trash (page ⋯ › Move to Trash), then **permanently deleted** from the trashed page's banner ("Permanently delete" › confirm "Are you sure you want to permanently delete this page?"). Only that page was deleted; "Empty trash" was not used. Reloading its URL afterwards showed "This page was moved to Trash over 30 days ago and will be permanently deleted soon" with both buttons disabled and no content (`shots-08/96-scratch-gone.png`). The Trash list itself was not viewed: this sidebar has no Trash entry. (A workspace search for "Blok parity scratch" returned no match, but Notion search also hides trashed pages, so that is not proof of deletion.)
- The Chart view hit a free-plan limit. "Upgrade now" was not clicked.
- Screenshots show the user's sidebar (page titles). Two shots with extra account detail (settings, search results) were deleted.

## Still unmeasured

- **Cmd+C / Cmd+V over a cell range** and any Cmd shortcut (Cmd+A, Cmd+Z, Cmd+/). The extension relay does not forward Meta combos.
- No-data empty states of Board, Gallery, List, Calendar, Timeline, Feed.
- Chart view (paywalled in this workspace).
- Side peek in dark mode (the OPEN button did not appear on hover in the dark pass); dark calendar and timeline.
- Full-page open mode ("Open pages in: Full page") and its transition.
- Filter operators for URL, Email, Phone, Relation, Rollup, Formula, Created/Last edited time and by, ID; the Date operator list; the date filter's relative options.
- Conditional color sub-menus ("Page background" colours, "Apply to" options other than "Entire row").
- Group-by with Sub-group; hidden-groups column; "Load more groups" behaviour.
- Card drag between board columns inside a **sorted** board, and dragging a card onto the no-value column.
- Keyboard focus ring on cells (cells use the selection ring; no separate focus ring was seen) and on menu items after arrow navigation.
- Exact frame-by-frame sequences for menu open (only the transition definition was captured: 200 ms `ease`, scale 0.96 → 1, opacity 0 → 1) and for the side-peek open (rAF was starved between 63 ms and 350 ms while the peek mounted).
- Row height in a single-line table here was 37–38px (rows with one line), consistent with research/07; not re-measured per type.
- Mobile / narrow widths; RTL.
- Row selection by a direct click on the row checkbox (selection was reached via Escape, ⋮⋮ click and drag start).
- The **look** of the cell editing state: the text editor overlay's box, shadow, radius and whether it grows past the cell (behaviour recorded, styles not).
- Screenshot frame sequences at fixed intervals (the relay cannot time screenshots; motion is from `getAnimations()` keyframes and rAF samples, with rAF rect samples only for the side-peek open/close).
