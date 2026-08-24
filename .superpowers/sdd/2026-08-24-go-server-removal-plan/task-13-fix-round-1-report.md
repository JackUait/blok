# Task 13 fix round 1 — NuGet parity proof hardening

Date: 2026-08-25
Base commit: `1e22bdde`

## Result

The package harness now enforces the four review requirements without changing any project behavior:

- both packable library projects must declare neither `Version` nor `PackageVersion`;
- the `Blok.Server` nuspec must contain the exact direct dependencies `AngleSharp` 1.5.0, `BouncyCastle.Cryptography` 2.6.2, and `Jint` 4.16.1;
- `Blok.Server.Host` must explicitly declare `IsPackable` as `false`;
- a successful process shutdown clears its five-second fallback timer and asserts that no additional active timeout remains.

The existing exact Blok-family dependency assertion remains in place. No csproj behavior, package graph, dependency, CI workflow, protected configuration, or unrelated file changed.

## TDD evidence

Assertions were added before the timer implementation change. The package script then observed four focused red states:

1. A temporary `<Version>9.9.9</Version>` in `Blok.Server.csproj` failed with `Blok.Server must not declare Version or PackageVersion`.
2. A temporary Host `IsPackable=true` failed with `Blok.Server.Host must be explicitly non-packable`.
3. A temporary `PrivateAssets="all"` on `BouncyCastle.Cryptography` produced a package without that dependency and failed the exact core dependency assertion.
4. With the original shutdown implementation, the active-timeout assertion failed `1 !== 0`, proving the fallback timer remained alive after the child closed.

Every temporary project mutation was restored before the implementation and final verification. The minimal timer change retains the timeout handle and clears it in a `finally` around `Promise.race`.

## Focused verification

| Command | Result |
|---|---|
| `node scripts/test-server-packages.mjs` | exit 0; all package, consumer, parity, resource, process, and new law assertions passed |
| focused CI transition law | 1 passed, 0 failed, 10 skipped |
| `npx eslint scripts/test-server-packages.mjs` | exit 0 |
| `git diff --check` | exit 0 |

NuGet still prints its expected missing-readme authoring warning. A package README remains outside Task 13 scope.

## Commit

The required local commit message is:

```text
test(server): harden NuGet parity proof
```

The commit includes:

```text
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Concerns

None.
