# Database → Notion parity: spec, gap analysis and roadmap

Date: 2026-10-09. Base: `main` at `665c077a`, last release `v1.16.1`.

This is the umbrella document. It says what "match Notion" means here, what Blok has today, what is missing, and the order to build it in. Each phase gets its own implementation plan in this folder. Only Phase 0 is written out to task level so far (`01-phase-0-foundations.md`). Later phases get their own plans when they start, because each one depends on decisions made in the phases before it.

## Evidence

Every Notion claim below traces to a report in `research/`. Each claim in those reports cites a notion.com or developers.notion.com URL that was fetched on 2026-10-09. Every Blok claim cites `file:line`.

| Report | Covers |
|---|---|
| `research/01-codebase-inventory.md` | What the database does today, with defects |
| `research/02-architecture-constraints.md` | CRDT mapping, undo, backend, public surface, core levers |
| `research/03-notion-views.md` | Every Notion view layout, view tabs, data sources, limits |
| `research/04-notion-properties.md` | Every property type, config, operators, calculations |
| `research/05-notion-filter-sort-group-settings.md` | Filters, sorts, groups, the settings menu, templates, buttons, automations, bulk actions |
| `research/06-notion-row-page-interactions.md` | Peek modes, row page layout, table and board interactions, shortcuts |
| `research/07-notion-live-measurements.md` | Computed styles measured on public Notion pages, light and partly dark |
| `research/08-notion-signed-in-measurements.md` | Signed-in measurement: motion, editing states, keyboard model, menus, decision answers |

**Look: partly measured. Motion: not measured.** Notion's docs give no pixel values, durations or easings. `research/07-notion-live-measurements.md` holds computed-style reads from five public `*.notion.site` pages (screenshots in `research/shots/`, kept local and not committed). Cloudflare challenged rapid loads, so the agent spaced loads 30–45 s apart and never bypassed the challenge. Measured:
- The view tab pill (32px, gray active fill, no underline).
- The table: 36px header, 37px single-line rows, 1px right and bottom lines, no row hover fill.
- Pills: 20px, 4px radius; status pills have a 10px radius and a dot. Light colors for 9 option colors, dark for 6.
- The board: 276px columns, 12px gap, 10px card radius, 3-layer shadow.
- The gallery: 296px cards, 146px covers.
- The list: 30px rows.
- Calendar and timeline chrome.
- The center peek: 960×756, 12px radius, 60% backdrop.

Still unmeasured:
- The "+ New" button.
- Number alignment.
- Calendar event cards.
- An open side peek.
- An inline database in a normal-width page.
- Dark purple, pink and red.
- Every animation.
- Every editing interaction, because public pages are read-only.

Those need **Task M** in a signed-in workspace, which needs the user's go-ahead (decision D1). No phase may invent a Notion pixel value: use a measured one, or Blok's existing token labelled "unmeasured".

Items the research could not confirm are listed in each report's "unverified" section. The ones that affect the design are restated here as decisions or as "unverified".

## Where Blok stands (summary of `research/01`)

The database looks further along than it is.

- **Views.** Only Board and List render. `table` and `gallery` are in the type union but fall through to the board renderer (`src/tools/database/index.ts:896-900`). The toolbox preview draws a table that does not exist.
- **Properties.** Nine types exist. Only the title and the board's group value can be edited as row values. Board column headers can add, rename, delete and reorder select options, but not recolor them. A property cannot be renamed, deleted, retyped, hidden or reordered. New properties are named `'Property'` in hard-coded English (`index.ts:1326`).
- **Filters and sorts.** They are saved but never applied, and no UI creates them. `visibleProperties` and `groupBy` have no settings UI. There is no view settings menu.
- **Row page.** There is a side drawer only. Properties in it are read-only. The body is either an `OutputData` blob in a `richText` property or a host page mounted through `rowPages`. Neither form is child blocks, which breaks the "Page body IS blocks" law in CLAUDE.md.
- **Defects** (code-derived, see `research/01` §10):
  - Read-only is re-wired on every rerender.
  - Adding a row in a grouped list throws.
  - The tab bar's menu and drag ignore read-only.
  - Renaming an untitled card pre-fills the placeholder text.
  - Deleting a column deletes its rows without asking.
  - Rows with an empty group value are invisible.
  - Grouping by multi-select hides every row.
  - The playground fixtures are malformed.
- **Keyboard.** Cards and rows are not focusable, and Escape is the only key they handle. The tab bar handles Arrow, Home, End, Enter and Space.

## Constraints every phase carries (summary of `research/02`)

1. **Everything is a block.** Rows stay `database-row` children. Property values stay in `data.properties`. Views and schema stay in the database block's `data`. Relations and rollups store row ids; they never build a parallel model. Sub-items are `parentId` links between row blocks.
2. **CRDT shape.**
   - Every new list of objects carries a unique string `id`, so it merges by identity (`src/components/modules/yjs/serializer.ts:673-713`).
   - Lists that start empty and that two peers grow need an eager birth, both in `EAGER_ARRAY_KEYS` (`serializer.ts:78`) and in C# `OrderedIdArrayKeys` (`packages/server/dotnet/Blok.Server/Collab/YDocConverter.cs:124`).
   - Primitive arrays are last-writer-wins. Values two people edit at once (people lists, file lists, relation ids) are stored as id-bearing objects.
   - No representation may depend on a property's type (`serializer.ts:24-41`).
   - Each new field gets a concurrent-loss test pair, in TS and in `YDocConverter`.
3. **Old clients.**
   - A v1.16.1 database tool drops unknown **top-level** keys on save (`database-model.ts:216-222`). It keeps unknown fields **inside** property and view objects, but NOT inside a property's `config`: `updateProperty` replaces `config` whole (`database-model.ts:72`), so any old-client column add, rename, delete or reorder drops a new key stored beside `options`. New state therefore goes on the view or property object itself, never in `config`, or waits for Phase 0's forward-compat fix (which must cover `config` too) to ship and age.
   - A new view type opens as a board on old clients.
   - A new property type whose value is an object or array shows nothing in an old drawer.
4. **Breaking surfaces.** All of these shipped in v1.16.1, so changing them is BREAKING under CLAUDE.md:
   - `types/tools/database.d.ts` and `types/tools/database-row.d.ts`.
   - The `DatabaseAdapter` signatures.
   - The published `blokDocumentSchema`. It is strict: `additionalProperties:false` and closed enums.
   - 80 `data-blok-database-*` attributes.
   - 30 `--blok-database-*` CSS variables.

   One consequence: **any new property type, new view type outside the shipped enum, or new view field makes new documents fail validators that consumers already have.** `table` and `gallery` are already legal view types in the shipped schema, and filter `operator`/`value` and option `color` are open. Additions are therefore grouped into labelled release windows (decision D2).
5. **Undo.** Changes go through `dispatchChange`. Computed or host values (formula caches, created-time stamps) use `{derived:true}`. The database tool has no `setData`, so every peer or undo change rebuilds the whole block. That gets expensive once a table holds hundreds of editable cells, and Phase 1 must address it.
6. **Scale.** Every row is in memory. The architecture doc (`docs/plans/2026-08-22-database-block-architecture.md`) fixed the query shape `queryRows({view, group?, cursor?, limit?})` / `queryGroups(view)` but never built it. Phase 0 builds it in memory, so every later view is written against the query shape rather than against `getOrderedRows()`.
7. **UI laws.**
   - No blue selected states (`--blok-icon-active-*` tokens).
   - Hints show only on hover, after a delay (`tooltip.ts`).
   - No focus ring on click.
   - Reuse icons before drawing new ones; no inline `<svg>`.
   - `PopoverDesktop` for menus. `data-blok-keyboard-owner` for grids and editors that own their keys.
   - RTL laws, `prefers-reduced-motion`, and every string through `tools.database.*` i18n (blok-translations skill).
8. **Parallel surfaces that must move together:**
   - `src/shared/tool-descriptions/database*.ts`, which feeds the published JSON schema and the agent manifest. Another session has uncommitted WIP in this file; coordinate before editing it.
   - The C# `YDocConverter` rules.
   - `index.html` playground fixtures.
   - The docs site.

## Decisions the user owns

These are conflicts or trade-offs the research turned up. Each has a recommendation, but the plan does not settle any of them on the user's behalf.

| # | Decision | Recommendation |
|---|---|---|
| D1 | Measure Notion's look and motion in the user's **signed-in** Notion (playwright-cli `--extension`). This touches their account: it would create a scratch workspace page with one database per layout, then read computed styles and record frames. | Yes. Use a throwaway page and delete it afterwards. Without this, "looks and animates like Notion" cannot be verified. |
| D2 | **Release windows for breaking shape changes.** Every new property type, view type and view field breaks strict schema validators. | Group them: a v2 data-shape window at Phase 1 (table and property configs) and another at Phase 3 (filter tree). Each gets a `BREAKING` commit with a migration note. Read-time migration keeps old documents loading. |
| D3 | **Selected cells and rows.** Notion's selection color is not documented anywhere fetched (unverified, measure in Task M). If it is blue, it conflicts with Blok's law against blue selected states. | Keep Blok's law: gray fill and primary ink. Blue stays for the focus ring after keyboard navigation only. |
| D4 | **Personal vs shared view edits.** In Notion, filter and sort edits are personal until "Save for everyone", and the tab display style is personal. Blok has no per-user document state today. Whether switching tabs is a shared, undoable edit is unverified (`w4-database.spec.ts:326` asserts it is). | Phase 3 adds a host-provided per-user view-state lever with a local fallback. The shared document keeps the saved view. Run the w4 spec first to settle the current behaviour. |
| D5 | **Row body as child blocks.** CLAUDE.md says a page body IS blocks, but the shipped row body is a blob or a host page. | Phase 4 moves new bodies to child blocks of the row, with read-time migration from the blob. Hosts that use `rowPages` keep their path. The change is BREAKING for consumers who read `properties[cardDetails]`. |
| D6 | **What Blok will not build, or will only expose as host hooks.** Candidates: Automations, Forms (public submission), Map (geocoding), Dashboard, AI Autofill, Verification, row/property permissions, Notion Calendar sync, multi-source databases. | Tier 3 below: hooks and data shape only, with no built-in service. |
| D7 | **Manual order while sorted** (unverified in Notion). | Hide the drag handle inside a sorted view, and keep dragging between groups, which only changes the group value. Re-check during Task M. |
| D8 | **Empty values in sorts** (unverified in Notion). | Empty values go last in both directions. Re-check during Task M. |
| D9 | **Deleting a group option.** Today it deletes every row in the group. Changing that is **BREAKING**: it shipped in v1.16.1, and adapters would receive `updateRow` instead of `deleteRow`. | Rows lose the value and move to the "No ⟨property⟩" group. Never delete rows without a confirm. The non-breaking alternative keeps deleting rows, but behind a confirm. Re-check Notion's behaviour during Task M. |
| D10 | **Published `DatabaseData.title?: string`.** The published type is missing it (it is typed `unknown` through the index signature). Adding it is **BREAKING** for consumers who type a non-string title: `title: 42` and `extends DatabaseData { title: number }` stop compiling, as do some `exactOptionalPropertyTypes` cases. Every shipped runtime already saves a string. | Add `title?: string` and label it BREAKING. `title?: unknown` would avoid the break but leave the type wrong. |


### Decision outcomes (2026-10-09)

The user approved the recommendations ("go ahead, do whatever you need"). Task M (`research/08`) then measured what Notion actually does, and it changed three of them:
- **D3: Notion is blue.**
  - A selected cell has a `rgba(35,131,226,0.07)` fill and a 2px `rgb(39,131,222)` ring. A selected row has a `0.14` fill.
  - Blok's "no blue selected states" law (CLAUDE.md) wins, so Blok uses a gray fill and primary ink. This is a deliberate divergence, documented as such.
  - Drop lines and the focus ring after keyboard navigation are not selected states. They keep Notion's blue through `--blok-focus-ring`-family tokens.
- **D7: Notion prompts.** When you drop a row in a sorted view, Notion asks "Would you like to remove sorting?".
  - "Don't remove" discards the drop.
  - "Remove" deletes the sorts, keeps the sorted order as the manual order, and places the row where it was dropped.
  - Phase 0 shipped a simpler gate (drag off within a sorted group). **Phase 1 replaces it with the prompt.**
- **D8: confirmed.** Empty values go last in both directions. Equal values keep their manual order. Select sorts by option order.
- **D9: confirmed, plus a confirm step.** Deleting an option asks first, then keeps the rows with their value cleared, in the "No ⟨property⟩" group. A separate column-menu action, "Move to Trash", deletes the rows, with its own confirm.
  - Phase 0's C3 matches the data result. **Phase 1 adds both confirms and the Move-to-Trash action.**
- **Other measured facts that override the roadmap's assumptions:**
  - Clicking a cell opens its editor at once. Escape then selects the cell, and a second Escape selects the row.
  - Enter commits and moves down a row. In the last row it never creates a row.
  - **On a select board the no-value group comes LAST**, after every option column, and a group added later goes after it. Phase 0 put it first, so **Phase 1 moves it**. When grouping by number, text or date, "No ⟨prop⟩" is listed first.
  - Multi-select board columns come out alphabetical. With more than 10 groups, a "Load more groups" button appears.
  - Center peek and the cell editors have no open animation.
  - Side peek slides with `translateX` over 200ms `ease` and takes half the viewport. The page beside it narrows over the same 200ms.
  - Menus fade and scale from 0.96 over 200ms `ease`.
  - The card and row drag ghost is `opacity:0.4`, with no rotation or shadow. The drop line is 4px, `rgba(35,131,226,0.43)`.
  - Group collapse rotates only the caret: 200ms `ease-out`, with no height animation.
  - The load limit offers 10/25/50/100. The board default is 25.
  - Only checkbox has Checked, Unchecked and the matching percents in the footer.

## Gap matrix

Legend: ✅ have · 🟡 partial · ❌ missing. P = phase. T3 = tier 3 (hooks only, see D6).

### Views

| Notion | Blok | P |
|---|---|---|
| Table: columns, resize (auto-fit on double-click), reorder, freeze, wrap per column and for all, vertical lines, calculation footer, OPEN on hover, row ⋮⋮ handle and menu, + New, load limit (10/25/50/100 per the 2020 release note; current values unverified) | ❌ (falls through to board) | 1 |
| Board: group by select/status/person/relation/checkbox…, sub-groups, hide group, Hidden groups area, color columns toggle, column calculation, card properties, card size, card preview (cover/content/files), fit image, wrap properties, inline edit on card | 🟡 select grouping, drag, title only, no recolor, empty group invisible | 0 (bugs), 5 |
| List: properties on the right, inline edit, Tab between properties, Shift+Enter new item, groups | 🟡 badges, no editing; renders groups with collapse, but no UI sets `groupBy` | 1, 3 |
| Gallery: card grid, card size, preview, fit image, hide name, groups | ❌ | 5 |
| Calendar: month/week, show by date property, weekends toggle, drag to move, drag edge to span, + on day, Today and arrows | ❌ (no date picker either) | 5 |
| Timeline: zoom hours→5 years, start/end properties, Today, off-screen arrows, resize and move bars, table panel, dependency arrows | ❌ | 5 |
| Chart: bar/column/line/donut/number, axes, styles, drilldown, export | ❌ | 6 |
| Feed | ❌ | 6 |
| Map, Form, Dashboard | ❌ | T3 |
| View tabs: add, rename, duplicate, delete, reorder, overflow "N more", display as icon/text, copy link | 🟡 everything except display mode and copy link; read-only gaps | 0, 3 |
| Change a view's layout | ❌ (`updateView` supports `type`, no caller) | 3 |
| Linked views and data sources | ❌ | 6 (in-document), T3 (cross-document) |

### Properties

| Notion type | Blok | P |
|---|---|---|
| Title | ✅ (CRDT-merged) | — |
| Text | 🟡 display only | 1 |
| Number + 45 formats + bar display (ring unverified on the live page) | 🟡 raw display | 1 (edit), 2 (formats) |
| Select / Multi-select: search-or-create, 10 colors, option menu (rename, color, delete), drag-reorder options, sort by option order | 🟡 board column headers add, rename, delete and reorder options; no value editor, no color UI | 1 |
| Status: groups To-do / In progress / Complete, show as checkbox | ❌ | 2 |
| Date: picker, range, include time, formats, time zone, reminders | 🟡 raw string, no picker | 1 (picker), 2 (formats, range, tz) |
| Checkbox | 🟡 display only | 1 |
| URL / Email / Phone | 🟡 URL display only | 1 (URL), 2 |
| Person | ❌ needs a host directory lever | 2 |
| Files & media | ❌ reuse `asset-uploader` | 2 |
| Created/Last edited time/by | ❌ `lastEditedAt/By` exist on blocks; no created stamps | 2 |
| ID (prefix + auto-increment) | ❌ | 2 |
| Formula 2.0 | ❌ needs an evaluator (subproject) | 6 |
| Relation (one-/two-way, limit 1) and Rollup (24 functions) | ❌ in-document first | 6 |
| Button | ❌ | 6 |
| Verification, Place, AI Autofill | ❌ | T3 |
| Property actions: rename, change type (value conversion), duplicate, delete, hide, insert left/right, wrap, freeze, description, icon, page visibility (always/hide when empty/hide) | ❌ | 1 (header menu), 2 (type change, description, icon, visibility) |

### Data operations

| Notion | Blok | P |
|---|---|---|
| Filter evaluation | ❌ stored only | **0** |
| Sort evaluation (multiple, option-order for select) | ❌ stored only | **0** |
| Grouping: empty-value group, multi-select, status group/option, date day/week/month/year/relative, number ranges, text exact/first letter, hide empty, group sort, collapse (persisted) | 🟡 select only, collapse not persisted | 0 (empty, multi-select), 3 |
| Filter UI: simple pills, advanced AND/OR up to 3 levels, relative dates, "Me" | ❌ | 3 |
| Sort UI with drag order | ❌ | 3 |
| Search in view (≥3 rows) | ❌ | 3 |
| Calculations (count all/values/unique/empty/not empty/percents, sum/avg/median/min/max/range, earliest/latest/date range; checked/unchecked appear only in the API enums, unverified for the footer) | ❌ | 1 (footer), 3 (board header) |
| Conditional color (per view, row or cell in table) | ❌ | 3 |
| Selection, bulk edit (Cmd/Ctrl+/), bulk delete/duplicate | ❌ | 4 |
| Cell copy/paste, paste one value into many cells, fill right/down (Cmd+R/D), fill handle | ❌ | 4 |
| CSV import/export, merge with CSV, paste a table into a database | ❌ | 6 |
| Lock database / lock views | ❌ | 3 |
| Templates (default, per-row, repeat) | ❌ | 6 |
| Sub-items and dependencies | ❌ | 6 |
| Load limit / load more | ❌ | 1 |

### Row page

| Notion | Blok | P |
|---|---|---|
| Open in side peek / center peek / full page, per view; defaults by layout | 🟡 side drawer only | 4 |
| Previous/next row in peek (Ctrl+Shift+K/J on Mac, Ctrl+K/J elsewhere; 🔼🔽 buttons) | ❌ | 4 |
| Expand peek to full page (⤡) | ❌ | 4 |
| Editable properties panel, "+ Add a property", hide empty | 🟡 values read-only; "+ Add a property" exists (hard-coded English, name 'Property') | 1 (editors reused), 4 |
| Page layouts (pinned properties in the heading, sections, details panel, tabs) | ❌ | 6 |
| Icon and cover on row pages, page icon in views | ❌ | 4 |
| Body as child blocks | ❌ (D5) | 4 |
| Comments on rows and cells | ❌ | T3 |

### Interaction, keyboard and a11y

| Notion | Blok | P |
|---|---|---|
| Keyboard reachability of cards and rows; table cell navigation | ❌ | 1 (table), 5 (cards) |
| Esc deletes an accidental empty new row | ❌ | 1 |
| + New focuses the new row's title | ❌ likely (neither add-row handler focuses, `index.ts:1088-1157`; not run) | 1 |
| Ctrl/Cmd+Alt+T toggles all groups | ❌ | 3 |
| `prefers-reduced-motion` | ❌ in database.css | 0 |

### Look and motion

| Item | Blok | P |
|---|---|---|
| Measured Notion values: row and header heights, paddings, fonts, borders, pill colors, card shadows, peek size | static look measured (`research/07`); gaps and all motion need Task M (D1) | M |
| Token pass that maps the measurements onto `--blok-database-*` (new tokens are additive) | — | after M |
| Motion: peek slide, card drag ghost, menu open, group collapse | Blok has its own curves (`research/01` §7) | after M |

## Roadmap

Each phase ships on its own and leaves `main` green. Every task is TDD, as the repo's CLAUDE.md requires.

### Phase 0: Foundations and correctness (`01-phase-0-foundations.md`, detailed)
Fix the shipped defects, make saves forward-compatible, and build the in-memory query engine that every later view consumes.
- No saved-data shape changes.
- Two tasks are BREAKING, and each is gated on a user decision: C3 (deleting a column keeps its rows, D9) and E2 (published `DatabaseData.title?: string`, D10).
- One new behaviour (F2): rows created in a filtered view inherit the filter's `equals` values, as in Notion.

### Task M: Finish measuring Notion (needs D1)
`research/07` already covers static look on public pages. Task M fills the gaps it lists, in a signed-in workspace, on one scratch page:
- Build one inline database per layout in a normal-width page.
- Record the remaining styles: + New, number cells, calendar events, side peek, dark purple/pink/red.
- Record selected and editing states, including the selection color that D3 depends on.
- Record the peek open and close, the drag ghosts, menu open and group collapse, frame by frame. Read durations and easings from `getAnimations()` and the computed `transition` values.
- Settle the unverified behaviours: D7, D8, D9, the cell keyboard model, the row ⋮⋮ menu, and empty states.

Output: `research/08-notion-signed-in-measurements.md`. Delete the scratch page afterwards.

### Phase 1: Table view and the cell-editing core (breaking window A)
- Table renderer written against the query engine.
- The toolbox "Database" entry inserts a table view, as Notion does for new databases (`research/03` §1.1). Today it inserts the same board as the "Board" entry, while its preview draws a table.
- Column header menu: rename, hide, insert left/right, wrap, freeze, sort, filter, calculate, delete.
- Resize with auto-fit, column reorder, vertical-lines toggle.
- Calculation footer and load limit.
- Row ⋮⋮ handle and menu, OPEN on hover, + New.
- Grid keyboard model (decided by Task M) under `data-blok-keyboard-owner`.
- Cell editors, reused by board, list and the drawer: text, number, select/multi-select (search-or-create, colors, option menu), checkbox, URL, and a new date picker.
- Option recolor.
- Shape additions, all optional: per-view property settings `{propertyId, visible, width, wrap}`, `wrapCells`, `frozenColumnIndex`, `showVerticalLines`, `loadLimit`, `calculations`.
- Add `setData` to the database tool so a remote edit to one cell doesn't rebuild the block.

### Phase 2: Property system
- Change type, with conversion rules decided per pair and tested.
- Duplicate, description, icon, and page visibility per property.
- New types: Status (with groups), Email, Phone, Files (`asset-uploader`), Person (a new `config.people` host lever: directory + `me`), Created/Last edited time/by (row-block metadata, written with `{derived:true}`), ID.
- Number formats (45) with bar/ring display. Date formats, ranges, time zones and the 12/24-hour setting.

### Phase 3: View settings and data operations (breaking window B)
- The view settings panel: layout switch, property visibility and order, filter, sort, group, sub-group, conditional color, load limit, open-pages-in, copy link.
- Filter tree with AND/OR groups up to 3 levels. Filters gain ids, so the shape changes, with migration from flat filters.
- Relative dates; "Me" through the person lever.
- Sort list with drag. Grouping by every type, with granularity, hide-empty, group sort and persisted collapse.
- Search in view.
- Board column calculations. Ctrl/Cmd+Alt+T toggles all groups.
- Lock database.
- Personal unsaved edits (D4).

### Phase 4: Row page and bulk actions
- Read-only viewers can open a row page to read it, as in Notion. Phase 0 Task A makes read-only fully inert on every paint path, so this splits `attachViewListeners` into read and write listeners.
- Peek modes (side, center, full page) with per-layout defaults. Previous/next navigation and shortcuts. Expand to full page.
- Editable properties panel with hide-empty. Icon and cover.
- Body as child blocks (D5), with migration.
- Row selection with gray fill (D3). Bulk edit (Cmd/Ctrl+/), bulk delete and duplicate.
- Cell copy/paste, paste one value into many cells, fill right/down and the fill handle. All of it goes through the paste-attribute law.
- Escape deletes an accidental empty row.

### Phase 5: More layouts
- Gallery and calendar (month/week, weekends, drag to move or span, + on a day).
- Timeline (zoom levels, bars, table panel, off-screen arrows).
- Board parity: card properties, size, preview/cover, fit image, sub-groups, hidden groups, color-columns toggle, inline card edit, keyboard-reachable cards.
- Every layout is written against `queryRows`/`queryGroups`.

### Phase 6: Computation and structure
- Formula 2.0 evaluator, a subproject with its own spec.
- Relation and rollup within one document. Cross-document needs the backend index the architecture doc deferred.
- Sub-items and dependencies (row-block `parentId` plus a self-relation).
- Templates.
- Button property.
- Chart and feed layouts.
- CSV import/export and merge.
- Linked views of a database in the same document. A view block points at a database block id; no copy is made.
- Page layouts.

### Tier 3: Hooks only (D6)
Automations, forms, map, dashboard, AI autofill, verification, permissions, comments, calendar sync, and multi-source databases. Each gets a data-shape slot and a host callback where that makes sense, and no built-in service.

## Definition of done for "matches Notion"

A feature counts as matching when all three of these hold:
1. **Behaviour.** An e2e test drives the Notion-documented behaviour, with the URL cited in the test file's header comment.
2. **Look.** Its measured values (from `research/07` or Task M) are pinned in a unit test or a screenshot spec, in light and dark.
3. **Motion.** Its durations and easings match the Task M recording and respect `prefers-reduced-motion`.

Divergences the user chose (D3, D6, and any later ones) are listed in `docs/` as intentional.
