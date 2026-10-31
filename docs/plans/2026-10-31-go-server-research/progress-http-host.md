# Progress: http-host lane (Go server)

Branch `go/http-host`, worktree `/Users/jackuait/Packages/.blok-go/http-host`. Rounds 1 to 4, 2026-10-31.

## Landing (2026-10-31)

All 53 branch commits were cherry-picked onto main with no conflicts (d1136b57). The first main run (41161084604) showed four failures caused by this lane. All four are now fixed:
- **Playwright could not load the harness.** `server-process.ts` imported `onTestFinished` from vitest. The MCP participant spec loads it through `run-against.ts`, so `playwright test --list` failed on every E2E shard and on Validate Spec File Coverage. Another session fixed it first in 6b9e7007 (a vitest-free registrar plus a law).
- **The IPv6 scope fixture was host-specific.** `fe80::1%eth0` resolves to `%2` on the Ubuntu runner. Another session fixed it in 51773d6c.
- **The HTML corpus overflowed (69eaf127).** `test/unit/html/corpus.ts` reads every JSON file under the conformance fixtures. The 10,000-deep case in `unfurl-html.json` overflowed the recursive tree walks in parser-differential and serializer.round-trip. That file is now left out of the corpus.
- **C# upload file names depended on process history (C# bug, 343e6eb7, BREAKING).** AngleSharp.dll references `Encoding.RegisterProvider` and `CodePagesEncodingProvider`; this is from a string scan of the dll. After the first unfurl, `filename*` in windows-1252, shift_jis, koi8-r, ibm437 or gb2312 decoded; before it, it did not. That made `ContentDispositionFixtureTests` depend on test order, and it failed on the full project run. `UploadEndpoint` now ignores any charset whose code page is not built in (20127, 28591, 1200, 1201, 12000, 12001, 65001, measured with `dotnet fsi` with and without the provider). Oracle: `FileNameStarCodePageTests`, which was red before the fix. Go and the fixture are unchanged.
- **CI time.** Server Delivery took 7 min 01 s on the first run, because the Go cache was cold after the go.sum change (vet 28 s against 1 s). Warm runs took 5 min 09 s to 6 min 01 s (e04b6b16, b7ed9a3a, 51773d6c). That leaves about 1 minute of headroom. The 61 s "resets a ticket rate-limit bucket" case now runs on both C# and Go.

## Round 4: review fixes (newest first)

Each review finding is now pinned by an oracle that fails on the old Go code (or on the mutant the review used).

- U6 re-opened, now DONE. C# bug fixed first: `filename*=utf-7''...` gave a 500. `Encoding.GetEncoding` throws `NotSupportedException` for the 65000 names, and `TryDecode5987` catches only `ArgumentException`. Now `UploadEndpoint.TryReadFileName` treats UTF-7 as an unknown charset and falls back to `filename`. xunit `FallsBackToTheFileNameWhenTheFileNameStarCharsetIsUtf7` failed before the fix.
  - Go: `blokserver/disposition.go` ports `TryDecode5987`. It has the 36 `EncodingTable` names (decompiled CoreLib 10.0.11), splits on every quote, decodes each `%XX` run on its own, and uses .NET replacement: `?` for ASCII, one U+FFFD per bad UTF-8 subpart, and U+FFFD for UTF-16/32 tails and lone surrogates.
  - Shared fixture `content-disposition-filenames.json` (147 inputs; xunit `ContentDispositionFixtureTests` recomputes; Go `TestFileNameFromDispositionMatchesUploadEndpoint`, which also rejects lone-surrogate escapes). 86 cases failed on the old Go code.
  - Black-box: http-host-contract "reads filename* with every charset .NET knows" (`upload-file-names.json`, the review's spellings plus UTF-7).
  - Mutation-checked: SplitN, the ASCII `?`, and the subpart length.
- H28/T7 re-opened, now DONE (also the `*`/`+` and localhost findings). `cmd/blok-server/listen.go` binds what Kestrel's UseUrls binds. Measured with lsof and dials on both hosts:
  - `:P`, `0.0.0.0:P` and `127.1:P` are IPv4 only (`tcp4`);
  - `*`, `+` and `[::]` are dual-stack (AnyIPListenOptions falls back to IPv4 any; decompiled);
  - `localhost`, in any case, binds 127.0.0.1 and [::1] (LocalhostListenOptions: an IOException is fatal, and one of the two is enough);
  - `localhost:0` is refused with Kestrel's message;
  - `[::ffff:127.0.0.1]:P` is refused (C#: "Can't assign requested address");
  - an address in use gets "Failed to bind to address http://IP:P: address already in use.".
  Oracle: host-cli-contract "binds ... for IPv4 ... and IPv6 ..." (9 spellings, dials 127.0.0.1 and ::1; skipped when ::1 cannot listen), "refuses to start on ...", "names the address already in use ...". 10 of 13 failed on the old Go code. The string-only `TestBindAddressMatchesTheCSharpHost` is gone.
- S3/LF2/S4 key gate, now pinned. `internal/blob/local_test.go` ports `LocalBlobStoreTests` (`RefusesForeignUrlsWithoutTouchingBystanderFiles` plus the review's `hex/../../victim.txt` key, `DeletesAnOwnedUrl...`, `KeepsOnlyABoundedAsciiAlphanumericExtension`). The review's `IsGenerated` mutant now fails 8 URLs, and the victim file is gone under it.
- O8 cap, now pinned. Go port of `RejectsTheRedirectAfterTheConfiguredCap` (3 requests, 3 lookups; the `>` mutant fails). Black-box: http-host-contract "follows five outbound redirects and refuses the sixth" (`outbound-redirect-cap.json`, new `/chain/N/` route in `fixture-origin.ts`). It pins the production cap of 5 for unfurl and upload-by-url: setting 6 or 4 in `handlers.go` fails it.
- R10 re-opened, now DONE. `internal/dotnet/ordinal.go` ports OrdinalIgnoreCase: the simple upper case per char, with U+0131 and U+017F unchanged (measured). It compares rune by rune, not byte by byte: U+0250 matches U+2C6F and U+2C65 matches U+023A on C# (measured), although their UTF-8 lengths differ. It backs the origin list, Sec-Fetch-Site and the localhost checks in `options.go` and `listen.go`.
  - Kestrel validates a response header value when it is set (decompiled `HttpResponseHeaders`, allowed chars tab and 0x20-0x7E). So an allowed non-ASCII origin, or non-ASCII Access-Control-Request-Headers, gets an empty 500 before the handler runs. Go now answers the same (`headerValueRefused`).
  - Oracle: http-host-contract "matches request origins the way OrdinalIgnoreCase does" (`origin-case-fold.json`, raw sockets, 26 cases: Kelvin, long s, dotless i, sharp s, sigma, micro, emoji, the 500s, Sec-Fetch-Site). Also a new `options-validate.json` case for `localhoſt:4000`.
- Mapped IPv6 outbound (minor, was UNVERIFIED), now VERIFIED. On C# a mapped literal is Blocked, a mapped DNS answer never connects, and the next address is tried: `new Socket(InterNetworkV6)` cannot reach `::ffff:x` (macOS EAFNOSUPPORT, measured). New xunit tests: `AnIpv4MappedLiteralNeverConnects`, `AnIpv4MappedDnsAnswerNeverConnects`, `SkipsAnIpv4MappedDnsAnswerForTheNextAddress`. Go ports are in `fetcher_test.go`.
  - Go bug fixed: Go dialed the IPv4 address behind a mapped DNS answer and fetched it. It now refuses the mapped address at once.
  - Brackets now follow `CreateHostHeader` (`TestHostHeaderBracketsEveryIPv6Literal`).
  - Linux: the Unix `SocketPal.CreateSocket` (decompiled System.Net.Sockets 10.0.11, the Unix build Linux uses as well) sets `IPV6_V6ONLY=1` on every InterNetworkV6 socket. So on Linux the connect and the bind to a mapped address also fail. The kernel's exact errno there is UNVERIFIED; the tests check only that it fails.

### New open findings (measured, not fixed)
- Request header bytes. Kestrel answers an empty 400 for a header value with invalid UTF-8 (`X-Junk: \xe9`); Go accepts it. Kestrel accepts DEL (0x7F) in a header value; Go's net/http answers 400 `400 Bad Request`. With NUL, both answer 400, but the bodies differ. Fixing this needs a check in front of net/http (invalid UTF-8) and cannot loosen net/http's DEL refusal. Not done.
- C# may want to refuse a non-ASCII `--allow-origin` at startup: today every match gives a 500. That is a published-surface change (a config that starts today would stop starting), so it is a user decision. Go copies the 500 for now.

### Round 4 runs
- gofmt clean. go vet clean, also with `-tags conformance`. `go test -race -p 2 ./...` all ok, also with `-tags conformance`.
- Conformance `--target go` (harness, server, routing, host-cli, http-host): 169 passed, 25 skipped (collab), 0 failed, 76 s.
- Same suites `--target csharp`: 194/194, 88 s. This round adds about 9 s to C# (9 bind starts, 4 refusals, 3 new http-host cases). Mind the CI budget note below.
- dotnet: Blok.Server.AspNetCore.Tests (Upload, ContentDispositionFixture, OptionsValidateFixture, HttpDateFixture, RequestGuard): 67/67. Blok.Server.Tests (GuardedOutboundFetcher, LocalBlobStore): 89/89. `dotnet format --verify-no-changes` on the changed files: clean.
- eslint on the three changed TS files: clean.
- Leftover processes: only the earlier 9831 and 78333, plus 518 (`/Users/jackuait/Packages/blok/.dev/server-bin`, the main checkout's dev server, not this lane's).

## Round 3

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
- DONE: H1, H2, H3, H5 (usage byte-copy test), H6, H7, H8 (SC:752), H10, H11, H12 (SC upload URLs use the default), H13, H14, H15, H16, H17, H25, H26, H27, H29, H30 (HC), H4 (Go `TestMissingFlagValueExitsTwo`), H28 (host-cli-contract bind cases, round 4), H33 (Go `deadline_test.go`, mutation-checked), H39, H40 (SC:1369/1390/1407).
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
- DONE: O1, O2 (`outbound-policy.json`), O8 (SC redirect; cap: Go port + `outbound-redirect-cap.json`, round 4), O9 (SC timeout), O11 (SC oversized), O13, O14 (SC link).
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
