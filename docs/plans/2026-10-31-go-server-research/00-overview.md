# Go server: parity plan (2026-10-31)

Goal: the Go server supports every feature the C# server supports. From now on every backend feature is written in both.

The ledgers in this folder list every C# feature and the test that proves Go matches it:

| Ledger | Rows | Rows with no oracle yet |
|---|---|---|
| http-host.md | 217 | 86 |
| yjs-lib0.md | 113 | 8 |
| collab.md | 191 | 115 |
| documents-runtime.md | 93 | 91 |
| agent.md | 115 | 89 |
| delivery-ci.md | 78 | 34 |
| critique.md | orphans and wrong citations, to fold into the ledgers above | |

## How parity is proven

1. **Black-box conformance.** `node scripts/test-server-conformance.mjs --target go` runs the same suite as `--target csharp`.
2. **Shared fixtures.** Both `dotnet test` and `go test` read the same files under `test/unit/server-conformance/fixtures`.
3. **Goldens captured from C#.** For a row with no oracle, capture the C# answer into a shared fixture. Both xunit and go test read it, so a stale golden fails C# too. Go fails it first, which is the TDD red step.
4. **Hand-ported tests** only where a fixture cannot express the behaviour: timing, concurrency, race-sensitive locking.

## Order

1. **Foundation** (lands first, on main, in order):
   - F1. Replace `server-go-removal-law.test.ts` with a parity law. Update release-wiring, quality-gates and critical-path laws. Add `--target go` to the conformance runner. Add a Go stub server (flag set `blok-server`, `listening on` on stderr after bind, `/health` version from `-ldflags`, default `dev`, exit within 2 s of SIGTERM). Add the Go-and-C# rule to CLAUDE.md.
   - F2. `jsjson`: one Go package for JS strings (UTF-16) and .NET-compatible JSON (System.Text.Json escaping, verbatim number text, key order, UTF-16 key sort, JS Number formatting, NaN bits, depth 512, lone surrogates). Pinned by a fixture captured from C# and Node.
   - F3. A Kestrel-compatible router (case-insensitive, trailing slash, dot segments, 405 on HEAD, encoded `%2F` kept in `{doc}`).
   - F4. The JS bundle: a committed copy inside the Go module, plus a law that its sha256 equals the C# `Generated` copy and a fresh build. A law that the bundle has no sticky regex.
2. **Three lanes in parallel:** http-host, yjs-lib0, documents-runtime.
3. **Collab** (needs all three).
4. **Agent** (needs documents-runtime and collab).
5. **Delivery and CI** beside the lanes.

Each lane ends with an independent review before landing.

## Decisions and their defaults (the user may override any of them)

| # | Question | Default |
|---|---|---|
| U1 | How Go ships | Go module `github.com/JackUait/blok/packages/server/go`, tagged `packages/server/go/vX.Y.Z`, plus its own release archives `blok-server-go_*` with `checksums-go.txt`. npm and the Docker image stay on C#. |
| U2 | Memory budget per conversion | goja has none. Go uses an approximate process-wide watchdog. Documented gap. |
| U3 | Conversion timeout | goja cannot stop a regex already running inside the engine, so the timeout is not a hard bound. Documented gap. |
| U4 | Stack overflow | Surfaces as a Go error rather than a catchable JS RangeError. The public error kind matches C#. |
| U5 | Pending promise | Fails at once in Go (there is no event loop). C# waits for cancellation. |
| U6 | C# lone-surrogate read defect (yjs T17) | Fix C# first (use `JsJson.Parse`), with a regression test; Go matches the fixed behaviour. |
| U7 | Agent `group: 15.0` (agent T3) | Match C# (refused). |
| U8 | Journal compatibility | Go reads and writes the same on-disk journal bytes as C#. |
| U9 | Runtime name in the bundle | Add a Go name next to `jint`/`csharp-live` only if a test proves C# output is unchanged. |
| U10 | Dependencies | stdlib first. goja (JS engine), golang.org/x/net (html, idna), a brotli decoder. WebSocket hand-written (gorilla and coder both hide empty fragments). |
| U11 | `Intl` missing in goja | Fix in the bundle (guard or fallback), not by injecting a host global. |
