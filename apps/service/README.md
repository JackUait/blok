# Blok cloud host

Go product host embedding Blok's existing server. PostgreSQL stores identities, sessions, access control, workspace indexes and document projections. Blok's local collaboration journal remains the durable operation source. Run exactly one application instance against a journal directory.

The hosted MCP endpoint is `https://<PUBLIC_URL host>/mcp`. Every signed-in user creates a dedicated 90-day Bearer token in **Mon compte → Accès MCP**, and can rotate or revoke it there. Rotation invalidates the old token immediately. The new secret appears once, is stored only as a hash on the server and carries the caller's current workspace rights. MCP tools list workspaces/pages, create pages, and edit page documents live. See [API.md](API.md#hosted-mcp) for the contract.

## Configuration

Required production environment:

- `DATABASE_URL`: PostgreSQL connection string, with TLS when crossing a host/network trust boundary.
- `PUBLIC_URL`: canonical HTTPS application origin, such as `https://blok.tousamba.cloud`.
- `INTERNAL_URL`: self-reachable application URL, default `http://127.0.0.1:8080`. Internal document endpoints require `INTERNAL_SECRET` independently of public user authentication; keep them blocked at the public reverse proxy.
- `TICKET_SECRET`, `INTERNAL_SECRET`: independent cryptographically random values of at least 32 characters.
- `RESEND_API_KEY`, `MAIL_FROM`: verified Resend sender. SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`) is an alternative.
- `BOOTSTRAP_ADMIN_EMAIL`: verified through the same email login as every account. The first configured bootstrap creates the default workspace admin once. Changing this environment variable never overrides subsequent role changes.
- `DATA_DIRECTORY`: persistent directory containing `collab/` and private `uploads/`.

Optional `LISTEN_ADDR` defaults to `:8080`. `TRUSTED_PROXY_CIDRS` allows forwarded client IPs only from the specified direct proxy peers (for example Caddy’s dedicated `/32` address); forwarded chains are read from right to left and direct callers cannot spoof them. The resolved IP is also passed to Blok’s rate limiter. `ALLOWED_ORIGINS` is a comma separated exact allowlist for native origins. Never configure `*`. Browser UI and API should share an origin. Native app origins must be included for Blok's own ticket guard.

`APP_ENV=development` allows HTTP and non-secure localhost cookies. An explicit `DEV_MAIL_DIRECTORY` enables a private filesystem mail sink **only** in development. The filename is the SHA-256 hexadecimal digest of the normalized email plus `.json`; contents are `{to,subject,text}`. Production refuses this option. Login codes and session tokens are never logged. No unauthenticated code-retrieval endpoint exists.

## Build and run

From this directory with Go 1.27.4:

```sh
go build -o server ./cmd/server
./server
```

The service applies the embedded idempotent migration under a PostgreSQL advisory transaction lock before serving traffic. `/healthz` checks database availability. The executable blocks new public admissions, drains Blok rooms before shutting down HTTP and PostgreSQL, and exits nonzero if draining fails; allow at least 50 seconds for container termination. Local assets are served only through the host's session/membership check, never by a public static-files mount.

## Verification

```sh
TEST_DATABASE_URL='postgres://postgres:password@localhost:5432/blok_test?sslmode=disable' go test -race -v ./...
```

Without a local Go toolchain, `./test.sh` runs the same suite inside a `golang`
container pinned to this module's version, and passes its arguments through
(`./test.sh -run TestResolve`). It expects a throwaway PostgreSQL:

```sh
docker run -d --name blok-test-pg -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=blok_test -p 55432:5432 postgres:17-alpine
```

Integration tests skip themselves when `TEST_DATABASE_URL` is unset, so the unit
layer — including the page-permission truth table — runs with no database at all.

Integration tests create and drop a unique PostgreSQL schema. They use an in-memory mail function and send no live email. They verify authentication and single-use codes, join approval, invitation acceptance, viewer restrictions, admin invariants, index revisions and PR25 metadata, internal document isolation, actual Blok room loading and live duplication, seeding guards, private signed file grants, logout/session revocation and one-time bootstrap behavior.

The API contract is in [API.md](API.md). Administrators can attach an optional plain-text invitation note of up to 2,000 Unicode characters; the note is delivered in the email and is not stored with the invitation. Tickets contain a session digest rather than a reusable bearer token. This permits immediate rechecking of logout, session expiry and membership/role changes, including established WebSockets. Logout, role changes, member removal and workspace index changes trigger Blok `RecheckAccess` immediately; an observed-document sweep rechecks expiry every five seconds and closes denied live sockets. Journal actor identifiers therefore represent sessions; they are not stable user profile identifiers.

## Data safety

Back up PostgreSQL, the **entire** journal directory, uploads, configuration and deployed version together after draining/stopping the application. A PostgreSQL-only backup may omit the newest acknowledged collaboration changes. Restore all components before restarting one instance. Soft deletion/trash only blocks access; journal and assets remain retained for history and restores. Uploaded assets are private to workspace membership, including retained/duplicated documents.

Seed content is accepted only for a new empty document before any collaboration ticket has been issued. Subsequent body edits use Blok collaboration; direct checkpoint JSON overwrites are not a public API. Duplication reads the live room snapshot before creating an independent document.

## OpenAI credentials and assistant

Members can store an account-wide personal OpenAI API key. Administrators can additionally configure a workspace key for members who have no personal key. A configured personal key always wins, including when OpenAI rejects it: the host never silently charges the shared key as fallback. Removing a personal key is the explicit action that re-enables the workspace key. Each key scope has its own selected model; a personal model without a personal key does not override the workspace model.

Keys are AES-256-GCM encrypted in PostgreSQL with scope/owner-bound authenticated data. The server generates `DATA_DIRECTORY/ai-key` once, persists and syncs it with mode `0600`, and refuses a non-regular key path. If encrypted credentials exist but that file is missing, startup fails instead of silently generating an unusable replacement. Alternatively, set `AI_ENCRYPTION_KEY` to base64 encoding of exactly 32 cryptographically random bytes; keep it in protected deployment configuration. Changing this key does **not** re-encrypt existing credentials. Restore the matching encryption key with the database; rotation requires a separate migration. Backups of `/data` include the generated key, so protect them accordingly.

The server never returns plaintext keys, never logs prompts or upstream bodies, and never forwards raw provider errors. It sends only text to fixed OpenAI API endpoints, disables redirects/environment proxies and uses `store:false` in Responses requests. Histories are bounded to 32 messages/64 KiB, output to 4,096 tokens and 64 KiB of text, requests to 60 seconds, with persistent account rate limits and concurrency controls. Provider model listings are filtered conservatively for text families, without guaranteeing every listed model works with Responses. The API contract and error codes are documented in [API.md](API.md).

Tests use an injected HTTP transport and fake upstream with mock keys only: no paid request or live credential is needed. They cover personal precedence (including provider rejection with no shared fallback), shared admin privileges, cross-account/workspace isolation, encrypted storage, key-file persistence/restart, lost-key failure, model-only updates, deletion fallback, payload budgets, filtering, sanitized errors, cancellation and rate limits.
