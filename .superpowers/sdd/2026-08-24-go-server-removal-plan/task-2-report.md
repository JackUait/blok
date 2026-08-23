# Task 2 Report — Go Server Process and Middleware Contract

## Result

Added the Go-backed black-box conformance cases under the binding
`test/unit/server-conformance/` path. No C# source or protected configuration was
changed.

## TDD Evidence

### Non-counting syntax correction

The first attempt to run the new test source had a TypeScript parse error in one
nested `expect(await ...)` expression. It was corrected before treating any result
as a TDD observation.

```sh
node scripts/test-server-conformance.mjs --target go
```

Observed: failed before running tests with `Expected \`,\` or \`)\` but found
\`;\` at `server-contract.test.ts:364`.

### Red: missing fixture

After the test source was syntactically valid and before adding the fixture:

```sh
node scripts/test-server-conformance.mjs --target go
```

Observed: the focused suite failed before running tests with:

```text
ENOENT: no such file or directory, open
.../test/unit/server-conformance/fixtures/tickets.json
```

This was the intentional red cycle for the fixed ticket fixture.

### Red: missing process helper

After adding only the fixture and before adding the process-command helper:

```sh
node scripts/test-server-conformance.mjs --target go
```

Observed:

```text
Tests  11 failed | 11 passed (22)
TypeError: runServerCommand is not a function
```

The 11 HTTP cases that passed at this point are recorded Go observations, not
production changes. The 11 process cases failed solely because the required
harness helper had not yet been implemented.

### Green: helper and fixture

After adding the minimal command helper:

```sh
node scripts/test-server-conformance.mjs --target go
```

Observed:

```text
Test Files  1 passed (1)
Tests  22 passed (22)
[exited with code 0]
```

### Green after refactor

After removing unused stdout capture from the new helper:

```sh
node scripts/test-server-conformance.mjs --target go
```

Observed:

```text
Test Files  1 passed (1)
Tests  22 passed (22)
[exited with code 0]
```

## Lint

Only changed TypeScript files were linted:

```sh
yarn --cwd /Users/jackuait/Packages/blok eslint \
  test/unit/server-conformance/run-against.ts \
  test/unit/server-conformance/server-contract.test.ts
```

Observed: exited with code 0.

## Post-commit Verification

After committing, the focused test and the same changed-file lint command were
re-run together:

```sh
node scripts/test-server-conformance.mjs --target go && \\
yarn --cwd /Users/jackuait/Packages/blok eslint \\
  test/unit/server-conformance/run-against.ts \\
  test/unit/server-conformance/server-contract.test.ts
```

Observed:

```text
Test Files  1 passed (1)
Tests  22 passed (22)
[exited with code 0]
```

## Frozen Go Contract

- `GET /health` is ungated and returns exactly
  `{"status":"ok","version":"dev"}\n` with `Content-Type: application/json`;
  it does not emit CORS headers, including when sent an allowed `Origin`.
- Wrong-method, unknown, and dependency-unregistered routes preserve Go's
  `405 Method Not Allowed\n` and `404 page not found\n` responses.
- `--no-unfurl` unregisters both outbound routes and their preflights.
  Empty storage unregisters both upload routes and their preflights.
- In `none` and `proxy` modes, allowed origins receive CORS while missing
  and disallowed origins still reach the handler without CORS. In `ticket`
  mode, missing and disallowed origins are rejected before ticket checking.
- A permitted anonymous preflight returns `204`, echoes requested headers,
  returns `GET, OPTIONS`, `600` max age, and does not consume a ticket
  request budget.
- The frozen ticket vector is compatible with Go's exact HS256 wire format.
  Missing, malformed, expired, and tampered passes are `401` with
  `invalid pass\n` except missing, which is `missing pass\n`.
- Guard ordering is origin, then ticket, then rate limiter, then handler.
  Rejected origins never reach ticket verification, and rejected passes do not
  consume a valid user's rate-limit budget.
- Ticket mode defaults to 60 requests per minute; explicit limits apply at the
  specified count.
- Help exits 0, invalid flag parsing exits 2, and invalid auth/listen/secret/
  origin/S3 configurations exit 1 with their established actionable message.

## Decisions

- Used `test/unit/server-conformance/`, not the obsolete path in the brief,
  as Task 1 and the binding path ruling require. `vitest.config.ts` was not
  changed.
- Kept JSON parsing opt-in for JSON response assertions. Textual error and
  preflight responses remain raw.
- Added `runServerCommand()` beside `startServer()` so startup and flag
  contract cases can observe exit status and stderr without changing the
  server implementation.
- Used a fixed future-expiry compatibility vector and separate expired,
  malformed, and tampered vectors; no ticket signing helper is needed in the
  shared suite.

## Files Changed

- `test/unit/server-conformance/server-contract.test.ts`
- `test/unit/server-conformance/run-against.ts`
- `test/unit/server-conformance/fixtures/tickets.json`
- `.superpowers/sdd/2026-08-24-go-server-removal-plan/task-2-report.md`

## Concerns

- The explicit-rate tests prove the observable fixed-window budget behavior
  inside one window. They do not wait a real minute to assert window rollover,
  because the black-box server has no injectable clock and an artificial wait
  would make the focused conformance gate slow.
- The fixed compatible ticket expires in 2100; a future replacement should
  retain the same wire vector or deliberately rotate this fixture before then.
