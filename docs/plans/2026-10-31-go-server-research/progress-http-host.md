# Progress: http-host lane (Go server)

Branch `go/http-host`, worktree `/Users/jackuait/Packages/.blok-go/http-host`. Round 1, 2026-10-31.

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
- CI: `node scripts/test-server-conformance.mjs --target go --suite harness-contract --suite server-contract --suite routing-contract` (new `--suite` flag). Local wall time 1 min 44 s (the 65 s rate-limit window test dominates). **Check the CI job against the 7-minute budget.**
- Harness fix: `server-process.ts`/`run-against.ts` kill every child when its test finishes (`onTestFinished`) and on worker exit. Oracle: `server-process-cleanup.test.ts`; a timed-out test's child was also checked dead by hand.

## Ledger rows

DONE = implemented AND an oracle proves it. IMPL = implemented, no oracle yet (next round: add one). TODO = not done.

### 1a Host (H)
- DONE: H1, H2, H3, H5 (usage byte-copy test), H6, H7, H8 (SC:752), H10, H11, H12 (SC upload URLs use the default), H13, H14, H15, H16, H17, H25, H26, H27, H29, H30 (HC), H4 (Go `TestMissingFlagValueExitsTwo`), H28 (Go `TestBindAddress…`), H33 (Go `deadline_test.go`, mutation-checked), H39, H40 (SC:1369/1390/1407).
- IMPL: H9, H20 (warnings), H22, H23, H24 (env/flag precedence, duplicate-key refusal via jsjson), H31 (ReadHeaderTimeout 10 s), H32 (IdleTimeout 2 min). Oracle: F1 `host-cli-contract.test.ts` (not written).
- Collab lane: H18, H19, H21, H34–H38, H41 (`--conformance-journal` is parsed and ignored).

### 1b Validate (V)
- DONE: V2–V34 via `options-validate.json`; SC:789/940 too.
- IMPL: V1 (defaults copied; no fixture compares the C# default values). V35: Go validates once in `New` and copies `Options`, so a post-registration mutation cannot happen. Decision, not parity: documented here.

### 1c Library (L)
- DONE: L3 (SC local + S3), L17 (SC unfurl/by-url cases).
- IMPL: L1 (`New`; no public override seams yet), L6, L7 (`Handler(prefix)`; prefix untested), L8 (files outside the prefix; untested), L10/L11 (`Authorization` interface; consulted by collab only), L12 (`User` on context in ticket mode; untested).
- TODO: L9 open-routes warning (needs collab; and a `Logger` option).
- Collab/documents: L2, L4, L5, L13–L16.

### 1d Routing and guard (R)
- DONE: R1–R3, R5–R7, R9–R15, R18–R21, R23 (SC + `internal/route`).
- IMPL: R16 write-access 403, R17 doc claim ignored on HTTP routes. Oracle: Go guard test (next).
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
- TODO: O15–O17 TLS. The darwin decision (T27) is not measured yet; Go uses the default verifier with system roots. Next round: F12 leak test, then decide.
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

## Next round, in order
1. F1 `host-cli-contract.test.ts` (black-box): H4, H9, H20, H22–H24, V3, V9, V11, V12, V15–V25, V28, V31, IPv4 shorthand listens.
2. Go guard test for R16/R17/L12.
3. F8 outbound black-box (encodings, 6-hop redirect, UA/no Accept-Encoding, 5 concurrent).
4. F9 byte ranges; F13 unfurl HTML; F7 S3 golden.
5. Darwin TLS: measure (F12), decide, document.
6. L9 warning + `Logger` option (with collab).
