# Yjs Multiplayer Sync — Research for the Blok Sidecar

Researched 2026-08-31. Context: Blok already runs Yjs client-side (Y.Doc drives document state and undo) but has no network layer. The companion sidecar is C#/ASP.NET Core, self-contained single-file publish. Locked constraints: no hosted service; the consumer's endpoint stays the system of record for documents; the sidecar may persist a sync working set.

---

## A. What a correct minimal Yjs sync server must implement

### A.1 The wire protocol (y-protocols)

The de-facto standard wire format is [yjs/y-protocols](https://github.com/yjs/y-protocols) (v1.0.7, released 2025-12-16; repo pushed 2026-05). Every y-websocket-compatible server (hocuspocus, y-sweet, y/hub, ypy-websocket, yrs-warp, YDotNet.Server.WebSockets…) speaks it. One WebSocket connection per document ("room"), binary messages with a lib0 varint type prefix:

- **Message type 0 — sync**, with three sub-messages:
  - **SyncStep1**: sender's *state vector* — a compact `Map<clientID, clock>` of "the latest operation I have per client". Much cheaper than listing all op IDs.
  - **SyncStep2**: the diff — every update the recipient of a SyncStep1 is missing, computed against that state vector, plus the delete set.
  - **Update**: an incremental document update, broadcast to all other connected clients as edits happen.
- **Message type 1 — awareness**: ephemeral per-client state (cursor, selection, user name/color). Each client owns exactly one entry in a `Map<clientID, state>`; a state not refreshed for 30 s is dropped; `setLocalState(null)` on disconnect marks a client offline. **Awareness is pure relay — no CRDT decoding is ever required server-side.**
- **Message types 2/3 — auth / queryAwareness**: permission-denied signalling and awareness re-query.

Client–server handshake ([y-protocols README](https://github.com/yjs/y-protocols/blob/master/README.md), [Dovetail's Yjs Fundamentals Part 2, Medium](https://medium.com/dovetail-engineering/yjs-fundamentals-part-2-sync-awareness-73b8fabc2233)): client connects and sends SyncStep1; server replies **SyncStep2 immediately followed by its own SyncStep1**; client answers with SyncStep2. After that, everything is Update broadcasts. The same protocol is implemented in Rust in [yrs `sync/protocol.rs`](https://docs.rs/yrs/latest/src/yrs/sync/protocol.rs.html) — which is what a C# server via YDotNet inherits.

### A.2 What a "dumb relay + append-only log" can and cannot do

**Can, with zero CRDT code:**
- Broadcast Update messages verbatim to other clients in the room (updates are opaque binary blobs).
- Append every Update to a per-doc log. Yjs updates are commutative, associative, and idempotent — applying the whole log in any order, with duplicates, converges to the correct document.
- Relay awareness verbatim (this is all any server does with awareness).

**Cannot, and this is what breaks:**
1. **Answering SyncStep1 from a late joiner.** Computing SyncStep2 = "diff my state against your state vector" requires decoding CRDT state. A dumb relay's only *correct* fallback is to ignore the state vector and send the **entire update log** (correct thanks to idempotence, but unbounded bandwidth: Chronicle measured 2 MB+ initial payloads causing 4–5 s document loads before they fixed it — [Optimizing Yjs first load, anikd.com, 2024-12-25](https://anikd.com/blog/optimizing-yjs-first-load/)).
2. **Compaction.** Merging the log into one update needs a Yjs implementation (`Y.mergeUpdates` or load-into-Doc). Without it the log grows forever and every cold start replays all of it.
3. **State-vector diff responses** for reconnecting clients — same problem as (1); every reconnect costs a full log download.

**Real-world proof both ways:**
- *Dumb relay shipped in production*: Nextcloud Text runs Yjs over a PHP backend that stores/forwards base64-encoded steps without a PHP Yjs implementation. It works, but they carry sync bugs like [missing steps/structs (#4600)](https://github.com/nextcloud/text/issues/4600) and an open wish for a [real Yjs backend drop-in (#2847)](https://github.com/nextcloud/text/issues/2847). Cautionary, not aspirational.
- *The middle path*: [y/hub](https://github.com/yjs/yhub) (the renamed y-redis, see B) relays updates through Redis streams **without keeping a Y.Doc in memory** — it only loads Yjs state when computing a client's initial sync, and a separate worker does compaction. So the "relay is dumb, one component knows CRDTs" split is exactly what the reference-quality server does.

**Half-way tools that soften the requirement**: the [Yjs document-updates API](https://docs.yjs.dev/api/document-updates) offers `Y.mergeUpdates(updates)`, `Y.encodeStateVectorFromUpdate(update)`, and `Y.diffUpdate(update, sv)` which operate **on binary updates without instantiating a Y.Doc**. So a server *with a Yjs library but without live docs in memory* can still answer SyncStep1 correctly and compact logs. Caveat, quoted from the docs: merging updates "doesn't garbage-collect deleted content. You still need to load the document to a Y.Doc to reduce the document size." (These v2/diff functions exist in yjs; check binding coverage before assuming them in other languages — YDotNet does not expose mergeUpdates, see C.)

### A.3 Persistence: update log vs snapshot, compaction, GC

Standard pattern (all real servers converge on a variant of it):

1. **Append incoming updates** to a per-doc log (cheap, crash-safe, no decode needed).
2. **Periodically compact**: either `Y.mergeUpdates(log)` (no tombstone GC) or — better — load into a Y.Doc and `Y.encodeStateAsUpdate(doc)`, which garbage-collects deleted content into tombstones and shrinks the doc. y-leveldb historically compacted every N updates; hocuspocus debounces `onStoreDocument` writes of full state; y-sweet keeps the doc in memory and [writes to S3 only when dirty (#416, 2025-09)](https://github.com/jamsocket/y-sweet/pull/416); y/hub's worker consumes Redis streams, merges, writes blobs to S3 + metadata to Postgres, idempotently.
3. **Snapshot for cold start**: a late joiner should get one merged blob, not a log replay. Chronicle's fix was client-side (y-indexeddb as a local snapshot so SyncStep1 already carries most state) — the server-side equivalent is storing the merged doc and answering SyncStep1 with a real diff.
4. **GC subtlety**: Yjs GC (on by default) replaces deleted content with tombstones; disable it only if you need to restore deleted history from snapshots. y-sweet exposes this as a flag ([disable GC via env/CLI, #422, 2025-12](https://github.com/jamsocket/y-sweet/pull/422)).

**Minimal-correct-server checklist** (what Blok's sidecar must do to be a first-class citizen):
- Speak y-protocols framing over raw WebSocket (sync + awareness message types).
- Reply to SyncStep1 with a genuine state-vector diff (needs a CRDT lib) — or accept full-log sends as a temporary, correct-but-degenerate mode.
- Broadcast Updates to room peers; relay awareness; drop awareness state on disconnect.
- Persist: append updates immediately, compact into a merged/GC'd snapshot on an interval or on last-client-disconnect.
- Auth at connection time (see y-sweet's token model in B — the right shape for a sidecar).

---

## B. Server landscape, 2026

### y-websocket (+ @y/websocket-server) — the reference
- [Repo](https://github.com/yjs/y-websocket): MIT, v3.1.0 2026-08-06, actively maintained. The bundled server was split out to [@y/websocket-server](https://github.com/yjs/y-websocket-server) — README calls it "a simple in-memory backend that can persist to databases, but it can't be scaled easily."
- Architecture: in-memory Y.Doc per room; optional y-leveldb persistence. **No auth built in** — README's position: "Websockets also send header information and cookies, so you can use existing authentication mechanisms with this server."
- Notable: the `main` branch is the development branch for `@y/websocket` targeting **Yjs v14 (`@y/y`)** — a Yjs major is brewing; the README recommends staying on y-websocket + Yjs v13 for now. Worth tracking for any new integration.
- Who stores the doc: the server process (memory), optionally LevelDB. Room auth: none / BYO reverse proxy.

### y-redis → **y/hub** (renamed)
- `yjs/y-redis` now redirects to [yjs/yhub](https://github.com/yjs/yhub) — "Alternative backend for y-websocket", pushed 2026-08-28, **AGPL-3.0**, self-described **beta**.
- Architecture: stateless **server** nodes stream updates through Redis streams — "The server doesn't maintain a Y.Doc in-memory" except when computing a client's initial sync — plus a separate **worker** that merges pending updates, writes blobs to S3 and metadata to Postgres, and trims Redis. Compaction is idempotent by design.
- Auth: JWT (ECDSA-verified in-process via an auth plugin) issued by *your* application backend — identity + per-doc permission scope.
- Relevance to Blok: the best-engineered blueprint of the relay/compactor split, but AGPL-3.0 makes co-shipping or embedding unattractive for an MIT-style product; treat it as architecture documentation.

### Hocuspocus (Tiptap)
- [Repo](https://github.com/ueberdosis/hocuspocus): MIT, v4.6.0 2026-08-10, 2.5k stars, actively maintained; Node 22+/Bun/Deno/Cloudflare Workers ([v4 stable announcement](https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release)).
- Architecture: in-memory Y.Doc per document; everything else is hooks. [Persistence guide](https://tiptap.dev/docs/hocuspocus/guides/persistence): `onLoadDocument` returns a Y.Doc built from **binary** fetched from your DB; `onStoreDocument` is a debounced full-state save. Extensions: `extension-database`, `extension-sqlite`, S3, Redis (horizontal scaling).
- Auth ([guide](https://tiptap.dev/docs/hocuspocus/guides/authentication)): client passes an opaque `token`; server's `onAuthenticate` hook validates it however you like (call your backend, verify a JWT) and can set per-connection context; pre-auth messages are buffered with size caps.
- Who stores the doc: **your database, via hooks** — of all Node servers this maps most directly onto "the consumer's endpoint is the system of record", but it stores *binary Y.Doc state*, not JSON.

### y-sweet (Jamsocket) — closest to Blok's sidecar model
- [Repo](https://github.com/jamsocket/y-sweet): **MIT** (LICENSE file confirmed), Rust. "A realtime CRDT-based document store, backed by S3." Latest release v0.9.1 2025-09-16; last commit 2025-12-04 (GC flag). **Maintenance: alive but quiet in 2026** — no release in ~11 months; Jamsocket (the company) still promotes it and hosts it, and they published the excellent [learn.yjs.dev](https://learn.yjs.dev/) tutorial. Factor the slow cadence into any adoption decision.
- Architecture: single native binary (also `npx y-sweet serve`, Docker `ghcr.io/jamsocket/y-sweet`); document held in memory while a session is open; persists to **filesystem path or `s3://` bucket** ([running.md](https://github.com/jamsocket/y-sweet/blob/main/docs/running.md), [BYO-S3 docs](https://docs.jamsocket.com/y-sweet/advanced/bring-your-own-s3)); writes only when dirty; WebSocket ping/pong zombie-connection cleanup (v0.9.1); offline support since [v0.7.0, 2024-12](https://jamsocket.com/blog/y-sweet-offline-support).
- **Auth model (the part to copy)**: two-tier tokens. Your backend holds a *server token* (connection string = URL + secret). To let a user open a doc, your backend calls the y-sweet SDK — `getOrCreateDocAndToken(connectionString, docId)` — which mints a short-lived, **doc-scoped client token**; the browser connects to the sync server with only that token. v0.8.1 added validation that a client token's docId matches the doc being opened. This is exactly the sidecar shape: *the consumer's backend decides authorization; the sync server only verifies signatures.*
- Who stores the doc: the sidecar's own S3/filesystem working set — the app's system of record stays elsewhere. Same split Blok wants.

### Liveblocks — hosted, counterpoint only
- Proprietary hosted platform ([Liveblocks Yjs](https://liveblocks.io/docs/products/document/yjs)); excluded by the no-hosted-service constraint. Still instructive: rooms, backend-minted room tokens (secret key), permanent Yjs storage per room, webhooks, DevTools. [Feb 2026 update](https://liveblocks.io/blog/whats-new-in-liveblocks-february-2026): rewritten realtime storage engine (larger docs, faster initial loads) in internal use since 2025.

### PartyKit / Cloudflare Durable Objects
- PartyKit was [acquired by Cloudflare in April 2024](https://blog.partykit.io/posts/partykit-is-joining-cloudflare/); repo now [cloudflare/partykit](https://github.com/cloudflare/partykit) (ISC, pushed 2026-01-29; `y-partykit` 0.0.33 released 2025-06-05 — modest cadence).
- Pattern: **one Durable Object per room** — a globally-unique stateful mini-server with its own storage; `y-partykit` provides `onConnect` Yjs handling with persistence into DO storage. Auth: your endpoint issues a token; `onBeforeConnect` validates it.
- Relevance: architecture inspiration only (the "one owner per document" model); runtime is coupled to Cloudflare Workers, not self-hostable in a consumer's own infra in any practical way.

### Tiptap Cloud / Document Server
- Hosted collaboration built on Hocuspocus, with on-prem Docker images available **only on paid Enterprise licensing** ([product page](https://tiptap.dev/product/collaboration), [licensing discussion #7321](https://github.com/ueberdosis/tiptap/discussions/7321)). Excluded by constraints; the open-source path from the same vendor is plain Hocuspocus.

### Rocicorp Zero — different species
- [Zero 1.0 shipped June 2026](https://www.infoq.com/news/2026/06/zero-version-1/) ([zero.rocicorp.dev](https://zero.rocicorp.dev/)): a general query-sync engine over Postgres, **not Yjs/CRDT**. It syncs query results and mutations, not rich-text ops. Relevant to Blok only as philosophy: like Notion (section D), it shows structured app data can sync server-arbitrated without CRDTs — but character-level collaborative text still needs Yjs/OT, so it's not a fit for the editor surface.

### Summary table

| Server | Lang | Doc storage | Room auth | License | Health (2026) |
|---|---|---|---|---|---|
| @y/websocket-server | Node | memory (+leveldb) | none/BYO | MIT | active (v3.1.0 08/2026) |
| y/hub (ex y-redis) | Node (+Rust exp.) | Redis→S3+Postgres (worker) | JWT/ECDSA in-process | **AGPL-3.0** | active, beta (08/2026) |
| Hocuspocus | Node | **your DB via hooks** (binary) | `onAuthenticate` token hook | MIT | active (v4.6.0 08/2026) |
| y-sweet | Rust binary | own S3/fs working set | backend-minted doc-scoped tokens | MIT | quiet (last release 09/2025) |
| Liveblocks | hosted | their cloud | backend-minted room tokens | proprietary | active |
| PartyKit / DO | Workers | DO storage | `onBeforeConnect` + token | ISC | maintained, slow |
| Tiptap Cloud | hosted/on-prem $ | their infra / paid image | JWT | commercial | active |

---

## C. Yjs in .NET / C# (the critical section)

### C.1 YDotNet — the primary path

[y-crdt/ydotnet](https://github.com/y-crdt/ydotnet) — .NET bindings to **yrs** (the Rust y-crdt port, itself very healthy: [y-crdt/y-crdt](https://github.com/y-crdt/y-crdt) v0.27.4 released 2026-08-22, pushed 2026-08-28). YDotNet lives **inside the y-crdt GitHub org** — it is the blessed .NET binding.

**Maintenance (verified via GitHub/NuGet APIs, 2026-08-31):**
- Latest release **v0.6.0, 2026-02-14** ([NuGet](https://www.nuget.org/packages/YDotNet) published same day). Releases roughly twice a year (0.4.3 → 02/2025, 0.5.0 → 09/2025, 0.6.0 → 02/2026).
- Last commit 2026-05-04 ("Dotnet10"); issues actively triaged through **2026-08-28** — largely by **Sebastian Stehle (Squidex's founder)**, who co-authors the packages (NuGet authors: `lsviana, sebastianstehle, goldsam`).
- **Production usage: Squidex CMS.** `squidex/squidex` master [`Squidex.csproj`](https://github.com/squidex/squidex/blob/master/backend/src/Squidex/Squidex.csproj) pins `YDotNet 0.6.0`, `YDotNet.Native 0.6.0`, `YDotNet.Server 0.6.0`, `YDotNet.Server.Redis 0.6.0`, `YDotNet.Server.WebSockets 0.6.0` (the old `Squidex.YDotNet` fork packages from 2023 are superseded).
- Self-assessment in the README: "this project is still early, so it may contain bugs and the API is subject to change."

**Package family:** `YDotNet` (core bindings), `YDotNet.Native` (meta-package → per-platform `YDotNet.Native.Linux` / `.MacOS` / `.Win32`, nuspec verified), `YDotNet.Extensions`, `YDotNet.Server` (room/doc hosting abstraction with pluggable storage callbacks), `YDotNet.Server.WebSockets` (**raw ASP.NET Core middleware** — `YDotNetSocketMiddleware` + `WebSocketEncoder`/`WebSocketDecoder` implementing y-protocols framing), plus `YDotNet.Server.Redis`, `.MongoDB`, `.EntityFramework` backends.

**Wire compatibility (verified):** the repo's [Demo client `package.json`](https://github.com/y-crdt/ydotnet/blob/main/Demo/Client/package.json) depends on standard **`y-websocket` 1.5.x, `y-protocols`, `y-prosemirror`, `y-monaco`** — i.e., stock JS providers connect to the ASP.NET Core middleware unchanged. Awareness is handled by the server package (the Demo runs ProseMirror + Monaco + tldraw collaboratively).

**Feature coverage:** Docs, transactions, all shared types (Text/Map/Array/XmlFragment/XmlText), state vectors and diffs (`StateVectorV1()`, `StateDiffV1()` ≈ `encodeStateAsUpdate(doc, sv)`), apply-update, observation/events; undo comes from yrs's UndoManager (verify binding coverage for the specific API you need before committing). Known gaps and rough edges (from the tracker):
- **No `mergeUpdates` equivalent** ([#118, opened 2026-01](https://github.com/y-crdt/ydotnet/issues/118)); maintainer: "I have not found anything in the rust implementation. This library is just a wrapper" (yrs's `Update::merge_updates` isn't surfaced through yffi). Practical consequence: compaction in C# = apply the update log into a fresh `Doc` and re-encode `StateDiffV1(null)` — which is also the only route that garbage-collects tombstones, so it's the compaction you'd want anyway.
- Open bugs as of 08/2026: `Text.RemoveRange` can kill the process on out-of-range length; SafeHandle hygiene for subscriptions; server shutdown hangs 30 s with open sockets; SyncStep2 triggers store callbacks even with no change. Nothing disqualifying, but budget for contributing fixes upstream.

**Single-file / NativeAOT (matters for Blok's self-contained Host):**
- The native lib ships per-RID via the three `YDotNet.Native.*` packages; win-arm64 was added 2025-11 (issue closed). Since Blok's Host already publishes self-contained per-RID, each publish pulls exactly one native library.
- `PublishSingleFile` works with native libs either bundled (`IncludeNativeLibrariesForSelfExtract=true`, extracted to a temp dir at first start) or laid beside the exe. Standard P/Invoke (`DllImport`) is NativeAOT-compatible; the only AOT complication would be static linking, which YDotNet doesn't attempt — dynamic per-platform libs are the model. So: native bindings **do** add a per-RID artifact to the publish matrix, but Blok already has that matrix; no blocker.

### C.2 Ycs — dead
[yjs/ycs](https://github.com/yjs/ycs) (pure-C# port): last commit **2023-08-09**, 187 stars, no releases, targets old Yjs v13 encodings with no maintenance since. Do not build on it.

### C.3 Other paths
- **Direct yffi P/Invoke**: possible (yffi is the C ABI YDotNet wraps) but that's just re-writing YDotNet with none of its Server layer. Only worth it to expose missing functions like `merge_updates` — better done as a YDotNet PR.
- **yrs-warp** ([y-crdt/yrs-warp](https://github.com/y-crdt/yrs-warp)): standalone Rust y-websocket server from the y-crdt org — an alternative co-shipped binary, but y-sweet is the more complete packaging of the same idea.
- **Polyglot sidecar fallback** (no C# CRDT code at all): co-ship a second self-contained binary next to the Host. Precedent is strong — y-sweet's entire product *is* "a doc-sync sidecar you run next to your app in any language" (single static binary / Docker image / `npx`); multi-container polyglot sidecars are routine (e.g. Immich's Python ML service beside its Node server). A Node-subprocess-spawned-by-the-Host variant (embedding `@y/websocket-server` or Hocuspocus) is the fragile version of this — it drags a Node runtime into the install and process-supervision into the Host; a second native binary (y-sweet) or a second container is cleaner. Cost of the fallback: the consumer now authorizes docs against a second service's token endpoint, and JSON→Y.Doc seeding needs a JS-side conversion path (see E).

### C.4 SignalR vs raw WebSockets
SignalR is the wrong fit: it wraps connections in its own hub protocol (JSON or MessagePack framing, hub method dispatch, its own handshake/negotiate step), so stock Yjs providers (`y-websocket`, y-sweet provider, BlockNote's expectations) cannot connect; you'd have to write and forever maintain a custom Yjs provider and give up ecosystem compatibility, in exchange for features (groups, reconnect, scale-out backplane) the Yjs protocol already handles at the doc level. The standard answer is **raw `UseWebSockets` middleware speaking y-protocols** — which is literally what `YDotNet.Server.WebSockets` implements ([ASP.NET Core WebSockets docs](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/websockets); [SignalR overview](https://learn.microsoft.com/en-us/aspnet/core/signalr/introduction) for what its protocol layer imposes).

---

## D. How block-based editors integrate Yjs collaboration

### BlockNote (closest analog — Notion-style, ProseMirror-based)
[Collaboration docs](https://www.blocknotejs.org/docs/features/collaboration) (repo healthy: v0.54.0, 2026-08-13):
- Config surface: the `collaboration` option / `withCollaboration` helper takes **`{ provider, fragment: doc.getXmlFragment("document-store"), user: { name, color }, showCursorLabels: "activity" | "always" }`** — i.e., *the consumer constructs the Y.Doc and provider and hands both in*; the editor binds to a named XmlFragment, not the whole doc. This is the config shape Blok should mirror (Blok can go one better since it owns its Y.Doc: accept a provider/connection descriptor and expose the fragment convention).
- Cursors: rendered through y-prosemirror's cursor plugin — colored caret + selection decorations with a name label, driven by the awareness `user` field.
- Recommended servers, verbatim list: **Liveblocks, PartyKit, Y-Sweet, Hocuspocus, y-websocket, y-webrtc (demos only)** — a self-hostable open-source editor recommending exactly the landscape in section B.

### Tiptap / ProseMirror
- v3 renamed `collaboration-cursor` → **[CollaborationCaret](https://tiptap.dev/docs/editor/extensions/functionality/collaboration-caret)** (use the new name). Configured with `user: { name, color }`; it broadcasts via the provider's awareness and renders each remote user's caret + selection as ProseMirror decorations inside contenteditable, label above the caret ([awareness concepts](https://tiptap.dev/docs/collaboration/core-concepts/awareness)).
- The awareness field convention across the whole ecosystem is `awareness.setLocalStateField('user', { name, color })` — y-prosemirror, Tiptap, BlockNote, and Lexical all read that shape. Adopt it verbatim for interop with debugging tools.

### Lexical
- [`CollaborationPlugin`](https://github.com/facebook/lexical/blob/main/packages/lexical-react/src/LexicalCollaborationPlugin.tsx) takes `username` / `cursorColor` / `awarenessData`; remote selections render via the **CSS Custom Highlight API** where available (native-quality selection painting) with positioned-overlay fallback. Note their [discussion #5880](https://github.com/facebook/lexical/discussions/5880): CollaborationPlugin deliberately does not handle initial state — same footgun as section E, left to the app.
- Block-level presence ("avatar on the block someone is editing") has **no ecosystem convention** — apps put a `blockId`/section into their awareness state and render indicators themselves. For Blok: publish `{ user: {name, color}, cursor: …, blockId }` and render per-block presence from awareness — cheap and matches "everything is a block".

### Notion — the non-CRDT counterpoint
Notion does **not** use CRDTs. Per [How Notion Was Built (howworks.ai, 2026-02-25)](https://howworks.ai/blog/how-notion-was-built) and [Notion system design (educative.io)](https://www.educative.io/blog/notion-system-design):
- Every entity is a block (`UUID, type, properties, relationships`) — same law as Blok's.
- Clients are offline-first: **RecordCache** (SQLite/IndexedDB LRU of records) + **TransactionQueue** (pending operation groups). "Operations are grouped into transactions, committed or rejected as a group by the server."
- Clients POST transactions to **`/saveTransactions`**; the server loads the affected blocks, applies operations, validates permissions/coherency against *current* server state, and commits to the source-of-truth DB — server-ordered operational transactions with **last-writer-wins at block/property granularity** as the conflict fallback.
- Committed changes fan out over a WebSocket pub/sub (**MessageStore**); notified clients call `syncRecordValues` to refetch and re-render.
- Why it works: block-tree operations (insert/move/set-property) are coarse-grained and naturally arbitrated server-side; simultaneous character-level edits inside one block are rare enough that LWW on the property is acceptable. The trade: no true concurrent text merging, and a mandatory round-trip for conflict resolution.
- Relevance to Blok: this is the *other* viable architecture, and it maps perfectly to "everything is a block" — but Blok already runs Yjs client-side for state/undo, so the CRDT path is the one that adds no second data model. Worth keeping in mind that Yjs at block granularity (Y.Map of blocks + Y.XmlFragment/Y.Text per block content) gives Notion-style block arbitration *and* character merges.

---

## E. Dual-seeding footgun and cold start

### The footgun
If two clients each seed a Y.Doc from the same JSON snapshot, they generate **different CRDT operations that happen to contain the same content** (different clientIDs/clocks), and the first sync merges them into duplicated content. Canonical write-up: [Initializing a Yjs document with a common value (Moriz Buesing)](https://morizbuesing.com/blog/initializing-a-yjs-document-with-a-common-value/) — "it's okay to initialize a Y.Doc with default content, as long as it's only ever initialized in one location… create the update only once, and store the update." Also reproduced in [yjs-demos #16](https://github.com/yjs/yjs-demos/issues/16) and multiple [discuss.yjs.dev threads](https://discuss.yjs.dev/t/duplication-of-content-when-using-y-websockets/481).

Hocuspocus states it as doctrine in the [persistence guide](https://tiptap.dev/docs/hocuspocus/guides/persistence): **"Do not be tempted to store the Y.Doc as JSON and recreate it as YJS binary when the user connects. This will cause issues with merging of updates and content will duplicate on new connections."**

### The three canonical solutions
1. **Server-authoritative first write** (the robust one): the *server/sidecar* converts JSON → Y.Doc exactly once — at doc creation or on first-ever open — persists the binary, and every client only ever receives CRDT state over the sync protocol. Race-free because the server owns the doc instance and can serialize "first open" per doc.
2. **Seed-only-when-empty after sync**: the client waits for the provider's `synced` event, checks the fragment/map is empty, and only then inserts initial content. This is what the [Liveblocks BlockNote guide](https://liveblocks.io/docs/guides/setting-an-initial-or-default-value-in-blocknote) prescribes, and what BlockNote's `initialContent` does natively ("only used if the current editor has never been edited"). Weakness: two clients passing the empty-check simultaneously on a doc's first-ever open can still double-seed unless the server serializes it.
3. **Store binary from first open**: from the moment a doc becomes collaborative, the Y.Doc update/state (binary) is the source of truth for the CRDT layer; JSON becomes a *derived export* (for the consumer's system of record, search, rendering) and is **never re-imported** into a live doc. Both directions coexist fine: persist binary for sync, emit JSON via the Saver pipeline for the consumer's endpoint.

### How the reference servers do first-ever open
- **Hocuspocus**: `onLoadDocument` is *the* single seeding point — return a Y.Doc hydrated from stored binary, or populate a fresh one from your JSON/template if none exists. One server-side code path per doc ⇒ no race.
- **y-sweet**: `getOrCreateDocAndToken(connectionString, docId)` creates the doc (empty) if missing and mints the client token in one backend call; seeding is done by your backend writing to the doc through the SDK before/independent of clients, or by pattern 2 client-side. The doc thereafter lives as binary in y-sweet's S3 working set; your JSON store stays separate.

### What this means for Blok
- Blok already seeds a client-side Y.Doc from consumer JSON today. The moment a network provider appears, that seeding must become conditional: **only when the synced remote doc is empty — and preferably never on the client at all.**
- The clean sidecar design: consumer's endpoint stores JSON (system of record, unchanged); the sidecar stores the binary sync working set (append log + compacted snapshot, per A.3); on a doc's **first** collaborative open the sidecar performs the JSON→Y.Doc conversion exactly once (this requires a server-side CRDT lib — i.e., YDotNet; a dumb relay cannot do it) and from then on JSON flows *out* of the Y.Doc (debounced save → consumer endpoint), never back in.
- Security note: remote Yjs updates are untrusted input from other collaborators — hostile awareness/content must go through the same render-path sanitization as pasted HTML (Blok has a known open issue here: yjs-sync renders unsanitized remote data). No server choice fixes this; it's a client render-path obligation.

---

## Bottom line for Blok

1. **Primary path**: YDotNet inside the existing C# sidecar — raw ASP.NET Core WebSocket middleware (`YDotNet.Server.WebSockets`) speaking standard y-protocols, so stock JS providers work; Squidex proves it in production; per-RID natives fit the existing self-contained publish matrix. Budget for early-library roughness (no mergeUpdates binding — compact via load-and-re-encode; a few open runtime bugs).
2. **Copy y-sweet's shape**, not its binary (unless the polyglot fallback wins): doc-scoped client tokens minted by the consumer's backend via the sidecar; sidecar owns an S3/filesystem sync working set; consumer endpoint stays the JSON system of record; write-when-dirty persistence; GC toggle.
3. **Minimal-correct-server bar**: y-protocols sync (real SyncStep2 diffs) + awareness relay + append-log-then-compact persistence + connection-time auth. A dumb relay is a legitimate *stepping stone* (full-log initial sync is correct, just heavy) but a CRDT lib server-side is required for state-vector diffs, compaction, and — critically — the one-time JSON→Y.Doc seeding that kills the dual-seeding footgun.
