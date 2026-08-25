# Task 15 Report

## Status

Implemented Task 15 on `main`. Public server delivery now points to the shared C# implementation. Go remains only as the transition oracle in CI and conformance; Task 17 still owns its deletion. No release, package, asset, image, tag, push, or other external publication was performed.

## TDD evidence

The focused release/CI/docs-verification/release CLI tests were updated first and failed on the missing draft seam, C# delivery gates, NuGet/assets/GHCR verification, Docker stages, and metadata. The focused docs tests then failed on the missing ASP.NET path and C# grammar. Additional focused red slices pinned the produced-package fixture arguments, root Docker context exclusions, container route smoke, and workspace manifests required by Yarn's immutable install.

Minimal implementation followed each red slice. Final focused results:

- Task 15 root tests: 7 files, 110 tests passed.
- Server docs tests: 4 files, 28 tests passed.
- Task 13 packed-consumer proof: passed, including package metadata, DLL identity, consumer endpoints, and native host probe.
- Task 14 publisher dry-run: all six archive targets and checksums planned; native host plus npm cached-wrapper `--help` smoke passed.

## Delivery changes

- `scripts/release.mjs` creates a draft GitHub release after the tag push.
- The tag workflow waits for the draft, tests/formats C#, packs and validates both NuGets, builds and smokes six native archives, publishes NuGet/assets and the linux/amd64 GHCR image, waits until every output is observable, then publishes the draft.
- `NUGET_API_KEY` is the only NuGet secret used.
- Transition CI retains Go 1.25, Go vet/tests, and both Go/C# conformance targets while adding the full .NET, package, artifact, and delivery gates.
- The root-context Docker build uses Node 24, the .NET 10 SDK, and the official .NET 10 `runtime-deps` final image. The final image is linux/amd64.
- npm metadata, README, docs, design status, release verification, and the current changelog describe C# delivery. MySQL/database-block integration is explicitly later and is not advertised as available.

## Verification

Passed:

- focused Task 15 Vitest suite: 110/110
- focused docs Vitest suite: 28/28
- Task 13 package proof
- Task 14 dry-run and native npm-wrapper smoke
- `dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes`
- changed-root-file ESLint
- real linux/amd64 Docker build
- unsafe public configuration refusal
- authenticated container routes: health `200` with version `1.10.1`, unfurl `400`, disabled upload `404`, missing route `404`
- full C# solution with built outputs via `dotnet test ... --no-build`: 428/428

## Concern

On this macOS runner, the binding build-and-test command `dotnet test packages/server/dotnet/Blok.Server.slnx --configuration Release` runs project builds and test assemblies concurrently and repeatedly tripped two unchanged timing-sensitive `GuardedOutboundFetcherTests`. The same core assembly passed 272/272 alone, and the full solution passed 428/428 with `--no-build`. The failing source and tests were clean before Task 15; no unrelated timing-test change was included.
