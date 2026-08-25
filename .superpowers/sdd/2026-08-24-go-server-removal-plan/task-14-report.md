# Task 14 report — compatible C# host artifacts

Date: 2026-08-25
Base commit: `52aa06e6`
Commit: `build(server): publish C# host artifacts`

## Result

Task 14 adds a dependency-free release publisher for six self-contained, single-file C# host targets while preserving the existing npm wrapper protocol.

The exact external mapping is:

| Node target | .NET RID | Archive | Root executable |
|---|---|---|---|
| `darwin/x64` | `osx-x64` | `blok-server_darwin_amd64.tar.gz` | `blok-server` |
| `darwin/arm64` | `osx-arm64` | `blok-server_darwin_arm64.tar.gz` | `blok-server` |
| `linux/x64` | `linux-x64` | `blok-server_linux_amd64.tar.gz` | `blok-server` |
| `linux/arm64` | `linux-arm64` | `blok-server_linux_arm64.tar.gz` | `blok-server` |
| `win32/x64` | `win-x64` | `blok-server_windows_amd64.zip` | `blok-server.exe` |
| `win32/arm64` | `win-arm64` | `blok-server_windows_arm64.zip` | `blok-server.exe` |

`scripts/publish-server.mjs` parses `--version`, optional `--output`, and `--dry-run`; constructs the required `dotnet publish` invocation; creates deterministic one-file ustar/gzip or ZIP archives; and writes sorted lowercase SHA-256 lines with two spaces and a trailing newline. Its default output is the ignored `.server-release-dist/` directory.

The Host project now emits `BlokServerVersion` as assembly metadata, defaulting to `dev`. `Program.cs` reads that metadata into the existing options object. The release-only `AssemblyName=blok-server` property is removed from the referenced AspNetCore project graph so it cannot rename friend assemblies.

The npm wrapper keeps the GitHub URL, cache layout, archive and executable names, checksum verification, extraction, execution protocol, and `ghcr.io/jackuait/blok-server` fallback image unchanged. Its target result now also carries the matching .NET RID, and its exported install seam supports focused download/extract/recovery tests.

## TDD evidence

The JavaScript and TypeScript tests were written before the publisher or wrapper changes.

Red commands:

```bash
yarn vitest run --project=unit test/unit/scripts/publish-server.test.ts
yarn vitest run --project=unit test/unit/server/bin.test.ts
```

Both were red at the intended missing publisher boundary: `scripts/publish-server.mjs` did not exist.

The build-version process test was added before the metadata seam. Its first run failed with the exact mismatch:

```text
Expected: {"status":"ok","version":"1.2.3"}
Actual:   {"status":"ok","version":"dev"}
```

After the metadata seam passed, the process test was tightened to include the required `-p:AssemblyName=blok-server` release property. That red exposed global-property propagation into `Blok.Server`: `GuardedFetchLimits` became inaccessible because the referenced assembly was renamed. Adding `GlobalPropertiesToRemove="AssemblyName"` to the Host project reference made the exact release publish pass without changing library assembly identities.

## Focused verification

| Command or probe | Result |
|---|---|
| publisher + wrapper Vitest files | 38 passed, 0 failed |
| `Blok.Server.Host.Tests` project | 29 passed, 0 failed |
| publisher dry run | six publish operations and six archive operations; no output directory |
| real six-RID cross-publish | exit 0; no emulators |
| real archive/checksum inspection | six SHA-256 checks passed; every archive contains exactly its one root executable |
| native `darwin/arm64` executable `--help` | exit 0 with the expected usage |
| native exact health/version | `{"status":"ok","version":"1.11.0"}\n` |
| npm wrapper cache smoke with the native C# artifact | exit 0 |
| changed-file ESLint | exit 0 |
| scoped C# format and `--verify-no-changes` | exit 0 |
| Task 14 `git diff --check` | exit 0 |

## Scope

No dependency, root `package.json`, `yarn.lock`, protected configuration, public delivery workflow, public documentation, branch, worktree, detached checkout, stash, pull, push, or emulator was added or used.

Release artifacts were produced only under temporary directories for verification and are not committed.

## Concerns

Unrelated working-tree changes from another active session appeared during verification. Task 14 uses explicit staging and commit pathspecs so none of that work is included. The protected untracked paths named in the dispatch were never opened or staged by this task.
