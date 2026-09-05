# Acknowledged Operation Persistence — Design

**Date:** 2026-09-01  
**Status:** Approved direction; implementation is dependency-gated  
**Builds on:** `docs/plans/2026-08-31-multiplayer-design.md` and the closed Phase 4 plan  
**Supersedes:** only those older documents' decisions to drop operation history and to treat continuous whole-JSON export as the collaboration durability path. Consumer record ownership, authorization, listing, and sharing stay outside Blok.

## Goal

Give Blok one reliable save path for collaborative and single-user documents:
small Yjs operations go through the collaboration transport, the browser keeps
unacknowledged work, the server records each accepted operation durably, and the
client removes it from the outbox only after an exact acknowledgement.

The same durable journal is the foundation for version history. It records the
authenticated actor when one exists, when the server committed the operation,
and its stable order. A later
history UI can replay that journal without inventing a second capture system.

A single user gets this path by opening a document through collaboration with one
member. The existing whole-JSON `persistence` option remains a compatibility
path; it is not renamed or silently changed.

## Plain-language model

1. The editor produces a Yjs update.
2. Blok gives it a random operation ID.
3. With offline storage enabled, Blok commits the update and operation ID to
   IndexedDB before the socket may send it. Without offline storage, the same
   queue lives in memory.
4. The server checks the user, document lineage, ID, size, and update.
5. The server appends an attributed record to the durable operation journal.
6. Only after that commit may the server broadcast the update and acknowledge
   the exact operation ID.
7. The client deletes only that acknowledged outbox row.
8. A whole-document JSON export is a later projection, not the save receipt.

A lost connection can repeat steps 4–7. The operation ID makes retry safe.

```text
editor change
    │
    ▼
local outbox ── retry same operation ID ───────────────┐
    │                                                  │
    ▼                                                  │
blok-sync.v2 operation                                 │
    │                                                  │
    ▼                                                  │
auth + lineage + duplicate check                       │
    │                                                  │
    ▼                                                  │
durable operation journal ── commit ──► broadcast     │
    │                                      │           │
    └──────── exact ACK ◄──────────────────┘           │
                 │                                      │
                 └── delete exact outbox row ───────────┘
```

## Guarantees and non-guarantees

### What an acknowledgement means

A `blok-sync.v2` acknowledgement means all of these are durable in the
configured operation store:

- the document and lineage;
- the exact operation ID and payload digest;
- a server-assigned, gap-free sequence within that lineage;
- the authenticated actor, if the connection has one;
- the server commit time and source;
- the raw Yjs update needed to replay the operation.

The same operation ID and same digest is a duplicate: it receives an
acknowledgement and is not applied or recorded twice. The same ID with different
bytes is a terminal conflict.

### What an acknowledgement does not mean

It does not mean:

- every peer has received the broadcast;
- the operation won every CRDT conflict;
- the consumer's whole-JSON projection has completed;
- the browser has made origin storage immune to eviction;
- a visible DOM edit and its asynchronous IndexedDB write were one atomic act;
- an intentional reset can never start a new history.

`connected` continues to mean “live and content-synced.” It never means “all
local edits are saved.” Save state is reported separately, inside the same
status event, with its own `reason`. A broken local store or a rejected
operation is not a terminal connection reason: the socket can still receive.

### Local durability boundary

IndexedDB cannot be committed synchronously with a Yjs mutation. The honest
client guarantee is narrower:

- an edit becomes visible first;
- Blok immediately starts the outbox transaction;
- Blok never sends that operation before `IDBTransaction.oncomplete`;
- `saved` is impossible while a local append or server acknowledgement is
  outstanding.

If IndexedDB fails, Blok keeps the current tab's data in memory, sends nothing,
blocks further editing, and reports that an export/recovery action is required.
`pagehide` remains a best-effort flush, not a power-loss guarantee.

## One operation identity, two orders

Each local Yjs update gets one CSPRNG-generated 128-bit `operationId`, encoded as
32 lowercase hexadecimal characters. It is persisted with the bytes before the
first send and never regenerated on retry.

There is deliberately no protocol-level browser counter, replica lease, or tab
leader:

- IndexedDB has a local auto-increment `localOrder` for FIFO draining.
- Multiple tabs may send the same oldest row.
- The server deduplicates the exact operation ID.
- The server assigns `serverSequence`, a `uint64` that totally orders committed
  records inside one document lineage.
- `serverSequence` travels to JavaScript as a decimal string, never a JS number.

The operation journal is retained for history, so its exact ID index already is
the durable dedupe ledger. A separate client high-water protocol would add gaps,
counter recovery, and writer namespaces without reducing retained history.

## Durable record and checkpoint model

A committed operation has this logical shape:

```text
OperationRecord {
  documentId
  lineage
  operationId
  serverSequence
  actorId?          // server-derived
  committedAt       // server clock
  source            // client-v2 | client-v1 | http-edit
  update             // raw Yjs update
  digest             // SHA-256 of update
}
```

For `source = http-edit` the digest covers the canonical request body rather
than the derived update: the update bytes depend on the room's per-load random
Yjs client id, so a retried edit against a recreated room would otherwise be
mistaken for an ID conflict.

The head for a document contains:

```text
DocumentHead {
  format
  epoch
  lineage
  durableThrough
  checkpointThrough
  checkpoint
  fence
}
```

The journal is authoritative. A checkpoint is only a replay accelerator and a
materialization source. Publishing a checkpoint must never remove operation
history or its idempotency metadata.

Initial seeding is the sequence-zero baseline. Reset atomically creates a new
epoch and lineage with a new sequence-zero baseline; old-lineage operations
remain history but can never be replayed into the new lineage.

## Client design

### Storage consent and identity boundary

`collaboration.offline` remains opt-in because it writes document content to
origin-scoped disk. Reliable server acknowledgements work without it, using an
in-memory outbox, but pending work then does not survive a reload, so memory
mode warns on `beforeunload` while rows are pending, exactly as the legacy
`persistence` queue does.

Offline mode also requires a new host-supplied `offlineScope` string. It is an
opaque, stable partition for the signed-in identity, not an authorization claim.
The database namespace is:

```text
server URL + document id + offlineScope
```

Lineage stays in metadata and on every row. Keeping it out of the database name
lets one IndexedDB transaction quarantine the old lineage and adopt the new one.
The scope prevents one person's pending operation from being replayed under the
next person's refreshed ticket on a shared browser. Ticket hashes are unsuitable
because tickets rotate; display/presence identity is unsuitable because it is
not authenticated.

### IndexedDB layout

Replace the unreleased cache database with a new versioned database containing
separate stores in one database:

- `meta`: lineage, epoch, format, write verdict, and compaction state;
- `updates`: every local and remote update needed to render offline;
- `outbox`: `localOrder`, operation ID, lineage, bytes, creation time;
- `quarantine`: old-lineage or terminally rejected outbox rows plus the recovery
  snapshot metadata.

A local update on a v2 session writes `updates` and `outbox` in one
transaction. A local update on a v1 session and every remote update write only
`updates`. The protocol negotiated at the last completed sync is recorded in
`meta`, so a cache-adopted offline boot routes local edits the same way the
server will accept them. Acknowledgement deletes only the exact `outbox` row.
Every write resolves on transaction completion, not request success.
Offline-cache compaction may merge `updates`; it must never merge or delete
`outbox` or `quarantine`.

The existing offline cache has not shipped in a release. The new database leaves
that development-era database untouched rather than guessing which old updates
were local. There is no dual-write or permanent migration layer.

### Persistent capture and draining

The local update subscription lives for the collaboration module's lifetime,
not for one socket generation. It records changes while connecting or offline.
The provider then drains as follows:

- re-read the oldest pending row before every attempt;
- keep at most one operation in flight per provider;
- wake on append, socket readiness, reconnect, `online`, or the store's lossy
  committed-change hint (a `BroadcastChannel` under the hood);
- always re-read IndexedDB after a hint;
- delete by exact operation ID after an exact acknowledgement;
- treat an already-deleted acknowledgement as a no-op;
- on timeout or disconnect, retain the row and resend the same ID.

Correctness does not depend on BroadcastChannel, Web Locks, a leader, a row
claim, or a lease. Duplicate sends are expected.

### v2 bootstrap must not leak untracked edits

The current symmetric handshake can answer a server SyncStep1 with a whole
client diff. That would upload pending offline work outside its operation
envelope.

`blok-sync.v2` keeps the v1 handshake bytes but changes what the client may
send back:

1. the client sends SyncStep1 and applies the server's SyncStep2;
2. the server also sends its own SyncStep1, as today, and does so again after
   every inbound SyncStep1;
3. the client never answers with a raw SyncStep2. While the outbox is non-empty
   it ignores the server's SyncStep1 and drains through operation frames;
4. once the outbox is empty it sends SyncStep1 again and, on the fresh server
   state vector, wraps any residual local diff as one more operation.

Step 4 is what carries edits made under an earlier v1 session (cached without
an outbox row) onto a server that has since gained a durable store. A v2
connection drops inbound SyncStep2/SyncUpdate writes and closes the socket.
Standard update frames remain the server-to-client broadcast format, so v1 and
stock readers can receive committed content.

The server broadcasts a committed update to every member, including the socket
that submitted it. This is required when tab B submits an outbox row created by
tab A; applying the update twice is harmless in Yjs.

### Reset and rejection

Before adopting a new lineage, the client flushes the Yjs write buffer, waits
for every outstanding outbox append, then atomically moves every old-lineage
pending row and a recovery snapshot to quarantine, and only then resets the
document. It never sends those bytes to the new lineage. Today the buffer flush
happens inside the document reset itself, after the cache is already being
cleared; that order would strand the last buffered edit.

A final rejection (`invalid-update`, `oversized-update`, read-only race, or
operation-ID conflict) quarantines the rejected operation and the remaining
lineage tail, because later Yjs updates may depend on it. Temporary storage,
authentication, or network outages pause delivery; they do not discard data.

## Wire protocol

The client offers WebSocket subprotocols in this order:

```text
blok-sync.v2, blok-sync.v1, <ticket when configured>
```

A new server selects the highest supported version. An old server selects v1.
The new handshake must exclude both protocol tokens when it searches offers for
a ticket.

Types 0–3 and strict Blok types 100/101 remain byte-for-byte unchanged. New
information uses new outer types:

- **102 Operation:** strict metadata `{lineage, operationId}` plus one binary
  Yjs update;
- **103 Acknowledgement:** strict metadata
  `{lineage, operationId, serverSequence}`;
- **104 Rejection:** strict metadata `{lineage, operationId, code}`.

Metadata uses the existing lib0 var-string framing with canonical JSON: the
exact key set above, full input consumption, lowercase 32-hex IDs, and strict
UTF-8. Key order is an emitter rule, not a decoder one — an emitter MUST write
the keys in the order shown above (the fixtures pin those bytes), but a
decoder validates the key *set* and never the order, matching how the
type-100/101 decoders already work; most JSON libraries never expose key
order to a decoder in the first place, and a language-neutral backend is a
promised deliverable of this plan. 102 is two length-prefixed sections: the
metadata string, then the update as a var-uint-length-prefixed byte string —
a shape 100/101 do not have. `serverSequence` matches `^(0|[1-9][0-9]*)$` and
never exceeds `18446744073709551615`. Sequences start at 1, so `0` means no
operation has been committed on the lineage yet; a type-103 frame carrying
`"0"` is malformed. The decoders reject any backslash in metadata and any
repeated key, as the 100/101 decoders already do.

A raw SyncStep2/SyncUpdate write on a v2 socket carries no operation ID, so it
cannot be answered with 104; the server drops it and closes with 1008 (policy
violation).

Stable rejection codes are:

- `lineage-mismatch`;
- `read-only`;
- `not-synced`;
- `invalid-update`;
- `oversized-update`;
- `operation-id-conflict`.

These six are the stable set, not a closed one: a receiver MUST accept any
other code matching `^[a-z][a-z0-9-]{0,63}$` and treat it as a final
rejection, handled exactly like `read-only`. Refusing an unrecognised code as
malformed is a liveness hole with no way out — an older client would never
learn its operation was rejected and would redrive it forever against a
server that keeps refusing the same frame.

`not-synced` is the one transient code: the room was not ready, and the
operation was never judged invalid. A receiver keeps it pending and redrives
it once the sync phase completes; it MUST NOT quarantine it.

A transient journal failure produces no rejection and no acknowledgement. The
server closes every member with the existing 4503 status and the reason
`commit unavailable, retry`; the client keeps every row, quarantines nothing,
and reconnects with backoff, so the same operation resolves an unknown commit
outcome by retrying. `read-only` is a final rejection that quarantines the
lineage tail: today a read-only member's writes are silently dropped, and a
write verdict that flips mid-typing must leave the typed content recoverable
rather than lost.

### Compatibility matrix

| Client | Server | Result |
|---|---|---|
| v1 | v1 | Current behavior; no client save receipt |
| v1 | v2 | v1 selected; on an operation-store room the server journals each update before broadcasting it, so a v1 update now waits for the append; client has no receipt |
| v2 | v1 | v1 selected; reports legacy/unavailable, never reports saved |
| v2 | v2 | Exact durable operation acknowledgements |
| stock y-websocket | v2 server | Standard y-protocol sync; takes the v1 write path, so an operation-store room journals its writes; no client receipt or durability claim |

If a v2 outbox already contains rows and only v1 is negotiated, Blok keeps those
rows, blocks further edits, and reports durability unavailable. It does not send
them through v1 and later pretend they were acknowledged.

## Server commit path

The room remains a single-document actor lane. For a new v2 operation:

1. Validate membership, write permission, sync phase, lineage, strict IDs,
   message limits, and the update's process safety.
2. Ask the store whether the operation ID is already committed.
   - same digest: return its acknowledgement without reapplying or rebroadcast;
   - different digest: reject with `operation-id-conflict`.
3. Apply the candidate provisionally to the live YDoc so invalid bytes cannot be
   journalled as valid document history.
4. Await the fenced journal append inside the room lane.
5. On success, broadcast to all members, send the exact acknowledgement, and
   mark the JSON projection dirty.
6. On failure or an unknown outcome, broadcast and acknowledge nothing; close
   every room member with the commit-unavailable close and discard the mutated
   room. A new room reloads only committed data, and the client retries the
   same operation ID. The room manager holds a per-document cooldown so a
   store that keeps failing does not reload baseline and tail on every join.

No unjournalled mutation may reach a peer, an export, or a checkpoint. A slow
store backpressures that document; a second in-memory commit queue is not added.
A v1 or stock member is bounded by the inbound token bucket, so a document pays
at most that many appends per second per connection; the store may group-commit
concurrent appends, and an append past the store timeout is a
commit-unavailable outcome. An empty update (a stock client answering SyncStep1
while already in sync) is not journalled.

A journal-backed room keeps no second copy: the working-set persist, its blob
version tracking, the blob-write eviction hold and every compaction call are
skipped, so the only writer of document bytes is the fenced session.

The HTTP block-edit endpoint takes a required idempotency key and enters this
same commit primitive. Its 2xx response means durable operation commit. It does
not maintain a parallel edit persistence path.

### v1 writes

On a room backed by an operation store, a v1 update receives a server-generated
operation ID and the authenticated actor, then follows the same
journal-before-broadcast path. Yjs keeps a replayed v1 update logically
idempotent, but a v1 client has no stable ID and therefore cannot receive the
v2 retry receipt guarantee.

A working-set-only room (the current S3 store) keeps today's
apply/broadcast/schedule path unchanged and never negotiates v2.

## Actor attribution

The server takes actor identity only from the verified ticket's user claim or
the ASP.NET principal's name identifier, and records null otherwise. It never
uses the handshake's rate-limit key (which starts as a client IP address), and
never trusts awareness, `collaboration.user`, `offlineScope`, or operation
metadata for attribution.

Raw Yjs bytes are opaque. This layer cannot truthfully infer semantic block
diffs or stamp `lastEditedBy` per block. Version-history presentation derives
snapshots/diffs by replaying committed records later.

## Store implementations and custom backends

### Public .NET persistence seam

`ICollabOperationStore` is public because custom storage is an explicit product
requirement. Opening a document returns a fenced, exclusive session that can:

- load the baseline/checkpoint and journal tail;
- append-if-absent and assign the next server sequence atomically;
- publish a checkpoint through a committed sequence;
- reset to a new epoch/lineage;
- close the fence.

Method completion defines the store's crash-durability boundary. A stale fence
must be unable to append, checkpoint, or reset. Opening a document another
live process holds reports it, and the join is refused as unavailable; one
process per document is the standing scale-out rule. If the pending-state gate
fails, the first release omits checkpoints entirely (no checkpoint method, no
checkpoint fields in the head) and adds them later as a default interface
member rather than shipping a method that can never be called.

A relational implementation maps naturally to one document-head row and an
operations table with unique `(document, lineage, operationId)` and
`(document, lineage, serverSequence)` constraints.

### Built-in local store

The reference local store uses an append-only, checksummed journal:

- a per-document subdirectory holding the journal, a manifest and a lock file;
- a monotonic fence token in the manifest, re-verified on every append,
  checkpoint and reset (the lock file is an optimisation: a file lock is
  advisory, and a holder with a stale descriptor can still write);
- bounded length-prefixed records with digest and completion marker;
- append followed by `Flush(flushToDisk: true)` before success;
- checked directory sync when publishing a new manifest/checkpoint;
- recovery may truncate only an incomplete final record;
- corruption in the middle fails closed;
- checkpoint publication precedes any old-file cleanup.

Existing BKW2 data migrates atomically to a sequence-zero BKW3 baseline while
preserving the exact ordered legacy frame section. History attribution begins
with the first new journal record; migration does not invent actors or pretend
old frame boundaries were user operations.

### S3

The current S3 implementation has unconditional whole-object GET/PUT and no
ETag/CAS/fence. It cannot honestly acknowledge durable operation history. It
remains v1-only in the first release.

Supporting v2 on S3 requires immutable operation objects plus a conditional
head update carrying the fence and next sequence. That is a separate plan after
real-bucket tests; it is not emulated with another whole-history rewrite.

### Language-neutral custom server

A backend in any language may implement `blok-sync.v2` directly. The repository
publishes:

- a normative protocol document (kept in the repository, not in a package);
- positive and negative frame fixtures;
- mixed-version behavior cases;
- durable-history scenario definitions for duplicate replay, crash recovery,
  failed append, checkpoint lag, reset, and actor attribution.

The repository's conformance runner drives only the built C# host. A custom
backend runs the fixtures and scenarios in its own harness, and wire
conformance alone cannot prove fsync or crash behavior: that harness must also
restart the backend, fail an append, and inspect history. A second raw-operation HTTP sink is not added: it would duplicate the
same auth, lineage, idempotency, commit, broadcast, and acknowledgement path.
The existing HTTP edit API remains the non-WebSocket producer and uses the
shared commit primitive.

## Whole-document projections

The operation journal replaces frequent whole-document saving as the durable
path. The consumer JSON endpoint becomes a compatibility projection and seed
source:

- acknowledgement never waits for it;
- Blok does not PUT the whole document after every edit window;
- a projection is scheduled only after a published checkpoint and on
  eviction/drain;
- PUT includes lineage and committed server sequence so the consumer can reject
  a stale projection;
- failure leaves the projection dirty and retryable, and a room does not evict
  while its projection is dirty;
- the operation store remains authoritative.

A host that needs reliable history/current state supplies an operation store or
implements v2. A host that keeps only the legacy JSON endpoint remains on the
legacy save profile.

## Dependency gates

Two YDotNet 0.6 limitations must be resolved before v2 is advertised:

1. A NUL-bearing raw update can make the native runtime abort the process, and
   the binding cannot validate it before apply. A public raw-update protocol
   cannot rely only on the official browser's NUL stripping.
2. The binding does not expose pending updates. A full-state checkpoint can omit
   a dependency-pending update, so the server cannot safely advance
   `checkpointThrough` or skip the journal tail.

Both are CLOSED by the managed engine that replaced YDotNet, and the record is
kept because each is accurate about the binding it names. Gate 1: a NUL-bearing
update applies and exports intact. Gate 2: `YDoc.EncodeStateAsUpdate` writes
`PendingNormalizer.AllRuns(...)`, parked structs included, and
`CompactionKeepsAnUpdateThatIsStillPending` asserts the round trip. Task 3.7's
brief transcribed gate 2 as a property of the ENGINE rather than of the binding,
and built a risk framing on it; that framing is wrong and the task's real value
is elsewhere. Do not re-derive an engine limitation from these two lines.

Implementation begins with a dependency gate. The accepted YDotNet/yrs version
must prove both behaviors in process-isolated tests:

- a crafted NUL update returns a managed rejection and the host remains alive;
- pending state is observable, and a checkpoint cursor advances only when it is
  empty.

If no released binding meets those tests, implementation stops after the gate;
v2 remains unadvertised. A subprocess validator or an unreviewed native fork is
not smuggled into the feature.

## Crash and outage outcomes

| Cut point | Required outcome |
|---|---|
| Before local IDB commit | not sendable; never reported saved |
| IDB commit, before socket send | outbox survives reload and retries |
| Before server journal append | no peer observation and no ACK |
| Torn final local-journal record | recovery drops only that tail; client retries |
| Journal commit, ACK lost | restart finds record; retry re-ACKs without duplicate |
| Journal result unknown | room closes/discards; retry resolves by operation ID |
| Broadcast fails after commit | operation stays committed; peer resyncs later |
| JSON endpoint is down | operation ACKs; projection remains dirty |
| Checkpoint published, cleanup not done | either old or new files recover all history |
| Reset committed | old lineage cannot append; pending client rows quarantine |
| Middle-journal corruption | fail closed; never silently re-seed |

## Scope cuts

This design does not include:

- the version-history UI, semantic diffs, restore UI, or retention controls;
- destructive operation-history pruning;
- multi-region or multi-leader routing;
- built-in durable S3;
- a service worker or background sync;
- browser-storage encryption or immunity from browser eviction;
- immediate whole-JSON projection;
- mid-socket ticket revocation;
- a new raw-operation HTTP API;
- automatic conversion of the old top-level whole-JSON `persistence` queue.

## Research basis

The design uses the pattern established by Notion's public architecture writing:
locally persisted pending transactions, server acceptance/rejection, and version
snapshots as separate background work. It does not claim Notion's private wire
format or exact durability boundary.

It also follows documented public contracts from:

- Yjs: updates are commutative, associative, and idempotent;
- y-indexeddb: local database load is not server durability;
- y-websocket: “synced” means document content arrived, not that storage
  committed;
- Hocuspocus: Yjs binary is authoritative and whole-document storage hooks are
  debounced projections;
- Replicache: stable pending mutation identity survives retry until the server
  confirms it.
