# Progress: http-host lane (Go server)

Branch `go/http-host`, worktree `/Users/jackuait/Packages/.blok-go/http-host`. Round 1 and round 2, 2026-10-31.

## Round 3 (newest first)

All six rows left after round 2 are closed. No ledger row in this lane is open; the rest are deferred to collab (list under "Still open after round 2", plus L1's collab seams).

- V35 DONE: `blokserver/library_test.go` `TestNewKeepsItsOwnCopyOfTheOptions`. Go bug fixed: `New` shared the `RichTextFields` map (and its slices) with the caller; it now deep-copies. Mutating `AllowedOrigins[0]` after `New` was already safe.
- L1 DONE for the non-collab seams, rest deferred: `Options.Clock` added (the `TimeProvider` TryAdd, `BlokServerServiceCollectionExtensions.cs:77`; tickets, rate limit, S3 signing read it). Oracle `TestOptionsClockDrivesTheTicketCheck` (a 2020 ticket passes only with a 2020 clock). `Authorization` was already there. Blob store and fetcher stay unexported seams, as §5 says. Deferred to collab: `OperationStore`, `ActivityObserver`, `Logger` (their types live in the collab lane; `Logger` goes with L9).
- L6 DONE: `TestS3StoreSpoolsToTheTempDirUpToTheUploadCap` (mutation-checked): `MaxSpoolBytes = MaxUploadBytes`, `TempDir` empty means `os.TempDir()`. Both read `TMPDIR` on Unix, as the round-2 spool case shows black-box.
- S13 DONE: new xunit `S3BlobStoreTimeoutTests` (raw socket, `RequestTimeout`/`ResponseHeaderTimeout` options set small) and its Go port `internal/blob/s3_timeout_test.go` (unexported `requestTimeout`/`headerTimeout`, -race). Measured on C#: a GET with no body still gets the header timeout (PayloadContent's callback fires for zero-length content); the header clock starts after the body is sent (64 MiB body, server waits 3x the timeout before reading); a stalled response body ends at the request timeout. Mutation-checked on both sides (C#: start the header timer at request creation; Go: drop `ResponseHeaderTimeout`, or use the header timeout for the whole request). Connect 10 s and no redirects by a field test.
- S16 DONE, Go bug fixed: `fixtures/s3-proxy.json` (25 settings, `http-host-contract`: "sends S3 requests through the environment proxy the way .NET does"). The S3 endpoint is an unresolvable https name, so a proxy only shows as a CONNECT; loopback http endpoints check the absolute-form target. `internal/blob/proxy.go` ports `HttpEnvironmentProxy` (decompiled from System.Net.Http 10.0.11, osx). Go's `ProxyFromEnvironment` failed 5 cases before (ALL_PROXY, bare NO_PROXY domain, `*`, empty `no_proxy` hiding `NO_PROXY`) and would also bypass loopback, which .NET does not.
  - Not ported, documented: with no variable set .NET on macOS falls back to `MacProxy` (system settings); Go uses none. The golden is captured with no system proxy set. `socks4://`/`socks4a://` are parsed but Go's transport cannot use them. Go sends proxy credentials from the URL up front; when .NET sends them is UNVERIFIED. A host with `/?#@ ` is refused in Go; what `UriBuilder` does there is UNVERIFIED. The Linux build's fallback is UNVERIFIED (only the osx dll was read).
- O15 DONE: `internal/outbound/tls_test.go` ports `PreservesTheHostnameForTlsSniAndCertificateValidation`, `RejectsATrustedCertificateForTheWrongHostname`, `RetainsNormalTlsCertificateValidation`, `OffersOnlyHttp11DuringMacOsTlsNegotiation` (runs on every OS in Go), plus two Go-only checks: a leaf with CRL and OCSP URLs verifies with zero hits (RevocationMode NoCheck, `GuardedOutboundFetcher.cs:455-476`), and an IP literal sends no SNI (what SslStream sends there is UNVERIFIED). ALPN and verification are mutation-checked; SNI and revocation are behaviour pins (Go's TLS never sends SNI for an IP and never checks revocation, so no code line can be mutated).

### Round 3 conformance (`--target go`)
- CI step (harness, server, routing, host-cli, http-host): 151 passed, 25 skipped (collab), 0 failed; 2 min 6 s locally. The proxy case adds about 20 s on C# and 1 s on Go.
- `blok-client-contract`: still 0/12, every test needs `/sync` (collab lane). Suites on main did not change since this branch forked (`git log HEAD..main` over the contract files is empty).

### C# changes this round
- New test only: `Blok.Server.Tests/S3BlobStoreTimeoutTests.cs` (`dotnet format --verify-no-changes` clean). No C# bug found.

### CI time budget (7 min per job): at risk
- "Server Delivery" runs both conformance steps. On main (run 41152050359) it took 4 min 30 s, with Go running only `--test-name-pattern health`.
- This branch adds about 40 s to the C# step (http-host-contract: 10 s header case, about 20 s of proxy starts) and makes the Go step about 2 min 6 s (local). Projected about 6.5 to 7 min. Measured locally, not on a runner. Before landing, check the job time, or move the Go conformance step to its own job (mind the 20-job cap) or trim the 65 s rate-limit window case in host-cli-contract.

### Notes for the collab lane
- The S3 client (`blob.S3`, also the working-set store's) uses the .NET environment proxy (`internal/blob/proxy.go`), not Go's.
- `Options.Clock` exists. Collab code must read `s.clock`, never `time.Now`.
- `New` deep-copies `RichTextFields`; read `s.options.RichTextFields`.
- `blob.S3` has unexported `requestTimeout`/`headerTimeout`; zero means 5 min / 60 s.
- Leftover processes seen this round, not this lane's: pid 9831 (from round 1) and pid 78333 (cwd `/Users/jackuait/Packages/.blok-go/documents-runtime`, `lsof -d cwd`).

## Round 2

New suite `test/unit/server-conformance/http-host-contract.test.ts` (in CI for Go and C#). Each `it` replays requests and compares with a golden captured from C# (`BLOK_WRITE_FIXTURES=1 node scripts/test-server-conformance.mjs --target csharp --suite http-host-contract`); the input list must equal the golden's.

- LF3, LF6–LF12 DONE: `fixtures/local-file-responses.json` (120 requests). It found a Go bug: dates. `internal/dotnet/httpdate.go` ports `HeaderUtilities.TryParseDate` (16 formats read from the decompiled ASP.NET 10.0.11 dll, DoStrictParse rules from System.Private.CoreLib); `fixtures/http-dates.json` (172 inputs, `HttpDateFixtureTests` recomputes). Multi-line headers are joined with "," like `StringValues.ToString`.
- Query parsing bug fixed: `/unfurl?url=` now uses `dotnet.QueryFirst` (split on `&` only, `+` to space, `Uri.UnescapeDataString`, name OrdinalIgnoreCase). Oracle `fixtures/unfurl-queries.json` (17 spellings; `;`, `URL=`, `%zz` failed on Go before).
- D4, S6 DONE: `fixtures/local-delete-responses.json`. Go bug fixed: `os.Remove` removed an empty directory at the key; C# answers 502.
- U4 DONE (`fixtures/upload-section-limit.json`), U8 DONE (spool name, mode 0600, removed after finish and abort; mutation-checked).
- M1, M3, M7, M10 DONE: `fixtures/unfurl-html.json` (167 pages incl. depth 508–515, bad UTF-8, IDN domains; `UnfurlHtmlFixtureTests` recomputes; Go `internal/unfurl/parse_test.go`). Go bugs fixed: scripting must be off (noscript holds markup), `<template>` contents are not children, AngleSharp 1.8.6's own "in select" mode (decompiled; `selectState` emulates it), rel lowercasing kept U+0130. Dropped from the fixture: a `mailto:` final URL (Go's `dotnet.URI` is http/https only; unreachable, the fetcher only returns http(s) final URLs).
- O5 (cookies, auth, redirects, compression), O6, O7, O10, O12 DONE: `fixtures/outbound-encodings.json` (29 bodies), `fixtures/outbound-request-headers.json`, and the shared-slot case (peak 4 across unfurl + by-url). Go bugs fixed: `Connection: close` was sent (now `MaxIdleConnsPerHost: -1`); gzip trailing bytes, truncated gzip/deflate/br, and brotli trailing bytes now follow .NET's non-strict decode (decompiled `Inflater.ResetStreamForLeftoverInput`, `DeflateStream.ReadCore`; `internal/outbound/decode.go`). O5 "no proxy" is by code (`Proxy: nil`), no oracle.
- O3, O4 DONE: hand ports in `internal/outbound/fetcher_test.go` (mixed/empty/site-local answers block before any socket, one lookup, vetted addresses in order, IPv6 literal never resolved, IPv6 candidate). Slots: `TestHoldsFourResponsesUntilOneIsReleased`. B8 DONE: `blokserver/byurl_test.go`. All mutation-checked.
- S8, S10, S11, S12, S15 DONE: `internal/blob/s3_test.go` hand-ports S3TargetResolverTests (11 + 14 cases), the frozen SigV4 vector, the 7 S3BlobStoreObjectMethodsTests, the PUT attachment headers, the media-type cases, the spool cap. Mutation-checked.
- V1 DONE: `fixtures/options-defaults.json` (`OptionsValidateFixtureTests.DefaultsMatchTheFixture`; Go `TestDefaultOptionsMatchTheCSharpDefaults`).
- H31 DONE, Go bug fixed: Kestrel answers stalled headers with a bare 408 and closes (`fixtures/header-timeout.json`); Go closed silently. `cmd/blok-server/headertimeout.go` keeps a per-connection clock from the first byte to the handler (net/http's StateActive fires only after the headers). H32 pinned by a field test (a 2-minute black-box case is too slow).
- A silent connection (no byte at all) closes after KeepAliveTimeout, no answer, like Kestrel (decompiled `Http1Connection.BeginRequestProcessing`); Go test `TestASilentConnectionClosesAtTheKeepAliveTimeout`. Kestrel skips leading CR/LF before starting the header clock; Go starts it on any byte (not ported). Hooks: `limitRequestHeaders` chains earlier ConnState/ConnContext. Collab hand-off: Hijack returns a `*headerConn`, not a `*net.TCPConn`.
- L7, L8, L10, L11 DONE: `blokserver/handler_test.go` (prefix routes, files at the root, deny-all Authorization never asked on upload/unfurl/delete).

### Round 2 conformance (`--target go`)
- harness, server, routing, host-cli, http-host contracts: 150 passed, 25 skipped (collab), 0 failed. Local wall time 1 min 16 s.
- Same five suites on C#: 175/175. http-host-contract adds about 20 s to the C# job (the 10 s header-timeout case).
- blok-client-contract: 0/12, every test needs `/sync` (collab lane).

### Still open after round 2
- Deferred to collab: H18, H19, H20 (the warning needs --collab to start), H21, H34–H38, H41, L2, L4, L5, L9 (open-routes warning), L13–L16, R4, R8, R22, H33 "sync opts out" (hand-off notes below; also `headerConn` wraps the hijacked conn, its clock stops on StateHijacked).
- Decisions, not ports: V35 (Go validates once in `New` and copies Options, so no post-registration mutation exists), L1 (no DI container; hooks are Options fields, `s.fetcher`/`s.store` are the only seams, internal), L6 (spool dir `os.TempDir()`, cap MaxUploadBytes, `server.go:321`; by code).
- By code, no oracle: S13 (timeouts are constants in `s3.go`), O15 (Go's verifier does no revocation; SNI per `tlsConfig`), O5 proxy.
- UNVERIFIED: S16 (which proxy settings .NET reads; Go uses `http.ProxyFromEnvironment`). Non-ASCII header bytes in date headers (Go parses UTF-8 runes; Kestrel's decoding not measured).
- Leftover processes from other lanes (not touched): Go stubs from `.blok-go/documents-runtime` and `.blok-go/yjs-lib0` worktrees (`--storage-dir  --max-upload 0`, parent 1), and pid 9831 from round 1. Their worktrees lack this lane's harness kill fix.


Read this first next round. Ledger: `http-host.md`. Row IDs below are the ledger's.

## Where things live

| Go path | What it ports |
|---|---|
| `blokserver/options.go` | `BlokServerOptions` + `Validate` (all refusal messages) |
| `blokserver/server.go` | `New`, `Handler(prefix)`, `Drain`, guard, CORS, preflight, fixed-window limiter, health, S3 wiring |
| `blokserver/upload.go` | `UploadEndpoint`: own multipart reader (ASP.NET limits), strict QP decoder, spool |
| `blokserver/handlers.go` | unfurl, delete, upload-by-url, local file entry |
| `blokserver/localfile.go`, `contenttypes.go` | `LocalFileEndpoint` (preconditions, ranges), ASP.NET content-type table (generated) |
| `blokserver/user.go` | exported `User`, `WithUser`, `UserFrom`, `Authorization` (aliases of `internal/auth`) |
| `blokserver/ticket/mint.go` | `ticket.Mint` (= `BlokTicket.Create`) |
| `blokserver/conformance.go` | `UseConformanceOrigin`, `-tags conformance` only |
| `internal/ticket` | `TicketVerifier` |
| `internal/dotnet` | `IPAddress.TryParse`, `System.Uri` (http/https), `Uri.UnescapeDataString` |
| `internal/mediatype` | `MediaTypeHeaderValue` grammar, wire sanitize, boundary, JSON check |
| `internal/blob` | `BlobKey`, `LocalBlobStore`, `S3BlobStore` + SigV4 + `GetObject/PutObject/DeleteObject` for collab |
| `internal/outbound` | `GuardedOutboundPolicy`, `ExactOriginOutboundPolicy`, `GuardedOutboundFetcher` |
| `internal/unfurl` | `UnfurlMetadataParser` (x/net/html) |
| `cmd/blok-server/args.go` | hand port of `HostArguments.Parse` (not the flag package) |
| `cmd/blok-server/deadline.go` | request deadline: 504 + cancel, decided by the clock |
| `cmd/blok-server/conformance*.go` | `ConformanceArguments` pre-filter |

Packages are at module-root `internal/` so the collab lane (`internal/collab/...`, `internal/httpapi/collab`) can import blob, S3 object methods, outbound, ticket and auth.

## Shared fixtures added (C# is the reference; xunit recomputes; `BLOK_WRITE_FIXTURES=1` rewrites)

| Fixture | C# test | Go test |
|---|---|---|
| `fixtures/dotnet/primitives.json` (63 IPs, 231 URIs, 28 relative, 13 unescape) | `DotnetPrimitivesFixtureTests` (capture: `dotnet fsi scripts/capture-dotnet-primitives.fsx`) | `internal/dotnet` |
| `fixtures/options-validate.json` (88 cases) | `OptionsValidateFixtureTests` | `blokserver/options_test.go` |
| `fixtures/tickets-extended.json` (37 payloads, 13 tokens, 9 mints) | `TicketFixtureTests` | `blokserver/ticket` |
| `fixtures/media-types.json` (64) | `MediaTypeFixtureTests` | `internal/mediatype` |
| `fixtures/content-types.json` (382) | `ContentTypeFixtureTests` | `blokserver/contenttypes_test.go` |
| `fixtures/outbound-policy.json` (126 IPs at range edges, 39 URLs, 10 relative) | `OutboundPolicyFixtureTests` | `internal/outbound/policy_test.go` |

## Conformance status (`--target go`)

- `server-contract.test.ts`: 67/67 pass.
- `harness-contract.test.ts`: 2/2 pass.
- `routing-contract.test.ts`: all non-skipped pass. Skipped on Go: the collab host block (collab lane) and "malformed escape on an unknown route" (net/http answers 400 before any handler; not fixable in a router).
- `blok-client-contract.test.ts`: 0/12. Every test needs `/sync` (collab lane): connects-with-subprotocol, converges-with-stock-peer, reads-seeded-doc, read-only-client, resets-on-4409, close-1001-on-SIGTERM, awareness, v2-on-v1-server, stock-reader-with-v2-writer, two-tabs-one-outbox, row-journalled-by-other-tab, quarantine-on-verdicts.
- CI: `node scripts/test-server-conformance.mjs --target go --suite harness-contract --suite server-contract --suite routing-contract --suite host-cli-contract` (new `--suite` flag).
- `host-cli-contract.test.ts` (new): 19/19 on Go and on C#. Local wall time 1 min 44 s (the 65 s rate-limit window test dominates). **Check the CI job against the 7-minute budget.**
- Harness fix: `server-process.ts`/`run-against.ts` kill every child when its test finishes (`onTestFinished`) and on worker exit. Oracle: `server-process-cleanup.test.ts`; a timed-out test's child was also checked dead by hand.

## Ledger rows

Count (python over the ledger's §1 table rows, 217 total): 154 DONE, 20 deferred to the collab/documents lanes, 43 IMPL or TODO:
H20 H31 H32 V1 V35 L1 L6 L7 L8 L10 L11 U4 U8 B8 D4 LF3 LF6–LF12 S6 S8 S10–S13 S15 S16 O3–O7 O10 O12 O15 M1 M3 M7 M10.

### Hand-off to collab: the request deadline (H33)
H33 is DONE except "Sync opts out". `cmd/blok-server/deadline.go` wraps every route. Before `/sync` lands:
1. `SetReadDeadline` stays on the `net.Conn` after a hijack; net/http leaves clearing it to the caller, so a sync socket's reads would fail 10 minutes in. Clear both deadlines right after `Hijack`, or skip `withDeadline` for `GET /sync/{doc}`.
2. `trackingWriter` has `Unwrap`, so `http.NewResponseController(w).Hijack()` works, but a `w.(http.Hijacker)` assertion does not.
3. The `AfterFunc` would write 504 onto a hijacked connection. Mark the writer hijacked (or bypass it) so `timeOut` is a no-op.

DONE = implemented AND an oracle proves it. IMPL = implemented, no oracle yet (next round: add one). TODO = not done.

**The Round 2 section above supersedes the IMPL/TODO marks below.**

### 1a Host (H)
- DONE: H1, H2, H3, H5 (usage byte-copy test), H6, H7, H8 (SC:752), H10, H11, H12 (SC upload URLs use the default), H13, H14, H15, H16, H17, H25, H26, H27, H29, H30 (HC), H4 (Go `TestMissingFlagValueExitsTwo`), H28 (Go `TestBindAddress…`), H33 (Go `deadline_test.go`, mutation-checked), H39, H40 (SC:1369/1390/1407).
- DONE (new black-box `host-cli-contract.test.ts`, green on C# AND Go, in CI for Go): H4, H9 (secret warning), H22, H23 (bad env), H24 (duplicate key, non-object), H25 overflow, plus V3, V9, V11, V12, V15, V17, V22-ish (S3 rows), V24, V28, V31, and "explicit empty secret beats BLOK_SECRET" (T3).
- IMPL: H20 (doc-endpoint-auth warning; needs --collab to start), H31 (ReadHeaderTimeout 10 s), H32 (IdleTimeout 2 min).
- Collab lane: H18, H19, H21, H34–H38, H41 (`--conformance-journal` is parsed and ignored).

### 1b Validate (V)
- DONE: V2–V34 via `options-validate.json`; SC:789/940 too.
- IMPL: V1 (defaults copied; no fixture compares the C# default values). V35: Go validates once in `New` and copies `Options`, so a post-registration mutation cannot happen. Decision, not parity: documented here.

### 1c Library (L)
- DONE: L3 (SC local + S3), L17 (SC unfurl/by-url cases).
- IMPL: L1 (`New`; no public override seams yet), L6, L7 (`Handler(prefix)`; prefix untested), L8 (files outside the prefix; untested), L10/L11 (`Authorization` interface; consulted by collab only).
- TODO: L9 open-routes warning (needs collab; and a `Logger` option).
- Collab/documents: L2, L4, L5, L13–L16.

### 1d Routing and guard (R)
- DONE: R1–R3, R5–R7, R9–R15, R18–R21, R23 (SC + `internal/route`).
- DONE: R16 write-access 403, R17 doc claim ignored, L12 user on context (Go `guard_test.go`, mutation-checked).
- Collab: R4, R8, R22.

### 1e Upload, by-url, delete, unfurl
- DONE: U1–U3, U5–U7, U9–U17, B1–B7, D1–D3, D5, D6, F1u–F4u (SC). U1 chunked cap also by Go `upload_test.go` (it caught a real bug: bufio swallowed the cap error).
- IMPL: U4 (1000 sections), U8 (spool 0600, removed), B8 (permit held through Put), D4 (missing storage dir → 502).
- Divergence to check: `r.URL.Query()` drops pairs with `;`, ASP.NET keeps them (UNVERIFIED for `/unfurl?url=`).

### 1f Local files (LF)
- DONE: LF1, LF2, LF4 (table pinned to ASP.NET), LF5, LF13 (SC).
- IMPL: LF3, LF6–LF12. Oracle: F9 `byte-ranges.json` (not written). `HeaderUtilities.TryParseDate` formats beyond `http.ParseTime` are UNVERIFIED.

### 1g Tickets (T)
- DONE: T-1 … T-10 (`tickets-extended.json`, byte-identical mint).
- Decision: Go `Claims.TTLSeconds == 0` means the 300 s default (C# refuses an explicit 0). Go has no unset field.

### 1h Blob storage (S)
- DONE: S1–S5, S7 (path style), S9 (SC regex), S14 (SC:1732).
- IMPL: S6 (missing dir is an error), S8, S10 (Content-Disposition on PUT), S11, S12 (spool cap), S13, S15 (object methods for collab).
- TODO: F7 `s3-store.json` (SigV4 golden with fixed time, virtual auto-selection table, 404/403 on get, spool cap). S16: Go uses `http.ProxyFromEnvironment`; what .NET reads is UNVERIFIED.

### 1i Outbound (O)
- DONE: O1, O2 (`outbound-policy.json`), O8 (SC redirect), O9 (SC timeout), O11 (SC oversized), O13, O14 (SC link).
- IMPL: O3–O7, O10, O12 (gzip/br/deflate; brotli is `github.com/andybalholm/brotli` v1.2.6). Oracle: F8 black-box through the conformance origin (not written).
- O16/O17 darwin TLS: MEASURED and DECIDED. Go 1.27.1 on macOS, a leaf whose caIssuers URL points at a local listener: with `RootCAs` nil or `x509.SystemCertPool()` the platform verifier (trustd) fetched the issuer once (then cached it); with a pool built from PEM (a custom root, or `/etc/ssl/cert.pem`) it never did. Probe: `scratchpad/tlsprobe`. Decision: on darwin the guarded fetcher verifies against a pool built from `/etc/ssl/cert.pem` (`internal/outbound/tls_darwin.go`); a missing bundle fails https closed. Gap vs C#: Keychain-only roots (enterprise CAs) are not trusted for unfurl/by-url on macOS; C# keeps them via SecTrust with network fetch off. No cgo. Oracle: `tls_darwin_test.go` (the Go port of `SslStreamStillLeaksAnIssuerFetchOnMacOs`, red before the fix).
- O15 (no revocation check, SNI = host, no SNI for IP literals): IMPL, Go's verifier does no revocation; no oracle. Windows issuer fetching is UNVERIFIED.
- Architecture law DONE: `internal/outbound/law_test.go` (AST; S3 pinned to one client, one transport, one dialer; planted violations fail it). Doc-endpoint exemption to add when collab lands its client.

### 1j Unfurl parser (M)
- DONE: M2, M4–M6, M8, M9 (SC:1416).
- IMPL: M1, M3, M7, M10. Oracle: F13 `unfurl-html/` from the 18 `UnfurlMetadataParserTests` (not written). The x/net/html depth behaviour vs AngleSharp `MaximumDepth=513` is UNVERIFIED.

### Critique orphans in this area
- `BlokServerBuilder.cs`: Go has no builder; hooks are `Options` fields. Decision.
- `ForeignBlobUrlException.cs`: `blob.ErrForeign` → 404 (SC:1824).
- `S3BlobStoreOptions.cs`: fields map to `blob.S3` (Endpoint, Region, Bucket, AccessKey, SecretKey, PublicURL, Addressing, MaxSpoolBytes, TempDir). Timeouts are constants, not options.
- `UnfurlMetadata.cs`: `unfurl.Metadata`.
- `http-client.ts`: harness helper, unchanged.
- `fixtures/metadata/error.html`: used by the fixture origin's error route; covered by SC:1453.

## C# bugs found
None this round.

## Leftover process (not started by this lane)
A Go stub `…/blok-server-conformance-ALy01T/go-conformance/blok-server --listen 127.0.0.1:0 --storage-dir  --max-upload 0` (pid 9831, parent 1) was running before this lane's first run, from a deleted temp dir. Left alone; it is the orphan the task describes.

## Next round
Superseded: the round-1 list (F7, F8, F9, F13) was done in round 2. Left for this lane once collab lands: H20 warning, L9 open-routes warning with a `Logger` option, the collab `Options` seams of L1, and the `/sync` hand-off notes above. Still not measured: the `127.1:PORT` shorthand bind (T1). H23 flag-over-env is now pinned in host-cli-contract (round 3: the variable is not parsed once the flag is given).
