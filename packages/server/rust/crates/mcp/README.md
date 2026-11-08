# blok-mcp (Rust)

Blok's MCP server in Rust, built on the official Rust MCP SDK (`rmcp`). It takes the same flags and environment variables as the Node server, `@bloklabs/mcp`.

It ships nothing yet, like the Rust server. Build it from this repository:

```sh
cd packages/server/rust
cargo build --release -p blok-mcp
./target/release/blok-mcp --source files:./docs
```

CI checks it against the Node server with the shared suite:

```sh
node scripts/test-mcp-conformance.mjs --target rust
```

The crate's rules are the workspace's, in `packages/server/rust/README.md`. One exception: this crate uses `serde_json`, because `rmcp` requires it.

## Embedding it in a Rust host

`blok_mcp::Embedded` runs the whole server inside your own process. To add Blok's tools to an MCP server of your own, see "Blok's tools on your own MCP server" below.

- `Embedded::start(bundle, &options, hooks)` takes typed options (`blok_mcp::options::McpOptions`) and the hooks Node takes as functions (`blok_mcp::options::Hooks`).
- `Embedded::new` and `Embedded::with_uploads` take the options as the JSON object the CLI builds from its flags.
- `embedded.serve(&options)` serves the transport the options name, as the CLI does.

### Options

`McpOptions` has the same fields as Node's `BlokMcpOptions`:

| Field | What it does |
|---|---|
| `transport` | `Stdio` (the default) or `Http { listen, public }`. |
| `auth` | `None` (the default) or `OAuth { issuer, audience, jwks_url }`. |
| `sync`, `tickets` | Live mode: the sync server's URL and origin, and how a ticket is minted. `None` turns live mode off. |
| `source` | Where stored documents live: a folder or a document endpoint. |
| `manifest`, `overrides`, `rich_text_fields` | Custom tools, as `--manifest` loads them. |
| `page_titles` | `"off"` or `"page-map"`. |
| `schema` | `"envelope"`, `"full"` or `"mixed"`. |
| `handle_idle_ms`, `max_handles_per_principal` | Handle limits. Defaults: 600000 ms and 8. |
| `principal` | The caller's name with stdio and no auth. Default `"local"`. |
| `comments` | Turns the comment commands on or off. |

`Hooks` holds what Node takes as functions:

| Hook | What it does |
|---|---|
| `authorize` | Decides, per caller and document, whether a document may be opened. |
| `agent_actor` | Names the agent in the document's history. |
| `uploads` | Your uploader, a folder the agent may upload from (`root`), and limits per kind. |
| `rooms` | Your own collab rooms (`blok_blokserver::Server::agent_executor()`). Live handles then run in this process, with no ticket and no socket. |
| `source` | Your own document store, in place of `McpOptions::source`. See "Your own document store". |
| `page_creator` | Creates each new sub-page's document as your own (`--create-page <url>` on the CLI). See "Your own page creator". |
| `handle_store` | Where stored-mode handles live, so several processes serve one agent (`--handle-store files:<dir>` on the CLI). See "Sharing handles between processes". |

The server refuses unsafe options when it is made, with Node's words. For example:

- HTTP needs a per-document check.
- `uploads.root` works over stdio only.
- An upload root that is not a folder is refused.

### Blok's tools on your own MCP server

`blok_mcp::embed::BlokTools` serves Blok's `blok_*` tools and prompts on an rmcp server you already run, next to your own tools. Your server keeps its serverInfo, instructions, capabilities, transport and sign-in. `examples/embed.rs` is a whole host:

```sh
cargo run --release -p blok-mcp --example embed -- --source files:./docs --authorize <url> [--http 127.0.0.1:0]
```

Build it once with `BlokTools::new(bundle, &options, hooks, embed)`. `options` is what `cli::parse` reads from the blok-mcp flags; `BlokTools::start` takes typed `McpOptions`. Clone it into every handler you make. Then, in your `ServerHandler`:

- Put `blok.instructions()` into your own instructions. Blok never sets them.
- List `blok.tools()` and `blok.prompts()` next to your own.
- Send a `tools/call` whose name `blok.owns_tool(name)` to `blok.call_tool`, and a `prompts/get` whose name `blok.owns_prompt(name)` to `blok.get_prompt`. Answer the rest yourself.
- Call `blok.check_names(your_tools, your_prompts)` before you serve. A name Blok also serves stops the start: "Blok already serves blok_open: rename the host's tool or prompt".
- On shutdown, call `blok.shutdown(limit)` before you close your transport. It waits for the calls in flight, then closes every handle.

A Blok answer is the standalone one: `structuredContent`, one text item with the same JSON, and `isError`. Blok's protocol errors stay protocol errors. A 2026-07-28 result says `resultType: "complete"`. rmcp does not stamp serverInfo on results, so stamp your own `_meta` on Blok's results as on yours (see `stamp` in the example).

Who calls:

- By default, Blok reads the `blok_mcp::embed::SignedIn` your sign-in put on the HTTP request's extensions. Its `subject` is the principal. Over stdio there is no request, so pass a `caller` hook (`EmbedHooks::caller`).
- No sign-in: the call is refused with JSON-RPC -32600 "Blok needs a signed-in caller.". A sign-in without a name: -32600 "Blok needs a named caller (sub or NameIdentifier).".
- `EmbedHooks::anonymous_principal` serves anonymous callers as that one principal. They all share its handles and its handle limit, so pick a name no real user can have.
- Scopes: Blok ignores `SignedIn::scopes`, because your server owns auth. A `caller` hook that returns `scopes: Some(..)` turns on Blok's `blok.read` / `blok.write` checks, as standalone.
- A handle belongs to the principal that opened it. Another principal gets `UNKNOWN_HANDLE`.

Start rules, with Node's words:

- `authorize` (`--authorize`) is required, on every transport: Blok cannot see yours. The one exception is live rooms only: `--ticket-url` with no source.
- Blok's own OAuth (`--auth oauth`) and `principal` (`--principal`) are for the standalone server and are refused.

Not done for you: Origin and Host checks, a body cap and OAuth. They belong to your server. `Mcp-Param-Blok-Handle` is not checked; the argument wins. Stateless HTTP is what is tested; a stateful host is not promised.

### Your own document store

`Hooks::source` takes your store in place of `--source`: a `blok_mcp::document_source::DocumentSource`.

- `load(caller, id)` answers `None` for a document never saved, or a `StoredDocument` with its JSON text and its non-empty version. Blok parses the text the way the endpoint source does: a repeated key keeps its last value, a lone surrogate escape reads as U+FFFD, and more than 48 levels of nesting is refused.
- `save(caller, id, document_text, if_version)` gets compact JSON. `if_version` `None` means "must not exist yet"; any other value must equal the stored version, else refuse with `SourceError::changed`. Answer the new non-empty version.
- `list(caller, request)` is optional: return `true` from `lists()`. Blok still runs `authorize` on every id.

`caller` is the caller that opened the handle (a list runs for the current caller): principal, client name, scopes and the agent actor.

Errors:

- `SourceError::changed`, `unavailable`, `forbidden` and `invalid_id` become `DOCUMENT_CHANGED`, `SOURCE_UNAVAILABLE`, `FORBIDDEN` and `INVALID_ARGS`. The agent sees your message; a blank one gets Blok's words.
- `SourceError::Failed` is your own error. It goes to stderr in full; the agent sees `SOURCE_UNAVAILABLE` in Blok's words, and the handle reloads.
- A load without a version, or a save that answers none, is a bug in your store: `SOURCE_UNAVAILABLE`. After a save, the words say it may have saved.

Blok refuses the ids `.` and `..` before it calls your store. A custom source cannot be combined with `options.source`, and it counts as a source in every start check: with `--ticket-url` it still needs `authorize`.

### Your own page creator

`Hooks::page_creator` takes a `blok_mcp::blok_blokagent::PageCreator`, the same trait Blok.Server's executor uses. On the CLI, `--create-page <url>` is a webhook that implements it (`blok_mcp::create_page::CreatePageWebhook`).

When an agent inserts a page block, Blok calls `create(cancel, request)` once per page, before the batch runs. `request` has:

- `parent_document_id`: the open document the page block goes into.
- `principal`: who the agent acts for.
- `actor`: the agent.
- `suggested_page_id`: a fresh id you may take or ignore.

Answer `Ok(Some(id))` with the new page's id, `Ok(None)` to refuse, or `Err` for your own failure.

- The id must be 1-512 code points, with no control character (Unicode Cc), and not `.` or `..`. Anything else, an empty id included, is a host error. (Blok.Server's executor still reads an empty id as a refusal.)
- Blok does not authorize the new id, does not check that it is free, and does not save an empty page. You own it. A later `blok_open` of the id goes through `authorize` as usual.
- A refusal fails the insert with `FORBIDDEN` "You may not create a page document here.", and nothing is saved.
- An `Err` goes to stderr in full. On the first page the agent sees `SOURCE_UNAVAILABLE` "The host could not create the page." (retryable), and nothing is saved.
- A failure, refusal or cancel after you made pages fails the batch with `ORPHANED_SIDE_EFFECT`. `details.orphaned` lists the pages you made; delete them. `details.cause` is `APPLY_FAILED` for your own failure, `FORBIDDEN` for a refusal, or `CANCELLED`. A page the parent already links is never listed; with none left, the cause alone is the answer.
- One batch makes at most 25 pages. Undo, redo and deleting a page block never call you. `page.rename` and `page.setIcon` save through the source as before.

It works in stored mode with a source and `page_titles` "page-map" only. With `sync` or `rooms`, or without a source, the start is refused.

The webhook speaks Node's wire: `POST <url>` with `Content-Type: application/json` and the body `{"parentDocumentId","principal","actor":{"id","name","onBehalfOf"},"suggestedPageId"}` (`onBehalfOf` null when there is none). `200 {"pageId":"<id>"}` is the id; `200 {"pageId":null}` refuses. Any other status (201 and 3xx too, since redirects are not followed), a timeout (10 s), a network error or another body is a host error, never a refusal.

### Sharing handles between processes

By default a handle lives in the memory of the process that opened it. With `Hooks::handle_store` (a `blok_mcp::handle_store::HandleStore`), stored-mode handles live in your store, so a call can land on any process that shares it. Live handles hold a socket, so they always stay in their own process.

On the CLI, `--handle-store files:<dir>` is the reference store (`blok_mcp::handle_store_files::FilesHandleStore`), for tests and for several processes on one machine. `--handle-store memory` (the default) keeps today's in-process handles. `MemoryHandleStore` is the contract in one process's memory, for tests.

Per call, Blok:

1. answers `UNKNOWN_HANDLE` for a handle that is not 1-128 characters of `[A-Za-z0-9_-]`, before the store is asked;
2. takes the handle's lease (`acquire`, waiting up to 30 s; still leased → `SOURCE_UNAVAILABLE` "Another call is using this handle. Retry shortly.");
3. checks the record: another principal, or a record `v` that is not 1, answers `UNKNOWN_HANDLE`; another tool contract (a rolling deploy) answers `VERSION_SKEW`, and the agent opens again;
4. rebuilds the session from the record, for its opener (principal, client name, scopes and actor from the record, not the current call);
5. runs the call, renewing the lease every 5 s; the source save happens here;
6. saves the record if it changed (`lease.save`), then releases the lease.

If the record cannot be saved after the source save, the answer stands, the error is logged, and the handle is removed: the next call answers `UNKNOWN_HANDLE`. Restored undo steps hold only while their revision is the record's document's (the engine checks it); otherwise undo answers `CONFLICT`. Any error from your store is logged in full, and the agent sees `SOURCE_UNAVAILABLE` "The handle store is unavailable. Retry shortly." (retryable).

The cap (`max_handles_per_principal`) counts the store's handles of the principal plus this process's live ones. Blok calls `sweep(idle)` every 60 s. A stop waits for this process's calls and never touches the store.

Your store's duties:

- `try_add` counts and adds as one step per principal (an SQL row lock, a Redis Lua script). A count, then an insert, can pass the cap.
- A lease is exclusive and time-limited: `save`, `renew`, `remove` and `release` check it is still held, and fail (or, for `release`, do nothing) once it is lost. A holder that stops renewing loses it. So exclusivity is best effort: a paused process can lose its lease while it runs. Correctness then rests on your source's version check (`DOCUMENT_CHANGED` on a stale version). A source that does not check versions can lose writes across processes.
- A handle not leased for longer than the idle time is gone: `acquire` answers `Unknown`, `count` leaves it out, and `sweep` deletes it. A leased handle never expires.
- Records are trusted. Anyone who can write the store can forge one (its actor, scopes, document and history). Make it writable by Blok's processes only.
- Values can be large: a record holds the document and every undo step, with no byte limit. Use a type that takes them (for example `LONGTEXT` or `JSON`, not `TEXT`).
- Keep `scopes` `None` and an empty list apart.

The files store keeps one directory: `<handle>.record.json`, `<handle>.meta.json`, a `<handle>.lease` lock and a lock per principal. It makes the directory (0700) at start if missing, then refuses to start (exit 2) unless the directory is not a link, has no group or world access, and belongs to this user; a trailing slash cannot skip that check. Every file is created 0600. Its privacy checks are POSIX only. Sharing one directory with another language's store is not supported.

### Serving it on your own HTTP server

Call `embedded.http(hosts)`, then pass each request to `handle(peer, local, request)`:

- `peer` is the address that sent the request.
- `local` is the address your server accepted it on.

`http` is refused unless the options say `Transport::Http`. The HTTP rules (a per-document check, no `uploads.root`) are only checked for those options. `handler(true)` is refused the same way.

`handle` makes Node's checks first:

- A browser `Origin` must be a loopback page.
- With `hosts` set to `None`, the `Host` must be a loopback name with the port in `local`, and the caller must be on this machine.
- With no OAuth and no `hosts`, only loopback callers are served.

Past those checks it answers exactly as the CLI's front door does: the same statuses, bodies and OAuth metadata route.

`handle` takes a body your server has already read. Its 413 for a body over 4 MiB only refuses the request; it cannot stop your server from reading a bigger one into memory. Cap the body at 4 MiB yourself before you build the request, for example with `http_body_util::Limited`, and answer 413 when the cap is hit, as Node does.

Naming your own `hosts` lets remote callers in without OAuth. This is on purpose, for an app that sits behind its own login or proxy. Node has no such option: its server binds loopback, and only `--public` with `--auth oauth` takes remote callers. Behind a proxy every caller looks like the proxy, so set OAuth or name your hosts.

### Uploads

Your uploader returns `UploadError::Failed` for its own errors. The full message goes to stderr, and the agent sees only "The upload failed.". Return `UploadError::Agent` for words meant for the agent, as Node's `agentMessage`. A blank message counts as none.

### Limits that differ from Node

- A call runs within a memory budget per engine (256 MiB of allocations). Node has no such limit.
- A document endpoint answer over 64 MiB is refused with "The document endpoint answered more than 64 MiB". The answer is read whole, and a document that big is past the memory budget anyway.
