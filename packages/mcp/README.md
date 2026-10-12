# @bloklabs/mcp

An MCP server for [Blok](https://blokeditor.com). It lets outside agents read and edit Blok documents.

## What it is

The server exposes six tools.

| Tool | What it does |
|---|---|
| `blok_list_documents` | Lists documents the caller may open, if the source can list them. |
| `blok_open` | Opens a document and returns a `handle`. Every other tool takes it. |
| `blok_read` | Returns the document view for a handle. |
| `blok_describe` | Returns the command contract, or one tool or command. |
| `blok_execute` | Runs one batch of commands on a handle. |
| `blok_close` | Closes a handle. |

A document opens in one of two modes:

- **Live**: the agent joins the document's sync room as a participant. People see it work.
- **Stored**: the agent loads the saved document, edits it, and saves it back after every batch.

Agents write rich text with commands. They never write Markdown or HTML into block data.

## Install and run locally

Run it against a folder of JSON documents:

```sh
npx @bloklabs/mcp --source files:./docs
```

It speaks MCP over stdio by default. Add it to Claude Code or Claude Desktop like this:

```json
{
  "mcpServers": {
    "blok": {
      "command": "npx",
      "args": ["@bloklabs/mcp", "--source", "files:/abs/path/to/docs"]
    }
  }
}
```

Over stdio, credentials come from environment variables, not from the MCP client.

## Live rooms

Pass `--sync-url` to join rooms on a Blok sync service.

- `--origin` sets the `Origin` header the server sends to the room.
  - A sync service in ticket mode checks `Origin` on every client, browser or not.
  - So a backend must send an origin the service allows (its `--allow-origin` list).
  - `Origin` is a cross-site guard, not proof of identity. The ticket is what authenticates.
- Tickets come from one of two places:
  - `BLOK_SECRET`: the MCP server signs tickets itself with the sync service's secret.
  - `--ticket-url` with `BLOK_MCP_HOST_TOKEN`: the MCP server asks your host for a ticket. The host checks the human's rights. This is the recommended hosted mode.
- `--sync-url` needs one of the two. Without a ticket the room cannot name the agent, so the server refuses to start.
- `BLOK_SECRET` over `--http` also needs `--authorize`. Otherwise any caller could get a ticket for any document. Over stdio it is allowed alone.
- The ticket's `user` must equal the agent's actor id, not the human's id. Otherwise the open is refused.
- `blok_open` reports the handle's `durability`:
  - `acknowledged`: the server has a journal, and each batch waits for its acks.
  - `best-effort`: the server has no journal and makes no durability claim.
  - `saved-on-execute`: a stored document, saved after every batch.
- Each `blok_execute` result says what happened to that batch in `delivery`.
- `blok_close` reports `hostRecordLags`. The host's stored record lags the agent's edits until the room writes it back.

## Stored documents

Pick a source with `--source`.

**`--source endpoint:<url>`** reuses the document endpoint contract the sync service already uses.

- Load: `GET <url>/<doc>`. Save: `PUT <url>/<doc>` with `Blok-Doc-Version`.
- `BLOK_DOC_ENDPOINT_AUTH` is sent as the `Authorization` header. It opens every document, so run this source only from a trusted backend.
- Answer a stale `PUT` with `409`. Without it, saves are last-writer-wins.
- `--source-list <url>` turns on `blok_list_documents`. The route contract:
  - Request: `GET <url>?query=&cursor=&limit=`.
  - Response: `{ "documents": [{ "id": "...", "title": "..." }], "nextCursor": "..." }`. `title` and `nextCursor` are optional.

**`--source files:<dir>`** stores each document as `<dir>/<id>.json`. It is meant for local use.

- An id uses letters, digits, `.`, `_` and `-`, starts with a letter or digit, and is at most 200 characters.
- Saves are atomic: a temp file, then a rename.
- A save checks a SHA-256 hash of the file first. If the file changed since it was opened, the save is refused.
- The check and the rename are not locked together. Two local writers can still race in that window.

Stored mode is refused when `--sync-url` is set. A sync service owns those documents, and a stored write would fight the room.

## Hosted

- `--http <host:port>` serves Streamable HTTP instead of stdio.
- A non-loopback address needs `--public`. `--public` needs `--auth oauth`.
- Over HTTP the server also needs a per-document check, or it refuses to start. OAuth says who is calling, not which documents they may open.
  - Pass `--authorize`, or
  - serve live rooms only: `--ticket-url` with no `--source`, so your host decides each ticket.
- `--auth oauth` makes the server an OAuth resource server. It needs `--oauth-issuer`, `--oauth-audience` and `--oauth-jwks`.
  - Tokens are checked against the issuer's JWKS. The audience must name this server.
  - Scopes: `blok.read` (list, open read-only, read, describe) and `blok.write` (open for writing, execute).
  - Protected Resource Metadata is served at `/.well-known/oauth-protected-resource`.
- A request with a non-loopback `Origin` header is refused.
- Live handles hold sockets, so run it as a long-lived process.
- To scale out, route on the `Mcp-Param-Blok-Handle` header, so every call for a handle reaches the process that holds it.
- Some clients do not mirror `x-mcp-header` parameters into headers. To serve them, run a single instance.

## Host duties

- On an ASP.NET host, `IBlokAuthorization` sees the agent's actor id, not the human's. Map it back to the human for your document checks.
- `--authorize <module|url>` decides who may open what:
  - A URL is a webhook. It gets `POST { "principal", "documentId", "write" }` and must answer `200 { "allowed": true | false }`. Any other answer means no.
  - Anything else is a module path. Its default export is `(principal, documentId, write) => Promise<boolean>`.
  - It runs before every open, and again on each later call.
  - `blok_list_documents` shows only the documents it allows the caller to read. Without it, the list is unfiltered.
- `--page-titles page-map` lets agents rename other pages and set their icons. It shows up only if your host reads each page's title from that page document's title.

## Custom tools

- `--manifest <file>` loads your custom block tools, as a `BlokCustomToolsFile`.
- `--manifest-overrides <file>` hides tools or actions, or adds guidance.
- `--rich-text-fields` (or `BLOK_RICH_TEXT_FIELDS`) names rich text fields as JSON, like `{"callout":["title"]}`. It is used only for block types missing from the manifest.
- Custom tool action handlers do not run here. Custom tools get structural commands and field writes.

## All flags

A flag wins over its environment variable.

| Flag | Env var | Default | What it does |
|---|---|---|---|
| `--source files:<dir>` / `endpoint:<url>` | | none | Where stored documents live. |
| `--source-list <url>` | | none | List route for the `endpoint` source. |
| | `BLOK_DOC_ENDPOINT_AUTH` | empty | `Authorization` header for the `endpoint` source. |
| `--sync-url <url>` | `BLOK_SYNC_URL` | none | Sync service for live rooms. |
| `--origin <origin>` | `BLOK_MCP_ORIGIN` | none | `Origin` sent to the sync service. |
| | `BLOK_SECRET` | none | Signs room tickets locally. |
| `--ticket-url <url>` | `BLOK_TICKET_URL` | none | Host route that mints room tickets. |
| | `BLOK_MCP_HOST_TOKEN` | none | Bearer token for `--ticket-url`. Required with it. |
| `--http <host:port>` | `BLOK_MCP_HTTP` | stdio | Serve Streamable HTTP. |
| `--public` | | off | Allow a non-loopback `--http` address. |
| `--auth none\|oauth` | | `none` | How HTTP callers authenticate. |
| `--oauth-issuer <url>` | | none | Expected token issuer. |
| `--oauth-audience <url>` | | none | This server's resource id. |
| `--oauth-jwks <url>` | | none | Issuer's JWKS URL. |
| `--authorize <module\|url>` | | none | Per-document access hook. |
| `--principal <name>` | | `local` | Who the caller is over stdio. |
| `--manifest <file>` | | none | Custom block tools. |
| `--manifest-overrides <file>` | | none | Tool and action overrides. |
| `--rich-text-fields <json>` | `BLOK_RICH_TEXT_FIELDS` | none | Rich text fields for unknown block types. |
| `--page-titles off\|page-map` | | `off` | Headless page rename and icon. |
| `--schema envelope\|full` | | `envelope` | How `blok_execute` describes its commands. |
| `--handle-idle-ms <ms>` | | `600000` | Idle time before a handle expires. |
| `--max-handles <n>` | | `8` | Open handles per principal. |

## Limits

- No undo in live rooms.
- No uploads. Add media by URL.
- No Docker image.
- A handle expires after 10 minutes idle.
- A principal may hold 8 open handles.

## Versions

Upgrade `@bloklabs/core`, `@bloklabs/server` and `@bloklabs/mcp` together. They share the room format. A room in a format this server does not know fails with `VERSION_SKEW`.

## Embedding

`createBlokMcpServer(options)` runs the same server inside your own Node backend. Its options are typed as `BlokMcpOptions`.
