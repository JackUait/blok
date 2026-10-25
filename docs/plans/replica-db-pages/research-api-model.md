# Notion API data model: full-page vs inline databases

Research date: 2026-10-25. Sources are Notion's public developer docs (fetched as raw `.md` from developers.notion.com). Two help-center pages (notion.com/help) are used only where the developer docs say nothing; those are marked **[help center]** and were read through a summarizer, so treat their quotes as close paraphrase.

Rule used: every fact has a URL. "Not found" means the docs fetched did not say it. Sections marked **Inference** are my reading, not doc text.

Current API version in the docs' examples: `2026-03-11` (e.g. curl headers in [move-page]). The data-source model arrived in `2025-09-03`.

---

## 1. The database object

- A database "is an object that contains one or more data sources. Databases can either be displayed inline in the parent page (`is_inline: true`) or as a full page (`is_inline: false`)." [database]
- `is_inline`: "Has the value `true` if the database appears in the page as an inline block. Otherwise has the value `false` if the database appears as a child page." [database]
- Fields on the database (2025-09-03+): `object: "database"`, `id`, `data_sources` (array of `{id, name}`), `title` (rich text), `description` (rich text), `icon`, `cover`, `parent`, `url`, `public_url`, `in_trash` (`archived` = deprecated alias), `is_inline`, `database_type` (`tasks`/`projects`/`skills`/null), `show_data_source_title`, created/edited time+user. [database]
- The response schema also has `is_locked`. [retrieve-database] (OpenAPI `databaseObjectResponse`)
- `show_data_source_title`: "Full-page databases with one data source never show this title." [database]
- The database does **not** carry `properties` (schema) any more. "After upgrading … the new database object shape is displayed, including an array of child `data_sources` but **not** the data source `properties`." [database]
- Permissions live on the database: "Individual data sources don't have permissions settings, so the set of Notion users and bots that have access to data source children is managed through **databases**." [database]

### Parent types of a database
- Read side: "Databases can be parented by pages, blocks, or by the whole workspace. *For wikis, databases can also have a data source parent.*" [parent-object]
- OpenAPI `parentOfDatabaseResponse` = one of `page_id`, `workspace`, `database_id`, `block_id`. Description: "typically a page, block, or workspace, but can be another database in the case of wikis." [retrieve-database]
- Write side: "the parent of a database currently must be a page if it is created via the API." [parent-object]. Create-database says parent "must be a Notion page (`page_id` type) or a wiki database", and the request schema accepts `page_id` or `workspace`. [create-database]
- Workspace parent: "A page or database with a workspace parent is a top-level page within a Notion workspace." [parent-object]

## 2. How a database shows up in its parent's children

- Block type `child_database`. Its only field: `title` — "The plain text title of the database." [block]
- OpenAPI `childDatabaseBlockObjectResponse` = `type`, `child_database: {title}`, plus the common block fields (`parent`, `id`, `has_children`, `in_trash`, …). No `is_inline` field. [retrieve-a-block]
- `child_database` is listed among "Block types that support child blocks". [block]
- Create/update: "To create or update `child_database` type blocks, use the Create a database and the Update a database endpoints, specifying the ID of the parent page in the `parent` body param." [block]. Update a block: "Updating the page's `title` updates the text displayed in the associated `child_database` block." [update-a-block]
- `child_database` is not in the Append block children request schema (it appears only as a response object). [patch-block-children]
- Is `child_database` returned for BOTH inline and full-page databases? **Not found** stated explicitly.
- Is the `child_database` block id the same as the database id? **Not found** stated explicitly. The docs do call a database a "database block": "Pass `database_id` to list the views belonging to a specific database block." [working-with-views]; and linked views "create a new linked database block on a page". [create-view]. For pages the docs do say it: "Pages are a special kind of block … you can use the page ID as a block ID." [working-with-page-content]

**Inference:** since `child_database` carries only `title`, the children list cannot tell inline from full-page; a client must call Retrieve a database and read `is_inline`. That `is_inline:false` is described as "appears as a child page" suggests the full-page case is still listed among the parent's children, but the docs do not say so outright.

## 3. Can a full-page database have its own page content?

- Append block children summary: "Blocks can be parented by other blocks, pages, or databases." [patch-block-children]
- The block `parent` response schema includes `database_id` as a possible parent type. [retrieve-a-block] (`parentForBlockBasedObjectResponse`)
- Parent rules prose: "Blocks can be parented by pages, data sources, blocks, or agents." (no "databases"). [parent-object]
- Whether a full-page database has body blocks above/below its views: **not found** in the developer docs.
- **[help center]** A full-page database "appear[s] just like any other page in your sidebar". [help-intro-db]. The help page does not describe adding other blocks to a full-page database page.

## 4. Rows

- "A data source holds the schema and is the parent of its pages." "In a table view, a property appears as a column and a page appears as a row. … Its content blocks form the body of the page." [working-with-databases]
- Row page parent (2025-09-03+): `{"type": "data_source_id", "data_source_id": "...", "database_id": "..."}`; `database_id` is "provided in the API response for convenience". [parent-object], [working-with-databases]
- Before 2025-09-03, "page parents were databases, not data sources." [parent-object]
- Page `properties`: "If `parent.type` is `"page_id"` or `"workspace"`, then the only valid key is `title`. If `parent.type` is `"data_source_id"`, then the keys and values … are determined by the `properties` of the data source this page belongs to." [page]
- "Page content is available as blocks … read using retrieve block children and appended using append block children." [page]
- "Every data source has exactly one Name property, with API type `title`." [working-with-databases]
- **[help center]** A row is "its own Notion page that you can build, format, and nest content in like any other page", including "sub-pages or an inline database". [help-intro-db]

## 5. The 2025-09-03 split: database vs data source

The model, per the docs' diagram caption: "A database is a parent of one or more data sources, each of which parents zero or more pages. Previously, databases could only have one data source, so the concepts were combined in the API until 2025." [database], [data-source]

```
page (or workspace / block)
└── database            id, title, description, icon, cover, is_inline, parent, in_trash, is_locked
    ├── view(s)         parent = database_id, each scoped to one data_source_id
    └── data source(s)  id, title, description, icon, properties (schema), parent = database_id
        └── page (row)  parent = data_source_id (+ database_id), properties, block children
```
Sources: [working-with-databases] ("A database contains data sources and views"), [view], [data-source], [upgrade-faq].

Which object holds what:
- Database-level (Update a database): "`parent`, `title`, `is_inline`, `icon`, `cover`, `in_trash`". "`cover` is not supported when `is_inline` is `true`." [upgrade-2025-09-03]
- Data-source-level (Update a data source): "`properties` …, `in_trash` (to archive or unarchive a specific data source under a database), `title`." "Changes to one data source's `properties` doesn't affect the schema for other data source, even if they share a common database." [upgrade-2025-09-03]
- Data source fields: `object: "data_source"`, `id`, `properties`, `parent` (usually `database_id`), `database_parent` (the database's own parent), `database_type`, `title`, `description`, `icon`, `in_trash`, times/users. No `is_inline`, no `cover`. [data-source]
- "You can't use a database ID with the retrieve data source API, or vice-versa. The two types of IDs are not interchangeable." [upgrade-2025-09-03]
- Endpoints: query moved to `/v1/data_sources/:id/query`; `GET /v1/databases/:id` now returns the `data_sources` list; create database takes schema under `initial_data_source[properties]`; Create a data source adds a second source. [upgrade-2025-09-03]
- Search filter value is now `"page" | "data_source"`; the query "is matched against the *database* title, not the *data source* title". [upgrade-2025-09-03]
- "database mentions in rich text will continue to reference the database, not the data source." [upgrade-2025-09-03]
- URLs: in `notion.so/workspace/<db>?v=<view>`, the first id is the database (container), `v=` is the view; the data source id is not in the URL. [upgrade-faq]
- Wikis "won't support multiple data sources". [upgrade-faq]
- Old-version clients get `validation_error` / `multiple_data_sources_for_database` once a second source exists. [upgrade-faq]

Linked databases:
- A linked view is created with `POST /v1/views` + `create_database`: "This creates a new database container on the target page with a single view over the specified data source … With `create_database`, the view points to an existing data source owned by another database, so no new schema is created." [working-with-views]
- "Views in a database can be configured to show pages from a data source that's owned by another database. In Notion, this is called a linked database (or linked view)". [working-with-views]
- `create_database.parent` "Must be `{ "type": "page_id", "page_id": "..." }`"; `position` `{type:"after_block", block_id}` must name "a direct child of the parent page". [working-with-views]
- Data source parent can be another data source for "Linked or externally synced external data sources … but aren't thoroughly supported". [parent-object]
- **[help center]** Edits to a linked source's "title, properties, or pages … will be reflected in the original data source", but views/filters/sorts/groups in the linked database don't affect the original. [help-data-sources]
- How a linked database appears in block children (its block type): **not found**.

## 6. Creating a database

- "Creates a database as a subpage in the specified parent page, or as a private page at the workspace level". Creates "a database, its first data source, and its first table view, all in one API call." [create-database]
- The views guide: create provisions "One data source" and "One Table view named "Default view"". [working-with-views]
- Request `is_inline`: "Whether the database should be displayed inline in the parent page. Defaults to false." [create-database]
- Update `is_inline`: "Whether the database should be displayed inline in the parent page. If not provided, the inline status will not be updated." [update-database]
- Docs example moving a database and making it inline in one PATCH: `{"parent": {"type":"page_id","page_id":"NEW-PAGE-ID"}, "is_inline": true}`. [upgrade-2025-09-03]
- Whether flipping `is_inline` changes anything besides the flag (e.g. block shape, children): **not found**.
- **[help center]** UI conversions: full-page → inline: drag it into another page (it becomes a subpage), open it, `⋮⋮` → `Turn into inline`. Inline → full-page: `⤡` expand, or drag `⋮⋮` into the sidebar as a top-level page. [help-intro-db]

## 7. Moving, trashing

- Move a database: Update a database `parent` — "The parent page or workspace to move the database to. If not provided, the database will not be moved." [update-database]. "`parent` can be used to move an existing database to a different page, or (for public connections), to the workspace level as a private page." [upgrade-2025-09-03]
- Move a page endpoint: "This must be a regular Notion page, and not a database. Moving databases or other block types in the API is not currently supported." [move-page] (That endpoint only; databases move via Update a database.)
- Move a page *into* a database uses `parent: {type:"data_source_id", ...}`. [move-page]
- Append block children: "Existing blocks cannot be moved using this endpoint." [patch-block-children]
- Move a data source to another database: SDK v5.1.0 "`dataSource.update`: add support for changing a data source's `parent` database". [changelog]; webhook `data_source.moved` = "Data source is moved to a different database". [upgrade-2025-09-03]
- Trash a database: Update a database `in_trash` — "Whether the database should be moved to or from the trash." [update-database]. A data source can be trashed alone via Update a data source `in_trash`. [upgrade-2025-09-03]
- Delete a block "Sets a Block object, including page blocks, to `in_trash: true`". [delete-a-block]
- "The API does not support permanently deleting pages." [trash-page]. `archived` was removed in `2026-03-11`. [trash-page], [changes-by-version]
- Webhooks: `database.moved` "Database is moved to different parent (i.e. page)"; `database.deleted` "Database is deleted from its parent". [upgrade-2025-09-03]
- MCP `notion-delete-databases` "moves up to 20 databases with their rows" to Trash; locked databases can't be trashed. [changelog]
- What happens to the parent's `child_database` block on move or trash: **not found**.

## 8. link_to_page and mentions

- `link_to_page` block (response and append-request schemas): `link_to_page` is one of `{type:"page_id", page_id}`, `{type:"database_id", database_id}`, `{type:"comment_id", comment_id}`. [retrieve-a-block], [patch-block-children]. (It is not in the prose type list on the Block reference page. [block])
- Mentions: types `database`, `date`, `link_preview`, `page`, `template_mention`, `user`. "Database mentions contain a database reference … an object with an `id` key and a string value (UUIDv4) corresponding to a database ID." No access → returned with just the id, `plain_text` "Untitled". [rich-text]
- Page mention: `page: {id}`. [rich-text], [block]
- Database mentions point at the database, not the data source. [upgrade-2025-09-03]

## 9. Views in the API

- `/v1/views` launched March 19, 2026: create, retrieve, update, delete, list, plus view queries (create / get results / delete). [changelog]. The older FAQ line "managing views is not currently supported in the API" is outdated. [upgrade-faq]
- View object: `object:"view"`, `id`, `parent` ("The parent database. Contains `type: "database_id"`"), `data_source_id` (null for dashboards), `name`, `type`, `filter`, `sorts`, `configuration`, `url`, `dashboard_view_id`, times/users. [view]. Guide also lists `quick_filters`. [working-with-views]
- Types: `table`, `board`, `calendar`, `timeline`, `gallery`, `list`, `form`, `chart`, `map`, `dashboard`. [view]
- "A view is scoped to a single data source within a database." "`parent` — Always a database." [working-with-views]
- Create a view: exactly one of `database_id`, `view_id` (dashboard widget), `create_database` (linked database). `position` controls place in "the database's view tab bar". [working-with-views], [create-view]
- List by `data_source_id` returns views "including linked views on other pages across the workspace". [working-with-views]
- "A database must always have at least one view. Attempting to delete the last remaining view returns a `validation_error`. To remove the database entirely, set `in_trash` to `true`". [working-with-views]

---

## Implications for a block-tree model (Inference — not doc text)

- Notion splits one visual "database" into three things: container (database), schema+rows (data source), presentation (views). Title/icon/cover/inline flag/parent/permissions sit on the container; schema sits on the source; rows are children of the source, not the container.
- Inline vs full-page is one boolean on the container. It is not a different object type. A Blok equivalent: one `database` block with `data.isInline` (or similar); the same block renders as an embedded table or as an openable page.
- Rows are pages: properties + block children. That already matches Blok's `database-row` block with `contentIds` body.
- A linked database is a separate container whose views point at another container's source. In Blok terms: a second `database` block that references the first's id and owns only view configs, no rows.
- Views belong to the container and target one source; at least one view must exist.
- Gaps the API docs leave open (check in the app before copying): whether a full-page database has its own body blocks; whether `child_database` block id == database id; what the parent block list shows after a move/trash; what a linked database looks like in block children.

---

## Sources

| Key | URL |
| - | - |
| database | https://developers.notion.com/reference/database |
| data-source | https://developers.notion.com/reference/data-source |
| parent-object | https://developers.notion.com/reference/parent-object |
| block | https://developers.notion.com/reference/block |
| retrieve-a-block | https://developers.notion.com/reference/retrieve-a-block |
| update-a-block | https://developers.notion.com/reference/update-a-block |
| patch-block-children | https://developers.notion.com/reference/patch-block-children |
| delete-a-block | https://developers.notion.com/reference/delete-a-block |
| page | https://developers.notion.com/reference/page |
| rich-text | https://developers.notion.com/reference/rich-text |
| create-database | https://developers.notion.com/reference/create-database |
| update-database | https://developers.notion.com/reference/update-database |
| retrieve-database | https://developers.notion.com/reference/retrieve-database |
| move-page | https://developers.notion.com/reference/move-page |
| trash-page | https://developers.notion.com/reference/trash-page |
| view | https://developers.notion.com/reference/view |
| create-view | https://developers.notion.com/reference/create-view |
| working-with-databases | https://developers.notion.com/guides/data-apis/working-with-databases |
| working-with-views | https://developers.notion.com/guides/data-apis/working-with-views |
| working-with-page-content | https://developers.notion.com/guides/data-apis/working-with-page-content |
| upgrade-2025-09-03 | https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03 |
| upgrade-faq | https://developers.notion.com/guides/get-started/upgrade-faqs-2025-09-03 |
| changes-by-version | https://developers.notion.com/reference/changes-by-version |
| changelog | https://developers.notion.com/page/changelog |
| help-intro-db [help center] | https://www.notion.com/help/intro-to-databases |
| help-data-sources [help center] | https://www.notion.com/help/data-sources-and-linked-databases |
