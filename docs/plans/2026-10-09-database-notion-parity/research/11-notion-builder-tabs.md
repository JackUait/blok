# Research 11: Notion row-page view tabs: Cancel, Reset, Simple, sharing (measured)

Measured 2026-10-13 in the user's signed-in Chrome via `playwright-cli -s=notion-measure3 open --extension`, on app.notion.com.
Workspace "Personal", Free Plan. Viewport 1512x717 CSS px (never changed). Light theme.
Scratch: private page "Blok measure scratch 3 2026-10-13" (id 3f7c2586eb6d80cca83ecc6546df167c) holding full-page database "Measure DB 3" (id 3f7c2586eb6d80e3a9edd6e19b7f02fd; `/database full` > "Database - Full page" > "New empty data source").
Properties: Name (title), Number, Text. Rows (created in this order): Alpha (Number 1), Beta (Number **12**, a typo for 2, left as is), Gamma (Number 3).
Row ids: Alpha 3f7c2586eb6d803da674c6f3494087f0, Beta 3f7c2586eb6d80159059f7c29a919e28, Gamma 3f7c2586eb6d8067b07affc69bcdf907.
Files: ~/Packages/.blok-undo/db-parity-ledger/notion-measure3/ (not in the repo). Screenshots `NN-*.png`. Probe dumps `*.json`.

Method: after each step, `probe-all.sh` opened the parent page, each row page (always **full page**, by URL `/p/<rowId>`) and the database, and dumped every `[class*=collection_view]` block id, every `[role=tab]`, and the top-level blocks of the page (`probe.js`). Files `<NN>-<step>-{PARENT,ALPHA,BETA,GAMMA,DB}.{json,png}`.
Each view tab got a unique name (TabOne, TabTwo, ...) so a leftover view can be told apart from the database itself.

Step order differs from the task list: 1, then 2 up to Apply, then 4 and 5 while a tab exists, then the rest of 2 (Reset), then 3.

Baseline (`11-base-*`): no collection view on any row page; the parent page holds only the database; the database has one view, "Table".

## 1. Add a view tab, then Cancel > Discard

- Builder > Structure "Tabbed" > hover tab bar > "Add tab" > "Link existing data source" > "Measure DB 3" > View name > "Add view" (`13-tabbed.png`, `15-link-picker.png`, `16-view-name-form.png`).
  - The "View name" field is prefilled "Measure DB 3" but the text was **not** selected this time: typing appended ("Measure DB 3TabOne"). Renamed in the View settings name field to "TabOne" (`17-tab1-added.png`, `18-tab1-named.png`).
- In the builder the tab is a real block: `.notion-collection_view-block` with `data-block-id` 3f7c2586-eb6d-80c0-ae2a-d0497c91eb0e (`18-builder-tab1-probe.json`).
- **Cancel** opens a modal: title **"Discard all layout changes?"**, buttons **"Discard"** (red fill) and **"Cancel"** (`20-cancel-dialog.png`).
- **Discard** closes the builder and returns to the database (`21-after-discard.png`).
- **The tab is gone. No linked view is left anywhere checked** (`22-after-discard-*`):
  - Alpha, Beta, Gamma (full page): no collection view block, no tab bar. Same block list as the baseline.
  - Parent page: only "Measure DB 3". Database: one view, "Table".
  - Opening the TabOne block id as a page (`/p/3f7c2586eb6d80c0ae2ad0497c91eb0e`) shows **"This page couldn't be found"** (`22-after-discard-tabone-blockurl.png`). Control: the same URL form for an *applied* tab's block opens that block (see 2a), so "not found" here means the TabOne block no longer exists (or never got saved).
- Reopening the builder: Structure is **Simple**; switching to Tabbed shows only **"Content"**. The draft did not keep TabOne (`23-builder-reopen-after-discard.png`, `24-reopen-tabbed-after-discard.png`).
- Whether TabOne was already readable from a row page *before* Discard: UNMEASURED. `tab-new` did not open a second tab over the extension relay (tab-list stayed at 1 tab).

## 2a. Add a view tab, Apply

- Added "TabTwo" the same way (block id 3f7c2586-eb6d-8046-b8c8-eb32fb6004c7, `25-tabtwo-added.png`). "Apply to all pages": no confirm, builder closes, back on the database (`26-after-apply-tabtwo.png`).
- **Every row page shows the tab bar "Content | TabTwo"** (`27-applied-T2-*`). The view block id is **the same on Alpha, Beta and Gamma**: 3f7c2586-eb6d-8046-b8c8-eb32fb6004c7. One block, rendered on every row page.
- On full-page open, **TabTwo was the selected tab** on all three rows (aria-selected), not "Content" (`27-applied-T2-ALPHA.png`).
- The database itself still has one view, "Table". The parent page is unchanged.
- **Opening the view block id as a page works**: `/p/3f7c2586eb6d8046b8c8eb32fb6004c7` redirects to `?v=3f7c2586eb6d80b5b99f000ced952043`, document title **"View of Measure DB 3 | Notion"**, breadcrumb "View of Measure DB 3" (no parent crumb), page with no title ("Add title"), and **its own view tabs are "Content" and "TabTwo"** with the full table (`28-tabtwo-blockurl.png`). The sidebar's Recents then lists "View of Measure DB 3" with a linked-database glyph.
  - Hypothesis (unverified): the row-page tab bar is this one linked-database block's view list, with "Content" as a special entry in it.

## 4. Shared or per row? (with TabTwo applied)

**Headline: view tabs are per database, shared by every row page. There is one view block, not one per row.**

- **Same block on every row**: Alpha, Beta, Gamma all render `.notion-collection_view-block` 3f7c2586-eb6d-8046-b8c8-eb32fb6004c7 (`27-applied-T2-*.json`).
- **Same view id**: the row-page tab menu's "Copy link to view" gave `…/p/Alpha-<alphaId>?v=3f7c2586eb6d80b5b99f000ced952043` on Alpha and `…/p/Gamma-<gammaId>?v=3f7c2586eb6d80b5b99f000ced952043` on Gamma. Same `v`, and the same `v` the standalone "View of Measure DB 3" page redirected to (2a). Clicking the "Content" tab changed the URL to `?v=3f7c2586eb6d80a0b613000c266404d2` (`41-gamma-content-tab.png`), so "Content" also has its own view id.
- **Row-page tab menu** (click the selected view tab): only **Customize layout** · **Display as ›** (Text and icon ✓ / Text only / Icon only, footnote **"Only applies to you"**) · **Copy link to view** (`29-alpha-tabtwo-menu.png`, `30-alpha-display-as.png`). No Filter, Sort, rename, Duplicate or **Delete** there: a row page cannot delete or rename a tab. The tab bar's right side has Filter, Sort, Search icons and a New split button.
- **Filter edit on one row** (Alpha, TabTwo, Filter icon > Number > "= 3"):
  - At first the filter is a **local draft**: the filter bar shows "Number = 3" with an orange dot, plus **Reset** and **"Save for everyone"** (with a "More save options" chevron) (`33-number-filter.png`, `34-filter-unsaved.png`). Only Gamma is listed.
  - "Save for everyone" opens a modal: layout glyph, title **"Updating layout for all pages in this database"**, body **"Changes to filter and sort will apply to all pages in Measure DB 3"**, buttons **"Save for all pages"** (blue) and **"Cancel"** (`35-filter-saved.png`).
  - With the modal cancelled (filter still a draft on Alpha): Beta showed **no filter**, all 3 rows (`36-beta-with-unsaved-filter-on-alpha.png`). Back on Alpha, the draft was still applied (Gamma only, orange dot on the Filter icon, bar collapsed) (`37-alpha-back-unsaved.png`). So the unsaved draft is kept for that row page only (for this user; other users UNMEASURED).
  - After **"Save for all pages"**: Beta and Gamma both list only Gamma (`40-BETA-after-filter-saved.png`, `40-GAMMA-after-filter-saved.png`). The filter is shared.
- **Selected tab is remembered across rows**: after Apply every row opened on TabTwo. After clicking "Content" on Gamma, both Gamma and Alpha opened on "Content" (`42-*-tabsel.json`). Whether this is per user or per workspace: UNMEASURED (one user).

## 5. Other facts that decide per-database vs per-row

- **A row created after Apply gets the tabs**: new row "Delta" (id 3f7c2586eb6d8015a999eead14cfd859) shows "Content | TabTwo" with the same block id 3f7c2586-eb6d-8046-… (`44-delta-page.png`, `44-delta.json`).
- The database's own view list is untouched: it still has only "Table" (`27-applied-T2-DB.json`). TabTwo is **not** added as a view of the database page.
- The tab's linked view is reachable as its own untitled page, "View of Measure DB 3", with no parent in its breadcrumb (2a, `28-tabtwo-blockurl.png`).
- The filter save modal names the scope in words: "all pages in this database".
- Changing a tab on one row only (a per-row override): no UI found for it. The row-page tab menu has no per-row edit, and saving a filter goes to all pages.

## 2b. "Reset to original page layout" with TabTwo applied (filter saved on it)

- Builder (opened with TabTwo applied) showed tabs "Content" (selected) and "TabTwo", same block id 8046-… (`45-builder-with-tabtwo.png`).
- Apply chevron "More save options" > "Reset to original page layout" > modal **"Reset to original page layout?" / "No properties will be deleted." / Reset / Cancel** (`46-reset-confirm.png`). Reset closes the builder and returns to the database (`47-after-reset.png`).
- **The tab does not survive** (`48-after-reset-*`):
  - Alpha, Beta, Gamma, Delta: no tab bar, no collection view block. Each body is back to the baseline block list (title, properties, comments, template prompt). **The linked view is not left behind as body content.**
  - Database: still one view "Table". Parent page: unchanged.
- **Structure is Simple again**: reopened builder shows Simple selected (`51-builder-after-reset.png`). Switching to Tabbed shows only "Content"; TabTwo does not come back (`52-builder-after-reset-tabbed.png`).
- **Where the view went: Trash.** `/p/3f7c2586eb6d8046b8c8eb32fb6004c7` now opens "View of Measure DB 3" with a red banner **"Jack Uait moved this page to Trash 1 minute ago. It will be permanently deleted in 30 days."** + "Restore page" / "Permanently delete". Its tabs still read "Content | TabTwo" (`49-after-reset-tabtwo-blockurl.png`). Neither button was clicked.
- The old copied view link (`/p/Alpha-…?v=3f7c2586eb6d80b5b99f000ced952043`) now opens Alpha's plain (Simple) page (`50-after-reset-alpha-viewlink.png`).

## 3. Apply with a tab, then Simple + Apply, then Tabbed again

- Builder (after Reset) > Tabbed > added "TabThree" (new block id 3f7c2586-eb6d-**8035**-a42f-f78a80dc4a15, not the trashed 8046 block) > Apply. Alpha and Beta show "Content | TabThree", same block id (`53-tabthree-added.png`, `54-T3-applied-*.json`).
- Builder > Structure **Simple**: the canvas loses the tab bar; the DOM has no `[role=tab]` and no collection view block (`56-builder-simple-draft.png`). Apply: no confirm.
- **After Apply (Simple)**: Alpha, Beta, Gamma have no tab bar and no collection view block (`58-after-simple-*`). TabThree's view is **not** shown anywhere on the row pages, the database or the parent.
- **But the view block is kept, not trashed**: `/p/3f7c2586eb6d8035a42ff78a80dc4a15` opens "View of Measure DB 3" with **no Trash banner**, tabs "Content | TabThree", full table with Delta, Gamma, Beta, Alpha (`59-after-simple-tabthree-blockurl.png`). Compare Reset, which trashed it (2b).
- **Switching back to Tabbed brings it back**: reopening the builder shows Simple; clicking Tabbed shows "Content | TabThree" with the same block id 8035-… (`60-builder-after-simple.png`, `61-builder-back-to-tabbed.png`). After Apply, Gamma shows "Content | TabThree" again, same block id (`62-reapplied-tabbed-GAMMA.png`).
- Summary of the three exits:

| Action | Tab on row pages | View block afterwards | Tabbed again brings tab back? |
|---|---|---|---|
| Cancel > Discard (never applied) | never shown | "This page couldn't be found" | No |
| Reset to original page layout | gone | moved to **Trash** (restorable 30 days) | No |
| Simple + Apply | gone | **kept** (live, untrashed) | **Yes**, same block |
- After the scratch page and the database were trashed (Teardown), the TabThree view page (`/p/3f7c2586eb6d8035a42ff78a80dc4a15`) still showed **no Trash banner**, even after a reload. It was read-only (no New, no "+" column), and a disabled button read **"Can't add automations to databases in Trash"** (`70-after-trash.png`, `71-tabthree-view-after-trash-reload.png`). Its place in the page tree was not found: UNMEASURED.

## UNMEASURED

- Whether TabOne could be seen from a row page **before** Discard (could not open a second tab over the relay).
- ⌘K search for the tab names (TabOne/TabTwo/TabThree).
- Whether the remembered selected tab is per user, per device or per workspace (one user only).
- How an unsaved (draft) filter on a row page looks to other users.
- Where the layout and the tab's view block are stored (parent of "View of Measure DB 3"; it showed no parent crumb).
- Renaming or deleting a tab from the builder after Apply, and whether that reaches every row (research 10 measured Delete view in the draft only).
- What "Reset" does to a Simple-hidden view block (Simple + Apply, then Reset) — not tried.

## Teardown

- Scratch page "Blok measure scratch 3 2026-10-13" moved to Trash via its own top-bar "Actions" (•••) > "Move to Trash". Notion then navigated to the TabThree view page.
- Opening the parent page and "Measure DB 3" by URL shows the banner "Jack Uait moved this page to Trash just now. It will be permanently deleted in 30 days." (`73-trash-check-PARENT.png`, `73-trash-check-DB.png`). The Trash panel lists Blok measure scratch 3, Measure DB 3, Delta, Beta, … (`76-trash-panel.png`).
- Sidebar check: the sidebar text contains none of "Blok measure scratch 3", "Measure DB 3", "Alpha", "Beta", "Gamma", "Delta", "View of Measure". The Private section starts at "Полугодовое ревью".
- ⌘K search "Measure DB 3" still lists **"Measure DB 3 · Database · Blok measure scratch 3 2026-10-13 · Edited 9m ago"** as the first result, before and after a page change (`72-search-measure-db-3.png`, `80-search-after-teardown.png`). Recorded as seen; cause not checked.
- TabTwo's view block: in Trash since Reset (2b).
- TabThree's view block (3f7c2586eb6d8035a42ff78a80dc4a15): its own "Actions" > "Move to Trash" was clicked. Afterwards the page still showed **no** Trash banner (after reload too), and a Trash search for "View of" / "Untitled" found nothing (`77-trash-search-view-of.png`). **Unverified leftover**: if it still exists, the user can open that id and trash it.
- Row "Delta" was created during the run (inside the scratch database, trashed with it).
- After the second Move to Trash Notion opened the user's "New database" page; it still reads "Edited 2d ago" (`79-new-database-untouched.png`). Not edited.
- Trash was not emptied. Restore / Permanently delete were never clicked. No viewport change. No workspace settings, sharing or plan touched.
- `tab-new` did not open a second tab over the extension relay (tab-list kept 1 tab).
- Helper scripts left in this folder: `p`, `probe.js`, `run-probe.sh`, `probe-all.sh`, `open-builder.sh`, `add-tab.sh`, `ids.sh`, `s*.yml` snapshots.
