# Blok.Mcp

Blok's MCP server as a .NET tool. It lets an MCP client read and edit [Blok](https://blokeditor.com) documents.

It takes the same flags and environment variables as the Node server, [`@bloklabs/mcp`](https://www.npmjs.com/package/@bloklabs/mcp). That package's README lists them all.

## Install

It needs .NET 10.

```sh
dotnet tool install -g Blok.Mcp
blok-mcp --source files:./docs
```

Or run it once without installing:

```sh
dnx Blok.Mcp --yes -- --source files:./docs
```

## In an MCP client

Most clients start a server from a command line. For example:

```json
{
  "mcpServers": {
    "blok": {
      "command": "blok-mcp",
      "args": ["--source", "files:/path/to/docs"]
    }
  }
}
```

To serve MCP from your own ASP.NET Core app instead, use the `Blok.Server.Mcp` package.

## Docs

[https://blokeditor.com/docs](https://blokeditor.com/docs) and [the server page](https://blokeditor.com/server#mcp).
