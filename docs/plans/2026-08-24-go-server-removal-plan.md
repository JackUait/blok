# Go server removal implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the unreleased Go server with one .NET 10 implementation shared by NuGet and the standalone host, switch every delivery path to C#, and delete all Go source and build wiring.

**Architecture:** A TypeScript/Vitest black-box suite freezes the externally observable Go contract before C# route work starts. `Blok.Server` holds framework-neutral services, `Blok.Server.AspNetCore` maps the shared HTTP contract, and `Blok.Server.Host` only parses standalone configuration and starts ASP.NET. The same C# handlers back NuGet and the host; Go remained frozen until the C# host, packages, artifacts, Docker image, npm wrapper, and security gates passed, then was deleted in one change.

**Tech Stack:** TypeScript, Vitest, .NET 10, ASP.NET Core, Jint 4.16.1, AngleSharp, xUnit 2.9.3, Microsoft.AspNetCore.TestHost 10.0.0, self-contained single-file `dotnet publish`, Docker, GitHub Actions.

**Spec:** `docs/plans/2026-08-23-blok-dotnet-library-design.md`

**Status:** Tasks 1–18 are complete. C# is the sole server implementation and delivery
path; Task 17 removed the frozen Go source and build wiring after the unwaived Task 16
dual-target gate passed, and Task 18 completed the final repository verification.

## Global constraints

- Work directly on the existing `main` branch. Do not create branches, worktrees, or stashes.
- Follow TDD for every production change: add the narrowest test, run it red for the intended reason, implement the minimum, then run it green.
- Run only new/directly affected tests during red/green work. Lint only changed TypeScript/JavaScript files.
- Keep one implementation. `Blok.Server.Host` contains composition/configuration only and never forks endpoint or storage logic from NuGet.
- Preserve current route paths, methods, JSON/text bodies, meaningful headers, flags, environment variables, archive names, executable name, npm package name, and GHCR image name.
- Keep Go frozen. Only conformance seams and correctness/security fixes may touch Go before deletion.
- Consumer-supplied URLs have one guarded C# fetch path. S3 is the sole documented configured-endpoint exception.
- The C# guard validates every initial URL and redirect, pins the validated address for the connection, and preserves Host/TLS SNI.
- Disabled dependencies mean absent routes (404), not handler-level “disabled” errors.
- Do not add MySQL/database-block work to this plan; it follows Go removal.
- Target `net10.0` only. Do not add NativeAOT or speculative provider abstractions.
- Keep the generated TypeScript runtime untracked and embedded through the existing build hook.
- Go deletion happens only after the removal gate in Task 16 passes.

## File structure

### Cross-language conformance

- `test/server-conformance/server-process.ts` — launches a supplied executable, waits for health, captures stderr, and shuts the process down.
- `test/server-conformance/http-client.ts` — raw request helper preserving response bytes and repeated headers.
- `test/server-conformance/fixtures.ts` — deterministic HTML, upload bytes, ticket vectors, and expected wire results.
- `test/server-conformance/server-contract.test.ts` — health, route registration, CORS, auth, limits, uploads, local files, unfurl, and process tests.
- `test/server-conformance/run-against.ts` — selects `BLOK_CONFORMANCE_SERVER` and allocates storage/listen configuration.
- `scripts/test-server-conformance.mjs` — builds the ordinary and conformance C# hosts and invokes the same 58-case Vitest contract.

### C# projects

- `packages/server/dotnet/Blok.Server/` — runtime, tickets, metadata parsing, guarded fetch, local/S3 storage, and shared contracts.
- `packages/server/dotnet/Blok.Server.AspNetCore/` — options, DI, middleware, endpoints, local-file mapping, and rate limiting.
- `packages/server/dotnet/Blok.Server.Host/` — CLI/environment parsing, Kestrel configuration, startup validation, and graceful shutdown.
- Matching `*.Tests` projects contain focused unit/TestServer/process tests.
- `packages/server/dotnet/Blok.Server.slnx` contains all production/test projects.

### Delivery and deletion

- `scripts/publish-server.mjs` publishes six RIDs into legacy-compatible archive names plus `checksums.txt`.
- `.github/workflows/release-server.yml` packs NuGet, archives hosts, smoke-tests native artifacts, and publishes the existing image/assets.
- `packages/server/Dockerfile` becomes a repository-root-context .NET multi-stage build.
- `packages/server/bin/blok-server.mjs` keeps the existing external protocol and downloads the C# single-file host.
- Task 17 removed `.goreleaser.yaml`, `packages/server/go.mod`, `packages/server/go.sum`, `packages/server/cmd`, and `packages/server/internal`.

---

### Task 1: Create the external server process harness

**Files:**
- Create: `test/server-conformance/server-process.ts`
- Create: `test/server-conformance/http-client.ts`
- Create: `test/server-conformance/run-against.ts`
- Create: `test/server-conformance/server-contract.test.ts`
- Create: `scripts/test-server-conformance.mjs`

**Interfaces:**
- Produces: `startServer(options): Promise<RunningServer>`, where `RunningServer` exposes `baseUrl`, `request()`, and `stop()`.
- Consumes: `BLOK_CONFORMANCE_SERVER` pointing at a built executable.

- [ ] **Step 1: Write the red health/process test**

```ts
it('starts a supplied server and reports its version', async () => {
  const server = await startServer({ args: ['--listen', '127.0.0.1:0', '--storage-dir', ''] });

  try {
    expect(await server.request('GET', '/health')).toMatchObject({
      status: 200,
      headers: { 'content-type': 'application/json' },
      json: { status: 'ok', version: expect.any(String) },
    });
  } finally {
    await server.stop();
  }
});
```

- [ ] **Step 2: Run it red**

Run: `BLOK_CONFORMANCE_SERVER=/missing yarn vitest run --project=unit test/server-conformance/server-contract.test.ts`

Expected: FAIL because the process harness does not exist/cannot launch the supplied target.

- [ ] **Step 3: Implement the minimum harness**

Use `child_process.spawn` with an allocated loopback port, bounded health polling, stderr capture, and SIGTERM followed by bounded wait. The raw HTTP helper returns status, a lower-cased header multimap, bytes, text, and parsed JSON only when requested.

- [ ] **Step 4: Build Go and run green**

```bash
go build -o /tmp/blok-server-go ./packages/server/cmd/blok-server
BLOK_CONFORMANCE_SERVER=/tmp/blok-server-go   yarn vitest run --project=unit test/server-conformance/server-contract.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add test/server-conformance scripts/test-server-conformance.mjs
git commit -m "test(server): add external conformance harness"
```

---

### Task 2: Freeze startup, health, route, CORS, auth, and limiter behavior

**Files:**
- Modify: `test/server-conformance/server-contract.test.ts`
- Create: `test/server-conformance/fixtures/tickets.json`
- Test source: `packages/server/internal/httpapi/*_test.go`
- Test source: `packages/server/internal/config/config_test.go`
- Test source: `packages/server/internal/ticket/verify_test.go`

**Interfaces:**
- Produces executable black-box cases reused unchanged against Go and C#.
- Pins exact route registration and middleware order: origin → ticket → rate limit → handler.

- [ ] **Step 1: Add table-driven red cases**

Cover:
- exact `GET /health` JSON and absence of CORS;
- wrong method/unknown path/unregistered route;
- `--no-unfurl` removes `/unfurl` and `/upload-by-url`;
- no storage removes both upload routes;
- allowed/disallowed/missing Origin in all three auth modes;
- anonymous OPTIONS response headers and no limiter cost;
- fixed compatible ticket, missing/invalid/expired/tampered tokens;
- default ticket rate of 60 and explicit small limits;
- invalid auth/listen/secret/origin/S3 startup exits and help/flag exit codes.

- [ ] **Step 2: Run against Go and observe every newly characterized mismatch**

Run: `node scripts/test-server-conformance.mjs --target go`

Expected: new cases initially fail where the harness expectation or exact wire observation has not been encoded.

- [ ] **Step 3: Record Go’s observed contract**

Keep compatibility assertions for existing behavior. Mark intentionally stronger future C# fetch behavior in security tests rather than changing unrelated wire responses.

- [ ] **Step 4: Run green**

Run: `node scripts/test-server-conformance.mjs --target go`

Expected: all process, route, CORS, auth, and limiter cases pass.

- [ ] **Step 5: Commit**

```bash
git add test/server-conformance
git commit -m "test(server): freeze process and middleware contract"
```

---

### Task 3: Freeze upload, local-file, unfurl, and storage wire behavior

**Files:**
- Modify: `test/server-conformance/server-contract.test.ts`
- Create: `test/server-conformance/fixture-origin.ts`
- Create: `test/server-conformance/fake-s3.ts`
- Create: `test/server-conformance/fixtures/metadata/*.html`
- Test source: Go upload/unfurl/blobstore tests under `packages/server/internal`

**Interfaces:**
- `fixture-origin` exposes deterministic success, redirect, oversized, delayed, and error endpoints.
- `fake-s3` records PUT/DELETE method, path, headers, body, and configurable status.

- [ ] **Step 1: Add red multipart/local-file cases**

Pin:
- field name `file`;
- response `url`, optional `fileName`, `size`, `mimeType`;
- total multipart size cap and zero-cap startup refusal;
- malformed/missing multipart errors;
- basename normalization for slash/backslash;
- generated 32-lowercase-hex key with safe extension;
- stored bytes;
- no directory listing;
- `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff` on file responses.

- [ ] **Step 2: Add red unfurl/upload-by-url cases**

Pin:
- exact `success: 0` behavior and status distinction;
- final redirect URL;
- metadata precedence and relative URL resolution;
- `meta.image` object shape;
- final-path filename, MIME, body size;
- upstream non-2xx/fetch/store failures;
- JSON envelope limit and malformed bodies.

- [ ] **Step 3: Run against Go, correct observations, and reach green**

Run: `node scripts/test-server-conformance.mjs --target go`

- [ ] **Step 4: Add fake-S3 process cases**

Assert known content length, SigV4 headers, addressing mode, returned public URL, and HTTP 502 on configured S3 failure.

- [ ] **Step 5: Commit**

```bash
git add test/server-conformance
git commit -m "test(server): freeze upload and unfurl contract"
```

---

### Task 4: Create the .NET solution, shared contracts, and public registration shell

**Files:**
- Create: `packages/server/dotnet/Blok.Server.slnx`
- Create: `packages/server/dotnet/Blok.Server.AspNetCore/Blok.Server.AspNetCore.csproj`
- Create: `packages/server/dotnet/Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj`
- Create: `packages/server/dotnet/Blok.Server.Host/Blok.Server.Host.csproj`
- Create: `packages/server/dotnet/Blok.Server.Host.Tests/Blok.Server.Host.Tests.csproj`
- Modify: `packages/server/dotnet/Blok.Server/Blok.Server.csproj`
- Create: builder/registration/options source files in the new projects.

**Interfaces:**

```csharp
public static BlokServerBuilder AddBlokServer(this IServiceCollection services);
public static BlokServerBuilder UseAuthorization<T>(this BlokServerBuilder builder)
  where T : class, IBlokAuthorization;
public static RouteGroupBuilder MapBlokServer(
  this IEndpointRouteBuilder endpoints,
  string pattern = "");

public interface IBlokAuthorization
{
  ValueTask<bool> CanReadDocumentAsync(
      ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default);
  ValueTask<bool> CanWriteDocumentAsync(
      ClaimsPrincipal user, string documentId, CancellationToken cancellationToken = default);
}
```

- [ ] **Step 1: Write red registration tests**

Assert one call registers the runtime/services, custom authorization replaces the deny-by-default implementation, and `MapBlokServer` returns a route group.

- [ ] **Step 2: Run red**

Run: `dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj`

Expected: FAIL because project/types do not exist.

- [ ] **Step 3: Create minimal projects and registration**

Use `Microsoft.NET.Sdk` + `FrameworkReference Microsoft.AspNetCore.App`; tests use current xUnit packages and `Microsoft.AspNetCore.TestHost` 10.0.0. Keep host `IsPackable=false`.

- [ ] **Step 4: Run green and format**

```bash
dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj
dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes
```

- [ ] **Step 5: Commit**

```bash
git add packages/server/dotnet
git commit -m "feat(server): add shared ASP.NET package shell"
```

---

### Task 5: Port health, route registration, and standalone configuration

**Files:**
- Create: ASP.NET endpoint/options files under `Blok.Server.AspNetCore`
- Create: `Blok.Server.Host/Program.cs`
- Create: host parser/validation files
- Test: ASP.NET endpoint tests and host process tests

**Interfaces:**
- Host preserves flags `--listen`, `--auth`, `--secret`, `--allow-origin`, `--storage-dir`, `--public-url`, `--max-upload`, `--rate-limit`, `--no-unfurl`, and S3 flags.
- Host preserves `BLOK_SECRET`, `BLOK_S3_ACCESS_KEY`, and `BLOK_S3_SECRET_KEY`.

- [ ] **Step 1: Write red TestServer health/registration tests**
- [ ] **Step 2: Write red process tests for defaults, flag/env precedence, validation, exit codes, and version**
- [ ] **Step 3: Implement options validation, health mapping, conditional route mapping, and host parsing**
- [ ] **Step 4: Run C# tests and the same conformance subset against C#**
- [ ] **Step 5: Commit with `feat(server): add the standalone C# host`**

---

### Task 6: Port ticket verification, CORS, auth ordering, and fixed-window limiting

**Files:**
- Create: ticket verifier in `Blok.Server`
- Create: guard/preflight/limiter code in `Blok.Server.AspNetCore`
- Test: focused ticket vectors plus TestServer middleware ordering

**Interfaces:**
- Fixed raw-base64url header `{"alg":"HS256","typ":"JWT"}`.
- HMAC-SHA256 claims `user`, `doc`, `write`, `exp`.
- Exact `Bearer ` prefix; Origin settles before auth; limiter follows auth; preflight bypasses both.

- [ ] **Step 1: Port fixed and malformed token vectors as red xUnit tests**
- [ ] **Step 2: Implement the minimum verifier and run green**
- [ ] **Step 3: Add red CORS/preflight/auth/limit TestServer cases**
- [ ] **Step 4: Implement ordering and fixed one-minute buckets**
- [ ] **Step 5: Run C# and black-box middleware suites green**
- [ ] **Step 6: Commit with `feat(server): port ticket and request guards`**

---

### Task 7: Port blob naming and local storage

**Files:**
- Create: internal blob contracts, key parser, and local store in `Blok.Server`
- Create: local-file mapping in `Blok.Server.AspNetCore`
- Test: unit filesystem tests, TestServer file tests, black-box local-storage suite

**Interfaces:**
- Key: 16 random bytes → 32 lowercase hex + optional 1–15 ASCII alphanumeric lower-case extension.
- Put uses destination-directory temp file, flush, permissions, atomic move.
- Delete accepts only directly owned public URLs and is idempotent.

- [ ] **Step 1: Add red naming/ownership/atomic/delete tests**
- [ ] **Step 2: Implement local store and run green**
- [ ] **Step 3: Add red mapped-file header/listing tests**
- [ ] **Step 4: Implement secure file mapping and run C# + black-box local suite**
- [ ] **Step 5: Commit with `feat(server): port local blob storage`**

---

### Task 8: Port multipart upload

**Files:**
- Create: upload endpoint/response types under `Blok.Server.AspNetCore`
- Test: TestServer multipart limits/errors plus conformance upload cases

**Interfaces:**
- `POST /upload`, field `file`, total body cap, exact response shape and status/error mapping.

- [ ] **Step 1: Add red TestServer cases matching conformance fixtures**
- [ ] **Step 2: Implement streaming multipart handling with bounded body and temp cleanup**
- [ ] **Step 3: Run C# tests and black-box upload suite**
- [ ] **Step 4: Commit with `feat(server): port multipart uploads`**

---

### Task 9: Port S3 storage and SigV4

**Files:**
- Create: S3 options, target resolver, signer, and store in `Blok.Server`
- Test: fake-S3 unit/integration tests and process conformance cases

**Interfaces:**
- Supports configured endpoint/region/bucket/public URL/addressing.
- Credentials only from configuration populated by the host environment.
- PUT/DELETE sign known-length SHA-256 payload; nonseekable bodies spool to temp storage.

- [ ] **Step 1: Port target/addressing/signature vectors as red xUnit tests**
- [ ] **Step 2: Implement minimal S3 store with one configured-endpoint client**
- [ ] **Step 3: Add and pass spool/cleanup/error truncation tests**
- [ ] **Step 4: Run fake-S3 black-box suite**
- [ ] **Step 5: Commit with `feat(server): port S3 blob storage`**

---

### Task 10: Implement the guarded outbound client

**Files:**
- Create: URL/address policy, DNS resolver seam, connect callback, redirect loop, and bounded response reader in `Blok.Server`
- Create: static outbound-client architecture test
- Test: deterministic resolver/dialer fixtures for IPv4/IPv6, redirects, DNS rebinding, Host, and SNI

**Interfaces:**

```csharp
internal interface IGuardedOutboundFetcher
{
  ValueTask<GuardedResponse> GetAsync(
      string rawUrl,
      GuardedFetchLimits limits,
      CancellationToken cancellationToken);
}
```

- [ ] **Step 1: Add red URL/scheme/credential/port/address classification tests**
- [ ] **Step 2: Implement the minimum policy and run green**
- [ ] **Step 3: Add red exact-connect and DNS-rebinding tests**
- [ ] **Step 4: Implement `SocketsHttpHandler.ConnectCallback` address pinning while preserving Host/SNI**
- [ ] **Step 5: Add red per-hop redirect, size, timeout, and cancellation tests**
- [ ] **Step 6: Implement manual redirects and bounded streaming**
- [ ] **Step 7: Add static source law forbidding consumer-URL clients elsewhere, with only the S3 exemption**
- [ ] **Step 8: Run the independent security suite and commit with `feat(server): add guarded outbound fetching`**

---

### Task 11: Port metadata parsing and `/unfurl`

**Files:**
- Add AngleSharp to `Blok.Server.csproj`
- Create metadata parser in `Blok.Server`
- Create unfurl endpoint in `Blok.Server.AspNetCore`
- Test: extracted HTML corpus, TestServer endpoint tests, black-box unfurl suite

**Interfaces:**
- Parser precedence and URL resolution match frozen fixtures.
- `GET /unfurl` maps missing URL to 400, fetch/non-2xx failures to HTTP 200 `{"success":0}`, and success to the existing nested meta shape.

- [ ] **Step 1: Port metadata corpus as red xUnit theories**
- [ ] **Step 2: Implement parser and run green**
- [ ] **Step 3: Add red endpoint cases**
- [ ] **Step 4: Implement endpoint through the sole guard**
- [ ] **Step 5: Run black-box unfurl suite and commit with `feat(server): port link unfurling`**

---

### Task 12: Port `/upload-by-url`

**Files:**
- Create endpoint in `Blok.Server.AspNetCore`
- Test: TestServer and black-box cases

**Interfaces:**
- 8 KiB JSON envelope, guarded media limits, final-URL filename, sanitized media type, every upstream 2xx accepted, same upload response.

- [ ] **Step 1: Add red envelope/fetch/status/store/final-name/MIME cases**
- [ ] **Step 2: Implement through `IGuardedOutboundFetcher` and the shared blob store**
- [ ] **Step 3: Run C# and black-box upload-by-url suites**
- [ ] **Step 4: Commit with `feat(server): port remote uploads`**

---

### Task 13: Prove NuGet and host use the same implementation

**Files:**
- Add NuGet metadata to three library projects as applicable; host remains non-packable
- Create: `test/fixtures/dotnet-server-consumer/`
- Create: packed-resource and minimal-consumer tests
- Modify: CI server job

**Interfaces:**
- Pack IDs `Blok.Server` and `Blok.Server.AspNetCore` now; MySQL package remains outside this Go-removal scope until it has real functionality.
- A fixture installs local packages, calls `AddBlokServer()` and `MapBlokServer()`, and passes the shared endpoint tests.

- [ ] **Step 1: Add red `dotnet pack` consumer test**
- [ ] **Step 2: Add package metadata and pack local packages**
- [ ] **Step 3: Run fixture against packed NuGet and self-contained host**
- [ ] **Step 4: Add embedded-resource drift assertion**
- [ ] **Step 5: Commit with `build(server): prove NuGet package consumption`**

---

### Task 14: Publish compatible self-contained artifacts

**Files:**
- Create: `scripts/publish-server.mjs`
- Create: `test/unit/scripts/publish-server.test.ts`
- Modify: `packages/server/bin/blok-server.mjs`
- Modify: `test/unit/server/bin.test.ts`

**Interfaces:**
- Preserve assets:
  - `blok-server_darwin_amd64.tar.gz` → `osx-x64`
  - `blok-server_darwin_arm64.tar.gz` → `osx-arm64`
  - `blok-server_linux_amd64.tar.gz` → `linux-x64`
  - `blok-server_linux_arm64.tar.gz` → `linux-arm64`
  - `blok-server_windows_amd64.zip` → `win-x64`
  - `blok-server_windows_arm64.zip` → `win-arm64`
- Each archive contains one self-contained single-file `blok-server` or `blok-server.exe`.
- `checksums.txt` retains the current checksum format.

- [ ] **Step 1: Add red RID/name/archive/checksum tests**
- [ ] **Step 2: Implement single-file self-contained publish and deterministic archive assembly**
- [ ] **Step 3: Expand wrapper tests to checksum, extract, cache, execute, and recover from partial installs**
- [ ] **Step 4: Run native host smoke and wrapper tests**
- [ ] **Step 5: Commit with `build(server): publish C# host artifacts`**

---

### Task 15: Switch Docker, release, CI, and documentation

**Files:**
- Replace: `packages/server/Dockerfile`
- Rewrite: `.github/workflows/release-server.yml`
- Modify: `.github/workflows/ci.yml`
- Rewrite: `test/unit/architecture/server-release-wiring.test.ts`
- Modify: `test/unit/architecture/ci-critical-path-law.test.ts`
- Modify: `packages/server/package.json`, `packages/server/README.md`, release scripts, changelog, and current plan/docs references

**Interfaces:**
- Docker image remains `ghcr.io/jackuait/blok-server`.
- Docker build uses repository root context because the embedded bundle build needs root TypeScript and Node dependencies.
- Tag builds publish NuGet packages, six archives, checksums, and the image before docs can advertise them.
- CI retains Node, Go, and .NET plus both conformance targets through Task 16; Task 17 removes Go.

- [ ] **Step 1: Rewrite architecture tests first and run them red**
- [ ] **Step 2: Replace Dockerfile with Node-build + dotnet-publish/runtime stages**
- [ ] **Step 3: Rewrite release workflow around `dotnet pack`, `publish-server.mjs`, artifact upload, image build, and smoke tests**
- [ ] **Step 4: Update npm metadata/docs/changelog and docs release verification**
- [ ] **Step 5: Run Docker health/config/routes smoke, packed NuGet fixture, artifact/native smoke, wrapper tests, and architecture tests**
- [ ] **Step 6: Commit with `build(server): switch delivery to C#`**

---

### Task 16: Run the removal gate against both implementations — complete

**Files:**
- Modify only tests/implementation defects discovered by the gate.
- Record no waived failures.

- [x] **Step 1: Run all focused C# tests**

```bash
dotnet test packages/server/dotnet/Blok.Server.slnx
dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes
```

- [x] **Step 2: Run the exact same black-box suite against Go and C#**

```bash
node scripts/test-server-conformance.mjs --target go
node scripts/test-server-conformance.mjs --target csharp
```

- [x] **Step 3: Run delivery gates**

```bash
node scripts/publish-server.mjs --version "$(node -p "require('./package.json').version")" --dry-run
yarn vitest run --project=unit   test/unit/server/bin.test.ts   test/unit/scripts/publish-server.test.ts   test/unit/architecture/server-release-wiring.test.ts   test/unit/architecture/ci-critical-path-law.test.ts
docker build --platform linux/amd64 -f packages/server/Dockerfile --build-arg BLOK_SERVER_VERSION=1.10.1 .
```

- [x] **Step 4: Run security review cases**

Require green deterministic tests for private/loopback/metadata IPv4 and IPv6, mixed DNS results, DNS rebinding, redirect-to-private, redirect-to-credentials, disallowed ports, exact address pinning, Host/SNI, size, timeout, and cancellation.

- [x] **Step 5: Confirm no public release points at Go assets**

Inspect release workflow, wrapper mapping, Dockerfile, docs release gates, and current changelog. Do not delete Go until every step is green.

---

### Task 17: Delete Go in one change — complete

**Files:**
- Delete: `packages/server/cmd/`
- Delete: `packages/server/internal/`
- Delete: `packages/server/go.mod`
- Delete: `packages/server/go.sum`
- Delete: `.goreleaser.yaml`
- Remove Go setup/tests/references from CI/release/current docs and `.gitignore`
- Update conformance script so normal runs target C#; retain language-neutral contract tests.

- [x] **Step 1: Add/red-update static removal laws**

Assert no tracked `.go`, `go.mod`, `go.sum`, GoReleaser config, `setup-go`, `go test`, or Go artifact builder remains outside explicitly historical plan documents.

- [x] **Step 2: Delete all Go implementation/build files and update wiring**
- [x] **Step 3: Run removal law, all C# tests, black-box C# suite, Docker/artifact/wrapper gates**
- [x] **Step 4: Update active design status to C# only**
- [x] **Step 5: Commit with `refactor(server): remove the Go implementation`**

---

### Task 18: Final repository verification and publish

**Files:** all files changed by Tasks 1–17.

- [x] **Step 1: Review session diff for dead compatibility layers, duplicate handlers, unsafe clients, and stale Go references**
- [x] **Step 2: Run production build**
- [x] **Step 3: Run full unit suite sequentially after build**
- [x] **Step 4: Run all .NET, conformance, NuGet, self-contained, Docker, wrapper, and architecture gates**
- [x] **Step 5: Run ESLint only on changed TS/JS files and `git diff --check`**
- [x] **Step 6: Commit any verified cleanup**
- [x] **Step 7: `git pull --rebase`, `git push origin main`, and verify `HEAD == origin/main` with a clean status**

## Removal completion checklist

Go removal is complete only when:

- no tracked active Go implementation/build file remains;
- the C# unit/integration suite passes;
- the black-box contract passes against C#;
- deterministic guarded-fetch security tests pass;
- packed NuGet works in a minimal .NET 10 consumer;
- all six self-contained artifact mappings/checksums are produced and native smoke coverage is present;
- Docker and npm wrapper run the C# host;
- CI/release/docs refer only to C# delivery;
- full repository gates pass;
- `main` is pushed and matches `origin/main`.
