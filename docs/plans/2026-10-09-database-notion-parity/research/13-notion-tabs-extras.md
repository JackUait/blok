# Research 13: Notion row-page tabs extras (Add tab menu, relation tabs, view tab menu, Autofill on page edit) — measured

Measured 2026-10-14 (local) in the user's signed-in Chrome via `playwright-cli -s=notion-measure5 open --extension`, on app.notion.com.
Workspace "Personal", Free plan (same as research-09..12). Viewport 1512x717 CSS px, never changed. Light theme.
Files: ~/Packages/.blok-undo/db-parity-ledger/notion-measure5/ (not in the repo). Screenshots `NN-*.png`, DOM dumps `*.json`, ids in `ids.sh`.
Helpers: `p` (session wrapper), `probe.js` (copied from research-11: collection-view block ids, `.notion-collection-item` rows, `[role=tab]` list), `menu.js` + `dump.sh` (visible dialogs/menus text + items), `open-builder.sh`, `addtab-open.sh`, `rename-tab.sh`.
Anything not observed is marked **UNMEASURED**.

## 0. Setup

- Private page "Blok measure scratch 5 2026-10-14" (id 3f9c2586eb6d809b86e8f32f5984f6de): sidebar compose button > "Page" (`01-new-page.png`, `02-blank-page.png`).
- Full-page database "Measure A5" (id 3f9c2586eb6d80f4ab04ce3d19bfa73a): `/database full` > "Database - Full page" > "New empty data source" (`03-slash-db.png`, `04-db-source.png`, `05-db-a-named.png`). Rows Alpha, Beta, Gamma (`06-a-rows.png`). Property Number (`08-a-number.png`).
- Full-page database "Measure B5" (id 3f9c2586eb6d804e8fcff99e834761f9), same route. Rows One, Two, Three (`12-b-rows.png`).
- Relation on A: Add property > type search "Relation" > "Related to" picker > Measure B5 > panel "New relation" (name "Measure B5", Related to Measure B5, Limit "No limit", **Two-way relation** off by default) (`21-type-relation.png`, `22-relation-picker.png`, `23-relation-config.png`). I turned Two-way on; that shows "Related property name" (placeholder "Measure A5") (`23b-twoway.png`). "Add relation" (`24-relation-added.png`). Result: A has "Measure B5", B has "Measure A5".
- Links: Alpha → One, Two; Beta → none; Gamma → Three (`26-relations-set.png`).
- Builder opened from a row page: Alpha full page > top-bar "Actions" (•••) > "Customize layout" (`14-builder.png`). Structure > "Tabbed" (`15-tabbed.png`).

## 1. The tab bar "+" (Add tab) menu

**Headline: the "+" menu has no "View of …" and no "Add new relation" item. Those two labels live one step later, in the form you get from "Link existing data source" > pick a source. The "+" menu itself lists each relation of the database as a one-click item, under the heading "Related to <this database>".**

**Direct answer on "View of":** "View of" is the source row inside the Link-existing form (§1d); it shows whichever source you picked. Every row-filtered tab measured here was a view of the **related** database B, filtered by "<B's back-relation> contains This page" (§1c, §2). None was a view of A. A same-database link was unfiltered (research 11). A **related** source added through "Link existing data source" with "Add new relation" off ("Add view") is **UNMEASURED**; that is the case that would show whether "View of" alone filters per row.

The "+" is a 28x28 element with aria-label **"Add tab"**, right of the last tab. It did not show in screenshots after a plain hover, and coordinate clicks did not open it; a Playwright locator click on `[aria-label="Add tab"]` did (`16-tabbar-hover.png`, `17-addtab-menu.png`).

### 1a. Database with no relation property
- Menu: one item, **"Link existing data source"** (table glyph). Nothing else (`17-addtab-menu.png`, `17-addtab-menu-norelation.json`).
  - Caveat: this dump was taken about 1.2 s after opening. The with-relation menu (1b) was re-checked after 4.5 s; this one was not. So "only one item" here is as seen at ~1 s. Supporting (not proof): `dump.sh` reads `innerText`, which skips hidden text; neither this dump nor the 1.2 s with-relation dump (`28-addtab-menu-with-relation.json`) contains "Loading...", and the latter matched its 4.5 s re-check.
- "Link existing data source" opens a picker: search field placeholder **"Link to a data source..."**, heading **"Existing data sources"**, then Measure A5 / Measure B5 (each with subtitle "Blok measure scratch 5 2026-10-14"), Database (Demo Page), Elen (Demo Page), People, "Show 1 more" (`18-link-picker.png`, `18-link-picker.json`).

### 1b. Database with a relation (A → B, two-way)
- Menu, top to bottom (`28-addtab-menu-with-relation.png`, `28-menu-leaves.json`):
  1. Heading **"Related to Measure A5"** (12px, rgb(125,122,117)).
  2. **"Measure B5"** with the relation arrow glyph (↗), 14px rgb(44,44,43).
  3. Divider.
  4. **"Link existing data source"** (table glyph).
- A `role=status` "Loading..." node sits in the menu. After 4.5 s it was `visibility:hidden` and the list was the same (`33-addtab-menu-waited.png`, `33-menu-leaves-waited.json`). So the list above is final.
- The relation item stays offered after its tab exists (`33-addtab-menu-waited.png`, taken with one "Measure B5" tab already added).

### 1c. What the relation item ("Measure B5") produces
- One click, no form. A new tab named **"Measure B5"** (the related database's name) is added and selected, and its **View settings** popover opens at once (`30-after-relation-item.png`, `30-after-relation-item.json`):
  - View settings: name field "Measure B5", Layout **Table**, Property visibility **2**, **Filter "Measure A5"**, Sort, Group, Conditional color.
  - Data source settings: **Source "↗ Measure B5"** (greyed, with the relation glyph), Edit properties, AI Autofill, More settings.
  - Duplicate view, Delete view.
- The filter is **"Measure A5: Contains This page"** (`31-relation-tab-filter.png`). "Measure A5" is B's back-relation property; "This page" is a token value, listed above the real rows Alpha/Gamma/Beta in the value picker (`48-copy-filter-chip.png`).
- So it is a view of the **related database (B)**, filtered to rows whose back-relation contains the current row. It is **not** a view of the same database (A).
- Per-row result:
  - Builder preview Alpha: Two, One (`32-relation-tab-alpha-preview.png`, `32-relation-tab-probe.json`). Preview Gamma: Three (`42-preview-gamma.png`, `42-preview-gamma.json`).
  - After Apply, full pages: **Alpha → Two, One; Beta → no rows; Gamma → Three** (`59-reltab-ALPHA.json`, `59-reltab-BETA.json`, `59-reltab-GAMMA.json`, `59-reltab-BETA.png`).
  - Beta's empty state shows buttons **"Edit filters"**, **"+ New page"**, **"↗ Link existing"** (`59-reltab-BETA.png`). Clicking "New page" / "Link existing" there: UNMEASURED.
- Preview "Beta" in the builder: UNMEASURED (my click on the preview picker missed; `43-preview-still-gamma.png` is still Gamma). The full-page Beta result above covers it.

### 1d. "Link existing data source" > a source = the "View of" form
- With Measure B5 picked (`34-link-b5-form.png`, `34-link-b5-form.json`, `34-link-b5-form-controls.json`):
  - Name field, value "Measure B5", placeholder **"View name"**, focused, caret at end (not selected).
  - Row **"View of"** with value "Measure B5" (database glyph) and a chevron ›.
  - Row **"Add new relation"** with a switch, **off** by default.
  - Button **"Add view"**.
- "View of" › (changing the source from here): UNMEASURED (not clicked).
- "Add view" with the switch off (a plain linked view of B with no filter): UNMEASURED this run. Research 11 measured the same-database case (`Link existing data source` > its own database > "Add view"): an unfiltered view.

## 2. "Add new relation"

- Turning the switch on changes the form (`35-add-new-relation-on.png`, `35-add-new-relation-on.json`, `35-switch-states.json`):
  - Name placeholder becomes **"View & relation name"** (value still "Measure B5").
  - New row **"↔ Two-way relation"** with a "?" hint and a switch that is **on and disabled** (`disabled`, opacity 0.4).
  - Hint text (`36-twoway-hint.png`, read from the screenshot, the tooltip was gone before a DOM read): **"Manage separate properties for each direction of a two-way relation. This setting is required for relations of linked databases in tabbed views."**
  - Label **"Related property name"** with an input, empty, placeholder **"Measure A5 1"**.
  - Button becomes **"Add view & relation"**.
- "Add view & relation" (name and related name left as default) did all of this:
  - **On A**: a new relation property. In the builder's property group it read "Measure B5" (same as the old one) (`40-content-tab-props.png`); after Apply the table header and Beta's page read **"Measure B5 1"** (`61-db-A-after.png`, `61-db-A-after.json`, `70-beta-content-tab.png`). Why the label differs between the two: not checked.
  - **On B**: a new back-relation property **"Measure A5 1"** (`61-db-B-after.json`, B header: Name, Measure A5, Measure A5 1).
  - **A new tab** named **"Measure B5"** (a second one, same name as the first), selected, with View settings open: Property visibility **3**, **Filter "Measure A5 1"** = **"Measure A5 1: Contains This page"** (`37-after-add-view-relation.png`, `38-new-relation-tab-filter.png`).
  - The tab shows rows of B related to this row through the **new** relation. None are linked yet, so it is empty with an "Edit filters" button (`39-two-relation-tabs.png`). After Apply it was empty on Alpha, Beta and Gamma (`58-applied-*.json`).
- The new properties were created while the layout was still an unapplied draft. Whether they survive Cancel > Discard: UNMEASURED (I applied).

## 3. View tab menus

### 3a. In the builder
- Clicking a tab that is already selected opens its **View settings** popover (same content as 1c) (`44-builder-tab-click.png`, `44-builder-tab-click.json`). Rename is the name field at the top of it (used in `rename-tab.sh`, `56-renamed.png`). Items: name field, Layout, Property visibility, Filter, Sort, Group, Conditional color, Source, Edit properties, AI Autofill, More settings, **Duplicate view**, **Delete view**.
- With more tabs than fit, an overflow button **"1 more…"** appears (`47-copy-filter.png`, `50-original-still-filtered.png`). It opens a list (`51-one-more.png`, `51-one-more.json`): search **"Search for a view..."**, then every tab in order with a drag handle and "•••", then **"+ New view"**.
- The "•••" on a view row there opens: **Rename**, **Edit view**, divider, **Duplicate view**, **Delete view** (`52-overflow-row-menu.png`, `52-overflow-row-menu.json`). There is no "Copy link to view" in the builder.
- The **Content** tab's View settings has only the name field (value "Content", with an info icon); no Duplicate/Delete (`53-content-row-menu.png`). I reached it from the overflow list; which control opened it is unclear (I aimed at Content's "•••"), so the route is unverified, the content is as shown.

### 3b. On a row page (after Apply)
- Clicking the selected tab opens: **Customize layout**, **Display as ›**, **Copy link to view** (`59-reltab-BETA.png`, `59-row-tab-menu-BETA.json`). Same as research 11. No rename, duplicate or delete on a row page.

### 3c. Duplicate view
- Duplicated the first "Measure B5" tab from its View settings (`45-after-duplicate.png`):
  - **Placement: appended at the end of the tab bar**, after the second "Measure B5", not next to the original. The overflow list confirms the order: Content, Measure B5, Measure B5, Measure B5 (1) (`51-one-more.png`).
  - **Name: "Measure B5 (1)"** — suffix " (1)", not "(copy)".
  - The copy becomes the selected tab; the popover closes.
  - Same view block: there is still one `.notion-collection_view-block`, 3f9c2586-eb6d-80cc-ab06-dbbf6e3df3d5 (`49-copy-unfiltered.json`, taken with the copy selected). The copy's own view id: UNMEASURED.
  - It copies the filter: with preview Gamma it showed Three (`45-after-duplicate.png`).
- **Independent**: on the copy I deleted the filter (filter chip > "•••" > "Delete filter"). The copy then listed Three, Two, One (`49-copy-unfiltered.json`). The original still showed only Three for Gamma (`50-original-still-filtered.png`, `50-original-still-filtered.json`). Renaming the copy changed only the copy ("Measure B5 (1)CopyX"; my select-all did not take, so the text was appended) (`47-copy-filter.png`).
- **Delete view** asks a modal **"Delete this view?"** with **"Delete view"** (red text) and **"Cancel"** (`54-delete-view.png`, `54-delete-view.json`). After Delete, the copy is gone and **Content** becomes the selected tab (`55-after-delete-copy.png`).

### 3d. The tabs' view block as a page
- `/p/3f9c2586eb6d80ccab06dbbf6e3df3d5` opens a page titled **"View of Measure A5 and Measure B5"** (document title "View of Measure A5 and Measure B5 | Notion"), tabs Content | RelTab | NewRelTab (`60-view-block-page.png`, `60-view-block-page.json`). Research 11's single-source tab gave "View of Measure DB 3"; here the name lists both sources. RelTab there is empty (no current row for "This page").
- Selected tab after Apply: all rows opened on the last tab I had edited in the builder (NewRelTab) (`58-applied-*.json`). After I clicked RelTab on Alpha, the URL gained `?v=3f9c2586eb6d80caaf9c000c8c460aa3` (`59-reltab-ALPHA.json`).

## 4. AI Autofill "When page content is edited"

Setup: A > Add property > AI Autofill > Summarize › **One-liner**. That creates Text property "Summary" and opens "Autofill Summary" (`62-add-prop.png`, `63-autofill-dialog.png`). Same dialog as research 12.

- Triggers > **On page update** (value "None") opens a menu (`65-on-page-update-menu.png`, `65-on-page-update-menu.json`, `65-switch-before.json`):
  - Switch row **"When page content is edited"**, **off** by default.
  - Divider, heading **"When a property is updated"**: **None** (✓), **Any properties**, **Only specific properties**.
- Turning the switch on: the trigger's value becomes **"Page content"**, a blue unsaved dot + undo arrow appear in the header, "Save changes" turns blue (`66-switch-on.png`, `67-before-save.png`). Hint on the row: **"The agent automatically fills this property when the following are updated: Page content"** (`67-before-save.png`, `68-after-save.json`).
- "Save changes" → toast **"AI Autofill published successfully"** (`68-after-save.png`). Saving did **not** run anything: all Summary cells stayed empty (`69-table-after-save.png`). "Run AI Autofill now" and "Generate" were not clicked.
- **Run 1 — body edit only.** On Beta (full page, Content tab), I typed one paragraph in the page body: "Beta is a red bicycle with two wheels." at 17:27:16. No property was touched.
  - About 3 s later the Summary property shows **"Thinking…"** (`71-beta-body-typed.png`). It stayed "Thinking…" across a reload (`73-beta-after-reload.png`).
  - Filled between 17:30:08 and 17:30:39 (about 3 min after the edit) with **"Beta is a red bicycle with two wheels."** (`74-beta-summary-later.png`).
  - Only Beta ran. Alpha and Gamma Summary stayed empty (`75-table-after-run1.png`, `75-table-after-run1.json`).
- **Run 2 — second body edit.** Appended " It is blue now." at 17:31:09. "Thinking…" again within 3 s (`76-beta-edit2.png`); done between 17:34:10 and 17:34:31, value **"Beta is a two-wheel bicycle that was red but is now blue."** (`77-beta-after-edit2.png`). Both body edits re-ran it (2 of 2).
- Delay: about 3 min from edit to value in both runs. Whether that is a debounce, a queue, or model time: UNMEASURED.
- Credits: no counter, prompt, or paywall was shown. Credit cost and remaining credits: **UNMEASURED**. AI runs used: **2** (plus one search "Quick Answer" Notion generated on its own during the teardown search, `88-search-after-trash.png`).
- Whether a typing burst inside one block counts as one run or several: UNMEASURED (each of my edits was one `type` call and produced one "Thinking…").

## Teardown

- Builder > "More save options" > **"Reset to original page layout"** > **Reset** (`81-reset-confirm.png`, `82-after-reset.png`). The tabs' view block then shows **"moved this page to Trash just now"** (`83-viewblock-after-reset.png`). Alpha had no tabs after that.
- Scratch page: top-bar "Actions" > **"Move to Trash"** (`84-scratch-actions.png`). Notion navigated to the user's "Watch and Play List" page, which showed "Saving…" (`85-after-trash.png`). My next `goto` hit a `beforeunload` dialog; I dismissed it (stayed). "Watch and Play List" still reads **"Edited Aug 15"** afterwards (`87-watchlist-untouched.png`, `87-sidebar-check.json`). Nothing was typed there.
- Banners: the scratch page, Measure A5 and Measure B5 each show **"moved this page to Trash 2 minutes ago. It will be permanently deleted in 30 days."** (`86-trash-check-PAGE.png`, `86-trash-check-A.png`, `86-trash-check-B.png`).
- Sidebar text contains none of "Blok measure scratch 5", "Measure A5", "Measure B5", "View of Measure A5", "Alpha", "Beta", "Gamma" (`87-sidebar-check.json`).
- Sidebar search "Blok measure scratch 5": 24 results. The scratch page, A5, B5 and the view page are not among the **rendered** best-match rows (`88-search-after-trash.png`, `88-search-hits.json` reads only rendered text; not all 24 may have been rendered). A5 and B5 were not searched by their own names; their Trash state is confirmed by the URL banners above. Notion generated an AI "Quick Answer" on its own.
- Trash not emptied. Restore / Permanently delete never clicked. No viewport, workspace setting, sharing or plan change. Session `notion-measure5` closed (only that one; there was no other open session at start).
- Created during the run and trashed with the scratch page: rows Alpha/Beta/Gamma, One/Two/Three; properties Number, Measure B5, Measure B5 1, Summary (A) and Measure A5, Measure A5 1 (B); the view block 3f9c2586eb6d80ccab06dbbf6e3df3d5 (trashed by Reset first).

## UNMEASURED (collected)

- **A related source via "Link existing data source" with "Add new relation" off ("Add view"): filtered per row or not.** Top open question.
- "+" menu without a relation re-checked after a longer wait (seen at ~1.2 s only).
- "View of" › source change.
- Whether "Add new relation" properties survive Cancel > Discard of the draft.
- The duplicate's own view id.
- Clicking "+ New page" / "Link existing" inside an empty relation tab.
- Why the new A property read "Measure B5" in the builder but "Measure B5 1" after Apply.
- Autofill: credit cost; what sets the ~3 min delay; whether one typing burst = one run.
