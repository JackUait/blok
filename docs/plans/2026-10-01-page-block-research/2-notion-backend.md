# Notion backend: how pages are modelled, stored, loaded and synced

Research date: 2026-10-01. Read-only web research. Every bullet carries a source or a label.

**Labels**
- **[primary]**: Notion's own engineering blog, help center, or developers.notion.com.
- **[reverse-engineered]**: community clients that call Notion's private `/api/v3`. They are not official and may be stale. Last-commit dates, read via `gh api` on 2026-10-01:
  - `jamalex/notion-py`: 2026-02-16.
  - `NotionX/react-notion-x`: 2026-09-19.
  - `kjk/notionapi`: 2026-09-22.
  - A recent commit does not prove the endpoint shapes in the code are still current.
- **[inference]**: my own conclusion from the sourced facts. Not stated by any source.
- **[unverified]**: no source found.

Quotes in double quotes are verbatim from text I extracted with curl.

Key sources:
- DM: "The data model behind Notion's flexibility", May 18, 2021. https://www.notion.com/blog/data-model-behind-notion
- SH: "Herding elephants: lessons learned from sharding Postgres at Notion", Oct 6, 2021. https://www.notion.com/blog/sharding-postgres-at-notion
- RS: "The Great Re-shard", Jul 17, 2023. https://www.notion.com/blog/the-great-re-shard
- DL: "Building and scaling Notion's data lake", Jul 1, 2024. https://www.notion.com/blog/building-and-scaling-notions-data-lake
- WS: "How we sped up Notion in the browser with WASM SQLite", Jul 10, 2024. https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite
- OF: "How we made Notion available offline", Dec 11, 2025. https://www.notion.com/blog/how-we-made-notion-available-offline
- NT: notion-types, from react-notion-x [reverse-engineered]:
  - https://github.com/NotionX/react-notion-x/blob/master/packages/notion-types/src/block.ts
  - https://github.com/NotionX/react-notion-x/blob/master/packages/notion-types/src/core.ts
  - https://github.com/NotionX/react-notion-x/blob/master/packages/notion-types/src/maps.ts
- NC: notion-client, from react-notion-x [reverse-engineered]:
  - https://github.com/NotionX/react-notion-x/blob/master/packages/notion-client/src/notion-api.ts
  - https://github.com/NotionX/react-notion-x/blob/master/packages/notion-utils/src/get-page-content-block-ids.ts
- NP: notion-py [reverse-engineered]:
  - https://github.com/jamalex/notion-py/blob/master/notion/operations.py
  - https://github.com/jamalex/notion-py/blob/master/notion/block.py
  - https://github.com/jamalex/notion-py/blob/master/notion/client.py
  - https://github.com/jamalex/notion-py/blob/master/notion/store.py
  - https://github.com/jamalex/notion-py/blob/master/notion/monitor.py
- KJ: kjk/notionapi [reverse-engineered]. https://github.com/kjk/notionapi/blob/master/api_loadCachedPageChunk.go
- API: the public Notion API docs, under https://developers.notion.com/reference/. Pages used: `block`, `page`, `parent-object`, `get-block-children`, `intro`, `move-page`.

---

## 1. Block record shape

### Attributes Notion documents

The DM post lists these attributes for every block [primary]:
- **ID**: "We use randomly-generated UUIDs (UUID v4) for IDs in Notion." It also says "You can see the ID of page blocks at the end of the URL in your browser."
- **Properties**: "a data structure containing custom attributes about a specific block." The most common property is `title`, which "stores the text content of block types like paragraphs, lists, and of course, the title of a page."
- **Type**: "defines how a block is displayed, and how the block's properties are interpreted."
- **Content**: "an array (or ordered set) of block IDs representing the content inside this block."
- **Parent**: "the block ID of the block's parent. The parent block is only used for permissions."

### Full record shape (NT, reverse-engineered)

The `BaseBlock` type in NT has these fields:
- `id`, `type`
- `properties?`, `format?`
- `content?: ID[]`
- `space_id?`
- `parent_id`
- `parent_table: 'space' | 'block' | 'table' | 'collection' | (string & {})`
- `version: number`
- `created_time`, `last_edited_time`: numbers
- `alive: boolean`
- `created_by_table`, `created_by_id`
- `last_edited_by_table`, `last_edited_by_id`

Notes on this shape:
- `parent_table: 'team'` does not appear in the NT union [unverified]. NT allows any string through `(string & {})`, so it might exist, but I found no source.
- The public API says: "Team-level pages are also currently represented as having a workspace parent in the API." [primary, API `parent-object`]

### Page blocks

- A page is just `type: 'page'` on the same record. NT's `PageBlock extends BasePageBlock { type: 'page' }` [reverse-engineered, NT].
- A page differs from text only by **how its `content` renders** [primary, DM]:
  - Pages: "Page blocks display their content in a new page, instead of rendering it indented in the current page."
  - List blocks: "List blocks display their content indented."
- Changing the type keeps the data [primary, DM]: "Changing the type of a block doesn't change the block's properties or content—it only changes the type attribute."

### Page title, icon and cover

- The title is stored as `properties.title`, the same field a paragraph uses for its text [primary, DM].
- NT types it as `properties.title: Decoration[]`, which is rich-text runs [reverse-engineered, NT].
- NT's `BasePageBlock.format` holds the page settings [reverse-engineered, NT]:
  - `page_icon`, `page_cover`, `page_cover_position`, `card_cover_position`
  - `page_full_width`, `page_small_text`
  - `block_locked`, `block_locked_by`, `block_color`
- `BasePageBlock` also has `permissions: { role: Role; type: string }[]` and `file_ids?`.
- `Role` is `'editor' | 'reader' | 'none' | 'read_and_write'`.

### Database rows

- A database row is the same block record. DM says "like a page block in a database with user-defined properties" [primary].
- NP reads a block's parent through `parent_table`. It dispatches `"block"` → `get_block`, `"collection"` → `get_collection`, and `"space"` → `get_space` [reverse-engineered, NP `block.py`]. So a row is a page block with `parent_table='collection'` [inference].
- In the public API, a row is a page whose `parent.type` is `data_source_id` [primary, API `page`]:
  - Before API version 2025-09-03 it was `database_id`.
  - If the parent is a page or the workspace, "the only valid key is `title`".

### Record creation fields (NP)

NP's `create_record` builds a new record with these fields [reverse-engineered, NP `client.py`]:
- `id` (a uuid4 the client makes up), `version: 1`, `alive: True`
- `created_by_id`, `created_by_table: "notion_user"`, `created_time`
- `parent_id`, `parent_table`, `space_id`
- The client chooses the ID. NP's comment says: "make up a new UUID; apparently we get to choose our own!"

## 2. Ownership vs rendering

### Two trees

- **Render tree = `content[]`.** DM calls these "downward pointers" and the blocks they point to "render children" [primary].
- **Permission/ownership tree = `parent`.** DM says "we use an 'upward pointer'—the parent attribute—for the permission system" [primary].
- The two trees mirror each other "outside of a few edge cases we're working to clean up" [primary, DM].

### Why two trees exist

Notion gives two reasons, both from DM [primary]:
- Ambiguity: "Initially, we allowed blocks to be referenced by multiple content arrays … because a block can be referenced in multiple places, it's ambiguous which block it would inherit permissions from."
- Cost: walking up through content arrays to find ancestors "is inefficient, especially on the client."
- Note the word "Initially". Notion describes multi-referencing as a past design that led to the parent pointer. It does **not** say blocks are routinely multi-parented today.

### Referencing a page without owning it

These mechanisms are all reverse-engineered:
- **Link-to-page block.** NT has `PageLink { type: 'alias'; format: { alias_pointer: { id } } }` [NT]. It is a separate block that points at the target page. It does not own the target.
- **Inline page mention.** This is a rich-text decoration `['p', pageId]` (NT `PageFormat = ['p', string]`) inside a `title` [NT `core.ts`]. Other mention decorations include `['u', userId]`, `['d', date]`, `['lm', …]` and `['eoi', …]`.
- **Synced block.** NT has `transclusion_container` (the original), plus `transclusion_reference` with `format.transclusion_reference_pointer { id, spaceId }` [NT].
- **Alias by `content` only.** NP's `add_alias` "adds the block's ID to the parent's content list, but doesn't change the block's parent_id". It does this with one `listAfter` on the parent's `content` [NP `block.py`]. This is the `content` ≠ `parent` edge case from DM, used on purpose.
  - Removing an alias only runs `listRemove` on the alias parent's `content`. The target stays alive.
- **How NC walks these references.** NC's `getPageContentBlockIds` follows `content`, `transclusion_reference_pointer`, `alias_pointer` and `['p', id]` decorations [NC]. Inside `if (blockId !== rootBlockId)`, it stops at `if (type === 'page' || type === 'collection_view_page')`, with the comment "ignore the content of other pages and collections".

## 3. Loading

### loadPageChunk

- DM describes it [primary]: it "descends from a starting point (likely the block ID of a page block) down the content tree, and returns the blocks in the content tree plus any dependent records needed to properly render those blocks."
- DM says it uses several cache layers, but "in the worst case, this API might need many trips to the database as it recursively crawls down the tree."
- Load order in the client [primary, DM]:
  - The client first tries local data: memory, then RecordCache on native apps.
  - "if we need block data that's missing, we stop and request the page data from the API."

### Request shape

- NC sends this body to `loadPageChunk` [reverse-engineered, NC]:
  `{ pageId, limit: chunkLimit, chunkNumber, cursor: { stack: [] }, verticalColumns: false }`
- KJ's `loadCachedPageChunk` uses a different body [reverse-engineered, KJ]:
  `{ page: { id }, chunkNumber, limit, cursor: { stack: [[{ id, index, table }]] }, verticalColumns }`
  - The cursor is a stack of `{id, index, table}`, so it looks like a resumable depth-first position.
- KJ's limit values do not match its own comment:
  - The comment says "30 items on first request, 50 on subsequent requests".
  - The code does the opposite: `limit := 30`, then sets `limit = 50` when `cur == nil`, which is the first call.
  - Real chunk sizes are therefore **unverified**.

### recordMap shape

- The response is `{ recordMap, cursor }` [reverse-engineered].
- NT's `RecordMap` has `block`, `collection`, `collection_view` and `notion_user`. `ExtendedRecordMap` adds `collection_query`, `signed_urls`, `preview_images` and `custom_emojis`.
- KJ's `RecordMap` lists these keys: `__version__`, `activity`, `block`, `space`, `notion_user`, `user_root`, `user_setting`, `collection`, `collection_view`, `comment` and `discussion`.

### Missing blocks

- NC's `getPage` loops. It computes the page's content ids, finds the ones not yet in `recordMap.block`, and fetches them with `syncRecordValuesMain` until nothing is missing [reverse-engineered, NC].
- This shows that one `loadPageChunk` response is not always complete.

### What a parent page loads of its sub-pages

What the sources do show:
- The parent's `content[]` holds the sub-page ids [primary, DM].
- The sub-page's own `properties.title` and `format.page_icon` sit on its block record [reverse-engineered, NT].
- So rendering a sub-page link inside the parent needs only that one record.
- NC's traversal stops at child `page` blocks, so NC never fetches a sub-page's body when it renders the parent [reverse-engineered, NC].

What is **not** shown:
- That the **server's** `loadPageChunk` also stops at page boundaries. That is an [inference] from the "render in a new page" semantics and NC's behaviour.
- DM only says it "descends … down the content tree" and is chunked.

Lazy loading:
- Sub-page bodies load when the user navigates into them. That is a new `loadPageChunk` on the sub-page id [inference, consistent with DM's navigation description].

## 4. Writes, transactions and real-time sync

### Operations and transactions

- DM [primary]: changes "are expressed as operations that create or update a single record … operations are batched into transactions that are committed (or rejected) by the server as a group."
- An operation looks like `{ id, table, path, command, args }` [reverse-engineered, NP `operations.py` `build_operation`]. `table` defaults to `"block"`, and `path` is a list of keys.

Commands, as applied locally in NP's `store.py` `run_local_operation` [reverse-engineered]:
- `set`: replace the value at `path`. With `path=[]` this creates or replaces a record.
- `update`: merge `args` into the object at `path`.
- `listAfter`: insert `args.id` after `args.after`, or append if `after` is missing.
- `listBefore`: insert `args.id` before `args.before`, or prepend if `before` is missing.
- `listRemove`: remove the id from the list.

The web UI also adds an `update` with `last_edited_by_id`, `last_edited_by_table` and `last_edited_time` to each touched block [reverse-engineered, NP `operation_update_last_edited`].

### Creating a block

DM describes this [primary]: "blocks are also added to their parent's content array … the client also generates an operation to do so. All these individual change operations are grouped into a transaction."

NP does the same [reverse-engineered]:
- `set` on the new record.
- `listAfter` on the parent's `content`.
- Both run in one `as_atomic_transaction()`.

### Moving a block to another page

NP's `move_to` builds one atomic transaction [reverse-engineered, NP `block.py`]:
1. `update {alive: false}` on the block.
2. `listRemove` from the old parent's `content`, using the old parent's `parent_table`.
3. `update {alive: true, parent_id: new, parent_table: new}` on the block.
4. `listAfter` or `listBefore` into the new parent's `content`.

Both pages' records change in the same transaction. Positions supported: `first-child`, `last-child`, `before`, `after`.

### Turning a block into a page

- DM says Turn-into is a change to `type` only [primary].
- So turning a text block into a page should be an `update`/`set` on the type, with `properties.title` and `content` kept. This is an [inference]. I found no captured transaction for it.

### Endpoint names

- DM (May 2021) names `/saveTransactions` [primary].
- NP posts to `submitTransaction` with `{ operations }` [reverse-engineered].
- Both names are reported here. Which one is current is **unverified**.

### Server-side commit

DM describes these steps [primary]:
1. The server loads every block and parent involved, giving a "before" picture in memory.
2. It copies that and applies the operations to produce "after".
3. It "use[s] both 'before' and 'after' data to validate the changes for permissions and data coherency".
4. Then it commits and returns success.
5. In the background it schedules version history and notifies MessageStore.

### Client queue

- Changes are applied to the in-memory and local cache. "At the same time", the transaction is saved into TransactionQueue, which "stores transactions safely in IndexedDB or SQLite (depending on platform) until they're persisted by the server or rejected" [primary, DM].

### Versioning and conflicts

- Each record has a `version: number` [reverse-engineered, NT/NP].
- DM does not describe how concurrent edits to the same field are merged. Its server step is validate-then-commit on a before/after copy [primary].
- Notion has a newer CRDT data model for conflict resolution. OF says offline-enabled pages "are dynamically migrated to our new CRDT data model for conflict-resolution" [primary]. Its internals are **unverified**: no public detail found.

### Real-time sync (MessageStore)

- DM [primary]: "Every client has a long-lived WebSocket connection to MessageStore … the client subscribes to changes of that record."
- After a commit, MessageStore "passes on the new version" to subscribers.
- A client whose cached version differs sends `syncRecordValues` with the outdated records and re-renders from the reply.
- NP's monitor shows the wire format [reverse-engineered, NP `monitor.py`]:
  - It talks to `https://msgstore.www.notion.so/primus/` over Engine.IO 3 polling, not a WebSocket.
  - Subscription keys are `versions/{id}:{table}` with the known `version`, and `collection/{id}` for collection children.
  - On an event whose `value` is greater than the local version, it refreshes that record.
  - The transport may have changed since; that is unverified.
- Offline pages also use a per-page channel [primary, OF]: "Whenever a batch of updates is applied to a page, the server emits a message on a channel for that page."

## 5. Storage at scale

- Every content type is one entity. DL [primary]: "Everything you see in Notion—texts, images, headings, lists, database rows, pages, etc—… is modeled as a 'block' entity in the back end and stored in the Postgres database."
- Scale [primary, DL]:
  - "more than 20 billion block rows in Postgres" at the start of 2021.
  - "more than two hundred billion blocks" by the time of the post.
  - "90% of Notion upserts are updates."
- What was sharded [primary, SH]: "all tables reachable from the block table via some kind of foreign key relationship". That includes space, discussion, comment and others.
- Partition key [primary, SH]: "each block belongs to exactly one workspace, we used the workspace ID as the partition key. Since users typically query data within a single workspace at a time, we avoid most cross-shard joins."
- Row key [primary, SH]: sharded rows use a composite key, `id` plus `space_id`.
- Shard counts [primary]:
  - 2021: "480 logical shards evenly distributed across 32 physical databases", 15 per database [SH].
  - 2023: 32 → 96 machines, 15 → 5 schemas per shard, still 480 logical shards [RS, DL].
- Transaction limit [primary, SH]: "transactionality guarantees only apply within each datastore", with the example that "the block deletion could succeed while the comment update fails".
- Why workspace partitioning helps moves [inference]:
  - Every block in a workspace shares one `space_id`, so they sit on one logical shard.
  - So a move between two pages of the **same** workspace touches records on one shard and can commit as one Postgres transaction.
  - I found no source on how cross-workspace moves are handled.

## 6. Client caching and offline

### Native-app cache

- DM [primary]: native apps "cache all records you access locally in an LRU (least recently used) cache on top of SQLite or IndexedDB called RecordCache."
- The cache granularity is the **record**.

### Browser cache (WASM SQLite)

From WS [primary]:
- The browser uses WASM SQLite with OPFS persistence. Each tab has a Web Worker, and a SharedWorker routes every query to the one "active tab".
- They shipped "OPFS SyncAccessHandle Pool VFS" because it does not need cross-origin isolation.
- Results:
  - "improved page navigation times by 20 percent in all modern browsers."
  - Initial page load gained nothing, because "the initial page data would seldom be loaded from SQLite".
  - SQLite reads are "raced" against the API, because some devices read disk slowly.
- Write load: "The Notion application frequently writes to the cache—it does so every time it gets an update from the server."

### Offline mode

- Announced "Last August" in a post dated Dec 11, 2025, so August 2025 [primary, OF].
- The old SQLite cache "was best-effort". Offline mode needed "downloading every record that the page depends on". The cache became a persistent store that tracks offline pages and "why" each one is offline [primary, OF].
- **Granularity is the page** [primary, OF]: "We track which pages … are fully available offline and only let you access these pages when you have no internet connection." Notion would rather block access than show a half-loaded page.
- How a page becomes offline [primary, OF]:
  - an explicit "Available offline" toggle
  - automatic download of recent pages
  - favorites
  - inheritance from a parent page
  - a database marked offline downloads "up to 50 pages in the current view"
- The two tracking tables [primary, OF]:
  - `offline_page`: "One row for every page or database that is available offline."
  - `offline_action`: one row per reason, with columns `origin_page_id`, `from_page_id`, `impacted_page_id` and `type`.
  - Invariant: every `offline_page` row has at least one `offline_action` row with it as `impacted_page_id`.
- Staying fresh [primary, OF]:
  - Per-page push channels, as in section 4.
  - On reconnect, the client compares its `lastDownloadedTimestamp` with the server's `lastUpdatedTime` for each page.
  - Structural changes (moves, rows entering or leaving a view) re-diff the `offline_action` rows.

## 7. Permissions

- Effective permission is **computed by walking ancestors** through `parent` [primary]:
  - DM: "To implement permission checks for a block, we need to look up the tree, getting that block's ancestors all the way up to the root of the tree (which is the workspace)."
  - DL: "a block's permission isn't statically stored in the associated Postgres—it has to be constructed on the fly via expensive tree traversal computation."
- **Explicit sharing settings sit on the page block.** NT has `permissions: { role, type }[]` on `BasePageBlock`, with `Role = 'editor' | 'reader' | 'none' | 'read_and_write'` [reverse-engineered, NT].
- These two facts fit together. Grants are stored on certain blocks, and the effective set is computed by walking up to the workspace [inference].
- Inheritance rule:
  - "a page inherits from the nearest parent page with custom permissions; top-level teamspace pages inherit from teamspace settings" comes from a search-engine summary, not a primary page I read [secondary/unverified].
  - The help page I read confirms only this: "Each teamspace has its own members and permission levels." https://www.notion.com/help/sharing-and-permissions [primary]
- The server checks permissions on every transaction, on the before/after copies [primary, DM].

## 8. Trash and deletion

- **Soft delete** [reverse-engineered, NP `remove()`]:
  - `update {alive: false}` on the block, plus `listRemove` from the parent's `content`, in one transaction.
  - NP's docstring: "it doesn't *actually* delete it, just orphan it."
  - Because of the `listRemove`, restoring is more than flipping `alive`. The id has to be put back into a `content` array.
- **Permanent delete** [reverse-engineered]: NP posts `deleteBlocks` with `{ blockIds, permanentlyDelete: true }`.
- **Restore** [primary]: "Your page will return to where it was last in your workspace." https://www.notion.com/help/back-up-your-data
  - How the old position is kept or rebuilt in `content` is **unverified**. `move_to` shows `parent_id` is kept on the dead record until it is rewritten.
- **Retention** [primary]:
  - "By default, pages will remain in Trash for 30 days before they are automatically removed from Trash. Enterprise plan workspace owners may customize these settings." https://www.notion.com/help/back-up-your-data
  - "Once pages are permanently deleted from Trash, they are retained for 30 days before they become inaccessible to all users, even workspace owners." https://www.notion.com/help/duplicate-delete-and-restore-content
- **Public API** [primary, API `block`/`page`]:
  - `in_trash: boolean` on blocks and pages. `archived` is a deprecated alias.
  - The API trashes and restores by setting `in_trash` through Update block or Update page.

## 9. Public API: what it reveals

- The API splits one record into two views [primary, API `page`, `block`]:
  - **Page object**: `object: "page"`, with `properties`, `icon`, `cover`, `parent` and `in_trash`.
  - **Block object**: `object: "block"`, with `type`, `has_children` and `in_trash`.
  - "Page content is available as blocks. The content can be read using retrieve block children."
- A sub-page appears **inside its parent's children** as a `child_page` block. That block carries only `child_page: { title }` [primary, API `block`].
  - "To create or update child_page type blocks, use the Create a page and the Update page endpoints."
  - So the page record also sits in the parent's content list, and the parent shows only its title [inference]. This matches section 3.
- Children are one level deep and paginated [primary, API `get-block-children`, `intro`]:
  - "Returns only the first level of children for the specified block."
  - `page_size`: "Default: 100, Maximum: 100".
  - Paging uses `start_cursor`, `has_more` and `next_cursor`.
  - "you may need to recursively retrieve the block children of child blocks", using `has_children` as the hint.
- Parent types [primary, API `parent-object`]:
  - "Pages can be parented by other pages, data sources, blocks, agents, or by the whole workspace."
  - Team-level pages appear as `{ type: "workspace", workspace: true }`.
- The API has a dedicated **Move a page** endpoint, with body `{ parent: { type: "page_id", page_id } }`. It works only on "a regular Notion page, and not a database" [primary, API `move-page`]. From the API caller's side, a move is one parent change and the caller never edits two content arrays [inference].

---

## Implications for a library editor that does NOT own the consumer's database

These are design recommendations derived from the findings above. They are not facts about Notion.

1. **A page is a block with `type: 'page'`, a title, and `contentIds`. It is not a separate entity.** Notion stores the title in the same `properties.title` field as text, and Turn-into only changes `type` (sections 1 and 2). Blok's "everything is a block" law already matches this.
2. **Keep a sub-page's body out of the parent document.** Notion shows a sub-page in its parent as one record holding title and icon (`child_page { title }`, `format.page_icon`). The body loads on navigation (sections 3 and 9). Blok should save a page block in the parent with only its header data, and load the body through a **consumer-supplied loader**, for example `loadPage(id) → blocks`.
3. **Separate "owns" from "references".** Notion uses `parent` for ownership and `content` for rendering. Link-to-page (`alias`) and mentions (`['p', id]`) point to a page without owning it (section 2). Blok should model link and mention blocks as id references that never re-parent the target, and should keep the reference id-based so a host can resolve it lazily.
4. **Emit a cross-page move as one atomic, ordered op group.** Notion's move is remove → re-parent → insert in one transaction (section 4). Blok cannot assume the consumer's store is transactional, which Notion gets from workspace sharding (section 5). So Blok should hand the host one grouped change event with both pages' changes and let the host commit it atomically or reject it.
5. **Use client-minted UUID ids plus per-record operations.** Notion clients mint UUIDv4 ids and send `{table,id,path,command,args}` ops (sections 1 and 4). This fits Blok's collab layer and lets a host write to any database without id negotiation.
6. **Soft delete must keep the restore position.** Notion's delete flips `alive` *and* removes the id from `content`, while the dead record keeps `parent_id` (section 8). If Blok exposes trash or restore, it should record the former parent and position, or leave restore to the host. It should never hard-delete a sub-page's subtree on its own.
7. **Leave permissions to the host.** Notion computes permissions server-side by walking ancestors and checks them on every transaction (section 7). A library cannot enforce that. At most Blok can expose read-only or locked flags per page that the host sets (like NT's `block_locked`), and treat a rejected write as a normal path.
8. **Paginate children and expect gaps.** Both the public API (100 per page, cursor) and the private API (chunked, sometimes incomplete) return partial children (sections 3 and 9). Blok's page loader contract should allow cursors and should render or placeholder missing child ids, not crash.
9. **Cache and offline at page granularity, owned by the host.** Notion caches records but makes offline guarantees per page, and refuses to open a half-downloaded page (section 6). Blok should expose "page fully loaded or not" to the host, and leave persistence (SQLite, IndexedDB) to the host.
10. **Track versions per record for sync.** Notion's realtime path is "version bumped → client re-fetches stale records" (section 4). Pages in Blok sync more easily if each page block can carry a host-provided version or `lastEditedTime`, so the host can tell which pages are stale.
