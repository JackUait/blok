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

Wave A (parallel, no spike dependencies):
- A1 size announcement — frame type 101 both sides + provider
  refuse-before-write + fixtures + docs (IN FLIGHT).
- A2 F8 — caret capture on entering read-only, restore on leaving, BOTH
  toggle paths, plus the adjacent no-op-flap fix in
  reapplyCollaborationArbitration; unit (mock harness) + e2e with a tool
  WITHOUT setReadOnly (the fixture law) (IN FLIGHT).
- A3 scale-out guide (DONE `e73ecbd2`).

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
