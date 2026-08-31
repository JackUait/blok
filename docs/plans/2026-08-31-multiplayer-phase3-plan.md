# Phase 3 Implementation Plan — Client Provider, `collaboration` Key, Sync-First Load, Presence, Docs

Planning pass 2026-08-31 against main `6a1f7f29` (Phases 0-2 closed). Wire contract = Phase 2 plan
amendments (SyncWire framing, control frame `{epoch,format,lineage}` type 100, close codes,
`blok-sync.v1` subprotocol, inbound budget 50 f/s burst 100 + 60 SyncStep1/min burst 10, 1 MiB max).
Server echoes `blok-sync.v1` whenever offered in EVERY auth mode (SyncHandshake.cs:95-96) — the Blok
client always offers it and always receives control frames.

## Risk order
- R1 sync-first load replaces the seed path without breaking single-player (every branch collab-gated;
  leak = dual-seeding corruption OR broken empty editor). Public wholesale-replace APIs (blocks.render/
  clear) re-arm it via adapters' controlled-data — must refuse under collab.
- R2 lineage/epoch resync = a FRESH Y.Doc (in-place fromJSON([]) keeps old history, re-poisons). Fresh
  doc recreates UndoHistory/BlockObserver/BlockYjsSync/onUpdate/Awareness. Riskiest; own wave item C4.
- R3 awareness substrate doesn't exist client-side; bundle y-protocols/awareness (exact devDep 1.0.7),
  LAZY (its 3s setInterval violates "absent = zero cost").
- R4 client codec drift from server SyncWire → hand-roll on lib0, pin against the SAME
  fixtures/sync-frames.json (one fixture, three impls).
- R5 hostile awareness (name/color/blockId): textContent only, strict color pattern, cap counts/length.
- R6 config-law + bundle-law: collaboration key reds React/Vue compile guards intentionally; y-protocols/
  lib0 imports from src must pass no-phantom-dependencies-law + framework-isolation (yjs precedent).

## Standing decisions (17 — see full text; key ones)
1. Codec: hand-rolled client mirror `sync-wire.ts` on lib0/encoding+decoding, NOT y-protocols/sync
   (which bypasses the seam's flush barriers + echo-suppression registry). One message per frame.
2. Doc traffic through the binary seam ONLY (applyRemoteUpdate/onDocUpdate/getStateVector/
   encodeStateAsUpdate); one long-lived provider origin per connection generation.
3. Awareness added to the seam, LAZY: DocumentStore owns Awareness on first enableAwareness() (collab
   only); destroyed before ydoc.destroy(); recreated on lineage reset (binds doc.clientID). YjsManager
   delegates enable/setField/getStates/onChange/encode/apply/clearRemote. Binary at provider face, JSON
   at presence face.
4. Config: `collaboration:{doc:string, user?:{name, color?}}`, mount-fixed. Absent = zero cost. Sync URL
   from `server` (http→ws) + /sync/{encodeURIComponent(doc)}. Validation refuse-don't-warn in the config
   setter: collab+persistence → throw; collab sans server → throw; doc not single-segment → throw
   (mirror server 4400). Existing user:{id} (attribution) stays independent of collaboration.user (display).
5. Ticket: extract createTicketSource(endpoint)→()=>Promise<string> from access-pass (same cache/30s-early/
   coalesce); mint with ?doc=<enc>. WS offers ['blok-sync.v1', token] or ['blok-sync.v1'] alone.
6. Wholesale-replace guard: under collab, blocks.render()/clear() throw naming POST /sync/{doc}/reset.
   insert/update/delete stay legal.
7. Sync-first load state machine: connecting (no seed/default block, read-only) → control frame validated
   BEFORE sending anything but SyncStep1 → first SyncStep2 via applyRemoteUpdate → connected (editable iff
   host readOnly off AND pass write). Connect fail pre-first-sync → offline; render config.data last-known
   read-only via Renderer.render(blocks,{skipYjsSync:true}), retry backoff, swap on success. POST-first-sync
   disconnect is ASYMMETRIC: doc has server lineage → stays EDITABLE while offline, reconnect ships diff.
   Reload loses unsent edits (Phase 4 y-indexeddb). Empty doc after sync + write → one default block,
   DETERMINISTIC id from doc id (first-occurrence-wins convergence, like restoreDefaultBlockIfDocEmptied).
8. Close codes: 4400/4403 terminal; 4401 refresh ticket + retry once then terminal; 4409 lineage reset +
   reconnect; 4503 offline+backoff; 1001 reconnect short; 1008 back off harder; 1009 two consecutive →
   terminal oversized, drop read-only. Exp backoff + jitter ~1s→30s, reset on sync.
9-11. Client outbound throttled (write buffer coalesces updates; awareness ~100ms incl. queryAwareness
   reply; SyncStep1 on reconnect only). Presence local state {user:{name,color}, blockId} from
   currentBlock; avatar stack + colored outline on the HOLDER (child-decoration mold, data-blok-presence +
   --blok-presence-color); read-only viewers appear; hideControls hides UI but still publishes; broadcast
   null + clearRemoteAwarenessStates on drop. Status via events dispatcher: 'collaboration:status'
   {status, peers[]} — NO new class API (keeps blok-class-api-parity-law).
12. NUL-strip at serializer chokepoints (outputDataToYBlock incl id/type, objectToYMap, plainToYValue,
   plainToGridMap ROW KEYS) + updateBlockData/updateBlockTune key params. Ungated, fast-path scan-first.
   The client is the ONLY guard (server aborts on read).
13. Verify+pin remote onChange fires (blockDidMutated emits BlockChanged ungated) — desirable for v-model;
   pin + doc "don't write onSave data back in collab mode".
14. Provider takes injectable socket factory (default global WebSocket) for mock + node-conformance tiers.
15. Layout: src/components/modules/collaboration/{index,provider,sync-wire,presence,presence-renderer,
   types}.ts; register in modules/index.ts + blok-modules.d.ts.
16. ReadOnly arbitration: effective = host readOnly OR not-synced OR write:false. Host set(true) wins;
   set(false) while unsynced refused.
17. Angular: NO dedicated input (server/ticket/persistence have none either — flow through [config];
   BlokAngularConfig=Omit<BlokConfig,'holder'> picks it up). Docs show the escape hatch.

## Tasks (TDD)
Wave A (parallel): A1 config key + 4-edit law + core refusal matrix; A2 ticket source refactor + ?doc=;
A3 sync-wire codec vs fixtures/sync-frames.json; A4 NUL strip; A5 lazy awareness seam; A6 verify+pin
remote onChange; A7 events surface (CollaborationStatusChanged). D1 docs (parallel).
Wave B (needs A3,A5,A7): B1 provider (socket-factory, subprotocol, control-frame-first, seam exchange,
awareness both ways throttled, close-code matrix, backoff, per-generation origin; two-provider relay test).
Wave C (needs B1, sequential): C1 Collaboration module + sync-first load + readOnly arbitration +
deterministic empty-doc block + degrade-to-last-known + status events; C2 wholesale-replace guard; C3
presence + renderer (hostile hardening, ghost cleanup, hideControls); C4 lineage/epoch reset (fresh doc:
flush buffer FIRST, clear undo, unobserve, fresh doc+awareness, re-observe, DOM clear skipYjsSync; until
C4, B1 ships 4409 as terminal resync-required).
Wave D (parallel with C): D1 docs; D2 law-test sweep (phantom-deps/framework-isolation/dist-weight/
public-docs-drift/class-api-parity).
Wave E (needs C1, gated): E1 blok-client-contract.test.ts (node, BLOK_CONFORMANCE_SERVER) — real provider
vs built binary; E2 two-browser playwright (optional, conformance lane not critical path).

## Parallel map
Independent: A1∥A2∥A3∥A4∥A5∥A6∥A7∥D1. Spine: {A3,A5,A7}→B1→C1→{C2,C3,C4}→E1→E2. Shared owners: core.ts
(A1→C1), document-store.ts + yjs/index.ts (A5→C4), access-pass.ts (A2), blocks.ts (C2), server-data.ts
(D1), events (A7).

## Deferred to Phase 4
y-indexeddb offline (epoch/lineage-tagged; C4's reset lever is its prerequisite, lands now); Y.Text/
character carets (format bump); scale-out guide; server-side edit API; in-band ticket refresh.

## Review-round findings (2026-08-31) — QUEUED, not yet fixed

Three adversarial reviewers ran over `c27b5f25..d4cc9681`. The sync core held
(handshake ordering, lineage/reset, echo suppression, codec parity all survived
probing). These remain OPEN and block the phase closing:

- **F1 (CRITICAL, data corruption — the exact R1 risk)** `renderer.ts:152-158`'s
  empty branch calls `BlockManager.insert({origin:'load'})` WITHOUT forwarding
  `options.skipYjsSync`, so the block lands in the Yjs doc. `readonly.ts:224-246`
  renders `savedBlocks.blocks` (`[]` for an empty collab doc) with
  `skipYjsSync:true` on every real read-only transition — which happens whenever
  ANY registered tool lacks `setReadOnly` (true for essentially every
  third-party tool). The first sync lifting read-only is such a transition and
  runs BEFORE `seedEmptyDocument`, whose `toJSON().length > 0` guard then sees
  the phantom and skips. Result: a RANDOM-id block per peer — N peers, N
  paragraphs, converged. Invisible to the suite only because every fixture tool
  implements `setReadOnly`. Both candidate fixes have traps (see the review):
  forwarding skipYjsSync yields a DOM-only phantom whose typing is silently
  dropped; skipping the re-render when `savedBlocks.blocks` is empty looks safer.
- **F2/F2b (HIGH)** a terminal provider is a one-way trip to a permanently
  read-only, un-reloadable editor that the published event calls "offline"
  (`index.ts:589` folds error→offline; the payload doc says "edits stay pending
  until reconnect" — the opposite of the truth). Two ordinary ways in: the
  handshake timeout is terminal (a dead server retries forever, a SLOW one
  bricks the session — absent from decision 8's matrix), and two consecutive
  1009s are self-completing (the reconnect re-ships the same oversized state).
  Mirror image: no deadline on the FIRST SYNC — if the syncStep2 never arrives
  the client sits in `connecting` forever, read-only, empty, no reconnect, no
  degrade. Also `onStatus`'s detail is discarded at `index.ts:309-311`, so
  `code`/`reason`/`retryInMs` never reach a host.
- **F3** after a reset the editor re-renders the PRE-RESET mount data for the
  whole backoff window (a reset means "this content is being replaced").
- **F4** `seedEmptyDocument` ignores the host's `readOnly` — a pure viewer with
  a write-granting ticket authors the first paragraph of someone else's doc.
  Its own docstring states the rule it doesn't implement.
- **F6** a peer with no `collaboration.user` is invisible EVERYWHERE (presence
  and the published `peers[]`). `user` is optional in the published type, so the
  DEFAULT configuration yields a session where everyone is present and nobody
  sees anyone.
- **F7** collaboration silently requires every tool to be read-only capable
  (`readonly.ts:105-107` throws CriticalError; collab always boots blocked) —
  undocumented in the `collaboration` JSDoc.
- **F8** the veto flipping mid-typing destroys the caret (network-driven,
  unannounced, save/clear/render restores only scrollY).
- **F9** an editable collab editor can reach zero blocks with no way to create
  one (`seedEmptyDocument` is latched to the first sync; a later write grant
  never re-arms it, and `UI.appendBlockAtBottom` no-ops with no lastBlock).
- **F13 (plausible)** `ModificationsObserver.disable()/enable()` is a boolean,
  not a counter; the new code opens overlapping disable windows around awaits.

**Two fixture omissions hid four of these** and should land in the same pass: a
registered tool WITHOUT `setReadOnly`, and a peer with NO `collaboration.user`.
