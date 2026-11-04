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

## Still different (measured, left open)
- An unread body over 256 KiB but under the cap: C# drains it and keeps the connection; Go closes.
- A body announced but never sent: C# closes after about 6 s; Go waits for the read deadline.
- Expect: 100-continue with an unread body: Go sends Connection: close at once.
- HTTP/1.0 with a chunked body: C# decodes it; net/http sees an empty body.
- Heads after a chunked trailer, an upgrade or CONNECT are not checked.
- Content-Length `+2` or `-0`: C# reads them as numbers; Go answers 400.
- An absolute target with a fragment: C# 200, Go 404.
- An app that embeds blokserver in its own http.Server gets no body cap or rate unless it wires the new hook, much as a C# host's own Kestrel sets those limits.
- Log wording for a room seam error on receive (collab-transport.md). Wire is the same.
- The accepted engine gaps U2–U5 (goja memory, timeout, stack, pending promise) are unchanged.

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
- Compaction throw. Not reachable from any input found:
  - C#'s `EncodeStateAsUpdate` with no target cannot fail on decode. It throws only on an engine invariant (`has no parent to write`).
  - Go's twin of that check is `item.go:88,103`.
  - If it ever fired: C# would skip that flush's persist and export, and its caller would log. Go logs and still persists and exports. Left as is.
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
