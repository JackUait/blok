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

`blok_mcp::Embedded` runs the server inside your own process.

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

The server refuses unsafe options when it is made, with Node's words. For example:

- HTTP needs a per-document check.
- `uploads.root` works over stdio only.
- An upload root that is not a folder is refused.

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
