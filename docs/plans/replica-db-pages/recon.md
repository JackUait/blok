# Recon map: Notion full-page databases (web)

Scope: a database that lives as its own page — creating one, how its parent shows it, opening it, turning it inline and back, the sidebar, its rows.
For: Blok, rebuilt on Blok's existing `page` tool (separate documents) and `database` tool.
Date: 2026-10-25

Research files (evidence for every row below):
- `research-help-center.md` — notion.com/help, releases (25 sources)
- `research-api-model.md` — developers.notion.com
- `research-live-notion.md` + `shots/01..11` — measured in the user's own signed-in Notion, 2026-10-25
- Earlier measurements: `../2026-10-09-database-notion-parity/research/` (views, toolbar, row peeks; r28 = slash entries)

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | help center | https://www.notion.com/help/intro-to-databases | inline vs full page, convert by sidebar drag, ⤢ expand, sidebar |
| 2 | help center | https://www.notion.com/help/views-filters-and-sorts | "Open pages in", views under a full-page database in the sidebar |
| 3 | help center | https://www.notion.com/help/data-sources-and-linked-databases | data sources, linked views |
| 4 | API | https://developers.notion.com/reference/database | `is_inline`, container fields |
| 5 | API | https://developers.notion.com/reference/update-database | `is_inline` + `parent` change in one update |
| 6 | API | https://developers.notion.com/reference/block | `child_database` (title only) for both forms |
| 7 | user's account | live session 2026-10-25 | layout, parent link, menus, round trip |
| 8 | user's account | r28 2026-10-20 | slash entry "Database - Full page" — "Add a new database as a sub-page" |

## Core loop

A database is one object that is shown either inside a page or as a page of its own, and the user can switch between the two without losing anything.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Parent page with a full-page database link | any page holding one | shows the database as one link row | link row (database glyph + title, underline), hover preview card, ⋮⋮ menu | default, hover (bg ≈ rgba(33,27,23,.05) + preview card) |
| S02 | Full-page database | click S01 row; `/p/<db>?v=<view>`; ⤢ on S03 | the database alone on a page | breadcrumb, header hover row (Add icon / Add cover / Add description), title h1 32/700, view tab pills, toolbar, the view | empty (0 rows), filled; NO body blocks anywhere |
| S03 | Parent page with an inline database | `/database inline`, or Turn into inline | database inside a page's flow | title 24/600, tabs (hidden at one view), toolbar, ⤢ "Open as full page" 28×28 | one view, many views |
| S04 | "New database" source panel | right after `/database full` | pick how the new database starts | AI box, New empty data source, Import CSV, templates, Link existing | open |
| S05 | Sidebar tree | left sidebar | navigation | page rows; full-page DB nests under parent with table glyph; its VIEWS nest under it ("• Table"), never rows | collapsed, expanded |
| S06 | Row page | click a row (side / center / full) | the row as a page: properties + body | measured before (r06, r08) | — |
| S07 | Database ••• Actions menu (full page) | top-right ••• on S02 | page actions for a database page | Copy link, Duplicate, Move to, Merge with CSV, Version history, Updates & analytics, Customize layout, Notify me, Lock database, Move to Trash, More | open |

## Flows

```
F01 Create a full-page database
    any page -> "/" "database full" -> Enter -> S02 opens at once (child of the page) + S04 -> New empty data source
    happy path: 3 steps (type, Enter, pick source)
    edge: the parent then holds S01's link row; breadcrumb "Parent / New database"

F02 Open a full-page database
    S01 -> click row -> S02          (1 click)
    edge: ⌘-click / Open in new tab; Open in side peek (⋮⋮ menu)

F03 Full page -> inline
    S01 -> ⋮⋮ -> "Turn into inline database" -> S03     (2 clicks)
    keeps: same block id, same database URL, views, rows. Parent URL unchanged.

F04 Inline -> full page
    S03 -> ⋮⋮ -> "Turn into page" -> S01                 (2 clicks)
    also: drag S03 into the sidebar as a top-level page (help center)

F05 Look at an inline database full page, without converting
    S03 -> ⤢ "Open as full page" -> S02 (same URL as F02) (1 click)

F06 Rows open as pages
    S02/S03 row -> side peek | center peek | full page (per-view "Open pages in"), ⤡ to full page
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Database link row | page link, database link (glyph = view type) | default, hover, focused, selected | S01 |
| Link hover preview card | page body / database drawing | hidden, shown after hover delay | S01 |
| Header hover row | page (Add comment), database (Add description) | hidden until header hover | S02 |
| "Open as full page" button | — | hover tooltip | S03 |
| Block ⋮⋮ menu items | Turn into inline database / Turn into page / Open as page | — | S01, S03 |

## Inferred data model

```
Database   id, title, description, icon, cover, parent, is_inline, in_trash, is_locked,
           data_sources[], views[]
           evidence: API reference/database; live: id unchanged across F03/F04
           confidence: high

ParentBlock child_database { title }  — same block type for inline and full page
           evidence: API reference/block; live: only the class changes (collection_view_page <-> collection_view)
           confidence: high

Row        page with parent = data source; properties + body blocks
           evidence: API reference/page; Blok already: database-row + contentIds
           confidence: high
```

Relationships: Page 1-n Database (as child block); Database 1-n View, 1-n DataSource; DataSource 1-n Row; Row 1-n body Block.

Key fact: in Notion inline vs full page is ONE flag on ONE object. A full-page database is a page that holds nothing but that database.

## Blok today (from the code map)

- `page` block = pointer `{pageId}`; body is another document (`acceptsChildren = false`); host hooks `create/open/resolve/peek/preview/loadDocument/saveDocument`.
- `database` block = schema + views + `title` + glyph `icon`, rows are `database-row` children. Already has `OpenPagesIn` side/center/full for ROWS.
- Recorded blocker: "Database - Full page" not built because `PageConfig.create({pageId})` cannot carry initial content (`32-parity-status…r12.md:134`, `src/tools/database/index.ts:1869-1873`).
- Gaps: `PageInfo` has no kind (page vs database) so the link can't show a database glyph; no Turn into between page and database; page tree / Trash watch / agent gate count only `type === 'page'`; a database's title (`data.title`) and a page's title (`OutputData.title`) are two places.

## Feature matrix

See `features.csv`. Must: 9, should: 6, could: 4, skip: 3.

## Out of scope

- Notion AI "Build with AI", templates gallery, Import CSV in the source panel (separate features).
- Multiple data sources per database (Blok has one schema per database block).
- Sharing / per-database permissions ("Can edit content") — host concern.

## Size

Screens 7 (2 new: S01 database link, S02 database page), flows 6 (F03/F04 new), entities 3.
Hard parts:
1. Moving a database (schema + every row + every row's body) between two documents on Turn into, without loss, under collaboration.
2. One title/icon for a database page (page title vs `data.title`).
3. Telling the host what a page is (page vs database) so the parent link, tree and preview draw it right.
Size: M.
