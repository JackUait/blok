# CI Critical-Path Optimization Design

## Goal

Reduce the GitHub Actions CI wall-clock time as far as the repository's existing
GitHub-hosted runner allocation allows, without removing any build, validation,
test, browser, artifact, or report step.

## Baseline

Ten recent successful `CI` runs on `master` establish the current shape:

- total workflow duration: approximately 7.5–8 minutes
- build: 47–62 seconds
- browser installation gate: 60–115 seconds, starting only after build
- unit tests: 263–343 seconds, starting only after build
- slowest E2E jobs: WebKit at 296–370 seconds, starting only after both build
  and browser installation

The current critical path is therefore:

```text
build -> install browsers -> slowest E2E shard
```

The repeated checkout, dependency setup, artifact download, browser restore,
test-result upload, and blob-report upload steps are part of the required
pipeline and remain present.

## Constraints

- Work directly on the existing `master` branch. Do not create a branch,
  worktree, detached checkout, or equivalent isolated workflow.
- Preserve all current CI checks and commands.
- Preserve all three browser engines, the Chromium logic project, retries,
  `fail-fast: false`, failure diagnostics, blob reports, and PR report merging.
- Preserve the build artifact and all adapter bundle paths consumed downstream.
- Preserve cancellation of superseded workflow runs.
- Keep the implementation within the 20 concurrent standard-runner jobs
  available on GitHub Free.
- Do not rely on paid runners, self-hosted infrastructure, or mutable container
  images.

## Considered Approaches

### 1. Overlap setup and rebalance shards

Start browser preparation in the first workflow wave alongside build. Split the
long unit suite into two shards, and rebalance E2E across 16 shards according to
observed engine cost.

This is the selected approach. It attacks every measured critical-path segment,
uses only existing GitHub-hosted runners, and preserves the pipeline contract.

### 2. Overlap browser preparation only

Move browser preparation alongside build but retain current test shard counts.
This is structurally conservative, but saves only about one build duration and
leaves the five-to-six-minute test jobs untouched.

### 3. Containers or larger runners

Use a Playwright image or paid larger runners. Container pulls can add variable
startup cost to every shard, while larger runners require external account
configuration. Neither is a repository-only, reliably faster solution.

## Architecture

### Workflow graph

The optimized graph is:

```text
initial wave
  i18n
  lint
  spec coverage
  build -------------------------+
  storybook                      |
  install browsers --------------+
                                  |
                          unit shards (2)
                          E2E shards (16)
                                  |
                          merge PR reports
```

`build` and `install-browsers` have no dependency on each other. E2E shards
depend on both. Unit shards depend only on build.

### Reusable E2E workflow

`.github/workflows/e2e.yml` becomes the reusable definition for one E2E shard.
It accepts:

- build artifact name
- Playwright project
- browser engine
- shard fraction
- artifact index

The shard retains the existing sequence:

1. checkout
2. Node and dependency setup
3. build artifact download
4. `BLOK_BUILT=true`
5. React vendor build
6. cached browser restoration plus OS dependency installation
7. Playwright execution
8. failure artifact upload
9. always-on blob report upload

The browser preparation job and report merge job move to the caller so the
caller can express their real dependencies. Their commands and artifact
semantics do not change.

### Unit sharding

The unit job becomes a two-entry matrix:

- `1/2`
- `2/2`

Each entry retains checkout, dependency setup, build artifact download, CLI
build, and `yarn test`, adding Vitest's native `--shard` argument. Together the
two jobs execute the same `unit` and `unit-angular` projects exactly once.
`fail-fast: false` ensures one failing shard cannot prevent the other shard from
running.

### E2E sharding

The 16 E2E shards are allocated by observed engine cost:

- Chromium: 3 shards
- Firefox: 4 shards
- WebKit: 5 shards
- Chromium logic: 4 shards

Playwright's native sharding partitions each project without changing project
membership or browser coverage. WebKit receives the most shards because it is
the measured critical engine. All shards retain three workers and the current
retry policy.

At the downstream peak, 16 E2E jobs plus two unit jobs leave capacity for the
long-running lint and Storybook jobs under the 20-job limit.

## Failure Handling and Artifacts

- E2E remains `fail-fast: false`.
- Unit sharding uses `fail-fast: false`.
- Failed E2E shards still upload `test-results/`.
- Every E2E shard still uploads `blob-report/` under a unique artifact name.
- PR runs still merge all blob reports and upload the unified HTML report.
- Master pushes still skip report merging, matching current behavior.
- Browser cache misses still install Chromium, Firefox, and WebKit before E2E
  starts.
- Superseded workflow runs remain cancellable through the existing concurrency
  group.

## Verification

Implementation begins with a failing architecture test that inventories the
pipeline contract. It will assert:

- every original CI command and action remains represented
- browser preparation is independent of build
- E2E depends on both build and browser preparation
- unit shards are exactly `1/2` and `2/2`
- E2E shard counts are 3/4/5/4 by project
- failure artifacts, blob artifacts, and merged PR reports remain configured
- both unit and E2E strategies keep `fail-fast: false`

Then:

1. Run the architecture test before editing workflows and observe failure.
2. Restructure workflows.
3. Run the architecture test and the existing spec-coverage validator.
4. Parse both workflow files as YAML.
5. List every Vitest and Playwright shard and verify shard unions equal the
   corresponding unsharded suite with no overlap.
6. Run lint and targeted tests locally.
7. Push and inspect a real GitHub Actions run, comparing its total and per-job
   timings with the measured baseline.

## Expected Result

Overlapping browser preparation removes roughly 50 seconds from the serialized
setup path. Two-way unit sharding and duration-balanced E2E sharding reduce the
longest downstream jobs to an estimated 2.5–3.5 minutes including setup.

The expected warm-cache workflow duration is approximately 4–5 minutes, with
the same checks, browser coverage, diagnostics, and reports as the baseline.
