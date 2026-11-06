# 02 — What the C# server already has for an MCP port

Research only. Every claim cites a file read or a command run on 2026-11-06.
Paths under `dotnet/` mean `packages/server/dotnet/`. "Unverified" marks what was not checked.

Commands run:

- `dotnet --version` → `10.0.400`.
- `dotnet build dotnet/Blok.Server.AspNetCore/Blok.Server.AspNetCore.csproj -p:SkipBlokServerRuntimeBuild=true` → 0 warnings, 0 errors.
- `dotnet test dotnet/Blok.Server.Tests --list-tests` → 544 tests under `Blok.Server.Tests.Agent.*`.

## 0. The main split: public vs internal

A new `Blok.Server.Mcp` package sees only the public surface. Everything internal needs a new `InternalsVisibleTo` line or a new public API.
Today `Blok.Server` opens its internals to `Blok.Server.AspNetCore` and the two test projects only (`dotnet/Blok.Server/Properties/AssemblyInfo.cs:3-5`).

| Type | Visibility | Where |
| --- | --- | --- |
| `IBlokAgentExecutor` (ExecuteAsync, GetContractAsync, GetRoomContractAsync, OpenSession, ExecuteInRoomAsync) | public | `Agent/IBlokAgentExecutor.cs:4-62` |
| `BlokAgentSession`, `BlokAgentActor`, `BlokAgentExecution`, `BlokAgentOptions` | public | `Agent/BlokAgentSession.cs:13`, `Agent/IBlokAgentExecutor.cs:68-96` |
| `IBlokPageTarget`, `IBlokPageCreator`, `BlokPageLocation` | public | `Agent/IBlokAgentExecutor.cs:99-145` |
| `BlokDocuments.CreateAgentExecutor` / `Create` | public | `Documents/BlokDocuments.cs:136,150` |
| `IBlokDocumentConverter` (incl. `GetPageIndexAsync`) | public | `Documents/IBlokDocumentConverter.cs:112,246` |
| `BlokTicket.Create`, `BlokTicketClaims` | public | `Tickets/BlokTicket.cs:8-44` |
| `IBlokAuthorization`, `BlokServerBuilder`, `BlokServerOptions` | public | `dotnet/Blok.Server.AspNetCore/IBlokAuthorization.cs:20`, `dotnet/Blok.Server.AspNetCore/BlokServerBuilder.cs:14`, `dotnet/Blok.Server.AspNetCore/BlokServerOptions.cs:18` |
| `ICollabRoomManager` | public | `Collab/ICollabRoomManager.cs:9` |
| `BlokAgentExecutor` | internal | `Agent/BlokAgentExecutor.cs:7` |
| `IBlokRuntime`, `JintBlokRuntime` | internal | `Runtime/IBlokRuntime.cs:3`, `Runtime/JintBlokRuntime.cs:13` |
| `CollabRoomManager` (JoinAsync, AgentEditAsync, HistoryAsync) | internal | `Collab/CollabRoomManager.cs:197,258,402,476` |
| `ICollabMember` | internal | `Collab/ICollabMember.cs:45` |
| `SyncWire` | internal | `Collab/SyncWire.cs:100` |
| `TicketVerifier` | internal | `Tickets/TicketVerifier.cs:14` |
| `DocEndpointClient` / `IDocEndpointClient` | internal | `Collab/DocEndpointClient.cs:49,78` |
| `YDocConverter`, `CollabDocConverter` | internal | `Collab/YDocConverter.cs:42`, `Collab/CollabDocConverter.cs:14` |

(Paths in this table are under `dotnet/Blok.Server/` unless they name another project.)

## 1. Agent engine in C#

### How it is called

- `IBlokAgentExecutor.ExecuteAsync(documentJson, batchJson, actor, options)` runs one batch on a stored document. It returns the new document only on success (`Agent/IBlokAgentExecutor.cs:13-15`, impl `Agent/BlokAgentExecutor.cs:34-110`).
- `OpenSession(actor, options)` returns a `BlokAgentSession`. It carries undo/redo steps between calls, as long as each call passes the document the session last returned (`Agent/IBlokAgentExecutor.cs:41-50`, `Agent/BlokAgentSession.cs:47-56`). Caps: 100 steps, 4 MiB (`Agent/BlokAgentSession.cs:16-17`).
- `BlokAgentSession` is **not thread-safe**: "await each call before the next" (`Agent/BlokAgentSession.cs:10-11`). An MCP handle layer must serialize calls per handle, as Node's `HandleRegistry.use` does (`src/mcp/dispatcher.ts:170`).
- `ExecuteInRoomAsync(docId, batchJson, actor, options)` runs a batch on a live room in the same process (`Agent/BlokAgentExecutor.cs:385-560`). See §2.
- `GetContractAsync` / `GetRoomContractAsync` / `BlokAgentSession.GetContractAsync` return the full contract JSON (`Agent/BlokAgentExecutor.cs:343-378`, `Agent/BlokAgentSession.cs:39-40`). The contract type has a `revision` field (`types/tool-manifest.d.ts:164-166`), which can serve as Node's `contractRevision`.
- DI registration: `AddBlokDocuments()` registers a singleton `IBlokAgentExecutor`. It wires in the room manager only when `CollabEnabled` is true (`dotnet/Blok.Server.AspNetCore/BlokDocumentsServiceCollectionExtensions.cs:57,79-86`). `AddBlokServer` calls `AddBlokDocuments(warmUp: false)` (`dotnet/Blok.Server.AspNetCore/BlokServerServiceCollectionExtensions.cs:85`).
- Every call goes through `runtime.InvokeAsync("agentExecute" | "agentPagesNeeded" | "agentPlanHost" | "manifest", json)` (`Agent/BlokAgentExecutor.cs:88,143,228,346`).

### The JS bundle Jint loads

- Built by `scripts/build-server-runtime.mjs`. It runs Vite in library mode, entry `src/view/server-runtime.ts`, format IIFE, target es2020, `resolve.conditions: ['worker']` (`scripts/build-server-runtime.mjs:29-55`).
- The output goes to `dotnet/Blok.Server/Generated/blok-server-runtime.js`, which is gitignored (`.gitignore:29`). The same file is also copied to the committed Go bundle `packages/server/go/internal/jsruntime/` (`scripts/build-server-runtime.mjs:9-10,72-82`). **So any new op added to `server-runtime.ts` also changes the Go runtime bundle and its law tests.**
- MSBuild rebuilds it before `PrepareResourceNames` when any `src/**/*.ts` changes, and embeds it as `Blok.Server.Runtime.blok-server-runtime.js` (`dotnet/Blok.Server/Blok.Server.csproj:48` `EmbeddedResource`, `:57` `BuildBlokServerRuntime` target). `-p:SkipBlokServerRuntimeBuild=true` skips it (`:61`).
- The ops the bundle exposes are only the `invoke` switch in `src/view/server-runtime.ts:722-876`: `markdownToBlocks`, `htmlToBlocks`, `blocksToHtml`, `blocksToMarkdown`, `…WithPages`, `blocksToPlainText`, `…WithReport`, `inspect`, `version`, `schema`, `manifest`, `extractTexts`, `injectTexts`, `pageIndex`, `remapPageDocument`, `htmlFieldsToSegments`, `agentExecute`, `agentPlanHost`, `agentPagesNeeded`.
- **There is no read op and no describe op.**

What is and is not in the bundle (checked by `grep -c -F` on the generated file, built 2026-11-06 21:04):

| Piece | In bundle? | Evidence |
| --- | --- | --- |
| Shared executor, `doc.read` / `doc.find` / `history.*` commands | yes | "Read the document as an outline" ×1, `doc.read` ×3, `history.read` ×3 |
| `describeContract` (`src/shared/agent/describe.ts`) | code yes, **not exposed** | "Call describe() for the list" ×2; no `invoke` case calls it |
| Contract guidance (`contract.guidance`) | yes, inside `manifest` output | "guidance" ×6; `buildAgentContract` at `server-runtime.ts:844` |
| Tool-call parser `src/shared/agent/tool-call.ts` | **no** | `blok_read` ×0, `blok_describe` ×0, `blok_execute` ×0 |
| `renderAgentTools` (MCP tool schemas, `src/agent/render-tools.ts`) | **no** | `x-mcp-header` ×0, `Blok-Handle` ×0 |
| MCP / Ask AI rules (`SHARED_RULES`, `src/agent/guidance.ts:4`) | **no** | "Call blok_read when you need" ×0 |
| Skills / prompts (`src/shared/skills.ts`) | **no** | "Improve the writing of the selected text" ×0 |

### Can it answer the three core tools?

| Tool | Stored document | Live room (same process) |
| --- | --- | --- |
| `blok_execute` | yes: `ExecuteAsync` or a `BlokAgentSession` | yes: `ExecuteInRoomAsync` |
| `blok_read` | partial: send a `doc.read` batch and unwrap `results[0]` (tests do this: `Blok.Server.Tests/Agent/BlokAgentRoomTests.cs:168-173`). Node calls `session.read(args)` instead (`src/shared/agent/document-session.ts:267-270`). Exact parity of the two answers is **unverified**. | same, via `ExecuteInRoomAsync` |
| `blok_describe` `{tool}` / `{command}` | **missing**. Only the whole contract comes back. Node slices it with `describeContract` (`document-session.ts:280`). | same |
| Argument parsing / unknown-argument refusal (`parseToolCall`, `toolErrorAnswer`) | **missing** in C# and in the bundle | `src/mcp/dispatcher.ts:241,300` |

### Co-authoring, history, sub-pages

- **Co-authoring:** yes. The actor goes in as `{id, name, kind: "agent", onBehalfOf}` (`Agent/BlokAgentExecutor.cs:1228-1238`). A test asserts `createdBy = "human-1"` and `createdWith = "agent-cs"` on a block the agent made (`Blok.Server.Tests/Agent/JintAttributionTests.cs:51-52`).
- **Undo/redo, stored:** yes, through `BlokAgentSession` (Jint carries the steps; `server-runtime.ts:509-528,648`).
- **Undo/redo, room:** yes. `RoomAgentHistory` keeps steps per (doc, actor id, onBehalfOf), in process memory, dropped after 1 h idle, same caps (`Agent/RoomAgentHistory.cs:13-23`). Steps are recorded after the room write (`Agent/BlokAgentExecutor.cs:541-551`). The room contract uses `runtime: "csharp-live"` (`Agent/BlokAgentExecutor.cs:1212-1224`).
- **Version history:** room only, and only when the journal keeps history (`rooms.HasHistory`, `Agent/BlokAgentExecutor.cs:1219-1223`; test `BlokAgentVersionHistoryTests.cs:43,112`). Reads and restore go to `CollabRoomManager` in process (`Agent/BlokAgentExecutor.cs:416-419,855`). A stored call never offers them (`Common()` adds no `versionHistory`, `Agent/BlokAgentExecutor.cs:1176-1210`).
- **Sub-page creation:** yes, when `BlokAgentOptions.PageTitles = true` and `PageTarget` is an `IBlokPageCreator`. C# creates the pages first, because Jint cannot await the host (`Agent/BlokAgentExecutor.cs:130-140`, `server-runtime.ts:530-548`). Works stored and in a room (`BlokAgentPageCreateTests` lists both, e.g. `InARoomTheInsertedPagePointsAtTheHostsPageAndUndoRedoNeverCreateAgain`).
- **Page rename / icon on another document:** yes, through `IBlokPageTarget.ResolveAsync` → `BlokPageLocation.Stored` or `.Room` (`Agent/IBlokAgentExecutor.cs:99-145`).

### Gaps caused by "Jint cannot await the host"

- **Approval (MCP elicitation):** `agentExecute` calls `session.execute(batch)` with no `approve` (`src/view/server-runtime.ts:640`). So unlocking a locked database answers `APPROVAL_REQUIRED` (`Blok.Server.Tests/Agent/JintDatabaseUnlockTests.cs:21-31`). Node passes the client's elicitation as `approve` (`src/mcp/dispatcher.ts:259`, `src/mcp/sdk-server.ts:87`).
- **Uploads:** `Common()` never adds the `uploader` service (`Agent/BlokAgentExecutor.cs:1176-1210`), and `contractWhere` has no `uploadsFiles` (`server-runtime.ts:497-501`). So `<tool>.uploadFile` is unavailable. Blob storage (`IBlobStore`, upload routes) exists only as server routes.

## 2. How an agent joins a room today

- **In-process: yes.** `ExecuteInRoomAsync` calls `CollabRoomManager.AgentEditAsync(docId, planOps, …)` (`Agent/BlokAgentExecutor.cs:507`, `Collab/CollabRoomManager.cs:402-410`). Inside the room lane it exports the live YDoc to JSON, runs Jint `agentExecute`, and turns Jint's `edits` into room ops with `RoomEditTranslator.Translate` (`Agent/BlokAgentExecutor.cs:509-540`). The revision is the journal head `lineage:sequence`, not Jint's hash (`Agent/BlokAgentExecutor.cs:380-384`). No socket and no ticket are involved.
- This only works when the MCP runs **in the same process** as the room manager, with `CollabEnabled = true`.
- **No awareness / presence for agents.** No `awareness` or `presence` in `Agent/*.cs` (grep, 0 hits). A room member is an internal `ICollabMember` (`Collab/ICollabMember.cs:45`), joined by internal `CollabRoomManager.JoinAsync(docId, member)` (`Collab/CollabRoomManager.cs:258-261`). An in-process presence member would need new internal access or new public API.
- **Remote sync service (Node's model): missing.**
  - Node opens a headless Yjs room over `ws`, with a ticket and an Origin header (`src/mcp/live/open-live.ts:138-157`, `src/mcp/live/node-socket.ts:11-12`).
  - C# has only the server side: `SyncEndpoint`, `SyncHandshake` (subprotocols `blok-sync.v1` / `.v2`, ticket in the subprotocol offer, Origin check; `dotnet/Blok.Server.AspNetCore/Collab/SyncHandshake.cs:60-61,113-122,305`), and the wire codec `SyncWire` (internal, `Collab/SyncWire.cs:100-155`).
  - There is no client handshake, no v2 operation/ack client, no reconnect, no client-side pending outbox. `ClientWebSocket` appears only in test projects (`Blok.Server.AspNetCore.Tests/Collab/SyncTestSupport.cs:1040`, `Blok.Server.Host.Tests/HostCollabTests.cs:855`).
  - The YDoc engine (`Yjs/YDoc.cs`, `Yjs/UpdateV1Encoder.cs`) can read and write updates. A client could be built on it, but none exists.
- **Delivery mapping.** Node returns `durability` (`acknowledged` / `best-effort` / `saved-on-execute`) and `delivery {durable, pending, serverSequence, savedVersion}` (`src/mcp/session.ts:4-13`). In-process C# room writes return the journal head as `BlokAgentExecution.Revision`. With a journal, a write is committed before anyone is told (`docs/src/components/server/server-data.ts:605`). So an in-process room write maps to `durable: true, pending: false`. That mapping is an inference, **unverified** against the Node live session's exact semantics.

### Outbound-client architecture law (a hard constraint)

`OutboundClientArchitectureTests` forbids `HttpClient`, `HttpClientHandler`, `HttpMessageInvoker`, `IHttpClientFactory`, `SocketsHttpHandler`, `ClientWebSocket` and other socket types (`Blok.Server.Tests/OutboundClientArchitectureTests.cs:10-24`). Only `GuardedOutboundFetcher`, `S3BlobStore` and `DocEndpointClient` may own one (`:31-40`).

It scans every `*.cs` under the folder that holds `Blok.Server.slnx`, except `bin/`, `obj/` and projects whose name ends in `.Tests` (`:46-49,595-623`). **So a new `Blok.Server.Mcp` project under `dotnet/` is scanned.** The guarded fetcher is not a drop-in: it forbids loopback and has no PUT (`Collab/DocEndpointClient.cs:67-72`). So every outbound call the Node MCP makes would need a new pinned owner or a change to the test:

- endpoint source GET / PUT / list (`src/mcp/sources/endpoint.ts:67-152`)
- ticket URL POST (`src/mcp/auth/tickets.ts:44`)
- authorize webhook (`src/mcp/auth/authorize.ts:34`)
- OAuth JWKS fetch (`src/mcp/auth/oauth.ts:81`)
- live version-history HTTP (`src/mcp/live/version-history.ts:55-65`)
- the sync WebSocket (`src/mcp/live/node-socket.ts:12`)

## 3. Tickets

- **Signer: exists, public.** `BlokTicket.Create(secret, new BlokTicketClaims { User, Doc, Write, TtlSeconds })` (`Tickets/BlokTicket.cs:8-44`). It needs a secret of at least 32 characters, a TTL of at least 1 s (default 300), and refuses lone surrogates (`:51-65`).
- **Format:** HS256 JWT. Fixed header segment `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9` (`Tickets/TicketVerifier.cs:16`). Payload keys are written in the order `user`, `doc` (optional), `write`, `exp` (`Tickets/BlokTicket.cs:70-90`). Base64url, no padding (`:110-111`).
- Documented for .NET hosts in `packages/server/README.md:304-312`.
- **Verifier: exists, internal** (`Tickets/TicketVerifier.cs:14-31`; used at `BlokServerRequestGuard.cs:93` and `SyncHandshake.cs:305`).
- **Usable with `BLOK_SECRET`:** yes. The host reads `BLOK_SECRET` into `options.Secret` (`dotnet/Blok.Server.Host/HostArguments.cs:279`). Node's secret mode mints `{user: actorId, doc, write, ttl 1800}` (`src/mcp/auth/tickets.ts:34-36`); `BlokTicket.Create` can mint the same claims.
- **Ticket URL mode (POST to host, check claims):** missing. Node does this at `src/mcp/auth/tickets.ts:43-100`.

## 4. Documents and the endpoint contract

- `IBlokDocumentConverter`: convert, validate, extract and inject texts, `GetPageIndexAsync`, `RemapPageDocumentAsync`, import from Markdown and HTML (`Documents/IBlokDocumentConverter.cs:112-574`). Public. Useful for loading stored JSON and for page titles.
- **There is no document load/save abstraction** (no `IDocumentSource`). Node has `DocumentSource { load, save, list? }` (`src/mcp/sources/types.ts`).
- **There is an endpoint client, but it is internal and room-only.** `DocEndpointClient` (`Collab/DocEndpointClient.cs:78`):
  - `LoadAsync`: GET `{endpoint}/{docId}`; accepts bare OutputData, a `{data, version}` envelope, or `null` (`:73-76,138-148`).
  - `SaveAsync`: PUT with `Blok-Doc-Version`, plus `Blok-Doc-Lineage` / `Blok-Doc-Sequence` for room projections (`:81-87,150-181`).
  - Redirects off (`AllowAutoRedirect = false`, `:208`); Authorization sent verbatim, CR/LF refused (`:342-349`); response size capped at 64 MiB (`:25`).
  - Any non-2xx throws `DocEndpointException` with `StatusCode` (`:381-390`). **No 409 → `DOCUMENT_CHANGED` mapping.** Node maps 409 at `src/mcp/sources/endpoint.ts:104-106`.
  - **No list route.** Node's optional `list` GET is at `src/mcp/sources/endpoint.ts:125-152`.
  - Built only inside the `CollabRoomManager` factory, from `DocEndpoint` / `DocEndpointAuth` options (`BlokServerServiceCollectionExtensions.cs:150-162`).
- **Files source:** missing. Node's `src/mcp/sources/files.ts` keeps one JSON file per id with locks and atomic rename. `LocalCollabStore` is the room working set, not document JSON, so it does not fit.

## 5. ASP.NET Core integration pattern

The shape a `Blok.Server.Mcp` package would copy:

- `services.AddBlokServer(options => …)` → validates options and returns a `BlokServerBuilder` (`dotnet/Blok.Server.AspNetCore/BlokServerServiceCollectionExtensions.cs:22-74`). Every registration is `TryAdd`, so whatever the app registered first wins (`:52-57`).
- `BlokServerBuilder` has an internal constructor, so hooks hang off it only after `AddBlokServer` (`BlokServerBuilder.cs:9-21`).
- Hooks: `UseAuthorization<T>()`, `UseCollabOperationStore<T>()`, `UseLoopbackHostCheck()`, `UseCollabActivityObserver<T>()` (`BlokServerBuilderExtensions.cs:22-115`). Each is `RemoveAll` + `AddSingleton`.
- `app.MapBlokServer(prefix)` → returns a `RouteGroupBuilder`, so the app adds `.RequireAuthorization()` (`BlokServerEndpointRouteBuilderExtensions.cs:64-126`). Routes are mapped only for enabled features. Non-GET routes go through `BlokServerRequestGuard` (`:190-203`). It logs a warning when collab routes are open: `Auth = "none"` and no `IBlokAuthorization` (`:116-120`).
- `IBlokAuthorization.CanReadDocumentAsync / CanWriteDocumentAsync(ClaimsPrincipal, documentId)` (`IBlokAuthorization.cs:20-53`). It only narrows access. This is the natural C# form of Node's `authorize(principal, documentId, write)` hook (`src/mcp/options.ts:10`).
- `BlokServerOptions` holds `Auth`, `Secret`, `CollabEnabled`, `DocEndpoint`, `DocEndpointAuth`, `CollabJournal`, `RichTextFields` and more (`BlokServerOptions.cs:27-254`). `Validate()` is at `:287`.

Consumer code, as published in `packages/server/README.md:18-38`:

```csharp
// dotnet add package Blok.Server.AspNetCore
using Blok.Server.AspNetCore;

builder.Services.AddBlokServer(options =>
{
  options.StorageDirectory = "./blok-uploads";
  options.PublicUrl = "https://uploads.example.com/files";
  options.UnfurlDisabled = false;
});

var app = builder.Build();

app.MapBlokServer("/api/blok").RequireAuthorization();
app.Run();
```

With collab and an access hook (`packages/server/README.md:655-663`):

```csharp
builder.Services
  .AddBlokServer(options =>
  {
    options.CollabEnabled = true;
    options.DocEndpoint = "http://127.0.0.1:5080/internal/blok-docs";
    options.DocEndpointAuth = docEndpointSecret;
  })
  .UseAuthorization<PageRules>();
```

Getting the agent executor from DI, condensed from `Blok.Server.AspNetCore.Tests/BlokAgentExecutorRegistrationTests.cs:21-38` (the test wraps `GetService` in asserts and uses `Document`/`Actor` constants):

```csharp
var services = new ServiceCollection();
services.AddBlokDocuments(poolSize: 1, warmUp: false);
using var provider = services.BuildServiceProvider();
var executor = provider.GetRequiredService<IBlokAgentExecutor>();
var execution = await executor.ExecuteAsync(documentJson,
    """{"commands":[{"name":"doc.setTitle","args":{"title":"Server title"}}]}""", actor);
```

A matching MCP surface would be `AddBlokServer(...).AddBlokMcp(o => …)` or a builder hook, plus `app.MapBlokMcp("/mcp")` returning a `RouteGroupBuilder`. That is a suggestion, not something that exists.

The README has no section on the C# agent executor (no `IBlokAgentExecutor` / `OpenSession` hits in `packages/server/README.md`).

## 6. Packaging

- **Published to NuGet: yes, two packages.** `Blok.Server` and `Blok.Server.AspNetCore` have `IsPackable=true` and a `PackageId` (`Blok.Server.csproj:7,13`, `Blok.Server.AspNetCore.csproj:7,13`), Apache-2.0, `GenerateDocumentationFile=true`, and pack `packages/server/README.md` (both csproj files). Host and tests are `IsPackable=false`.
- `release-server.yml` (on `v*` tags) packs both csproj files by path (`.github/workflows/release-server.yml:140-155`). It pushes both to nuget.org (`:204-215`) and mirrors both to the dodopizza GitHub feed (`:217-230`). The version comes from `BLOK_SERVER_VERSION` (`:59`).
- A third package must be added by name in each of these places:
  - `.github/workflows/release-server.yml` (pack, push, mirror, and the check at `:393-410`)
  - `scripts/test-server-packages.mjs:68-75,233-267`
  - `scripts/verify-docs-release.mjs:17-20` (`SERVER_NUGET_PACKAGES`)
  - `test/unit/architecture/server-release-wiring.test.ts:360-361,380-381,442`
  - `test/unit/architecture/package-metadata-law.test.ts:164` (README install line)
- **Build settings:**
  - Target `net10.0` in every project.
  - `TreatWarningsAsErrors` is on in each csproj and in `dotnet/Directory.Build.props`.
  - `Directory.Build.props` also sets `AnalysisLevel latest-recommended`, `EnforceCodeStyleInBuild`, and `NuGetAudit` (mode `all`, level `low`) with NU1901–NU1904 as errors.
- **No central package versions:** there is no `Directory.Packages.props`. Versions sit in each csproj.
- **Third-party NuGet deps:**
  - `Blok.Server`:
    - `AngleSharp` 1.9.0
    - `BouncyCastle.Cryptography` 2.7.0, compile assets private
    - `Jint` 4.17.0, compile assets private
  - `Blok.Server.AspNetCore`: `FrameworkReference Microsoft.AspNetCore.App` only.
  - Tests:
    - `Microsoft.AspNetCore.TestHost` 10.0.14
    - `Microsoft.NET.Test.Sdk` 18.11.0
    - `xunit` 2.9.3
    - `xunit.runner.visualstudio` 4.0.1
- **No MCP SDK is referenced** (grep `Mcp`/`MCP` in `*.cs`: only two doc comments). Whether an official C# MCP SDK exists on NuGet, and at what version, is **unverified** (not checked this session). The same goes for whether JWT bearer validation ships in the shared framework.
- **Docs:**
  - `packages/server/README.md` (sections "ASP.NET Core", "Access passes", "Pages").
  - Docs site data `docs/src/components/server/server-data.ts:118-176` (`dotnet add package`, `AddBlokServer`). Locale strings that mention `AddBlokServer`: `docs/src/i18n/en.json:2904,3055`, `docs/src/i18n/ru.json:3646,3797` (en.json wins over the data module at the reader).
  - Maintainer guide `docs/maintainers/page-csharp-host.md`.

## 7. Gap table

"Outbound" means the feature needs a new owner under the outbound-client law (§2).

| Node MCP capability | C# today | Where / note | Outbound |
| --- | --- | --- | --- |
| `blok_execute` stored | exists | `IBlokAgentExecutor.ExecuteAsync`, `BlokAgentSession` | — |
| `blok_execute` live, same process | exists | `ExecuteInRoomAsync` | — |
| `blok_read` | partial | `doc.read` batch + unwrap `results[0]`; parity unverified | — |
| `blok_describe` `{tool,command}` | missing | `describeContract` in bundle, no op exposes it; full contract only | — |
| Tool-call parsing, arg refusal, error answers (`tool-call.ts`, `model-answer`) | missing | not in bundle (§1) | — |
| MCP tool schemas (`renderAgentTools`, lifecycle tools) | missing | not in bundle | — |
| Handles (`blok_open`/`blok_close`, idle expiry, per-principal cap) | missing | Node `src/mcp/handles.ts`; session must serialize calls | — |
| `blok_list_documents` | missing | no list in `DocEndpointClient` | yes |
| Server instructions (`mcpInstructions`) | missing | `SHARED_RULES` not in bundle; `contract.guidance.general` is | — |
| Prompts (Ask AI skills) | missing | `src/shared/skills.ts` not in bundle | — |
| Stored endpoint source | partial | `DocEndpointClient` (internal, room-only, no 409 mapping, no list) | yes (pinned owner exists) |
| Files source | missing | `LocalCollabStore` is not document JSON | — |
| Live room, same process | exists | `CollabRoomManager.AgentEditAsync` via executor | — |
| Live room, remote sync service over WS | missing | server side only; no client; `ClientWebSocket` forbidden | yes |
| Presence (agent awareness) | missing | no awareness in `Agent/`; `ICollabMember` internal | — |
| Version history | partial | room + journal only, in process; no HTTP client for a remote room | yes for remote |
| Undo/redo | exists | `BlokAgentSession` (stored), `RoomAgentHistory` (room) | — |
| Co-authoring (`createdBy`/`createdWith`) | exists | `JintAttributionTests.cs:51-52` | — |
| Sub-page create / rename | exists | `IBlokPageCreator`, `IBlokPageTarget` | — |
| Uploads (`<tool>.uploadFile`) | missing | no `uploader` service sent to Jint; `IBlobStore` is route-side only | — |
| Approval / elicitation (unlock) | missing | `agentExecute` has no `approve`; answers `APPROVAL_REQUIRED` | — |
| Tickets, secret mode | exists | `BlokTicket.Create` (public) | — |
| Tickets, URL mode | missing | — | yes |
| OAuth (JWT via issuer/audience/JWKS) | missing | ASP.NET auth could cover it; not checked | yes (JWKS) |
| Authorize hook | partial | `IBlokAuthorization` (ClaimsPrincipal, doc) fits; webhook form missing | yes for webhook |
| Custom tools / overrides / comments off | exists | `BlokAgentOptions.CustomToolsJson`, `OverridesJson`, `BuiltInComments` | — |
| stdio transport | missing | no stdio host | — |
| HTTP transport (Streamable HTTP) | missing | ASP.NET hosting pattern exists (§5) | — |

## 8. Constraints to decide before building

- **Three-backend rule.** CLAUDE.md says every backend feature in `packages/server` is written in Go, C# and Rust, with shared conformance fixtures (`CLAUDE.md:132`). Whether a C# MCP under `packages/server/` falls under that rule is a decision for the user.
- **Bundle is shared with Go.** New `invoke` ops (read, describe, tool-call parse) change the committed Go runtime bundle too (`scripts/build-server-runtime.mjs:72-82`).
- **Internal access.** Same-process presence, version history over HTTP, the ticket verifier and the endpoint client are all internal. Either add `InternalsVisibleTo("Blok.Server.Mcp")` or make public APIs (which would be new public surface on a published package).
- **Outbound law.** Every outbound call needs a pinned owner or a test change (§2).
