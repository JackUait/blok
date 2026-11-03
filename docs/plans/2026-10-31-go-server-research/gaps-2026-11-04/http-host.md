# Go vs C# gaps: HTTP host and CLI/options (2026-11-04)

Scope: `Blok.Server.AspNetCore/*.cs` (not `Collab/`), `Blok.Server.Host/*.cs` versus `go/cmd/blok-server`, `go/blokserver` (top level), `go/internal/{route,auth,ticket,mediatype}`.

## How this was checked

- Read every C# file in scope next to its Go port.
- Went through every C# commit since 2026-10-31 in scope:
  - `1ccc2194` (UTF-7 filename*) and `01e071b2` (code-page filename*).
  - `679e97e3` (redirect hops charged to the rate limit).
  - `c82692f2`, `071e9f87`, `9958a221` (`/frame-check`, oEmbed, embedder param).
  - `b8ad8f9f` (escaped stderr log lines).
  - Each one also changed the Go side, and each has a test that runs on both (details under VERIFIED-AT-PARITY).
- Conformance gating: `http-host-contract`, `host-cli-contract`, `server-contract` and `routing-contract` all run for `--target go` in CI (`ci.yml:547`, every suite).
  - `http-host-contract.test.ts:28` gates only fixture *capture* to csharp, not the tests.
  - The only Go skip in these suites is the 3 `ordinaryIt` cases (`server-contract.test.ts:33`). They need the ordinary binary, and the runner builds it.
- Black-box probes over raw sockets, against the Go host built from HEAD (`go build ./cmd/blok-server`) and the C# host at `packages/server/dotnet/Blok.Server.Host/bin/Debug/net10.0` (built 2026-10-12).
  - That C# build is older than HEAD. But the only host commit since then is `b8ad8f9f` (log escaping, `git log --since=2026-10-12 -- Program.cs HostCollab.cs`).
  - Current C# code still sets only `RequestHeadersTimeout` and `KeepAliveTimeout` on Kestrel (`Program.cs:134-138`), plus the upgrade cap when collab is on (`HostCollab.cs:47-48`).
  - So every Kestrel limit probed below is the framework default, and it still applies at HEAD.
  - Probe scripts are in `scratchpad/gaps/probe/`.

---

## CONFIRMED GAPS

### G1. Kestrel request-head size limits: Go has none (431 / 414)

- **C#:** the host uses Kestrel's default limits. `Program.cs:134-138` overrides only the two timeouts. Measured on C#:
  - **Header block:** one `X:` header with a 32,730-byte value gets 200. A 32,740-byte value gets `431 Request Header Fields Too Large`, `Content-Length: 0`, `Connection: close`. So the cap is about 32 KiB.
  - **Request line:** `GET /health?<n×a> HTTP/1.1` gets 200 at n=8150 and `414 URI Too Long` (empty) at n=8170. So the cap is about 8 KiB.
  - **Header count:** 100 header lines get 200. 101 lines get 431.
- **Go:** `newHTTPServer` (`cmd/blok-server/main.go:89-99`) sets no `MaxHeaderBytes`. `target.go:30-32` confirms the head limit is net/http's 1 MiB + 4096. Measured: 200 for all of the cases above, including a 40 KiB header, a 9 KB line and 101 headers.
- **Prior notes:** `progress-collab-transport.md:81` measured the same thing and handed it to this lane ("match it in the http-host lane"). It is still open.
- **Why it matters:**
  - Go accepts about 30× more header than C#.
  - The sync door verifies every candidate ticket in `Sec-WebSocket-Protocol` (one HMAC each) before the rate limit. That is a cost lever C# does not offer.
- **Severity:** medium.
- **Oracle:** add raw-socket cases to `http-host-contract` (each instant):
  - header block at 32,730 / 32,740;
  - request line at 8150 / 8170;
  - 100 / 101 headers.
  - The C# golden captures status, empty body and `Connection: close`.
  - Kestrel's exact counting rule (whether CRLFs and the request line count) was not read from source. The golden pins it.

### G2. Kestrel's 30,000,000-byte request body cap on non-upload routes (413)

- **C#:** Kestrel's default `MaxRequestBodySize` applies to every route except `/upload`, which raises it to `MaxUploadBytes` (`UploadEndpoint.cs:22-27`). Measured on C#:
  - `POST /delete` with `Content-Length: 30000001` gets `413 Payload Too Large`, empty, `Connection: close`, at once.
  - `Content-Length: 30000000` does not get 413 (it waits for the body).
  - With a 40,000,000 Content-Length and 9 KB actually sent: 413.
- **Go:** no cap. `readEnvelope` (`blokserver/handlers.go:80-83`) reads up to 8 KiB + 1.
  - Measured: with `Content-Length: 30000001` and a short body, Go waits (no answer in 3 s).
  - With 9 KB of body sent, Go answers `400 expected {"url": "..."}`.
- **Routes affected:** `/delete` and `/upload-by-url`. Also the collab POST routes (`/sync/{doc}/reset`, `/edit`, history restore), which belong to the collab lane.
- **Library angle:** every ASP.NET app that embeds the C# library gets this Kestrel default. A Go app that embeds `blokserver` gets whatever its own `http.Server` does. So the gap is in `cmd/blok-server`, and there is an open question whether the `blokserver` handlers should enforce the cap themselves.
- **Severity:** low to medium (only status and timing differ; no data risk).
- **Oracle:** raw-socket `http-host-contract` cases with Content-Length 30,000,000 / 30,000,001 on `/delete` and `/upload-by-url`.

### G3. Kestrel's minimum request-body data rate: Go has none (408)

- **C#:** Kestrel's default `MinRequestBodyDataRate` applies. The host does not change it (`Program.cs:134-138`).
  - Measured: `POST /delete`, `Content-Length: 200`, then one byte a second.
  - Kestrel answered `408 Request Timeout`, `Content-Length: 0`, `Connection: close`, and closed at 5.9 s.
- **Go:** no body read timeout or rate.
  - `deadline.go` only enforces the 10-minute request deadline.
  - `headertimeout.go` covers only the head.
  - Measured: the same trickle got no answer and no close within 20 s.
- **Impact:** a slow-loris body holds a Go handler, its goroutine and the connection for up to 10 minutes. C# drops it in about 6 s. The same applies to a very slow `/upload`.
- **Severity:** medium (resource exhaustion).
- **Oracle:**
  - The black-box case costs about 6 s per target. The CI job is already near the 7-minute budget (`progress-http-host.md:72-74`).
  - So prefer a Go unit test in `cmd/blok-server` with an injected short window, plus a C# test pinning the default.
  - Or one `http-host-contract` case if the budget allows.
  - The exact rate and grace numbers were not read from Kestrel source. The probe only shows "aborted at about 6 s for 1 B/s".
- **Not found:** the matching response-side minimum data rate. A 33 MB local file download, stalled for 20 s and then read, completed in full on both hosts. No difference was observed there.

### G4. SIGQUIT: C# shuts down gracefully, Go crashes without draining

- **Measured** (signals reset to default before exec; without `--collab`):

  | Signal | C# | Go |
  |---|---|---|
  | SIGTERM | exit 0, one stderr line | exit 0, one stderr line |
  | SIGINT | exit 0, one stderr line | exit 0, one stderr line |
  | SIGHUP | killed by the signal (status 1) | killed by the signal (status 1) |
  | SIGQUIT | exit 0, only the listening line | `SIGQUIT: quit` plus a goroutine and register dump (203 lines), exit 2 |

- **By code:** Go subscribes only to `syscall.SIGTERM, os.Interrupt` (`cmd/blok-server/main.go:80`). So on SIGQUIT, `server.Drain` (`main.go:170`) and `httpServer.Shutdown` never run.
  - With `--collab`, C# runs `CollabDrainService.StoppingAsync` (`HostCollab.cs:96-111`) on the same graceful path.
  - So Go would skip the room flush. This is inferred from the code path, not observed (no collab run).
- **Severity:** medium (collab data still in memory is not flushed or exported on SIGQUIT).
- **Oracle:** a `host-cli-contract` case: start, send SIGQUIT, expect exit code 0 and stderr equal to just the listening line. Optionally a `--collab` variant that checks the doc endpoint got the export.

### G5. Request-head grammar: Kestrel and net/http accept and refuse different heads

Re-measured today. The first two rows were already listed in `progress-http-host.md:42` as "measured, not fixed". obs-fold is new.

| Input (`GET /health`) | C# | Go |
|---|---|---|
| header value with invalid UTF-8 (`X-Junk: \xE9`) | 400, empty body | **200** |
| header value with DEL (0x7F) | **200** | 400 `400 Bad Request` |
| obs-fold (`X-A: a\r\n b`) | 400, empty body | **200** (folded) |
| NUL in a value | 400, empty | 400, body `400 Bad Request` |
| space before colon (`X-A : a`) | 400, empty | 400, body `400 Bad Request: invalid header name` |
| no Host on HTTP/1.1 | 400, `Content-Length: 0` | 400, body `400 Bad Request: missing required Host header` |
| two Host headers | 400, empty | 400, body `400 Bad Request` |
| bare-LF line endings | 200 | 200 |

- **C#:** Kestrel's HTTP/1.1 parser (framework). The host code does not touch it.
- **Go:** net/http's parser. `target.go` rewrites only the request line, never headers (`target.go:16-27`).
- **Severity:** low to medium. Where one host accepts what the other refuses (invalid UTF-8, DEL, obs-fold), that is a request-smuggling-shaped difference behind a proxy. The body-only differences are low.
- **Oracle:** an `http-host-contract` raw-socket golden over these heads. A fix needs a pre-parser in front of net/http, like `targetStream`. Go cannot loosen net/http's DEL refusal without such a layer.

### G6. Wire-level answers net/http writes itself (low)

Measured on both hosts:
- **HTTP/1.0 request:**
  - C# answers `HTTP/1.1 200 OK` with `Connection: close`.
  - Go answers `HTTP/1.0 200 OK` with no `Connection` header.
- **HTTP/2 prior-knowledge preface** (`PRI * HTTP/2.0`):
  - C# sends an h2 GOAWAY frame (last byte 0x0D = HTTP_1_1_REQUIRED).
  - Go answers `HTTP/1.1 404 Not Found` with `404 page not found`.
- **Severity:** low.
- **Oracle:** `http-host-contract` raw-socket golden.

### G7. Log lines with invalid UTF-8 (unverified, low)

- **Go:** `writeLogLine` copies bytes that are not valid UTF-8 through raw (`cmd/blok-server/collablog.go:75-77`, "Raw bytes, so an invalid byte is not turned into U+FFFD").
- **C#:** `Line` works on UTF-16 `char`s (`HostCollab.cs:159-179`). A .NET string cannot hold invalid UTF-8, and Console.Error encodes a lone surrogate as U+FFFD (EF BF BD).
- Whether a doc id can reach the log with bytes that do not decode as UTF-8 on the C# side (how the route decodes `%E9`) was **not** measured. So the observable difference is UNVERIFIED.
- `fixtures/host-log-lines.json` covers control characters only.
- **Oracle:** add a `%E9` doc-id case to the `host-cli-contract` log-line test.

---

## DOCUMENTED / ACCEPTED DIFFERENCES

From `progress-http-host.md` and `http-host.md`. I checked that the Go code still matches each decision.

- **No builder.** C# `BlokServerBuilder` + `UseAuthorization<T>` / `UseCollabOperationStore<T>` / `UseCollabActivityObserver<T>` map to `Options.Authorization` / `CollabOperationStore` / `CollabActivityObserver` (`options.go` fields; ledger L1/L10/L13). The TimeProvider override maps to `Options.Clock`, logging to `Options.Logger`.
- **Blob store and fetcher overrides.** These are `internal` in C# too (`Blok.Server/Storage/IBlobStore.cs:3`, `Outbound/GuardedOutboundFetcher.cs:69`, `GuardedOutboundPolicy.cs:33`). That is parity, not a difference.
- **V35:** Go validates once in `New` and deep-copies Options (`server.go:52-64`). C# re-validates at resolve and map time.
- **Ticket TTL:** Go `Claims.TTLSeconds == 0` means 300 s. C# refuses an explicit 0.
- **darwin TLS:** Go trusts only the PEM bundle `/etc/ssl/cert.pem`. Keychain-only roots are not trusted for unfurl and upload-by-url (O16/O17).
- **Proxy:**
  - No macOS system-proxy (MacProxy) fallback in Go.
  - `socks4://` is parsed but cannot be used.
  - When .NET sends proxy credentials is UNVERIFIED.
- **Header clock:** Kestrel skips leading CR/LF before starting the header clock. Go starts it on any byte (round 2 note, not ported).
- **Non-ASCII `--allow-origin`:** every match gives an empty 500 on both (a user decision whether C# should refuse it at startup).
- **`Server: Kestrel` header:** left out of the contract (`http-host-contract.test.ts:31-36`, VOLATILE_HEADERS).
- **Out of this lane.** Go's `PurgeDocument`, `RecheckAccess` and `AgentExecutor` exist (`collab.go:190-249`). They are collab/agent-lane surfaces, not reviewed here.

## VERIFIED-AT-PARITY

Each item was checked by reading both sides. The oracle that runs on both targets is named.

- **CLI parser.**
  - `HostArguments.Parse` matches `args.go`: flags, `-`/`--`, `=`, bool forms, base-0 int grammar, the env vars (BLOK_SECRET, BLOK_DOC_ENDPOINT_AUTH, BLOK_COLLAB_JOURNAL, BLOK_RICH_TEXT_FIELDS, BLOK_S3_ACCESS_KEY/SECRET_KEY), flag-over-env, the default public URL, origin splitting, the ticket rate-limit default of 60.
  - The usage text is byte-identical (`main.go:22-67` vs `HostArguments.cs:19-67`).
  - Oracle: `host-cli-contract`, `main_test.go`.
- **Startup.**
  - Same exit codes (help 0, parse error 2, refusal 1).
  - Same "refused to start" text.
  - The --secret and --doc-endpoint-auth warnings print after validation.
  - The listening line prints after the bind.
- **ConformanceArguments** match `cmd/blok-server/conformance.go` (SC:1369/1390/1407).
- **Routes and dispatch.**
  - `MapBlokServer` matches `Handler(prefix)`: health GET/HEAD, 405 Allow strings, preflight 403 / 204 with Max-Age 600 and Vary, the 404 catch-all, local files outside the prefix, frame-check gated with unfurl.
  - Oracle: `routing.json`, SC, `handler_test.go`.
- **Guard.**
  - Origin rule, `Bearer ` prefix, missing / invalid pass, write 403, `user:` / `addr:` rate key, fixed-window limiter with its sweep.
  - Hop budget on the guard's key (`679e97e3`; Go `server.go:350-355`, `outbound/fetcher.go`).
  - Oracles: SC, `guard_test.go`, the http-host-contract cases "counts every outbound redirect hop" and "charges the oEmbed fetch".
- **OrdinalIgnoreCase origin match**, plus Kestrel's 500 for a non-ASCII response header value (`origin-case-fold.json`).
- **`/unfurl` and `/frame-check`** (verdict, oEmbed, embedder choice, Vary: Origin, 400 / 200 unknown). Oracles: `frame-check-*.json`, `internal/framecheck/embedder_test.go`, http-host-contract.
- **`/upload-by-url` and `/delete`:** 8 KiB envelope (depth 64 like .NET), 415 / 400 / 404 / 502 texts. Oracles: SC, `local-delete-responses.json`, `envelope_test.go`.
- **`/upload`:**
  - The `filename*` charset rules, including UTF-7 and code pages (`content-disposition-filenames.json`, `upload-file-names.json`).
  - The 1000-section cap.
  - The spool file: 0600 mode, removed afterwards.
- **UploadWire response:** `fileName`, `size` and `mimeType` are left out when empty or 0 on both (`UploadWire.cs:72-76` vs `server.go:442-458`).
- **JSON escaping:** `jsjson.AppendQuoted` ports the default `JavaScriptEncoder` (`\uXXXX` for non-ASCII and `"&'+<>\``) (jsjson tests; one `&` in the frame-check golden).
- **Local file serving:** preconditions, ranges and dates (`local-file-responses.json`, `http-dates.json`).
- **Timeouts:**
  - Header timeout 10 s → bare 408 (`header-timeout.json`).
  - Keep-alive 2 min.
  - Request deadline 10 min → 504.
  - Shutdown ceiling 30 s.
- **Listen address binding:** host-cli-contract bind cases.
- **Collab stderr logger:** category filter, warning/error kinds, control-character escaping (`host-log-lines.json`, `collablog_test.go`, host-cli-contract).
- **Library API:**
  - `New` / `Handler` / `Drain` / `PurgeDocument` / `RecheckAccess` / `WithUser` / `UserFrom` / `ticket.Mint` match `AddBlokServer` / `MapBlokServer` / `ICollabRoomManager` / `ICollabDocumentPurger`.
  - Options fields match C# property for property. `UnfurlEnabled` is inverted on purpose, so the zero value means closed, like C#'s `UnfurlDisabled = true` default.
