# 05 — Notion databases: data manipulation and view settings

Research date: 2026-10-09. All sources were fetched in this session with curl. Raw copies are in `scratchpad/research/raw/`.

**Source tags**
- **[UI]** is a notion.com/help article. It describes the current app.
- **[Rel YYYY-MM-DD]** is a notion.com/releases entry. It is historical: it says what shipped on that date. Labels may have changed since.
- **[API]** is developers.notion.com. It gives serialized enum values, **not menu labels**. An API enum does not prove a UI label. A missing API field does not prove the UI lacks the feature.

**Status values:** `verified` (stated in the cited source), `conflict` (sources disagree, and all are cited), `unverified` (no primary source found).

---

## 0. Unverified items (read first)

The help center, the 152 release pages and the developer docs were all searched. None of them state these things:

| # | Item | What *is* verified nearby |
|---|---|---|
| U1 | The UI operator labels for each property type (for example "is within", "is relative to today", "is within past week"). No help page lists the operators in the filter menu. | API date conditions and relative values (§1.4). [Rel 2022-04-14] says relative dates such as "today" or "within the past month" are available in quick filters: https://www.notion.com/releases/2022-04-14 |
| U2 | A **"Me"** option in the UI people filter. | API people filter accepts `"me"`: https://developers.notion.com/reference/filter-data-source-entries . Template dynamic `@me`: https://www.notion.com/releases/2023-09-22 |
| U3 | What happens to manual drag-reordering of rows while sorts are active. | Sorts can be reordered with ⋮⋮: https://www.notion.com/help/views-filters-and-sorts . API group sort has a `manual` type: https://developers.notion.com/guides/data-apis/working-with-views |
| U4 | Pasting a CSV or markdown table directly into a database view. | CSV import and Merge with CSV (§9.3). Pasting into multiple selected cells (§9.2). |
| U5 | The exact current labels "Wrap all columns" and "Show vertical lines". | API `wrap_cells`, `show_vertical_lines`. [Rel 2022-11-08] "toggle gridlines". [Rel 2023-09-22] "Wrap all properties" (Board/Gallery). Column-level "Wrap text" / "Wrap column". See §6. |
| U6 | A description field on the database itself. | Descriptions on **views and properties**: https://www.notion.com/releases/2023-12-20 |
| U7 | Group calculations outside Board columns (for example a per-group footer in grouped tables). | The Board column header shows a count and lets you change the calculation: https://www.notion.com/help/boards |
| U8 | Bulk delete, duplicate or move for many selected rows from one menu. | Per-item right-click menu (Delete, Duplicate, Copy link, Rename, Move to, Edit property): https://www.notion.com/help/intro-to-databases . Multi-row edit with cmd/ctrl+/: https://www.notion.com/help/keyboard-shortcuts |
| U9 | The launch date of conditional color. | [Rel 2025-11-17] calls it "new" and adds formulas, relations and rollups: https://www.notion.com/releases/2025-11-17 . The launch release was not found. |
| U10 | Number grouping, text-alphabetical grouping and date-granularity grouping **as UI labels**. | Only API enums are confirmed (§3.2). |
| U11 | "Filter bar" UI behavior beyond what is listed in §1.1 (pill styling, overflow, how pills reorder). | API `quick_filters` (§1.1) |

---

## 1. Filters

### 1.1 Simple filters / quick filters (the filter bar)

| Claim | Src | URL | Status |
|---|---|---|---|
| Add a filter: settings menu → **Filter** (under View settings) → choose a property. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| **Save for everyone** applies the filter for everyone in the view. If you don't select it, the filter applies only to you. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| "Quick filters": filters take 2–3 clicks (previously 8+). | Rel 2022-03-15 | https://www.notion.com/releases/2022-03-15 | verified (historical) |
| "Filters and sorts don't affect others until you save." Click **Save for everyone** to apply, or **Reset** to discard. | Rel 2022-03-15 | https://www.notion.com/releases/2022-03-15 | verified |
| The API models quick filters as `quick_filters`: "A map of property-level filters that appear in the view's filter bar." Keys are property names or IDs. Values are filter conditions without `property`, or `{}` for a filter with no criteria. | API | https://developers.notion.com/guides/data-apis/working-with-views | verified |
| An empty quick filter puts the property in the filter bar without a value. "People who open the view pick the value themselves. This matches picking a property from **+ Filter** in Notion." It does not change which pages the view shows. Files and place properties can't have an empty quick filter. | API | https://developers.notion.com/guides/data-apis/working-with-views | verified |
| Quick-filter people conditions accept `"me"` ("assigned to me" without a hardcoded user ID). | API | https://developers.notion.com/guides/data-apis/working-with-views | verified |
| Set one key to `null` to remove that quick filter. Set `quick_filters: null` to clear all of them. | API | https://developers.notion.com/guides/data-apis/working-with-views | verified |
| Relative dates such as "today" or "within the past month" work in quick filters and no longer need an advanced filter. | Rel 2022-04-14 | https://www.notion.com/releases/2022-04-14 | verified (historical) |
| Filter and Sort options in the database header became icons instead of text. | Rel 2024-04-30 | https://www.notion.com/releases/2024-04-30 | verified (historical) |
| Viewers of a **locked** database can use advanced filters. | Rel 2024-06-11 | https://www.notion.com/releases/2024-06-11 | verified |
| Mobile: tap to view, edit or create filters. | Rel 2025-07-10 | https://www.notion.com/releases/2025-07-10 | verified |
| New entries inherit **all** multi-select tags when an AND filter is active, so a new entry is not immediately filtered out. | Rel 2020-05-28 | https://www.notion.com/releases/2020-05-28 | verified (historical) |
| + New opens a preview when the view's filters conflict with the new item (example: adding to a "Completed" column while the filter is Status = In Progress). | Rel 2020-06-04 | https://www.notion.com/releases/2020-06-04 | verified (historical) |
| Delete a filter: Filter → open the filter → ••• → **Delete filter**. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |

### 1.2 Advanced filters (AND/OR groups)

| Claim | Src | URL | Status |
|---|---|---|---|
| Combine AND and OR with filter groups, "nested up to **three layers** deep". Path: Filter → **Add advanced filter**. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Convert a simple filter: click the filter → ••• → **Add to advanced filter**. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Three layers is repeated in releases. | Rel 2020-05-28, 2020-11-11, 2022-03-15 | https://www.notion.com/releases/2020-05-28 · https://www.notion.com/releases/2020-11-11 · https://www.notion.com/releases/2022-03-15 | verified |
| **API**: a compound filter has an `and` or `or` key holding an array of filters or nested compounds. "Nesting is supported up to **two levels** deep." | API | https://developers.notion.com/reference/filter-data-source-entries | verified |
| **CONFLICT on depth**: the UI says 3 layers and the API says 2 levels. These are different surfaces (and may count levels differently). Both are recorded. | — | URLs above | **conflict** |
| API status-group beta: a saved view filter comes back as plain names "when the extra level would nest the view filter deeper than compound filters allow". So the view depth limit is enforced on the API surface too. | API | https://developers.notion.com/reference/filter-data-source-entries | verified |
| Filters on sub-items: sub-item visibility settings affect filtered results (§11.1). Filtering supports sub-items. | UI / Rel 2025-11-17 | https://www.notion.com/help/views-filters-and-sorts · https://www.notion.com/releases/2025-11-17 | verified |

### 1.3 Per-type filter conditions (API enum values, not UI labels)

Source for this whole table: https://developers.notion.com/reference/filter-data-source-entries

| Property type (API filter key) | Conditions |
|---|---|
| `checkbox` | `equals`, `does_not_equal` (boolean) |
| `date` | `after`, `before`, `equals`, `on_or_after`, `on_or_before` (ISO date **or relative value**); `is_empty`, `is_not_empty`; `past_week`, `past_month`, `past_year`, `next_week`, `next_month`, `next_year`, `this_week` (empty object `{}`) |
| `files` | `is_empty`, `is_not_empty` |
| `formula` | `checkbox` / `date` / `number` / `string` (a nested condition of that type) |
| `multi_select` | `contains`, `does_not_contain` (string **or string[]**, matches any); `is_empty`, `is_not_empty` |
| `number` | `equals`, `does_not_equal`, `greater_than`, `greater_than_or_equal_to`, `less_than`, `less_than_or_equal_to`, `is_empty`, `is_not_empty` |
| `people` (also `created_by`, `last_edited_by`) | `contains`, `does_not_contain` (UUID **or `"me"`**); `is_empty`, `is_not_empty` |
| `relation` | `contains`, `does_not_contain` (page UUID); `is_empty`, `is_not_empty` |
| `rich_text` | `equals`, `does_not_equal`, `contains`, `does_not_contain`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty` |
| `rollup` | array rollups: `any`, `every`, `none` (each takes a nested condition); `date`; `number` |
| `select` | `equals`, `does_not_equal` (string **or string[]**, matches any); `is_empty`, `is_not_empty` |
| `status` | `equals`, `does_not_equal` (string or string[]), `is_empty`, `is_not_empty`. Beta `group: {equals \| does_not_equal}` matches a status **group** ("To-do", "In progress", "Complete") with the header `Notion-Beta: status-group-filters-2026-10-06`. |
| `timestamp` | `timestamp: "created_time" \| "last_edited_time"` plus a date condition |
| `verification` | `status`, `does_not_equal` |
| `ID` (unique_id) | `equals`, `does_not_equal`, `greater_than`, `greater_than_or_equal_to`, `less_than`, `less_than_or_equal_to` |
| also listed as filterable | `phone_number` (in the filter-object field list) |

- `"me"` resolves to the token's user. For internal connections there is no user, so `contains:"me"` returns nothing and `does_not_contain:"me"` matches everything. Source: same URL. Status: verified.
- Status without the beta: if a value matches no option but does match a group name, it matches the group. Source: same URL. Status: verified.

### 1.4 Relative dates (API)

- `after`, `before`, `equals`, `on_or_after` and `on_or_before` accept the relative strings `today`, `tomorrow`, `yesterday`, `one_week_ago`, `one_week_from_now`, `one_month_ago` and `one_month_from_now`. They are "resolved at query time". Source: https://developers.notion.com/reference/filter-data-source-entries . Status: verified.
- **Doc inconsistency**: the working-with-views update example uses `date: { this_month: {} }`, but the filter reference date table has no `this_month`. Sources: https://developers.notion.com/guides/data-apis/working-with-views vs https://developers.notion.com/reference/filter-data-source-entries . Status: conflict.
- UI wording for relative dates: see U1 (unverified).

### 1.5 Filters in templates / self-reference

| Claim | Src | URL | Status |
|---|---|---|---|
| Linked databases inside a database template can be filtered by the containing entry ("self-referential filters"). | Rel 2020-05-13 | https://www.notion.com/releases/2020-05-13 | verified (historical) |
| Dynamic `@me`, `@today` and `@now` in people/date properties inside a template. | Rel 2023-09-22 | https://www.notion.com/releases/2023-09-22 | verified |
| `@today`/`@now` in templates offer "Date when duplicated". | Rel 2021-09-08 | https://www.notion.com/releases/2021-09-08 | verified |

---

## 2. Sorts

| Claim | Src | URL | Status |
|---|---|---|---|
| Add a sort: settings → **Sort** → choose a property. **Save for everyone**, or keep it for yourself only. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| "Change the order that multiple sorts are applied by dragging them up or down using ⋮⋮." | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Text (Name, Text) sorts alphabetically. Number sorts numerically. **Select/Multi-select sort by the option order you define** (drag options in the property menu). | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Select/multi-select option order can be set alphabetically or manually. | Rel 2023-08-08 | https://www.notion.com/releases/2023-08-08 | verified |
| Delete a sort: Sort → **X**. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Rollups can only be sorted when they output a number. | UI | https://www.notion.com/help/relations-and-rollups | verified |
| Rows are "logically sorted for you using the name of the row". | Rel 2024-02-26 | https://www.notion.com/releases/2024-02-26 | verified (scope unclear) |
| With more than 1,000 items, new pages may appear in the middle of the collection instead of at the end. | UI | https://www.notion.com/help/intro-to-databases | verified |
| Sorts/filters on title, text, formula or rollup can slow loading. | UI | https://www.notion.com/help/optimize-database-load-times-and-performance | verified |
| API sort object: `{property, direction}` or `{timestamp: created_time\|last_edited_time, direction}`. `direction` is `ascending\|descending`. "The sort object listed first … takes precedence." | API | https://developers.notion.com/reference/sort-data-source-entries | verified |
| A view query can't stack extra filters/sorts on top of the saved view. | API | https://developers.notion.com/guides/data-apis/working-with-views | verified |
| Manual drag-reorder vs active sorts | — | — | **unverified (U3)** |
| Table rows drag via ⋮⋮. Board cards drag within and between columns. Gallery cards drag in any direction. Timeline items drag up/down. | UI | https://www.notion.com/help/tables · https://www.notion.com/help/boards · https://www.notion.com/help/galleries · https://www.notion.com/help/timelines | verified |

---

## 3. Grouping and sub-grouping

### 3.1 UI behaviour

| Claim | Src | URL | Status |
|---|---|---|---|
| settings → **Group** → choose a property. In the Group menu you can hide/show groups (👁️), sort groups manually or by the provided options ("alphabetical, ascending, and more"), and turn on **Hide empty groups**. Turn off with **Remove grouping**. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| **Sub-group**: "a second layer of grouping within your existing groups" (example: status → priority). | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Board: the default grouping is the status property. If there is none, a select, person, multi-select or relation property is used. If none of those exist, Notion creates a status property. | UI | https://www.notion.com/help/boards | verified |
| Board: hide a column via ••• → **Hide group**. Hidden columns are listed under settings → Group. Toggle "Color columns" in Group. Drag column headings to reorder. | UI | https://www.notion.com/help/boards | verified |
| Groups launched in Timeline, Table, List and Gallery. Each group has a toggle to collapse/expand. "Hide empty groups" toggle. Board gets sub-groups. | Rel 2021-10-19 | https://www.notion.com/releases/2021-10-19 | verified (historical) |
| Groupable types (2021): "nearly every property type", including Text, Number, Date, Checkbox, URL, Email, Phone, Formula, Relation, Created time, Created by, Last edited time, Last edited by (plus the earlier Select, Multi-select, Person). | Rel 2021-10-19 | https://www.notion.com/releases/2021-10-19 | verified (historical) |
| Status options are grouped into To-Do / In progress / Complete "so that it's easier to organize, group, filter". | Rel 2022-06-29 | https://www.notion.com/releases/2022-06-29 | verified |
| cmd/ctrl + option/alt + T opens and closes all database groups on a page. | Rel 2022-08-11 | https://www.notion.com/releases/2022-08-11 | verified (historical) |
| Views grouped by select, status, multi-select, person or relation load faster. | Rel 2024-06-11 | https://www.notion.com/releases/2024-06-11 | verified |
| **CONFLICT — relation/formula grouping**: the boards FAQ says "Any way to group by a relation or formula property? **Not currently**". The same page names relation as a board default. Rel 2021-10-19 lists Formula and Relation. The API has `relation` and `formula` group-by variants. The FAQ looks stale but is recorded. | UI / Rel / API | https://www.notion.com/help/boards · https://www.notion.com/releases/2021-10-19 · https://developers.notion.com/guides/data-apis/working-with-views | **conflict** |
| **CONFLICT — which layouts group**: the API config table allows `group_by` only on table (optional) and board (required). `sub_group_by` is board-only. Rel 2021-10-19 says Timeline, List and Gallery can group. | API / Rel | https://developers.notion.com/guides/data-apis/working-with-views · https://www.notion.com/releases/2021-10-19 | **conflict** (API gap ≠ UI absence) |

### 3.2 Group-by configuration (API; enum values, not UI labels)

Source for this table: https://developers.notion.com/guides/data-apis/working-with-views (Group-by configuration).

| `type` | Extra fields |
|---|---|
| all | `property_id` (required), `sort: {type: "manual"\|"ascending"\|"descending"}` (required), `hide_empty_groups` (bool) |
| `select`, `multi_select` | — |
| `status` | `group_by`: `"group"` (by status group) or `"option"` (by individual option) |
| `person`, `created_by`, `last_edited_by` | — |
| `relation` | — |
| `date`, `created_time`, `last_edited_time` | `group_by`: `"relative"` \| `"day"` \| `"week"` \| `"month"` \| `"year"`; optional `start_day_of_week`: `0` (Sunday) or `1` (Monday) |
| `text`, `title`, `url`, `email`, `phone_number` | `group_by`: `"exact"` or `"alphabet_prefix"` (first letter) |
| `number` | optional `range_start`, `range_end`, `range_size` (≥1) for bucket grouping |
| `checkbox` | — |
| `formula` | nested `group_by` object for the result type: date (relative/day/week/month/year, start_day_of_week), text (exact/alphabet_prefix), number (ranges), checkbox |

- Notes for implementers: date grouping granularity, number ranges and alphabetical-prefix grouping all exist in the data model. The UI wording is unverified (U10).
- Calendar layout: "Start week on Monday" is a user preference in Settings → Preferences. Source: https://www.notion.com/help/calendars . Status: verified.

### 3.3 Group counts / calculations

| Claim | Src | URL | Status |
|---|---|---|---|
| Board: "To the immediate right of each column heading, you'll see a gray number." It defaults to the card count and can be changed to other calculations (same list as §4). | UI | https://www.notion.com/help/boards | verified |
| Grouped table/list per-group aggregates | — | — | unverified (U7) |

---

## 4. Calculations (column footer / board column header)

Source: https://www.notion.com/help/tables (Calculations). The same list appears on https://www.notion.com/help/boards and https://www.notion.com/help/timelines (the timeline's side table). In a table: click a property → hover **Calculate** → choose. "Some or all" options appear, depending on type.

| Calculation | Applies to |
|---|---|
| Count all | all |
| Count values | all |
| Count unique values | all |
| Count empty | all |
| Count not empty | all |
| Percent empty | all |
| Percent not empty | all |
| Earliest date | time-related (help example: Last edited, Created time) |
| Latest date | time-related |
| Date range | time-related |
| Sum, Average, Median, Min, Max, Range | Number |

- Rollup example: Calculate → **More options** → Sum. Source: https://www.notion.com/help/relations-and-rollups . Status: verified.
- The "Calculate" placeholder in inline table views is hidden until hover. Source: https://www.notion.com/releases/2022-04-14 . Status: verified (historical).
- **Chart aggregators (API, charts only, NOT confirmed for footers)**: `count`, `count_values`, `sum`, `average`, `median`, `min`, `max`, `range`, `unique`, `empty`, `not_empty`, `percent_empty`, `percent_not_empty`, `checked`, `unchecked`, `percent_checked`, `percent_unchecked`, `earliest_date`, `latest_date`, `date_range`. Source: https://developers.notion.com/guides/data-apis/working-with-views . Status: verified for charts. Checkbox-specific footer options are unverified.
- Chart drilldown views can't do calculations/aggregations, bulk actions, freeze columns or add pages. Source: https://www.notion.com/help/charts . Status: verified.

---

## 5. Search inside a database view

| Claim | Src | URL | Status |
|---|---|---|---|
| A database becomes searchable once it has **at least three pages**. Click 🔍 at the top. Results narrow as you type. Search looks at **page titles and properties**. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Databases with three or more views get a search box in the view switcher dropdown. | Rel 2021-12-23 | https://www.notion.com/releases/2021-12-23 | verified (historical) |
| A bug fix: new entries now appear when + New is clicked while a search term is active. | Rel 2020-06-04 | https://www.notion.com/releases/2020-06-04 | verified (historical) |

---

## 6. View settings menu

Entry point: the settings (slider) icon at the top right of the database, or click the view name to rename, duplicate, delete, copy its link or edit components. "Each database view has its own settings." Source: https://www.notion.com/help/views-filters-and-sorts . Status: verified.

### 6.1 View settings items

| Item | Detail | Src | URL | Status |
|---|---|---|---|---|
| Layout | Table, Board, Timeline, Calendar, List, Gallery, Chart (+ Form). | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Other layouts | Feed (Rel 2025-07-10; help: feeds), Map (Rel 2025-11-17; help: maps), Dashboard (Business/Enterprise; up to **4 widgets per row, 12 total**). | UI/Rel | https://www.notion.com/help/feeds · https://www.notion.com/help/maps · https://www.notion.com/help/dashboards · https://www.notion.com/releases/2025-07-10 | verified |
| API view types | `table, board, calendar, timeline, gallery, list, form, chart, map, dashboard` (no `feed`). | API | https://developers.notion.com/reference/view | verified |
| Property visibility | 👁️ show/hide per view, ⋮⋮ to reorder (Board/List/Gallery/Calendar/Timeline). In tables you can also drag column headers. | UI | https://www.notion.com/help/database-properties · https://www.notion.com/help/boards · https://www.notion.com/help/tables | verified |
| Filter / Sort / Group / Sub-group | See §1–3. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Copy link to view | "a direct link to the particular database view". | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Duplicate / Delete / Rename view | Click the view name. A database must keep ≥1 view (the API returns `validation_error` when you delete the last one). | UI / API | https://www.notion.com/help/views-filters-and-sorts · https://developers.notion.com/guides/data-apis/working-with-views | verified |
| View tabs | Drag to reorder. Use "{#} more…" to overflow. **Display as** Icon only / Text only / both, which is **personal** ("Only you will see this change"). Views appear in the sidebar under full-page databases, marked with •. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Custom icons on views and properties | 600+ icons. | Rel 2022-11-17 | https://www.notion.com/releases/2022-11-17 | verified |
| View descriptions | Descriptions on views and properties. | Rel 2023-12-20 | https://www.notion.com/releases/2023-12-20 | verified |
| **Open pages in** | Side peek / Center peek / Full page. Path: Layout → Open pages in. Defaults: Table, Board, List and Timeline use side peek. Gallery and Calendar use center peek. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Open pages setting scope | "This setting affects everyone who uses the database view." (2022 label: "Open pages as".) | Rel 2022-07-20 | https://www.notion.com/releases/2022-07-20 | verified (historical label) |
| Peek navigation | 🔼/🔽 to move to the previous/next item in peek. | Rel 2022-01-19 | https://www.notion.com/releases/2022-01-19 | verified |
| **Conditional color** | §6.2 | UI | https://www.notion.com/help/database-properties#conditional-color | verified |
| **Load limit** | Timeline: Layout → **Load limit**, then choose a number of pages (example: 10). | UI | https://www.notion.com/help/timelines | verified |
| Load limit values | Inline tables, lists, galleries and timelines can be limited to **10, 25, 50, or 100** rows, then "load more". | Rel 2020-11-11 | https://www.notion.com/releases/2020-11-11 | verified (historical) |
| Wrap | Per column: property → **Wrap text** (help). [Rel 2022-04-14] "Wrap column" per column (before that, only database-wide). API table `wrap_cells` (view-wide) and per-property `wrap`. Board/Gallery "Wrap all properties" [Rel 2023-09-22]. | UI/Rel/API | https://www.notion.com/help/tables · https://www.notion.com/releases/2022-04-14 · https://www.notion.com/releases/2023-09-22 · https://developers.notion.com/guides/data-apis/working-with-views | verified; label "Wrap all columns" **unverified (U5)** |
| Vertical lines | Table: Layout → toggle gridlines [Rel 2022-11-08]. API `show_vertical_lines` (table only). | Rel/API | https://www.notion.com/releases/2022-11-08 · https://developers.notion.com/guides/data-apis/working-with-views | verified; current label unverified |
| **Show page icon** | Toggle off **Show page icon** in the database's … menu. | Rel 2024-02-26 | https://www.notion.com/releases/2024-02-26 | verified |
| Freeze column | Column name → **Freeze up to column** / **Unfreeze column**. API `frozen_column_index`. | UI/API | https://www.notion.com/help/views-filters-and-sorts · https://developers.notion.com/guides/data-apis/working-with-views | verified |
| Column resize | Drag edges. Double-click the resizer to auto-fit. API per-property `width` (px). | UI/Rel/API | https://www.notion.com/help/tables · https://www.notion.com/releases/2022-04-14 | verified |
| Card preview (Board/Gallery) | Page cover / Page content / any Files & media property. **Fit image** toggle. Reposition. | UI | https://www.notion.com/help/boards · https://www.notion.com/help/galleries | verified |
| Card size (Board/Gallery) | Small / Medium / Large. | UI | https://www.notion.com/help/boards | verified |
| Card API | `cover {page_cover\|page_content\|property}`, `cover_size small\|medium\|large`, `cover_aspect contain\|cover`, `card_layout list\|compact`, per-property `card_property_width_mode full_line\|inline`. | API | https://developers.notion.com/guides/data-apis/working-with-views | verified |
| Gallery: hide Name | Switch off Name in Properties. | UI | https://www.notion.com/help/galleries | verified |
| Calendar | Layout → **Show calendar as** Week/Month; **Show calendar by** a date property; **Show weekends** toggle [Rel 2024-02-26]. API `view_range week\|month`, `show_weekends`. | UI/Rel/API | https://www.notion.com/help/calendars · https://www.notion.com/releases/2024-02-26 | verified |
| Timeline | Timescale dropdown. Today button. Show/hide table (>> / <<). Layout → **Table properties**. **Show timeline by** (separate start/end date properties are allowed). API zoom `hours, day, week, bi_week, month, quarter, year, 5_years`. Dependency `arrows_by`. | UI/API | https://www.notion.com/help/timelines · https://developers.notion.com/guides/data-apis/working-with-views | verified |
| Per-property display (API) | `status_show_as select\|checkbox`; `date_format full\|short\|month_day_year\|day_month_year\|year_month_day\|relative`; `time_format 12_hour\|24_hour\|hidden`. | API | https://developers.notion.com/guides/data-apis/working-with-views | verified |
| Hide database title | Option to hide the source database title in a linked view. | Rel 2022-03-15 | https://www.notion.com/releases/2022-03-15 | verified (historical) |
| Automations / Lock / Data sources | §8, §12, §13. | | | |

### 6.2 Conditional color

Source: https://www.notion.com/help/database-properties#conditional-color (all rows verified unless noted).

- **Path**: slider icon → View settings → **Conditional color** → **New color setting** → choose a property. In the dropdown, set a rule. Pick a **Page background** color. Use **Add another** for more rules. Delete with 🗑️.
- **Default color**: pages match the property value colors by default (P0 red → red page).
- **Table only**: **Apply to** = the entire row, or just the property the rule targets.
- **Views supported**: Table, Calendar, Timeline, List, Board, Feed.
- **Properties supported**: Select, Multi-select, Status, Title, Text, Number, Date, Person, Checkbox, Formulas, Relations, Rollups. Formulas, relations and rollups were added per https://www.notion.com/releases/2025-11-17 .
- **Scope**: per view. It does not propagate to other views. **Duplicating a view duplicates its color settings.**
- **Granularity**: colors the whole page/card background. You can't color specific properties inside a card. Coloring a single property needs a table view.
- **Permissions**: you need Can edit content, Can edit or Full access to edit. View/comment users see the colors but can't edit them.
- **Timeline API**: `color_by` (bool). Source: https://developers.notion.com/guides/data-apis/working-with-views .
- **Launch date**: unverified (U9).

### 6.3 Personal vs shared view changes

| Claim | Src | URL | Status |
|---|---|---|---|
| Filter/sort edits are unsaved (personal) until **Save for everyone**. **Reset** discards them. | Rel 2022-03-15 / UI | https://www.notion.com/releases/2022-03-15 · https://www.notion.com/help/views-filters-and-sorts | verified |
| Tab "Display as" is personal. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Calendar remembers the last date range viewed. | UI | https://www.notion.com/help/calendars | verified (per-user scope unverified) |
| Can edit content users can't add, edit or remove properties or views, change filters or sorts, or lock/unlock. They **can** create linked databases and edit views, sorts and filters there. | UI | https://www.notion.com/help/intro-to-databases | verified |
| Whether other settings (group, property visibility, conditional color) have a personal unsaved state | — | — | unverified |

---

## 7. Database templates

| Claim | Src | URL | Status |
|---|---|---|---|
| Create: dropdown arrow next to **New** → **+ New template**. The template title becomes the template name. It presets properties and body content (images, embeds, sub-pages). | UI | https://www.notion.com/help/database-templates | verified |
| Use: pick from the gray menu in a new page, or from the New dropdown. | UI | https://www.notion.com/help/database-templates | verified |
| Don't fill relation properties in templates unless every page should relate to the same page(s). | UI | https://www.notion.com/help/database-templates | verified |
| Templates are per-database. There is no limit on their number. | UI | https://www.notion.com/help/database-templates | verified |
| Edit/duplicate/delete: New dropdown → ••• next to the template. | UI | https://www.notion.com/help/database-templates | verified |
| **Repeat**: ••• → Repeat: daily/weekly/monthly/yearly, with an interval, start date and time. | UI | https://www.notion.com/help/database-templates | verified |
| Nesting: a template can't nest inside a **daily** recurring template (weekly/monthly/yearly only). **Max 3 levels** of nesting per template. | UI | https://www.notion.com/help/database-templates | verified |
| **Default template**: New ▾ → ••• → **Set as default**, then choose **current view** or **entire database**. It is applied automatically to every new page. | Rel 2022-08-11 | https://www.notion.com/releases/2022-08-11 | verified (historical) |
| A recurring template does not trigger database automations. | UI | https://www.notion.com/help/database-automations | verified |
| A button can use a database template as the default page it creates. Template values overwrite button-set values. | Rel 2023-09-22 / UI | https://www.notion.com/releases/2023-09-22 · https://www.notion.com/help/buttons | verified |
| API: "List data source templates" and "Creating pages from templates" endpoints/guides exist. Rel 2025-11-17: create pages from database templates via the API. | API index / Rel 2025-11-17 | https://developers.notion.com/llms.txt · https://www.notion.com/releases/2025-11-17 | endpoint exists (per docs index); contents not reviewed |

---

## 8. Buttons, automations, forms

### 8.1 Button property (database buttons)

Source: https://www.notion.com/help/database-buttons

- **Create**: slider → Edit properties → New property → **Button** → set a label → **Edit automation** → New action → Save. Status: verified.
- **Permissions**: create/edit needs Full access or Can edit. Clicking also allows Can edit content. Status: verified.
- **Actions**:
  - Edit property (pages in the current database)
  - Add page to
  - Edit pages in
  - Send notification to (≤20 people, or a People property)
  - Send mail to (Gmail; paid plans)
  - Send webhook (HTTP POST; paid plans)
  - Show confirmation
  - Open page or URL
  - Send Slack notification to (Plus/Business/Enterprise)
  - Define variables
- **Mentions (@) and formulas (∑)** work in actions, not triggers. Status: verified.

### 8.2 Button block

Source: https://www.notion.com/help/buttons

- **Create**: `/button`, set name and emoji, add actions.
- **Actions**: the same set as §8.1, plus **Insert blocks**: Above button / Below button / At top of page / At bottom of page. There is no "Edit property" action.
- **Formulas** can't be used in Insert blocks, Open page/URL or Slack notifications.
- **Permissions**: you need Full access or Can edit on the page. To add or edit pages in a target database, the clicker must be an editor of that database.
- Status of all of the above: verified.

### 8.3 Database automations

Source: https://www.notion.com/help/database-automations (verified unless noted).

- **Create**: ⚡ → New automation → name → New trigger / Add trigger → New action / Add action → Create.
- **Scope**: an automation runs on the entire database or on a **specific view**. Its filters then define the page set. It runs only if the page still matches the view when the trigger fires.
- **Triggers**:
  - **Page added**
  - **Property edited**. Name, person, number, text, select and relation properties let you choose the kind of edit, such as "is set to" or "contains".
  - **Every {frequency}**: day/week/month…, with time, start/end and timezone. It can't be combined with other triggers, and it doesn't work with the Edit property action.
- **Combining triggers**: choose **When any of these occur** or **When all of these occur**. Multiple "is edited" triggers must all happen within about **3 seconds**.
- **Actions**: Edit property (multi-select/people/relation can add or remove individual values), Add page to, Edit pages in, Send notification to (≤20), Send mail to (Gmail), Send webhook, Send Slack notification to, Define variables.
- **Chaining**: automations don't trigger other automations. Button clicks **do** trigger automations.
- **Plans and permissions**: paid plans. Users with full access create them. Free users get Slack-notification automations only. Guests can't create automations. A **locked** database stops automations from triggering.
- **Errors**: a failing automation is **paused**. Re-enable it with ••• → **Active**. Manage with Edit / Pause / Delete.
- Recurring database automations: https://www.notion.com/releases/2025-02-18 (verified).
- Formulas in actions: https://www.notion.com/releases/2024-10-24 (verified).

### 8.4 Forms (form view → rows)

Source: https://www.notion.com/help/forms (verified unless noted).

- **Create**: `/form` creates a new database and form, with an automatic **Respondent** property. On an existing database: + view → **Form** → "Create {#} questions". You need Full access. Add a Created by property to capture names.
- **Questions map to properties**. Renaming a question renames the property unless **Sync with property name** is off.
- **Question options**: Required, Description, list vs dropdown, Long answer, Question type (equals property type), max selections (multi-select/relation/people), conditional logic (Business/Enterprise), Duplicate, Delete.
- **Submit screen**: button color and text, confirmation title and body, email copy of submissions.
- **Sharing**: Anyone at workspace with link / Anyone on the web with link (automatically anonymous) / No access (closes the form).
- **Access to submission**: No access / Can view / Can comment / Can edit / Full access.
- **Responses** land in a Table view named **Responses**. A Form view can't be exported (export from the Table view instead).
- **Forms can only be added to the original database**, not to a linked data source. Source: https://www.notion.com/help/data-sources-and-linked-databases .
- **API form config**: `is_form_closed`, `anonymous_submissions`, `submission_permissions none|comment_only|reader|read_and_write|editor`. Source: https://developers.notion.com/guides/data-apis/working-with-views .
- [Rel 2025-02-18]: respondents can be restricted to seeing only their own submissions, plus a max-selections limit. https://www.notion.com/releases/2025-02-18

---

## 9. Rows: selection, bulk edit, copy/paste, import/export

### 9.1 Selection and bulk edit

| Claim | Src | URL | Status |
|---|---|---|---|
| Hover a row → click its **checkbox**. Select all via the checkbox on hover over the Name header. The menu that appears edits properties for all selected rows. | UI | https://www.notion.com/help/tables | verified |
| "In a database, select multiple rows or cards, then use cmd/ctrl + / to edit them all at once." | UI | https://www.notion.com/help/keyboard-shortcuts | verified |
| Rows drag by ⋮⋮. Esc on an accidental empty row deletes it. | UI/Rel | https://www.notion.com/help/tables · https://www.notion.com/releases/2022-04-14 | verified |
| Right-click item: Delete, Duplicate, Copy link, Rename, Move to, Edit property. | UI | https://www.notion.com/help/intro-to-databases | verified |
| Bulk delete/duplicate/move from a multi-selection | — | — | unverified (U8) |
| Content dragged into a database (bullets, to-dos…) turns into pages. | UI | https://www.notion.com/help/intro-to-databases | verified |
| Text blocks with @date/@person mentions fill Date/Person properties when moved into a database. | Rel 2021-09-08 | https://www.notion.com/releases/2021-09-08 | verified |

### 9.2 Cell copy/paste/fill

| Claim | Src | URL | Status |
|---|---|---|---|
| Paste the same content into multiple selected cells at once (Table). | Rel 2021-12-23 | https://www.notion.com/releases/2021-12-23 | verified |
| Drag-fill: drag the small blue circle at the bottom of a cell. **cmd+D** pastes the starting cell into the selected cells. | Rel 2022-08-25 | https://www.notion.com/releases/2022-08-25 | verified |
| "In a table, press cmd/ctrl + R or cmd/ctrl + D to fill cells right or down … when you have multiple cells selected." | UI | https://www.notion.com/help/keyboard-shortcuts | verified |
| Copy-to-clipboard buttons on Text, Number, URL, Phone, Email, Created/Last edited time. | Rel 2021-09-08 | https://www.notion.com/releases/2021-09-08 | verified (historical) |
| List view: Shift+Enter creates an item below. Tab moves between properties. | Rel 2022-12-15 | https://www.notion.com/releases/2022-12-15 | verified |
| Paste a CSV/markdown table into a view | — | — | unverified (U4) |

### 9.3 Import / Merge with CSV / Export

| Claim | Src | URL | Status |
|---|---|---|---|
| CSV import: Settings → Import → CSV, or `/csv`. Create a new database **or import into an existing one**. Map each column to a property. Rows become pages and columns become properties. | UI | https://www.notion.com/help/import-data-into-notion | verified |
| **Merge with CSV**: in a full-page database, •• → **Merge with CSV** → match columns to properties. | UI | https://www.notion.com/help/import-data-into-notion | verified |
| CSV can't create rollups, formulas or relations. When merging into an existing database you can map a column to an **existing relation**. | UI | https://www.notion.com/help/import-data-into-notion | verified |
| Imports and merges **add rows only** and never update existing ones, so watch for duplicates. Headers must match property names exactly for a merge. The first row is the header. Use UTF-8. Dates import as MM/DD/YYYY. Mixed-type columns may import as text. Title doesn't support formatting. | UI | https://www.notion.com/help/import-data-into-notion | verified |
| Size: 5 MB/file (Free), 50 MB (paid). CSV and ZIP can't be multi-file imports. Excel: export to .csv first. A ZIP turns CSV/XLSX/TSV/ODS into databases. | UI | https://www.notion.com/help/import-data-into-notion | verified |
| Choose the property type per CSV column during import or merge. | Rel 2025-07-10 | https://www.notion.com/releases/2025-07-10 | verified |
| Export: ••• → Export → **Markdown & CSV**. A full-page database exports as CSV plus one .md per page. PDF and HTML are also available. | UI | https://www.notion.com/help/export-your-content | verified |
| Exporting a database offers the **current view** or the **default view** only. Exporting all views is unsupported. A filtered current view exports filtered (PDF/HTML/CSV). | UI / Rel 2022-04-14 | https://www.notion.com/help/export-your-content · https://www.notion.com/releases/2022-04-14 | verified |
| Relations export as plain-text URLs and can't be re-imported as relations. | UI | https://www.notion.com/help/relations-and-rollups | verified |

---

## 10. Database container: title, inline vs full page, linked views, data sources

| Claim | Src | URL | Status |
|---|---|---|---|
| Create: new page → Get started with → Table (or ••• → Database), or `/database`. Options: **New empty database**, **Link to existing data source**, Build with AI, Suggested template. Inline layouts: `/Table view`, `/Board view`, `/List view`, `/Gallery view`, `/Calendar view`, `/Timeline view`, `/Feed view`, `/dash`. | UI | https://www.notion.com/help/data-sources-and-linked-databases · https://www.notion.com/help/tables · https://www.notion.com/help/feeds · https://www.notion.com/help/dashboards | verified |
| New databases are created as tables. | UI | https://www.notion.com/help/views-filters-and-sorts | verified |
| Full-page → inline: drag it into another page in the sidebar (it becomes a subpage), then ⋮⋮ → **Turn into inline**. Inline → full page: drag the block into the sidebar as a top-level page. Expand inline with ⤢. | UI | https://www.notion.com/help/intro-to-databases · https://www.notion.com/help/tables | verified |
| Inline controls are hidden until hover. Inline ⋮⋮ offers Delete, Duplicate, move, copy link. In the sidebar, an inline database appears as a subpage. | UI | https://www.notion.com/help/intro-to-databases | verified |
| Duplicate a database: **Duplicate with content** / **Duplicate without content**. | UI | https://www.notion.com/help/intro-to-databases | verified |
| **Linked view**: type `/linked` → **Linked view of a database**. Only one view is open at a time in a single linked database, which helps performance. | UI | https://www.notion.com/help/optimize-database-load-times-and-performance | verified |
| Adding a view offers a data source choice. After you pick a source, a menu lists that database's existing views. Hover to preview, then pick one to copy its filters, sorts, grouping and property visibility. Different tabs can show different databases. | Rel 2022-03-15 | https://www.notion.com/releases/2022-03-15 | verified (historical) |
| New linked databases copy the sort, column order and visibility of the source's first Table view. | Rel 2021-12-23 | https://www.notion.com/releases/2021-12-23 | verified (historical) |
| Linked source: views, filters, sorts and groups you create don't affect the original. Edits to title, properties or pages **do** propagate. Access = the original's access. | UI | https://www.notion.com/help/data-sources-and-linked-databases | verified |
| **Data sources**: a database has ≥1 data source and can hold **multiple**. Slider → **Manage data sources** → Add data source / Link existing data source. Under **Sources**: ••• Move / Move to Trash. Under **Linked**: X removes it. Moving a source to a page creates a database there, and views that aren't moved become linked views. | UI | https://www.notion.com/help/data-sources-and-linked-databases | verified |
| API: every view targets exactly one `data_source_id`. `create_database` creates a linked database view on a page. New databases get one data source plus a Table view named "Default view". | API | https://developers.notion.com/guides/data-apis/working-with-views | verified |
| Title/description | Database title: hide in linked views (Rel 2022-03-15). Descriptions: views and properties only (Rel 2023-12-20). | Rel | https://www.notion.com/releases/2022-03-15 · https://www.notion.com/releases/2023-12-20 | partial; database description unverified (U6) |
| Customize page layout (applies to **all pages in the database**, not per view): Heading with **≤15 pinned properties**, Property group, details panel, Simple vs Tabbed structure, Apply to all pages, Reset to original. | UI | https://www.notion.com/help/layouts | verified |
| Per-page property display: Always show / Hide when empty / Always hide. | UI | https://www.notion.com/help/intro-to-databases | verified |

---

## 11. Sub-items and dependencies

Source: https://www.notion.com/help/tasks-and-dependencies

### 11.1 Sub-items

**Enable**: Database settings → More settings → Sub-items → **Turn on sub-items**. They are visible in all views. Status: verified.

**Display options**

| Views | Options |
|---|---|
| Table, list, timeline | **Nested in toggle** / **Flattened list** |
| Board, calendar, gallery | **Card property** / **Flattened list** |

**Filter options** (labelled **Filter options** or **Include**, depending on the display option)

| Views | Options |
|---|---|
| Table, list, timeline | **Parents only** (shows a sub-item count) / **Parents and sub-items** / **Sub-items only** |
| Board, calendar, gallery | Parents only |

**Moving, duplicating, deleting**
- Moving an item turns on sub-items in the target database.
- Without permission to do that, sub-items become parent items.
- Sub-items you can't edit aren't moved.
- Duplicating an item duplicates its sub-items.
- **Deleting a parent deletes its sub-items.**

**Advanced settings**: choose the Property (Sub-item or Parent item). This one property drives all views. "Show nesting toggle on title" is available. Nested-in-toggle keeps the tree even when some pages are restricted.

**API** (`subtasks`, table only):
- `property_id`: a self-relation
- `display_mode show|hidden|flattened|disabled`
- `filter_scope parents|parents_and_subitems|subitems`
- `toggle_column_id`

Source: https://developers.notion.com/guides/data-apis/working-with-views . Status: verified.

Origin: [Rel 2022-12-15] https://www.notion.com/releases/2022-12-15 (verified).

### 11.2 Dependencies

- **Enable**: More settings → Dependencies → **Turn on dependencies**. Status: verified.
- **Date shifting**: **Shift only when dates overlap** / **Shift & maintain time between items** / **Do not automatically shift**. Plus **Avoid weekends**. Status: verified.
- **Timeline**: directional arrows. Hover an item, then drag the yellow arrow to the item it blocks. Source: https://www.notion.com/releases/2022-12-15 . Status: verified (historical UI).
- **API**: `arrows_by.property_id` is the relation used for arrows. Source: https://developers.notion.com/guides/data-apis/working-with-views . Status: verified.
- "Blocked by / Blocking" as property names: unverified (not stated in the fetched help text).

---

## 12. Database lock and permissions

| Claim | Src | URL | Status |
|---|---|---|---|
| **Lock database** (Database settings): "people can still enter data, but they can't change views or properties." | UI | https://www.notion.com/help/customize-your-database | verified |
| Full-page: ••• → **Lock database** prevents changes to properties and value options. | UI | https://www.notion.com/help/intro-to-databases | verified |
| **Lock views** (••• at the top right of the window) prevents changes to properties and views. Data stays editable. Anyone with edit access can toggle it. | UI | https://www.notion.com/help/intro-to-databases | verified |
| **Naming conflict**: "Lock database" vs "Lock views" on two help pages. Both labels are recorded. | UI | URLs above | **conflict (label)** |
| Locked databases: viewers can use advanced filters. Automations don't trigger. | Rel 2024-06-11 / UI | https://www.notion.com/releases/2024-06-11 · https://www.notion.com/help/database-automations | verified |
| Database settings need Can edit or higher. They apply to the whole database, not per view. Items: Lock database, Edit properties, Automations, Sub-items/Sub-tasks, Dependencies, Sprints, Connections, Customize page layout, Turn into Tasks. | UI | https://www.notion.com/help/customize-your-database | verified |
| **Can edit content**: create, edit and delete pages and values, but not properties, views, filters, sorts or lock. | UI / Rel 2022-02-08 | https://www.notion.com/help/intro-to-databases · https://www.notion.com/releases/2022-02-08 | verified |
| **Can create pages** permission: create pages without seeing others. | Rel 2026-03-05 | https://www.notion.com/releases/2026-03-05 | verified |
| Deleted properties can be restored: Edit properties → **Deleted properties** → ↩️. The trash holds up to 1.5 MB. | UI | https://www.notion.com/help/optimize-database-load-times-and-performance | verified |

---

## 13. Limits

| Limit | Value | URL |
|---|---|---|
| Properties per database | 500 | https://www.notion.com/help/database-properties · https://www.notion.com/help/optimize-database-load-times-and-performance |
| Rows per database | 250,000 | https://www.notion.com/help/optimize-database-load-times-and-performance |
| Property data per page | 2.5 MB (excludes file contents, formulas/rollups, body) | same |
| Schema size per database | 1.5 MB | same |
| Two-way relation references | after 10,000 references to the same page, the reverse side stops reflecting | same |
| Insertion-order caveat | >1,000 items: new pages may land mid-collection | https://www.notion.com/help/intro-to-databases |
| UI filter nesting | 3 layers | https://www.notion.com/help/views-filters-and-sorts |
| API compound nesting | 2 levels | https://developers.notion.com/reference/filter-data-source-entries |
| In-view search threshold | ≥3 pages | https://www.notion.com/help/views-filters-and-sorts |
| Inline load limit options (2020) | 10 / 25 / 50 / 100 | https://www.notion.com/releases/2020-11-11 |
| Pinned layout properties | 15 | https://www.notion.com/help/layouts |
| Template nesting | 3 levels; not in daily-recurring templates | https://www.notion.com/help/database-templates |
| Notification recipients (button/automation) | 20 | https://www.notion.com/help/database-automations |
| Multi-"is edited" trigger window | ~3 s | https://www.notion.com/help/database-automations |
| Dashboard widgets | 4 per row, 12 total | https://www.notion.com/help/dashboards |
| CSV file size | 5 MB Free / 50 MB paid | https://www.notion.com/help/import-data-into-notion |
| View query cache TTL (API) | ~15 min | https://developers.notion.com/guides/data-apis/working-with-views |
| Views per database | ≥1 (the last view can't be deleted) | https://developers.notion.com/guides/data-apis/working-with-views |

