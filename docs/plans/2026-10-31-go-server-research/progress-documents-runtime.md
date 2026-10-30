# Progress: documents-runtime lane

Branch `go/documents-runtime`. Ledger: `documents-runtime.md`. Read this first in the next round.

## Shared oracles added

| Fixture | Read by | Proves |
|---|---|---|
| `test/unit/server-conformance/fixtures/documents/looks-like-a-document.json` | xunit `LooksLikeADocumentFixtureTests`, Go `blokdocs` | D5, and D27's "non-document" half |
| `test/unit/server-conformance/fixtures/documents/host.json` | xunit `HostEnvelopeFixtureTests`, Go `blokdocs` | D10-D29: exact request bytes, href calls, result shape, error kind/reason/param/message |
| `test/unit/server-conformance/fixtures/documents/ops.json` (F-OPS, 397 cases) | xunit `DocumentOpsFixtureTests` (Jint), Go `jsruntime` `TestMatchesNodeOnTheDocumentOpsFixture` (goja), vitest `documents-ops-fixture.freshness.test.ts` (node regenerates) | B5-B24: every op over the C# test documents and edge cases |

`host.json` expectations are captured from C#: `BLOK_CAPTURE_HOST_FIXTURE=1 dotnet test Blok.Server.Tests --filter FullyQualifiedName~HostEnvelopeFixtureTests.CapturesTheFixtureWhenAsked`. A normal run compares, so a stale fixture fails C# too.

## C# bugs fixed (failing xunit first)

1. `BlokDocuments.LooksLikeADocument` threw on a repeated key (`ArgumentException`) and on a lone-surrogate key (`InvalidOperationException`), though it promises never to throw. `ValidateAsync` inherited it. Now it parses with `JsonDocument` and `AllowDuplicateProperties = false` and answers `false` for both.
   - Why refuse repeats instead of taking the last: Jint, once the bundle is loaded, reads `{"blocks":1,"blocks":[]}` as `blocks = 1` (`JSON.stringify` of the parsed object printed `{"blocks":1,"blocks":1}`), while node and plain Jint keep the last. Probe: `scratchpad/dr2/jint4.fsx`. A fresh Jint engine without the bundle keeps the last (`jint3.fsx`, `jint5.fsx`, `jint6.fsx`); the trigger inside the bundle is UNVERIFIED.
2. Envelope ops (plain text, texts, pageIndex, remap, with-pages, with-title) threw a raw `InvalidOperationException` on a document with a lone-surrogate escape: `JsonNode.Parse` accepts it and `ToJsonString` fails. Now `InvalidDocument`, like bad JSON. Bare ops (`ToHtml`, `ToMarkdown(doc)`) still pass the text to JS unchanged.

Probe output (`dotnet fsi`, .NET 10.0.400), verbatim:

```
dup blocks -> THROWS ArgumentException: An item with the same key has already been added. Key: blocks (Parameter 'key')
dup other -> THROWS ArgumentException: An item with the same key has already been added. Key: a (Parameter 'key')
lone key -> THROWS InvalidOperationException: Cannot read incomplete UTF-16 JSON text as string with missing low surrogate.
lone value -> true
deep 70 -> THROWS JsonReaderException: The maximum configured depth of 64 has been exceeded. Cannot read next JSON array. LineNumber: 0 | BytePositionInLine: 73.
deser lone -> THROWS JsonException: The JSON value could not be converted to System.String. Path: $[0] | LineNumber: 0 | BytePositionInLine: 9.
tojson lone -> THROWS InvalidOperationException: Cannot read incomplete UTF-16 JSON text as string with missing low surrogate.
tojson dup -> "{"x":1,"x":2}"
nest tojson dup -> "{"document":{"x":1,"x":2}}"
nest tojson lone -> THROWS InvalidOperationException: Cannot read incomplete UTF-16 JSON text as string with missing low surrogate.
```

```
dup root -> THROWS JsonException: Duplicate property 'blocks' encountered during deserialization.
dup escaped -> THROWS JsonException: Duplicate property 'blocks' encountered during deserialization.
dup nested -> THROWS JsonException: Duplicate property 'a' encountered during deserialization.
lone key -> THROWS InvalidOperationException: Cannot read incomplete UTF-16 JSON text as string with missing low surrogate.
```
(`JsonDocument.Parse` with `AllowDuplicateProperties = false`.) `new ArgumentException("msg", "texts").Message` is `msg (Parameter 'texts')`.

## Decisions

- Envelope ops refuse JSON nested past 64 (`JsonNode.Parse` default depth) with `InvalidDocument` and never call the runtime; bare ops hand it to JS. Pinned in `host.json`. Go uses `jsjson.ParseNode` with `MaxDepth` 0 (64), not `jsjson.Parse` (512).
- Map key order (`pages`, `blockIds`, `pageIds`) is not part of the contract: the bundle reads `pages` through `hasOwn` (`src/view/server-runtime.ts` `parsePagesRequest`) and `findRemapProblems` walks the document (`src/view/page-document-remap.ts:220`). Go writes keys in UTF-16 order; `host.json` maps are authored in that order, so C# and Go send the same bytes.

## Go layout

- `packages/server/go/blokdocs` (public): `New(Options)`, `*Converter` with every C# converter method, `LooksLikeADocument`, result types, `ConversionError{Reason}`, `TextCountError`/`UnmappedIDsError` (`ArgumentError` with `Param()`), `AnswerError`, `ErrNoVersion`, `StartupError`/`ConstraintError` (aliases).
- `packages/server/go/internal/jsruntime`: `NewPool(Options)`, `(*Pool).Invoke(ctx, op, input, timeout)`, `guard.go` (deadline, live-heap watchdog, cancel, all through `Interrupt`).

## Ledger rows

DONE = an oracle both languages run, or a Go hand-port of the C# test where a fixture cannot express it (timing, pool, cancellation; run with `-race`).

| Rows | Status | Oracle |
|---|---|---|
| R1, R2, R9, R26 | DONE | `ops.json` through `Pool.Invoke`; bundle law (embed); no host global is added |
| R3, R5, R6, R7, R13 | DONE | `TestTakesTheDefaultsForZeroOptions`, `TestRefusesLimitsBelowTheirFloors`, `TestLoadsAtTheFloors`, `TestReportsAnyOtherLoadFailure` |
| R4, R19 | DONE, approximate (U2) | `TestStopsACallThatOutgrowsItsMemoryBudget`. See decisions: live heap, 1 GiB default |
| R8 | DONE | `TestHandlesConcurrentCallsWithoutSharingAnEngine` (64 calls, pool 4, `-race`), `TestCallersWaitWhenEveryEngineIsBusy` |
| R10, R11, R12 | DONE | `TestReportsALoadThatOutgrowsTheBudget`, `…RunsPastTheTimeout`, `…AnyOtherLoadFailure` |
| R14, R15, R16, R17, R18 | DONE | `TestAPerCallTimeout*`, `TestCancellationEndsTheWaitForAnEngine`, `TestTimesOutInsideTheJobQueue`, `TestReturnsTheCallersCancellationUnwrapped`, `TestKeepsServingAfterATimeoutAndReplacesTheEngine` |
| R20, R21 | DONE | `TestClassifiesJavaScriptErrorsAndKeepsTheEngine`, `TestClassifiesTheBundlesOwnErrorsByName`, `ops.json` error cases (C# checks the reason too) |
| R22 | DEFERRED (no oracle) | The code recovers a Go panic inside goja as `Unknown` and replaces the engine, but no known input makes goja panic, so nothing tests it. |
| R23 | DONE | `TestKeepsTheSlotWhenARebuildFails` |
| R24 | N/A | A cap-N channel holding exactly the taken engines cannot refuse a send (comment in `pool.go`) |
| R25 | DONE, differs (U4) | `TestSurvivesRunawayRecursionAndKeepsTheEngine`, `TestConvertsADeeplyNestedOutline`. goja's overflow is not catchable in JS. |
| R27 | DONE (U5) | `TestFailsAPendingPromiseAtOnceAndKeepsTheEngine` |
| (late interrupt) | DONE | `TestDisarmClearsAnInterruptThatLandedAfterTheRun`, `TestALateInterruptAfterDisarmIsIgnored` (both mutation-checked: removing the guard line fails them) |
| D1, D2, D3, D4, D6 | DONE | `host.json` reasons; `TestRefusesLimitsBelowTheFloorsBeforeLoading`; `TestConvertsThroughTheEmbeddedBundle` |
| D5 | DONE | `looks-like-a-document.json` |
| D7 | DEFERRED | agent ledger (`blokagent`) |
| D8, D9 | DONE | C# xunit (existing) + Go `TestAsksTheBundleForItsVersionOnlyOnce`, `TestRefusesToHandOutAVersionTheBundleDoesNotHaveAndAsksAgain`, `TestFetchesTheSchemaOnce` |
| D10-D24, D26-D36 | DONE | `host.json` (84 cases); D27 also `TestReportsTheCallersOwnCancellationAsCancellation`. A lone surrogate in a bare document is a recorded divergence (see decisions), pinned by `TestReadsALoneSurrogateInABareDocumentAsAReplacementCharacter` |
| D25 | N/A | Go has no default interface members; `*Converter` is a concrete struct, so there is nothing to refuse |
| D37 | DONE | `host.json` page cases (`EmojiIcon`, `ImageIcon`, `Title *string`, `NoAccess`) |
| D38 | DECIDED | Go strings cannot be nil. A nil map reads as an empty map (Go convention). |
| H1 | DONE | `New` validates before loading (`TestRefusesLimitsBelowTheFloorsBeforeLoading`) |
| H3 | DONE | `Options.WarmUp`: `New` starts the warm-up (C#'s 220-block article) in a goroutine, never waits, ignores failure. `TestWarmsUpOffTheStartupPathWithALongArticle`, `TestIgnoresAWarmUpThatFails`, `TestWarmsUpOnlyWhenAsked` |
| H2, H4 | DEFERRED | host wiring in `cmd/blok-server` (http-host lane) |
| B1, B2, B3, B4 | DONE | `server-go-runtime-bundle-law.test.ts` (fresh build, C# copy, release rebuild) |
| B5-B15, B17-B21, B23, B24 | DONE | `ops.json` |
| B16 | DONE (fixture), agent ledger owns it | `ops.json` `manifest` (sha256) |
| B22 | DEFERRED | agent ledger |

Rows: 93. DONE, N/A or decided: 88. Deferred: 5 (D7, H2, H4, B22 to other ledgers; R22 for lack of an oracle).

## Decisions (continued)

- **Memory guard (R4).** goja has no allocation count. The watchdog polls `/gc/heap/live:bytes` every millisecond and interrupts past the budget. Measured on a 3 MiB data URL to Markdown: heap objects (with unswept garbage) peaked 738 MiB above the start; live heap peaked 412-562 MiB across runs. C# converts it under its 512 MiB churn budget, so the Go default is 1 GiB. C#'s `StopsAConversionThatOutgrowsTheBudgetItWasGiven` (64 MiB, 700 KB article to HTML) cannot be reproduced: goja's live heap for it is far smaller. Process-wide, so concurrent calls add up.
- **Stack limit (R25).** `SetMaxCallStackSize(10000)`. Measured frames per outline nesting level: plain text and Markdown about 3, HTML about 8 (1000 levels needed 8040). Jint (dotnet fsi main thread) converted 800 levels to HTML and failed at 1000.
- **Pending promise (R27).** Fails at once as `Unknown` and keeps the engine.
- **ConstraintError params** are the Go field names (`Timeout`, `MemoryBudget`, `PoolSize`, and `timeout` for a per-call value).
- **Lone surrogates (T5).** Envelope ops refuse them in both languages (C# fix 2). goja's `JSON.parse` reads a lone-surrogate escape as U+FFFD (measured: `JSON.parse('"a\\ud800b"').charCodeAt(1)` is `fffd`); node and Jint keep the unit. So bare ops on such a document differ in Go. `ops.json` `lone.*` pins it: the Go test expects node's answer with each lone escape read as U+FFFD.
- **Repeated keys.** Jint with the bundle loaded reads `{"blocks":1,"blocks":[]}` as `blocks = 1`; node and goja keep the last. The shape check refuses repeats in both languages. Bare ops still differ between engines on such a document; `ops.json` has no repeated-key case.
- **Intl (T6, U11).** Fixed in `src/shared/database/formula/dates.ts`: without `Intl`, UTC and the host zone read through `Date` getters, and any other zone is an invalid date (formula result empty). Jint output on the 46 probe cases is identical before and after (`scratchpad/dr2/jint-old.json` vs `jint-new.json`). Agent date formulas through goja are not yet exercised end to end (agent lane).

## Timings (ms, single sample, same machine, `ops.json` big cases)

goja: `go test -run …/big -v`, no race. Jint: xunit, Debug build, one engine, 5 min timeout.

| case | goja | Jint |
|---|---|---|
| big.plain.text (600 KB) | 200 | ~1,000 |
| big.plain.markdown | 420 | ~5,000 |
| big.plain.html | 520 | ~1,000 |
| big.marked.text (700 KB) | 2,290 | ~6,000 |
| big.marked.markdown | 2,310 | ~6,000 |
| big.marked.html | 3,370 | ~11,000 |
| big.marked.pageIndex | 5,840 | ~20,000 |
| big.marked.extract | 130 | 61 |
| big.url.image.markdown (3 MiB) | 1,670 | ~2,000 |
| big.url.bookmark.markdown | 2,190 | ~1,000 |
| big.fromMarkdown (~120 KB) | 3,560 | ~12,000 |

xunit rounds to whole seconds. `big.marked.pageIndex` ran 20 s in Jint here, twice the 10 s default timeout; the ledger probe (Release, own runner) measured 7.2 s.

## Remaining for the next round

- Agent date formulas through goja end to end (needs an `agentExecute` input; agent lane).
- Optional: replace goja's lossy `JSON.parse` so lone-surrogate escapes survive (would need a Go `JSON.parse` returning UTF-16 strings; not started).
- Optional: a `go generate` directive for the bundle (the law already fails a stale copy).
- R22 has no test (no known way to make goja panic).

## BREAKING (C# fixes in 42107cac, for the landing commit and release notes)

`LooksLikeADocument` and the envelope ops shipped in v1.16.1 (`git log v1.16.1..HEAD` on these files shows only this lane's commit). The commit subject lacks `BREAKING`; history was not rewritten, so the landing must label it:

- `BlokDocuments.LooksLikeADocument`: OLD threw `ArgumentException` on a repeated key at the root and `InvalidOperationException` on a lone-surrogate key, and returned `true` for a key repeated inside a block. NEW returns `false` for all three. Migration: none needed to stop the crash; a caller relying on `true` for a nested repeat must de-duplicate keys. `ValidateAsync` follows it.
  - The nested part is avoidable: refusing only root repeats and lone-surrogate keys keeps the old `true`. It was kept because Jint with the bundle loaded misreads nested repeats too (measured: `{"type":"paragraph","type":"header"}` renders `<p>a</p>` in Jint and `<h2>b</h2>` in node, `scratchpad/dr2/nested.fsx`).
- Envelope ops (`ToPlainText*`, `ExtractTexts`, `InjectTexts`, `GetPageIndex`, `RemapPageDocument`, `*WithPages`, `*WithTitle`): OLD threw a raw `InvalidOperationException` for a document holding a lone-surrogate escape. NEW throws `BlokDocumentConversionException` with `Reason = InvalidDocument`. Migration: catch `BlokDocumentConversionException`.

## Known divergence: lone surrogate in a bare document (not fixed this round)

Measured with the real runtimes on `{"blocks":[{"id":"p","type":"paragraph","data":{"text":"a\ud800b"}}]}` (`scratchpad/dr2/lonemd.fsx`):

| Call | C# (Jint) | Go (goja) |
|---|---|---|
| `ToMarkdown` (bare) | throws raw `JsonException` (`…could not be converted to BlokMarkdownConversion. Path: $.markdown`) | `"a\ufffdb"` |
| `ToHtml` (bare) | `<p>a` + U+D800 + `b</p>` (UTF-8 on the wire turns it into U+FFFD) | `<p>a\ufffdb</p>` |
| `ValidateAsync`, lone-surrogate block type | `Failure = Unknown` (the answer fails to deserialize) | `UnrecognizedBlockTypes = ["\ufffd"]` |

The raw `JsonException` from C# `ToMarkdownAsync` is a C# bug (the contract promises `BlokDocumentConversionException`). It is not fixed yet because the fix is a design choice that changes a shipped surface either way: refuse such documents on the bare ops too (a host parse on a path that is raw by design), or read answers with `JsJson.Parse` so the unit survives. Go cannot keep the unit in either case unless goja's `JSON.parse` is replaced. Needs a user decision.

## Process note

`pool.go` and `guard.go` were written before `pool_test.go`, not test-first. Compensating evidence: two mutation checks (drop `ClearInterrupt`; drop the `finished` guard), each failing a guard test, and the reuse counts in the pool tests. Everything else in this lane was test-first (C# fixes, Intl, blokdocs, warm-up, the fixtures).
