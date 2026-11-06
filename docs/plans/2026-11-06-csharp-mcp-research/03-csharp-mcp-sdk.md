# 03 — The official C# MCP SDK, measured against what Blok's Node MCP uses

> **Review corrections (2026-11-07, independent re-build on 2.3.1):**
> - "Byte for byte" schemas is WRONG in general. It holds only for plain ASCII without `' < > & + "` or `\/`. The default System.Text.Json encoder escapes those and all non-ASCII as `\uXXXX`, in schemas and in `Tool.Description`. Compare parsed JSON.
> - The 1.x line did not end: v1.4.2 shipped 2026-11-03 as a security patch.
> - 2024-10-07 is not rejected: C# answers 200 and offers 2025-11-25.
> - `InputRequiredException` for a 2025-era client on stateless HTTP gives JSON-RPC error -32603.
> - ASP.NET Core `AllowedHosts` can block a foreign Host (400). Origin still needs middleware.
> - With default settings, resource metadata is served at the root and at `/mcp`; only the 401 header points at `/mcp`.
> - The first `dnx` run of an unsigned local package prints a NuGet line to stdout before the JSON-RPC.

Date: 2026-11-06. Research only. No repo code changed.

How to read this:

- **[run]** I ran it in this session. Probe project and driver scripts are under the session scratchpad (`probe/Program.cs`, `drive_stdio.py`, `drive_http.py`). They were built against `ModelContextProtocol.AspNetCore` 2.3.1 on .NET SDK 10.0.400.
- **[xml]** It comes from the XML API docs shipped inside the 2.3.1 nupkgs (`lib/net10.0/*.xml`).
- **[doc]** It comes from a fetched page. The URL is given.
- **Unverified** means exactly that.

---

## 0. What Node actually relies on

Read from `src/mcp/sdk-server.ts`, `src/mcp/http.ts`, `src/mcp/auth/oauth.ts` and `src/mcp/index.ts`. The SDK is `@modelcontextprotocol/server` 2.4.0, from `node_modules/@modelcontextprotocol/server/package.json`. Apache-2.0.

**Protocol versions** (from SDK dist):

- Legacy `initialize` list: `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`, `2024-10-07` (`core/dist/schemas-*.mjs`).
- Modern list: `2026-07-28` only (`server/dist/src-DdvbAHrR.mjs:567-574`).

**Features Blok uses:**

1. **Low-level handlers, not reflected tools.**
   - `server.setRequestHandler('tools/list' | 'tools/call' | 'prompts/list' | 'prompts/get')`.
   - `tools/list` returns Blok's own JSON schemas by reference. The SDK checks only that the root is `type: object`.
2. **Server instructions.** `new McpServer(..., { instructions })`.
3. **Elicitation through multi-round-trip requests (MRTR, SEP-2322).**
   - `tools/call` *returns* `inputRequired({ inputRequests: { [key]: inputRequired.elicit({...}) } })`, with no `requestState`.
   - On the retry it reads `ctx.mcpReq.inputResponses` through `inputResponse(...)`.
   - It asks only when the client declared form elicitation (`canElicit`).
   - Under 2025-era stdio, the SDK's "legacy shim" turns this into a real `elicitation/create` and re-runs the handler (`mcp-BCJHyo7l.d.mts:2866-2870`).
4. **Per-request client identity (2026-07-28).**
   - Reads `_meta["io.modelcontextprotocol/clientInfo"]` and `.../clientCapabilities` from the request envelope.
   - Falls back to the `initialize` values for 2025-era clients.
5. **stdio.** `serveStdio(factory)`. All `console.log/info/debug` go to stderr (`src/mcp/stdout-guard.ts`).
6. **Streamable HTTP, stateless, one fresh server per request.**
   - `createMcpHandler(factory)`. Its default `legacy: 'stateless'` serves 2025-era clients per request and answers GET/DELETE with 405 (`createMcpHandler-*.d.mts:258-263`).
   - Blok wraps this in its own `node:http` server and adds:
     - an Origin allow-list (loopback only);
     - a Host check against DNS rebinding;
     - a 4 MiB body cap;
     - 404 for any other path.
7. **OAuth resource server.**
   - `requireBearerAuth({ verifier, requiredScopes: ['blok.read'], expectedResource, resourceMetadataUrl })`.
   - Blok hand-serves `GET /.well-known/oauth-protected-resource` at the **root**, with `resource`, `authorization_servers`, `scopes_supported: [blok.read, blok.write]` and `bearer_methods_supported: [header]`.
   - The JWT verifier is Blok's own (`auth/oauth.ts`):
     - RS256/ES256 only, with the key type matched to `alg`;
     - `typ` must be `at+jwt`;
     - any `crit` header rejects;
     - JWKS cache with TTL, miss cooldown and 10 s fetch timeout;
     - `iss`, `aud`, `exp` and `nbf` are checked;
     - scopes come from `scope` or `scp`;
     - `client:` subjects are reserved.
8. **Result shaping.** `server.projectCallToolResult(result, tool.outputSchema)`.

---

## 1. Current state of the C# SDK

| Item | Value | Evidence |
|---|---|---|
| Latest stable | **2.3.1** (all three packages) | [run] `https://api.nuget.org/v3-flatcontainer/modelcontextprotocol/index.json`, and the same for `.core` and `.aspnetcore` |
| Published | NuGet: 2026-11-03T07:46Z. GitHub release: 2026-11-03T07:33:49Z | [run] NuGet registration API; `gh api repos/modelcontextprotocol/csharp-sdk/releases/tags/v2.3.1` |
| 2.3.1 notes | "This patch release includes a security fix for authenticated stateful sessions." | [doc] https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.3.1 |
| 2.x history | 2.0.0 on 2026-07-28, 2.1.0 on 08-05, 2.2.0 on 08-13, 2.3.0 on 10-20, 2.3.1 on 11-03. The 1.x line ended at 1.4.2 | [run] NuGet registration API and version index |
| Target frameworks | `ModelContextProtocol` and `.Core`: netstandard2.0, net8.0, net9.0, net10.0. `.AspNetCore`: net8.0, net9.0, net10.0 | [run] the 2.3.1 `.nuspec` files |
| Protocol versions | `2024-11-05`, `2025-03-26`, `2025-06-18`, `2025-11-25`, `2026-07-28` | [xml] `McpServerOptions.ProtocolVersion`. [run] strings in `ModelContextProtocol.Core.dll` |
| License | Apache-2.0 on NuGet. The repo's LICENSE says it is moving from MIT to Apache-2.0, and some older contributions stay MIT | [run] nuspec `<license>`; `gh api .../contents/LICENSE` |
| Packages | `ModelContextProtocol.Core` (client and low-level server), `ModelContextProtocol` (hosting and DI), `ModelContextProtocol.AspNetCore` (HTTP), plus Extensions.Apps, .Skills and .Tasks | [doc] https://raw.githubusercontent.com/modelcontextprotocol/csharp-sdk/main/README.md |

The 2.0.0 notes say: "brings the C# SDK into stable alignment with the MCP 2026-07-28 specification … discovery-first negotiation, multi-round-trip requests, stateless-by-default HTTP … with down-level interoperability for peers negotiating 2025-11-25 and earlier." 2.0.0 also deprecated the Roots, Sampling and Logging APIs, which now raise warning MCP9005. Source: `gh api repos/modelcontextprotocol/csharp-sdk/releases/tags/v2.0.0`.

**Version window.** Node 2.4.0 and C# 2.3.1 cover the same window: every 2025-era revision plus 2026-07-28. The one difference is that Node's legacy list also has `2024-10-07`.

---

## 2. The C# API for each feature Blok uses

Every snippet below was compiled and run in the probe ([run]) unless it says otherwise.

### 2.1 Tools with exact raw JSON schema

`Tool.InputSchema` is a `JsonElement`. The setter rejects a root that is not `type: object` ([xml] `P:...Protocol.Tool.InputSchema`), the same rule Node enforces. The official tools doc builds a `Tool` this way: [doc] https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/tools/tools.md (`InputSchema = JsonDocument.Parse("""...""").RootElement.Clone()`).

```csharp
var tool = new Tool { Name = "blok_execute", Description = "...",
    InputSchema = JsonDocument.Parse(schemaJson).RootElement.Clone() };

builder.Services.AddMcpServer(o => { o.ServerInfo = new() { Name = "blok-mcp", Version = v }; o.ServerInstructions = primer; })
    .WithListToolsHandler((ctx, ct) => ValueTask.FromResult(new ListToolsResult { Tools = [tool] }))
    .WithCallToolHandler((ctx, ct) => /* dispatch ctx.Params.Name / ctx.Params.Arguments */);
```

**[run] Byte check.** The schema came back from `tools/list` byte for byte. This held on 2025-11-25, 2025-06-18 and 2026-07-28, including `default`, `additionalProperties` and key order.

**Handler scope.** `CallToolHandler` runs for tools that are not in the reflected `McpServerTool` collection ([xml] `McpServerHandlers.CallToolHandler`). With no reflected tools, it gets every call.

**Cancellation.** It arrives as the handler's `CancellationToken` ([xml] `McpRequestHandler\`2`).

### 2.2 Prompts

`.WithListPromptsHandler(...)` and `.WithGetPromptHandler(...)` take `ListPromptsResult { Prompts = [new Prompt { Name, Description, Arguments = [new PromptArgument {...}] }] }` and `GetPromptResult { Messages = [...] }`. [run] Both answered correctly on all three versions.

### 2.3 Server instructions

`McpServerOptions.ServerInstructions` ([xml]). [run] It appeared as `instructions` in the `initialize` result (2025-era) and in the `server/discover` result (2026-07-28).

### 2.4 Elicitation from a tool call (MRTR)

The official MRTR doc is [doc] https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/mrtr/mrtr.md. In C# the handler **throws** `InputRequiredException`, where Node *returns* `inputRequired(...)`. The wire result is the same.

```csharp
var responses = ctx.Params?.InputResponses;            // filled on the retry
if (responses is not null && responses.TryGetValue("approve", out var r)) {
    var er = r.Deserialize(InputResponse.ElicitResultJsonTypeInfo);
    var ok = er?.Action == "accept" && er.Content is { } c
             && c.TryGetValue("unlock", out var v) && v.ValueKind == JsonValueKind.True;
    ...
}
if (ctx.Server.IsMrtrSupported)
    throw new InputRequiredException(new Dictionary<string, InputRequest> {
        ["approve"] = InputRequest.ForElicitation(new ElicitRequestParams {
            Message = "...",
            RequestedSchema = new() {
                Properties = new Dictionary<string, ElicitRequestParams.PrimitiveSchemaDefinition> {
                    ["unlock"] = new ElicitRequestParams.BooleanSchema { Title = "Unlock", Description = "...", Default = false } },
                Required = ["unlock"] } }) },
        null);   // requestState: Blok does not need one
```

**[run] What happened, per transport and version:**

| Client | Transport | What the C# SDK did |
|---|---|---|
| 2026-07-28 | stdio | Returned `{"resultType":"input_required","inputRequests":{"approve":{"method":"elicitation/create",...}}}`. The retry carried `inputResponses` and **no `requestState`**. The handler saw `responses=1` and finished. |
| 2025-11-25 | stdio | Sent a real `elicitation/create` to the client. Re-ran the handler with `InputResponses` filled. Returned the final result. This is the backward-compatibility resolver, Node's "legacy shim" counterpart. |
| 2025-06-18 | stdio | Same as 2025-11-25. |
| 2026-07-28 | stateless HTTP | Same as 2026-07-28 stdio. |
| 2025-11-25 | stateless HTTP | Request-scoped `ClientCapabilities.Elicitation` was **null** and `IsMrtrSupported` was **false**, so the probe's gate skipped the question. |

The last row matches Node: there `canElicit` is false, and the shim would refuse anyway (`src-DdvbAHrR.mjs:699`, "per-request legacy serving cannot receive server-to-client requests"). The doc's compatibility table says that throwing anyway in this case "raises an `McpException`" ([doc] mrtr.md, "Compatibility").

**Throwing from the low-level handler.** Throwing `InputRequiredException` from a low-level `WithCallToolHandler` works ([run]). It does not need to be an `[McpServerTool]` method. To *return* an `InputRequiredResult` instead of throwing, `McpServerHandlers.CallToolWithAlternateHandler` exists ([xml]). It was not tested, and throwing is enough.

**Do not use `await server.ElicitAsync(...)` in the port.** The doc says it throws `InvalidOperationException("... is not supported in stateless mode.")` on every stateless session. It works only on stateful sessions, stdio included ([doc] mrtr.md). Use only the explicit `InputRequiredException` path.

**Unverified wording.** `IsMrtrSupported` doc text says the 2025 resolver needs "a stateful session using protocol revision 2025-11-25". The table says "2025-11-25 and earlier". [run] 2025-06-18 over stdio also worked.

### 2.5 Per-request client identity

`ctx.Server.ClientInfo` and `ctx.Server.ClientCapabilities` on the **request-scoped** server ([xml] `McpServer.ClientInfo`, `McpServer.ClientCapabilities`). On 2026-07-28 they come from `_meta`, and on 2025-era from `initialize`. [run] They returned `client=probe` for 2026-07-28 over HTTP and stdio, and for 2025-era over stdio.

**[run] Gap.** On stateless HTTP with a 2025-era client, `ClientInfo` was null in `tools/call`. Each request is a fresh server, so the `initialize` identity is gone. The port must fall back to a default name. Node's behaviour in the same case is not measured.

### 2.6 stdio transport and stderr logging

From the official template (`dotnet new mcpserver`, template package `Microsoft.McpServer.ProjectTemplates` 1.2.1, [run] generated `Program.cs`):

```csharp
var builder = Host.CreateApplicationBuilder(args);
// Configure all logs to go to stderr (stdout is used for the MCP protocol messages).
builder.Logging.AddConsole(o => o.LogToStandardErrorThreshold = LogLevel.Trace);
builder.Services.AddMcpServer().WithStdioServerTransport().WithTools<RandomNumberTools>();
await builder.Build().RunAsync();
```

`WithStdioServerTransport` runs "a single-session service that exits when the stdin stream is closed" ([xml]). [run] The process exited cleanly when stdin closed.

**Unverified.** Whether a stray `Console.Out` write corrupts the stream was not tested. Node needs `installStdoutGuard`, so the port should keep a rule of no `Console.Write*` to stdout, or redirect `Console.SetOut(Console.Error)`.

### 2.7 Streamable HTTP: `WithHttpTransport` and `MapMcp`, stateless vs session

```csharp
builder.Services.AddMcpServer(...).WithHttpTransport(o => o.SessionMode = HttpServerSessionMode.Stateless);
app.MapMcp("/mcp");
```

There are three session modes ([xml] `HttpServerSessionMode`):

- **`Stateless`.** The default since 2.0.0. No `Mcp-Session-Id`. GET/DELETE and `/sse` are unavailable. "Client sampling, elicitation, and roots capabilities are disabled … use MRTR instead."
- **`Stateful`.** Refuses 2026-07-28 with `-32022`.
- **`StatefulForInitializeClients`.** A hybrid. Sessions for `initialize` clients, stateless serving for 2026-07-28.

**Recommendation.** Blok's Node server is per-request stateless, so `Stateless` is the match.

**[run]** In stateless mode, a 2025-11-25 `initialize` and `tools/call` worked with no session id. 2026-07-28 calls worked with the `Mcp-Method` and `Mcp-Name` headers.

**Per-request options.** `HttpServerTransportOptions.ConfigureSessionOptions` runs once per request in stateless mode, with the `HttpContext` ([xml]). That is the hook for building per-caller options, the counterpart of Node's per-request `buildSdkServer` factory.

### 2.8 OAuth protected-resource metadata and bearer auth

The SDK supplies the **challenge and metadata half**: `AddAuthentication().AddJwtBearer(...).AddMcp(o => o.ResourceMetadata = ...)`, plus `MapMcp().RequireAuthorization()`. Official sample: [doc] https://github.com/modelcontextprotocol/csharp-sdk/blob/main/samples/ProtectedMcpServer/Program.cs (`DefaultChallengeScheme = McpAuthenticationDefaults.AuthenticationScheme`, `.AddMcp(options => options.ResourceMetadata = new() { AuthorizationServers = {...}, ScopesSupported = [...] })`).

Token validation is ASP.NET Core's `JwtBearer`, not the MCP SDK.

**Path difference.** `ResourceMetadataUri` defaults to `/.well-known/oauth-protected-resource/<resource-path>` ([xml]). Node serves it at the root. To match Node ([run]):

```csharp
.AddMcp(o => {
    o.ResourceMetadataUri = new Uri("/.well-known/oauth-protected-resource", UriKind.Relative);
    o.ResourceMetadata = new() { Resource = audience, AuthorizationServers = { issuer },
        ScopesSupported = ["blok.read", "blok.write"], BearerMethodsSupported = ["header"] };
});
builder.Services.AddAuthorization(o => o.AddPolicy("blok.read", p => p.RequireClaim("scope", "blok.read")));
app.MapMcp("/mcp").RequireAuthorization("blok.read");
```

**[run] Result:**

- An unauthenticated POST got `401` with `WWW-Authenticate: Bearer resource_metadata="http://127.0.0.1:5199/.well-known/oauth-protected-resource"`.
- The root metadata path returned the same four fields as Node. Only the JSON key order differed: `bearer_methods_supported` came before `scopes_supported`.
- `/.well-known/oauth-protected-resource/mcp` returned 404.

**Unverified.** The `RequireClaim("scope", "blok.read")` line compiles. A space-separated `scope` claim may need custom splitting. No signed-token test was run.

---

## 3. Gaps vs what Blok uses in Node 2.4.0

None of these blocks the port. All are work the port must do by hand.

1. **The JWT verifier rules are Blok's own in both stacks.** The SDK does not provide them. Rebuild them on `JwtBearer` `TokenValidationParameters` plus `OnTokenValidated` or a custom handler:
   - `ValidTypes = ["at+jwt", "application/at+jwt"]`, `ValidAlgorithms = [RS256, ES256]`;
   - reject `crit`;
   - reserve `client:` subjects;
   - read scopes from `scope` or `scp`;
   - map the principal (`sub`, else `client:<client_id|azp>`);
   - match Node's JWKS TTL, miss cooldown and 10 s timeout through `ConfigurationManager` settings.

   Whether JwtBearer's defaults match each Node rule is **unverified**. Each rule needs a conformance fixture.
2. **No Origin or Host (DNS-rebinding) check in the SDK.** [run] A POST with `Origin: http://evil.example`, and one with `Host: evil.example:5199`, were both served (200). Node hand-writes both checks. The port needs middleware ahead of `MapMcp`.
3. **Body cap.** Node caps bodies at 4 MiB and returns 413. Set Kestrel's `MaxRequestBodySize` explicitly. Its default was not measured here.
4. **Other paths.** Node returns 404 for any path other than `/mcp` and the metadata path. ASP.NET does that by default when nothing else is mapped. Not measured.
5. **`projectCallToolResult`.** No C# counterpart turned up in the 2.3.1 XML docs (searched `OutputSchema`). Blok must project `structuredContent` against `outputSchema` itself. [run] `CallToolResult.StructuredContent` passed through as given.
6. **`throw` instead of `return`.** C# signals input-required by throwing `InputRequiredException`. Node returns it. This changes code shape, not the wire.
7. **Extra `logging` capability.** [run] On 2025-era `initialize`, C# advertises `"capabilities":{"logging":{},"prompts":{},"tools":{}}`. Node registers only `tools` and `prompts`. On 2026-07-28 `server/discover`, C# sent only `prompts` and `tools`. Whether `logging` can be turned off was not checked. It matters only if conformance fixtures compare capabilities exactly.
8. **Client name on stateless legacy HTTP is null** (see 2.5).
9. **`2024-10-07`.** Node accepts it in `initialize` and C# does not. That revision predates the public spec, so the risk is low.
10. **2026-07-28 response `_meta` and cache hints.** [run] C# adds `"ttlMs":0,"cacheScope":"private"` on list results and `_meta["io.modelcontextprotocol/serverInfo"]`. Node also emits `ttlMs: 0` and `cacheScope: 'private'` by default (`mcp-*.d.mts:2860-2863`). Byte parity of the whole envelope was not compared.

There was no gap in: raw schemas, prompts, instructions, MRTR elicitation (2026 and 2025 stdio), stateless HTTP, per-request client info on 2026, or bearer challenge with metadata.

---

## 4. Packaging

### 4.1 As a `dotnet tool` / `dnx` MCP server: there is an official convention

- **Package type.** `<PackAsTool>true</PackAsTool>` plus `<PackageType>McpServer</PackageType>`. The nupkg then has two package types, `DotnetTool` and `McpServer`. [run] Packed the template and read the `.nuspec`. [doc] https://learn.microsoft.com/en-us/nuget/concepts/nuget-mcp
- **`.mcp/server.json`.** Embedded in the package at `/.mcp/server.json`. The template does it with `<None Include=".mcp\server.json" Pack="true" PackagePath="/.mcp/" />` ([run]).
  - Schema: `https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json`, with `registryType: "nuget"` and `transport: { type: "stdio" }`.
  - "The only information used by NuGet.org in the `server.json` is the first `packages` array item with the `registryType` value matching `nuget`." [doc] https://learn.microsoft.com/en-us/dotnet/ai/quickstarts/build-mcp-server
- **Running it.** Users run `dnx <PackageId>@<version> --yes`. `dnx` ships with the .NET 10 SDK. NuGet.org lists these packages at `nuget.org/packages?packagetype=mcpserver` and shows a ready `mcp.json` snippet (both from the quickstart page above).
- **Scope.** NuGet-hosted MCP servers are framed as **local, stdio** servers ([doc] nuget-mcp page, "Applicable scenarios").
- **Template defaults.** Self-contained and single-file, with RIDs `win-x64; win-arm64; osx-arm64; linux-x64; linux-arm64; linux-musl-x64`. `dotnet pack` makes one tool package plus one package per RID ([run], 7 nupkgs).
  - The template pins `ModelContextProtocol` **1.2.0**. The port must bump it to 2.3.1.
  - The `remote` (http) variant of the template does not set `PackAsTool`.
- **[run] One tool doing both stdio and `--http`.** This works. I packed the probe (Web SDK, ASP.NET Core inside) with `-p:IsPackable=true -p:PackAsTool=true -p:PackageType=McpServer`. Then:
  - `dotnet tool install --tool-path` worked;
  - a run through `dnx Probe.Mcp@0.0.1 --add-source <feed> --yes stdio` completed discover, `tools/list` and the MRTR call.
- **Two catches with the Web SDK:**
  - Packing is off by default, so `IsPackable=true` is required.
  - The framework-dependent `runtimeconfig.json` needs `Microsoft.AspNetCore.App` 10.0.0 on the user's machine. A self-contained build avoids that. Whether `dnx` users always have the ASP.NET shared runtime is **unverified**.

csproj sketch for `Blok.Mcp`, based on the template:

```xml
<PackAsTool>true</PackAsTool>
<PackageType>McpServer</PackageType>
<ToolCommandName>blok-mcp</ToolCommandName>
<SelfContained>true</SelfContained><PublishSelfContained>true</PublishSelfContained>
<RuntimeIdentifiers>win-x64;win-arm64;osx-arm64;linux-x64;linux-arm64;linux-musl-x64</RuntimeIdentifiers>
<ItemGroup><None Include=".mcp\server.json" Pack="true" PackagePath="/.mcp/" /></ItemGroup>
```

### 4.2 As a library inside a consumer's ASP.NET Core app

The shape is the SDK's own (sample above, [xml] `MapMcp(IEndpointRouteBuilder, string)`):

```csharp
builder.Services.AddMcpServer(o => { ... }).WithHttpTransport(o => o.SessionMode = HttpServerSessionMode.Stateless).AddBlokMcp(...);
app.MapMcp("/mcp").RequireAuthorization("blok.read");
```

- A Blok library would ship an `IMcpServerBuilder` extension, a name like `AddBlokMcp` (hypothetical), that calls `WithListToolsHandler`, `WithCallToolHandler`, `WithListPromptsHandler` and `WithGetPromptHandler`.
- The consumer keeps control of auth, CORS and the route.
- It should target net8.0, net9.0 and net10.0 like `ModelContextProtocol.AspNetCore`.
- **Unverified.** Whether `With*Handler` composes cleanly when the host app registers its own handlers too. The handler properties are single-valued, so a second registration presumably replaces the first. Not tested.

---

## 5. The other route: run the Node MCP as a sidecar from C#

A C# host can launch `npx @bloklabs/mcp` (`bin: blok-mcp`, `packages/mcp/package.json`) and either proxy stdio or point clients at its `--http` URL.

- **Gains.** No port and no drift. It keeps Blok's verifier and checks.
- **Costs.** Node on every host. Two processes to supervise. No in-process DI or `HttpContext` identity, so identity has to cross the process boundary.

The C# SDK's client (`McpClient`, with `StdioClientTransportOptions` in 2.0.0's notes) could drive it. Not tested here. This is listed only for comparison.

---

## Sources

- NuGet: `api.nuget.org/v3-flatcontainer/{modelcontextprotocol,modelcontextprotocol.core,modelcontextprotocol.aspnetcore}/index.json`, the 2.3.1 `.nuspec` and `.nupkg` files, `api.nuget.org/v3/registration5-gz-semver2/.../2.3.1.json`
- GitHub: `gh api repos/modelcontextprotocol/csharp-sdk/releases/tags/{v2.0.0,v2.3.0,v2.3.1}`; repo `LICENSE`; `samples/ProtectedMcpServer/Program.cs`; `docs/concepts/{mrtr,tools,stateless,transports,elicitation,prompts,logging}/*.md`
- https://learn.microsoft.com/en-us/nuget/concepts/nuget-mcp (updated 2026-02-02)
- https://learn.microsoft.com/en-us/dotnet/ai/quickstarts/build-mcp-server (updated 2026-07-27)
- Template `Microsoft.McpServer.ProjectTemplates` 1.2.1 (`dotnet new mcpserver`), generated and packed locally
- Node: `node_modules/@modelcontextprotocol/{server,core}` 2.4.0 dist files cited inline
