# Database Notion-parity ledger (2026-10-20)

Replaces the open list in `15-parity-audit-2026-10-15.md`, which is stale.
Read-only audit. No tests were run. Evidence is a commit, a `src/` line and a test title that was read.

Inputs: 15-parity-audit, 10-backlog, memory `database-layout-builder-shipped.md`, research 12/16/17/19/20, and `git log` of `src/tools/database` and `src/shared/database` since 2026-10-15 (57 commits, last 801447c5).
Not re-derived: the 00-spec gap matrix (the 15 audit's 27 rows were taken as its PARTIAL set) and the plan-11 builder gap table.

Order: OPEN-MEASURED, OPEN-UNMEASURED, BUG, BUG-UNVERIFIED, BLOCKED-PAID, SKIPPED, DONE. OPEN rows are ranked by user-visible impact.

"UNVERIFIED" means the item comes from a doc or memory line and was not reproduced here.

## OPEN-MEASURED

| id | item | status | evidence | size | what to measure |
|---|---|---|---|---|---|
| OM1 | Linked view of a database on another page | OPEN-MEASURED | Notion links a source on a different page (research/20:85-95). Blok's picker lists only this document's databases. `index.ts:755` `this.documentDatabases()`. A `source.documentId` lever exists for relations and dashboards (`types.ts:400-405`), but the picker does not use it. Same root cause: row "Move to" targets databases in this document only (10-backlog P1). | L | — |
| OM2 | Row-page tab strip "N more…" list | OPEN-MEASURED | Notion: "1 more…" opens search, drag rows, "•••", "+ New view" (research/13:81-82). Blok's tab strip scrolls: `src/tools/tabs/index.ts:120,810`. `grep -n "more…" src/tools/tabs/index.ts` → 0. | M | — |
| OM3 | Filled autofill cell hover: Autofill + Comment + Copy | OPEN-MEASURED | Notion shows three buttons (research/12:45). Blok shows only Autofill. Comment and Copy are only for url/email/phone. `database-table-view.ts:888-891` ("The autofill button takes the same corner; it wins"). | S | — |
| OM4 | "Add to Favorites" in the row menu | OPEN-MEASURED | First item in Notion's row menu (research/12:51,56). `database-table-menus.ts:439-440`: "No Add to Favorites: Blok has no favorites." No user decision is cited. Needs a host lever. | M | — |
| OM5 | Status group: default sort | OPEN-MEASURED | Notion: Status "Ascending (default)" (research/08:89). Blok's default for status is `manual` (`group-keys.ts:25-26`). The choices exist (`database-view-settings-panel.ts:1841-1842`). | S | — |
| OM6 | Look and motion pinned by snapshot only | OPEN-MEASURED | Measured values pinned only by the CSS rule snapshot. "+ New page" table row and number `text-align: end` (research/08:262, 273): `grep -rln "161, 158, 153" test/unit/styles` → only `__snapshots__/main-css-rules.snap.txt`. Menu anchor-corner origin, table caret rule, 10px uppercase footer label: snapshot only (10-backlog P1). "Body swaps in one frame" on tab switch: no test (10-backlog P1). | S (tests) | — |

## OPEN-UNMEASURED

| id | item | status | evidence | size | what to measure |
|---|---|---|---|---|---|
| OU1 | Dark theme for every database surface | OPEN-UNMEASURED | See "Look: dark" below. Research 16, 17, 19 and 20 all say "Dark: UNMEASURED" at line 4. The only dark e2e is a chart PNG pixel. | M | Each listed surface in Notion dark: fill, ink, border, shadow. |
| OU2 | Calendar event selection | OPEN-UNMEASURED | `index.ts:7842` paints selection on list rows, board cards, gallery cards and timeline rows. It skips `[data-blok-database-calendar-event]`. | S-M | Does Cmd/Shift-click select calendar events? Does the bulk bar show? |
| OU3 | Reminder alarm outside the table | OPEN-UNMEASURED | The alarm and accent render only when `reminder` is passed. Only the table passes it (`database-table-view.ts:847`). The board does not (`database-board-view.ts:654`), nor the row page (`database-card-drawer.ts:2720`). Notion's row page with a reminder: UNMEASURED (research/17:56). | S | Alarm and blue date on the row page, board, gallery and list. |
| OU4 | Remind in the form and bulk editors, and `defaultReminder` there | OPEN-UNMEASURED | The bulk editor passes no `onReminderChange` (`index.ts:7890-7898`). Neither does the form (`database-form-view.ts:523-532`). So there is no Remind row, and the property default is never applied (`cells/date-editor.ts:146`). | S | Notion bulk-edit date picker and form date question: is there a Remind row? Does the property default apply? |
| OU5 | Comment entry on calendar and timeline items | OPEN-UNMEASURED | `grep -n comment database-calendar-view.ts database-timeline-view.ts` → 0. Research/12 measured board, gallery, list and table only. | S-M | Right-click or "•••" on a calendar event and a timeline bar: is there a Comment item? |
| OU6 | View overflow list: arrow keys | OPEN-UNMEASURED | `database-tab-bar.ts:631-653` handles Escape only. | S | Do arrows move through Notion's "N more…" list? Does Enter open a view? |
| OU7 | Multi-source ("New data source") | OPEN-UNMEASURED | Notion's add-view menu ends with "New data source" (research/20:26). Blok has the `view.dataSourceId` slot only. | L | What "New data source" makes, and how views pick a source. |
| OU8 | Board calculation scope and results | OPEN-UNMEASURED | Blok stores it per view (3846af44). Notion per view: UNMEASURED (research/16:22). Percent and Date results, and "99+": UNMEASURED (16:42, 16:147). | S | Pick on Board, then check Table. Pick Percent and Date. |
| OU9 | Gallery Home/End/PageDown, Enter on many, Delete on selection | OPEN-UNMEASURED | research/16:148. Blok handles Up/Down/Enter (`database-gallery-view.ts:472-476`). | S | Each key on a gallery selection. |
| OU10 | URL/email/phone editor Escape, and those cells on the row page and cards | OPEN-UNMEASURED | research/16:150. | S | Escape reverts or commits. A link click in the row page and on a card. |
| OU11 | Backlinks order and many-count overflow | OPEN-UNMEASURED | research/17:202. | S | Order with three or more sources. Popover with 20+. Does a mention in a row property count? |
| OU12 | Feed: "N replies", other people's reaction pills, view count | OPEN-UNMEASURED | Blok writes "{count} replies" (`database-comments.ts:204`). research/19:67, 75, 82. | S | Two-comment row wording. A second user's pill. Whether views show anywhere. |
| OU13 | Map: many pins, hover delay, conditional-color pins, "No place" row click | OPEN-UNMEASURED | research/20:157. Blok caps pins by the load limit (e6f40505 message). | S-M | 100+ pins, hover timing, a color rule's pin, a click in the "No place" list. |
| OU14 | Form: what "Anonymous responses" changes; the Responses view | OPEN-UNMEASURED | research/19:145, 154, 179. | S | Submit once with anonymous on. |
| OU15 | Number grouping default range | OPEN-UNMEASURED | `group-keys.ts:28-29`: "0 to 1000 in steps of 100 is a guess". | S | Notion's default buckets for a number group. |
| OU16 | Row-page details panel in the side peek; 240px column | OPEN-UNMEASURED | research/09 measured full page and center peek only (10-backlog P6). `database.css:3322`: "240px matches the pin width". | S | Side peek panel geometry. |
| OU17 | "Remove sorting" with per-view manual order | OPEN-UNMEASURED | 10-backlog P3: Blok keeps one shared order. Pinned by database.test.ts "'Remove' in one view re-orders the shared manual order…". | M | Two views with their own manual order, then Remove in one. |
| OU18 | Timeline hour snapping; edge resize at hours zoom | OPEN-UNMEASURED | 10-backlog P5: edge resize still snaps to days. | S | Drag and resize a timed bar at Hours zoom. |
| OU19 | Leaving the page while customizing the layout | OPEN-UNMEASURED | 10-backlog P6: Blok drops the draft and keeps new properties. | S | Close, Escape and next-row while in the builder. |
| OU20 | Small leftovers | OPEN-UNMEASURED | 42 currencies (Blok adds `bitcoin`, `types.ts:114`) vs 41 measured. Multi-select Enter in the editor (10-backlog P1). Sort row pointer-drag motion (audit row 27). | S | Currency list count. Enter in multi-select. Sort drag motion. |
| OU21 | Table cell editing-state look | OPEN-UNMEASURED | research/08:383: the text editor overlay box, shadow, radius and growth were not recorded (behaviour only, 08:159-167). No style test pins it (15 audit row 25). | S | Editor overlay box, shadow, radius, and whether it grows past the cell. |

## BUG (verified by reading code)

| id | item | status | evidence | size | what to measure |
|---|---|---|---|---|---|
| B1 | Due reminders and repeating templates are offered only once, at render | BUG | `offerDueTemplates()` and `offerDueReminders()` are called only from `rendered()` (`index.ts:1280`, `1303-1304`). There is no timer and no other call site. The contract says "Called for each reminder whose time has come" (`types.ts:386-392`; `onRepeatDue` 376-382). Scenario: open the doc at 08:55 with a reminder due at 09:00. The host is never told until a reload. The fix could be a timer, or a contract that says "on render" (the 15 audit noted "checked only at build"). | M | — |
| B2 | "Every 1 weeks" | BUG | `database-template-menu.ts:61-65` always uses the plural unit key (`filterUnitWeek` = "weeks", `en.json:1138`). Interval 1 reads "Every 1 weeks". | S | — |
| B3 | Form question rename: silent refusal and partial renames | BUG | `database-form-view.ts:678-682` calls `renameProperty` on every keystroke. `renameProperty` refuses a taken name with no error (`index.ts:8585`). Line 681 then sets the panel's name to the typed value anyway. Scenario: a form asks "Owner", and "Status" exists. Type "Status": "S"…"Statu" each rename the property, "Status" is refused, and the property ends as "Statu" with no message. `panelInput` listens to `input` (`database-panel.ts:334`). From code; not reproduced. | S | — |
| B4 | Agent `updateProperty` can make duplicate names | BUG | `src/shared/tool-actions/database.ts:546-566` writes `name` with no taken-name check. `addProperty` (:328) and `duplicateProperty` (:583) use `freePropertyName`. Scenario: `updateProperty({propertyId: owner, name: "Status"})` gives two "Status" properties. | S | — |
| B5 | CSV import keeps duplicate headers | BUG | `database-csv.ts:304-315` copies each header as the name. A blank header becomes "Untitled N" with no clash check. Scenario: `Name,Tag,Tag` gives two "Tag" properties. The rest of Blok keeps names unique (6cac5961, 96690c6a). | S | — |

## BUG-UNVERIFIED (from docs or memory, not reproduced)

| id | item | status | evidence | size | what to measure |
|---|---|---|---|---|---|
| BU1 | Layout draft limits | BUG-UNVERIFIED | memory `database-layout-builder-shipped.md:20`: not cleaned while the maker has a tab open; a v1.16.1 client re-saving a draft publishes it; a Yjs client-id change mid-session is unhandled. | M | — |
| BU2 | `config.permissions` gaps | BUG-UNVERIFIED | `10-backlog.md:144`: the row page body, core block-menu actions and API writes ignore `editContent`/`editStructure`. | M | — |
| BU3 | Reduced motion coverage | BUG-UNVERIFIED | `database.css` has 81 `transition:` lines and 12 `prefers-reduced-motion: reduce` blocks. Each one was not checked. | S | — |

## BLOCKED-PAID (gated on the user's Free workspace)

| id | item | status | evidence | size | what to measure |
|---|---|---|---|---|---|
| P1 | Dashboard widgets, layout and sources | BLOCKED-PAID | research/19:42-44 (behind "Dashboards require the Business plan…", 19:30). Measured on Free: Dashboard is in the add-view menu with no lock and creates an empty gated view (19:18-24). Blok leaves it out of the add-view menu (`database-view-popover.ts:25`) and only renders stored widgets. | L | — |
| P2 | Form conditional logic | BLOCKED-PAID | research/19:126-132 (Business). | L | — |
| P3 | Form submit screen and email copies | BLOCKED-PAID | research/19:151 (Plus). | M | — |
| P4 | Automations (form and database: schedules, any/all, mail/webhook/Slack) | BLOCKED-PAID | research/19:152 (gated on Free). Blok has the `config.automations.onTrigger` hook. | L | — |
| P5 | Button: Send mail, Send webhook, Send Slack notification | BLOCKED-PAID | research/17:132, 138 ("Available on Plus", greyed). | M | — |
| P6 | Verification: expiry UI, Owner, notifications | BLOCKED-PAID | research/12:12 (not on Free; help page says Business). | M | — |
| P7 | Chart look values | BLOCKED-PAID | research/08:322 ("used its 1 free chart"). `database.css:120` stands in. | S | — |

## SKIPPED

| id | item | status | evidence | size | what to measure |
|---|---|---|---|---|---|
| S1 | Row-page tab "Display as ›" | SKIPPED-USER | memory `database-layout-builder-shipped.md:18`. | — | — |
| S2 | Property access | SKIPPED-USER | memory Q7 (2026-10-13); 10-backlog P1. | — | — |
| S3 | Button "Send message to agent" | SKIPPED-USER | memory round 3. | — | — |
| S4 | Gray selection (D3), AA yellow/brown, gray active filter pill | SKIPPED-USER | 15 audit header; 10-backlog P1/P3. | — | — |
| S5 | Section folds per viewer | SKIPPED-USER | memory Q3. | — | — |
| S6 | Layout-level Full width only | SKIPPED-USER | memory Q10. Superseded: per-page Full width shipped (D12). | — | — |
| S7 | Page discussions module and switch | SKIPPED-DEFAULT | Coordinator default Q9 (memory), not a user decision. `page-layout-builder.ts:126`. | L | — |
| S8 | Inline comments (Default / Minimal) | SKIPPED-DEFAULT | plan 11 §2.4 row 34 ("Blok has no inline comments"), the same default as Q9. | M | — |
| S9 | View order, onboarding card, builder chrome, menu keys | SKIPPED-DEFAULT | Coordinator defaults Q4, Q5, Q6, Q8 (memory). | — | — |

## DONE

| id | item | status | evidence (sha · src · test) | size | what to measure |
|---|---|---|---|---|---|
| D1 | Card "Page cover" uses the row's own cover | DONE | 468cac35 · `database-card-preview.ts:66` · database-gallery-view.test.ts:125 "shows the row's own page cover over an image in the body" | — | — |
| D2 | Board column calculation | DONE | 3846af44 · `database-board-calculation.ts:34` · database-board-view.test.ts:66 "makes the count a menu button…" | — | — |
| D3 | Gallery selection and keyboard | DONE | 37911a93, cb9104fc · `index.ts:7842`, `database-gallery-view.ts:472` · database-gallery-view.test.ts:478 "ArrowDown with nothing selected…" | — | — |
| D4 | Gallery card Edit and "•••" | DONE | 3a7caf57 · `database-gallery-view.ts` · database-gallery-view.test.ts:674 "Tab goes card, Edit, then…" | — | — |
| D5 | Copy link to view (opens on load); row-page tab Copy link | DONE | 70b7b9fc, 02deb9a7 · `index.ts:315-319, 4719, 6100-6133`, `database-card-drawer.ts:249` · database-view-link.integration.test.ts:86; row-page-layout.integration.test.ts:1273 | — | — |
| D6 | Date reminders: Remind, property default, due hook, zones, copies | DONE | a1ea78be, e1c03284, 0c013f14, 2282caca, 1164dc0d · `reminders.ts:24, 87`, `cells/date-editor.ts:146` · database-reminders.test.ts:45; date-reminders-surfaces.integration.test.ts:150. Open parts: OU3, OU4, B1. | — | — |
| D7 | Page icons in calendar, timeline, feed | DONE | 41d51fe9, 4c68f340 · `database-feed-view.ts:183` · database-page-icon-views.test.ts:130 | — | — |
| D8 | Feed keyboard | DONE | a0ea4162 (blame `database-feed-view.ts:176`) · arrows do nothing, as Notion (research/16:92) · test: none. Divergence: Enter on the title button opens the post; Notion's Enter does nothing (16:95). Kept for a11y. | — | — |
| D9 | Button actions (Add page to, Edit pages in, Show confirmation, Define variables, Send notification, Open) | DONE | aa5dc5b7..8dd93a0a · `src/shared/database/types.ts:266-323` · database-button-menu.test.ts:144; database-button.test.ts:86 | — | — |
| D10 | URL / email / phone cells open on click; hover pill | DONE | 4b58a0a3 · `cells/display.ts:68, 356`, `database-table-view.ts:896` · database-table-link-cells.test.ts:117 | — | — |
| D11 | Template repeat: interval, start date and time | DONE | b6bf1e59, 6757be1e · `database-template-menu.ts:58-80` · database-template-menu.test.ts:71, 92. Open: B1, B2. | — | — |
| D12 | Row page Actions menu, per-page Full width | DONE | aed9dfbf · `database-card-drawer.ts:259, 1477` · database-row.test.ts:222 "saves the page's own full width" | — | — |
| D13 | Backlinks on row pages | DONE | bcd42539, 0bd048ea · `backlinks.ts`, `database-card-drawer.ts:2137` · database-card-drawer-backlinks.test.ts:72 | — | — |
| D14 | Built-in comments: composer, threads, badges, row-page section | DONE | 73ee8419, 1013604f, 626019f2, 84c3a44b · `database-comments.ts:33`, `database-comment-badge.ts`, `database-card-drawer.ts:2065` · database-comments-ui.integration.test.ts:114 | — | — |
| D15 | Feed reactions and comment box | DONE | 213d41b4, 692fbf99, 44213bf4 · `database-feed-view.ts:17`, `database-comments.ts:184-204` · database-feed-reactions.test.ts:62; database-feed-comments.integration.test.ts:107 | — | — |
| D16 | Chart: Save as, Copy as PNG, background switch | DONE | 4c114bfd · `database-chart-export.ts:15` · e2e database-chart-feed-csv.spec.ts:289, 303, 314 | — | — |
| D17 | Person "Edit property" | DONE | 8726d462, cae74af2 · `database-property-menu.ts:155` · database-property-menu.test.ts:297; e2e database-person-edit-property.spec.ts:103 | — | — |
| D18 | AI Autofill in View settings | DONE | cea163ff, aa9a3414 · `database-view-settings-panel.ts:131` · database-ai-autofill-view-settings.public-path.test.ts:83 | — | — |
| D19 | Form: auto-create, Person/Files/Relation questions, Share panel | DONE | 31503f22, ceaf5381 · `database-form-view.ts:50`, `index.ts:3097`, `database-form-share.ts:26-51` · database-form-auto-create.integration.test.ts:92; database-form-provider-questions.integration.test.ts:104; database-form-share.integration.test.ts:118 | — | — |
| D20 | Map view, Place property, MapLibre, geocode lever, height | DONE | e6f40505, 801447c5 (USER: MapLibre), a892c31d, 53512e46, 08bf210c · `database-maplibre.ts`, `database-map-view.ts:40`, `cells/types.ts:72` · database-maplibre.test.ts:159, 210 | — | — |
| D21 | Linked views in the same document | DONE | 8441d2bf, 616ad5fc, 08d5106b · `database-linked-picker.ts`, `index.ts:732` · database-linked-view.test.ts:89. Open: OM1. | — | — |
| D22 | View overflow "N more…" list | DONE | 73760f60 · `database-tab-bar.ts:564` · database-tab-bar.test.ts:794. Open: OU6. | — | — |
| D23 | One row menu for cards, list rows, feed and table; list handle opens it | DONE | 50324127, 35210e3b · `database-table-menus.ts:442`, `database-list-view.ts:492` · database-card-menu.integration.test.ts:214 | — | — |
| D24 | Property name clashes (add, rename in the property menu) | DONE | 6cac5961, 96690c6a · `index.ts:8585, 8592` · test changed in those shas, assertion not read. Open: B3, B4, B5. | — | — |
| D25 | Builder items the backlog listed as missing: Preview switch, eye visibility, Property labels, Database templates, Close panel, pin arrow labels | DONE | 9a593cab, 755fb898, b2aed5ee, 37da7bd5, 5386020b, 8190cf13 · `page-layout-builder.ts:92, 151, 1058`, `page-layout.ts:80`, `database-card-drawer.ts:2480`, `en.json:805-806` · page-layout-builder.test.ts:195, 650, 1035; page-layout.test.ts:348; database-card-drawer-layout.test.ts:374 | — | — |
| D26 | Status group sort choices | DONE | 72b7c159 · `database-view-settings-panel.ts:1841-1842` · database-view-settings-panel.test.ts:451. Default differs: OM5. | — | — |
| D27 | Timeline dependency arrows | DONE | 72b7c159 · `database-timeline-view.ts:420, 434` · database-dependencies-tool.test.ts:91. Hygiene: database-timeline-view.test.ts:559 "draws nothing yet, even with arrowsBy set" passes only because no `arrows` option is passed; the name is stale. | — | — |
| D28 | Column menu Insert right | DONE | 51ba04e3 · `database-table-menus.ts:257` · test: none (gap). database-table-view.test.ts:988 checks `side:'left'` only. | — | — |
| D29 | Board group by relation | DONE | bbaabade · `group-keys.ts:140` · test: none (gap). No relation case in group-keys / model-groups tests. | — | — |
| D30 | Relative date filter values in the UI | DONE | 7f240977 · `database-view-settings-panel.ts:1108` · test: none (gap). `grep -rn database-filter-date test` → 0. | — | — |
| D31 | Sort rows reorder by drag | DONE | 79b5db3a · `database-panel.ts:340` · test: Alt+Arrow only (database-view-settings-panel.test.ts:331). Pointer drag untested. | — | — |

## Look: dark

No measured dark value exists for any surface shipped after 2026-10-15. Research 16, 17, 19 and 20 each say "Dark: UNMEASURED" (line 4 of each file).

Two dark blocks hold the database dark tokens: the media-query block (`database.css:176-300`) and its `[data-blok-theme="dark"]` copy (`database.css:320-430`). Every light color token has a dark override except `--blok-database-peek-backdrop` (`:116`).

Surfaces marked unmeasured in dark (media block line, theme copy line):
- Map pin shadow (`:30`, same value in dark)
- Select editor head (`:157`)
- Status dots (`:188`, `:326`)
- Table gutter and OPEN button (`:198`, `:336`)
- Board brown column (`:214`, `:352`)
- Confirm dialog (`:225`, `:363`)
- Gallery, except card and empty cover (`:231`, `:369`)
- Calendar (`:240`, `:378`), its event card (`:277`, `:414`) and weekend fill (`:280`, `:417`)
- Page-layout builder (`:243`, `:381`)
- Timeline (`:254`, `:392`)
- Peek (`:266`)
- Tab hover, card actions, peek label (`:288`, `:425`)
- Dependency arrows (`:143`, unmeasured in light too)
- Chart (`:120`, BLOCKED-PAID)

Shipped surfaces with no dark measurement and no comment saying so: board calculation menu, page icons, link-cell pill, Person panel, reminder alarm and accent, backlinks, button editor, form share and questions, feed reactions and comments, comments popover and badge, map pins and hover card, linked-view banner.

E2E in dark:
- No database spec renders the on-screen look in dark. `database-look-parity.spec.ts:118` emulates light only.
- One spec sets the dark theme: `database-chart-feed-csv.spec.ts:303-311`. It checks only the exported PNG's corner pixel (`[29, 29, 28, 255]`).
