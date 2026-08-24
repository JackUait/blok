# Task 13 report — packed NuGet/Host identity

Date: 2026-08-25
Base commit: `c933b116`
Commit: `build(server): prove NuGet package consumption`

## Result

Task 13 ships exactly two locally verified NuGet packages:

- `Blok.Server`
- `Blok.Server.AspNetCore`

`Blok.Server.Host` remains non-packable and keeps its existing project reference to `Blok.Server.AspNetCore`. The AspNetCore package keeps its existing project reference to `Blok.Server`; packing emits the matching package dependency without a second `PackageReference`.

The isolated consumer references only `Blok.Server.AspNetCore`. Its restore proves that both Blok libraries came from the temporary package feed as packages, that `Blok.Server` is transitive, and that no project reference entered the consumer graph.

## TDD evidence

### Package/consumer cycle

The fixture and `scripts/test-server-packages.mjs` assertions were created before either library project received package metadata.

Red command:

```bash
node scripts/test-server-packages.mjs
```

The packed nuspec assertion failed at the intended missing metadata boundary: `Blok.Server` carried the default author `Blok.Server` instead of `JackUait`.

Only the binding metadata was then added to the two library projects. The same command passed after the harness aligned its exact project URL assertion with NuGet's canonical packed form, `https://blokeditor.com/`.

The green package test proves:

- the feed contains exactly `Blok.Server.0.0.0-task13.nupkg` and `Blok.Server.AspNetCore.0.0.0-task13.nupkg`;
- exact IDs, supplied version, authors, descriptions, Apache-2.0 license expression, project URL, and repository metadata;
- the AspNetCore package has exactly one direct Blok-family dependency, `Blok.Server` at `0.0.0-task13`;
- both packages contain their own `lib/net10.0` DLL;
- both packed DLLs are byte-identical to the corresponding DLLs copied into the ordinary Release Host build;
- the isolated consumer restores AspNetCore directly and Server transitively from the temporary feed with no project references;
- the package-restored `Blok.Server` resource hash matches a fresh worker-condition TypeScript runtime build;
- one shared endpoint probe passes against the package consumer under `/api/blok` and the self-contained single-file Host at root;
- the shared probes cover GET and HEAD health, exact health 405, malformed unfurl, absent upload, and unknown-route wires.

### CI-law cycle

The exact server-job expectation was updated before the workflow.

Red command:

```bash
yarn vitest run --project=unit test/unit/architecture/ci-critical-path-law.test.ts -t "retains the exact server transition job contract"
```

The test failed because the workflow lacked the expected `Test packed .NET packages` step.

After adding only that step after `Test .NET runtime`, the same command passed: 1 passed, 10 skipped.

## Focused verification

| Command | Result |
|---|---|
| `node scripts/test-server-packages.mjs` | exit 0; pack, exact nuspec/feed, isolated restore, resource/DLL identity, shared endpoint, and self-contained Host checks passed |
| focused CI server-job law | 1 passed, 0 failed, 10 skipped |
| `JintBlokRuntimeTests` filter | 6 passed, 0 failed |
| `BlokServerRegistrationTests` filter | 12 passed, 0 failed |
| `StartsWithDefaultsAndReportsTheDevelopmentVersion` filter | 1 passed, 0 failed |
| changed-file ESLint | exit 0 |
| `git diff --check` | exit 0 |

NuGet reports its standard missing-readme authoring warning while packing. A package README is deliberately excluded by the binding Task 13 scope.

## Changed files

Created:

- `scripts/test-server-packages.mjs`
- `test/fixtures/dotnet-server-consumer/Blok.Server.Consumer.csproj`
- `test/fixtures/dotnet-server-consumer/Program.cs`
- `.superpowers/sdd/2026-08-24-go-server-removal-plan/task-13-report.md`

Modified:

- `packages/server/dotnet/Blok.Server/Blok.Server.csproj`
- `packages/server/dotnet/Blok.Server.AspNetCore/Blok.Server.AspNetCore.csproj`
- `.github/workflows/ci.yml`
- `test/unit/architecture/ci-critical-path-law.test.ts`

No Host source/project, MySQL package, project-reference graph, protected configuration, package dependency, public runtime API, solution membership, committed NuGet configuration, branch, worktree, detached checkout, stash, pull, or push changed in this task.

## Commit

The required local commit message is:

```text
build(server): prove NuGet package consumption
```

The commit includes the trailer:

```text
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Concerns

None.
