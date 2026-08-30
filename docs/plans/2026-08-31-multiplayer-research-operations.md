# Research: CRDT working set + system of record, offline, presence, auth, scaling

Web research for Blok self-hosted multiplayer design (2026-08-31). Locked constraints assumed throughout: consumer backend = system of record (JSON, versioned, load/save already exists); C# sidecar sync server holds a working set stored as opaque blob + format/version tag; no hosted service; audience is frontend devs, minimum concepts.

---

## 1. The "CRDT working set + external system of record" pattern in practice

### 1.1 Hocuspocus (the reference implementation of this pattern)

Hocuspocus (Tiptap's open-source Yjs WebSocket server) is built around exactly two hooks:

- **`onLoadDocument`** — called when the first client opens a doc; you return either a `Y.Doc` or a raw `Uint8Array` of Yjs updates fetched from your storage. Returning the raw binary is the recommended form since v4 ([hooks docs](https://tiptap.dev/docs/hocuspocus/server/hooks)).
- **`onStoreDocument`** — called after changes, **debounced** via `debounce` / `maxDebounce` server options (2 s / 10 s class defaults; y-partyserver copies the same 2000 ms / 10000 ms defaults). Since v4 it fires on *any* doc change, including non-WebSocket sources (server-side `DirectConnection` edits). If the hook throws, the document stays in memory and the store is retried, to avoid data loss ([hooks docs](https://tiptap.dev/docs/hocuspocus/server/hooks), [persistence guide](https://tiptap.dev/docs/hocuspocus/guides/persistence)).

**The binary is the primary copy — verbatim warning from the persistence guide:**

> "Do not be tempted to store the Y.Doc as JSON and recreate it as YJS binary when the user connects. This will cause issues with merging of updates and content will duplicate on new connections."

And from the [Database extension docs](https://tiptap.dev/docs/hocuspocus/server/extensions/database): `fetch` must return **the same `Uint8Array` that was saved in `store()`** — "do not create a new Ydoc; that would lead to a new history and duplicated content."

**The recommended dual-write pattern** (SQL row in JSON + binary): inside the *same* `onStoreDocument` (or the Database extension's `store`), write two columns — the `Uint8Array` (authoritative, used by `onLoadDocument`) and a derived JSON/HTML extraction of the same Y.Doc for your app to query/index/render. The JSON column is a **read model**, never read back into the sync path. This is the standard community answer (see e.g. the [Skcript Tiptap+PlanetScale walkthrough](https://www.skcript.com/blog/real-time-editor-tiptap-db-connect), [Emergence Engineering's hocuspocus + Supabase writeup](https://emergence-engineering.com/blog/hocuspocus-with-supabase)).

**Why regenerating from JSON duplicates content** (the mechanics): a Y.Doc rebuilt from JSON is a *new CRDT history* — new client IDs, new item IDs. When a client that holds the old history merges with the rebuilt doc, Yjs treats the rebuilt content as concurrent inserts and you get every paragraph twice. Even generating the seed update "on the server for everyone" fails if you generate it more than once — the fix is to generate the seed update **exactly once** and reuse the identical byte string ([Moriz Buesing: Initializing a Yjs document with a common value](https://morizbuesing.com/blog/initializing-a-yjs-document-with-a-common-value/), [Yjs document-updates docs](https://docs.yjs.dev/api/document-updates)). Real-world symptom thread: [hocuspocus #540 — content disappears/duplicates on reload](https://github.com/ueberdosis/hocuspocus/issues/540).

**Pitfalls answered:**

- *Which is authoritative after a server restart?* The stored Y.Doc binary. `onLoadDocument` loads it; the JSON row is ignored by the sync path. Hocuspocus additionally flushes pending debounced stores in `Server.destroy()` so a graceful shutdown loses nothing ([hooks docs](https://tiptap.dev/docs/hocuspocus/server/hooks)).
- *What if the JSON was edited server-side while the sync server was down?* Hocuspocus has no answer for out-of-band JSON edits — the binary wins and the JSON edit is silently overwritten by the next store. The sanctioned route for server-side edits is to edit **through** the sync server as a Yjs transaction via `openDirectConnection` (server-side connection; edits flow through the same `onStoreDocument`) — see [hocuspocus hooks](https://tiptap.dev/docs/hocuspocus/server/hooks) ("non-WebSocket sources") and issues [#832](https://github.com/ueberdosis/hocuspocus/issues/832)/[#846](https://github.com/ueberdosis/hocuspocus/issues/846) for DirectConnection semantics.

### 1.2 y-sweet (Jamsocket)

[y-sweet](https://github.com/jamsocket/y-sweet) is "a realtime CRDT-based document store, backed by S3" (Rust, MIT, self-hostable, also runnable as `npx y-sweet serve`).

- **Storage**: pass a data dir or `s3://bucket/prefix`; with no dir it keeps docs in memory only ([running.md](https://github.com/jamsocket/y-sweet/blob/main/docs/running.md)). Persistence is periodic checkpointing of the doc state to the store — the store is a *working set dump*, not an app-readable format (it's Yjs binary).
- **Session-backend model**: each active document is loaded by a server process that owns it while clients are connected — "scales horizontally" by distributing docs across backends ([README](https://github.com/jamsocket/y-sweet/blob/main/README.md)); this is Jamsocket's session-backend (per-doc process) architecture.
- **Token flow** (the cleanest published version of the three-party flow): your app backend creates a `DocumentManager(CONNECTION_STRING)` and exposes one auth endpoint. On request it authenticates the user against *its own* permission model, then calls `getOrCreateDocAndToken(docId, { authorization: 'full' | 'read-only', validForSeconds })`. The returned `ClientToken` is `{ url, docId, token, authorization }` — the client hands it to `createYjsProvider` and connects **directly** to the sync server ([SDK source: main.ts](https://github.com/jamsocket/y-sweet/blob/main/js-pkg/sdk/src/main.ts), [types.ts](https://github.com/jamsocket/y-sweet/blob/main/js-pkg/sdk/src/types.ts), [auth endpoint doc](https://docs.jamsocket.com/y-sweet/advanced/auth-endpoint)).
- **Renewal**: `YSweetProvider` takes the auth endpoint itself and "fetches a new client token behind the scenes when the old one expires", including retrying via the auth endpoint after a failed connect ([client docs](https://docs.jamsocket.com/y-sweet/reference/client)).
- **Exporting to the app's own DB**: the server SDK exposes `getDocAsUpdate(docId)` — "returns the entire document as a Yjs update byte string" over HTTP — and `updateDoc(docId, update)` to apply server-side edits *as Yjs updates* rather than JSON rewrites ([SDK main.ts](https://github.com/jamsocket/y-sweet/blob/main/js-pkg/sdk/src/main.ts)). The app pulls the update, hydrates a Y.Doc, serializes JSON, writes its own row. Same shape as hocuspocus, but pull-based instead of hook-based.

### 1.3 Liveblocks (hosted, but the sync-to-customer-DB model is instructive)

- Liveblocks is explicit that **their Yjs store is authoritative** for collaboration; your DB copy is a duplicate: "Liveblocks must store Yjs document data to provide realtime collaboration features" ([Can I use my own database with Yjs?](https://liveblocks.io/docs/guides/can-i-use-my-own-database-with-yjs)).
- Sync-out is via the **`YDocUpdated` webhook**: receive event → fetch latest doc content via server SDK (`withProsemirrorDocument` / `withLexicalDocument` export JSON/markdown/text) → write to your DB. The webhook is **throttled to at most once per 60 s** (down to 5 s on enterprise) — an explicit admission that DB sync-out is a *lagging read model*, not the record ([guide: sync Yjs to Postgres](https://liveblocks.io/docs/guides/how-to-synchronize-your-liveblocks-yjs-document-data-to-a-vercel-postgres-database), [webhooks](https://liveblocks.io/docs/platform/webhooks), [blog: extend Yjs with REST API + webhooks](https://liveblocks.io/blog/extend-the-capabilities-of-yjs-using-our-rest-api-and-webhooks)).
- Server-side edits go through their REST API, which applies changes **as Yjs updates against the live doc** ([Modifying Yjs document data with the REST API](https://liveblocks.io/docs/guides/modifying-yjs-document-data-with-the-rest-api)). Two-way "edit the DB copy and it flows back" is simply unsupported — the guides are one-directional by design.
- Tiptap Cloud's equivalent ([Inject content API](https://tiptap.dev/docs/collaboration/documents/content-injection), [REST API](https://tiptap.dev/docs/collaboration/documents/rest-api)) is the most polished server-side-edit story: you PATCH JSON, the server **diffs your JSON against the live Y.Doc and applies the delta collaboratively** while users keep typing, and the update endpoint is checksum-guarded — "only apply the update if the document hasn't changed since you last fetched it" via checksum headers — i.e. optimistic concurrency on the working set, matching Blok's existing single-player versioning concept.

### 1.4 When working set and system of record disagree — recovery/invalidation patterns

Consensus across sources:

1. **Exactly one representation may accept out-of-band writes.** Yjs guidance is to treat the Yjs model as the thing you never regenerate: rebuild-from-JSON breaks merging for any client holding old state ([hocuspocus persistence](https://tiptap.dev/docs/hocuspocus/guides/persistence), [Moriz Buesing](https://morizbuesing.com/blog/initializing-a-yjs-document-with-a-common-value/)). If the app DB must stay the system of record (Blok's locked decision), then the working-set blob is authoritative *only while it exists*, and every legitimate server-side write path must either (a) go through the sync server as a Yjs transaction (hocuspocus DirectConnection, y-sweet `updateDoc`, Liveblocks/Tiptap REST) or (b) invalidate the working set.
2. **"Delete the working set blob to force re-seed" is the de-facto reset answer — but it is only safe with an epoch/GUID bump.** Deleting the blob alone re-seeds a *new CRDT history*; the first stale client (open tab, y-indexeddb cache) that reconnects will merge its old history in and duplicate or resurrect content. The community pattern for "reset/replace content wholesale" is therefore *new document identity* — a new room name / doc GUID so stale updates can't apply (Yjs forum: [Clear document history and reject old updates](https://discuss.yjs.dev/t/clear-document-history-and-reject-old-updates/945)). Blok's "opaque blob + format/version tag" maps exactly: treat the tag as an **epoch**; a backup restore, migration, or direct JSON rewrite bumps the epoch; the sync server discards any blob with an older epoch and re-seeds once from the system of record; clients discard local caches whose epoch doesn't match.
3. **Seed exactly once.** The re-seed update must be generated one time on the server and stored; never re-derived per connection ([Yjs document-updates](https://docs.yjs.dev/api/document-updates), [Buesing](https://morizbuesing.com/blog/initializing-a-yjs-document-with-a-common-value/)).
4. **Continuous export keeps divergence windows small.** All three systems debounce/throttle JSON extraction to the record store (hocuspocus 2–10 s debounce, Liveblocks 60 s webhook, y-partyserver 2–10 s) and accept that the record trails the working set by that window; on crash, at most the debounce window of *export* is lost while the binary retains everything (hocuspocus flushes on destroy; retries on hook failure).
5. Alternative architectures that dodge the dual-store problem exist but cost more concepts: store the update log itself in the record DB ([PowerSync: Postgres + Yjs](https://powersync.com/blog/postgres-and-yjs-crdt-collaborative-text-editing-using-powersync), [y-redis worker → S3/Postgres](https://github.com/yjs/y-redis/blob/master/README.md)) — rejected for Blok since the record must stay the consumer's plain JSON endpoint.

---

## 2. Offline and reconnect semantics

**What Yjs gives free**: local edits accumulate in the local Y.Doc; on reconnect the sync protocol exchanges state vectors and ships only the diff, merging automatically ([Yjs offline editing guide](https://docs.yjs.dev/getting-started/allowing-offline-editing)). There is no separate "queue" concept to design — the doc *is* the queue.

**y-indexeddb** ([repo](https://github.com/yjs/y-indexeddb), [docs](https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb)):

- Pros: instant document load on revisit (local-first paint before the socket connects); offline edits survive tab close; "replicates state to every peer that ever visited the document", so peers can even re-seed a server that lost data; minimal network on reconnect (diff only). Providers are composable — IndexedDB + websocket run side by side.
- Cons / pitfalls for an embeddable editor:
  - Browser storage is evictable (quota pressure, private windows, "clear site data") — it is a cache, not a guarantee.
  - Per-origin and per-device; the consumer embedding Blok inherits the origin — two Blok-powered apps on one origin must namespace DB names; docs persist after logout unless the integration calls `clearData()` (privacy).
  - Multi-tab writes have had duplication quirks ([y-indexeddb #25](https://github.com/yjs/y-indexeddb/issues/25)).
  - Interacts with §1.4: a stale IndexedDB cache is exactly the client that poisons a re-seeded doc — epoch-tag the local cache too.
  - Read-only users editing offline: the server rejects their updates on reconnect (hocuspocus drops updates from `readOnly` connections), leaving the client with local changes the server never accepted — the UX must surface this, not pretend it saved ([hocuspocus discussion #302](https://github.com/ueberdosis/hocuspocus/discussions/302)).
- [Tiptap's offline-support guide](https://tiptap.dev/docs/guides/offline-support) is literally "add y-indexeddb next to the provider" — this is the standard recipe.

**Messaging patterns in products**: Notion shows a sync indicator (up to date / syncing), marks pages "available offline", surfaces "edited just now" once reconnected sync completes, and is explicit that offline availability is per-device ([Notion: working offline guide](https://www.notion.com/help/guides/working-offline-in-notion-everything-you-need-to-know)). The common vocabulary across products (Notion, Google Docs' "Working offline — changes saved on this device") is: a *connection state* pill (online / offline / reconnecting), a *save state* line ("changes saved on this device, will sync when you're back online"), and automatic merge on reconnect with no user action. Yjs providers expose the needed signals: provider `status` events (connecting/connected/disconnected), y-indexeddb `synced` event, and Tiptap Cloud's `unsyncedChanges` counter for "N unsynced changes" UI ([provider docs](https://tiptap.dev/docs/collaboration/provider/integration)).

---

## 3. Presence & cursors in block editors

### 3.1 Awareness payload conventions

The Yjs **awareness protocol** ([y-protocols PROTOCOL.md](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md), [Yjs awareness docs](https://docs.yjs.dev/getting-started/adding-awareness), [API](https://docs.yjs.dev/api/about-awareness)) is a tiny state-map CRDT, separate from the doc and never persisted:

- Convention: `awareness.setLocalStateField('user', { name, color })` (avatar URL commonly added); editor bindings use the `cursor` field for selection position. Every binding (y-prosemirror, Tiptap, BlockNote, y-codemirror) renders `user.name`/`user.color` above the caret.
- Liveness: a client is marked **offline after 30 s** without updates; clients **re-broadcast their own state every ~15 s**; before disconnecting a client SHOULD broadcast `state = null` (and servers broadcast null for dropped connections) — so cleanup is automatic with a worst-case 30 s ghost.
- Throttling: cursor moves are the chatty part. Liveblocks throttles presence to **one message per 100 ms by default, configurable 16–1000 ms** ([client API ref](https://liveblocks.io/docs/api-reference/liveblocks-client)) — 10 Hz default, 60 Hz max for cursor-chasing UIs. For a text editor, updating awareness on selection-change (not pointermove) plus the 15 s heartbeat is the norm; a ~50–100 ms throttle is the published sweet spot.

### 3.2 Rendering remote carets/selections in contenteditable block editors

Two schools:

- **Editor decorations (the norm for text)**: y-prosemirror's `yCursorPlugin` inserts a **widget decoration** at the mapped position — a `.ProseMirror-yjs-cursor` element (caret drawn with a border, username label div above, colored per `user.color`) — plus inline decorations painting the remote selection range ([y-prosemirror README](https://github.com/yjs/y-prosemirror/blob/master/README.md)). Tiptap's **CollaborationCaret** (renamed from CollaborationCursor) wraps exactly this, with `.collaboration-carets__caret` / `__label` classes and `editor.commands.updateUser({name, color})` ([extension docs](https://tiptap.dev/docs/editor/extensions/functionality/collaboration-caret)). Positions coming from a remote peer are stored in awareness as **Yjs relative positions**, resolved to absolute positions locally, so carets survive concurrent edits. Decorations track reflow/wrapping for free — the main reason they beat overlays inside text.
- **Absolutely-positioned overlays from Range rects**: used for page-level multiplayer cursors (pointer, not text caret) and by canvas-style tools; Liveblocks' cursor examples animate absolutely-positioned elements ([animating multiplayer cursors](https://liveblocks.io/blog/how-to-animate-multiplayer-cursors)). Inside contenteditable this approach must re-measure on every reflow — viable for Blok since it already positions toolbars off Range rects, but it's the more fragile path for character carets.
- **BlockNote** (closest cousin to Blok): collaboration is y-prosemirror underneath; config is `collaboration: { provider, fragment, user: { name, color }, showCursorLabels: 'activity' | 'always' }` — labels flash on activity by default and pin on hover ([BlockNote real-time collaboration docs](https://www.blocknotejs.org/docs/advanced/real-time-collaboration)).

### 3.3 Block-level presence (the Notion model) — the cheap alternative

Notion does **not** render character carets as the primary presence signal: avatars sit at the page top (faded when the person isn't viewing), and a person's avatar appears **next to the block they clicked/are editing, following them block to block**; clicking an avatar jumps to their location ([Notion: collaborate in a workspace](https://www.notion.com/help/collaborate-within-a-workspace)). For a block editor this is dramatically cheaper and fits Blok's architecture: awareness payload carries `{ user, blockId }` instead of a text position — no relative-position mapping, no decoration plugin, renders as an avatar stack + colored outline on the block holder (Blok may write on holders per the child-holder decoration law). Liveblocks ships this as a first-class pattern (avatar stack + "highlighted box around the element being edited", including for AI-agent presence) ([AI Presence quickstart](https://liveblocks.io/docs/get-started/nextjs-ai-presence), [multiplayer overview](https://liveblocks.io/multiplayer)). A sensible v1: block-level presence + per-block avatar stack; character carets later as an opt-in layer.

### 3.4 Read-only viewers/observers

- **hocuspocus**: `onAuthenticate` sets `data.connection.readOnly = true`; the server's MessageReceiver then drops incoming doc updates from that connection while still *sending* updates and awareness — viewer sees live changes and appears in presence, their writes are discarded server-side ([authentication guide](https://tiptap.dev/docs/hocuspocus/guides/authentication), [discussion #302](https://github.com/ueberdosis/hocuspocus/discussions/302)).
- **y-sweet**: the token itself carries `authorization: 'read-only' | 'full'`, enforced by the sync server ([types.ts](https://github.com/jamsocket/y-sweet/blob/main/js-pkg/sdk/src/types.ts)).
- **Liveblocks**: room permission levels via token/room ACLs ([permissions](https://liveblocks.io/docs/rooms/permissions)).
- Client side, pair it with the editor's read-only mode (Blok already has the read-only toggle contract), but **enforcement must be server-side** — the read-only client still participates in awareness so it shows up in the avatar stack.

---

## 4. Auth for collab rooms with a self-hosted sync server

**The standard three-party flow** (identical across y-sweet, Liveblocks, Tiptap Cloud, and hand-rolled hocuspocus):

1. Client asks **the app backend** (the consumer's own server) for access to doc X.
2. App backend checks **its own** permission model — the sync server never knows about users/ACLs.
3. App backend mints a **short-lived, doc-scoped token** (y-sweet: `getOrCreateDocAndToken(docId, {authorization, validForSeconds})` signed against the sync server's secret; Tiptap/hocuspocus: a JWT signed with a shared secret; Liveblocks access token: JWT listing allowed rooms).
4. Client presents the token straight to the sync server on WebSocket connect; the sync server verifies the signature and scope, no callback to the app backend needed.

Sources: [y-sweet auth endpoint](https://docs.jamsocket.com/y-sweet/advanced/auth-endpoint) + [SDK](https://github.com/jamsocket/y-sweet/blob/main/js-pkg/sdk/src/main.ts); [Tiptap auth guide](https://tiptap.dev/docs/collaboration/getting-started/authenticate) and [JWT guide](https://tiptap.dev/docs/guides/authentication); [hocuspocus onAuthenticate](https://tiptap.dev/docs/hocuspocus/guides/authentication); [Liveblocks access-token auth](https://liveblocks.io/docs/authentication/access-token).

**Token contents** (union of what these systems put in):

- doc/room id (or a pattern/list of rooms — Liveblocks access tokens grant room sets),
- permission level: `full` / `read-only` (y-sweet `authorization`; hocuspocus derives readOnly in `onAuthenticate`; Liveblocks permission strings),
- expiry (`exp` / `validForSeconds`),
- user identity for awareness/attribution (`sub`, display name, color, avatar) — y-sweet reserves `userId`; Tiptap JWTs carry user fields into `onAuthenticate` context.

Two permission-model variants worth knowing (Liveblocks names them): **access tokens** — permissions live *in* the token, app backend is the source of truth (fits Blok's locked decision: consumer backend owns permissions); **ID tokens** — token only proves identity, room ACLs live in the sync service, "checked at the door" ([Liveblocks authentication overview](https://liveblocks.io/docs/authentication)). Blok should ship the access-token variant only — one concept.

**Expiry & renewal for long sessions**:

- Tiptap guidance: keep JWTs short-lived (their example: **30 min exp**), and because they offer a revocation API they explicitly advise *not* making tokens too short ([auth guide](https://tiptap.dev/docs/collaboration/getting-started/authenticate)).
- Renewal patterns: (a) y-sweet's provider holds the *auth endpoint URL*, not just a token, and silently re-fetches a token when one expires or a connect is rejected — the app author writes zero renewal code ([client docs](https://docs.jamsocket.com/y-sweet/reference/client)); (b) in-band refresh over the open socket without dropping it (Ably-style, [websocket.org auth guide](https://websocket.org/guides/authentication/)); (c) naive recreate-the-provider — known to be bad UX: cursor state lost, editor deselected mid-typing ([tiptap discussion #4223](https://github.com/ueberdosis/tiptap/discussions/4223)). Recommendation seen in practice: expiry is checked **at connection time**; an established socket outlives its token, and renewal happens on the next (re)connect via pattern (a).
- **Revocation reality**: default everywhere is *kick on next reconnect* — the sync server verifies tokens only at the door, so revoking access takes effect when the socket next drops (deploys, network blips, token-expiry reconnects make this window practical). *Active kick* requires an explicit server feature: Tiptap Cloud exposes a JWT-revocation API; a self-hosted server can track session→doc and force-close connections (hocuspocus lets you close a document's connections server-side). Honest design: short expiry (minutes-to-an-hour) + optional admin "disconnect user from doc" endpoint; don't promise instant revocation otherwise.

---

## 5. Scaling & deployment for a single-container self-hosted sync server

**Per-doc authority is the industry-wide invariant.** Every production Yjs backend routes all traffic for one doc to one authority:

- **Cloudflare Durable Objects / PartyKit**: "all edits to a document route to one object, which serialises them naturally"; each PartyKit party (= room/doc) is backed by one Durable Object ([How PartyKit works](https://docs.partykit.io/how-partykit-works/), [partykit repo](https://github.com/cloudflare/partykit)). y-partyserver's `YServer` adds `onLoad`/`onSave` hooks with `callbackOptions: { debounceWait: 2000, debounceMaxWait: 10000, timeout: 5000 }`, and `onSave` fires both on the debounce and **when the room empties** ([y-partyserver README](https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/README.md)).
- **y-sweet**: session-backend model — each doc gets a server session that owns it; horizontal scale = distribute docs across backends ([README](https://github.com/jamsocket/y-sweet/blob/main/README.md)).
- **hocuspocus**: the official scalability answer is "deploy multiple independent Hocuspocus instances and **split users by document identifier**" — i.e., doc-sharding with routing affinity, not shared state ([scalability guide](https://tiptap.dev/docs/hocuspocus/guides/scalability)). The Redis extension exists for HA, but with a documented anti-goal: "all messages will be handled on **all** instances… if you are trying to reduce CPU load by spawning multiple servers, you should not connect them via Redis" ([Redis extension](https://tiptap.dev/docs/hocuspocus/server/extensions/redis)); it also has known multi-instance hook quirks ([#730](https://github.com/ueberdosis/hocuspocus/issues/730)).
- **y-redis** is the one genuinely stateless design: servers keep no Y.Doc in memory, each room is a Redis stream, and a separate worker persists to S3/Postgres and trims the stream ([y-redis README](https://github.com/yjs/y-redis/blob/master/README.md)). Cost: Redis + worker + stream semantics — three extra concepts, wrong trade for Blok's "near-zero backend" audience.

**Is "one container, one process, docs partitioned in-memory" an acceptable v1? Yes — it's what everyone ships as the default.** `npx y-sweet serve`, single-node hocuspocus, `y-websocket-server`, and PartyKit's one-DO-per-room are all exactly this model. Hocuspocus publishes no connection ceiling, saying only that when you hit "too many connections / network traffic" you go horizontal by doc-splitting ([scalability](https://tiptap.dev/docs/hocuspocus/guides/scalability)); Node/actor WebSocket servers routinely carry thousands of idle-ish editor connections per node, and Yjs server work per keystroke is tiny. The scale-out story to document (not build) for v2: route by doc id (consistent hash / sticky LB on the doc, **not** on the user — two users on one doc must land on the same node), one authority per doc.

**Graceful shutdown expectations** (what peers do, and what a K8s/Docker `SIGTERM` handler should do):

1. Stop accepting new WebSocket upgrades.
2. Flush the working set: hocuspocus `Server.destroy()` "flushes any pending debounced stores on shutdown" ([hooks docs](https://tiptap.dev/docs/hocuspocus/server/hooks)); y-partyserver fires `onSave` when rooms empty; failed stores keep the doc in memory and retry rather than drop.
3. Close connections with a normal close code; clients' providers auto-reconnect with backoff and re-sync via state vectors — Yjs makes redeploys forgiving because every client still holds the full doc; worst case after a *hard* kill is losing the debounce window of the working-set blob, and even then clients re-seed the server on reconnect (the y-indexeddb "peers restore the server" property, [Yjs offline docs](https://docs.yjs.dev/getting-started/allowing-offline-editing)).
4. For Blok specifically: the flush must write both the opaque blob (fast, always) and trigger the debounced JSON `save()` to the consumer endpoint, so the system of record is no staler than one debounce window at shutdown.

---

## Source index

- Hocuspocus: [hooks](https://tiptap.dev/docs/hocuspocus/server/hooks) · [persistence](https://tiptap.dev/docs/hocuspocus/guides/persistence) · [Database ext](https://tiptap.dev/docs/hocuspocus/server/extensions/database) · [Redis ext](https://tiptap.dev/docs/hocuspocus/server/extensions/redis) · [scalability](https://tiptap.dev/docs/hocuspocus/guides/scalability) · [authentication](https://tiptap.dev/docs/hocuspocus/guides/authentication) · [readOnly discussion #302](https://github.com/ueberdosis/hocuspocus/discussions/302) · [#540](https://github.com/ueberdosis/hocuspocus/issues/540) · [#730](https://github.com/ueberdosis/hocuspocus/issues/730)
- y-sweet: [repo](https://github.com/jamsocket/y-sweet) · [running.md](https://github.com/jamsocket/y-sweet/blob/main/docs/running.md) · [SDK main.ts](https://github.com/jamsocket/y-sweet/blob/main/js-pkg/sdk/src/main.ts) · [SDK types.ts](https://github.com/jamsocket/y-sweet/blob/main/js-pkg/sdk/src/types.ts) · [auth endpoint](https://docs.jamsocket.com/y-sweet/advanced/auth-endpoint) · [client](https://docs.jamsocket.com/y-sweet/reference/client)
- Liveblocks: [own DB with Yjs](https://liveblocks.io/docs/guides/can-i-use-my-own-database-with-yjs) · [Yjs→Postgres guide](https://liveblocks.io/docs/guides/how-to-synchronize-your-liveblocks-yjs-document-data-to-a-vercel-postgres-database) · [webhooks](https://liveblocks.io/docs/platform/webhooks) · [REST+webhooks blog](https://liveblocks.io/blog/extend-the-capabilities-of-yjs-using-our-rest-api-and-webhooks) · [modify Yjs via REST](https://liveblocks.io/docs/guides/modifying-yjs-document-data-with-the-rest-api) · [authentication](https://liveblocks.io/docs/authentication) · [access tokens](https://liveblocks.io/docs/authentication/access-token) · [client API (throttle)](https://liveblocks.io/docs/api-reference/liveblocks-client) · [AI presence](https://liveblocks.io/docs/get-started/nextjs-ai-presence)
- Tiptap Cloud: [auth](https://tiptap.dev/docs/collaboration/getting-started/authenticate) · [JWT guide](https://tiptap.dev/docs/guides/authentication) · [content injection](https://tiptap.dev/docs/collaboration/documents/content-injection) · [REST API](https://tiptap.dev/docs/collaboration/documents/rest-api) · [provider](https://tiptap.dev/docs/collaboration/provider/integration) · [CollaborationCaret](https://tiptap.dev/docs/editor/extensions/functionality/collaboration-caret) · [offline support](https://tiptap.dev/docs/guides/offline-support) · [token update #4223](https://github.com/ueberdosis/tiptap/discussions/4223)
- Yjs core: [offline editing](https://docs.yjs.dev/getting-started/allowing-offline-editing) · [y-indexeddb](https://github.com/yjs/y-indexeddb) · [document updates](https://docs.yjs.dev/api/document-updates) · [awareness](https://docs.yjs.dev/getting-started/adding-awareness) · [y-protocols PROTOCOL.md](https://github.com/yjs/y-protocols/blob/master/PROTOCOL.md) · [y-prosemirror](https://github.com/yjs/y-prosemirror/blob/master/README.md) · [y-redis](https://github.com/yjs/y-redis/blob/master/README.md) · [reset thread](https://discuss.yjs.dev/t/clear-document-history-and-reject-old-updates/945) · [seeding pitfall](https://morizbuesing.com/blog/initializing-a-yjs-document-with-a-common-value/)
- PartyKit/DO: [how PartyKit works](https://docs.partykit.io/how-partykit-works/) · [y-partyserver README](https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/README.md)
- Products: [BlockNote collaboration](https://www.blocknotejs.org/docs/advanced/real-time-collaboration) · [Notion working offline](https://www.notion.com/help/guides/working-offline-in-notion-everything-you-need-to-know) · [Notion collaborate](https://www.notion.com/help/collaborate-within-a-workspace) · [websocket.org auth](https://websocket.org/guides/authentication/) · [PowerSync Yjs+Postgres](https://powersync.com/blog/postgres-and-yjs-crdt-collaborative-text-editing-using-powersync)
