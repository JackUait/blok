# @bloklabs/mcp

An MCP server for [Blok](https://blokeditor.com). It lets outside agents read and edit Blok documents.

## What it is

The server exposes six tools.

| Tool | What it does |
|---|---|
| `blok_list_documents` | Lists documents the caller may open, if the source can list them. |
| `blok_open` | Opens a document and returns a `handle`. Every other tool takes it. Without `documentId` it opens the only document, or the one whose id or title equals `query`; otherwise it returns the list to choose from. |
| `blok_read` | Returns the document view for a handle. |
| `blok_describe` | Returns the command contract, or one tool or command. |
| `blok_execute` | Runs one batch of commands on a handle. |
| `blok_close` | Closes a handle. Live: leaves the room. Stored: optional, since every batch already saved. |

A document opens in one of two modes:

- **Live**: the agent joins the document's sync room as a participant. People see it work.
- **Stored**: the agent loads the saved document, edits it, and saves it back after every batch.

Agents write rich text with commands. They never write Markdown or HTML into block data. On initialize the server sends `instructions`:

- The rich-text rules: the marks, colour presets, link defaults, and equation and page embeds.
- The editing rules the in-app assistant gets too, such as "change only the blocks the request is about" and "put related edits in one `blok_execute` call".
- How to reach a sub-page: open the page block's `data.pageId` with `blok_open`.
- How to make a sub-page, where the server can: insert a page block. See `--page-titles page-map`.

## Prompts

The server also offers the built-in Ask AI buttons as MCP prompts. A client lists them with `prompts/list` and shows them, for example as slash commands. The prompt text is the one Ask AI sends.

| Prompt | What it does |
|---|---|
| `improve` | Improve writing |
| `proofread` | Fix spelling and grammar |
| `shorter` | Make shorter |
| `longer` | Make longer |
| `simplify` | Simplify language |
| `explain` | Explain |
| `summarize` | Summarize |
| `actionItems` | Find action items |
| `continue` | Continue writing |

The arguments:

- `documentId`: the document to work on. Without it, `blok_open` lists the documents to choose from.
- `selection`: the selected text, word for word. `improve`, `shorter`, `longer`, `simplify` and `explain` need it. With it, `proofread` fixes only that text; without it, the whole document.
- `blockId`: the block the selection is in, or, for `continue`, the block to write after.

The prompt tells the model to open the document with `blok_open`, find the text with `doc.find` and edit with `blok_execute`. Host buttons set in `agent.assistant.actions` are not served.

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
- The ticket route answers 403 when the human may not open the document. The agent gets `FORBIDDEN`, and a live handle ends. A 401 means the host token was refused; the agent gets a retryable error.
- `blok_open` reports the handle's `durability`:
  - `acknowledged`: the server has a journal, and each batch waits for its acks.
  - `best-effort`: the server has no journal and makes no durability claim.
  - `saved-on-execute`: a stored document, saved after every batch.
- `blok_open` lists the commands a live handle refuses in `unavailableCommands`, each with a `reason`. `blok_describe` marks them `available: false` too.
- `history.undo` and `history.redo` take back and redo the handle's own batches. They never touch what other people wrote. When someone else changed what a batch added, removed or moved, they answer `CONFLICT` and change nothing.
- Each `blok_execute` result says what happened to that batch in `delivery`.
- `blok_close` reports `hostRecordLags`. The host's stored record lags the agent's edits until the room writes it back.

## Stored documents

Pick a source with `--source`.

**`--source endpoint:<url>`** reuses the document endpoint contract the sync service already uses.

- Load: `GET <url>/<doc>`. Save: `PUT <url>/<doc>` with `Blok-Doc-Version`.
- A document the host never saved (`null`, or `{"data": null}`) opens empty, and `blok_open` reports `exists: false`. So does a missing file under `files:`. The first save creates it.
- `BLOK_DOC_ENDPOINT_AUTH` is sent as the `Authorization` header. It opens every document, so run this source only from a trusted backend.
- Answer a stale `PUT` with `409`. Without it, saves are last-writer-wins.
- `--source-list <url>` turns on `blok_list_documents`. The route contract:
  - Request: `GET <url>?query=&cursor=&limit=`.
  - Response: `{ "documents": [{ "id": "...", "title": "..." }], "nextCursor": "..." }`. `title` and `nextCursor` are optional.

**`--source files:<dir>`** stores each document as `<dir>/<id>.json`. It is meant for local use.

- An id uses letters, digits, `.`, `_` and `-`, does not start with `.`, and is at most 200 characters.
- Ids are case-sensitive. An id that matches a stored file only when case is ignored is refused.
  - On a disk that ignores case (the macOS and Windows default), two ids that differ only by case cannot both exist. Whichever is saved first owns the name.
- Saves are atomic: a temp file, then a rename. The file keeps its permissions, and the data is flushed to disk before the rename.
- A save checks a SHA-256 hash of the file first. If the file changed since it was opened, the save is refused.
- Saves of one file run one at a time, across processes too. Each save holds a lock file beside the file it writes, named after it in lower case: `.<file name>.lock`, like `.doc.json.lock`.
  - Only blok-mcp honors the lock. Another program writing the file is still caught by the hash check, except in the moment between the check and the rename.
  - A lock older than 30 seconds is treated as left by a crashed process and removed.
- A document that is a symlink is saved through to its target, so the link stays. The lock sits beside the target, so saves through the link and saves of the target wait for each other.
  - A link to a missing file is refused, on open and on save.
  - `page.rename` and `page.setIcon` refuse a page block whose id links to the open document, as they do for the open document's own id.

Stored mode is refused when `--sync-url` is set. A sync service owns those documents, and a stored write would fight the room.

## Hosted

- `--http <host:port>` serves Streamable HTTP instead of stdio.
- A non-loopback address needs `--public`. `--public` needs `--auth oauth`.
- Over HTTP the server also needs a per-document check, or it refuses to start. OAuth says who is calling, not which documents they may open.
  - Pass `--authorize`, or
  - serve live rooms only: `--ticket-url` with no `--source`, so your host decides each ticket.
- `--auth oauth` makes the server an OAuth resource server. It needs `--oauth-issuer`, `--oauth-audience` and `--oauth-jwks`.
  - Tokens are checked against the issuer's JWKS. The audience must name this server.
  - Tokens must be JWT access tokens (RFC 9068): the header `typ` must be `at+jwt` or `application/at+jwt`. Tokens with any other `typ`, or none, are refused, so an ID token cannot pass as an access token.
  - Scopes: `blok.read` (list, open read-only, read, describe) and `blok.write` (open for writing, execute).
  - Protected Resource Metadata is served at `/.well-known/oauth-protected-resource`.
  - The principal is the token's `sub`. A token with no `sub` gets `client:<client_id>` (or its `azp`), so a machine client never shares a user's handles or `--authorize` answers.
  - A `sub` that is not a non-empty string, or that starts with `client:`, is refused. So is a token that names no `sub`, `client_id` or `azp`.
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
  - It also lets agents make sub-pages. Inserting a page block creates a document under a new id, and the block's `data.pageId` names it. The agent then names it with `page.rename` and fills it with `blok_open`.
  - The new id must pass `--authorize` as a write first. If it does not, nothing is created and the insert fails with `FORBIDDEN`.
  - In stored mode the server saves an empty document there.
  - With `--sync-url` the server joins the new page's room once and leaves. The sync service loads it empty and seeds it, so its ticket and `IBlokAuthorization` must let the agent open an id it has never seen, and your document endpoint must answer `null` for it. If the room is refused, the insert fails with `FORBIDDEN` or `SOURCE_UNAVAILABLE`.
  - In live mode your document endpoint gets no PUT for the new page yet. It gets one when someone writes in the page, or under a journal when the room is opened again.
  - The document stays, empty, if the batch fails after it was made or the insert is undone. When a later command in that batch fails, `error.details.orphaned` lists it. A save or a room that refuses the batch does not. Delete it yourself if you do not want it.

## Custom tools

- `--manifest <file>` loads your custom block and inline tools, as a `BlokCustomToolsFile`.
- List each custom inline tool under `inlineTools`. Give its `name`, an optional `title`, and its `sanitize` rules.
  - Copy `sanitize` from the tool's `static sanitize`. Each tag maps to `true` or to its attributes, like `{"kbd":{"data-key":true}}`.
  - Function rules cannot go in a JSON file. Write the attributes out instead.
  - Its marks are `tag:<tag>` keys. Agents see them in the schema, and `blok_describe` answers for the tool by name.
  - Without this entry, the server removes the tool's marks when it writes the block.
  - The tool applies to every built-in block but code, and to your custom blocks. The file cannot limit it to some blocks.
  - Only text-formatting tags are allowed: `kbd`, `abbr`, `cite`, `dfn`, `q`, `small`, `samp`, `var`, `time`, `data`, `span`, `mark`, `code`, `a`, `ruby`, `rt`, `rp`, `bdi`, `bdo`, `ins`, `del`, `s`, `u`, `b`, `i`, `strong`, `em`, `sup`, `sub`.
  - Only plain attributes are allowed: `class`, `id`, `title`, `lang`, `dir`, `role`, `translate`, `datetime`, `value`, `data-*` and `aria-*`. A link (`a`) may also have `href`, `target` and `rel`. Its `href` gets the same unsafe-URL check as Blok's own links.
  - Anything else is refused, because the server cannot check it for unsafe URLs. That includes `style`, `on*`, `cite`, `xlink:href` and `data-blok-*`.

```json
{
  "formatVersion": 1,
  "blocks": [],
  "inlineTools": [{ "name": "kbd", "title": "Keyboard", "sanitize": { "kbd": { "data-key": true } } }]
}
```

- `--manifest-overrides <file>` hides tools or actions, or adds guidance.
- `--rich-text-fields` (or `BLOK_RICH_TEXT_FIELDS`) names rich text fields as JSON, like `{"callout":["title"]}`. It is used only for block types missing from the manifest.
- Custom tool action handlers do not run here. Custom tools get structural commands and field writes.

## All flags

A flag wins over its environment variable.

Pass a value as the next argument: `--auth oauth`, not `--auth=oauth`. An unknown flag or a stray argument is refused at startup.

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
| `--manifest <file>` | | none | Custom block and inline tools. |
| `--manifest-overrides <file>` | | none | Tool and action overrides. |
| `--rich-text-fields <json>` | `BLOK_RICH_TEXT_FIELDS` | none | Rich text fields for unknown block types. |
| `--page-titles off\|page-map` | | `off` | Headless page rename and icon, and new sub-pages. |
| `--schema mixed\|envelope\|full` | | `mixed` | How `blok_execute` describes its commands. `mixed` gives the full arguments of the common commands, so the model needs no `blok_describe` call for them. |
| `--handle-idle-ms <ms>` | | `600000` | Idle time before a handle expires. |
| `--max-handles <n>` | | `8` | Open handles per principal. |

## Limits

- No uploads. Add media by URL.
- No Docker image.
- A handle expires after 10 minutes idle.
- A principal may hold 8 open handles.

## Versions

Upgrade `@bloklabs/core`, `@bloklabs/server` and `@bloklabs/mcp` together. They share the room format. A room in a format this server does not know fails with `VERSION_SKEW`.

## Embedding

`createBlokMcpServer(options)` runs the same server inside your own Node backend. Its options are typed as `BlokMcpOptions`.
