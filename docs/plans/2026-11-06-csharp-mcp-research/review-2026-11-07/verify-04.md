# Verification of 04-parity-tests-and-release.md and 00-plan.md §2-§3

Repo HEAD a626c28f (2026-11-07). Read-only. Every verdict below cites a file read or command run in this session.

## 1. startServer / blok-mcp spawn facts — CONFIRMED
- `run-against.ts:45-48` reads `BLOK_CONFORMANCE_SERVER`; `:80-98` replaces `--listen 127.0.0.1:0` and throws `Server args must include --listen ...` otherwise; `:166-186` retry loop.
- `server-process.ts:15` marker `' listening on '`; `:117` `GET /health` must be 200; `:161` ready only when health is OK AND stderr has the marker; `adoptChild` at `:104`.
- `src/mcp/config.ts:16` `--http` is a value flag, `:182` `flag(argv,'--http') ?? env.BLOK_MCP_HTTP`, `:195-197` http transport.
- `src/mcp/http.ts:133` "port 0 picks the real one"; `:162-163` any path other than `/mcp` (and OAuth metadata) gets 404 (`writeHead(404)` at `:163`). Note: the Origin/Host check before it answers 403 for a non-loopback Host, so `/health` is 404 only on a loopback Host.
- `src/mcp/index.ts:59` `console.error(\`blok-mcp: listening on ${http.url}/mcp\`)`. The URL carries the real port: `http.ts:213-223` builds it from `server.address().port`, not the requested `:0`.

## 2. checkMcpCase reusable; client is a devDependency — PARTLY
- `@modelcontextprotocol/client` 2.4.0 and `/server` 2.4.0 are in `devDependencies` (node read of package.json). CONFIRMED.
- `checkMcpCase` exists (`mcp-harness.ts:227-255`) and the `McpRun` seam exists (`:31-39`). BUT it is NOT reusable "unchanged": `:228` hard-codes the opener: `await (runner === 'mcp-stored' ? openMcpStored : openMcpLive)(c.seed, TEST_ACTOR)`, and its `runner` parameter is typed `McpRunnerName` (also used for `mcpExemption`/`expectationFor`). Plugging in `openMcpProcess` requires changing `checkMcpCase` to take an opener (or adding a branch). 04 §1 step 6 ("call the unchanged checkMcpCase") is wrong on that point.
- `openMcpStored`/`openMcpLive` are also used by `test/unit/mcp/creation-stamp.test.ts:5,33`. There is already a spawn-based MCP surface in `test/evals/agent/runner/surfaces/mcp.ts:115` and `live-room.ts:38-127` (spawns blok-mcp with `--sync-url` against a real room). 04 does not mention it; it is prior art for `mcp-process.ts`.

## 3. Agent id in goldens vs spawned binary — CONFIRMED, with two details missed
- `test/unit/agent/harness.ts:19` `TEST_ACTOR = { id: 'agent-test', ..., onBehalfOf: 'human-1' }`.
- Goldens (53 JSON files): `lastEditedWith: "agent-test"` x123, `createdWith: "agent-test"` x90, `lastEditedBy`/`createdBy: "human-1"`. 41 of 53 goldens contain `agent-test`.
- `src/mcp/actor.ts:9-14` id = `agent:${principal}:${clientName}`.
- `normalize.ts:259-264` replaces `lastEditedAt` AND `createdAt` (04 says "only lastEditedAt"; minor). No actor remap — confirmed.
- So a remap must cover `createdWith` as well as `lastEditedWith`.
- Answers: answer rows go through `normalizeForParity` (`answers.ts:39`) but `meta` is projected separately in `answers.ts:135` (only `lastEditedAt` masked). `meta.lastEditedBy` is built from `block.rest.lastEditedBy` (the human, `document-view.ts:52-61`), not the agent id, so with `--principal human-1` meta should match. Lead only; I did not run it. Still unverified overall whether any answer carries the agent id.
- Plan §3 milestone 1 says "remap in normalize.ts"; 04 says remap in `output()` and answers. Remapping only in normalize.ts would not touch answer `meta` (handled in answers.ts). Probably harmless per above, unverified.

## 4. Live corpus runner uses a fake in-memory socket — CONFIRMED
`mcp-harness.ts:112` `class RoomSocket` acks every operation into an in-memory `DocumentStore`; `openMcpLive` at `:152`, passed at `:173-174` via `assembleMcp(..., { liveSocketFactory })`.

## 5. Test counts — CONFIRMED
- `npx vitest run --project=unit test/unit/mcp --maxWorkers=2`: 39 files, **939 passed**.
- Both runners: 2 files, **108 passed** = 54 each.
- Corpus: `cases/` 40, `evals/` 14 (one `parityExcluded`: `evals/custom-tool.json`) = 53 cases. Only `cases/05-bookmark-create.json` has `services` and MCP `against: json-without-services` exemptions.
- Minor: 04 §4 says `goldens/ (54)`; it has 53 JSON files + `.gitkeep`.

## 6. "an MCP agent joins" runs TS MCP in-process vs backend under test — CONFIRMED
`mcp-agent-participant.test.ts:16` imports `assembleMcp`; `:14` uses the real `nodeSocketFactory`; `:153-157` `startServer` with `--listen 127.0.0.1:0 --auth ticket ... --collab ... --conformance-journal`; `:25` skipIf no `BLOK_CONFORMANCE_SERVER`; cases at `:182, :242, :279, :294, :318`.

## 7. C# corpus runners skip service cases, compare only goldens — CONFIRMED (nuance)
- `AgentParityCorpus.cs` `LoadAll`: `if (json["services"] is not null) continue;` for `cases/`; evals skip only `parityExcluded` (no eval has services).
- `JintAgentParityTests.cs:43,48-54` and `RoomAgentParityTests.cs:35,40-46`: assert expected error code (`ExpectedError(c,"jint"|"room")`) and the golden. No answer comparison. So "only goldens" = goldens plus the outcome code.
- `ExpectedError` reads `expectByRunner[runner]["errorCode"]`; an `{against:...}` exemption has none and reads as ok. 04's claim holds.

## 8. CI — CONFIRMED (one-sample caveat matters for Server Delivery)
Job times from `gh run view --json jobs` (completedAt-startedAt):

| Job | 42232343536 (04's sample) | 42245028952 | 42180833223 |
|---|---|---|---|
| Server | 516 | 466 | 486 |
| Server Delivery | 366 | 336 | **405** |
| Validate Spec File Coverage | 142 | 138 | 153 |
| Lint | 332 | 321 | 631 |
| Workflow Lint | 101 | 121 | 110 |
| Workspace Unit Tests | 257 | 299 | 354 |
| Server Security | 418 | 364 | 424 |

- All three runs have 35 jobs. Server is over 420 s in all three.
- Server Delivery spare under 420 s ranges 15-84 s, not a stable "54 s". 04 does say it is one sample.
- 20-job cap and "Stay Free, lossless only": `memory/ci-20-job-cap-wall-clock.md`. Confirmed.
- `ci-critical-path-law.test.ts`: required jobs list at `:178-197`; Server Delivery exact ordered steps at `:367+`; Validate Spec Coverage `timeout-minutes` 6 at `:705` and ordered steps after. Confirmed.
- `server-go-parity-law.test.ts:31,46` scans only `node scripts/test-server-conformance.mjs --target X`. `server-release-wiring.test.ts:230-246` pins the suite list. Confirmed.

## 9. Release — CONFIRMED (minor omissions)
- `release-manifest.mjs:69-74` `@bloklabs/mcp` / `@dodopizza/blok-mcp` in FAMILY.
- `release-server.yml:3-5` `tags: ['v*']`; `dotnet pack` Blok.Server and Blok.Server.AspNetCore `:145-152`; `test-server-packages.mjs` `:155`; `publish-server.mjs` `:156`; `nuget push` `:208-228`; `gh release upload` `:237-255`; docker build `:265`. Line numbers drift by a few from 04's. 04 omits that the same workflow also runs `publish-server-go.mjs` (`:159`).
- `verify-docs-release.mjs:17-20` `SERVER_NUGET_PACKAGES = ['Blok.Server','Blok.Server.AspNetCore']`.
- Host csproj `:7` `IsPackable=false`; no `PackAsTool`/`ToolCommandName` in any csproj (grep hits only dist JS).
- Dockerfile `:13` copies `packages/mcp/package.json` only.
- `release.mjs:14-15` checks `release-server.yml`, `mirror.yml`.
- `server-release-wiring.test.ts:15,118,217,369,651` pins release-server.yml, verify-docs-release.mjs and test-server-packages.mjs. So these files are the right touch points.

## 10. Plan milestone consistency — PARTLY
- Bundle shared by three backends: CONFIRMED. `build-server-runtime.mjs:8,10` writes C# `Blok.Server/Generated` and Go `internal/jsruntime`; `rust/crates/jsruntime/src/runtime.rs:7-8` `include_str!` of Go's copy.
- Milestone 3 = library then tool, milestone 5 = in-process live, milestone 6 = approval retry: as stated in the plan text. CONFIRMED as written.
- Inconsistencies found:
  1. **Harness targets vs the user decision.** §3 M1 says `--target node|csharp`. §4 says the MCP is written in Go and Rust too, proven by one shared suite. The harness needs `go`/`rust` targets; §3 was not updated.
  2. **Live corpus for a spawned C# binary.** M1 says the harness reuses `checkMcpCase` and the corpus. The corpus has `mcp-live` runs. The tool (spawned binary) gets live mode only in M7 (remote). M5's in-process live exists only when the library runs inside a Blok C# host, which a spawned `Blok.Mcp` is not. So C# `mcp-live` corpus parity cannot run until M7, unless the harness spawns a test host that hosts both collab and the MCP library. The plan does not say which.
  3. **Approval retry depends on bundle work that M2 does not list.** `src/view/server-runtime.ts:640` calls `session.execute(batch)` with no `approve`. `approve` is an `AgentApprover` callback (`src/mcp/dispatcher.ts:31,259`; `types/agent.d.ts:379`), not a value. "Jint runs a second time with an `approve` input" needs a new `agentExecute` input that builds an approver from the client's answer. It is not in M2's operation list. 03 measured only the SDK side of the retry (`03-csharp-mcp-sdk.md:137`, a test handler), not a Jint re-run. Also unverified: whether a batch refused with `APPROVAL_REQUIRED` leaves the document unchanged, so that re-running the whole batch is safe.
  4. M1 says the harness talks stdio and HTTP. C# HTTP lands in M4, so C# can only pass the stdio half until M4. This is just sequencing, not a contradiction.
