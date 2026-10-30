# Go server parity — delivery and CI ledger

Area: how the server ships and how CI gates it. Research only. Written 2026-10-31.

Conventions:
- Every row cites `file:line` read in this session, or a command run in this session.
- **UNVERIFIED** marks a claim not proven by a read or a run.
- Proposed Go module: `packages/server/go`, module path `github.com/JackUait/blok/packages/server/go`.
- Probe code: `/private/tmp/claude-501/-Users-jackuait-Packages-blok/1972ea3d-88af-4e14-951b-0edd9367e8e3/scratchpad/delivery-ci/` (`modprobe/`, `flagprobe/`, `runtime/`).

## 0. Facts measured in this session

| # | Fact | Evidence |
|---|------|----------|
| F1 | ci.yml has **35 jobs** after the matrices expand. | `gh run view 41116754755 --json jobs --jq '.jobs\|length'` printed `35`. By hand: i18n, lint, workflow-lint, frontend-coverage, docs-quality, codeql×2, server-security, server, server-delivery, unit-tests×5, workspace-unit-tests, validate-spec-coverage, build, install-browsers, e2e×12, merge-reports, storybook, visual-regression, production-readiness (ci.yml:20-720). |
| F2 | **17 ci.yml jobs start at t=0** (no `needs`): i18n, lint, workflow-lint, codeql×2, server-security, server, server-delivery, unit×5, validate-spec-coverage, build, install-browsers, storybook. | ci.yml:20,37,95,183,240,293,335,375,462,481,521,627 (no `needs:`). |
| F3 | Other workflows also take slots at t=0: `link-check.yml` on push and PR (1 job), `mutation.yml` on push to main (1 job). So t=0 is **19 slots on a main push, 18 on a PR**. The cap is 20. | link-check.yml:4-17, mutation.yml:4,29; memory `ci-20-job-cap-wall-clock.md` (Free = 20). |
| F4 | Server job durations, run 41116754755 (main, d559d40e): Server **5m34s**, Server Delivery **3m49s**, Server Security **2m38s**, CodeQL (csharp) **3m33s**, Workflow Lint **21s**. | `gh run view 41116754755 --json jobs`. |
| F5 | Step times in that run: `dotnet test` + coverage 4m22s, `dotnet format` 48s, packed packages 64s, **C# conformance 2m15s**, publish dry-run 0s, wiring vitest 6s, Docker build 1m36s, image Trivy 15s. | `gh api repos/{owner}/{repo}/actions/runs/41116754755/jobs`. |
| F6 | A subdirectory module is versioned ONLY by tags prefixed with its directory. With root tags `v1.16.1` and `v1.17.0` only, `go list -m …/packages/server/go@v1.17.0` failed: `invalid version: unknown revision packages/server/go/v1.17.0`. With tag `packages/server/go/v1.16.1` it resolved to `v1.16.1`. | `modprobe/` probe (local git repo, `GOPROXY=direct`, git `insteadOf`). Primary doc: go.dev/ref/mod — "the module subdirectory … also serves as a prefix for semantic version tags", example `gopls/v0.1.0`. |
| F7 | A gitignored file used by `//go:embed` builds locally, but a consumer fetching the tagged module gets `pattern blok-server-runtime.js: no matching files found`. | `modprobe/` probe: local build printed `LOCAL BUILD OK`; consumer `go build` failed with that error. `git ls-tree -r packages/server/go/v1.16.1` listed no `.js` file. |
| F8 | v2+ needs a `/v2` module path suffix. | go.dev/ref/mod: "Starting with major version 2, module paths must have a major version suffix like `/v2`". |
| F9 | Go's own texts equal what the C# host and conformance freeze: `flag provided but not defined: -not-a-real-flag`, `flag needs an argument: -conformance-origin`, `Usage of blok-server:` (only with `flag.NewFlagSet("blok-server", …)`), ServeMux 404 `404 page not found\n` `text/plain; charset=utf-8`, 405 `Method Not Allowed\n` with `Allow: GET, HEAD` for a `GET /health` pattern. | `flagprobe/` `go run .` output. |
| F10 | A Go 1.27.1 build of a clean commit tagged `packages/server/go/v1.16.2` reported `debug.ReadBuildInfo().Main.Version` = `(devel)`. `-ldflags -X main.version=…` worked. | `modprobe/repo` probe output `ldflag=1.16.2 buildinfo=(devel)`. |
| F11 | Go 1.27.1 ships Unicode **17.0.0**. Local Node is 24 with Unicode 16.0. | probe `unicode.Version` → `17.0.0`; `node -p process.versions.unicode` → `16.0`. |
| F12 | Go coverage is statement-only: `-covermode set,count,atomic`, "does this statement run?". There is no branch coverage. | `go help testflag`. |
| F13 | The runtime bundle build takes under 1s locally (887,159 bytes). | `time node -e "…buildServerRuntime(…)"` → `real 0.63`. |

## 1. Parity ledger

Oracle column: a conformance test name, a shared fixture, or **NONE**. Go column: the proposed package or file.

### 1a. Conformance runner and harness

| # | Feature | C# location | What it does | Oracle | Go home |
|---|---------|-------------|--------------|--------|---------|
| R1 | `--target` flag | scripts/test-server-conformance.mjs:38-58 | Accepts only `csharp`; anything else prints usage and exits 1 before any build. | server-go-removal-law.test.ts "rejects the retired target before build or temporary work" (must be rewritten) | Add `go` branch in the same script |
| R2 | Ordinary host build | test-server-conformance.mjs:118-127 | Builds `Blok.Server.Host` in Release, the binary without test seams. | server-contract.test.ts `ordinaryIt` cases :1369,:1390,:1407 | `go build -o <tmp>/blok-server-ordinary ./cmd/blok-server` |
| R3 | Conformance host build | test-server-conformance.mjs:128-138; Directory.Build.props:20-22 | Builds with `BLOK_SERVER_CONFORMANCE` so test-only seams exist. | same ordinaryIt cases | `go build -tags conformance` (the old code did this: `git show ad5782d7 -- scripts/test-server-conformance.mjs`) |
| R4 | `--configuration Debug\|Release` | test-server-conformance.mjs:36,43,49 | Picks the journal host's build config; Debug keeps `Debug.Assert`. | NONE (wiring only) | Go has no Debug/Release. Accept the flag and ignore it, or reject it for go. Proposal: for `--target go` map Debug → `-race`? **UNVERIFIED** cost; simplest is "ignored, printed in the banner". |
| R5 | Suite list | test-server-conformance.mjs:140-150 | Runs 6 files: harness, server, sync, blok-client, protocol-v2, mcp-agent-participant. | server-release-wiring.test.ts "runs every conformance suite through the runner CI invokes" (checks only 4 of the 6) | same list for both targets |
| R6 | Empty-pattern guard | test-server-conformance.mjs:78-102 | Fails if `--test-name-pattern` ran zero tests. | NONE | shared; target-independent |
| R7 | Env handoff | test-server-conformance.mjs:165-175; run-against.ts:42-50; server-contract.test.ts:29-34,90-93 | Sets `BLOK_CONFORMANCE_SERVER` and `BLOK_CONFORMANCE_ORDINARY_SERVER` to executables. | harness-contract.test.ts both cases | Go binaries at `<tmp>/blok-server-{ordinary,conformance}` |
| R8 | Listening marker | server-process.ts:14,133; Program.cs:106-107 | Harness waits for `" listening on "` on stderr AND 200 from `/health`; C# prints `blok-server <ver> listening on <addr> (--auth <mode>)`. | harness-contract.test.ts "refuses a health answer that came from a server it did not start" | `cmd/blok-server/main.go`: write the same line to stderr only after `net.Listen` succeeds |
| R9 | Bind-loss text | run-against.ts:130-132 | Retries only if the error contains `address already in use`. | harness-contract.test.ts "takes another port when the one it allocated is already taken" | Go `net.Listen` error text. darwin probe: `listen tcp 127.0.0.1:60983: bind: address already in use` (flagprobe/l). Linux text **UNVERIFIED**. |
| R10 | Startup timeout 20s, SIGTERM drain 2s then SIGKILL | server-process.ts:9,15,58-74 | Bounds start and stop. | crash-recovery cases in sync/protocol-v2 suites | Go must exit within 2s of SIGTERM (`signal.NotifyContext` + `Server.Shutdown`) |
| R11 | `--conformance-origin` | ConformanceArguments.cs:40-107; BlokServerConformanceExtensions.cs:56-121 | Test-only: allows exactly `http://127.0.0.1:PORT` as outbound target. | server-contract.test.ts:1369 "accepts only an exact HTTP 127.0.0.1 origin in the tagged binary", :1390 "keeps the conformance-only origin flag out of an ordinary binary" | `cmd/blok-server/conformance.go` (`//go:build conformance`) + `conformance_disabled.go` (old files at `ad5782d7^:packages/server/cmd/blok-server/`) |
| R12 | `--conformance-journal` | ConformanceArguments.cs:40-44; BlokServerConformanceExtensions.cs:29-41 | Test-only: puts the local journal store under `--collab-dir`. | server-contract.test.ts:1407 "keeps the conformance-only journal flag out of an ordinary binary" + durability cases in sync/protocol-v2 | same `conformance.go` |
| R13 | Conformance arg error | ConformanceArguments.cs:51-52,93-94; Program.cs:15-20 | Bad seam flag → message, usage, exit 2. | server-contract.test.ts:1369 | Go `flag` gives this text natively (F9) |
| R14 | Suite gated on env, not in runner | test/unit/view/page-transfer-sidecar.server.test.ts:12-19,39 | Starts a server via `run-against.ts` but no runner or workflow passes it. | NONE — `git grep page-transfer-sidecar -- .github scripts` found nothing | Add it to the runner list for both targets |
| R15 | Other consumers of the built host | agent-evals.yml (dotnet build → `BLOK_CONFORMANCE_SERVER`); test/playwright/tests/agent/mcp-participant.spec.ts:29,52 | Evals and one Playwright spec drive the C# host only. | NONE | Optional `target` input on agent-evals; keep C# default |

### 1b. Standalone host binary (delivery-visible surface)

| # | Feature | C# location | What it does | Oracle | Go home |
|---|---------|-------------|--------------|--------|---------|
| H1 | Version stamp | Program.cs:43-46; publish-server.mjs:156; Dockerfile:48 | `-p:BlokServerVersion=X` → `/health` version; unset → `dev`. | server-contract.test.ts:284-285 (`"version":"dev"`); release-server.yml:257-258 (stamped) | `var version = "dev"` + `-ldflags "-X main.version=$V"`. Do NOT use `ReadBuildInfo` (F10 gives `(devel)`; a proxy build gives `v`-prefixed text, **UNVERIFIED**: `go install …@version` not run). |
| H2 | `--help` → stderr usage, exit 0 | Program.cs:28-32 | | server-contract.test.ts:789-938 "exits with the contract code for help" | `flag.NewFlagSet("blok-server", ContinueOnError)`; map `flag.ErrHelp` → exit 0 |
| H3 | Unknown flag → exit 2 | Program.cs:34-39 | | same it.each "unknown flag" | native Go text (F9) |
| H4 | Startup refusals → `blok-server refused to start: …`, exit 1 | Program.cs:48-56,111-115 | | same it.each (auth, secret, origin, S3 cases); release-server.yml:235 exact unsafe-bind text | `cmd/blok-server/main.go` |
| H5 | Malformed `--listen` | Program.cs:74-77 | Errors copy Go's net text. | server-contract.test.ts:940-957 `listen tcp: address localhost: missing port in address` / `address 65536: invalid port` | native `net.Listen` text, probed byte-exact: `listen tcp: address localhost: missing port in address`, `listen tcp: address 65536: invalid port` (flagprobe/l). |
| H6 | `--secret` / `--doc-endpoint-auth` process-list warnings | Program.cs:58-70 | Warn when a secret comes from a flag. | server-contract.test.ts:752 "reads BLOK_SECRET and lets an explicit secret override it" (warning text itself: NONE) | main.go. Propose adding a `toContain('warning: --secret')` case. |
| H7 | Request timeouts | Program.cs:119-152 | 10 min request deadline → 504; 10s header timeout; 2 min keep-alive; sync socket exempt. | server-contract.test.ts:236 "applies the total request deadline while a response keeps sending bytes" | `http.Server{ReadHeaderTimeout:10s, IdleTimeout:2m}` + per-route `http.TimeoutHandler`-like wrapper (TimeoutHandler buffers; **trap**, see T9) |
| H8 | Health wire | test-server-packages.mjs:334-363; release-server.yml:257 | `GET` → `{"status":"ok","version":"V"}\n` JSON; `HEAD` → 200 empty JSON; `POST` → 405 `Allow: GET, HEAD`. | server-contract.test.ts:275 "returns the exact ungated health response without CORS", :290, :317 | `httpapi/health.go` (old: `ad5782d7^:packages/server/internal/httpapi/health.go`) |
| H9 | Unknown route / no storage | test-server-packages.mjs:405-430 | `404 page not found\n` text/plain. | server-contract.test.ts:290, :358 | native ServeMux (F9) |
| H10 | Release-image smoke | release-server.yml:217-264 | Unsafe bind refuses with an exact line; proxy mode serves health/unfurl 400/upload 404/missing 404. | release-server.yml itself (runs only at release) | Same smoke against the Go image |

### 1c. npm wrapper `@bloklabs/server`

| # | Feature | C# location | What it does | Oracle | Go home |
|---|---------|-------------|--------------|--------|---------|
| N1 | Archive name per platform | bin/blok-server.mjs:49-71 | `blok-server_<os>_<arch>` (+`linux_musl`), zip on Windows. | test/unit/server/bin.test.ts (16 cases, grep count) | **Unchanged.** Go archives must use other names (T1). |
| N2 | Checksums verify | bin/blok-server.mjs:87-97,196-216 | Downloads `checksums.txt` from `v<ver>` release, refuses mismatch or missing entry. | bin.test.ts | Unchanged. Go gets `checksums-go.txt` (T2). |
| N3 | Cache dir + `BLOK_SERVER_CACHE_DIR` | bin/blok-server.mjs:107-162 | Per-OS cache, temp fallback 0700. | bin.test.ts | Unchanged |
| N4 | Signal forwarding, exit code passthrough | bin/blok-server.mjs:263-286,353-358 | | bin.test.ts | Unchanged; Go binary must exit by signal the same way (R10) |
| N5 | Docker fallback text | bin/blok-server.mjs:293-302 | Points at `ghcr.io/jackuait/blok-server:<ver>`. | bin.test.ts | Unchanged |
| N6 | npm tarball contents | packages/server/package.json:42-46 | `files: bin, dist, types` — a `go/` dir is not packed. | package-metadata-law.test.ts (6) | Nothing to do; `packages/server/go` stays out of npm |
| N7 | Description says C# | packages/server/package.json:4 | "shared C# routes". | server-release-wiring.test.ts:759 "keeps every public delivery surface on C#" (`/C#\|ASP\.NET/`) | Reword to "C# and Go"; regex still passes |

### 1d. Release archives, NuGet, Docker

| # | Feature | C# location | What it does | Oracle | Go home |
|---|---------|-------------|--------------|--------|---------|
| P1 | 8 host targets | publish-server.mjs:17-74 | darwin/linux/linux-musl/windows × amd64/arm64. | publish-server.test.ts:78 "maps exactly the eight external assets to their .NET RIDs" (7 cases) | `scripts/publish-server-go.mjs` or a `GO_TARGETS` list: 6 GOOS/GOARCH pairs. A static binary (cgo off) needs no musl variant — **UNVERIFIED** until an Alpine smoke runs it. |
| P2 | Publish command | publish-server.mjs:138-160 | self-contained single file, no symbols, version stamp. | publish-server.test.ts:160 | `go build -trimpath -ldflags "-s -w -X main.version=V"` with cgo off |
| P3 | Deterministic archives | publish-server.mjs:177-218 | tar mode 0755, uid/gid 0, mtime 0; gzip level 9 mtime 0; zip via own writer. | publish-server.test.ts:188 "archives only $binary at the root of $archive" | Reuse `createArchive` unchanged |
| P4 | `checksums.txt` | publish-server.mjs:224-234 | Sorted `sha256  name` lines. | publish-server.test.ts | Reuse `renderChecksums` → `checksums-go.txt` |
| P5 | `--dry-run` | publish-server.mjs:240-251; ci.yml:358 | Prints commands, builds nothing (0s, F5). | ci-critical-path-law.test.ts:339 | Same flag for the Go publisher |
| P6 | NuGet packs + content checks | release-server.yml:123-138; test-server-packages.mjs:202-287,616-700 | Packs Blok.Server + AspNetCore, checks nuspec, DLL bytes = host build. | test-server-packages.mjs (script asserts) | Go library ships as the module itself (T3). No pack step. |
| P7 | Consumer fixture | test/fixtures/dotnet-server-consumer/Program.cs; test-server-packages.mjs:700-760 | Restores packages from a local feed, mounts at `/api/blok` behind app auth, checks the embedded runtime hash. | test-server-packages.mjs `probeEndpoints(…, applicationAuthorization=true)` | `test/fixtures/go-server-consumer/` (own `go.mod`, `replace` → `../../../packages/server/go`), `http.StripPrefix("/api/blok", …)` behind a header-auth middleware; same probes; same `BLOK_EXPECTED_RUNTIME_SHA256` check |
| P8 | Host publish smoke | test-server-packages.mjs:762-800 | Publishes host for the current RID and probes root routes, version `dev`. | same script | Go: build + same probes |
| P9 | Runtime bundle embed | Blok.Server.csproj:48-61; build-server-runtime.mjs:8,16; .gitignore:29 | JS runtime is built into `Generated/` (gitignored) and embedded as a resource. | Consumer fixture hash check | `go:embed` cannot reach `../`, and a gitignored file is missing for module consumers (F7). See T3. |
| P10 | Release order | release-server.yml:83-371 | CI gate → draft exists → test → pack → smokes → NuGet → mirror → assets → image → verify → publish draft → docs. | server-release-wiring.test.ts:273 "publishes two NuGets, eight hosts, checksums, and a multi-architecture image before the draft" | Insert Go steps after "Upload release assets": build Go archives, upload, Go image, then add Go assets/image to "Verify published server delivery" |
| P11 | Docker image (C#) | Dockerfile:1-61 | Node stage builds runtime; SDK stage publishes per TARGETARCH; runtime-deps final, USER 65532, `/data`, port 4000. | server-release-wiring.test.ts:640 (asserts `not.toMatch(/\bgo(?:lang)?\b/i)` and no `distroless`) | **Separate** `packages/server/go/Dockerfile` → `ghcr.io/jackuait/blok-server-go` (T4) |
| P12 | Image smokes | release-server.yml:205-276 | Exact unsafe-bind refusal; health; USER 65532 with unwritable HOME. | server-release-wiring.test.ts:578, :784-832 | Same smokes, Go image |
| P13 | Alpine archive smoke | release-server.yml:148-156 | Runs the musl archive on `runtime-deps:10.0-alpine`. | server-release-wiring.test.ts:788 | Run the linux_amd64 Go archive on plain `alpine` |
| P14 | `latest` only for stable | release-server.yml:207-211,294-297 | | server-release-wiring.test.ts:545 | same rule for the Go image |
| P15 | Release tag | scripts/release.mjs:198,429-431 | Tags `v<ver>`, pushes branch then tag. | scripts/release.test.mjs (12), release-cli.test.ts (13) | Also tag `packages/server/go/v<ver>` on the same commit and push it (F6) |
| P16 | Tag-triggered workflows | release.mjs:13-16; release-server.yml:3-5; mirror.yml | Trigger on `v*`. | release-cli.test.ts | A `packages/server/go/v*` tag cannot match `v*` because it does not start with `v`. `mirror/v*` tags already coexist with `v*` (`git tag`). No script resolves a tag at HEAD: `git grep "describe --tags\|tag --list\|git tag -l\|for-each-ref.*tags\|points-at" -- scripts .github` found nothing. |
| P17 | Family version | release-manifest.mjs:59-67; package.json:3 | Server rides the shared family version. | server-release-wiring.test.ts:187 "keeps the server package on the family version" | Go module tag uses the same version. A family 2.0.0 forces `…/packages/server/go/v2` (F8). |

### 1e. CI quality gates

| # | Gate | C# location | Oracle (law that pins it) | Go analogue |
|---|------|-------------|---------------------------|-------------|
| G1 | Tests + coverage collect | ci.yml:312-318 | ci-critical-path-law.test.ts:290 "tests, measures and formats the .NET server" (exact step list) | `go test -p 2 -race? -coverpkg=./... -coverprofile=… ./...` (race cost **UNVERIFIED**) |
| G2 | Coverage floor 80% lines + 80% branches | check-server-coverage.mjs:4-7,20-48; ci.yml:320-329 | check-server-coverage.test.ts (3); server-quality-gates.test.ts:61 | Go has statements only (F12). Add `validateGoCoverage(profileText)` in the same script: total statement % ≥ 80. Say plainly there is no Go branch floor. |
| G3 | Formatter | ci.yml:331-332 (`dotnet format --verify-no-changes`, 48s) | ci-critical-path-law.test.ts:290 | `test -z "$(gofmt -l .)"` |
| G4 | Analyzers as errors | Directory.Build.props:3-7 | server-quality-gates.test.ts:44 | `go vet ./...` (+ optionally staticcheck — new dependency, user call) |
| G5 | Dependency audit | Directory.Build.props:8-11; ci.yml:258-259 (`dotnet restore`) | server-quality-gates.test.ts:44,81 | `govulncheck ./...` (pinned version). Trivy fs (ci.yml:268-277) already reads `go.mod`/`go.sum` — **UNVERIFIED** for this Trivy version. |
| G6 | Secret scan | ci.yml:261-266 (gitleaks, whole repo) | server-quality-gates.test.ts:81 | nothing new; covers Go files already |
| G7 | Image scan | ci.yml:279-291 | server-quality-gates.test.ts:81 (exactly 2 trivy uses) | Build Go image + 3rd trivy step → the law's `toHaveLength(2)` must change |
| G8 | CodeQL | ci.yml:183-238; codeql.yml; codeql-config.yml | server-quality-gates.test.ts:81; ci-critical-path-law.test.ts:496 | add `go` language (see §3) |
| G9 | Outbound-client law | Blok.Server.Tests/OutboundClientArchitectureTests.cs:12-36,43-61 (14 Fact/Theory) | itself | `go/internal/archlaw/outbound_test.go` using `go/parser` + import resolution, not substrings (T6). Owners: guarded fetcher, S3 store, doc-endpoint client. |
| G10 | Dependabot | .github/dependabot.yml:67-98 | server-quality-gates.test.ts:135 (`arrayContaining`, additive OK) | add `gomod` `/packages/server/go`, `docker` `/packages/server/go` |
| G11 | Action pins | ci.yml:120-121 (`check-action-pins.mjs`) | workflow-lint job | `actions/setup-go@<sha>`; old ci used `@v5` unpinned (`git show ad5782d7 -- .github/workflows/ci.yml`) |
| G12 | Readiness aggregator | ci.yml:682-720 | ci-critical-path-law.test.ts:176 | add the new job id to `needs` |

### 1f. Docs and laws that say "C# only" or "Go is gone"

| # | File:line | Claim | Change |
|---|-----------|-------|--------|
| D1 | test/unit/architecture/server-go-removal-law.test.ts:78-180 (5 cases) | No `.go`/`go.mod`/`go.sum`, no `go build/test/vet/run/install/generate`, no `actions/setup-go`, `CGO_ENABLED`, goreleaser; runner rejects `--target go`. | Delete. Replace with a **parity law** (§4). Must land FIRST, or the first `.go` file turns CI red. |
| D2 | server-release-wiring.test.ts:194-219 | Asserts `--target csharp` step only. | Also require `--target go`. |
| D3 | server-release-wiring.test.ts:640-696 | Dockerfile must not mention go. | Keep for the C# Dockerfile; add a case for the Go Dockerfile. |
| D4 | server-release-wiring.test.ts:759-773 | "keeps every public delivery surface on C#"; bans "Go sidecar". | Rename; require both C# and Go named. |
| D5 | server-release-wiring.test.ts:775-782 | "ships an npm wrapper that verifies the C# host it downloads". | Keep (npm still ships C#). |
| D6 | server-quality-gates.test.ts:61-133 | Only C# gates. | Add Go gate assertions. |
| D7 | ci-critical-path-law.test.ts:176-205, 290-383 | Exact job list and exact step lists. | Add the new job and steps. |
| D8 | packages/server/README.md:3,166,539,663 | "written in C#"; "runner builds and drives the C# host only"; CI paragraph lists C# gates only. | Rewrite for both. |
| D9 | packages/server/protocol/blok-sync-v2.md:623-630 | "`--target` accepts only `csharp` … adds no external-target mode." | Rewrite §11.1. |
| D10 | docs/src/components/server/server-data.ts:3,108-125; server-data.test.ts:99-110,215-220 (78 cases, grep count) | Paths are own-storage, dotnet, own-server, serverless. | Add a `go` in-process path (net/http mount) once the library exists; tests pin the exact id list. Both locales (en.json, ru.json). |
| D11 | release-manifest.mjs:59-62 | Comment: tag workflow publishes "the shared C# host archives and container image". | Mention Go archives/image. |
| D12 | docs/maintainers/page-csharp-host.md | C# host guide. | Needs a Go twin later (host area). |
| D13 | memory `blok-server-go-service-shipped.md` (desc line 3, lines 11-14) | "Go REMOVED", "Everything Go-specific … is dead". | Rewrite; point at `backend-go-and-csharp-parity-rule.md`. |
| D14 | memory `blok-backend-service-direction.md` lines 3,9-10,31 | "Go deleted", "REWRITTEN IN C#". | Update status. |
| D15 | memory `release-mechanics.md` line 110 | Lists `server-go-removal-law.test.ts`. | Replace with the parity law. |
| D16 | memory `MEMORY.md` / `index-collab-server-kb.md` line 14 | Link label `[C#](blok-server-go-service-shipped.md)`. | Relabel. |
| D17 | scripts/mutation-test-seconds.json:57 | Timing entry for the removal law. | Regenerate after the law is replaced. |

### 1g. Oracle recount: C#-only tests are not Go oracles

These rows cite a test that pins the C# side only. It would stay green with no Go code at all, so for Go the oracle is **NONE**. The proposal for each is in §4.

| Row | C#-only test cited | Go oracle to add |
|-----|--------------------|------------------|
| R2, R3 | ordinaryIt cases run the binary the runner builds — real Go oracle once R1 lands | (none needed after R1) |
| P1 | publish-server.test.ts `TARGETS` | Go target-list test |
| P2 | publish-server.test.ts command | Go build-command test |
| P3 | publish-server.test.ts archive layout | same test over Go archives |
| P4 | publish-server.test.ts | `checksums-go.txt` render test |
| P5 | ci-critical-path-law dry-run step | Go dry-run step in the law |
| P6 | test-server-packages.mjs nuspec checks | module-zip check: `go mod download` from a local tag, assert files present |
| P7 | test-server-packages.mjs consumer probes | go-server-consumer probes |
| P8 | test-server-packages.mjs host publish | Go host build + probes |
| P9 | consumer runtime-hash check | Go runtime SHA check + freshness law |
| P10 | release-wiring release order | Go steps in the order law |
| P11 | release-wiring Dockerfile case | Go Dockerfile case |
| P12 | release-server.yml image smokes | same smokes on Go image |
| P13 | release-server.yml Alpine smoke | Go archive on alpine |
| P14 | release-wiring `latest` rule | same for Go image |
| P15 | release.test.mjs / release-cli.test.ts | second-tag cases |
| P17 | family-version law | Go tag = family version law |
| H10 | release-server.yml smoke | Go image smoke |
| G1-G12 | ci-critical-path-law / server-quality-gates / check-server-coverage tests | Go gate assertions + Go coverage parser test + Go AST outbound law |

Black-box Go oracles that already exist (run through the runner once R1 lands): R5, R7-R13, H1-H9 (H6 text excepted). Shared and target-independent: R6, N1-N7 (npm wrapper unchanged, bin.test.ts).

Recount over the 61 feature rows (R/H/N/P/G):
- R4, R6, R14, R15, H6 → 5 NONE.
- P1-P15, P17, H10 → 17 C#-only.
- G1-G12 → 12 C#-only.
- Total **34 NONE for Go**.

## 2. Answers

### (1) Running conformance with `--target go`

What must change, all in `scripts/test-server-conformance.mjs`:
1. `selectedOptions` (:38-58): accept `go`. Update the usage string to `[--target csharp|go]`.
2. Build step: for `go`, run in `packages/server/go`:
   - `go build -o <tmp>/go-ordinary/blok-server ./cmd/blok-server`
   - `go build -tags conformance -o <tmp>/go-conformance/blok-server ./cmd/blok-server`
   - with the runtime bundle in place first (T3).
3. Env (:165-175): point both variables at the Go binaries. Add `.exe` on Windows.
4. `--configuration`: decide (R4). It means nothing to Go.
5. Banner (:65-70): print the target.

What needs NO change: `run-against.ts` and `server-process.ts` are language-neutral. They need only:
- the `--listen 127.0.0.1:PORT` flag (run-against.ts:77-97),
- `GET /health` = 200 (server-process.ts:88-98),
- the `" listening on "` stderr marker, written after bind (server-process.ts:14,133),
- `address already in use` in the bind error (run-against.ts:130-132),
- exit within 2s of SIGTERM (server-process.ts:15,58-74).

The Go binary must also:
- keep the conformance flags behind a build tag (R11, R12),
- print usage as `blok-server` (F9).

### (2) Versioning and releasing a Go module in `packages/server/go`

- Module path: `github.com/JackUait/blok/packages/server/go`. The old module was `github.com/JackUait/blok/packages/server` (`git show ad5782d7^:packages/server/go.mod`). No `packages/server/v*` tag ever existed (`git tag | grep -v '^v'` showed only `mirror/*` and backup tags), so no published version to clash with. **UNVERIFIED**: whether proxy.golang.org cached pseudo-versions of the old path.
- Tags: `packages/server/go/vX.Y.Z` on the same commit as `vX.Y.Z` (F6). Add it to `scripts/release.mjs:429-431`.
- Major version: family 2.0.0 means module path `…/go/v2` and every import changes (F8).
- Prerelease versions (`1.17.0-beta.1`) are valid semver tags. **UNVERIFIED** with the proxy.
- Library consumers use `go get …/packages/server/go@vX.Y.Z`. This is the NuGet analogue. It works only if the embedded runtime is committed inside the module (F7, T3).
- Binary: `go install …/packages/server/go/cmd/blok-server@vX.Y.Z` also builds from the module zip. Same constraint. Its version reads `dev` unless the code falls back to build info (H1).
- Release artifacts, without touching what ships today:
  - GitHub release assets `blok-server-go_<os>_<arch>.tar.gz|zip` + `checksums-go.txt`. The 8 C# names, `checksums.txt` bytes, and the npm wrapper stay as they are.
  - Image `ghcr.io/jackuait/blok-server-go:<ver>` (+`latest` for stable), from `packages/server/go/Dockerfile`. `ghcr.io/jackuait/blok-server` stays C#.
  - npm: no change. `@bloklabs/server` still downloads the C# archives.
  - Optional: warm the proxy in the verify step (`GOPROXY=https://proxy.golang.org go list -m …@vX.Y.Z`).

### (3) CI plan under 20 slots and 7 minutes

Baseline: t=0 uses 19 slots on main and 18 on PRs (F2, F3). Jobs over 5 minutes are Server (5m34s) and Lint/Unit/E2E (frontend). Server Delivery has about 3 minutes of slack, Server Security about 4 minutes (F4).

**Plan A (recommended): one new job, `server-go` "Server (Go)", at t=0.**
- Steps: checkout → setup-node-deps → setup-go (SHA-pinned, cache on `packages/server/go/go.sum`) → build the runtime bundle (<1s, F13) → `gofmt -l` → `go vet ./...` → `go test -p 2 -coverprofile` → coverage floor → `node scripts/test-server-conformance.mjs --target go` → Go consumer fixture + `publish-server-go --dry-run`.
- Estimate: about 20s setup + Go test (**UNVERIFIED**, port not written) + conformance. C# conformance takes 2m15s (F5) including two dotnet builds. Go builds take seconds, so Go conformance is probably 1-2m. **UNVERIFIED** until measured.
- Slots: main t=0 becomes 20 = the cap. Nothing waits at t=0. E2E shards start after Build (~70s), when i18n/workflow-lint have ended. Per memory `ci-20-job-cap-wall-clock.md`, extra jobs delay E2E. Measure first-job-start → end before and after, like that memory did.
- Fold the rest, no new jobs:
  - **Server Security** (+govulncheck, +Go image `docker build` +Trivy image scan): est. +1-2m → ~4-5m. Go image build time is **UNVERIFIED**.
  - **CodeQL**: add `go` with `build-mode: autobuild` (or manual `go build ./...`) to the **same** csharp job as a second language. **UNVERIFIED** that one CodeQL job takes two languages with mixed build modes, and how long it takes. Fallback: a 3rd matrix entry (+1 job → main t=0 = 21, over the cap). Or run Go CodeQL only in weekly `codeql.yml`, which is weaker than C#.

**Plan B (zero new jobs).** Put Go conformance into Server Security and Go unit tests + gofmt/vet into Workflow Lint (21s, Go only). This is lossless on slots but mixes concerns. Server Security would then need node deps. Use it only if Plan A's measurement shows E2E delay.

Do NOT put Go into `server` (5m34s, would pass 7m) or `server-delivery` (3m49s + ~2m conformance + fixture ≈ 6-7m, too close).

Release (release-server.yml) is one long job with no 7-minute rule in the memory (`ci-job-time-budget-7min.md` is about the CI workflow). Add Go steps there. A separate job would need artifact passing.

### (4) Go analogue of each gate

See §1e. In short:
- coverage → statement floor only (no branch metric exists),
- `dotnet format` → `gofmt -l`,
- analyzers → `go vet`,
- NuGetAudit → `govulncheck` + Trivy fs,
- outbound law → AST law,
- CodeQL csharp → CodeQL go,
- container scan → a 3rd Trivy step,
- Dependabot → gomod + docker entries.

### (5) Files that say Go is gone

See §1f: D1-D17. The blocker is D1. Its patterns match any tracked file except `docs/plans/*.md`, including the plain words "go test", "CGO_ENABLED" and "actions/setup-go" in ci.yml or a README.

## 3. Unit tests in this area that need Go twins or edits

| File | Count | Go need |
|------|-------|---------|
| test/unit/server/bin.test.ts | 16 | none (npm wrapper unchanged) |
| test/unit/scripts/check-server-coverage.test.ts | 3 | + Go profile parser cases |
| test/unit/scripts/publish-server.test.ts | 7 | + Go target list / command / archive cases |
| test/unit/scripts/release-cli.test.ts | 13 | + second tag push |
| scripts/release.test.mjs | 12 | + second tag |
| test/unit/architecture/server-release-wiring.test.ts | 31 | edit D2-D5; add Go asset/image cases |
| test/unit/architecture/server-quality-gates.test.ts | 4 | add Go gates |
| test/unit/architecture/ci-critical-path-law.test.ts | 18 | add server-go job |
| test/unit/architecture/server-go-removal-law.test.ts | 5 | replace |
| test/unit/architecture/package-metadata-law.test.ts | 6 | check after the description edit |
| docs/src/components/server/server-data.test.ts | 78 | add Go path cases |
| Blok.Server.Tests/OutboundClientArchitectureTests.cs | 14 Fact/Theory | Go AST law with the same mutation cases (alias, fully-qualified, escapes, comments/strings ignored, second S3 client) |
| Blok.Server.Host.Tests/HostProcessTests.cs | 42 | host area owns it; delivery needs H1-H7 |
| Blok.Server.Host.Tests/HostCollabTests.cs | 15 | host area |

Counts: `grep -cE "^\s*(it|test)(\.each\([^)]*\))?\("` for TS, and `grep -cE "\[(Fact|Theory)\]"` for C#. An `it.each` row counts once.

## 4. Proposed shared oracles for NONE rows

| For | Proposal |
|-----|----------|
| R4/R6 | `test/unit/scripts/test-server-conformance.test.ts`: argument parsing for both targets, run with `PATH=''` like the removal law does (server-go-removal-law.test.ts:144-180). |
| R14 | Add `test/unit/view/page-transfer-sidecar.server.test.ts` to the runner's list. |
| H6 | A conformance case: `--secret` on argv → stderr contains `warning: --secret puts the shared secret`. |
| P7/P9 | `scripts/test-server-go-module.mjs` + `test/fixtures/go-server-consumer`: the same `probeEndpoints` as test-server-packages.mjs:326-431, and the embedded runtime SHA check. |
| D1 | `server-backend-parity-law.test.ts`, which asserts:<br>- ci.yml runs `--target csharp` AND `--target go`;<br>- both coverage floors run;<br>- dependabot has nuget + gomod;<br>- release-server uploads both asset sets;<br>- the Go module's embedded runtime equals a fresh `buildServerRuntime` (freshness, like collab-fixtures.freshness.test.ts). |
| T7 | A source-lockstep test for Go tables (like server-concurrent-loss-wave2.test.ts:202-323 reads TextDiff.cs), or better, a shared JSON table that both read. |

## 5. Traps

| # | Trap | Evidence |
|---|------|----------|
| T1 | The old Go release used the SAME archive names (`name_template: 'blok-server_{{ .Os }}_{{ .Arch }}'`, checksum `checksums.txt`). Reusing them would silently swap the npm wrapper's binary from C# to Go. | `git show ad5782d7^:.goreleaser.yaml`; bin/blok-server.mjs:68,197-205 |
| T2 | Adding Go lines to `checksums.txt` keeps the wrapper working (it looks up by name, :87-97) but changes the bytes of a published file. Use `checksums-go.txt`. | bin/blok-server.mjs:87-97; publish-server.mjs:224-234 |
| T3 | The runtime bundle (887 KB) is gitignored (.gitignore:29). `go:embed` builds locally but breaks every `go get`/`go install` consumer (F7). Choose one:<br>(a) commit a copy inside `packages/server/go/…` plus a freshness law. Every `src/view` change then regenerates a tracked file.<br>(b) add the bundle only in the `chore(release)` commit (release.mjs:58-59 commits manifests there). The guard at release.mjs:425-427 refuses later tracked changes, so it must happen before that. `@main` / pseudo-version consumers break.<br>(c) ship only binaries.<br>NuGet parity (a library at every released version) needs (a) or (b); (a) is the only one that also serves `@main`. | F7; Blok.Server.csproj:48-61 |
| T4 | The C# Dockerfile law bans the word `go` and `distroless` (server-release-wiring.test.ts:692-693). Use a separate Go Dockerfile. Do not add a Go stage to the existing one. | same |
| T5 | The removal law fails on plain text like `go test` or `CGO_ENABLED` in ANY tracked file except docs/plans markdown, including README and workflow comments. Replace it before the first Go commit. | server-go-removal-law.test.ts:22-38,92-101 |
| T6 | The old Go outbound law matched substrings (`http.Client{`, `http.Get(` …). An import alias (`nh "net/http"`) or `net.Dialer`/`tls.Dial`/websocket dialers walk past it. The C# law resolves symbols and tests aliases and escapes. | `ad5782d7^:packages/server/internal/httpapi/outbound_law_test.go:56-65`; OutboundClientArchitectureTests.cs:84-141 |
| T7 | JS/TS laws read C# source directly (YDocConverter.cs, TextDiff.cs Unicode ranges). A Go port has no such guard unless one is added. Go 1.27 is on Unicode 17 (F11), so hard-coded tables must match Node 26's tables, not Go's `unicode` package by default. | server-concurrent-loss-wave2.test.ts:13-17,202-323; memory `ci-node26-unicode17-vs-local-node24.md` |
| T8 | Version: `debug.ReadBuildInfo` reports `(devel)` for local builds (F10), and the module version has a `v` prefix. `/health` must say `dev` or `1.16.1`, never `(devel)` or `v1.16.1`. | server-contract.test.ts:284; release-server.yml:257-258 |
| T9 | `http.TimeoutHandler` buffers the whole response and cannot cover a streaming body or a WebSocket. The 10-min deadline must cut a body that "keeps sending bytes", and sync sockets must be exempt. | server-contract.test.ts:236; Program.cs:125-128. Go behaviour **UNVERIFIED** in this session. |
| T10 | `flag.NewFlagSet` name must be `blok-server`. `flag.CommandLine` prints `Usage of /full/path/binary:`, and the test expects `Usage of blok-server:`. | F9; server-contract.test.ts:794 |
| T11 | Go's `flag` accepts `-x` and `--x`. C# mirrors that by hand (ConformanceArguments.cs:40,46,57-69). A non-`flag` parser (cobra/pflag) would change texts and exit codes. | ConformanceArguments.cs |
| T12 | `setup-go`'s cache fails the job when `cache-dependency-path` resolves to nothing, so `go.sum` must exist even with no deps. | old ci.yml comment, `git show ad5782d7 -- .github/workflows/ci.yml` |
| T13 | The release-wiring suite check lists only 4 of the 6 suites the runner runs. A Go branch that drops `protocol-v2` or `mcp-agent-participant` would pass the law. | server-release-wiring.test.ts:223-234 vs test-server-conformance.mjs:140-150 |
| T14 | `dotnet test` with `--no-build` broke HostCollabTests' 10s socket deadlines on 4 vCPU. A Go job beside it on the same runner type may hit timing deadlines too. Use `-p 2`. | ci.yml:309-311; memory `ci-20-job-cap-wall-clock.md` |
| T15 | Any ci.yml edit to server jobs must update ci-critical-path-law's EXACT step lists (`toEqual`, :96-105). | ci-critical-path-law.test.ts:96-105 |
| T16 | Server Security checks out full history (`fetch-depth: 0`) for gitleaks. Go steps added there pay nothing extra. A new Go job should use the default shallow checkout. | ci.yml:247-251 |
