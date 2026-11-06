# Adversarial check of 03-csharp-mcp-sdk.md

Date: 2026-11-07. My own build, independent of the earlier probe.

- Server: `verify-sdk/srv/Program.cs`. It uses `ModelContextProtocol.AspNetCore` 2.3.1 and `Microsoft.AspNetCore.Authentication.JwtBearer` 10.0.0, built on .NET SDK 10.0.400.
- Drivers:
  - `verify-sdk/drive.mjs` uses the repo's `@modelcontextprotocol/client` 2.4.0 over stdio and HTTP. It runs in two modes, legacy and modern (pin `2026-07-28`). It logs the wire.
  - `verify-sdk/stdio_raw.py` writes raw JSON-RPC to stdio for 2025-06-18, 2025-11-25 and 2026-07-28.
  - curl handles the HTTP edge cases.
- Outputs: `verify-sdk/out-*.txt`.
- All paths are under `/private/tmp/claude-501/-Users-jackuait-Packages-blok/127fe423-fcdf-4069-b172-fc3dabc89038/scratchpad/`.

## 1. Versions, dates, TFMs, license: CONFIRMED (one nit)

- The flat-container index puts **2.3.1** last for all three packages.
- Registration `published` times:
  - `ModelContextProtocol` 2026-11-03T07:46:51Z
  - `.Core` 07:46:52Z
  - `.AspNetCore` 07:46:51Z
- GitHub release v2.3.1 was published at 2026-11-03T07:33:49Z. Its notes give the "security fix for authenticated stateful sessions" text.
- History matches the report: 2.0.0 on 07-28, 2.1.0 on 08-05, 2.2.0 on 08-13, 2.3.0 on 10-20.
- Target frameworks, from the 2.3.1 nuspec dependency groups:
  - `ModelContextProtocol` and `.Core`: net8.0, net9.0, net10.0 and .NETStandard2.0.
  - `.AspNetCore`: net8.0, net9.0 and net10.0.
- License: the nuspec has `<license type="expression">Apache-2.0`. The repo LICENSE text describes the MIT to Apache-2.0 transition, as the report says.
- **Nit (PARTLY).** The report says "the 1.x line ended at 1.4.2". The GitHub release v1.4.2 was published at 2026-11-03T07:33:13Z, the same day as 2.3.1, and NuGet shows it at 07:45:21Z. Its notes read "security fixes for OAuth authentication and authenticated HTTP sessions". So 1.4.2 is a same-day security patch on the 1.x line. "Ended" is not supported. Whether more 1.x releases will follow is unknown.

## 2. Protocol versions vs Node 2.4.0: CONFIRMED (one nuance)

- Node `core/dist/schemas-DscsoNZN.mjs:4-12` has `SUPPORTED_PROTOCOL_VERSIONS = [2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07]`.
- Node `server/dist/src-DdvbAHrR.mjs:567-574` has `SUPPORTED_MODERN_PROTOCOL_VERSIONS = [2026-07-28]`.
- The C# XML for `McpServerOptions.ProtocolVersion` lists 2024-11-05, 2025-03-26, 2025-06-18, 2025-11-25 and 2026-07-28.
- Runtime results from C#:
  - `initialize` echoes 2025-06-18 and 2024-11-05.
  - `server/discover` returns `supportedVersions:["2026-07-28"]`.
- Nuance on 2024-10-07. C# does not reject it. It answers 200 with `protocolVersion:"2025-11-25"`, a counter-offer. Node, measured through InMemoryTransport, echoes `2024-10-07`. So "Node accepts it, C# does not" is right, but C# fails soft, not hard.

## 3. Raw schema byte-identical in tools/list: PARTLY (load-bearing)

- CONFIRMED for the requested schema. It had nested objects, an enum in non-sorted order, `additionalProperties:false`, `default`, `$comment` and non-alphabetical keys. It came back as an exact byte substring of the raw response in every case I ran:
  - stdio 2025-06-18, 2025-11-25 and 2026-07-28 (raw stdout bytes);
  - HTTP 2025-11-25 and 2026-07-28 (raw fetch body).
- **WRONG as a general claim.** String contents are re-escaped by System.Text.Json's default encoder. I sent this schema:
  `"description":"a<b & c>d 'q' + é — 日本 {BS}u00e9 {BS}/ {BS}"x{BS}" 1.0 1e2"` (`{BS}` is one backslash, as below)
  It came back as:
  `"a{BS}u003Cb {BS}u0026 c{BS}u003Ed {BS}u0027q{BS}u0027 {BS}u002B {BS}u00E9 {BS}u2014 {BS}u65E5{BS}u672C {BS}u00E9 / {BS}u0022x{BS}u0022 1.0 1e2"` (here `{BS}` stands for one backslash. A tool hook in this session decodes literal backslash-u escapes in written files, so they are spelled out. The raw bytes are in `verify-sdk/out-raw-*.txt`.)
  - `< > & ' + "` and every non-ASCII character become `\uXXXX`.
  - `\/` becomes `/`.
  - Number lexemes are kept (`1.50`, `1E+2`).
  - Measured on raw stdio for 2025-06-18, 2025-11-25 and 2026-07-28, and on raw HTTP for 2025-11-25 and 2026-07-28. The escaping was the same everywhere.
- The value is semantically identical JSON. It is NOT byte-identical, and it is not byte-identical to Node's output either, because Node writes raw UTF-8 and literal `'`.
- `Tool.Description` is escaped the same way: `it's <b> é` came back as `it{BS}u0027s {BS}u003Cb{BS}u003E {BS}u00E9`. Measured on stdio 2025-11-25 and on HTTP 2026-07-28.
- Blok's own tools/list does contain such a character. I ran the built `packages/mcp` (dist dated Oct 19, so it may be stale). Its `blok_execute` description has an apostrophe ("a command's arguments"). Byte-exact conformance fixtures would therefore differ unless they compare parsed JSON.
- I found no server-wide encoder option in the 2.3.1 XML. Whether the encoder can be overridden is UNVERIFIED.

## 4. Prompts and server instructions: CONFIRMED

- `prompts/list` and `prompts/get` (`hi bob`) answered over stdio and HTTP, in both legacy and modern modes.
- `ServerInstructions` showed up in two places:
  - in the `initialize` result for 2025-06-18, 2025-11-25 and 2024-11-05;
  - in the `server/discover` result for 2026-07-28.
- The Node client's `getInstructions()` returned it in all four runs.

## 5. Input-required flow: CONFIRMED (two additions)

`InputRequiredException(IDictionary<string,InputRequest>, string requestState)`, `InputRequest.ForElicitation`, `RequestParams.InputResponses`, `InputResponse.ElicitResultJsonTypeInfo` and `McpServer.IsMrtrSupported` all exist, per the XML, and compile.

What each case did:

- **2026-07-28 stdio, raw.** The server returned `{"inputRequests":{"approve":{"method":"elicitation/create",...}},"resultType":"input_required"}` with no `requestState`. The retry with `inputResponses` gave `answered ok=True responses=1 state=null`.
- **2026-07-28 stateless HTTP** (Node client, auto-fulfil). Same result.
- **2025-11-25 and 2025-06-18 stdio, raw.** The server sent a real `elicitation/create` server-to-client request. The handler re-ran and finished with `answered ok=True`.
- **2025-11-25 stateless HTTP.**
  - `ClientCapabilities.Elicitation` was null.
  - `IsMrtrSupported` was False.
  - `ClientInfo` was null. This confirms the report's 2.5 gap.
- **2025-11-25 stateless HTTP, throwing anyway.** On the wire this is a JSON-RPC error `-32603`: "A tool handler returned an incomplete result, but the server is stateless and the client does not support MRTR...". mrtr.md calls this an `McpException`. The wire code is -32603.
- **`ElicitAsync` on stateless HTTP.** It throws `System.InvalidOperationException: Elicitation is not supported in stateless mode.` for both 2026-07-28 and 2025-11-25 clients. CONFIRMED.

Addition the report lacks: `ElicitAsync` WORKS on 2026-07-28 stdio. The SDK turned it into an `input_required` with an `input_1` key and an SDK-generated `requestState`, and the client's retry completed (`elicitAsync action=accept`). That matches mrtr.md line 46 ("still work on stateful sessions — including 2026-07-28 stdio"). The report's advice not to use it stays sound, because it breaks on HTTP.

## 6. Stateless is the default; GET/DELETE; no session id: CONFIRMED

- With `WithHttpTransport()` and no SessionMode set:
  - every response had no `Mcp-Session-Id`;
  - `SessionId` was null inside handlers for both 2025-11-25 and 2026-07-28.
- `GET /mcp` and `DELETE /mcp` returned `405 Method Not Allowed`, `Allow: POST`.
- The XML for `HttpServerTransportOptions.SessionMode` says: "The default is Stateless as of the 2026-07-28 protocol revision".
- The v2.0.0 notes say "stateless-by-default HTTP".
- I did not test the report's side-claim that `Stateful` refuses 2026-07-28 with `-32022`. That comes from the XML and mrtr.md only.

## 7. No Origin/Host checks in the SDK: CONFIRMED (one addition)

- These requests all got 200 and real results:
  - `Origin: http://evil.example` and `Host: evil.example:5291`, on a 2025-11-25 `initialize`;
  - the same two headers on a 2026-07-28 `tools/call`.
- Addition: ASP.NET Core's built-in host filtering does the Host half from config alone. With `AllowedHosts=127.0.0.1;localhost` as an environment variable, a foreign Host got **400** and `127.0.0.1` got 200. The `appsettings.json` from `dotnet new web` ships `"AllowedHosts": "*"`. The `mcpserver` local template has no appsettings.json, and I did not generate the remote variant. The port can use this for the DNS-rebinding check. Origin still needs custom middleware.

## 8. 401 to protected-resource metadata, movable to root: CONFIRMED (one nuance)

- Default (no `ResourceMetadataUri` set): `401` with `WWW-Authenticate: Bearer resource_metadata="http://127.0.0.1:5294/.well-known/oauth-protected-resource/mcp"`.
- With `ResourceMetadataUri = new Uri("/.well-known/oauth-protected-resource", UriKind.Relative)`:
  - `401` with `resource_metadata="http://127.0.0.1:5293/.well-known/oauth-protected-resource"`;
  - the root path gave 200 with `resource`, `authorization_servers`, `bearer_methods_supported` and `scopes_supported` (in that key order);
  - `/.well-known/oauth-protected-resource/mcp` gave **404**.
- Nuance the report omits: with the DEFAULT setting, the metadata is served at BOTH the root path and `/mcp` (both 200). Only the challenge header points at the `/mcp` one.

## 9. PackAsTool + McpServer + .mcp/server.json + dnx: CONFIRMED (two additions)

- `dotnet new mcpserver` (template 1.2.1) generates:
  - `PackAsTool` and `PackageType McpServer`;
  - self-contained, single-file;
  - the 6 RIDs listed in the report;
  - `<None Include=".mcp\server.json" Pack="true" PackagePath="/.mcp/" />`;
  - `ModelContextProtocol` **1.2.0**;
  - a `server.json` with schema `2025-10-17`, `registryType:"nuget"` and `transport stdio`.
- Packing the template gives 7 nupkgs. The main one holds `.mcp/server.json` and its nuspec lists packageTypes `DotnetTool` and `McpServer`.
- My Web-SDK server packed as `Verify.Srv` (with `IsPackable=true PackAsTool=true PackageType=McpServer`) has both package types.
- Without `IsPackable=true`, `dotnet pack` silently produced nothing. That confirms the catch.
- The runtimeconfig needs `Microsoft.AspNetCore.App` 10.0.0, as the report says.
- `dnx Verify.Srv@0.0.1 --add-source <feed> --yes stdio`, run with an isolated NUGET_PACKAGES, completed `server/discover` and an MRTR `input_required` round.
- The MS Learn quote ("The only information used by NuGet.org in the server.json is the first packages array item with the registryType value matching nuget") and "dnx … shipped as part of the .NET SDK, starting with version 10" are both verbatim on the fetched page. `dnx` exists at `/usr/local/share/dotnet/dnx`.
- **Addition (new risk).** On the FIRST `dnx` run of an unsigned local package, dnx prints `Skipping NuGet package signature verification.` to **stdout**, ahead of the server's JSON-RPC. I reproduced it twice with a fresh cache. Cached runs are clean. This only hits local/unsigned feeds, which matters for testing the packaged stdio server. Whether nuget.org-signed packages print anything is UNVERIFIED.

## Side note

`git status` in the repo shows `packages/server/go/go.sum` modified. I did not touch it, and it was not in the starting snapshot, so another session is likely editing in parallel. I wrote nothing in the repo.
