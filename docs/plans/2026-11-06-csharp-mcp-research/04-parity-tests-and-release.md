# 04 — Proving parity for a C# MCP, and releasing it

Research only. Every claim cites a file read or a command run on 2026-11-06 (HEAD `07b2326d`).
Anything not checked is marked **unverified** or **estimate**.

---

## 1. How the server conformance harness works

### The runner script

`scripts/test-server-conformance.mjs` (343 lines).

- Targets: `csharp`, `go`, `interop`, `rust`, `interop-rust` (`:40-41`). Suites are a fixed list (`:45-58`). One suite lives outside the folder and is mapped by hand (`:61-63`).
- Arguments: `--target`, `--suite` (repeatable), `--test-name-pattern`, `--configuration Debug|Release` (C# only) (`:65-91`).
- It builds two binaries per target into a temp folder:
  - **C#**: `dotnet build Blok.Server.Host.csproj` twice. One is an ordinary Release build. The other uses `-p:BlokServerConformance=true` (`:137-175`). That property defines `BLOK_SERVER_CONFORMANCE` (`packages/server/dotnet/Directory.Build.props:20-22`), which turns on test-only flags such as `--conformance-journal` (`Blok.Server.Host/ConformanceArguments.cs:42-50`).
  - **Go**: `go build ./cmd/blok-server`, once plain and once with `-tags conformance` (`:182-200`).
  - **Rust**: `cargo build --release`, once plain and once with `--features conformance`, each binary copied out (`:210-227`).
- Then it runs vitest (`--project=unit`) on the suite files (`:299-304`). The binary paths go in env vars (`:317-326`):
  - `BLOK_CONFORMANCE_ORDINARY_SERVER`, `BLOK_CONFORMANCE_SERVER`, `BLOK_CONFORMANCE_TARGET`;
  - for interop: `BLOK_CONFORMANCE_CSHARP_SERVER`, `BLOK_CONFORMANCE_GO_SERVER`, `BLOK_CONFORMANCE_RUST_SERVER` (`:262-263`, `:277-278`).
- `--test-name-pattern` adds a JSON reporter. `requireExecutedTests` then fails when the pattern ran zero tests, because vitest exits 0 in that case (`:111-135`, `:308-330`).

### How a suite spawns a server

- `test/unit/server-conformance/run-against.ts`
  - `startServer({ args, env })` reads `BLOK_CONFORMANCE_SERVER` (`:44-52`).
  - It allocates a loopback port and replaces the `--listen 127.0.0.1:0` placeholder. It **throws if `--listen` is missing** (`:79-99`).
  - It retries up to 3 times when the port is lost (`:12`, `:162-185`).
  - It returns `{ baseUrl, request, stop, kill }` (`:22-28`).
- `server-process.ts`
  - Readiness means polling `GET /health` for 200 (`:117-127`), plus the stderr marker `" listening on "` (`:11-15`).
  - Children are killed when the test ends (`adoptChild`, `:104-115`).
- `runServerCommand` runs a one-shot command (exit code and stderr), used by the CLI contract tests (`run-against.ts:101-132`).

### How a case is written

- A case is a plain vitest test in `test/unit/server-conformance/<suite>.test.ts`. It is skipped when `BLOK_CONFORMANCE_SERVER` is unset (e.g. `routing-contract.test.ts:15-19`, `mcp-agent-participant.test.ts:25`).
- Shared data lives as JSON in `test/unit/server-conformance/fixtures/` (64 entries). The same file is read by the TS suite and by the native unit tests. Example: `fixtures/routing.json` is read by `routing-contract.test.ts:41-45`, `packages/server/go/internal/route/route_test.go` and `packages/server/rust/crates/route/tests/route.rs` (found with `grep -rln routing.json`).

### How goldens are captured

There are three patterns.

1. **Generator plus freshness test.**
   - A `scripts/generate-*.mjs` writes the fixture from a reference implementation.
   - A `*.freshness.test.ts` regenerates it and fails on drift. It also names the case list, so a dropped case cannot pass quietly (`sync-frames.freshness.test.ts:13-28`, `:35-55`).
   - Generators that exist: `generate-sync-frames`, `generate-collab-fixtures`, `generate-yjs-engine-fixtures`, `generate-jsjson-fixtures`, `generate-agent-room-scenarios`, `generate-documents-ops-fixture` (`ls scripts`).
2. **Captured from C#.** `scripts/capture-dotnet-primitives.fsx` and `capture-jsjson-dotnet.fsx` exist. I did not read them; they are named here only.
3. **Agent corpus goldens.**
   - Written with `BLOK_UPDATE_GOLDENS=1` as `{ reviewed: false, document }`.
   - They must then be reviewed by hand, which sets `reviewed` to a name.
   - A reviewed golden is never regenerated (`test/unit/agent/parity/run-case.ts:73-102`).

### Driving two MCP implementations with the same pattern

Facts that shape the design:

- **`startServer` cannot drive blok-mcp unchanged.**
  - blok-mcp takes `--http <listen>`, not `--listen` (`src/mcp/config.ts:15-19`, `:182`, `:195-197`), and `replaceListenPlaceholder` throws without `--listen`.
  - blok-mcp serves no `/health`. Every path except `/mcp` (and the OAuth metadata) answers 404 (`src/mcp/http.ts:162-166`).
  - What does work: blok-mcp accepts port 0 (`http.ts:133`) and prints `blok-mcp: listening on <url>/mcp` to stderr (`src/mcp/index.ts:59`). That line contains the same `" listening on "` marker. A new spawner can read the URL from stderr instead of polling `/health`.
- **An MCP client is already a dev dependency.**
  - `@modelcontextprotocol/client` 2.4.0 is in the root `package.json:237`.
  - Checked by import in this session: it exports `Client`, `StreamableHTTPClientTransport` and `InMemoryTransport`, and `/stdio` exports `StdioClientTransport`.
  - The tests already drive the server with this `Client` (`test/unit/mcp/sdk-server.test.ts:3`, `unlock-elicitation.test.ts:3-5`).
- **Tool answers carry both forms.** `tools/call` results have `structuredContent` and the same JSON as text content (`src/mcp/sdk-server.ts:183-184`). A black-box runner can read `structuredContent`.
- **The existing MCP runners are in-process, not black-box.**
  - `mcp-harness.ts` calls `assembleMcp(...).dispatch(...)` directly (`:47-65`, `:75-80`, `:173-176`).
  - The `McpRun` interface (`:31-39`: `opened`, `execute`, `output`, `close`) is the seam where a process-backed opener can plug in.

**Proposed `scripts/test-mcp-conformance.mjs --target node|csharp`.** It copies the server runner's shape. This is a proposal, not built.

1. **Arguments**: `--target node|csharp`, `--transport stdio|http` (default: both), `--suite NAME`, `--test-name-pattern`. Copy `selectedOptions` and the usage error from `test-server-conformance.mjs:65-91`.
2. **Build step**:
   - `node`: `yarn build:mcp` (`package.json:159`). The command is `process.execPath packages/mcp/bin/blok-mcp.mjs`, which is how `test/unit/mcp/bin.test.ts:8`, `:41` spawns it.
   - `csharp`: `dotnet build <McpHost>.csproj` twice, ordinary and `-p:BlokServerConformance=true`, mirroring `buildCsharp` (`:137-175`).
   - For live-mode suites, also build the C# server host with the existing `buildCsharp`. That gives a real sync room to join.
3. **Env**: `BLOK_MCP_CONFORMANCE_COMMAND` (a JSON array: command plus leading args), `BLOK_MCP_CONFORMANCE_TARGET`, and `BLOK_CONFORMANCE_SERVER` (the sync host, reused as is).
4. **Run**: vitest over `test/unit/mcp-conformance/<suite>.test.ts`, skipped when the env var is unset. Reuse `requireExecutedTests` (`:111-135`) as it is.
5. **New helper `mcp-process.ts`**, next to `run-against.ts`. It returns one interface over two transports:
   - stdio: `Client` plus `StdioClientTransport` spawning the command;
   - http: spawn with `--http 127.0.0.1:0`, read the URL from stderr, then `Client` plus `StreamableHTTPClientTransport`.
   - Reuse `adoptChild` (`server-process.ts:104-115`) so no child outlives its test.
6. **Corpus suite**: add a third opener `openMcpProcess` that returns `McpRun`, and call the unchanged `checkMcpCase` (`mcp-harness.ts:227-255`). This reuses `projectAnswers`, `referenceAnswers` and `compareToGolden` in TS. `grep` found no C# or Go mirror of `projectAnswers`/`caseStrings`, so the answer check stays in one place.

**Problems the design must solve (checked):**

- **Attribution vs goldens.**
  - Goldens hold `lastEditedBy: "human-1"` and `lastEditedWith: "agent-test"` (example golden read above). These come from `TEST_ACTOR` (`test/unit/agent/harness.ts:19`), which is injected through `agentActor` (`mcp-harness.ts:79`, `:174`).
  - A spawned binary builds its actor as `agent:<principal>:<clientName>` (`src/mcp/actor.ts:9-14`).
  - `normalize.ts` replaces only `lastEditedAt` with a placeholder (`normalize.ts:259-260`). It does not relabel actors.
  - So the runner needs one of these:
    - (a) a conformance-only flag that sets the actor, behind the same build switch as `--conformance-journal`;
    - (b) a remap of `agent:human-1:<client>` to `agent-test` in `output()` and in the answers before comparing;
    - (c) a separate set of goldens.
  - With `--principal human-1` (a real flag, `config.ts:17`), `onBehalfOf` already matches. Only the agent id differs.
  - Whether answers carry actor ids is **unverified**. `answers.ts:51` masks id keys, and I did not trace actor fields.
- **Live mode needs a real socket.**
  - `openMcpLive` injects a fake `RoomSocket` through `assembleMcp`'s second argument, `liveSocketFactory` (`mcp-harness.ts:112-176`). A spawned binary cannot take that.
  - Options: run the built C# host as the room, as `mcp-agent-participant` does (`:148-180`). Or serve the `RoomSocket` logic from a loopback `ws` server.
  - Live mode needs no tickets config. Tickets are optional and come from `BLOK_SECRET` or `--ticket-url` (`config.ts:160-175`, `server.ts:111`). The C# host in ticket auth needs `BLOK_SECRET` set on both processes.
- **Stored output is readable black-box.** The files source writes `<dir>/doc.json` (`mcp-harness.ts:71-74`, `:85-93`).
- **Endpoint source fake.**
  - `doc-endpoint.ts` serves GET `{url}/{docId}` as bare OutputData or a `{data, version}` envelope and records PUTs (`doc-endpoint.ts:1-23`).
  - The MCP endpoint source reads both shapes (`src/mcp/sources/endpoint.ts:76-90`).
  - Whether its PUT and version headers satisfy every `sources-endpoint` case is **unverified**.

---

## 2. Inventory of MCP tests

Counts come from running the tests in this session: `vitest run --project=unit test/unit/mcp <both mcp runners>`. Result: **1047 passed, 0 failed**. That is 939 in `test/unit/mcp` and 54 in each runner. Each runner has 53 corpus cases plus a "has cases" check.

The corpus has 53 cases: 40 `cases/` plus 13 `evals/`, after one `parityExcluded` eval is dropped (counted with node over `test/fixtures/agent-commands`).

| Bucket | Files (expanded test count) | Why |
|---|---|---|
| **A. Protocol boundary, good black-box fixtures** | `http` 22, `sdk-server` 26, `unlock-elicitation` 42, `stored-e2e` 33, `server` 16, `server-live` 9, `page-titles` 12, `live-version-history` 20, `custom-inline-tools` 5, `creation-stamp` 2, `bin` 1 (the stdio `initialize` test), `run-cli-config` 1 — **189** | They assert on JSON-RPC answers, HTTP status and headers, elicitation, saved documents, or exit codes. `sdk-server` and `unlock-elicitation` already use a real SDK `Client` over a stdio transport. `stored-e2e` and `server` go through `dispatch`, but each assertion is a tool answer or a saved file. |
| **B. Observable, but needs a fake host or exact text** | `config` 156, `sources-files` 69, `sources-endpoint` 52, `oauth` 40, `index` 25, `custom-tools-file` 25, `handles` 14, `tickets` 14, `open-live` 13, `authorize` 8 — **416** | CLI parsing can be observed as exit code 2 plus a `blok-mcp: …` stderr line (`index.ts:138-140`), so stderr text becomes a contract. `oauth` needs a fake JWKS issuer. `tickets` needs a fake ticket host (one already exists in `mcp-agent-participant.test.ts:59-98`). `authorize`: only the webhook form can be shared. The module form is a JS `import()` (`src/mcp/auth/authorize.ts:16`, `:28`). |
| **C. TS internals, no shared fixture** | `dispatcher` 146 (uses fakes), `readme` 45, `errors` 27, `live-session` 22, `local-files` 14, `stored-session` 13, `uploads` 12, `package` 11, `contract` 10, `presence` 9, `actor` 8, `stdout-guard` 4, `node-socket` 4, `mode` 3, `public-types` 2, `bin` 2 (bundle checks), `bin-order` 1, `bundle-deps` 1 — **334** | Unit seams, npm packaging, README, and the Node stdout guard. `uploads` works only when embedded; there is no flag (`packages/mcp/README.md:175`). |

**Estimate** of a shared MCP fixture set (method: buckets above, `.each` rows counted as cases):

- Core: the corpus 53 × 2 modes = **106 runs**, plus bucket A ≈ **190**, so about **300**.
- With bucket B turned into data tables (like `options-validate.json`): up to about **700**.
- Per transport (stdio and http), the protocol cases would run twice.
- Most of `dispatcher.test.ts` (146) checks rules a model can see, such as caps, `UNKNOWN_HANDLE` and abort. Porting it would mean rewriting it as calls through the protocol. That is **not counted** above.

---

## 3. The "an MCP agent joins" case

`test/unit/server-conformance/mcp-agent-participant.test.ts` is suite `mcp-agent-participant`. It is in `SUITES` (`test-server-conformance.mjs:51`) and pinned by `server-release-wiring.test.ts:230-246`.

- **Which side runs MCP: the TS MCP, in-process.** It imports `assembleMcp` from `src/mcp/server` (`:16`) and calls `mcp.dispatch(...)` (`:189`, `:193`). The **binary under test is the backend** (C#, Go or Rust), started by `startServer` with `--auth ticket --collab --conformance-journal` (`:153-160`).
- The MCP gets a signing-secret ticket config, so it mints its own tickets (`:50-51`).
- Cases:
  - `:182` an MCP agent joins as its own participant and writes formatted rich text. A human provider sees the block with bold marks. Identities name `agent:alice:claude-code`. Awareness carries `agent: { via: 'mcp', onBehalfOf }` and `agentCursor`, with no caret. Saved attribution is `lastEditedBy: alice` and `lastEditedWith: <agent>`. `/sync/<doc>/history` names the agent. Close answers `{closed:true, unsavedBatches:0, hostRecordLags:true}` (`:182-240`).
  - `:242` a moved block keeps its identity while the human types inside it.
  - `:279` a read-only ticket makes the batch not saved with `READ_ONLY`.
  - `:294` a write the room refuses for a read-only ticket is reported as not saved, and it locks the handle.
  - `:318` open before sync never returns an empty view.
- So this suite proves **server** parity for an MCP client. It does not test an MCP implementation. With a C# MCP, the same scenarios could run with the MCP side swapped for a spawned process. The room side stays on `BLOK_CONFORMANCE_SERVER`.

---

## 4. The agent parity corpus

- **Location**: `test/fixtures/agent-commands/`. It holds `cases/` (40), `evals/` (14, one excluded), `goldens/` (54), `custom-tools/rating.json` and `normalizer-cases.json` (`ls`).
- **Format** (`test/unit/agent/parity/corpus.ts`):
  - `ParityCase { name, seed: OutputData, batches: [{commands:[{name,args,ref?}]}], expect?, expectByRunner?, services? }` (`:32-43`).
  - Runners are named `editor|json|store|jint|room|mcp-stored|mcp-live` (`:7`).
  - The MCP runners take only an exemption with a reason, either `{errorCode, reason}` or `{against:'json-without-services', reason}` (`:16-18`, `:103-110`).
  - Evals become `eval:<id>` cases (`:156-165`).
  - Goldens are `goldens/<name with unsafe chars → "__">.json` (`:182-183`).
  - Today one case has MCP exemptions: `05-bookmark-create.json`, which is `against: json-without-services` for both modes (counted with node).
- **How the TS MCP runners drive it.**
  - `mcp-stored-runner.test.ts:21-24` and `mcp-live-runner.test.ts:21-24` run `checkMcpCase` for each case.
  - Stored: it writes the seed to `<tmp>/doc.json` and assembles with `source: files` (`mcp-harness.ts:70-107`).
  - Live: it seeds an in-memory `DocumentStore` behind a fake socket that acknowledges every operation (`:109-195`).
  - Each batch is a `blok_execute` call. The runner checks the outcome against the expectation, the normalized saved document against the golden, and each answer against the json engine's answers (`:227-255`).
- **How the C# corpus runner reads it.**
  - `AgentParityCorpus.cs` walks up from the test assembly until it finds `test/fixtures/agent-commands/normalizer-cases.json` (`:152-169`).
  - It loads cases and evals the same way, but **skips any case with `services`** (`:104-150`; `:112-117`).
  - `ExpectedError(c, runner)` reads `expectByRunner[runner]` or else `expect` (`:44-49`).
  - Golden documents are read the same way (`:74-79`).
  - Two theories use it:
    - `JintAgentParityTests` runs Jint on stored documents, runner key `jint` (`:15-56`).
    - `RoomAgentParityTests` runs a real room, runner key `room` (`:11-49`).
  - Both compare only the golden. **No C# runner compares answers.**
  - Go and Rust have their own corpus runners: `packages/server/go/blokagent/parity_test.go:16-21` and `packages/server/rust/crates/blokagent/src/parity_test.rs`.
- **Adding a C# MCP runner to the same corpus.** There are two routes.
  1. **Black-box from TS** (section 1). Add `openMcpProcess` and keep `checkMcpCase`. The existing `mcp-stored`/`mcp-live` exemptions and the answer comparison apply unchanged. Cost: the attribution fix and a real live room.
  2. **xUnit in-process**: a `McpAgentParityTests` theory over `AgentParityCorpus.Names()`, like `JintAgentParityTests`.
     - It needs a runner key. `corpus.ts:97-98` accepts only the seven names, and its validator rejects unknown keys. Reusing `mcp-stored`/`mcp-live` would need `ExpectedError` to read the MCP exemption shape: `{errorCode, reason}` works today, but `{against:…}` has no `errorCode` and would read as "ok".
     - It would check only goldens, not answers, unless `answers.ts` is ported.

---

## 5. CI

Every number below comes from **one sample**: main run `42232343536` (sha `e400defc`), via `gh run view --json jobs`. That run had 35 jobs, matrices included.

Workflows that touch MCP, dotnet or conformance:

| Workflow / job | What it runs | Sample time |
|---|---|---|
| `ci.yml` `lint` (`:37-119`) | ESLint, tsc, then **Rust conformance** (`:116`) and **interop-rust** (`:119`). The comment says they live there because of the 20-job cap (`:94-97`). | 332s (Rust conf 131s) |
| `ci.yml` `workflow-lint` (`:121`) | actionlint and the server container image build and scan | 101s |
| `ci.yml` `codeql` (`:226-272`) | builds `Blok.Server.slnx` for C# CodeQL | 228s (csharp) |
| `ci.yml` `server-security` (`:283-357`) | dotnet restore and audit, Go fmt/vet/test | 418s |
| `ci.yml` `server` (`:359-399`) | `dotnet test Blok.Server.slnx` with coverage, `dotnet format` | **516s, already over 420s (7 min)** |
| `ci.yml` `server-delivery` (`:401-454`) | packed .NET packages, **C# conformance** (`:421`), **C#↔Go interop** (`:432`), artifact dry-runs, wiring tests | 366s (C# conf 217s, packages 67s, interop 40s) |
| `ci.yml` `unit-tests` 5 shards (`:456-498`) | `yarn build:mcp` (`:475`), then all unit tests, MCP ones included | 356–598s |
| `ci.yml` `workspace-unit-tests` (`:500-596`) | `yarn build:mcp` (`:526`), dist tests, Rust gates | 257s |
| `ci.yml` `validate-spec-coverage` (`:598-629`) | spec checks, then **Go conformance** (`:629`); `timeout-minutes: 6` | 142s (Go conf 82s) |
| `agent-evals.yml` | manual dispatch only. Builds the C# host (`:64-65`) and `yarn build:mcp` (`:67-68`). | not in CI runs |
| `codeql.yml` (`:45-65`) | weekly C# build | — |
| `release-server.yml` | tag `v*` (`:3-6`). Covered in section 6. | — |

Where a `--target csharp` MCP conformance job could fit, on these sample numbers:

- **A new job** takes one of the 20 concurrent slots. The memory note `ci-20-job-cap-wall-clock.md` records that the user chose "Stay Free, lossless only".
- **Server Delivery** is the natural home, since it already sets up .NET. At 366s it has about 54s left under 420s, so it fits only if the MCP build and run take under a minute.
- **Server** is already over budget.
- **Validate Spec Coverage** (142s) is the precedent for borrowing room: Go conformance moved there (`ci.yml:618-619`). Its `timeout-minutes` is pinned at 6 (`ci-critical-path-law.test.ts:711`), and it has no .NET setup.
- **Workflow Lint** (101s) and **Workspace Unit Tests** (257s) also have room. Neither sets up .NET today.
- **Any new step changes a pinned job.** `ci-critical-path-law.test.ts` lists required jobs (`:176-197`) and pins each job's exact step order, e.g. Server Delivery (`:367-395`) and Validate Spec Coverage (`:705-712`). That law must be edited in the same change.
- **No parity law would pin the new script.** `server-go-parity-law.test.ts` scans only `test-server-conformance.mjs --target X` lines (`:23-46`, `:91-113`), and `server-release-wiring.test.ts:230-246` pins only that script's suite list. A new law, or new targets inside the existing script, would be needed.

---

## 6. Release

**How `@bloklabs/mcp` ships today** (npm, lockstep):

- `packages/mcp/package.json`: version `2.0.0`, bin `blok-mcp`, runtime dependencies `@modelcontextprotocol/server` 2.4.0 and `ws` 8.22.0, Node `>=20.19.0`.
- Built by `scripts/build-mcp.mjs` with Vite SSR from `src/mcp/index.ts` and `stdout-guard.ts`. Everything is inlined except `node:*`, the SDK and `ws` (`:12-38`).
- `yarn release <version>` (`scripts/release.mjs`):
  - bumps the root and every workspace manifest, `packages/mcp/package.json` included (`:319-335`);
  - runs `build-server-runtime.mjs` (`:350`) and `build-all.mjs --with-cli` (`:357`);
  - publishes each `FAMILY` entry with `npm pack` + `npm publish` to npm, then to the GitHub Packages mirror (`:400-440`). `@bloklabs/mcp` / `@dodopizza/blok-mcp` is in `FAMILY` (`scripts/release-manifest.mjs:69-74`);
  - then tags and pushes (`:466-470`) and creates a draft GitHub release (`:494`).
- Before publishing, it refuses to start if a workflow that the tag triggers reads a secret the repo lacks. That covers `release-server.yml`, `mirror.yml` (`:8-15`, `:60`, `:272-285`).

**How the C# server ships** (`release-server.yml`, started by the `v*` tag):

- It waits for the draft release, then runs `dotnet test` and `dotnet format` (`:127-128`).
- `dotnet pack` builds `Blok.Server` and `Blok.Server.AspNetCore` with `-p:PackageVersion=$BLOK_SERVER_VERSION` (`:141-154`). `test-server-packages.mjs` checks the packed `.nupkg`s (`:155`).
- `publish-server.mjs` builds single-file host archives for 8 RIDs: osx, linux, linux-musl and win, each x64 and arm64 (`scripts/publish-server.mjs:14-71`, `:138-152`). Smoke tests follow (`:160-180`).
- `dotnet nuget push` goes to nuget.org with `NUGET_API_KEY` (`:204-215`), then mirrors to `nuget.pkg.github.com/dodopizza` (`:220-231`).
- `gh release upload` adds the archives and `.nupkg`s (`:233-256`).
- Docker builds `ghcr.io/jackuait/blok-server` from `packages/server/Dockerfile` (`:258-268`). That Dockerfile builds the JS runtime bundle, then `dotnet publish` of the Host as self-contained single-file (`Dockerfile:5-54`). It copies `packages/mcp/package.json` only for `yarn install` (`:13`). It does not ship the MCP.
- `deploy-docs.yml` `verify-release` (`:58-62`) checks that the release's packages exist. The NuGet list is `SERVER_NUGET_PACKAGES = ['Blok.Server', 'Blok.Server.AspNetCore']` (`scripts/verify-docs-release.mjs:17-20`).
- The Host csproj is `IsPackable=false` (`Blok.Server.Host.csproj:7`). `grep PackAsTool|ToolCommandName` across `packages/` finds nothing, so **no dotnet tool exists today**.

**What a C# MCP NuGet package plus dotnet tool would require.** Repo touch points come from the files above. Tool packaging facts come from Microsoft Learn, "Create RID-specific, self-contained, and AOT .NET tools" (fetched 2026-11-06, page dated 2026-01-26).

1. A new exe project with `<PackAsTool>true</PackAsTool>` and `<ToolCommandName>…</ToolCommandName>`.
   - Optional: per-RID self-contained tools with `RuntimeIdentifiers` or `ToolPackageRuntimeIdentifiers`. This is .NET SDK 10+, and the repo already uses `dotnet-version: '10.0.x'`.
   - One `dotnet pack` then makes a pointer package plus `<id>.<rid>.<version>.nupkg` per RID. Adding `any` to the list gives a framework-dependent fallback.
   - The RID packages must be pushed **before** the pointer package, and all must share one version.
   - Users run it with `dotnet tool install -g` or `dnx <tool>`.
   - With `PublishAot=true`, each RID must be packed on a matching OS. Whether Jint or the bundle can run under AOT is **unverified**.
2. In `release-server.yml`: a pack step next to `:145-154`, push steps in the order above next to `:204-231` (nuget.org and the dodopizza mirror), and the files added to `gh release upload`.
3. Add the package id(s) to `SERVER_NUGET_PACKAGES` (`verify-docs-release.mjs:17-20`). Extend `test-server-packages.mjs` to install and run the packed tool.
4. Wiring laws that pin this workflow and these scripts must be updated: `server-release-wiring.test.ts`, the Server Delivery dry-run step (`ci.yml:434-437`) and its law.
5. Versioning: C# packages take `BLOK_SERVER_VERSION`, taken from the git tag (`release-server.yml` "Prepare release version"). So a C# MCP would version in lockstep with `@bloklabs/mcp` without any extra step.
6. Secrets: `NUGET_API_KEY` and `BLOK_GITHUB_TOKEN` are already used and already prechecked by `release.mjs`.

---

## 7. Facts bearing on the "Go, C# and Rust" rule

These are reported, not decided.

- **The rule's text.** `CLAUDE.md:130-138`: "Every backend feature in `packages/server` is written three times … Parity is proven by the shared conformance suite." The user-memory version reads "every backend (packages/server) feature" (`memory/backend-go-and-csharp-parity-rule.md`).
- **Where the MCP lives.**
  - Source: `src/mcp/` (35 files, 4078 lines).
  - Package: `packages/mcp`, built from `src/mcp/index.ts` (`build-mcp.mjs:22`).
  - Nothing MCP-related lives under `packages/server`. A grep for "mcp" there finds only comments and tests.
- **The server README's scope.** `packages/server/README.md` describes uploads, link previews, live collaboration and document conversion. It does not mention MCP.
- **The MCP README's coupling.** It says to upgrade `@bloklabs/core`, `@bloklabs/server` and `@bloklabs/mcp` together, because they share the room format (`packages/mcp/README.md:264`).
- **The MCP is a client of the backends.**
  - Live mode joins the server's sync room (`mcp-agent-participant.test.ts`).
  - Both servers keep refusal and retry rules aligned with "MCP's HTTP reads": `packages/server/dotnet/Blok.Server/Agent/BlokAgentExecutor.cs:1064-1066` and `packages/server/go/blokagent/versions.go:261`.
  - The MCP-client scenario is a suite in the server conformance list (`test-server-conformance.mjs:51`), pinned by `server-release-wiring.test.ts:240`.
- **CHANGELOG framing (2.0.0).** "MCP server (`@bloklabs/mcp`)" is a separate entry from "Agents on the backend — The C# server (`IBlokAgentExecutor`) and the Go server (`blokagent`)" (`CHANGELOG.md:105-115`).
- **Release grouping.** The MCP ships with the npm family (`release-manifest.mjs:69-74`), not with the C# NuGet and Docker artifacts (`release-server.yml`). The Go server's agent runtime and the Rust `blokagent` crate exist and run the agent corpus (`parity_test.go`, `parity_test.rs`). There is no Go or Rust MCP.
- **Parity laws.** `agent-wire-parity-law.test.ts:15-21` states that Ask AI and MCP give a model the same answer. `mcp-handle-commands-law.test.ts` covers handles and `unavailableCommands`. Neither mentions Go, C# or Rust.
