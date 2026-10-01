# Live page meta (title, icon, breadcrumbs, sidebar) under "one document per page"

Date: 2026-10-01. Research only. No repo file was changed.

Paths are relative to `/Users/jackuait/Packages/blok`. "Report N" means
`docs/plans/2026-10-01-page-block-research/N-*.md`. Labels: **verified** (read this session),
**inference**, **unverified**. The web was unavailable this session (WebFetch refused: weekly limit),
so every external URL below is quoted from reports 2 and 5. Those reports verified them. I did not re-fetch them.

---

## 0. Summary

- **Notion** keeps the title on one record. Every client keeps one socket open to MessageStore and subscribes to the records it shows. The sidebar, the breadcrumbs and the parent's page block all read that one record, so a rename shows up everywhere. The shape is "subscribe to N records over one socket, get told when a version changes". Blok can copy that shape without storing anything.
- **Blok today** has nothing that crosses documents.
  - A room is one doc (`CollabRoomManager.cs:337-354`, report 4).
  - A ticket names exactly one doc (`SyncHandshake.cs:162-166`).
  - Awareness, activity (106) and identities (107) are all scoped to one room.
  - `OutputData` has no doc-level meta (`types/data-formats/output-data.d.ts:109-124`).
  - The Y.Doc has only the `blocks` and `root` roots (`document-store.ts:149,154`).
  - The server's export rebuilds only `{time, blocks}` (`CollabDocConverter.cs:37-44`).
- **Recommended mechanism**, in four layers. Each layer ships on its own.
  1. **Canonical title in the page doc.** It sits in a doc-level `page` meta, which is the page block's own data (D2). The parent's pointer holds a **cache**, stored under a key that is NOT per-character mergeable (§1.6). The page doc wins every conflict (§5).
  2. **Same tab, zero cost.** The page editor emits a `page meta` event on every title or icon change. The host's sidebar and breadcrumbs, and any Blok instance in the same window, update at once. This covers "I rename my own page" fully.
  3. **Cross-client, live.** A meta-only subscription channel on the sidecar. It carries new outer frame types on a socket the client already has. The server holds an in-memory map `docId → subscribers` and relays meta changes it sees in live rooms. Each subscription is authorized per doc. Cold docs cost nothing.
  4. **Durable cache repair.** The consumer rewrites the parent pointer from its own backend through `POST /sync/{parent}/edit`, triggered by the PUT it already receives. As a fallback, an opened parent editor refreshes its pointers from `pages.resolve`.
- **What still differs from Notion:**
  - Multi-node deployments need a pass-through relay backplane. The scale-out guide shards rooms by doc id.
  - Revocation takes effect only when the subscription is next made.
  - The parent's saved JSON can lag by about 2-10 s until the consumer repairs it.

---

## 1. Live title propagation without the server storing anything

### 1.1 Notion behaviour

- One record. The title is `properties.title` on the page's block record, the same field a paragraph uses for its text. Source: report 2 §1, citing "The data model behind Notion's flexibility", <https://www.notion.com/blog/data-model-behind-notion> [primary per report 2].
- The parent shows a sub-page as that one record. The sub-page's own `properties.title` and `format.page_icon` sit on the record (report 2 §3, lines 166-170) [reverse-engineered per report 2].
- Live sync, quoted in report 2 §4 (lines 245-256) from the same blog post: "Every client has a long-lived WebSocket connection to MessageStore … the client subscribes to changes of that record." After a commit, MessageStore "passes on the new version" to subscribers.
- The wire carries **version numbers, not values.** Subscription keys look like `versions/{id}:{table}`. On a newer version the client refetches with `syncRecordValues` (report 2, NP `monitor.py`) [reverse-engineered; the current transport is unverified].
- **Consequence:** Notion's sidebar is one socket subscribed to N record ids, receiving tiny change notices. That is option (i) below. The difference is that Notion's notice says "refetch" and the record store is Notion's own.

### 1.2 What Blok has today (verified)

| Piece | Scope | Evidence |
|---|---|---|
| Sync socket | one doc per URL, `/sync/{doc}` | `src/components/modules/collaboration/index.ts:109-116`; route `BlokServerEndpointRouteBuilderExtensions.cs:92-96` |
| Client socket | one `WebSocket` per provider | `src/components/modules/collaboration/provider.ts:250-251` |
| Ticket | one `doc` claim (string), checked by ordinal equality | `packages/server/types/index.d.ts:10-25`; `TicketVerifier.cs:119-120`; `SyncHandshake.cs:162-166` |
| Ticket minting | the client asks the host endpoint with `?doc=<enc>` | `src/components/utils/access-pass.ts:14-20, 46-58` |
| Authorization | `IBlokAuthorization.CanReadDocumentAsync(user, documentId)`, once per connection. With no implementation, "every caller the transport already authenticated reaches every document." | `IBlokAuthorization.cs:10-12, 33-36`; `SyncHandshake.cs:195-208` |
| Awareness | relayed inside one room. The server validates it and records owners, never across rooms. | `CollabRoom.cs:1865-1866, 1896-1926, 2341-2400` |
| Activity 106 / identities 107 | per room, client→server "I'm here" and server→client `clientId→actorId` map | `packages/server/protocol/blok-sync-v2.md:190-253`; `SyncWire.cs:94-95, 111-112` |
| Host observer precedent | `ICollabActivityObserver.RecordAsync(documentId, actorId, at, kind)`. Best-effort and off-lane. "Blok stores none of this. The room reports and forgets." | `Blok.Server/Collab/ICollabActivityObserver.cs:24-46, 79-84` |
| Forward compatibility | an unknown **outer** type is ignorable on both sides | `blok-sync-v2.md:79-82`; client `sync-wire.ts:224-227`; memory NEW-FRAME LAW (new info goes in a NEW type, never a new field) |
| Export to consumer | debounced whole-doc PUT. `ExportDebounce` is 2 s and `ExportMaxDelay` is 10 s. | `CollabRoomOptions.cs:6, 9`; `CollabRoom.cs:2614-2663` (report 4) |
| Server edit API | `POST /sync/{doc}/edit`. `update` **replaces `data` wholesale**, but top-level diffable keys (including `title`) are text-diffed into the live `YText`. | `CollabEditOps.cs:36-37`; `YDocConverter.cs:885-933, 97` |
| Cold-doc edit | `EditAsync` calls `RoomFor(docId)`, which creates or seeds a room if none is live | `CollabRoomManager.cs:211-250` |
| Scale-out rule | "one document, one process, routed by id" (documentation, not code) | commit `e73ecbd2`; `docs/plans/2026-08-31-multiplayer-design.md:216-219` |

**Conclusion (verified):** nothing in the current wire, room or ticket lets one socket learn about a second document.

### 1.3 Option (i): the room publishes "page meta changed", and the server relays it in memory to subscribers

**Mechanism.**

1. **Where the meta lives.** It needs a doc-level location the room can read. Lean: a new Y root `ydoc.getMap('page')` holding `{ title, icon }`. In saved JSON it is a new additive top-level `OutputData.page`. Both are D2 in the main research doc. Today the server would drop it: `CollabDocConverter.Seed` reads only `blocks` (`CollabDocConverter.cs:24-29`) and `Export` writes only `time` + `blocks` (`:37-44`). So this is a lockstep client + C# converter change.
2. **Detect.** After a room applies an update, it compares `page.title` / `page.icon` with the last value it saw. This is one map read per update, on the lane the room already runs.
3. **Subscribe.** The client sends a new outer frame. Type numbers are illustrative. Type 105 is reserved and must not be used (`blok-sync-v2.md:75-77`).
   - **108 `meta-subscribe`** (client→server): `{"subscriptions":[{"doc":"p1","ticket":"…"}, …]}`.
   - **109 `meta`** (server→client): `{"doc":"p1","title":"…","icon":…}`, or a batch.
   - **110 `meta-refused`** (server→client): `{"doc":"p1","reason":"forbidden"}`.
4. **Which socket carries it.** Two choices:
   - (a) The `/sync/{doc}` socket of the page the user already has open. No new connection. Old servers ignore 108 (unknown outer type), so the client degrades to "no live meta".
   - (b) A new `GET /meta` WebSocket route, for a host that shows a sidebar with no editor open.
   - Both use the same frames.
5. **Relay.** In-process `Dictionary<docId, HashSet<subscriber>>`. When a live room's meta changes, the server sends 109 to that doc's subscribers. On subscribe, if a room for that doc is live, it sends the current value once. If no room is live, it sends nothing: the consumer's record is as fresh as the last export, because a room flushes before eviction (report 4, memory `multiplayer-design`).
6. **Store nothing.** The map dies with the socket. Nothing is persisted. This passes the ownership line, the same way awareness and the 107 map do.

**Authorization (the leak question).** A subscription must not reveal the title of a page the user cannot read.

- **Per-doc ticket, verified in-band.** Each subscription carries a ticket whose `doc` equals the subscribed id. The server runs the same `TicketVerifier` and the same ordinal check as `SyncHandshake.cs:162-166`, then `IBlokAuthorization.CanReadDocumentAsync(user, doc)` (`:201`). A missing or failed check gives `meta-refused` for that doc only. The socket stays open.
  - The consumer stays the authority: it mints a ticket per doc only if the user may read it.
  - This is **no weaker than sync today**. Without `IBlokAuthorization`, an authenticated caller already reaches every doc (`IBlokAuthorization.cs:10-12`).
  - The user on a subscription should match the socket's verified user. That stops a socket from smuggling another user's tickets. This is a design proposal, not existing code.
- **Why not one multi-doc ticket.** The ticket rides `Sec-WebSocket-Protocol` (memory `multiplayer-design`). A claim `docs:[…500 ids]` is several kB and could hit header limits. The exact Kestrel limit is **unverified** this session. It would also need a `TicketVerifier` schema change. In-band per-doc tickets avoid both. The cost moves to minting: N calls to the host's mint endpoint. A host may add a batch mint (`?doc=a&doc=b`). That is the host's business, but `access-pass.ts` would need a batch shape.
- **Revocation** applies only at subscribe time, the same as the sync handshake (memory: "the ticket is verified once at the handshake and `exp` is dropped at that boundary"). A user who loses access keeps receiving title changes until they re-subscribe. Mitigation: the server drops a subscription when its ticket's `exp` passes, so the client must re-mint. This differs from sync, which does not expire live sockets.

**Principle check.**

- Ownership: passes. The relay is pass-through and in memory, like awareness.
- "Everything is a block": the meta is the page block's own data, carried by the page's root.
- No `/documents` route, no listing: the server never answers "which pages exist". It only relays changes for ids the client names and proves access to.

**Cost.**

- Per subscription: one dictionary entry plus one verify and one authorization call at subscribe.
- Per idle cold doc: **zero server memory**. No room, no GET, no Y.Doc.
- Per change: one small frame per subscriber.
- Client: no Y.Doc per subscribed page.

**Scale-out gap.** The guide routes `/sync/{doc}` by doc id, so a page room and a sidebar socket usually sit on different nodes. An in-process relay then sees nothing.

- Fix: a pluggable pass-through bus, e.g. `ICollabMetaRelay { Publish(docId, meta); Subscribe(docId, handler) }`. The default is in-process. An operator backs it with their own Redis or NATS pub/sub. It stores nothing, so it stays within the line.
- This is the first cross-node machinery the sidecar would have. That is a real cost, and it is a decision for the user.

### 1.4 Option (ii): the renaming client also writes the title into the parent's pointer

**Mechanism.** The client needs the parent id, from the page's meta or from the host. It mints a write ticket `?doc=<parent>` and calls `POST /sync/{parent}/edit` with `update {id: pointerId, data: {...}}`.

- That is browser-callable through the HTTP guard (origin + write ticket, `EditEndpoint.cs:8-12, 37-60`). Whether a typical host's CORS allows it is **unverified**.
- A cold parent is seeded and then exported (`CollabRoomManager.cs:238`).
- Any open editor of the parent gets the change live, because the edit lands in the parent's room.

**Problems (verified unless labelled).**

- `update` **replaces the whole `data`** (`CollabEditOps.cs:36-37`, `YDocConverter.cs:880-910`). The client must send the full current pointer data, which it does not hold for an unopened parent. A concurrent change to another pointer key is lost (last writer wins).
- `Blok-Idempotency-Key` is required. It deduplicates only with a journal, and the stock host has none (report 4 §2B). A retried `update` is not idempotent in general. Here a replay writes the same value, which is harmless in effect.
- It needs **write access to the parent**. In Notion, a user who can edit a sub-page can rename it, and the parent's display follows. Requiring parent-write would block that case. Writing as a system actor would let child-writers change text in a doc they cannot edit.
- It costs a full GET, seed and PUT of the parent on every rename when the parent is cold (`EditAsync` → `RoomFor`).
- It updates only the **parent pointer**. Breadcrumbs, the sidebar and other "link to page" pointers are not covered.

**Verdict.** Not the primary mechanism. It is acceptable as the **consumer-backend** repair step in 1.5, where the consumer holds authority and knows the parent.

### 1.5 Option (iii): the consumer's endpoint receives the save and fans out through its own channel

**Mechanism.** The sidecar already PUTs the whole page doc to `{doc-endpoint}/{doc}` (report 4 §1.5).

1. The consumer compares the new `page.title` with its record.
2. It updates its tree record. That record is the sidebar's source of truth anyway.
3. It pushes through its own realtime channel, if it has one.
4. It calls `/sync/{parent}/edit` to repair the parent's cached pointer, with its own authority.

**Optional speed-up.** `ICollabMetaObserver.ChangedAsync(documentId, title, icon, at)`, a sibling of `ICollabActivityObserver` with the same "Blok stores none of this" contract (`ICollabActivityObserver.cs:24-46`). It fires immediately instead of after the 2-10 s export debounce.

**Principle check.** This is the purest option. The consumer owns the records and the fan-out.

**Cost.**

- Latency of 2 s debounce, up to 10 s (`CollabRoomOptions.cs:6, 9`), unless the observer is added.
- Every consumer must build a push channel. Many will not, and that gap is exactly what (i) fills.

**Verdict.** It is the right owner for **durable** state: the tree record and the parent pointer cache. It is not enough for **live** display, unless the host already runs a realtime channel.

### 1.6 Option (iv): reuse awareness or presence

- Awareness is per room (`CollabRoom.cs:1896-1926`), and 107 is per room (`blok-sync-v2.md:208-253`). A peer's awareness reaches only members of the **same** doc.
- To learn page P's title through awareness, the sidebar must join P's room. That is a full sync member: the server holds the doc, seeds it if cold, and SyncStep2 sends the whole doc. That is the cost (b) in the brief says is too high.
- Awareness is also ephemeral and per client. A title stored there disappears when the renamer leaves, and it would duplicate the doc's own state.
- **What does help:** inside the page's own room, a title change is already a normal Yjs update to every co-editor of that page.
- **Verdict:** reject as the cross-doc carrier. It is fine within one doc, where nothing new is needed.

### 1.7 Same-tab bus (not in the brief, cheapest, covers the commonest case)

When the user renames their own page, the sidebar, the breadcrumbs and often the parent pointer (a peek or split view) are in the **same window**.

- Blok emits `page meta` (`{pageId, title, icon}`) from the page editor on each change. This is a new event, and its name is a new public surface.
- A Blok-side registry that every instance in the window joins updates the *display* of pointers to that `pageId` in other open instances.
- The host's sidebar listens to the same event.
- Cost: zero network. This gives Notion's "type in the title, see the sidebar change per keystroke" for the local user. (i) is needed only for **other** users and tabs. A `BroadcastChannel` across tabs is possible. The collab e2e harness already uses one, per memory `collab-browser-e2e-harness`.

### 1.8 A hazard found while costing: the pointer's cached title must not be a per-character-merged key

- `title` is a diffable key on both sides (`src/components/modules/yjs/serializer.ts:36`; `YDocConverter.cs:97`).
- The client writes it as a `Y.Text` through `diffText` insert and delete ops (`document-store.ts:1426-1445`). The server does the same (`YDocConverter.cs:913-925`).
- If several open parent editors, or a client plus the consumer backend, each refresh the cache to the same new title, each computes an insert of the same suffix from the same base.
- **Inference from Y.Text semantics, not measured:** concurrent inserts are all kept, so "Roadmap" → "Roadmap 2" from two writers would read "Roadmap 2 2".
- **Rule:** store the cache as an atomic leaf. Either a non-diffable key (e.g. `data.cachedTitle`) or a nested object `data.cache = {title, icon}`. Nested keys are atomic per report 6 (line 209, commit `50c9ab63`). Concurrent identical writes then converge under last-writer-wins.
- Keep the per-character `title` key for the **canonical** title in the page doc, where people really do type at the same time.
- This changes the saved shape in report 6 §6 / the main doc §6.1, which put `title` on the pointer. That shape is unreleased, so the change is not breaking.

---

## 2. Multiplexing many docs over one WebSocket vs a meta-only channel

**Precedent (from report 5 §6, not re-fetched).** Hocuspocus shares one `HocuspocusProviderWebsocket` among many `HocuspocusProvider`s, one per document.

- Source: <https://github.com/ueberdosis/hocuspocus/blob/c7e372e77d43c1bc6cf2d0d61252c9c815a5b327/packages/provider/src/HocuspocusProvider.ts#L79-L95>.
- Design: <https://github.com/ueberdosis/hocuspocus/pull/484>, which adds "a field… that indicates the documentName".
- y-websocket does not multiplex: "you have to create a single WebSocket connection for each document" (<https://github.com/yjs/y-websocket/issues/66>, report 4 §2C).

**Cost per idle doc.**

| | Full room per doc (today) | Multiplexed rooms, one socket | Meta-only channel (1.3) |
|---|---|---|---|
| Sockets | N | 1 | 1 (or 0 extra when piggy-backing on `/sync/{current}`) |
| Handshakes / tickets | N tickets, N upgrades | N tickets in-band, 1 upgrade | N tickets in-band, 1 upgrade |
| Server memory | N live `YDoc`s. A cold one is first loaded from the working set or seeded by a **whole-doc GET** (`CollabRoom.cs:1566-1594`, report 4). Each lingers 30 s after the last leave (`CollabRoomOptions.cs:12`). | same N `YDoc`s | one map entry per subscription. **Cold docs cost 0.** |
| Client memory | N `Y.Doc`s with full content | N `Y.Doc`s | N small `{title, icon}` |
| Background traffic per doc | awareness renewal every 15 s (`outdatedTimeout/2`, `node_modules/y-protocols/awareness.js:13, 61`), activity 106 at most every 60 s (`blok-sync-v2.md:201-203`), identities 107 on change | same, multiplied | none when nothing changes |
| Caps hit | `CollabMaxConnectionsPerUserPerDoc` = 8, process `CollabMaxConnections` (`BlokServerOptions.cs:183, 192`) | the connection cap no longer bites, the room count does | neither |
| Wire change | none | a doc id inside every frame. Today the room is the URL (report 4 §1.4), so this rewrites the framing for types 0-3 and 100-107. A large, protocol-wide change. | 2-3 new outer types. Old peers ignore them by rule. |

**Verdict.**

- Multiplexing saves sockets, not work. Each doc is still a full Yjs replica on both ends. It also forces a doc id into every existing frame, which is the riskiest wire change on offer.
- Use it only if hosts need many **editable** docs open at once, e.g. side-peek plus page plus inline database rows.
- A sidebar and breadcrumbs need only titles. The meta-only channel is about O(1) per idle doc and is additive on the wire.

---

## 3. Breadcrumbs: the ancestor chain without Blok storing a tree

**Notion.**

- Breadcrumbs show "what page you're in, and where that page lives" (<https://www.notion.com/help/create-a-subpage>, report 1 §4). There is also a `/bread` block.
- Records carry `parent_id`, used for permissions, and `content[]` decides rendering (report 2 §2).
- **Inference:** breadcrumbs walk `parent_id` through the client's record cache. Each ancestor's title is a record the client subscribes to.

**Blok today (verified).**

- No doc-level meta exists. `OutputData = {version?, time?, blocks}` (`output-data.d.ts:109-124`).
- The Y.Doc has only the `blocks` and `root` roots (`document-store.ts:149, 154`).
- The server's converter round-trips only `blocks` (`CollabDocConverter.cs:24-29, 37-44`).
- A `parentId` in the page doc therefore needs the same lockstep change as the title (D2).

**Two ways to hold "parent".**

| | A. `parentId` in the page doc's meta | B. The consumer's records (lean) |
|---|---|---|
| Who already knows it | nobody yet | the consumer. Every peer keeps the tree outside the page doc: Outline `parentDocumentId` in SQL, AppFlowy Folder, AFFiNE `meta` (report 5 §0-3). |
| Ancestor chain cost | walk depth d, opening d docs, i.e. d GETs or rooms just to read one key | one host call `pages.ancestors(pageId) → PageInfo[]`, or one join in the consumer's database |
| On page move | must write the **child doc** too: a third doc beyond the two parents, with its own ticket and race | the consumer updates one row |
| Ownership line | fine (it is data) | fine (consumer-owned) |
| Staleness | a moved page's doc may disagree with the parent's pointer | the record is the truth. The pointer's position in the parent doc must agree with it, and the consumer derives both from the parent's PUT. |

**Recommendation.**

- Ancestors come from the host: a new `pages.ancestors?(pageId)`, or `pages.resolve` returns `parentId` so Blok walks it.
- Live ancestor titles come from the meta channel (1.3) or the same-tab bus (1.7). Depth is small, so this means only a few subscriptions.
- A `parentId` hint in the page meta is optional. If present it is advisory: it helps a host with no tree table, and it is never authoritative.

**Note on sibling order (inference).** In Notion the sidebar order is the parent's `content[]`. Under model B the order of sub-pages is the order of `page` pointer blocks in the parent doc. A consumer that builds its sidebar from its own table must take that order from the parent's PUT, by scanning `type:'page'` blocks in DFS order. Otherwise the sidebar and the page body disagree.

---

## 4. Sidebar tree: a headless helper Blok could ship

**Why it fits.** The sidebar is host UI. Blok already ships headless, framework-agnostic cores that every adapter wraps thinly:

- `useBlocks` is implemented once in `src/components/utils/blocks-api.ts`. It is exported through `@bloklabs/core/adapters` (`package.json:74-77`, `vite.config.mjs:38`), re-exported by React (`packages/react/src/blocks-snapshot.ts:1-27`) and wrapped with `useSyncExternalStore` (`packages/react/src/useBlocks.ts:1-30`).
- Vue and Angular have their own `useBlocks.ts` (`packages/vue/src`, `packages/angular/src`).
- Parity is enforced by tests, e.g. `test/unit/architecture/useblocks-scope-parity-law.test.ts`.

**Proposed contract (illustrative, nothing exists).**

```ts
// core, framework-agnostic (in @bloklabs/core/adapters)
interface PageRecord { id: string; parentId: string | null; title: string; icon?: PageIcon; hasChildren: boolean }

interface PageTreeSource {
  roots(): Promise<PageRecord[]>;                       // consumer: top level
  children(parentId: string): Promise<PageRecord[]>;    // consumer: lazy expand, in pointer order
  // Optional live feed. Default: Blok's meta channel (1.3) + same-tab bus (1.7).
  subscribe?(ids: readonly string[], onMeta: (m: { id: string; title?: string; icon?: PageIcon | null }) => void): () => void;
}

interface PageTree {                                    // external store: getSnapshot/subscribe
  getSnapshot(): PageTreeSnapshot;                      // { nodes: Map<id, {record, expanded, loading, error}>, rootIds }
  subscribe(listener: () => void): () => void;
  expand(id: string): Promise<void>;
  collapse(id: string): void;
  refresh(id?: string): Promise<void>;
  destroy(): void;
}
function createPageTree(source: PageTreeSource): PageTree;
```

- **React:** `usePageTree(source)` via `useSyncExternalStore`, like `useBlocks.ts`.
- **Vue:** a composable that returns a `shallowRef` snapshot.
- **Angular:** a `signal` or `Observable` service.
- **One parity law test,** like `useblocks-scope-parity-law.test.ts`. The published `.d.ts` must be hand-authored in `types/` (published-types law).

**Rules the helper must keep.**

- **Lazy.** Expanding a node is what loads its children.
- **Subscription follows visibility.** Subscribe meta only for visible nodes (expanded ancestors plus their children). That keeps N bounded and drops subscriptions on collapse.
- **Live meta patches only `title` and `icon`.** Structure (add, move, delete) comes from `refresh` or the consumer's own push. The meta channel never claims to list pages, which would cross the "no listing" line (`multiplayer-design.md:56-58`).
- **No DOM.** Drag-to-reparent in the sidebar is the host's UI calling the host's `move`.

---

## 5. Conflict: the title edited inside the page and inline on the parent's pointer

**Notion.**

- Both surfaces edit the **same** `properties.title` on one record, so there is no copy to reconcile.
- How Notion merges two concurrent edits to that one field is **not documented**. The blog describes validate-then-commit, and offline pages move to an undescribed CRDT model (report 2 §4, citing <https://www.notion.com/blog/how-we-made-notion-available-offline>).
- Whether Notion lets you edit a sub-page's title inline in the parent at all is **unverified** (report 1 §2: inline rendering unverified).

**Blok rule (proposed).**

1. **The page doc is the only writable title.** Inline rename on a pointer, if offered, is a write **into the page doc**. Two routes:
   - the host's `pages.rename(pageId, title)`;
   - `POST /sync/{pageId}/edit`, which text-diffs into the live `YText` (`YDocConverter.cs:913-925`), so it merges per character with someone typing inside the page.
   It is never a write of the canonical value into the parent.
2. **The pointer's cache is display-only and last-writer-wins** (atomic leaf, §1.8). Any writer simply overwrites it with the latest canonical value: the meta relay, a `resolve` refresh, or the consumer's repair. Because every writer copies from one source, the writes converge.
3. **Order of truth:**
   - live meta (1.3 / 1.7);
   - then `pages.resolve` on open;
   - then the cached pointer value;
   - then "Untitled", which matches Notion's no-access `plain_text` of "Untitled" (report 1 §2, citing <https://developers.notion.com/reference/rich-text>).
4. **No access.** A subscription refused for a page the reader cannot see shows the cache (it was in a doc they can read) or "Untitled". **Open question:** should the cache itself be blanked so a parent reader cannot see a sub-page title they lack access to? Notion shows Private or Untitled for pages without access (report 1 §4). Blok's cache would leak the last-known title to every reader of the parent. That is the price of keeping the cache in the parent doc. A host that cares can set `pages.resolve` to return `null` and Blok renders "Untitled". The cached bytes still sit in the parent's JSON.

---

## 6. Residual difference from Notion (after all four layers)

| Notion | Blok, best achievable inside the principles |
|---|---|
| One record, no cache | Canonical title plus a cache in each parent doc. The cache can be stale in **saved JSON** for 2-10 s (export debounce), or until the consumer repairs it. |
| One socket for everything | One socket for live meta, plus one per editable open doc |
| Works at any scale out of the box | Single node is fine. Multi-node needs an operator-supplied pass-through relay (`ICollabMetaRelay`), the sidecar's first cross-node piece. |
| Permission changes apply live | A meta subscription is authorized at subscribe time, until re-subscribe or ticket `exp` |
| No-access page reads "Untitled" everywhere | The parent's cache holds the last-known title in the parent doc, a residual leak unless the host blanks it |
| Sidebar order = parent `content[]` | The consumer must derive order from the parent doc's pointer order |

---

## 7. Decisions for the user

1. **D2 location:** a doc-level `page` meta (new Y root plus `OutputData.page`, lockstep C# converter change) vs a root `page` block inside the page doc.
2. **The pointer cache key** must be atomic (`cachedTitle` or a nested `cache`), not top-level `title` (§1.8).
3. **Meta channel transport:** piggy-back on `/sync/{doc}` with new outer types, a separate `/meta` route, or both.
4. **Subscription auth:** in-band per-doc tickets (lean) vs a multi-doc ticket claim. Plus the expiry policy for live subscriptions.
5. **Multi-node:** ship `ICollabMetaRelay` (pass-through), or document "live meta is single-node unless you route sidebar sockets to the page's node".
6. **`ICollabMetaObserver`** (immediate host hook) beside the debounced PUT: yes or no.
7. **No-access cache leak** (§5.4): accept it, or require `pages.resolve` to be able to blank it.
8. **Ship the headless `createPageTree` plus three adapters**, or leave the sidebar entirely to hosts.
