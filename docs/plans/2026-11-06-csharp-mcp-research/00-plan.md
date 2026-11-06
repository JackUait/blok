# C# MCP server: research summary and plan

Goal: a C# MCP server that behaves like `@bloklabs/mcp` (Node, `src/mcp`), and that a .NET team can add to their own ASP.NET Core app.

Detail files in this folder:

- `01-node-mcp-spec.md` is the full behaviour spec of the Node server, with file:line citations.
- `02-csharp-reuse-map.md` covers what `packages/server/dotnet` already has, with a gap table in §7.
- `03-csharp-mcp-sdk.md` covers the official C# MCP SDK. A throwaway server was built and called over stdio and HTTP.
- `04-parity-tests-and-release.md` covers how to prove parity, CI fit and the release path.

Everything below comes from those files. Claims they mark "unverified" stay unverified here.

## 1. What we found

**The engine is already in C#.**

- The Node MCP shell is 4,078 lines across 35 files.
- The editing engine it calls is about 65k lines, shared with Ask AI.
- The C# server already runs that engine in Jint (`BlokAgentExecutor`, `BlokAgentSession`), for stored documents and for live rooms in the same process (`ExecuteInRoomAsync`).
- Undo/redo, co-authoring (`createdBy`/`createdWith`) and sub-page creation already exist in C#.

**The official C# SDK covers the protocol.**

- `ModelContextProtocol` and `ModelContextProtocol.AspNetCore` 2.3.1 were published 2026-11-03. They target net8–net10 and are licensed Apache-2.0.
- They support the same protocol versions as Node's `@modelcontextprotocol/server` 2.4.0, including 2026-07-28. The only exception is the old 2024-10-07, which Node alone accepts.
- These were measured on a test server, not just read in the docs:
  - Raw JSON tool schemas come back byte for byte.
  - Prompts and instructions work.
  - The 2026 "input required" approval flow works, and so does the fallback to `elicitation/create` on 2025-era stdio clients.
  - Stateless HTTP works.
  - A 401 points at protected-resource metadata.
- Not covered by the SDK, so we build it:
  - Blok's own JWT rules: `typ at+jwt` and the `sub`/`client:` rules.
  - Origin and Host checks. A foreign Origin and a foreign Host both got 200.
  - The 4 MiB body cap.
  - Output-schema projection.
- Avoid `ElicitAsync`, because it throws on stateless servers.

**These are missing in C#** (full table: `02` §7):

- **`blok_read`** is partial.
- **`blok_describe`** for one tool or command is missing.
- **Tool-call parsing and error answers** (`src/shared/agent/tool-call.ts`) are missing.
- **The MCP shell** is missing: tool schemas, instructions and prompts (Ask AI skills). None of it is in the Jint bundle.
- **Handles** are missing: open, close, idle expiry and the per-principal cap.
- **Sources** are missing: the files source, and the endpoint source's list route and 409 handling. The existing endpoint client is internal and room-only.
- **Joining a remote sync service over WebSocket** is missing. C# has only the server side.
- **Presence** is missing.
- **Ticket URL mode** is missing. Secret mode exists through `BlokTicket.Create`.
- **OAuth** is missing.
- **The webhook form of the authorize hook** is missing.
- **Approvals (unlock, restore, share)** are missing. Jint cannot wait on the host, so today they answer `APPROVAL_REQUIRED`.
- **Uploads** are missing.
- **The stdio host** is missing.

**Hard constraints in the repo:**

- **The runtime bundle is shared by all three backends.** `scripts/build-server-runtime.mjs` writes it for C# and for Go (`packages/server/go/internal/jsruntime`). Rust embeds Go's copy (`packages/server/rust/crates/jsruntime/src/runtime.rs:8`). Adding operations means rebuilding and committing it, which touches Go and Rust no matter where the C# MCP lives.
- **Outbound calls are restricted.** An architecture test forbids `HttpClient` and `ClientWebSocket` outside three pinned owners. Every outbound call the MCP makes needs a pinned owner: endpoint, ticket URL, webhook, JWKS, history and the WebSocket.
- **Most reusable C# pieces are `internal`.** This covers the room manager, room member, wire codec, ticket verifier and endpoint client.

## 2. Recommended shape

Two new projects under `packages/server/dotnet/`, both on the official SDK 2.3.1.

**`Blok.Server.Mcp` (library, NuGet).** This is the "add it to my C# project" piece. It follows the pattern `Blok.Server.AspNetCore` already uses:

```csharp
builder.Services.AddBlokServer(...);          // existing
builder.Services.AddBlokMcp(o => {            // new
    o.Source = BlokMcpSource.Endpoint(new Uri("https://host/docs"));
});
app.MapBlokMcp("/mcp").RequireAuthorization(); // new, wraps the SDK's MapMcp
```

- When the app also hosts Blok collab, live handles join rooms in process through `ExecuteInRoomAsync`. No WebSocket, no ticket. This is the cheapest live mode, and it is the natural one for a C# host.
- Authorization reuses `IBlokAuthorization`.

**`Blok.Mcp` (dotnet tool, NuGet).**

- It is a thin host over `Blok.Server.Mcp`, adding only the CLI parser, stdio and the webhook authorize hook. The shell is built once, in the library.
- This is the copy of `blok-mcp`: the same flags, environment variables, stdio by default, and `--http`.
- It is packed with `PackAsTool` and `PackageType=McpServer`, with `.mcp/server.json`, so users run `dnx Blok.Mcp --source files:./docs`. The SDK agent installed and ran a test tool this way.

**Keep text and schemas single-source.** Do not retype the tool schemas, instructions, prompt text, describe output or tool-call errors in C#. Add them to the Jint runtime bundle as new operations, and have C# call them:

- `mcpTools`
- `mcpInstructions`
- `skills`
- `parseToolCall`
- `read`
- `describe`

This follows the repo's "hand-transcription drifts — generate instead" rule, and it gives byte parity for free.

The C# code then owns only what is truly host-side: transports, handles, sources, auth, tickets, errors and shutdown.

**Error flags.** `retryable` depends on which helper built the error, not only on its code (`01` fact 4). Port the helpers one to one. Do not use one table keyed by code.

## 3. Milestones

Each milestone ships green, with tests written first.

1. **Parity harness first.** Add `scripts/test-mcp-conformance.mjs --target node|csharp` (design in `04` §1).
   - It spawns the binary and talks MCP over stdio and HTTP with the client library already in devDependencies.
   - It reuses `checkMcpCase` and the agent parity corpus.
   - It needs a fix for the agent id. Goldens say `agent-test`, but a spawned binary says `agent:<principal>:<client>`. Fix it with a conformance-only flag or a remap in `normalize.ts`.
   - Node passes first, and that becomes the oracle.
2. **Bundle operations.** Add `read`, `describe`, `parseToolCall`, tool schemas, instructions and skills to `server-runtime.ts`, then rebuild the bundle. C#, Go and Rust all load it, so run all three conformance targets.
3. **Stored mode, library first.** Build `Blok.Server.Mcp` with the following, then the `Blok.Mcp` tool as a stdio host over it:
   - the files and endpoint sources;
   - all six tools, the prompts and the instructions;
   - handles, the CLI parser and `checkOptionSafety`, in the same validation order (`01` §3);
   - the files source with exact bytes: `JSON.stringify(doc,null,2)+"\n"`, a SHA-256 version, lowercase lock keys and UTF-16 sort order.
4. **HTTP and auth:**
   - Stateless `/mcp`, with GET and DELETE answering 405.
   - Origin and Host checks, and the 4 MiB cap.
   - OAuth on `JwtBearer` plus Blok's rules, and protected-resource metadata at the root path.
   - The authorize hook: `IBlokAuthorization` for the library, and the webhook for the tool.
   - Tickets in secret and URL mode.
5. **In-process live rooms.** When the app hosts Blok collab, live handles go through `ExecuteInRoomAsync`, with presence and version history in process.
6. **Approvals and uploads.** Jint never has to wait on the host. The first run answers `APPROVAL_REQUIRED`. C# throws the SDK's `InputRequiredException`. The client retries with the answer, and Jint runs a second time with an `approve` input. Agent 3 measured this retry flow on SDK 2.3.1. Uploads need an uploader service handed to Jint.
7. **Remote live mode.** The tool joins a remote sync service over `ClientWebSocket`, with a ticket and an Origin header. This is the largest new piece: a client side for the sync and awareness wire, plus a new pinned outbound owner. Live conformance needs a real room, such as the built C# host.
8. **Release.**
   - Pack and push both packages in `release-server.yml`.
   - Update `verify-docs-release.mjs`, `test-server-packages.mjs` and the release wiring tests.
   - Add docs pages in both locales.
   - CI: the Server job already runs 516 s, over the 7-minute budget. Put MCP conformance next to Validate Spec Coverage (142 s), or in a new job (20-job cap), and update `ci-critical-path-law.test.ts`.

## 4. Decisions for the user

1. **Does the three-backend rule apply?** CLAUDE.md requires Go, C# and Rust for backend features in `packages/server`. The MCP today lives in `src/mcp` and is a client of the servers (`04` §7). Putting the C# MCP under `packages/server/dotnet` may pull Go and Rust MCPs into scope. Milestone 2 changes the shared bundle either way, so Go and Rust conformance must pass regardless.
2. **Remote live mode in v1?** In-process live (milestone 5) is cheap. Remote live (milestone 7) needs a new sync client in C#. Shipping v1 without it means the dotnet tool can only do stored documents, plus live rooms when it runs inside a Blok C# host.
3. **Internal or public API?** Reuse room, ticket and endpoint internals through `InternalsVisibleTo("Blok.Server.Mcp")`, or make them public, which is new published surface.
4. **Package names.** The plan assumes `Blok.Server.Mcp` (library) and `Blok.Mcp` (tool).

## 5. Still unverified

- Whether `blok_read` through `doc.read` matches Node's `session.read` exactly.
- Whether the Jint runtime works under ahead-of-time compilation, if a self-contained tool is wanted.
- Whether a stray stdout write corrupts C# stdio framing.
- Whether `JwtBearer` defaults match each Blok token rule.
- Whether an `unavailableCommands` reason of `host` can actually occur. Node's output schema allows only `runtime` and `service`, so this may be a Node bug (`01` fact 9).
