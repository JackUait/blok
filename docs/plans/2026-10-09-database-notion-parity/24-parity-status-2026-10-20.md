# Database Notion-parity status after round 5 (2026-10-20)

Follows `21-parity-ledger-2026-10-20.md` (the round-5 start).
Read-only status. No tests were run for this file. Evidence is a commit sha, a `src/` line, and a test path that exists on origin/main (57b8e219).

Inputs:
- Ledger 21 rows OM1-OM6, OU1-OU21, B1-B5, BU1-BU3 (and P1-P7 for context).
- Research 21, 22, 23 (`research/21-…`, `22-…`, `23-…`).
- `git log 3604546e..origin/main`: 96 commits. Out of scope (another session): fe58f036, 04d970b1 (agent / agent-models), bbb6da86, 7a942363 (Ask AI docs).

Not on origin/main, so not re-read: research 16-20. Claims that rest on them are cited through the commit body or the ledger row that quotes them.

## Status rule

- **DONE**: what Notion showed was built. Leftovers that Notion never showed (UNMEASURED) do not block DONE. They are noted and listed again in section 4.
- **PARTIAL**: Notion showed something that Blok has not built yet.
- **OPEN**: no work this round.
- **SKIPPED-USER** / **BLOCKED-PAID**: as in ledger 21.

## 1. Ledger rows

| id | item | status | evidence (sha · test) | left / note |
|---|---|---|---|---|
| OM1 | Linked view of a database on another page | OPEN | No commit. The picker still lists this document only: `index.ts:803-811` `pickerSources()` → `this.documentDatabases()`. | Needs a cross-document index (a backend), see section 4. |
| OM2 | Row-page tab strip "N more…" | PARTIAL | 871439cf, 7771e8c6, 372b0728, 055e9580 · `test/unit/tools/database/row-page-tab-overflow.integration.test.ts`, `test/unit/components/utils/overflow-list.test.ts`, e2e `database-page-layout.spec.ts` | Measured, not built: drag handles on the list rows (research/13:80). The layout tabs have no reorder operation yet (871439cf). |
| OM3 | Filled autofill cell: Autofill + Comment + Copy | DONE | e0ae9114, a5910605 · `test/unit/tools/database/database-table-autofill-cell-actions.test.ts`, e2e `database-autofill-cell-actions.spec.ts` | Title cells keep the lone Autofill button (OPEN holds the corner). |
| OM4 | "Add to Favorites" in the row menu | DONE | 3b6e2dcd (lever), f5011329 + 7b50b873 (row page star), da9ce4ab (filled star, "Remove" wording) · `test/unit/tools/database/database-row-menu.test.ts`, `row-page-favorite.integration.test.ts` | List right-click and feed share the builder but have no own test (3b6e2dcd). |
| OM5 | Status group default sort | DONE | ea25767e · `test/unit/tools/database/group-keys.test.ts`, `database-view-settings-panel.test.ts` | — |
| OM6 | Look pinned by snapshot only | DONE | 6f02e75f · e2e `database-look-parity.spec.ts`, `database-insert-column.integration.test.ts`, `database-board-group-relation.integration.test.ts`, `database-timeline-view.test.ts` | Also closes D27-D31 test gaps. |
| OU1 | Dark theme for every surface | PARTIAL | b8cddcef, 8396d0eb, 590e7241, 366dc6cc, c7b979bb, 218fec5b, da9ce4ab · e2e `database-dark-table-chrome.spec.ts`, `database-dark-views.spec.ts`, `database-peek-dark.spec.ts`; `test/unit/styles/database-dark-table-chrome-css.test.ts` | Measured, not shipped: see research 21 §1 rows below (e.g. date picker weekday ink rgb(139,152,152): 0 hits in `database.css`; `:4954-4960` uses `--blok-text-tertiary`). |
| OU2 | Calendar event selection | DONE | 5e7bbac2, 3e9f6968, 9450ab40, 3d0e96f5 (margin lasso), fc4ba77c (inside-grid box) · `test/unit/tools/database/database-calendar-select.integration.test.ts`, e2e `database-item-selection.spec.ts` | Gray paint, not blue (section 3). |
| OU3 | Reminder alarm outside the table | DONE | add24f32, 1cfc61d9, f2451c59 · `test/unit/tools/database/date-reminder-alarm-views.integration.test.ts` | Feed and row-page value show no alarm: UNMEASURED (research 21 §6). Dark reminder blue UNMEASURED (1cfc61d9). |
| OU4 | Remind in bulk and form editors | DONE | 7e8d2df8, 8122d583 · `test/unit/tools/database/date-reminders-bulk.integration.test.ts` | Form has no Remind, as measured (research 21 §6). Default on a form-made row: UNMEASURED. |
| OU5 | Comments on calendar and timeline items | DONE | 5e7bbac2 (calendar menu + badge), 44278fec (timeline table panel; no Comment on the bar, as measured) · `test/unit/tools/database/database-comments.test.ts`, `database-calendar-select.integration.test.ts` | — |
| OU6 | "N more…" list arrow keys | DONE | 055e9580 · `test/unit/components/utils/overflow-list.test.ts`, e2e `database-view-overflow-list.spec.ts` | Arrows reaching the "N more…" button: UNMEASURED; WAI-ARIA tabs kept (372b0728). |
| OU7 | "New data source" | PARTIAL | 60959740, 5d4a7cdc, ab11c206, 041f48e0, 1e44f6e9 · `test/unit/tools/database/new-data-source.integration.test.ts`, `new-data-source-layouts.integration.test.ts`, `new-data-source-collab.integration.test.ts`, e2e `database-new-data-source.spec.ts` | Measured, not built (60959740): the "New data source" side panel (Import CSV, templates, link existing), the view settings Source picker, the "Name" title property. |
| OU8 | Board calculation scope and results | DONE | 20b8410b, 25caf2c3, ab1e8c9d, 57b8e219 · `test/unit/tools/database/database-board-calculation.test.ts`, `database-board-count-hint.test.ts`, e2e `database-board-calculation.spec.ts` | UNMEASURED: 99+ toggle scope (research 23 §2a); spans under a day (20b8410b). |
| OU9 | Gallery keys, Enter on many, Delete | DONE | f1525b0e, a1bd5ebb, d0358e6a, 1ab2127f, fc4ba77c, 69e35448, 2fd446a7 · `test/unit/tools/database/database-gallery-view.test.ts`, `database.test.ts`, `test/unit/components/modules/api/history-step.test.ts`, e2e `database-gallery-calendar.spec.ts` | ArrowLeft kept as nothing (section 3). |
| OU10 | URL/email/phone Escape; links on row page and cards | DONE | 4212d984, e08c4eeb, 57188d47 · `test/unit/tools/database/cells/text-editor.test.ts`, `database-card-drawer-cell-editors.test.ts`, e2e `database-link-cells.spec.ts` | Title and place address still cancel on Escape: UNMEASURED (e08c4eeb). |
| OU11 | Backlinks order and many-count | PARTIAL | 10ae987b · `test/unit/tools/database/database-backlinks.test.ts`, `database-card-drawer-backlinks.test.ts`, e2e `database-backlinks.spec.ts` | Measured, not built: breadcrumb shortening "first…/.../parent" (research 23 §4). Blok joins the full path: `database-card-drawer.ts:1283-1287`. 20+ rows: UNMEASURED. |
| OU12 | Feed replies, others' pills, view count | DONE | 20b8410b (plural "N replies") · `test/unit/tools/database/database-feed-comments.integration.test.ts:107, 124` ("1 reply", "2 replies"; not changed by 20b8410b) | No view count, latest reply time: already so (20b8410b). Other users' reaction pills: UNMEASURED (research 22 §6). |
| OU13 | Map pins | PARTIAL | 10ae987b, e6f6785d · `test/unit/tools/database/database-map-view.test.ts`, `database-maplibre.test.ts`, e2e `database-tier3.spec.ts` | Measured, not built: the ≈55ms hide (Blok keeps the tooltip's 100ms grace; no option, 10ae987b). Show waits 300ms, not 160ms (section 3). UNMEASURED: 100+ pins, other colours, pin link. |
| OU14 | Form "Anonymous responses" | DONE | fa2b6021, 4c621792, 1586d496, 4c45c0e2 · `test/unit/tools/database/database-form-share.integration.test.ts`, `test/unit/anonymous-row-authorship.test.ts`, `database-feed-view.test.ts` | No Responses view, as measured. Server (dotnet) writers not touched (4c45c0e2). |
| OU15 | Number grouping default range | PARTIAL | 20b8410b, 25caf2c3, ab1e8c9d · `test/unit/tools/database/group-keys.test.ts`, `database-group-labels.test.ts`, `database-model-groups.test.ts` | Measured, not built: Notion puts the Range fields on the "Number by" sub-page; Blok keeps them on the Group page (25caf2c3). |
| OU16 | Side peek details panel; 280px | DONE | 56cb94c2 · `test/unit/tools/database/database-card-drawer-layout.test.ts`, `database-card-drawer.test.ts`, e2e `database-page-layout.spec.ts`, `database-row-page.spec.ts` | Narrow-window breakpoint: UNMEASURED (research 23 §2f). |
| OU17 | "Remove sorting" with per-view manual order | DONE | 20ecb059 · `test/unit/tools/database/database.test.ts`, `concurrent-database-row-order.test.ts`, e2e `undo-audit/w4-database.spec.ts` | "Don't remove" differs (section 3). Exports, agent actions and moveRowTo still use the shared order (20ecb059). |
| OU18 | Timeline Hours snapping and edge resize | DONE | 44278fec, 10ae987b (8px handles) · `test/unit/tools/database/timeline-dates.test.ts`, `database-timeline-view.test.ts`, e2e `database-timeline.spec.ts` | Right edge measured later (research 23 §3b); it matches what 44278fec built. Other zooms keep day snap (UNMEASURED). |
| OU19 | Leaving while customizing the layout | PARTIAL | da3bfb32 (beforeunload); Escape / Cancel / preview already matched · `test/unit/tools/database/page-layout-builder.test.ts`, e2e `database-page-layout.spec.ts` | Measured, not built: in-app back shows "Discard all layout changes?" in Notion (research 23 §7). Blok does nothing on an in-app route change. |
| OU20 | Small leftovers | DONE | 4212d984 (multi-select Enter) · `test/unit/tools/database/cells/select-editor.test.ts`. Currency count: research 22 §13 measured 42 currencies incl. Bitcoin, which matches Blok; no change needed. | Sort-row pointer-drag motion: UNMEASURED (the drag itself is tested by 6f02e75f). |
| OU21 | Table cell editing-state look | DONE | a7d0015d · `test/unit/styles/database-cell-editors-css.test.ts`, e2e `database-cell-editor-look.spec.ts` | Drawer, form and bulk editors still open below (only table cells were measured). |
| B1 | Due reminders offered only at render | DONE | b805787b (timer), 0ca79140, 0ff4bcff (bounded repeats) · `test/unit/tools/database/database-reminders.test.ts`, `database-templates.test.ts`, `template-repeat-schedule.test.ts` | — |
| B2 | "Every 1 weeks" | DONE | 24c3834c, then 208ee4ce / b80499b0 reworded it · `test/unit/tools/database/database-template-menu.test.ts`, `test/unit/components/i18n/plural-forms.test.ts` | — |
| B3 | Form question rename refusal | DONE | 9949c4c1 · `test/unit/tools/database/database-form-view.test.ts`, `database-form-builder.integration.test.ts` | — |
| B4 | Agent `updateProperty` duplicates | DONE | 81fda7c3, d6d264e9 · `test/unit/shared/tool-actions/database-gap-commands.test.ts` | — |
| B5 | CSV duplicate headers | DONE | a2299d9b, 16d9e1c8 (merge) · `test/unit/tools/database/database-csv.test.ts`, `test/unit/components/modules/paste/csv-database-offer.test.ts` | CSV row order kept (section 3). |
| BU1 | Layout draft limits | OPEN | No commit touched the draft cleanup, v1.16.1 re-save or Yjs client-id change. da3bfb32 only adds beforeunload. | Still unverified. |
| BU2 | `config.permissions` gaps | OPEN | No commit this round. | Still unverified. |
| BU3 | Reduced motion coverage | DONE | 5c7d6061 · `test/unit/styles/database-reduced-motion-law.test.ts` | Audit found all 11 moving pieces covered; no CSS change. |

Paid rows, for context (unchanged unless noted): P1 dashboards, P2 form conditional logic, P4 automations, P5 button mail/webhook/Slack, P6 Verification, P7 chart look stay BLOCKED-PAID. **P3 is now partly done**: research 23 §6 measured the thank-you screen on Free, and fa2b6021 shipped "View my response" and the `config.forms.emailCopy` lever. The custom submit screen itself is still paid.

## 2. Research 21-23 items

### Research 21

| § | item | shipped | left |
|---|---|---|---|
| 1a | Shared dark surfaces (menus, dividers, hover) | b8cddcef (menus rgb(37,37,37) + shadow) | Tooltip dark: UNMEASURED; left alone (section 3). |
| 1b | Tabs and toolbar | b8cddcef (tab hover, "New" hover, divider), 055e9580 (tab highlight token) | Filter/Sort icon blue kept gray (user decision S4). |
| 1c | Filter and sort pills, rule editor, sort panel | No commit cites §1c | Pills stay gray (S4). Rule editor and sort panel dark values: not audited value by value. |
| 1d | Table | b8cddcef; status pills and checkbox dark values predate this round (`database.css:207, 217, 226`, blame 2026-10-09) | OPEN button dark was UNMEASURED here; done from research 22 §12 (da9ce4ab). |
| 1e | Selection bar | b8cddcef (`--blok-database-table-selection-shadow`) | "N selected" stays gray (S4). |
| 1f | Board | 8396d0eb (tints, card tint, hover, pill shadow), 218fec5b (pill divider), b9595f89 (4px pill) | Brown and other hues, coloured-card hover: UNMEASURED (8396d0eb). |
| 1g | List, gallery | 8396d0eb | Gallery text inks: UNMEASURED (8396d0eb). |
| 1h | Calendar | 8396d0eb (grid, weekend, event card, hover) | Today digit stays white (section 3). "Manage in Calendar" border and "No date" ink: not audited. |
| 1i | Timeline | 8396d0eb, 590e7241 (arrow chip), 218fec5b (bar hover, chip border) | Grid line and arrow icon: UNMEASURED (8396d0eb). |
| 1j | Feed | 8396d0eb, 218fec5b (hover ring, 55x30 pill), 57b8e219 (spec) | — |
| 1k | Form builder | 218fec5b (question card, chip 24px), 8396d0eb (notice) | Blue "Edit question" chip not copied (section 3). |
| 1l | Panels and menus | b8cddcef (menu fill) | Date picker weekday ink rgb(139,152,152) not shipped (0 hits). View settings close button: not audited. |
| 1m | Side and center peek | 366dc6cc (bg, shadow, backdrop 0.8, Comments ink), c7b979bb (title ink, label hover 160x34, side peek shadow ring), b3f4a30f (RTL spec) | Light side-peek hovers: UNMEASURED, Blok fill kept (c7b979bb). |
| 1n | Builder chrome | 366dc6cc, c7b979bb (tile labels) | Blue frame, strip and pill stay neutral (Q6). |
| 1o | Comment badge | 366dc6cc | — |
| 2 | "N more…" keyboard; current view always a tab | 055e9580, 7771e8c6, 280397ba, 372b0728 | — |
| 3 | Template repeat wording and cadence | 24c3834c, 208ee4ce, 865cb810, b80499b0, bcab7e0b, 703b5a63, 25e08bee | Months row "On the [1st] [Day]" not built. At / Starting / Ending / Timezone submenus UNMEASURED; Ending and Timezone show their value only (b80499b0). |
| 4 | CSV duplicate headers | a2299d9b, 16d9e1c8 | Row order kept (section 3). |
| 5 | Favorite star on the row page; menu item | 3b6e2dcd, f5011329, 7b50b873 | — |
| 6 | Reminders in bulk and every view | 7e8d2df8, 8122d583, add24f32, 1cfc61d9, f2451c59 | Feed alarm UNMEASURED. |

### Research 22

| § | item | shipped | left |
|---|---|---|---|
| 1 | Calendar selection (OU2) | 5e7bbac2, 3e9f6968, 9450ab40, 3d0e96f5 | Gray overlay (section 3). |
| 2 | Gallery keys (OU9) | f1525b0e, a1bd5ebb, d0358e6a, 1ab2127f | ArrowLeft (section 3). |
| 3 | Link cells (OU10) | 4212d984, e08c4eeb | Row page does not shorten the address (only the table was measured short, 4212d984). |
| 4 | Cell editor look (OU21) | a7d0015d | Date picker height 449 vs 500 (e1eefe62 explains the 51px). |
| 5 | Board calculation (OU8) | 20b8410b, 25caf2c3 | Hint size read off a screenshot, not measured (25caf2c3). |
| 6 | Feed replies (OU12) | 20b8410b | — |
| 7 | Number grouping (OU15) | 20b8410b, 25caf2c3 | Fields not on a "Number by" sub-page (25caf2c3). |
| 8 | Manual order per view (OU17) | 20ecb059 | Opt-in for adapters (section 3). |
| 9 | Timeline Hours (OU18) | 44278fec | — |
| 10 | Side peek and details panel (OU16) | 56cb94c2 | Panel border keeps Blok's drawer token; handle hover look UNMEASURED; Notion's app-sidebar collapse has no Blok counterpart. |
| 11 | Comments on calendar / timeline (OU5) | 5e7bbac2, 44278fec | — |
| 12 | Dark OPEN, "+ New page", pills, tooltip | da9ce4ab | Notion's 2px rim inside OPEN not copied (one element). Tooltip left alone (section 3). |
| 13 | Multi-select Enter; currencies | 4212d984; currencies already 42 | — |
| 14 | Favorite star states | da9ce4ab | Name stays "Favorite" with aria-pressed (section 3). |

### Research 23

| § | item | shipped | left |
|---|---|---|---|
| 1 | Date picker submenus | e1eefe62, a9defbe6, 206f2d25, 8367dcb5, db4951d1 | "Learn about reminders"; fuzzy zone search and Notion's 567 zones; submenu width 250 vs 180 (section 4). Short date for another year UNMEASURED; keeps the year (206f2d25). |
| 2a | Board 99+ | ab1e8c9d (pinned), 57b8e219 | — |
| 2b | Gallery multi-delete toast, SR text | fc4ba77c, 69e35448, 2fd446a7 | — |
| 2c | Calendar box from inside the grid | fc4ba77c | Escape after it clears; Notion's one sample did not (section 3). |
| 2d | Range edge buckets | ab1e8c9d | "Out of range" under a descending sort: UNMEASURED, flips to first. |
| 2e | Hide empty groups default | ab1e8c9d | — |
| 3a | "Don't remove" | Not changed after the measurement | Blok keeps the old manual order (section 3). |
| 3b | Timeline right edge | 44278fec (built before the measurement), 10ae987b (handles, e2e) | — |
| 3c | Email / phone Escape after edit | 57188d47 | — |
| 3d | ⋮⋮ menu while favorited | 3b6e2dcd (one builder), da9ce4ab (flip tested) | — |
| 4 | Backlinks (OU11) | 10ae987b | Breadcrumb shortening (section 4). |
| 5 | Map pins (OU13) | 10ae987b, e6f6785d | 55ms hide; 160ms show (sections 3, 4). |
| 6 | Anonymous form (OU14) | fa2b6021, 4c621792, 1586d496, 4c45c0e2 | Thank-you text kept (section 3). Blok sends no mail. |
| 7 | Leaving the builder (OU19) | da3bfb32 | In-app route blocking (section 4). |
| 8 | Gallery focus after a peek; Enter after Cmd-click | fc4ba77c (Enter after a click pick opens the card) | Restoring the selection and focus after a peek closes: no commit, and no handler found in `database-gallery-view.ts` (`index.ts` not checked). Blok still picks a card on Cmd-click; Notion picks nothing (fc4ba77c). |
| 9 | Table undo: one step per press, focus stays | 1f5f63ce, f439640d, 57188d47, fa989de2, 4a2044a5 · `test/unit/components/modules/blockManager/reconcile-onchange-once.test.ts`, `test/unit/components/modules/yjs/undo-history.test.ts`, `test/unit/tools/database/undo-closes-cell-editors.integration.test.ts`, e2e `database-cell-undo.spec.ts` | Scroll to an off-screen reverted cell: UNMEASURED. |
| 10 | New data source (OU7) | 60959740, 041f48e0, 5d4a7cdc, ab11c206 | Side panel, Source picker, "Name" title (section 4). |

## 3. Deliberate differences from Notion

- **No blue selected states; gray instead.** Calendar picks (5e7bbac2), cadence day chips and Save (b80499b0), form "Edit question" chip (218fec5b), builder tiles (c7b979bb, 366dc6cc), time zone active row (206f2d25), ↻ in the templates list (208ee4ce). Filter pills, active Filter/Sort icon and "N selected" stay gray (user decision S4, kept in b8cddcef). Law: `test/unit/styles/selected-state-neutral.test.ts`.
- **Map pin card waits 300ms, not Notion's ≈160ms.** The hint-delay law sets `MIN_HINT_DELAY` as the floor (`database-maplibre.ts:192`, 10ae987b; research 23 §5a).
- **"Don't remove" keeps the old manual order.** Blok drops the drop and keeps the sort (20ecb059). Notion bakes the sorted order in and loses the old one (research 23 §3a calls that "looks like a bug").
- **Left arrow in the gallery does nothing.** Research 16 measured nothing; research 22 §2 measured "clears the selection" and said not to copy it. Blok keeps nothing (f1525b0e). Research 16 is not on origin/main; this rests on f1525b0e's body.
- **Thank-you screen keeps Blok's text and "Submit another response".** `en.json:1287-1288`, `database-form-view.ts:310`. Notion shows "Thank you!" and no submit-again button (research 23 §6). fa2b6021 added Notion's two buttons beside it.
- **"Discard" is outlined, not filled red.** Shared confirm style: red text and red border (`database.css:3989-3992`). Notion's builder Discard is a filled red button (research 23 §7).
- **Darker colours for AA contrast.**
  - Dark "New" button hover: rgb(36,115,201) at 4.53:1, not Notion's rgb(61,144,225) at 3.15:1 (b8cddcef, `database.css:166-171`).
  - Dark timeline off-screen chip icon: page ink rgb(25,25,25) at 7.5:1, since white on the measured fill is 2.3:1 (590e7241).
  - Yellow and brown column accents use the pill text colour (`database.css:72`, 72b7c159, an earlier round).
- **The editor-wide tooltip keeps its theme switch.** Notion's tooltip looks the same in both themes. Blok's lives in `colors.css` and is editor chrome, so it was not touched (da9ce4ab).
- **"Learn about reminders" is left out.** Blok has no help or docs URL lever (e1eefe62).
- **Per-view manual order is on for local documents, opt-in for adapters.** `index.ts:540`: on when there is no adapter, or when `DatabaseAdapter.viewRowOrder === true`. Without it, every view shares one order, as before (20ecb059).
- **Others found in commit bodies:**
  - Calendar "today" digit stays white in dark. Notion's black digit is a Notion bug (8396d0eb).
  - CSV import keeps the file's row order. Notion reversed it (a2299d9b).
  - The star's name stays "Favorite" with `aria-pressed`. Notion swaps the label to "Favorited" (da9ce4ab).
  - "Next occurrence" shows the exact time, not a 12-3 AM window (b80499b0).
  - The "Moved to Trash" toast stays open. Notion's timing was not measured (a1bd5ebb).
  - The builder's blue frame, strip and pill stay neutral (Q6, 366dc6cc).
  - The side peek details panel keeps Blok's drawer border token (56cb94c2).
  - "Hide data source titles" is per block. Notion's scope is UNMEASURED (041f48e0).
  - A repeat end date is Blok's choice. Notion only showed "Never" (865cb810).
  - Escape after a calendar box clears the picks (fc4ba77c). Notion's one sample did not (research 23 §2c).
  - Cmd-click picks a gallery card. Notion picks nothing (fc4ba77c).
  - Feed Enter opens the post, kept for a11y (ledger 21 D8).

## 4. Open / not built

Paid plan (Free workspace):
- Dashboards: create and edit widgets, layout, sources (P1). Blok only renders stored widgets.
- Form conditional logic (P2). Custom submit screen (P3, partly done, see section 1).
- Automations (P4). Button Send mail / webhook / Slack (P5).
- Verification (P6). Chart look values (P7).

Not built, with a reason:
- **Cross-document linked views** (OM1) and row "Move to" another document: the picker reads this document only (`index.ts:803-811`). Needs a backend index of databases across documents.
- **New data source side panel** (Import CSV, templates, link existing), the **Source picker**, and the "Name" title property (60959740). The source starts empty.
- **Backlink breadcrumb shortening** (research 23 §4). Blok shows the full path (`database-card-drawer.ts:1283-1287`).
- **Fuzzy time zone search and Notion's 567 zones.** Blok lists `Intl.supportedValuesOf('timeZone')` (`cells/date-format.ts:171-175`) and matches a substring (`cells/date-editor.ts:824`).
- **Date picker submenu width: 250 vs 180.** Blok's Remind and setting menus are 250px (`database.css:5126`, from a1ea78be, which cites research 17). Research 23 §1 measured 180. Research 17 is not on origin/main, so the 250 was not re-read.
- **"Learn about reminders"** row (e1eefe62). No help-URL lever.
- **Map pin hide after ≈55ms.** Blok uses the tooltip's 100ms grace; there is no option for it (10ae987b).
- **Template cadence:** the months row "On the [1st] [Day]"; real At / Starting / Ending / Timezone submenus (b80499b0).
- **In-app route change while the builder is open** (OU19). Only a full page load asks (da3bfb32, beforeunload). Research 23 §7 asks Blok to block route changes; nothing does that.
- **Number "Range" fields** on a "Number by" sub-page (OU15, 25caf2c3).
- **Gallery: restore selection and focus after a peek closes** (research 23 §8). No commit.
- **Dashboard widgets** draw only table and list layouts (5d4a7cdc).
- **Per-view manual order in exports, agent tool actions and `moveRowTo`:** they use the shared order (20ecb059).
- **Cell editors outside the table** (drawer, form, bulk) still open below, not over the cell (a7d0015d).
- **Row page link value** is not shortened (4212d984).
- **Escape** still cancels in the title and a place address (e08c4eeb).
- **Paste / fill of a date** brings no reminder default (7e8d2df8). The first selected row's own reminder is not pre-filled in bulk (8122d583).
- **Adding a property** reveals it only in table and form legacy views. Other layouts, the Sub-items / Dependencies pair, Card details and "Add new relation" are unchanged (a9309dff, 36fd7f39).
- **Board / gallery margin lasso** still selects the database block (3d0e96f5, pinned in e2e).
- **Row-page overflow list:** no drag handle (measured, research/13:80) and no rename (871439cf).
- **Server writers** (dotnet) of createdBy / lastEditedBy ignore anonymous answers (4c45c0e2).
- **BU1** (layout draft limits) and **BU2** (`config.permissions` gaps): no work, still unverified.

UNMEASURED (research 23 "UNMEASURED (collected)", plus leftovers named in commits):
- Default time when Include time turns on; Short date for another year.
- 99+ toggle scope.
- Escape after an inside-grid calendar box.
- Side peek details panel at a narrow window.
- Table undo scroll to an off-screen cell.
- Backlinks with 20+ sources; order by mention time or page edit time.
- Map: pin link; 100+ pins and clustering; colours other than green; warm window between pins.
- Form: Created by with anonymous off; what "View my response" opens; "Email me a copy".
- Builder: leaving by a sidebar click; draft after an accepted reload.
- New data source: Hide titles per view or per block; Import CSV / template paths; picking another source.
- Gallery: whether Cmd-click opened a tab elsewhere.
- Also: feed alarm; other users' reaction pills; sort-row drag motion; dark reminder blue; dark link underline (4212d984); dark favorite star (da9ce4ab); brown and other board hues in dark; timeline grid line and arrow icon in dark; gallery text inks in dark; date ranges under a day; "Out of range" under a descending sort; timeline snap at other zooms.

## 5. Release notes owed

No commit this round is labelled BREAKING. Each body says why its change is additive or newer than v1.16.1.

Public API added:
- `history.latestStep()` and `history.undoStep(step)`, type `HistoryStep` (a1bd5ebb, `types/api/history.d.ts`).
- `NotifierOptions.announce`: separate screen-reader text (69e35448, `types/configs/notifier.d.ts`).
- `data-blok-selection-owner` (`DATA_ATTR.selectionOwner`) and the cancelable `blok-lasso` event (3d0e96f5, `types/data-attributes.d.ts`).
- `config.favorites` / `DatabaseFavorites` (3b6e2dcd, f5011329, da9ce4ab).
- `DatabaseAdapter.viewRowOrder`, `views[].rowOrder`, `rowOrder` in `updateView` changes (20ecb059).
- `config.forms.emailCopy` (fa2b6021).
- `InsertAtOptions.anonymous`, `DatabaseRowData.anonymous`, `DatabaseRowMeta.anonymous` (fa2b6021, `types/api/blocks.d.ts`).
- `hideDataSourceTitles` on the database data (041f48e0).
- `TemplateRepeat.weekdays` and `TemplateRepeat.end` (865cb810).
- Second data source: a child `database` block plus `view.dataSourceId` (60959740, 5d4a7cdc).
- Popover `cover` param (a7d0015d, `types/utils/popover/popover.d.ts`).
- `IconStarFilled` icon (da9ce4ab).
- `api.i18n.t` picks plural forms from a numeric `count` (`key_one`, `key_other`, …), English included (24c3834c, `types/api/i18n.d.ts`).
- `DatabaseBacklinks.list` is one entry per mention; an entry with no `blockId` opens the page (10ae987b).

Behaviour changes:
- `onChange` may fire for a second undo or a peer update to the same block in the same frame. Same-task bursts still give one event (f439640d).
- Two quick Mod+Z presses are two undo steps. The 50ms dedupe is gone (1f5f63ce).
- Undo leaves the caret alone while focus is inside a `data-blok-keyboard-owner` area with no block input selected (57188d47).
- Side peek opens at 756px, not half the viewport. It is resizable (564-1008px) and remembers its width in localStorage `blok:database-peek-width` (56cb94c2).
- In dark, the peek background is `--blok-database-peek-bg` rgb(32,32,32). It no longer follows `--blok-popover-bg` there; light still does (366dc6cc, `database.css:135, 330, 507`).
- A toast with `announce` is not a live region (no `role=status`) (69e35448).
- Shift-click inside a selection owner starts no block range (3d0e96f5).
- Blocks inside an anonymous form answer never keep `createdBy` / `lastEditedBy`, and `BlockAPI` reads none there (1586d496, 4c45c0e2).
- Escape saves text, number, url, email and phone cell edits. It used to cancel (e08c4eeb, 4212d984, 57188d47).
- Undo and redo close every open cell editor and drop its draft. Form answers are left alone (fa989de2).
- A url typed with no scheme links to `http://…` (4212d984).
- Status groups sort Ascending by default (ea25767e).
- Manual row order is per view in local documents (no adapter). A drag in one view no longer reorders the others (20ecb059, `index.ts:540`).
- Number range: a value at the end gets its own bucket; values outside share one "Out of range" group. Changing the group property resets its group settings (ab1e8c9d).
- Gallery Delete trashes at once with a "Moved to Trash" toast and Restore (f1525b0e).
- Template repeat moved from the template ⋯ menu to the template banner (208ee4ce, b80499b0).
- Due reminders and template runs are offered while the document is open, not only at render (b805787b).
- A new column shows in a legacy `visibleProperties` table or form view (a9309dff, bdf89459, 36fd7f39).
- CSV import and merge number repeated headers: Tag, Tag 1, Tag 2 (a2299d9b, 16d9e1c8).
- Agent `database.updateProperty` refuses a name another property has (81fda7c3, d6d264e9).

Mixed-version clients (a v1.16.1 peer on the same document):
- A view on a second data source shows the database's own rows, and the source block is not hidden. No data is lost (60959740).
- It keeps `rowOrder` but shows the shared order (20ecb059).
- It drops `hideDataSourceTitles` on save, so the titles show again (041f48e0).
