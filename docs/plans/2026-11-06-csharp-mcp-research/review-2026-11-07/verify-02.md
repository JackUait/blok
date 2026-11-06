# Adversarial check of 02-csharp-reuse-map.md and 00-plan.md (C# claims)

Checked 2026-11-07 by reading the cited files and running commands. Paths under `dotnet/` = `packages/server/dotnet/`.

## Load-bearing claims

### 1. Engine runs stored docs and in-process rooms — CONFIRMED
- `dotnet/Blok.Server/Agent/IBlokAgentExecutor.cs:13-15` `ExecuteAsync`, `:49-50` `OpenSession` (default throws NotSupported; `BlokAgentExecutor` implements it), `:60-62` `ExecuteInRoomAsync`.
- `Agent/BlokAgentSession.cs:13` public sealed class, internal ctor (`:21`); caps 100 / 4 MiB at `:16-17`; "Not thread-safe" at `:10-11`.
- `Agent/BlokAgentExecutor.cs:385-560`: `ExecuteInRoomAsync` -> `rooms.AgentEditAsync(...)` (line ~507) -> `runtime.InvokeAsync("agentExecute")` (`:513`) -> `RoomEditTranslator.Translate`. Returns "Live rooms need collaboration" when `rooms is null` (`:394-397`).
- DI: `Blok.Server.AspNetCore/BlokDocumentsServiceCollectionExtensions.cs:79-86` wires `CollabRoomManager` only when `CollabEnabled`; `BlokServerServiceCollectionExtensions.cs:85` calls `AddBlokDocuments(warmUp: false)`.

### 2. Bundle lacks tool-call parser, MCP schemas, SHARED_RULES, skills, read op, describe op — CONFIRMED
- Bundle: `dotnet/Blok.Server/Generated/blok-server-runtime.js` (890471 bytes, Nov 6 21:04). `cmp` with `packages/server/go/internal/jsruntime/blok-server-runtime.js` -> identical.
- Probe strings verified to exist in source first, then `grep -o -F | wc -l` on the bundle:
  - `blok_read` / `blok_describe` / `blok_execute` (from `src/shared/agent/tool-call.ts:12,18-20`): 0 / 0 / 0
  - `x-mcp-header`, `Blok-Handle` (`src/agent/render-tools.ts:212`): 0, 0
  - `Call blok_read when you need` (`src/agent/guidance.ts:5`, SHARED_RULES): 0
  - `Improve the writing of the selected text` (`src/shared/skills.ts:29`): 0
- Controls (present): `Read the document as an outline` 1, `No command "` 1, `No tool "` 1, ` Inline tools: ` 1 (the last three are unique to `src/shared/agent/describe.ts:44,61`, so describeContract code IS bundled, minified).
- Doc's `grep -c` counts reproduced exactly (doc.read 3, history.read 3, "Call describe() for the list" 2, guidance 6). Caveat: "Call describe() for the list" also appears in `src/shared/agent/envelope.ts:39`, so it alone does not prove describe.ts is bundled; the `No tool "` probe does.
- `invoke` switch `src/view/server-runtime.ts:722-876` has 19 cases, none `read`/`describe`; the default throws `Unsupported Blok runtime operation`. `describeContract` is only reachable via `session.describe` (`src/shared/agent/document-session.ts:280`), which no op calls.

### 3. Outbound architecture test — CONFIRMED
- `dotnet/Blok.Server.Tests/OutboundClientArchitectureTests.cs:10-24` restricted types incl. `HttpClient`, `IHttpClientFactory`, `SocketsHttpHandler`, `ClientWebSocket`, `Socket`, `TcpClient`, `SslStream`.
- Owners `:31-36` (GuardedOutboundFetcher, S3BlobStore, DocEndpointClient); `PinnedOwners` = S3 + DocEndpoint (`:40-41`).
- Scan: every `*.cs` under the dir holding `Blok.Server.slnx` (`FindDotnetRoot`, ~`:596-612`), skipping `/bin/`, `/obj/` and first path segment ending `.Tests` (`IsGeneratedOrTestSource`, ~`:614-625`). A `dotnet/Blok.Server.Mcp/` project would be scanned; a `Blok.Server.Mcp.Tests` would not.
- Wording nit (00-plan): "outside three pinned owners" — the code has one guard owner plus two *pinned* owners; the failure message calls them three documented owners. Substance right.
- Cited reason for not reusing the fetcher is a comment, `Collab/DocEndpointClient.cs:67-71` ("forbids loopback ... and has no PUT"). Not independently verified in GuardedOutboundFetcher.

### 4. Visibility — CONFIRMED
- `AssemblyInfo.cs:3-5`: InternalsVisibleTo AspNetCore, AspNetCore.Tests, Tests only. (Host.Tests is not listed.)
- internal: `CollabRoomManager` (`Collab/CollabRoomManager.cs:197`), `ICollabMember` (`Collab/ICollabMember.cs:45`), `SyncWire` (`Collab/SyncWire.cs:100`, plus all frame records), `TicketVerifier` (`Tickets/TicketVerifier.cs:14`), `IDocEndpointClient`/`DocEndpointClient` (`Collab/DocEndpointClient.cs:49,78`), `RoomAgentHistory`, `BlokAgentExecutor`, `IBlokRuntime`, `JintBlokRuntime`, `YDocConverter`, `CollabDocConverter`.
- public: `ICollabRoomManager` (`Collab/ICollabRoomManager.cs:9`) — but it exposes only `DrainAsync` and `RecheckAccessAsync`, nothing an MCP can join/edit with.
- `BlokTicket.Create` public static (`Tickets/BlokTicket.cs:24,36,44`), HMACSHA256 over fixed header `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9` (= `{"alg":"HS256","typ":"JWT"}`), secret >= 32, TTL >= 1, lone surrogates refused.

### 5. No ClientWebSocket outside tests; no C# sync client — CONFIRMED
- `grep -rln ClientWebSocket --include='*.cs'` (excluding obj/bin): only `OutboundClientArchitectureTests.cs`, `Blok.Server.AspNetCore.Tests/Collab/SyncTestSupport.cs:1040`, `Blok.Server.Host.Tests/HostCollabTests.cs:855`.
- Non-test `ConnectAsync` hits are only TCP in `Outbound/GuardedOutboundFetcher.cs:546,643,676` (HTTP fetch). `blok-sync.v*` appears only in server-side files (SyncWire, CollabRoom, CollabOperation, SyncHandshake, options, host args).

### 6. Jint cannot wait on host -> APPROVAL_REQUIRED; uploads unavailable — CONFIRMED (with a list nit)
- `src/view/server-runtime.ts:640` `session.execute(batch)` with no options; `document-session.ts:284` only passes `approve: options.approve`. The "Jint cannot wait on the host" statement is the repo's own comment (`server-runtime.ts:530`); I did not test Jint's promise support myself.
- Test `dotnet/Blok.Server.Tests/Agent/JintDatabaseUnlockTests.cs:21-31` asserts `APPROVAL_REQUIRED` with `details.reason == "no-channel"`.
- Uploads: `BlokAgentExecutor.Common()` (`Agent/BlokAgentExecutor.cs:1176-1210`) only adds `pageBackend`; `RoomCommon` adds `versionHistory`. No `"uploader"` string anywhere in `dotnet/**/*.cs`. Note the Jint side already ACCEPTS `uploader` in `input.services` (`server-runtime.ts:587`), so the gap is C# not sending it plus no upload port, not a missing Jint filter.
- Nit (00-plan "Approvals (unlock, restore, share)"): the approval kinds are `database.share`, `database.buttonConfirm`, `database.buttonHooks`, `database.restore`, `database.unlock` (`src/shared/agent/approval.ts:16-27,68-83`). Button confirm/hooks are missing from the list.

### 7. Undo, co-authoring, sub-pages — CONFIRMED
- `Agent/RoomAgentHistory.cs:13-23` caps 100 / 4 MiB, IdleLimit 1 h, key (DocId, ActorId, OnBehalfOf). Used at `BlokAgentExecutor.cs:443,464,550,670`. Shared contract offers undo to `csharp-live` (`src/shared/tool-manifest.ts:392` UNDO_RUNNERS).
- Stale comment, not a doc error: `BlokAgentExecutor.cs` RoomCommon says "A room keeps no per-agent undo history" though RoomAgentHistory does keep it.
- `Blok.Server.Tests/Agent/JintAttributionTests.cs:51-52` asserts `createdBy == "human-1"`, `createdWith == "agent-cs"`. Exact.
- `IBlokPageCreator` public (`IBlokAgentExecutor.cs`); `BlokAgentPageCreateTests.cs:148` `InARoomTheInsertedPagePointsAtTheHostsPageAndUndoRedoNeverCreateAgain`, plus stored (`:228`) and room (`:241`) variants.
- Test run: see bottom.

### 8. Two NuGet packages, net10.0 — CONFIRMED
- `IsPackable true` + `PackageId` only in `Blok.Server.csproj:7,13` and `Blok.Server.AspNetCore.csproj:7,13`; Host and the three test projects `IsPackable false`. Every csproj `net10.0`.
- `.github/workflows/release-server.yml:145,150` pack both; `:208,212` push to nuget.org; `:224,228` second push (mirror); `:393-394` check both names.
- Deps match: AngleSharp 1.9.0, BouncyCastle 2.7.0, Jint 4.17.0; tests TestHost 10.0.14, Test.Sdk 18.11.0, xunit 2.9.3, runner 4.0.1.

### 9. Bundle shared by C#, Go, Rust — CONFIRMED
- `scripts/build-server-runtime.mjs:9-10` default Go dir (comment: committed for go:embed); `writeServerRuntimes` (`:72-82`) builds once and copies to Go.
- `git ls-files` confirms Go copy is committed; C# copy gitignored (`.gitignore:29`).
- `packages/server/rust/crates/jsruntime/src/runtime.rs:7-8` `include_str!("../../../../go/internal/jsruntime/blok-server-runtime.js")`.

### 10. IBlokAuthorization fits an MCP authorize hook — PARTLY
- `Blok.Server.AspNetCore/IBlokAuthorization.cs:20-53`: `CanReadDocumentAsync` / `CanWriteDocumentAsync(ClaimsPrincipal, string documentId, CancellationToken)`; narrows only; docs say it is consulted by sync upgrade and HTTP edit/reset.
- Node: `AuthorizeHook = (principal: string, documentId: string, write: boolean) => Promise<boolean>` (`src/mcp/options.ts:10`, `src/mcp/auth/authorize.ts:10`).
- Fits conceptually, but not one-to-one: Node's principal is a string, C#'s is a ClaimsPrincipal, so the MCP must build a ClaimsPrincipal from its principal (stdio has none) and map `write` to two calls. Node's `--authorize` also takes a module path, not only a webhook (`authorize.ts:24-60`); the doc mentions only the webhook form. Also `IBlokAuthorization` lives in `Blok.Server.AspNetCore`, so a non-ASP.NET stdio tool would need that package.

## Other 02 claims checked

- 02 §0 table locations: all match the line numbers I opened (CollabRoomManager 197, ICollabMember 45, SyncWire 100, TicketVerifier 14, DocEndpointClient 49/78, YDocConverter 42, CollabDocConverter 14, IBlokRuntime 3, JintBlokRuntime 13, IBlokDocumentConverter 112, BlokDocuments 7 class). CONFIRMED.
- `runtime.InvokeAsync` call lines 88, 143, 227 (doc says 228; the call starts at 227 and the op name is on the next line), 346. CONFIRMED.
- DocEndpointClient: GET `:142`, PUT `:159`, `AllowAutoRedirect = false` `:208`, 64 MiB `:25`; no `409`/`Conflict`, no list method. CONFIRMED.
- "No awareness/presence in Agent/*.cs": `grep -n 'awareness\|presence\|Awareness' Agent/*.cs` -> 0. CONFIRMED.
- "Version history room only": `Common()` adds no `versionHistory`; `RoomCommon` adds it when `rooms.HasHistory`. CONFIRMED.
- §6 "grep Mcp/MCP in *.cs: only two doc comments": WRONG count, 3 hits: `Blok.Server.Tests/Documents/BlokDocumentConverterTests.cs:197,259` and `Blok.Server/Agent/BlokAgentExecutor.cs:1066` — all comments, conclusion (no MCP SDK referenced) stands.

## Test run

`dotnet test Blok.Server.Tests -p:SkipBlokServerRuntimeBuild=true --filter` on JintAttributionTests, JintDatabaseUnlockTests, BlokAgentRoomHistoryTests, BlokAgentPageCreateTests, OutboundClientArchitectureTests:
`Passed! - Failed: 0, Passed: 70, Skipped: 0, Total: 70` (against the Nov 6 21:04 bundle). The tests pass today, so the behaviour the doc cites is live.

## WRONG / PARTLY summary

1. PARTLY, claim 10: `IBlokAuthorization` takes a `ClaimsPrincipal` and has separate read and write methods. Node's hook is `(principal: string, documentId, write)`. The MCP must build a `ClaimsPrincipal` and pick the method from `write`. Node's `--authorize` also takes a module path, not only a webhook. The interface lives in `Blok.Server.AspNetCore`.
2. PARTLY, 00-plan "Approvals (unlock, restore, share)": the list leaves out `database.buttonConfirm` and `database.buttonHooks` (`src/shared/agent/approval.ts:16-27`).
3. PARTLY, 00-plan "three pinned owners": the code has 1 guard owner plus 2 pinned owners (`OutboundClientArchitectureTests.cs:31-41`). The substance is right.
4. PARTLY, claim 6 uploads: the Jint side already accepts `uploader` in `services` (`server-runtime.ts:587`). The gap is on the C# side: it never sends `uploader` and has no upload port.
5. WRONG (trivial), 02 §6: the `Mcp`/`MCP` grep finds 3 comments, not 2. The conclusion still holds.
6. Note, not a doc error: the `RoomCommon` comment in `BlokAgentExecutor.cs`, "A room keeps no per-agent undo history", is stale. `RoomAgentHistory` does keep it.
