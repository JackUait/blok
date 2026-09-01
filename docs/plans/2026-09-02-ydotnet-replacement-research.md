# Replacing YDotNet — Research

**Date:** 2026-09-02  
**Status:** research; no decision taken, no code  
**Why now:** the acknowledged-operation persistence plan
(`2026-09-01-acknowledged-operation-persistence-plan.md`) opens with two
dependency gates on YDotNet 0.6.0. Probing them on 2026-09-02 showed one is
closable without a fork and one is not closable at all inside the binding.

## 1. What the probe found (verified on osx-arm64, YDotNet 0.6.0)

Scratch console project against the cached packages; every hostile case ran in
a child process so the parent could report the exit code.

| Gate | Result | Evidence |
|---|---|---|
| Pending (dependency-missing) updates observable | **Yes, without a fork.** The shipped `libyrs` exports `ytransaction_pending_update` and `ytransaction_pending_ds`; the managed wrapper never binds them. Two `DllImport`s plus the internal `Transaction.Handle` (declared on `YDotNet.Infrastructure.UnmanagedResource`; reflection works, `UnsafeAccessor` aimed at `Transaction` does not) make it callable. | After applying an update whose dependency is absent: pending update 25 bytes, missing state vector with 1 client. After the dependency arrives: null. |
| A NUL-bearing update can be refused without killing the host | **No, with anything YDotNet ships.** 0.6.0 (2026-02-14) is the newest release; `yffi/src/lib.rs` on main still `CString::new(key).unwrap()`. The only decode-without-apply export, `yupdate_debug_v1`, aborts on the same input because its `{:#?}` output carries the raw NUL (`lib.rs:1042`). | Exit 134 in the child for the canary update (NUL in a map key and in a value) through both `yupdate_debug_v1` and apply+read. Both fresh variants (NUL only in a value; NUL only in a key) behave the same. |

Consequence for the persistence plan: Wave 0 Task 0.2 is `supported` (via a
P/Invoke into the shipped native, not a fork); Task 0.1 is a hard stop as
written. That is what triggered this research.

## 2. What the server actually needs from an engine

Read-only inventory of `packages/server/dotnet` and the client's Yjs layer.

### 2.1 Capabilities

1. **lib0 codec.** varuint (LEB128, 64-bit cap), signed varint, varstring,
   varuint8array. `SyncWire.cs` already hand-rolls varuint. The `Any` tag set
   must be *read* in full (127 undefined, 126 null, 125 int, 124 float32,
   123 float64, 122 bigint, 121/120 bool, 119 string, 118 object, 117 array,
   116 Uint8Array) and *written* for 119/125/123/121/120/126/118/117.
2. **Update v1 codec, encode and standalone decode.** Struct section per client
   plus delete set; struct kinds Item / GC / Skip; Item info bits for origin,
   right origin, parent by id or by name, parentSub. Blok *writes* only
   `ContentAny` and `ContentType(Map|Array)`, but must *parse* every content
   kind (String, Format, Binary, Embed, JSON, Doc, Deleted, and Type for
   Text/XmlText/XmlElement/XmlFragment) or one foreign peer bricks a room.
   Standalone decode is new: it is what lets NUL screening move server-side.
   v2 is not required; the client is v1-only.
3. **CRDT core.** YATA integration; per-client struct store; pending structs
   and pending delete set retained, retried on later applies, and queryable;
   tombstones with GC on by default (`RemoveAll`/`RemoveRange` in seed and
   edit emit GC structs a replica must accept); state vector encode/decode
   (empty vector is `[0]`); diff-since-vector; one write transaction yields one
   merged v1 update to the observer (the seed depends on it); random uint32
   client id by construction. Numbers on write: integral and |v| ≤ 2^31−1 →
   tag 125; else a value that round-trips through float32 → tag 124; else
   float64 (123); never bigint (the client's `JSON.stringify` cannot read
   it). All three must be read.
4. **Shared-type API the converter uses.** Map: get/insert/remove/removeAll/
   length/iterate. Array: get/insertRange/removeRange/length/iterate. Root
   resolution by name outside a transaction; read and write transactions.
5. **Interop obligations.** Decode yrs-produced v1 bytes: every persisted BKW2
   blob is raw yrs output; failing that re-seeds every room under a new
   lineage. Byte-identical *output* is not required (fixtures compare JSON),
   wire interop with real yjs is.
6. **Not required.** Y.Text/XML write path, UndoManager, snapshots, subdocs,
   relative positions, awareness decoding (relayed verbatim), v2, mergeUpdates.

### 2.2 YDotNet surface in production code

| API | Where | Purpose |
|---|---|---|
| `new Doc(DocOptions{Id})` | `CollabRoom.cs:488` | room doc, explicit random id |
| `ObserveUpdatesV1` | `CollabRoom.cs:492,567` | capture the seed commit |
| `WriteTransaction`/`ReadTransaction` | converter + room | all access |
| `ApplyV1` | `CollabRoom.cs:586` | remote update, hydrate |
| `StateDiffV1(sv)` | `CollabRoom.cs:754,837` | compaction, SyncStep2 |
| `StateVectorV1()` | `CollabRoom.cs:838` | server SyncStep1 |
| `doc.Map/Array` | `YDocConverter.cs` | roots `blocks`, `root` |
| Map/Array read+write, `Input.*`, `Output`+`OutputTag` | `YDocConverter.cs` | seed, export, edit |

UndoManager, awareness, subdocs, v2, mergeUpdates, snapshots: zero call sites.
There is no seam: `Doc`/`Transaction`/`Map`/`Array` leak into
`ICollabDocConverter` and `CollabRoom`; only the room is abstracted in tests.

### 2.3 What the client can put into a document

- Shared types written: `Y.Map` and `Y.Array` only. `Y.Text` never written;
  XML types never imported.
- Roots: `getMap('blocks')` → map of block maps; `getArray('root')` → string ids.
- Block keys: `id`, `type`, `data` (always a Y.Map, deep-converted), `tunes`,
  `parentId`, `contentIds` (always a Y.Array of strings, created eagerly),
  `lastEditedAt` (float64), `lastEditedBy`. Blocks never nest.
- Promotion: non-empty array of objects → Y.Array; array of arrays → grid map
  `{__rows, __rowKeys}`; plain object → Y.Map; else an Any leaf.
- Any leaves: string, int, float64, bool, null, undefined, nested plain
  object/array. No Uint8Array, no bigint.
- Tunes have two wire shapes (nested Y.Map on load; plain-object leaf on
  incremental writes). Both must read back.
- Encoding v1 only; wire hand-rolled on lib0, byte-identical to y-protocols.
- UndoManager is used client-side only. Awareness is real y-protocols.
- NUL is stripped on write client-side; that is the only defence today.
- Deferred Y.Text/carets would add ContentString/ContentFormat, relative
  positions, a format bump, and the NUL law extended to Y.Text writes.

### 2.4 Pain ledger a replacement must not repeat

| # | Pain | Where |
|---|---|---|
| 1 | NUL aborts the process on read; writes truncate silently | `YDocConverter.cs:34-54`, skipped canary in `YDocConverterHardeningTests.cs` |
| 2 | No update decoder, so NUL screening lives on the client | `YDocConverter.cs:49-52` |
| 3 | No pending-update API in the managed wrapper; compaction drops pending | `CollabRoom.cs:743-746`, `CollabRoomTests.cs:627-656` |
| 4 | No `mergeUpdates` in yffi; load-into-fresh-doc workaround | `CollabRoom.cs:748-757` |
| 5 | Non-unique default client id (15 distinct in 50 docs) | `CollabRoom.cs:485-490` |
| 6 | No origin on `UpdateEvent`; `applyingRemote` flag hack | `CollabRoom.cs:52-57` |
| 7 | `Y.XmlFragment` has no Output accessor; export throws | `YDocConverter.cs:1636-1639` |
| 8 | No transaction rollback; commit on dispose after a throw; forced plan-then-write | `YDocConverter.cs:158-163` |
| 9 | musl RID mispackaged upstream; CI builds yffi itself | `release-server.yml:11-60`, `Blok.Server.Host.csproj:23-52` |
| 10 | Single-file publish drops `libyrs` without an extra flag | `publish-server.mjs:154`, `Dockerfile:20` |
| 11 | Container self-extraction needs `DOTNET_BUNDLE_EXTRACT_BASE_DIR` | `Dockerfile:33-38` |
| 12 | Uncatchable stack overflow forces self-imposed depth caps | `YDocConverter.cs:58-76` |
| 13 | `YDotNet.Protocol` unusable; wire already hand-rolled | `SyncWireFramingTests.cs:12-54` |
| 14 | `Doc` not thread-safe; roots refused mid-transaction; no v2 state vector | `CollabRoom.cs:48-51`, `YDocConverterEditTests.cs:335` |

A managed engine deletes rows 1, 2, 5, 6, 8, 9, 10, 11 and 12 by construction.

### 2.5 Conformance assets that already exist

- 20 golden cases under `test/unit/server-conformance/fixtures/collab/` with
  real-yjs `update.b64`, generated from the real client store; plus 8 golden
  y-protocols frames in `sync-frames.json`.
- `sync-contract.test.ts`: stock `y-websocket` + real yjs against the built
  C# binary (concurrent convergence, late joiner, offline reconnect);
  `blok-client-contract.test.ts`: the real Blok provider against the binary.
- `YDocConverterConformanceTests.cs` (three directions × 20 cases),
  `YDocConverterLawTests.cs`, `YDocConverterEditTests.cs`,
  `YDocConverterHardeningTests.cs` re-type mechanically to a new API.
- Gaps an engine must fill itself: no item-level tie-break vectors, no
  delete-set/GC vectors, no byte-level state-vector goldens beyond one frame.
  `update.b64` is JSON-compared, so only the real-yjs wire tests catch
  non-interoperable bytes.

## 3. Option: an own managed engine in C#

Designed against `yjs@13.6.32` and `lib0@0.2.117` sources in `node_modules`.
`[V]` = verified in source, `[E]` = estimate.

### 3.1 The contract that makes it tractable

| Artifact | Law | Why |
|---|---|---|
| State vector bytes | byte-identical | deterministic: `varuint size`, entries sorted by client DESC, `varuint client, varuint clock`; built from integrated structs only, pending excluded `[V: utils/encoding.js:writeStateVector]` |
| Document JSON | byte-identical | already the fixture law |
| Update bytes | *accepted by real yjs and producing identical state*, not byte-identical | yjs's own emission depends on post-transaction merging and lazy Skip placement; reproducing it buys nothing |

The third row drops most of `utils/updates.js` (722 LOC of lazy reader/writer,
`mergeUpdatesV2`, `diffUpdateV2`, format conversion) and the whole v2 codec.
One piece survives: pending re-encode (§3.3).

### 3.2 Modules

| Module | Mirrors | LOC [E] | Days [E] |
|---|---|---|---|
| IDs | `utils/ID.js` | 60 | 0.5 |
| lib0 codec (varuint, varint, varstring, bytes, f32/f64/bigint, Any) | `lib0/encoding.js`, `decoding.js` | 500 | 4 |
| Structs: Item, GC, Skip | `structs/Item.js` (816), `GC.js`, `Skip.js` | 700 | 7 |
| Content: Deleted, JSON, Binary, String, Embed, Format, Type, Any, Doc | `structs/Content*.js` | 450 | 4 |
| Types: AbstractType, YMap, YArray, YText placeholder | `types/*.js` (~35% of AbstractType) | 550 | 5 |
| StructStore with pending structs and pending delete set | `utils/StructStore.js` | 250 | 2 |
| DeleteSet | `utils/DeleteSet.js` (352) | 300 | 2.5 |
| Transaction incl. cleanup (GC, merge, one update emission) | `utils/Transaction.js` (~55%) | 350 | 4 |
| Update codec v1 only | `UpdateEncoder.js`/`UpdateDecoder.js` v1 halves | 220 | 2 |
| Sync: read/integrate/write structs, pending normaliser, apply, diff, SV, `HasPending` | `utils/encoding.js` (644) + `updates.js:301,512-577` | 630 | 7 |
| Doc: client id, store, roots by name, update emitted | `utils/Doc.js` (~40%) | 200 | 2 |
| Blok.Server seam: rewrite `YDocConverter.cs` (1753 LOC), `ICollabDocConverter` loses the YDotNet `Doc`, `ApplyV1` → `{Applied, PendingRemains, Malformed}` | `Blok.Server/Collab/*` | 900 | 8 |

Call sites: `CollabRoom.cs:488` (doc + observer), `:584-586` (apply), `:752`,
`:836-838` (diff, state vector); `YDocConverter.cs`; `ICollabDocConverter.cs`;
delete `YDotNetRuntimeProbeTests.cs`; un-skip the NUL canary. The engine is
single-threaded like yjs; the room lane stays the concurrency boundary.

What Blok actually produces `[V: serializer.ts]`: `ContentAny` for every
primitive (yjs wraps all of them), `ContentType` for nested Map/Array, plus
`ContentDeleted`/GC arriving from browsers (their docs run with `gc: true`, so
GC structs will arrive and must decode). `ContentString` exists only inside
Y.Text, so UTF-16 clock accounting is a Y.Text-era concern. Multi-length
content is real from day one: `Y.Array.from(contentIds)` packs N ids into one
item with `ContentAny(len N)`. Both lib0 container tags occur (117 arrays, 118
objects); `WriteAny` must reproduce `Object.keys` insertion order for 118.

### 3.3 Algorithms to port, with the traps

- **Struct decode** `[V: readClientsStructRefs]`: `info & 0x1F` = 0 GC, 10
  Skip, else Item. Origin bits 0x80/0x40; **parent and parentSub are on the
  wire only when neither origin bit is set**, otherwise inherited from the
  neighbour inside `getMissing`. Mis-porting this yields updates that decode
  fine and attach to the wrong parent: the single most common port bug.
- **Integration order and the missing loop** `[V: integrateStructs]`: clients
  sorted ASC, consumed from the highest, explicit stack; same-client gap →
  stash and record the missing clock; `getMissing` non-null → jump to that
  client; `addStackToRestSS` retains the un-integrated struct.
- **Pending retention, deliberate divergence:** yjs keeps pending as v2 bytes
  and manipulates them with `mergeUpdatesV2`/`diffUpdateV2`. Keep pending as
  decoded in-memory structs instead; safe because stashed structs return early
  from `getMissing` before its mutating tail. `HasPending = pendingStructs !=
  null || pendingDs != null`. Retry inside the same transaction as a `while`
  loop so exactly one update is emitted.
- **YATA `Item.integrate`** `[V: structs/Item.js:419]`: port verbatim: offset
  trim, the conflict scan with `conflictingItems`/`itemsBeforeOrigin`, the two
  cases, tie-break `o.id.client < this.id.client`, map-head LWW with
  `left.delete`, parent length accounting. `parent == null` → integrate a GC,
  never throw.
- **Delete set** `[V: readAndApplyDeleteSet]`: un-appliable ranges go to
  `pendingDs`; split first/last items; `Item.delete` cascades into nested
  types via `ContentType.delete`, mandatory for the server's own edit API.
- **Splitting** `[V: splitItem]`: pushes to `_mergeStructs`; re-points the map
  head when `parentSub != null && right == null`; never splits a GC.
- **Encode** `[V: writeClientsStructs`]: clients DESC; first struct at the
  offset; the **full** delete set is written regardless of the target vector
  (not a divergence to "improve"). Pending must be included for late joiners,
  which needs a ~180 LOC normaliser: a client may appear only once per update
  and gaps must be filled with Skip structs (`updates.js:512-577`). This is
  the one place `updates.js` does not drop out.
- **Merging** `[V: cleanupTransactions]`: `tryGcDeleteSet` on (peers already
  send GC; bounds memory), `tryMergeDeleteSet`, `tryToMergeWithLefts`; drop
  `keep`/`redone`. Regenerate the client id when a remote transaction
  advances it, since the server is a writer.
- **NUL and UTF-8**: a managed engine cannot crash on `\0`; it is a byte in a
  varstring. The replacing failure mode is invalid UTF-8: lib0 decodes with
  `fatal: true`, so the server must reject the whole update rather than
  substitute U+FFFD, or it holds state no client can hold.

### 3.4 Bit-exact v1 rules (selected)

varuint = LEB128 with `floor(n/128)` (53-bit safe). varint first byte
`(n > 0x3F ? 0x80 : 0) | (neg ? 0x40 : 0) | (n & 0x3F)`; `-0.0` emits `0x40`.
Number → tag: integer with |n| ≤ 0x7FFFFFFF → 125; else round-trips through
f32 → 124; else 123; `NaN` → 123; `±Infinity` → 124. State vector and delete
set both DESC by client; delete-set ranges are absolute in v1. typeRef 0
YArray, 1 YMap, 2 YText, 3–6 XML. Roots: `Doc.get(name)` creates an untyped
placeholder upgraded in place; never refuse an undeclared root.

### 3.5 Test strategy

Both directions, because a C#-only differential test cannot prove yjs accepts
the server's bytes:

- **Node → C#**: a fuzz generator drives three real `Y.Doc`s, two as
  "browsers" doing random ops and a third fed the identical delivery schedule
  (order, duplicates, delays) the C# engine gets, emitting per step
  `{update, deliverTo, expectedSV, expectedJSON, expectedHasPending}`. Seeds
  recorded; a failing seed becomes a checked-in case. Fixtures live beside
  `sync-frames.json`, not under `fixtures/collab/`.
- **C# → Node**: the engine's `EncodeStateAsUpdate(peerSV)` and edit-API
  updates are replayed into a fresh `Y.Doc`, asserting the same JSON. This is
  the direction that exercises the Skip/slice normaliser.

Op mix: map set/delete at depth, array insert/delete/`Array.from`, nested
types, grids, primitive arrays and `[]`, NUL-bearing and astral strings,
`-0.0`, `NaN`, `±Infinity`, integers straddling 2^31, long runs forcing
split+merge. Harness trap: `JSON.stringify(-0)` is `"0"` while
`System.Text.Json` writes `"-0"`.

First ten tests: lib0 round-trips every Any tag with Node goldens; state vector
bytes match yjs for a multi-client doc; every `fixtures/collab` update exports
`canonical.json`; seed then encode is readable by yjs; out-of-order delivery
retains pending then converges; duplicate delivery is idempotent; concurrent
map set on one key resolves like yjs; concurrent array insert at one position
follows YATA; a NUL-bearing string survives round-trip without a crash (the
un-skipped canary); deleting a block cascades into nested types and the
delete set matches yjs.

### 3.6 Effort, risk, scope

About 4,000 LOC of engine plus 900 LOC of converter rewrite, ~48 dev-days [E],
plus ~8 days harness/CI and ~10 days of soak against the fuzzer: **12–16 weeks
for one engineer to something worth trusting with real documents [E]**. The
code is not large; the tail is validation, because every bug is silent
corruption.

Riskiest five: the `Item.integrate` conflict scan (diverges only under
concurrency); the parent/parentSub wire asymmetry; pending retention and
re-encode (no yjs code to diff against); lib0 numeric edge cases (one-line
bugs a browser decodes differently); post-transaction merge/GC (breaks the
*next* peer's diff, days later).

Out of scope for v1: v2 format, UndoManager, snapshots, relative positions,
subdocs beyond opaque `ContentDoc`, XML beyond decode-or-refuse, observers and
event trees, awareness (already relayed undecoded).

### 3.7 Y.Text later

Fits without a rewrite if three things are built now: all nine content refs
decode/encode from day one (`ContentString`, `ContentFormat`, `ContentEmbed`
are ~40 LOC each and are the only Y.Text-specific wire surface); `YText`
exists as a typeRef-2 placeholder that integrates and re-encodes; multi-length
content and splitting are exercised in v1 by `ContentAny` runs. Additive
later: the surrogate-pair guard in `ContentString.splice`, format cleanup,
`toDelta`/`applyDelta`, `RelativePosition` for carets. The one rule to honour
now: never special-case `length == 1`.

## 4. Yjs internals, existing ports, and what bit the people who tried

Verified against `yjs@13.6.32` + `lib0@0.2.117`; **PROVEN** = executed
against real yjs in this repo, **ESTIMATE** = judgement.

### 4.1 Correcting the premise

"Byte-for-byte interoperable" is not a Yjs property. PROVEN: the same ops with
`gc: true` and `gc: false` yield the same `toJSON()` and different update
bytes (a deleted subtree collapses to `ContentDeleted`; with GC off the child
`ContentType` stays). `Doc.gc` defaults to true. The repo's fixture generator
already states this. The real oracle is: decode every struct yjs can emit;
identical `toJSON()` after the same ops; state-vector bytes exact; delete sets
equal after `sortAndMergeDeleteSet`; every server-emitted update applies to a
fresh real yjs doc. Byte identity is a unit-test tier for decode→re-encode.

### 4.2 Facts the port must get right (PROVEN where marked)

- Clock arithmetic: `arr.insert(0,[1,2,3])` is one `ContentAny` of length 3
  (+3); a Y.Map inside an array insert flushes the Any batch on both sides;
  `map.set` is always +1; `text.insert('héllo😀')` is +7 UTF-16 code units,
  not 6 code points nor 9 bytes. C# strings are UTF-16 with JS indexing, so
  `ContentString` offsets map 1:1; Rust and Go ports keep a parallel index
  and that is exactly where one Go port broke.
- `writeAny` number dispatch (PROVEN): 0/1/−1 → 125; −0 → 125 with the sign
  bit; 2147483647 → 125; ±2147483648 → 124 (the bound is |n| ≤ 0x7FFFFFFF);
  0.5 and Infinity → 124; NaN and MAX_SAFE_INTEGER → 123; `1n` → 122; a
  `Date` → 118 with zero keys, i.e. `{}`. Write side is forgiving (123 for
  124 preserves the value); read side is not.
- PROVEN: a real client emits a Skip struct in an ordinary SyncStep2 once it
  holds pending structs (peer got clock 0 and 2, never 1). Skip length is a
  raw varuint, not `readLen`; yrs got that wrong once (PR #545). Rare on a
  healthy star, routine with multiple providers, a gappy log, or the
  server's own edit API.
- PROVEN: a v1 reader silently swallows a v2 update (leading `00` reads as
  zero clients, then zero delete-set entries; no trailing-byte check). Sniff
  explicitly. v2 never travels on the y-websocket path, but yjs stores its
  pending structs and pending delete set as v2 internally.
- PROVEN: two docs sharing a client id merge to one entry; the other is
  lost. yjs self-heals only afterwards. `pendingStructs != null` is the
  documented "document is broken" health signal; nothing re-requests.
- Duplicate client groups in one update silently overwrite (`Map.set`);
  within a group the clock is inferred and load-bearing.
- There is no byte-level Yjs spec; `Item.integrate()` is the only ground
  truth, and the YATA paper's pseudocode contains a known error.

### 4.3 Existing non-JS implementations (checked 2026-09-02)

- **Ycs (C#, yjs/ycs): not a usable base.** Last commit 2023-08-09; tracks
  yjs 13.4.14; no NuGet package (issue open since 2023); ~9.6k LOC; XML
  unimplemented; ships only the v2 codec, so stock Ycs cannot talk to a
  browser at all; open desync with 3+ clients since 2021. Three unmerged
  Aug-2026 PRs add v1 and XML; one of them documents the cautionary tale: an
  encoder bug and a matching decoder bug made Ycs↔Ycs round-trips pass while
  Ycs↔Yjs silently corrupted.
- **yrs has forked from browser Yjs 13.6.** yrs 0.27 (2026-05) adopted Yjs
  v14 transaction semantics (integrating past a clock gap via skips) while
  Yjs 14 is still beta. y-crdt #632 is open: the same update decodes to
  different visible text in Yjs 13.6.x and in pycrdt; the maintainer wrote
  that Jupyter's collaboration stack had been blocked for a month.
  Maintenance is one largely unfunded person.
- **ydotnet 0.6.0 builds its native from yrs `release-v0.19.1`** (head
  2024-07-08, ~8 minor versions behind). That predates the v14 fork, which is
  good for 13.x interop, but lacks later client-id fixes. Open issues include
  #124 (2026-08-27): `Text.RemoveRange` panic kills the host process, the
  same class as the NUL abort; #118 no `mergeUpdates`; #34 memory leaks.
  Upgrading the binding later would import the #632 divergence.
- yrs validates interop with nine hand-pasted byte fixtures, no fuzzing, and
  its wasm tests do not depend on the `yjs` npm package.
- Other ports: three Go engines (the most active is validated against yrs's
  own compatibility fixtures), a Kotlin port with 136 interop fixtures, a
  dormant Dart port. **No non-yrs, non-JS reimplementation was found in
  named production**; every verifiable deployment is Node `yjs` (Hocuspocus)
  or Rust `yrs` (y-sweet). y-octo (Rust, AFFiNE) is a from-scratch engine
  built because yrs is not thread-safe and panics instead of returning
  errors.

### 4.4 What bit the Go port (fixed against real yjs fixtures)

1. GC structs dropped content: 63 of 94 real documents corrupted, the worst
   losing 45 of 46 map entries. The loop skipped GC without appending, left a
   clock hole, and every later struct from that client parked in pending
   forever. Missed because none of 202 fixtures carried a GC struct; plain
   deletes never produce one. **This repo's corpus has the same hole.**
2. parentSub read unconditionally: overwriting a Y.Map key makes an item
   with an origin and therefore no parentSub on the wire.
3. UTF-16 vs code points (yjs emits U+FFFD per surrogate half).
4. Floats little-endian; lib0 is big-endian.
5. `ContentEmbed` differs by version; `ContentDoc` must write guid + opts.
6. XML type-ref collision.

### 4.5 Effort, second opinion

Relevant yjs source measured at ~5.5–6.5k comment-heavy lines → **~6–9k LOC
C# plus 4–8k LOC tests** [ESTIMATE], versus §3's ~4k engine + ~900 seam. Weeks
to first green; the strictly-interoperable long tail is **months**: the Go
port was created 2025-04, has ~34k non-test LOC and a fixture corpus, and was
still shipping corruption fixes 16 months in. Root-type kind is not on the
wire (`Doc.get` upgrades a placeholder); it is app schema. A server that
never merges items is still correct, just fatter: consider shipping v1 without
merge/GC.

Tests: tier 1 port the yjs suite (npm ships only `testHelper.js`; the rest is
on GitHub); tier 2 extend the collab fixture generator with state vector and
partial-vector diff per case **and add GC-struct and Skip cases**; tier 3 yjs
exports its harness (`TestConnector.flushRandomMessage` reorders messages,
`applyRandomTests` drives ops, `compare` asserts no pending on any peer), so
the C# engine can join as one more peer over a bridge; tier 4 byte identity
for decode→re-encode only.

Migration shape this suggests: keep YDotNet in production behind a real
engine seam, run the C# engine beside it over the fuzz corpus until they
agree, then swap. The tiny YDotNet surface (~25 members) and the existing
fixture lockstep make that cheap.

## 5. Alternatives to a native binding, measured

A second probe narrowed the crash. Real yjs emitted a valid update carrying
`"be\0fore"`; against YDotNet 0.6.0: `ApplyV1` Ok, `StateDiffV1` 61 bytes,
`StateVectorV1` 7 bytes, and only reading the value back aborted
(`lib.rs:2815`, `NulError`). **The sync hot path is already NUL-safe on the
binary shipped today**; the 21 `CString::new(...).unwrap()` sites in yffi
(5,392 lines, 192 `extern "C"` functions, zero `catch_unwind`) are all on the
read-back direction: `Export`, `Seed`, `CollabEditOps`. Export is debounced
and automatic, so a hostile update still kills the process eventually, but
the blast radius is three code paths, not the relay. Since Rust 1.81 an
uncaught unwind out of `extern "C"` is a guaranteed abort; .NET cannot defend
itself. The fix must be in Rust or in a different engine.

Speeds below were measured first-hand on macOS arm64 / .NET 10.0.302.

| Option | Process safety | Interop | Per-update speed | Packaging | Maintenance | Time to ship |
|---|---|---|---|---|---|---|
| YDotNet today | aborts on read-back only | exact (yrs is the reference port, pinned to yrs 0.19.1) | 1–3 µs | 8 RIDs, musl self-built in CI | upstream active but forked from Yjs 13 at 0.27 | shipped |
| Patch yffi in the CI build already run | abort removed at source | unchanged | 1–3 µs | the CI job grows from the two musl RIDs to all eight, and the `YDotNet.Native` binaries stop being used | one pinned patch, send upstream | **days to a week** |
| Jint running the real yjs (pure managed) | cannot abort; NUL round-trips | perfect, it *is* yjs | 110–720 µs (**146–570× slower**); 2,000-block load 1,206 ms vs 3.8 ms | one 2.5 MB DLL, any RID | very active, BSD-2 | weeks, read-back only |
| ClearScript/V8 | cannot abort | perfect | near native | per-RID natives, **no musl since 2021** | active | weeks |
| yrs compiled to wasm under wasmtime-dotnet | trap catchable, **except Windows x64 where Intel CET turns a trap back into process death** (#374) | exact | ~1.5–2.5× | 6 RIDs, **no musl**; custom yffi→wasip1 build with no prior art | active | months |
| Node sidecar (real yjs) | isolated | perfect | ~100 µs IPC | +50 MB, kills the single-file install story, two processes per container | driver library stalled 2024 | weeks |
| Relay-only (never decode) | nothing to abort | n/a | ~0 | trivial | ours | weeks, **deletes export, seeding, the edit API and compaction** |
| Own C# engine (§3, §4) | cannot abort; only `StackOverflowException` is uncatchable, so walks stay iterative | must be earned by fuzzing | unknown | **zero natives, one DLL** | all ours | **months** |

Details that decide it:

- **Jint** ran yjs 13.6.32 + lib0 + y-protocols bundled by esbuild (95 KB)
  unmodified, with a ten-line `crypto.getRandomValues` shim; `"k\0ey"` and
  `"va\0lue"` survive encode → apply → `toJSON`. It is single-threaded, so one
  engine per room at 1.9 MB each. A full-engine Jint is not viable at 570× on
  apply; a read-back-only Jint is, and it could bundle Blok's own
  `document-store.ts`/`serializer.ts` and retire the hand-mirrored
  `YDocConverter` with its fixture-drift risk.
- **Patching yffi**: per-call-site error returns (matching the converter's
  stated preference for failing loud) or a blanket `catch_unwind` at the 192
  entries. Because YDotNet pins each `DllImport` to a named entry point, a
  behaviour-only patch links against the unchanged managed binding. The repo
  already builds yffi from `release-v0.19.1` for musl; this is that job, not a
  new one. Upstream is receptive (maintainer on #415: "we're at the process of
  removing panics"; hardening PRs merged same-day), expect weeks upstream,
  days in the fork. Two adjacent facts: `ytransaction_pending_update` is
  exported natively and missing only from the C# binding (one `DllImport`);
  yrs has `Update::state_vector()`, `merge()` and `merge_updates()` that work
  without a `Doc` and never touch `CString`, and exporting them through yffi
  would give decode-free compaction and diffing.
- **Relay-only** is endorsed as an "echoing server" shape by the Yjs author
  and is correct because updates are commutative and idempotent, but nobody
  ships it long-term (even `yjs/yhub` decodes for initial sync and
  compaction), and for Blok it deletes shipped Phase 4 features to fix a path
  that is not broken.

## 6. Synthesis and recommendation

### 6.1 What the four streams agree on

- The abort is real, unfixable from .NET, and confined to read-back. A NUL
  update never breaks sync; it breaks the next export, seed or edit of that
  document, and export runs by itself.
- No released YDotNet closes it; upstream yffi still unwraps; yrs has moved
  past browser Yjs 13 semantics, so *upgrading* the binding later imports a
  live divergence (#632) rather than a fix.
- Pending-update visibility is closable today with two `DllImport`s.
- Every non-native alternative except an own engine trades the abort for a
  new structural cost: 146–570× slower (Jint), no musl (V8, wasm), a second
  process (Node), or lost features (relay-only).
- An own managed engine is the only option that delivers all three of "no
  native code, no abort ever, no per-RID packaging", and it is the only one
  immune to the yrs/Yjs-14 fork. Its cost is months, the risk is silent
  corruption, and the mitigation is a two-direction differential fuzzer
  against real yjs plus GC/Skip fixtures the current corpus lacks. The two
  effort estimates (§3: ~4k engine + 900 seam, 12–16 weeks; §4: 6–9k engine
  + 4–8k tests, months of tail) bracket the honest range.

### 6.2 Recommended path

Three steps, each shippable alone, each making the next cheaper. Steps 1 and
2 are not exclusive with abandoning YDotNet; they are what keeps the product
safe while the replacement is built.

1. **Now (days to a week).** Patch the 21 unwrap sites in the yffi build
   the CI already produces so read-back returns an error instead of aborting;
   send the same patch upstream. The musl-only CI job widens to all eight
   RIDs and the package's own natives stop being used. Bind
   `ytransaction_pending_update` and `pending_ds` with two `DllImport`s and a
   reflection (or `UnsafeAccessor` on `UnmanagedResource`) reach to the
   internal handle. Acceptance: a null returned from a patched `ytext_string`
   or `YMapEntry` surfaces in the managed layer as a loud failure, never as an
   empty key in an export that claims success; `catch_unwind` applied by macro
   across the 192 entries, or per-site error returns, with the per-call cost
   measured; the patched binary passes the collab conformance fixtures
   unchanged. This makes the *process* survive. It does not by itself open
   v2: `ApplyV1` still returns Ok on NUL, so the journal would hold a
   poisoned update forever; step 2 is what advertises v2.
2. **Next (weeks).** Write the managed v1 *decoder* in C#: lib0 codec, struct
   and content parsing for all ten refs, delete-set parsing, standalone (no
   doc). It is the pre-apply screen the persistence plan wants (NUL, invalid
   UTF-8, size, structure) and it is the first third of an own engine, so
   nothing is thrown away. Validate against the 20 real-yjs fixtures plus new
   GC-struct and Skip cases.
3. **Then (months, the user's call).** Complete the engine per §3: struct
   store, YATA integration, delete sets, transactions, encode, diff, pending.
   Build it beside YDotNet behind a real `ICollabDocConverter` seam, run
   both engines over the fuzz corpus in both directions until they agree
   across the whole corpus and the yjs test harness, then swap and delete the
   native build matrix. Ship v1 without item merging/GC if it simplifies
   correctness; a server that never merges is still correct.

Not recommended: full-engine Jint, ClearScript, wasm, a Node sidecar, or
relay-only. Read-back-only Jint is a viable middle path if step 3 is rejected
outright, but it adds a second engine to keep in lockstep.

### 6.3 What this changes in the persistence plan

`2026-09-01-acknowledged-operation-persistence-plan.md` Task 0.1 says "if no
released pair passes, stop". Replace it with steps 1 and 2 above: the process
gate is the patched native build, the v2 gate is the managed decoder screen,
and neither is a new YDotNet release. Task 0.2 is `supported` via the
`DllImport` route. Task 3.6 gains one rule: a projection failure the converter
classifies as permanent (its own data refused: NUL once the native returns
errors, an XML fragment, a depth cap) releases the eviction hold and marks the
document unexportable for an operator reset, instead of retrying forever.
Nothing else in that plan depends on which engine sits behind the seam; the
journal stores raw update bytes and never decodes them.
