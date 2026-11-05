# Outcome of the 2026-11-04 parity sweep

All on main. Each lane was retested on the merged tip before push.

## Fixed in Go
- Outbound and storage (aa7d411c and parents):
  - A browser URL host must be plain letters, digits, `-`, `_` and `.`.
  - A Content-Encoding line .NET cannot parse is read as identity.
  - A local upload works on a file system with no hard links.
  - `?` and `#` in an S3 key are escaped.
  - S3 requests carry no Accept-Encoding or User-Agent, and a GET returns raw bytes.
  - An empty S3 upload sends Content-Length: 0.
  - TLS handshake timeouts on S3 and the doc endpoint.
  - A seekable S3 body is hashed in place.
- Collab core (42b5ec64 and parents):
  - An empty purge id is refused.
  - The purge errors are exported from blokserver.
  - A posted checkpoint takes its lane place at once. This was a real ordering bug.
- Shared oracles and the documents API (d828b75e and parents):
  - Go matches the C# room-history error texts.
  - `blokserver.Options.Documents` and `Server.DocumentConverter()` share one engine pool.
- HTTP host round 1 (e497a6bc and parents):
  - Kestrel head limits: 414 and 431.
  - The 30,000,000-byte body cap.
  - The minimum body data rate: 408.
  - SIGQUIT stops gracefully.
  - Header grammar and the HTTP/2 preface GOAWAY.
- HTTP host round 2 (1ef14e6f and parents):
  - 505 for an unknown version.
  - A second Content-Length line is refused.
  - Transfer codings, and NUL or CR in a codings line is refused.
  - Absolute, authority and asterisk targets.
  - Status lines for 413, 416 and HTTP/1.0.
  - Full duplex for requests with a body.
  - Heads after a chunked body are checked.

## Fixed in C#
- 0222ffe4: BrowserUrl uses the same plain letter-digit host rule. This was a security fix. The filter itself never shipped, so the commit has no BREAKING label. It belongs in the release note under a901c373.
- 1ab38fad, BREAKING (user decision): a repeated JSON key takes the last value, and a lone surrogate on the plain conversions becomes U+FFFD.

## Proof added (Go had the code, nothing checked it)
- Room-level format-1 migration (20 cases).
- Checkpoint policy (8 cases).
- Version captured at load (5).
- Headless journal adoption (6).
- History caps and If-Match restore.
- tickets.json and outbound-encodings.json now have Go readers.
- Malformed rich text moved into a shared fixture.
- Relation and structure merges.
- format-1 canonical.json.
- bundle-smoke.json now has a C# reader.
- HTTP conformance cases for the 32768-char cap and raw non-UTF-8 bodies.
- The flag number grammar.

## Fixed on 2026-11-05 (HTTP host, second pass)
- HTTP/1.0 with a chunked body is read as chunked. Before, the chunks were read as the next request, and with Content-Length a request inside a chunk reached the router.
- A Content-Length with one sign (`+2`, `-0`) is read as Kestrel reads it.
- An absolute target drops its fragment, and routes a control byte or bad escape in its path or query as Kestrel does.
- A body the route left gets 6 s to arrive after the answer, then the connection closes.
- Expect is answered as Kestrel does: 100 Continue only for a first line of 100-continue, no 417, and no Connection: close after an unread body.
- Chunked trailers are checked under the head's limits and grammar, and heads after them are checked again.
- Heads after an upgrade the route did not take are checked again.

## Still different (measured, left open)
- An unread body over 256 KiB but under the cap: C# finishes its whole answer, reads the body, and keeps the connection; Go closes. net/http gives up on more than 256 KiB left (transfer.go `body.Close`, after `finishRequest` wrote the answer). Go could only keep the connection by reading the body before the answer ends. A probe that sends the body only after the whole answer got C#'s answer to the next request at once, so that would stall such a client.
- A body announced but never sent: Go closes at 6 s with a FIN. C# closes at 6.0 to 7.0 s (its 1 s heartbeat) with a reset.
- HTTP/1.0 keep-alive with a chunked body: Go closes after the answer (net/http decides 1.0 keep-alive before the handler runs). C# keeps a HEAD with keep-alive open. Closing is the safe side.
- CONNECT: Go answers with Connection: close and closes, so no head after it is read. C# keeps the connection and checks the next head.
- More than one head's worth (40 KiB) sent during an upgrade request's handler: Go stops checking heads on that connection.
- Trailer lines are dropped, not handed to the handler. Blok reads no trailers.
- An absolute target with `%2F` in its path: C# routes the decoded path (`http://x/health%2F` is 200), Go 404. Found in this pass, not fixed.
- Log wording for a room seam error on receive (collab-transport.md). Wire is the same.
- The accepted engine gaps U2–U5 (goja memory, timeout, stack, pending promise) are unchanged.

## Settled after the sweep (user decision 2026-11-05)

- An app that mounts `blokserver.Handler` in its own http.Server now gets Kestrel's body limits by default: 30,000,000 bytes and 240 B/s after 5 s, a bare 413 or 408 with Connection: close. A host that puts its own setter in the context with `WithRequestBodyLimit` (blok-server does) keeps its own limits. C# gets these from Kestrel and Rust from `blok_http::Config::default`. One difference left: on a chunked body the embedded default counts data bytes only, while Kestrel and blok-server count the framing too.

## Older known differences, settled (second lane)
Each C# answer was measured first.

- Room-history type texts. C# reads `5.0`, `-0` and `1E2` as Int64. It reads `1e20`, `9223372036854775808` and `-9223372036854775808` as Double. Go already matched. Six room scenarios now pin it (`room-undo-unreadable-lock-*`).
- Access hook error before the upgrade. Kestrel answers 500 with `Content-Length: 0` and no body, and keeps the connection. Go already matched. A synchttp test pins it.
- Connection cap. Measured on the C# host with the cap lowered to 2:
  - Two live sockets, then an upgrade C# would accept only to close (bad document): an empty 500, not 101.
  - Two live sockets, then a good upgrade: 503 from the service count.
  - One live socket, plus one rejected socket still in its 250 ms close grace, then a good upgrade: the room is joined, then an empty 500. So Kestrel counts rejected sockets.
  - Fixed in Go. With collab on, the standalone host counts every hijacked socket until it closes. A failed hijack answers the empty 500.
  - This means rejected sockets can push a real user into a 500 on C#. Go now does the same. Changing it would be a C# decision.
- Sec-WebSocket-Protocol trim. Kestrel decodes the head as UTF-8. String.Trim then drops U+000B, U+000C, U+0085, U+00A0, U+1680, U+2009, U+202F and U+3000. It keeps U+001C and U+200B. A lone 0x85 or 0xA0 byte is a 400 on both hosts (measured). Fixed in Go with `unicode.IsSpace`. A new sync-transport case passes on both targets.
- Compaction throw. No input found that reaches it. UNVERIFIED that none exists.
  - C#'s `EncodeStateAsUpdate` with no target does no decode. Its throw sites on the encode path are engine invariant checks. Examples: `Yjs/UpdateV1Encoder.cs:58` ("has no wire form") and the store lookups in `Yjs/StructStore.cs:94-209`.
  - Go has the same checks as `fail()` calls, for example `item.go:88,103` and `store.go:44,76`.
  - If one ever fired, C# would skip that flush's persist and export, and its caller would log. That reading comes from collab-core.md (`CollabRoom.cs:3550-3637`). Go logs and still persists and exports. Left as is.
- Empty user name, embedding only. Measured on C# with a per-user cap of 1:
  - Name claim absent: the second socket gets 429.
  - Name claim `"alice"`: the second socket gets 429.
  - Name claim present but empty: the second socket is admitted, with no cap.
  - Go reads an empty `User.Name` as absent and falls back to the ID, so it gives 429. Go cannot express "present but empty" without a new public field.
  - Not changed. An empty name turning the cap off looks like a C# weakness.
- G7 rest. A multipart /upload on S3 now hashes the upload's own spool in place. `countingReader` seeks like CountingReadStream. The reported size is still the furthest position read.
- G8. The gap report's "both refuse to start" was wrong. Measured on the standalone hosts:
  - `http:\\example.com`: both refuse. The texts differ: C# asks for HTTPS, and Go says it must be a full HTTP(S) origin.
  - `https:\\example.com:9000` and `http:\\127.0.0.1`: C# starts, then answers every /upload with 502 "upload failed". Go refuses to start.
  - Go was left as is. Matching would mean teaching backslashes to `dotnet.ParseAbsoluteURI`. Outbound policy, framecheck and unfurl share that parser. It would also copy a C# validation gap.
- Docs. `docs/src` makes no Go-versus-C# claim that this sweep made wrong. The 1,024 ceiling entry (500 from the backstop after the document loads) now matches what was measured.
