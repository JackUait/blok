# Blok server + editor wiring map for a real-time collaboration (WebSocket sync) design

All paths relative to `/Users/jackuait/Packages/blok` unless absolute. Researched 2026-08-31 on `main` (711e3f2f).

---

## 0. Headline findings for the multiplayer design

1. **A dormant collaboration seam already exists.** `IBlokAuthorization` (`packages/server/dotnet/Blok.Server.AspNetCore/IBlokAuthorization.cs:5-16`) declares `CanReadDocumentAsync(user, documentId)` / `CanWriteDocumentAsync(user, documentId)` — a per-document authorization contract. It is registered only via `AddBlokServer().UseAuthorization<T>()` (`BlokServerBuilderExtensions.cs:8-17`), is **consumed by nothing** in any endpoint, and the test `DoesNotRegisterUnusedFutureServices` (`Blok.Server.AspNetCore.Tests/BlokServerRegistrationTests.cs:24-41`) pins that it stays unregistered by default — and name-checks a second reserved future service, `Blok.Server.Runtime.IBlokRuntime` (:33-35). Commit ce3cf61a's message says doc enforcement "has to agree with IBlokAuthorization, with the row scope of the planned MySQL package and with a future collaboration room key" — the codebase anticipates exactly this feature.
2. **Document scoping is a guard gap, not a wire gap.** The C# verifier still parses `doc` into `TicketClaims.Document` (`TicketVerifier.cs:135-137,79-83`); the conformance fixtures all carry `"doc":"doc-42"` (`test/unit/server-conformance/fixtures/tickets.json`); only the request guard ignores it (`BlokServerRequestGuard.cs:88-101` reads `Write` and `User` only). Real enforcement needs a document identity in requests (today: `OutputData` has no id, `BlokConfig` has no `documentId`, no route receives one) plus one guard read — no ticket-format change.
3. **The service stores no documents, by stated commitment** (`docs/src/components/server/server-data.ts:384-387`, the `no-documents` limit). The consumer's own endpoint is the system of record via the editor-side `persistence` queue. A sync server must either stay ephemeral (relay + in-memory doc state, consumer endpoint still authoritative) or renegotiate that commitment.

---

## 1. Route registration and gating; what a WebSocket endpoint would look like

### How routes are registered

- `MapBlokServer(this IEndpointRouteBuilder, string pattern = "")` — `packages/server/dotnet/Blok.Server.AspNetCore/BlokServerEndpointRouteBuilderExtensions.cs:11-48`.
  - Pulls `BlokServerOptions` from DI and calls `options.Validate()` at map time (:18-19).
  - `LocalFileEndpoint.Map(endpoints, options)` — file serving mapped OUTSIDE the group (:20).
  - `var routes = endpoints.MapGroup(pattern)` (:21) — everything else lives on this `RouteGroupBuilder`, which is also the return value, so an in-process consumer chains ASP.NET policy onto it: `app.MapBlokServer("/api/blok").RequireAuthorization()` (documented sample at `docs/src/components/server/server-data.ts:125`).
  - `/health` GET/HEAD, `.AllowAnonymous()` (:23-27).
  - **Conditional gating**: `GET /unfurl` only when `!options.UnfurlDisabled` (:29-32); `POST /upload` and `POST /delete` only when `options.HasStorage` (:34-43); `POST /upload-by-url` needs both storage AND unfurl enabled (:39-42). `HasStorage => StorageDirectory != "" || S3Bucket != ""` (`BlokServerOptions.cs:44`). An unconfigured feature's routes are **not mapped at all** — they 404 (documented failure mode, `server-data.ts:144-147, 215-217`).
  - Catch-all 404 with `.WithOrder(int.MaxValue)` (:45) — a new endpoint added to the group automatically wins over it.
- `MapShell` (:50-72): each business route gets three mappings — the real handler wrapped in `Guard(handler, requireWrite: method == "POST")` (:61), an anonymous OPTIONS preflight (:62-66), and a 405 fallback with the `Allow` header (:71).
- `Guard` (:74-87) resolves `BlokServerRequestGuard` per request; the handler runs only if `AllowAsync(context, requireWrite)` passes (origin check → ticket check → rate limit; see §5-6).
- DI: `AddBlokServer` (`BlokServerServiceCollectionExtensions.cs:28-77`) uses `TryAddSingleton` throughout (idempotent), registers `TimeProvider.System`, `IGuardedOutboundPolicy`/`IGuardedOutboundFetcher`, `FixedWindowRateLimiter`, `BlokServerRequestGuard`, and a lazy `IBlobStore` factory that picks S3 vs. local vs. throwing "Blob storage is disabled." (:45-74).

### What a WebSocket endpoint would look like here

- **Nothing WebSocket- or SignalR-related exists anywhere** in `packages/server` (grep for `websocket|signalr|UseWebSockets` across `*.cs`, `*.csproj`, `*.mjs`, `*.ts`: zero hits).
- The natural shape: a new `routes.Map("/sync", ...)` inside `MapBlokServer`, gated on a new options predicate (mirroring `options.HasStorage` at :34), with the ticket/origin check done at the HTTP handshake through `BlokServerRequestGuard` before `HttpContext.WebSockets.AcceptWebSocketAsync()`. The in-process (dotnet path) consumer would inherit `.RequireAuthorization()` from the returned group exactly as uploads do. The Host binary would additionally need `app.UseWebSockets()` in `Program.cs` — nothing calls it today.
- SignalR would be a heavier alternative (`AddSignalR` service registration doesn't fit the current hand-rolled `RequestDelegate` style; every existing endpoint is a static `HandleAsync`).
- **Registration law to respect**: `DoesNotRegisterUnusedFutureServices` (`BlokServerRegistrationTests.cs:24-41`) — new DI services must be deliberate, and double `AddBlokServer()` must stay idempotent (the test calls it twice).

### Hosting constraints (confirmed)

- The Host binary is **Kestrel, single-file, self-contained**: `packages/server/Dockerfile:14-24` (`dotnet publish ... --self-contained true -p:PublishSingleFile=true`) and `scripts/publish-server.mjs:139-153` (same flags for all 8 release archives). `Blok.Server.Host.csproj` itself carries no publish props — the flags live in those two delivery pipelines.
- Plain HTTP only: `builder.WebHost.UseUrls($"http://{listenAddress}")` (`Blok.Server.Host/Program.cs:70`); TLS termination is explicitly external (`server-data.ts:424-427`, `tls-termination` limit). WSS therefore terminates at the reverse proxy — proxies must be configured for WS upgrade pass-through.
- **Timeout hazards a WS route must verify or exempt** (`Program.cs:71,102-127`): `RequestHeadersTimeout` 10s (:110, fine — that's the handshake), Kestrel `KeepAliveTimeout` 2 min (:111), and a **default request-timeout policy of 10 minutes → 504** applied via `AddRequestTimeouts`/`UseRequestTimeouts` (:113-120, :125). Whether the request-timeouts middleware spares upgraded connections is an open design item — the endpoint should carry `[DisableRequestTimeout]`/`.DisableRequestTimeout()` explicitly rather than rely on it.

---

## 2. The ticket contract, exactly

### Format (HS256 JWT, byte-pinned)

- JS signer `blokTicket(secret, claims)` — `packages/server/src/ticket.ts:37-52`. Header is the literal string `{"alg":"HS256","typ":"JWT"}` (:12) and the C# verifier compares the **encoded** header segment ordinally against the hard-coded constant `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9` (`TicketVerifier.cs:16,46`) — reordering keys or adding a space is rejected (pinned by the `noncanonicalHeaderTicket` conformance fixture).
- Payload claims (signer): `user` (consumer's own id, stored never interpreted), `write` (default false), `exp` (unix seconds, `now + ttlSeconds`, default TTL **300 s** — `ticket.ts:5,42-46`). Base64url unpadded, HMAC-SHA256 over `header.payload`, signature base64url.
- Secret: minimum **32 characters**, enforced on both sides — signer throws (`ticket.ts:3-4,38-40`), service refuses to start (`BlokServerOptions.cs:61-63`). Shared via `BLOK_SECRET` env (flag works but warns — `Program.cs:58-63`).

### C# verification (`packages/server/dotnet/Blok.Server/TicketVerifier.cs:23-86`)

Empty secret → fail (:31-34). Exactly 3 non-empty dot segments (:36-44). Encoded header must equal the constant (:46). Signature: HMAC-SHA256 over `segments[0].segments[1]` with UTF-8 secret bytes, compared in constant time with length-leak mitigation (:52-57, :117-128). Payload parsed case-insensitively into `{user, doc, write, exp}` (:130-143); `exp <= now` → fail (:74). Claims returned include `Document` — **which nothing reads**.

### How the guard uses it (`BlokServerRequestGuard.cs:56-101`)

Only in `--auth ticket` mode. `Authorization` header, `Bearer ` prefix optional (:60-62). Missing → 401 "missing pass"; invalid/expired → 401 "invalid pass"; `requireWrite && !claims.Write` → 403 "write access required" (:88-96). `claims.User` re-keys the rate limiter to `user:{id}` (:98-101). `claims.Document` is never consulted.

### Why doc scoping was removed (commit ce3cf61a, 2026-08-29)

`blokTicket` minted a `doc` claim, the verifier parsed it, nothing enforced it — "a consumer who scoped a pass to one document got no scoping and no warning." Enforcement was impossible: nothing in Blok carries a document identity (OutputData has no id, BlokConfig no documentId, no route receives one). The unreleased minting API stopped offering the option (`ticket.ts` diff removes `doc?: string` and the payload spread); the C# verifier deliberately keeps accepting hand-made passes carrying `doc`, so no released wire changed and the byte-pinned fixtures are untouched. Documented as the `ticket-not-scoped` limit (`server-data.ts:419-422`).

### What real per-document enforcement requires

Per the commit and code: (a) a document/room identity that travels with requests — a new `BlokConfig` key (see the 4-edit law, §4) and/or a route parameter/WS room key; (b) the guard (or the WS handshake) reading `claims.Document` against it; (c) agreement with the `IBlokAuthorization` seam (which already has the right shape) and the planned MySQL row scope. For collaboration specifically the "room key" IS the natural document identity — the first route that would ever receive one.

### Conformance suite pattern (where a WS wire contract would be pinned)

- Shared fixture: `test/unit/server-conformance/fixtures/tickets.json` (secret + compatible/expired/malformed/noncanonicalHeader/tampered/userTwo passes, all carrying `doc`), read by both the JS suite (`packages/server/src/ticket.conformance.test.ts`) and the black-box contract test (`test/unit/server-conformance/server-contract.test.ts:62-72`), which drives a **real built binary** (skipped unless `BLOK_CONFORMANCE_SERVER` is set, :26-35; built by `scripts/test-server-conformance.mjs`).
- The conformance binary is a special compile: `#if BLOK_SERVER_CONFORMANCE` in `Program.cs:13-22` plus `BlokServerConformanceExtensions.cs` (swaps the outbound policy for a loopback-only one). CI runs `node scripts/test-server-conformance.mjs --target csharp` (pinned at `test/unit/architecture/server-release-wiring.test.ts:166-188`). The fixture path is allow-listed in gitleaks (`server-quality-gates.test.ts:113-115`).

---

## 3. The persistence client contract (the half a sync server must coexist with)

All in `src/components/utils/persistence.ts` (expansion) + `types/configs/blok-config.d.ts` (public shape).

### Public config shape (`types/configs/blok-config.d.ts`)

- `persistence?: { load(): Promise<OutputData | PersistedDocument | null>; save(data: OutputData, ctx: SaveContext): Promise<SaveResult | void>; onError?(error: unknown): void }` (:636-647).
- `PersistedDocument { data: OutputData | null; version?: string }` (:16-21) — `data` is the envelope discriminator (`OutputData` has no `data` key); `{ data: null }` means "nothing saved yet", never "empty document" (`persistence.ts:28-43`).
- `SaveContext { version: string | null }` (:24-33) — the version this save overwrites. `SaveResult { version?: string }` (:35-42) — returning nothing keeps the held version.
- **Blok only CARRIES the version; comparing two versions is the consumer endpoint's job** (doc comment :600-604 and `persistence.ts:94-97`). The documented pattern is ETag/If-Match (:620-635).

### Expansion and queue semantics (`persistence.ts:100-286`)

- `expandPersistenceConfig` turns `persistence` into an `onSave` handler — and **yields entirely if the consumer set `onSave` themselves** (:103).
- **Newest-only, single-flight queue**: `onSave` overwrites `queue.pending`, un-parks, cancels any running backoff, re-syncs the unload guard, drains (:276-284). `drain` runs one `attemptSave` at a time (:230-244); intermediate payloads are dropped as obsolete; a save superseded mid-retry silently stops (:191-193, :208-210).
- **Retry backoff**: `RETRY_DELAYS_MS = [500, 2000]` — 3 attempts total (:25). After the last failure the payload is **parked** back on `pending` (kept, but never self-restarting — "endless retry loop against a dead endpoint" avoided) and `persistence.onError` fires once (:195-204). The next user change replaces and re-drives it.
- **Version plumbing**: the expansion wraps `load` to capture `version` from a `PersistedDocument` answer (:248-256); each `save` gets `{ version: queue.version }` (:180); a returned `result.version` replaces it (:184-186).
- **Unload guard**: a `beforeunload` preventDefault listener attached only while work exists (in-flight or pending), self-detaching when the queue empties (:139-163).
- **`releasePersistenceQueue(owner)`** (:71-80): keyed per-editor by the expanded persistence object in a module-level `WeakMap` (:55); drops the guard for an editor destroyed with an unwritten save; safe on anything, idempotent. Called from `blok.ts:569` in `destroy()`.
- **Orphan sweep coupling**: a resolved save is the only proof the document was written, and only then are assets the document no longer names swept (:107, :219-227, `attachOrphanSweep` at :262).

### Wiring into the editor (`src/components/core.ts`)

- Expansion order at config-normalization time, before validate and before any module reads config: `expandServerConfig` then `expandPersistenceConfig` (:114-120).
- `pendingPersistedLoad` set only when `config.data == null` — persistence only fills a gap, never overwrites host-passed data (:122-134); awaited once right before first render (:358-380).
- Upstream cadence: `onSave` fires on the trailing edge of a **400 ms** mutation batch window (`src/components/modules/modificationsObserver.ts:192-208, 252-266`; `modificationsObserverBatchTimeout = 400` at `src/components/constants.ts:21`), one serialization per window, never in read-only mode (:225-229).

### Coexistence implications for sync

The queue is last-writer-wins whole-document PUT with consumer-side conflict detection (version compare in THEIR endpoint), in-memory only ("none of this survives a page reload" — `blok-config.d.ts:608-611`). A sync server introduces a second write path to the same document; the design must decide whether sync replaces `persistence` (server persists via consumer webhook/callback), feeds it (sync merges, persistence still snapshots), or suspends it — and whichever way, the newest-only queue's assumption that "the payload is the only copy of the newest document Blok holds" (:197-199) breaks once remote edits exist.

---

## 4. The config-key law (confirmed: FOUR edits + compile-time guards)

Adding a new `BlokConfig` key (e.g. `collaboration`/`documentId`) requires:

1. `types/configs/blok-config.d.ts` — the key itself (`server` :575, `ticket` :586, `persistence` :636 are the precedents).
2. `packages/react/src/config-keys.ts` — add to `USE_BLOK_CONFIG_KEYS` (:11-57; `server`/`ticket`/`persistence` at :53-55). Guard: `as const satisfies readonly (keyof UseBlokConfig)[]` proves membership, and `_MissingConfigKey extends never` (:63-66) makes `tsc` red if a `UseBlokConfig` key is missing from the list — this is what partitions props into "editor config" vs. "container div attribute".
3. `packages/vue/src/config-keys.ts` — add to `BLOK_EDITOR_CONFIG_KEYS` (:16-57, same trio :53-55). Guard: `_UncoveredConfigKey = Exclude<keyof UseBlokConfig, BlokEditorConfigKey | EmitMappedConfigKey>` must be `never` (:73-75); callback-shaped keys can alternatively go to `EmitMappedConfigKey` (:65).
4. `packages/vue/src/BlokEditor.ts` — a declared prop (`server` :81, `ticket` :83, `persistence` :85), because Vue needs props declared to remove them from `$attrs`.

The guards are compile-time (`tsc` under `yarn lint:types`), so forgetting an edit is a build failure, not silent drift. (Project memory: "LAW new config key = 4 edits".)

---

## 5. Auth modes in depth

Validation in `BlokServerOptions.Validate()` (`BlokServerOptions.cs:48-75`); refusal to start is exit code 1 with `blok-server refused to start: ...` (`Program.cs:48-56`).

- **`--auth none`** (default): no per-request auth. **May only bind loopback** — non-loopback listen address refuses to start (:53-56). Origin checks still apply to any request that carries `Origin` or `Sec-Fetch-Site: cross-site` (`BlokServerRequestGuard.cs:31-47`).
- **`--auth proxy`**: "trusts every caller" — identical guard behavior to `none` (no ticket branch), loopback-only enforced the same way (:57-60). The auth is the consumer's own app: their login middleware guards the forwarding route (`server-data.ts:183-192`). Consequence: all traffic arrives from one IP, so the rate limiter sees one caller (`server-data.ts:414-417`).
- **`--auth ticket`**: the exposed mode. Refuses to start without a **>=32-char secret** (:61-63) and without **`--allow-origin`** (:64-67 — "anyone who finds this address can drive requests at third-party sites from your IP"). Per-request: an allowed `Origin` is ALWAYS required (`originRequired` is true whenever `Auth == "ticket"` — guard :31-37), then a valid unexpired pass on every guarded route, then `write: true` for the three POST routes (`/upload`, `/delete`, `/upload-by-url`) while `GET /unfurl` accepts a read-only pass (`requireWrite: method == "POST"`, extensions :61). `/health` and all OPTIONS preflights stay anonymous (:23-27, :62-66).
- Unknown mode string refuses to start (:72-74). Additional startup refusals: bad listen address / DNS hostname bind (:242-308), `--max-upload <= 0` (:79-84) or `> Array.MaxLength` with remote unfurl on (:86-91), negative rate limit (:93-97), and the whole S3 option battery (:104-170; credentials only via `BLOK_S3_ACCESS_KEY`/`BLOK_S3_SECRET_KEY` env, :159-164).
- In-process ASP.NET path: no guard modes — the consumer chains `.RequireAuthorization()` (or anything) on the returned route group and can plug `UseAuthorization<T>` for the (currently unenforced) `IBlokAuthorization` seam.

**WS design note (flagged inference):** the guard reads the pass from the `Authorization` header, but the browser `WebSocket` API cannot set headers — a WS route needs the ticket via query string, `Sec-WebSocket-Protocol`, or cookie. And with a 300 s default TTL, connections will outlive passes; the existing precedent for that bug class is the bookmark tool's fixed-headers failure mode (`server-data.ts:367-372`). Decide: authenticate at handshake only, or re-authenticate in-band.

---

## 6. Rate limiting

- `FixedWindowRateLimiter` (`packages/server/dotnet/Blok.Server.AspNetCore/FixedWindowRateLimiter.cs`): fixed **1-minute** window (:5), lock-guarded in-memory `Dictionary<string, Window>` (:10, :29-52), lazily swept (:54-70). `RateLimitPerMinute <= 0` disables entirely (:24-27).
- **Per-what**: per caller key, checked once per HTTP request in the guard AFTER auth (`BlokServerRequestGuard.cs:104-112`). Key is `addr:{RemoteIpAddress}` (:117-120), upgraded to `user:{claims.User}` when a ticket names a user (:98-101). Default: **60/min in ticket mode, 0 (off) otherwise** (`HostArguments.cs:14, 190-191`; pinned by `HostProcessTests.cs:536-550`).
- **WS interaction**: a long-lived WebSocket costs **one count at the handshake**; per-message sync traffic is invisible to it — so it does not throttle a chatty connection, and 60/min does not meaningfully limit connection storms either (60 new sockets/min/user allowed). A sync design needs its own connection/message limits.
- **Multi-node caveat**: the store is process-local memory — a horizontally scaled sync tier inherits a single-instance assumption here (as it does from local `--storage-dir`).
- Proxy-mode footgun is documented: all users share one allowance (`server-data.ts:414-417,231-235`).

---

## 7. Quality gates new server code must pass

- **`packages/server/dotnet/Directory.Build.props:1-13`**: `AnalysisLevel latest-recommended`, `AnalysisMode Recommended`, `EnableNETAnalyzers`, `EnforceCodeStyleInBuild`, **`TreatWarningsAsErrors`**, `NuGetAudit` (mode `all`, level `low`), NU1901-NU1904 as errors. All pinned by `test/unit/architecture/server-quality-gates.test.ts:44-56`.
- **Coverage floors: 80% lines AND 80% branches**, whole-solution Cobertura (`scripts/check-server-coverage.mjs:4-7`); CI collects `--collect:"Code Coverage;Format=Cobertura"`, runs reportgenerator (pinned version 5.5.11) and the checker (`server-quality-gates.test.ts:58-76`). New code is measured collectively — an under-tested WS module drags the whole solution below the floor.
- **Formatting pin**: `dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes` in CI and in the release workflow (`test/unit/architecture/server-release-wiring.test.ts:180, 263`).
- **`OutboundClientArchitectureTests`** (`packages/server/dotnet/Blok.Server.Tests/OutboundClientArchitectureTests.cs`): a Roslyn semantic scan over all non-test sources. Restricted types (:10-23): `HttpClient`, `HttpClientHandler`, `HttpMessageInvoker`, `IHttpClientFactory`, `HttpWebRequest`, **`Socket`**, `SocketsHttpHandler`, **`SslStream`**, **`TcpClient`**, `WebClient`, `WebRequest`, plus any `AddHttpClient` call (:361-376). Only two owners: `GuardedOutboundFetcher.cs` (whole file exempt) and `S3BlobStore.cs` (exactly one `client` field + one creation + one `CreateHandler`, structurally verified :305-322). It catches aliases, escapes, target-typed `new`, and error-type name matches. **An inbound WS endpoint constructs none of these** (Kestrel owns the socket); note `ClientWebSocket` is absent from the list, so an outbound WS client would currently slip past the law — extend the list if one is ever added, and any server-to-server HTTP (webhooks to the consumer's persistence endpoint) must go through `IGuardedOutboundFetcher`.
- **Security jobs** (pinned by `server-quality-gates.test.ts:78-130`): gitleaks (singular `[allowlist]` table — the plural form silently allows nothing), trivy twice (fs + `blok-server:ci` image built from the Dockerfile), CodeQL init/analyze, `dotnet restore` audit. Dependabot covers `nuget /packages/server/dotnet`, `docker /packages/server`, `github-actions /` (:132-144).
- **Registration/architecture pins**: `DoesNotRegisterUnusedFutureServices` + idempotent double-`AddBlokServer` (`BlokServerRegistrationTests.cs:24-41`); release wiring test pins the family version, the ticket-signer suite in CI, the conformance run, the 8 archive names, the pinned action SHAs, and "two NuGets, eight hosts, checksums, and a multi-architecture image" (`server-release-wiring.test.ts:21-30, 145-152, 166-188, 225+`).
- **JS side**: `yarn workspace @bloklabs/server test` runs in CI (`server-release-wiring.test.ts:145-152`); the published `.d.ts` is hand-authored and must not reach outside its tarball (`packages/server/types/index.d.ts:1-8`; the repo-wide published-types law).

---

## 8. Delivery, and what complicates a stateful long-lived-connection feature

### npx wrapper (`packages/server/bin/blok-server.mjs`)

Ships no binary. On first run: resolves platform/arch/libc (musl via `process.report` glibc probe, :37-41; 8 targets incl. `linux_musl`, :25-31), downloads `checksums.txt` then the archive from the GitHub release `v{package.json version}` (:196-206), verifies sha256 (:211-216), unpacks with `tar -xf` into a scratch dir and single-renames into a per-OS cache (`~/Library/Caches/blok-server` etc., :107-121, :242-250), then execs it. Docker image (`ghcr.io/jackuait/blok-server`) is the fallback message (:293-302). **The wrapper DOES forward SIGINT/SIGTERM to the child and re-raises the child's exit signal on itself** (:263-286, :353-355) — signal delivery through npx is not the problem.

### Docker image (`packages/server/Dockerfile`)

Multi-stage: SDK 10.0 publishes the Host **self-contained single-file** (`--self-contained true -p:PublishSingleFile=true`, :14-24); final stage is `runtime-deps:10.0` containing ONLY `/blok-server` and an empty `/data` owned by non-root `65532` (:28-33). Exec-form `ENTRYPOINT ["/blok-server"]` (:35) → the binary is PID 1 and receives SIGTERM directly. `EXPOSE 4000`, plain HTTP.

### Stateful-feature complications (the accurate SIGTERM picture)

- **Graceful shutdown is framework-default only — nothing custom exists.** `Program.cs:86-98` is `StartAsync` → `WaitForShutdownAsync`; the generic host's ConsoleLifetime handles SIGTERM/SIGINT, but there is **no** `HostOptions.ShutdownTimeout` configuration, no `IHostApplicationLifetime` hook, no connection-drain logic anywhere, and the host tests only ever hard-`Kill` the process (`HostProcessTests.cs:102, 510, 830, 1061, 1082, 1217` — `Kill(entireProcessTree: true)`; no SIGTERM/graceful test in the 1224-line file). Long-lived WS connections would be severed at whatever the framework default allows; a sync design needs explicit drain (stop accepting, flush rooms, close with a going-away code) and a test that exercises SIGTERM at all.
- **The 10-minute default request timeout and 2-minute Kestrel keep-alive** (§1) must be explicitly reconciled with connections meant to live for hours.
- **No shared state anywhere**: single binary, in-memory rate limiter, local disk or S3 for blobs, no database ("There is no database inside it" — `server-data.ts:386`). Room state for sync either stays in-process (pinning one instance per document — needs sticky routing) or introduces the service's first external state dependency.
- **TLS/proxy topology**: every internet-facing deployment path routes through a reverse proxy (`server-data.ts:424-427`); the `own-server` path proxies through the consumer's app (`http-proxy-middleware` sample, :183-192) — WS support on that forwarding route (`ws: true` etc.) becomes a new documented consumer obligation.
- Versioning: release archives/NuGets/image all stamp the same family version (`BlokServerVersion` assembly metadata, `Program.cs:43-46`; `server-release-wiring.test.ts:159-164`) — the wrapper downloads the binary matching its own npm version, so editor↔server protocol versioning gets a free ride from the family version, but only per-release.

### Storage layer (context for assets in a collab session)

- `IBlobStore` (`packages/server/dotnet/Blok.Server/Storage/IBlobStore.cs:3-14`): just `PutAsync(extension, mimeType, stream) → url` and `DeleteAsync(url)`.
- `LocalBlobStore`: atomic temp-write + rename, explicit unix modes, fsync (`LocalBlobStore.cs:17-75`).
- `S3BlobStore` (`S3BlobStore.cs`) with **hand-written SigV4** (`S3RequestSigner.cs:8-12`) — "has never been run against a real bucket" is a documented limit (`server-data.ts:399-402`). Its `HttpClient` may only reach the operator-configured endpoint; consumer URLs go through the guarded fetcher (comment at `S3BlobStore.cs:44-45`).

### The four documented consumer paths (`docs/src/components/server/server-data.ts:3, 59-375`)

`own-storage` (no service; presets uploader), `dotnet` (in-process `AddBlokServer`+`MapBlokServer`, consumer's own authz), `own-server` (standalone on loopback, `--auth proxy`, consumer's app forwards), `serverless` (standalone public, `--auth ticket`, consumer mints passes). A sync feature must slot into all four: in-process (hub in consumer's app), sidecar-behind-proxy (WS pass-through on the forwarding route), and public-ticketed (handshake auth) — while `own-storage` simply has no server to sync through.

---

## Appendix: editor-side `server`/`ticket` expansion (for symmetry)

`expandServerConfig` (`src/components/utils/server-config.ts:55-96`): `server` is pure sugar expanded once at config-normalization (`core.ts:114-118`) — fills `uploader` (a `createFetchUploader` at `{base}/upload|/upload-by-url|/delete`, `src/components/utils/fetch-uploader.ts:43-101`) and the bookmark tool's `endpoint` (`{base}/unfurl`); anything explicit wins. `ticket` builds ONE shared `createPassSource` (`src/components/utils/access-pass.ts:51-98`): fetches `{ ticket }` from the consumer's endpoint with same-origin credentials, caches the pass, refreshes **30 s before expiry** (:5), and coalesces concurrent mints (:88-92). A WS client would want to reuse exactly this pass source — note it currently returns `Authorization` headers, which WS handshakes can't carry from a browser (§5).
