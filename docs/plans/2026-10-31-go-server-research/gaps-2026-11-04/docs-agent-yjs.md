# Go vs C# gaps: documents, JS runtime, agent, Yjs

Date: 2026-11-04. Read-only. No repo file edited.

Scope: C# `Blok.Server/{Documents,Runtime,Agent,Yjs}` against Go `blokdocs`, `blokagent`, `internal/{jsruntime,yjs,lib0,jsjson}`, plus the host wiring that hands these to a host (`Blok.Server.AspNetCore/BlokDocumentsServiceCollectionExtensions.cs` and `go/blokserver/collab.go`).

How I checked:
- Read both sides' code.
- Grepped both test trees for every shared fixture.
- Ran Go tests: `go test -run 'Host|Looks|LoneSurrogate' ./blokdocs` and `-run 'HostFixture|SharedFixture|TheCSharpHost' ./blokagent`. Both passed.
- Ran live probes in the scratchpad. Neither probe touches the repo.
  - Go: a scratch module that uses `blokdocs.New` through a `replace` directive (`scratchpad/goprobe`), and raw goja (`scratchpad/gojalc`).
  - C#: `dotnet fsi` on Jint 4.17.0 (the csproj version) with the same bundle. `cmp` shows that `dotnet/Blok.Server/Generated/blok-server-runtime.js` and `go/internal/jsruntime/blok-server-runtime.js` are identical (`scratchpad/jintprobe`).
  - The built `Blok.Server.dll` in `bin/` is from Oct 13, so it is stale. I did not use it. The C# probes run the engine and bundle directly, with the same `Engine` options as `JintBlokRuntime.CreateEngine` (`JintBlokRuntime.cs:320-327`). They skip the `BlokDocumentConverter` wrapper. Where a claim depends on that wrapper, I say so.

---

## CONFIRMED GAPS

### G1. A JSON key repeated in a document or batch: C# reads the first value, Go reads the last

- **What C# does.** Jint, once the bundle is loaded, keeps the FIRST value of a repeated key. It also builds an object that holds the key twice. Measured (`scratchpad/jintprobe/probe2.fsx`):
  - `JSON.stringify(JSON.parse('{"a":1,"a":2}'))` gives `{"a":2}` before the bundle loads.
  - The same call gives `{"a":1,"a":1}` after the bundle loads.
  - `blocksToHtml` on `{"blocks":[{"id":"p","type":"paragraph","type":"header","data":{"text":"a","text":"b","level":2}}]}` gives `<p>a</p>`.
  - The envelope op `blocksToPlainText` on that document gives `a`.
  - `{"blocks":1,"blocks":[...]}` fails with `TypeError: Document input requires a blocks array`, which is InvalidDocument.
- **What Go does.** goja keeps the LAST value. Measured (`scratchpad/goprobe`):
  - `ToHTML` gives `<h2>b</h2>`, `ToMarkdown` gives `## b`, and `ToPlainText` gives `b`.
  - `{"blocks":1,"blocks":[…]}` gives `<p>x</p>`, which is a success where C# fails.
- **Where it shows.** The text reaches the engine unchanged on both sides:
  - Bare ops: C# `BlokDocumentConverter.cs:42-53` (`ToMarkdownAsync`) and `:357-362` (`ToHtmlAsync`). Go `blokdocs/converter.go:102-104` and `:135-137`.
  - Envelope ops: C# `ParseDocument` (`BlokDocumentConverter.cs:328-338`) keeps the repeats, and the shared `documents/host.json` case "envelope keeps repeated keys and number text" pins that.
  - Agent batches: `agent/host.json` "execute: a repeated key in the batch passes through without page options".
  - So the same document, or the same agent batch (for example `{"name":"block.delete","name":"block.insert"}`), renders or executes differently on the two servers.
- **Partly covered.** `LooksLikeADocument` and `Validate` refuse repeated keys on both sides (`looks-like-a-document.json` cases 20-23, commit 9d4b7385). Only that path is safe. No fixture runs a repeated key through a real engine: `ops.json` has none, and `host.json` uses a scripted runtime.
- **Severity: medium.** It needs malformed input. But it is silent, and it reaches agent batches as well as conversions. The C# side is arguably the buggy one (a Jint bug that writes `{"a":1,"a":1}`). The fix is a decision:
  - (a) refuse repeated keys host-side on both servers before the engine, or
  - (b) make the C# side match JSON.parse (last wins).
- **Suggested oracle.** Add `ops.json` cases with repeated keys: root `blocks`, nested `type`, and data `text`, across `blocksToHtml`, `blocksToMarkdown`, `blocksToPlainText` and `agentExecute`. Both real engines run them (`DocumentOpsFixtureTests` and `ops_fixture_test.go`). Until a decision is made, the expected output is unclear.

### G2. A lone surrogate in a document on the bare ops: the result differs, and C# throws a raw exception

- **What C# does.** Measured on Jint with the bundle, then System.Text.Json into the real `Blok.Server.Documents` records (`scratchpad/jintprobe/stj.fsx`). The `bin/` dll is from Oct 13, but `git log` shows neither record file changed since.
  - `blocksToMarkdown` on `{"blocks":[{"id":"p","type":"paragraph","data":{"text":"a\ud800b"}}]}` answers `{"markdown":"a\ud800b","warnings":[]}`.
  - `JsonSerializer.Deserialize<BlokMarkdownConversion>` on that answer, as at `BlokDocumentConverter.cs:51` (no catch), throws `System.Text.Json.JsonException: The JSON value could not be converted to Blok.Server.Documents.BlokMarkdownConversion. Path: $.markdown`. So `ToMarkdownAsync` escapes with a raw `JsonException`, not `BlokDocumentConversionException`.
  - `ToHtml` returns the lone unit as is (measured: `<p>a` + U+D800 + `b</p>`).
  - `inspect` on `{"blocks":[{"type":"\udc00","data":{}}]}` answers `"unrecognizedBlockTypes":["\udc00"]`. Deserializing that into `BlokDocumentValidation` throws `JsonException … Path: $.unrecognizedBlockTypes[0]`, which `ValidateAsync` catches and turns into `Failure = Unknown` (`BlokDocumentConverter.cs:494-497`).
  - `ValidateAsync` reaches the runtime here because `LooksLikeADocument` accepts a lone surrogate in a VALUE. `looks-like-a-document.json` "lone surrogate value" is `expected: true`.
- **What Go does.**
  - `ToMarkdown` gives `"a�b"` with no error, and `ToHTML` gives `<p>a�b</p>`. Both are measured, and pinned in Go only by `blokdocs/converter_test.go:157-177` (`TestReadsALoneSurrogateInABareDocumentAsAReplacementCharacter`).
  - `Validate` gives `UnrecognizedBlockTypes=["�"]`.
- **Status.** The ledger records it as "needs a user decision". It is not in the accepted list (U1-U11). The envelope ops are already at parity (InvalidDocument on both, 9d4b7385).
- **Severity: low-medium.** The C# raw `JsonException` breaks the converter's contract that a conversion failure surfaces as `BlokDocumentConversionException`.
- **Suggested oracle.** Add bare-op lone-surrogate cases to `documents/host.json` with the real answer text, so that the C# answer read and the Go answer read are compared byte for byte.

### G3. The Go server shares no document converter and offers no settings for its engine pool

- **What C# does.**
  - `AddBlokServer` calls `AddBlokDocuments(warmUp: false)` (`BlokServerServiceCollectionExtensions.cs:85`).
  - That registers ONE `IBlokRuntime`, which the converter, the agent executor and the collab HTML reader all share (`BlokDocumentsServiceCollectionExtensions.cs:74-86`, `BlokServerServiceCollectionExtensions.cs:164`).
  - So a host that embeds the server gets `IBlokDocumentConverter` from DI, on that shared pool.
  - A host that calls `AddBlokDocuments(poolSize, timeout, warmUp: true, allocationBudgetBytes)` first sets the size, timeout and budget of the pool the rooms and the agent use, because `TryAddSingleton` means the first registration wins. Calling it at all also turns the warm-up on (`AddHostedService<BlokDocumentWarmUp>`, `:88-91`).
  - Pinned by `Blok.Server.AspNetCore.Tests/BlokDocumentsRegistrationTests.cs:32-49` (`RegistersOneConverterAcrossRepeatedAndMixedRegistration`) and `:168`.
- **What Go does.**
  - `blokserver.Server` exposes `AgentExecutor()` (`blokserver/collab.go:249-262`) but no converter accessor. I searched `blokserver/*.go` for `blokdocs`: no hit.
  - The shared pool is always built with defaults: `newCollabRuntime = … jsruntime.NewPool(jsruntime.Options{})` (`collab.go:160`). `blokserver/options.go` has no pool, timeout, memory or warm-up option (searched for `pool|runtime|engine|memory`: no hit).
  - A Go host has to call `blokdocs.New` itself, which builds a second engine pool. It cannot resize, re-time or warm the pool the rooms and agent use.
  - The prior ledger left this as H2/H4 "DEFERRED to http-host". Only the warm-up-off half (L2) landed.
- **Consumer fixtures show the same split.**
  - `test/fixtures/go-server-consumer/main.go` `convertOnce` builds its own `blokdocs.New(...)` pool next to `blokserver.New`.
  - `test/fixtures/dotnet-server-consumer/Program.cs` calls only `AddBlokServer`, which per the code above already registers a converter on the shared runtime.
- **Severity: low-medium.** No wire behaviour changes. The gaps are memory (two pools), the missing knobs, and a missing API.
- **Cross-lane.** This is the prior ledger's H2/H4, which was handed to the http-host lane. If the http-host report also lists it, count it once.
- **Suggested oracle.** Add a Go `blokserver` test: `Server.DocumentConverter()` returns a converter on the same pool as `AgentExecutor()` (count builds with the `newCollabRuntime` hook). Add an `Options` field (for example `Documents blokdocs.Options`) with a test that its `PoolSize`/`Timeout` reach the shared pool. Mirror the C# registration tests.

### G4. Two error texts in the room history are not pinned (unverified)

- **Where.** Go `blokagent/roomhistory.go:397` (`netString`: "The node must be of type 'JsonValue' holding a String, not %T.", which prints a Go type name) and `:460` (`locked`: "…holding a Boolean.").
- **What C# does.** C# reads the same nodes with `GetValue<string>()` and `GetValue<bool>()` (`RoomAgentHistory.cs:262-264`). The .NET text for that case was never captured.
- **What matches.** The error kind matches: `InvalidOperationError` and `InvalidOperationException`. A peer can reach this through room projections, for example `databaseLocked: "yes"` before an undo.
- **Severity: low.** It is only a message text, on a path that ends in a 500. The prior ledger lists it as open (`progress-agent-room.md:152`).
- **Suggested oracle.** Add a room scenario in `test/fixtures/agent-server-scenarios` with a non-boolean `databaseLocked` (and a non-string `type`), captured from C#.

### G5. Proof gap: `bundle-smoke.json` is read by Go only

`test/unit/server-conformance/fixtures/documents/bundle-smoke.json` holds node:vm outputs on the bundle. Only `go/internal/jsruntime/runtime_test.go:48` reads it, and no `.cs` file names it. It is low risk, because C# runs the broader `ops.json` through Jint. Still, the astral-character and escaping cases in it are not checked against Jint. Oracle: a C# `[Fact]` reading the same file through `JintBlokRuntime`.

I also checked the other agent-area fixtures for one-sided readers. Both sides read them:
- `test/fixtures/version-history/kind-cases.json` (`CollabVersionChangesTests.cs` and `room/changes_test.go`).
- `lis-cases.json` (`CollabLongestKeptOrderTests.cs` and `convert/longestkept_test.go`).

---

## DOCUMENTED / ACCEPTED DIFFERENCES

- **U2 memory budget.** C# default is 512 MiB of allocation churn (`JintBlokRuntime.cs:30`). Go default is 1 GiB of live heap from an approximate watchdog (`jsruntime/pool.go:22`). The startup-error text names a different knob (`MemoryBudget`, "1 GiB") (`pool.go:188-193` vs `JintBlokRuntime.cs:100-106`).
- **U3 timeout.** It is not a hard bound in goja against a regex that is already running.
- **U4 stack overflow.** In Go it is not a catchable JS RangeError. The reason (Unknown) matches.
- **U5 pending promise.** Go fails at once, while C# waits.
- **Go zero-value idiom.** `PoolSize`, `Timeout` and `MemoryBudget` of 0 mean "default" in Go (`pool.go:93-135`). In C#, an explicit `poolSize`/`timeout` below the floor throws. Go refuses only negative or below-floor non-zero values. Duration text differs ("10s" vs "00:00:10"). This only affects the in-process API.
- **Null arguments.** C#'s `ArgumentNullException` for `documentJson`/`actor` has no Go counterpart, because Go strings and value-type `Actor` cannot be nil. Map and slice nils are mirrored (`NullArgumentError`).
- **Interface default members.** `IBlokAgentExecutor.OpenSession`/`GetRoomContractAsync` and the `IBlokDocumentConverter` `*WithTitle` defaults exist for host-written implementations. Go has concrete types (N/A). Nothing in the C# server resolves a host-substituted executor, so this is not observable.
- **Any write-side stack guard (yjs L18).** C# probes the stack (`Yjs/AnyCodec.cs:69-73`) and reads up to 4096 levels deep. Go has only the 4096 depth cap on read (`lib0/any.go:14-16`). This is intentional (P6).
- **parentSub bit with pending structs.** Both engines differ from yjs in the same way (`progress-yjs-lib0.md:107-129`). It is not a C#/Go gap.
- **Intl (U11).** goja has no `Intl`. The bundle falls back to `Date` getters for UTC and the host zone (`src/shared/database/formula/dates.ts:47-68`).
  - On the agent computed read, the outputs match Jint in 7 zones (`agent/formula-dates.json`, read by `AgentFormulaDatesFixtureTests.cs` and `formula_dates_test.go`).
  - A named zone other than UTC would give an empty value on Go. I found no server path that passes one: in the bundle, the only `Intl.` use is `Intl.DateTimeFormat`, and the computed reader passes no `timeZone` (fixture `why` field).

---

## VERIFIED AT PARITY (short)

**Documents API.** Every `IBlokDocumentConverter` method has a Go method with the same request and answer shape:
- ToMarkdown, ToHtml and ToPlainText, each in bare, Pages, Title and Report forms.
- ExtractTexts and InjectTexts with `includeCode`, PageIndex, RemapPageDocument, Validate, FromMarkdown, FromHtml, Version and Schema.

`BlokPageInfo`/`BlokPageIcon`, `BlokConversionFailure` reasons and messages, and `LooksLikeADocument` are also at parity.

Oracles: `documents/host.json` (C# `HostEnvelopeFixtureTests`, Go `blokdocs/host_fixture_test.go`, which passed), `looks-like-a-document.json` (both), and `ops.json` (both real engines).

**Runtime.**
- Pool default `max(1,min(cpus,4))`, 10 s default timeout, 100 ms and 8 MiB floors, and a per-call timeout override.
- Error classification: TypeError/SyntaxError map to InvalidDocument, others to Unknown, and an unreadable `name` maps to Unknown with the engine kept (1a2706e2). Only a string result counts as success.
- Oracle: `runtime-scripts.json` (both).

**Agent executor and session.**
- Execute, Contract, RoomContract, OpenSession and ExecuteInRoom.
- Session caps of 100 steps and 4 MiB of escaped UTF-16 (`BlokAgentSession.cs` vs `session.go`).
- Sub-page creation: `IBlokPageCreator` maps to `PageCreator`, an empty id gives FORBIDDEN or stranded, and a cancel or error after a create gives a cleanup answer (`BlokAgentExecutor.cs:135-176` vs `pagecreate.go:13-120`).
- `BuiltInComments` defaults to on, with `DisableBuiltInComments` as the opt-out (same wire).
- Room history and undo/redo with lineage set before the step is shared (40300fa5 is in Go: `room.Applied` receives the receipt, `TestAStepCarriesItsLineageWhenItIsAdded`).
- History is forgotten on DocumentReplaced.
- Version list, read and restore, with `group: 15.0` refused.
- The locked-database refusal and sharing that needs approval.
- Linked-view row and template commands, creation stamps, computed reads, formula caps and wire bytes (473bed39 plus later captures).

Oracles, all read by both sides:
- `agent/host.json` (124 cases; the Go run passed).
- `test/fixtures/agent-server-scenarios` (110 files, `AgentServerScenarioTests.cs` and `scenario_test.go`, no skips).
- `test/fixtures/agent-commands` cases, evals, goldens and normalizer (`AgentParityCorpus.cs` and `parity_test.go`, with the same `services` and `parityExcluded` filters).
- The room corpus (`RoomAgentParityTests` and `TestMatchesTheAgentCommandCorpusInARoom`).
- `agent-moves.json`, `agent-page-fields.json` and `agent/formula-dates.json`.
- CI runs `--target go` conformance unfiltered (`ci.yml:547`), which includes `mcp-agent-participant`.

**Yjs, lib0 and jsjson.** Recent C# commits are mirrored in Go:
- 0c823384: length-0 structs. `empty-structs.json` is read by `HostileUpdateTests.cs` and `pending_test.go`.
- 5fe7fe3a: stable parked sort, with twin tests.
- d30e8163: wire JSON read as JSON.parse, and only the lone-surrogate string dropped (Go `collab/convert/export.go:106,666-668`).

Shared yjs-engine fixtures, all read by both sides: `varint`, `any`, `structs`, `negative`, `yrs-compat`, `scenarios`, `csharp-capture`, `manifest` and `fuzz/seed-*`. jsjson `js.json` and `dotnet.json` are read by both, including a BOM parse case. That closes the ledger's "BOM unverified" note for JsJson.

**Engine semantics, sampled.** These matched on every case I tried; it is a sample, not a proof.
- `localeCompare` (14 pairs plus one sort), Jint and goja on macOS. The Docker runtime-deps ICU was not checked.
- `Date.parse` (15 human date formats, TZ=UTC), as used by `property-conversion.ts:152` and `database-query.ts:154`.
- 20 regex cases: lookbehind, `\p{L}`, named groups, `u` and `i` case folding, and `^$/m`.
- A BOM-prefixed bare document is refused by both.
