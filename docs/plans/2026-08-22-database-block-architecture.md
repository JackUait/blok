# Database Block — Architecture for Scale

> **Status amendment:** the query shape and block model remain. The remote source is
> now implemented by Blok's C# package inside the consumer's application (or the same
> code in the standalone host), not by consumer-written endpoints and not by Go. See
> [`2026-08-23-blok-dotnet-library-design.md`](2026-08-23-blok-dotnet-library-design.md).

## The question

Notion-style databases are assumed to require "real" databases per collection,
which would be hard to reproduce on a consumer's backend. This document checks
that premise, records what Blok already has, and fixes the one decision that would
otherwise force a rewrite later.

No implementation work is proposed for now. The outcome is a decision plus a
sized, deferred refactor.

## Premise check: Notion has no per-database databases

From Notion's own writing on their data model: "Everything you see in Notion is a
block. Text, images, lists, **a row in a database**, even pages themselves — these
are all blocks." A row is a page block carrying user-defined properties; the
properties are a structure on the block, not columns in a table.

From their sharding post: there is **one** block table, split across 32 physical
databases holding 15 logical shards each — 480 shards, partitioned by workspace id.
A "database" in the Notion UI corresponds to nothing in their storage layout. It is
a block whose children happen to be row blocks.

**Conclusion: the premise is false.** Notion's difficulty is volume, not data model.
The model is the one Blok already declares in CLAUDE.md — everything is a block.

## What Blok already has

The block law is implemented, and deliberately so — the current shape is the result
of a migration in April 2026:

```
960c6a39 refactor(database): remove rows from DatabaseData, add LegacyDatabaseData
5e8301b0 feat(database): add DatabaseRowTool as lightweight block for database rows
96a5b974 fix(database): convert playground data to child-block format
```

- `DatabaseData` (`src/tools/database/types.ts`) stores title, schema, views,
  `activeViewId`. **No rows.**
- Rows are child blocks, collected at `src/tools/database/index.ts:285` by
  `.filter(child => child.name === 'database-row')`.
- `DatabaseRowTool` is a deliberately minimal block holding `properties` and
  `position`, not user-insertable, driven by the parent through `block.call(...)`.

`DatabaseAdapter` (`types.ts`) also already exists — but it is **a write mirror,
not a data source**:

- `loadDatabase()` returns `{ schema, views }` and **no rows**.
- Everything else is `createRow` / `updateRow` / `moveRow` / `deleteRow`, plus the
  property and view equivalents.
- `DatabaseBackendSync` debounces row and property updates at 500 ms.

So the document is the source of truth and the consumer's backend receives a copy
of every change. There is **no read path for rows**: no filtered query, no
pagination, no counting.

## The real rewrite risk

It is not where rows are stored. It is a single assumption compiled into the call
sites: **all rows are present in memory, as one complete array.**

```
database-model.ts:18   private rows: DatabaseRow[] = [];
index.ts:596           rows: this.model.getOrderedRows(),
index.ts:553/580/1178  this.model.getRowsGroupedBy(groupByPropId)
```

At a few hundred rows this is ideal. At ten thousand everything fails at once: the
document carries ten thousand blocks, filtering runs over an in-memory array, and
there is no one to ask for "the first fifty matching this filter".

## Three regimes

1. **Rows in the document** — today. Good to roughly low thousands of rows;
   filtering and sorting happen in memory.
2. **Rows behind a query** — the same block law, but a view **asks a question**
   ("give me rows for this view config, this page") instead of holding an array.
   Today memory answers; later the consumer's server answers, filtering and paging
   on its side. Views never learn the difference.
3. **Relations and rollups across databases** — require an index spanning
   documents, not one document. **Explicitly out of scope** so nobody assumes the
   seam covers it. It is a backend feature, and it arrives, if ever, with its own
   design.

## The decision

**What gets laid down now is the shape of the question, not storage.**

Storage was never the risk — the same lesson as the backend-service design, where
document storage turned out to belong to the consumer. The risk here is that the
code cannot *ask*; it can only *take everything*.

### The question shape

```ts
queryRows(request: {
  view: DatabaseViewConfig;   // filters, sorts, groupBy already live here
  group?: string;             // which group's page — board columns page separately
  cursor?: string;
  limit?: number;
}): Promise<{
  rows: DatabaseRow[];
  nextCursor?: string;
  total?: number;             // optional: a remote source may not count cheaply
}>

queryGroups(view: DatabaseViewConfig): Promise<Array<{ key: string; count: number }>>;
```

Two details that must be in the shape from the first line, or regime 2 will not fit
later:

- **Per-group paging.** A board groups rows by a property, and each column must page
  independently — this is what Notion does with kanban columns. A single page for
  the whole view cannot express it.
- **Group counts without rows.** Column headers show counts; fetching every row to
  count them defeats the purpose.

### Where the remote implementation lives

Database rows are the consumer's **business records**, exactly like documents. By
the ownership line in `2026-08-22-backend-service-design.md`, the remote answer to
`queryRows` comes from **the consumer's endpoint**, or their BaaS via a preset —
**never from our Go service**. That service remains uploads and link previews only.

Stated explicitly here because otherwise the two documents look contradictory.

## Sizing the deferred refactor

Smaller than expected, because the coupling is concentrated rather than spread:

- `DatabaseModel` gains the query-shaped methods and answers them from memory.
  `getOrderedRows()` / `getRowsGroupedBy()` become internals.
- `src/tools/database/index.ts` — four call sites (`:553`, `:580`, `:596`, `:1178`).
- **View files need no changes.** They already receive their data from outside, and
  the shared `DatabaseViewRenderer` contract already carries `appendRow` — so
  incremental loading is expressible today, merely unused.

No behavior change: the in-memory implementation returns everything in one page.

Note for later scope: `ViewType` declares `'board' | 'table' | 'gallery' | 'list'`,
but only board and list renderers exist. Table and gallery will be written against
the query shape from the start rather than migrated to it.

## Non-goals

- No relations or rollups across databases.
- No server-side aggregation beyond group counts.
- Our backend service does not store or query rows — see the ownership line.
- No implementation in this pass: the refactor is the first task of a future plan.

## Sources

- [Notion — the data model behind Notion](https://www.notion.com/blog/data-model-behind-notion)
- [Notion — herding elephants: sharding Postgres](https://www.notion.com/blog/sharding-postgres-at-notion)
- [AppFlowy — database system](https://deepwiki.com/AppFlowy-IO/AppFlowy/7-database-system)
