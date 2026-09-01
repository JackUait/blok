# Phase 4 Implementation Plan — Offline Cache, Server-Side Edit API, Scale-Out Guide, Carets Decision

Planning pass 2026-09-01 against main `fe1b3018` (Phases 0-3 closed; see the
phase 3 close-out for what carried in). Scope from the design's "later, by
demand" list — the demand arrived: y-indexeddb-style offline cache
(lineage/epoch-tagged), Y.Text/character carets (format bump — DECISION GATED
on the YDotNet spike, see below), scale-out guide, server-side edit API — plus
the three items Phase 3 carried: F8 (caret destroyed when the write veto flips
mid-typing), `CollabMaxMessageBytes` announced in the control frame, and the
decision-8 matrix rewrite (DONE, `fe1b3018`).

## Risk order

- R1 **Y.Text is gated upstream before it is gated by us.** YDotNet 0.6.0
  killed Y.XmlFragment exports in Phase 2; whether Y.Text seeds/exports at all
  decides if carets are even on the table. Spike first, real code. The plan
  must survive the honest outcome "blocked → record, defer, ship the rest".
- R2 **The format tag is already frozen.** Phase 2 shipped the working-set
  store, so v1 blobs exist. Any format bump needs an explicit compatibility
  matrix (old blob/new server, new room/old client — 'unsupported-format' is
  TERMINAL client-side) before one byte changes.
- R3 **Offline-editable changes a safety invariant.** Today's law: never
  editable unsynced. The carve-out is narrow and must stay narrow: editable
  from cache ONLY when the cached doc carries server lineage, and the cache
  drops itself on lineage/epoch mismatch. Every "pre-first-sync doc is empty"
  assumption in the client is a landmine to enumerate first.
- R4 **A server-side edit API is a new unguarded write path.** The client is
  the only NUL guard today and YDotNet aborts the process on NUL. Whatever
  shape the API takes, the NUL rejection moves server-side with it.
- R5 F8 belongs in core read-only, not in collaboration — the fix must not
  fork the toggle contract (see `readonly-inplace-toggle-contract`).

## Standing decisions (sealed 2026-09-01 after the research fan-out)

1. Every wave ships alone and leaves main green — same discipline that let
   Phases 1-3 survive interruptions.
2. Wave A quick wins land first: decision-8 matrix (DONE `fe1b3018`),
   scale-out guide (DONE `e73ecbd2`), the size announcement (A1), F8 (A2).
3. **The size announcement rides a NEW frame type 101, never a new field on
   type 100.** Both control-frame parsers are strict BY DESIGN (client
   `sync-wire.ts` CONTROL_KEYS; server `SyncWire.TryDecodeControl`) — a new
   field on 100 is malformed → dropped → handshake-timeout → TERMINAL on
   every deployed client. Unknown OUTER types are the forward-compat channel
   both sides deliberately left open. The announced limit is fact, not
   inference: never cleared by markSynced, cleared per-connection.
4. **Offline cache is hand-rolled on the binary seam; y-indexeddb is
   unusable here.** Three independent reasons: it takes the raw Y.Doc (which
   the seam keeps private precisely against the dual-import footgun — a
   host-side copy applies updates with ITS yjs and our `instanceof Y.Map`
   gates silently drop the result); it applies cached updates the moment the
   DB opens, before any lineage/format veto can run; and its cache-load
   origin is not in remoteOrigins, so loads would rebroadcast through
   onUpdate. lib0 (already a bundled devDep) carries the same IDB helpers
   y-indexeddb itself uses. No new dependency.
5. **The cache needs a new unfiltered seam tap.** `onDocUpdate` filters out
   remote-origin transactions, so a cache riding it would persist only local
   edits and reload stale. Add `onAnyUpdate` (DocumentStore → YjsManager →
   CollabDocSeam), cache excludes its own CACHE_ORIGIN.
6. **The cached lineage is pre-seeded into the provider's `state.lineage`.**
   Today the first control frame is ADOPTED, not compared; a cache-adopted
   boot without the pre-seed would swallow a post-reset server's new lineage
   and ship pre-reset history into the reset room via answerResync — the
   exact leak resetForRelineage exists to prevent. With the pre-seed, a
   mismatch takes the battle-tested relineage path. relineage/4409 also
   drops the cache.
7. Cache shape: per-doc store keyed by server URL + doc id (same id can
   live on two servers); every update row stamped with its lineage (rows
   from a stale-lineage tab must never mix into the adopted set); meta
   `{lineage, epoch, writeDenied, savedAt}` written only after a VALIDATED
   control frame — a never-synced session must not fabricate an adoptable
   cache. Epoch stored, never compared (matches the provider). Multi-tab =
   CRDT idempotence + Web Locks around compaction only. Compaction merges
   rows via Y.mergeUpdates at a threshold; merged row written before the
   range delete.
8. Cache-adopted boot: `isEditingBlocked` becomes
   `!(firstSynced || cacheAdopted) || writeDenied || terminal`, where
   cacheAdopted requires a valid 32-hex lineage + format 1. Meta's
   writeDenied carries the last ticket's verdict across the reload so a
   write-denied member does not type into a void. renderLastKnown and the
   degrade path must never overwrite a cache-rendered doc. seedEmptyDocument
   treats cacheAdopted like firstSynced (the derived id keeps racing offline
   peers convergent). Terminal sessions KEEP the cache — the next page load
   gets a fresh session and the edits.
9. **The cache is opt-in**: `collaboration.offline?: boolean`, default off.
   A library writing document content to origin-scoped disk by default would
   silently break hosts' compliance assumptions; the host opts in. The
   config-key-=-4-edits law applies. Lazy like awareness: absent = zero
   allocations; no navigator.storage.persist() call (it prompts) — document
   it instead.
10. `pagehide` flushes the pending write buffer — without it the last
    debounce window of typing dies with the tab whatever the cache does.
11. **Edit API = block-level ops on the room lane**: `POST /sync/{doc}/edit`,
    guarded exactly like reset (origin + write ticket + doc claim +
    IBlokAuthorization), ops `insert (after/parent) | update | remove`
    applied atomically in ONE transaction inside the lane via a new
    converter entry `ApplyOps` (Seed wipes; InputWriter's value rules are
    reused). The lane's OnLocalUpdate broadcast delivers it to members with
    zero relay code, but the endpoint MUST run the post-apply trio
    (CompactIfOversized / SchedulePersist / MarkDirty) or the edit never
    persists/exports. A `New` room takes the load-or-seed path like
    JoinAsync (not ResetAsync's tag-only shortcut). Failure modes: 413
    oversized before the lane, 422 malformed/unknown-id/**NUL (mandatory —
    the endpoint is a new unguarded write path and NUL aborts the process)**,
    503 seed-failed. Raw-update POST is rejected as a shape: YDotNet cannot
    decode-without-applying, so it is structurally un-NUL-guardable. The
    reset endpoint remains the whole-doc escape hatch.
12. **In-band ticket refresh: dropped, with the reason recorded.** The
    ticket is verified exactly once per connection at the handshake; exp is
    dropped at that boundary and nothing downstream could enforce it; the
    client already re-mints on reconnect and on 4401. A live socket outlives
    both exp and revocation BY DESIGN (docs already say revocation applies
    at the next reconnect). Mid-session revocation would be a new
    server-side feature, deliberately not built.
13. **Y.Text and character carets: DEFERRED out of Phase 4** — and the
    deferral is purely a client-side scope call, because the YDotNet spike
    came back FULLY GREEN: Input.Text seeds nested in maps, both export
    Output paths read it (the Phase-2 XmlFragment crash was that type
    having NO Output accessor — Text has a complete one), diffs converge
    character-level, Text.Observe delivers Quill-style deltas, StickyIndex
    encodes/decodes (use Before association — After returns null at end of
    string), UndoManager scopes to a nested Text, and the default offset
    encoding is UTF-16, agreeing with JS as-is. NUL truncates silently in
    Y.Text writes too — the NoNul law extends there. A future phase has a
    green light server-side. The M-sized version (Y.Text in the doc, string-level apply,
    fallback-to-LWW under interleave) spends the one-way format-bump cost —
    frozen blobs, bricked old tabs, doubled fixture surface, mirrored C#
    laws — without the visible win (carets), and its merge win is waived
    exactly where users look for it. The real version is L/XL
    (HTML-offset↔DOM mappers per tool, an in-contenteditable overlay layer)
    — a phase of its own. Carried prep, cheap now: widen
    `block-observer.ts` `walkToOwningBlock` to accept Y.Text targets (today
    a Y.Text delta would resolve to no owning block and be SILENTLY dropped
    — the Phase-0 blind-spot class). Full survey findings live in the
    research report; key laws if it is ever carried: promotion is
    creation-time-only (concurrent promotion is an LWW race that eats
    edits), every demotion path closed, diff-splice only when
    `toString() === lastSavedData` else whole-string LWW, servers upgrade
    before clients, conversion per-doc via the reset-shaped lever.

## Tasks (TDD)

Wave A — CLOSED:
- A1 size announcement — frame type 101 both sides + provider
  refuse-before-write + fixtures + docs (DONE `81a6920c`).
- A2 F8 — caret capture on entering read-only, restore on leaving, BOTH
  toggle paths, plus the adjacent no-op-flap fix in
  reapplyCollaborationArbitration (DONE `683e8d6d`).
- A3 scale-out guide (DONE `e73ecbd2`).
- A0 decision-8 matrix rewrite (DONE `fe1b3018`); Y.Text observer/serializer
  hardening, decision 13's carried prep (DONE `3f01ca20`).

Wave B (after A1 lands — shares provider.ts/types.ts): offline cache per
decisions 4-10, plus the walkToOwningBlock widening (13) and the pagehide
flush (10). Unit: cache adoption/veto/relineage-drop/multi-tab dupes via
fake-indexeddb or lib0's IDB against a jsdom shim — follow what the harness
supports; the lineage pre-seed (6) gets its own regression test shaped like
the leak it prevents.

Wave C (after A1 lands — shares CollabRoom.cs/CollabRoomOptions.cs):
`POST /sync/{doc}/edit` per decision 11. Tests mirror ResetEndpointTests +
room-level EditAsync tests incl. broadcast-to-members, persist/export after
edit, NUL 422, oversized 413, unknown-id 422, New-room load-or-seed, and a
conformance-level check that an edit lands on a live stock client.

Docs (with B and C): the offline story replaces the 'collab-offline-reload'
limit honestly; the edit API gets its section beside the reset call; both
en + ru.

Review: one adversarial round over B + C together once landed, as in
Phases 0-3. Close-out updates this plan + memory.

## Parallel map

A1 ∥ A2 (disjoint files) → {B ∥ C} (disjoint: client vs server; both blocked
on A1's files) → review → close-out. The Y.Text spike runs free — its result
only edits decision 13's record.

## Amendments from execution

(append-only, dated)

### 2026-09-01 — Wave A closed

Four items landed and are on main. Two things the execution taught, both
worth more than the features:

**The strict-parser trap (A1).** The plan opened intending to add
`maxMessageBytes` as a field on the existing control frame. Both parsers
reject unknown properties BY DESIGN — a client sees the frame as malformed,
drops it, never validates the handshake, and after three attempts lands in
the TERMINAL handshake-timeout state. Adding that field would have bricked
every deployed client on contact with an upgraded server. The forward-compat
channel both sides deliberately left open is an unknown OUTER message type,
so the announcement rides a new type 101. **Law: in this protocol, new
information goes in a new frame type, never a new field on an existing one.**

**A no-op is not a no-op (A2).** F8 was filed as "the veto flip destroys the
caret". It is worse: `BlockSelection.toggleReadOnly` removes every selection
range from inside the module cascade, and the cascade runs BEFORE
`applyReadOnly`'s same-state early return — so a collaboration status blip
that changed nothing at all (an offline flicker while still editable) killed
a live caret with no state change and no gesture. Fixed by returning early in
`reapplyCollaborationArbitration` when the derived state is unchanged, scoped
there because host-initiated same-state `set()` relies on the cascade re-run
to re-stamp `hideControls`.

### 2026-09-01 — Wave B closed

The offline cache is on main (`5f299527`, `079b61d6`, `8fe43042`, `760700a8`,
`5e170da9`). `collaboration.offline` is opt-in; with it, a reload picks up work
typed while disconnected and ships it on the next connection.

Two bugs the tests found, both real rather than test-only:

**The seed race.** Rows can only be stamped once the meta names a lineage, so
everything the document held before the first `connected` — the whole first
sync — needed one snapshot write. Chaining `saveMeta().then(append)` meant an
editor torn down in between lost exactly the snapshot that makes the next boot
adoptable. Fixed by making it ONE call the cache orders internally, with a
serialized write queue that captures the database handle when the caller asks
rather than when the turn comes, and a `close` that waits for scheduled writes
instead of abandoning them.

**Realm-crossing bytes.** `instanceof Uint8Array` is false for a genuine byte
array a structured-clone deserializer built in another realm — which is what
IndexedDB hands back under fake-indexeddb, and a hazard worth not relying on
anywhere. Storage-deserialized bytes are normalised, never instanceof-checked.

**A process failure worth recording.** An earlier `git add -u` swept a dead
agent's unfinished C# stubs onto main: three NotImplementedException bodies and
a signature naming a type whose file was never committed, so Blok.Server did
not compile from a clean checkout. Reverted whole in `78f5d9b8`. LAW: stage by
path when the working tree holds anyone else's work — `git add -u` is not safe
in a tree shared with subagents.

### 2026-09-01 — Wave C closed

`POST /sync/{doc}/edit` is on main (`45f6f70a` the document half, `5ebc6e78`
the endpoint, `40965857` the docs). A consumer backend can insert, update and
remove blocks in a live document without holding a socket.

Three things the implementation settled:

**Plan, then write.** Everything refusable is refused before the transaction
opens — the planner keeps its own picture of the document and mutates it as it
goes, so later ops see earlier ones while a refusal anywhere leaves the
document byte-for-byte unchanged.

**Removal follows parentId, never contentIds.** parentId is what decides
membership on export, so a child the removed block never listed would otherwise
keep a dangling parent and resurface at the top of the document on the client's
orphan pass — and a listed child naming a different parent must survive.

**The NUL screen covers ids that are only COMPARED.** A parent id becomes the
block's parentId moments later, and a remove id that carries a process-killer
should hear about the NUL rather than "no such block". Both were holes in the
first pass, caught by the tests that came with the scaffolding.

**Process notes.** Four subagents died on this wave (three rate limits, one
server error); the fourth left a complete parser and 565 lines of tests but an
ApplyOps calling an EditPlanner that was never written, so the project did not
compile. Finishing it by hand was faster than a fifth relaunch. Two
test-construction bugs were found while doing so: an op carrying a raw NUL
cannot be built by parsing JSON (the reader refuses it first, so the test
proved nothing), and a broadcast assertion compared against a document that had
never received the room's state — an update is a diff, and a mirror that never
synced cannot render one.
