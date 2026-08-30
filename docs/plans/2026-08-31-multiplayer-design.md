# Blok Multiplayer — Design

Companion research (same date, full citations and file:line evidence):
`2026-08-31-multiplayer-research-client-crdt.md` (the existing Yjs layer, verified gaps),
`2026-08-31-multiplayer-research-server-wiring.md` (Blok.Server seams and constraints),
`2026-08-31-multiplayer-research-landscape.md` (sync-server landscape, .NET options),
`2026-08-31-multiplayer-research-operations.md` (persistence, presence, auth, scaling).

## Goal

Two people open the same document and see each other's edits live, with presence
showing who is where — while the consumer writes near-zero backend code, learns as
few concepts as possible, and their own endpoint remains the system of record for
documents. Blok hosts nothing.

The same two costs as the backend-service design are first-class and weighted
equally: lines the consumer writes, and concepts they must learn. The target
consumer experience, in full:

```ts
new Blok({
  holder: 'editor',
  server: 'https://myapp.com/api/blok',      // exists today
  ticket: '/api/blok-ticket',                 // exists today
  collaboration: {
    doc: 'article-42',                        // the ONE new concept
    user: { name: 'Jack', color: '#f60' },    // shown to other people
  },
});
```

```bash
npx @bloklabs/server --auth ticket --collab \
  --doc-endpoint https://myapp.com/api/documents   # their existing save/load routes
```

## Scope

**In scope:** real-time sync of one document between clients; presence (who is
here, which block they are editing); read-only participants; the working-set
store; seeding and export against the consumer's endpoint; per-document access
enforcement; the client fixes multiplayer depends on.

**Deferred, architecture must not preclude:** character-level text merging
(carets inside text), offline persistence across page reloads (y-indexeddb),
horizontal scale-out, server-side programmatic edits ("edit through the sync
server" API).

**Dropped, not deferred:** document listing, version history, per-document
sharing UI, comments-as-a-service. All of it is the consumer's records and
permissions — the ownership line from the backend-service design stands.

## Decisions

| Decision | Rationale |
|---|---|
| Sync lives in **Blok.Server** (the existing C# sidecar), built on **YDotNet** | YDotNet is the y-crdt org's own .NET binding to yrs (MIT, v0.6.0 02/2026, issues triaged through 08/2026); Squidex runs it in production including `YDotNet.Server.WebSockets`. Per-RID native packages fit the self-contained single-file publish matrix the Host already has. One service to run stays one service to run. |
| Wire protocol is **standard y-protocols over raw WebSocket** | Every provider in the ecosystem speaks it; YDotNet's middleware implements it and the stock `y-websocket` JS client connects unchanged — which is also how we conformance-test the server. SignalR's hub framing would orphan us from the ecosystem. |
| **Copy y-sweet's shape**: consumer backend mints short-lived doc-scoped passes; sidecar owns a working set in its own storage; consumer endpoint stays the JSON system of record | The three-party access-token flow is universal (y-sweet, Liveblocks, Tiptap, hocuspocus). It is also exactly Blok's existing `ticket` flow with the `doc` claim restored — the claim the C# verifier still parses today. |
| **Server-authoritative seeding, exactly once** | Rebuilding a Y.Doc from JSON per client duplicates content on first sync (hocuspocus documents this as doctrine; the current client load path has this bug armed — see §2). Only a server-side CRDT lib can serialize "first open" per doc. This kills the dumb-relay option for v1. |
| **Doc schema v2 before anything persists**: blocks keyed by id, order as data | Today's Y.Array move is delete + reinsert-a-clone: a concurrent edit to a moved block is silently lost, and two concurrent moves duplicate the block. Must be fixed at the schema level, and it is free to change now — the Y.Doc is rebuilt from JSON on every load and never leaves the process. The first persisted blob freezes the format. |
| **Block-level presence, not character carets, in v1** | Blok stores text as plain-string LWW registers (no Y.Text). Character carets need Yjs relative positions, which need Y.Text; carets over LWW strings would jump and lie. Block-level presence (avatar on the block being edited) is Notion's own model and matches the actual merge granularity. |
| **Merge granularity v1 = per block field** (concurrent same-field text edits: last writer wins) | Matches the existing CRDT layout (field-level map merge, whole-string text values). Notion ships the same granularity. Stated honestly in docs. Y.Text upgrade is a format-tag bump later, not a rewrite. |
| **No hosted service. No second sidecar.** | Unchanged from the backend-service design. The polyglot fallback (co-shipping y-sweet's binary) would give consumers two token systems and two services; rejected while YDotNet is viable. |

---

## 1. What already exists, and what the research changed

The document **is already a CRDT**: one `Y.Doc` per editor, a flat
`Y.Array('blocks')` of `Y.Map`s (`id`, `type`, nested `data` map, `parentId`,
`contentIds`), driving state and undo (`src/components/modules/yjs/`,
`src/components/modules/blockManager/yjs-sync.ts`). Remote-origin handling
exists and is load-bearing: any unknown transaction origin classifies as
`'remote'`, is applied to the DOM, and is excluded from undo
(`trackedOrigins: {'local'}`). A provider gets correct apply-and-undo semantics
with zero changes to the observer or undo layers.

The server side has a **dormant seam built for exactly this feature**:
`IBlokAuthorization.CanReadDocumentAsync/CanWriteDocumentAsync(user, documentId)`
sits in Blok.Server.AspNetCore, registered only via `UseAuthorization<T>`,
consumed by nothing, pinned unused-by-default by a test. The ticket verifier
still parses the `doc` claim; commit ce3cf61a removed only the *signer option*,
because nothing carried a document identity to enforce against — and its message
names "a future collaboration room key" as what enforcement must agree with.
The room key is that identity.

What the research **ruled out**:

- *Dumb relay* (no server-side CRDT): correct but degenerate — late joiners
  download the full update log (measured multi-MB, multi-second loads in the
  wild), no compaction, and no way to seed server-side. Nextcloud Text ships
  this in PHP and carries the scars.
- *Notion-style server-arbitrated transactions* (no CRDT at all): maps to
  "everything is a block", but Blok already runs Yjs client-side for state and
  undo — the CRDT path adds no second data model, the Notion path adds one.
- *Node sync server* (hocuspocus et al.): a second runtime in the install and a
  second service for the consumer; the C# path keeps the sidecar singular.
- *y/hub* (ex y-redis): the best relay/compactor architecture blueprint, but
  AGPL-3.0 — reference only, never embedded.

## 2. Client: five fixes before any network exists

Each is independently shippable; none waits for the server. File:line evidence
in the client-crdt research doc.

**2a. Sanitize the remote render path** (the known open hole). Block data read
off the shared doc reaches `block.setData` → `innerHTML` and three
`composeBlock` paths with no sanitize pass. Mirror the renderer's load path
(`sanitizeBlocks` + `stripUnsafeUrlsDeep`) at the three read sites in
`yjs-sync.ts` (`handleYjsUpdate` :427, `handleYjsAdd` :601, `handleYjsBatchAdd`
:730), gated to remote origin. A hostile collaborator's update must be exactly
as powerless as hostile pasted HTML. Regression tests drive the Y.Doc directly.

**2b. Fix the two verified reconciler blind spots.** (1) A remote write into a
*nested* data map (e.g. `data.style.color`) emits no event at all —
`findParentBlock` only matches maps directly under a block; walk `event.path`
instead. (2) A remote root-promotion (deleted `parentId` key) is invisible to
`handleYjsUpdate`'s `yblock.has('parentId')` gate. Both are silent desyncs
today only because nothing remote exists.

**2c. Doc schema v2 — order as data.** Replace `Y.Array('blocks')` with:

- `Y.Map('blocks')`: id → block `Y.Map` (same per-block keys as today).
  A block's map is **never deleted-and-recreated**; it lives as long as the
  block. Moves stop destroying identity, so a concurrent remote edit to a moved
  block merges instead of vanishing, and concurrent moves converge (the order
  writes race; the block exists once).
- `Y.Array('root')`: ids of top-level blocks, in order. Children keep ordering
  in `contentIds` exactly as today — the CRDT keeps mirroring the public JSON
  model rather than inventing a second hierarchy. (Fractional order keys were
  considered and rejected: they'd diverge the doc from the `contentIds` shape
  the whole codebase and public format speak.)
- Concurrent moves of the same id can duplicate the id *string* in an order
  array (each mover deletes+reinserts the value). Ids are values, so this is
  detectable and deterministic: **dedupe on read, first occurrence wins**, one
  law test. An id present in no order array renders at the end rather than
  disappearing (mirror of the existing dangling-parent tolerance).
- Undo's move stacks currently store absolute indices and break under remote
  interleave; with order-as-data they record "id X back to parent P after
  sibling S", which survives concurrent edits. This collapses two recorded
  undo-breakage classes.
- **Bandwidth hotspot, same schema pass:** arrays are atomic in the current
  serializer, so a table's entire 2-D cell grid is ONE value — editing a cell
  re-broadcasts the whole grid (a large table makes every keystroke cost tens
  of KB, and concurrent edits to *different cells* clobber each other, the
  worst of both worlds). Store the grid as nested maps (row → cell) so an edit
  sends one cell and merges per cell. Ordinary text is fine unfixed — a
  whole-field update of a 1–2KB paragraph a few times a second is noise — but
  local doc writes during typing must be **coalesced on a short window**
  (aligned with the existing 400ms mutation batch) rather than fired per input
  event, so traffic scales with typing sessions, not keystrokes. Per-character
  updates arrive with Y.Text later; they are the same change as per-character
  merging.

This is the one structurally invasive client change, and it is **free only
now**: the doc format today is ephemeral (rebuilt from JSON each load, never
serialized). The first persisted working-set blob freezes it under the format
tag. Ship v2 before Phase 3 persists anything.

**2d. Binary-only provider seam.** yjs is *bundled* into dist, so handing a
host's provider the raw `Y.Doc` crosses two yjs module instances (the
documented dual-import footgun). The seam on `DocumentStore`, delegated through
`YjsManager`, is binary: `applyRemoteUpdate(update, origin)`,
`onUpdate(cb)` (filtering out remote-applied echoes), `getStateVector()`,
`encodeStateAsUpdate(sv?)`. The `LocalOriginTag` type barrier stays; remote
updates enter under a provider origin that classifies as `'remote'` for free.
Unhook in `destroy()` before `ydoc.destroy()`.

**2e. Sync-first load.** With `collaboration` set, the editor must NOT run
today's load path (fromJSON-seed from `config.data`/persistence) — two clients
doing that and then syncing permanently duplicates every block in the CRDT
(verified; the DOM masks it, the doc corrupts). Instead: connect; the initial
sync delivers the doc; blocks materialize through the existing remote path
(`repaintBlocks`/`skipYjsSync` levers exist). The client never seeds.
`persistence` and `collaboration` are mutually exclusive config (validated with
a clear error): in collab mode the sidecar owns the record round-trip (§4), and
the client save queue stays off.

**When the sync server is unreachable** (down, or the connect fails), the
editor must not become a blank page — that would make collab mode LESS
available than single-player. Degradation: if the host passed `config.data`
(or it is otherwise cached), render it **read-only** as the last-known
snapshot, with the connection state exposed so the host can show "reconnecting";
retry with backoff; on first successful sync, swap to the live doc. Never fall
back to *editable* unsynced content — edits made against a locally-seeded doc
would fork CRDT history and recreate the dual-seeding corruption on reconnect.
Offline *editing* arrives with the epoch-tagged y-indexeddb cache in Phase 4,
where local history is genuinely part of the doc rather than a fork.

## 3. Server: rooms in Blok.Server

**Registration and gating.** `/sync/{doc}` joins `MapBlokServer` behind a new
`options.HasCollab` predicate, exactly as upload routes gate on `HasStorage`.
Host adds `UseWebSockets()`; the endpoint explicitly disables the 10-minute
request-timeout policy and reconciles the 2-minute Kestrel keep-alive with
protocol-level ping/pong. Off by default; `--collab` (plus working-set storage
and `--doc-endpoint`) turns it on. The process refuses misconfigured
combinations at startup, in the existing refuse-don't-warn style.

**Room model.** One in-process authority per open doc: first connection loads
the working set (or seeds, below) into a YDotNet `Doc`; connections exchange
standard SyncStep1/SyncStep2/Update; awareness messages relay verbatim (never
persisted, never decoded). Last connection closing schedules the doc's eviction
after a flush. One process, docs partitioned in memory — the same v1 every peer
ships (y-sweet, single-node hocuspocus, one-Durable-Object-per-room). Scale-out
is documentation, not code: shard by doc id so one doc's clients land on one
node; never fan a doc across nodes.

**Auth at the door, via subprotocol.** Browsers cannot set arbitrary headers on
WebSocket connects, but they CAN set `Sec-WebSocket-Protocol` — and the stock
`y-websocket` client exposes it as its `protocols` option. The client offers
`['blok-sync.v1', <ticket>]`; the server validates the ticket from the offer
list, accepts with `blok-sync.v1`, or closes with the auth-failed code. The
ticket stays out of URLs (query-string tickets leak into access logs), and
ecosystem compatibility survives in BOTH modes — no Blok-only handshake.
(A base64url ticket is a valid subprotocol token; the unpadded alphabet plus
dots is within RFC 6455's token grammar.) Verification: existing `TicketVerifier`;
**the `doc` claim returns to `blokTicket()`** and the sync handshake requires
`claims.Document == {doc}` — the first route that ever enforces it, which is
what its removal commit said to wait for. `write: false` connections receive
everything and their doc updates are dropped server-side (read-only viewers
still appear in presence); the client pairs this with read-only mode, but
enforcement is the server's. The in-process ASP.NET path consumes
`IBlokAuthorization` at the handshake — the dormant seam's first consumer.
Tickets are verified at connect only; a connection outlives its pass, and
renewal happens through the existing client pass source on reconnect.
Revocation is honestly "takes effect on next reconnect"; TTL guidance moves
from 5 minutes to ~30 for collab passes.

**Working set store.** The recorded decision implemented: a new small contract
(not `IBlobStore`, whose put-returns-public-URL shape is wrong for this) —
`read(docId) → {blob, tag}?`, `write(docId, blob, tag)`, `delete(docId)` — with
local-directory and S3 drivers reusing the existing S3 machinery. The blob is
an append log of updates, compacted by loading into a fresh `Doc` and
re-encoding full state (YDotNet has no `mergeUpdates` binding; load-and-re-encode
is also the only route that garbage-collects tombstones, so it is the compaction
we want anyway). The **tag is `{format, epoch}`**: `format` names the doc
schema (`1` = schema v2 from §2c), `epoch` is the re-seed counter (§4).

**Limits and lifecycle.** The existing fixed-window limiter counts the
handshake; the sync endpoint adds its own per-user connection cap and a
max-message-size cap. Graceful shutdown becomes real: on SIGTERM, stop
accepting upgrades, flush every open doc's working set and JSON export, close
sockets with a going-away code (clients auto-reconnect and re-sync from their
own state — redeploys are forgiving by protocol design). This lands with an
actual SIGTERM host test; today's host tests only ever `Kill`, and the .NET
timing law applies (assert timeouts, never sub-second completion).

**Wire conformance.** The contract is pinned the way the ticket contract is
pinned: the conformance suite drives a **stock `y-websocket` JS client** against
the built server binary — in no-auth loopback mode AND in ticket mode via the
`protocols` option — two clients, concurrent edits, late joiner, read-only
drop, reconnect diff. If the stock provider syncs, every ecosystem tool syncs.

## 4. The record round-trip: seeding and export

The sidecar is configured with the consumer's existing document endpoint
(`--doc-endpoint`) — the same load/save routes the single-player `persistence`
key speaks today, so a consumer graduating from single-player to multiplayer
rewrites zero backend code.

**Seed once, server-side.** On a doc's first-ever open (no working-set blob):
fetch JSON from the consumer's endpoint, convert JSON → Y.Doc **exactly once**
inside the room authority (serialized per doc by construction), persist the
blob. Clients only ever receive CRDT state. This is the canonical kill for the
dual-seeding footgun, and it is possible precisely because the doc's block data
is plain maps — the conversion is structural, no tool code, no JS runtime.

**Export continuously.** On a debounced interval (and on last-disconnect and on
shutdown flush), the room authority derives `OutputData` JSON from the doc —
again purely structural — and POSTs it to the consumer's save endpoint with the
version handling the persistence contract already defines. The record trails
the working set by the debounce window; every shipped system accepts exactly
this (hocuspocus 2–10s, Liveblocks 60s webhook). Stated limit: server-derived
JSON is the CRDT truth, without per-tool `save()` normalization the DOM path
applies.

Both directions go to an operator-configured endpoint — the same trust class as
the S3 driver, and the same architecture-test exemption discipline: one more
documented owner beside the guarded outbound client, nothing else.

**How the sidecar authenticates to the consumer's routes:** the operator
supplies the header value their app already expects
(`BLOK_DOC_ENDPOINT_AUTH="Bearer …"`, sent verbatim on seed fetches and
export POSTs). Their route, their auth scheme, zero new concepts — the same
shape as the client-side `fetchStorage` headers option. A self-minted
server-to-server ticket (signed with `BLOK_SECRET`) was considered and set
aside: it would force verification code into the consumer's endpoint, which is
a new concept for them and nothing gained for us.

**When they disagree.** While a working-set blob exists, the blob is
authoritative and out-of-band JSON edits are overwritten by the next export —
the industry-wide answer, documented plainly. The lever is **epoch bump**:
`POST /sync/{doc}/reset` (write ticket required) discards the blob, bumps
`epoch` in the tag, and re-seeds from the consumer's JSON. Clients learn the
epoch at handshake; a client holding state from an older epoch discards it and
resyncs fresh instead of merging stale history back in — the guard that makes
"delete the blob to re-seed" safe against open tabs.

## 5. Presence

Standard awareness protocol (pure relay). Local state:
`{ user: { name, color }, blockId }` — the ecosystem's `user` field convention
verbatim (debug tooling reads it), plus the block being edited. Rendering:
avatar stack and a colored outline on that block's **holder** — the child-holder
decoration law already permits exactly this write, and it needs no relative
positions, no decorations inside contenteditable, no per-character mapping.
Heartbeat/timeout per protocol defaults (15s/30s, null on disconnect);
selection-driven updates throttled ~100ms. Character carets are the format-tag
upgrade that arrives with Y.Text, not before.

The editor exposes connection state (`connecting/connected/offline` + peers)
through the existing events dispatcher so hosts can render a sync pill;
Blok ships the block-presence rendering itself.

## 6. Config surface

One new key: `collaboration: { doc, user? }` (absent = everything off, zero
cost). `server` and `ticket` are reused as-is — sync URL derives from `server`
the way upload/unfurl URLs do; the pass source already coalesces and refreshes
mints. Per the config-key law this is four edits (types + react keys + vue keys
+ vue prop), plus adapter parity for the three frameworks. The provider itself
is internal (a thin y-protocols client over WebSocket with reconnect backoff —
y-protocols is small and MIT; bundle like yjs, and the dist-weight pin will
hold the line).

## 7. Delivery and phasing

Same artifacts, no new packages: NuGet (`AddBlokServer().AddCollab()` -ish
surface), npx binary, GHCR image. Every phase lands green and releasable alone.

- **Phase 0 — hardening (start now, independent of everything):** sanitize the
  remote path (§2a), fix the two reconciler blind spots (§2b). These are
  correctness fixes on code that already exists; they also de-risk the yjs-sync
  memory item that predates this design.
- **Phase 1 — doc schema v2 + seam (client-internal, no wire):** §2c and §2d,
  behind the existing test surface (yjs-sync/undo/observer suites are large).
  No behavior change for single-player users.
- **Phase 2 — server rooms:** YDotNet spike first (musl/arm64 natives across
  all 8 publish targets + single-file extraction — the one genuinely unproven
  packaging step), then rooms, auth, working set, seed/export, drain,
  conformance suite.
- **Phase 3 — the feature:** client provider, `collaboration` key, sync-first
  load, presence UI, docs (four consumer paths each get their collab story;
  `own-storage` honestly states sync needs the service, like previews).
  First persisted blob ⇒ format tag frozen.
- **Phase 4 — later, by demand:** y-indexeddb offline cache (epoch-tagged),
  Y.Text/character carets (format bump), scale-out guide, server-side edit API.

KB is the natural first consumer and dogfood target.

## 8. Risks

- **YDotNet is early** (self-described; no `mergeUpdates`, a few open runtime
  bugs, ~2 releases/year). Mitigations: Squidex production precedent; the
  conformance suite is our own safety net; budget upstream PRs; the Phase 2
  spike validates packaging before anything depends on it. This is the same
  "security-critical dependency in a language we don't write daily" risk the
  backend design accepted, with the same answer: keep our layer tiny, test the
  contract, keep the emergency lever (`--collab` off is one flag).
- **Yjs v14 is brewing** (y-websocket's main targets it). We pin v13 bundled;
  yrs/YDotNet speak the v13 lib0 encoding; the ecosystem's own guidance is to
  stay on v13 for now. Watch item, not blocker — the conformance suite is what
  tells us when v14 becomes real.
- **Schema v2 touches undo/yjs-sync internals** — the highest-regression-risk
  client work. Mitigation: it ships alone (Phase 1), behind existing suites,
  before any wire or blob exists to be compatible with.
- **LWW text granularity** will eventually disappoint a consumer expecting
  Google-Docs merging inside one paragraph. Stated in docs from day one;
  Notion-parity is the honest v1 claim.
- **The sidecar gains state.** Backups of the working set are the operator's
  (documented); losing the working set loses at most the export debounce window
  of record-visible content, and connected clients re-seed the server on
  reconnect by protocol design.

## Non-goals, stated explicitly

- No hosted sync service, free or paid.
- No document listing, history, or sharing model — the consumer's records, the
  consumer's permissions. The `doc` id is an opaque string we never interpret.
- No second sidecar binary and no per-language sync servers.
- No character carets in v1, and no pretending otherwise.
- No horizontal scaling machinery in v1 — a documented sharding pattern only.
- No CRDT decoding of awareness server-side, no persistence of presence.
- No anti-abuse arms race beyond connection/message caps and tickets.
