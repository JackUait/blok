# Database Notion-parity status after round 8 (2026-10-21)

Supersedes `25-parity-status-final-2026-10-20.md` (written at 2bcf738a, committed as d43c6a77). This file is the status of record. Ledgers 21, 24 and 25 are history; nothing here points back to them for a live item.

Read-only status. Evidence at 8b4df4b2 (origin/main when written). No tests were run for this file. Every cited test path was checked to exist at 8b4df4b2 (`test -e`).

Inputs:
- Ledger 25, every row of §1, §2, §4 and §4b.
- Research 21-23 (already inputs to ledger 25) and research 26, 27, 28 (new since ledger 25).
- `git log d43c6a77..origin/main -- src/tools/database src/shared/database types/tools/database.d.ts src/components`: 73 commits. 39 are database, core or events commits and are used here. 34 are excluded: `assistant`, `agent`, `agent-models` and `playground` commits (the Ask AI bar, its live preview and model adapters). They touch `src/components` but no database surface.
- Bodies of every database / core / events commit in `d43c6a77..8b4df4b2`, grepped case-insensitively for "not built", "unmeasured", "unverified", "not verified" and "open". See §4b.

Not an input: efc5b404. 8b4df4b2's body names it for the popover tie-ranking change, but it is not on main (`merge-base --is-ancestor` fails). The same change landed as **0ac38e6b**.

## Status rule

- **DONE**: what Notion showed is built. A DONE row can still carry leftovers. Each leftover has its own tag (UNMEASURED, PARTIAL, OPEN, BLOCKED), so lists A and B can be pulled out by tag.
- **PARTIAL**: Notion behaviour was measured and Blok has not built it. Every PARTIAL cites the research line that measured it and says what is missing.
- **UNMEASURED**: Notion's behaviour was never observed. The item says what to measure.
- **BLOCKED**: needs a paid plan, a backend, or a user decision. The item says which.
- **OPEN**: no work, and no research line backs it (only a commit body says "not built"). Such items keep their ledger 25 wording and say "not re-checked" when this round found no commit for them.

Ledger 25 labels mapped: PARTIAL (unaudited) → re-audited below; OPEN (verified) → BU1 rows; BLOCKED-PAID → BLOCKED: paid plan; SKIPPED-USER → BLOCKED: user decision.

## 1. Ledger rows

| id | item | status | evidence (sha · test) | leftovers |
|---|---|---|---|---|
| OM1 | Linked view of a database on another page | DONE | **d005c5bc** `config.linkedSources.search` / `subscribe` (`types/tools/database.d.ts:443, 448`); remote pick copies the source's first table view; deleted banner on `null` · `test/unit/tools/database/database-linked-view.test.ts` | OPEN (d005c5bc "not built"): host write callbacks for remote rows; "+" add-view on a remote linked view. OPEN, not re-checked: row "Move to" another document. |
| OM2 | Row-page tab strip "N more…" | DONE | as ledger 25 (871439cf, 7771e8c6, 372b0728, 055e9580, 02b29ae0) · `test/unit/tools/database/layout-tab-reorder.integration.test.ts`, `row-page-tab-overflow.integration.test.ts` | UNMEASURED: whether Notion's Content tab moves; row page list handle; strip pill drag (02b29ae0). Not re-checked. |
| OM3 | Filled autofill cell actions | DONE | e0ae9114, a5910605 · `test/unit/tools/database/database-table-autofill-cell-actions.test.ts` | — |
| OM4 | "Add to Favorites" in the row menu | DONE | 3b6e2dcd, f5011329, 7b50b873, da9ce4ab · `test/unit/tools/database/database-row-menu.test.ts` | UNMEASURED (blocked in session, see §6): dark favorite star. |
| OM5 | Status group default sort | DONE | ea25767e · `test/unit/tools/database/group-keys.test.ts` | — |
| OM6 | Look pinned by snapshot only | DONE | 6f02e75f; **6449cac3** adds `test/playwright/tests/database/database-light-values.spec.ts` | — |
| OU1 | Dark theme for every surface | PARTIAL | Ledger 25's four unaudited values are now built: sort panel buttons r21:62 → **75c02d41**; "Manage in Calendar" border r21:138 → **27d4b367**; "No date" ink r21:139 → `src/styles/database.css:132, 364, 576` (rgb(142, 139, 134) / rgb(173, 169, 163), read here); View settings header and close r21:177 → **6449cac3**, **75c02d41**. Research 26 dark values → **6449cac3** (board brown/blue, reminder blue, side peek hovers), **2f783bd5** (pressed row and ×, Today/Now hover) · `test/unit/styles/database-light-values-css.test.ts`, `database-notion-elements-css.test.ts`, e2e `database-notion-elements.spec.ts` | PARTIAL: timeline off-screen arrow chip has no hover. Notion: light rgb(56, 56, 54), dark rgb(230, 229, 227); icon 14x12 (r26:222). Blok: rest colours match (`database.css:148, 151, 379, 381`), no `:hover` rule, icon 12x12 (`database.css:8548-8566`). UNMEASURED: "/" menu and hints in dark (r28:166); Manage in Calendar arrow dark ink (27d4b367). |
| OU2 | Calendar event selection | DONE | as ledger 25 · `test/unit/tools/database/database-calendar-select.integration.test.ts` | OPEN, not re-checked: board and list Shift-click range (3e9f6968). |
| OU3 | Reminder alarm outside the table | DONE | add24f32, 1cfc61d9, f2451c59 · `test/unit/tools/database/date-reminder-alarm-views.integration.test.ts` | UNMEASURED: feed and row page value alarm. |
| OU4 | Remind in bulk and form editors | DONE | 7e8d2df8, 8122d583; **18b30fb5** (End date on an empty first row no longer clears every row) · `test/unit/tools/database/date-reminders-bulk.integration.test.ts` | UNMEASURED: End date turned on in an empty cell (18b30fb5). |
| OU5 | Comments on calendar and timeline items | DONE | 5e7bbac2, 44278fec · `test/unit/tools/database/database-comments.test.ts` | — |
| OU6 | "N more…" list arrow keys | DONE | 055e9580 · `test/unit/components/utils/overflow-list.test.ts` | UNMEASURED: arrows reaching the "N more…" button. |
| OU7 | "New data source" | DONE | **12e403f9** (side panel; "Existing data sources" in Source; "Data source settings" label), **2daf4b2e** (named source, Suggested sources, last-view dialog), **3a33ffca** (CSV into a new source reaches its backend), **0438b73b** ("Name"), **a8849f2e** (greyed Source row), **03010a9c** (source switch drops filters, keeps the title sort), **1b480bdf** (CSV import dialog) · `test/unit/tools/database/new-data-source-panel.integration.test.ts`, `new-data-source.integration.test.ts`, `new-data-source-collab.integration.test.ts`, e2e `database-new-data-source.spec.ts` | PARTIAL: the panel has no × close button. Notion: 20x20 round ×, rest rgba(42, 28, 0, 0.07), on "New database", "New data source" and "Link to existing" (r26:40, r26:91). Blok: only View settings passes `headerAction` (`database-view-settings-panel.ts:257`); `database-new-source-panel.ts` passes none. UNMEASURED: delete-last-view dialog default focus (2daf4b2e). |
| OU8 | Board calculation scope and results | DONE | as ledger 25 · `test/unit/tools/database/database-board-calculation.test.ts` | UNMEASURED: 99+ toggle scope per view; spans under a day; "Out of range" under a descending sort. |
| OU9 | Gallery keys, Enter on many, Delete | DONE | as ledger 25 · `test/unit/tools/database/database-gallery-view.test.ts` | PARTIAL: focus after a peek, see §2 (23 §8). |
| OU10 | URL / email / phone Escape | DONE | 4212d984, e08c4eeb, 57188d47 · `test/unit/tools/database/cells/text-editor.test.ts` | UNMEASURED: Escape in the title, in a place address, and in bulk editors (e08c4eeb). |
| OU11 | Backlinks order, many-count, path | DONE | 10ae987b, 340cd854; **2a301691** (path at the row's right end, r23 §4) · e2e `database-backlinks.spec.ts` | UNMEASURED: 20+ sources; order by mention time or edit time. |
| OU12 | Feed replies, others' pills, view count | DONE | 20b8410b · `test/unit/tools/database/database-feed-comments.integration.test.ts` | UNMEASURED (blocked in session, see §6): other users' reaction pills. |
| OU13 | Map pins | DONE | as ledger 25 · `test/unit/tools/database/database-maplibre.test.ts` | UNMEASURED: pin link; 100+ pins and clustering; colours other than green; warm window between pins. |
| OU14 | Form "Anonymous responses" | DONE | as ledger 25 · `test/unit/tools/database/database-form-share.integration.test.ts` | OPEN, not re-checked: server (dotnet) writers (4c45c0e2). UNMEASURED: Created by with anonymous off; what "View my response" opens. |
| OU15 | Number grouping range | DONE | b615919e · `test/unit/tools/database/database-view-settings-panel.test.ts` | Measured since (r26:270-276): Notion goes back to Unique from the Group page's "Number by" row; its Range page has no Unique/Range rows. Blok keeps them there (deliberate, §3). |
| OU16 | Side peek details panel | DONE | 56cb94c2 · `test/unit/tools/database/database-card-drawer-layout.test.ts` | UNMEASURED (blocked in session, see §6): narrow-window breakpoint. UNMEASURED: handle hover look. |
| OU17 | "Remove sorting" with per-view order | DONE | 20ecb059 · `test/unit/tools/database/concurrent-database-row-order.test.ts` | OPEN, not re-checked: per-view order in exports, agent actions and `moveRowTo`. |
| OU18 | Timeline Hours snapping | DONE | 44278fec, 10ae987b · `test/unit/tools/database/timeline-dates.test.ts` | UNMEASURED: snap at other zooms. |
| OU19 | Leaving while customizing the layout | DONE | da3bfb32, dbe0920a · `test/unit/tools/database/page-layout-builder.test.ts` | UNMEASURED: leaving by a sidebar click; draft after an accepted reload. |
| OU20 | Small leftovers | DONE | 4212d984 · `test/unit/tools/database/cells/select-editor.test.ts` | UNMEASURED: sort-row drag motion. |
| OU21 | Table cell editing-state look | DONE | a7d0015d · `test/unit/styles/database-cell-editors-css.test.ts` | OPEN, not re-checked: drawer, form and bulk editors still open below. |
| B1-B5 | Reminders at render, plurals, form rename, agent duplicates, CSV headers | DONE | as ledger 25 | — |
| BU1 | Layout draft limits | see table below | 2f8b7ddf | — |
| BU2 | `config.permissions` gaps | DONE | as ledger 25 (203786fe, 64dc8b83, b1b19db1, fb5272b0, 460a4272) · `test/unit/tools/database/database-permissions-core.integration.test.ts` | BLOCKED: user decision (by design, 203786fe): direct host `api.blocks` writes, the headless planner, per-row answers. UNMEASURED (blocked in session, see §6): undo on a read-only block. |
| BU3 | Reduced motion | DONE | 5c7d6061 · `test/unit/styles/database-reduced-motion-law.test.ts` | — |
| CT | Database childTools e2e | DONE | 2bcf738a; **e7863411** · e2e `test/playwright/tests/database/database-child-tools.spec.ts` | — |

Paid rows: P1 dashboards, P2 form conditional logic, P3 custom submit screen, P4 automations, P5 button mail / webhook / Slack, P6 Verification, P7 chart look. All BLOCKED: paid plan. No commit since d43c6a77.

### BU1: layout draft limits

| limit | status | evidence |
|---|---|---|
| Not cleaned while any of the maker's tabs stays open | BLOCKED: user decision (by design, as ledger 25) | No commit touched `src/tools/database/layout-drafts.ts` since d43c6a77 (`git log d43c6a77..origin/main -- src/tools/database/layout-drafts.ts` is empty). Not re-run. |
| A v1.16.1 client re-saving a `tabs` block drops its draft mark | OPEN (holds) | Same: no change to `layout-drafts.ts`; v1.16.1 code cannot change. Not re-run. |
| Yjs client-id change mid-session | DONE (closed differently) | **Ledger 25 was wrong here.** It said the maker repairs a peer cleanup on Apply. 2f8b7ddf ran it: relineage clears the blocks, the drawer is torn down, and the open draft is discarded, so nobody can Apply. Built instead: `resetForRelineage` clears `firstSynced` / `cacheAdopted` before the clear, so the maker's editor no longer locks read-only; discard forgets its made ids, so a stranded copy hides and is cleaned like any abandoned draft · `test/unit/tools/database/concurrent-layout-tab-drafts.test.ts`, `test/unit/components/modules/collaboration/sync-first-load.test.ts` |

### 1b. New since ledger 25 (not ledger rows)

| item | status | evidence | leftovers |
|---|---|---|---|
| "/" Database section (r28 §1a) | DONE | **0ac38e6b** (Table, Board, Gallery, List, Feed, Calendar, Timeline, Map views, Form, Database - Inline, Linked view; seeds in `src/shared/database/seed-layouts.ts`; "· Database" suffix in search only; title match ranks above alias match at equal score), **7dd143aa**, **063f0935** (`/table` keeps the Table block first, r28:95), **d0a962f3**, **7198f343**, **8b4df4b2** (template / CSV / AI / link drops the Timeline sample cards) · `test/unit/shared/database/seed-layouts.test.ts`, `test/unit/components/utils/popover/search-suffix.test.ts`, e2e `database-slash-entries.spec.ts` | PARTIAL: Calendar view toolbar has no "Manage in Calendar" button. Notion shows it there (r28:129). Blok: timeline toolbar only (27d4b367 said "not measured there"; `database-calendar-view.ts` has no manage control). BLOCKED: paid plan: Dashboard view (r28:136), five chart entries (r28:137, free-chart quota). BLOCKED: needs a backend / host page lever: Database - Full page (r28:134; 0ac38e6b: `PageConfig.create` carries no initial content). |
| "New database" panel on every user insert | DONE | **10fb951b**, **e6346231**, **7c2462c9**, **70c53f5e** (opens on every user insert; Import CSV row; AI box only with `ai.setupDatabase`), **48d043d5** · `test/unit/tools/database/database-new-database-ai.test.ts`, `database-ai-setup.test.ts`, `database-ai-setup-only.public-path.test.ts`, e2e `database-new-database-ai.spec.ts` | UNMEASURED: why Notion's first Table insert on a fresh page opened no panel (r28:160). Blok opens it every time. |
| Suggested templates (r27 §1) | DONE (three schemas) | **45ae9276** Tasks Tracker, Projects, Skills with schema, views, sample rows and first-row body; one undo step · `test/unit/tools/database/database-starters.test.ts`, `database-starters-panel.test.ts`, `test/unit/styles/database-starter-neutral.test.ts`, e2e `database-starters.spec.ts` | PARTIAL, see list A (rotation r27:19-26; database icon r27:42; "Undo … database" row r27:43; Default template r27:44; More templates r27:120-127). OPEN (Blok choice, 45ae9276): PDF / Drive / Figma placeholders (Blok keeps no empty embed). UNMEASURED: what a chip or view card changes (r27:322); Board card layout (r27:319); Status "Not started" colour (r27:320). |
| Import CSV dialog (r27 §2) | DONE | **1b480bdf** (Choose file, Clear file, Setup CSV columns, type per column, Don't import / title / Add new property), **e916deb0**, **3a33ffca**, **70c53f5e** · `test/unit/tools/database/database-csv-import-dialog.test.ts`, `database-csv.test.ts` | PARTIAL: right-hand preview (r26:117, r27:142); "Use first row as headers" switch (r27:151); "Learn about imports" link (r26:117). UNMEASURED: date-format submenu, headers switch off, Phone / Person / Status detection, merge into an existing database (r27:318). |
| Manage in Calendar (r27 §3) | DONE | **27d4b367** `config.calendar.manage` lever (`types/tools/database.d.ts:498`); View settings row and timeline toolbar button · e2e `database-manage-calendar.spec.ts`, `test/unit/tools/database/database-view-settings-tool.test.ts` | PARTIAL: Calendar view button (row above). BLOCKED (by design): what Notion's link opens is a separate product (r27:192-194). |
| Date picker field and default time (r26 §5d-e, r27 §4) | DONE | **ccd26944** (field shows the Date format), **1006d89d** (Short date never shows a year; Full date field uses the short month), **c7995bec** (today → next whole hour, other day → 9:00), **a2f13321** (empty cell fills today at once) · `test/unit/tools/database/cells/date-editor.test.ts`, `cells/number-date-format.test.ts` | UNMEASURED: default time at exactly hh:00 and in the 23:xx hour (r27:232); Relative in the field for nearby days (ccd26944). |
| "Today" button sets the date (r27:236) | DONE | `src/tools/database/cells/date-editor.ts:488-492` calls `pickDay` (read here) | — |
| Edit property keys (r27 §7) | DONE | **369eab1a** (ArrowRight / Enter open, Escape closes one level; `escapeClosesSubmenuFirst` set only at `database-property-menu.ts:213`) · `test/unit/components/flipper.test.ts`, `test/unit/utils/popover-registry.test.ts`, e2e `database-notion-elements.spec.ts` | BLOCKED: user decision: one-level Escape on every other menu (369eab1a calls it a product call). |
| Pressed and hover fills (r27 §6) | DONE | **2f783bd5** · `test/unit/styles/database-notion-elements-css.test.ts` | UNMEASURED: light View settings row `:active` (r27:279 "not read"; Blok keeps the hover fill). |
| Bordered controls (r26 §3) | DONE | **75c02d41** (sort buttons, selection bar dividers, property icon button, View settings ×) · `test/unit/styles/database-notion-elements-css.test.ts` | DONE (r30 X2, r10/prop-desc): the (i) in the name field shows an inline description field inside the menu; the "Property description" item is gone. Enter adds no line, Escape closes the menu and saves. |
| Deleting a database deletes its subtree | DONE | **19775e8c** (`deletesChildren`, `src/tools/database/index.ts:427`), **ee82ebc5**, **e053752e** (replace deletes the subtree; `removed({ deleted })`), **9a405ad6** (local deletes send `deleteRow`; undo, paste, duplicate send `createRow`) · `test/unit/tools/database/database-delete-cascade.integration.test.ts`, `database-backend-sync.test.ts`, `test/unit/components/blocks.test.ts` | OPEN: an old peer that deletes only the source block leaves its rows (`it.fails`, `database-delete-cascade.integration.test.ts:837`). |
| Events dispatcher | DONE | 16ff5df6 (BREAKING), then **4d108636** undid it; 83ec5a6f (a once listener no longer skips the next) · `test/unit/components/utils/events.test.ts` | Net public change: none (§5). |

## 2. Research 21-23 items

| research § | item | change since ledger 25 | status / left |
|---|---|---|---|
| 21 §1c | Sort panel dark (r21:62) | 75c02d41 | DONE |
| 21 §1h | "Manage in Calendar" border, "No date" ink (r21:138-139) | 27d4b367; ink read at `database.css:132, 364` | DONE |
| 21 §1l | View settings header and close (r21:177) | 6449cac3, 75c02d41 | DONE |
| 21 §1m | Light side peek hovers | 6449cac3 (r26 §5f) | DONE |
| 21 §5 | Template cadence (r21:233-245) | none | PARTIAL: months row "On the [1st] [Day]"; At / Starting / Ending / Timezone submenus; ↻ tooltip in the template list ("Duplicate weekly" etc.). Banner summary: not re-checked. |
| 23 §1 | Date picker submenus | e026c279 (UTC), 6449cac3 (Date / Time format 180 wide, `database.css:5587-5591`) | PARTIAL: fuzzy zone search, a "Current timezone" section and "No results" (r23:39-41). Blok matches a substring (`cells/date-editor.ts:833`). Notion's legacy aliases are not added (e026c279, deliberate). "Learn about reminders" (r23:19, r08:307): PARTIAL, no help-URL lever. |
| 23 §4 | Backlinks path | 2a301691 | DONE |
| 23 §8 | Gallery focus after a peek (r23:266-279) | none | PARTIAL: after a peek opened from a selection closes, restore the selection and keyboard focus. After a plain-click peek, select nothing. |
| 23 §10 | New data source | 12e403f9, 0438b73b, a8849f2e | DONE |

## 3. Deliberate differences from Notion

Carried from ledger 25 (still true at 8b4df4b2 unless noted):
- Map pin card waits 300ms to show (hint-delay law); hide matches at 55ms.
- "Discard" is outlined, not filled red.
- Dark "New" button hover is rgb(36, 115, 201) for AA.
- Thank-you screen keeps Blok's text.
- Per-view manual order: on for local documents, opt-in for adapters.
- AA-adjusted grays; light "Today" / "Now" and "Add sort" / "Delete sort" use Blok's secondary token (Notion's rgb(142, 139, 134) is 3.39:1; 2f783bd5 keeps it).
- Number by Range page keeps Unique / Range rows (r26:276).
- Browser Back is held only when cancelable.
- Layout tab reorder: Content has no handle; the row page list has no handle.
- Undo on a read-only block waits until the block opens.
- Deleting the last view of a source keeps the source by default. This matches Notion's default (r26:260). Blok also offers "Delete view and data source" (2daf4b2e).

Changed since ledger 25:
- **Picking another source** now drops every filter and keeps only the title sort, as Notion does (03010a9c, r27:257-270). Ledger 25's "keeps filters and sorts" is gone.

New this round:
- **"/" entries keep a preview card** on every entry, with Notion's hint text as the caption (user rule; 0ac38e6b, 7dd143aa). Notion shows a dark hint and no card (r28:58-61).
- **Selection bar count stays gray**, not Notion's blue (no-blue law; 75c02d41, r26:148).
- **View settings × does not take first focus** on open; the first row keeps it (75c02d41; Notion focused it after a keyboard open, r26:175).
- **CSV import keeps file column order and row order** (Notion sorts columns and reverses rows, r27:180-181), and keeps Blok's notifier instead of an "Import complete" dialog (1b480bdf).
- **Template picks are ringed in primary ink**, not blue (45ae9276).
- **Back from "Link to existing" keeps the search variant** of the "New data source" panel (2daf4b2e). Notion went back to the AI-box "New database" panel (r26:120). 2daf4b2e's reason was "no AI setup lever"; 10fb951b added one. Not re-checked whether that should change.
- **Primary database title property stays "Title"**; only new sources use "Name" (0438b73b).
- **The "New database" panel opens on every user insert**, including the first Table insert on a page (70c53f5e; user decision 2026-10-20).
- **Tooltip colours stay Blok's** (user decision 2026-10-20). Notion uses one look in both themes (r26:194).

## 4. Open / not built

### PARTIAL (measured, not built)

See list A (§6). Each entry there cites its research line.

### OPEN (no research line, or not re-checked)

From ledger 25, no commit since d43c6a77 names them. Not re-checked:
- Dashboard widgets draw only table and list layouts (5d4a7cdc).
- Per-view manual order in exports, agent tool actions and `moveRowTo` (20ecb059).
- Cell editors outside the table open below (a7d0015d).
- Row page link value is not shortened (4212d984).
- Paste / fill of a date brings no reminder default; bulk does not pre-fill the first row's reminder (7e8d2df8, 8122d583).
- Adding a property reveals it only in table and form legacy views (a9309dff, 36fd7f39).
- Board / gallery margin lasso selects the database block (3d0e96f5).
- Board and list cards: Shift-click block range (3e9f6968).
- Server (dotnet) writers of createdBy / lastEditedBy ignore anonymous answers (4c45c0e2).
- Row "Move to" another document.

New:
- Remote linked views: host write callbacks for remote rows; "+" add-view on a remote linked view (d005c5bc).
- Old-peer orphan: a peer from before 19775e8c deletes only the database block (`it.fails` at `database-delete-cascade.integration.test.ts:837`).
- Empty PDF / Drive / Figma placeholders in template row bodies (45ae9276, Blok keeps no empty embed).

### BLOCKED

- Paid plan: P1-P7 (§1); Dashboard view and chart entries in "/" (r28:136-137).
- Needs a host page lever: Database - Full page (r28:134).
- User decision: permissions by design (BU2); one-level Escape on every menu (369eab1a); layout draft limit 1 (BU1).
- Separate product: what "Manage in Calendar" opens (r27:192-194).

### UNMEASURED

Struck since ledger 25 because research 26-27 measured them: default time and Short date in other years (r27 §4); dark reminder blue, link underline, brown hues, timeline grid and arrow, gallery inks (r26 §4); picking another source (r27 §5); Import CSV and template paths (r27 §1-2); Content of the "New data source" panel (r26 §2); deleting the last view (r26 §5a); Range back to Unique (r26 §5c).

Still unmeasured: everything in list B (§7), plus the items blocked in a measuring session:
- Undo on a read-only block; table undo scroll to an off-screen cell. Cmd/Ctrl combos are not forwarded through the extension (r26:318).
- Side peek at a narrow window. The user's window cannot be resized (r23:341, r26:318).
- Dark favorite star. Favoriting is forbidden in the session (r26:308).
- Other users' reaction pills. Probably needs a second account; unverified.
- "Email me a copy". It sends mail.
- AI box keys and submit (would spend AI credits, r26:316).
- Dashboard and chart inserts (paid / quota, r28:159).

### 4b. Commit-body sweep (d43c6a77..8b4df4b2)

Every hit for "not built", "unmeasured", "unverified", "not verified", "open" (as a status), case-insensitive. "Closed by" names the later commit in this window.

| hit sha | what it said | state |
|---|---|---|
| 12e403f9 | Not built: Suggested templates; AI prompt; panel on a new inline database | Templates: closed by 45ae9276. AI prompt: closed by 10fb951b. Inline panel: closed by 10fb951b, 70c53f5e. |
| 12e403f9 | Closing the panel keeps the empty source: Notion UNMEASURED | Measured r26:116 (Notion keeps it). Matches. |
| 12e403f9 | research/26 panel look not landed | Closed by 2daf4b2e, 75c02d41, 6449cac3. × button: PARTIAL (OU7). |
| 3a33ffca | — | No hit. |
| 75c02d41 | "Manage in Calendar" not built, target UNMEASURED | Closed by 27d4b367 (host lever). Target: BLOCKED (separate product). |
| bd3a7ebf | Which variable decides the default time UNMEASURED; empty cell commits nothing | Closed by c7995bec (today vs other day, r27:229) and a2f13321 (fills today). hh:00 / 23:xx: UNMEASURED. |
| 2daf4b2e | Delete-last-view default focus UNMEASURED | Open (UNMEASURED). |
| 2daf4b2e | Filters stay on a source switch (UNMEASURED) | Closed by 03010a9c. |
| 2daf4b2e | "A database block does not take its children with it" | Closed by 19775e8c. |
| 2daf4b2e | Back keeps the search variant; no AI lever | Lever added by 10fb951b. Kept as a deliberate difference (§3), not re-checked. |
| 19775e8c | `it.fails` (open): old-peer orphan; replace re-homes rows; 0 deleteRow calls | Replace: closed by e053752e. deleteRow: closed by 9a405ad6. Old-peer orphan: OPEN. |
| 10fb951b | Blok choices (unmeasured): Enter sends, busy state, rejection text, dark placeholder | UNMEASURED (AI; excluded from list B). |
| 10fb951b | "autofill stays required" | Closed by 7c2462c9. |
| 48d043d5 | New database panel shows no Import CSV | Closed by 70c53f5e. |
| ccd26944 | Relative in the field (unmeasured) | Open (UNMEASURED). |
| 45ae9276 | Not built: Suggested rotation, More templates, database icon, view icons, "Undo Task database", "New task" default template, embed placeholders | PARTIAL (list A) except view icons (not re-checked) and embed placeholders (OPEN, Blok choice). |
| 45ae9276 | Panel opens only with the lever | Closed by 70c53f5e. |
| 45ae9276 | Blok choices (unmeasured): chip semantics, Gantt / My Projects rules, first-row body only | Open (UNMEASURED, r27:322). |
| 27d4b367 | Calendar views get no button: not measured | Measured since (r28:129). PARTIAL. |
| 27d4b367 | Arrow dark ink unmeasured | Open (UNMEASURED). |
| c7995bec | Not built: fill today on an empty cell | Closed by a2f13321. hh:00 / 23:xx: UNMEASURED. |
| 1b480bdf | Not built: preview, headers switch, date-format submenu, "Import complete", "Learn about imports" | Preview, switch, Learn: PARTIAL (list A). Date-format submenu: UNMEASURED (r27:171). Import complete: deliberate (§3). |
| a2f13321 | hh:00 and 23:xx unmeasured; bulk per-row unmeasured | Open (UNMEASURED). |
| 18b30fb5 | End date in an empty cell unmeasured | Open (UNMEASURED). |
| 70c53f5e | Panel top without AI never measured | Open (UNMEASURED; only reachable on a workspace without AI). |
| 7198f343 | First layout of `/database inline` not recorded | Measured since: Table (r28:133). Matches. |
| 7dd143aa | Not built: other view entries; order not measured | Closed by 0ac38e6b (r28 §1a order). |
| 0ac38e6b | Not built: Dashboard view (paid), five charts, Database - Full page | BLOCKED (§4). |
| d005c5bc | Not built: remote row writes; "+" on a remote linked view | OPEN. |
| 2f8b7ddf | Re-stamping `draft.by` not built | By design; BU1 row 3 DONE (closed differently). |

## 5. Release notes owed (delta since ledger 25)

Ledger 25 §5 is still owed in full; this adds to it. User decision (2026-10-20): database-only changes are not BREAKING.

Public API added:
- `config.calendar` / `DatabaseCalendar` with `manage({ databaseId, viewId })` and `label` (27d4b367).
- `DatabaseAI.setupDatabase`, `DatabaseSetupRequest`, `DatabaseSetup`; `DatabaseAI.autofill` is now optional (10fb951b, 7c2462c9).
- `config.linkedSources.search` and `subscribe`; `resolve` may return `title` and `views`; types `DatabaseLinkedSourceHit`, `DatabaseLinkedSourceSnapshot` (d005c5bc).
- `BlockTool.removed()` gets `{ deleted: boolean }`; React / Vue / Angular `onRemoved(block, removal)` (e053752e).
- Popover item `searchSuffix` and `data-blok-popover-item-search-suffix` (0ac38e6b).

Behaviour changes:
- **Popover search tie order** (core, every searchable popover): at the same score, a title match ranks above an alias match (0ac38e6b).
- **Events dispatcher: net change none.** 16ff5df6 was labelled BREAKING; 4d108636 reverted it, so `api.events` forwards return values as in v1.16.1. Do not copy the BREAKING label. One real fix remains: a `once` listener no longer skips the next listener (83ec5a6f).
- Deleting or replacing a database deletes its rows, sources and comments; the tool manifest says `children.deletedWithParent: true` (19775e8c, e053752e). Migration: move rows out first.
- Adapters get `deleteRow` on local deletes and `createRow` on undo, paste and duplicate (9a405ad6).
- "/" Database section entries and seeds; the "New database" panel on every user insert (0ac38e6b, 70c53f5e).
- Short date never shows a year; picker field follows the Date format (1006d89d, ccd26944).
- Include time fills today at the next whole hour, or 9:00 on another day (c7995bec, a2f13321).
- A source switch drops filters and keeps only the title sort (03010a9c).
- Edit property opens on ArrowRight / Enter; Escape closes one level in the property header menu only (369eab1a).
- A room reset with an open layout draft no longer locks the maker's editor (2f8b7ddf).

## 6. List A: measured but not built

Each item is one lane.

1. **Calendar view "Manage in Calendar" button.** Notion shows it on the Calendar view toolbar (r28:129). Blok shows it on the timeline toolbar only (27d4b367). Reuse the timeline button and `config.calendar`. Small.
2. **Timeline off-screen arrow chip hover and icon size.** Hover bg rgb(56, 56, 54) light, rgb(230, 229, 227) dark; icon 14x12 (r26:222). Blok has no hover and a 12x12 icon (`database.css:8548-8566`). Small, CSS only.
3. **× close on the "New database" / "New data source" panels and the "Link to existing" page.** 20x20 round, rest rgba(42, 28, 0, 0.07), hover rgba(42, 28, 0, 0.106) (r26:38-40, r26:91). Reuse `panelCloseButton` from View settings (`database-view-settings-panel.ts:257`). Small.
4. ~~**Property menu "(i) Add property description" button**~~ DONE in round 10 (r30 X2): inline field, no menu item. Still open: the header cell's description icon and its dark tooltip (r30 X2 last bullet).
5. **CSV import: right-hand preview and "Use first row as headers".** Preview titled with the file name, skeleton before a file (r26:117, r27:142). Switch on by default (r27:151). What "off" does is unmeasured, so build the switch only after list B item 9. Medium.
6. **Help-link lever: "Learn about reminders" and "Learn about imports".** Last row of the date picker (r23:19, r08:307); a link in the CSV dialog (r26:117). Needs one generic host help-URL lever; without it, show nothing. Small.
7. **Time zone list: fuzzy search, "Current timezone" section, "No results".** "tok" finds Vostok, Tokyo, Vladivostok…; "zzqx" shows "No results"; the current zone sits in its own section with a check (r23:39-41). Blok matches a substring (`cells/date-editor.ts:833`). Small.
8. **Template cadence editor leftovers.** Months row "On the [1st] [Day]"; At / Starting / Ending / Timezone submenus (r21:233); ↻ tooltip in the template list, "Duplicate weekly / daily / monthly / yearly" (r21:237-245). Medium.
9. **Gallery: restore selection and focus after a peek closes.** Peek opened from a selection: re-select the card and focus it, so the first ArrowDown moves on. Plain-click peek: select nothing (r23:266-279). Small.
10. **Suggested templates: rotation, database icon, Undo row, default template.** Suggested shows the first three unused templates (r27:19-26; the rule is an inference there). The database gets an icon (r27:42), View settings gets "Undo … database" (r27:43), and New ▾ gets a Default template such as "New task" (r27:44). Needs a database icon field. Medium.
11. **"More templates" gallery.** A modal with "Empty database", "Existing data sources" cards and a 21-entry "Templates" list that expands in place (r26:118, r27:120-127). Only three schemas are measured, so the other 18 cards can only list titles. Large; build after list B item 10.

## 7. List B: unmeasured, measurable in one Free-plan session

No paid features, no AI, no charts. Items marked (clock) need the session timed to the wall clock.

1. Default time when Include time turns on at exactly hh:00 and during 23:xx (r27:232). (clock)
2. Turning End date on in an empty date cell (18b30fb5).
3. Delete-last-view dialog: which control has focus on open (2daf4b2e).
4. Dark: "Manage in Calendar" trailing arrow ink (27d4b367); the "/" menu, its hints and "· Database" suffix (r28:166).
5. Light View settings row `:active` fill (r27:279).
6. Relative date format: what the picker field shows for nearby days (ccd26944).
7. "/" menu: whether the first Table insert on a fresh page skips the panel (r28:160); the inline Table view's rendered name (r28:161); why Feed lists no properties (r28:162); full-page database View settings (r28:163); hint delay and position (r28:164); ArrowUp / ArrowDown and wrap (r28:165).
8. Template Customize modal: what each feature chip and view card adds or removes (r27:322); which Board card layout the templates pick (r27:319); Status "Not started" colour and CSV-made Select colour names (r27:320).
9. CSV import: the Date type's date-format submenu; "Use first row as headers" off; Phone, Person and Status detection; merging into an existing database (r27:318).
10. Schemas of the other "More templates" entries (Document Hub … Asset Library), at least the first page (r27:323).
11. Calendar: does Escape clear a selection made by an inside-grid drag box (r23:340).
12. Board: 99+ toggle scope per view; "Out of range" under a descending sort; date spans under a day (r23:339, ab1e8c9d, 25caf2c3).
13. Backlinks: 20+ sources (overflow, scroll, "show more"); order by mention time or source edit time (r23:343).
14. Map: is a pin a link; 100+ pins and clustering; colours other than green; warm window between pins (r23:344).
15. Form: Created by with anonymous off; what "View my response" opens (r23:345).
16. Layout builder: leaving by a sidebar click; draft after an accepted reload (r23:346); whether the Content tab moves in the layout list (02b29ae0).
17. "Hide data source titles": per view or per block (r23:347).
18. Gallery: whether Cmd-click opens a tab outside the current one (r23:348).
19. Reminders: alarm on feed cards and the row page value (add24f32); reminder lane gap (1cfc61d9); bulk: other types open empty, Remind before a date, first row's reminder (8122d583); paste default (7e8d2df8).
20. Escape in the title cell, a place address and bulk editors (e08c4eeb).
21. Timeline snap at zooms other than Hours (44278fec).
22. Sort-row drag motion (OU20).
23. "N more…" overflow list: do arrows reach the "N more…" button (372b0728).
24. Side peek handle hover look (56cb94c2).
25. Time zone list max height (320px?) and row boxes (e1eefe62).
26. Board calc "<calc> in <property>" hint and sub-grouping (ab1e8c9d; chart X-axis excluded).
27. Light leftovers named in commits: title ink, hovers, padding (c7b979bb); chip label, visibility at rest, selected-card ring (218fec5b); dark gutter (b8cddcef); coloured-card hover in hues other than brown and blue (8396d0eb).
28. Adding a property: does it show in board, gallery, list and calendar views; relation tabs (36fd7f39, a9309dff).
