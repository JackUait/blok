# Page blocks on Blok's backend, persistence and collab stack

Research only. No code was changed. Every code claim cites a file and line read in this session (paths are relative to `/Users/jackuait/Packages/blok`). Library claims cite a URL. Anything not checked is labelled **UNVERIFIED**.

---

## 0. Summary

- Today, one Blok editor is one document. It has one `Y.Doc` with two roots, `blocks` (a map) and `root` (an array). That maps to one sync room `/sync/{doc}`, one server working-set blob keyed by `sha256(doc)`, one consumer endpoint `GET/PUT {doc-endpoint}/{doc}`, and one ticket `doc` claim.
- Nothing in the stack knows about "a block whose children are not loaded".
  - The Saver rebuilds `content[]` only from blocks that are in memory.
  - The Yjs read side skips ids that have no map entry.
  - So a page block that lists unloaded children in `content` would **erase them on the next save**.
- Option B (one Y.Doc per page) needs **no schema change**. A page is an ordinary schema-v2 document. The page block in the parent is a leaf that names the child document in `data`. The cost of B is in cross-page moves, tickets and sockets, not in the schema.
- Option C (Yjs subdocuments) has no support anywhere in this stack. Neither the client, the server nor the wire protocol handles subdocs. In this stack C would be B plus extra machinery.
- Option A (one doc for the whole tree) cannot enforce per-page read permissions. Authorization runs once per document at the handshake, and Yjs then syncs everything.
- The ownership line has three variants, not two: a consumer `pages` adapter; Blok's service storing pages (this crosses the line); and the `blok_`-tables-in-the-consumer's-DB design from the .NET library doc (design only, not implemented).

---

## 1. Today: what one "document" is, end to end

### 1.1 Client save/load contract (no collaboration)

- **`onSave`** is `onSave?(data: OutputData, api: API): void` (`types/configs/blok-config.d.ts:414`).
- **`persistence`** is `{ load(): Promise<OutputData | PersistedDocument | null>; save(data, ctx): Promise<SaveResult|void>; onError? }` (`types/configs/blok-config.d.ts:708-718`).
  - Its doc comment says that "the Blok service stores no documents" (`:653-654`).
  - Saves are queued, never parallel, and newest-only (`:658-661`).
  - Versioning is opt-in and Blok only carries the version (`:665-671`).
  - Every save carries **the whole document** (`:680-682`).
  - `persistence` fills `onSave` only when the host did not set one (`:662`).
- **Load on mount.**
  - `core.ts:161-164` keeps `persistence.load` as a one-shot. It is used only when `config.data == null`.
  - If both are set, `core.ts:172-192` warns that `persistence.load` will not run.
  - Collaboration and persistence are mutually exclusive: `core.ts:332-333` throws `'collaboration and persistence cannot be combined…'`.
- **`server` and `ticket` keys.**
  - `server` fills in `uploader` and the bookmark endpoint. It "does NOT configure document storage" (`blok-config.d.ts:628-639`).
  - `ticket` is the host's pass-minting endpoint (`:641-650`).

### 1.2 Saved JSON shape

- `OutputData = { version?, time?, blocks: OutputBlockData[] }` (`types/data-formats/output-data.d.ts`, the `OutputData` interface after `:95`).
- `OutputBlockData` holds `id?`, `type`, `data`, `tunes?`, `parent?: BlockId` (`:78`), `content?: BlockId[]` (`:86`), `lastEditedAt?` and `lastEditedBy?`. It is a flat list with references, Notion-style.
- The Saver (`src/components/modules/saver.ts`) works like this:
  - It treats a dangling `parentId` as root in the output and warns (`:245-274`).
  - It builds each parent's `content[]` from **in-memory blocks only**: "its contentIds first, then any child whose parentId names it but contentIds omits" (`:279-308`).
  - Output follows a DFS tree order (`:294`).

### 1.3 Yjs document (schema v2)

- There is one `Y.Doc` per `DocumentStore` (`src/components/modules/yjs/document-store.ts:143`), and one `DocumentStore` per editor's `YjsManager` (`src/components/modules/yjs/index.ts:163`).
- It has two roots:
  - `ydoc.getMap('blocks')`, mapping id → per-block `Y.Map` (`:149`).
  - `ydoc.getArray('root')`, the top-level ids in order (`:154`).
  - The schema comment is at `:98-108`.
- Per-block keys are `id`, `type`, `data` (a `Y.Map`), `tunes` (a `Y.Map`), `parentId` (absent at root), `contentIds` (a `Y.Array<string>`), `lastEditedAt` and `lastEditedBy` (`serializer.ts:335-386`, `document-store.ts:259-298`).
- The flat order is **derived** by a DFS from `root` through `contentIds`. `parentId` is the last-writer-wins arbiter of membership (`document-store.ts:347-360`). The read-side laws (`:494-530`) are:
  - an entry counts only if the block's parent agrees with the array it sits in;
  - **an id with no map entry is skipped**;
  - unreached map entries are appended at the end, sorted by id.
- Placement is `addBlockAt(blockData, {parentId, afterId})` (`:634-680`).
- `moveBlockTo(id, placement)` runs in **one transaction** that owns both the `parentId` key and order-array membership (`:761-775`, `:804-812`). So a move within one doc is atomic and keeps the block's `Y.Map` identity (`:102-104`).
- Subdocuments are explicitly **not** read. `yValueToPlain` returns `null` for a `Y.Doc` value (`serializer.ts:838-844`).

### 1.4 Sync wire and room identity

- The client sync URL is `${server}/sync/${encodeURIComponent(doc)}` (`src/components/modules/collaboration/index.ts:109-116`, used at `:400`).
- `collaboration.doc` must be a single path segment and is fixed for the editor's life (`blok-config.d.ts:740-743`, `:782-784`).
- Server routes are `GET /sync/{doc}` (WebSocket), `POST /sync/{doc}/reset` and `POST /sync/{doc}/edit` (`packages/server/dotnet/Blok.Server.AspNetCore/BlokServerEndpointRouteBuilderExtensions.cs:92-96`).
- The room manager keeps one `CollabRoom` per `docId` (`Blok.Server/Collab/CollabRoomManager.cs:337-354`). The room holds a single `YDoc` (`CollabRoom.cs:1211`).
- I found no doc-id field in the frame protocol (`packages/server/protocol/blok-sync-v2.md`, grep for room/path/doc). The room is the URL. **UNVERIFIED in full:** I did not read the whole protocol spec.

### 1.5 What the C# server stores and how it keys it

- **Working set** (the Yjs update log between compactions): `ICollabWorkingSetStore.ReadAsync/WriteAsync/ResetAsync(docId, …)` (`Blok.Server/Collab/ICollabWorkingSetStore.cs:49-71`).
  - The files and S3 keys are `CollabDocKey.For(docId)`, which is SHA-256 lower-hex (`CollabDocKey.cs:7-20`, `LocalCollabStore.cs:401`, `S3CollabStore.cs:109`).
- **Operation journal** (acknowledged per-edit persistence): `ICollabOperationStore` (`ICollabOperationStore.cs:167, 261, 306, 362`).
  - It is registered with `UseCollabOperationStore<T>()` (`Blok.Server.AspNetCore/BlokServerBuilderExtensions.cs:50-55`).
  - The only built-in implementation, `LocalCollabOperationStore`, is wired in `BlokServerConformanceExtensions.cs:39`.
  - **The production host registers no journal.** `Blok.Server.Host/Program.cs:84-96` calls `UseConformanceJournal` only inside `#if BLOK_SERVER_CONFORMANCE`. The extension's own doc says "production DI never does… a stock host negotiates blok-sync.v1 and journals nothing" (`BlokServerConformanceExtensions.cs:17-22`). A NuGet consumer can register their own store via `UseCollabOperationStore<T>()`.
- **The consumer's document record.** The server does not own it. It seeds from, and projects back to, the consumer's endpoint:
  - `GET {endpoint}/{docId}` returns bare OutputData, a `{data, version}` envelope, or `null`.
  - `PUT {endpoint}/{docId}` sends the whole OutputData with `Blok-Doc-Version`, `Blok-Doc-Lineage` and `Blok-Doc-Sequence` headers (`Blok.Server/Collab/DocEndpointClient.cs:70-87`).
  - The seed path is `CollabRoom.cs:1566-1594` (`endpoint.LoadAsync` → `converter.Seed`).
  - The export is a debounced single-flight PUT of `converter.Export(doc)` (`CollabRoom.cs:2614-2663`).
- The server-to-consumer edit API is `POST /sync/{doc}/edit` with ops `insert {id, block, parent, after}`, `update {id, data}` and `remove {id}` (removing a block removes "everything parented to it") (`CollabEditOps.cs:40-41, 233-257`).
  - The whole request is planned before the transaction opens. A refused request leaves the doc unchanged, and the commit is one update (`YDocConverter.cs:190-235`).
  - `insert` of an id that already exists is refused: "the document already has a block" (`YDocConverter.cs:577-583`).
  - `remove` of a missing id is refused (`:720-731`).

### 1.6 Auth tickets

- A ticket is HS256 with claims `user`, `doc?`, `write?` and `exp` (`packages/server/types/index.d.ts:10-19`; verifier `Blok.Server/TicketVerifier.cs:119-120`).
- At the sync handshake, "The ticket must name this document; an absent claim is a mismatch." The check is an ordinal equality with the route doc (`Blok.Server.AspNetCore/Collab/SyncHandshake.cs:162-165`). The `write` claim sets `canWrite` (`:173`).
- The client already scopes each ticket per document by sending `?doc=<enc>` to the host's mint endpoint (`src/components/utils/access-pass.ts:14-20, 46-58`).
- The application hook is `IBlokAuthorization.CanReadDocumentAsync/CanWriteDocumentAsync(user, documentId)` (`Blok.Server.AspNetCore/IBlokAuthorization.cs:33-53`).
  - It can only narrow what the transport granted (`:14-17`).
  - It is consulted **once per sync connection** (`SyncHandshake.cs:201-207`) and once per edit or reset request (`EditEndpoint.cs:56`, `ResetEndpoint.cs:46`).

**One document today = one editor = one `Y.Doc` = one `/sync/{doc}` room = one working-set blob `sha256(doc)` = one consumer record at `{endpoint}/{doc}` = one ticket `doc` claim = one authorization decision.**

---

## 2. Page granularity options, costed against this code

### The fact every option must respect: unloaded children are erased

- Saved `content[]` is rebuilt from loaded blocks (`saver.ts:279-308`).
- The Yjs DFS skips ids with no map entry (`document-store.ts:494-530`).
- `fromJSON` **deletes** every map key not present in the rendered blocks (`document-store.ts:204-219`).

So "a page block whose `content` lists children that are not loaded" is impossible today. The next save, or the next render, drops them.

The .NET library design reached the same conclusion for databases. It calls for a core "generic externally-persisted-child contract": the saver omits externally persisted children, and unloading removes only the local copy (`docs/plans/2026-08-23-blok-dotnet-library-design.md:288-301`). That contract is **design only** (`:7` says the database phase is "not included in the current packages").

### (A) One Y.Doc for the whole workspace or tree (a page is a subtree)

**What already works**

- A page = a block with `contentIds` (CLAUDE.md "Everything Is a Block", rule 3).
- Moving a block between pages = `moveBlockTo` (one transaction, keeps `Y.Map` identity; `document-store.ts:761-812`).
- Delete page = the existing subtree delete.
- Server `remove` cascades (`CollabEditOps.cs:40`).
- Duplicate = a deep copy with new ids inside one doc. **UNVERIFIED:** I did not locate or read Blok's duplicate code path.

**Costs in this code**

- **Load everything.** `fromJSON` loads the full block list (`:204`). Seeding GETs the whole OutputData, bounded at 64 MB (`DocEndpointClient.cs:24`). Export PUTs the whole document on every debounce (`CollabRoom.cs:2641`). `persistence.save` sends the whole document (`blok-config.d.ts:680`).
- **No per-page read permission.** `IBlokAuthorization` is asked per `documentId` at connect time (`SyncHandshake.cs:201-207`). Yjs then syncs the whole doc. I found no per-block read filter. That means someone who may read the workspace reads every page. This is a hard limit of A, not a tradeoff.
- **Page-sized rendering.** One editor would have to render only a subtree. I found no "render subtree as root" mode. **UNVERIFIED** that none exists. I grepped only for page tools and found no `page` or `link_to_page` tool in `src/tools`.
- The working set and journal grow with the whole workspace.

### (B) One Y.Doc per page (lazy)

**Why the schema is already ready**

- A page document is an ordinary schema-v2 `Y.Doc`. Its `root` array (`document-store.ts:154`) holds the page's top-level blocks.
- In the parent document, the page block is a **leaf**. It names its child document in `data` (for example `data.pageId`, or the block's own id reused as the child doc id). It never names it in `content`, so the erase-on-save rule in §2 does not touch it.

**What maps one to one onto existing per-document machinery**

- Room `/sync/{pageId}`.
- Working set `sha256(pageId)`.
- Consumer `GET/PUT {endpoint}/{pageId}`.
- Ticket `?doc=pageId` (`access-pass.ts:51-58`).
- `IBlokAuthorization(user, pageId)`.
- The database drawer already opens a **separate Blok instance** per row body (`src/tools/database/database-card-drawer.ts:601-614`). That is the same "open a nested page in its own editor" shape.

**Costs**

- **Moving a block between pages is not atomic.** Two rooms, two `Y.Doc`s, two consumer records. The safe pattern with today's primitives is copy-then-delete with preserved ids:
  1. `POST /sync/{target}/edit` with `insert` ops carrying the **same block ids**. A retry is detectable because a duplicate insert is refused with "already has a block" (`YDocConverter.cs:579-583`), and the whole request is all-or-nothing (`:190-198`).
  2. Then `POST /sync/{source}/edit` with `remove {id}`. A retry after success is refused as "no block to remove" (`:726-731`).
  3. Failure between steps 1 and 2 leaves **a duplicate, never a loss**. A sweeper or an "intent record" (the consumer's, or a tombstone `data.movedTo` on the source block) finishes the job.
  - **Retries.** A retried insert comes back as a whole-request **refusal**, not a success. The move is idempotent only if the caller reads "already has a block" as "my earlier attempt landed".
  - **Order.** Subtree inserts must go parent-first, because `PlanInsert` refuses an insert under a missing parent (`YDocConverter.cs:585-596`).
- **Who drives the move.** `/sync/{doc}/edit` is documented as a door for "a consumer backend that is not a WebSocket peer" (`EditEndpoint.cs:9-10`). There are two possible drivers:
  - A **consumer backend** calls `/edit` on both docs.
  - A **browser** already has the source page open in Yjs. It removes the block locally, but it still needs a write ticket for the target (`?doc=<target>`) and either a second sync connection or an `/edit` call to insert there.
- **`Blok-Idempotency-Key` gives real dedup only with a journal.** The header is required (`EditEndpoint.cs:63-70`). But the duplicate lookup runs only when `session is not null`, that is, when an `ICollabOperationStore` is registered (`CollabRoom.cs:470-499`). Without one, ops are applied again with no lookup (`:505-535`). The stock host registers none (see §1.5), so safety there must come from the id-collision refusals above, not from the key.
  - **Caveat:** a re-sent `update` op has no such guard. A re-sent move that also carries updates is not idempotent without a journal.
- **Block identity is lost across docs.** Copying a block into another `Y.Doc` builds new Yjs items. A peer typing in the moved block at that moment is not carried over: their edit lands on the source copy, which is then removed.
  - Contrast with the in-doc move, which keeps the `Y.Map` "so a concurrent remote edit to a moved block merges instead of vanishing" (`document-store.ts:102-104`).
  - This is a real data-loss window. It needs either a quiesce step (lock the block) or the acceptance that concurrent typing during a cross-page move is lost.
- **One socket, one ticket and one room per open page.** The ticket must equal the doc (`SyncHandshake.cs:163`). A sidebar showing 20 pages live means 20 tickets, 20 WebSockets and 20 rooms. Showing titles only, without live sync, avoids this.
- **The page title lives in two places:** the page block in the parent, and the page document. Notion stores the title on the page block. **Assumption:** keep it on the page block only.
- Undo and history are per document. A cross-page move has two undo stacks. **UNVERIFIED** how `undo-history.ts` would group them; I did not read it.

### (C) Yjs subdocuments

**What the Yjs docs say** (<https://docs.yjs.dev/api/subdocuments>, fetched as `.md`)

- Subdocs are `Y.Doc`s set into a shared type, identified by `guid`, and "empty until they are explicitly loaded" via `subdoc.load()` (or `autoLoad: true`).
- "It is up to the providers to sync subdocuments… **all official Yjs providers currently think of sub-documents as separate entities**."
- The suggested lazy pattern is "create a provider instance to the `doc.guid`-room once a document is loaded". That is literally option B.
- Providers listen to the `subdocs` event (`added`, `removed`, `loaded`). "Not all providers support subdocuments yet."

**Ecosystem support**

- **y-websocket:** "you have to create a single WebSocket connection for each document". Multiplexing was described as a future effort (maintainer dmonad in <https://github.com/yjs/y-websocket/issues/66>).
- **Hocuspocus:** the docs say "We're currently evaluating feedback for subdocuments, but haven't implemented support yet" (<https://tiptap.dev/docs/hocuspocus/guides/multi-subdocuments.md>). Issue #583 "Subdocs" is open, filed 2023-04-20 (<https://github.com/ueberdosis/hocuspocus/issues/583>).
- Hocuspocus does let several providers share one socket (`websocketProvider` option, <https://tiptap.dev/docs/hocuspocus/provider/configuration.md>). That is multiplexing of separate documents, not subdoc sync.

**This stack**

- Client: `Y.Doc` values read as `null` (`serializer.ts:842-843`).
- Server: a subdoc exports as `{}`, and "its guid is not a value the record carries" (`YDocConverter.cs:3087-3091`).
- Wire: one room per URL (§1.4).

**Verdict for C:** it brings nothing B lacks. It adds a parent-doc dependency, and no provider here can use it.

### Which option the schema-v2 placement model makes easiest

- **Inside one doc**, schema v2 makes A trivially correct. Placements and moves are already atomic.
- **Across docs**, schema v2 makes B cheap. Each page is a self-contained v2 doc whose `root` is the page body. No new Yjs keys are needed. The server's `insert {id, parent, after}` op already speaks placements (`CollabEditOps.cs:159-165`).
- The open problems in B are cross-doc moves and connection fan-out. They are not data-model problems.

---

## 3. The ownership-line conflict: who answers "load page by id" and "save page by id"

Locked line: "The service may own what passes through it. It must not own the consumer's records." There are no `/documents/*` routes and no bundled database (`docs/plans/2026-08-22-backend-service-design.md:263-280`). Multiplayer repeats this: document listing and per-document sharing are "Dropped, not deferred" (`2026-08-31-multiplayer-design.md:56-58`).

### Variant 1: consumer-side `pages` contract (keeps the line)

It follows the existing precedents:

- `persistence.load/save` (`blok-config.d.ts:708`);
- `DatabaseAdapter` (`types/tools/database.d.ts:96-160`), which is a **write mirror**: `loadDatabase()` returns schema and views only, the rest is create/update/move/delete;
- the server's `DocEndpointClient` (GET/PUT `{endpoint}/{docId}`, `DocEndpointClient.cs:70-87`).

A precise shape, as an illustration (nothing like this exists):

```ts
pages?: {
  load(pageId: string): Promise<OutputData | PersistedDocument | null>;   // body of ONE page
  save(pageId: string, data: OutputData, ctx: SaveContext): Promise<SaveResult | void>;
  create?(p: { pageId: string; parentPageId: string | null; title: string }): Promise<void>;
  move?(p: { pageId: string; toParentPageId: string; afterId: string | null }): Promise<void>;
  remove?(p: { pageId: string }): Promise<void>;   // consumer decides soft vs hard delete
  ticket?(pageId: string): Promise<string>;        // or reuse config.ticket + ?doc=
}
```

- **Single-player:** each opened page is a nested editor with `persistence` bound to that `pageId`. This works today for one page at a time, because `persistence` already takes no id: the closure binds it.
- **Multiplayer:** each page is `collaboration.doc = pageId`. The server already seeds from and exports to `{doc-endpoint}/{pageId}`. So the **consumer's existing doc endpoint becomes the page endpoint with no server change**.
- What Blok would add: the page block tool, the open-page navigation, and a core rule that a page block's child document is never inlined into the parent's save.

### Variant 2: Blok's service stores pages (crosses the line)

- `/pages/{id}` routes plus storage in Blok's own store (the working-set store or S3).
- Workable technically: the working set is already a durable per-doc blob (`ICollabWorkingSetStore`).
- Breaks every reason in design §3: the records would not join the consumer's users, backups, search or deletion requests.
- It would reverse a decision recorded twice as "dropped, not deferred".

### Variant 3: Blok's schema inside the consumer's database (design only)

- The .NET library design has Blok own "tables with a `blok_` prefix inside the consumer's MySQL database… keyed by both document id and database-block id" (`2026-08-23-blok-dotnet-library-design.md:275-277`).
- It has a document-table mapping and soft-delete cleanup (`:318-330`), and authorization through `IBlokAuthorization` (`:305-310`).
- The records live in the consumer's database and backups, but in Blok's schema. This is neither variant 1 nor variant 2.
- It is **not implemented** (`:7`).
- `docs/plans/2026-08-22-database-block-architecture.md:3-5` was amended to point remote `queryRows` here. That conflicts with the "consumer endpoint, never Blok's service" wording that still stands at `:127-130`.
- Whether variant 3 is an accepted refinement of the locked line is a decision for the user (see the list at the end).

---

## 4. Cross-page operations

| Operation | Option A (one doc) | Option B (doc per page), variant 1 |
|---|---|---|
| Move block to another page | `moveBlockTo`, atomic (`document-store.ts:761-812`) | Copy-then-delete with preserved ids (§2B). Duplicate on failure, never loss. Concurrent typing during the move is lost unless the block is quiesced. |
| Move a whole page | Same as a block move | Re-parent the page **block** in the parent docs (two docs again: remove from the old parent, insert into the new). The page document itself does not move. The consumer's `move` updates its hierarchy record. |
| Delete page | Subtree remove. Server `remove` cascades to "everything parented to it" (`CollabEditOps.cs:40`). | Remove the page block from its parent. The page doc and its **descendant page docs** must be cascaded by whoever knows the page hierarchy. Blok's service does not know it (no listing, design §3), so it is the consumer. |
| Trash / restore | No trash concept in core. **UNVERIFIED**: I grepped no trash API. A soft "trashed" flag in page `data` fits "properties are data". | Consumer soft-delete. The .NET design already models soft-delete cleanup (`dotnet-library-design.md:318-330`). Restore = re-insert the page block. Its doc was never destroyed. |
| Duplicate page | Deep copy with new ids in one doc | Deep copy of every page doc in the subtree, minting new ids and new page doc ids, and rewriting page blocks to point at the copies. A multi-doc job: the consumer's job or a client-side walk. |
| Backlinks / `link_to_page` index | One doc, so a client scan finds references | Spans documents. Nobody in Blok can build it: the service keeps no listing (`multiplayer-design.md:56`), and the working set is keyed by a hash it cannot reverse (`CollabDocKey.cs:7-11`). Either the consumer indexes the OutputData its endpoint receives on every PUT, or a variant-3 table does. The database design names relations and rollups "need an index spanning documents, a real backend feature" (memory note `database-block-query-shape.md`). |
| Per-page permissions | **Not enforceable** (§2A) | Natural: `IBlokAuthorization(user, pageId)` per page room, plus ticket `doc = pageId`. Inheritance (child pages share the parent's ACL) is the consumer's logic inside that hook. |

---

## 5. Database rows vs page blocks

**Today**

- Rows are `database-row` child blocks of the database block (`src/tools/database/index.ts:321`), with `data.properties`, `position` and `title` (`types/tools/database.d.ts:42-50`).
- The row **body** is an `OutputData` stored as the value of the first `richText` property:
  - `descriptionProp = schema.find(p => p.type === 'richText')` (`index.ts:1091`);
  - `onDescriptionChange` writes `{[descriptionPropId]: description}` into the row block and calls the adapter's `updateRow` (`index.ts:1153-1158`).
- The drawer opens a **separate `new Blok({...toolsConfig, data: description})`** (`database-card-drawer.ts:601-614`).
  - `toolsConfig` carries only `tools`, `inlineToolbar`, `tunes` and `theme` (`src/components/modules/api/tools.ts:14-31`).
  - So the nested editor has **no `collaboration` and no `persistence`**. Its content travels as data inside the parent's row block.
- In Yjs, that body becomes nested `Y.Map`s and wrappers through `plainToYValue` (`serializer.ts:711-739`), inside the row's `data` map.
  - Whether two people editing the same row body at once merge or overwrite each other is **UNVERIFIED**. I did not trace `updateBlockData`'s nested assignment.

**Conflict with the project's own law.** CLAUDE.md rules 3 and 5 say "Opening a database row means navigating into that block's children" and "Page body IS blocks… stored as child blocks via `contentIds`". The `richText`-property body violates both.

**Convergence**

- A row is a page block whose parent happens to be a database.
- The body should become the row's child blocks:
  - (A) in the same doc via `contentIds`; or
  - (B) in its own page doc, with `pageId` equal to the row id.
- With B, the drawer's nested editor gets `collaboration.doc = rowId` (or `persistence` bound to the row id). That is the same code path as opening any page.
- Row **properties** stay in `data.properties` (CLAUDE.md rule 4).
- This also fits the .NET design's "externally persisted child" lever. Rows queried by `queryRows` are partial materializations. Page bodies are the same idea one level down.
- Migration from the old format is needed: today's `properties[richTextId]` holds `OutputData`. That is a change to saved JSON shape, so it counts as **BREAKING** per CLAUDE.md, unless it stays readable. The release check (`git tag` versus `git log`) was not run.

---

## 6. What a page block's saved data could look like

**Option A (subtree):** the existing format, unchanged.

```json
{ "id": "p1", "type": "page", "data": { "title": "Roadmap", "icon": "🗺" }, "content": ["b1","b2"] },
{ "id": "b1", "type": "paragraph", "data": { "text": "…" }, "parent": "p1" }
```

**Option B (separate doc):** a leaf in the parent document. `content` must stay absent (§2: listed-but-unloaded children are erased on save and render).

```json
{ "id": "p1", "type": "page", "data": { "title": "Roadmap", "icon": "🗺" } }
```

- The child doc id is `p1` itself, or an explicit `data.pageId` if ids must differ (for example after a duplicate).
- The page doc is a normal `OutputData` whose top-level blocks have no `parent`. Its root is the page.
- Keeping the title on the block in the parent lets a sidebar or breadcrumb render without opening the child doc.

**Validation rules that matter**

- Ids must be unique **per doc** (`YDocConverter.cs:579-583`). Across docs, uniqueness is the consumer's concern. It matters when moving with preserved ids.
- `parent` and `content` are hierarchy fields in the public type (`output-data.d.ts:78, 86`). Reusing them to point across documents would be misread as dangling (`saver.ts:245-274`), so a cross-doc reference belongs in `data`.

---

## 7. Recommendation (for discussion; nothing here is decided)

1. **Granularity B is recommended.**
   - Every page-level concern (room, store key, consumer endpoint, ticket, authorization) is already per document.
   - The page block is a leaf with the page id in `data`.
   - Per-page permissions come free through `IBlokAuthorization`.
   - On ownership, variant 1 is the only one consistent with the line **as currently locked**. Choosing between variants 1, 2 and 3 stays with the user (decision 2).
2. **Skip C.** No provider in this stack, or in Hocuspocus or y-websocket, syncs subdocs as such (§2C).
3. **Use A only for small, single-permission trees.** Its only real advantage is atomic cross-page moves, and it cannot hide one page from a reader.
4. **Build the core lever first**, before any page tool: "externally persisted child". A page block's child document is never inlined into the parent's save or `fromJSON`. The .NET database design needs the same lever, so doing it once serves both features.
5. **Cross-page move = copy-then-delete with preserved ids.** It relies on the server's all-or-nothing edit requests and id-collision refusals. Duplicate on failure, never loss. The concurrent-typing loss window and the no-journal case must be documented.
6. **Move the row body to the page model**, so rows and pages converge. The drawer's nested editor is already the "page editor".

## DECISIONS THE USER MUST MAKE

1. **Granularity:** A (one doc per tree), B (one doc per page), or a hybrid (for example B for top-level pages, A inside a page).
2. **Ownership:** whether page storage is (1) a consumer `pages` contract, (2) Blok's service, which would reverse a "dropped, not deferred" decision, or (3) the `blok_`-tables-in-the-consumer's-DB design. Related: is variant 3 an accepted refinement of the locked line? The two database docs currently disagree (`database-block-architecture.md:3-5` vs `:127-130`).
3. **Cross-page move semantics:** accept a duplicate-on-failure window? Accept losing concurrent typing in the moved block, or require a lock or quiesce step?
4. **Journal:** the stock host journals nothing (`Program.cs:84-96`). Should it ship an `ICollabOperationStore` so `Blok-Idempotency-Key` actually dedups (`CollabRoom.cs:470-535`)? It is needed for safe retries of `update` ops in multi-doc operations.
5. **Page id:** reuse the page block's id as the child doc id, or use a separate `data.pageId` (simpler duplication and retargeting)?
6. **Delete:** hard cascade or trash. Who cascades descendant page docs (the consumer, by design)? And the restore semantics.
7. **Backlinks and `link_to_page` index:** who builds it — the consumer, from PUT payloads, or a variant-3 table? Or is it out of scope?
8. **Permissions inheritance:** a consumer concern inside `IBlokAuthorization` (recommended by the line), or a Blok-level ACL field on page blocks?
9. **Row body migration:** move `properties[richText] = OutputData` to child blocks or a page doc. Decide on BREAKING versus a read-compatible migration, and check the release tag first.
10. **Live sidebar cost:** do non-open pages sync live (one socket and ticket each, `SyncHandshake.cs:163`), or show static titles from the parent doc?

## Sources (web)

- Yjs subdocuments: <https://docs.yjs.dev/api/subdocuments> (read via `.md`)
- y-websocket, one connection per document: <https://github.com/yjs/y-websocket/issues/66>
- Hocuspocus subdocs not implemented: <https://tiptap.dev/docs/hocuspocus/guides/multi-subdocuments>; open issue <https://github.com/ueberdosis/hocuspocus/issues/583>
- Hocuspocus shared socket: <https://tiptap.dev/docs/hocuspocus/provider/configuration>
