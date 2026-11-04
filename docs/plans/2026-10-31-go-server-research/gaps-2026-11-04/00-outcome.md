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
- G8: a different startup error text for an S3 endpoint with backslashes.
- The multipart /upload still spools to a temp file on S3.
- Connection-cap counting, Sec-WebSocket-Protocol trimming and log wording. These are low and were listed in collab-transport.md.
- An app that embeds blokserver in its own http.Server gets no body cap or rate unless it wires the new hook, much as a C# host's own Kestrel sets those limits.
- The accepted engine gaps U2–U5 (goja memory, timeout, stack, pending promise) are unchanged.
