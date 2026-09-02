# YDotNet packaging spike — Phase 2 opening (multiplayer design §7)

Date: 2026-08-31. Package family: **YDotNet 0.6.0** (latest stable on nuget.org; also audited: YDotNet.Native 0.6.0 + .Linux/.MacOS/.Win32, YDotNet.Server 0.6.0, YDotNet.Server.WebSockets 0.6.0). Upstream repo: y-crdt/ydotnet, natives built from yrs `release-v0.19.1` (yffi crate).

Environment: macOS arm64, .NET SDK 10.0.302, TFM `net10.0` (matches `packages/server/dotnet` — all csprojs are net10.0). Docker available (arm64 native + amd64 via emulation). All artifacts live in `scratchpad/ydotnet-spike/`.

## Verdict up front

**GO, with two musl caveats that are both mitigable.** Core YDotNet works, has zero managed dependencies, ships correct natives for 6 of our 8 RIDs, and the CRDT round-trip (doc → update → state vector → diff → apply → converge) passed on macOS arm64/x64, Debian glibc x64/arm64, and Alpine arm64. The two problems are `linux-musl-x64` (broken as shipped — upstream packaging bug puts an **aarch64** lib in that RID folder) and `linux-musl-arm64` (no asset at all; RID-graph fallback silently deploys the **glibc** arm64 lib, which happens to work on Alpine today). Plus one hard precondition in our own release script (below).

## 1. Native coverage audit

What YDotNet.Native.* 0.6.0 actually ships (`runtimes/<rid>/native/`), with the real ELF/Mach-O/PE architecture we verified via `file`/`readelf`:

| shipped RID folder | file | actual contents | linkage |
|---|---|---|---|
| linux-x64 | libyrs.so | x86-64 glibc | NEEDED: libgcc_s, libc.so.6, **ld-linux-x86-64.so.2** |
| linux-arm64 | libyrs.so | aarch64 glibc | NEEDED: libgcc_s, libpthread, libdl, libc.so.6 (no ld-linux entry) |
| linux-arm | libyrs.so | ARM 32-bit glibc | — |
| linux-musl-arm | libyrs.so | ARM 32-bit musl | NEEDED: libgcc_s, libc.so |
| **linux-musl-x64** | libyrs.so | **aarch64 musl — WRONG ARCH** | NEEDED: libgcc_s, libc.so |
| **linux-x64-musl** (invalid RID, never matched by .NET 8+) | libyrs.so | x86-64, but **glibc-linked** despite the name | NEEDED: libgcc_s, libc.so.6, ld-linux-x86-64.so.2 |
| osx-x64 / osx-arm64 | libyrs.dylib | correct x86_64 / arm64 Mach-O | ok |
| win-x64 / win-arm64 | yrs.dll | correct x86-64 / Aarch64 PE | ok |

**Root cause found in upstream source** (`native/YDotNet.Native.Linux/YDotNet.Native.Linux.csproj`, still on main): the packaging map packs `output/linux-arm64-musl/libyrs.so → runtimes/linux-musl-x64/native/` (a typo — should be `linux-musl-arm64`), and the x64-musl build goes to `runtimes/linux-x64-musl/` — an invalid RID that .NET 8+ ignores (emits NETSDK1206). Upstream's CI matrix DOES build all four musl targets correctly (x86_64/aarch64/armv7 musl via cargo/cross); only the folder mapping is wrong. Bonus bug: their "x64-musl" artifact is glibc-linked anyway (NEEDs ld-linux-x86-64.so.2), so even a correct mapping wouldn't run on stock Alpine x64.

Our 8 release RIDs (from `scripts/publish-server.mjs` TARGETS) vs what `dotnet publish` actually deploys (sha256-matched against the shipped assets — presence alone would have lied):

| our RID | native deployed | which asset was selected | runs? |
|---|---|---|---|
| osx-x64 | yes | correct osx-x64 dylib | **PASS** (run under Rosetta on this machine) |
| osx-arm64 | yes | correct osx-arm64 dylib | **PASS** (run natively) |
| linux-x64 | yes | correct linux-x64 glibc .so | **PASS** (runtime-deps:10.0, amd64 emulation) |
| linux-arm64 | yes | correct linux-arm64 glibc .so | **PASS** (runtime-deps:10.0, native arm64) |
| linux-musl-x64 | yes — **wrong arch** | aarch64 lib from the swapped folder | **FAIL** on Alpine amd64: exit 139, "Error loading shared library libyrs" |
| linux-musl-arm64 | yes — **wrong libc** | glibc linux-arm64 .so via RID-graph fallback (`linux-musl-arm64 → linux-arm64`, verified in SDK RuntimeIdentifierGraph.json) | **PASS** on runtime-deps:10.0-alpine arm64 — works by luck, see below |
| win-x64 | yes | correct win-x64 yrs.dll | not run (no Windows here); arch verified |
| win-arm64 | yes | correct win-arm64 yrs.dll | not run; arch verified |

Why musl-arm64 "works by luck": musl's dynamic loader aliases the glibc sonames (libc.so.6, libpthread.so.0, libdl.so.2) to itself, and the aarch64 glibc build carries no NEEDED entry for the glibc loader (the x64 builds DO carry `ld-linux-x86-64.so.2`, which musl does not alias — that's exactly why x64-on-Alpine fails while arm64-on-Alpine passes). All symbols yrs uses resolved against musl and the full round-trip passed. Requirements: `libgcc` must be present — it is in `runtime-deps:10.0-alpine` (verified: image ships libgcc + libstdc++), and any Alpine box running self-contained .NET needs those apk packages anyway. This is fragile (a future yrs build could pull a glibc-versioned symbol musl lacks) but empirically green today.

## 2. Local proof (macOS)

Project: `ydotnet-spike/proof/` (net10.0, YDotNet 0.6.0 + YDotNet.Native 0.6.0). The program: creates Doc A, opens a **origin-tagged** WriteTransaction (`"blok-spike"` bytes), inserts into a Text root and a Map root, captures the update via `ObserveUpdatesV1` (fired, 55 bytes); encodes `StateVectorV1` (3 bytes) and `StateDiffV1` against an empty doc's vector (55 bytes); applies into Doc B via `ApplyV1` (result `Ok`); asserts text == "Hello from Blok" and map["kind"] == "paragraph"; re-encodes full state from the hydrated doc against a zero state vector (the mergeUpdates workaround). **`dotnet run`: PASS.**

API gotcha found: on the receiving doc, `tx.GetText("content")` returned **null** for a root created remotely — use the doc-level accessors `doc.Text(name)` / `doc.Map(name)` (get-or-create) instead of the transaction-level Get*.

### Single-file publish — production flag trap (action required in our script)

`publish-server.mjs` does NOT pass `-p:IncludeNativeLibrariesForSelfExtract=true`, and its archiver packs ONLY `<publishDir>/<binary>`. Verified with the script's exact flags for osx-arm64: the publish output is **two files** — the 80.2 MB binary plus `libyrs.dylib` (1.6 MB) sitting beside it. The archive as built today would ship without the native lib; running the binary alone dies at first use: `System.DllNotFoundException: Unable to load shared library 'yrs'` (at `Doc.CreateDoc`). With `-p:IncludeNativeLibrariesForSelfExtract=true` added, the output is a single 81.8 MB file that **passes standalone**. → **Hard precondition: add `IncludeNativeLibrariesForSelfExtract=true` to `publishCommand` in `scripts/publish-server.mjs` (and keep the Dockerfile in sync) when YDotNet lands.**

Size delta (both with the fixed flags, osx-arm64 self-contained single-file):

| binary | size |
|---|---|
| hello-world | 80,010,230 B |
| YDotNet proof | 81,781,126 B |
| **delta (YDotNet managed + native dylib)** | **1,770,896 B (~1.7 MB)** |

Published single-file sizes for the Linux RIDs: linux-x64 75.6 MB, linux-musl-x64 75.6 MB, linux-arm64 83.0 MB, linux-musl-arm64 83.0 MB.

## 3. Linux proofs (Docker, all self-contained single-file with the fixed flags)

| run | image | result |
|---|---|---|
| linux-arm64 | mcr.microsoft.com/dotnet/runtime-deps:10.0 (native arm64) | **PASS** |
| linux-x64 | runtime-deps:10.0 (amd64 emulation) | **PASS** |
| linux-musl-arm64 | runtime-deps:10.0-alpine (native arm64) | **PASS** (glibc-fallback lib, see §1) |
| linux-musl-x64 | runtime-deps:10.0-alpine (amd64 emulation) | **FAIL: exit 139, cannot load libyrs (aarch64 lib on x64)** |
| linux-musl-x64 + correct-arch lib swapped in, no gcompat | alpine 10.0-alpine | FAIL — that lib is glibc-linked, NEEDs ld-linux-x86-64.so.2 |
| linux-musl-x64 + glibc x64 lib + **gcompat** | alpine:3.20 + `apk add gcompat libgcc` | **PASS** |
| linux-musl-arm64 + **our own yrs build** (yffi from y-crdt `release-v0.19.1`, compiled in a rust:alpine arm64 container, ~7 min, genuinely musl-linked: NEEDED `libc.musl-aarch64.so.1`) | runtime-deps:10.0-alpine (native arm64) | **PASS** — proves the build-our-own-native mitigation end-to-end |

linux-arm64 was tested natively (no emulation caveat). The x64 runs used Docker's amd64 emulation on this arm64 Mac — same binaries, slower execution only.

## 4. API surface (verified by reflection over the shipped YDotNet.dll)

All present, exact names:
- **Apply update**: `Transaction.ApplyV1(byte[] stateDiff)` / `ApplyV2(byte[])` → `TransactionUpdateResult` enum (`Ok` on success).
- **Encode state vector**: `Transaction.StateVectorV1()` → `byte[]`. (No V2 state-vector method — v1 only, which is what y-protocol uses.)
- **Encode diff / state-as-update**: `Transaction.StateDiffV1(byte[] stateVector)` / `StateDiffV2(byte[])`. Empty-doc vector or `new byte[]{0}` gives full state.
- **Transaction origins**: `Doc.WriteTransaction(byte[] origin = null)` — origins can be TAGGED. But `UpdateEvent` (from ObserveUpdatesV1/V2) carries ONLY `Update` bytes and `AfterTransactionEvent` only Before/AfterState + DeleteSet — **origin is NOT observable on update events** (only `UndoEvent.Origin` exists, for UndoManager). Echo suppression in room code must use an "applying remote" flag around `ApplyV1` (observe callbacks fire synchronously inside commit, so this is reliable) rather than origin filtering.
- **Observe/subscribe**: `Doc.ObserveUpdatesV1/V2`, `Doc.ObserveAfterTransaction`, `Doc.ObserveClear`, `Doc.ObserveSubDocs`; `Text/Map/Array/Xml*.Observe`, `Branch.ObserveDeep`. All return `IDisposable`.
- **mergeUpdates**: **ABSENT**, as expected — no merge API anywhere in the assembly. Workaround proven in the spike: apply updates into a scratch Doc and re-encode via `StateDiffV1` (works; this is also what compaction will look like).
- Bonus: a `YDotNet.Protocol` namespace ships IN CORE YDotNet — `SyncStep1Message`/`SyncStep2Message`/`SyncUpdateMessage`/`AwarenessMessage` + Encoder/Decoder (y-protocol framing). Usable by our own room code without Server.*.

### Server.* separability
- **Core `YDotNet` 0.6.0 has ZERO managed dependencies** (nuspec group is empty). Cleanly usable alone with our own room code. `YDotNet.Native*` are content-only runtime packages.
- `YDotNet.Server` drags: protobuf-net 3.2.26, System.Reactive 6.0.0, Microsoft.Extensions.{Caching.Abstractions, Caching.Memory, Hosting.Abstractions, Options} pinned at 7.0.x (EOL-era but abstraction-only). `YDotNet.Server.WebSockets` adds nothing further. `dotnet list package --vulnerable --include-transitive`: **no vulnerable packages flagged** today, so the repo's NuGetAudit gate would not trip — but we don't need any of it. **Recommendation: reference core YDotNet + YDotNet.Native only; skip Server.*.**
- Repo-hygiene note: referencing YDotNet.Native.Linux emits SDK warning **NETSDK1206** (because of the bogus `linux-x64-musl` folder). Verified it stays a warning under `TreatWarningsAsErrors=true` (compiler property doesn't cover SDK warnings); only `-warnaserror`/MSBuildTreatWarningsAsErrors would trip on it. Silence with `<NoWarn>NETSDK1206</NoWarn>` if it bothers CI logs.

## 5. Gaps and mitigations

**Gap A — linux-musl-x64 is broken as shipped** (aarch64 lib deployed; DllNotFound/exit 139 on Alpine x64).
1. **Build yrs natives ourselves in CI and override** (recommended): cargo build of the `yffi` crate from y-crdt `release-v0.19.1` for `x86_64-unknown-linux-musl` + `aarch64-unknown-linux-musl`, ship via `runtimes/<rid>/native/` Content items in Blok.Server.Host so they win over the package's assets (embedded by single-file publish). Cost: ~1 CI job (rust toolchain, ~5-10 min, cacheable by yrs version) + a pinned-yrs-version drift risk vs YDotNet's binding (must match the yrs branch YDotNet builds against). **Proven in this spike**: we compiled yffi for aarch64-musl in a rust:alpine container (~7 min, one `cargo build -p yffi` with `RUSTFLAGS="-C target-feature=-crt-static"`), swapped it in, and the full proof PASSED on Alpine arm64. The yrs pin must track upstream's (`release-v0.19.1` for YDotNet 0.6.0 — read their build-binaries.yml per release).
2. **Upstream PR** fixing the two csproj mapping lines (arm64-musl → linux-musl-arm64; x64-musl → linux-musl-x64, plus making that build genuinely musl-linked). Cost: tiny diff, unknown maintainer latency (repo active); we'd still need mitigation 1 or 3 until a release ships.
3. **Document gcompat**: `apk add gcompat libgcc` makes the glibc x64 lib load on Alpine — proven PASS in this spike. Cost: one docs line + ugly runtime requirement on users' boxes; fine as a stopgap, wrong as the story.
4. **Startup refusal**: detect musl-x64 + missing/unloadable libyrs at boot, refuse collab endpoints with a clear error, everything else works. Cost: ~30 lines + a doc note; product cost is no collab on Alpine x64.
5. Static linking into the .NET binary is NOT realistic (P/Invoke expects a shared lib; would need a custom import resolver + custom yrs build) — don't pursue.

**Gap B — linux-musl-arm64 has no dedicated asset** (glibc lib silently substituted via RID graph).
- Works today (full PASS on Alpine arm64), so strictly a robustness gap: one glibc-versioned symbol in a future yrs build breaks it silently. Same mitigations as Gap A — our CI-built `aarch64-unknown-linux-musl` lib closes it for good; until then, add an Alpine-arm64 smoke test to CI so "luck" is at least continuously verified.

**Gap C — our own publish script** (not a YDotNet gap): must add `-p:IncludeNativeLibrariesForSelfExtract=true` or every tarball/zip target ships a binary that crashes at first collab call. One-line change in `scripts/publish-server.mjs` + Dockerfile parity. Non-negotiable precondition.

**Untested**: win-x64 / win-arm64 execution (assets present, correct PE arch verified; risk low), linux-arm 32-bit (not a release target).
