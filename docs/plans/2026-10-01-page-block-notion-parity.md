# Page block: closing the gap to Notion without storing data

Date: 2026-10-01. Status: research only. Nothing is built.

Builds on `2026-10-01-page-block-research.md` (one document per page, the page block is a pointer). That doc listed what a user would see differently from Notion. This one answers: how close can we get to each item without Blok hosting or owning anyone's records?

Source reports, all in `2026-10-01-page-block-notion-parity/`:

| # | Report | Scope |
|---|---|---|
| 1 | `1-move-undo.md` | Moving blocks between pages, one-step undo, atomicity |
| 2 | `2-live-meta.md` | Live titles, breadcrumbs, sidebar |
| 3 | `3-open-cache-offline.md` | Open speed, browser cache, offline |
| 4 | `4-workspace-features.md` | Search, backlinks, trash, Move to, duplicate, export, mentions |
| 5 | `5-notion-edge-behaviours.md` | Notion behaviours the first pass left unverified |
| 6 | `6-principles-rows-perms.md` | Principles register, verdict per mechanism, database rows, permissions |

The web search quota ran out during this pass. Claims about what Notion *shows* that the reports could not source are labelled unverified there.

---

## 1. The rule every mechanism below follows

From report 6 (all cited there):

- Blok hosts nothing. The C# server is a sidecar the consumer runs.
- The sidecar may hold what passes through it: rooms in memory, a working-set blob per doc, a journal only through a store the consumer plugs in. It must not own the consumer's records. No `/documents/*` routes, no document database.
- Data on the end user's own device (IndexedDB) is not "us storing data". It must be opt-in and scoped per user. That is already true of today's offline cache.
- Derived data follows the `ICollabActivityObserver` precedent: "Blok stores none of this… reports and forgets".
- Presets ship no SQL as package code; a SQL recipe can live in docs.

Every mechanism below is "allowed" or "allowed with conditions" under these rules (report 6 §2). None needs Blok to store a page.

---

## 2. Gap by gap

### 2.1 Moving a block to another page (Move to, drag onto a page, Turn into page)

**Notion:** "Move to" works on ordinary blocks, not only pages (report 5 §8, primary). It is one database transaction.

**Mechanism (report 1):** a three-phase move where the intent record is the moving block itself, a `move` marker in the source document.
1. **Claim.** Mark the block in the source room. This is a compare-and-set inside the room's single lane (`CollabRoom.cs:79-82, :157`). Two people moving the same block at once get one winner.
2. **Copy.** Insert into the target with the same ids, through `/sync/{target}/edit`. Large subtrees go in parent-first chunks because of the edit body cap.
3. **Commit.** Hide the block in the source.

**What the user sees:** the mover's block disappears at once, and a "Moved to …" toast with Undo appears. The move is queued in the user's IndexedDB only when `collaboration.offline` is on (the opt-in rule from §1); otherwise the queue is in memory. Other viewers see a read-only ghost until it commits.

**Typing during a move:** the marker is the freeze signal, so clients flush buffered typing when they see it. The hidden source copy stays alive for a while. Late edits forward to the target through a new 3-way `patch` op built on the existing `TextDiff.cs`.

**Principles:** the marker is document data, so no new store is needed.

**Conditions that must hold first:**
- **Proof the copy was saved.** On the stock host, `/edit` answers 204 even if its save failed (`CollabRoom.cs:503-535`). The source may commit only after a journal receipt or a new "persisted" signal.
- **A block coming back must be revived, not re-inserted.** The hidden copy keeps its id, so a plain re-insert is refused as "already has a block".
- **Old clients must not show the hidden copy as a duplicate.** A block that no order lists is still drawn at the end of the page (`document-store.ts:494-529`, `YDocConverter.cs:2737-2770`). The read rule has to change on client and server, behind a per-room version gate.

**Strict atomicity** is real only in single-player mode, through an opt-in host callback `pages.transfer`. In collab mode an optional consumer batch endpoint makes only the consumer's copy atomic, not the live rooms.

**Cycles:** Blok catches a move into the moved block's own sub-page only when that page is inside the moved subtree. Deeper cycles need the host's page tree, through `pages.canMove`.

**Remaining difference:** a ghost on other viewers' screens for the move's round trip. That is not proven to differ from Notion: what Notion shows is unverified.

### 2.2 Undo after a cross-page move

**Notion:** undo scope across pages is unverified (report 5 §9). A deleted page gets a toast with an Undo button (report 5 §4, primary).

**Mechanism (report 1 §4):** a third undo timeline, `kind: 'transfer'`, next to the existing `'move'` and `'edit'` (`yjs/types.ts:103-112`). Undo brings the block back in the source at once and fixes the target in the background, so `undo()` stays synchronous.

**Remaining difference:** Ctrl+Z in the *target* page does nothing for the move, because the copy arrived there as a remote change. The toast's Undo covers the common case.

### 2.3 Titles everywhere, live

**Notion:** renaming a page updates every link to it and every @-mention (report 5 §7, primary). How fast that reaches breadcrumbs and the sidebar for collaborators is not stated.

**Mechanism (report 2), four layers:**
1. **Title home:** the page's own document holds the real title (decision D2 in the first doc). Caveat: the sidecar's converter exports only `time` and `blocks` (`CollabDocConverter.cs:38-46`, checked), so a new doc-level field such as `OutputData.page` would be dropped on every collab export. D2's lean needs the matching server change.
2. **Same window:** the page editor emits an event. The sidebar, breadcrumbs and other open editors in the tab update instantly, with no network. This fully covers a user renaming their own page.
3. **Other users:** a titles-only subscription on the sidecar. It adds 2-3 new frame types, which older peers ignore. The server keeps the subscriber list in memory and relays changes from open rooms. Each subscription carries its own ticket and passes `IBlokAuthorization.CanReadDocumentAsync`, so it leaks no title.
4. **Saved copy in the parent:** the consumer repairs the parent's pointer through `/sync/{parent}/edit`, driven by the save it already receives. `update` replaces the block's whole `data` (`CollabEditOps.cs:37`, checked), so this is safe only while the pointer's `data` is exactly `{pageId, cache}` and `pageId` never changes. Otherwise use the `patch` op from report 1. A parent that opens also refreshes its pointers from `pages.resolve`.

**Correction to the first doc:** the pointer's copy must **not** use the top-level `title` key. That key merges per character on client and server (`serializer.ts:36`, `YDocConverter.cs:97`). Two clients refreshing the same copy could double the text. This is inferred from how Yjs text works, not tested. Use a plain value instead, e.g. `data.cache = { title, icon }`.

**Remaining differences:**
- **Several servers:** under scale-out, a sidebar socket and the page's room usually sit on different servers. Live titles across them need a pass-through relay the operator plugs in (`ICollabMetaRelay`).
- **Late saved copy:** the parent's saved copy lags by the server's save debounce (2-10 s).
- **Title leak:** a cached title is visible to everyone who can read the parent, so a hidden page's title leaks. Notion shows "No access" instead. Fix: no cached title for restricted pages (ties to D2).

### 2.4 Breadcrumbs and sidebar

**Notion:** a live tree of pages.

**Mechanism (report 2 §3-4):**
- **Breadcrumbs:** the ancestor chain comes from the consumer's records (`pages.ancestors`, or `resolve` returning `parentId`), as in every open-source peer. Storing `parentId` inside a page document would mean one document open per level, plus a third write on every move.
- **Sidebar:** Blok can ship a headless `createPageTree(source)` in `@bloklabs/core/adapters`, wrapped by React, Vue and Angular like `useBlocks`. It loads lazily and subscribes to titles only for visible nodes. The structure always comes from the consumer; Blok never lists pages.

**Remaining difference:** none beyond 2.3.

### 2.5 Opening a page fast

**Notion:** a browser cache (WASM SQLite) and an offline mode. Offline mode does **not** auto-download sub-pages: "Subpages of any downloaded pages won't automatically download for offline use", databases get their first 50 rows, and it works in the desktop and mobile apps only (report 5 §11, primary).

**What exists (report 3):**
- `collaboration.offline` + `offlineScope` already keeps one IndexedDB database per server, document and user (`operation-store.ts:406`). With one document per page, every page gets its own cache for free.
- A cached page opens editable before any network call. The cache is replayed first, then the socket connects (`collaboration/index.ts:803-848`).
- The project decided against `y-indexeddb` on purpose.

**What to add, in order:**
1. **Measure first.** There is no open-page benchmark in the repo. Cold and warm room, cold and warm cache.
2. **Page shell.** Draw the title and icon from the pointer at once, before the body loads.
3. **Earlier ticket fetch.** Today the ticket is renewed only when someone asks for it within 30 s of expiry. There is no timer (`access-pass.ts:5, 137`, checked). The `ticket` config takes only a string, so warming one on hover needs a new option. The published docs say the pass is replaced "ahead of expiry" (`blok-config.d.ts:647`); that wording should say "on demand, with a 30 s margin".
4. **Cache management API.** The cache has no eviction, no size cap, no `storage.persist()`, no way to forget a user's copies on logout, and no list of offline pages.
5. **Background sync.** Today prefetching a page body costs a full hidden editor.
6. **One socket for several pages, last.** Frames carry no doc id (`blok-sync-v2.md` §3), so this would be a new protocol version.

**Do not reuse one editor across pages.** Under collab, `doc` is fixed and `blocks.render` is refused (`api/blocks.ts:256-272`). Under persistence, a swap would send page B to page A's save. Destroy and create.

**Remaining difference:** pages never opened are not available offline unless a background sync is built. Notion has the same limit for sub-pages.

### 2.6 Workspace features: search, backlinks, trash, Move to, duplicate, export, mentions

**Notion:** all built in.

**Mechanism (report 4):** Blok derives, the consumer stores.

- **A new pure `pageIndex(data)` in `@bloklabs/core/view`.** It returns `{ page | null, subPages[], links[], blocks[{id, type, text}], text }`. The consumer's save endpoint calls it, which covers both persistence and collab mode. A client cannot forge backlinks this way. It is reachable from .NET through the server's JS runtime.
  - Not on the server's PUT payload: changing that body would break every existing endpoint.
  - Two consumer tables are enough: `page_index` and `page_edge`.
  - The index must skip blocks that carry a committed `move` marker (§2.1). Otherwise the hidden source copy of a moved pointer makes two parents claim one child, and trash and backlinks go wrong.
- **What each feature becomes:**

| Feature | Blok | Host |
|---|---|---|
| Search | `text` + `blocks` in the index | full-text query, `pages.search` |
| Backlinks | `links` in the index | reverse lookup on `page_edge` |
| Trash | nothing new | a page whose pointer vanished from every parent is trashed after a grace period; undo puts the pointer back. Host owns the 30-day purge |
| Link to a block on another page | Copy link already builds `#blockId` (`block-tune-copy-link.ts:81-82`) | `href` resolves the page |
| Move to | the move of 2.1 | `pages.search` for the picker |
| Duplicate page with sub-pages | make the private `remapIds` public | `pages.duplicate` |
| Export with sub-pages | page emitters, an options argument for `blocksToMarkdown` | fetches the sub-pages |
| Link to page | a separate `page-link` block, so delete and duplicate never act on the target | — |
| @page mention | the biggest item: there is no `@` or `[[` trigger anywhere, only `/` (`blockEvents/index.ts:255`) | `pages.search` |

- **Saved HTML must carry ids.** Inline page links need something like `<a data-blok-page data-blok-block>` in the saved HTML. The link tool keeps only `href`, `target` and `rel` today (`inline-tool-link.ts:116-124`). Whitelisting the new attributes falls under the paste attribute law.
- **Page picker.** The popover search only filters a fixed list synchronously (`popover-desktop.ts:2028-2066`). Every page picker needs an async item source first. The cheapest picker is a "Pages" section in the link field, fed by `pages.search`.
- **Supabase recipe.** Tables, per-page RLS and one save function, as docs, not package code. Importing `pageIndex` into presets would break their zero-dependency rule, so the consumer passes it in.
- **No headless components** for backlinks, picker or trash list. Each would cost three adapters plus parity tests.

**Remaining difference:** the host has to build these screens. Blok provides the data and the pickers inside the editor.

### 2.7 Permissions

**Notion:** sub-pages inherit the parent's permissions and can be widened or narrowed. A page you cannot open shows "No access" with a request option (report 5 §12, primary).

**Mechanism (report 6 §5):**
- `IBlokAuthorization` (`IBlokAuthorization.cs:20-54`) takes a user and a document id. Changing its members is breaking, so inheritance stays the consumer's logic inside that hook.
- **"No access" pointer state:** possible. A 4403 close already reaches the host as the `'forbidden'` status.
- **Inheritance recipe:** in docs, or an optional .NET helper. Not in presets, which run in the browser.
- **Never trust a client-sent parent page id** in the auth hook. The consumer's page tree is the only safe source.

**Remaining differences:**
- **Title leak:** see 2.3.
- **Revocation:** access is checked only at connect, and there is no way to disconnect members. A permission change on a parent does not reach child rooms already open until they reconnect.

### 2.8 Database rows as pages

**Notion:** a row is a page.

**Mechanism (report 6 §4), no BREAKING step:**
- **Phase 0:** the row tool keeps unknown keys and gains an optional `pageId`. This must ship in a release before any client writes the key. Today the row tool saves only `properties`, `position` and `title` (`src/tools/database-row/index.ts`, `snapshot()`, checked), so an older client would erase `pageId`.
- **Phase 1:** opt in through the database tool's config.
  - Migrate a row on its first body edit, never on load: create the page, wait for success, then set `pageId`.
  - Keep the old blob as it is.
- **Phase 2:** the card opens the page document through the host.
- **`DatabaseAdapter`:** gains only optional fields. Making the new shape the default, or removing the blob, would be BREAKING.

The blob shape shipped in v1.15.2, but `richText` is not in the default schema, the property menu or the docs. So few consumers depend on it.

---

## 3. Problems found along the way (not page-specific)

1. **Card body text is thrown away with the default schema.** I found this by reading the code; it has not been reproduced. The card always mounts a body editor (`database-card-drawer.ts:204`). It saves the body only when the schema has a `richText` property (`index.ts:1091, 1154-1157`), and the default schema has none (grep: `richText` appears only in `types.ts:5` and the drawer filter). Text typed into a card body is lost. A failing test must confirm it first.
2. **The sidecar's working set has no delete.** `ICollabWorkingSetStore` offers `ReadAsync`, `WriteAsync` and `ResetAsync`: "There is no bare delete" (`ICollabWorkingSetStore.cs:49-70`, checked). Report 6 found no route a consumer can call to purge a deleted document's working set. Content can then stay on the sidecar's disk or S3 after the consumer deletes the record. That breaks the ownership line's own "deletable on request" reason.
3. **Ticket docs promise more than the code does.** See 2.5, item 3.
4. **The row tool drops unknown keys.** See 2.8, phase 0.
5. **The principle docs contradict each other in seven places.** Report 6 §1 lists them. The two that block page work:
   - Who answers `queryRows`: `database-block-architecture.md:3-5` vs `:127-130`.
   - Whether `blok_` tables inside the consumer's database are inside the ownership line.

## 4. What stays different from Notion

| Difference | Why | Size |
|---|---|---|
| Ctrl+Z in the target page does not undo an incoming move | the copy arrives as a remote change | small: the toast Undo covers it |
| Live titles across several servers need an operator-supplied relay | scale-out puts rooms on different servers | small for single-server installs |
| Parent's saved title lags 2-10 s | save debounce | invisible in the UI if layers 2-3 of 2.3 are built |
| Permission changes reach open pages only on reconnect | auth is checked at connect | medium |
| Workspace screens (search, backlinks, trash) are the host's | ownership line | by design |
| Pages never opened are not offline | no background sync yet | Notion has the same limit for sub-pages |

## 5. Suggested order

1. **Fix first, independent of pages:** the card body loss (3.1), working-set delete (3.2), the ticket wording (3.3), and row-tool unknown keys (2.8 phase 0). Each needs a failing test first.
2. **Page tool v1** from the first doc, with `data.cache` instead of a mergeable `title` on the pointer (2.3).
3. **Same-window title events and page shell** (2.3 layer 2, 2.5 item 2): the biggest perceived win for the least code.
4. **`pageIndex(data)` and `pages.search`** (2.6): this unlocks search, backlinks, trash, Move to and the picker.
5. **Cross-page move with `move` marker, `transfer` undo and toast** (2.1, 2.2). Needs the persisted-receipt condition and the room version gate.
6. **Titles-only subscription on the sidecar** (2.3 layer 3).
7. **Cache management API and background sync** (2.5 items 4-5).
8. **Rows as pages, phases 1-2** (2.8).
9. **@mention trigger** (2.6), the largest UI item.

## 6. Decisions for you

In addition to D1-D9 in the first doc:

1. **D10, cached title on the pointer.** A `data.cache` plain object, with no cached title for pages the parent's readers may not open?
2. **D11, the room version gate for the `move` marker.** It changes the per-block schema in collab rooms. Old clients must be refused or upgraded.
3. **D12, the "persisted" receipt.** Ship a journal store, or add a signal that `/edit` actually saved? The stock binary cannot get a journal today: the built-in store is compiled only into conformance builds.
4. **D13, multi-server installs.** Add the `ICollabMetaRelay` seam now, or document live titles as single-server only?
5. **D14, the principle contradictions** in report 6 §1, especially `queryRows` and `blok_` tables.
6. **D15, scope of what Blok ships for workspace features.** Data plus in-editor pickers only (recommended), or headless components too?

## 7. Still unverified about Notion

From report 5. Settling these needs searches after the quota resets (Oct 4), or a hands-on test in a scratch Notion workspace:

- Inline look of a page block and its empty-title text.
- Cut and paste of a page block today.
- Cmd+Z after a delete or Move to, and undo scope.
- What a link-to-page block shows once its target is deleted.
- Where a normal Trash restore puts the page.
- Alt-click behaviour.
- The "Restore inheritance" label.
- Whether page lock reaches sub-pages.
