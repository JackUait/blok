# Task 18 follow-up fix report

## Scope

Implemented only the five verified findings in `task-18-additional-adjudication.md` on existing `main` at `bbd8ae03`. The rejected musl and CLI-wait items were not changed. No branch, worktree, stash, reset, pull, push, protected root configuration, or unrelated file was used.

## Implemented findings

1. **Non-default NuGet version proof**
   - The packed-consumer fixture now defaults `BlokServerPackageVersion` to `0.0.0-task13` and uses it for its direct `Blok.Server.AspNetCore` reference.
   - The package proof passes the selected version property to both consumer restore and build.
   - The fixture still directly references only `Blok.Server.AspNetCore`; `Blok.Server` is verified as its transitive dependency.

2. **Explicit tagged docs deployment**
   - The server release job now has `actions: write` and dispatches `deploy-docs.yml` with `release_tag` after publishing the draft release.
   - The docs workflow accepts an optional dispatch tag, verifies that tag, and checks it out for docs tests and build.
   - Published-release, ordinary manual, and docs-push behavior remains unchanged.

3. **Stable-only GHCR latest tag**
   - Every release builds and pushes its immutable version tag.
   - The `latest` build and push happen only when the version has no prerelease suffix.

4. **Bounded unsafe-config image smoke**
   - The unsafe Docker invocation is bounded by `timeout 10s`.
   - A zero exit, timeout exit, or any output other than the exact unsafe-listen refusal fails the release job.

5. **Generated-key-only local file mapping**
   - The local endpoint reuses `BlobKey`'s existing generated-key grammar before opening a file.
   - Arbitrary direct files such as `.env` and `config.json` return the existing 404 wire response.
   - Existing generated keys, extensions, ranges, and traversal rejection remain covered by the full ASP.NET project.

## RED to GREEN evidence

| Finding | RED observed | GREEN evidence |
| --- | --- | --- |
| Non-default NuGet version | `--version 0.0.0-task18-followup` failed restore with `NU1603`: the fixture requested `0.0.0-task13` while only the follow-up packages existed | The same end-to-end package command exited 0; both non-default NuGets restored, the consumer built and ran, and the core package resolved transitively |
| Tagged docs deployment | Focused workflow tests reported missing dispatch input, tag selection, release verification, `actions: write`, and post-publish dispatch | Both workflow test files passed, 21/21 |
| Stable-only `latest` | Focused release wiring test found unconditional `latest` build/push | The release wiring test passed with version-tag-always and stable-only conditions |
| Bounded unsafe smoke | Focused release wiring test found no timeout, exit classification, or exact refusal check | The release wiring test passed with all three failure classes pinned |
| Local file grammar | Both arbitrary-file cases returned 200 instead of 404 | Focused regression passed 2/2; full ASP.NET project passed 144/144 |

The combined initial workflow RED run had 8 failures and 13 passes. The local-file RED run had 2 failures, each `expected 404, actual 200`.

## Final verification

- Focused workflow tests: 2 files passed, 21 tests passed.
- Focused local-file grammar regression: 2 passed.
- Non-default packed-package proof: exit 0 for `0.0.0-task18-followup`.
- Full `Blok.Server.AspNetCore.Tests`: 144 passed.
- Server removal/release law selection: 9 files passed, 1 intentionally skipped; 125 tests passed and 58 conformance cases skipped because that law command did not start a server.
- C# process conformance: 58 passed.
- Full Release solution:
  - `Blok.Server.Tests`: 276 passed.
  - `Blok.Server.AspNetCore.Tests`: 144 passed.
  - `Blok.Server.Host.Tests`: 47 passed.
  - Total: 467 passed, 0 failed.
- `dotnet format --verify-no-changes`: exit 0.
- ESLint on the three changed JS/TS files: exit 0.
- `git diff --check`: clean.
- Generated .NET `bin`, `obj`, runtime, and temporary release artifacts were removed.

The Storybook annotation notice and NuGet missing-readme warnings remained non-failing and unrelated. GitHub Actions dispatch and GHCR publication cannot be performed without a real release; their workflow structure and preserved trigger/ref behavior are covered by the focused parsed-workflow tests.

## Commit

The owned work is committed once with subject:

`fix(server): harden release completion`

and trailer:

`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
