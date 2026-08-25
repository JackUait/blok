# Task 18 final-review fix report

## Scope

Implemented every verified finding in `task-18-adjudication.md` and no rejected or speculative item.

The work started from `7097b517` on `main`. Concurrent documentation commits advanced the shared parent to `315596d3`; this work remained limited to the owned server, server-docs, packed-consumer, and removal-law paths. No Go source or module was restored. The protected root package/configuration files, `src/tools/code/index.ts`, and `test/fixtures/ai-chat/**` were not changed.

## Implemented findings

1. **IPv6 site-local SSRF block**
   - Added `fec0::/10` to the existing guarded outbound policy.
   - Added literal, DNS-only, and mixed-answer coverage proving rejection before socket connection.

2. **Safe package defaults and application authorization**
   - In-process defaults now disable local storage and unfurling.
   - The standalone Host explicitly restores its legacy storage and unfurl defaults.
   - Guarded routes use the consuming ASP.NET application's authorization policy.
   - Health and CORS preflight endpoints are anonymous.
   - `IBlokAuthorization` remains document/database-scoped and is not called for upload or unfurl.
   - README, docs-site sample, and packed consumer use `MapBlokServer("/api/blok").RequireAuthorization()`.
   - Local storage requires an explicit valid `PublicUrl`.

3. **Owner-only live spools**
   - The multipart endpoint spool and `LocalBlobStore` temporary output use Unix mode `0600`.
   - Existing async, sharing, cleanup, and final served-file `0644` behavior is preserved.

4. **Host-only absolute deadlines**
   - Kestrel uses a 10-second request-header timeout and a 2-minute keep-alive timeout.
   - The Host applies a 10-minute absolute request timeout through the framework timeout middleware.
   - The timeout composition is internal; no environment bypass, public flag, or shared-package setting was added.
   - Release tests use the same internal composition with short deadlines and observe stalled-body and blocked-storage cancellation.

5. **Multipart section limit**
   - Every multipart section is counted.
   - Exactly 1,000 sections are accepted; section 1,001 returns the existing malformed-upload 400 before storage and cleans the spool.

6. **Frozen local-file preconditions**
   - Representation preconditions now run before Range in the frozen order:
     `If-Match` or `If-Unmodified-Since`, then `If-None-Match` or `If-Modified-Since`.
   - The existing custom single- and multi-range implementation remains intact.

7. **Zero suffix range**
   - `bytes=-0` is non-overlapping instead of producing an invalid partial representation.
   - GET, HEAD, nonempty, and empty-file cases are covered.

8. **Local public URL startup validation**
   - Active local storage validates its relative-or-absolute `PublicUrl` once before binding.
   - Malformed percent escapes are rejected.
   - The validated path is reused for local-file mapping.
   - Disabled local storage and S3 precedence ignore unused local URL values.

9. **Frozen base-zero integer grammar**
   - `--max-upload` and `--rate-limit` use one checked private signed 64-bit base-zero parser.
   - Decimal, sign, legacy and `0o` octal, hexadecimal, binary, underscores, invalid digits, and overflow are pinned.
   - `040000000` is 8 MiB and `010` rejects request nine.
   - Rate-limit configuration and window counters are signed `long`.
   - Parse errors remain exit 2; validation errors remain exit 1.

10. **Go-command removal law**
    - The scan is whitespace-aware and covers build, test, vet, run, install, and generate.
    - Multiple spaces, tabs, and versioned `go run` are mutation-tested.
    - The only historical exception remains Markdown under `docs/plans/`.
    - Every mutation restores its fixture in `finally`.

## RED to GREEN evidence

| Finding | RED observed | GREEN evidence |
| --- | --- | --- |
| IPv6 site-local | `fec0::1` and site-local DNS answers were allowed | Guarded policy/fetcher project passed; final `Blok.Server.Tests` 276/276 |
| Safe defaults/auth | Bare defaults mapped unfurl; group authorization blocked health; package probe did not enforce app auth | Registration tests and packed consumer passed with anonymous 401, authenticated handler access, anonymous health/preflight |
| Private spools | Both live Unix spools were `0644` | Both blocking-spool mode tests passed at `0600` |
| Host deadlines | A stalled body received no 504; blocked storage exceeded the client timeout | Release deadline tests 2/2; Host suite 47/47; final Release solution green |
| Section limit | 1,001 multipart sections returned 200 | Boundary test accepts 1,000 and rejects 1,001 before storage |
| Preconditions | Six date/ETag/Range cases ignored preconditions | All six focused cases and the 142-test ASP.NET project passed |
| Zero suffix | Four GET/HEAD cases produced invalid 206 responses | All four focused cases and the ASP.NET project passed |
| Public URL | Validation did not throw and malformed Host startup did not exit | Registration and pre-bind Host process regressions passed |
| Base-zero grammar | Hex, binary, `0o`, underscores, signed validation, octal boundaries, and wide rate limit failed | Full Host suite passed 47/47 |
| Removal law | Controlled mutations for whitespace and additional commands were missed | Mutation test passed; final removal/release laws passed 115 tests |

The first full Release solution run exposed a test-only scheduling bound: the original 200 ms blocked-storage deadline could expire before the test listener observed the outbound connection under parallel solution load. The production 10-minute value was unchanged. The internal test deadline was raised to 2 seconds and observation bounds to 5 seconds. The focused Release deadline tests then passed 2/2 and the complete Release solution passed.

## Final verification

### Direct C# projects and Host

- `dotnet test packages/server/dotnet/Blok.Server.Tests/Blok.Server.Tests.csproj --no-restore`
  - 276 passed, 0 failed.
- `dotnet test packages/server/dotnet/Blok.Server.AspNetCore.Tests/Blok.Server.AspNetCore.Tests.csproj --configuration Release --no-restore`
  - 142 passed, 0 failed.
- `dotnet test packages/server/dotnet/Blok.Server.Host.Tests/Blok.Server.Host.Tests.csproj --configuration Release --no-restore`
  - 47 passed, 0 failed.
- Focused Release Host deadline rerun:
  - 2 passed, 0 failed.

### Package and process contracts

- `node scripts/test-server-packages.mjs`
  - Exit 0. Both NuGets, the authenticated packed consumer, anonymous health/preflight, and native Host parity passed.
- `node scripts/test-server-conformance.mjs --target csharp`
  - 58 passed, 0 failed.

### Removal, release, and docs

- Focused removal/release architecture command:
  - 8 files passed, 1 intentionally skipped.
  - 115 tests passed, 58 conformance tests intentionally skipped because that command does not set `BLOK_CONFORMANCE_SERVER`.
- `yarn --cwd docs test src/components/server/server-data.test.ts`
  - 11 passed, 0 failed.
- Scoped docs source type-check:
  - Exit 0.

### Final solution and hygiene

- `dotnet test packages/server/dotnet/Blok.Server.slnx --configuration Release`
  - `Blok.Server.Tests`: 276/276.
  - `Blok.Server.AspNetCore.Tests`: 142/142.
  - `Blok.Server.Host.Tests`: 47/47.
  - Total: 465 passed, 0 failed.
- `dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes --no-restore`
  - Exit 0.
- Packed-consumer C# format verification:
  - Exit 0.
- ESLint on changed root JS/TS:
  - Exit 0.
- `git diff --check`:
  - Clean.

The standard Storybook annotation notice and NuGet missing-readme warnings remained non-failing and unrelated.

## Commit and repository handling

The owned work is committed once with:

`fix(server): close final removal review`

and trailer:

`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

No pull, push, branch, worktree, stash, reset, detached HEAD, Go restoration, or unrelated cleanup was performed, as required.
