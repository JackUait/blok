# Opening a page fast: cache, prefetch, offline, socket reuse

Date: 2026-10-01. Research only. No repo files were changed.

Context: direction B from `docs/plans/2026-10-01-page-block-research.md`. Each page is its own document. Opening a page means a new editor, a ticket, a socket and a first sync.

Paths are relative to `/Users/jackuait/Packages/blok` unless they say otherwise. Every claim cites a `file:line`, a URL, or a memory note, or it is labelled **UNVERIFIED**, **INFERENCE** or **ESTIMATE**.

Web tooling hit a quota partway through. Two web claims (Hocuspocus v4 session multiplexing, Notion hover prefetch) could not be fetched and are labelled.

---

## 0. Summary

1. **Blok already has a per-document browser cache.** It is shipped, opt-in, and hand-rolled on lib0's IndexedDB helpers: `collaboration.offline` plus `offlineScope` (`types/configs/blok-config.d.ts:800-858`).
   - Under B, every page document gets its own cache for free. The database is named `blok-ops-<url>|<doc>|<scope>` (`src/components/modules/collaboration/operation-store.ts:406`).
   - The project **rejected y-indexeddb on purpose**. Memory `multiplayer-design.md` ("OFFLINE CACHE LAWS") gives three reasons: it needs the raw `Y.Doc`, which the seam keeps private; it applies rows before the lineage veto can run; and its load origin would rebroadcast.
   - So the dependency question does not arise. Core's `package.json` has **no `dependencies` key at all**. `yjs` and `lib0` are bundled devDependencies (`package.json:274, 311`).
2. **A cached page opens editable before any network call.** Cache adoption is awaited first, then the provider connects (`collaboration/index.ts:803-848`). Adoption sets `cacheAdopted`, and that lifts the read-only gate (`:436`).
   - **Without** the cache, a collab page boots empty and read-only until the first sync (`src/components/core.ts:458-475`).
   - `config.data` (the "last known" copy) is shown **only on `offline`/`error`, never while connecting** (`collaboration/index.ts:1285-1287, 1351-1373`).
3. **The boot path is strictly serial:** IDB replay → ticket mint → WebSocket upgrade → SyncStep1 → control frame → SyncStep2 → batch-add. Only the ticket mint can safely move earlier and run in parallel with the IDB read.
4. **The ticket cache does NOT refresh ahead of expiry.** The published docs say it does (`blok-config.d.ts:646-647`), and so does the memory note. The code only treats a cached ticket as stale within 30 s of `exp`, and only when someone asks for it (`src/components/utils/access-pass.ts:5, 137`). No timer runs.
   - The cache lives in a closure that is created per editor (`collaboration/index.ts:1190`) and dies with the editor.
   - `ticket` is a string, so a host cannot hand in a pre-minted ticket.
5. **One socket per document is wired into the protocol.**
   - Frames carry no document id (`packages/server/protocol/blok-sync-v2.md` §3).
   - The ticket must equal the route's document (`SyncHandshake.cs:162-165`).
   - Hocuspocus solved this with a document name on every frame (report 5 §6). For Blok that would be a protocol change, not a configuration option.
6. **Reusing one editor instance across pages is closed today, with evidence.**
   - Collab: `doc` is fixed for the editor's life (`blok-config.d.ts:780`), and `blocks.render` is refused (`src/components/modules/api/blocks.ts:256-272`).
   - Persistence: `load` runs once (`core.ts:161-164`), and `save` plus its version queue are bound to one editor (`src/components/utils/persistence.ts:282-330`).
   - Destroy and create is the only correct path.
   - **There is no page-open benchmark in the repo.** No numbers are given below; any figure is labelled as an estimate.

---

## 1. What makes opening a page slow today

### 1.1 Boot path, step by step (collaboration mode, which is what B uses for multiplayer pages)

| # | Step | Where | Blocking? |
|---|---|---|---|
| 0 | `new Blok()`. Config is validated and modules are constructed. | `core.ts:69-77` | sync CPU |
| 1 | `render()` diverts to `Collaboration.load(lastKnown)`. Nothing is seeded from `config.data`. | `core.ts:458-475` | — |
| 2 | Presence and awareness are wired. | `collaboration/index.ts:732-801` | sync CPU |
| 3 | **Cache adoption, awaited:** `createOperationStore(...).open()`, then each stored update is replayed with `applyRemoteUpdate(update, CACHE_ORIGIN)`. | `collaboration/index.ts:803, 869-990, 956` | IDB read. Awaited "because the blocks it restores have to be on screen before the first frame can race them" (`:801-802`). |
| 4 | Provider created with `initialLineage: adopted`, then `connect()`. | `:805-848` | — |
| 5 | **Ticket mint:** `fetch(endpoint?doc=…)` (skipped when the server runs Auth `none`/`proxy`, `Blok.Server.AspNetCore/BlokServerOptions.cs:37-42`). | `provider.ts:1580-1601`, `access-pass.ts:116-132` | 1 HTTP round trip to the host app |
| 6 | **WebSocket upgrade.** The ticket rides as a subprotocol. | `provider.ts:1426-1436` | 1 round trip (+TLS on a new connection) |
| 7 | Server handshake: origin check, ticket check, doc equality, `IBlokAuthorization.CanRead/CanWrite`. | `SyncHandshake.cs:120-210` | host's auth hook latency |
| 8 | **Cold room load on the server:** the journal (if one is registered), else the working-set read, else a GET to the consumer's endpoint (`SeedLocked`). | `Blok.Server/Collab/CollabRoom.cs:1240-1268, 1566-1594` | storage read; consumer GET only for a never-synced doc |
| 9 | `onopen` sends SyncStep1. The server sends the control frame (type 100), then SyncStep1/SyncStep2. | `provider.ts:1475`, `blok-sync-v2.md` §3 | 1 round trip |
| 10 | Remote blocks materialize through `batch-add`. That is one composed pass, not `Blocks.insertMany`. | `src/components/modules/blockManager/yjs-sync.ts:897-899, 1919-1960` | DOM + tool `render()` |
| 11 | First `connected` status. `recordCacheMeta` writes the snapshot so the next open is cached (offline mode only). | `collaboration/index.ts:1318-1341` | IDB write, off the critical path |

Persistence mode (single player, no server) is shorter: `persistence.load()` → `Renderer.render` (`core.ts:483-505`). Its only latency is the host's own GET.

### 1.2 What can overlap or be skipped

- **Ticket mint ∥ IDB read: possible, not done today.** The ticket does not depend on the cache. But the ticket source is built inside the provider's connect path (`index.ts:1183-1209`, called at `:809`), which runs after `await this.adoptCache` (`:803`). Starting the mint before step 3 saves `min(IDB, mint)`. **INFERENCE** from the code order.
- **SyncStep1 must wait for the replay.** The state vector in SyncStep1 is what makes the server send only the diff. A warm cache turns step 9's payload from "whole document" into "what changed since last time". This is the real reason a cache makes opening faster, beyond showing content early. `initialLineage` must also be known when the provider is built (`:812-815`). So steps 3 → 9 stay ordered.
- **Step 5 can be skipped** when the server runs Auth `none`/`proxy`. Those modes are for loopback deployments only (`BlokServerOptions.cs:37-42`).
- **Step 8 is skipped on a warm room.** A room lingers 30 s after it empties (`Blok.Server/Collab/CollabRoomOptions.cs:12`, `EvictionLinger = 30s`). Going back to a page within 30 s finds the room still in memory.
- **Steps 6 and 7 can only shrink with a shared socket (§4).** Even then, step 7's per-document authorization remains.
- **Step 10 cost scales with page size.** No benchmark exists. `test/unit/components/modules/yjs/document-store-scale.test.ts:102-130` bounds store ops on 10k blocks at under 1 s (a loose bound for the Yjs store only, not DOM rendering). No page-open or editor-boot timing exists anywhere in `test/`. Searched for `performance.now()`. Hits are unrelated scale and animation tests.

---

## 2. Optimistic open, prefetch, warm ticket

### 2.1 Notion behaviour

- **Browser cache.** SQLite reads are "raced" against the API, and navigation got "20 percent" faster. The initial page load gained nothing (WS blog, quoted in report 2 §6: https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite).
- **The parent shows a sub-page as one record (title, icon), not its body** (report 2 §3, §5). So the title and icon of a page you click are already on screen.
- **Hover/visible prefetch: UNVERIFIED.** I found no primary source saying Notion prefetches a page on hover. The web search quota ran out before I could search. Do not cite it as Notion behaviour.

### 2.2 Mechanism for Blok

1. **Instant shell from the pointer.**
   - The page block in the parent already holds the cached `title`/`icon` (report 6 §0, option 1).
   - The host (or a `pages.open` hook) renders the title, the icon and a skeleton at once, then mounts the editor under it.
   - This needs no core change. It is the host's routing UI plus the page tool's data.
2. **Show `config.data` read-only while connecting.**
   - Today `renderLastKnown` runs only on `offline` or `error` (`collaboration/index.ts:1285-1287`). Its guard skips it once the doc is synced or the cache was adopted (`:1355`).
   - A small core change could render it during `connecting` as well. Then a host that holds a last-known copy (its own HTTP cache, or the parent's snapshot) paints content at step 1 instead of step 10.
   - **Cost:** it clears and re-renders, and the first remote apply swaps it out (`dropDegradedView`, `:1377-1395`). That is two renders, and it changes when the caret becomes available. This is behaviour on a published surface, so treat it as an opt-in or a documented default change. **INFERENCE.**
3. **Prefetch on hover or visible.** Three tiers, cheapest first:
   - (a) **Warm the ticket.** Needs a new lever (see 2.3). It saves one host round trip.
   - (b) **Warm the host's HTTP cache** of the page's last-known `OutputData`, for use with lever 2. This is the host's business.
   - (c) **Warm the IDB copy.**
     - Today the cache is filled only by a mounted editor that completed a sync (`recordCacheMeta` on `connected`, `:1318-1341`).
     - **No headless sync exists.** I grepped `src/` for `navigator.storage`, `deleteDatabase` and headless sync paths and found none.
     - So prefetching the body into IDB today costs a whole hidden editor instance per page: socket, room join and DOM.
     - A headless "sync this doc into the store" helper (store + provider + a `Y.Doc`, no editor modules) would be new code. It is the precondition for anything like Notion's background download.

### 2.3 Warm ticket: what the code actually does

- `createTicketSource` caches one ticket. It re-mints only when called within `REFRESH_MARGIN_MS = 30_000` of `exp` (`access-pass.ts:5, 137`). There is no timer, so nothing refreshes ahead of time on its own. The doc comment at `blok-config.d.ts:646-647` ("replaces it ahead of expiry") is true only in the sense that a call inside the margin re-mints early.
- Concurrent callers share one in-flight mint (`:143-145`).
- The collab source is built per editor and per doc (`collaboration/index.ts:1190`). A new page means a new closure and a guaranteed fresh mint.
- **The lever that's needed:** either
  - a module-level ticket cache keyed by `(endpoint, doc)` with a `prefetchTicket(doc)` API, or
  - `ticket` widened to accept `(doc) => Promise<string>`, so the host owns caching and prefetch.

  The second option widens a published type (additive, so not breaking). It also matches the `persistence` "functions, not URLs" precedent (`blok-config.d.ts:655-657`).
- Tickets are short-lived (`exp` claim), so a prefetched ticket only helps within its lifetime. The server reads `exp` once, at the handshake (memory `multiplayer-design.md`: "the ticket is verified once at the handshake and `exp` is dropped at that boundary").

### 2.4 Principle check

The shell, the ticket prefetch and the `config.data` paint all run in the user's browser or the host's app. Blok stores nothing. ✔

### 2.5 Residual difference from Notion

Notion's parent record **is** the page record, so title and icon cannot drift. In B the pointer's title is a cache (decision D2 in the main plan), and it can be stale until the page doc loads.

---

## 3. Client-side cache of page documents

### 3.1 Notion behaviour (report 2 §6, primary: https://www.notion.com/blog/how-we-made-notion-available-offline)

- Before offline mode, the cache "was best-effort".
- **Offline mode (August 2025) works per page:** "We track which pages … are fully available offline and only let you access these pages when you have no internet connection." It would rather block a page than show half of it.
- A page becomes offline through a toggle, recent pages, favorites, inheritance from a parent, or a database view (up to 50 rows).
- Two tables track it: `offline_page` and `offline_action` (a reason per row).
- **Freshness:** on reconnect the client compares `lastDownloadedTimestamp` with the server's `lastUpdatedTime` for each page.

### 3.2 What Blok already has (verified)

- **Opt-in:** `collaboration.offline: true` plus a required `offlineScope` (`blok-config.d.ts:800-858`; enforced in core, see the comment at `collaboration/index.ts:404-406`).
- **Granularity:** one IndexedDB database per (server URL, doc, scope) (`operation-store.ts:406, 714`). Under B that is **one database per page**, the same granularity as Notion.
- **Whole-page guarantee:** "METADATA IS THE GATE".
  - Meta is written only after a completed sync (`collaboration/index.ts:1318-1341`).
  - A cache with no meta is never adopted (`:946-948`, the `contents === null` path).
  - So a cached page is either a whole server-agreed document plus local edits, or absent. This matches Notion's "fully available" rule per page.
- **Offline edits with later sync:**
  - Local edits are journalled (`appendLocal` under v2, `appendCached` under v1, `:917-945`).
  - On reconnect they drain to the server. Yjs merges them.
  - Lineage is stamped on every row. A server reset drops the copy (`resetForRelineage`, `:1150-1175`; laws (b) and (c) in memory `multiplayer-design.md`).
- **Invalidation:**
  - **Lineage.** A reset or a re-lineage clears the copy (`:1170-1172`).
  - **An `oversized-update` terminal** clears it (`:1297-1308`).
  - **An unreadable row** clears it (`:957-966`).
  - Freshness is implicit: the Yjs state vector in SyncStep1 pulls exactly what is missing. Nothing like Notion's `lastUpdatedTime` compare is needed.
- **Compaction:** 500 rows per lineage are merged into one (`operation-store.ts:22`), under a Web Lock (`:607`).
- **Privacy on shared computers:** partitioned by `offlineScope` (documented at `blok-config.d.ts:836-858`).

### 3.3 Gaps that B makes real (verified absences)

- **No eviction, no quota handling, no persistence request.** No `navigator.storage.persist` or `estimate` call exists anywhere in `src/` (grep). The docs say "Blok never asks the browser to keep the storage" (`blok-config.d.ts:828-831`). One page today is one database. B with 500 visited pages is 500 databases. Nothing deletes them, except the browser's own eviction under storage pressure.
- **No public "forget" API.** `clearAdoptable` is internal (`collaboration/index.ts:691`). There is no `deleteDatabase` call in `src/`. On logout, a host cannot wipe the user's page copies through Blok. Scoping stops the next person **reading** the copy through Blok, but the bytes stay on disk until site data is cleared. The host could call `indexedDB.databases()` and delete names starting with `blok-ops-`, but that ties the host to an internal naming scheme.
- **Per-page overhead.** Each open page has its own database, its own `BroadcastChannel(dbName)` (`operation-store.ts:734`) and its own compaction lock name (`:607`). This is fine for a handful of open pages. For background prefetch of many pages it is **UNMEASURED**.
- **No index of what is offline.** Nothing like Notion's `offline_page` table exists, so a host cannot ask "which pages can I open offline?" Under B this list is the host's to keep. It needs the page tree, which only the host has.
- **No headless sync (§2.2c).** Notion downloads pages you have not opened. Blok can only cache pages that have been opened in an editor.

### 3.4 Mechanism, closest to Notion within the principles

1. Each page editor mounts with `collaboration: { doc: pageId, offline: true, offlineScope: userId }`. This exists today.
2. Add a small **cache-management surface**. It is new API, all additive:
   - `Blok.offline.forget(scope)` deletes every `blok-ops-*|*|scope` database (for logout and shared computers).
   - `Blok.offline.list(scope)` returns the doc id and `savedAt` of each copy. `savedAt` is already stored in meta (`operation-store.ts:90, 827`).
   - An LRU cap with a host override, plus an option that calls `navigator.storage.persist()` when the host opts in to "available offline".
3. **Headless prefetch** (`Blok.offline.sync(doc)`): open store + provider + `Y.Doc` without an editor, sync once, record meta, close. This is what makes Notion's "recent / favorites / inherited" policies possible. The **policy** (which pages) stays with the host, because only the host knows the tree.
4. **Persistence mode (no server) has no cache.** Its queue "lives in memory only" (`blok-config.d.ts:674-675`). Offline for single-player pages is the host's own job (its `load`/`save` can hit its own IDB).

### 3.5 Principle check

- **Ownership.** The copy is on the end user's device, under the host's origin, and opt-in. The project's stated position is in the published docs: "it writes document content into this browser's storage for this origin, which is a decision about the host's data, not about the editor", and "It is NOT A BACKUP… the document lives on the service and in your own records" (`blok-config.d.ts:807-831`). Nothing is stored by Blok. ✔
- **Zero runtime deps.** The cache uses bundled `lib0/indexeddb` (`operation-store.ts:7`). No y-indexeddb is needed. ✔
- **The memory note `emoji-picker-open-latency.md`** rejected IndexedDB for emoji data ("not worth it, chunk = one JSON.parse, ~5ms"). That ruling is about static assets and does not bear on documents.

### 3.6 y-indexeddb status (prior art only)

- API: `new IndexeddbPersistence(docName, ydoc)`, a `synced` event, `clearData()`, `destroy()` (README, https://github.com/yjs/y-indexeddb). One instance per doc.
- **No subdocument handling.** Issue #32 "sub-doc syncing support" has been open since 2023-06 (report 5 §6, https://github.com/yjs/y-indexeddb/issues/32).
- Outline uses one Y.Doc per document with an IndexedDB cache (report 5, `MultiplayerEditor.tsx` L77-L95). That is the same shape as Blok-under-B.

### 3.7 Cost

- Steps 1 and 2 of §3.4 are small: a new namespace on `Blok`, typed in `types/`, plus parity across the 3 adapters (memory `adapter-parity-audit`).
- Step 3 is medium. It re-uses the provider and store without the module system. **ESTIMATE**, nothing measured.

### 3.8 Residual difference from Notion

- Notion's offline guarantee covers **everything a page depends on** (rows, mentions). Blok-under-B caches **one page doc**. Linked pages, database rows and media are separate. Media is never cached.
- Pages you have never opened are offline only if the host runs headless prefetch (once built).
- Read-only members: a cached write-denied verdict is honoured only while `ticket` is configured (`blok-config.d.ts:820-823`).

---

## 4. One socket for several pages

### 4.1 What Blok's wire allows today

- The room is the URL: `/sync/{doc}` (`collaboration/index.ts:109-116`, server routes in `BlokServerEndpointRouteBuilderExtensions.cs:92-96`).
- **No frame carries a doc id.** The frame table lists types 0-3 and 100-107, and none has a doc field (`packages/server/protocol/blok-sync-v2.md` §3). Each "WebSocket message" holds exactly one frame (§1).
- The ticket is checked once, at the upgrade, and it must name **this** document (`SyncHandshake.cs:162-165`). `IBlokAuthorization` runs once per connection (`:195-210`).
- The provider's own header says: "one WebSocket per document" (`provider.ts:20`).

So **one connection carries exactly one document.**

### 4.2 Precedent

- **y-websocket:** one connection per document. Multiplexing is a "future effort" (https://github.com/yjs/y-websocket/issues/66, report 4 §2C).
- **Hocuspocus:** one `HocuspocusProviderWebsocket` shared by many `HocuspocusProvider`s. The design adds "a field… that indicates the documentName" to every message (report 5 §6: `HocuspocusProvider.ts` L79-L95, https://github.com/ueberdosis/hocuspocus/pull/484).
- **Hocuspocus v4 "session-aware multiplexing"** puts a session id in the document-name field so two providers can open the same doc on one socket. The source is a search-result snippet (https://github.com/ueberdosis/hocuspocus/blob/main/RELEASE_NOTES_V4.md), **not fetched (quota)**, so it is UNVERIFIED in detail.

### 4.3 What it would take in Blok (protocol change)

- **A new route or subprotocol** (`blok-sync.v3` or `/sync`), plus **new outer frame types** that wrap a doc id around an inner v2 frame. Memory `multiplayer-design.md` "NEW-FRAME LAW": new information goes in a new message type, never a new field on an existing frame. Unknown outer types are the forward-compat channel (`blok-sync-v2.md` §3).
- **Per-document auth inside the socket:** a "join doc" frame carrying a doc-scoped ticket, then `IBlokAuthorization` per join. The per-doc ticket claim must stay, or a ticket for one page would open another.
- **Per-doc lineage, limits and acknowledgement state** inside one connection. The provider state machine is per socket today (`provider.ts:281-320`).
- **Conformance fixtures and the C# server.** The protocol is normative for third-party servers (`blok-sync-v2.md:3-5`).

### 4.4 Cost and benefit

- **Saves per page:** one TCP+TLS+upgrade round trip (steps 6-7 minus auth). HTTP/2 or HTTP/3 does not pool WebSockets by default (**UNVERIFIED**: RFC 8441 extended CONNECT support varies by browser and server).
- **Does not save:** the ticket mint (still one per doc), the room load, or SyncStep1/2.
- **Cost:** a protocol version, a provider rewrite to N docs per socket, server routing, and conformance. **Large.** Recommend deferring it until a measured page-open trace shows the upgrade dominating.

### 4.5 Principle check

Neutral: it changes transport only, and stores nothing. ✔

---

## 5. Editor instance: reuse vs destroy and create

### 5.1 Reuse is blocked

- **Collab:** `collaboration` is "Fixed for the editor's life; changing it requires recreating the editor" (`blok-config.d.ts:780`). `blocks.render`, `clear`, `renderFromHTML` and `importMarkdown` throw while collaboration is on (`api/blocks.ts:256-272, 290-293`).
- **Persistence:** `load` runs once and is consumed by the first render (`core.ts:111-116, 161-164, 477-480`). `save` and the version queue live in a closure built once (`persistence.ts:282-330`). A `blocks.render(pageB)` swap would send page B's content to page A's `save`, together with page A's version. That is silent data corruption.
- **What does reset on render:** `YjsManager.fromJSON` clears undo history (`src/components/modules/yjs/index.ts:309-313`). `blocks.render` discards pending changes (`api/blocks.ts:319-327`).
- **What would leak:** **UNVERIFIED** in full. I did not audit toolbars, find-in-page, selection, presence or tool-level static state for a swap, because the swap is already closed by the two points above.

### 5.2 Destroy and create costs

- Module construction runs once per editor (`core.ts:512-523` iterates every module). Collab teardown flushes the write buffer and the outbox (`collaboration/index.ts:996-1010`; memory law (g)), so closing a page is safe.
- **No benchmark exists** for boot, render or destroy time. Measure first: a Playwright trace of `new Blok` → `isReady` → first `connected`, with 10, 100 and 1000 blocks, cold and warm IDB.
- Precedent: the database drawer already builds a fresh `new Blok` per row body (`src/tools/database/database-card-drawer.ts:601-614`, report 4 §5).

### 5.3 Notion comparison

Notion is one SPA with one record store, so a page switch re-renders from the store. Blok has no store that spans pages. The closest equivalent is: keep the IDB copy warm (§3), paint the shell at once (§2), and destroy and create the editor.

**Residual:** module construction cost on every open. It is unmeasured.

---

## 6. Recommended order (cheap to expensive)

1. **Measure.** Add a page-open trace (cold room / warm room, cold IDB / warm IDB). Nothing below should be prioritised without it.
2. **Host shell from the pointer.** No core work. Document it in the page-tool guide.
3. **Start the ticket mint before the IDB replay,** and fix the "ahead of expiry" doc wording (`blok-config.d.ts:646-647`), which is wrong.
4. **`ticket` as a function, or a shared ticket cache with `prefetchTicket(doc)`.** Additive.
5. **Paint `config.data` read-only during `connecting`.** It is opt-in, and it changes a behaviour on a published surface.
6. **Offline management API:** `forget(scope)`, `list(scope)`, an LRU cap, and an opt-in `storage.persist()`.
7. **Headless `offline.sync(doc)`** for Notion-style background download, with the policy left to the host.
8. **Socket multiplexing.** A protocol v3. Defer until measured.

## 7. Open points

- Notion hover prefetch: no primary source found (web quota). **UNVERIFIED.**
- Hocuspocus v4 session multiplexing details: snippet only. **UNVERIFIED.**
- State that would leak across a `blocks.render` swap: not audited (§5.1).
- Overhead of many IDB databases and BroadcastChannels per origin: **UNMEASURED.**
- How long a never-opened page takes to load cold through `SeedLocked` (a consumer GET): host-dependent, not measured.
