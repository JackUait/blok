# Go vs C# gaps: collab transport, edit API, rich text

Checked on 2026-11-04 against the working tree at HEAD `86b9f5bd`. Read only. No repo file was changed.

Paths below:
- `C/` = `packages/server/dotnet/Blok.Server.AspNetCore/Collab/`
- `S/` = `packages/server/dotnet/Blok.Server/Collab/`
- `G/` = `packages/server/go/`
- `F/` = `test/unit/server-conformance/fixtures/`

Runs this session:
- `go test -p 1 -count=1 ./internal/collab/convert/ ./internal/collab/wire/ ./internal/collab/collabhttp/ ./internal/collab/synchttp/`: all 4 ok.
- One probe through `go test -overlay`, with the file kept in the scratchpad. It is described under gap 3.
- No C# test and no conformance suite was run this session. Their results are cited from source and from earlier ledgers, and are marked as such.

## Summary

No confirmed behaviour gap. Every route, status, body and header I compared reads the same in Go as in C#. What remains is:
- three proof gaps, where the behaviour matches but no shared oracle proves it;
- carried-over items that are documented and accepted. Most cannot be seen from the standalone binary.

## CONFIRMED GAPS

### 1. Proof gap: an HTML field over 32768 chars → 413 is not proven over HTTP on Go
- **What C# does.** `S/CollabDocConverter.cs:36` sets `MaxEditHtmlChars = 32 * 1024`. At `:74-80` it throws `CollabEditException` around `BlokDocumentConversionException(DocumentTooLarge)` before any runtime read. `S/CollabRoom.cs:2161-2166` maps that to `TooLarge`. `C/EditEndpoint.cs` (`case CollabEditStatus.TooLarge`) answers 413 with the message and no Retry-After. Pinned by xunit `EditEndpointTests.AnEditWithAnHtmlFieldPastTheCapIsA413AndNeverReachesTheRuntime` (`Blok.Server.AspNetCore.Tests/Collab/EditEndpointTests.cs:689-714`): 413, no Retry-After, message, 0 reader calls, nothing committed.
- **What Go does.** The code reads the same:
  - `G/internal/collab/convert/docconverter.go:88-95` checks the same cap, measured in UTF-16 units (`jsjson.Str`), with the same message and a `jsruntime.Failure{KindDocumentTooLarge}` inside.
  - `G/internal/collab/room/ops.go:64-69` (`refusalStatus`) maps it to `EditTooLarge`.
  - `G/internal/collab/collabhttp/edit.go:114-115` answers 413.
- **Evidence of the gap.**
  - Go tests it only at the converter level: `docconverter_test.go` `TestAnEditHTMLFieldPastTheCapIsRefusedAsTooLargeBeforeAnyRead` and `TestTheEditCapCountsUTF16Units`.
  - The status table: `collabhttp/edit_result_test.go:31`.
  - No Go test sends the request through room and endpoint.
  - `collab-http-contract.test.ts` has no 32768 case. Grep for `32768|HTML characters` in the suite: no hit.
- **Severity.** Low. The code reads equal, but the chain from converter error to room to 413 is not proven on Go.
- **Suggested oracle.** One `collab-http-contract` case: POST an insert whose `data.text` is `'x'.repeat(32769)`. Expect 413, a body containing `an edit may send at most 32768`, no `Retry-After`, and no doc-endpoint put. Add a 32768-char control case that answers 204. Both targets run the suite.

### 2. Proof gap: raw non-UTF-8 edit bodies → 422 are proven only by Go unit tests, not black-box
- **What C# does.** `S/CollabEditOps.cs` (commit `6d11ac58`) catches `InvalidOperationException` and answers `collab: the request body holds text that is not valid Unicode.` (422).
- **What Go does.** `G/internal/collab/convert/editops.go:110-117` returns the same message. `editops_test.go` reads every `parse` entry of `F/canonical-edit-digest.json`, including the `bodyHex` ones.
- **Evidence of the gap.**
  - `collab-http-contract.test.ts:82` filters refusals on `body`.
  - 10 of the 92 `parse` entries have only `bodyHex`. 9 of them carry an error, for example `raw 0xff in a key`, `encoded surrogate in a value` and `overlong slash in a value`.
  - So raw invalid UTF-8 over HTTP → 422 is checked on neither target.
  - Lone-surrogate *escapes* sit in `body` entries and are checked black-box.
- **Severity.** Low.
- **Suggested oracle.** In `collab-http-contract`, also send each `bodyHex` refusal as `Buffer.from(hex, 'hex')`.

### 3. Proof gap: malformed rich text cases are C#-only inline data
- **What C# does.** `Blok.Server.Tests/Collab/RichTextMalformedTests.cs:14-81` checks `Canonicalize`, `ReadInput` and `FromDelta` against 20 inline segment cases plus 1 delta case.
- **What Go does.** Go has no twin. `richtext_test.go` covers only the shared `rich-text-canonical` and `rich-text-edits` fixtures, and none of these inputs is in them.
- **Verified this session.** I ran all 21 cases against Go's `Canonicalize`, `ReadInput` and `FromDelta` with `go test -overlay`. The probe is `scratchpad/overlay/malformed_probe_test.go`, and no repo file was touched. Result: `--- PASS: TestProbeMalformed`. Behaviour matches today.
- **Severity.** Low. This is a proof gap only.
- **Suggested oracle.** Move these cases into `F/rich-text-canonical/inputs.json` and `expected.json`, which both sides already read.

## DOCUMENTED / ACCEPTED DIFFERENCES (carried over, re-checked against current code)

| Item | C# | Go | Seen from the standalone binary? |
|---|---|---|---|
| Kestrel upgraded-connection backstop | `Blok.Server.Host/HostCollab.cs:47-51`: Kestrel `MaxConcurrentUpgradedConnections = 1024`. This also counts rejected-handshake sockets, which hold no service slot. | `G/cmd/blok-server/main.go:101-111`: only the service count (1024). Rejected sockets are uncapped. They live at most the 250 ms grace (`synchttp/endpoint.go:24`) and are billed to the rate limit. | Only with 1024 live sockets. The "Kestrel answers 500" claim comes from a C# comment (`HostCollab.cs:48-49`). **Unmeasured.** Low. |
| `Sec-WebSocket-Protocol` token trim | `C/SyncHandshake.cs` `ProtocolOffers`: `token.Trim()` (char.IsWhiteSpace) | `G/internal/collab/synchttp/handshake.go:229-239`: trims `" \t\v\f"` only | **Unverified** whether Kestrel lets non-ASCII or control whitespace into a header value at all. Low. |
| Hook throws before the upgrade | Unhandled exception → Kestrel 500 | `synchttp/endpoint.go:64-65` (`hookFailed`) → empty 500 with `Content-Length: 0` | Probably the same. C# side **not measured**. Low. |
| Signed-in principal with an empty, non-null Name | `Identity.Name ?? NameIdentifier`. An empty name gives no principal, so no per-user cap. | `handshake.go:179-191`: an empty name falls back to the ID | Library API shape (`auth.User` cannot hold null). Not reachable in the standalone host. |
| Room seam error on receive | `C/SyncSocketMember.cs`: a non-socket exception escapes and is logged as an unhandled request error | `G/internal/collab/synchttp/member.go:309-311`: ends the loop silently | Wire is the same (leave, then close 1000). Log only. |
| Open-routes warning wording | `BlokServerEndpointRouteBuilderExtensions.cs:25-31` names `IBlokAuthorization` | `G/blokserver/collab.go:226-243` names `Options.Authorization` | Category `Blok.Server.AspNetCore`, which the standalone host never forwards (`Program.cs:73` ClearProviders; `HostCollab.cs:52` adds only the collab-category provider). Embedders only. |
| `IHttpWebSocketFeature` missing → 500 | `C/SyncHandshake.cs` Admit | No counterpart. Go always has WebSockets. | Not reachable. |

## VERIFIED AT PARITY

### (a) Proven by a shared fixture or contract that both targets run
Both targets run all 12 SUITES, including sync-contract, protocol-v2, sync-transport, collab-http and routing (`scripts/test-server-conformance.mjs:44-57`; `ci.yml:394-395,546-547`). The C# suite has no Go-only skips in these files (grep `skip` / `target`). These are cited from source and from earlier ledgers. I did not run them this session.

- **Sync wire.** `F/sync-frames.json` and `F/sync-wire-decode.json` (179 decode cases, incl. non-Unicode strings from `3a081c20`): C# `SyncWireDecodeFixtureTests` and `SyncWireTests`; Go `wire/wire_test.go` and `fuzz_test.go`.
- **Edit parse, refusals, digests, keys, restore digest.** `F/canonical-edit-digest.json`: Go `editops_test.go` reads `parse`, `agent`, `keys` and `restore`, and `dotnet/double_test.go` reads `doubles`. Body-string refusals → 422 with the parser's words: collab-http-contract `:180-187`.
- **Edit op bytes.** `F/collab-edits/cases.json` (213 cases): C# capture test asserts equality (`YDocConverterEditCaptureTests.cs:40-41`); Go `apply_test.go`.
- **Format-1 migration.** `F/collab-migrations/cases.json` (67 cases): Go `migrate_test.go`. All 31 `collab-format1/*` rooms are referenced (checked: 0 missing), including the `rich-*` folders.
- **Converter hardening, structure, export and seed.** `collab-hardening`, `collab-structure`, `collab/manifest.json` (Go `export_test.go:107-121` asserts the manifest equals the folders).
- **Rich text.** `rich-text-canonical` (32 + 6), `rich-text-edits` (25), `rich-text-fields.json`, `converter-keys.json` (GB9c tables).
- **Text diff.** `F/text-diff/cases.json` (555 cases, incl. every JS whitespace unit, `069ffff6`, and conjunct-heavy cases, `46c790c6`) plus `grapheme-break.json`. Go `textdiff_test.go:26,98`. Linear-time conjunct join: C# `TextDiffGraphemeTests.ALongConjunctRunDiffsInLinearTime`, Go twin `textdiff_test.go:141` (16000 pairs, < 1 s), passing this session. Go code `textdiff.go:120-180` keeps `conjunctState` incrementally.
- **Changes cap.** 4 MiB and 200 records: collab-http-contract `:602-648`.
- **Methods.** Every sync route answers HEAD/POST/OPTIONS/PUT with the right `Allow` (`F/routing.json:98-104`, e.g. HEAD `/sync/x/state` → 405 `GET, OPTIONS`). The Go router matches methods exactly with no implicit HEAD (`G/internal/route/route.go:78-108`).
- **Transport.** Handshake order, origin, tickets, close codes and reasons, caps, budgets, RFC 6455 refusals: sync-transport-contract. The previous ledger (`progress-collab-transport.md`) records C# 35/35 and Go 34 + 1 skipped. The skip was the v2 case, which the stand-in room could not serve. The skip helper `itNeedsAStore` and `standInRooms` no longer exist (grep finds no hits), so the v2 case now runs on Go too. Not re-run this session. 4409 reset, 1001 drain, 4503: sync-contract `:692-728`, protocol-v2 `:64-67,1073`.

### (b) Read equal in code only (no dedicated shared oracle beyond the contract cases above)
- **POST `/edit` door order and bodies**: `C/EditEndpoint.cs` vs `G/internal/collab/collabhttp/edit.go` + `collabhttp.go:43-71`. The order is doc → doc claim → read+write hook → key (exactly one line) → If-Match (one strong canonical tag) → body counted in 8 KiB chunks → parse → digest → room. All 9 result statuses map the same, with the same texts.
- **Retry-After.** `ceil(seconds)`, at least 1.
- **Head headers and `Access-Control-Expose-Headers` merge.** Only on a CORS answer.
- **GET `/state` and POST `/reset`.** `C/StateEndpoint.cs` and `C/ResetEndpoint.cs` vs `collabhttp/state.go`: read-only gate on state, ETag only with a head, `no-store`, same refusals.
- **History routes.** `C/HistoryEndpoint.cs` vs `collabhttp/history.go`:
  - `no-store` comes first.
  - `group` must be 1, 15 or 60.
  - `since` must not exceed the sequence.
  - A malformed lineage gives 404 before the store.
  - The sequence parses as `ulong` with `NumberStyles.None`, via `dotnet.ParseUInt64None`.
  - Changes rows are cut newest first within 4 MiB, minus a 32-byte envelope. The newest row is always kept.
  - Refusal texts match, and the corrupt record is logged.
  - The JSON string escaping matches .NET's default encoder (`jsjson.AppendQuoted`, `G/internal/jsjson/node.go:538-568`: `<>&'+"` and non-ASCII → upper-hex `\u`).
- **Preflight.** `HandlePreflight` (`BlokServerEndpointRouteBuilderExtensions.cs:205-238`) vs `G/blokserver/server.go:246-267`: same Allow-Methods `"<method>, OPTIONS"` (so `DELETE, OPTIONS` on `/history/{lineage}`), same Max-Age 600, same Vary and 204.
- **Sync endpoint serve path.** `C/SyncEndpoint.cs` vs `synchttp/endpoint.go`:
  - The service slot is taken first: 503 `too many connections on this server`.
  - Then the per-principal lease: 429 `too many connections`.
  - Join comes before the upgrade. Draining gives 503 `shutting down`; Forbidden or Purged gives 403.
  - SeedFailed or Unavailable gives a 4503 close after the upgrade.
  - Keep-alive timeout is 2x the interval.
  - Rejected sockets get a 250 ms grace.
- **Socket member.** `C/SyncSocketMember.cs` vs `synchttp/member.go`: receive slack, text-frame close, too-big close, backlog `>` cap, and Forbidden suppressing queued frames.
- **Rich text HTML reader batching.** `S/RichTextHtmlReader.cs` vs `convert/htmlreader.go`: a call carries at most 32768 UTF-16 units, and an oversized field goes alone. Go has unit twins of all four C# tests plus two more.
- **Doc converter.** `S/CollabDocConverter.cs` vs `convert/docconverter.go`:
  - Seed and migration reads use a 60 s timeout.
  - Transient means the runtime timeout, the memory budget, or a wait cancelled elsewhere. Too-large is not retried.
  - Each distinct HTML is read once.
  - Go has twins of every `CollabDocConverterTests` fact except `EscapedMarkupCharactersReadAsText`, which tests the shared JS runtime bundle and not converter logic.
- **Route wiring.** `G/blokserver/server.go:141-163` maps every C# collab route under the same conditions (`CollabEnabled`; `s.rooms` is always set then, `server.go:78-81`). The journal/v2 switch is `hasJournal()` (`collab.go:54-57`), the same rule as `C/CollabOperationStoreSource.cs`. The host constants match: shutdown grace 30 s (`main.go:71`) and 1024 connections.
