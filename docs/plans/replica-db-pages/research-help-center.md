# Notion full-page vs inline databases: public-source research

Fetched 2026-10-25. Public pages only, no login. Primary = notion.com help/guides/releases and developers.notion.com.
Secondary = third-party blogs. Every secondary claim is labelled **[secondary]**. "Not found" means no source fetched here says it.

Note: `docs/plans/` is gitignored (`.gitignore:72`). Use `git add -f` if this file should be committed.

## Sources

| # | URL | Kind | What it gave |
|---|-----|------|--------------|
| S1 | https://www.notion.com/help/intro-to-databases | primary | Full-page vs inline section; ⤡ expand; drag-to-sidebar conversion; ⋮⋮ → Turn into inline; Lock database / Lock views; duplicate with/without content; row page layout; Customize page; Can edit content |
| S2 | https://www.notion.com/help/create-a-database | primary | Create paths: "Get started with → ••• → Table", `/database`, Build with AI, Suggested templates; AI from Home lands as a new page |
| S3 | https://www.notion.com/help/data-sources-and-linked-databases | primary | Data source model; "New empty database" / "Link to existing data source"; Manage data sources; moving a data source to a page |
| S4 | https://www.notion.com/help/views-filters-and-sorts | primary | Views as tabs; views nested in sidebar with •; "Open pages in" (Side peek / Center peek / Full page) and per-layout defaults; database search |
| S5 | https://www.notion.com/help/tables | primary | `/Table view` creates inline table; "Expand inline databases to full page by clicking ⤢ at the top right" |
| S6 | https://www.notion.com/help/navigate-with-the-sidebar | primary | Database pages' sidebar toggle shows views (•); pin a view; dragging to Trash deletes nested pages incl. database items |
| S7 | https://www.notion.com/help/duplicate-delete-and-restore-content | primary | Trash 30 days; restore; version history for databases and pages with inline databases; archived pages |
| S8 | https://www.notion.com/help/sharing-and-permissions | primary | Can edit content / Can create (database-only levels); page-level access rules; per-data-source rules |
| S9 | https://www.notion.com/help/create-links-and-backlinks | primary | @-mention creates backlinks; database page backlinks shown under properties |
| S10 | https://www.notion.com/help/customize-and-style-your-content | primary | Page icon / cover ("even to databases"); Full width toggle; database-page discussions |
| S11 | https://www.notion.com/help/keyboard-shortcuts | primary | Peek next/previous shortcuts; cmd/ctrl+shift+U up one level |
| S12 | https://www.notion.com/help/database-templates | primary | Database templates via New ▾ |
| S13 | https://www.notion.com/help/guides/creating-a-database | primary (guide) | "click the + New Page button and select a database type"; "a database is an advanced type of page" |
| S14 | https://www.notion.com/help/guides/using-linked-databases | primary (guide) | `/linked` to add a linked database |
| S15 | https://www.notion.com/help/guides/databases-reimagined-whats-changed | primary (guide) | Select a data source on create; tabs; unified View options menu |
| S16 | https://www.notion.com/releases/2022-07-20 | primary (changelog) | Side peek introduced; "Open pages as" setting affects everyone |
| S17 | https://www.notion.com/releases/2025-09-18 | primary (changelog) | Notion 3.0; database row permissions (page-level access) |
| S18 | https://developers.notion.com/reference/database | primary (API) | Database object: `is_inline`, title, description, icon, cover, parent, `in_trash`, `data_sources`, `show_data_source_title` |
| S19 | https://developers.notion.com/reference/block | primary (API) | `child_database` block type (title only) |
| S20 | https://developers.notion.com/docs/upgrade-faqs-2025-09-03 | primary (API) | Parent chain page → database → data source → page; wikis don't support multiple data sources |
| S21 | https://www.makeuseof.com/switch-database-full-page-to-inline-notion/ | secondary, 2022-02-17 | "turn into inline" via three dots beside the link; "Turn into page" via three dots top-right; can't use the page below a full-page database. **Predates the 2025 redesign.** |
| S22 | https://www.makeuseof.com/useful-navigation-features-notion-keep-organized/ | secondary, 2021-07-15 | Top bar shows the page path; opening an inline database from the sidebar shows it full page; linked databases don't create backlinks. **Old.** |
| S23 | https://vida.io/blog/notion-shortcuts | secondary, 2026-05-26 | `/table-inline` etc.; "Replace -inline with -full" |
| S24 | https://www.lilachbullock.com/how-to-create-a-database-in-notion/ | secondary, undated (fetched 2026-10-25) | Restates S1/S2 |
| S25 | https://wisechecker.com/notion-inline-database-vs-full-page-database-tradeoffs/ | secondary, 2026-05-01, **LOW CONFIDENCE** | Contradicts S1 twice (see Q4, Q6). Cited only for comparison. |

Unreachable: `notion.com/help/lock-a-database`, `/help/linked-databases`, `/help/side-peek` returned 404. Notion Academy pages returned a CloudFront 403, so fetching stopped there.

---

## Data model (API): primary, read this first

- "A database is an object that contains one or more data sources. Databases can either be displayed inline in the parent page (`is_inline: true`) or as a full page (`is_inline: false`)." [S18]
- `is_inline`: "Has the value true if the database appears in the page as an inline block. Otherwise has the value false if the database appears as a child page." [S18] **The same object with one flag. Inline vs full page is presentation, not two kinds of entity.**
- The database fields are `title` (rich text), `description` (rich text, "Description of the database as it appears in Notion"), `icon`, `cover` ("Page cover image"), `parent`, `url`, `in_trash`, `is_inline`, `data_sources[]`, `database_type`, `show_data_source_title`, `public_url`. [S18]
  - The field list has **no block-children / page-body field.** This fits the secondary claim that a full-page database has no free body (Q5). It does not prove it.
- In the parent page, the database is a `child_database` block whose payload is just `{ title }`. The same block type is used whether it is inline or full page (the block reference has only one database block type). [S19]
- Parent chain: database `parent` = page (or workspace). Data source `parent` = database. Row page `parent` = `data_source_id`. [S20]
- "Individual data sources don't have permissions settings … access … is managed through databases." [S18]

## 1. Creating

Primary:
- "create a new page and under **Get started with**, select **Table**. You can also open an existing page and use the slash command **/database**." [S1]
- "Create a new page and under **Get started with**, select **••• → Table**." [S2]
- "Create a new page and under **Get started with**, select **••• → Database** … In the menu that appears, select **New empty database**. You can also build the database with Notion AI or using a template." Or select **Link to existing data source**. [S3]
  - The three pages give slightly different labels (Table / ••• → Table / ••• → Database), so the UI has likely changed between edits. Quoted as is.
- Creating also offers **Build with AI** and **Suggested template** / **More templates** → **Get started**. [S1, S2]
- "Databases created with Build mode in Home will be added to your workspace as a new page." [S2]
- "click the + New Page button and select a database type." [S13]
- Sidebar: a + next to teamspace / Private / any page creates a page. There is also a tab button for "a database". [S6] The help does not say whether this creates a full-page database: **not found** explicitly.
- `/Table view` "on any page" creates an **inline** table. [S5]
- `/linked` adds a linked database. [S14]

Slash-menu labels for inline vs full page:
- **Not found in primary sources.**
- [secondary, S23 2026] `/table-inline`, `/board-inline`, `/calendar-inline`, `/list-inline`, `/gallery-inline`, `/timeline-inline`, and "Replace -inline with -full to create the database on a separate page (e.g., /table-full)". The exact visible menu-item text is not given.

## 2. What the parent page shows

- Primary: a full-page database is `is_inline: false`, which "appears as a child page" [S18]. In the parent's block list it is a `child_database` block [S19].
- "Full page databases appear just like any other page in your sidebar." [S1]
- Exact visual appearance in the parent (icon + title row like a sub-page link?): **not found in primary sources.**
- [secondary, S21 2022] after dragging a full-page database into a page, you click "the three dots beside **the link**". This implies it renders as a link row.
- [secondary, S25 low-confidence] "The parent page will show a link to the new page instead of the inline block."
- Inline: a block within the page. "Controls and menus for your inline database are hidden until you hover over it." ⋮⋮ appears on hover to the side. [S1]

## 3. Opening

- Expand an inline database: "You can expand an inline database to a full page database by selecting ⤡ at the top." [S1] and "Expand inline databases to full page by clicking ⤢ at the top right." [S5]
  - The two pages give different glyphs and positions. Both are quoted.
  - **Whether expand converts the database or only views it full page is not stated.** S1 lists drag-to-sidebar as a separate way to "turn an inline database into a full page database". This suggests the two actions differ, but that is unverified.
  - [secondary, S22 2021] "Clicking a database from the sidebar opens it up as a full page, even if it was inline."
- Navigation to its own URL: the API gives every database a `url` [S18]. "Copy link" to an inline database exists via ⋮⋮ [S1]. The in-app URL change on open is **not found**.
- Breadcrumbs: **not found in primary.** [secondary, S22] "The top bar of Notion shows you the path of pages and sub-pages that the current page you're on came from." Shortcut "cmd/ctrl + shift + U to go up one level in the page hierarchy." [S11]

## 4. Converting

Primary [S1]:
- Inline → full page: "You can turn an inline database into a full page database by clicking ⋮⋮ and dragging it into the sidebar as a top-level page."
- Full page → inline: "drag the database into another page in the sidebar, which will turn it into a subpage. Then navigate into the page, and select ⋮⋮ → **Turn into inline**."
- A "Turn into page" menu item for inline databases is **not found in primary sources.**
  - [secondary, S21 2022, pre-redesign] "click the three dots at the top-right of the database and selecting 'Turn into page'".
  - [secondary, S25 low-confidence] "… menu in the top-right corner of the database block, and select Turn into page." S25 also claims a "Turn into inline … Choose the destination page" flow. That contradicts S1's drag-then-⋮⋮ flow, so it is treated as unreliable.

What is preserved:
- Primary: **not found** explicitly.
- The API model shows both forms are the same object differing only in `is_inline` [S18]. That implies views, rows and title carry over, but this is inference.
- [secondary, S25 low-confidence] "without data loss".

Data-source move (2025 model, primary [S3]): "If you move your data source to a page (not a database), it'll be added as a database in that page. You can choose to move all your views over … Existing views that don't get moved along with the data source will become linked views. In your destination, you'll have a new table view of the data source."

Lock [S1]. The page uses two labels:
- "You can lock a full page database … by selecting ••• at the top of your database → **Lock database**." This stops others changing properties and value options. It sits in the full-page section.
- "**Lock views** … in the ••• menu at the very top right of the Notion window. Switch it on to prevent anyone from changing properties and views … They'll still be able to edit the data … anyone with editing access can toggle this lock on or off."
- Lock on inline databases: **not found.** Interaction between lock and conversion: **not found.** The `help/lock-a-database` URL is 404.

## 5. Full-page database layout

- Icon / cover: the database object has `icon`, `cover`, `title`, `description`. [S18] "Cover art appears as a banner image at the top of any page … (even to databases)." [S10]
- Full width: the page-level toggle (••• → Appearance & layout → Full width) [S10]. The default for full-page databases is **not found.**
- Page body (blocks above/below the database):
  - Primary: **not found.** The API database object has no children field [S18].
  - [secondary, S21 2022] "the inability to use the page below a database".
  - [secondary, S25 low-confidence] "A full-page database page contains only the database."
- Data-source title: "Full-page databases with one data source never show this title" (`show_data_source_title`, the in-app "Show data source title" setting). [S18] **This is a concrete inline vs full-page rendering difference.**
- View tabs: "quickly access your views by switching between tabs at the top of your database" [S15]. Tabs can show "Icon only, Text only, or both" (per user) [S4]. Add a view with "+ next to your database name" or "{#} more…" / "New view" on narrow screens [S4].
- Toolbar: settings (slider) menu → View settings (Layout, Property visibility, Filter, Sort, Group, Sub-group, Copy link to view) [S4]; "unified View options menu" [S15]; 🔍 search, "Databases that contain at least three pages will also be searchable" [S4]; "the blue **New** button at the top right" with ▾ for templates [S1, S12]; "+ New at the bottom" in table/list/board [S1].
- New databases default to Table view [S1, S4].

## 6. Sidebar

- Full page: "appear just like any other page in your sidebar." [S1]
- Inline: "In your sidebar, your inline database will appear as a subpage of the page it's in." [S1]
  - S25 (low-confidence) says the opposite ("Sidebar entry: No"). Primary wins.
- Views: "In your sidebar, views show up as nested items inside any full page database … they'll have a • to their left." [S4] "For database pages, you can open the toggle to see all the different views." [S6] A view can be pinned to the sidebar [S6].
- Rows as sidebar children: **not found.** The sidebar docs list only views (•) under a database.

## 7. Rows as pages

- "Every item in your database … is its own Notion page." [S1]
- Open: tables → hover the first column → **OPEN**; lists → click the title; board/calendar/gallery → click the card [S1].
- "Open pages in" per view: **Side peek** ("right side … rest of the database view continues to be interactive"), **Center peek** ("focused, center modal"), **Full page**. Path: settings menu → Layout → "Open pages in". [S4]
  - Defaults: "Table, Board, List & Timeline layouts will open pages in side peek by default. Gallery & Calendar layouts will open pages in center peek by default." [S4]
  - The 2022 changelog calls it "Open pages as" and says "This setting affects everyone who uses the database view." [S16]
- From peek: "Click ⤡ at the top left to view in full page mode." [S1]
- Peek navigation: ctrl+shift+K / ctrl+shift+J on Mac (ctrl+K / ctrl+J on Windows) for previous/next database page [S11].
- Row page layout [S1]:
  - Properties at the top, one per row (name, type, value). ⋮⋮ on hover lets you drag, change Property type, rename, Duplicate, or Delete.
  - "Underneath your properties is free page space" for any block.
  - Top section can also hold Comments and Backlinks.
  - ••• → **Customize page**: per property Always show / Hide when empty / Always hide; backlinks Expanded / Show in popover / Off; comments Expanded / Off.
  - Hidden properties collapse into one item at the bottom.
- "any other type of content you drag into a database (like bullets or to-do items), will automatically turn into pages." [S1]
- Right-click a row: Delete, Duplicate, Copy link, Rename, Move to, Edit property [S1].
- Breadcrumb row → database → parent: **not found** (see Q3, secondary S22 only).

## 8. Move, duplicate, delete, trash, restore, linked views, mentions

- Duplicate [S1]:
  - Inline: hover → ⋮⋮ → Duplicate.
  - Full page: ••• top right → Duplicate.
  - Both offer **Duplicate with content** / **Duplicate without content**.
- Inline ⋮⋮ also offers Delete, move, copy link [S1].
- Trash [S7]:
  - Drag to Trash at the bottom of the sidebar.
  - 30 days in Trash, then permanent deletion (kept 30 more days, then inaccessible).
  - A trashed page can't be edited until restored.
  - "Drag a page … into the Trash. This will delete all the sub-pages nested within that page, including database items." [S6]
- Version history [S7]:
  - "If you're restoring a database, all of its pages and their properties will be restored. However, any contents of the database pages … won't be restored."
  - For a page with an inline database, "you can choose to restore or not restore the database's pages and properties."
- Archived database pages are filtered out; Settings → View archived pages [S7].
- Data source removal [S3]: Manage data sources → Sources → ••• → Move / Move to Trash; Linked → X removes a linked source.
- Linked views [S3, S14]:
  - `/linked`, or `/database` → Link to existing data source.
  - Views, filters, sorts and groups in a linked view don't affect the original. Edits to title, properties and pages do.
  - Linked sources respect the original's access level.
- What happens to linked views when the source is trashed: **not found in primary.** [secondary S25 low-confidence] "all linked views stop working".
- @-mention [S9]:
  - "Backlinks are created automatically every time you @-mention a page." Backlinks show "under its title, or its properties if it's a database page."
  - Mentioning a whole database: **not found.**
  - [secondary S22] "databases that are linked do not include backlinks."

## 9. 2025 data sources change

- "Every database is made up of at least one data source. A data source is a set of pages in a database." [S3]
- A database can hold several sources, each with its own schema [S3, S18]. Manage via the slider icon → **Manage data sources** → **Add data source** / **Link existing data source** [S3].
- Terminology [S3, S15, S18]:
  - "database" = the container shown in the page (inline or full page).
  - "data source" = the set of rows plus schema.
  - "linked view of a data source" replaces "linked database".
- The API moved schema to `/v1/data_sources` [S18, S20].
- Effect on full page vs inline:
  - Both are still one `is_inline` flag on the database [S18].
  - The only stated difference is `show_data_source_title` ("Full-page databases with one data source never show this title") [S18].
- "wikis won't support multiple data sources" [S20].
- Release date: the API version is 2025-09-03 [S20]. The app changelog date for multi-source databases is **not found** (S17, 2025-09-18, covers Notion 3.0 and row permissions).

## 10. Permissions / sharing

- "Click Share at the top of a database" [S1]. It is shared like a page; access lives on the database, not on data sources [S18].
- Database-only levels [S8]:
  - **Can edit content**: create/edit/delete pages and values, but not properties, views, filters, sorts, or lock.
  - **Can create** (Business/Enterprise): create rows without seeing others' rows.
- Page-level access rules use a person / created-by property ("must be the source database and not a linked view"). Rules can differ per data source [S8]. Announced 2025-09-18 [S17].
- Users with Can edit content can still build linked views with their own filters [S1].
- Inline vs full-page sharing differences: **not found.**

## 11. Shortcuts and edge cases

- Shortcuts [S11]:
  - Peek previous/next: ctrl+shift+K / ctrl+shift+J (Mac), ctrl+K / ctrl+J (Windows).
  - cmd/ctrl+shift+U goes up one level.
  - cmd/ctrl+/ bulk-edits selected rows.
  - cmd/ctrl+L copies the page URL.
- Search appears only when a database has ≥3 pages [S4].
- With >1,000 items, new pages may appear mid-collection [S1].
- Empty database UI: **not found.**
- Database with no views / deleting the last view: **not found.**
- Empty title → "Untitled": **not found.**
- Notion AI can create but not edit databases. It can't create rows, automations, forms, charts, or templates [S2].
