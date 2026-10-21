# Database Notion-parity status after round 12 (2026-10-21)

Supersedes `29-parity-status-2026-10-21.md` (committed as e87ab3c8). This file is the status of record. Ledgers 21, 24, 25 and 29 are history. Nothing here points back to them for a live item.

This is a read-only status. Evidence is at **34022555** (origin/main when written, the r12 escape-editors landing). No tests were run for this file. Every cited test path was checked to exist at 34022555 (`test -e`). Every cited SHA was checked with `git merge-base --is-ancestor <sha> 34022555` (85 SHAs). The only three that fail are the r12 branch SHAs below, which are named only to say they landed under new SHAs.

## Inputs

- Ledger 29: list A (§6, 11 items), list B (§7, 28 items), every §1 / §1b / §2 row, §3 and §4.
- Research 30 (round 9, list B of ledger 29, plus X1 and X2) and research 31 (round 11).
- `git log e87ab3c8..34022555`: **78 commits**.
  - **22 excluded**: the `assistant`, `agent` and `agent-models` commits (Ask AI bar, in-editor agent, model adapters). They change no database surface.
  - **56 used**: 27 `feat(database)`, 12 `fix(database)`, 8 `test(database)`, 2 `docs(database)` (2dd70cde research 30, fbba7efa research 31), 2 popover core (1b060507, 7bf5c4c6), 2 selection core (e97cd1b0 lasso, 3549838d cross-block text drag), and 3 gate commits: bb6eedb7 (URL-sink law exemption), b01c2aac (code budget 14.3 MiB, user decision), 420c0f1e (CSS budget and snapshot for an assistant rule; included only because it unblocked the CSV landing).
  - Every used body was read in full, not only grepped. The grep words were "not built", "unmeasured", "unverified", "deviation", "not copied", "open". The deviations were also collected from other phrasings: "Not the same as Notion", "Left out on purpose", "Known difference", "Left as is", "Not as measured", "Blok's choice".
- The r12 lane's branch commits 77381916, 1b3650a4 and 622daaae landed as **34022555**, **0f800b68** and **7022a450**. The bodies and file lists are identical. Only the main SHAs are cited.

## Status rule

- **DONE**: what Notion showed is built. A DONE row can still carry tagged leftovers.
- **DEVIATION**: Blok differs on purpose. The reason is always given: a user rule or decision, data loss, or a11y. If a difference only exists because a lever is missing, it is PARTIAL, not DEVIATION.
- **PARTIAL**: Notion was measured and Blok has not built it. The citation names what is missing.
- **UNMEASURED**: Notion was never observed, or the reading is unresolved. The item says what to measure.
- **BLOCKED**: needs a paid plan, a backend, a second account, the desktop app, or a user decision. The item says which.

Mapping from ledger 29's sixth tag: **OPEN** (no work, no research line, only a commit body says "not built") is carried as **PARTIAL (no research)**, unless a commit since closed it. If no commit in this window names it, it is marked "not re-checked".

Research references: `r30 §B6` means research 30, section B6; `r31 §4b` means research 31, section 4b. Older research keeps ledger 29's `r27:44` line style.

## 1. Ledger 29 list A (measured, not built at e87ab3c8)

| # | item | status | evidence (sha · test / file:line) | left |
|---|---|---|---|---|
| 29-A1 | Calendar view "Manage in Calendar" button | DONE | **623442aa** calendar toolbar button, same `config.calendar` lever as the timeline · `test/playwright/tests/database/database-manage-calendar.spec.ts`, `test/unit/tools/database/database-calendar-view.test.ts` | Calendar icon size not measured (timeline's 16px reused). Dark: no trailing arrow on the toolbar button, pinned in **02b68bd8** (r30 §B4). |
| 29-A2 | Timeline off-screen chip hover and icon | DONE | **623442aa** hover rgb(56, 56, 54) / rgb(230, 229, 227), icon box 14x12 · `test/unit/styles/database-timeline-css.test.ts` | The glyph stays Blok's chevron. Notion draws a filled straight arrow. 623442aa gives no reason. See C. |
| 29-A3 | × on "New database", "New data source", "Link to existing" | DONE | **8b3784a9** `panelCloseButton` on all three; closing keeps the new view and its empty source (r26:116) · e2e `database-new-data-source.spec.ts`, `database-new-database-ai.spec.ts`, `test/unit/styles/database-notion-elements-css.test.ts` | — |
| 29-A4 | Property description (i) and header icon | DONE | **5d55304b** (i) opens an inline field in the menu (r30 §X2); 8b3784a9's submenu is gone. **10122e37** header icon, then **c9816f56** hint on the whole header cell, name over description (r31 §1). 73557552 fixed (i) with a submenu open · `test/unit/tools/database/database-property-menu.test.ts`, `database-table-view.test.ts`, `test/unit/components/utils/tooltip.test.ts`, e2e `database-notion-elements.spec.ts` | DEVIATION: field look, hint delay, hint colours (C). UNMEASURED: (B) 9, 10. PARTIAL: (A) 10. |
| 29-A5 | CSV import preview and "Use first row as headers" | DONE | **a28a9343** preview (skeleton "New table", then the file name, then the table to be made), switch on by default, "Column N" with headers off, Date read-format submenu, Phone from values · `test/unit/tools/database/database-csv-import-dialog.test.ts`, `database-csv.test.ts`, e2e `database-csv-import.spec.ts` | DEVIATION: the Date submenu opens on hover; Status keeps values. Differs, no reason stated: the preview updates when the switch flips; file row order (C). |
| 29-A6 | Help-link lever | DONE | **7ea963c2** `config.helpLinks { reminders?, imports? }` (`types/tools/database.d.ts:507`, `:1546`), through safeHref; **2ad8fdaa** label ink rgb(125, 122, 117) · e2e `database-help-links.spec.ts`, `test/unit/architecture/url-sink-law.test.ts` (bb6eedb7) | UNMEASURED: "Learn about imports" hover and dark ink; the link on the Setup step ((B) 7). |
| 29-A7 | Time zone list: fuzzy search, "Current timezone", "No results" | DONE | **7ea963c2**, **2ad8fdaa** three-rank fuzzy rule (`src/tools/database/cells/date-editor.ts:876-920`); **37eb3029** rows 45 tall, 46 apart, no max-height (r30 §B25) · `test/unit/tools/database/cells/date-editor.test.ts`, e2e `database-cell-editor-look.spec.ts` | The rule is fitted to one sample. It adds Novokuznetsk for "tok", which Notion did not show. PARTIAL: zone list content ((A) 12). UNMEASURED: menu top edge and taller windows ((B) 17). |
| 29-A8 | Template cadence editor leftovers | DONE | **2622fefb** "On the [Nth] [Day]" months row; At / Starting / Ending / Timezone rows with submenus. ↻ "Duplicate weekly" hint at the right edge: **1b060507** core submenu flip (r30 §X1) · e2e `database-template-repeat.spec.ts`, `test/unit/tools/database/database-template-menu.test.ts`, `test/unit/components/utils/popover/popover-desktop.mutants.test.ts` | UNMEASURED: the submenus' contents in Notion, the second list's choices (Nth weekday, "Last"), what "Around midnight" means ((B) 15). PARTIAL: the flipped submenu's position ((A) 9). |
| 29-A9 | Gallery selection and focus after a peek | DONE | **ff501a48** a peek opened from a selection re-selects the card and focuses the gallery; a plain-click peek selects nothing · `test/unit/tools/database/database-gallery-view.test.ts`, e2e `database-item-selection.spec.ts` | DEVIATION: focus goes to the gallery (C). |
| 29-A10 | Suggested rotation, database icon, Undo row, default template | DONE | **e8175123** "first three unused" (inferred rule), saved `icon` / `starter` (`types/tools/database.d.ts:1018-1024`), "Undo Task database", "New task" / "New project" default templates; **48aa5c7b** unknown icon / starter survive a save · `test/unit/tools/database/database-starters-panel.test.ts`, `database-template-menu.test.ts`, e2e `database-starters.spec.ts` | PARTIAL: the board's "+ New task" label ((A) 6). UNMEASURED: what Notion's Undo row does; Projects' "Turn into" (r27:81) ((B) 6). PARTIAL (no research): exporting the icon (e8175123). |
| 29-A11 | "More templates" gallery | DONE (9 of 21 templates) | **94430f18** gallery modal, Document Hub, Brainstorm Session, Meeting Notes, Goals Tracker, Customize chips and view cards; **f9dc0d25** preview follows the card just turned on; **5ad8f19f** Campaign Management, Content Calendar, Goals' Quarter and Progress; **fb2da66e** + **c1072b25** Days until due · `test/unit/tools/database/database-starters-more.test.ts`, `database-starters-panel.test.ts`, `test/unit/tools/database/formula/errors.test.ts`, e2e `database-starters.spec.ts` | UNMEASURED: 12 schemas ((B) 6). PARTIAL: preview fidelity, Status DEFAULT, per-view group order, card layout ((A) 6-8). Excluded: "More in Marketplace". |

## 2. Ledger 29 list B (unmeasured at e87ab3c8)

| # | item | measured in | status | evidence | left |
|---|---|---|---|---|---|
| 29-B1 | Default time at hh:00 and 23:xx | r30 §B1 | DONE for hh:00 | 01:00:07 gives 2:00 AM. Blok already took the next hour; pinned in **59033d20** · `test/unit/tools/database/cells/date-editor.test.ts` | UNMEASURED (clock): 23:xx; the exact second hh:00:00. |
| 29-B2 | End date on in an empty cell | r30 §B2 | DONE | **59033d20** writes today → today at once · `test/unit/tools/database/date-reminders-bulk.integration.test.ts`, e2e `database-date-and-range-rules.spec.ts` | UNMEASURED: the same in a bulk edit (59033d20). |
| 29-B3 | Delete-last-view dialog focus | r30 §B3 | DONE | **bf7f110f** 24x24 × "Close" takes focus on open, no ring on a click · `test/unit/tools/database/database-confirm-dialog.test.ts`, `new-data-source.integration.test.ts`, e2e `database-new-data-source.spec.ts` | DEVIATION: keyboard ring, `role=radio` (C). PARTIAL: menu stays open behind the dialog ((A) 3). UNMEASURED: light × fill and position. BLOCKED: Tab order (Tab untrusted in the session). |
| 29-B4 | Dark: Manage arrow, "/" menu, suffix | r30 §B4 | DONE | **02b68bd8** `--blok-popover-search-suffix-text` rgb(161, 158, 153) light, rgb(125, 122, 117) dark (`src/styles/colors.css:228, 698, 900`). Manage arrow and toolbar buttons pinned, no code change · `test/unit/components/utils/popover/search-suffix.test.ts`, `test/unit/styles/database-notion-elements-css.test.ts` | PARTIAL: suffix size and dark label ink ((A) 5). DEVIATION: hint colours (C). |
| 29-B5 | Light View settings row `:active` | r30 §B5 | DONE | **279d2ea6** `--blok-database-panel-row-active-bg` light rgba(33, 27, 23, 0.102) · `test/unit/styles/database-notion-elements-css.test.ts` | The token paints every database panel row; Notion was read on "Sort" only. |
| 29-B6 | Relative date format | r30 §B6 | DONE | **59033d20** Today / Tomorrow / Yesterday, bare weekday in this Mon-Sun week, "Last" / "Next" weekday, else the full date; the field always shows the full date (undoes ccd26944). **7f1d3875** feed and row-menu times keep "N days ago" · `test/unit/tools/database/cells/date-format.test.ts`, `cells/number-date-format.test.ts`, `database-feed-view.test.ts`, `database-table-menus.test.ts` | UNMEASURED: a "start week on Monday" setting; Yesterday on a Monday; the feed and row-menu times. PARTIAL (no research): a typed "Last Monday" is not parsed back (59033d20). |
| 29-B7 | "/" menu leftovers | r30 §B7 | DONE for 7a, 7b | **42cf12b9** a Table view alone on the page opens no panel (`src/tools/database/index.ts:328`, `aloneSkipsPanel`); one-view name "Table" pinned · `test/unit/tools/database/database-new-database-ai.test.ts`, e2e `database-slash-entries.spec.ts`, `database-new-database-ai.spec.ts` (c8b80fb0) | PARTIAL: "Close menu esc" footer ((A) 4). UNMEASURED: what triggers the skip; Database - Inline on a fresh page; Feed with no properties; full-page View settings; cold hint delay; read-only one-view tab. DEVIATION: the skip vs. the 2026-10-20 decision, and preview cards (C). |
| 29-B8 | Customize chips, card layout, Status colour | r30 §10b, §10f, §10g; r31 §7c | DONE for chips and view cards | **94430f18**, **f9dc0d25**: chips add or remove columns, "N hidden properties", the last view card stays on. Status "Not started" is `gray` (same pill as measured). CSV option colours do not follow names: **a28a9343** · e2e `database-starters.spec.ts`, `test/unit/tools/database/database-csv.test.ts` | PARTIAL: card layout setting; Status DEFAULT and "no checked colour" ((A) 7, 6). UNMEASURED: which card-layout tile a template picks (r30 §10g vs r31, ring unclear). |
| 29-B9 | CSV: Date submenu, headers off, detection, merge | r30 §9a-f | DONE | **a28a9343** (submenu, headers off, Phone), **7bf5c4c6** (a click on Date picks Full date; ArrowRight opens formats), **916c47cb** (Merge opens the dialog with "Import Location"; headers map onto properties; unmatched columns become new properties), **cce1fa05** (never two "Name") · `test/unit/tools/database/database-csv-import-dialog.test.ts`, `database-csv.test.ts`, `test/unit/components/utils/popover/popover-parent-activate.test.ts`, e2e `database-csv-import.spec.ts`, `database-chart-feed-csv.spec.ts` | PARTIAL: merge matching and subtitle ((A) 1). DEVIATION: Status values kept, hover submenu. Differs, no reason stated: row order, merged rows shown at once (C). |
| 29-B10 | Other "More templates" schemas | r30 §10c-f; r31 §7a-b, §8 | UNMEASURED (the rest) | 6 more schemas were measured and built (29-A11). | UNMEASURED: Event Management … Asset Library (12, thumbnails only, r30 §10a). |
| 29-B11 | Calendar Escape after an inside drag box | r30 §B11 | DONE | One Escape clears it, a second does nothing. Already true; pinned by the e2e added in 4d776172 · e2e `database-item-selection.spec.ts` | Day clicks: §3, r31 §6. |
| 29-B12 | Board 99+ scope, Out of range, short spans | r30 §B12 | DONE for Out of range | **59033d20** "Out of range" stays after the ranges under a descending sort (fixes ab1e8c9d) · `test/unit/tools/database/group-keys.test.ts` | UNMEASURED: 99+ scope (the switch was disabled on 3 rows; needs a 100+ row database); spans under a day; where "No <property>" goes (r30 vs r23 disagree). |
| 29-B13 | Backlinks 20+ sources | — | UNMEASURED | not attempted (r30 "Not measured") | — |
| 29-B14 | Map pins | — | UNMEASURED | not attempted | — |
| 29-B15 | Form: Created by with anonymous off; "View my response" | — | UNMEASURED / BLOCKED | not attempted | "View my response" needs a submitted answer through the shared form link: excluded (sharing). |
| 29-B16 | Layout builder: sidebar leave, reload draft, Content tab | — | UNMEASURED | not attempted | — |
| 29-B17 | "Hide data source titles" scope | r30 §B17 | DONE | Per block. Blok already kept one block flag; pinned in **4e551f23** · `test/unit/tools/database/database-data-source-titles.test.ts` | UNMEASURED: where Notion shows the block-level Layout switch on a non-linked two-source database (4e551f23). |
| 29-B18 | Gallery Cmd-click | — | BLOCKED | r30 "Not measured": a new tab takes the extension relay | Whether a Cmd-click reaches the page is unverified. |
| 29-B19 | Reminders: feed / row page alarm, lane gap, bulk, paste | — | UNMEASURED | not attempted | — |
| 29-B20 | Escape in title, place, bulk editors | r30 §B20; r31 §4a-b | DONE | Title: **62bdd376** Escape saves. Place: **7022a450** a press outside an unpicked search keeps the saved place. Bulk: **0f800b68** date input shows today and saves a typed date on Escape; **34022555** Text keeps on Escape and clears the selection, Select Escape drops the typed option, Date Escape saves · `test/unit/tools/database/cells/text-editor.test.ts`, `cells/place-search.test.ts`, `cells/date-editor.test.ts`, `bulk-escape.integration.test.ts`, `database-table-bulk-clipboard.test.ts`, e2e `database-cell-editors.spec.ts`, `database-bulk-escape.spec.ts` | DEVIATION: Place keeps the value; focus after a title Escape (C). PARTIAL: Place view state ((A) 2). UNMEASURED: (B) 2. |
| 29-B21 | Timeline snap at other zooms | — | UNMEASURED | not attempted | — |
| 29-B22 | Sort-row drag motion | — | UNMEASURED | not attempted | — |
| 29-B23 | "N more…" and arrow keys | r30 §B23 | DEVIATION (arrows) / BLOCKED (Tab) | Notion's view tabs do not move focus with arrows. Blok's tab bar is a roving tablist (`src/tools/database/database-tab-bar.ts:124, 141`) | Whether focus reaches "N more…": BLOCKED, because Tab moved no focus in the session (untrusted). |
| 29-B24 | Side peek handle hover | r30 §B24; r31 §2 | DONE | **2247afee** no hover look on the handle, a "Resize · Drag" hint that follows the pointer; **1098f6d4** a click (under 4px) closes the peek, hint "Close · Click"; **cfc986c8** the click activates nothing behind · `test/unit/tools/database/database-card-drawer.test.ts`, `test/unit/styles/database-page-layout-css.test.ts`, e2e `database-peek-dark.spec.ts` | DEVIATION: hint delay, no ⌘\ (C). UNMEASURED: whether drags under ~10px close; ⌘\ in the desktop app (BLOCKED: desktop app). |
| 29-B25 | Time zone list height and rows | r30 §B25 | DONE | **37eb3029** (see 29-A7) | PARTIAL: zone list content ((A) 12). |
| 29-B26 | Board calc hint and sub-grouping | r30 §B26; r31 §3 | DONE | **ab7b4a53** hint above the value; picking a sub-group turns its "Hide empty groups" on (inferred from the outcome; r31 §3 then read it on). **50819bf5** band ▼ toggle folds the row, saved in `collapsedGroups` as `sub:<id>` · `test/unit/tools/database/database-board-count-hint.test.ts`, `database-board-view.test.ts`, `test/unit/styles/database-board-card-css.test.ts`, e2e `database-board-calculation.spec.ts`, `database-board-band-toggle.spec.ts` | DEVIATION: hint delay, chevron icon (C). PARTIAL: band card count ((A) 8). BLOCKED (second account): per-user vs. shared fold. |
| 29-B27 | Light leftovers (c7b979bb, 218fec5b, b8cddcef, 8396d0eb) | — | UNMEASURED | not attempted | — |
| 29-B28 | Added property in other views | r30 §B28 (board only) | DONE for board | Already true; pinned in **4e551f23**, **ed510447** · `test/unit/tools/database/database-new-column-visible.integration.test.ts` | UNMEASURED: gallery, list, calendar, relation tabs. |

## 3. Research 30 / 31 items outside list B

| item | status | evidence | left |
|---|---|---|---|
| r30 §X1 template list ↻ hint and "…" submenu side | DONE | **2622fefb** builds the hint; **1b060507** core flip: a submenu with no room on the inline end opens on the start side, for every beside-placed submenu · e2e `database-template-repeat.spec.ts` | PARTIAL: position ((A) 9). UNMEASURED: keyboard and chevron of a flipped submenu; cold delay of the "…" hint (one sample 2258 ms, one none). |
| r30 §X2 property description (i) | DONE | 5d55304b, 10122e37, c9816f56 (see 29-A4) | — |
| r30 §9e Select colours from CSV | DONE | a28a9343 pins "colours do not follow names" | — |
| r30 §9d Person mapped by hand | DONE | a28a9343 drops the values, as in Notion | UNMEASURED: workspace member names. |
| r30 §9d Status mapped by hand | DEVIATION | a28a9343 keeps the values as options (C) | — |
| r30 §9f merge rows appended, not matched | DONE | a28a9343, 916c47cb (unit + e2e) | Differs, no reason stated: merged rows show at once (C). |
| r30 §10a thumbnails | DONE for the 9 built templates | 94430f18, 5ad8f19f | UNMEASURED: Content Calendar thumbnail is a weekday row, not a drawn calendar (5ad8f19f). |
| r31 §1 header description hint | DONE | **c9816f56**: the hint hangs off the header cell; name, then description; padding 5px 8px, 12px / 16.8px, wraps at 280px, start edges aligned, 6px gap, flips below · `test/unit/components/utils/tooltip.test.ts`, `test/unit/tools/database/database-table-view.test.ts` | DEVIATION: delay, colours (C). PARTIAL: a header with no description ((A) 10). UNMEASURED: board, list and gallery headers; dark. |
| r31 §2 side peek click and ⌘\ | DONE | 1098f6d4, cfc986c8 (see 29-B24) | — |
| r31 §3 sub-group band toggle | DONE | 50819bf5 (see 29-B26) | — |
| r31 §4a Place editor | DONE (Escape, ×, pick) | **7022a450**: already saved on pick, × cleared, Escape cancelled; now a press outside cancels too | DEVIATION: a keystroke does not clear the saved place (C). PARTIAL: the post-pick view state ((A) 2). UNMEASURED: Place in a row page or peek; a press outside in Notion. |
| r31 §4b bulk editors | DONE | **34022555**, **0f800b68** (see 29-B20). Also fixed: a board / list bar repaint dropped the table's bulk selection; board / list bulk Select could not create an option | DEVIATION: bulk Place opens empty on mixed rows (C). UNMEASURED: Text Enter / press outside; a Select pick by click; bulk Number / URL; live preview on board and list (not built, no per-cell repaint there). |
| r31 §5 Merge with CSV | DONE | **916c47cb**, **cce1fa05** (see 29-B9) | PARTIAL: case-insensitive matching, Place offered, subtitle ((A) 1). Differs, no reason stated: chevron icon (C). UNMEASURED: names of unmapped columns with headers off in a merge. |
| r31 §6 calendar day clicks | DONE | **d6b531b5** a single click adds nothing (clears a selection); a double-click on empty space or the day number adds a page and opens it. Corrects 4d776172 / fbbc48d0 · `test/unit/tools/database/database-calendar-view.test.ts`, e2e `database-gallery-calendar.spec.ts`, `database-item-selection.spec.ts` | UNMEASURED: whether Notion's center peek is the view's open mode (Blok uses the view's); modifier double-clicks; whether "+" opens the page. |
| r31 §7a-b Campaign Management, Content Calendar | DONE | 5ad8f19f | UNMEASURED: Owner, Budget, Accounts, By Market, By Platform; Content Calendar icon; page templates behind "+ New campaign"; "Hide empty groups" on Status boards (r31 §7c, unresolved; Blok hides). PARTIAL: Files & media card preview draws an empty area where shot 51 shows none (5ad8f19f). |
| r31 §8 Goals Quarter, Progress, Days until due | DONE | 5ad8f19f; **fb2da66e** if() / ifs() branches of different types give type Any (shown as text); **c1072b25** chip · `test/unit/tools/database/formula/errors.test.ts`, `formula/math-logic.test.ts`, `database-starters-more.test.ts` | PARTIAL: preview column position; By Team group order ((A) 6). UNMEASURED: how a number branch renders, sorts and filters. |

## 4. Ledger 29 rows and their leftovers

Ledger 29 §1 rows that no commit in this window touched keep their status. Their leftovers are listed here so nothing is dropped.

| row | leftover | status now |
|---|---|---|
| OM1 linked view | host write callbacks for remote rows; "+" on a remote linked view (d005c5bc) | PARTIAL (no research), not re-checked |
| OM1 | row "Move to" another document | PARTIAL (no research), not re-checked |
| OM2 tab strip | Content tab moving; row page list handle; strip pill drag | UNMEASURED ((B) 21) |
| OM4 favorites | dark favorite star | BLOCKED: favorites excluded |
| OU1 dark | timeline chip hover; "/" menu dark; Manage arrow dark | DONE (623442aa, 02b68bd8) |
| OU2 calendar selection | board and list Shift-click range (3e9f6968) | PARTIAL (no research), not re-checked |
| OU3 reminder alarm | feed and row page value | UNMEASURED ((B) 21) |
| OU4 bulk reminders | End date in an empty cell | DONE (59033d20); bulk case UNMEASURED |
| OU6 "N more…" keys | arrows reaching "N more…" | DEVIATION on arrows, BLOCKED on Tab (29-B23) |
| OU7 new data source | × close; delete-last-view focus | DONE (8b3784a9, bf7f110f) |
| OU8 board calc | 99+ scope; short spans; Out of range | Out of range DONE (59033d20); rest UNMEASURED ((B) 4) |
| OU9 gallery | focus after a peek | DONE (ff501a48) |
| OU10 Escape | title, place, bulk | DONE (62bdd376, 7022a450, 0f800b68, 34022555) |
| OU11 backlinks | 20+ sources; order | UNMEASURED ((B) 21) |
| OU12 feed | other users' reaction pills | BLOCKED: second account (assumed; unverified) |
| OU13 map | pin link, 100+ pins, colours, warm window | UNMEASURED ((B) 21) |
| OU14 anonymous forms | server (dotnet) writers (4c45c0e2) | PARTIAL (no research), not re-checked |
| OU16 side peek | narrow-window breakpoint | BLOCKED: the window cannot be resized (r23:341) |
| OU16 | handle hover | DONE (2247afee) |
| OU17 per-view order | exports, agent actions, `moveRowTo` (20ecb059) | PARTIAL (no research), not re-checked |
| OU18 timeline | snap at other zooms | UNMEASURED ((B) 21) |
| OU19 builder | sidebar leave; draft after reload | UNMEASURED ((B) 21) |
| OU20 | sort-row drag motion | UNMEASURED ((B) 21) |
| OU21 editing look | drawer, form and bulk editors open below (a7d0015d) | PARTIAL (no research), not re-checked |
| BU1 layout drafts | not cleaned while a maker's tab is open; a v1.16.1 client drops the draft mark | unchanged. `git log e87ab3c8..34022555 -- src/tools/database/layout-drafts.ts` is empty. BLOCKED: user decision / holds |
| BU2 permissions | host `api.blocks` writes, headless planner, per-row answers | BLOCKED: user decision (by design) |
| BU2 | undo on a read-only block | UNMEASURED; needs Cmd+Z in the session (see B, blockers) |
| delete cascade | old peer deletes only the source block | PARTIAL (no research): `it.fails` at `test/unit/tools/database/database-delete-cascade.integration.test.ts:837`. 748608c1 fixed only the stale column e2e |
| ledger 29 §1b "/" section | Dashboard view, five charts | BLOCKED: paid plan / chart quota |
| ledger 29 §1b | Database - Full page | BLOCKED: needs a host page lever (`PageConfig.create` has no initial content) |
| ledger 29 §1b Manage in Calendar | what the link opens | BLOCKED: separate product (r27:192-194) |
| ledger 29 §1b Edit property keys | one-level Escape on every other menu | BLOCKED: user decision (369eab1a) |
| ledger 29 §1b templates | PDF / Drive / Figma placeholders | DEVIATION (Blok keeps no empty embed, 45ae9276) |
| ledger 29 §2 cadence | banner summary | not re-checked |
| ledger 29 §2 date picker | "Learn about reminders" | DONE (7ea963c2) |
| ledger 29 §4 OPEN list | dashboard widgets draw only table and list (5d4a7cdc); row page link not shortened (4212d984); paste / fill date reminder default (7e8d2df8, 8122d583); added property revealed only in table and form legacy views (a9309dff, 36fd7f39); board / gallery margin lasso selects the block (3d0e96f5) | PARTIAL (no research), not re-checked. e97cd1b0 changed the core lasso's scroll tracking only; the margin case was not re-checked. |
| paid rows P1-P7 | dashboards, form logic, submit screen, automations, button mail / webhook / Slack, Verification, chart look | BLOCKED: paid plan. No commit. |

## 5. Commit-body sweep (e87ab3c8..34022555)

A hit means the body said "not built", "unmeasured", "unverified", "deviation", "not copied" or "open", or used a deviation phrase. "→" gives where the hit is now.

| sha | hit | → |
|---|---|---|
| 623442aa | calendar icon size not measured; glyph stays Blok's chevron | (B) 22; C (glyph) |
| ff501a48 | — (Blok focuses the gallery where Notion loses the first ArrowDown) | C |
| 2622fefb | submenu controls not measured; second list choices and "Around midnight" not built; ↻ hint hidden at the right edge | (B) 15; hint closed by 1b060507 |
| e8175123 | Suggested rule INFERRED; Undo row action UNMEASURED; default template body UNMEASURED; not built: board "+ New task", More templates, later templates, icon export | (A) 6; (B) 6; More templates closed by 94430f18 and 5ad8f19f; icon export PARTIAL (no research) |
| 48aa5c7b | — | — |
| 7ea963c2 | imports link hover / dark unmeasured; Setup step not measured | (B) 7 |
| 2ad8fdaa | dark label ink unmeasured | (B) 7 |
| 8b3784a9 | (i) click target, dark ink, glyph size unmeasured; "Property description" item kept | item closed by 5d55304b; rest (B) 9 |
| 1b060507 | Known difference: Notion's flipped submenu covers the list; keyboard / chevron unmeasured | (A) 9; (B) 16 |
| 37eb3029 | cadence Timezone stays a Popover list (no placeholder / ranking / section lever); Notion's version never measured; menu top edge, taller windows, bottom margin | (B) 15, 17 |
| 5d55304b | Not copied (user laws): tint fill, blue ring, 6px radius; reopen state, second click, Shift+Enter, growth, dark: Blok choices | C; (B) 10 |
| 59033d20 | week-start setting, ±1 at week edges, bulk End date, 23:xx, "No <property>" place, feed times; typed "Last Monday" not parsed | (B) 1-4; parse PARTIAL (no research) |
| 7f1d3875 | feed and row-menu times unmeasured | (B) 3 |
| 974d236a, 279d2ea6 | — (279d2ea6: token covers every panel row) | — |
| 02b68bd8 | Left as is: hint colours (user decision), label ink, suffix size, dark toolbar border | C; (A) 5; (B) 22 |
| bf7f110f | light × fill and position unmeasured; Left as is: Tab order, `role=radio`, menu closed behind the dialog | (B) 11; C; (A) 3 |
| 4e551f23 | block-level Layout switch not built (unmeasured where); r30 §B28 other views | (B) 18, 19 |
| 42cf12b9 | Not built: "Close menu esc" footer; unmeasured: skip trigger, Inline, Feed, full page, cold hint; read-only one-view tab | (A) 4; (B) 5 |
| 10122e37 | icon size / ink, hint anchor, click: Blok choices; not built: board / list / gallery / row page | anchor corrected by c9816f56; (B) 9 |
| a28a9343 | DELIBERATE DEVIATION Status values; hover submenu; preview live; not built: merge modal (closed by 916c47cb); headers-off title "Title" (closed by 916c47cb); ISO dates, Date property format, Person names unmeasured | C; (B) 7 |
| 7bf5c4c6 | — (public type widened, see §6) | — |
| 94430f18 | off chips / views, Upvote actions, row bodies, page icons, tints, dark, search, Escape, Compact/List: unmeasured or no lever | (A) 6, 7; (B) 6 |
| f9dc0d25 | preview draws a flat table (no groups, no reversed order) | (A) 6 |
| 62bdd376 | board card title and row page heading not changed (unmeasured); focus after Escape kept on the grid | (B) 8; C |
| ab7b4a53 | switch state inferred; band ▼ not built | ▼ closed by 50819bf5 |
| 4d776172, fbbc48d0 | plain click adds a page | superseded by d6b531b5 |
| 2247afee | Left out on purpose: "Close · Click or ⌘\" line | click closed by 1098f6d4; ⌘\ C |
| 6c554bd8 | `getByRole('tooltip')` did not find the hint with the peek open (cause not traced) | test-only, unexplained |
| 916c47cb | chevron icon; file row order; rows shown at once; subtitle unchanged; "Existing property" list, two columns on one property, no title column, headers off, taken name: Blok choices | C; (A) 1; (B) 7 |
| cce1fa05 | doubled "Name" rule unmeasured | (B) 7 |
| 50819bf5 | Not the same: 11px caret vs 16px chevron; card count kept; no hover hint; Cmd/Ctrl+Alt+T; per-user unknown | C; (A) 8; (B) 13 |
| 5ad8f19f | Days until due not offered (closed by fb2da66e, c1072b25); Hide empty groups unresolved; By Team order; "Status (1)" left out; unmeasured icons, thumbnails, DEFAULT lever, page templates, Post URL; empty Files & media preview area | (A) 6; (B) 6 |
| d6b531b5 | modifier double-clicks; menu-close with a selection; center peek vs view's mode | (B) 12 |
| c9816f56 | delay and colours (hint law, user decision); dark; plain name hint on undescribed headers kept | C; (A) 10; (B) 9 |
| 1098f6d4 | 4px slop; ⌘\ desktop | (B) 14; BLOCKED desktop |
| cfc986c8 | passthrough not reproduced | — |
| fb2da66e | number branch render, sort, filters, person / date / list print, prop(X)+1 | (B) 20 |
| c1072b25 | Not as measured: preview column position; with Due date off adds nothing; "Overdue" translated | (A) 6; (B) 6 |
| 7022a450 | Not copied (data loss): keystroke clears; not built: post-pick view state; unmeasured: row page / peek, press outside | C; (A) 2; (B) 8 |
| 0f800b68 | single-cell Escape with typed text; single empty cell's field | (B) 2 |
| 34022555 | Not copied (data loss): bulk Place first row; unmeasured: Text Enter, Select click, Number / URL, board / list live preview | C; (B) 2 |
| e97cd1b0, 3549838d | core selection fixes, no Notion item | §6 |
| a70f0154, ed696d8f, bb6eedb7, 73557552, 748608c1, ed510447, c8b80fb0, b01c2aac, 420c0f1e, 2dd70cde, fbba7efa | no hit | — |

## 6. Release notes owed (delta since ledger 29)

Ledger 29 §5 is still owed in full; this adds to it. User decision (2026-10-20): database-only changes are not BREAKING.

Public API added:
- `config.helpLinks` / `DatabaseHelpLinks { reminders?, imports? }`; icon `IconHelp` (7ea963c2).
- Saved database fields `icon: { glyph, color }` and `starter`; types `DatabaseIcon`, `DatabaseStarterId`; colour 'purple' (e8175123, 48aa5c7b, 5ad8f19f).
- CSS variable `--blok-popover-search-suffix-text` (02b68bd8).
- `types/utils/popover/popover-item.d.ts`: an item with children may carry `onActivate` (was `never`). A widening of a v1.16.1 type (7bf5c4c6).

Core behaviour changes (every editor, not database-only):
- A beside-placed submenu with no room at the inline end opens on the start side; `data-side` follows (1b060507).
- A row with children and its own `onActivate`: click / Enter run it, hover / ArrowRight open the children (7bf5c4c6).
- The rectangle lasso keeps every row it covers while anything scrolls, and ends on `buttons === 0` (e97cd1b0).
- A cross-block text drag follows the pointer while anything scrolls (3549838d).

Database behaviour changes: relative date words (59033d20); feed times keep "N days ago" (7f1d3875); End date fills today (59033d20); Out of range stays last (59033d20); a Table view alone on the page opens no panel (42cf12b9); Escape saves a title (62bdd376); calendar double-click adds a page (d6b531b5); side peek handle click closes (1098f6d4); band fold (50819bf5); CSV preview, headers switch, Date read format, Phone, Merge dialog, "Name" title (a28a9343, 7bf5c4c6, 916c47cb, cce1fa05); `mergeCsv(text)` adds unmatched columns (916c47cb); formulas with mixed branch types (fb2da66e); nine templates and the gallery (e8175123, 94430f18, 5ad8f19f, c1072b25); bulk editor Escape rules (0f800b68, 34022555); place press-outside (7022a450).

## (A) Measured, not built: lane-sized units

Each item is one lane. "Small" means about one commit.

1. **Merge with CSV matching.** (a) Match headers to properties ignoring case: Notion mapped "tag" onto "Tag" (r31 §5b). Blok compares names exactly (`src/tools/database/database-csv.ts:466`). (b) Leave Place out of "Existing property": Notion never listed "Where" (r31 §5b). Blok's `MERGEABLE_TYPES` includes `place` (`database-csv.ts:441-443`). (c) The subtitle ends "or merge it into an existing one" (r30 §9, r31 §5a). Blok's key reads "Create a new database with your CSV" (`src/components/i18n/locales/en.json:1769`; 916c47cb). Small.
2. **Place editor view state after a pick.** The popover stays open with a name chip, a "Clear location field" ×, a 232x168 map and an "Open in Google Maps" link (r31 §4a). Blok closes on a pick (7022a450 "Not built"). The look was read from a screenshot that was not kept, so take sizes beyond 232x168 again. Medium (needs the map render path).
3. **Delete-last-view dialog keeps View settings open behind it.** After Cancel, focus goes back to its "Delete view" row (r30 §B3). Blok closes View settings before asking (bf7f110f "Left as is"). Small.
4. **"/" menu footer "Close menu  esc".** ArrowUp from the first row reaches the footer (r30 §B7c). Blok's toolbox has no footer and wraps to the true last row (42cf12b9 "Not built"). This is a core toolbox change. Do not copy the lazy-render jump to the last rendered row. Small-medium.
5. **"/" search suffix size and dark label ink.** The suffix is 14px in Notion (r28 §1b), 13px in Blok (02b68bd8). The dark row label is rgb(240, 239, 237) in Notion (r30 §B4); Blok uses core `--blok-text-primary` #e2e0dc. Small, CSS (core token for the label).
6. **Template fidelity.** One lane, four parts:
   - The board's add button names the default template, for example "+ New task" (r27 shot 04; e8175123 "Not built").
   - The Customize preview draws a grouped view as groups, and Top Ideas in its reversed row order (r30 §10b). Blok draws a flat table (f9dc0d25). The Days until due column shows last in the preview, as Notion's does (r31 §8; c1072b25 "Not as measured").
   - A Status option can be the DEFAULT, with no checked colour ("Not started", "Idea") (r30 §10f, r31 §7a-b). Blok has no lever and checks Gray (94430f18, 5ad8f19f).
   - Per-view manual group order: By Team lists Account Management, Business Development, Human Resources, Product Design (r31 §8). Blok follows option order (5ad8f19f).
   Medium.
7. **Board "Card layout" setting (Compact / List).** Notion's board settings have the row "Card layout | Compact | List" (r30 §10d, §10f). Blok has no such setting (94430f18). Which tile each template picks is still unmeasured ((B) 6). Medium.
8. **Sub-group band header without a card count.** Notion shows no count (r31 §3). Blok keeps one (50819bf5). Small.
9. **Flipped submenu covers its parent.** At the right edge, Notion's template "…" submenu opens over the list, right edge 1364, just left of the "…" button (r30 §X1). Blok's opens outside the list's left edge (1b060507 "Known difference"). Core popover. Small.
10. **No hint on a header without a description.** Notion showed none after 2 s (r31 §1, one header). Blok keeps its plain name hint (c9816f56 "Not changed"). One sample only: re-check one more header first. Small.
11. **Empty Files & media card preview.** With no file, Notion's Campaign board card shows no preview area (shot 51). Blok draws an empty one (5ad8f19f). Small.
12. **Time zone list content.** Notion lists 568 rows, including Asmara (r30 §B25). Blok uses the browser's Intl list: 418 in headless Chromium plus UTC, and has no Asmara (37eb3029). This needs a bundled zone list. Medium, low value.

Carried without research (ledger 29 OPEN; each needs a look before a lane): remote linked-view writes and "+" (d005c5bc); row "Move to" another document; board / list Shift-click range (3e9f6968); dotnet anonymous writers (4c45c0e2); per-view order in exports, agent actions and `moveRowTo` (20ecb059); cell editors outside the table open below (a7d0015d); dashboard widgets only table / list (5d4a7cdc); row page link not shortened (4212d984); paste / fill reminder default (7e8d2df8, 8122d583); added property revealed only in table / form legacy views (a9309dff, 36fd7f39); margin lasso selects the block (3d0e96f5); old-peer orphan (`it.fails` at `database-delete-cascade.integration.test.ts:837`); database icon in exports (e8175123); typed "Last Monday" not parsed back (59033d20).

## (B) Unmeasured, measurable in one Free-plan session

No paid features, no AI, no charts or dashboards, no email, no favorites, no sharing. (clock) means the session must be timed to the wall clock.

1. Include time at 23:xx, and at the exact second hh:00:00 (59033d20). (clock)
2. Bulk editors: End date on with an empty first row; Text with mixed values on open; Text Enter and a press outside; a Select pick by click; Number and URL; whether board and list cells preview live. Single cell: Escape with typed text in the date field; the empty cell's field (59033d20, 0f800b68, 34022555).
3. Relative dates: a workspace "start week on Monday" setting; Yesterday on a Monday and Tomorrow on a Sunday; the feed byline and row-menu "last edited" times (59033d20, 7f1d3875).
4. Board: 99+ toggle scope on a 100+ row database (CSV import), since the switch was disabled on 3 rows; date spans under a day (25caf2c3); where "No <property>" goes in a range grouping (r30 vs r23).
5. "/" menu: what makes the panel skip (first block, empty page, or first database); Database - Inline on a fresh page; why Feed lists no properties; the full-page database's View settings; the cold hint delay; a read-only one-view database's tab (42cf12b9).
6. Templates: the 12 unread schemas (Event Management … Asset Library); Campaign Owner and Budget, Content Calendar Accounts, the By Market and By Platform view cards; the card-layout tile each template board picks; "Hide empty groups" on Status-grouped boards (r31 §7c); page templates behind "+ New campaign" / "New content"; the Content Calendar icon; what "Undo … database" does; Projects' "Turn into"; Customize search and Escape (e8175123, 94430f18, 5ad8f19f).
7. Help links: "Learn about reminders" dark ink (2ad8fdaa); "Learn about imports" hover, dark ink, and the Setup step. CSV: unmapped column names with headers off in a merge; two columns onto one property; no column matching the title; a taken name; the "Existing property" list for computed, person and file properties; ISO dates under Day/Month/Year; the created Date property's format; the doubled-"Name" case (7ea963c2, a28a9343, 916c47cb, cce1fa05).
8. Place editor inside a row page or peek; a press outside an unpicked search in Notion (7022a450). Escape in a board card's inline title rename and in the row page heading (62bdd376).
9. Header (i): what a click does; dark ink and glyph size; description hints on board, list and gallery headers and row page properties; dark hint (8b3784a9, 10122e37, c9816f56).
10. Description field: open on reopen without a click; a second (i) click; Shift+Enter; growth; dark (5d55304b).
11. Delete-last-view dialog: light × fill and its position (bf7f110f).
12. Calendar: modifier double-clicks; a click that closes a menu while events are selected; whether "+" opens the page; whether the double-click's center peek is the view's open mode (d6b531b5, 4d776172).
13. Sub-group band: a hover hint on the toggle (50819bf5).
14. Side peek: whether a drag under ~10px closes (1098f6d4).
15. Edit cadence: the At / Starting / Ending / Timezone submenus' contents in Notion; the second list's choices (Nth weekday, "Last"); what "Around midnight" means (2622fefb, 37eb3029).
16. A flipped submenu's keyboard and chevron (1b060507).
17. Time zone menu: the rule for its top edge; the bottom margin (37eb3029). Its height in taller windows is blocked (window size).
18. "Hide data source titles": where the block-level Layout switch shows on a non-linked two-source database (4e551f23).
19. An added property in gallery, list and calendar views, and in relation tabs (4e551f23).
20. Formulas with mixed branch types: how a number branch renders, sorts and filters, and which calculations are offered (fb2da66e).
21. Carried, never attempted: backlinks with 20+ sources (needs 20+ pages; Free allows it); map pins (link, 100+ pins, colours, warm window); form Created by with anonymous off (if this needs a submitted response through the form link, it is excluded as sharing, like "View my response"; unverified); layout builder (sidebar leave, draft after an accepted reload, Content tab moving); reminders (feed and row page alarm, lane gap, bulk, paste default); timeline snap at other zooms; sort-row drag motion; light leftovers (c7b979bb, 218fec5b, b8cddcef, 8396d0eb).
22. Calendar toolbar "Manage in Calendar": the calendar icon size (623442aa); the button's border in dark (02b68bd8).

Session blockers. Research 31 §2 changes ledger 29's "Cmd/Ctrl combos are not forwarded":
- **A Meta+key keydown reaches the page.** Meta+Backslash arrived with `metaKey: true`, and Notion acted on it (r31 §2).
- **Cmd+Z and Cmd-click are unverified.** Check the keydown first. These items depend on it: undo on a read-only block (BU2), table undo scroll to an off-screen cell, Cmd/Ctrl+Alt+T on a band.
- **Opening a new tab is blocked.** It takes the extension relay (r30 §B18). This blocks gallery Cmd-click.
- **Tab focus order is untrusted.** Tab moved no focus in the session (r30 §B3, §B23). This blocks the delete-last-view Tab order and reaching "N more…".
- **Window size cannot change.** This blocks the side peek narrow breakpoint and the time zone menu in taller windows.
- **A second account is needed** for other users' reaction pills and for a per-user vs. shared band fold.
- **The desktop app is needed** for ⌘\.
- **Excluded by rule:** the dark favorite star (favorites), "View my response" (sharing), "Email me a copy", AI box, Dashboard and chart entries, P1-P7, "More in Marketplace".

## (C) Intentional deviations (for release notes and user review)

New this round:
- **USER REVIEW: a lone Table view opens no "New database" panel** (42cf12b9). The skip applies only to the "Table view" entry, and only when every block is this database or its rows. This follows research (r30 §B7a). It narrows the user decision of 2026-10-20 ("the panel opens on every user insert"), which ledger 29 §3 recorded. Confirm with the user.
- **Place editor keeps the saved value** (data loss): one keystroke does not clear it, and Escape after typing restores it. Notion clears at once (7022a450).
- **Bulk Place opens empty on mixed rows** (data loss). Notion opens on the first row's place as if all rows shared it, and one key cleared every row (34022555).
- **CSV Status mapped by hand keeps the values as options** (data loss). Notion dropped every value and left no options (a28a9343).
- **CSV Date format submenu also opens on hover and click** (a11y: a mouse user could not reach it). ArrowRight still opens it (a28a9343, 7bf5c4c6).
- **Gallery focus after a peek closes goes to the gallery** (a11y). Notion leaves focus on the body, so the first ArrowDown is lost (ff501a48).
- **View tabs move focus with arrow keys** (a11y, inferred: the bar is a roving tablist, `database-tab-bar.ts:124, 141`; no commit states the reason). Notion's tabs did not move (r30 §B23). This is existing behaviour, not a new commit.
- **Title cell Escape keeps focus on the grid, with the cell selected** (keyboard). Notion left focus on the body (62bdd376).
- **Delete-last-view dialog**: the keyboard ring is Blok's outline, not Notion's blue box-shadow (user rule: no focus ring on click; blue only for rings). The cards keep `role=radio` for screen readers; Notion's are not radios (a11y) (bf7f110f).
- **Description field uses the shared field look**: no tint fill, no blue focus ring, radius 8px instead of 6px (user rules: one field look, no ring on click) (5d55304b).
- **Hints always wait Blok's hint delay** (user rule: hint law). Over the header (i), Notion shows at about 20 ms (c9816f56). Board calc hint, about 160 ms in Notion (ab7b4a53). Side peek handle, 21 ms measured once (2247afee).
- **Tooltip colours stay Blok's** (user decision 2026-10-20). This covers the header description hint's second line, rgba(255, 255, 255, 0.55) vs. Notion's rgb(173, 169, 163) (c9816f56), the side peek hint, and "/" hints (02b68bd8).
- **No ⌘\ for the side peek.** In Notion web it toggles the sidebar, not the peek. The hint leaves out "or ⌘\" (1098f6d4).
- **Band toggle uses the 16px chevron**, not Notion's 11px filled caret (user rule: reuse icons first) (50819bf5).
- **"/" entries keep the preview card** (user rule: the preview is the real block), carried. 02b68bd8 re-confirms it.

Differs, no reason stated in the commit. The user should confirm each one, or turn it into an (A) lane:
- **Timeline off-screen chip keeps Blok's chevron**, not Notion's filled straight arrow (623442aa says only "the glyph stays Blok's chevron").
- **Merge dialog "Import Location" chevron is IconChevronDown.** Notion draws an up/down chevron; 916c47cb says only "no such Blok icon".
- **CSV preview updates when "Use first row as headers" flips.** Notion's modal did not update (a28a9343).
- **CSV rows keep file order, and merged rows show without a reload.** Notion reversed rows and needed a reload. a28a9343 and 916c47cb say "not copied"; file order was carried from ledger 29 §3.

Carried from ledger 29 §3 (no commit in this window changed them, unless noted):
- The map pin card waits 300ms (hint law); hide at 55ms.
- "Discard" is outlined, not filled red.
- Dark "New" button hover is rgb(36, 115, 201) for AA.
- The thank-you screen keeps Blok's text.
- Per-view manual order: on for local documents, opt-in for adapters.
- AA-adjusted grays; light "Today" / "Now" and "Add sort" / "Delete sort" use Blok's secondary token.
- The Number by Range page keeps Unique / Range rows (r26:276).
- Browser Back is held only when cancelable.
- Layout tab reorder: Content has no handle; the row page list has no handle.
- Undo on a read-only block waits until the block opens.
- Deleting the last view keeps the source by default (Notion's default), and also offers "Delete view and data source".
- A source switch drops filters and keeps the title sort (matches Notion since 03010a9c).
- The selection bar count stays gray (no-blue law).
- The View settings × does not take first focus.
- CSV import keeps Blok's notifier instead of an "Import complete" dialog (1b480bdf; not re-checked).
- Template picks are ringed in primary ink, not blue.
- Back from "Link to existing" keeps the search variant (2daf4b2e; not re-checked since 10fb951b added the AI lever).
- The primary database title property stays "Title"; new sources use "Name". cce1fa05 added that a CSV-made title with no title column is now "Name".
- Template row bodies have no empty PDF / Drive / Figma placeholders (45ae9276).

Blok choices on unmeasured behaviour are not deviations. They are listed in (B) for measurement.
