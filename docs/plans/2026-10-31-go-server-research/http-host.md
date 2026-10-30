# Go server parity ledger: http-host

Area: `Blok.Server.Host`, the non-collab parts of `Blok.Server.AspNetCore`, and the `Tickets`, `Storage`, `Outbound` and `Metadata` folders of `Blok.Server`.

Research only. Every C# location is `file:line` as read on 2026-10-31. A claim backed by a probe I ran names it as **[probe]**. Anything I could not check is marked **UNVERIFIED**.

Paths, shortened:
- `Host/` = `packages/server/dotnet/Blok.Server.Host/`
- `Asp/` = `packages/server/dotnet/Blok.Server.AspNetCore/`
- `Srv/` = `packages/server/dotnet/Blok.Server/`
- `SC` = `test/unit/server-conformance/server-contract.test.ts`
- `BC` = `test/unit/server-conformance/blok-client-contract.test.ts`
- `HC` = `test/unit/server-conformance/harness-contract.test.ts`
- `OLD` = the deleted Go tree at `ad5782d7^:packages/server/` (read with `git archive`)

Probes:
- **[probe-cs1]**: .NET 10, `IPAddress.TryParse`, `System.Text.Json` escaping, `Uri`, `Path.GetExtension`, `File.Delete`.
- **[probe-cs2]**: .NET 10, `Array.MaxLength`, `MediaTypeHeaderValue.TryParse`, `JsonSerializer` ticket and envelope cases.
- **[probe-go]**: Go 1.27.1. ServeMux 404/405 wire, path cleaning, `mime.ParseMediaType`, `encoding/json`, `net.ParseIP`, `net/url` on the same inputs.
- **[probe-kestrel]**: real Kestrel 10 with the same `MapGroup`/`MapMethods`/`MapGet`/`Map(...).WithOrder` calls as the route builder, driven over raw TCP. Results are in §8.

Probe code lives under `/private/tmp/claude-501/-Users-jackuait-Packages-blok/1972ea3d-88af-4e14-951b-0edd9367e8e3/scratchpad/http-host/`.

Proposed Go layout. This is a **proposal**, and the paths are new:

```
packages/server/go/                      module github.com/JackUait/blok/packages/server/go
  blokserver/        options.go validate.go handler.go router.go guard.go cors.go ratelimit.go
                     health.go upload.go uploadwire.go multipart_qp.go uploadbyurl.go unfurl.go
                     delete.go localfile.go authorization.go user.go timeouts.go
  blokserver/ticket/ mint.go verify.go
  blokserver/internal/blob/      key.go local.go s3.go s3target.go s3sign.go mediatype.go
  blokserver/internal/outbound/  policy.go fetcher.go decode.go tls_darwin.go tls_other.go
  blokserver/internal/unfurl/    parse.go
  cmd/blok-server/   main.go args.go baseint.go conformance.go conformance_disabled.go collab.go
```

---

## 1. Parity ledger

Oracle column:
- `SC:<line> '<name>'` is a black-box conformance test.
- `fixture:<dir>` is an existing shared fixture.
- `NONE→F<n>` means there is no oracle today. F-numbers point to the fixture proposals in §2.

### 1a. CLI flags, env vars, process exit (Blok.Server.Host)

| ID | Feature | C# location | What it does | Oracle | Go file |
|---|---|---|---|---|---|
| H1 | flag grammar | Host/HostArguments.cs:90-188 | Go-`flag`-style parse: `-x`/`--x`, `=value` or next arg. Stops at `--` or the first non-flag. | SC:789 'exits with the contract code for $name' (unknown flag) | cmd/blok-server/args.go (stdlib `flag.FlagSet`, ContinueOnError) |
| H2 | `-h`/`--help` | HostArguments.cs:109-112; Program.cs:28-32 | Prints Usage to stderr, exit 0. | SC:789 (help) | args.go |
| H3 | unknown flag | HostArguments.cs:170-173; Program.cs:34-39 | `flag provided but not defined: -NAME` + Usage, exit 2. | SC:789 (unknown flag) | args.go |
| H4 | missing value | HostArguments.cs:185-188 | `flag needs an argument: -NAME`, exit 2. | NONE→F1 | args.go |
| H5 | Usage text | HostArguments.cs:19-67 | Hand-written usage block starting `Usage of blok-server:`. | SC:789 checks the prefix only | args.go: set `fs.Usage` to print this exact text. Go's `PrintDefaults` format differs. |
| H6 | `--listen` | :192-194; Options.cs:35 | Default `127.0.0.1:4000`. | SC:940 'rejects malformed listen address…' | args.go |
| H7 | `--auth` | :195-197; Options.cs:43 | `none`, `proxy` or `ticket`. Default `none`. | SC:789 (unknown auth mode) | args.go |
| H8 | `--secret` + `BLOK_SECRET` | :198-201, 277-280 | The flag wins **even when given as empty** (`secretFromFlag` is set by presence). Otherwise env. | SC:752 'reads BLOK_SECRET and lets an explicit secret override it' | args.go (use `fs.Visit` to detect presence; OLD used `!= ""`, which is wrong; see T3) |
| H9 | `--secret` warning | Program.cs:58-63 | One stderr warning line when the secret came from the flag. | NONE→F1 | main.go |
| H10 | `--allow-origin` | :202-204, 270, 536-542 | Comma split, trim, drop blanks. | SC:376/445 tables | args.go |
| H11 | `--storage-dir` | :79, 205-207 | Default `./blok-uploads`. Empty means no local storage. | SC:358 'unregisters both upload routes when storage is absent' | args.go |
| H12 | `--public-url` default | :208-210, 271-273, 544-590 | Empty means `http://HOST:PORT/files`. A wildcard or empty host becomes 127.0.0.1. IPv6 is bracketed. | NONE→F1 (C#: HostProcessTests 'UsesALoopbackPublicUrlForWildcardListeners') | args.go |
| H13 | `--max-upload` | :211-219, 413-534 | Base-0 int64 (`0x`, `0o`, `0b`, a leading `0` means octal, `_` separators). Default 32 MiB. | SC:1328 'applies max-upload…'; SC:1358 'refuses a zero upload cap…' | args.go: `fs.Int64Var` uses `strconv.ParseInt(s,0,64)`, the same grammar (T4) |
| H14 | `--rate-limit` | :220-228, 274-275 | Base-0 int64. Absent means 60 in ticket mode, else 0. An explicit negative is refused later. | SC:662 'uses the default ticket limit of 60…'; SC:696 | args.go (OLD used -1 for "auto"; see T2) |
| H15 | `--no-unfurl` | :114-130 | Bool flag; `=true/false/1/0/t/f/T/F/TRUE/True…` (Go ParseBool set, :387-411). | SC:340 'unregisters both outbound routes when unfurling is disabled' | args.go (`fs.BoolVar`) |
| H16 | `--s3-*` (5 flags) | :229-243 | Endpoint, region, bucket, bucket-url, addressing. | SC:789 S3 rows; SC:1652 | args.go |
| H17 | `BLOK_S3_ACCESS_KEY`/`_SECRET_KEY` | :311-312 | Env only. There is no flag. | SC:789 'S3 without credentials' | args.go |
| H18 | `--collab` | :132-148 | Bool flag. | sync-contract / protocol-v2 (collab area) | args.go |
| H19 | `--doc-endpoint` | :244-246 | URL for seed and export. | sync-contract (collab area) | args.go |
| H20 | `--doc-endpoint-auth` + `BLOK_DOC_ENDPOINT_AUTH` | :247-250, 282-285; Program.cs:65-70 | The flag wins by presence. A warning prints when it comes from the flag. | NONE→F1 (C#: 'WarnsWhenTheDocEndpointAuthComesFromTheFlag' and 3 more) | args.go |
| H21 | `--collab-dir` | :78, 251-253 | Default `./blok-collab`. | sync-contract uses it | args.go |
| H22 | `--collab-s3-prefix` | :254-256 | Working set in the bucket. | NONE→F1 | args.go |
| H23 | `--collab-journal` + `BLOK_COLLAB_JOURNAL` | :150-168, 287-297 | Bool. The flag wins by presence. The env must parse as ParseBool, or exit 2 with `invalid value "…" for BLOK_COLLAB_JOURNAL: parse error`. | NONE→F1 (C#: 'ReadsTheCollabJournalFromTheEnvironmentUnlessTheFlagIsGiven') | args.go |
| H24 | `--rich-text-fields` + `BLOK_RICH_TEXT_FIELDS` | :257-266, 299-309, 354-385 | A JSON object of string arrays. A duplicate key, a non-object or a non-string fails with exit 2 `parse error`. | NONE→F1 (C#: 'RefusesRichTextFieldsThatAreNotAnObjectOfStringLists') | args.go (Go `encoding/json` does NOT fail on duplicate keys; see T6) |
| H25 | value-parse error wire | :124-125, 214-216, 260-261 | `invalid value "V" for flag -NAME: parse error`, exit 2. | SC:789 indirectly; C# 'RefusesInvalidOrOverflowingBaseZeroIntegers' checks the prefix | args.go (Go's suffix for overflow is `value out of range`; prefix matches; T4) |
| H26 | version | Program.cs:43-46; Host.csproj:8,13 | Comes from assembly metadata `BlokServerVersion`. Default `dev`. | SC:275 'returns the exact ungated health response…' (version "dev") | main.go: `var version = "dev"` set by `-ldflags -X` (OLD main.go:17) |
| H27 | startup refusal | Program.cs:48-56 | `Validate()` throws, which prints `blok-server refused to start: MSG` and exits 1. | SC:789 rows (exit 1) | main.go |
| H28 | listen `:PORT` | Program.cs:74-77 | A leading `:` becomes `0.0.0.0:PORT`. **IPv4 only.** | NONE→F1 (C# 'StartsOnABlankHostListenerInTicketMode', 'KeepsPortZeroWhenBindingABlankHostListener') | main.go (Go `net.Listen("tcp",":p")` is dual-stack; must rewrite to `0.0.0.0`; T7) |
| H29 | "listening" line | Program.cs:105-107 | Printed **after** a successful bind: `blok-server VERSION listening on LISTEN (--auth MODE)`. LISTEN is the raw flag text. | HC:31, HC:47; every `startServer` waits for `' listening on '` (server-process.ts:14,133) | main.go: `net.Listen` first, then print, then `Serve` (OLD printed before binding; T8) |
| H30 | bind failure | Program.cs:111-115 | `blok-server refused to start: …`, exit 1. The harness retries when the message contains `address already in use` (run-against.ts:130-132). | HC:47 'takes another port when the one it allocated is already taken' | main.go (Go's message contains `bind: address already in use`) |
| H31 | header timeout | Program.cs:136 | Request headers must arrive in 10 s. | NONE→F1 | main.go (`ReadHeaderTimeout`) |
| H32 | keep-alive idle | Program.cs:123,137 | 2 min between requests. It does not apply to upgraded sockets. | NONE (C# HostCollabTests 'ASyncSocketOutlivesKestrelsKeepAliveTimeout') | main.go (`IdleTimeout`) |
| H33 | request deadline | Program.cs:121,139-146,151 | Each request gets 10 min. On expiry the answer is **504** and the request token is cancelled. Downstream S3 is cancelled too. Sync opts out. | NONE→F1 (C# 'CancelsBlockedStorageWorkAtTheHostDeadline', 'CancelsAStalledRequestBodyAtTheHostDeadline' assert `HTTP/1.1 504`) | blokserver/timeouts.go: ctx deadline middleware that writes 504 if nothing was written. **Not** `http.TimeoutHandler` (it answers 503 and buffers). **Not** `ReadTimeout`/`WriteTimeout` (they reset the socket). T9 |
| H34 | shutdown timeout | HostCollab.cs:23,38 | 30 s. | BC:908 'reports offline with close 1001 when the server drains on SIGTERM' | main.go |
| H35 | SIGTERM drain | HostCollab.cs:77-119 | Drain rooms first (new upgrades get 503, rooms flush, members close 1001), then stop Kestrel. A drain failure prints `warning: collab: the shutdown drain did not complete: …` and the process still exits 0. | BC:908; C# 'DrainsSyncRoomsOnSigterm', 'ExitsCleanlyOnSigtermWithoutCollab' | cmd/blok-server/collab.go: `signal.NotifyContext`, then `srv.Drain(ctx)`, then `http.Server.Shutdown` (it does not track hijacked conns; T10) |
| H36 | upgraded-conn cap | HostCollab.cs:31,45-49 | 1024 with `--collab` only. Also copied to `CollabMaxConnections` (503 before seed). | NONE (C# 'RefusesUpgradesBeyondTheConcurrentLimit', 'BoundsUpgradedConnectionsOnlyWithCollab') | collab.go: set `Options.CollabMaxConnections=1024`. Go has no Kestrel backstop, so the service count is the only gate. |
| H37 | collab stderr logger | HostCollab.cs:50,126-168 | Forwards only the `Blok.Server.Collab` category at Warning or above, as `warning: …` / `error: …` lines. Every other log is silenced (Program.cs:73). | NONE (C# 'SurfacesCollabWarningsOnStandardError') | collab.go: `Options.Logger` = stderr `slog` handler, collab-only |
| H38 | WebSockets on | HostCollab.cs:55-64 | Only with `--collab`. | collab area | collab.go |
| H39 | conformance build | Directory.Build.props:20-22; Program.cs:13-22,84-96 | `BLOK_SERVER_CONFORMANCE` compiles in two extra flags. The ordinary build rejects them as unknown flags. | SC:1390, SC:1407 'keeps the conformance-only … flag out of an ordinary binary' | conformance.go `//go:build conformance` / conformance_disabled.go (OLD pattern, reusable) |
| H40 | `--conformance-origin` | Host/ConformanceArguments.cs:46-98 | Must be exactly `http://127.0.0.1:PORT`, PORT 1..65535, nothing else. On error: requirement text, exit 2. It is pre-filtered **before** host parsing, at any argv position before `--`. | SC:1369 'accepts only an exact HTTP 127.0.0.1 origin in the tagged binary' | conformance.go (`fs.Func`; Go error prefix differs but contains the requirement; T11) |
| H41 | `--conformance-journal` | ConformanceArguments.cs:40-44; Program.cs:92-95 | Puts the local journal behind collab without `CollabJournal`. | protocol-v2-contract (collab area) | conformance.go |

### 1b. Options and Validate (startup refusals)

All rows are in `Asp/BlokServerOptions.cs`. Message strings must match byte for byte. Tests use `toContain`.

| ID | Refusal / option | C# location | What it does | Oracle | Go file |
|---|---|---|---|---|---|
| V1 | Options defaults | :20-265 | Version dev, listen 127.0.0.1:4000, auth none, MaxUpload 32 MiB, **UnfurlDisabled=true in-process** (the host sets false), PerUserPerDoc 8, MaxMessage 1 MiB, KeepAlive 15 s, frames/s 50, burst 100, resyncs/min 60, awareness 128 KiB/s. | NONE→F2 | blokserver/options.go |
| V2 | auth none off loopback | :291-294 | `--auth none serves anyone who can reach "L"{scope}; it may only bind loopback — …` | SC:789 'non-loopback anonymous listener' | validate.go |
| V3 | auth proxy off loopback | :295-298 | `--auth proxy trusts every caller, so it may only bind loopback, not "L"{scope} — …` | NONE→F1 | validate.go |
| V4 | short secret | :299-301; Tickets/BlokTicket.cs:27 | `--secret must be at least 32 characters (got N)`. **N counts UTF-16 units.** | SC:789 'short ticket secret' | validate.go (count `utf16.RuneLen` units, not bytes; T12) |
| V5 | ticket without origins | :302-305 | `a public service needs --allow-origin: …` | SC:789 'missing ticket origin' | validate.go |
| V6 | bad auth | :310-312 | `--auth must be none, proxy, or ticket (got "X")` | SC:789 | validate.go |
| V7 | listen grammar | :631-697 | `listen tcp: address L: missing port in address` / `too many colons` / `address P: invalid port` / `DNS host "H" would bind every network interface; …`. Allows `*`, `+`, empty, `localhost`, or an IP **as .NET parses it**. | SC:940 (localhost, localhost:65536); C# 'RejectsDnsListenHostsThatKestrelWouldTreatAsWildcards' | validate.go (needs a .NET-compatible IPv4 parser; T1) |
| V8 | loopback test | :699-720 | localhost (case-insensitive), a loopback IP, or IPv4-mapped loopback. | SC:789 | validate.go |
| V9 | bind-scope suffix | :722-735 | ` (an address with no host binds every network interface)` / ` (which binds every network interface)` | NONE→F1 | validate.go |
| V10 | max-upload ≤ 0 | :317-322 | `--max-upload must be a positive number of bytes (got N): a zero cap refuses every upload` | SC:1358 | validate.go |
| V11 | max-upload > Array.MaxLength | :324-329 | Only with storage and unfurl on: `--max-upload must be no greater than 2147483591 bytes when remote URL upload is enabled (got N)`. **[probe-cs2]** `Array.MaxLength=2147483591`. | NONE→F1 (C# 'RejectsUploadLimitsLargerThanManagedArrays…', 3 tests) | validate.go (hard-code 2147483591) |
| V12 | negative rate limit | :331-335 | `--rate-limit must be zero or greater (got N)` | NONE→F1 (C# 'RejectsEveryExplicitNegativeRateLimit') | validate.go |
| V13 | collab numeric caps | :415-474 | Seven refusals, for PerUserPerDoc, MaxConnections, MaxMessageBytes, KeepAlive, frames/s, burst, resyncs and awareness. Each has its own message. | NONE→F2 (in-process only; no flag) | validate.go |
| V14 | RichTextFields | :454-461 | `RichTextFields: …` (from `RichTextFields.With`). | fixture:rich-text-fields.json (collab area) + C# 'RefusesToStartWithAnEmptyRichTextBlockType' | validate.go |
| V15 | doc-endpoint without collab | :478-482 | `--doc-endpoint needs --collab: …` | NONE→F1 | validate.go |
| V16 | collab-s3-prefix without collab | :484-488 | Refused. | NONE→F1 | validate.go |
| V17 | journal without collab | :490-494 | Refused. | NONE→F1 | validate.go |
| V18 | journal + s3 prefix | :499-504 | Refused. | NONE→F1 | validate.go |
| V19 | collab without doc-endpoint | :506-511 | Refused. | NONE→F1 | validate.go |
| V20 | doc-endpoint shape | :513-528 | Absolute http(s), host, no userinfo, query or fragment. HTTP only on loopback (`Uri.IsLoopback`). | NONE→F1 + F3 | validate.go |
| V21 | doc-endpoint-auth CR/LF | :530-535 | Refused. | NONE→F1 | validate.go |
| V22 | s3 prefix without bucket | :537-541 | Refused. | NONE→F1 | validate.go |
| V23 | collab-dir inside storage-dir | :543-559 | Lexical `GetFullPath` prefix check, ordinal. | NONE→F1 | validate.go (`filepath.Abs` + `Clean`; trailing-separator handling per C# 'RejectsACollabDirectoryEqualToATrailingSlashStorageDirectory') |
| V24 | local PublicUrl | :562-593 | No `?`/`#`. Must be an http(s) URL or root-relative (`/x`, not `//`, no `\`). It resolves `LocalPublicPath` (AbsolutePath trimmed of `/`). | NONE→F1 + F3 (C# 'RejectsUnsafeLocalPublicUrls', 'RefusesAMalformedLocalPublicUrlBeforeBinding') | validate.go |
| V25 | malformed `%` escape | :609-629 | `%` not followed by 2 hex digits means invalid PublicUrl / S3BucketUrl. | NONE→F3 | validate.go |
| V26 | s3 without endpoint | :349-353 | Refused. | SC:789 'S3 without endpoint' | validate.go |
| V27 | s3 endpoint shape | :355-365 | Origin only. `AbsolutePath.Trim('/')` must be empty. | SC:789 'S3 with a malformed endpoint' | validate.go |
| V28 | s3 http off loopback | :367-372 | Refused. | NONE→F1 (C# 'RejectsNonLoopbackHttpS3Endpoints') | validate.go |
| V29 | s3 without region | :374-378 | Refused. | SC:789 | validate.go |
| V30 | s3 without bucket-url | :380-384 | Refused. | SC:789 | validate.go |
| V31 | bucket-url `?#` | :386-390 | Refused. | NONE→F1 | validate.go |
| V32 | bucket-url shape | :392-397 | Refused. | NONE→F3 | validate.go |
| V33 | s3 credentials | :399-404 | Refused. | SC:789 'S3 without credentials' | validate.go |
| V34 | s3 addressing | :406-410 | `--s3-addressing must be "path" or "virtual", or empty to choose automatically (got "X")` | SC:789 | validate.go |
| V35 | Validate idempotent + lazy | :271-286; Asp/BlokServerServiceCollectionExtensions.cs:74,96,200; Asp/BlokServerEndpointRouteBuilderExtensions.cs:72 | Runs at AddBlokServer, MapBlokServer and every lazy factory. A post-registration mutation is still checked. | NONE (C# 'ValidatesPreRegisteredOptionsBeforeMappingRoutes', '…ResolvingStorage') | options.go: `New(opts)` validates; `Handler()` validates again |

### 1c. Library API (AddBlokServer, MapBlokServer, hooks)

| ID | Feature | C# location | What it does | Oracle | Go file |
|---|---|---|---|---|---|
| L1 | AddBlokServer (3 overloads) | Asp/BlokServerServiceCollectionExtensions.cs:22-49,68-186 | Validates, registers the options instance as a singleton, and TryAdds every service. **First registration wins**, so a host can override the blob store, fetcher, clock or room manager. | NONE (C# BlokServerRegistrationTests: 55 tests) | handler.go `New(Options) (*Server, error)` with override fields (see §5) |
| L2 | does NOT warm documents | :78-85 | Calls `AddBlokDocuments(warmUp:false)`. | NONE (C# 'DoesNotRegisterUnusedFutureServices') | handler.go (lazy converter) |
| L3 | blob store selection | :93-113 | S3 if a bucket is set, else local if a dir is set, else throws `Blob storage is disabled.` | NONE (C# 'UsesTheRegisteredOptionsForBlobStoreSelection', 'HonorsAnExistingBlobStoreOverride') | handler.go |
| L4 | collab store selection | :115-135 | S3 prefix, else dir, else throws. Lazy. | collab area | handler.go |
| L5 | doc-endpoint timeout | :15,157-161 | 30 s per doc-endpoint request. | collab area | handler.go |
| L6 | S3 spool dir and cap | :210-226 | `Path.GetTempPath()`. The spool cap is MaxUploadBytes. | NONE→F7 | handler.go |
| L7 | MapBlokServer(pattern) | Asp/BlokServerEndpointRouteBuilderExtensions.cs:64-125 | Maps the group under a prefix. Everything not claimed in the group answers 404 (`/{**path}`, order max). | SC:290 'returns the frozen method and unknown-route responses' | handler.go `(*Server).Handler(prefix string) http.Handler` |
| L8 | local files mapped OUTSIDE the group | :73 (`LocalFileEndpoint.Map(endpoints, …)` before `MapGroup`) | With a prefix, files are still served at the public-URL path from the app root. | NONE→F1 (in-process) | handler.go: return a handler that dispatches the file prefix before the group, or expose `(*Server).FilesHandler()` |
| L9 | open-routes warning | :25-31,115-119,133-150 | Collab on, auth none and no IBlokAuthorization logs one Warning under category `Blok.Server.AspNetCore`. **The standalone host never prints it** (H37 forwards only `Blok.Server.Collab`). | NONE→F2 | handler.go (log via `Options.Logger` with a category attr; cmd filters it out) |
| L10 | UseAuthorization<T> | Asp/BlokServerBuilderExtensions.cs:22-31 | Replaces any earlier registration. Singleton. | NONE (C# 'RegistersCustomAuthorizationForCompatibility', 'ApplicationAuthorizationProtectsGuardedRoutesOnly') | `Options.Authorization` |
| L11 | IBlokAuthorization | Asp/IBlokAuthorization.cs:20-54 | `CanRead`/`CanWrite(user, docId, ct)`. They only NARROW access. Not consulted on upload/unfurl/delete. | collab area (sync/edit/reset/history) | authorization.go (§5) |
| L12 | ticket principal | Asp/Collab/SyncHandshake.cs:332-354 | Auth type `blok-ticket` (so IsAuthenticated). NameIdentifier and Name = user (only if non-empty). `blok:doc`, and `blok:write` = "true"/"false". | collab area | user.go (`User{ID, Name, Doc, Write, Authenticated}`) |
| L13 | UseCollabOperationStore / ActivityObserver | BlokServerBuilderExtensions.cs:56-90 | Replace-style hooks. | collab area | `Options.OperationStore`, `Options.ActivityObserver` |
| L14 | AddBlokDocuments | Asp/BlokDocumentsServiceCollectionExtensions.cs:57-94 | Pool (≤4 by default), timeout 10 s, allocation budget 512 MiB, warm-up. Validates up front. Also registers the agent executor. | documents/agent area | (documents area) |
| L15 | document warm-up | :120-183 | Background, failure swallowed, a 220-block synthetic doc. | NONE | (documents area) |
| L16 | conformance journal hook | Asp/BlokServerConformanceExtensions.cs:29-41 | Test build only. | protocol-v2 (collab area) | `//go:build conformance` |
| L17 | conformance origin policy | :56-121 | Replaces the outbound policy. Only `http://127.0.0.1:PORT` passes, and the origin must be followed by `/`, `?`, `#` or the end of `OriginalString`. Only 127.0.0.1 resolves. | SC:1416, SC:1453, SC:1492, SC:1546 … (every unfurl/by-url case runs through it) | outbound/policy_conformance.go |

### 1d. Routing, CORS, guard, rate limit

| ID | Feature | C# location | What it does | Oracle | Go file |
|---|---|---|---|---|---|
| R1 | `GET,HEAD /health` | Route.cs:76-77,238-251 | `application/json`, `{"status":"ok","version":V}\n`. HEAD gets no body. No guard, no CORS. | SC:275 | health.go |
| R2 | `/health` other methods | :78-80 | 405 with `Allow: GET, HEAD`. | SC:290 | router.go |
| R3 | route gating | :82-120 | `/unfurl` unless disabled. `/upload` and `/delete` when storage is set. `/upload-by-url` with storage and unfurl. Sync routes with collab. | SC:340, SC:358, SC:1907 'unregisters the delete route…' | router.go |
| R4 | sync route set | :14-21,98-120 | `GET /sync/{doc}` (no guard, no request timeout), `POST reset`, `POST edit`, `GET state`, and 5 history routes. | sync-contract / protocol-v2 (collab area) | router.go |
| R5 | 405 Allow values | :177-185 | POST: `OPTIONS, POST`. GET non-sync: `GET, HEAD, OPTIONS`. GET sync shell: `GET, OPTIONS`. `/sync/{doc}`: `GET`. DELETE: `DELETE, OPTIONS`. | SC:317 'returns the exact wrong-method wire for every active route' (non-sync); C# 'ActiveRoutesUseTheExactMethodNotAllowedWire' | router.go: **own** method dispatch. [probe-go] ServeMux gives `GET, HEAD` for `/sync/{doc}` (T13) |
| R6 | 405 body | :253-261 | `text/plain; charset=utf-8`, `Method Not Allowed\n`, and no nosniff header. | SC:290, SC:317 | router.go ([probe-go] `http.Error` adds `X-Content-Type-Options: nosniff`; T14) |
| R7 | 404 body | :122,263-268 | `404 page not found\n`, text/plain. | SC:290 | router.go |
| R8 | HEAD on sync GET routes | :103,170 (MapGet/MapMethods `GET` only) | HEAD is not mapped, so it gets 405 ([probe-kestrel]). | NONE→F4 | router.go ([probe-go] ServeMux auto-serves HEAD for GET; T13) |
| R9 | preflight | :171-175,203-236 | `OPTIONS` on every shell route. No guard, no rate limit. A disallowed or missing Origin gets 403 `origin not allowed\n`. Otherwise 204 with ACAO=origin, `Access-Control-Allow-Methods: M, OPTIONS`, ACAH echoed (plus `Vary: Access-Control-Request-Headers`), `Access-Control-Max-Age: 600`, `Vary: Origin`. | SC:502 'answers anonymous preflights with the exact CORS headers without spending a ticket limit'; SC:376 | cors.go |
| R10 | origin match | Asp/BlokServerCors.cs:12-24 | Empty never matches. Each candidate is trimmed and compared **case-insensitively**. | SC:445 '$name mode rejects every present disallowed origin' | cors.go |
| R11 | origin required | Asp/BlokServerRequestGuard.cs:31-47 | Required in ticket mode, OR when any `Origin` header is present, OR when `Sec-Fetch-Site: cross-site`. Otherwise 403 `origin not allowed\n`. | SC:445; SC:478 '$name mode rejects an originless cross-site browser request' | guard.go (OLD checked ticket mode only; T15) |
| R12 | CORS on allowed | RequestGuard.cs:49-52; Cors.cs:26-30 | ACAO=origin plus `Vary: Origin`, set **before** auth and the limiter, so 401/429 stay readable. | SC:376 (`rawHeaders.vary == ['Origin']`) | guard.go |
| R13 | bearer grammar | RequestGuard.cs:58-62 | Strips one `Bearer ` prefix (case-sensitive). A raw token is also accepted. | SC:575 'preserves the frozen ticket header and authorization grammar' | guard.go |
| R14 | missing pass | :64-72 | 401 `missing pass\n` | SC:541, SC:575 | guard.go |
| R15 | invalid pass | :74-86 | 401 `invalid pass\n` | SC:541 'accepts the fixed compatible ticket and rejects malformed ticket cases' | guard.go |
| R16 | write access | :88-96 | Every non-GET guarded route (Route.cs:170) needs `write:true`, else 403 `write access required\n`. | NONE→F4 (C# BlokServerRequestGuardTests) | guard.go (OLD lacked it) |
| R17 | doc claim NOT checked on HTTP upload/unfurl | :56-104 | The guard ignores `doc`. | NONE→F10 (`tickets.json` has `docMismatch`, but `grep` shows `SC` never sends it; it is loaded only for the shape check at SC:42,61) | guard.go |
| R18 | guard order | :26-116 | Origin, then ticket, then rate limit. | SC:624 'runs origin checks before ticket checks and ticket checks before the limiter' | guard.go |
| R19 | rate-limit key | :54,98-101,119-122 | `user:ID` when the pass has a user, else `addr:RemoteIpAddress` (no port). | SC:696 'uses separate fixed-window buckets…' | guard.go (strip the port with `net.SplitHostPort`, as OLD middleware.go:234-243 did) |
| R20 | 429 | :106-114 | `rate limit exceeded\n`, text/plain. | SC:662, SC:696 | guard.go |
| R21 | fixed window | Asp/FixedWindowRateLimiter.cs:22-70 | One-minute window from the first hit. Count ≤ N. Sweep at most once a minute. `N<=0` means off. | SC:721 'resets a ticket rate-limit bucket after its fixed one-minute window' | ratelimit.go (OLD middleware.go:18-84 reusable as is) |
| R22 | limiter is shared with sync | Asp/BlokServerServiceCollectionExtensions.cs:142-146 | `SyncHandshake` takes the same limiter instance. | collab area | ratelimit.go (one instance) |
| R23 | text/plain error wire | RequestGuard.cs:124-133 | `text/plain; charset=utf-8` | SC:445 etc. | guard.go |

### 1e. Upload, upload-by-url, delete, unfurl

| ID | Feature | C# location | What it does | Oracle | Go file |
|---|---|---|---|---|---|
| U1 | body cap = whole request | Asp/UploadEndpoint.cs:22-36,52-54,310-415 | Kestrel's 30 MB cap is raised to MaxUpload. `Content-Length > max` gets 413 `file too large\n` before reading. The bounded stream counts the **whole body**, framing included. | SC:1328 'applies max-upload to the complete multipart request body'; C# 'AcceptsAnUploadBetweenKestrelsDefaultAndTheConfiguredDefaultCap' | upload.go (`http.MaxBytesReader` + an up-front Content-Length check) |
| U2 | boundary | :38-45,203-222 | `multipart/form-data` (case-insensitive) with no conflicting duplicate params. Unquoted. Empty boundary or a bad type gets 400 `malformed upload\n`. | SC:1102 'accepts a matching %i-character multipart boundary' (129, 4089); SC:1123; SC:1158 | upload.go + uploadwire.go (own media-type grammar, not `mime.ParseMediaType`; T16) |
| U3 | reader buffer | :60-65 | Buffer = max(4096, boundaryBytes+8). | SC:1102 (4089-char boundary) | upload.go |
| U4 | section limit | :17,72-78 | More than 1000 sections gets 400. | NONE→F5 | upload.go |
| U5 | first file part wins | :84-92 | Only the first `form-data; name="file"` part **with a filename** is stored. Others are drained. | SC:1070 'requires a valid multipart file field named file' | upload.go |
| U6 | filename | :244-253,272-296 | `filename*` preferred over `filename`. Unquoted with backslash escapes. Sanitized (U17). | SC:985, SC:1046 | upload.go |
| U7 | quoted-printable | :80-82,259-270,436-707 | Strict decoder: 4096-byte line cap, soft breaks, hex case-insensitive, rejects bad bytes. A decode error gets 400. | SC:1262 'decodes quoted-printable multipart file bytes before storage'; SC:1285 'rejects malformed quoted-printable in a $label before storage' | multipart_qp.go (port the C# decoder; use `NextRawPart`, because `NextPart` auto-decodes with Go's own QP rules (go/src/mime/multipart/multipart.go:161,369-380); T17) |
| U8 | spool to temp 0600 | :94-118,189-200 | `$TMPDIR/.blok-upload-<guid>`, CreateNew, deleted in `finally`. | NONE→F5 (C# 'RemovesTheEndpointSpoolAfter…' ×3) | upload.go |
| U9 | trailing drain | :120 | Reads to the end of the body after the parts. Bytes past the cap give 413. | SC:1328 | upload.go |
| U10 | errors | :122-152 | 413 on cap. 400 `malformed upload\n` on invalid data or I/O. 400 `missing file field\n`. | SC:1070, SC:1328 | upload.go |
| U11 | store failure | :158-180 | Any non-cancel exception gets 502 `upload failed\n`. | SC:1732 'maps a configured S3 error status to an upload bad gateway' | upload.go |
| U12 | extension | :163; Srv/Storage/BlobKey.cs:39-56 | `Path.GetExtension(fileName)`, then normalized. | SC:985 'stores multipart bytes under safe local keys…' | blob/key.go |
| U13 | size | :155,182-187,709-829 | Bytes the store read from the spool (max of position). | SC:985 | upload.go |
| U14 | response | Asp/UploadWire.cs:65-82,118-128 | `application/json`, `{"url":…,"fileName"?,"size"?,"mimeType"?}\n`. Empty or zero values are omitted. | SC:1046 'omits unavailable optional multipart response metadata' | uploadwire.go (escaping differs; T18) |
| U15 | media-type sanitize (wire) | UploadWire.cs:31-40 | Trim. Length 1..255. Must pass `MediaTypeHeaderValue.TryParse` with no conflicting params. **Original text kept.** | SC:1183, SC:1204 'preserves frozen MIME-special quoted parameter escapes', SC:1226 | uploadwire.go (T16, F6) |
| U16 | conflicting params | UploadWire.cs:42-63,84-116 | The same name (case-insensitive) with a different unquoted value is a conflict. The same value is OK. Unquoting un-escapes MIME specials only. | SC:1158, SC:1183, SC:1226 | uploadwire.go |
| U17 | filename sanitize | UploadWire.cs:16-29 | Keep the text after the last `/` or `\`. Drop `.`, `..` and anything over 255 UTF-8 bytes. | SC:985 | uploadwire.go (OLD displayName reusable) |
| B1 | by-url media type | Asp/UploadByUrlEndpoint.cs:22-36 | `application/json` exactly (case-insensitive, no conflicting params), else 415 `expected application/json\n`. | SC:1520 'requires the exact application/json media type for upload-by-url' | uploadbyurl.go (OLD lacked it) |
| B2 | by-url envelope | :14,38-63,158-187 | ≤8 KiB, else 400. Property names case-insensitive. `url` must be a non-empty string. Trailing tokens give 400 `expected {"url": "..."}\n`. | SC:1784 'bounds and validates the upload-by-url JSON envelope' | uploadbyurl.go ([probe-go] `json.Decoder.Decode` accepts trailing data; use `Unmarshal` on the bounded bytes; T19) |
| B3 | by-url fetch | :65-88 | Timeout 2 min, max = MaxUpload, 5 redirects. Any guarded failure gets 400 `the URL could not be fetched\n`. | SC:1546, SC:1587 | uploadbyurl.go |
| B4 | by-url upstream non-2xx / too large | :92-99 | 400, same text, nothing stored. | SC:1587 'refuses non-success and oversized upload-by-url responses before storage' | uploadbyurl.go |
| B5 | by-url name | :101,189-198 | Absolute `FinalUrl`, then `Uri.UnescapeDataString(AbsolutePath)`, then SanitizeFileName. | SC:1546 'stores redirected upload-by-url bytes with final response metadata' | uploadbyurl.go (F3) |
| B6 | by-url mime | :102; Srv/Outbound/GuardedOutboundFetcher.cs:238 | Upstream Content-Type **as .NET re-serializes it** ([probe-cs1] `text/html;charset=UTF-8` → `text/html; charset=UTF-8`), then sanitized. | SC:1546 (only one CT spelling) | uploadbyurl.go (T20, F6) |
| B7 | by-url store failure | :136-148 | 502 `upload failed\n`. | SC:1621 'reports an upload-by-url storage failure as a bad gateway' | uploadbyurl.go |
| B8 | fetch permit held through Put | :90 (`await using ownedResponse`) | The concurrency slot (of 4) stays held while the blob is stored. | NONE→F8 | uploadbyurl.go |
| D1 | delete media type | Asp/DeleteEndpoint.cs:20-34 | Same rule as B1. 415. | SC:1824 'deletes a stored asset and refuses a URL it did not issue' | delete.go |
| D2 | delete envelope | :12,36-61,100-129 | Same rule as B2. | SC:1824 | delete.go |
| D3 | foreign URL | :69-79 | 404 `not found\n`. | SC:1824 | delete.go |
| D4 | delete failure | :85-92 | 502 `delete failed\n`. | NONE→F7 | delete.go |
| D5 | delete success | :94-97 | `application/json`, `{"success":1}\n`. | SC:1824 | delete.go |
| D6 | delete route gating | Route.cs:87-91 | Storage only. **Not** gated by `--no-unfurl`. | SC:1907 | router.go |
| F1u | unfurl missing url | Asp/UnfurlEndpoint.cs:19-27 | 400 `{"success":0}\n`. | SC:1453 'distinguishes a missing unfurl URL from fetch and upstream failures'; SC:376 | unfurl.go |
| F2u | unfurl limits | :12-15 | 10 s, 2 MiB, 5 redirects. | SC:1492 'reports an upstream unfurl timeout as success zero' | unfurl.go |
| F3u | unfurl failure/non-2xx | :40-58 | 200 `{"success":0}\n`. | SC:1453 | unfurl.go |
| F4u | unfurl success wire | :60-74,94-123 | `{"success":1,"link":FinalUrl,"meta":{title?,description?,image:{url?},favicon?,domain?}}`. `image` is always an object. | SC:1416 'unfurls redirected metadata with stable precedence and resolved URLs' | unfurl.go (OLD unfurl.go reusable; T18) |

### 1f. Local file serving

All rows are in `Asp/LocalFileEndpoint.cs`.

| ID | Feature | C# location | What it does | Oracle | Go file |
|---|---|---|---|---|---|
| LF1 | mount | :17-42 | Local storage only, at `{LocalPublicPath}/{fileName}` (or `/{fileName}` when the path is `/`). GET and HEAD. **No guard, no CORS.** | SC:959 'serves a preseeded local file at the public URL path as an attachment' | localfile.go |
| LF2 | name gate | :49-53,503-507 | A direct name (not `.`/`..`, no `/` or `\`) AND `BlobKey.IsGenerated`, else 404 `404 page not found\n`. | SC:959 | localfile.go |
| LF3 | open failures | :58-75 | Not found, no directory, or no access gives 404. | NONE→F9 | localfile.go |
| LF4 | content type | :15,79-81 | `FileExtensionContentTypeProvider` (ASP.NET's built-in table), else `application/octet-stream`. | SC:959 (one extension) | localfile.go (a table copied from ASP.NET, not `mime.TypeByExtension`, which reads OS tables; T21, F9) |
| LF5 | headers | :87-91 | `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Last-Modified` (RFC1123, truncated to seconds). | SC:959, SC:985 | localfile.go |
| LF6 | preconditions | :156-213 | If-Match (only `*` passes, else 412). If-Unmodified-Since. If-None-Match (`*` gives 304, else ignored). If-Modified-Since gives 304. | NONE→F9 | localfile.go |
| LF7 | If-Range | :221-234 | Date only, compared exactly with Last-Modified. A mismatch serves the whole file. | NONE→F9 | localfile.go |
| LF8 | Range parse | :236-354 | `bytes=` only. At most 16 ranges (`too many ranges`). Suffix ranges. Start ≥ len counts as no overlap. Empty specs are skipped. | NONE→F9 | localfile.go |
| LF9 | 416 | :445-467 | Body `invalid range\n` / `too many ranges\n` / `invalid range: failed to overlap\n`. Accept-Ranges and Last-Modified removed. `Content-Range: bytes */N` on no-overlap. A zero-length file with no overlap serves the whole file. | NONE→F9 | localfile.go |
| LF10 | sum guard | :128-139 | If the ranges sum past the file length, serve the whole file. | NONE→F9 | localfile.go |
| LF11 | single range | :369-388 | 206 with Content-Range and Content-Length. | NONE→F9 | localfile.go |
| LF12 | multi range | :390-443 | `multipart/byteranges; boundary=<guid N>` with an exact Content-Length. | NONE→F9 | localfile.go |
| LF13 | whole | :356-367 | `Accept-Ranges: bytes`, Content-Length. HEAD gets no body. | SC:959 | localfile.go |

Note: this file is a hand port of Go's `http.ServeContent` rules. Go's `ServeContent` is close but differs. It sniffs the type, and it handles ETags and `If-None-Match` for real. Do not call it directly. F9 decides what is equal.

### 1g. Tickets

| ID | Feature | C# location | What it does | Oracle | Go file |
|---|---|---|---|---|---|
| T-1 | header segment | Srv/Tickets/TicketVerifier.cs:16,41-45 | Exactly `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9`. Any other header fails. | SC:575 (noncanonicalHeaderTicket); fixture:tickets.json | ticket/verify.go (OLD verify.go reusable with changes) |
| T-2 | segments | :31-39 | Exactly 3 parts, none empty. | SC:541 (malformed) | verify.go |
| T-3 | base64url | :83-112 | Only `[A-Za-z0-9-_]`, `len%4 != 1`, non-zero trailing bits accepted. | NONE→F10 | verify.go ([probe-go] not run; Go `RawURLEncoding` also **skips `\r\n`**, so add an explicit charset check) |
| T-4 | HMAC + const-time | :47-56 | HS256 over `h.p`, `FixedTimeEquals`. | SC:541 (tampered) | verify.go (`hmac.Equal`) |
| T-5 | payload JSON | :58-67,114-127 | **Case-sensitive** names. `write:null` or a non-int `exp` gives a JsonException, so the pass is invalid. A duplicate key: last wins. [probe-cs2] | NONE→F10 | verify.go ([probe-go] Go is case-insensitive and accepts `write:null`; T5) |
| T-6 | expiry | :69-72 | `exp <= now` (Unix seconds) is invalid. A top-level `null` is invalid. | SC:541 (expired) | verify.go |
| T-7 | empty secret | :26-29 | Always invalid. | NONE→F10 | verify.go |
| T-8 | claims | :8-12,74-78 | `user`, `doc`, `write`, `exp`. A missing string becomes "". | SC:696 (userTwo) | verify.go |
| T-9 | BlokTicket.Create (public mint) | Srv/Tickets/BlokTicket.cs:36-91 | Secret ≥32 UTF-16 units. TTL ≥1 (default 300). Rejects a lone surrogate in user or doc. `doc` is omitted only when null. Field order user, doc, write, exp. | NONE→F10 (C# BlokTicketTests: 9) | ticket/mint.go `Mint(secret string, c Claims) (string, error)` (T12, T22) |
| T-10 | mint JSON escaping | BlokTicket.cs:70-83 | `Utf8JsonWriter` default escaping: non-ASCII and `<>&'+` become `\uXXXX` with uppercase hex ([probe-cs1] same encoder family). | NONE→F10 | mint.go (the same claims mint different bytes in Go; both verify. F10 must compare *decoded* claims, not strings) |

### 1h. Blob storage

| ID | Feature | C# location | What it does | Oracle | Go file |
|---|---|---|---|---|---|
| S1 | key | Srv/Storage/BlobKey.cs:7-17 | 16 random bytes, lowercase hex, plus the normalized extension. | SC:985 | blob/key.go (OLD blobstore.go:48-57 reusable) |
| S2 | extension rule | :39-56 | `.` plus 1..15 ASCII alphanumerics, lowercased, else "". | SC:985 | key.go (OLD extensionFor reusable; note OLD took a full name, C# takes an extension) |
| S3 | IsGenerated | :58-77 | 32 lowercase hex, then "" or a normalized extension. | SC:959 | key.go (OLD isStoredName reusable) |
| S4 | public URL parse | :19-37 | Strip `?`/`#`, then an ordinal prefix of `publicUrl.TrimEnd('/')+"/"`. | SC:1824 | key.go (OLD keyFromPublicURL reusable) |
| S5 | local put | Srv/Storage/LocalBlobStore.cs:18-110 | MkdirAll. Temp file `.blok-upload-<guid>` 0600 in the dir. fsync, chmod 0644, rename (no overwrite). | SC:985 (C# LocalBlobStoreTests: 11) | blob/local.go (OLD localdir.go reusable) |
| S6 | local delete | :112-127 | Foreign URL throws Foreign. A missing **file** is a no-op. A missing **directory** throws `DirectoryNotFoundException`, which becomes 502 ([probe-cs1]). | SC:1824 (foreign); NONE→F7 (missing dir) | local.go (OLD treats every ErrNotExist as success; T23) |
| S7 | S3 target | Srv/Storage/S3TargetResolver.cs:7-83 | Validates the bucket charset, addressing, DNS-compat for virtual, an absolute http(s) endpoint, an ASCII authority and no path. Builds a path- or virtual-style URL. Host header without the default port. | SC:1652 (path style) | blob/s3target.go (OLD resolveTarget s3.go:227-349 reusable, needs a diff check) |
| S8 | auto addressing | :85-110 | Virtual only for `*.amazonaws.com` with a dot-free, DNS-compatible bucket. | NONE→F7 | s3target.go |
| S9 | SigV4 | Srv/Storage/S3RequestSigner.cs:12-113 | Signed headers `[content-type;]host;x-amz-content-sha256;x-amz-date`. Empty query. Canonical URI = `AbsolutePath`. Whitespace-collapsed values. | SC:1652 'uploads to S3 with a known length, SigV4 headers, and path addressing' (fake-s3.ts) | blob/s3sign.go (OLD s3.go reusable) |
| S10 | S3 PUT headers | Srv/Storage/S3BlobStore.cs:216-227 | `Content-Disposition: attachment` (not signed), `Content-Type` if sanitized non-empty, `Content-Length` known. | SC:1652 | s3.go (**OLD has no Content-Disposition**) |
| S11 | S3 media sanitize | :332-415 | UploadWire's grammar **plus** ASCII 0x20-0x7E only. | NONE→F6 | blob/mediatype.go |
| S12 | payload prep | :417-618 | Seekable: hash in place. Else spool to `$TMP/blok-s3-<guid>.tmp` 0600 with the cap = MaxUpload; over the cap is an IOException. | NONE→F7 | s3.go (OLD spool has **no cap**) |
| S13 | timeouts | :13-16,193-241 | 5 min per request. Response headers within 60 s **after the body is sent**. Connect 10 s (:266-273). No redirects. | NONE→F7 | s3.go (OLD set ResponseHeaderTimeout 60 s, which counts from the end of the write, the same) |
| S14 | S3 errors | :242-263,275-330 | Non-2xx throws `blobstore: s3 METHOD returned N: <first 512 bytes trimmed>`. Allow-404 only for collab get/delete. | SC:1732 | s3.go |
| S15 | collab object methods | :110-175 | `GetObject` (404 means null; 403 stays an error), `PutObject` (octet-stream), `DeleteObject` (404 OK). | NONE (C# S3BlobStoreObjectMethodsTests: 7) | s3.go (**new**; OLD lacks it) |
| S16 | proxy | :266-273 | `SocketsHttpHandler` with default `UseProxy` = system proxy (**UNVERIFIED**: env/system proxy honoured). | NONE | s3.go (decide explicitly) |

### 1i. Outbound guard (SSRF boundary)

| ID | Feature | C# location | What it does | Oracle | Go file |
|---|---|---|---|---|---|
| O1 | URL validation | Srv/Outbound/GuardedOutboundPolicy.cs:79-129 | `System.Uri` absolute (or relative to the redirect base). http/https. Host non-empty. No userinfo, and no `@` in the canonical authority. **Port 80 or 443 only.** `IdnHost` (punycode). An IP literal must parse. | NONE→F11 (the conformance build replaces this policy, so black-box tests can never reach it) | outbound/policy.go (needs `golang.org/x/net/idna`; T24) |
| O2 | forbidden ranges | :41-77,131-141 | 34 CIDRs (v4 + v6). IPv4-mapped is unmapped first. | NONE→F11 | policy.go (`netip.Prefix`, copy the list exactly; OLD used `safeurl`'s own list, so it is obsolete) |
| O3 | every DNS answer checked | GuardedOutboundFetcher.cs:174-184 | An empty answer, or ANY forbidden address, blocks the whole host. | NONE→F11 | fetcher.go |
| O4 | dial pinned to vetted IPs | :396-415,478-588 | `ConnectCallback` dials only the resolved list, in order. 1 s per attempt except the last. The endpoint must match the target. | NONE→F11 | fetcher.go (`Transport.DialContext` over the vetted list; never re-resolve) |
| O5 | no proxy, no cookies, no auto-redirect, no auto-decompress | :401-415 | Set on the handler. | NONE→F8 | fetcher.go (`Proxy:nil`, `DisableCompression:true`, `CheckRedirect` returning `ErrUseLastResponse`; T25) |
| O6 | User-Agent | :67-68,206-208 | `blok-server (+https://blokeditor.com)`. | NONE→F8 | fetcher.go |
| O7 | no Accept-Encoding sent | :404 (`AutomaticDecompression=None`) | No header is added. | NONE→F8 | fetcher.go (Go adds `Accept-Encoding: gzip` unless `DisableCompression`) |
| O8 | redirects | :214-229,245-253 | Only 301/302/303/307/308 **with** a Location are followed. Each hop is re-validated against the base. Past the limit gives TooManyRedirects. A 3xx without Location is the final answer. | SC:1416, SC:1546 (redirect followed); NONE→F8 for the limit | fetcher.go |
| O9 | total timeout covers the semaphore wait | :108-124,143-148 | The deadline starts before `concurrency.WaitAsync`. | SC:1492 (timeout) | fetcher.go |
| O10 | process-wide concurrency 4 | :72,123 | Shared by unfurl and by-url (one registered fetcher, BlokServerServiceCollectionExtensions.cs:87-89). | NONE→F8 (C# 'RegistersOneGuardedOutboundFetcher') | fetcher.go (one `chan struct{}` of 4 on Server) |
| O11 | body cap | :255-269,329-365,602-710 | Content-Length > max is TooLarge. Raw bytes are bounded AND decoded bytes are bounded by the same max. | SC:1587 (oversized) | decode.go |
| O12 | content-encoding | :271-327 | 0 or 1 encoding: `identity`, `gzip`, `br`, `deflate` (=zlib). More than one, or an unknown one, gives UnsupportedContentEncoding. | NONE→F8 | decode.go (**stdlib has no brotli**: `ls $(go env GOROOT)/src/compress` → bzip2 flate gzip lzw zlib; needs `github.com/andybalholm/brotli` or an in-house decoder; T26) |
| O13 | failure collapse | :134-152 | Every non-cancel error becomes Blocked. Deadline becomes TimedOut. Caller cancellation passes through. | SC:1453 | fetcher.go |
| O14 | FinalUrl | :239 | `target.Url.AbsoluteUri` (System.Uri canonical form). | SC:1416 (`link`) | fetcher.go (F3; T24) |
| O15 | TLS | :417-421,455-476 | Chain policy: no cert downloads, no revocation check. SNI = host. | NONE→F12 | fetcher.go |
| O16 | macOS managed TLS | Srv/Outbound/MacOsTlsTransport.cs:12-23,24-117 | On macOS, https goes over BouncyCastle TLS so SecTrust runs with `SecTrustSetNetworkFetchAllowed(false)`. Reason: SslStream lets trustd fetch the caIssuers URL, which bypasses the guard. ALPN `http/1.1` only. No SNI for IP literals. | NONE→F12 (C# 'SslStreamStillLeaksAnIssuerFetchOnMacOs' pins the leak) | tls_darwin.go (T27) |
| O17 | macOS trust eval | MacOsTlsTransport.cs:304-514 | `SecPolicyCreateSSL(host)`, network fetch off, custom anchors only when given. | NONE→F12 | tls_darwin.go |

### 1j. Unfurl metadata parser

All rows are in `Srv/Metadata/UnfurlMetadataParser.cs`.

| ID | Feature | C# location | What it does | Oracle | Go file |
|---|---|---|---|---|---|
| M1 | decode | :32-33 | Bytes are **always UTF-8** (invalid bytes become U+FFFD). The charset is ignored. | NONE→F13 | unfurl/parse.go |
| M2 | parser | :32 | AngleSharp HTML5 parse, `MaximumDepth = 513`. | fixture:metadata/precedence.html via SC:1416 | parse.go (`golang.org/x/net/html`; OLD reusable with changes) |
| M3 | depth cut | :9,42-45 | An element deeper than 512 drops everything except domain and favicon default. | NONE→F13 | parse.go (x/net/html's own open-element cap differs; UNVERIFIED value; T28) |
| M4 | title | :49-53 | First HTML-namespace `<title>`. Trimmed `FirstChild.TextContent`. | SC:1416 | parse.go |
| M5 | meta precedence | :54-84,125-141 | Per element: `property` is checked before `name`. Values are trimmed and **case-sensitive** (`og:title`). Title: og, twitter, `<title>`. Description: og, twitter, description. Image: og, twitter. | SC:1416 | parse.go |
| M6 | link icons | :85-110 | `rel` split on Unicode whitespace, lowercased. `icon`, else a `apple-touch-icon*` prefix. First non-empty href. | SC:1416 | parse.go |
| M7 | domain | :150-158 | `IdnHost` (punycode) lowercased, with `www.` stripped. | NONE→F13 | parse.go (OLD used `Hostname()`, which keeps Unicode; T24) |
| M8 | favicon default | :159-162 | `/favicon.ico` when there is a base and no icon. | SC:1416 | parse.go |
| M9 | URL resolve | :205-226 | `new Uri(base, ref)`, then http(s) with a host, then `AbsoluteUri`. Otherwise "". | SC:1416 (`../images/cover.png?size=2`) | parse.go (F3) |
| M10 | any exception | :120-123 | Returns domain and favicon only. | NONE→F13 | parse.go |

Row count (measured with `awk` over the §1 tables): **217 rows**. **86** have `NONE` in the oracle column. **84** of those have no conformance or fixture oracle at all. The other 2 are partial ("SC:… + NONE→F…").

---

## 2. Proposed shared fixtures (oracle = NONE)

Each one copies the existing pattern. A JSON corpus lives under `test/unit/server-conformance/fixtures/<name>/`. A C# xunit test and a Go test both read it. A `*.freshness.test.ts` checks that the C# side regenerates the same file, as `yjs-engine-fixtures.freshness.test.ts` does. Seed each one with the probe pairs already measured here.

| F | Fixture | Content | Why black-box cannot prove it |
|---|---|---|---|
| F1 | `host-cli.json` driven by a new `test/unit/server-conformance/host-cli-contract.test.ts` (black-box, `runServerCommand`) | `{args, env, exitCode, stderrContains, stderrNotContains}` for H4, H9, H12 (via health of the file URL), H20, H22-H24, H28, V3, V9, V11, V12, V15-V25, V28, V31. Plus `--listen 2130706433:4000`, `127.1:4000` and `0x7f.0.0.1:4000` (T1). | It can be black-box. It just is not written yet. |
| F2 | `options-validate.json` (in-process) | `{options, error}` for V1 defaults, V13 and L9. A Go test builds `Options`, and C# builds `BlokServerOptions`. | No flag reaches these options. |
| F3 | `uri-canonical.json` | `{input, base?, absoluteUri, idnHost, valid}` from System.Uri. Seed: [probe-cs1] `http://0x7f.1/`→`http://127.0.0.1/` IPv4. `…/a b/../c?q=1 2#f`→`http://example.com/c?q=1%202#f`. `bücher.example`→abs keeps Unicode, idn `xn--bcher-kva.example`. `example.com\@evil.com` is invalid. `:80` dropped. `/%7Efoo/%2e%2e/bar`→`/bar`. [probe-go] net/url differs on 5 of 6. | Used by O1, O14, M7, M9, B5, V20, V24, V27, V32. Go needs an own canonicalizer that is proven against it. |
| F4 | `routing.json` black-box | HEAD on sync GET routes gives 405. `//health`, `/./health`, `/health/`, `%2F` in `{doc}`. DELETE history Allow value. | Not covered. Go's ServeMux differs ([probe-go]). |
| F5 | multipart cases (black-box, add to SC) | 1001 sections give 400. Spool removed. A file part without a filename is skipped. `filename*` beats `filename`. | Partly covered. |
| F6 | `media-types.json` | `{input, wireSanitized, s3Sanitized, conflicting}`. Seed with the 12 [probe-cs2]/[probe-go] pairs. Go differs on 5: duplicate-different (`mime: duplicate parameter name` vs .NET OK), `text/plain; charset` (.NET OK, Go error), `text` (.NET reject, Go OK), and more. | `mime.ParseMediaType` is a different grammar. |
| F7 | `s3-store.json` + fake-s3 | Virtual auto-selection table. A SigV4 golden case (fixed time, keys, expected `Authorization`). 404/403 on collab get. Spool cap. Delete with a missing local dir gives 502. | SC:1652 covers path style only. |
| F8 | `outbound-fetch` black-box via the conformance origin | `fixture-origin.ts` gets routes that serve gzip, br, deflate, `gzip, br`, unknown encoding, a 6-hop redirect, a 304/300 with Location, and one that echoes `User-Agent`/`Accept-Encoding`. Plus 5 concurrent slow fetches (the 5th waits). | The conformance origin reaches loopback, so this CAN be black-box. |
| F9 | `byte-ranges.json` + black-box file cases | Every LF6-LF12 branch: `{headers, fileLength, status, headersOut, bodySlices}`. Extension→Content-Type table from `FileExtensionContentTypeProvider`. | Not covered at all. |
| F10 | `tickets-extended.json` | Next to `tickets.json`: `USER` key, `write:null`, `exp:5.0`, `exp:1e3`, a duplicate user, a `\n` inside a segment, a non-zero tail bit, an empty secret. Plus mint inputs (`{secret, claims, now}` → decoded payload; lone surrogate gives an error; a secret of 16 'é' is refused). | Only 9 tickets exist today. |
| F11 | `outbound-policy.json` | `{url, base?, verdict}` and `{ip, allowed}` for all 34 ranges at both edges, IPv4-mapped, ports, userinfo, IDN. | **The conformance build replaces this policy, and the ordinary build blocks loopback, so it is unreachable black-box.** |
| F12 | macOS TLS leak test | Go version of `SslStreamStillLeaksAnIssuerFetchOnMacOs`: a TLS server whose leaf has a caIssuers URL pointing at a local listener. Assert the listener sees no hit. | Platform behaviour. |
| F13 | `unfurl-html/` | One `.html` + expected JSON per case, ported from the 18 `UnfurlMetadataParserTests`. Add depth 511/512/513, a non-UTF-8 charset, an svg `<title>`, an uppercase `OG:TITLE`, a punycode domain, a `javascript:` image. | One HTML fixture today. |

---

## 3. C# unit tests needing Go equivalents

Counts are `grep -c -E '\[(Fact|Theory)'`, so a Theory counts once.

| File | Tests | Go target |
|---|---|---|
| Blok.Server.Host.Tests/HostProcessTests.cs | 42 | cmd/blok-server/main_test.go (args, base-0 ints, env precedence, deadlines 504, listen line after bind) |
| Blok.Server.Host.Tests/HostCollabTests.cs | 15 | cmd/blok-server/collab_test.go (drain, keep-alive, upgrade cap, journal flag, rich-text flag; half are collab area) |
| Blok.Server.AspNetCore.Tests/BlokServerRegistrationTests.cs | 55 | blokserver/options_test.go + handler_test.go |
| Blok.Server.AspNetCore.Tests/BlokServerRequestGuardTests.cs | 16 | guard_test.go |
| Blok.Server.AspNetCore.Tests/UploadEndpointTests.cs | 19 | upload_test.go |
| Blok.Server.AspNetCore.Tests/UploadByUrlEndpointTests.cs | 18 | uploadbyurl_test.go |
| Blok.Server.AspNetCore.Tests/DeleteEndpointTests.cs | 13 | delete_test.go |
| Blok.Server.AspNetCore.Tests/UnfurlEndpointTests.cs | 7 | unfurl_test.go |
| Blok.Server.AspNetCore.Tests/LocalFileServingTests.cs | 23 | localfile_test.go |
| Blok.Server.AspNetCore.Tests/BlokDocumentsRegistrationTests.cs | 12 | (documents area) |
| Blok.Server.Tests/BlokTicketTests.cs | 9 | ticket/mint_test.go |
| Blok.Server.Tests/TicketVerifierTests.cs | 10 | ticket/verify_test.go |
| Blok.Server.Tests/LocalBlobStoreTests.cs | 11 | blob/local_test.go |
| Blok.Server.Tests/S3BlobStoreTests.cs | 30 | blob/s3_test.go |
| Blok.Server.Tests/Collab/S3BlobStoreObjectMethodsTests.cs | 7 | blob/s3_objects_test.go |
| Blok.Server.Tests/GuardedOutboundFetcherTests.cs | 42 | outbound/fetcher_test.go |
| Blok.Server.Tests/GuardedOutboundPolicyTests.cs | 9 | outbound/policy_test.go |
| Blok.Server.Tests/OutboundClientArchitectureTests.cs | 14 | outbound/law_test.go (analogue of OLD `httpapi/outbound_law_test.go`: one outbound client, no stray `http.Get`) |
| Blok.Server.Tests/UnfurlMetadataParserTests.cs | 18 | unfurl/parse_test.go |
| **Total** | **370** | |

---

## 4. Traps (silent parity breaks), with evidence

| T | Trap | Evidence |
|---|---|---|
| T1 | `.NET IPAddress.TryParse` accepts `2130706433`, `127.1` and `0x7f.0.0.1` as 127.0.0.1. Go `net.ParseIP` rejects all three. A Go port of V7/V8 refuses `--listen 127.1:4000` (DNS host), and C# accepts it as loopback. What Kestrel then binds is UNVERIFIED. | [probe-cs1] vs [probe-go] |
| T2 | OLD `--rate-limit` used -1 for "auto". C# treats any explicit value as explicit, and -1 is refused by V12. | OLD main.go:37,160,226-235 vs HostArguments.cs:220-228,274 |
| T3 | OLD `secretFromFlag = raw.secret != ""`. C# uses flag presence, so `--secret ""` does not fall back to env. | OLD main.go:194; HostArguments.cs:198-201,277; C# 'AnExplicitSecretWinsEvenWhenItIsInvalid' |
| T4 | Go `flag` int64 overflow says `value out of range` where C# says `parse error`. Tests check the prefix only. | HostArguments.cs:212-216; Go flag source (UNVERIFIED exact text) |
| T5 | Ticket payload: C# property names are case-sensitive and Go's are not (`USER` verifies in Go). `write:null` errors in C# and passes in Go. | [probe-cs2] vs [probe-go] |
| T6 | `encoding/json` keeps the last duplicate key with no error. C# `TryParseRichTextFields` fails on a duplicate key (HostArguments.cs:380-383 comment). Go needs a token-level duplicate check. | HostArguments.cs:360-384; [probe-go] duplicate `user` gives last-wins, no error |
| T7 | `:PORT` means IPv4 only in C#. Go `":p"` is dual-stack. | Program.cs:74-77 |
| T8 | OLD printed "listening" BEFORE `ListenAndServe`. The harness treats the line as proof of the bind. | OLD main.go:133,144; server-process.ts:14,133; C# 'ReportsListeningOnlyAfterBindingSucceeds' |
| T9 | The deadline must answer 504 and cancel downstream. `http.TimeoutHandler` gives 503 and buffers. `ReadTimeout`/`WriteTimeout` kill the socket and would also kill a hijacked sync socket unless cleared after hijack (UNVERIFIED for Go 1.27). | Program.cs:139-146; HostProcessTests.cs:~385 (`GatewayTimeout`), ~456 (`HTTP/1.1 504`) |
| T10 | `http.Server.Shutdown` ignores hijacked conns. The drain has to run before Shutdown, or rooms are cut without 1001. | HostCollab.cs:67-76 |
| T11 | C# pre-filters conformance flags before host parsing (any position before `--`). Go `flag` stops at the first error, so `--bad --conformance-origin x` reports a different error. | ConformanceArguments.cs:28-99; Program.cs:14-21 |
| T12 | Secret length counts UTF-16 units in C#. Go `len()` counts bytes, and OLD config.go:50 used it. | Options.cs:299; BlokTicket.cs:26,51 |
| T13 | ServeMux auto-HEAD, `Allow: GET, HEAD` on `/sync/{doc}`, a 307 for `//health` and `/./health`, and `%2F` decoded into `{doc}`. Kestrel also matches case-insensitively and accepts a trailing slash (§8). A doc id with `%2F` reaches the room under a different key. | [probe-go] vs [probe-kestrel], §8 |
| T14 | `http.Error` adds `X-Content-Type-Options: nosniff`. The C# error wire does not have it. | [probe-go]; RequestGuard.cs:124-133 |
| T15 | OLD required an Origin in ticket mode only. C# also requires it when any Origin is present or `Sec-Fetch-Site: cross-site`. | OLD middleware.go:125; RequestGuard.cs:31-37 |
| T16 | Media-type grammar: .NET `MediaTypeHeaderValue` ≠ Go `mime.ParseMediaType` on 5 of 12 inputs. | [probe-cs2] vs [probe-go] (F6 seed) |
| T17 | `multipart.Reader.NextPart` silently QP-decodes with Go's lenient decoder. C# is strict (400 on a bad hex byte, a line over 4096 bytes, or a bad soft break). | go/src/mime/multipart/multipart.go:161,369-380; UploadEndpoint.cs:589-621 |
| T18 | JSON escaping: System.Text.Json writes `é` as `é` and `<>&'+` as `<…`. Go writes `é` raw, `<` as `<` (lowercase), and leaves `'` and `+` alone. Byte-exact `text` assertions on a non-ASCII fileName/title would differ. | [probe-cs1] `{"t":"café <b>&'+"}`; [probe-go] `{"t":"café <b>&'+"}` |
| T19 | `json.Decoder.Decode` accepts `{"url":"x"}{}`. C# refuses it with 400, because `JsonReaderException` is a `JsonException`. | [probe-cs2]; [probe-kestrel] `isJsonException=True`; [probe-go] |
| T20 | FinalUrl, mime and link come from .NET-normalized objects (`AbsoluteUri`, `MediaTypeHeaderValue.ToString`). Go's raw strings differ. | GuardedOutboundFetcher.cs:238-239; [probe-cs1] |
| T21 | The local file Content-Type comes from ASP.NET's static table. Go `mime.TypeByExtension` reads OS mime files and varies by host. | LocalFileEndpoint.cs:15,79-81 |
| T22 | Mint omits `doc` only when it is null. A Go `omitempty` also drops `""`, which changes the signed bytes and the doc claim. | BlokTicket.cs:75-78; OLD verify.go:22 |
| T23 | A local delete with a missing storage directory gives 502 in C#. OLD Go answers success. | [probe-cs1] `DirectoryNotFoundException`; OLD localdir.go:61 |
| T24 | System.Uri canonicalizes (IPv4 shorthand, dot segments including `%2e%2e`, punycode IdnHost, default port). net/url does none of this, and it percent-encodes a Unicode host in `String()`. | [probe-cs1] vs [probe-go] |
| T25 | OLD used `github.com/doyensec/safeurl`, which has its own range list and automatic gzip. That is not the C# list. | OLD fetchguard/client.go:18,80-111; go.mod |
| T26 | Brotli is not in the Go stdlib. | `ls $(go env GOROOT)/src/compress` |
| T27 | Go's darwin verifier calls `SecTrustEvaluateWithError` **without** `SecTrustSetNetworkFetchAllowed(false)`. So when `RootCAs == nil` it may have the same trustd issuer-fetch leak (verify.go:565-573; root_darwin.go:20-70). Whether trustd actually fetches for Go is UNVERIFIED (F12). Setting `RootCAs` from `/etc/ssl/cert.pem` (exists, 128 certs) forces the pure-Go verifier, which never fetches, but it **drops Keychain and enterprise trust**. That is a parity gap, not a full fix. | grep of Go 1.27.1 GOROOT; `ls /etc/ssl/cert.pem` |
| T28 | Parser depth: AngleSharp `MaximumDepth=513` plus a walk cut at depth >512. OLD x/net/html returns an error past its own cap, and that cap's value is UNVERIFIED. The boundary must be tested at 511/512/513. | UnfurlMetadataParser.cs:9,32,42-45; OLD parse.go:43-45 |
| T29 | `UnfurlDisabled` defaults to **true** in-process and false in the host. A Go `Options{}` zero value would be false, which opens SSRF routes by default. Use an inverted field (`UnfurlEnabled bool`) or a constructor. | Options.cs:95; HostArguments.cs:80 |
| T30 | The forbidden-range list and URL validation are unreachable black-box (H39/L17 swap the policy). | BlokServerConformanceExtensions.cs:56-69 |

---

## 5. Go library API (analogue of AddBlokServer/MapBlokServer/IBlokAuthorization)

A proposal. The shape follows from L1-L13, V35 and T29.

```go
package blokserver

type Options struct {
    Version, ListenAddress, Auth, Secret string
    AllowedOrigins []string
    StorageDirectory, PublicURL string
    MaxUploadBytes, RateLimitPerMinute int64
    UnfurlEnabled bool                 // inverted on purpose: zero value = closed (T29)
    S3Endpoint, S3Region, S3Bucket, S3BucketURL, S3Addressing, S3AccessKey, S3SecretKey string
    CollabEnabled bool; DocEndpoint, DocEndpointAuth, CollabDirectory, CollabS3Prefix string
    CollabJournal bool
    CollabMaxConnectionsPerUserPerDoc int; CollabMaxConnections int64; CollabMaxMessageBytes int
    CollabKeepAliveInterval time.Duration
    CollabInboundFramesPerSecond, CollabInboundBurstFrames, CollabInboundResyncsPerMinute, CollabInboundAwarenessBytesPerSecond int
    RichTextFields map[string][]string

    // Overrides: the TryAdd seam. nil = built-in.
    Authorization    Authorization
    OperationStore   collab.OperationStore
    ActivityObserver collab.ActivityObserver
    Clock            func() time.Time
    Logger           *slog.Logger   // category attr "Blok.Server.Collab" / "Blok.Server.AspNetCore"
}

func DefaultOptions() Options              // C# defaults (V1), UnfurlEnabled=false
func (o *Options) Validate() error          // same messages as BlokServerOptions.Validate
func New(o Options) (*Server, error)        // AddBlokServer: validate + build lazily
func (s *Server) Handler(prefix string) http.Handler   // MapBlokServer: group + 404 catch-all,
                                                        // local files at the public path outside prefix (L8)
func (s *Server) Drain(ctx context.Context) error       // ICollabRoomManager.DrainAsync
func (s *Server) PurgeDocument(ctx context.Context, id string) error

type User struct { ID, Name, Doc string; Write, Authenticated bool; Claims map[string]string }
func WithUser(ctx context.Context, u User) context.Context  // the host's own auth middleware sets it
func UserFrom(ctx context.Context) (User, bool)             // ticket mode builds it from the pass (L12)

type Authorization interface {             // IBlokAuthorization: narrows only
    CanReadDocument(ctx context.Context, u User, documentID string) (bool, error)
    CanWriteDocument(ctx context.Context, u User, documentID string) (bool, error)
}

package ticket
type Claims struct { User string; Doc *string; Write bool; TTL time.Duration }
func Mint(secret string, c Claims, now time.Time) (string, error)   // BlokTicket.Create (T-9, T12, T22)
```

Blob store and fetcher overrides (`HonorsAnExistingBlobStoreOverride`, `HonorsAnExistingGuardedFetcherOverride`) are internal interfaces in C# (`internal interface IBlobStore`, Srv/Storage/IBlobStore.cs:3). Keep them as unexported test seams in Go too, reached through `export_test.go`.

---

## 6. Deleted Go tree (OLD): per-file verdict

| OLD file | Verdict | Changes needed |
|---|---|---|
| cmd/blok-server/main.go | needs changes | Int64 rate limit by presence (T2). Secret and doc-endpoint-auth by presence (T3). Collab and rich-text flags and env (H18-H24). `:p`→`0.0.0.0` (T7). Bind before the "listening" line (T8). Plain stderr with no `log` timestamps (`log.Printf` adds a date prefix, main.go:121,133). Drop `ReadTimeout`/`WriteTimeout`; add 504 middleware (T9). SIGTERM drain (H35). Custom Usage text (H5). |
| cmd/blok-server/build.go | needs changes | Move the wiring into `blokserver.New`. Replace `http.FileServer` (it sniffs, has no strict name gate, and has its own Range rules) with the LF1-LF13 port. Startup checks move into `Validate` with the C# messages. |
| cmd/blok-server/conformance.go / _disabled.go | reusable | Add `--conformance-journal`. Keep the error text (T11). |
| internal/config/config.go | needs changes | Fold into `Validate`. UTF-16 secret length (T12). .NET-style IPv4 parse (T1). All V7-V34 rules. |
| internal/httpapi/router.go | needs changes | Own method dispatch (T13). Delete, collab and history routes. Preflight on every shell route. 404 catch-all. Prefix support. |
| internal/httpapi/middleware.go | needs changes | Rate limiter reusable as is. Origin-required rule (T15). Write-access 403 (R16). Errors without nosniff (T14). Store the user in context. |
| internal/httpapi/health.go | needs changes | HEAD without body. JSON escaping (T18). |
| internal/httpapi/upload.go | needs changes | Replace `ParseMultipartForm` with a streaming `NextRawPart` reader. Strict QP (T17). 1000-section cap. First file part wins. `filename*`. Own media-type grammar (T16). Up-front 413. by-url: 415 check, 8 KiB, and `Unmarshal` to reject trailing data (T19). |
| internal/httpapi/unfurl.go | reusable | Response structs match F4u. Only the escaping question remains (T18). |
| internal/ticket/verify.go | needs changes | Case-sensitive and strict JSON (T5). Charset check before base64 (T-3). Add Mint with a `*string` doc (T22). |
| internal/unfurl/parse.go | needs changes | Depth cut (T28). Punycode domain (T24). System.Uri-compatible resolve (F3). UTF-8 decode first (M1). `property` checked before `name` per element is already the same. |
| internal/fetchguard/client.go | obsolete (rewrite) | Drop `safeurl`. Own policy (O1-O2). Pinned dial (O4). `DisableCompression` and manual gzip/br/zlib (O7, O12). Redirect set (O8). Semaphore of 4 (O10). Darwin TLS (O16). |
| internal/fetchguard/conformance*.go | needs changes | Port ExactOriginOutboundPolicy (L17): prefix plus `/?#` boundary check. |
| internal/blobstore/blobstore.go | reusable | Rename to blob/key.go. Split `extensionFor(name)` into `NormalizeExtension(ext)`. |
| internal/blobstore/localdir.go | needs changes | Missing dir gives an error (T23). No-overwrite rename (`os.Link`+`Remove`, or `O_EXCL`). |
| internal/blobstore/s3.go | needs changes | Content-Disposition on PUT (S10). Spool cap (S12). ASCII media rule (S11). Get/Put/DeleteObject (S15). |
| tests: cmd/*_test.go (4) | needs changes | Rebase on the C# HostProcessTests expectations. |
| tests: httpapi/*_test.go (7) | needs changes | outbound_law_test.go becomes the analogue of OutboundClientArchitectureTests (14). |
| tests: blobstore, ticket, unfurl, fetchguard, config (10) | needs changes | Assertions encode OLD behaviour (safeurl, lenient JSON, no QP). Re-derive them from the C# tests and F-fixtures. |
| go.mod | needs changes | `go 1.27`. Keep `golang.org/x/net` (html, idna). Drop safeurl. Add a brotli decoder (T26). |

---

## 7. Dependencies: why they exist, and the Go equivalent

| C# package | Used at | Why | Go equivalent |
|---|---|---|---|
| AngleSharp 1.8.6 (Srv/Blok.Server.csproj:24) | Only Srv/Metadata/UnfurlMetadataParser.cs:2-3,32 (`grep -rn AngleSharp`) | Spec HTML5 tree building with a depth cap, so `<title>`/`<meta>` land where a browser puts them. | `golang.org/x/net/html` (stdlib has no HTML5 parser). It is already the OLD dependency (OLD go.mod). |
| BouncyCastle.Cryptography 2.7.0 (Srv/Blok.Server.csproj:25-33) | Only Srv/Outbound/MacOsTlsTransport.cs:7-8,95 | Managed TLS on macOS, so SecTrust runs with network fetch off. SslStream leaks the caIssuers fetch (file comment :12-23). | Stdlib `crypto/tls` is already managed TLS. Use `InsecureSkipVerify` plus `VerifyConnection` that calls a darwin trust check with fetch off. That needs cgo or purego to reach Security.framework (stdlib's `crypto/x509/internal/macos` is not importable). The no-cgo option is `RootCAs` from `/etc/ssl/cert.pem`, which loses Keychain trust (T27). Decide after F12. |
| (implicit) System.Uri, IdnMapping | O1, O14, M7, M9 | Canonical URL and punycode. | `net/url` + `golang.org/x/net/idna` + an own canonicalizer proven by F3. |
| (implicit) BrotliStream | O12 | `br` content-encoding. | `github.com/andybalholm/brotli` (pure Go) or an in-house decoder. Stdlib has none (T26). |
| (implicit) FileExtensionContentTypeProvider | LF4 | Static extension→type table. | A Go map copied from ASP.NET's table (F9). |

---

## 8. Kestrel routing probe (the C# side of T13, T19)

Measured with [probe-kestrel]. It uses the same routing calls as `BlokServerEndpointRouteBuilderExtensions`, but it is not the real `MapBlokServer`. Paired with [probe-go] (Go 1.27 ServeMux):

| Request | Kestrel | Go ServeMux |
|---|---|---|
| `GET //health` | 404 (catch-all) | 307 → `/health` |
| `GET /./health` | 200 (dot segment removed) | 307 → `/health` |
| `GET /health/` | **200** (trailing slash matches) | 404 |
| `GET /HEALTH` | **200** (route match is case-insensitive) | 404 |
| `HEAD /sync/x` (GET-only route) | 405 | 200 (auto HEAD) |
| `GET /sync/a%2Fb` | `{doc}` = `a%2Fb` (not decoded) | `{doc}` = `a/b` |
| `GET /sync/a%20b` | `{doc}` = `a b` | (decoded) |

The trailing-JSON question in T19 is settled: `{"url":"x"}{}` throws `System.Text.Json.JsonReaderException`, which **is** a `JsonException`. So C# answers 400 on delete and upload-by-url.

Conclusion: the Go router must be hand-written. Use case-insensitive path matching, accept an optional trailing slash, remove dot segments without redirecting, leave `%2F` encoded in segment values (use `r.URL.EscapedPath()`), and dispatch methods explicitly. F4 should pin every line of this table black-box.

---

## 9. Prerequisite repo changes before any Go code can land

List only. Do not edit them as part of this research.

- `test/unit/architecture/server-go-removal-law.test.ts`: forbids `go build/test/...`, goreleaser and `CGO_ENABLED` in tracked files (it exempts only `docs/plans/*.md`).
- `scripts/test-server-conformance.mjs:46-55` accepts only `--target csharp`. It builds two dotnet hosts (ordinary Release plus conformance with `-p:BlokServerConformance=true`) and sets `BLOK_CONFORMANCE_ORDINARY_SERVER` / `BLOK_CONFORMANCE_SERVER`. Go needs `go build` and `go build -tags conformance` the same way. Also update its test `test/unit/scripts/test-server-conformance.test.ts`.
- `test/unit/architecture/ci-critical-path-law.test.ts` and `server-release-wiring.test.ts` (both edited by ad5782d7).
- CI job time budget (memory: every job under 7 min): the Go conformance run is one more job.
