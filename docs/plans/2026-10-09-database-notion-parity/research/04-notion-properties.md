# 04 — Notion database properties (exhaustive, sourced)

Researched 2026-10-09. Every claim carries a source key from the table below. All sources were fetched in this session with `curl`: the developers.notion.com `.md` endpoints, the notion.com/help HTML (text-extracted), and all 152 English notion.com/releases pages. Raw copies are in `research/src/`. **"UNVERIFIED"** means no fetched primary source confirms it. No pixel values appear here, because none were sourced.

## Sources

| Key | URL |
|---|---|
| PO | https://developers.notion.com/reference/property-object.md (Data source properties — schema) |
| PV | https://developers.notion.com/reference/page-property-values.md (Page property values) |
| PI | https://developers.notion.com/reference/property-item-object.md |
| FI | https://developers.notion.com/reference/filter-data-source-entries.md (current filter reference) |
| FL | https://developers.notion.com/reference/post-database-query-filter.md (legacy, "Deprecated as of version 2025-09-03") |
| SO | https://developers.notion.com/reference/sort-data-source-entries.md |
| UP | https://developers.notion.com/reference/update-data-source-properties.md |
| VW | https://developers.notion.com/guides/data-apis/working-with-views.md |
| VO | https://developers.notion.com/reference/view.md |
| WK | https://developers.notion.com/workers/reference/schema.md (Workers `Schema.*` builders) |
| H-props | https://www.notion.com/help/database-properties |
| H-tables | https://www.notion.com/help/tables |
| H-rr | https://www.notion.com/help/relations-and-rollups |
| H-vfs | https://www.notion.com/help/views-filters-and-sorts |
| H-fx | https://www.notion.com/help/formulas |
| H-fxs | https://www.notion.com/help/formula-syntax (**the full function reference link**) |
| H-btn | https://www.notion.com/help/database-buttons |
| H-maps | https://www.notion.com/help/maps |
| H-ai | https://www.notion.com/help/autofill (page title "Notion AI for databases") |
| H-uid | https://www.notion.com/help/unique-id |
| H-wiki | https://www.notion.com/help/wikis-and-verified-pages |
| H-rem | https://www.notion.com/help/reminders |
| H-layouts | https://www.notion.com/help/layouts |
| H-access | https://www.notion.com/help/database-property-access |
| H-intro | https://www.notion.com/help/intro-to-databases |
| H-create | https://www.notion.com/help/create-a-database |
| H-settings | https://www.notion.com/help/customize-your-database |
| R-YYYY-MM-DD | https://www.notion.com/releases/YYYY-MM-DD |

**Where each setting lives.** Blok stores schema and view configs in the database block's `data`, so this split is the data model:
- **[schema]**: on the property definition. Shared by every view and page.
- **[view]**: per-view property config: `visible`, `width`, `wrap`, `status_show_as`, `card_property_width_mode`, `date_format`, `time_format`; plus table `wrap_cells` and `frozen_column_index` (VW).
- **[value]**: on the page's property value.
- **[layout]**: in the database-wide page layout (H-layouts).

---

## 0. Cross-cutting facts

| Fact | Source |
|---|---|
| A property has common fields `id`, `name`, `description` (string or null), and `type`, plus a key matching `type` that holds that type's settings. "Many types use an empty object." | PO |
| `id` stays the same across renames. The Name property always has the ID `title`. Responses URL-encode IDs. | PO |
| The API lists 24 types: button, checkbox, created_by, created_time, date, email, files, formula, last_edited_by, last_edited_time, multi_select, number, people, phone_number, place, relation, rich_text, rollup, select, status, title, unique_id, url, verification. (24 is the number of `##` type sections I counted in PO.) | PO |
| The help lists these UI names: Text, Number, Select, Status, Multi-Select, Date, Formula, Relation, Rollup, Person, File (API: "Files & media"), Checkbox, URL, Email, Phone, Created time, Created by, Last edited time, Last edited by, Button, ID, Place. | H-props; PO |
| A database can have up to 500 properties. | H-props |
| Property descriptions ("Add descriptions to views & properties") [schema]. In the API, `description` sits beside the type settings. A rename that sends only `name` keeps the description. A select/multi_select settings update that omits `description` clears it. | R-2023-12-20; UP |
| You can choose a type when you create a property with "+". | R-2022-09-13 |
| Custom icons for properties. | R-2022-11-17 (heading "Custom icons for database views and properties") |
| Property-level access (Business/Enterprise): up to 20 properties can have rules. Levels: Inherit from database / Can edit property & values / Can edit values only / Can view property only / Can view property & values / No access. These types cannot be restricted: Title, ID, Created by, Created time, Last edited by, Last edited time, some synced properties, sub-item/parent relations. | H-access |
| Comments on property values are not possible on name, formula, rollup, button, or unique ID. The property must already have a value. | H-props |
| Conditional color can be based on Select, Multi-select, Status, Title, Text, Number, Date, Person, Checkbox, Formulas, Relations, Rollups. It works in Table, Calendar, Timeline, List, Board, Feed views and is set per view. In a table it can apply to the whole row or only to the property. | H-props |
| Clearing a value: send `[]` for title/rich_text/people/relation/multi_select/files; `null` for number/url/email/phone_number/select/date/place; `null` for status (resets to the default option if one is set); `false` for checkbox; `{state:"unverified"}` for verification. An array write replaces the whole value. | PV |
| Page responses cap at 25 relation refs (`has_more`), may omit people beyond 25, and include up to 25 inline mentions in title/rich_text. | PV |

### Property-level actions (column header menu / Edit properties)

| Action | Evidence |
|---|---|
| Rename | The column menu lets you "edit the property's name" (H-props). The ⋮⋮ menu on a page offers "rename it" (H-intro). |
| Change type | "Click a property name, then Edit property and Change type" (H-create). The page ⋮⋮ menu offers "change the Property type" (H-intro). |
| Duplicate / Delete | "duplicate a property, or delete a property" (H-props, H-settings). The page ⋮⋮ menu offers "Duplicate or Delete it" (H-intro). |
| Insert left / Insert right | Table column → "Insert left or Insert right" (H-props). |
| Filter / Sort / Calculate from the header | The column menu has "filter or sort by that property, run calculations" (H-props). Calculate: "hover over Calculate" (H-tables). |
| Wrap | "Wrap text" in the column menu (H-tables). Per-column "Wrap column" toggle (R-2022-04-14). [view] `wrap` per property and table-level `wrap_cells` (VW). |
| Freeze | "Freeze up to column" / "Unfreeze column" (H-vfs). [view] `frozen_column_index` = "Number of columns frozen from the left" (VW). Table view only (R-2023-09-22). |
| Hide in view | "Hide in view" from the column menu (H-rr). Property visibility toggle with 👁️ (H-props). [view] `visible` (VW). Hide/show all with one click (R-2021-10-12 heading). |
| Reorder columns | Drag the header, or drag ⋮⋮ in the Properties list (H-tables). Resize by dragging the edge (H-tables). [view] `width` (VW). |
| Visibility on the page: Always show / Hide when empty / Always hide | Release text: "set it to Always hide", "Hide when empty" (R-2020-11-11). Relation help: "Property visibility and select Always show, Hide when empty, or Always hide" (H-rr). [layout] The layout builder also has 👁️ per property, sections, and pinning of up to 15 properties into the Heading (H-layouts). |
| Property description | See §0 (R-2023-12-20; PO; UP). |
| Property access | See §0 (H-access). |
| AI Autofill setup | Click the property name → "AI Autofill (or Set up AI Autofill)" (H-ai). |
| Comment on a value | See §0 (H-props). |

### Type-change value conversion rules
- The API warns: "Changing a type can make existing values unreadable in the new type." Title cannot be removed or converted, and no other property can become `title`. "Place properties cannot be converted to or from another type." (UP; PO)
- After a text→place conversion, addresses may need cleanup before they show on the map (H-maps). The UI evidently allows text→place, which conflicts with the API's statement for the API path.
- **UNVERIFIED:** every other conversion rule, such as text→select splitting, number parsing, or date parsing. I grepped all fetched help pages and 152 release notes and found no primary source for them.

---

## 1. Footer calculations (Calculate)

Generic list from the help (label: meaning), H-tables:
- Count all: total rows.
- Count values: number of property values.
- Count unique values.
- Count empty.
- Count not empty.
- Percent empty.
- Percent not empty.
- Earliest date / Latest date / Date range: for time-related properties, e.g. Last edited or Created time.
- Number only: Sum, Average, Median, Min, Max, Range (= highest − lowest).

The help also says: "Depending on the type of property ... you'll see some or all" of these (H-tables). Rollup columns can be aggregated through "Calculate → More options" (H-rr).

API aggregator enum (chart views; the closest machine list): `count, count_values, sum, average, median, min, max, range, unique, empty, not_empty, percent_empty, percent_not_empty, checked, unchecked, percent_checked, percent_unchecked, earliest_date, latest_date, date_range` (VW).

**UNVERIFIED:**
- Which footer functions each type offers beyond the help's groupings, e.g. whether checkbox shows Checked/Unchecked/Percent checked/Percent unchecked in the table footer. Those four appear only in the chart-aggregator and rollup enums (VW; PO).
- Their exact UI labels.

## 2. Filters, sorts, grouping (general)

Filters:
- Simple filters can be saved for everyone or kept personal. Advanced filters use AND/OR groups "nested up to three layers deep" in the UI (H-vfs).
- In the API, compound filters nest "up to two levels deep" (FI).
- Quick filters exist (R-2022-03-15). API `quick_filters` (VW).
- "This week" is reached via "Is within" → "This week" in an advanced filter (R-2022-12-07). It is the only UI operator label I could source.
- **UNVERIFIED:** the full list of UI operator labels.

Sorts:
- Direction is `ascending` or `descending`. You can sort by a property or by the `created_time`/`last_edited_time` timestamp. Multiple sorts apply in list order (SO).
- Text sorts alphabetically and numbers numerically. Select and multi-select sort in the user-defined option order: "drag options up or down to set the sort order" (H-vfs).
- Rollups can be sorted only when they output a number (H-rr).
- Place sorts alphabetically, as text (H-maps).
- **UNVERIFIED:** where empty or null values land in a sort.

Group-by shape per type (VW):
- select/multi_select; person/created_by/last_edited_by; relation; checkbox: no extra fields.
- status: `group_by` = `group` or `option`.
- date/created_time/last_edited_time: `group_by` = `relative|day|week|month|year`, plus `start_day_of_week` 0 or 1.
- text/title/url/email/phone_number: `group_by` = `exact|alphabet_prefix`.
- number: `range_start`, `range_end`, `range_size` (≥1).
- formula: a nested group-by for the result type.
- Every variant takes `sort` (`manual|ascending|descending`) and `hide_empty_groups`.

### API filter operators (exact, from FI unless noted)

| Filter key | Operators |
|---|---|
| `checkbox` | `equals`, `does_not_equal` (boolean) |
| `date` | `after`, `before`, `equals`, `on_or_after`, `on_or_before` (ISO 8601 or relative); `is_empty`, `is_not_empty`; `past_week`, `past_month`, `past_year`, `this_week`, `next_week`, `next_month`, `next_year` (empty object). Relative strings: `today`, `tomorrow`, `yesterday`, `one_week_ago`, `one_week_from_now`, `one_month_ago`, `one_month_from_now`. A time compares at ms precision. No time zone means UTC. |
| `files` | `is_empty`, `is_not_empty` |
| `formula` | `checkbox` / `date` / `number` / `string` (string uses the rich-text condition), matched to the result type |
| `multi_select` | `contains`, `does_not_contain` (string or string[]; any-match), `is_empty`, `is_not_empty` |
| `number` | `equals`, `does_not_equal`, `greater_than`, `greater_than_or_equal_to`, `less_than`, `less_than_or_equal_to`, `is_empty`, `is_not_empty` |
| `people` (also `created_by`, `last_edited_by`) | `contains`, `does_not_contain` (UUID or `"me"`), `is_empty`, `is_not_empty` |
| `relation` | `contains`, `does_not_contain` (page UUID), `is_empty`, `is_not_empty` |
| `rich_text` | `equals`, `does_not_equal`, `contains`, `does_not_contain`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty` |
| `rollup` | array result: `any`, `every`, `none` (each takes another type's condition). Date result: `date` condition, only when the function is Earliest date / Latest date / Date range. Number result: `number` condition. |
| `select` | `equals`, `does_not_equal` (string or string[]; any-match), `is_empty`, `is_not_empty` |
| `status` | `equals`, `does_not_equal` (option names; a non-option name that matches a group name matches the group), `is_empty`, `is_not_empty`. Beta header `Notion-Beta: status-group-filters-2026-10-06` adds `group: {equals|does_not_equal}` with group names. |
| `timestamp` | `timestamp: "created_time"|"last_edited_time"` plus a date condition. No `property` field: "The API throws an error if you provide one." |
| `verification` | `status`, `does_not_equal`; values `verified`, `expired`, `none` |
| `ID` (as titled in the doc) | `equals`, `does_not_equal`, `greater_than`, `greater_than_or_equal_to`, `less_than`, `less_than_or_equal_to` (number). The doc says "Use a timestamp filter condition to filter results based on the `unique_id` value." That reads like a doc typo. The request key is not stated plainly, so **I do not assert that it is `unique_id`.** |
| `phone_number` | Listed as a filter key in FI and FL, but **neither page has an operator section. UNVERIFIED.** |
| title / url / email / place | **Not mentioned in FI or FL. API operators UNVERIFIED.** In the UI, place filtering is text-based, by name or address (H-maps). |

---

## 3. Per-type reference

### Title (Name)
| Aspect | Detail | Src |
|---|---|---|
| Schema | `title: {}`. Exactly one per data source. ID is always `title`. Cannot be removed or converted, and nothing can convert to it. | PO |
| Value | Rich text array. An empty value displays as an untitled page. | PV |
| Cell | Opens the database page. The first column is the page name. The column can be dragged. | H-tables |
| Filter / sort | API filter UNVERIFIED (see §2). Sorts alphabetically. | H-vfs |
| Group | `exact` / `alphabet_prefix` | VW |
| Access / comments | Not restrictable. Not commentable. | H-access; H-props |

### Text (`rich_text`)
| Aspect | Detail | Src |
|---|---|---|
| Schema | `rich_text: {}` | PO |
| Value | Rich text array with formatting, mentions, equations. | PV |
| Help | "Add text that can be formatted." | H-props |
| Filter | rich_text operators (§2) | FI |
| Sort / group | Alphabetical. `exact` / `alphabet_prefix`. | H-vfs; VW |
| Wrap | The help gives text as the example of a wrappable property. | H-props; R-2022-04-14 |
| Calculations | Generic count/percent set | H-tables |

### Number
| Aspect | Detail | Src |
|---|---|---|
| Schema `format` | Display only. Default `number`. **45 values:** `number, number_with_commas, percent, dollar, australian_dollar, canadian_dollar, singapore_dollar, euro, pound, yen, ruble, rupee, won, yuan, real, lira, rupiah, franc, hong_kong_dollar, new_zealand_dollar, krona, norwegian_krone, mexican_peso, rand, new_taiwan_dollar, danish_krone, zloty, baht, forint, koruna, shekel, chilean_peso, philippine_peso, dirham, colombian_peso, riyal, ringgit, leu, argentine_peso, uruguayan_peso, peruvian_sol, vietnamese_dong, pakistani_rupee, nigerian_naira, bitcoin` (counted from the raw PO line). | PO |
| Percent semantics | `0.25` displays as 25% with `percent`. | PV |
| Show as bar / ring | Number and formula properties: "Show the number as a bar or ring visualization", "Choose a color", "Divide by a custom number". Found under Edit property. **No API shape. The color list and the default divide-by are UNVERIFIED.** | R-2022-08-11 |
| Decimal places | Sourced only for rollups ("number formatting ... and decimal places"). **Decimal places on a plain number property: UNVERIFIED.** | R-2026-04-27; H-rr |
| Cell edit | Type or paste, like text. | H-props |
| Filter | number operators (§2) | FI |
| Sort / group | Numeric. Range buckets `range_start/end/size`. | H-vfs; VW |
| Calculations | Generic set plus Sum, Average, Median, Min, Max, Range | H-tables |

### Select
| Aspect | Detail | Src |
|---|---|---|
| Schema | `select.options[]`, each with `id`, `name`, `color`, `description`. Names are unique ignoring case. **No commas.** | PO |
| Option colors (exact) | `default, gray, brown, orange, yellow, green, blue, purple, pink, red` (10) | PO |
| Value | One option or `null`. A new name written to a page adds the option, if the connection can write the schema. | PV |
| Cell edit | Type and press Enter to create tags. "Colors are randomly assigned." Edit name/color or delete via the ••• that appears on hover. Reorder by dragging ⋮⋮. | H-props |
| Options UI | "Add an option" under Edit property. | H-create |
| API schema update | Send the complete option list; omitted options are removed. The API cannot rename existing options or change their colors. | UP |
| Filter | select operators (§2) | FI |
| Sort | Manual option order (drag) | H-vfs |
| Calculations | Generic set | H-tables |

### Multi-select
| Aspect | Detail | Src |
|---|---|---|
| Schema / colors | Same option shape and same 10 colors as select | PO |
| Value | Array. Writes by `id` or `name`. `[]` clears. A new name adds an option. No commas. | PV |
| Cell edit | Same as select, with multiple tags | H-props |
| Formula type | "Text (list)" | H-fxs |
| Filter | multi_select operators (§2) | FI |
| Sort | Manual option order | H-vfs |

### Status
| Aspect | Detail | Src |
|---|---|---|
| Schema | `status.options[]` (select option shape) and `groups[]` (`id`, `name`, `color`, `option_ids` in order). | PO |
| Defaults | `status: {}` creates `Not started`, `In progress`, `Done` in groups `To-do`, `In progress`, `Complete`. | PO |
| Groups | The API manages options only. "Group definitions themselves are managed in Notion." A new option goes to `To-do`, or else to the first group. | PO; UP |
| Release | Grouped "To-Do, In progress and Complete". "pre-loaded with 3 options". Custom colors. "Display ... as familiar select tags, or convenient checkboxes." | R-2022-06-29 |
| Display [view] | `status_show_as`: `"select"` or `"checkbox"` | VW |
| Value | One option. A page write cannot create options. `null` resets to the default option. | PV |
| Filter | status operators plus beta `group` (§2) | FI |
| Group-by | `group` or `option` | VW |

### Date
| Aspect | Detail | Src |
|---|---|---|
| Schema | `date: {}` (empty in the API) | PO |
| Value | `start` (required, ISO date or datetime), `end` (or null), `time_zone` (IANA or null). With `time_zone`, the times carry no offset. | PV |
| Picker UI | Date picker with **Remind**, **End date** toggle (range), **Include time** toggle, **Date format & timezone**, **Clear**. | H-props |
| Reminders | Set in the Date property's calendar window, "when you want to be reminded (i.e. 30 minutes beforehand)". **The full offset list is UNVERIFIED.** Delivery: inbox badge, desktop push, mobile push within 5 min, email if Notion isn't open. | H-rem |
| Display formats [view] | `date_format`: `full, short, month_day_year, day_month_year, year_month_day, relative`. `time_format`: `12_hour, 24_hour, hidden`. | VW |
| Conflict | The Workers `Schema.date("YYYY/MM/DD")` emits `date_format` on the **property** definition, while the views API puts it on the **view**. Not resolved here. | WK; VW |
| Natural-language entry in the cell | **UNVERIFIED.** The sourced `@remind tomorrow` syntax is for inline page reminders, not the property cell. | H-rem |
| Filter | date operators and relative values (§2) | FI |
| Group-by | relative/day/week/month/year, plus week start | VW |
| Calculations | Generic set plus Earliest date / Latest date / Date range | H-tables |

### Person (`people`)
| Aspect | Detail | Src |
|---|---|---|
| Schema | `people: {}` | PO |
| Value | Array of users or groups. User objects may be partial. | PV |
| Cell edit | Tag members or guests by typing a name and pressing Enter. Remove with the X. | H-props |
| Filter | people operators; `"me"` supported | FI |
| Formula type | "Person (list)"; `name()`, `email()` | H-fxs |
| Limit 1 / default | Documented only for the verification **Owner** person property ("Limit": 1 Person or No limit; "Default": Created by or No default). **Whether a general People property has a limit option: UNVERIFIED.** | H-wiki |

### Files & media (`files`)
| Aspect | Detail | Src |
|---|---|---|
| Schema / value | `files: {}`. Array of named file objects: `external.url`, or Notion-hosted `file` with an expiring URL; writes accept `file_upload`. | PO; PV |
| Cell edit | Upload, paste a link to embed, drag files in, add several at once. ••• menu: Delete, Download, Full screen, View original. Drag ⋮⋮ to reorder. | H-props |
| Filter | `is_empty`, `is_not_empty` | FI |
| Gallery | A gallery can show images from Files & media | H-vfs |

### Checkbox
| Aspect | Detail | Src |
|---|---|---|
| Schema / value | `checkbox: {}`. Boolean. Clear = `false`. | PO; PV |
| Filter | `equals`, `does_not_equal` | FI |
| Comments | Only from the opened page, not table view | H-props |
| Calculations | checked/unchecked/percent appear only in the aggregator and rollup enums; **footer availability UNVERIFIED** | VW; PO |

### URL / Email / Phone
| Aspect | Detail | Src |
|---|---|---|
| Schema | `url: {}`, `email: {}`, `phone_number: {}`. The API does not enforce a phone format. | PO; PV |
| Click behavior | URL opens a new tab. Email launches the mail client. Phone prompts a call. | H-props |
| URL cell | A click opens the link. Editing is through an "Edit URL" button on hover. | R-2021-09-08 |
| Rollups of these | Clickable | R-2021-12-23 |
| Filter | `phone_number` key listed without operators; url/email not listed. **UNVERIFIED.** | FI; FL |
| Group | `exact` / `alphabet_prefix` | VW |

### Formula
| Aspect | Detail | Src |
|---|---|---|
| Schema | `formula.expression`. `prop("Name")` is stored by ID, so renames are safe. Responses may use `{{notion:block_property:...}}`. A bad expression returns `validation_error`. | PO |
| Result types (API) | `string`, `number`, `boolean`, `date`, or `unsupported` (too many dependencies). | PV |
| Formula types (help) | Text, Text (list), Number, Boolean, Date, Person, Person (list), Page (list). Rollups give "Number, date, or list of any type". | H-fxs |
| Built-ins | `+ - * %`, `true/false`, `== > >= < <=`, `and/&&`, `or/||`, `not/!`, ternary `? :` | H-fxs |
| Functions (help page table) | if, ifs, empty, length, substring, contains, test, match, replace, replaceAll, lower, upper, repeat, link, style, unstyle, format, add, subtract, multiply, mod, pow, divide, min, max, sum, median, mean, abs, round, ceil, floor, sqrt, cbrt, exp, ln, log10, log2, sign, pi, e, toNumber, now, today, minute, hour, day, date, week, month, year, dateAdd, dateSubtract, dateBetween, dateRange, dateStart, dateEnd, timestamp, fromTimestamp, formatDate, formatNumber (example only, no description), parseDate, name, email, at, first, last, slice, concat, sort, reverse, join, split, unique, includes, find, findIndex, filter, some, every, map (`current`, `index`), flat, id, equal, unequal, let, lets, trim. **This is the help page's list; I do not claim it is exhaustive.** | H-fxs |
| style() | Styles `b u i c s`. Colors gray, brown, orange, yellow, green, blue, purple, pink, red, plus `_background`. | H-fxs |
| Date units | years, quarters, months, weeks, days, hours, minutes | H-fxs |
| Editor UI | Input at the top. Left panel lists properties, built-ins, functions. Right panel shows docs and examples. Live preview when opened from a row. AI assistance (Business/Enterprise). | H-fx |
| Also used in | Buttons, database buttons, automations | H-fx |
| Show as bar/ring | Applies to formula properties too | R-2022-08-11 |
| Filter | by result type (§2) | FI |
| Version | "Formulas 2.0" | R-2023-09-22 |

### Relation
| Aspect | Detail | Src |
|---|---|---|
| Schema | `data_source_id`, `database_id` (response), `type`: `single_property` (one-way, `{}`) or `dual_property` (two-way; response has `synced_property_id`/`synced_property_name`; create with `{}`). | PO |
| Setup UI | Search "Relation" → pick a database → preview → "Add relation". Toggle "Show on [db]" for two-way and name the reverse property. Self-relation: one property works both ways; "Two-way relation" makes two properties (e.g. Next/Previous). Re-select Relation to retarget. | H-rr |
| Default direction | One-way by default between different databases | H-rr |
| Limit | "1 page" or "No limit" | H-rr; R-2022-08-11 |
| Cell edit | Search-and-pick menu over the target database. Remove with – on hover. | H-rr |
| Display | Shown/Hidden related-page properties ("Shown in relation"/"Hidden in relation"). Visibility Always show / Hide when empty / Always hide. "Show as → As page section" (up to 10 at a time). | H-rr; R-2022-08-25 |
| Value | Array of page IDs. 25 in a page response (`has_more`). | PV |
| Filter | relation operators (§2) | FI |
| Duplicate DB | A two-way relation becomes one-way on the duplicate | H-rr |
| CSV | Exports as URLs. Cannot be re-imported as relations. | H-rr |
| Layout | Cannot be moved to the details panel | H-layouts |

### Rollup
| Aspect | Detail | Src |
|---|---|---|
| Schema | `relation_property_name/id`, `rollup_property_name/id`, `function` | PO |
| Functions (API, exact, 24) | `count, count_values, empty, not_empty, unique, show_unique, percent_empty, percent_not_empty, sum, average, median, min, max, range, earliest_date, latest_date, date_range, checked, unchecked, percent_checked, percent_unchecked, count_per_group, percent_per_group, show_original` | PO |
| Functions (help labels) | Show original, Show unique values, Count all, Count values, Count unique values, Count empty, Count not empty, Percent empty, Percent not empty. Number only: Sum, Average, Median, Min, Max, Range. Date only: Earliest date, Latest date, Date range. **UI labels for checked/unchecked/percent checked/unchecked and count_per_group/percent_per_group: UNVERIFIED.** | H-rr |
| Config UI | Relation → target property → calculation → number format → decimal places. Edit via ✏️ on hover. | H-rr; R-2021-12-23 |
| Number format | Currency, percent, etc., plus decimal places | R-2026-04-27 |
| Result | `number` / `date` / `array` / `unsupported`. The property-item endpoint cannot calculate `show_unique, unique, median, count_per_group, percent_per_group`. | PV; PI |
| Sort | Only when numeric | H-rr |
| Filter | any/every/none, date, number (§2) | FI |
| Rollup of a rollup | Not supported. FAQ "Can I rollup a rollup?" answers "Unfortunately not, as this could create unintended loops". | H-rr |

### Created time / Last edited time
| Aspect | Detail | Src |
|---|---|---|
| Schema / value | `created_time: {}` / `last_edited_time: {}`. Read-only ISO timestamps. | PO |
| Filter | `timestamp` filter (no property name), or a date condition on the property | FI |
| Sort | `timestamp` sort | SO |
| Group | Date group-by | VW |
| Calculations | Earliest/Latest/Date range are explicitly cited for these | H-tables |

### Created by / Last edited by
| Aspect | Detail | Src |
|---|---|---|
| Schema / value | `created_by: {}` / `last_edited_by: {}`. Read-only user. | PO |
| Filter | people condition | FI |
| Formula | Person type; `.name()`, `.email()` | H-fxs |

### Button
| Aspect | Detail | Src |
|---|---|---|
| Schema | `button: {}`, response-only. The API cannot create or configure it, expose its actions, or press it. | PO; PV |
| Setup | Label, then "Edit automation", then add actions. | H-btn |
| Actions (exact list) | Edit property; Add page to; Edit pages in; Send notification to (up to 20 people or a People property); Send mail to (Gmail, paid); Send webhook (HTTP POST, paid); Show confirmation; Open page or URL; Send Slack notification to (Plus/Business/Enterprise); Define variables. | H-btn |
| Mentions / formulas | `@` and `∑` work in action fields. Formulas are not allowed in: inserting blocks, opening a page/URL, Slack notifications. | H-btn |
| Permissions | Create/edit: Full access or Can edit. Click: plus Can edit content. | H-btn |

### ID (`unique_id`)
| Aspect | Detail | Src |
|---|---|---|
| Schema | `prefix` (string or null). The number is auto-assigned and read-only. | PO; PV |
| Behavior | The prefix is auto-generated from the teamspace and database names and can be edited. Numbers start at 1 and go to every page, including deleted pages. They never change. With a prefix set, `notion.so/TASK-123` resolves. | H-uid |
| Formula | Text type (`split("-")` gives prefix and number) | H-fxs |
| Filter | numeric operators (see the ID caveat in §2) | FI |

### Verification
| Aspect | Detail | Src |
|---|---|---|
| Schema | `verification: {}`. Notion creates it for wikis. The API cannot create it. | PO |
| Value | `state` (`verified`/`unverified`/`expired`; writes accept only the first two), `date` (needs times; `end` = expiry), `verified_by`. | PV |
| UI | Verify "until a specific time or indefinitely". Adding it to a non-wiki DB also adds an Owner property (Limit 1 or No limit; Default Created by or No default). Blue check mark. Owner is notified on expiry. | H-wiki |
| Filter | `status` / `does_not_equal`: verified, expired, none | FI |

### Place
| Aspect | Detail | Src |
|---|---|---|
| Schema / value | `place: {}`. Value `{lat, lon, name, address, aws_place_id, google_place_id}` or null. The API does not geocode. | PO; PV |
| Input | Current location, location name, or address (third-party search) | H-maps |
| Map | Map view needs a place property and creates one if missing. "Map by" picks the property. Up to 100 items shown. | H-maps |
| Filter / sort | Text-based on name or address. Alphabetical. | H-maps |
| Conversion | Not convertible to or from other types via the API | UP |
| Release | Map view and place property | R-2025-11-17 |

### AI Autofill (property behavior, not a type)
| Aspect | Detail | Src |
|---|---|---|
| Modes | **Basic**: Summary, Translate, Key info, Custom autofill; uses only that page; included in Business/Enterprise. **Custom Agent**: workspace or web search, multi-property, credits. | H-ai |
| Triggers | Basic: manually, on page create, on page edits. Custom Agent adds a schedule. | H-ai |
| Releases | AI Autofill (R-2023-05-31). Translate any property (R-2023-09-22). Custom Agents autofill (R-2026-04-14). | releases |
| API | No autofill config in PO. **UNVERIFIED** beyond the help. | PO |

---

## 4. Open gaps (UNVERIFIED)
1. UI filter operator labels for each type. Only "Is within → This week" is sourced.
2. API filter operators for title, url, email, phone_number, place.
3. Footer calculation list for each type, beyond the help's generic, number, and date groupings.
4. Number bar/ring color list and default divide-by. Number-property decimal places.
5. Date reminder offset list. Natural-language date entry in the cell.
6. Type-change conversion rules, other than title and place.
7. Where empty values land in a sort.
8. Whether a People property has a limit option.
9. UI labels for rollup checked/percent and per_group functions.
10. Whether `date_format` lives on the schema (Workers) or the view (views API).
