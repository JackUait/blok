# Blok cloud host

Go product host embedding Blok's existing server. PostgreSQL stores identities, sessions, access control, workspace indexes and document projections. Blok's local collaboration journal remains the durable operation source. Run exactly one application instance against a journal directory.

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

Integration tests create and drop a unique PostgreSQL schema. They use an in-memory mail function and send no live email. They verify authentication and single-use codes, join approval, invitation acceptance, viewer restrictions, admin invariants, index revisions and PR25 metadata, internal document isolation, actual Blok room loading and live duplication, seeding guards, private signed file grants, logout/session revocation and one-time bootstrap behavior.

The API contract is in [API.md](API.md). Tickets contain a session digest rather than a reusable bearer token. This permits immediate rechecking of logout, session expiry and membership/role changes, including established WebSockets. Logout, role changes, member removal and workspace index changes trigger Blok `RecheckAccess` immediately; an observed-document sweep rechecks expiry every five seconds and closes denied live sockets. Journal actor identifiers therefore represent sessions; they are not stable user profile identifiers.

## Data safety

Back up PostgreSQL, the **entire** journal directory, uploads, configuration and deployed version together after draining/stopping the application. A PostgreSQL-only backup may omit the newest acknowledged collaboration changes. Restore all components before restarting one instance. Soft deletion/trash only blocks access; journal and assets remain retained for history and restores. Uploaded assets are private to workspace membership, including retained/duplicated documents.

Seed content is accepted only for a new empty document before any collaboration ticket has been issued. Subsequent body edits use Blok collaboration; direct checkpoint JSON overwrites are not a public API. Duplication reads the live room snapshot before creating an independent document.
