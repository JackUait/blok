# Progress: yjs-lib0 lane (rounds 1-2, 2026-10-31)

Branch `go/yjs-lib0`, worktree `/Users/jackuait/Packages/.blok-go/yjs-lib0`. Read this first next round.

## What exists

- `packages/server/go/internal/lib0`: reader, writer, Any codec. Any values reuse the `jsjson` JS value model (`nil`, `bool`, `float64`, `jsjson.Str`, `*jsjson.Object`, `[]any`, `jsjson.Undefined`), plus `lib0.BigInt` (int64) and `[]byte`.
- `packages/server/go/internal/yjs`: the whole engine. Structs, the 9 content kinds, decode and inspect, the writers, the store, delete sets, state vectors, the integrator, pending and diffs, GC, `Doc`, `Map`, `Array`, `Text`, `XmlText`, and the XML placeholders.
- `packages/server/go/internal/yjs/yjstest`: the fixture loader. It walks up to `test/unit/server-conformance`, or uses `BLOK_REPO_ROOT`. It checks every manifest entry's size and sha256, and reads the sentinels.
- The scenario runner and JSON renderer are ported in `internal/yjs/scenario_test.go`, from `ScenarioSupport.cs` and `JsonRenderer.cs`.

## Shared oracles added this round

- **P1** `test/unit/server-conformance/fixtures/yjs-engine/csharp-capture.json`, 470 KB, outside the manifest.
  - Written by `Blok.Server.Tests/Yjs/CSharpCaptureTests.cs`. The C# test fails when the file is stale; `BLOK_WRITE_CSHARP_CAPTURE=1` rewrites it.
  - It covers every scenario and fuzz step. Per step it records:
    - `sv`;
    - sha256 prefixes of the full state, the diff against the previous step's vector, and the diff against the first non-empty vector;
    - every emitted update (hash + `Local`);
    - the ApplyResult (`PendingRemains`, `Changed`);
    - `pending` and `minted`.
  - Go test: `internal/yjs/capture_test.go`. Every one of the ~2600 steps matches.
  - Mutation-checked: dropping the parked-coverage half of `Changed`, or dropping pending structs from the diffs, both fail.
- **P2** limit boundaries, as twin tests in both languages:
  - JSON depth 512 passes and 513 is refused;
  - a length of 2^31-1 passes and 2^31 is refused.
  - C#: `UpdateV1DecoderTests.RawJsonDepthAndLengthBoundariesHold`. Go: `TestRawJSONDepthIs512`, `TestRefusesWireValuesNoEncoderWrites`.
- **P3** is already covered by the foundation's `fixtures/jsjson/js.json` and `dotnet.json` (jsjson package tests plus C# `JsJsonFixtureTests`). Nothing was added.
- **P4/P5** as twin tests:
  - C#: `IntegrationTests.AdoptClientIdWritesUnderTheAdoptedId` and `ARemoteApplyInsideALocalTransactionMakesItRemote`.
  - Go: `TestAdoptClientIDWritesUnderTheAdoptedID` and `TestARemoteApplyInsideALocalTransactionMakesItRemote`.
  - Finding (C# behaviour, pinned in both): a remote apply nested in a local transaction makes the whole transaction remote, so its update has `Local=false`. The transaction also advanced the doc's own clock, so it re-mints the client id.

## C# fix (T17 / U6)

Commit `fix(server)!: BREAKING read wire JSON content with JsJson.Parse` (03e827ac, was 533aea17 before the round-2 reword).
- `ContentJson.GetContent` and `ContentEmbed.GetContent` now use `JsJson.Parse`.
  - Before, a `JsonNode` accepted a lone surrogate escape and threw on first read.
- The converter (`YDocConverter.TryToPlain`) drops a string holding a lone surrogate, as it drops undefined.
  - Before, `TryReadWireJson` dropped the WHOLE wire value. Now only that string goes; the rest survives (`ExportDropsOnlyTheLoneSurrogateStringInsideAWireJsonValue`).
  - `ExportSkipsAWireJsonValueItCannotMaterialise` still passes.
- Side effects for refs 2 and 5 only (no Blok client writes them), pinned by `ExportWritesWireJsonAsJavaScriptReadsIt`:
  - `{"n":1.0,"e":1e2,"i":1e999}` now exports as `{"n":1,"e":100,"i":null}`. Before, it exported the raw number text `1.0`, `1e2`, `1e999`. That old output comes from probe 3 (`JsonNode ... ok -> 1e999`); it was not re-run on the old code.
  - A 300-deep ref-2 array now exports as 256 levels with null at the bottom (the converter's lockstep cap). Before, it exported whole.
  - `SameAsLive` can now find an equal wire value. Before, it never could, so it always rewrote.
- **Behaviour change on a shipped surface.** `TryReadWireJson` shipped in v1.16.1 (`git merge-base --is-ancestor` on commit 8372f514).
  - Round 2: the commit was reworded (non-interactive `commit-tree` + `rebase --onto`; tree unchanged) to carry `BREAKING` in the subject and a `BREAKING CHANGE:` body with old, new and migration. No other branch or worktree contained it (`git branch -a --contains`, plus `merge-base --is-ancestor` against every detached worktree HEAD).
  - The commit's "Old" claims were run on the pre-change tree (`git archive 5bdc4ce3` into a scratch folder, plus the new `ExportWritesWireJsonAsJavaScriptReadsIt`). Old output: numbers `{"n":1.0,"e":1e2,"i":1e999}`, the 300-deep array exported whole (`300:1`), and the lone-surrogate value dropped whole (NullReferenceException on `data["mixed"]`).
  - A release note is still owed when this lands; the user decides the bump.
  - Compatible route, if wanted: keep the raw text beside the parsed value, and let the converter re-read the raw text as before.
- **Who reaches the new `case string text when HasLoneSurrogate(text)`** (round 2, partly verified). It runs on every string `TryToPlain` sees, which is map and array values and Any members, not Y.Text (YText/YXmlText take their own branches above it).
  - ContentAny strings cannot carry one: the varstring read is strict UTF-8 (`Lib0Reader.cs:126-131`; negative case `invalid-utf8-key`).
  - Rich-text HTML answers parsed with `JsJson.Parse` (`RichTextHtmlReader.cs:91`) go to `RichText.ToJson`, not to a map value.
  - UNVERIFIED: that no other LOCAL writer (the importer) can put a lone-surrogate string in a map value. Its inputs come through System.Text.Json `JsonNode`, which round 1's probe 3 showed throws on a lone-surrogate read.
- **The collab lane must reproduce the lone-surrogate drop in the Go converter.**
- UNVERIFIED: a lone surrogate in an object KEY of wire JSON. STJ would write it as U+FFFD; nothing drops it.

## Ledger rows (113)

DONE = a passing Go test reads a shared fixture or the C# capture, or is a twin of a C# test.

| Rows | Status | Oracle |
|---|---|---|
| L1-L16 | DONE | varint.json, any.json, negative.json; lib0_test.go ports of Lib0CodecTests/AnyCodecTests |
| L17 | DONE | Go counter: 4096 passes, 4097 refused. C# may refuse earlier via its stack probe (T9, UNVERIFIED where); C# pins 256/4097 only |
| L18 | DEFERRED (intentional difference, P6) | Go has no write-side stack guard; Go stacks grow |
| J1-J5 | DONE | foundation fixtures/jsjson (js.json, dotnet.json) |
| J6-J7 | DONE | P2 twin, TestAcceptsEveryRawJSONPayloadABrowserAccepts, TestRefusesRawJSONContent |
| C1-C14 | DONE | structs.json, negative.json, hand-built write-backs, scenarios, P1; C14 via TestDuplicateDeliveryOfOneDecodedUpdateIsIdempotent |
| W1-W21 | DONE | structs/negative/yrs-compat/collab updates rewritten byte for byte; delete set and state vector ports; P1 for W19/W21 |
| S1-S19 | DONE | scenarios + fuzz + P1; store, delete set, pending, parked-coverage and hostile ports. S1 now also `TestGetStateIsZeroForAnUnknownClient` (round 2) |
| D1-D28 | DONE | scenarios engineWrites bytes, P1, integration/write/text ports, P4/P5 twins. Round 2: D18 adds `TestMapTryGetReadsTheLastValueOfTheHeadAndSkipsDeleted`, D21 adds `TestArrayEnumerateSkipsDeletedAndNonCountable` (before, both rows lacked their cited oracle; mutations M9 `last := 0` and M10 drop `!countable()` now fail them) |
| X1-X6 | DONE | varint.json, P2 twins, TooDeepPastTheCap, AGapWiderThanAnInt |
| T4 | DONE (round 2) | `yjstest.TestCanonicalSortsKeysByUTF16Units`, expected text from node; mutation M12 (byte compare) fails it |
| T16 | DONE (round 2) | twin tests, see below |

So 112 DONE and 1 deferred with a reason.

## Round 2 fixes (review findings)

1. **T16 was a real divergence, now fixed in C#.** `List.Sort` is unstable from 17 items; Go was stable.
   - C#: `YDoc.MergeParked` and `PendingNormalizer.ParkedByClient` now sort with LINQ `OrderBy` (stable). For 16 or fewer items `List.Sort` was already stable (reviewer probe 1), so nothing smaller changes: the C# Yjs suite (753) and P1 still pass.
   - Twin tests: C# `PendingRetentionTests.EqualClockParkedStructsKeepTheirParkedOrder`, Go `TestEqualClockParkedStructsKeepTheirParkedOrder`. 16 one-char items park at clocks 10..25, a 5-char item parks at clock 13, then clocks 0..9 fill the gap. They pin the parked full state bytes and the final text, for conflicting and for same content.
   - The C# test failed before the fix (`Expected AQ0HCgQ... Actual AQwHCgQ...`). A Go mutation (length-descending tiebreak) fails the Go twin; P1 did not catch it.
2. **A length-0 struct broke every later encode.** Pre-existing C# defect, ported into Go.
   - yjs accepts length-0 items and GCs, and still encodes: `findIndexSS` tests the LAST struct for an exact clock before bisecting (`node_modules/yjs/src/utils/StructStore.js:111-118`). Our bisection could not find a length-0 last struct that the state vector names.
   - Fix in both: the same exact-last check in `StructStore.FindIndex` / `store.findIndex`. For structs of length 1 or more it returns the same index as before.
   - Shared oracle `fixtures/yjs-engine/empty-structs.json` (new, in the manifest, from the generator): 9 cases, each applies its updates and must encode `sv`, `full` and a `diff` against `{1000:1}` exactly as yjs did. Read by C# `HostileUpdateTests.ALengthZeroStructEncodesAsYjsDoes` and Go `TestALengthZeroStructEncodesAsYjsDoes`. The C# test failed before the fix with `client 1000 has no struct at clock 0`.
   - The reviewer's exact crash input `0102e80700220101300130002100e8303001303000` is pinned by twins C# `HostileUpdateTests.TheFuzzCrashInputEncodes` and Go `TestTheFuzzCrashInputEncodes`: it applies, encodes, and its vector is `AegHAA==`. Full bytes are not pinned, because they hit the parentSub-bit item below. Removing the fix fails both.
   - `AMapKeyWithNoValueReadsAsUndefined` (8372f514, shipped) now also asserts the encode succeeds, in both languages. Its applied-and-undefined contract is unchanged.
   - A ContentDeleted of length 0 is the one empty shape yjs also refuses (it throws mid-apply; `yjsAccepts: false`). Both decoders now refuse it, so the doc stays as it was. New negative case `empty-deleted-content` (reason `empty-struct`); negative.json has 9 cases.
   - Not refused: empty strings, JSON, Any and GCs, because yjs accepts them and refusing would reverse 8372f514. That also keeps journal replay of an old room working.
3. **`Doc.EncodeStateAsUpdate` now returns an engine failure as `*EngineError`** instead of panicking (shared `recoverEngine`, also used by `ApplyDecoded`). Test: `TestEncodeReturnsAnEngineFailureAsAnError` corrupts the store directly; it panicked before the fix. `Doc.Transact` returns no error, so it still panics with `*EngineError`; its comment now says so. `ApplyUpdate`, `ApplyDecoded`, `Decode` and `DecodeStateVector` already return errors.
4. **Pending-gap store state** is now checked in Go: `TestSameClientGapParksTheTail` (pendingMissing {1000:1}, empty store, one parked id) and `TestPendingRetriesWhenTheDependencyArrives` (state after each delivery). Mutation M11 fails the first.

## Not done / round 3

- **NodeReplay harness for Go.** 16 C# test bodies call NodeReplay (FuzzCorpus excluded):
  - EncoderTests: DiffAgainstAnEmptyVectorReplaysIntoYjsWithIdenticalJson, DiffAgainstAPeerVectorIsAcceptedByYjs, PendingWithGapsEncodesSkipsReadableByYjs, TransactionEmitsOneUpdateThatReplaysIntoYjs, ApplyEmitsTheAppliedChangeOnly, ForeignTextEmbedsAndFormatsSurviveTheOracle.
  - YDocWriteTests: OneTransactionEmitsOneUpdateReadableByYjs, PrelimMapIntegratesWithItsParent, SetAdmitsUndefined, JsonNumbersAlwaysLowerToDouble, TextWritesMatchYjs, TextSplitsOnSurrogatePairsLikeYjs, TextRoundTripsThroughNode.
  - YTextFormattingTests: FormattedWritesReadBackInYjs, ToDeltaReadsANullEmbed.
  - YjsEngineHarnessTests: NodeReplayAppliesAnEmptyUpdateAndReportsNoPending.
  - Go has a non-Node counterpart only for PrelimMapIntegratesWithItsParent and ToDeltaReadsANullEmbed (`write_test.go`). The rest are covered only transitively: Go bytes equal C# bytes (P1), and C# bytes are replayed into yjs. A direct port needs node in the Go CI job.
- **YrsCompatCorpusTests export side.** It belongs to the collab ledger, because it needs the converter.
- **Collab seam API.** Go exports `Doc`, `Map`, `Array`, `Text`, `XmlText`, `Inspect`, `Decode`, `DecodedUpdate`, `ApplyResult`, `UpdateEvent`, `lib0.Reader/Writer/ReadAny/WriteAny`. The collab port may need more accessors (item walking for `RichText`, for example). Add them there.
- **Panics.** `Doc.Transact`, and anything else with no error return, panics with `*yjs.EngineError` on an engine invariant failure. Collab must `recover()` at the room boundary (T12).
- **NEW, open (round 2): yjs drops the parentSub bit whenever the doc holds pending structs; neither engine does.** yjs `encodeStateAsUpdate` runs `mergeUpdates` when anything is pending (`encoding.js:522-540`). The merge re-reads every struct, and an item with an origin reads back with no parentSub, so it is rewritten without BIT6.
  - Measured with yjs 13.6.33: a doc holding map "m" key "k" set twice encodes the second value with info `a8` and nothing pending, but `88` once one unrelated struct is parked. The probe (run from the repo root):

    ```js
    const Y = require('yjs');
    const a = new Y.Doc(); a.clientID = 1000;
    a.getMap('m').set('k', 1); a.getMap('m').set('k', 2);
    const b = new Y.Doc(); b.clientID = 5;
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    console.log(Buffer.from(Y.encodeStateAsUpdate(b)).toString('hex'));
    // client 2000 at clock 5: parks
    Y.applyUpdate(b, Buffer.from('0101d00f0504010174016300', 'hex'));
    console.log(Buffer.from(Y.encodeStateAsUpdate(b)).toString('hex'));
    ```

    Output: `0102e807002101016d016b01a8e80700017d0201e807010001`, then `0201d00f0504010174016302e807002101016d016b0188e80700017d0201e807010001`.
  - C# writes `0x20` from `ParentSub` or `WireParentSubBit` (`YItem.cs:86`), whatever is pending. Go matches C#, so P1 is blind to it.
  - Impact: bytes only. A reader skips the parentSub bytes when an origin is set, so both forms decode to the same document. UNVERIFIED whether anything compares sync bytes to yjs.
  - `empty-structs.json` keeps its parked case free of parentSub for this reason, and says so in the generator.
  - Fix, if wanted: when pending structs or a pending delete set exist, write BIT6 only when the parentSub bytes are written (no origin and no right origin). Do it in C# first, regenerate P1 with `BLOK_WRITE_CSHARP_CAPTURE=1`, then Go.

## Known differences and edges (documented, not hidden)

- **T16.** Fixed in round 2: both engines sort parked structs stably.
- **D27.** `===` on `[]any` compares the backing array. An empty array with no backing store is never identical, even to itself. C# compares references.
  - This only matters for an empty array used as a text mark value.
- **BOM.** UNVERIFIED whether C# `JsonDocument.Parse(string)` skips a leading U+FEFF in raw JSON content. Go's jsjson reader was not checked for it either.

## Round 2 test runs

- `go test -race -p 2 -count=1 ./internal/lib0/... ./internal/yjs/... ./internal/jsjson/...`: all 4 packages ok. `gofmt -l internal/` printed nothing. `go vet ./internal/...` was clean.
- `dotnet test Blok.Server.Tests --filter Yjs|YDocConverter|JsJson`: 1191 passed, 0 failed.
- `vitest run test/unit/server-conformance/yjs-engine-fixtures.freshness.test.ts`: 59 passed (the generator was edited).
- `node scripts/test-server-conformance.mjs --target csharp`: 192 of 194 passed. The 2 fails were page-title sync timeouts (`status=connecting`). A rerun with `--test-name-pattern "page title"` passed 5/5, so they were load, not this change. The Mac was shared with other lanes' dotnet runs.

## Process note

The engine code was ported before its Go tests were written. The C# tests and the shared fixtures were the specification. Each Go test was checked to fail on a deliberate mutation:
- the parentSub bit;
- JSON depth;
- the YATA tie-break;
- the pending retry;
- `Changed`;
- the diff's pending structs;
- mark key order.
