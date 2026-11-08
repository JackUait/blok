# Blok.Server.Mcp

Blok's MCP server inside your ASP.NET Core app. An MCP client can then read and edit [Blok](https://blokeditor.com) documents through your app.

It serves the same six tools as the Node server, [`@bloklabs/mcp`](https://www.npmjs.com/package/@bloklabs/mcp), over stateless streamable HTTP.

## Install

It needs .NET 10.

```sh
dotnet add package Blok.Server.Mcp
```

## Use

```csharp
using Blok.Server.Mcp;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddBlokMcp(options =>
{
  options.FilesDirectory = "./docs";
  // Your own check: may this principal open this document?
  options.Authorize = (request, cancellationToken) =>
    ValueTask.FromResult(MayOpen(request.Principal, request.DocumentId, request.Write));
});

var app = builder.Build();

app.MapBlokMcp("/mcp");
app.Run();
```

- `BlokMcpOptions` holds the same choices as the command line flags: the document source, the principal, the schema, handle limits, comments and OAuth.
- Read documents from a folder with `FilesDirectory`, or from your own route with `DocumentEndpoint`.
- Without `Authorize`, a registered `IBlokAuthorization` decides. With neither, startup fails. Set `AllowEveryCallerEveryDocument` to let every caller reach every document. A server with only `TicketUrl` and no document source needs neither: the ticket route decides.
- `MapBlokMcp` takes a path, `/mcp` by default.

To run the server on its own instead, use the `Blok.Mcp` tool.

## Add Blok to your own MCP server

`WithBlok` serves Blok's `blok_*` tools and prompts on an MCP server you build with the ModelContextProtocol SDK (2.x). Your server keeps its own name, instructions, tools, prompts, transport and sign-in. A working example is in [`examples/Blok.Mcp.EmbedExample`](../examples/Blok.Mcp.EmbedExample).

```csharp
builder.Services
  .AddMcpServer(options => options.ServerInfo = new Implementation { Name = "my-app", Version = "1.0.0" })
  .WithHttpTransport(http =>
  {
    http.SessionMode = HttpServerSessionMode.Stateless;
    // Blok never sets instructions: put its text into yours.
    http.ConfigureSessionOptions = async (context, options, cancellationToken) =>
      options.ServerInstructions = "My instructions.\n\n"
        + await context.RequestServices.GetRequiredService<IBlokMcp>().GetInstructionsAsync(cancellationToken);
  })
  .WithTools<MyTools>()
  .WithBlok(options =>
  {
    options.DocumentSource = new MyStore();
    options.Authorize = (request, cancellationToken) => MayOpenAsync(request.Principal, request.DocumentId, request.Write, cancellationToken);
  });

app.UseAuthentication();
app.MapMcp("/mcp").RequireAuthorization();
```

- `BlokMcpOptions` are the same as for `AddBlokMcp`. `BlokMcpCommandLine.ParseAsync(args)` reads the `blok-mcp` flags into them (`ApplyTo`).
- The per-document check is required as for `AddBlokMcp`: `Authorize`, or a registered `IBlokAuthorization`, or `AllowEveryCallerEveryDocument`.
- Refused at start, because your server owns them: `OAuth`, `Principal`, `AllowedOrigins`, `AllowedHosts` and `TrustRemoteCallers`.
- Who calls: the user your auth signed in, named by its `sub` claim, else `NameIdentifier`. Set `Caller` to name callers yourself. An anonymous caller gets the protocol error `-32600` "Blok needs a signed-in caller."; a signed-in caller with no name gets "Blok needs a named caller (sub or NameIdentifier).". `AnonymousPrincipal` serves anonymous callers as that principal instead. They all share it, and its handle limit: pick a name no real user has.
- Scopes: Blok ignores the user's scope claims, since your server owns sign-in. Make read-only agents in `Authorize`. When `Caller` returns `Scopes`, Blok checks `blok.read` and `blok.write` as the standalone server does.
- A handle belongs to the caller that opened it. Another principal gets `UNKNOWN_HANDLE`.
- A tool or prompt of yours with a Blok name stops the app at start. A list handler of yours that returns a Blok name fails that list. Other names reach your own tools, handlers and prompts.
- Blok's tools answer as the standalone server's, including its protocol errors and the approval question.
- `IBlokMcp` gives Blok's instructions, tool and prompt names and version. The app's stop waits for Blok's calls in flight.
- Blok adds request filters only. It never sets your serverInfo, instructions or handlers, and it adds the tools and prompts capabilities only when they are missing. Keep `Capabilities.Tools` if you replace `Capabilities` per request.
- Origin and Host checks, a body size cap and OAuth are your server's job. Stateless HTTP is the supported transport; stateful sessions are not promised.
- The SDK reads a request only 64 levels deep. `MapBlokMcp` moves deeper `blok_execute` arguments aside before the SDK reads them; your endpoint does not, so a batch nested deeper than about 60 levels fails to parse there. Blok refuses documents deeper than 48 levels anyway.
- It needs ModelContextProtocol 2.x: the tool filter is `CallToolWithAlternateFilters`, and the approval question uses `InputRequiredException`.

## Your own document store

Set `DocumentSource` to load and save stored documents through your own code. It works with `AddBlokMcp` and `WithBlok`, and replaces `FilesDirectory` and `DocumentEndpoint`: set one of the three.

```csharp
sealed class MyStore(MyDb db) : IBlokMcpDocumentSource, IBlokMcpDocumentLister
{
  // One read for the text and its version, so they always match. Null: never saved.
  public async ValueTask<BlokMcpStoredDocument?> LoadAsync(BlokMcpDocumentCaller caller, string documentId, CancellationToken cancellationToken) =>
    await db.ReadAsync(documentId, cancellationToken) is { } row ? new BlokMcpStoredDocument(row.Json, row.Version) : null;

  // ifVersion null: the document must not exist yet. Otherwise it must equal the stored version.
  public async ValueTask<string> SaveAsync(BlokMcpDocumentCaller caller, string documentId, string documentText, string? ifVersion, CancellationToken cancellationToken) =>
    await db.WriteIfAsync(documentId, documentText, ifVersion, caller.Actor, cancellationToken)
      ?? throw new BlokMcpSourceException(BlokMcpSourceErrorKind.Changed);

  // Optional: turns on blok_list_documents.
  public ValueTask<BlokMcpDocumentList> ListAsync(BlokMcpDocumentCaller caller, BlokMcpListRequest request, CancellationToken cancellationToken) =>
    ValueTask.FromResult(new BlokMcpDocumentList([new BlokMcpListedDocument("doc") { Title = "Notes" }]));
}
```

- `caller` is the caller that opened the handle: principal, client name, scopes and the agent actor. Blok still runs the per-document check before every open and on every listed id.
- `LoadAsync` answers the document as JSON text, as you store it. Blok parses it as it parses a file: a `blocks` array, at most 48 levels deep, a repeated key keeps its last value, lone surrogates read as U+FFFD.
- Ids are any string your check allows, except `""`, `.` and `..`, which Blok refuses with `INVALID_ARGS` before it calls you. With `PageTitles = "page-map"`, Blok makes up the ids of new pages, so your store must take ids it did not choose.
- An existing document needs a non-empty version, and so does every save. A save answered without one is a host bug: the agent sees `SOURCE_UNAVAILABLE` "The host may have saved this document but did not say which version. Read it before you retry.", and the handle reloads.
- Refuse with `BlokMcpSourceException(kind, agentMessage)`: `Changed` is `DOCUMENT_CHANGED`, `Unavailable` is `SOURCE_UNAVAILABLE`, `Forbidden` is `FORBIDDEN`, `InvalidId` is `INVALID_ARGS`. The agent sees `agentMessage`, or Blok's own words when it is blank.
- Any other exception, and a bad answer, is logged in full through your `ILogger`. The agent sees `SOURCE_UNAVAILABLE` in generic words.
- A failed save drops the batch: the handle reloads your document, and the batch's undo step is gone.
- A custom store counts as a source everywhere: with `TicketUrl` it still needs the per-document check.

## Docs

[https://blokeditor.com/docs](https://blokeditor.com/docs) and [the server page](https://blokeditor.com/server#mcp).
