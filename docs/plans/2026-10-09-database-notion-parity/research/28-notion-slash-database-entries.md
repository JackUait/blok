# Research 28: Notion's database entries in the "/" menu

Measured 2026-10-20 (local, about 22:04–22:50 CEST) in the user's signed-in Chrome via `playwright-cli -s=notion-measure16 open --extension`, on app.notion.com.
Workspace on the Free plan. Viewport 1512x717 CSS px, DPR 2. Theme: light (body bg rgb(255, 255, 255)).
Files: `~/Packages/.blok-undo/db-parity-ledger/notion-measure16/` (not in the repo). Helpers copied from research/27 (`notion-measure15/`), session renamed. New: `slash.js` (walks the slash listbox: section labels, option text, glyph class, highlighted row by background), `filt2.sh` (types `/query`, scrolls the menu to the end, prints every row and the highlighted one), `ins.sh` (inserts only when the highlighted row equals the expected label), `gate.sh` (billing-word and upgrade-glyph detector, run after every insert), `db.sh` / `dbset.sh` (one database block: layout class, title, view settings rows, Edit properties list), `newline.sh`, `tips.sh`.
Every value is DOM text, `getComputedStyle` / `getBoundingClientRect`, or a screenshot. Anything not observed is **UNMEASURED**. Names of the user's own pages are not written here. Screenshots are cropped to the editor (sidebar removed).

## 0. Setup

- Sidebar "New page" (tooltip "New…") › Page. Private page "Blok measure scratch 16 2026-10-20".
- Each entry was inserted on a fresh empty line below the previous database (click under the last block). Insertion was by typing a query, checking that the highlighted row was the target (by background), then Enter.

## 1. The unfiltered "/" menu

Opened with "/" in an empty paragraph. The menu is 324 px wide, 287 px tall viewport, rows 32 px, step 33 px. It renders more rows as it scrolls (scrollHeight grew 952 → 3606). Footer row "Close menu" with "esc" on the right.

Section order (labels 12px / 14.4px / 500, rgb(125, 122, 117)):

1. **Suggested**: AI Meeting Notes, HTML · Embeds `New`, **Table view · Database**, Page. (This order is what this account showed. It is probably personalised; not checked.)
2. **Basic blocks**: Text, Heading 1–4, Bulleted list, Numbered list, To-do list, Toggle list, Page, Callout, Quote, **Table** (the simple table, glyph `viewTable`), Divider, Link to page.
3. **Media**: Image, Video, Audio, Code, File, Web bookmark.
4. **Database** (the section with every database entry, below).
5. **Advanced blocks**, 6. **Inline**, 7. **Embeds**.

### 1a. The "Database" section, in order

| # | Label | Glyph (svg class) | Badge |
|---|---|---|---|
| 1 | Table view | `viewTable` | |
| 2 | Board view | `viewBoard` | |
| 3 | Gallery view | `squareGrid2X2` | |
| 4 | List view | `listDash` | |
| 5 | Feed view | `newspaper` | |
| 6 | Dashboard view | `viewDashboard` | **New** |
| 7 | Calendar view | `viewCalendar` | |
| 8 | Timeline view | `viewTimeline` | |
| 9 | Map view | `map` | |
| 10 | Vertical bar chart | `chartBarXAxis` | |
| 11 | Horizontal bar chart | `chartBarYAxis` | |
| 12 | Line chart | `chartLine` | |
| 13 | Donut chart | `donutChart` | |
| 14 | Number chart | `number` | |
| 15 | Form | `inlineBlockDouble` | |
| 16 | Database - Inline | `databaseEmbed` | |
| 17 | Database - Full page | `viewTable` | |
| 18 | Linked view of data source | `collectionArrow` | |

- Glyphs are 20x20 at x 545, fill rgb(56, 56, 54), `aria-hidden="true"`, no aria-label. Options have no aria-label and `aria-selected` is never set; the highlight is a background only.
- Label text 14px / 16.8px / 400, rgb(44, 44, 43), starts at x 573 (28 px right of the glyph's left edge).
- Hovered / highlighted row: background `color(srgb 0.129 0.106 0.090 / 0.051)` on the option itself.
- **"New" badge**: 11px / 14.3px / 500, text rgb(39, 131, 222), bg rgba(0, 124, 215, 0.094), radius 4px, padding 2px 4px, 32x18, ~10 px after the label.
- **Inside the "Database" section the rows have NO "· Database" suffix.** The suffix shows only when the row appears outside its section: in "Suggested" and in every filtered result.

### 1b. The "· Database" suffix

`Table view · Database` in Suggested is three leaves: label (rgb(44, 44, 43)), then "·" and "Database", both 14px / 16.8px / 400, **rgb(161, 158, 153)**. Gaps: label ends x 641, "·" at x 646 (4 px wide), "Database" at x 656. Other sections use the same pattern (`· Embeds`, `· Turn into`, `· Synced Databases`). A badge comes after the suffix (`Dashboard view · Database New`).

### 1c. Hover hint (no preview card)

No preview card opens. A dark hint shows to the right of the menu after a short hover:
- bg rgb(44, 44, 43), radius 6px, padding 5px 8px, text 12px / 16.8px / 400, rgb(240, 239, 237). Seen at x 859 (menu right edge 857).
- The hint text per entry:

| Entry | Hint |
|---|---|
| Database - Inline | Add a new inline database to this page |
| Database - Full page | Add a new database as a sub-page |
| Table view | Add a table view for a new or existing data source |
| Board view | Create a kanban board database view |
| Gallery view | Create a gallery database view |
| List view | Create a list database view |
| Feed view | Create a feed database view |
| Dashboard view | Create a dashboard database view |
| Calendar view | Create a calendar database view |
| Timeline view | Create a timeline database view |
| Map view | Create a map database view |
| Vertical bar chart | Create a vertical bar chart from a database |
| Horizontal bar chart | Create a horizontal bar chart from a database |
| Line chart | Create a line chart from a database |
| Donut chart | Create a donut chart from a database |
| Number chart | Create a number chart from a database |
| Form | Create a form from scratch |
| Linked view of data source | Add a view of an existing data source to this page |
| Asana · Synced Databases | Bring Asana tasks into Notion to see the latest updates across teams |
| GitLab · Synced Databases | View the latest updates from GitLab in Notion pages and databases |

The hint delay was not measured (reads were taken 1.6–2.5 s after hover; sometimes it had not shown yet).

## 2. Filtered results

Typing after "/" replaces the sections with one label **"Filtered results"**. Every database row then carries "· Database". HL = the highlighted row when the menu opens (what Enter inserts).

| Query | Rows in order (HL first unless noted) |
|---|---|
| `/table` | **Table** (simple table, HL), Table view · Database, Table of contents |
| `/table view` | Table view · Database (HL) |
| `/board` | Board view · Database (HL), Dashboard view · Database `New` |
| `/gallery` | Gallery view · Database (HL) |
| `/list` | List view · Database (HL), Bulleted list, Numbered list, To-do list, Toggle list, then the same four as "· Turn into" |
| `/calendar` | Calendar view · Database (HL) |
| `/timeline` | Timeline view · Database (HL) |
| `/chart` | Vertical bar chart (HL), Horizontal bar chart, Line chart, Donut chart, Number chart (all · Database), Code - Mermaid, Lucidchart · Embeds |
| `/feed` | Feed view · Database (HL) |
| `/map` | Map view · Database (HL), Google Maps · Embeds |
| `/form` | Form · Database (HL), Block equation, Block equation · Turn into, Typeform · Embeds |
| `/dash`, `/dashboard` | Dashboard view · Database `New` (HL) |
| `/database` | Database - Inline (HL), Database - Full page, Table view, Board view, Gallery view, List view, Feed view, Dashboard view `New`, Calendar view, Timeline view, Map view, Vertical bar chart, Horizontal bar chart, Line chart, Donut chart, Number chart, Form, Linked view of data source (all · Database), then **Asana, GitLab, GitHub · Synced Databases**, each with the upgrade glyph `arrowInCircleUpAnimated` (blue circle-arrow). 21 rows, scrolled to the end |
| `/linked` | Linked view of data source · Database (HL), Web bookmark, then 35 "· Embeds" rows (Google Drive … GitHub), scrolled to the end |
| `/view` | the 9 "… view" rows in section order, Linked view of data source, then 35 "· Embeds" rows |
| `/inline` | Database - Inline (HL), Mention a person, Mention a page or data source, Date or reminder, Emoji, Inline equation, Timeline view, Line chart, Linear · Embeds |
| `/full page` | Database - Full page · Database (HL) |

Notes: inside "Database", the database order under `/database` puts **Database - Inline and Database - Full page first**, unlike the unfiltered section (where they are 16th and 17th). `/table` highlights the simple table, not the database. The Synced Databases rows were not hovered for clicks and not opened (upgrade glyph).

## 3. What each entry inserts

"Panel" = the floating **"New database"** side panel (290 px wide at x 1210): AI prompt box "Describe what you want to build", **New empty data source**, **Import CSV**, "Suggested" (Tasks Tracker, Projects, Skills), More templates, **Link to existing data source** (`02-board-panel.png`). The database is already on the page, with its starting properties, while the panel is open. "New empty data source" was chosen every time. It closed the panel and changed nothing visible.

All databases get the placeholder title **"New database"** (title empty) unless noted. "Props" = View settings › Edit properties, types read on each property's page.

| Entry | Panel | Block | First view (layout · name) | Props created | Rows / other |
|---|---|---|---|---|---|
| Table view (1st insert, first block on the page) | **no** | inline | Table · view name **empty** (input placeholder "View name") | Name (Title) | none |
| Table view (2nd insert, lower on the page) | **yes** | inline | Table · empty name | Name | none |
| Board view | yes | inline | Board · **"Board view"**; Group = Status | Name, **Assign** (Person), **Status** (Status: Not started DEFAULT / In progress / Done; Display as Select) | 3 groups, 0 rows. Visibility 2 |
| Gallery view | yes | inline | Gallery · **"Gallery view"** | Name, **Created** (Created time), **Tags** (Multi-select, no options) | 0 rows. Visibility 1 |
| List view | yes | inline | List · **"List view"** | Name, Tags (Multi-select), Created (Created time) | 0 rows. Visibility 2 |
| Feed view | yes | inline | Feed · **"Feed view"** | Edit properties showed **"No results"**; Property visibility = 0 and its page also "No results" | 0 rows. No Group row in View settings |
| Calendar view | yes | inline | Calendar · **"Calendar view"** | Name, **Date** (Date, Full date, 12 hour, Notifications None), Tags (Multi-select) | Month grid "October 2026", toolbar "Manage in Calendar", Today. Visibility 1 |
| Timeline view | yes | inline | Timeline · **"Timeline view"** | Name, Assign (Person), **Date** (Date), **Status** (Status, same three options) | **3 sample rows "Card 1", "Card 2", "Card 3"**. From the bar geometry (40 px days) they span Oct 15–19, Oct 17–21, Oct 19–23 (today Oct 20). Zoom "Month", "Manage in Calendar" |
| Map view | yes | inline | Map · **"Map view"**; View settings: Layout, Style, Height = Medium, Source, Filter, Conditional color, Copy link to view, Manage data sources, Lock database (no Edit properties row) | **Place** (pin glyph). Read on a new row's page, which showed only Place, Empty | 0 rows; empty map. Button "Add pin" (aria "Enable add pin mode") |
| Form | **no** | inline | **two views**: tab **"Form builder"** (selected) and **"Responses"** (Table) | **Question 1** (Title), **Respondent** (Created by), **Question 2** (Multi-select, Option 1/2/3), **Submission time** (Created time) | Title is real text **"New form"**. Builder: "Form title" and "Description (optional)" placeholders, "Only members at [workspace] can fill out this form. Change", Question 1 text answer, Question 2 "(Respondents can select up to 1)" with Option 1–3. Buttons Preview, Share form |
| Database - Inline | yes | inline | Table · empty name | Name | none (same as Table view) |
| Database - Full page | yes, docked in the page at x 1126 | **child page** (`collection_view_page` block on the scratch page, glyph `viewTable`, text "New database"); **the tab navigates into it** | Table · the tab reads **"Table"** | Name | breadcrumb "scratch page / New database" |
| Linked view of data source | panel variant: "New database" title, search "Add or link data source…", **New empty data source**, "Existing data sources" (each row: title + parent page, glyph `collection`), "Show more" | inline, title shows the source's name with `arrowDiagonalUpRight` | after picking a source: step 2 "New view: **New table view**" + "Views on New form: **Responses**" (the Form builder view is not offered). "New table view" opens the New view layout picker (Table, Board, Timeline, Calendar, List, Gallery, Chart, Feed, Map, Dashboard; Show data source title, Show vertical lines, Show page icon, Wrap all content, Open pages in Side peek, Load limit 50, Source) with **Done** | source's props (Question 1, Respondent, Question 2, Submission time) | View settings ends in **"Lock views"** (owned databases say "Lock database"). Linked to the Form made in this session |
| Dashboard view | not inserted | | | | Release notes say Business/Enterprise only (research/03). Its row shows only "New" and no upgrade glyph, but research/19 hit a live checkout behind a "New"-only control. UNMEASURED by design |
| 5 chart entries | not inserted | | | | research/08 hit "Your workspace has already used its 1 free chart. Upgrade to get unlimited charts." UNMEASURED by design |

No upgrade gate, plan word or upgrade glyph appeared after any insert (`gate.sh` clear every time).

## 4. For Blok

- One "Database" section in the "/" menu, in Notion's order (§1a). Inside it, no suffix. Outside it (suggested rows, search results), add "· Database" in the secondary ink.
- Under a search, Inline and Full page rank before the views for "database". `/table` matches the simple table first.
- Each "… view" entry makes a database whose first view is that layout, named "<Layout> view". Exception: Table (and Database - Inline) leave the name empty and show "Table".
- Starting properties per layout (§3): Board = Assign + Status (grouped by Status); Gallery/List = Created + Tags; Calendar = Date + Tags; Timeline = Assign + Date + Status + three sample rows; Map = Place; Form = Question 1 (title), Respondent, Question 2 (multi-select, 3 options), Submission time, plus a Responses table view.
- Form and the first Table insert skip the "New database" panel; every other entry opens it.

## 5. Account state and safety

- **No billing surface opened.** Every new control was hovered first. `gate.sh` ran after every insert. Dashboard and Charts were not inserted. The Synced Databases rows (upgrade glyph) were hovered only, never clicked.
- Not used: Notion AI (prompt box untouched), templates, Import CSV, chart quota, Copy-to-Clipboard, favorites, settings.
- One empty row was created in the Map database (via "New") to read its properties.
- The scratch page was moved to Trash (page Actions › Move to Trash; toast "Moved to Trash"). Its 11 inline databases, the full-page child database and the linked view went with it. The sidebar then had no leaf containing "measure scratch 16". Trashing navigated the tab to another recent page; nothing was clicked there.
- `.playwright-cli/` auto-snapshots were deleted; the session `notion-measure16` was closed.

## 6. UNMEASURED

- Dashboard view and the five chart entries: what they insert, and whether a gate or checkout opens (not inserted, by design).
- Why the first Table view insert opened no panel. Hypothesis: it was the first block on a fresh page. Not re-tested on another fresh page.
- The rendered name of an inline Table view (view name empty; tabs hidden while there is one view). The full-page one shows "Table".
- Feed: why Edit properties and Property visibility list "No results" (a Name/title property was expected).
- Full-page database View settings (the button did not open the menu twice).
- The slash hint's delay and exact position; the GitHub row's hint.
- Keyboard behaviour in the menu (ArrowUp/Down, wrap) and how rows rank for other queries.
- Dark theme for the menu and hints.
- What the "Suggested" section shows on other pages or accounts.
