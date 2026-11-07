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

## Docs

[https://blokeditor.com/docs](https://blokeditor.com/docs) and [the server page](https://blokeditor.com/server#mcp).
