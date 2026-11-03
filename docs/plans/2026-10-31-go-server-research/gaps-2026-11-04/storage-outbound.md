# Go vs C# parity gaps: Storage, Outbound, FrameCheck, Metadata, Tickets

Area: library code under the HTTP host.
- C#: `packages/server/dotnet/Blok.Server/{Storage,Outbound,FrameCheck,Metadata,Tickets}`
- Go: `packages/server/go/internal/{blob,outbound,framecheck,unfurl,ticket,mediatype}` and `go/blokserver/ticket`

Method: I read each C# file next to its Go twin. Where the code differed, I measured both sides.
- C#: `dotnet fsi`, calling the built `Blok.Server.dll` by reflection, or the .NET API itself. The Storage code has not changed since 2026-10-05, so the 2026-10-13 dll is current for it.
- Go: `go test -overlay` with throwaway test files kept in the scratchpad.

No repo file was edited. Probe sources: `scratchpad/probe-storage-outbound/` (`*.fsx`, `*_probe_test.go`, `overlay*.json`).
- `s3_probe_test.go` holds only the last of its three versions (the TLS stall). The target and wire versions were overwritten.

---

## CONFIRMED GAPS

### G1. The browser URL filter lets through a host whose IDN form holds a URL delimiter (HIGH, security)

**C#:** `BrowserUrl.Secure` reads `url.IdnHost` inside try/catch.
- `.NET` throws `UriFormatException` when the IDN-mapped host holds `# / : ? @ [ \ ]`.
- The URL is then dropped (`Outbound/BrowserUrl.cs:67-77`).

**Go:** `publicHost` (`go/internal/outbound/browserurl.go:52-70`) uses `u.IdnHost` with no such check.
- The check exists only in `DefaultPolicy.Validate` (`go/internal/outbound/policy.go:89-93`, commit 073f6328).
- `BrowserURL` was added later and never got it.

**Measured.** The C# column is derived, not executed. The built dll predates `BrowserUrl.cs`.
- What was measured: `Uri.TryCreate(…, Absolute)` succeeds and `Uri.IdnHost` throws `UriFormatException` (`idn.fsx`, `idn2.fsx`).
- What was read: the current source catches that exception and returns null (`BrowserUrl.cs:70-77`, and `Secure` returns null when `host is null`, `:34-40`).

| input | C# (`IdnHost`) | Go `BrowserURL` |
|---|---|---|
| `https://a／b.example/x` | throws, so null | `https://a/b.example/x` (host `a`) |
| `https://127.0.0.1／x.example/a.png` | throws, so null | `https://127.0.0.1/x.example/a.png` (**loopback**) |
| `https://localhost＃.example/a.png` | throws, so null | `https://localhost#.example/a.png` (**localhost**) |
| `https://evil.example＠bank.example/a.png` | throws, so null | `https://evil.example@bank.example/a.png` |
| `https://a？b.example/x`, `a：b`, `a＼b` | throws, so null | delimiter written raw |

**Reach:** every caller of the filter.
- `/unfurl` `meta.image` and `meta.favicon` (`internal/unfurl/parse.go:181-191`).
- `/frame-check` `oembed.thumbnail_url` (`internal/framecheck/oembed.go:84-90`).

So Go hands a reader's browser a loopback, localhost or single-label URL, or one with userinfo. That is exactly what a901c373 and 746770c9 meant to stop.

**Oracle gap:** no fullwidth-delimiter case exists in `unfurl-html.json` or `frame-check-oembed.json`. Only `outbound-policy.json` has one (`http://a／b.com/`), and that covers the fetch policy, not BrowserUrl.

**Suggested oracle:** add thumbnail cases to `frame-check-oembed.json`, recomputed by `FrameCheckOEmbedFixtureTests` (C# answer: absent):
- `https://a／b.example/x`
- `https://127.0.0.1／x.example/a.png`
- `https://localhost＃.example/a.png`
- `https://evil.example＠bank.example/a.png`
- `https://a？b.example/`, `https://a：b.example/`, `https://a＼b.example/`, `https://a［b］.example/`

Add matching `og:image` and `link rel=icon` pages to `unfurl-html.json`. Both sides already read both files.

**Fix direction:** in `publicHost`'s `"Dns"` case, refuse the same `#/:?@[\]` set `Validate` refuses.

### G2. Outbound fetch: a Content-Encoding value .NET cannot parse reads as identity on C#, but fails on Go (MEDIUM, visible on /unfurl, /frame-check and upload-by-url)

**C#:** `ReadBoundedAsync` uses the typed `content.Headers.ContentEncoding` (`Outbound/GuardedOutboundFetcher.cs:338-377`).
- When no item parses, the collection is empty.
- `encoding` is then null, so the body is read raw as identity.

**Go:** `readBounded` splits the raw header on `,` and trims (`go/internal/outbound/fetcher.go:317-349`).
- Any non-empty item that is not gzip, br, deflate or identity gives `UnsupportedContentEncoding`.

**Measured on .NET 10:**
- With `TryAddWithoutValidation`, `gzip;q=1`, `gzip x`, `"gzip"`, `gzip/1`, `gzéip` and `gzip(x)` all give Count=0.
- Over a real `SocketsHttpHandler` response (`ce2.fsx`), `Content-Encoding: gzip;q=1`, `gzip x` and `"gzip"` give `ContentEncoding.Count == 0`.

**Measured on Go:** `readBounded` gives an error for all four of `gzip;q=1`, `gzip x`, `"gzip"` and `gzip/1` (`ce_probe_test.go`).

**What users see:**
- `/unfurl`: C# `success:1` (domain, `/favicon.ico`, title if the bytes hold one), Go `success:0`.
- upload-by-url: C# stores the bytes, Go answers 400.
- `/frame-check`: C# rates the headers, Go answers `unknown`.

**Oracle gap:** `outbound-encodings.json` and `fixture-origin.ts` `ENCODED` only cover well-formed tokens: gzip/GZIP/br/deflate/identity/empty/x-unknown/compress/` gzip `/two values.

**Suggested oracle:** add `ENCODED` entries to `fixture-origin.ts`, with expected bodies captured from C#:
- `'param': { body: PRECEDENCE_HTML, encoding: ['gzip;q=1'] }`
- `'quoted': ['"gzip"']`
- `'two-words': ['gzip x']`

### G3. LocalBlobStore.Put fails on Go where the filesystem has no hard links (MEDIUM)

**C#:** commits with `File.Move(temporaryPath, finalPath)` (`Storage/LocalBlobStore.cs:72`).

**Go:** commits with `os.Link` only, then removes the temp file (`go/internal/blob/local.go:58-63`). It has no fallback.

**Measured on a FAT32 disk image mounted on macOS:**
- C# `LocalBlobStore.PutAsync` succeeded and wrote `e39c…acd.txt`.
- Go `Local.Put` failed with `link …: operation not supported`, so the upload errors.

**Affects:** `--storage-dir` on FAT/exFAT. Also any mount without `link(2)`, such as some SMB/FUSE mounts.
- That those mounts lack `link(2)` is an assumption. Linux .NET was not measured.
- It is assumed to share the Unix `File.Move` path (unverified).

**Suggested oracle:** a Go test and an xunit test that run Put against a directory where linking fails.
- In Go, inject the link function, or use a FAT image in an opt-in test.
- Assert that the file is stored, and is never written over an existing key.

### G4. S3 object key with `?` or `#` (operator `--collab-s3-prefix`): Go addresses the wrong object (MEDIUM, config-dependent, silent data clobber for `#`)

**C#:** `S3TargetResolver` sets `UriBuilder.Path` (`Storage/S3TargetResolver.cs:60-80`). The builder escapes `?` to `%3F` and `#` to `%23`.

**Go:** `target` builds the URL by joining strings, then parses it (`go/internal/blob/s3.go:111-124`). So `?` starts a query and `#` starts a fragment.

**Measured:**

| key | C# AbsolutePath | Go AbsolutePath | Go wire request-target |
|---|---|---|---|
| `pre?fix/abc` | `/bucket/pre%3Ffix/abc` | `/bucket/pre` | `/bucket/pre?fix/abc` (signed with an empty query, so the signature is wrong) |
| `pre#fix/abc` | `/bucket/pre%23fix/abc` | `/bucket/pre` | `/bucket/pre` |

- 13 other odd keys gave identical paths on both sides: space, `é`, `%2F`, `%zz`, `%41`, `..`, `.`, `\`, `[]`, sub-delims, `{}|^`"<>`, a leading `/`, `//`.
- The key layout is the same on both sides: `{prefix trimmed of '/'}/{doc key}`.
  - C#: `S3CollabStore.cs:25-35` and `KeyFor` at `:142-145`.
  - Go: `internal/collab/workingset/s3.go:26-35`.
- Neither side checks the prefix characters beyond "not empty after trimming '/'". I read:
  - C#: `BlokServerOptions.cs:478-545` (only the needs-`--collab`, journal-exclusive and needs-`--s3-bucket` checks) and the `S3CollabStore` constructor (`:17-36`).
  - Go: `blokserver/options.go:225-255`, `cmd/blok-server/args.go:127-128` (plain assignment) and `NewS3Store` (`workingset/s3.go:26-32`).
  - So both servers accept a `?` or `#` prefix, and only the addressing differs.
- So with a `#` in the prefix, Go writes every document's working set to the ONE object `bucket/<prefix-before-#>`.
- Upload keys (hex plus extension) are not affected.

**Suggested oracle:** port the C# `S3TargetResolverTests` rows with keys `a?b/c`, `a#b/c`, and also `a b`, `é`, `%2F`, `..`, `\`. Expected values come from C#: `/bucket/a%3Fb/c`, `/bucket/a%23b/c`.
- Assert both `AbsolutePath` and Go's `http.Request.URL.RequestURI()`.
- Alternatively, refuse such prefixes in BOTH servers' options validation (a breaking change).

### G5. S3 client wire: Go adds `Accept-Encoding: gzip` and `User-Agent: Go-http-client/1.1`, and silently gunzips GetObject (LOW)

**Measured** with the same PUT then GET of `p/k`; the GET answer carried `Content-Encoding: gzip`.

**C#:**
- Headers sent: Host, x-amz-content-sha256, x-amz-date, Authorization, Content-Length (also `Content-Length: 0` on GET), Content-Disposition and Content-Type on PUT.
- No User-Agent. No Accept-Encoding.
- `GetObjectAsync` returned the 25 gzip bytes (`1f 8b …`).

**Go:**
- Headers sent: the same, plus `Accept-Encoding: gzip` and `User-Agent: Go-http-client/1.1`.
- No Content-Length on GET.
- `GetObject` returned `"hello"`, already decoded.

**Code:**
- Go's `http.Transport` in `NewS3` leaves `DisableCompression` false and sets no User-Agent (`go/internal/blob/s3.go:60-70`).
- C# uses a bare `SocketsHttpHandler` (`Storage/S3BlobStore.cs:266-273`).

**Effect:** a working-set object that carries `Content-Encoding: gzip` reads back different bytes. Blok itself never sets that, so this needs an odd bucket or gateway. The extra headers are unsigned, so signing is unaffected.

**Suggested oracle:** extend the Go port of the S3 object-method tests with a raw listener. Assert the exact request header set, and that a gzip-encoded GET body comes back byte for byte.

**Fix direction:** `DisableCompression: true`, and set `User-Agent` to empty (`request.Header["User-Agent"] = nil`).

### G6. S3 client: a stalled TLS handshake fails after 10 s on C#, but only at the request timeout (5 min) on Go (LOW-MEDIUM)

**C#:** `SocketsHttpHandler.ConnectTimeout = 10 s` (`Storage/S3BlobStore.cs:271`) also bounds the TLS handshake.

**Go:** `net.Dialer{Timeout: 10s}` bounds only TCP (`go/internal/blob/s3.go:59`). The Transport has no `TLSHandshakeTimeout`, and `ResponseHeaderTimeout` starts only after the request is written.

**Measured** against a listener that accepts and never answers the ClientHello, with the request timeout set to 30 s on both:
- C# failed after 10.0 s (TaskCanceledException).
- Go failed after 30.0 s (`context deadline exceeded`).
- At the defaults, Go would hang uploads and collab reads for 5 min.

**Suggested oracle:** add the stall case to `S3BlobStoreTimeoutTests` and its Go port `internal/blob/s3_timeout_test.go`. Expect failure at the connect cap, not the request timeout.

**Fix direction:** `TLSHandshakeTimeout: s3ConnectTimeout`, or a dial and handshake both under one 10 s deadline. Check whether .NET's 10 s covers TCP and TLS together or each one separately; this was not measured.

### G7. S3 PUT always spools to TMPDIR on Go; C# streams a seekable body without a temp file (LOW)

**C#:** `PreparedPayload.CreateAsync` hashes a seekable stream in place, with no temp file (`Storage/S3BlobStore.cs:437-459, 485-517`). Both callers pass seekable streams:
- upload-by-url passes a `MemoryStream` (`Blok.Server.AspNetCore/UploadByUrlEndpoint.cs:124-131`).
- upload passes a `CountingReadStream` over its temp `FileStream`; `CanSeek` passes through (`UploadEndpoint.cs:780`).

Only a non-seekable body is spooled. For that spool, C# also runs `Directory.CreateDirectory(temporaryDirectory)` (`:531`).

**Go:** `S3.Put` always copies into a new `blok-s3-*.tmp` under `TempDir` or `os.TempDir()`, and never creates the directory (`go/internal/blob/s3.go:173-218`).

**Effect** (from reading the code, not measured):
- By-url uploads to S3 fail on Go when TMPDIR is missing, not writable or full. C# succeeds.
- File uploads need 2x the upload size in TMPDIR on Go (the upload spool plus the S3 spool), against 1x on C#.

**Suggested oracle:** a Go test where `TempDir` cannot be written. Put from a `bytes.Reader` or `*os.File` must still succeed, like C#.

### G8. S3 endpoint error text differs for a backslash endpoint (LOW, message only)

**Measured:**
- `http:\\example.com` and `https:\\example.com:9000`: C# says `blobstore: s3 endpoint host "example.com" must be ASCII`; Go says `blobstore: s3 endpoint "http:\\example.com" has no usable host`.
- Both refuse to start, so only the operator-facing text differs.
- Code: `Storage/S3TargetResolver.cs:38-51` against `go/internal/blob/s3.go:91-107`.
- The 9 other endpoint spellings tried matched (`http:example.com`, `http:/…`, `:0`, upper case, `/%2F`, `[::1]`, leading space; for userinfo, see the accepted section).

**Suggested oracle:** add these rows to the S3 rows in `host-cli-contract`, or to the ported `S3TargetResolverTests`.

---

## DOCUMENTED / ACCEPTED DIFFERENCES

- **macOS TLS roots for guarded fetches.** Go verifies against `/etc/ssl/cert.pem` (`internal/outbound/tls_darwin.go`), so roots only in the Keychain are not trusted.
  - C# uses SecTrust with network fetch off (`MacOsTlsTransport.cs`).
  - Recorded in `progress-http-host.md` (O16/O17). Off macOS, Go uses the system roots. Windows issuer fetching is UNVERIFIED (`tls_other.go`).
- **Ticket mint with TTL 0.**
  - C# `BlokTicket.Create` throws for `TtlSeconds = 0` (`Tickets/BlokTicket.cs:59`).
  - Go `ticket.Mint` reads 0 as the 300 s default (`blokserver/ticket/mint.go:46-49`), because Go has no "unset".
  - Negative TTL is refused by both. An API-shape difference only.
- **3xx with a Location that .NET cannot parse** (for example `http://a:99999/` or `http://[x/`, measured: `HttpResponseHeaders.Location` is null).
  - C# treats it as a final response and reads its body. Go validates it and fails as Blocked.
  - An empty Location is the reverse: .NET gives an empty relative Uri, Go gives `""`.
  - Not observable today: every caller (unfurl, frame-check, oEmbed, by-url) maps any non-2xx and any `GuardedFetchException` to the same answer.
  - It would become visible if a caller ever used a 3xx response.
- **S3 endpoint with userinfo** (`http://user@example.com`): C#'s target URL keeps `user@`, Go's drops it. The Host and the signature are the same. Whether .NET sends anything for the userinfo was not measured.
- **Ticket payload edge cases** (lone-surrogate escapes in `user`/`doc`): Go refuses. What System.Text.Json does was not measured; the exception might escape C#'s `catch (JsonException)`. The minter is trusted, so this is low value.

## VERIFIED AT PARITY (short)

- **S3 items the task named:**
  - Neither server has a session token: `S3BlobStoreOptions.cs:3-14` has no field, and the Go `S3` struct (`s3.go:35-46`) has none.
  - Neither server presigns: `S3RequestSigner` signs only the Authorization header, and so does Go `sign`.
  - Region appears in the scope and the signing key on both.
  - PUT sends `Content-Disposition: attachment` and the sanitised `Content-Type` (signed) identically. Captured on the wire in the G5 probe.
  - The PUT media-type sanitiser matches (trim, at most 255, printable ASCII, parses, no conflicting parameters).
  - Upload key layout `hex32 + normalised extension` and URL `PublicUrl.TrimEnd('/') + "/" + key` are the same.
  - DELETE by URL refuses a foreign URL (C# `ForeignBlobUrlException`, Go `ErrForeign`).
- **Fixture proof in this area:**
  - Read by both xunit and go test: `outbound-policy`, `frame-check-verdicts`, `frame-check-embedders`, `frame-check-oembed`, `unfurl-html`, `tickets`, `tickets-extended`, `media-types`, `dotnet/primitives`.
  - Run black-box on both targets through `http-host-contract` (`scripts/test-server-conformance.mjs` runs it for `--target csharp` and `--target go`): `outbound-encodings`, `outbound-header-size`, `outbound-redirect-cap`, `outbound-request-headers`, `s3-proxy`, `unfurl-queries`, `frame-check-responses`, `metadata/*.html`.
  - No fixture in this area is proven on one side only. The gaps above are cases that no fixture holds.

- **Outbound policy:** the forbidden ranges (same 35 prefixes in the same order, SIIT included), the URL rules, the port 80/443 rule, mapped IPv4.
  - Proof: `outbound-policy.json` (xunit `OutboundPolicyFixtureTests` and Go `policy_test.go`).
- **Fetcher:** redirect statuses, the https-to-http refusal, the hop budget, the redirect cap, the 4-slot concurrency, the per-address connect timeout, the mapped-address skip, the 64 KiB head cap, `Content-Length` > cap, the truncate path, the identity, gzip-multimember, br and zlib non-strict decode, `Content-Type` reserialisation, a raw header list for the final response, and a request with only UA and Host.
  - Proof, black-box on both targets via `http-host-contract`: `outbound-encodings.json`, `outbound-header-size.json`, `outbound-redirect-cap.json`, `outbound-request-headers.json`.
  - Two Location lines take the first on both (measured).
  - The limits per endpoint match: unfurl 10 s/2 MiB/5, frame-check 10 s/256 KiB/5 with truncate, oEmbed 64 KiB on what is left of the budget, by-url 2 min/MaxUpload/5.
- **FrameCheck verdict:** checked line by line (CSP split, the frame-ancestors grammar, scheme/host/port/path, `'self'`, the XFO get-decode-split). Proof: `frame-check-verdicts.json` (108 cases, both sides).
  - `Uri.UnescapeDataString` vs `url.PathUnescape` differ only on bad escapes. The piece is always compared with `""`, so this has no effect.
- **Embedder choice:** `frame-check-embedders.json`, both sides.
- **oEmbed answer:** `frame-check-oembed.json` (124 cases, both sides). This covers depth 64, the UTF-16 cut and the size regex. Its thumbnail filter has the G1 gap.
- **Unfurl parser:**
  - The meta, link and rel rules, trimming (the .NET `Char.IsWhiteSpace` and Go `unicode.IsSpace` sets match), ASCII lowering (Kelvin K cannot hit any target word), domain, `/favicon.ico` fallback, oEmbed resolve, and the depth cut.
  - Proof: `unfurl-html.json` (205 pages, both sides).
  - `fixtures/metadata/*.html` is read only through `fixture-origin.ts` (black-box, both).
- **Tickets:** verify and mint are the same logic. Proof: `tickets.json` and `tickets-extended.json` (xunit `TicketFixtureTests` and Go `blokserver/ticket/ticket_test.go`).
- **BlobKey and LocalBlobStore:** key shape, extension normalising, public-URL parse, the foreign check, delete semantics (missing file OK, missing directory an error, never removes a directory), 0600 temp then 0644 (except G3).
- **S3:**
  - Bucket and addressing validation, the virtual-host auto rule, the endpoint path rule, and the SigV4 canonical form. The headers are signed in the same order, measured on the wire; signatures differ only by time.
  - 404 handling, the error prefix of 512 bytes, the request and header timeouts, no redirects.
  - The environment proxy is proven by `s3-proxy.json` (black-box, both).
- **Commits after 2026-10-31 in this area all have a Go twin:** a2a7fb5a, ff4a7986, a901c373, f544113e, 746770c9, 4eb0684e, 9958a221, 16f8aa81, ef3badb3, fa851aba, f8d32007, 679e97e3, 1ab0d620, d3a051df, b67a67d5, 073f6328.
  - G1 is the one place where 073f6328's check did not reach a later surface (BrowserURL).
