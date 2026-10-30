# Go parity ledger: documents + runtime

Area: `Blok.Server/Documents`, `Blok.Server/Runtime`, `scripts/build-server-runtime.mjs`, `src/view/server-runtime.ts`, their C# tests, and the DI/warm-up glue in `Blok.Server.AspNetCore/BlokDocumentsServiceCollectionExtensions.cs`.

Date: 2026-10-31. Bundle probed: `packages/server/dotnet/Blok.Server/Generated/blok-server-runtime.js`, already built (Oct 31 00:47, 887,159 bytes, sha256 `ad1be39e…6787e`, reports version `1.16.1`). I copied it and did not rebuild it. Probe code is in `/private/tmp/claude-501/-Users-jackuait-Packages-blok/1972ea3d-88af-4e14-951b-0edd9367e8e3/scratchpad/documents-runtime/`.

## 0. Headline findings (all measured this session)

1. **goja runs the bundle unchanged and matches it exactly.** I sent 46 cases (every documents op plus `htmlFieldsToSegments`, `manifest`, error paths, and the large and deep documents from `JintBlokRuntimeTests`) through node:vm, goja and Jint 4.17.0 (with JintBlokRuntime's settings). All three gave the same output for all 46 (`diff.mjs`: `46/46 identical`, both goja-vs-node and jint-vs-goja). Two caveats:
   - The import ops make ids from the clock (`md-<base36>-N`, `html-<base36>-N`), so the diff normalizes them.
   - The three error cases agree on `error.name`. Only `err.notjson` has different messages: Jint says `Unexpected token ILLEGAL in JSON at position 0`, goja says `invalid character 'o' in literal null (expecting 'u')`, and V8 has its own text. The other two messages are the same in all three engines (critique.md §4). C# classifies by `name` only (`JintBlokRuntime.cs:286-290`), so the outcome is the same.
2. **Load cost:**
   - goja: `goja.Compile` 138.9 ms, then `RunProgram` 11.0 ms.
   - A second goja runtime from the same compiled `*goja.Program` costs 7.6 ms.
   - Jint: first engine 2,335 ms, second 537 ms.
   - node:vm: 40.9 ms.
   - So a Go pool can compile once and build every engine cheaply.
3. **Timeout works:** `vm.Interrupt(v)` from a timer goroutine stops `for(;;){}` at 201 ms, also inside JS `try/catch`, and also after `await` (job queue) at 224.6 ms. It comes back as `*goja.InterruptedError`.
   - **Gap:** an interrupt cannot stop a native builtin while it runs. (Single samples; a re-run gave about half these figures, critique.md §4.) A backtracking regex `/^(a+)+$/.test('a'*24+'b')` was stopped only after **7,301 ms**, and `'a'*26` after 11,014 ms (15,221 ms with the `u` flag), even though the deadline was 200 ms.
   - Jint's deadline constraint has the same blind spot in principle (UNVERIFIED for Jint).
   - The runtime stays usable after `ClearInterrupt()`. It also answered `1+1` without `ClearInterrupt()`, but call `ClearInterrupt()` anyway.
4. **No allocation budget exists in goja (parity gap).** goja has no `LimitMemory` equivalent.
   - Measured stand-in: a watchdog goroutine reads `runtime/metrics` `/gc/heap/allocs:bytes` every 1 ms and calls `Interrupt` past 64 MiB. It stopped an unbounded `push` loop at 146 ms with a 64 MiB delta, and peak RSS was 68 MB.
   - That counter is **process-wide**, so with more than one engine busy it blames whichever call crosses the line.
   - goja concatenates strings lazily: the Jint test script `grown += grown` reached n=62 and threw `RangeError: Invalid array or string length` after 1.1 ms, allocating 0 MiB. The C# test `ReportsAMemoryLimitAsBloksOwnFailure` would therefore get `Unknown`, not `DocumentTooLarge`, in Go.
5. **Stack guard differs.** `SetMaxCallStackSize(10000)` turns runaway recursion into `*goja.StackOverflowError`, a Go error. **JS `try/catch` cannot catch it** (measured: the catch did not run). In Jint, `StackOverflowGuard` raises a **catchable `RangeError`** (measured: `caught:RangeError`). The engine is reusable afterwards in both: goja ran depth 9000 next. With no limit, goja ran depth 1e6 in 28,083 ms with 462 MiB of heapInuse (single sample; a re-run gave 23,417 ms and 371 MiB, critique.md §4). Go-native recursion: `JSON.parse` at depth 1e6 gives a catchable `SyntaxError: exceeded max depth`, the compiler refuses nesting past 5000 (`Maximum nesting depth exceeded`), and `JSON.stringify` at depth 1e5 succeeded in 38,484 ms. Depth 1e6 was still running after more than 600 s, so I stopped it: UNVERIFIED whether it ends or crashes.
6. **Sticky regex:** the bundle has **0 sticky regex literals**. I tokenized it with acorn: 361 regex literals, flags `g:94 i:38 u:16 m:1`. A failed per-position `/[ac]x/y` probe over `'b'*n`:

   | Engine | n=10k | n=20k | n=40k | n=80k |
   |---|---|---|---|---|
   | goja | 133 ms | 801 ms | 3,889 ms | — |
   | goja, `/a/y` | 256 ms | 1,273 ms | 4,525 ms | 20,807 ms |
   | goja, `/a/yu` | — | — | — | 103,306 ms |
   | Jint 4.17.0 | 559 ms (first, cold) | 57 ms | 323 ms | — |
   | node | 0.4 ms | — | — | 1.5 ms |

   goja is **quadratic**: about 4–5x per doubling. In this session Jint was **not** quadratic for these two patterns, which differs from the memory note, probably because the pattern differs. The "no sticky regex in server-bundled code" law matters MORE for Go. Today it guards only `src/markdown/engine` and `src/html` (`test/unit/markdown/engine/no-sticky-regex-law.test.ts:13-15`). It should scan the built bundle.
7. **Missing globals in goja:** `Intl`, `structuredClone`, `URL`, `TextEncoder`, `queueMicrotask` and `setTimeout` are all `undefined`. Jint has `Intl` (measured: `new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Yekaterinburg',…}).format(new Date(0))` gives `01/01/1970, 05:00`). The bundle calls `new Intl.DateTimeFormat(...).formatToParts` without a guard, in a date-formula helper (`FC=e=>{…new Intl.DateTimeFormat("en-US",{timeZone:e,hourCycle:"h23",…})`). The documents ops never reach it (all 46 matched), but agent date formulas would throw `ReferenceError` in goja. `structuredClone` and `crypto` are guarded with `typeof`, and so is `new URL` (behind `typeof window`).
8. **Strings are UTF-16 vs UTF-8:**
   - goja `Value.String()` turns a lone surrogate into U+FFFD (`'a\ud83db'` → `"a�b"`). `JSON.stringify` keeps it as `\ud83d`.
   - Go `encoding/json` into `any` also turns `\ud83d` into U+FFFD. It also sorts object keys, and rounds `9007199254740993` to `…992` and `1.0` to `1`. `json.RawMessage` keeps all of these.
   - C# `JsonNode.Parse(...).ToJsonString()` keeps key order and number text. It escapes every non-ASCII and HTML character (`é`, `<`). On a **lone surrogate it THROWS `InvalidOperationException`** ("Cannot read incomplete UTF-16 JSON text as string with missing low surrogate"), and that is not a `BlokDocumentConversionException`.

## 1. Parity ledger

Oracle column: "NONE" means no test that both languages run exists today. The JS tests in `test/unit/server-runtime/index.test.ts` (67 `it`) import `invoke` straight into vitest/node. They pin the bundle's meaning, not any server engine. The conformance suite (`test/unit/server-conformance`) has nothing for documents: it is HTTP/sync only, and `doc-endpoint.ts` is a fake document store, not conversion. Proposed fixtures are in section 3. Proposed Go layout:
- `packages/server/blokdocs`: public, the Go equivalent of `Blok.Server.Documents`.
- `packages/server/internal/jsruntime`: the goja pool.
- `packages/server/internal/jsruntime/generated/blok-server-runtime.js`: the embedded bundle.

### 1a. Runtime (`Blok.Server/Runtime`)

| # | C# location | What it does | Existing coverage (none runs Go) | Go file |
|---|---|---|---|---|
| R1 | `Runtime/IBlokRuntime.cs:12-16` | Runs one op `(operation, inputJson, timeout?, ct)` and returns a string. | NONE → F-RT | `internal/jsruntime/runtime.go` `Invoke(ctx, op, input string, timeout time.Duration) (string, error)` |
| R2 | `JintBlokRuntime.cs:14,150-165` | Loads the bundle from the embedded resource `Blok.Server.Runtime.blok-server-runtime.js`. A missing resource throws `InvalidOperationException`. | `test/unit/architecture/server-release-wiring.test.ts:180-182` (C#-only wiring) | `internal/jsruntime/bundle.go` (`//go:embed generated/blok-server-runtime.js`). `go doc embed`: patterns may not contain `..`, so the bundle must be copied under the package. |
| R3 | `JintBlokRuntime.cs:16` | Default per-call timeout of 10 s. | NONE → F-RT | `runtime.go` `DefaultTimeout` |
| R4 | `JintBlokRuntime.cs:30` | Default allocation budget of 512 MiB, counted as churn per call. | NONE, and goja has no equivalent (finding 4) | `runtime.go` + `budget.go` (watchdog), or drop it with a documented gap |
| R5 | `JintBlokRuntime.cs:51` | Budget floor of 8 MiB. Loading the 1.14.0 bundle allocated 8,406,648 B (comment :41-44). | `BlokRuntimeStartupTests.PublishesTheFloorsItEnforces` (C#) | `runtime.go` `MinimumAllocationBudgetBytes` |
| R6 | `JintBlokRuntime.cs:53` | Timeout floor of 100 ms. | same | `runtime.go` `MinimumTimeout` |
| R7 | `JintBlokRuntime.cs:66-72` | Constructor refuses a blank script, `poolSize<1`, or `budget<1`. | NONE | `runtime.go` `New` |
| R8 | `JintBlokRuntime.cs:77-83,161-162` | Bounded pool. Default size `max(1,min(ProcessorCount,4))`. Callers wait for a free engine. | `JintBlokRuntimeTests.HandlesConcurrentCallsWithoutSharingAnEngine` (C#) | `runtime.go`: `chan *engine` of cap N, `runtime.NumCPU()`. Measured with `go run -race ./cmd/pool`: 4 runtimes from one `*goja.Program`, 64 concurrent `blocksToPlainText` calls, 0 wrong, no race report, 211 ms. |
| R9 | `JintBlokRuntime.cs:84-128` | Builds every engine at construction, each under the same timeout and budget. | NONE | `runtime.go` (compile `*goja.Program` once, then `RunProgram` per engine: 7.6 ms each, measured) |
| R10 | `JintBlokRuntime.cs:98-107` | A load that runs out of memory gives `BlokRuntimeStartupException` naming the budget, the default and the floor. | `BlokRuntimeStartupTests.ReportsAnExhaustedLoadBudgetAsBloksOwnException` (C#) | `runtime.go` `*StartupError{Cause: Budget}` |
| R11 | `JintBlokRuntime.cs:108-116` | A load that times out gives `BlokRuntimeStartupException` naming the timeout. | `…ReportsALoadThatRunsPastTheTimeoutAsBloksOwnException` (C#) | same, `Cause: Timeout` |
| R12 | `JintBlokRuntime.cs:117-122` | Any other load failure gives `BlokRuntimeStartupException("Could not load …")`. | `BlokRuntimeStartupTests` (C#) | same |
| R13 | `JintBlokRuntime.cs:136-148` | `ValidateConstraints`: below a floor gives `ArgumentOutOfRangeException` with the param name (`allocationBudgetBytes`/`timeout`). | `JintBlokRuntimeTests.ExplainsAStartUpTooSmallToLoadTheBundle` (C#) | `runtime.go` `ValidateConstraints` returning a typed `*ConstraintError{Param}` |
| R14 | `JintBlokRuntime.cs:176-179,189` | A per-call timeout replaces the default for that call only. It is floored at 100 ms. | `JintBlokRuntimeTests.APerCallTimeout*` (C#) | `runtime.go` |
| R15 | `JintBlokRuntime.cs:181` | Cancellation ends the wait for an engine. | NONE | `select` on `ctx.Done()` |
| R16 | `JintBlokRuntime.cs:189,301-306,309-326` | The deadline covers the whole async call, including promise jobs. | NONE | `time.AfterFunc(t, vm.Interrupt)`. Measured: it fires inside the job queue (finding 3). |
| R17 | `JintBlokRuntime.cs:200-204` | Caller cancellation stays `OperationCanceledException` and the engine is replaced. | `JintBlokRuntimeTests.ReplacesAnEngineAfterCancellation`; `BlokDocumentConverterTests.StillReportsTheCallersOwnCancellationAsCancellation` (C#) | return `ctx.Err()` unwrapped; interrupt then discard the engine |
| R18 | `JintBlokRuntime.cs:212-216` | A timeout gives `BlokConversionFailure.TimedOut` and the engine is replaced. | `JintBlokRuntimeTests.TimesOutInsteadOfHanging`, `KeepsServingAfterATimeout` (C#) | `*goja.InterruptedError` → `ErrTimedOut` |
| R19 | `JintBlokRuntime.cs:217-221` | Running out of memory gives `DocumentTooLarge` and the engine is replaced. | `ReportsAMemoryLimitAsBloksOwnFailure`, `StopsAConversionThatOutgrowsTheBudgetItWasGiven` (C#) | watchdog interrupt value `"budget"` → `ErrDocumentTooLarge` (approximate) |
| R20 | `JintBlokRuntime.cs:229-236` | A promise rejection or JS exception is classified, and the **engine is reused**. | NONE | rejected `*goja.Promise` / `*goja.Exception` |
| R21 | `JintBlokRuntime.cs:284-291` | `error.name` of `SyntaxError` or `TypeError` gives `InvalidDocument`; anything else gives `Unknown`. | `JintBlokRuntimeTests.DoesNotBlameTheDocumentForAFailureThatIsNotAboutIt` (C#) | `classify.go` |
| R22 | `JintBlokRuntime.cs:240-244` | Any other exception gives `Unknown` and the engine is replaced. | NONE | `classify.go` |
| R23 | `JintBlokRuntime.cs:256-268` | If building a replacement fails, the spent engine goes back. A pool slot is never lost and this never throws. | `KeepsServingAfterATimeout` (3 loops) (C#) | `runtime.go` |
| R24 | `JintBlokRuntime.cs:270-273` | If an engine cannot be returned to the pool, it throws `InvalidOperationException`. | NONE | non-blocking send cannot fail on a cap-N chan; document it |
| R25 | `JintBlokRuntime.cs:314,207-210` | The stack guard turns runaway recursion into a JS `RangeError` (`Unknown`) and the engine is reused. | `JintBlokRuntimeTests.SurvivesRunawayRecursionAndKeepsServing`, `ConvertsADeeplyNestedOutline` (C#) | `SetMaxCallStackSize(N)` → `*goja.StackOverflowError` → `Unknown`, then reuse. Measured: reusable, but NOT catchable in JS (finding 5). The 120-deep `nested.md` and `nested.text` convert under `SetMaxCallStackSize(10000)` (measured, `cmd/pool`). |
| R26 | `JintBlokRuntime.cs:310-321` | The engine gets no host globals: it only runs `Execute(script)`. | NONE | do not add globals except an `Intl` shim if needed (finding 7) |
| R27 | `JintBlokRuntime.cs:190-194` | The result is the settled promise value, taken with `.AsString()`. | NONE | read `Promise.State()` after the call. Measured: goja drains jobs before the call returns, so it is settled. A still-pending promise can never settle (no event loop, measured `state=0`). Treat it as `Unknown`, unlike Jint, which waits for cancellation. |

### 1b. Documents (`Blok.Server/Documents`)

| # | C# location | What it does | Existing coverage (none runs Go) | Go file |
|---|---|---|---|---|
| D1 | `IBlokDocumentConverter.cs:10-38` | `BlokConversionFailure` = Unknown / InvalidDocument / TimedOut / DocumentTooLarge. | NONE → F-HOST | `blokdocs/errors.go` (`type Failure int` + consts) |
| D2 | `IBlokDocumentConverter.cs:54-97` | `BlokDocumentConversionException`: `Reason` plus one fixed message per reason (:89-96). | `JintBlokRuntimeTests` (C#) | `blokdocs/errors.go` `*ConversionError{Reason, Err}` with `Unwrap` |
| D3 | `BlokRuntimeStartupException.cs:19` | Startup error. It derives from `InvalidOperationException` for older callers. | `BlokRuntimeStartupTests.KeepsTheExceptionTypeCallersAlreadyCatch` (C#) | `blokdocs/errors.go` `*StartupError` (no Go analogue of the base type) |
| D4 | `BlokDocuments.cs:22,35` | Public floor constants. | `PublishesTheFloorsItEnforces` (C#) | `blokdocs/blokdocs.go` |
| D5 | `BlokDocuments.cs:69-85` | `LooksLikeADocument`: true only for a JSON object whose `blocks` is an array. Never throws, including on null/whitespace. | `BlokDocumentInspectionTests.SaysNothingAboutWhetherTheBlocksAreReadable`, `AgreesWithTheFullInspectionOnWhatIsNotADocument` (C#) | `blokdocs/validate.go`. Trap T5: on a lone surrogate, C# `JsonNode.Parse` succeeds but Go must not differ. |
| D6 | `BlokDocuments.cs:122-129` | `Create(poolSize, timeout, budget)` builds a converter over a fresh pool. | NONE | `blokdocs.New(Options)` |
| D7 | `BlokDocuments.cs:136-143` | `CreateAgentExecutor` over its own pool. | see agent ledger | `blokagent` |
| D8 | `BlokDocumentConverter.cs:17-41` | `GetVersionAsync` caches the version. `"dev"` or `""` throws `InvalidOperationException` and is never cached. | `BlokDocumentConverterTests.ReportsTheEditorsOwnDocumentVersion`, `RefusesToHandOutAVersionTheBundleDoesNotHave`, `AsksTheBundleForItsVersionOnlyOnce` (C#) | `blokdocs/converter.go` (`sync.Once`-like, but retry on dev) |
| D9 | `BlokDocumentConverter.cs:73-76` | `GetSchemaAsync`, cached. 77,615 UTF-16 chars, measured. | `DescribesTheSavedFormatAsJsonSchema`, `TheSchemaTakesSegmentsOrHtmlInARichTextField` (C#) | same |
| D10 | `BlokDocumentConverter.cs:43-53` | `ToMarkdownAsync(doc)`: sends the raw string to `blocksToMarkdown` and deserializes `{markdown, warnings}`. | `ConvertsADocumentToMarkdown`, `ReportsConstructsThatCouldNotSurviveMarkdown`, `SkipsAMalformedBlockAndReportsIt` (C#) | `converter.go` |
| D11 | `BlokDocumentConverter.cs:55-68` | `ToMarkdownAsync(doc, pages, pageHref)` → `blocksToMarkdownWithPages`. | `BlokPageExportTests.LinksAllowedPagesInMarkdown`, `GivesMarkdownTitlesWithoutAnHrefBuilder` (C#) | `converter.go` |
| D12 | `BlokDocumentConverter.cs:255-320` | Pages envelope on the wire: a null info is JSON `null` ("missing") and a left-out id means "unresolved". `NoAccess` gives `{"access":"none"}` and `pageHref` is not called. `title` and `icon` (`{type:image,url}` / `{type:emoji,value}`) are sent only when set. `href` is sent only when non-empty. | `SendsAMissingPageAsJsonNull`, `SendsAnImageIconWithItsUrl`, `RendersAllowedDeniedMissingAndUnlistedPagesToHtml`, `IgnoresPagesCarriedInsideTheDocument`, `OldOverloadsStillSendTheBareDocumentToTheOldOperations` (C#, via a RecordingRuntime) | `converter.go` `pagesRequest` (`map[string]*PageInfo`, nil means missing) |
| D13 | `BlokDocumentConverter.cs:78-92,197-211` | `ExtractTextsAsync` sends `{document, includeCode}` and gets `string[]`. | `ExtractsTheStringsWorthTranslating`, `IncludesCodeOnlyWhenAsked`, `ReportsUnreadableInputTheSameWayOnTheTranslationPath` (C#) | `converter.go` |
| D14 | `BlokDocumentConverter.cs:94-120` | `InjectTextsAsync` sends `{document, includeCode, texts}`. A `mismatch` gives `ArgumentException("This document yields {e} translatable strings, but {r} were given.", "texts")`. It returns `document.ToJsonString()`, which is re-serialized (T4). | `PutsTranslationsBackWithoutLosingAnythingElse`, `RefusesATranslationListThatDoesNotMatchTheDocument` (C#) | `converter.go` `*TextCountError{Expected, Received}` |
| D15 | `BlokDocumentConverter.cs:122-135` | `GetPageIndexAsync` sends `{document}` and gets `{owners, text, references}`. | `BlokPageFunctionsTests.IndexesOwnersReferencesAndTextThroughTheRuntime`, `ReportsADocumentWithNoBlocksAsAnInvalidDocument` (C#) | `converter.go` |
| D16 | `BlokDocumentConverter.cs:137-191` | `RemapPageDocumentAsync` sends `{document, blockIds, pageIds}`. `unmapped` gives `ArgumentException(paramName "blockIds")` with the message `No new id for "a", "b"; More than one block maps to "x"; N block(s) without an id.`, joining only the non-empty parts. | `RemapsIdsAndKeepsUnknownKeys`, `RefusesIdMapsThatDoNotCoverTheDocument`, `RefusesNullRemapArguments` (C#) | `converter.go` `*UnmappedIDsError` (keep the message text identical) |
| D17 | `BlokDocumentConverter.cs:218-232` | Plain-text envelope `{document, includeHiddenText[, title:true]}`. | `ReadsTheHiddenMediaTextOnlyWhenAsked`, `CarriesTheHiddenTextOptionThrough` (C#) | `converter.go` |
| D18 | `BlokDocumentConverter.cs:238-247` | Title envelope `{document, title:true}`. The flag is read only from a wrapper (`server-runtime.ts:157-170`). | `BlokDocumentConverterTitleTests` (5) (C#) | `converter.go` |
| D19 | `BlokDocumentConverter.cs:328-338` | Envelope ops parse the document on the host. Bad JSON gives `InvalidDocument` before any engine is used. Bare ops (`ToHtml`, `ToMarkdown(doc)`) send the raw string and get `SyntaxError` → `InvalidDocument` from JS. | `BlokPageExportTests.ReportsUnreadableJsonAsAnInvalidDocument`, `BlokPageFunctionsTests.ReportsUnreadableJsonTo*` (C#) | `converter.go` `parseDocument` → `json.RawMessage` (T4) |
| D20 | `BlokDocumentConverter.cs:340-357` | `ToHtmlAsync` bare and with pages. Returns a bare string. | `RendersHtmlAndPlainText`, `RendersATableOfContentsThatLinksToItsHeadings`, `DropsAScriptCapableHref` (C#) | `converter.go` |
| D21 | `BlokDocumentConverter.cs:359-370` | `ToPlainTextAsync(doc, includeHiddenText)`. | `RendersHtmlAndPlainText` (C#) | `converter.go` |
| D22 | `BlokDocumentConverter.cs:372-387` | `ToHtmlWithTitleAsync` ×2. The emoji is wrapped in `<span aria-hidden="true">` and an image icon is `<img alt="">` (doc :306-307). | `WritesTheTitleAsAnH1` (C#) | `converter.go` |
| D23 | `BlokDocumentConverter.cs:389-412` | `ToMarkdownWithTitleAsync` ×2. An image icon is dropped. | `WritesTheTitleAsAMarkdownHeading` (C#) | `converter.go` |
| D24 | `BlokDocumentConverter.cs:414-425` | `ToPlainTextWithTitleAsync`. The title becomes the first line. | `WritesTheTitleAsTheFirstPlainTextLine` (C#) | `converter.go` |
| D25 | `IBlokDocumentConverter.cs:416-497` | The title methods are default interface members that throw `NotSupportedException`. | `AnImplementationWithoutTheTitleMethodsCompilesAndRefusesThem` (C#) | Go: N/A. Go interfaces have no defaults. Decide: a Go interface would break implementers, so expose a concrete struct. |
| D26 | `BlokDocumentConverter.cs:427-441` | `ToPlainTextWithReportAsync` → `{text, warnings}`. | `BlokPlainTextReportTests` (6) (C#) | `converter.go` |
| D27 | `BlokDocumentConverter.cs:450-481` | `ValidateAsync` never throws. A non-document is answered without an engine. A runtime failure becomes a `Failure`. `IsDocument` is set on the host. Cancellation still propagates. | `BlokDocumentInspectionTests` (11) incl. `AnswersANonDocumentWithoutTouchingTheRuntime` (CountingRuntime) (C#) | `blokdocs/validate.go` |
| D28 | `BlokDocumentConverter.cs:483-505` | `FromMarkdownAsync` sends `{markdown}`; `FromHtmlAsync` sends `{html}`. | `RoundTripsMarkdownThroughBlocks`, `ImportsHtmlAsADocumentEnvelope`, `ReportsWhatHtmlCouldNotCarryIn` … (C#) | `converter.go` |
| D29 | `BlokDocumentConverter.cs:511-529` | The import envelope strips `warnings` out of the stored JSON and returns the rest re-serialized (T4). | `ImportsMarkdownAsADocumentEnvelope` (C#) | `converter.go`, order-preserving removal (T4) |
| D30 | `BlokMarkdownConversion.cs:8-10` | `{markdown, warnings[]}`. | as D10 | `blokdocs/types.go` |
| D31 | `BlokMarkdownConversion.cs:21-23` | `{text, warnings[]}`. | as D26 | `types.go` |
| D32 | `BlokMarkdownConversion.cs:28-30` | `BlokImportConversion(DocumentJson, Warnings)`. | as D28 | `types.go` |
| D33 | `BlokMarkdownConversion.cs:40-47` | Action constants `dropped` / `degraded`. The field stays an open string. | `NamesTheTwoDegradationOutcomesItReports` (C#) | `types.go` (string consts, not an enum) |
| D34 | `BlokMarkdownConversion.cs:62-65` | `BlokDegradation{construct, action, detail}`. | as D10 | `types.go` |
| D35 | `BlokDocumentValidation.cs:24-84` | `isEmpty`, `blockCount`, `malformedBlockCount`, `unrecognizedBlockTypes`, plus host-only `IsDocument`, `Failure`, `IsFullyUnderstood`. | `BlokDocumentInspectionTests` (C#) | `types.go` |
| D36 | `BlokPageIndex.cs:13-43` | Rows: owners `{pageId, sourceBlockId, order}`, text `{blockId?, order, text}`, references `{pageId, sourceBlockId?, order}`. | `IndexesOwnersReferencesAndTextThroughTheRuntime` (C#) | `types.go` (`*string` for nullable ids) |
| D37 | `BlokPageInfo.cs:12-62` | `PageInfo{Title?, Icon?, NoAccess}`; `PageIcon.Emoji` / `Image` reject null. | `BlokPageExportTests` (C#) | `types.go` |
| D38 | many (`ArgumentNullException.ThrowIfNull`) | Null arguments are refused. | `RefusesANullDocument`, `RefusesNullRemapArguments` (C#) | Go strings cannot be nil. A nil map (pages/blockIds/pageIds) should return an error, to mirror C#. Decision needed. |

### 1c. Hosting glue (`Blok.Server.AspNetCore`)

| # | C# location | What it does | Existing coverage (none runs Go) | Go file |
|---|---|---|---|---|
| H1 | `BlokDocumentsServiceCollectionExtensions.cs:57-72` | `AddBlokDocuments(poolSize, timeout, warmUp=true, budget)` checks the floors at registration time. | `BlokDocumentsRegistrationTests.RefusesAStarved*WhileRegistering` (C#) | `blokdocs.New` returns the error up front |
| H2 | same :74-86 | One singleton runtime is shared by the converter AND the agent executor. | `RegistersOneConverterAcrossRepeatedAndMixedRegistration` (C#) | host wiring in `cmd/blok-server` |
| H3 | same :120-183 | Background warm-up: builds the pool and converts a 220-block article, swallows every error, never delays startup. | `BuildsTheConverterOffTheStartupPath`, `ConvertsSomethingAtStartupRatherThanOnlyBuildingThePool`, `SkipsTheWarmUpWhenItIsNotWanted` (C#) | `blokdocs.WarmUp(ctx)` in a goroutine. Its reason in C# is JIT promotion (:103-111); in Go the motive is only the 139 ms compile (measured). |
| H4 | `BlokServerServiceCollectionExtensions.cs:85` | `AddBlokServer` registers documents with `warmUp:false`. | `BlokServerRegistrationTests` (C#) | host wiring |

### 1d. Bundle and op list (`scripts/build-server-runtime.mjs`, `src/view/server-runtime.ts`)

| # | Location | What it does | Existing coverage (none runs Go) | Go file |
|---|---|---|---|---|
| B1 | `build-server-runtime.mjs:8,16-62` | Writes `packages/server/dotnet/Blok.Server/Generated/blok-server-runtime.js` through a staging dir and an atomic rename. | `test/unit/scripts/build-server-runtime.test.ts` (15) | add a second out dir, or a copy step, to `internal/jsruntime/generated/` |
| B2 | `build-server-runtime.mjs:27-52` | IIFE, `es2020`, esbuild minify, `worker` condition, `VERSION` define from package.json (otherwise `dev`). | same | same bundle. goja parsed the es2020 output unchanged (measured). |
| B3 | `Blok.Server.csproj:50-62` | An MSBuild target rebuilds the bundle when `src/**/*.ts`, `types`, the script, package.json or yarn.lock change. | `server-release-wiring.test.ts:180-184` | **No Go equivalent.** `go build` runs no hooks, so add a `go generate` directive, a CI step and a freshness test (T8). |
| B4 | `server-runtime.ts:879` | Sets the single global `blokServerInvoke(op, inputJson) → Promise<string>`. | `index.test.ts` "runs through one global boundary" (node) | `jsruntime` calls the global |
| B5 | `server-runtime.ts:724` | `markdownToBlocks` `{markdown}` → `{blocks…, warnings}` (async). | node: `index.test.ts`; Go: NONE → F-OPS | via `jsruntime` |
| B6 | `:731` | `htmlToBlocks` `{html}` → same envelope. | same | |
| B7 | `:733` | `blocksToHtml`: bare doc or `{document, title:bool}` → HTML string. | same | |
| B8 | `:743` | `blocksToMarkdown`: adds `skippedBlockWarning` when malformed blocks were skipped. | same | |
| B9 | `:753` | `blocksToHtmlWithPages` `{document, pages, title?}`. | `test/unit/view/server-runtime-pages.test.ts` (6) | |
| B10 | `:758` | `blocksToMarkdownWithPages`. | same | |
| B11 | `:768` | `blocksToPlainText`: bare or `{document, includeHiddenText, title}`. | `index.test.ts` | |
| B12 | `:778` | `blocksToPlainTextWithReport` → `{text, warnings}`. | same | |
| B13 | `:793` | `inspect` → `{blockCount, malformedBlockCount, isEmpty, unrecognizedBlockTypes}`. | same | |
| B14 | `:809` | `version` → `getBlokVersion()` (measured `1.16.1`). | same | |
| B15 | `:816` | `schema` → JSON Schema string. | same | |
| B16 | `:818` | `manifest` (agent). 552,768 chars; Jint 807 ms, goja 293 ms. | `server-runtime-manifest.test.ts` | agent ledger |
| B17 | `:848` | `extractTexts` `{document, includeCode, title}` → `string[]`. | `index.test.ts` | |
| B18 | `:853` | `injectTexts` → `{document}` or `{mismatch:{expected,received}}` (a RangeError becomes data). | same | |
| B19 | `:855` | `pageIndex` `{document}`: the RAW document, so malformed blocks keep `order`. | same | |
| B20 | `:857` | `remapPageDocument` → `{document}` or `{unmapped:{missingBlockIds, duplicateBlockIds, idlessBlocks}}`. | same | |
| B21 | `:863` | `htmlFieldsToSegments` (collab): an array in, an array out, throws on any bad entry. | SHARED (indirect): `fixtures/agent-moves.json` + `agent-page-fields.json` are read by C# `Collab/AgentRoomOpsTests.cs:13,57` (seeded through `RichTextRuntime.cs:16-17` → `RuntimeRichTextHtmlReader` → this op) and by TS `server-conformance/agent-move-fixture.test.ts`, `agent-page-fields-fixture.test.ts`; plus `JintBlokRuntimeTests.ConvertsHtmlFieldsToSegmentsInOrder` (C#) | collab ledger |
| B22 | `:868-873` | `agentExecute`, `agentPlanHost`, `agentPagesNeeded`. | SHARED (indirect, agentExecute only): same `agent-moves.json` / `agent-page-fields.json` fixtures as B21; `server-runtime-agent.test.ts`, `…host-plan.test.ts` (node) | agent ledger. Needs `Intl` (finding 7). |
| B23 | `:874-875` | An unknown op throws `TypeError` → `InvalidDocument` in C#. | none (measured: same `TypeError` in all 3 engines) | — |
| B24 | `server-runtime.ts:51-89` | `readBlock`: a malformed block (not an object, empty/non-string type, non-object data, non-string id or parent) is skipped. `parentId` is accepted as an alias. | `index.test.ts` | — |

**Count: 93 rows** (R 27, D 38, H 4, B 24).

**Oracle NONE for Go parity: 91 of 93.**
- The two exceptions are B21 and B22. Shared fixtures (`agent-moves.json`, `agent-page-fields.json`) already reach those ops through the C# runtime, and a TS conformance test reads the same files. A Go test reading the same fixtures would exercise them too.
- In every other row, the existing coverage is a C# xunit test or a node/vitest test of `invoke`. Neither runs Go or reads a shared golden file.
- I checked `rich-text-fields.json` and `rich-text-canonical`. Their C# readers (`RichTextFieldsTests.cs`, `RichTextCanonicalTests.cs`) test C# ports, not the runtime, so they do not count here.
- 17 rows have no test in ANY language: R1, R3, R4, R7, R9, R15, R16, R20, R22, R24, R26, R27, D1, D6, D25, D38, B23.

## 2. C# unit tests needing Go equivalents

| File | [Fact]/[Theory] | [InlineData] |
|---|---|---|
| `Blok.Server.Tests/Documents/BlokDocumentConverterTests.cs` | 27 | 2 |
| `…/Documents/BlokDocumentConverterTitleTests.cs` | 5 | 0 |
| `…/Documents/BlokDocumentInspectionTests.cs` | 11 | 24 |
| `…/Documents/BlokPageExportTests.cs` | 9 | 0 |
| `…/Documents/BlokPageFunctionsTests.cs` | 10 | 6 |
| `…/Documents/BlokPlainTextReportTests.cs` | 6 | 0 |
| `…/Documents/BlokRuntimeStartupTests.cs` | 6 | 0 |
| `…/Documents/BlokTabsDocumentTests.cs` | 9 | 0 |
| `…/Documents/TableDocumentDataLossAuditTests.cs` | 12 | 12 |
| `…/Runtime/JintBlokRuntimeTests.cs` | 20 | 12 |
| `Blok.Server.AspNetCore.Tests/BlokDocumentsRegistrationTests.cs` | 12 | — |
| **Total** | **127** | |

(Counts come from `grep -cE '\[(Fact|Theory)'` and `grep -cE '\[InlineData'`.)

No C# test in this area reads a shared fixture. `grep -rn -E "server-conformance|fixtures|ReadAllText|golden" Documents Runtime` found nothing. Every document is a C# string literal. About 70% of the asserts are op semantics (the bundle's job), so they belong in the shared corpus F-OPS. The rest test host logic (envelopes, errors, caching, pool) and need F-HOST and F-RT.

## 3. Proposed shared oracles

- **F-OPS: runtime op golden corpus.** `test/unit/server-conformance/fixtures/documents/ops.json`, with entries `[{name, op, input, expected | expectedErrorName}]`.
  - Generate it from node:vm on the freshly built bundle, with ids normalized by `/"(md|html)-[a-z0-9]+-/`.
  - Seed it with every string literal in the C# Documents tests above plus the 46 probe cases (`make-cases.mjs`). The probe already shows node = goja = Jint on all 46.
  - Run it from: a vitest freshness test (regenerate and compare), a C# xunit `[Theory]` over the file through `JintBlokRuntime`, and a Go `TestOps` through `jsruntime`.
  - Compare bare-string ops exactly. Compare JSON ops after parsing (T4).
  - Keep the large cases (600 KB, 700 KB, 3 MiB URL, 120-deep outline) as generators, not stored output, and assert only `contains`, as the C# tests do.
- **F-HOST: host envelope corpus.** `fixtures/documents/host.json`, each entry `{method, args, runtimeAnswer, expectRequest:{op, input}, expectResult | expectError:{kind, reason, message, param}}`. Both languages run it against a fake runtime (the C# tests already use `FixedRuntime`, `RecordingRuntime` and `CountingRuntime`). It covers D8, D12, D14, D16-D19, D27 and D29, including the exact `ArgumentException` messages and "validate answers without an engine".
- **F-RT: runtime-constraint scripts.** `fixtures/documents/runtime-scripts.json`, with tiny bundles (spin, spin-600ms, recursion, rejection, throw-Error, throw-TypeError, pending-forever, greedy-push) and the expected failure reason and reuse behaviour. Use a greedy `push` loop, NOT `grown += grown`: goja's lazy strings never allocate for it (finding 4).
- **Law: no sticky regex in the built bundle.** Extend `no-sticky-regex-law.test.ts`, or add a bundle-level test that tokenizes the built bundle (acorn is in node_modules; the probe code is in finding 6) and fails on any `y` flag or `new RegExp(…,'…y…')`.
- **Law: Go bundle freshness.** The Go embedded copy must have the same sha256 as `Generated/blok-server-runtime.js` and as a fresh build.

## 4. Traps (each with evidence)

| # | Trap | Evidence |
|---|---|---|
| T1 | goja cannot interrupt a long native builtin, so the timeout overshoots by seconds on backtracking regexes. The whole bundle holds 361 regex literals, and I did not split out which ones the import/HTML paths run. | finding 3: 7,301 ms and 15,221 ms against a 200 ms deadline |
| T2 | No per-call allocation budget. A process-wide watchdog is approximate, blames whichever concurrent call crosses the line, and misses lazy-string growth. `DocumentTooLarge` becomes best-effort. | finding 4 |
| T3 | Stack overflow is a Go error in goja but a catchable JS `RangeError` in Jint. Bundle code that catches errors around recursion would act differently. Both map to `Unknown` and reuse. Without a limit, deep recursion costs about 0.5 KB per frame on the heap (462 MiB at 1e6). | finding 5 |
| T4 | JSON re-serialization on the host. C# keeps key order and number text and escapes non-ASCII as `\uXXXX`. Go `map[string]any` sorts keys, rounds big ints, and changes lone surrogates to U+FFFD. Affected: injectTexts, remap, import (warnings removal), and every envelope build (D19). Use `json.RawMessage` or `jsontext`, keep order when removing `warnings`, and compare JSON semantically in oracles. | finding 8; `cs/Program.cs` and `cmd/jsonprobe` output |
| T5 | A lone surrogate in a document makes C# envelope ops throw a raw `InvalidOperationException`, not `BlokDocumentConversionException`. Bare ops pass the string straight to JS. goja `.String()` changes lone surrogates to U+FFFD on bare-string results (HTML, plain text). Decide the contract: replace on both sides, or report `InvalidDocument` on both. | finding 8 |
| T6 | `Intl` is missing in goja, and the bundle calls `Intl.DateTimeFormat(..).formatToParts` without a guard (date formulas). Documents ops are unaffected; agent ops are affected. | finding 7 |
| T7 | A promise left pending can never settle in goja (no event loop). Jint `InvokeAsync` waits until cancellation. The Go port must fail it at once, so the C# test `ReplacesAnEngineAfterCancellation` needs a Go rewrite. | `limits pending`: `state=0` |
| T8 | A stale bundle. MSBuild rebuilds it incrementally (`csproj:56-62`); `go build` never does. The generated file is untracked, and the dir listing shows only a local build. | `ls Generated/`; csproj |
| T9 | Error messages differ per engine (`Unexpected token ILLEGAL…`, `invalid character 'o'…`). Classify only on `error.name` and never surface or compare the message. | finding 1 |
| T10 | Import ids depend on the clock. The goldens must normalize them, or the Go and C# hosts would need an injected clock (none exists today). | diff before normalization: only `fromMarkdown`, `fromHtml` and `big.fromMarkdown` differed, on `md-mvve8e62-0` vs `md-mvve8zfv-0` |
| T11 | Lengths: Go `len` is UTF-8 bytes and the C#/JS `Length` is UTF-16 units (`big.plain.text` 1,191,598 B vs 651,598 units). Any limit or report stated in characters must convert. | runner outputs |
| T12 | Sticky regex: goja is quadratic on failed sticky probes (worse with `u`). Today's bundle has none, but nothing guards the bundle as a whole. | finding 6 |
| T13 | The `version` cache must not cache `dev`/`""` and must retry. A Go `sync.Once` would cache the failure. | `BlokDocumentConverter.cs:26-38` |
| T14 | `ValidateAsync` must not use an engine for non-documents, and it never throws except on cancellation. A Go port that wraps errors could turn `ctx.Err()` into a `Failure`. | `BlokDocumentConverter.cs:454-480` |
| T15 | goja vs node is 20–150x slower on large documents (`big.marked.pageIndex` 6,784 vs 45 ms; `big.marked.html` 5,678 vs 57 ms). The comparison that matters is goja vs Jint. goja is faster on most cases (`big.marked.md` 856 vs 1,860 ms). It is 1.2–5x slower on some: `bigurl.md` 1,249 vs 236 ms, `big.fromMarkdown` 3,880 vs 2,090 ms, `big.plain.html` 366 vs 216 ms, `big.marked.html` 5,678 vs 4,820 ms. `big.marked.pageIndex` takes 6.8 s in goja and 7.2 s in Jint, against the 10 s default. pageIndex on long articles can time out, as the doc comment warns (`IBlokDocumentConverter.cs:233-238`). | timing table below |

## 5. Timings (ms, one sequential run per engine, same process, shared dev machine; first-call warm-up included; single sample, not a benchmark)

| case | node:vm | goja | Jint 4.17 |
|---|---|---|---|
| load (first engine) | 40.9 | 138.9 compile + 11.0 run | 2,335.5 |
| next engine | — | 7.6 | 536.8 |
| version | 0.11 | 0.01 | 7.52 |
| schema | 0.26 | 1.41 | 55.72 |
| md.article | 2.06 | 0.70 | 85.61 |
| html.article | 6.56 | 2.48 | 34.85 |
| fromMarkdown | 13.9 | 14.32 | 184.5 |
| fromHtml | 5.96 | 3.63 | 48.82 |
| extractTexts | 1.02 | 0.56 | 4.16 |
| pageIndex | 2.66 | 9.75 | 70.56 |
| manifest | 67.19 | 293.44 | 807.08 |
| big.plain.text (600 KB) | 16.06 | 317.07 | 765.45 |
| big.plain.html | 17.29 | 365.98 | 215.77 |
| big.marked.text (700 KB) | 80.83 | 1,132.84 | 1,404.13 |
| big.marked.md | 32.41 | 855.92 | 1,859.55 |
| big.marked.html | 56.73 | 5,678.43 | 4,820.35 |
| big.marked.pageIndex | 45.18 | 6,784.03 | 7,229.82 |
| nested.md (120 deep) | 2.2 | 16.63 | 14.07 |
| bigurl.md (3 MiB URL) | 26.15 | 1,248.67 | 236.36 |
| big.fromMarkdown (~120 KB md) | 141.85 | 3,879.67 | 2,089.67 |

All 46 rows are in `out-node.json`, `out-goja.json` and `out-jint.json` in the probe dir.

## 6. Probe files (scratchpad)

- `make-cases.mjs`: builds the 46 cases from the C# test documents.
- `run-node.mjs`: the node:vm runner.
- `cmd/run/main.go`: the goja runner (goja `v0.0.0-20261030192516-032d024709ca`, regexp2/v2 v2.11.0).
- `jint/Program.cs`: the Jint runner, with JintBlokRuntime's settings.
- `diff.mjs`: compares outputs.
- `cmd/limits/main.go`: probes interrupt, stack, native-deep, alloc, alloc-watchdog, sticky, surrogate and pending.
- `cmd/jsonprobe`, `cs/`: JSON round-trip and Jint `Intl`/sticky/stack probes.
- `cmd/pool`: concurrent pool (race detector) and the nested outline under the stack limit.
