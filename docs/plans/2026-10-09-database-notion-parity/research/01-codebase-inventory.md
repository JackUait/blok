# 01 — Blok database block: codebase inventory (as of 2026-10-09, HEAD 665c077a + uncommitted WIP)

Evidence rule: every claim cites `file:line` read in this session or a command run. Items marked **[code-derived, not run]** were traced in source but not executed in a browser or test. Items marked **unverified** were not traced at all.

Paths are relative to `/Users/jackuait/Packages/blok`. `db/` = `src/tools/database/`.

Last release tag: `v1.16.1` (`git tag --sort=-v:refname | head -1`). The only WIP touching the database surface is a one-line change in `src/shared/tool-descriptions/database.ts`: `+ inputFields: ['title']` (from `git diff`).

## 0. File map

| File | Lines | Role |
|---|---|---|
| db/index.ts | 1777 | `DatabaseTool`: orchestrator, view dispatch, row CRUD, rowPages migration |
| db/types.ts | 201 | Data model types, adapter, rowPages, config |
| db/database-model.ts | 336 | Schema, views, row projection, grouping, fractional positions, hydrate merge |
| db/database-board-view.ts | 388 | Board (kanban) renderer |
| db/database-list-view.ts | 356 | List renderer, flat or grouped |
| db/database-view.ts | 269 | **DEAD.** Old `DatabaseView`, imported only by `database-view.test.ts` and `database-view.mutants.test.ts` (grep). The only user of `KanbanColumnData`/`KanbanCardData` (types.ts:95-107). |
| db/database-view-renderer.ts | 25 | Renderer interface |
| db/database-tab-bar.ts | 660 | View tabs: switch, add, rename, duplicate, delete, reorder, overflow |
| db/database-view-popover.ts | 137 | "Add view" type picker (board, list) |
| db/database-property-type-popover.ts | 128 | Property-type picker (7 types) |
| db/database-column-controls.ts | 115 | Group (column) rename and delete |
| db/database-card-drawer.ts | 861 | Row "page" side panel |
| db/database-card-drag.ts | 314 | Board card drag |
| db/database-column-drag.ts | 271 | Board column reorder drag |
| db/database-list-row-drag.ts | 253 | List row reorder drag |
| db/database-keyboard.ts | 35 | Escape closes the drawer |
| db/database-backend-sync.ts | 244 | Adapter calls, 500 ms debounce, per-row write serialization |
| db/database-localization.ts | 124 | Localizes canonical default names |
| db/preview.ts | 85 | Toolbox hover previews |
| db/copy-ghost-radius.ts | 15 | Copies corner radii onto drag ghosts |
| src/tools/database-row/index.ts | 180 | `DatabaseRowTool`: invisible data-holder block |
| types/tools/database.d.ts, database-row.d.ts | 272 / 95 | Published types |
| src/styles/database.css | 1199 | All runtime styling |
| src/styles/block-preview/database.css | 441 | Toolbox preview animation |

## 1. Views

### 1.1 Declared vs rendered

- `ViewType = 'board' | 'table' | 'gallery' | 'list'` (types.ts:56; same in types/tools/database.d.ts:60; in the describe schema enum at src/shared/tool-descriptions/database.ts:61).
- Dispatch is in `renderActiveView` (index.ts:890-901): `if (viewConfig?.type === 'list') return renderListView(...)`, and **everything else goes to `renderBoardView`**.
- Effect on **table and gallery** [code-derived, not run]:
  - They render as a board grouped by `view.groupBy`.
  - `validate()` requires `groupBy` only for `type === 'board'` (index.ts:276-277). A table or gallery without `groupBy` is therefore valid data, but it renders an empty board: options are `[]` (index.ts:904-906). Its "+ Add column" does nothing (index.ts:1163-1165 returns when `groupBy` is undefined).
  - No tab icon: `VIEW_ICONS` has only board and list (tab-bar.ts:41-44).
  - Names are never localized: `localizeViewName` handles only board and list (localization.ts:96-116).
  - The add-view popover offers only board and list (view-popover.ts:15-18).
- **Toolbox:** two entries, "Database" and "Board" (index.ts:107-126). Neither carries `data`, and the toolbox activates with `toolButtonActivated(tool.name, toolboxItem.data)` (src/components/ui/toolbox.ts:1012). Both entries therefore insert the **same default**: schema Title + Status (Not started/gray, In progress/blue, Done/green) and one board view grouped by Status (model.ts:285-335).
- **Preview mismatch:** the "Database" toolbox preview draws a **Table** view with Name/Status/Date columns (preview.ts:29-49). That view does not exist at runtime.

### 1.2 Board view (`DatabaseBoardView`)

| Aspect | Today |
|---|---|
| Layout | Horizontal flex, `overflowX: auto`, `gap: 12px` (board-view.ts:49-58). Columns are 260 px fixed (`flex: 0 0 260px`, board-view.ts:163-164). The board area pads to the content width so it can scroll edge to edge (database.css:11-17). |
| Groups | One column per select option, sorted by `position`, plus "orphan" columns for row values the schema no longer has. Orphans are labelless, sort last, and are never written back (model.ts:121-143). |
| Column header | Pill (option color bg/text via `color-mix`, plus a dot), title, card count (board-view.ts:171-212). Column bg is `var(--blok-color-<c>-bg)` (board-view.ts:166-169). |
| Card content | **Title only** (board-view.ts:268-293). No property values, no cover, no icon. An empty title shows the placeholder `cardTitlePlaceholder` with `data-empty` (board-view.ts:285-291). |
| Card hover actions | Pencil (inline title rename) and "…" menu (board-view.ts:295-321). The menu has a single item, "Delete card" (index.ts:1054-1086). |
| Add row | "+ New page" button at each column foot (board-view.ts:234-260). It creates a row with `{title:'', groupBy: optionId}` (index.ts:1116-1157). |
| Add group | "+ Add column" button (board-view.ts:66-75). It appends a select option labelled `columnTitlePlaceholder` with **no color** (index.ts:1159-1189). |
| Group rename | Click the pill title to get an inline input. Local save on each keystroke, debounced backend persist (column-controls.ts:64-112; index.ts:1225-1243). |
| Group delete | `[data-blok-database-delete-column]` button on each header (column-controls.ts:52-62). **It deletes every row in that group** (index.ts:1565-1572). It refuses to delete the last option (index.ts:1561). |
| Group recolor | **None.** A test pins that `handleColumnRecolor` is undefined (test/unit/tools/database/database.test.ts:2196-2203). |
| Rows with empty group value | **Invisible.** `toGroupKey` maps null/undefined to `''` (model.ts:226-231), orphan options skip `''` (model.ts:141), and the board renders only options. There is no "No Status" column. [code-derived, not run] |
| Group by multiSelect | `getSelectOptions` accepts multiSelect (model.ts:123), but `toGroupKey` returns `''` for arrays (model.ts:230). Grouping by multiSelect would therefore hide every row. [code-derived, not run] |
| Hide group / collapse / aggregation | None (no code in board-view.ts). |
| Drag | Card drag: 2D, 10 px threshold. The target column is chosen by X only, and the slot by card midpoint Y. The ghost is a clone with `rotate(2deg) scale(1.02)` and opacity 0.85. The source fades to 0.4. A gap opens via `margin-top`/`padding-bottom` (card-drag.ts:3, 102-115, 149-186, 197-278). On drop, the group value is rewritten and the position is re-minted (index.ts:1438-1457). Column drag: horizontal only, RTL-aware midpoint, `rotate(1deg)` ghost, gap via `margin-inline-start` (column-drag.ts:97-109, 142-179, 193-256). Escape cancels both drags (card-drag.ts:129-133; column-drag.ts:123-127). |
| Keyboard | Only Escape, which closes the drawer (database-keyboard.ts:16-27; index.ts:1340-1352). Cards are `<div role=listitem>` with **no tabindex** (board-view.ts:268-279). They are not keyboard-reachable or openable. |
| a11y | Board `role=region`, aria-label `kanbanBoard` (board-view.ts:45-46). Column `role=group`, cards container `role=list` (board-view.ts:159, 219). |

### 1.3 List view (`DatabaseListView`)

| Aspect | Today |
|---|---|
| Layout | Vertical rows, padded to content width (database.css:820-826). |
| Row content | Title plus "badges" for `view.visibleProperties` (list-view.ts:203-252). Badge rendering (list-view.ts:277-337): **select** is a colored text pill. **checkbox** is a display-only ✓ glyph with sr-only text. **string/number** values print raw, which covers text, number, date, url and title-as-text. **multiSelect (array) and richText render nothing.** |
| Row controls | An "open" button (no handler of its own; the row click delegate catches it, index.ts:1030-1040) and a "×" delete button (list-view.ts:254-268; index.ts:1014-1027). |
| Grouping | Only when `view.groupBy` is set. No UI sets `groupBy` on a list: `addView` passes `groupBy` only for board (index.ts:757). Grouped sections have a ▼/▶ text toggle, dot, title and count. Collapse is DOM-only and not persisted (list-view.ts:81-155). |
| Add row | "+ New" at the end of a flat list, or per group (list-view.ts:68-72, 133, 343-355; index.ts:1088-1114). |
| Grouped add-row defect | `handleAddListRow` calls `view.appendRow(boardEl, row)` with the whole list wrapper (index.ts:1107). `appendRow` calls `container.insertBefore(rowEl, addRowBtn)`, where `addRowBtn = container.querySelector(...)` finds the first group's button (list-view.ts:160-168). That button's parent is a `groupEl`, not the wrapper (list-view.ts:150-151). Under the DOM spec this throws `NotFoundError`. By then the row block is already inserted (index.ts:1101-1106), so `syncCreateRow` (index.ts:1109) is skipped. No unit test covers grouped add-row through `DatabaseTool`: the list-view tests at database-list-view.test.ts:345-367 cover only flat `appendRow`. [code-derived, not run] |
| Drag | Vertical only, 10 px threshold, across the whole list (list-view-drag.ts:95-107, 208-223). A drop re-mints the position only (index.ts:1425-1436). **Dragging between groups does not change the group value.** |
| Keyboard | Same as board: Escape only. Rows have no tabindex (list-view.ts:203-209). |

## 2. Properties

`PropertyType = title | text | number | select | multiSelect | date | checkbox | url | richText` (types.ts:5). `PropertyConfig` is only `{ options: SelectOption[] }` (types.ts:14-18). There is no number format, date format, URL config or similar.

| Type | Board cell | List badge | Drawer value | Value editor | Config UI |
|---|---|---|---|---|---|
| title | card title (board-view.ts:270) | row title (list-view.ts:205) | drawer textarea (card-drawer.ts:252-271) | **yes**: card pencil, drawer title | n/a |
| text | — | raw string | `String(value)` (card-drawer.ts:689-691) | **no** | none |
| number | — | raw | String | **no** | none |
| select | column grouping only | colored pill | colored pill (card-drawer.ts:673-680) | **only by dragging a card between columns** (index.ts:1451) | options: add (as a column), rename, delete-with-rows, reorder. **No color picker.** |
| multiSelect | — | **nothing** | pills (card-drawer.ts:681-688) | **no** | none |
| date | — | raw string | String | **no** (no date picker anywhere) | none |
| checkbox | — | ✓ glyph (display only, list-view.ts:301-329) | `"true"`/`"false"` text | **no** | none |
| url | — | raw string | String | **no** | none |
| richText | — | nothing | not shown in props; used as the row **body** store (card-drawer.ts:616-619; index.ts:1271-1323) | via nested editor | none |

- **Title handling:** exactly one `title` property is required by `validate` (index.ts:273-274). It is found by `type === 'title'` (index.ts:544-546). The title is stored twice on each row: top-level `data.title` (merged per character by the CRDT) and the `properties[titleId]` mirror (database-row/index.ts:118-124). On load the mirror is healed from `title` (index.ts:359-370).
- **Property type popover** (property-type-popover.ts:25-33) offers 7 types: text, number, select, multiSelect, date, checkbox, url. It omits title and richText. Its only caller is the drawer's "+ Add a property" (card-drawer.ts:588-607).
  - The new property's name is hard-coded `'Property'` (index.ts:1326).
  - A select/multiSelect gets no options.
  - The popover is a hand-built portal `div` with an outside-mousedown close, not the shared `PopoverDesktop` (property-type-popover.ts:52-109).
- **Property rename / delete / type switch / reorder / hide:** **no UI or code path.**
  - `model.deleteProperty` (model.ts:75-77) and `sync.syncDeleteProperty` (backend-sync.ts:148-152) are never called from index.ts (grep).
  - There is no type-switch method anywhere.
  - `updateProperty` changes only `name` and `config` (model.ts:68-73), and index.ts only ever passes `config`.

## 3. Sorts, filters, groupBy, visibleProperties

- `SortConfig {propertyId, direction}` and `FilterConfig {propertyId, operator: string, value}` (types.ts:58-67).
- **No evaluator exists.** A grep for `.sorts|.filters|visibleProperties|operator` in db/ and database-row/ hits only model copy/init (model.ts:35, 155-166, 173, 333) and `duplicateView` copying (index.ts:777-779). A grep for `FilterConfig|SortConfig` across src/ and types/ hits only type declarations. Rows are always ordered by `position.localeCompare` (model.ts:85-87).
- **No UI** creates or edits sorts or filters. The tab context menu has only Rename, Duplicate and Delete (tab-bar.ts:294-326).
- Sorts and filters survive concurrent edits as data only. The tests "keeps both filters/sorts…" (concurrent-database-loss.test.ts, concurrent-database-loss-wave2.test.ts titles) cover CRDT merge, not application.
- **groupBy:** applied for board (index.ts:903-907) and for list when set (index.ts:928-944). It is set automatically to the first select property for a new board view (index.ts:752-758). No UI changes it.
- **visibleProperties:** read by the list view only (index.ts:941, 952). No UI sets it. The default is `[]` (model.ts:166, 333), so new list views show no badges.

## 4. View tabs (`DatabaseTabBar`)

| Capability | Today |
|---|---|
| Switch | Click, or Enter/Space. Roving keys through `rovingRadioGroup`; the exact keys come from the tab-bar.ts:103 comment ("Arrow/Home/End"), and the util itself was not read (**unverified**) (tab-bar.ts:118-124, 138-149, 281-283). Focus is handed back across the full bar rebuild (tab-bar.ts:28, 224-236). The bar carries `data-blok-keyboard-owner` (tab-bar.ts:105). |
| Create | "+" opens the view popover (board, list), then `addView` (tab-bar.ts:126-136, 386-403; index.ts:751-761). The default name is "Board" or "List". |
| Rename | Context menu or double-click, then inline input (tab-bar.ts:151-176, 355-384; index.ts:763-766). |
| Duplicate | Copies type, groupBy, sorts, filters and visibleProperties, and keeps the same name (index.ts:768-783). |
| Delete | Only when there is more than one view. If the active view is deleted, the neighbour becomes active (tab-bar.ts:291, 313-326; index.ts:785-810). There is no confirm. |
| Reorder | Pointer drag past 10 px, a ghost at opacity 0.7, drop by tab midpoint, using `generateKeyBetween` directly rather than the suffix-safe `positionBetween` (tab-bar.ts:20, 178-191, 543-602; index.ts:812-816). |
| Overflow | A ResizeObserver hides tabs that don't fit and shows a "N more…" button with a dropdown listing all views plus "+ New view" (tab-bar.ts:193-222, 405-541). |
| Single view | Tab bar hidden; "+" moved into the title row (index.ts:839-869). Pinned by database-single-view-tab-bar.spec.ts. |
| View settings menu | **None** (no layout, properties, group, sort or filter settings). |
| Change a view's type | **None.** `updateView` supports `type` (model.ts:173), but no caller passes it. |
| Read-only gating | Only the "+" is hidden (tab-bar.ts:134-136, 625-643). Context menu, double-click rename/duplicate/delete and drag-reorder have **no readOnly check** (tab-bar.ts:151-191, 288-345). [code-derived, not run] |

## 5. Row page / card drawer

- **What opens:** clicking a card or list row calls `handleRowClick` (index.ts:1042-1050, 1029-1040, 1581-1594), which opens `DatabaseCardDrawer.open(row)`. A second click on the open row is ignored.
- **Presentation:** **side peek only.**
  - The panel is `position: fixed; top:0; inset-inline-end:0; height:100%`, with `z-index: var(--blok-z-drawer)` (database.css:342-358).
  - It animates `width` from 0 to 45% over 200 ms ease (card-drawer.ts:296-305; database.css:357). Close animates back to 0px and removes the panel on `transitionend` (card-drawer.ts:417-425).
  - There is **no center-peek mode, no full-page mode, and no "open as page"**.
  - The class comment says it is a "flex sibling, taking layout space" (card-drawer.ts:78-81), but the CSS makes it a fixed overlay.
- **Contents:**
  1. Toolbar with a `»` close button (card-drawer.ts:227-244).
  2. Auto-growing title textarea; Enter is suppressed (card-drawer.ts:252-271).
  3. Properties panel, **read-only display** of every non-title, non-richText property (card-drawer.ts:579-696), plus "+ Add a property" (hard-coded English, card-drawer.ts:592).
  4. An `<hr>`.
  5. The body holder.
- **Body:**
  - **Legacy path:** a nested `new Blok({...toolsConfig, holder, data: description, tabSync:false})` (card-drawer.ts:788-843). It is saved as `OutputData` (HTML fields) into the first `richText` property, which is auto-created and named `cardDetails` when missing (index.ts:1271-1323). Each `onChange` saves the editor. Overlapping saves are coalesced: only the newest is written, once none are in flight (card-drawer.ts:818-842). Data is also saved on close or switch (card-drawer.ts:727-753).
  - **Host path:** with `config.rowPages`, the drawer looks the row up, migrates the legacy body (`copyFromLegacy`, `reconcileLegacy`), writes `pageId` to the row as a derived (non-undoable) change, and calls `rowPages.mount(pageId, holder)` (index.ts:588-674, 1596-1719; card-drawer.ts:765-786). While a lookup or copy is pending, the body is `inert` (card-drawer.ts:461-491). A mount failure shows `tools.stub.error` (card-drawer.ts:854-860).
- **Architecture conflict:** the row body is **not child blocks**. It is an `OutputData` blob in a property, or a host page. This contradicts the CLAUDE.md law "Page body IS blocks … stored as child blocks via `contentIds`". The database does not declare `childTools` (grep of index.ts statics shows only describe, toolbox, sanitize and isReadOnlySupported). The core statics list it as `acceptsChildren: true, ownsChildren: false, selfPlacesChildren: true` (src/shared/tool-descriptions/built-in-statics.ts:146-163). A non-row child would be silently left out of the view by `filter(child => child.name === 'database-row')` (index.ts:350). There is a separate guard in page transfer (src/view/page-transfer.ts:137).
- Switching rows while open swaps the content in place (card-drawer.ts:362-408). Undo, redo and peer changes resync the open row or close it (card-drawer.ts:498-551; index.ts:430-439). The drawer outlives view switches (index.ts:1248-1249).
- Closing: Escape (document listener, skipped inside the body editor), outside mousedown (except popovers and the tab bar), or the » button (card-drawer.ts:309-353).
- The nested editor opens no tab-sync channel (database-card-drawer-tab-sync.test.ts).

## 6. Selection, clipboard, undo, collab, read-only

- **Row multi-select / bulk actions:** none. There is no selection code in db/ (no handlers besides click, pointerdown and Escape: index.ts:966-1052, 1354-1404).
- **Copy/paste:** the database has no `pasteConfig`/`onPaste`. `conversion: {}` and `convertible: {export:false, import:false}` (built-in-statics.ts:146-163). HTML export renders the database and its rows "children only", with no table markup (src/view/emitters.ts:767-768; src/view/blocks-to-html.ts:226).
- **Undo/redo:** every row write is `block.call(...)` followed by `dispatchChange()` (index.ts:553-586, 676-686). The pageId writeback is `dispatchChange({derived:true})` (index.ts:657-659, 1712-1714). `DatabaseRowTool.setData` takes undo or peer data in place (database-row/index.ts:91-96). Row changes trigger a microtask re-projection that redraws, or retitles in place, and waits for an inline edit or drag to finish first (index.ts:389-458, 492-530). Pinned by e2e undo-audit/w4-database.spec.ts (W4D-1…3d).
  - Schema and view mutations (add column, rename option, add view…) change the model only. Whether they become undo steps depends on the saver diffing the block. Only the description-property creation calls `this.block.dispatchChange()` (index.ts:1284). **unverified**
- **Collab (yjs):**
  - Row titles are top-level for per-character merge (types.ts:42-50).
  - Append keys get a random digit suffix so peers never collide (model.ts:249-283).
  - `hydrate` merges backend snapshots by id, keeping locally minted ids (model.ts:193-212).
  - Orphan groups keep cards visible after a peer deletes their option (model.ts:130-143).
  - Unknown row keys are preserved for newer clients (database-row/index.ts:7-15).
  - Concurrent-loss suites cover schema, options, views, filters, sorts and row positions, using `DocumentStore` + `YBlockSerializer` (concurrent-database-loss*.test.ts imports). I did not trace the merge mechanism itself.
- **Read-only is not enforced after any rerender.** [code-derived, not run]
  - `render()` skips `attachViewListeners` and `initSubsystems` when read-only (index.ts:171-174).
  - `rerenderView` runs both **unconditionally** (index.ts:1774-1775), with no readOnly check in `initSubsystems` (index.ts:1196-1405).
  - Many paths call `rerenderView`: `rendered()` when rows arrive after `render()` (index.ts:236-238), `loadFromBackend` (index.ts:259), reprojection after undo, redo or a peer change (index.ts:509, 523), both drop handlers (index.ts:1433, 1453), and `setReadOnly` (index.ts:331).
  - So a read-only database likely gets live card/column/list drags (whose drops write row blocks) and drawer opening as soon as any of those fire. The drawer itself is rebuilt with `readOnly: true`.
  - Whether the very first paint stays inert is **unverified**. The read-only unit tests (database.test.ts:438, 2428, 2795-2965) assert hidden buttons and contenteditable state, not drag or open behaviour.
  - Renderers hide add/edit/delete buttons when `readOnly` (board-view.ts:66, 234, 295; list-view.ts:68, 133, 260).

## 7. Visual and motion

**Selectors:** 71 unique `[data-blok-database-*]` selectors in database.css (`grep -oE '\[data-blok-database-[a-z-]+' src/styles/database.css | sort -u | wc -l`). Families: board/column/card/cards/pill/dot/count; add-card/add-column/add-row/add-view; card-actions/edit-card/card-menu; drawer-*; list-*; tab-*, tab-overflow-*; view-option-*; property-type-*; title/title-row.
- `[data-blok-database-empty-placeholder]` (database.css:542-547) is **dead CSS**. No source writes it, and tests assert it is absent (database-board-view.test.ts:250-258).
- Many layout styles are **inline** in TS rather than in CSS (board-view.ts:47-58, 161-178, 220-224, 275-279; index.ts:143-145, 162-163, 184-190).

**Tokens:**
- Light values: `--blok-database-*` at src/styles/colors.css:160-185 (card bg/hover/shadow/border/active/placeholder, colored-overlay, column-bg, add-text/border/hover, delete text, drawer-border, tab bg/active/hover/text, popover bg/shadow/hover). Further light-section tokens at 321 and 338-341: card-actions-bg/-icon/-divider, card-menu-hover-bg, column-pill-text.
- Dark values: 629-653 and 746-756 sit inside `@media (prefers-color-scheme: dark)` (colors.css:569). 826-850 and 943-953 sit after `:where([data-blok-theme="dark"] [data-blok-top-layer])` (colors.css:769). The exact enclosing rule of each block was found by an awk scan for selector lines, not by reading every brace.
- Option colors: `--blok-color-<name>-bg/-text`.
- Radius: `--blok-radius-surface`, `--blok-radius-inner`, `--blok-radius-control-*`.
- Shadows: `--blok-shadow-drawer-side`, `--blok-shadow-tab-ghost`.

**Motion** (database.css line numbers):

| Element | Transition |
|---|---|
| card | bg/box-shadow/border/outline 150ms ease (73) |
| card displacement during drag | margin-top 200ms `cubic-bezier(0.25,0.1,0.25,1)` (104); cards container padding-bottom 200ms (108) |
| column reorder gap | margin-inline-start / padding-inline-end 200ms same curve (119, 123) |
| card actions reveal | opacity 120ms (137) |
| buttons, tabs, popover items | 80–130ms ease color/bg (163, 207, 252, 614, 648, 676, 710, 764, 781, 845, 917, 961, 990, 1020, 1037, 1104-1107, 1166, 1189) |
| drawer | width 200ms ease (357) |
| property popover | `blok-prop-popover-in` 120ms `cubic-bezier(0.16,1,0.3,1)` (1133; keyframes in src/styles/keyframes.css:107) |
| drag ghosts (inline TS) | card `rotate(2deg) scale(1.02)`, column `rotate(1deg) scale(1.02)`, opacity 0.85, fixed shadow `0 12px 28px rgba(0,0,0,.2), 0 4px 10px rgba(0,0,0,.1)` (card-drag.ts:157-164; column-drag.ts:150-157); tab ghost opacity 0.7 (tab-bar.ts:553-556) |

- **No `prefers-reduced-motion`** in database.css. Only the preview CSS has one (block-preview/database.css:245).
- The stale comment at database.css:5-9 says `rendered()` sets the initial scrollLeft. It does not (index.ts:229-243).

**Hover states:** card bg; card actions revealed on card hover (144); delete-column revealed on header hover (255); "+ add view" revealed on title-row or tab-bar hover (596, 658); list row bg plus open/delete reveal (854, 933, 964); group header (1023); scrollbar thumbs revealed on hover (26-44, 428-431).

**Icons:**
- Used: IconDatabase, IconBoard, IconTrash (index.ts:23); IconPlus, IconPencil, IconDotsHorizontal (board-view.ts:4); IconBoard, IconList, IconPencil, IconCopy, IconTrash, IconPlus (tab-bar.ts:3); IconText, IconHash, IconSelect, IconMultiSelect, IconCalendar, IconListChecklist, IconGlobe (property-type-popover.ts:2-10); IconChevronRight ×2 (card-drawer.ts:238); IconTable, IconCalendar (preview only, preview.ts:1).
- Text glyphs, not icons: ▼/▶ group toggle (list-view.ts:95, 140), × delete (list-view.ts:266), ✓ checkbox (list-view.ts:312).
- `IconGallery` is listed in the playground icon groups (index.html:3194) but no database code uses it.

## 8. Localization

- Namespace `tools.database.*`: 47 keys in src/components/i18n/locales/en.json (`grep -o … | sort -u | wc -l`).
  - **Defined but unused:** `tools.database.emptyColumn` (comm of used vs defined).
  - Used but undefined: none.
- Other keys used: toolbox `database`/`board` titleKeys and `toolbox.preview.database`/`toolbox.preview.board` (index.ts:111-123); `tools.stub.error` (index.ts:671, 1653; card-drawer.ts:858).
- Canonical default names are stored in English and localized only when they still equal the English default (localization.ts:18-124).
- **Hard-coded English:**
  - "+ Add a property" (card-drawer.ts:592)
  - "+ New view" (tab-bar.ts:501)
  - New property name "Property" (index.ts:1326)
  - Fallbacks such as "N more…" (tab-bar.ts:429)
  - Preview labels (preview.ts:33-83)

## 9. Test coverage map

| Source | Unit | Mutants | E2E |
|---|---|---|---|
| index.ts | database.test.ts (3150 lines; 30 describes), concurrent-row-body, row-page-migration, column-database-placement.characterization, tab-sync-dispatch-paths | — | undo-audit/w4-database; columns-blocks/database-in-column, database-drop-lifecycle-in-column; database-single-view-tab-bar |
| database-model | ✓ | ✓ | — |
| board-view | ✓ | ✓ | database-card-hover-actions, database-board-pill-width |
| list-view | ✓ | ✓ | — (no list e2e) |
| tab-bar | ✓ | ✓ | database-single-view-tab-bar |
| view-popover | ✓ | ✓ | — |
| property-type-popover | ✓ | ✓ | database-property-type-menu-anchor (1 parametrized test: "a type menu opened while the drawer slides in ends under the button (${direction})") |
| column-controls | ✓ | ✓ | database-pill-title-edit |
| card-drawer | ✓ + rich-text + tab-sync | ✓ | w4-database |
| card-drag / column-drag / list-row-drag | ✓ | ✓ | — |
| keyboard | ✓ | ✓ | — |
| backend-sync | ✓ | ✓ | — |
| database-view.ts (dead) | ✓ | ✓ | — |
| localization, preview, copy-ghost-radius | **no dedicated file** (grep for an import path found none); localization is touched indirectly in database.test.ts (16 i18n/locali mentions) | — | toolbox-preview.spec mentions database |
| database-row | test/unit/tools/database-row/database-row.test.ts | — | — |
| collab | concurrent-database-loss(.wave2).test.ts | — | — |
| CSS | test/unit/styles/database-property-type-icon, database-table-radius, database-content-max-width | — | rtl-*, content-max-width-honored, tools-axe, semantic-contracts mention database |

## 10. TODOs, dead and declared-but-unused surfaces, defects

- `grep TODO|FIXME|XXX|HACK` over db/, database-row/ and database.css: **none**.
- **Dead or unused:**
  - database-view.ts and the `KanbanColumnData`/`KanbanCardData` types.
  - `DatabaseColumnControls.makeEditable` (column-controls.ts:23-50; tests only).
  - `model.deleteProperty`, `sync.syncDeleteProperty`.
  - ViewType `table` and `gallery`.
  - `sorts`/`filters` (stored, never applied).
  - `visibleProperties` has no setter UI.
  - `updateView({type|groupBy|sorts|filters|visibleProperties})` paths have no callers.
  - i18n `emptyColumn`.
  - CSS `[data-blok-database-empty-placeholder]`.
  - `onClose` no-op (index.ts:1324).
- **Type drift:** the published `DatabaseData` (types/tools/database.d.ts:90-94) **lacks `title?`**, which src types.ts:87 and the describe schema (tool-descriptions/database.ts:9) both carry.
- **Agent surface:** the describe guidance names `database.addRow`, `database.setRowValues` and `database.*` actions (tool-descriptions/database.ts:98; database-row.ts:25). A grep of src/ finds no implementation. `inputFields: ['title']` is uncommitted WIP from another session.
- **Defects** [code-derived, not run]:
  1. Grouped-list add-row `insertBefore` throws (§1.3).
  2. Read-only interactivity is re-wired on every rerender path (§6).
  3. Tab menu and drag not read-only gated (§4).
  4. Rename of an untitled card pre-fills the placeholder text. `currentValue` is the title div's `textContent`, which equals `cardTitlePlaceholder` (board-view.ts:288, 337). `input.value = currentValue`, and an empty commit falls back to `currentValue` (src/components/utils/inline-rename.ts:22, 57). The restored div lacks `data-placeholder` (board-view.ts:339-346), so the placeholder then looks like a real title.
  5. Deleting a group deletes its rows, with no confirm (index.ts:1565-1572).
  6. The new column gets no color (index.ts:1177-1181).
- **Playground fixtures are malformed** (index.html:3582-3625):
  - The title property is `type:'text'`, so there is no title property: `titlePropertyId()` returns `''` and every card/row shows the placeholder.
  - Select options sit at `options[]` with `name`, not `config.options[].label`.
  - Views lack `position`, and rows lack `position` (so they default to `'a0'`, database-row/index.ts:20).
  - Board state: `getSelectOptions('status')` returns `[]` plus orphan options for `todo`/`doing`/`done`, so it should render **three labelless, uncolored columns**.
  - List state: shows the real title only as a text badge (title is a `text` property listed in `visibleProperties`), and the status badge is null.
  - `validate()` is false for all three states (index.ts:272-278). The saver drops an invalid root block **only when it has no children** (src/components/modules/saver.ts:1164-1169), so "Empty database" is dropped on save and the others are kept.
  - All of the above is [code-derived, not run].
