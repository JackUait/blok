# Database Notion-parity status, final for round 5 (2026-10-20)

Follows `24-parity-status-2026-10-20.md` (written at 6b6651ee, evidence at 57b8e219).
Read-only status. No tests were run for this file. Evidence is a commit sha, a `src/` line at 2bcf738a, and a test path that exists at 2bcf738a.

Inputs:
- Ledger 24, every row.
- `git log 6b6651ee..origin/main` at 2bcf738a: 13 commits, all database or core. None excluded.
  - 34f20350, 2c962e93 (Source picker), b615919e (Number by), dbe0920a (leaving the builder), 340cd854 (backlink paths, pin hide), 1ef50aa3 (dark leftovers), 02b29ae0 (layout tab reorder).
  - 203786fe, 64dc8b83, b1b19db1, fb5272b0, 460a4272 (permissions core gate), 2bcf738a (database childTools).
- Memory `database-layout-builder-shipped.md`, "Draft limits" bullet (for BU1).
- `git log 3604546e..2bcf738a` bodies, swept for "not built", "unmeasured", "not verified", "unverified", "not checked" (case-insensitive, 40 commits). See section 4b.

A lane is building now (final-gaps lane): the UTC zone, the "Name" title for new sources, the greyed Source row, the backlink path at the right edge, and an e2e for childTools. Those items say "in progress (final-gaps lane)".

## Status rule

- **DONE**: what Notion showed was built. Leftovers that Notion never showed (UNMEASURED) do not block DONE. They are listed in section 4.
- **PARTIAL**: Notion showed something that Blok has not built yet.
- **PARTIAL (unaudited)**: research measured values that no commit names, and this file did not check them one by one.
- **OPEN**: no work.
- **SKIPPED-USER** / **BLOCKED-PAID**: as in ledger 21.

## 1. Ledger rows

| id | item | status | evidence (sha · test) | left / note |
|---|---|---|---|---|
| OM1 | Linked view of a database on another page | OPEN | No commit. The picker still lists this document only: `src/tools/database/index.ts:812-818` `pickerSources()` → `this.documentDatabases()`. | Needs a cross-document index (a backend). |
| OM2 | Row-page tab strip "N more…" | DONE | 871439cf, 7771e8c6, 372b0728, 055e9580; **02b29ae0** (drag handles on the builder list, reorder as a draft edit, list in the top layer) · `test/unit/tools/database/layout-tab-reorder.integration.test.ts`, `row-page-tab-overflow.integration.test.ts`, `concurrent-layout-tabs.test.ts`, `test/unit/components/utils/overflow-list.test.ts`, e2e `test/playwright/tests/database/database-page-layout.spec.ts` | Blok choices, not measured (02b29ae0): Content has no handle; the row page list has no handle; strip pills do not drag. Row page rows still have no rename (871439cf; research/13 §3b gives none). |
| OM3 | Filled autofill cell: Autofill + Comment + Copy | DONE | e0ae9114, a5910605 · `test/unit/tools/database/database-table-autofill-cell-actions.test.ts`, e2e `database-autofill-cell-actions.spec.ts` | Title cells keep the lone Autofill button. |
| OM4 | "Add to Favorites" in the row menu | DONE | 3b6e2dcd, f5011329, 7b50b873, da9ce4ab · `test/unit/tools/database/database-row-menu.test.ts`, `row-page-favorite.integration.test.ts` | List right-click and feed share the builder but have no own test (3b6e2dcd). |
| OM5 | Status group default sort | DONE | ea25767e · `test/unit/tools/database/group-keys.test.ts`, `database-view-settings-panel.test.ts` | — |
| OM6 | Look pinned by snapshot only | DONE | 6f02e75f · e2e `database-look-parity.spec.ts` and the unit tests in ledger 24 | — |
| OU1 | Dark theme for every surface | PARTIAL (unaudited) | b8cddcef, 8396d0eb, 590e7241, 366dc6cc, c7b979bb, 218fec5b, da9ce4ab; **1ef50aa3** (date picker weekday, values and "Today"; panel row values; filter operator; "+ Filter"; row page "Empty"; panel fields; "Add sort" / "Delete sort"; form answer field) · `test/unit/styles/database-dark-table-chrome-css.test.ts`, `database-view-settings-panel.test.ts`, e2e `database-dark-table-chrome.spec.ts`, `database-peek-dark.spec.ts`, `database-view-hover-chrome.spec.ts` | Weekday ink now ships: `src/styles/database.css:388, 576` rgb(139, 152, 152). Research 21 also measured dark values that no commit names: sort panel buttons (`research/21-notion-dark-and-leftovers.md:62`), "Manage in Calendar" border (`:138`), "No date" ink (`:139`), view settings header and close button (`:177`). Not audited here. |
| OU2 | Calendar event selection | DONE | 5e7bbac2, 3e9f6968, 9450ab40, 3d0e96f5, fc4ba77c · `test/unit/tools/database/database-calendar-select.integration.test.ts`, e2e `database-item-selection.spec.ts` | Gray paint, not blue. Board and list cards: Shift-click block range not checked (3e9f6968). |
| OU3 | Reminder alarm outside the table | DONE | add24f32, 1cfc61d9, f2451c59 · `test/unit/tools/database/date-reminder-alarm-views.integration.test.ts` | Feed and row page value: UNMEASURED. |
| OU4 | Remind in bulk and form editors | DONE | 7e8d2df8, 8122d583 · `test/unit/tools/database/date-reminders-bulk.integration.test.ts` | Form has no Remind, as measured. |
| OU5 | Comments on calendar and timeline items | DONE | 5e7bbac2, 44278fec · `test/unit/tools/database/database-comments.test.ts` | — |
| OU6 | "N more…" list arrow keys | DONE | 055e9580 · `test/unit/components/utils/overflow-list.test.ts`, e2e `database-view-overflow-list.spec.ts` | Arrows reaching the "N more…" button: UNMEASURED. |
| OU7 | "New data source" | PARTIAL | 60959740, 5d4a7cdc, ab11c206, 041f48e0, 1e44f6e9; **34f20350** (view settings "Source" picker, own tab bar lookup), **2c962e93** (Source fits every rendered layout; fixed the merge that threw ReferenceError) · `test/unit/tools/database/new-data-source.integration.test.ts`, `new-data-source-layouts.integration.test.ts`, `new-data-source-collab.integration.test.ts`, e2e `database-new-data-source.spec.ts` | Not built (34f20350, 60959740): the "New data source" side panel (Import CSV, templates, link existing); "Existing data sources" in Source (that is linking, OM1); the "Data source settings" label. In progress (final-gaps lane): the "Name" title property; the greyed Source row Notion shows with one source. |
| OU8 | Board calculation scope and results | DONE | 20b8410b, 25caf2c3, ab1e8c9d, 57b8e219 · `test/unit/tools/database/database-board-calculation.test.ts` | UNMEASURED: 99+ rule; spans under a day. |
| OU9 | Gallery keys, Enter on many, Delete | DONE | f1525b0e, a1bd5ebb, d0358e6a, 1ab2127f, fc4ba77c, 69e35448, 2fd446a7 · `test/unit/tools/database/database-gallery-view.test.ts` | ArrowLeft does nothing (section 3). |
| OU10 | URL/email/phone Escape; links on row page and cards | DONE | 4212d984, e08c4eeb, 57188d47 · `test/unit/tools/database/cells/text-editor.test.ts`, e2e `database-link-cells.spec.ts` | Title and place address still cancel on Escape: UNMEASURED. |
| OU11 | Backlinks order, many-count, path | DONE | 10ae987b; **340cd854** ("first / ... / parent", first page cut at 130px, path capped at 177px; code at `src/tools/database/database-card-drawer.ts:1283-1300`) · `test/unit/tools/database/database-card-drawer-backlinks.test.ts`, `database-backlinks.test.ts`, e2e `database-backlinks.spec.ts` | In progress (final-gaps lane): the path at the row's right edge. 20+ sources: UNMEASURED. |
| OU12 | Feed replies, others' pills, view count | DONE | 20b8410b · `test/unit/tools/database/database-feed-comments.integration.test.ts` | Other users' reaction pills: UNMEASURED. |
| OU13 | Map pins | DONE | 10ae987b, e6f6785d; **340cd854** (`TooltipOptions.hideDelay`; the pin card passes 55: `src/tools/database/database-maplibre.ts:192`; read at `src/components/utils/tooltip.ts:583`) · `test/unit/components/utils/tooltip.test.ts`, `test/unit/tools/database/database-maplibre.test.ts` | Show waits 300ms, not 160ms (section 3). UNMEASURED: 100+ pins, other colours, pin link. |
| OU14 | Form "Anonymous responses" | DONE | fa2b6021, 4c621792, 1586d496, 4c45c0e2 · `test/unit/tools/database/database-form-share.integration.test.ts` | Server (dotnet) writers not touched (4c45c0e2). |
| OU15 | Number grouping default range | DONE | 20b8410b, 25caf2c3, ab1e8c9d; **b615919e** (Range fields on the "Number by" page) · `test/unit/tools/database/database-view-settings-panel.test.ts`, `group-keys.test.ts`, e2e `database-view-settings.spec.ts` | Blok keeps the Unique / Range rows on the Range page. How Notion switches back to Unique: UNMEASURED (b615919e). |
| OU16 | Side peek details panel; 280px | DONE | 56cb94c2 · `test/unit/tools/database/database-card-drawer-layout.test.ts` | Narrow-window breakpoint: UNMEASURED. |
| OU17 | "Remove sorting" with per-view manual order | DONE | 20ecb059 · `test/unit/tools/database/database.test.ts`, `concurrent-database-row-order.test.ts` | Exports, agent actions and moveRowTo use the shared order. |
| OU18 | Timeline Hours snapping and edge resize | DONE | 44278fec, 10ae987b · `test/unit/tools/database/timeline-dates.test.ts`, e2e `database-timeline.spec.ts` | Other zooms keep day snap: UNMEASURED. |
| OU19 | Leaving while customizing the layout | DONE | da3bfb32 (beforeunload); **dbe0920a** (`blok.confirmLeave()` asks every open draft first, through `src/components/utils/leave-guards.ts`, wired at `src/components/modules/api/media.ts:17`; browser Back held through the Navigation API when `event.cancelable`) · `test/unit/tools/database/page-layout-builder.test.ts`, `test/unit/components/modules/api/media.test.ts`, e2e `database-page-layout.spec.ts` | Blok has no router. An in-app route change asks only if the host calls `confirmLeave()`. Blok never cancels push/replace (dbe0920a). Leaving by a sidebar click: UNMEASURED. |
| OU20 | Small leftovers | DONE | 4212d984 · `test/unit/tools/database/cells/select-editor.test.ts` | Sort-row drag motion: UNMEASURED. |
| OU21 | Table cell editing-state look | DONE | a7d0015d · `test/unit/styles/database-cell-editors-css.test.ts` | Drawer, form and bulk editors still open below. |
| B1 | Due reminders offered only at render | DONE | b805787b, 0ca79140, 0ff4bcff · `test/unit/tools/database/database-reminders.test.ts` | — |
| B2 | "Every 1 weeks" | DONE | 24c3834c, 208ee4ce, b80499b0 · `test/unit/tools/database/database-template-menu.test.ts` | — |
| B3 | Form question rename refusal | DONE | 9949c4c1 · `test/unit/tools/database/database-form-view.test.ts` | — |
| B4 | Agent `updateProperty` duplicates | DONE | 81fda7c3, d6d264e9 · `test/unit/shared/tool-actions/database-gap-commands.test.ts` | — |
| B5 | CSV duplicate headers | DONE | a2299d9b, 16d9e1c8 · `test/unit/tools/database/database-csv.test.ts` | CSV row order kept. |
| BU1 | Layout draft limits | OPEN (verified) | No commit touched `src/tools/database/layout-drafts.ts` after e3b6f514 (`git log -- layout-drafts.ts`). All three limits still hold. See BU1 below. | Builder is unreleased (not in v1.16.1). |
| BU2 | `config.permissions` gaps | DONE | **203786fe** (`BlockTool.isReadOnly`, block menu, selection delete, drag, Cmd+D, agent), **64dc8b83** (agent checks edit by edit; `BlockTool.isDataReadOnly`), **b1b19db1** (keyboard move, Tab, Backspace, drop, undo; adapters forward the hooks), **fb5272b0** (held step undoes once the block opens), **460a4272** (undo holds a step that writes frozen data) · `test/unit/tools/database/database-permissions-core.integration.test.ts`, `test/unit/architecture/block-tool-hook-adapter-parity-law.test.ts`, `test/unit/components/modules/blockEvents/composers/keyboardNavigation.test.ts`, `blockSelectionKeys.test.ts`, `test/unit/react/createReactBlock.test.tsx`, `test/unit/vue/createVueBlock.test.ts`, `test/unit/angular/createAngularBlock.test.ts` | Left by design (203786fe; `10-backlog.md:146`): direct host `api.blocks` writes; the headless/server planner never sees `config.permissions`; no per-row or per-property answers. Undo on a read-only block: Notion UNMEASURED (b1b19db1). Note: `10-backlog.md:146` still lists keyboard move, Tab, Backspace, drop and undo as "not covered"; b1b19db1, fb5272b0 and 460a4272 cover them. |
| BU3 | Reduced motion coverage | DONE | 5c7d6061 · `test/unit/styles/database-reduced-motion-law.test.ts` | — |

Also new this round, not a ledger row:
- **Database childTools** (2bcf738a): `DatabaseTool.childTools = { allow: database-row, database, tabs, database-comment }` (`src/tools/database/index.ts:370-372`). Core Tab, Shift+Tab, drop depth and index inserts now ask childTools. Test: `test/unit/tools/database/database-child-tools.integration.test.ts`, `test/unit/components/modules/drag/pointer-nesting-legal-parent.test.ts`. An e2e: in progress (final-gaps lane).
- **Stale save over setData** (34f20350): `DataPersistenceManager` counts setData calls; an older save no longer overwrites newer data. Test: `test/unit/components/block/data-persistence-manager.test.ts`.

Paid rows (unchanged): P1 dashboards, P2 form conditional logic, P4 automations, P5 button mail/webhook/Slack, P6 Verification, P7 chart look stay BLOCKED-PAID. P3 is partly done (fa2b6021); the custom submit screen is still paid.

### BU1: layout draft limits, read from source

Read from the code at 2bcf738a and from the v1.16.1 tag. Not run.

| limit (memory) | status | evidence | why not fixed |
|---|---|---|---|
| A draft is not cleaned while any of the maker's tabs stays open | Holds, by design | A draft's `by` is the maker's awareness ids (`layout-drafts.ts:46, 63-64`; the status folds a person's tabs, `:57`). `isAbandoned` returns false while any of those ids is in the room (`:81`). The maker's own editor never deletes its drafts: `isForeignDraft` is false for `made` ids (`index.ts:2130-2135`). | Intended: a maker with a tab open can still Apply or Discard. No commit since e3b6f514. |
| A v1.16.1 client re-saving a draft publishes it | Holds, narrower than the memory says | v1.16.1 `src/tools/tabs/index.ts:197-199` `save()` returns `{}`, so it drops a `tabs` block's draft mark. v1.16.1 `src/tools/tab/index.ts:105-107` spreads `_data`, so a `tab` keeps its mark. Today `isForeignDraft` (`index.ts:2130-2135`) would then show an unmarked tabs block while its tabs stay hidden, and cleanup (`index.ts:2223-2226`) removes only the tabs, which can leave an empty tabs block. | v1.16.1 code cannot change. The builder is unreleased, so only a mixed-version room hits it. |
| A Yjs client-id change mid-session is unhandled | Holds | The id changes on `resetForRelineage` (`src/components/modules/yjs/document-store.ts:2814`; "The new doc's clientID is Yjs's own random one", comment above it). `draft.by` is set once at `layout-drafts.ts:64` and never rewritten (grep `draft.by` in `src/tools`). Peers then see the old ids absent and delete the draft after 10 minutes (`layout-drafts.ts:81-84`). The maker re-makes a deleted layout block on Apply (`layout-drafts.ts:14-15`, `index.ts:2185-2210`). | No commit since e3b6f514. Loss is limited to a peer-side cleanup that the maker's Apply repairs; not run. |

## 2. Research 21-23 items

Rows not listed here are as in ledger 24 §2.

| research § | item | round 6 change | left |
|---|---|---|---|
| 21 §1c | Filter and sort | 1ef50aa3 (operator ink, "+ Filter", "Add sort" / "Delete sort", field fill) | Sort panel buttons dark (`research/21…:62`): not audited. Pills stay gray (S4). |
| 21 §1h | Calendar | — | "Manage in Calendar" border and "No date" ink (`:138-139`): not audited. |
| 21 §1k | Form builder | 1ef50aa3 (answer field border) | — |
| 21 §1l | Panels and menus | 1ef50aa3 (weekday header, Remind / Date format / Time values, "Today", panel row values) | View settings header and close button (`:177`): not audited. |
| 21 §1m | Side and center peek | 1ef50aa3 ("Empty" ink, AA-adjusted) | Light side-peek hovers: UNMEASURED. |
| 22 §7 | Number grouping | b615919e | Unique / Range rows kept on the Range page. |
| 23 §1 | Date picker submenus | — | Fuzzy zone search and Notion's 567 zones; submenu width 250 vs 180 (`database.css:5180`). UTC zone: in progress (final-gaps lane). |
| 23 §4 | Backlinks | 340cd854 | Path at the right edge: in progress (final-gaps lane). |
| 23 §5 | Map pins | 340cd854 (55ms hide) | Show stays 300ms (section 3). |
| 23 §7 | Leaving the builder | dbe0920a | Sidebar click: UNMEASURED. |
| 23 §8 | Gallery focus after a peek | — | Restoring the selection and focus after a peek closes: still no commit. |
| 23 §10 | New data source | 34f20350, 2c962e93 | Side panel; "Existing data sources"; "Data source settings" label. "Name" title and greyed row: in progress (final-gaps lane). |

## 3. Deliberate differences from Notion

As in ledger 24 §3, with these updates:
- **Map pin card waits 300ms to show, not ≈160ms.** The hint-delay law sets the floor (`database-maplibre.ts:192`). The hide now matches at 55ms (340cd854).
- **"Discard" is outlined, not filled red.** Shared confirm style: red text and red border (`src/styles/database.css:4039-4042`).
- **Dark "New" button hover is rgb(36, 115, 201)** for AA (`database.css:364, 552`).
- **Thank-you screen keeps Blok's text and "Submit another response"** (`src/components/i18n/locales/en.json:1288-1289`, `database-form-view.ts:310`).
- **Per-view manual order is on for local documents, opt-in for adapters** (`index.ts:548`).
- **AA-adjusted dark grays** (1ef50aa3): panel row values and filter operator rgb(142, 139, 134), "+ Filter" rgb(135, 132, 127), row page "Empty" rgb(138, 135, 130). Notion's values fail AA (3.6:1, 3.9:1, 3.8:1).
- **Light "Today" and "Add sort" / "Delete sort" use Blok's secondary token**, not Notion's light gray (3.4:1) (1ef50aa3).
- **The Number by Range page keeps Unique / Range rows.** Notion's Range page shows none (b615919e).
- **Browser Back is held only when cancelable.** Blok never cancels push/replace, so a host router keeps working. Notion's own Cancel leaves the URL changed; Blok's does not (dbe0920a).
- **Layout tab reorder:** Content never moves and has no handle; the row page list has no handle (02b29ae0).
- **Undo on a read-only block waits** on its stack until the block opens (b1b19db1, fb5272b0, 460a4272). Notion is unmeasured; this is the safe choice.
- **Deleting the last view of a second source** keeps the source block and its rows, hidden; "Source" can show them again (34f20350).
- **Picking another source keeps the view's filters and sorts**; unknown ids match nothing (34f20350, Blok rule).

## 4. Open / not built

Paid plan (Free workspace): P1 dashboards, P2 form conditional logic, P3 custom submit screen, P4 automations, P5 button mail / webhook / Slack, P6 Verification, P7 chart look.

In progress (final-gaps lane):
- UTC zone in the time zone list.
- "Name" title property for a new data source (60959740 used Blok's "Title").
- Greyed view settings "Source" row when the database has one source (34f20350).
- Backlink path at the row's right edge.
- e2e for core childTools (2bcf738a has unit tests only).

Not built, with a reason:
- **Cross-document linked views** (OM1), "Existing data sources" in Source (34f20350), row "Move to" another document. The picker reads this document only (`index.ts:812-818`). Needs a backend index.
- **New data source side panel** (Import CSV, templates, link existing) and the "Data source settings" label (60959740, 34f20350). The source starts empty.
- **Fuzzy time zone search and Notion's 567 zones.** Blok lists `Intl.supportedValuesOf('timeZone')` (`cells/date-format.ts:172-175`) and matches a substring (`cells/date-editor.ts:824`).
- **Date picker submenu width 250 vs 180** (`database.css:5180`). Research 17 is not on main, so the 250 was not re-read.
- **"Learn about reminders"** (e1eefe62). No help-URL lever.
- **Template cadence:** months row "On the [1st] [Day]"; real At / Starting / Ending / Timezone submenus (b80499b0). Notion's banner summary and ↻ tooltip (24c3834c).
- **Gallery: restore selection and focus after a peek closes** (research 23 §8). No commit.
- **Dashboard widgets** draw only table and list layouts (5d4a7cdc).
- **Per-view manual order in exports, agent tool actions and `moveRowTo`** (20ecb059).
- **Cell editors outside the table** still open below (a7d0015d).
- **Row page link value** is not shortened (4212d984).
- **Escape** still cancels in the title, a place address and a stored email or phone (e08c4eeb).
- **Paste / fill of a date** brings no reminder default (7e8d2df8). Bulk does not pre-fill the first row's own reminder (8122d583).
- **Adding a property** reveals it only in table and form legacy views (a9309dff, 36fd7f39).
- **Board / gallery margin lasso** still selects the database block (3d0e96f5).
- **Board and list cards: Shift-click block range** not checked; only calendar and gallery are selection owners (3e9f6968; `database-calendar-view.ts:275`, `database-gallery-view.ts:147`).
- **Server writers** (dotnet) of createdBy / lastEditedBy ignore anonymous answers (4c45c0e2).
- **Permissions, by design:** direct host `api.blocks` writes; the headless/server planner; per-row or per-property answers (203786fe; `10-backlog.md:146`).
- **Layout draft limits** (BU1): all three hold; see section 1.
- **Layout tab reorder:** row page list handle, Content handle, strip pill drag (02b29ae0, not measured).

UNMEASURED (ledger 24 §4 list still applies; round 6 adds):
- Undo of a step on a read-only block (b1b19db1).
- How Notion switches a Range grouping back to Unique (b615919e).
- Deleting the last view of a source (34f20350; also research 20 and 23).
- Whether Notion's Content tab moves in the layout list (02b29ae0).
- What picking another source does to filters and sorts (34f20350).

### 4b. Commit-body sweep (3604546e..2bcf738a)

Every hit, case-insensitive. "Open" hits are listed in section 4 above. "Closed" hits were built later; the closing body says so.

| hit sha | what it said | state |
|---|---|---|
| 041f48e0 | "New data source" NOT built; per view vs per block UNMEASURED | Closed by 60959740. Per block kept (section 3). |
| 60959740 | Only table and list on a second source | Closed by 5d4a7cdc ("every layout"). |
| 60959740 | Side panel and Source picker not built; "Title" not "Name" | Source: closed by 34f20350. Side panel: open. Name: in progress. |
| 34f20350 | Not built: "Existing data sources", "Data source settings", greyed row; deleting last view UNMEASURED; "on other layouts the row is disabled" | Disabled-row note closed by 2c962e93. Others open / in progress. |
| 3b6e2dcd | Favorited wording and icon unmeasured | Closed by da9ce4ab ("Remove from your favorites", IconStarFilled). |
| da9ce4ab | Dark favorite star unmeasured | Open (UNMEASURED). |
| fc4ba77c | SR text "2 blocks deleted" not built; Escape after grid box unmeasured | SR text closed by 69e35448. Escape: open (UNMEASURED). |
| 5e7bbac2 | Drag box not built; inside-grid start unmeasured | Closed by 3d0e96f5 (margin lasso) and fc4ba77c (grid box). |
| 3d0e96f5 | Board/gallery lasso unmeasured; inside-grid start unmeasured | Board/gallery: open. Inside-grid: closed by fc4ba77c. |
| 3e9f6968 | Board, list, gallery Shift-click not checked | Gallery: owner since 3d0e96f5. Board, list: open. |
| 25caf2c3, 20b8410b | Range fields not on "Number by"; "Group range" / "Group every" names not built; 99+ rule, under-a-day spans unmeasured | Names: closed by 25caf2c3. Sub-page: closed by b615919e. 99+ and spans: open (UNMEASURED). |
| b615919e | How Notion switches back to Unique unmeasured | Open (UNMEASURED). |
| 24c3834c | Banner summary, ↻ tooltip, Repeat in the banner not built | Banner: closed by 208ee4ce. Summary and tooltip: open. |
| 208ee4ce | Weekday preset, chips, At / Ending / Timezone / Next occurrence, Save step, unit dropdown, chevron not built | Closed by b80499b0 (presets incl. Weekday, chips, Edit cadence + Save, unit dropdown, Next occurrence, chevron). At / Starting / Ending / Timezone submenus: open. |
| e1eefe62 | Zone list max 320px unmeasured, no search; "Learn about reminders" not built; row boxes unmeasured | Search: closed by 206f2d25 (substring search, `cells/date-editor.ts:824`). Learn: open. 320px and row boxes: open (UNMEASURED). |
| 10ae987b | Other pin colours unmeasured | Open. |
| ab1e8c9d | "Out of range" under descending sort; sub-grouping and chart X-axis; "<calc> in <property>" hint unmeasured | Open. |
| e08c4eeb | Escape in title, address, stored email/phone; bulk Escape unmeasured | Email/phone after edit: closed by 57188d47. Others: open. |
| 20ecb059 | "Don't remove" answer unmeasured | Measured later (research 23 §3a); Blok keeps its rule (section 3). |
| 703b5a63 | Fallback start unmeasured | Open (Blok choice). |
| 4212d984 | Dark link underline unmeasured | Open. |
| 372b0728 | Arrows reaching "N more…" UNMEASURED | Open. |
| f1525b0e | Delete on several cards, no toast (unmeasured) | Closed by fc4ba77c (multi-delete Restore toast). |
| 56cb94c2 | Handle hover look, narrow breakpoint unmeasured | Open. |
| 44278fec | Right edge unmeasured; other zooms unmeasured | Right edge: measured later (research 23 §3b), matches. Zooms: open. |
| 1cfc61d9 | Lane gap; dark reminder blue unmeasured | Open. |
| 8122d583 | Other types open empty; Remind before date; first row's reminder unmeasured | Open. |
| 7e8d2df8 | Own reminder kept; paste default unmeasured | Open. |
| 218fec5b | Chip label, visibility at rest, selected-card ring unmeasured | Open. |
| c7b979bb | Light title ink, light hovers, padding unmeasured | Open. |
| add24f32 | Feed and row page value alarm unmeasured | Open. |
| b8cddcef | OPEN, gutter, "+ New page" hover unmeasured in dark | OPEN and "+ New page": closed by da9ce4ab. Gutter: open. |
| 8396d0eb | Brown hues, coloured-card hover, timeline grid and arrow, gallery inks unmeasured | Open. |
| 36fd7f39, a9309dff | Other layouts, relation tabs unmeasured | Open. |
| b1b19db1 | Undo on read-only unmeasured | Open. |
| 0ba45c84, 7ae47e80 | Research docs (title only) | No item. |

## 5. Release notes owed

**User decision (2bcf738a body, 2026-10-20): database-only changes are not BREAKING, because no consumer uses databases yet.** `git log 6b6651ee..2bcf738a --grep=BREAKING` finds no commit.

Public API added:
- `history.latestStep()` and `history.undoStep(step)`, type `HistoryStep` (a1bd5ebb, `types/api/history.d.ts`).
- `NotifierOptions.announce`: separate screen-reader text (69e35448, `types/configs/notifier.d.ts`).
- `TooltipOptions.hideDelay`: grace after the pointer leaves, default 100ms (340cd854, `types/api/tooltip.d.ts`).
- `BlockTool.isReadOnly()` and `BlockTool.isDataReadOnly()` (203786fe, 64dc8b83, `types/tools/block-tool.d.ts:160, 169`). The React, Vue and Angular block factories forward both (b1b19db1, `packages/react/types/index.d.ts`, `packages/vue/types/index.d.ts`).
- `data-blok-selection-owner` (`DATA_ATTR.selectionOwner`) and the cancelable `blok-lasso` event (3d0e96f5).
- `config.favorites` / `DatabaseFavorites` (3b6e2dcd, f5011329, da9ce4ab).
- `DatabaseAdapter.viewRowOrder`, `views[].rowOrder`, `rowOrder` in `updateView` changes (20ecb059).
- `config.forms.emailCopy` (fa2b6021).
- `InsertAtOptions.anonymous`, `DatabaseRowData.anonymous`, `DatabaseRowMeta.anonymous` (fa2b6021).
- `hideDataSourceTitles` on the database data (041f48e0).
- `TemplateRepeat.weekdays` and `TemplateRepeat.end` (865cb810).
- Second data source: a child `database` block plus `view.dataSourceId` (60959740, 5d4a7cdc), picked in view settings "Source" (34f20350).
- Popover `cover` param (a7d0015d).
- `IconStarFilled` icon (da9ce4ab).
- `api.i18n.t` plural forms from a numeric `count` (24c3834c).
- `DatabaseBacklinks.list` is one entry per mention (10ae987b).

Behaviour changes:
- **`confirmLeave()` now also asks about a dirty layout builder.** It is a v1.16.1 method. It asks every open layout draft in this editor first, then the failed-images banner. It resolves false if the user cancels (dbe0920a, `src/components/modules/api/media.ts:17`).
- **Core enforces childTools for Tab, Shift+Tab and drop on every container that declares it** (2bcf738a). `child-tools.ts` and the tabs block's `childTools` (`{ allow: ['tab'] }`, `src/tools/tabs/index.ts:473-475`) both shipped in v1.16.1, so this is visible: Tab on a block right after a tabs block no longer nests it. This follows from 2bcf738a's Tab change ("asks childTools of the block it would nest under"); its tests cover a database only, not a tabs block.
- **Database children** (2bcf738a, not breaking per the user decision): `api.blocks.moveTo(id, { parentId: <database> })` for a block that is not a row, database, tabs or database-comment throws `BlockPlacementError`. `api.blocks.insertAt` with such a tool and a database parent makes a blank `database-row`. Migration: put content next to the database, or in a row's page body (`parentId: <row id>`).
- **`DataPersistenceManager` no longer lets a late save overwrite newer data** after a setData (34f20350).
- **`onChange` may fire for a second undo or a peer update to the same block in the same frame.** Same-task bursts still give one event (f439640d).
- **Undo and redo leave the caret alone inside a `data-blok-keyboard-owner` area** with no block input selected (57188d47).
- **Read-only blocks** (`isReadOnly` true) refuse the block menu edits, selection delete, drag, Cmd+D, Cmd+Shift+Up/Down, Tab, Backspace merges, drops under them and agent writes; their undo steps wait until the block opens (203786fe, b1b19db1, fb5272b0, 460a4272). Only hosts that implement the new hook see this.
- A toast with `announce` is not a live region (69e35448).
- Two quick Mod+Z presses are two undo steps (1f5f63ce).
- Side peek opens at 756px, resizable 564-1008px, width in localStorage `blok:database-peek-width` (56cb94c2).
- Dark peek background is `--blok-database-peek-bg` (366dc6cc).
- Shift-click inside a selection owner starts no block range (3d0e96f5).
- Blocks inside an anonymous form answer keep no `createdBy` / `lastEditedBy` (1586d496, 4c45c0e2).
- Escape saves text, number, url, email and phone cell edits (e08c4eeb, 4212d984, 57188d47).
- Undo and redo close every open cell editor (fa989de2).
- A url with no scheme links to `http://…` (4212d984).
- Status groups sort Ascending by default (ea25767e).
- Manual row order is per view in local documents (20ecb059).
- Number range buckets and "Out of range"; changing the group property resets its settings (ab1e8c9d). Range fields moved to the "Number by" page (b615919e).
- Gallery Delete trashes at once with a toast and Restore (f1525b0e).
- Template repeat moved to the template banner (208ee4ce, b80499b0).
- Due reminders and template runs are offered while the document is open (b805787b).
- A new column shows in a legacy `visibleProperties` table or form view (a9309dff, bdf89459, 36fd7f39).
- CSV import and merge number repeated headers (a2299d9b, 16d9e1c8).
- Agent `database.updateProperty` refuses a taken name (81fda7c3, d6d264e9).
- Agent writes to a read-only block fail with `PRECONDITION_FAILED`, checked edit by edit (64dc8b83).
- Backlink paths shorten to "first / ... / parent" (340cd854).
- Light "Today" in the date picker is 12px weight 500 and secondary ink; light "Add sort" / "Delete sort" use secondary ink (1ef50aa3).

Mixed-version clients (a v1.16.1 peer on the same document):
- A view on a second data source shows the database's own rows; the source block is not hidden. No data is lost (60959740).
- It keeps `rowOrder` but shows the shared order (20ecb059).
- It drops `hideDataSourceTitles` on save (041f48e0).
- It drops a draft mark from a `tabs` block on save (BU1, v1.16.1 `tabs/index.ts:197-199`).
