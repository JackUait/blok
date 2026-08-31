# Phase 2 Implementation Plan — Server-Side Sync Rooms

Planning pass 2026-08-31 against main 013a9740 (Phases 0-1 closed). All research
file:lines re-verified; client schema v2 is the landed form the C# side mirrors.
Docker needs NO musl swap (runtime-deps is Debian; only linux-x64/arm64 published).

## Risk register (start order)
R1 lockstep serializers: C# YDocConverter mirrors BOTH serializer.ts (value rules:
convertible-array predicate, keyed grids __rows/__rowKeys + first-wins key
normalization, eager contentIds, empty-array-atomic, paragraph {}→{text:''},
tunes-only-when-nonempty) AND DocumentStore.toJSON/fromJSON (hierarchy view,
parentId as membership arbiter, cycle-break smallest-id-keeps-parent +
self-parent always broken, DFS parent-agreement gating, dup-id first-agreeing-
occurrence, two-pass sorted orphan tail, dangling tolerance). Fixtures are the
contract (like tickets.json); JS generates from REAL client code, both CIs red
on drift; reverse direction closed by E2.
R2a YDotNet.Protocol byte-compat unproven → B2 fixture spike gates use-vs-
hand-roll (~100-line codec fallback) BEFORE room code shapes around either.
R2b echo suppression = applying-remote flag around ApplyV1 (origins taggable,
NOT observable on UpdateEvent); Doc is not thread-safe → room = single-lane
actor; ALL doc access through the lane.
R3 musl: own yffi build from yrs release-v0.19.1, RUSTFLAGS -crt-static off,
swap via runtimes/<rid>/native items; fixes OUR archives only — NuGet-on-
Alpine-x64 stays broken upstream (docs note + startup probe refusal + upstream PR).
R4 single-file: -p:IncludeNativeLibrariesForSelfExtract=true in publish-server
AND Dockerfile; verify extraction under USER 65532/no-home
(DOTNET_BUNDLE_EXTRACT_BASE_DIR if needed); add native-load smokes.
R5 80/80 whole-solution coverage: converter/store fixture-saturated; endpoint
driven via TestServer.CreateWebSocketClient.

## Standing decisions
1. Doc-endpoint outbound = NEW third documented owner
   Blok.Server/Collab/DocEndpointClient.cs (guarded fetcher forbids loopback +
   has no PUT); S3-style structural pin in OutboundClientArchitectureTests;
   URL battery like S3; auth via BLOK_DOC_ENDPOINT_AUTH env verbatim.
2. Working-set S3 driver adds internal key-addressed Get/Put/Delete INSIDE
   S3BlobStore.cs (keeps the one-client pin).
3. Working-set placement is a SECURITY decision: --collab-dir (default
   ./blok-collab; refuse if inside StorageDirectory — LocalFileEndpoint serves
   that publicly); S3 opt-in --collab-s3-prefix with documented not-public req.
4. Blob = magic + {format,epoch} header + length-prefixed update frames;
   compaction = load into fresh Doc via ApplyV1 + StateDiffV1(zero) (GC route);
   triggers: on-load threshold + always flush-before-evict. format 1 = schema v2.
5. Epoch NEVER regresses: reset = atomic rewrite to empty log with epoch+1,
   close doc's connections 4409, evict; next open lazily re-seeds.
6. Epoch wire = first in-band control frame, message-type varint 100, {epoch,
   format}, ONLY on connections that negotiated blok-sync.v1 (stock clients in
   loopback mode never see it).
7. Handshake: Sec-WebSocket-Protocol offer [blok-sync.v1, <ticket>] (handle
   comma-joined AND repeated headers); verify TicketVerifier + claims.Document
   == {doc} (absent doc claim → reject at sync door); accept echoing
   blok-sync.v1; auth-fail = accept-then-close-4401 (refusing subprotocol
   gives no readable code); Origin allow-list applies to upgrades in ticket
   mode; verify-at-connect only; TTL guidance ~30min.
8. doc claim returns to blokTicket() additive; HTTP routes keep ignoring it.
9. IBlokAuthorization consumed via nullable GetService at handshake + reset;
   AND-semantics with ticket; stays unregistered by default.
10. Read-only: drop SyncStep2 AND Update (SyncStep2 carries initial state!);
    answer their SyncStep1; relay their awareness.
11. Awareness verbatim; on join broadcast constant queryAwareness(3) frame to
    others (verify stock-client reply at implementation).
12. Seed fails CLOSED: unreachable doc-endpoint on first open → close 4503,
    never seed empty. Export failure: log + retry next tick; blob stays
    authoritative; eviction still flushes blob.
13. Record wire: GET {doc-endpoint}/{docId} (bare OutputData or
    PersistedDocument envelope; data:null = legit empty seed); PUT bare
    OutputData + last-seen version in a header, UNCONDITIONAL overwrite (blob
    authoritative while it exists; version is pass-through).
14. Flags: --collab, --doc-endpoint (+BLOK_DOC_ENDPOINT_AUTH), --collab-dir,
    --collab-s3-prefix. Refusal matrix incl. doc-endpoint-without-collab.
    HasCollab gates route mapping like HasStorage.
15. DI: lazy TryAddSingleton factories (throw when !HasCollab); idempotent.
16. Code layout: pure logic Blok.Server/Collab/ (YDotNet+Native refs on
    Blok.Server.csproj — core only, zero managed deps, skip Server.*); wire in
    Blok.Server.AspNetCore/Collab/; Host flags/UseWebSockets/drain. NoWarn
    NETSDK1206 in Directory.Build.props.
17. Sync endpoint carries .DisableRequestTimeout() explicitly; keep-alive via
    accept KeepAliveInterval ~15s (KeepAliveTimeout on net10 =
    verify-at-implementation; fallback idle-receive deadline). In-process
    consumers must UseWebSockets themselves — clear refusal + docs.
18. Limits: existing limiter counts handshake; per-user-per-doc cap (8),
    max message 1 MiB (close 1009); options not flags.
19. Shutdown: HostOptions.ShutdownTimeout ~30s; ApplicationStopping →
    DrainAsync (503 new upgrades → flush all rooms blob+export → close 1001);
    REAL SIGTERM host test (today: zero — 6 Kill sites only).

## Tasks (TDD; .NET timing law: explicit deadlines, never sub-second absence;
unique per-test dirs)

Wave A (parallel): A1 package refs + NoWarn + publish/Dockerfile flag +
YDotNetRuntimeProbeTests + consumer-fixture native restore. A2 musl yffi CI
job (rust:alpine, yrs pin, QEMU arm64, cache; fail-if-absent guard; Alpine +
Docker + 65532 smokes; release-wiring pins). A3 JS ticket doc claim +
additive fixtures docMismatch/readOnly + conformance updates. A4 options/
flags/refusal matrix + registration & host tests. A5 store contract
(Read/Write/ResetAsync) + codec + local/S3 drivers + epoch-monotonic law.
B1 lockstep fixtures (scripts/generate-collab-fixtures.mjs → fixtures/collab/
{input.json,canonical.json,update.bin}; JS freshness test; C# YDocConverter +
3-direction conformance tests + per-law unit tests). B2 framing spike
(sync-frames.json fixtures; YDotNet.Protocol decode/re-encode byte-identical
→ adopt, else hand-roll SyncWire.cs pinned by same fixtures).
F1 docs server-data.ts per-path collab story + limits rewrite (ticket-not-
scoped, no-documents renegotiated honestly, working-set privacy, TTL, reset,
Alpine caveat).

Wave C (sequential): C1 CollabRoom/Manager single-lane actor (load-or-seed
exactly-once serialized, echo flag, append-on-observe, debounced export via
TimeProvider, eviction linger ~30s → compact+export+drop; DocEndpointClient +
third-owner pin + add ClientWebSocket to RestrictedTypes). C2 SyncEndpoint +
handshake guard + reset route (auth matrix off fixtures, both header forms,
two-client convergence, late joiner, read-only drops, awareness, caps, epoch
frame, 4409, RequireAuthorization parity). C3 Host wiring (UseWebSockets,
ShutdownTimeout, drain; REAL SIGTERM test with fixture doc-endpoint asserting
1001 + flushed blob + export PUT + exit 0, deadline-driven, skip-on-Windows;
10-min-policy + keep-alive proofs via shortened windows).

Wave D: D1 release wiring (sync conformance in release test step; pins).
Wave E: E1 pinned devDeps y-websocket/y-protocols (+ws only if needed).
E2 sync-contract.test.ts (BLOK_CONFORMANCE-gated; script extended, CI string
unchanged): STOCK client no-auth AND ticket-via-protocols; convergence, late
join, read-only drop (positive-event assert), reconnect diff, awareness,
seed-from-fixture-endpoint equals canonical via REAL JS serializer (closes R1
reverse), export lands, reset → 4409 → resync.

## Architecture tests to change
OutboundClientArchitectureTests (third owner + ClientWebSocket restricted);
BlokServerRegistrationTests (lazy-throw, idempotent, /sync absent w/o flag,
matrix; DoesNotRegisterUnusedFutureServices stays green);
server-release-wiring (flags, musl job, yrs pin string, smokes, conformance);
server-quality-gates (NoWarn exactly NETSDK1206; gitleaks entries if needed);
ci-critical-path (unchanged if conformance-script-only);
publish-server.test.ts; dependency/phantom laws for new devDeps;
server-contract.test.ts isTicketFixture keys.

## Parallelization
Independent: A1∥A2∥A3∥A5∥F1; then B1∥B2 (need A1's refs). Shared-file owners:
Options/HostArguments/Program (A4→C3); route-builder/DI extensions (A4→C2);
csproj/props (A1); S3BlobStore (A5); OutboundClientArchitectureTests (C1);
tickets.json (A3); release-server.yml (A2→D1); test-server-conformance.mjs (E2).
Spine: A1 → {A5,B1,B2} → C1 → C2 → C3 → E2; A4 → C2; A3 → C2 tests.

## Ships behind --collab default-off
Fully gated: routes, rooms, store writes, doc-endpoint traffic, drain deltas.
Global but inert (release notes): YDotNet deps on the NuGet (~1.7MB), single-
file layout change, musl swap, NoWarn, additive doc claim, drain hook.
Nothing default-path constructs a Doc — emergency lever = don't pass --collab.

## Amendments from execution (2026-08-31)

- **B2 DECIDED: SyncWire is hand-rolled** (`Blok.Server/Collab/SyncWire.cs`), NOT
  YDotNet.Protocol. Evidence against the real y-protocols 1.0.7 + lib0 0.2.117
  encoders: YDotNet.Protocol round-trips sync 0/0/1/2 and awareness byte-
  identically, but ENCODES queryAwareness (type 3) as `[0x01]` — a stock client
  reads that as an empty awareness update and never re-announces, defeating
  decision 11 — and cannot DECODE auth (2), queryAwareness (3) or the Blok
  control frame (100). Canary tests pin the mismatches so a YDotNet upgrade
  that fixes them forces a revisit. Use SyncWire for ALL frame types — never
  split codecs by type. SyncWire also pins: one message per WebSocket frame
  (trailing bytes rejected; the handshake reply is TWO frames), varuint ≤ 10
  bytes, unknown OUTER type → ignorable UnknownFrame, unknown sub-type →
  malformed. Control frame = `[100][varuint len][UTF-8 {"epoch":N,"format":N}]`,
  strict decode.
- **Fixture layout**: `fixtures/sync-frames.json` lives BESIDE `tickets.json`
  (the collab generator owns `fixtures/collab/` and must remove only its own
  case dirs — a shared folder is not safe to `rmSync`). C# loaders find
  fixtures via the `Blok.Server.slnx` walk-up, not csproj items.
- **devDependencies added (plan E1 pulled forward)**: `y-protocols 1.0.7` and
  `lib0 0.2.117`, both exact — the fixture generator must import lib0 directly
  (y-protocols writers take a lib0 encoder) and `no-phantom-dependencies-law`
  forbids transitive imports. `y-websocket` still lands with E2.
- **C1 decoupling**: the room depends on a small `ICollabDocConverter`
  abstraction (Seed(Doc, json) / Export(Doc)); B1's `YDocConverter` binds
  through a one-line adapter after both land. The room never references the
  concrete converter.
- **B1 LANDED** — `YDocConverter.Seed(Doc, JsonArray blocks)` / `Export(Doc) → JsonArray`
  operate on the BLOCKS ARRAY, not the OutputData envelope (envelope, `data:null`,
  version are the room's job). Numbers: always `Input.Double` (yrs `Long` → JS
  BigInt breaks JSON.stringify). Ordinal (UTF-16) comparison for sorts and the
  cycle keeper. 18 fixtures under `fixtures/collab/<case>/` + manifest; the JS
  freshness test is always-on. Reverse direction (C#-seeded → JS) probed 18/18.
- **Client behaviors pinned as-is by the fixtures (candidates for a later
  tightening pass, NOT changed):** `parent: null` (or non-string) is written as
  doc Null, excluded from root order → orphan tail, reads back parentless;
  `lastEditedBy: null` / non-number `lastEditedAt` written then dropped on read;
  `content` is never deduped in projection (`[x,x]` emitted verbatim) and
  non-string entries pass through; orphan pass 2 can emit a child before its
  own parent; a `null` block entry throws in fromJSON while a primitive entry
  is skipped; a data value shaped `{__rows, __rowKeys:[objects]}` would be
  misread as a grid; the escaped NUL (backslash-u0000) inside strings is
  SUSPECTED to truncate through yffi's C strings — excluded from fixtures,
  verify before relying on it.
- **C1 LANDED (`3137ba08`)** — room API: `CollabRoomManager.JoinAsync(docId,
  ICollabMember, ct) → CollabJoinResult{Joined|SeedFailed|Draining}`,
  `ResetAsync(docId)`, `DrainAsync`; `CollabMembership.ReceiveAsync(frame)` /
  `LeaveAsync`; `ICollabMember {CanWrite, AcceptsControlFrames, Send, Close}` —
  Send/Close run INSIDE the lane: enqueue and return, never block, never throw.
  The ROOM sends the epoch control frame first; the endpoint must not. Zero
  stored frames = unseeded (a reset's empty log re-seeds under the stored
  epoch); an unapplicable stored frame fails the join closed — operator reset
  recovers; compaction on load at 64 frames OR 1 MiB, always before evict when
  >1 frame. DocEndpointClient PUT header: `Blok-Doc-Version`.
- **YDOTNET LAW (found by C1):** `new Doc()` in YDotNet 0.6.0 does NOT get a
  unique client id (15 distinct in a 50-doc probe), and yrs DROPS updates that
  repeat a (client, clock) pair — "unrecoverable state corruption" if both
  write. Every Doc that may produce updates MUST be created with
  `DocOptions { Id = random uint32 }` (the browsers' id space). Rooms do; test
  helpers use `YDocs.NewClient()`. Audit any future `new Doc()`.
- **C3 LANDED (`254b8ee1`)** — drain via `IHostedLifecycleService.StoppingAsync`
  (ApplicationStopping is a synchronous Action; StoppingAsync runs after it and
  BEFORE Kestrel stops listening, under the 30s shutdown timeout);
  `MaxConcurrentUpgradedConnections = 1024` when collab is on; real SIGTERM test.
  FOLLOW-UP: at the upgrade limit Kestrel throws inside AcceptWebSocketAsync →
  HTTP 500 after JoinAsync already ran; the endpoint should pre-check the limit
  and answer 503 before joining.
- **Review facts (Phase 2 review round):** lone surrogates in strings become
  U+FFFD on the wire (lib0 UTF-8) — the originating client's own toJSON keeps
  them while every replica, including its own replay, reads U+FFFD; DOM text is
  well-formed UTF-16 so this is a note, not a fix. U+0000 in any map KEY makes
  yffi PANIC and abort the .NET process on read (uncatchable); NUL in string
  VALUES truncates on write — Seed rejects NUL; a hostile UPDATE carrying a NUL
  key cannot be guarded in-process without decoding the update (writers hold
  consumer-minted write passes; the client strips NUL in Phase 3; upstream fix =
  yrs returning an error instead of unwrap). The release workflow's bare
  `yarn test <conformance files>` step was vacuous (no BLOK_CONFORMANCE_SERVER);
  CI's `test-server-conformance.mjs` runner is the real gate release waits for.
