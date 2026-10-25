# Architecture: full-page databases on Blok pages

Reads `recon.md` + `features.csv`. The replica template's stack/SQL sections do not apply: Blok is a library, and the "schema" is block data.

## Decision

A full-page database is a **Blok page whose document holds one database block**. The parent document holds an ordinary `page` block pointing at it.

- Why a page, not a flag on the database block: the user asked for Blok's pages. A page gets a URL, a sidebar entry, Trash, its own collab room and Ask AI scope for free. The page tree, Trash watch and agent gate all match `type === 'page'`, so keeping the block type `page` means none of them need a second type.
- Notion keeps one object with an `is_inline` flag (API `reference/database`). Blok's equivalent of that flag is where the database block lives: in the parent document (inline) or in its own page document (full page).

## Data

| where | field | meaning |
| --- | --- | --- |
| parent `page` block | `kind?: 'database'` (new, saved) | draw the link with the table glyph. Saved, not resolved: no page-icon flash before `resolve` answers, and it works with no host `resolve`. Notion also stores it on the parent block (`collection_view_page`). |
| page document | one `database` block with `fullPage: true` (new, saved) | the explicit marker. A normal page that happens to hold only a database does NOT flip into database mode. |
| page document | `OutputData.title` / `icon` | the database's title and icon while it is a page. The database hides its own title row (Notion: "Full-page databases with one data source never show this title"). |
| `PageConfig.create(init)` | `init.document?: OutputData` (new) | the page's starting document. Clears the recorded blocker (`32-parity-status…r12.md:134`). |
| `BlockTool.prepareInsert(config, data?)` | `data` (new arg) | the toolbox entry's own `data`, so one tool can offer two entries that create different things. |

All additive and optional. Not BREAKING (`types/tools/page.d.ts` create/loadDocument changed after v1.16.1; new optional fields break no consumer). Database fields are never BREAKING (user decision 2026-10-20).

## Flows → code

| flow | code |
| --- | --- |
| F01 create | Page tool gets a second toolbox entry "Database - Full page" in the `database` section. Its `prepareInsert` calls `create({ pageId, document: { blocks: [database {initialView:'table', fullPage:true}] } })`, returns `{ pageId, kind: 'database' }`. The tool already calls `open` after a toolbox create. |
| F02 open | unchanged page tool `open`/`href`. |
| F03 page → inline | M2. Page menu item "Turn into inline database" (only when `kind === 'database'` and `loadDocument` exists): load the page document, insert its database subtree in place of the pointer with `fullPage` removed and `title` = page title, then the pointer is gone (playground Trash watch trashes the page). |
| F04 inline → page | M2. Database menu item "Turn into page" (needs page tool `create`): serialize the whole subtree (rows, row bodies, comments, nested databases), `create` with it, wait, then swap the subtree for a `page {kind:'database'}` block. If `create` throws, change nothing. |

Not routed through `conversionConfig`/Turn into: page export is the literal word "Page", lossy by design.

## Parts that bite

- **Undo across two documents (M2).** Turn into then undo must not leave the database in both documents or in neither. Test first.
- **Linked views** (`source.documentId`) of a database that moves document go stale. M2: check and decide.
- **Icons.** `DatabaseData.icon` is a glyph tile; `PageIcon` is emoji/image. M2 maps them; until then the page icon stays empty and the link shows the table glyph.
- **Collab.** `loadDocument` must return the live room, not the localStorage copy (playground `HeldDocuments`).
- **Tool name.** The seeded document names the block type `database`, the name every built-in config registers it under.

## Build order

1. **Slice (M1):** `prepareInsert` data arg → `create({document})` + page entry + `kind` glyph → database `fullPage` hides its title → playground stores the document and tree shows the glyph. Screens S01, S02, S04.
2. **M2:** F03 + F04 with the undo test, linked views, icon mapping.
3. **Should:** ⤢ "Open as full page" on inline (Blok inline databases have no URL, so later), hover preview draws a table, Trash/restore check, "no body blocks" enforcement (v1 allows typing below the database; recorded divergence), docs site in both locales.
