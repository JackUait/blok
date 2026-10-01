# Page block, Notion-style — research and recommendation

Date: 2026-10-01. Status: research only. Nothing is built.

The six source reports are in `docs/plans/2026-10-01-page-block-research/`:

| # | Report | Scope |
|---|---|---|
| 1 | `1-notion-ux.md` | What Notion users see and do with page blocks |
| 2 | `2-notion-backend.md` | Notion's record shape, loading, transactions, storage, trash |
| 3 | `3-blok-core-frontend.md` | Blok core: tree, mounting, undo, drag, saver, view |
| 4 | `4-blok-backend-collab.md` | Blok persistence, Yjs schema v2, the C# server |
| 5 | `5-prior-art.md` | AFFiNE, AppFlowy, Outline, Docmost, Yjs subdocs |
| 6 | `6-public-surface.md` | Config, API, adapters, view renderer, saved data |

Every claim in those reports has a `file:line`, a URL, or a label (unverified / inference / reverse-engineered).

---

## 1. The answer in one paragraph

Make each page its own document. The page block in the parent is a small block with `type: 'page'`. It names the page by id. It shows the page's icon and title, and it opens the page. The page's body is ordinary blocks in the page's own document. The host loads and saves that document by page id, the same way it loads and saves one document today. Blok never stores pages (the ownership line holds). Navigation belongs to the host, through a new `pages` config with `href` and `open`.

This is what every open-source peer does (section 3). Notion itself keeps one store and lazy-loads from it, which a library cannot copy (section 2). The one rule that it bends is our own "a page is a block with children" law. That is decision D1 below, and it is yours to make.

---

## 2. What Notion actually does

- **A page is a block.** It is the same record as a paragraph, with `type: 'page'`. "Turn into" changes only `type`. The title is the block's text (`properties.title`). Icon, cover and full width live in `format`. (report 2 §1, report 1 §1)
- **Two trees.** `content[]` decides what renders where. `parent_id` is used only for permissions. A link-to-page or a page mention points at a page without owning it. (report 2 §2)
- **One store, lazy loading.** Every block of a workspace sits in one Postgres table, sharded by workspace (480 logical shards). A page loads in chunks (`loadPageChunk`). A parent shows its sub-page as a single record (title, icon), not its body. (report 2 §3, §5; chunking is reverse-engineered)
- **Moves are one transaction.** Moving a block to another page is one transaction of list operations (`listRemove` + `set parent` + `listAfter`). This works because both pages live in one database shard. (report 2 §4, reverse-engineered)
- **Delete is soft.** `alive=false`, kept in Trash for 30 days. Deleting a page takes its sub-pages with it. (report 1 §5, report 2 §8)
- **A database row is a page.** It differs only in its parent and its properties. (report 1 §7)
- **Keyboard.** Enter or Cmd/Ctrl+Enter opens a selected page block. Backspace deletes it. Cmd/Ctrl+Opt+9 turns a line into a page. (report 1 §8)

Blok cannot copy "one store, one transaction". Blok is a library. The store is the consumer's database, and each Yjs room is one document. So the Notion behaviour has to be rebuilt on documents, the way every open-source peer does it.

## 3. What the open-source peers do

All of them use **one CRDT document per page** plus a separate tree. The page block, where one exists, is a pointer (`{pageId}` / `{view_id}`), never the body. (report 5 §1-3)

- AFFiNE tried Yjs subdocuments. All pages loaded at once, and changing a doc id lost data (AFFiNE#4912). It now uses a standalone `Y.Doc` per page and loads it on demand.
- AppFlowy has a `sub_page {view_id}` block. One handler keeps the block and the page tree in sync. Delete goes to trash and undo restores it.
- Outline keeps the tree in SQL (`parentDocumentId`) with a cycle check, and one Y.Doc per document.
- None of them moves blocks between two CRDT docs atomically. AppFlowy's "turn into page" creates the new page, waits for success, then deletes the source.
- Yjs subdocuments are not supported by y-websocket, y-indexeddb or Hocuspocus (issue #583 still open). Removing a subdoc from its parent destroys it (yjs `Transaction.js`). (report 5 §4, §6)

## 4. What Blok has today

Verified in this session:

- **One editor = one document.** One `Y.Doc`, one sync room `/sync/{doc}`, one ticket per doc. The ticket must name the doc (`packages/server/dotnet/Blok.Server.AspNetCore/Collab/SyncHandshake.cs:163-166`). Read and write access is checked per document (`:199-208`). There is no per-block read filter, so **one document cannot hide one page from a reader**.
- **Unloaded children are erased.** The Saver builds each parent's `content` only from blocks in memory (`src/components/modules/saver.ts:286-308`, used at `:321`). `fromJSON` deletes every map key not in the render (`src/components/modules/yjs/document-store.ts:213-217`). So a page block cannot list children that are not loaded.
- **The database drawer is a nested editor with the wrong storage.** It opens a row in a second `new Blok()` (`src/tools/database/database-card-drawer.ts:601-627`). It stores the row body as an `OutputData` blob in a `richText` property (`src/tools/database/index.ts:1091-1157`). That breaks law #5 ("Page body IS blocks"), and it contradicts our own schema text: "Rich page content lives in this block's children" (`src/view/document-schema.ts:326`). The blob shape shipped in v1.15.2 (`7f372a16` is an ancestor of `v1.15.2`).
- **Notion paste turns a sub-page into a bookmark** to notion.so (`src/components/modules/paste/notion-blocks-v3.ts:347-351`).
- **The view renderer would leak a page body.** An unknown block type still renders its children (`src/view/blocks-to-html.ts:379-384`).
- **There is no page icon.** `IconFile` / `IconFileDoc` exist (`src/components/icons/index.ts:1098, 1116`) but the File block uses them.

From the reports, not re-checked here:

- There is no navigation hook. A plain link to another path always opens a new tab (`ui.ts:1461`, report 6 §1).
- Undo is one `Y.UndoManager` over the whole doc (`yjs/undo-history.ts:381-389`, report 3 §3).
- Select-all selects every block in the store (`blockSelection.ts:172-177`, report 3 §3).
- Copy already carries a block's subtree, and paste remaps ids (`blockSelection.ts:793-818`, `blok-data-handler.ts:228-255`, report 3 §3).
- In production the server keeps no operation journal (`Program.cs:84-96` is behind `#if BLOK_SERVER_CONFORMANCE`, which I confirmed exists). So `Blok-Idempotency-Key` does not deduplicate anything (report 4 §2B).

## 5. The three storage models

| | A. One tree, one doc | B. One doc per page (recommended) | C. Yjs subdocs |
|---|---|---|---|
| Matches law #3 literally | yes | no, needs the reading in D1 | no |
| Lazy load | no, loads the whole workspace | yes | in theory |
| Hide one page from a reader | **impossible** (auth is per doc) | yes, `IBlokAuthorization(user, pageId)` | — |
| Move a block across pages | atomic, already works (`moveBlockTo`) | copy, then delete, with the same ids; failure leaves a duplicate, never a loss | subdoc removal destroys it |
| Undo | one stack for every page | one stack per page | — |
| Core work | large: a "detached children" mount mode plus scoping for select-all, arrows, find, link list and undo (report 3 §7) | small: a leaf block, a host contract, view and paste | no provider supports it |
| Server work | none, but the whole workspace is in one room | none: room, ticket, store key and doc endpoint are already per doc | not possible here |

**C is out.** No provider in this stack syncs subdocs, and AFFiNE moved away from them.

**A is out for Notion parity** because of two must-haves: per-page sharing and lazy loading. A stays possible later for small single-owner trees. The route is the core "detached children" setting in report 3 §7 (items 1-12). Do not build it in v1.

**B fits what already exists.** Every per-document thing (room, ticket, auth check, consumer endpoint, `persistence`) already works per page. The open problems are cross-page operations, not the data model.

## 6. Recommended design (model B)

### 6.1 Saved data

The page block in the parent document is a leaf. It has no `content`:

```json
{ "id": "b7", "type": "page", "data": { "pageId": "p1", "title": "Roadmap", "icon": { "type": "emoji", "value": "🗺" } } }
```

- Lean: an explicit `data.pageId`. One page id names the room, the ticket and the consumer's record. **D9.**
  - Why not reuse the block id: paste inserts every block with a new id (`src/components/modules/paste/handlers/blok-data-handler.ts:239-244`, `BlockManager.insert` with no id). A pasted pointer would then name no page.
  - `data.pageId` survives paste, undo and duplicate unchanged. Paste must still not create a second owner (§6.4).
- The page's own document is a normal `OutputData`. Its top-level blocks are the page body. Its root is the page.
- `OutputData` has no "this document is page X" field and no place for the page's own title (`types/data-formats/output-data.d.ts:109-124`, report 6 §0). Where the canonical title lives is **D2**.
- `title` is a top-level plain-text key. It is already merged per character on the client (`serializer.ts:36`) and on the server (`YDocConverter.cs:97`) (report 6 §6).
- Icon is a union (emoji or image). A cover (`coverUrl`, following audio's precedent) can wait. Note: a cover outside `data.url` is not visible to asset discovery (report 6 §6).

### 6.2 Host contract (consumer-side; the ownership line holds)

```ts
pages?: {
  href(pageId: string): string;                       // required: links, view output, middle-click
  open?(pageId: string, ctx: { mode: 'full' | 'peek'; source: 'block' | 'mention'; event?: MouseEvent }): void;
  resolve?(pageId: string): PageInfo | Promise<PageInfo | null> | null | undefined; // fresh title/icon
  create?(init: { parentId: string; blocks: OutputBlockData[] }): Promise<{ id: string }>; // /page, turn-into
  insert?(pageId: string, blocks: OutputBlockData[]): Promise<void>;                           // drop onto an existing page
}
```

- If `open` is set, the host handles every page click. If not, Blok follows `href`.
- `create` and `insert` exist because "turn into page" and "drop onto page" write into a document Blok does not hold.
- Without `create`, the `/page` toolbox entry and "Turn into page" are hidden. Without `insert`, a page block is not a drop target.
- The page body loads through the existing `persistence` / collab config of the editor the host mounts for that page. No new load API is needed for v1.
- The shape follows `persistence`, `resolveUser` and `onImageFailure` (report 6 §3, candidate 1).

### 6.3 Behaviour

| Action | v1 behaviour |
|---|---|
| `/page`, toolbox | Call `pages.create`, insert the page block, then `open` it. |
| Click / Enter / Cmd+Enter on the block | `pages.open(id)`, else go to `href`. |
| Turn into page | `create` the page with the block's children, wait for success, then replace the block with a page block. Never delete first (report 5, "patterns to avoid"). |
| Drag a block onto a page block | `pages.insert` into the target with the same ids, confirm, then remove from the source. |
| Delete the page block | Delete the pointer only. Undo restores it. The host decides when the page document goes to trash or is purged. |
| Copy / paste the page block | Must not create a second owner. Paste becomes a link-to-page, or the host duplicates the page. **D6.** |
| Find (Cmd+F) | Searches the open page only. That is automatic under B. |
| `/view` output | A built-in `page` emitter renders a link card using `pages.href`. It never renders children. |
| Notion paste | Map `page` / `link_to_page` to the page tool when `pages` is configured. Otherwise keep the bookmark. |

### 6.4 Hazards model B creates

- **Aliases.** Two owning pointers to one page make "delete" ambiguous. Paste and duplicate must never make a second owner.
- **Cross-document moves are not atomic.** Copy first, delete second. A failure in between leaves a duplicate, never a loss. A peer typing in the moved block during the move loses that typing. With no journal, a retried `update` is not safe (report 4 §2B).
- **Dangling pointers.** If the target page is missing, show a "page not found" state. Never auto-delete the pointer: AppFlowy does, and a client whose page tree hasn't synced yet could wrongly delete it (report 5 §7, inference).
- **Stale title.** The parent's copy of `title` goes stale after a rename inside the page until `resolve` or live sync refreshes it. **D2.**
- **Connection fan-out.** One socket, ticket and room per page that is open live. A sidebar should show static titles, not live sync (report 4 §2B).

### 6.5 Database rows converge on the same model

Under B, the drawer's nested editor is the right mechanism. Only its storage is wrong. The row becomes a page: its body is a page document with id = row id. The drawer then mounts that document with collab config, which it lacks today (`api/tools.ts:14-31`, report 3 §1.6).

**BREAKING:** the `richText` `OutputData` row body shipped in v1.15.2. Moving it needs either a read-compatible migration (read the old blob, write a page document, stop writing the blob) or a BREAKING label with a migration step. **D7.**

## 7. Decisions for you

1. **D1, the law.** B reads "a page is a block with children" as "a page's body is blocks, living in the page's own document, whose root is the page." Accept that reading and update CLAUDE.md, or keep the literal law and choose A (no per-page sharing, no lazy load).
2. **D2, where the title lives.** Lean: the page's own document is canonical and the pointer holds a cached copy (AppFlowy and AFFiNE do this; moving a page then moves only the pointer). That needs a home in the page document, which `OutputData` lacks today. Two ways:
   - a new additive top-level field, e.g. `OutputData.page = { id, title, icon }` (lean: one id in one document);
   - a single root `page` block inside the page document whose children are the body (report 6 option 2: the same page described in two documents, synced by someone).

   The alternative to the lean is Notion's single record: the title lives only on the pointer, and the page view must open the parent document to edit its own title.
3. **D3, ownership.** Lean: consumer-side `pages` contract (variant 1), which keeps the locked line. Alternatives: Blok's service stores pages (reverses a "dropped, not deferred" decision), or `blok_` tables in the consumer's database (design only). Note: the two database docs disagree on who answers `queryRows` (`database-block-architecture.md:3-5` vs `:127-130`).
4. **D4, navigation.** Host routing only in v1 (`open` / `href`), with side and center peek later. Or an in-editor peek from day one, which reuses the drawer.
5. **D5, cross-page moves.** Accept "duplicate on failure" and "concurrent typing in the moved block is lost"? Or require a lock? Ship an `ICollabOperationStore` journal so retries are safe?
6. **D6, copy and paste of a page block.** Paste as a link-to-page, or ask the host to duplicate (deep copy with new ids)?
7. **D7, row bodies.** Read-compatible migration or a BREAKING change.
8. **D8, scope of v1.** Proposed v1: page tool, `pages` contract, open / turn-into / delete / view / paste. Later: cover, peek, link-to-page and mentions, backlinks (host index), trash UI, permissions UI.
9. **D9, page id.** Lean: `data.pageId`, because paste mints new block ids (§6.1). The alternative, page id = block id, requires every copy, paste, duplicate and undo path to keep ids unchanged.

## 8. Build order (once D1-D3 are decided)

1. **Page tool and contract.** `page` block tool (render, save, `validate`, sanitize), `pages` config typed in `types/`, `api.pages.open` merged onto `Blok`. Click and keyboard handling. Dangling state.
2. **Link handling in core.** A `UI.redactorClicked` hook so page links never fall through to `openTab` (`ui.ts:1461`, report 6 §1).
3. **View.** `page` emitter, `blockId` on `ViewRenderContext` / `ViewUrlContext`, and a `pages.href` option. Apply the same "stop at page" rule to plain text, outline, `extractTexts` and markdown.
4. **Turn into page and drop onto page** through `pages.create` (create, confirm, then delete).
5. **Notion paste** mapping.
6. **Adapters.** React and Vue `pages` prop (Vue takes return-valued callbacks as props, not emits). Angular: `@Input()` or `config`. Parity tests.
7. **Database rows** move to page documents (D7).
8. **Server (optional).** Journal for safe retries (D5). A cross-doc move helper on `/sync/{doc}/edit`.

### Obligations that apply to every step

- TDD: failing test first.
- **i18n:** the new-key checklist has 7 layers (memory `i18n-new-key-checklist`), across all locales.
- **Toolbox:** every entry needs a `preview` and a caption key (memory `toolbox-hover-previews-shipped`).
- **Icons:** look for a reusable icon in `src/components/icons/index.ts` first. If a new one is drawn, add it to `iconGroups` in `index.html` and run `node scripts/generate-icons-dts.mjs`.
- **Published types:** hand-author `types/tools/page.d.ts` and the `pages` config. No `../src` imports.
- **Data attributes:** after adding one, run `node scripts/generate-data-attributes-dts.mjs`.
- **Selected state:** a selected page block is gray, never blue.
- **BREAKING:** `'page'`, every `PageData` key, the `pages` member names and the `open` rule are new surfaces. They are not breaking on first release, but they are permanent after it. Row-body migration (D7) is breaking.

## 9. What is still unverified

- Notion: how a page block looks inline, cut/copy/paste of a page block, whether duplicate deep-copies sub-pages, whether undo restores a deleted page (report 1). These can be checked in a real Notion session with `playwright-cli`, which would create pages in the account.
- Notion: real `loadPageChunk` sizes, and whether the server stops a chunk at sub-page boundaries (report 2 §3).
- Blok: the `onChange` event payload (report 3). Whether the link-click path runs in read-only mode, and whether `legacy` data mode can serialize a page (report 6).
- Prior art: whether AFFiNE and AppFlowy keep block ids across a cross-page move (report 5 §10).
