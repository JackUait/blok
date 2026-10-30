# Progress: yjs-lib0 lane (round 1, 2026-10-31)

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

Commit `fix(server): read wire JSON content with JsJson.Parse` (533aea17).
- `ContentJson.GetContent` and `ContentEmbed.GetContent` now use `JsJson.Parse`.
  - Before, a `JsonNode` accepted a lone surrogate escape and threw on first read.
- The converter (`YDocConverter.TryToPlain`) drops a string holding a lone surrogate, as it drops undefined.
  - Before, `TryReadWireJson` dropped the WHOLE wire value. Now only that string goes; the rest survives (`ExportDropsOnlyTheLoneSurrogateStringInsideAWireJsonValue`).
  - `ExportSkipsAWireJsonValueItCannotMaterialise` still passes.
- Side effects for refs 2 and 5 only (no Blok client writes them), pinned by `ExportWritesWireJsonAsJavaScriptReadsIt`:
  - `{"n":1.0,"e":1e2,"i":1e999}` now exports as `{"n":1,"e":100,"i":null}`. Before, it exported the raw number text `1.0`, `1e2`, `1e999`. That old output comes from probe 3 (`JsonNode ... ok -> 1e999`); it was not re-run on the old code.
  - A 300-deep ref-2 array now exports as 256 levels with null at the bottom (the converter's lockstep cap). Before, it exported whole.
  - `SameAsLive` can now find an equal wire value. Before, it never could, so it always rewrote.
- **Behaviour change on a shipped surface.** `TryReadWireJson` shipped in v1.16.1 (`git merge-base --is-ancestor` on commit 8372f514). Commit 533aea17 carries no BREAKING label. The label and a release note are owed when this lands, and the user decides.
  - Compatible route, if wanted: keep the raw text beside the parsed value, and let the converter re-read the raw text as before.
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
| S1-S19 | DONE | scenarios + fuzz + P1; store, delete set, pending, parked-coverage and hostile ports |
| D1-D28 | DONE | scenarios engineWrites bytes, P1, integration/write/text ports, P4/P5 twins |
| X1-X6 | DONE | varint.json, P2 twins, TooDeepPastTheCap, AGapWiderThanAnInt |

So 112 DONE and 1 deferred with a reason.

## Not done / round 2

- **NodeReplay harness for Go** (the 8 C# tests marked NODE: EncoderTests ×5, YDocWriteTests ×2, YTextFormattingTests ×1, plus the harness test).
  - They are covered transitively: Go bytes equal C# bytes (P1), and C# bytes are replayed into yjs.
  - A direct port needs node in the Go CI job.
- **YrsCompatCorpusTests export side.** It belongs to the collab ledger, because it needs the converter.
- **Collab seam API.** Go exports `Doc`, `Map`, `Array`, `Text`, `XmlText`, `Inspect`, `Decode`, `DecodedUpdate`, `ApplyResult`, `UpdateEvent`, `lib0.Reader/Writer/ReadAny/WriteAny`. The collab port may need more accessors (item walking for `RichText`, for example). Add them there.
- **Panics.** Engine invariant violations panic with `*yjs.EngineError`. `Doc.ApplyDecoded` turns that into an error. Any other panic, or one from `Doc.Transact`, propagates. Collab must `recover()` at the room boundary (T12).

## Known differences and edges (documented, not hidden)

- **T16.** Go sorts parked structs stably. C# `List.Sort` is unstable from 16 elements.
  - P1 shows no difference on today's fixtures.
  - UNVERIFIED for 16 or more equal-clock parked structs.
- **D27.** `===` on `[]any` compares the backing array. An empty array with no backing store is never identical, even to itself. C# compares references.
  - This only matters for an empty array used as a text mark value.
- **BOM.** UNVERIFIED whether C# `JsonDocument.Parse(string)` skips a leading U+FEFF in raw JSON content. Go's jsjson reader was not checked for it either.

## Process note

The engine code was ported before its Go tests were written. The C# tests and the shared fixtures were the specification. Each Go test was checked to fail on a deliberate mutation:
- the parentSub bit;
- JSON depth;
- the YATA tie-break;
- the pending retry;
- `Changed`;
- the diff's pending structs;
- mark key order.
