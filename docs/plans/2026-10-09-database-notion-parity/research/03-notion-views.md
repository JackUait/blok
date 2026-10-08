# Notion database VIEWS — feature inventory for a feature-for-feature clone

Researched 2026-10-09. Sources are Notion's help centre, its release notes and its developer docs. Every page below was fetched with curl in this session. WebFetch and WebSearch hit a rate limit, so no third-party pages were used. Raw copies are in `scratchpad/research/views-raw/`.

**How sources are cited.** Each bullet ends with a source key in brackets, like `[H-tables]`. The legend below maps each key to the URL that was fetched. "Unverified" means not found in any fetched Notion source. "NOT FOUND" means the fetched Notion pages do not cover the topic.

## Source legend

| Key | URL |
|---|---|
| H-views | https://www.notion.com/help/views-filters-and-sorts |
| H-tables | https://www.notion.com/help/tables |
| H-boards | https://www.notion.com/help/boards |
| H-galleries | https://www.notion.com/help/galleries |
| H-lists | https://www.notion.com/help/lists |
| H-calendars | https://www.notion.com/help/calendars |
| H-timelines | https://www.notion.com/help/timelines |
| H-charts | https://www.notion.com/help/charts |
| H-feeds | https://www.notion.com/help/feeds |
| H-maps | https://www.notion.com/help/maps |
| H-forms | https://www.notion.com/help/forms |
| H-dash | https://www.notion.com/help/dashboards |
| H-ds | https://www.notion.com/help/data-sources-and-linked-databases |
| H-intro | https://www.notion.com/help/intro-to-databases |
| H-settings | https://www.notion.com/help/customize-your-database (page title "Database settings") |
| H-props | https://www.notion.com/help/database-properties (#conditional-color) |
| H-subitems | https://www.notion.com/help/tasks-and-dependencies |
| H-perf | https://www.notion.com/help/optimize-database-load-times-and-performance |
| H-keys | https://www.notion.com/help/keyboard-shortcuts |
| H-layouts | https://www.notion.com/help/layouts (page layouts, not view layouts) |
| G-deps | https://www.notion.com/help/guides/tasks-manageable-steps-sub-tasks-dependencies |
| G-table | https://www.notion.com/help/guides/table-view-databases |
| G-reimagined | https://www.notion.com/help/guides/databases-reimagined-whats-changed |
| API-views | https://developers.notion.com/guides/data-apis/working-with-views (fetched as `.md`) |
| API-view | https://developers.notion.com/reference/view |
| API-versions | https://developers.notion.com/reference/changes-by-version |
| R-YYYY-MM-DD | https://www.notion.com/releases/YYYY-MM-DD |

---

## 0. Recently added (dated)

| Date | Change | Source |
|---|---|---|
| 2026-04-10 | View tabs can show as "Text and icon", "Text only" or "Icon only". The setting is per user. | [R-2026-04-10] |
| 2026-03-26 / 2026-03-10 | **Dashboard** view, a grid of widgets where each widget is a view. Business and Enterprise plans only. | [R-2026-03-26] [R-2026-03-10] |
| 2026-03-05 | New "Can create pages" database permission. | [R-2026-03-05] |
| 2025-11-17 | **Map** view and the Place property. Conditional color now works with formulas, relations and rollups. Filters now cover sub-items. | [R-2025-11-17] |
| Sept 2025 | **Multi-source databases**: one database can hold several data sources. The API moved to `/v1/data_sources` in version 2025-09-03. | [API-versions] |
| 2025-09-18 | Row-level (page-level) permissions in databases, Business and Enterprise. | [R-2025-09-18] |
| 2025-07-10 | **Feed** view, plus a database visual refresh ("+ property"; group, insert and rename from the property menu). | [R-2025-07-10] |
| 2025-03-26 | Chart drilldown (click a chart segment). Form conditional logic. Tabbed page layout. | [R-2025-03-26] |
| 2024-10-24 | **Forms** view. Page layouts. | [R-2024-10-24] |
| 2024-08-13 | **Chart** view: bar, line, pie/donut; drag charts around a page. | [R-2024-08-13] |
| 2024-02-26 | Calendar "Show weekends" toggle. Database "Show page icon" toggle. | [R-2024-02-26] |
| 2023-09-22 | Freeze columns in tables. "Wrap all properties" for Board and Gallery. | [R-2023-09-22] |
| 2022-12-15 | Sub-items and dependencies (timeline arrows). Inline editing and keyboard shortcuts in List view. | [R-2022-12-15] |
| 2022-11-08 | Toggle vertical gridlines in Table view. | [R-2022-11-08] |
| 2022-08-25 | Inline property editing on Board cards. Drag-fill handle in tables. | [R-2022-08-25] |
| 2022-07-20 | "Open pages in": side peek, center peek or full page. | [R-2022-07-20] |
| 2022-04-14 | Per-column wrap. Double-click a resizer to auto-fit. Esc deletes an accidental empty row. "Load x more" row. | [R-2022-04-14] |
| 2022-03-15 | View tabs, unified view-options menu, quick filters, "Save for everyone", data source picker, copying an existing view, multiple databases in one view block, hiding the source title of a linked view. | [R-2022-03-15] |
| 2021-10-19 | Groups in Table, List, Gallery and Timeline. Sub-groups in Board. Grouping by almost any property type. "Color columns". | [R-2021-10-19] |
| 2020-11-11 | Timeline view. Inline row limit of 10/25/50/100 with load more. | [R-2020-11-11] |

---

## 1. Cross-cutting model

### 1.1 View object (API spec, the best "schema" source)
- A view is scoped to exactly **one data source** in a database. Fields: `id`, `parent.database_id`, `data_source_id` (null for dashboards), `name`, `type`, `filter`, `sorts`, `quick_filters`, `configuration` (a union keyed on `type`), created/edited metadata, `url`, and `dashboard_view_id` (set only on widget views). [API-view] [API-views]
- View types in the API: `table`, `board`, `calendar`, `timeline`, `gallery`, `list`, `form`, `chart`, `map`, `dashboard`. **Feed is not an API type**, but it exists in the app and in the conditional-color view list. [API-view] [H-feeds] [H-props]
- A new database (via the API) gets one data source and one Table view named "Default view". [API-views]
- In the app, new databases start as tables. [H-views]
- A database must always keep at least one view. Deleting the last view returns `validation_error`. [API-views]
- Feature-support matrix (Yes / Optional / Required / –): [API-views]

| Feature | Table | Board | Calendar | Timeline | Gallery | List | Map | Form | Chart | Dashboard |
|---|---|---|---|---|---|---|---|---|---|---|
| properties | Yes | Yes | Yes | Yes | Yes | Yes | Optional | – | – | – |
| group_by | Optional | **Required** | – | – | – | – | – | – | – | – |
| sub_group_by | – | Optional | – | – | – | – | – | – | – | – |
| subtasks | Optional | – | – | – | – | – | – | – | – | – |
| cover / cover_size / cover_aspect / card_layout | – | Optional | – | – | Optional | – | – | – | – | – |
| date_property_id | – | – | **Required** | **Required** | – | – | – | – | – | – |
| end_date_property_id | – | – | – | Optional | – | – | – | – | – | – |
| view_range / show_weekends | – | – | Optional | – | – | – | – | – | – | – |
| preference (zoom) / arrows_by | – | – | – | Optional | – | – | – | – | – | – |
| show_table / table_properties | – | – | – | Optional | – | – | – | – | – | – |
| wrap_cells / frozen_column_index / show_vertical_lines | Optional | – | – | – | – | – | – | – | – | – |
| height | – | – | – | – | – | – | Optional | – | Optional | – |
| map_by | – | – | – | – | – | – | Optional | – | – | – |
| is_form_closed / anonymous_submissions / submission_permissions | – | – | – | – | – | – | – | Optional | – | – |
| chart_type (req) / x_axis / y_axis / value | – | – | – | – | – | – | – | – | Yes | – |
| rows (read-only) | – | – | – | – | – | – | – | – | – | Yes |

- Note: the API matrix lists `group_by` only for Table and Board. The help centre and the 2021-10-19 release also say groups work in **List, Gallery and Timeline**. Treat the API matrix as incomplete there. [R-2021-10-19] [H-views] [API-views]
- **Per-property view config** (`properties[]` entries): [API-views]
  - `property_id` (an ID or a name), `visible`, and `width` (an integer in pixels, table only).
  - `wrap` (per property, cell or card).
  - `status_show_as` (`select` | `checkbox`).
  - `card_property_width_mode` (`full_line` | `inline`, for compact board/gallery cards).
  - `date_format` (`full` | `short` | `month_day_year` | `day_month_year` | `year_month_day` | `relative`).
  - `time_format` (`12_hour` | `24_hour` | `hidden`).
  - No default pixel width is documented.
- **Group-by config** (shared by table/board groups, board sub-groups, chart axes): [API-views]
  - Common fields: `type`, `property_id`, `sort` (`manual` | `ascending` | `descending`), `hide_empty_groups`.
  - `status`: `group_by` = `group` (To-do/In progress/Complete) or `option`.
  - `date`, `created_time`, `last_edited_time`: `relative` | `day` | `week` | `month` | `year`, plus `start_day_of_week` 0 or 1.
  - `text`, `title`, `url`, `email`, `phone_number`: `exact` or `alphabet_prefix`.
  - `number`: `range_start`, `range_end`, `range_size` (≥1) buckets.
  - Also groupable: `select`, `multi_select`, `person`, `created_by`, `last_edited_by`, `relation`, `checkbox`.
  - `formula`: a nested group-by on the formula's result type (date/text/number/checkbox).
- **Quick filters**: a map of property → condition, shown in the view's filter bar. People filters accept `"me"`. [API-views]

### 1.2 View tabs bar
- **Add a view**: click "+" next to the database name or the view tabs. On narrow screens, click the current view name → "New view". Pick a layout, then name the view. [H-views]
- **Per-view actions**: click the view name to rename, duplicate, delete, copy the link, or edit its components. [H-views]
- **Reorder** tabs by dragging. With many views, use "{#} more..." to reach and reorder the overflow. [H-views]
- **Insert position (API)**: `position` = `start` | `end` (default) | `after_view {view_id}`. [API-views]
- **Tab display**: "Display as" → Icon only, Text only, or both. Only you see the change, and only on this database. Shipped 2026-04-10. [H-views] [R-2026-04-10]
- **Sidebar**: views of a full-page database appear nested in the sidebar with a "•" marker. Clicking one jumps to it. [H-views]
- **Tabs replaced the dropdown** (2022-03-15). One view block can mix views from different databases/data sources. [R-2022-03-15] [G-reimagined]
- Linked views can hide the source database title. [R-2022-03-15]

### 1.3 View-level vs database-level settings
- **View settings** (each view has its own): Layout, Property visibility, Filter, Sort, Group, Sub-group, Conditional color, Copy link to view. Settings do not carry over to other views. [H-views] [H-props]
- **Database settings** (apply to the whole database, Can edit or higher): [H-settings]
  - Lock database.
  - Edit properties.
  - Automations.
  - Sub-items / Sub-tasks.
  - Dependencies.
  - Sprints (Task databases).
  - Connections.
  - Customize page layout.
  - Turn into Tasks / Undo Task database.
- **Scope of changes**:
  - Filters and sorts stay personal until you click "Save for everyone". "Reset" discards them. [H-views] [R-2022-03-15]
  - Tab display style is personal. [H-views]
  - "Open pages in" affects everyone who uses the view. [R-2022-07-20]
  - In dashboards, filters and sorts set in View mode are stored locally unless saved for everybody by an editor. [H-dash]
- **Conditional color** is per view and is copied when a view is duplicated. [H-props]
- **Page layout** applies to all pages in the database. It cannot be scoped to one view. [H-layouts]
- **"Show page icon"** is a toggle in the database's "…" menu (2024-02-26). The docs do not say whether it is per view or per database (unverified). [R-2024-02-26]

### 1.4 Open pages in
- Options: **Side peek** (opens on the right; the view stays interactive), **Center peek** (modal), **Full page**. Path: Layout → Open pages in. [H-views]
- Defaults: Table, Board, List and Timeline use side peek. Gallery and Calendar use center peek. [H-views]
- Pages "always open in a peek preview". Click ⤡ for full page. [H-intro]
- How to open an item:
  - Tables: hover the first column and click OPEN.
  - Lists: click the title.
  - Boards, calendars and galleries: click the card. [H-intro]
- Keyboard in peek: next page is ctrl+shift+J (Mac) or ctrl+J (Win). Previous page is ctrl+shift+K (Mac) or ctrl+K (Win). [H-keys]

### 1.5 Filters, sorts, groups, search
- **Simple filters**, plus **advanced filters** with AND/OR groups nested up to **3 levels**. You can promote a simple filter with "••• → Add to advanced filter". [H-views] [R-2020-05-28]
- Quick filters support relative dates ("today", "within the past month"). [R-2022-04-14]
- New entries created in a filtered view inherit the filter values. For example, AND-filtered multi-select tags are all applied. [R-2020-05-28]
- **Sorts**: multiple sorts, reordered by dragging ⋮⋮. [H-views]
  - Text sorts alphabetically. Numbers sort numerically.
  - Select and multi-select sort by the option order you set by dragging options. Alphabetical or manual option sorting was added 2023-08-08. [H-views] [R-2023-08-08]
- **Groups** (Settings → Group): hide or show each group with 👁️, sort groups manually or by the offered orders, "Hide empty groups", "Remove grouping". [H-views]
- **Collapse groups**: each group has a toggle on its left to hide or show its items. [R-2021-10-19]
- cmd/ctrl+option/alt+T opens or closes **all database groups** on a page, as well as toggles. [R-2022-08-11]
- **Grouping by relation/formula**: the Boards FAQ says "Not currently". That conflicts with the 2021-10-19 release ("Formula, Relation… supported") and with API group-by types `relation` and `formula`. **The FAQ looks stale.** [H-boards] [R-2021-10-19] [API-views]
- **Search in a view**: available once a database has **at least 3 pages**. Click 🔍. Results filter live as you type. Matches page titles and properties. [H-views]
- **Sub-item interaction**: sub-item visibility settings change filter results. The filter scope can be Parents only, Parents and sub-items, or Sub-items only. Board, calendar and gallery support only "Parents only". [H-views] [H-subitems]
- **Performance**: sorts and filters on title/text/formula/rollup slow loading. Filtering on simple properties helps. [H-perf]

### 1.6 Load limits / pagination
- **Inline Table, List, Gallery and Timeline** can show only **10, 25, 50 or 100** rows at first, then "click to load more" (2020-11-11). [R-2020-11-11]
- A "Load x more" row exists in Table view. [R-2022-04-14]
- The Timeline help page documents "Layout → Load limit → select a number of pages". The page gives no numbers. [H-timelines]
- **Board load limit**: unverified. The 2020-11-11 release lists only tables, lists, galleries and timelines.
- Map shows at most **100 items** at once. [H-maps]
- Chart shows at most **200 groups and 50 sub-groups**. [H-charts]
- Dashboard holds at most **12 widgets, 4 per row**. [H-dash] [API-views]
- Database caps: 250,000 rows, 500 properties, 2.5MB of property data per page, 1.5MB schema. [H-perf]
- Above 1,000 items, new pages may appear mid-collection instead of at the end. [H-intro]
- Databases load lazily ("only load what you need", 2022-04-14). [R-2022-04-14]
- API view queries return a cached result set (~15 min TTL) with cursor pagination. [API-views]

### 1.7 Locking & permissions
- **Lock database** (Database settings): people can still enter data but cannot change views or properties. [H-settings]
- **Lock views** (the "•••" menu, top right): prevents changes to properties and views. Data stays editable. Anyone with edit access can toggle it. [H-intro]
- For full-page databases, the help text says "can't change properties and value options". [H-intro]
- The docs use two names for this lock. Both are reported here.
- **Can edit content**: can create, edit and delete pages and property values. Cannot add, edit or remove properties or views, change filters or sorts, or lock/unlock. Can still create linked databases and edit views in them. [H-intro]
- **Can create pages** permission (2026-03-05). [R-2026-03-05]
- Row-level permissions (2025-09-18). [R-2025-09-18]

### 1.8 Creating rows (all views)
- Blue **New** button, top right (all databases). [H-intro]
- **+ New** at the bottom of a table, list or board. [H-intro]
- Calendar: hover a day and click **+**. [H-intro]
- Gallery: **+ New** in the empty card at the end. [H-intro]
- **Right-click an item**: Delete, Duplicate, Copy link, Rename, Move to, Edit property. [H-intro]
- Bulk edit: select rows or cards, then press cmd/ctrl+/ to edit them all. [H-keys]
- Content dragged into a database becomes pages. [H-intro]

### 1.9 Conditional color
- Path: View settings → Conditional color → New color setting. Pick a property and a rule, then a page background color. Defaults to the option colors. "Add another" adds more rules. [H-props]
- Views that support it: Table, Calendar, Timeline, List, Board, Feed. **Not** Gallery, Chart, Map or Form. [H-props]
- Properties that can drive it: Select, Multi-select, Status, Title, Text, Number, Date, Person, Checkbox, Formulas, Relations, Rollups. [H-props]
- In Table only, "Apply to" can color the whole row or just the property cell. Everywhere else the whole page background is colored. [H-props]

### 1.10 Data sources & linked views (2025 model)
- Every database has ≥1 **data source** (a set of pages). A new database can create a new source or "Link to existing data source". [H-ds]
- A database can hold **multiple data sources**. Path: slider icon → Manage data sources → Add data source / Link existing data source. [H-ds]
- **Sources** (owned by this database): "•••" → Move (to another database, or to a page where it becomes a database) or Move to Trash. [H-ds]
- **Linked** (owned elsewhere): X removes the link. [H-ds]
- When moving a source, you choose whether its views move with it. Views left behind become linked views. The destination gets a new table view. [H-ds]
- Linked source behaviour:
  - Views, filters, sorts and groups made on it do **not** affect the original.
  - Edits to the title, properties or pages **do** reach the original.
  - Access follows the original database. You cannot set access per source. [H-ds]
- **Forms** can only be added to the database that owns the data source, not to a linked one. [H-ds]
- **API**: version 2025-09-03 split `/v1/databases` (container) from `/v1/data_sources`. Multi-source databases are "new in the Notion app as of September 2025". [API-versions]
- **API**: each view targets one `data_source_id`. `create_database` makes a linked database view on a page. [API-views]
- When adding a view over an existing source, you can **copy an existing view**: hover to preview, then pick one to copy its filters, sorts, grouping and property visibility. [R-2022-03-15] [G-reimagined]
- Perf tip: one linked database with many views (each pointing to a different source) keeps only one view live at a time. [H-perf]

### 1.11 Sub-items & dependencies (affect views)
- Sub-item display, per layout: [H-subitems]
  - Table, list and timeline: "Nested in toggle" or "Flattened list".
  - Board, calendar and gallery: "Card property" or "Flattened list".
- API `subtasks.display_mode` = `show` | `hidden` (parents with a count) | `flattened` | `disabled`. Other fields: `filter_scope` and `toggle_column_id`. [API-views]
- Deleting a parent deletes its sub-items. Duplicating a parent duplicates its sub-items. [H-subitems]
- Charts may need the "Flattened list" setting so sub-items are counted. [H-charts]
- **Dependency date shifting** options: "Shift only when dates overlap", "Shift & maintain time between items", "Do not automatically shift". Separate toggle: "Avoid weekends". [H-subitems]

---

## 2. Table view
- **Shows** pages as rows with one column per property. Each row opens as a page. The Title column cannot be deleted, only moved. [H-views] [H-tables]
- **Create**: Get started with → ••• → Table, `/Table view` (inline), or "+" → Table on an existing database. ⤢ expands an inline database to full page. [H-tables]
- **Bulk select**: hover a row and tick its checkbox. The header checkbox (on Name) selects all. The menu that appears edits properties for every selected row. [H-tables]
- **Reorder rows**: drag the ⋮⋮ handle on the left. [H-tables]
- **Reorder columns**: drag a header, or drag in Properties → ⋮⋮. [H-tables]
- **Resize columns**: drag the column edge. Double-click the resizer to auto-fit. Width is stored in pixels per property (`width`, no documented default). [H-tables] [R-2022-04-14] [API-views]
- **Wrap**: per column (header → Wrap text / "Wrap column") or "wrap all columns" in Layout. API: `wrap_cells` plus per-property `wrap`. [H-tables] [R-2022-04-14] [G-table] [API-views]
- **Vertical lines**: Layout → show or hide (2022-11-08). API `show_vertical_lines`. [G-table] [R-2022-11-08] [API-views]
- **Freeze**: header → "Freeze up to column" / "Unfreeze column". API `frozen_column_index` (number of columns frozen from the left). [H-views] [R-2023-09-22] [API-views]
- **Calculations** (column footer; header → Calculate): [H-tables]
  - Any column: Count all, Count values, Count unique values, Count empty, Count not empty, Percent empty, Percent not empty.
  - Dates: Earliest date, Latest date, Date range.
  - Numbers: Sum, Average, Median, Min, Max, Range.
  - The API aggregator list adds checkbox aggregators: `checked`, `unchecked`, `percent_checked`, `percent_unchecked`. [API-views]
  - The "Calculate" placeholder is hidden on inline tables until hover. [R-2022-04-14]
- **Grouping** is optional. Groups collapse, can be hidden, and "Hide empty groups" applies. [R-2021-10-19] [API-views]
- **Inline editing / keyboard**:
  - Drag the fill handle (small circle at the cell's bottom) to fill selected cells. [R-2022-08-25]
  - cmd/ctrl+R fills right and cmd/ctrl+D fills down when several cells are selected. [H-keys]
  - Esc on an accidental empty new row deletes it. [R-2022-04-14]
- **Comments on a property cell**: hover the cell → 💬. Not supported for name, formula, rollup, button or unique ID. Checkbox needs the page to be open. [H-props]
- **Row height**: NOT FOUND for database tables in any fetched source. Only dashboard rows have a documented height.
- **Grid keyboard navigation** (arrows, Enter to edit): NOT FOUND in fetched sources.
- **Whether a sort disables manual drag-reorder**: NOT FOUND in fetched sources.
- **Empty state**: NOT FOUND in fetched sources.
- Simple (non-database) tables are a different block. [H-tables]

## 3. Board view
- **Shows** cards grouped into columns by a property. [H-boards]
- **Default grouping**: Status if one exists. Otherwise select, person, multi-select or relation. If none exists, a new Status property is created. Board `group_by` is **required** (API). [H-boards] [API-views]
- **Group by** (Settings → Group) and **Sub-groups** (Settings → Sub-groups; a second layer of groups inside each group). [H-boards] [R-2021-10-19]
  - How sub-groups are drawn on screen is not described in the fetched docs (unverified).
- **Status grouping** can be by status group or by individual option. [API-views]
- **Adding a column** means adding an option to the grouped property. Edit property → "+" next to the options. [H-boards]
- **Drag**: drag a header to reorder columns. Drag cards up/down or between columns, which changes the grouped property value. [H-boards]
- **Hidden archive pattern**: drag cards onto a hidden column listed under "Hidden Columns". [H-boards]
- **Hide a column**: column ••• → Hide group. Revealed again under Settings → Group, which lists visible and hidden groups. [H-boards]
- **Color columns** is on by default. Toggle it under Group. [H-boards] [R-2021-10-19]
- **Card size**: Small, Medium or Large (Layout → Card size). API `cover_size`. [H-boards] [API-views]
- **Card preview**: Page cover, Page content (first image on the page), or any Files & media property. API `cover.type` = `page_cover` | `page_content` | `property`. [H-boards] [API-views]
- **Fit image**: on = contain, with hover → "Reposition" to drag the image. Off = crop to fill. API `cover_aspect` `contain` | `cover`. [H-boards] [API-views]
- **Card layout** (API only): `list` (full) | `compact`. Per-property `card_property_width_mode`. [API-views]
- **"Wrap all properties"** in Layout (2023-09-22). [R-2023-09-22]
- **Property visibility** on cards: 👁️ to show or hide, ⋮⋮ to reorder. [H-boards]
- **Inline editing**: click a property on a card to edit it without opening the page (2022-08-25). [R-2022-08-25]
- **Column calculations**: a gray number beside each header. Default is the card count. Can be changed to any calculation in the table list. [H-boards]
- **Add card**: + New at the bottom of a column. [H-intro]
- **Board load limit / "load more" per column**: unverified (not in fetched sources).
- **Keyboard**: NOT FOUND beyond bulk select plus cmd/ctrl+/. [H-keys]
- **Empty state**: NOT FOUND.

## 4. Gallery view
- **Shows** a grid of cards built for visuals. Without a Files & media setting, cards show page content. [H-views] [H-galleries]
- **Card preview**: Page cover, Page content (first block; an image or video shows if that comes first), or a Files & media property. [H-galleries]
- **Fit image** on/off plus Reposition, same as Board. [H-galleries]
- **Card size** dropdown (Layout). API `small` | `medium` | `large`. [H-galleries] [API-views]
- **Hide card name**: switch off Name in Properties, so images stand alone. [H-galleries]
- **Property visibility**: 👁️ and ⋮⋮. "Wrap all properties" (2023-09-22). API `card_layout` `list` | `compact`. [H-galleries] [R-2023-09-22] [API-views]
- **Reorder**: drag cards left, right, up or down. [H-galleries]
- **Add**: + New in the trailing empty card. [H-intro]
- **Groups** are supported in Gallery (2021-10-19). [R-2021-10-19]
- **Load limit** 10/25/50/100 when inline. [R-2020-11-11]
- Opens pages in **center peek** by default. [H-views]

## 5. List view
- **Shows** minimal rows, one per page, with properties shown at the far right. [H-lists]
- **Property visibility**: 👁️ and ⋮⋮ ordering. [H-lists]
- **Open** by clicking the title. [H-intro]
- **Inline editing**: click any property to edit it. [R-2022-12-15]
- **Keyboard**: **Shift+Enter** on a selected page creates a new item below. **Tab** moves between properties. [R-2022-12-15]
- **Add**: + New at the bottom. **Groups** are supported. **Load limit** 10/25/50/100 when inline. [H-intro] [R-2021-10-19] [R-2020-11-11]
- **Sub-items**: nested toggle or flattened. [H-subitems]
- **Reorder rows by drag in List**: NOT FOUND in fetched sources.

## 6. Calendar view
- **Requires** a Date property. Items are placed by that date. [H-calendars]
- **Show calendar by**: pick one of several date properties. API `date_property_id` (required). [H-calendars] [API-views]
- **Show calendar as**: Month (default) or Week. API `view_range` `month` | `week`. [H-calendars] [API-views]
- **Show weekends** toggle (2024-02-26). API `show_weekends`. [R-2024-02-26] [API-views]
- **Navigate**:
  - < and > arrows around **Today**.
  - Scroll down to advance months infinitely. You cannot scroll up to go back.
  - The view remembers the last range you viewed. [H-calendars]
- **Drag**: move a card to another day. Drag its left or right edge to span several days. [H-calendars]
- **Create**: hover a day and click **+**. [H-intro]
- **Property visibility** on cards: 👁️ and ⋮⋮. [H-calendars]
- **Week start**: Settings → Preferences → "Start week on Monday". It defaults by region and is a user setting, not a view setting. [H-calendars]
- **No day/year view** on desktop. Mobile has a daily view (tap a date). [H-calendars]
- Opens in **center peek** by default. Sub-items show as a card property or flattened. [H-views] [H-subitems]
- Calendar views can sync two-way with Notion Calendar ("Open in Calendar"; text properties editable since 2025-11-17). [H-calendars] [R-2025-07-10] [R-2025-11-17]
- **Items with no date** (unscheduled tray): NOT FOUND in fetched sources.
- **Drag to create a multi-day event / time slots in week view**: NOT FOUND.

## 7. Timeline view
- **Requires** at least one date property holding a **range**, otherwise nothing is plotted. [H-timelines]
- **Show timeline by**: a date property, or **separate start and end properties**. API `date_property_id` (required) plus `end_date_property_id`. [H-timelines] [API-views]
- **Zoom** dropdown (left of Today), "from hours all the way up to years". API `zoom_level` values are `hours`, `day`, `week`, `bi_week`, `month`, `quarter`, `year`, `5_years`. `center_timestamp` is also stored. [H-timelines] [API-views]
- **Today** button jumps to the current date. [H-timelines]
- **Off-screen arrows**: small arrows on a row show the item lies before or after the visible range. Click one to jump to the item. [H-timelines]
- **Resize bars**: drag the left or right edge. Date indicators guide the drag. [H-timelines]
- **Reorder**: drag items up or down. [H-timelines]
- **Moving a whole bar** along time: implied by "re-scope or move" in a guide. Not explicit in help (unverified).
- **Table panel**: show or hide with >> / <<. It has its own property list (Layout → Table properties). Calculations are available in the table panel (same list as Table). API `show_table` and `table_properties`. [H-timelines] [API-views]
- **Property visibility on bars**: 👁️ and ⋮⋮. [H-timelines]
- **Load limit**: Layout → Load limit. Inline values are 10/25/50/100. [H-timelines] [R-2020-11-11]
- **Dependencies** (Database settings → Dependencies; a self-relation, "Dependencies" by default):
  - Hover an item, then drag the arrow on its right onto another item to create a blocking link. It shows only in timeline. [G-deps] [R-2022-12-15]
  - API `arrows_by.property_id` (null disables arrows). Shifting rules are in §1.11. [API-views] [H-subitems]
- **Color**: conditional color supported. API `color_by`. [H-props] [API-views]
- **Groups** in Timeline (2021-10-19). The original 2020 timeline grouped by Date, Created time or Last edited time. [R-2021-10-19] [R-2020-11-11]
- Opens in **side peek** by default. [H-views]
- **Items with no date**: NOT FOUND in fetched sources.
- **Show weekends in timeline**: NOT FOUND.

## 8. Chart view
- **Create**: `/chart`, then Vertical bar, Horizontal bar, Line, Donut or Number. Link an existing database or create a new one. Or add it via "+" → Chart. [H-charts]
- API `chart_type` = `column` | `bar` | `line` | `donut` | `number`. [API-views]
- **You cannot edit entries from a chart.** [H-charts]
- **Bar/line X axis**: "What to show" (property), "Sort by", Visible/Hidden groups (👁️), "Omit zero values". [H-charts]
- **Bar/line Y axis**: "What to show" (a property or Count), "Group by" (or None), "Omit zero values", "Cumulative" (only for Count or Sum with the X axis ascending). [H-charts]
- Axes cannot use rollups, buttons, unique IDs, files, or list-valued formulas. [H-charts]
- **Donut**: "What to show", "Each slice represents", "Sort by", visible/hidden groups. [H-charts]
- **Style**: [H-charts]
  - Color palette.
  - Height: Small to Extra large.
  - Grid line (horizontal/vertical).
  - Axis name.
  - Data labels.
  - Smooth line.
  - Gradient area.
  - Show value in center (donut).
  - Color by value (bar/donut, when the palette is not Auto/Colorful).
  - Legend (line/donut).
- **API extras**: [API-views]
  - `sort` (manual / x or y, ascending or descending).
  - `color_theme` (gray, blue, yellow, green, purple, teal, orange, pink, red, auto, colorful).
  - `legend_position` (off / bottom / side), `axis_labels`, `grid_lines`.
  - `y_axis_min` / `y_axis_max`.
  - `reference_lines` (value, label, color, solid/dash).
  - `caption`.
  - `stack_by`, plus `group_style` (normal / percent / side_by_side).
  - `donut_labels`.
  - Number chart `value` aggregation and `hide_title`.
  - Results mode (`x_axis_property_id` / `y_axis_property_id`).
  - `hide_empty_groups`.
- **Interact**: hover for labels. Click a group for a **drilldown**. Click a legend entry to hide that group. Copy link. [H-charts]
- **Drilldowns** are table-only. "••• → Save as view in" saves one to a page. Inside a drilldown you cannot bulk-select, freeze, calculate, or add pages. [H-charts]
- **Export**: "Save chart as…" with a background choice, then Copy as PNG, Download PNG, or Download SVG. Paid plans can remove the background and watermark. [H-charts]
- **Limits**: 200 groups / 50 sub-groups. Free plan gets 1 chart. Paid plans are unlimited. [H-charts]

## 9. Feed view (2025-07-10)
- **Shows** pages as a linear stack of cards, like a blog or social feed. Users can comment on posts directly and track views on their posts. [H-feeds] [R-2025-07-10]
- Emoji reactions are mentioned in the release. [R-2025-07-10]
- **Create**: `/Feed view`, or "+" → Feed. [H-feeds]
- **Property visibility**: View settings (sliders icon) → Property visibility → 👁️. [H-feeds]
- **Conditional color** is supported. [H-props]
- **Not exposed in the API** view types. [API-view]
- Other Feed layout options (card length, cover): NOT FOUND.

## 10. Map view (2025-11-17)
- **Requires** a **Place** property. One is auto-created if missing. Places can come from current location, a place name, or an address (third-party geocoding). [H-maps]
- **Create**: `/map`, or "+" → Map → name → Create. [H-maps]
- **Map by**: Layout → Map by → choose a place property. API `map_by`. [H-maps] [API-views]
- **Height**: API `small` | `medium` | `large` | `extra_large`. [API-views]
- **Use**: click a pin to open its page. Zoom and pan. Up to **100 items** show at once; filter to narrow the rest. [H-maps]
- **Filters and sorts on places** are text-based: name/address contains, alphabetical sort. No distance calculation. [H-maps]

## 11. Form view (2024-10-24)
- **Create**: `/form` (creates a database plus an auto "Respondent" property), or "+" → Form on an existing database ("Create {#} questions"). Needs Full access. Desktop and web only. [H-forms]
- **Builder**: [H-forms]
  - Title, description, icon and cover.
  - Each question maps to a property. "Sync with property name" renames the property; turn it off to decouple.
  - "+" adds a question.
  - Per-question "•••": Required, Description, show options as list or dropdown, Long answer, Question type (= property type), max selections (multi-select/relation/people), conditional logic (Business/Enterprise), Duplicate, Delete.
- **Form settings → Submit screen**: button Color and Text, Confirmation title and body, email copy of each submission. "Preview" shows the form as respondents see it. [H-forms]
- **Share**: [H-forms]
  - Who can fill it: workspace with link, anyone on web with link, or No access (closes the form).
  - Access to submission: none / view / comment / edit / full.
  - Anonymous responses toggle (web forms are always anonymous).
  - Notion branding toggle (paid plans).
- API fields: `is_form_closed`, `anonymous_submissions`, `submission_permissions` (`none` | `comment_only` | `reader` | `read_and_write` | `editor`). [API-views]
- **Responses** land in a Table view named "Responses". Form views cannot be exported. Automations can be added from the builder "••• → Automations". [H-forms]
- Forms only work on the database that **owns** the data source. [H-ds]

## 12. Dashboard view (2026-03; Business/Enterprise)
- **Create**: "+" → Dashboard, or `/dash`. It starts in **Edit mode**. Notion Agent can draft one. [H-dash]
- **Widgets**: each widget is a database view from any data source. Up to 12 widgets total and **4 per row**. Width is on a 12-column grid (1–12). Row `height` is an integer in pixels. [H-dash] [API-views]
- **Edit mode**: add widgets (+ on a row or at the bottom), drag to move or reorder, drag between widgets to resize width, drag a row boundary to resize height, right-click or click a title for Duplicate / Delete / move. [H-dash]
- **View mode**: open pages and use widget filters, sorts and groups. [H-dash]
- **Global filters**: "Filter multiple sources". A global filter applies only to widgets whose view has that property. Several can be added. [H-dash]
- Editing a widget's underlying view may change that view wherever else it is used. [H-dash]
- API: dashboard `configuration.rows` is read-only. Widgets are added by `POST /v1/views` with `view_id`. `placement` = `new_row` (optional `row_index`) | `existing_row` (`row_index`). [API-views]

---

## 13. Gaps (searched, not found in fetched Notion sources)
- Empty-state UI for any view.
- Table row height or density for database tables.
- Grid keyboard navigation (arrow keys between cells, Enter to edit, typing to overwrite) for database tables.
- Whether an active sort disables manual drag reordering, and how manual order is stored.
- Calendar and Timeline "No date" / unscheduled items panel.
- Board per-column load limit or "load more".
- Moving board columns into a "hidden" bucket by drag, beyond the FAQ tip.
- Feed layout options beyond property visibility.
- Pixel defaults (column widths, card sizes): none documented; do not invent them.

Pages fetched for these checks: H-views, H-tables, H-boards, H-galleries, H-lists, H-calendars, H-timelines, H-charts, H-feeds, H-maps, H-forms, H-dash, H-intro, H-keys, H-subitems, API-views, and the releases listed in §0 (plus 2020–2026 release pages scanned via https://www.notion.com/releases/rss.xml).
