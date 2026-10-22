# Database Notion-parity status after round 17 (2026-10-22)

Supersedes `32-parity-status-2026-10-21-r12.md`. This file is the status of record. Ledger 32 and older ledgers are history.

Evidence is at **364bf041** (origin/main when written). No tests were run for this file. Every cited SHA was checked with `git merge-base --is-ancestor <sha> 364bf041`. Every cited test path was checked with `test -e`.

## Inputs

- Ledger 32, every list: (A), (B), (C).
- Research 35 (round 13) and research 36 (round 14). Audit 34 (colours).
- **Main window** `6bd3658d..364bf041`: 58 commits.
  - **Used: 48.** Every `database`, `tooltip` and `inline-rename` commit. Bodies read in full.
  - Of those, 11 are `docs(database)` research-36 commits (311ac9bc … 9abdc59f). They hold measurements only. The other 37 change code or tests.
  - **Excluded: 10** `assistant`, `inline-toolbar` and `playground` commits from a peer session. Three of them touch these paths: 8d19718d (`popover-inline.ts`, `types/api/agent.d.ts`), 84754467 (`types/icons.d.ts`), ea9d3f5c (`types/api/agent.d.ts`). None changes a database surface.
- **Gap window** `34022555..6bd3658d`. Ledger 32's evidence stopped at 34022555, so this window was never in a ledger. It holds 32 path-matching commits outside assistant/agent. Their bodies were read too. They close most of ledger 32 list A (see §3).
- Six commit bodies name branch SHAs. Each one landed on main under a new SHA. Checked with `git patch-id --stable` (identical ids): 5dbd9a28 → fab0010b, 8bff9ea9 → 77747211, 71a1ef7c → 9586e767, f8ce7614 → f71d3909, a208adfd → 1d719d58, 5f5f559d → 6e5ed1c6. Only the main SHAs are cited below.

## Labels

- **DONE**: Blok now does what Notion showed. Cites the commit. "pin" means Blok already matched and a test was added.
- **DONE-AS-DEVIATION**: built, but Blok differs on purpose. The reason is always one of: a user law or decision, WCAG AA, data loss, or a11y.
- **NOT BUILT**: Notion was measured, Blok does not do it. The reason is given.
- **UNMEASURED**: Notion was not observed, or the reading is unresolved. BLOCKED reasons (clock, window size, sharing, paid plan) go here.
- "not re-checked": no commit in either window touches it, and this ledger did not read the Blok code for it.

## 1. Research 35 (round 13)

| § | item | status | evidence | left |
|---|---|---|---|---|
| 1.1 | Board Default and Gray columns | DONE | 3ab0527c: Gray has its own count and "+ New" ink; dark gray cards 44,44,43; Default pinned | AA ink on Gray (see §4) |
| 1.2 | Board card hover | DONE | 3ab0527c Default, Gray, Yellow; a dragged card uses its column's hover fill. Red: 4cedd2aa (r36 §1) | Other hues' hover not measured |
| 1.3 | Filter, Sort, New, chevron fills | DONE | 3ab0527c: Filter/Sort pinned; "New" and chevron gain a pressed fill | "New" blue is an AA step (§4). Whether hovering one half tints the other: UNMEASURED |
| 1.4 | Calendar event rest, hover, selected | DONE-AS-DEVIATION | b80d0980: fill stays, halo 1px inside. Halo is gray `--blok-icon-active-bg`, not blue (no blue selected states) | Halo over or under the title: UNMEASURED |
| 1.5 | Timeline bar selected | DONE-AS-DEVIATION | b80d0980: halo 2px inside the bar only, lane untinted, gray (no blue law) | The timeline's left table row is still tinted (§5) |
| 1.6 | "Moved to Trash" toast | NOT BUILT | f11e89fc: Blok raises no toast on row trash. Every database toast goes through the core notifier, one global portal. A toast with actions never expires (published `NotifierOptions` contract) | Awaiting user decision (§5) |
| 1.7 | Dark confirm dialogs | DONE | f11e89fc: backdrop 0.8, destructive hairline and hover, last-view layout 400x368, Undo focuses Remove | AA fill and body ink (§4) |
| 1.8 | Template row "…" and its submenu | DONE | 3ab0527c: icon-gray glyph, pressed fill, hover kept while open, submenu top level with the "…". Escape closes only the submenu: 9586e767 | Rows are 36px, Notion's 28 (§5). Focus ring + hint after Escape not copied (hint law, §4) |
| 1.9 | Bottom-left notice | NOT BUILT | f11e89fc: Blok's Turn into Tasks raises no notice; it would need a new non-expiring core toast kind | §5 |
| 2.1 | "/table view" skips the panel only on an empty page | DONE (pin) | db57bbd6 adds the S1/S2 cases; skip from 42cf12b9. User decision 2026-10-21: follow Notion | — |
| 2.2 | Feed lists leave out the title | DONE | db57bbd6: count and page leave out the title; empty reads "No results" | "Edit properties" and "Shown in feed / Hide all" do not exist in Blok: NOT BUILT |
| 2.3 | Full-page database docked panel | NOT BUILT | db57bbd6 records it only | — |
| 2.4 | Cold "/" hint (none cold, ~15 ms warm) | DONE-AS-DEVIATION | db57bbd6: sub-300 ms delays are not copied (hint law) | — |
| 2.5 | Locked one-view database draws no tab | DONE (pin) | db57bbd6 | Focus ring + hint after Escape not copied (hint law) |
| 3 | Bulk Text on mixed rows | DONE | 0c866a74 opens on the top row's value; e50dd6e9 uses display order (r36 §5); pinned 1d6fc155 · `test/unit/tools/database/bulk-escape.integration.test.ts` | — |
| 3 | Which close clears the selection | DONE | 0c866a74 · `test/unit/tools/database/database-selection-bar.test.ts` | — |
| 3 | Bulk Date, empty first row, End date on | DONE-AS-DEVIATION | aebbe195: Notion wrote today → today to every row. Not copied (data loss); Blok writes nothing until a day is picked | — |
| 3 | Board and list cells preview the typed text live | NOT BUILT | 0c866a74 "Not built" (the table already does) | — |
| 3 | Single date cell: Escape on empty, Escape on typed text, End input Enter | not re-checked | no commit cites these | — |
| 4 | Property hints outside the table header | DONE | db57bbd6 (name always, description under it, HINT_DELAY); 6fc77403 inline-start in RTL; 3056cde6 a press hides the hint | Feed, calendar, timeline, table-body placement: UNMEASURED |
| 4 | Header (i) field: blue ring, tint fill, 6px radius | DONE-AS-DEVIATION | carried from 5d55304b (shared field look, no ring on click) | — |
| 5 | Description field reopen, toggle, growth, Shift+Enter | DONE | db57bbd6; e2e c077a984 · `test/playwright/tests/database/database-notion-elements.spec.ts` | Plain Enter: see r36 §2 |
| 6 | Calendar "+" and Shift/Alt double-click use the view's open mode | DONE | b80d0980 · `test/unit/tools/database/database-calendar-view.test.ts` | Cmd/Ctrl double-click: UNMEASURED (§5) |
| 6 | A click that closes a menu keeps the event selection | not re-checked | no commit in the windows | — |
| 7 | "Show large counts as 99+" enabled, on, per view; "No Grp" last | DONE (pin) | aebbe195 · `test/unit/tools/database/database-board-calculation.test.ts` | Enable threshold UNMEASURED (§5). Spans under a day, "No <property>" in a number range: UNMEASURED |
| 8 | Merge "Existing property" list leaves out Place, Files, Formula | DONE | f63bc239 (gap) drops Place from the picker; Files and Formula are not in `MERGEABLE_TYPES` (`src/tools/database/database-csv.ts:441-443`) | — |
| 8 | Merge "Existing property" list offers Person | NOT BUILT | `MERGEABLE_TYPES` has no `person` (`database-csv.ts:441-443`). No commit | — |
| 8 | Help-link inks, Setup step has no link, CSV Date "Full date" | not re-checked | no commit | — |
| 9 | Place editor in a peek: view state after a pick | DONE | f71d3909; light look 4cedd2aa (r36 §7) | — |
| 9 | One key in the view state clears the saved place | DONE-AS-DEVIATION | f71d3909, e2e 6f7376a6: not copied (data loss); the view state has no field | — |
| 9 | Board card rename: Escape saves | DONE | 3ef775c2; focus to body 866a8a33 | — |
| 9 | Peek heading: one Escape saves and closes | DONE (pin) | 3ef775c2 · `test/unit/tools/database/row-page-peek.integration.test.ts` | — |
| 10 | Delete-last-view × in light | DONE | f11e89fc: rgba(42, 28, 0, 0.07), 10px in | — |
| 11 | Sub-group band toggle has no hint | DONE (pin) | db57bbd6 | — |
| 12 | Peek handle: any move resizes, only a still press closes | DONE | 3ef775c2 removes the 4px slop | Touch and pen (§5) |
| 13 | Edit cadence: 12–3 AM window, submenu contents, Nth weekday / Last, "Discard unsaved changes?" | not re-checked | no commit in either window | — |
| 14 | Flipped submenu covers its parent | DONE | 1ad83018 (gap) | Unflipped gap: §5 |
| 14 | Arrow keys in the template submenu | DONE | 9586e767 (ArrowRight does nothing); 586b9a59 (ArrowLeft does nothing) | — |
| 15 | "Hide data source titles" is a plain row before Duplicate | DONE (pin) | aebbe195 · `test/unit/tools/database/database-data-source-titles.test.ts` | Per view or per block: UNMEASURED |
| 16 | A property added in the table is hidden in other views | DONE (pin) | aebbe195 · `test/unit/tools/database/database-new-column-visible.integration.test.ts` | Relation tabs: r36 §12 |
| 17 | Mixed-type formula: numbers sort as numbers | DONE | fab0010b; marker fixed 7f37b300. Left-aligned, text filters, None/Count/Percent pinned | A text branch that reads like a number sorts as a number: Blok's choice |
| 18 | "Manage in Calendar" 16px icon, dark border | DONE (pin) | b80d0980 | — |
| 19 | Row menu "Today at 4:54 AM" | DONE | 3c21e2c5; editor locale 1d719d58, 6e5ed1c6, 6ea513e0, fe7eac7d | Yesterday and older footer times: UNMEASURED |
| 19 | Feed byline age and its "Created … at …" hint | DONE | 77747211, then 68c1d925 ("Just now", live); hint 3c21e2c5 | See r36 §10 |
| 19 | Week starts Monday; Yesterday on a Monday | UNMEASURED | r35 §22 read the switch off and did not toggle it; Monday is BLOCKED (clock) | — |
| 20 | Time zone menu over the picker's end edge, 12px above the bottom | DONE | 1d929779; both-edge clamp 643c62d2 | 595px cap or window minus 122: BLOCKED (window size) |
| 21 | Map pin hover card, ~166 ms, no warm window | DONE-AS-DEVIATION | Blok waits its hint delay (hint law), carried from ledger 32 (C). No commit in the windows | Pin look, 100+ pins, colours: not re-checked / UNMEASURED |
| 21 | Reminder alarm icon in the cell and row page | not re-checked | no commit | Feed alarm: UNMEASURED |
| 21 | Timeline snap at other zooms | UNMEASURED | the drag moved the row out of the database (r35 §21) | — |
| 21 | Sort-row drag motion; c7b979bb light peek leftovers | not re-checked | no commit | — |
| 23 | Include time at exactly hh:00:00 takes the next hour | DONE (pin) | already true · `test/unit/tools/database/cells/date-editor.test.ts:289-290` | 23:xx in Notion: UNMEASURED (clock) |

## 2. Research 36 (round 14)

| § | item | status | evidence | left |
|---|---|---|---|---|
| 1, 11 | Board hover, light and dark: Red card, column, header buttons, "+ New page" | DONE | 4cedd2aa (a hover anywhere in the column shows the buttons; buttons in count ink; column fill never changes); e2e b4bcfc77 | AA steps (§4). Sub-grouped heads keep header hover (UNMEASURED). Other hues' "+ New page" hover UNMEASURED |
| 2 | Plain Enter in the description field keeps focus | DONE (pin) | ae3f9bc5 · `test/unit/tools/database/database-property-description-enter.test.ts` | Notion's Enter also ran a pointer-highlighted row: not copied (a hover side effect, not a choice) |
| 3.1 | Template "…" submenu: ArrowLeft leaves it open | DONE | 586b9a59 (internal `arrowLeftClosesSubmenu`, false only for the template New menu) | Enter on the focused "…": not re-checked |
| 3.2 | Property-menu submenus close on ArrowLeft | DONE (match) | Blok default; 586b9a59 keeps it | — |
| 4 | Card rename Escape leaves nothing focused | DONE | 866a8a33 | Collapsed DOM selection in the title: not copied |
| 5 | Bulk editor opens on the top row in view order | DONE | e50dd6e9; pinned under Z → A 1d6fc155 | — |
| 6 | Toast in light, 5 s, hover holds it | NOT BUILT | see r35 §1.6 | Resume vs fresh timer after hover: UNMEASURED (one sample). Dark timing: UNMEASURED |
| 7 | Place editor after a pick, light | DONE | 4cedd2aa: map button shadow, glyph 142,139,134, hover 244,243,243, 8px / 10px in; × icon gray | Dark shadow, glyph, hover: UNMEASURED |
| 8.1 | "Undo Task Database?" light | DONE | f11e89fc (focus Remove); 4cedd2aa (no ×, no icon pinned; red hover 0.0627) | Height: §5 |
| 8.2 | "Reset to original page layout?" light | DONE-AS-DEVIATION | 4cedd2aa new `small` option, 300x226, 22px × with rgba(55, 53, 47, 0.06 / 0.16), 32px icon, 17px/600 title | AA (§4). Dark: UNMEASURED |
| 8.3 | Unpicked radio dot is invisible | DONE | 4cedd2aa (no dot, white centre) | — |
| 8.4 | Bottom-left notice stays dark in light | NOT BUILT | the notice is not built (r35 §1.9) | — |
| 9 | 99+ switch enable threshold | UNMEASURED | every Notion read shared a database with a 101-row source | §5 |
| 10 | Feed byline: "Just now", 1m … 59m, 1h, live 30 s tick | DONE | 68c1d925 · `test/unit/tools/database/database-feed-age.integration.test.ts` | Tick phase: §5. "1h" → "2h" / date: UNMEASURED (clock) |
| 12 | Relation tabs for a same-database relation, columns by name | DONE | 43dab680 (new view field `propertyOrder`) · `test/unit/tools/database/row-page-layout.integration.test.ts` | Row order, colours, "Add new relation", deleting a tab: UNMEASURED. One-way relations to another database: NOT BUILT |
| 13 | Form Preview, "Submitting response as" chip, "View my response" full page | DONE | c4c24e92; dark fill 3b188f24; chip reads `config.user.id` 3146fef2; read-only forms show no chip 364bf041 | Anonymous on: UNMEASURED. Light chip: UNMEASURED |

## 3. Ledger 32 list A, closed in the gap window

All of these landed after ledger 32 was written.

| ledger 32 | status | evidence |
|---|---|---|
| A1 Merge with CSV matching and subtitle | DONE | f63bc239 (any case, no Place); d33c74c0 (merge subtitle). The new-database import keeps the short subtitle: it cannot merge |
| A2 Place view state after a pick | DONE | f71d3909 (main window) |
| A3 Tab menu stays open behind delete-last-view | DONE | f8b3dd35 (core `holdOpen`). The View settings "Delete view" path still closes first (UNMEASURED) |
| A4 "/" footer "Close menu  esc" | DONE | 75ce62c9 |
| A5 "/" suffix 14px, dark label ink | DONE | 63b4a569 (new CSS variable `--blok-popover-item-label-text`) |
| A6 Template fidelity | DONE | 49dbe703 "+ New task"; 1d333b4c and 52f271d2 grouped preview; 6d78a018 status default; bec08856 per-view group order |
| A7 Board "Card layout" | DONE-AS-DEVIATION | 6d35f0c3: primary-ink ring, neutral band (no blue law) |
| A8 Band header without a count | DONE | b090c558 |
| A9 Flipped submenu covers its parent | DONE | a7407fba ("…" opens on click); 1ad83018 |
| A10 No hint on an undescribed header | DONE | ca3e61aa |
| A11 Empty Files & media preview | DONE | 8291ddfa |
| A12 Time zone list content (568 rows, Asmara) | NOT BUILT | no commit; no "Asmara" in `src/`. Needs a bundled zone list |

Also in the gap: the twelve remaining "More templates" (767c0fe2), their glyphs (4b0164fe, 1ff97021), Notion's chip arrow and up/down chevron (3e1f7607), the colour audit (07576169, 284dd8d0, 1da041f9, 12cf43d9, de1aaf8b), "Undo … database" asks first (7f3ef46d), confirm dialog type (8248ac58, 3cab8eb3).

Still carried from ledger 32, not re-checked: remote linked-view writes and "+" (d005c5bc); row "Move to" another document; board / list Shift-click range (3e9f6968); dotnet anonymous writers (4c45c0e2); per-view order in exports and agent actions (20ecb059); outside-table editors open below (a7d0015d); dashboard widgets only table / list (5d4a7cdc); row page link not shortened (4212d984); paste / fill reminder default (7e8d2df8, 8122d583); margin lasso (3d0e96f5); old-peer orphan `it.fails` in `test/unit/tools/database/database-delete-cascade.integration.test.ts`; typed "Last Monday" not parsed (59033d20). Ledger 32 (B) items still never measured: backlinks with 20+ sources, layout builder leftovers (sidebar leave, draft after reload), reminders lane gap / bulk / paste, the other light leftovers (218fec5b, b8cddcef, 8396d0eb).

## 4. Known intentional deviations

- **No blue selected states** (CLAUDE.md). Picked calendar events and timeline bars use a gray halo, not Notion's rgba(35, 131, 226, 0.14) (b80d0980). Card layout tiles use a primary-ink ring (6d35f0c3).
- **Hint delay is never below 300 ms; focus never shows a hint** (hint law).
  - "/" warm hints (~15 ms), map pins (~166 ms), header (i) (~20 ms): Blok waits HINT_DELAY.
  - After Escape, Notion focuses the "…" or Settings button with a blue ring and shows its hint. Blok shows no hint on focus (9586e767 note, r35 §2.5, r36 §3.1).
- **Data-loss behaviours not copied.**
  - One key in the place view state clears the saved place (f71d3909, 6f7376a6).
  - Bulk Date with an empty first row and End date on overwrites every row (aebbe195).
  - Carried: Place editor keeps its value; bulk Place opens empty on mixed rows; CSV Status mapped by hand keeps its values (7022a450, 34022555, a28a9343).
- **WCAG AA colour substitutions** (Notion value fails; Blok keeps the nearest passing step).

  | surface | Notion | Blok | commit |
  |---|---|---|---|
  | Gray count and "+ New", light | 142,139,134 | 110,107,102 | 3ab0527c |
  | Gray count and "+ New", dark | 142,139,134 | 156,153,148 (was 154,151,146) | 3ab0527c, 4cedd2aa |
  | Red count, dark | 229,100,88 | 245,116,104 (was 238,109,97) | 4cedd2aa |
  | "New" hover, light | 31,118,204 | 24,96,172 | 3ab0527c |
  | "New" pressed, light | 28,105,182 | 21,85,153 | 3ab0527c |
  | "New" hover and pressed, dark | 61,144,225 / 83,156,229 | 36,115,201 both | 3ab0527c |
  | Delete view and Reset fill | 229,100,88 | 182,79,70 (no lighter hover) | f11e89fc, 4cedd2aa |
  | Dialog body and card subtitle, light | 125,122,117 | 114,111,106 | f11e89fc |
  | Remove label on red hover, light | hover alpha 0.063 | alpha 0.0627 (4.501:1) | 4cedd2aa |
  | Reset × glyph | 142,139,134 | 129,126,121 | 4cedd2aa |
  | Template "…" glyph, light | 142,139,134 | kept; icon rule 3:1, but 2.8:1 on hover and 2.5:1 pressed | 3ab0527c |

  The general ink steps are in audit 34 ("AA steps used").
- **ArrowLeft in property submenus: not a deviation.** It closes the submenu in Notion too (r36 §3.2). The template "…" submenu deviation of 9586e767 was removed by 586b9a59. At 364bf041 no ArrowLeft deviation remains.
- **Form chip reads `config.user.id`**, the id that Created by records, not `config.people.me()` (3146fef2). Without `user.id` the chip shows nothing.
- Carried from ledger 32 (C), unchanged in the windows: gallery focus after a peek; view tabs move focus with arrows; title cell Escape keeps grid focus; delete-last-view keyboard ring and `role=radio`; no ⌘\ for the side peek; band toggle 16px chevron (the 2026-10-21 glyph decision named only the chip arrow and the merge chevron); "/" preview cards; CSV Date submenu on hover; CSV rows keep file order; plus ledger 32's "carried from ledger 29" list.
- Ledger 32 (C) items that are **no longer deviations**:
  - Tooltip colours: now Notion's (07576169, user decision 2026-10-21).
  - Timeline chip arrow and merge chevron: Notion's glyphs drawn (3e1f7607).
  - Lone Table view skip: user decision 2026-10-21, follow Notion.
  - CSV preview updates on the headers switch: now has a reason (f63bc239: it shows what the import will do).

## 5. Open items

1. **"Moved to Trash" toast.** Not built. Awaiting a user decision:
   - (a) additive notifier options, so only database toasts get Notion's box and timing;
   - (b) restyle every toast.
   Today a toast with actions never expires, and that is the published `NotifierOptions` contract (f11e89fc). So (a) is the non-breaking route. Notion: 5 s, and hover holds it open (r36 §6).
2. **Bottom-left notice kind.** Not built. Needs a new non-expiring core toast kind (f11e89fc). Notion's box stays dark in light (r36 §8.4).
3. **99+ threshold.** UNMEASURED. Needs a standalone database of a few rows with nothing beside it. Blok keeps the switch always enabled (aebbe195).
4. **Anonymous forms.** Notion with anonymous on: UNMEASURED. Its switch is behind "Share form" (sharing, excluded).
5. **Dark Reset dialog and dark map button.** UNMEASURED. Blok keeps the last-view × and its earlier map button look (4cedd2aa).
6. **Undo dialog height.** Notion is 324x193 (r35 §1.7, r36 §8.1). The brief gives Blok as 180px. Not verified for this ledger.
7. **Template menu rows 36 vs 28 px.** So the "…" and the submenu top sit 6px below the row top, not 2px (3ab0527c).
8. **Unflipped submenu gap (core).** Notion's submenu starts 4px past the list edge (r35 §1.8). Blok's overlaps by 4px (1ad83018; `rightSideLeft = parentRect.right - overlap` in `src/components/utils/popover/popover-desktop.ts`).
9. **Feed-age clock.** Notion re-reads every byline on one 30 s tick that fires at :15 and :45 for all cards (r36 §10). Blok runs one 30 s interval per feed view, started when a card first shows a time (`src/tools/database/database-feed-view.ts:117`, `:365`). So the phase differs between views.
10. **Touch and pen on the peek handle.** Any `pointermove` between down and up resizes, for every pointer type (`src/tools/database/database-card-drawer.ts:1023-1056`). Inference, not tested: a finger tap that jitters would resize, not close. Notion was measured with a mouse only (r35 §12).
11. **Cmd/Ctrl double-click on a calendar day.** Blok adds nothing (`src/tools/database/database-calendar-view.ts:566`). Notion: UNMEASURED, since a Cmd-click may open a new tab and take the extension relay.
12. **Timeline left-row selection tint.** The timeline's table panel row stays tinted when its bar is picked. Notion: UNMEASURED (b80d0980).
13. Smaller: Person in the merge "Existing property" list (§1, r35 §8); time zone list content (§3, A12); Edit cadence details (r35 §13); full-page docked panel (r35 §2.3); board / list live bulk preview (r35 §3).

## 6. BREAKING and public API changes

The last release is v1.16.1.

**BREAKING, main window:**
- **3056cde6 `api.tooltip.onHover` hides on press.** It is published in v1.16.1 (`types/api/tooltip.d.ts`).
  - Old: the hint stayed through a press of its element.
  - New: pointerdown on the element hides the hint and cancels a pending one. No type change.
  - Migration: a tool that needs the hint during a press binds `show()` / `hide()` itself.
  - User decision 2026-10-22: BREAKING, chosen over an opt-in `hideOnPress`.

**BREAKING, gap window** (not in ledger 32; listed so the release notes have them):
- 07576169: `--blok-tooltip-bg`, `--blok-tooltip-font` and `--shadow-tooltip` take Notion's values. A hint's second line is rgb(173, 169, 163).
- 284dd8d0: `--blok-image-lightbox-shortcut-fg` becomes rgb(173, 169, 163). The toolbox preview text and the hint highlight use `--blok-tooltip-font`.

**Additive, not breaking:**
- `api.config.user` for tools: `types/index.d.ts` adds `'user'` to the config `Pick` (3146fef2). 364bf041 is its follow-up.
- View field `propertyOrder?: 'alphabetical'` (`types/tools/database.d.ts:885`, 43dab680).
- Message keys in `types/message-keys.d.ts`: `tools.database.rowEditedTodayAt`, `tools.database.feedCreatedAt` (3c21e2c5), `tools.database.feedJustNow` (68c1d925), `tools.database.formRespondentPill` (c4c24e92).
- Gap window: `--blok-popover-item-label-text` (63b4a569); `children.moreButton` and `data-blok-popover-item-more` (a7407fba); `toolbox.closeMenu` key (75ce62c9); database saved fields `status.defaultOptionId`, view `groupOrder`, view `cardLayout` (6d78a018, bec08856, 6d35f0c3); new icons and `DatabaseIcon` glyphs (3e1f7607, 4b0164fe, 1ff97021).

**Core behaviour, every editor (not labelled BREAKING):**
- d37fbcd4: inline rename ignores Enter and Escape during IME composition.
- 586b9a59: internal popover option `arrowLeftClosesSubmenu` (default true).
- 3ab0527c: in `popover-desktop.ts`, any submenu whose trigger has a "…" (`moreButton`) opens with its top level with the "…".
- Gap window: 1ad83018 (a flipped submenu covers its parent, every editor); 75ce62c9 ("/" menu footer changes ArrowUp from the first row); f8b3dd35 (`holdOpen`, internal).

Database-only changes are not BREAKING (user decision 2026-10-20).
