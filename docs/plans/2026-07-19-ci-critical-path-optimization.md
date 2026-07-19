# CI Critical-Path Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce the existing GitHub Actions CI workflow from roughly 7.5–8 minutes to approximately 4–5 minutes without removing any build, validation, test, browser, artifact, or report step.

**Architecture:** Move the existing browser-preparation job into the caller so it runs alongside build, then gate a duration-balanced 16-entry reusable E2E shard matrix on both prerequisites. Split the existing unit command across two native Vitest shards while retaining every setup and artifact step, and enforce the whole pipeline contract with a YAML-backed architecture test.

**Tech Stack:** GitHub Actions reusable workflows, YAML, Yarn 4, Vitest 4 native sharding, Playwright 1.59 native sharding, TypeScript.

---

### Task 1: Add the failing CI contract test

**Files:**
- Create: `test/unit/architecture/ci-critical-path-law.test.ts`
- Read: `.github/workflows/ci.yml`
- Read: `.github/workflows/e2e.yml`

**Step 1: Create the architecture test**

Add:

```ts
/**
 * Architectural enforcement: fast CI must retain the complete pipeline.
 *
 * The workflow deliberately spends more runner-minutes to shorten wall-clock
 * time. This test protects both sides of that contract: the dependency graph
 * and shard counts stay optimized, while every original command, diagnostic
 * artifact, and report step remains represented.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Step = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
};

type MatrixEntry = {
  project?: string;
  browser?: string;
  shard?: string;
};

type Job = {
  name?: string;
  needs?: string | string[];
  uses?: string;
  steps?: Step[];
  strategy?: {
    'fail-fast'?: boolean;
    matrix?: {
      shard?: string[];
      include?: MatrixEntry[];
    };
  };
};

type Workflow = {
  on?: {
    workflow_call?: {
      inputs?: Record<string, {
        required?: boolean;
        type?: string;
      }>;
    };
  };
  jobs: Record<string, Job>;
};

const root = resolve(__dirname, '../../..');

const readWorkflow = (path: string): Workflow =>
  parse(readFileSync(resolve(root, path), 'utf8')) as Workflow;

const ci = readWorkflow('.github/workflows/ci.yml');
const e2e = readWorkflow('.github/workflows/e2e.yml');
const jobs = [...Object.values(ci.jobs), ...Object.values(e2e.jobs)];
const steps = jobs.flatMap((job) => job.steps ?? []);

const getStep = (job: Job | undefined, name: string): Step => {
  const step = job?.steps?.find((candidate) => candidate.name === name);

  if (step === undefined) {
    throw new Error(`Missing workflow step: ${name}`);
  }

  return step;
};

describe('CI critical-path law', () => {
  it('retains every original pipeline step and command', () => {
    const stepNames = steps
      .map((step) => step.name)
      .filter((name): name is string => name !== undefined);
    const commands = steps
      .map((step) => step.run)
      .filter((run): run is string => run !== undefined);
    const actions = steps
      .map((step) => step.uses)
      .filter((uses): uses is string => uses !== undefined);

    const requiredStepNames = [
      'Checkout code',
      'Setup Node.js',
      'Check translations',
      'Check docs translations',
      'Setup Node.js and Dependencies',
      'Lint',
      'Download Build Artifacts',
      'Build CLI',
      'Run Unit Tests',
      'Validate all spec files match a Playwright project',
      'Build',
      'Upload build artifacts',
      'Setup Playwright Browsers',
      'Run Storybook Tests',
      'Mark Build as Available',
      'Build React Vendor Files',
      'Restore Playwright Browsers',
      'Run E2E Tests',
      'Upload E2E Test Results',
      'Upload Blob Report',
      'Download all blob reports',
      'Merge into unified HTML report',
      'Upload unified HTML report',
    ];

    for (const name of requiredStepNames) {
      expect(stepNames, `missing original CI step "${name}"`).toContain(name);
    }

    const requiredCommandFragments = [
      'node scripts/i18n/check-translations.mjs',
      'node scripts/i18n/check-docs-translations.mjs',
      'yarn lint',
      'yarn build:cli',
      'yarn test',
      'yarn validate:spec-coverage',
      'yarn build',
      'yarn storybook:test',
      'echo "BLOK_BUILT=true" >> $GITHUB_ENV',
      'node scripts/build-react-vendor.mjs',
      'yarn playwright test',
      'npx playwright merge-reports --reporter html',
    ];

    for (const fragment of requiredCommandFragments) {
      expect(
        commands.some((command) => command.includes(fragment)),
        `missing original CI command containing "${fragment}"`,
      ).toBe(true);
    }

    for (const action of [
      'actions/checkout@v4',
      'actions/setup-node@v4',
      './.github/actions/setup-node-deps',
      'actions/download-artifact@v4',
      'actions/upload-artifact@v4',
      './.github/actions/setup-playwright-browsers',
    ]) {
      expect(actions, `missing original CI action "${action}"`).toContain(action);
    }
  });

  it('runs browser preparation beside build and gates every E2E shard on both', () => {
    expect(ci.jobs['install-browsers']).toBeDefined();
    expect(ci.jobs['install-browsers']?.needs).toBeUndefined();
    expect(ci.jobs['e2e-tests']?.needs).toEqual(['build', 'install-browsers']);
    expect(ci.jobs['e2e-tests']?.uses).toBe('./.github/workflows/e2e.yml');
    expect(Object.keys(e2e.jobs)).toEqual(['e2e-tests']);
  });

  it('runs two complete Vitest shards without fail-fast cancellation', () => {
    const unit = ci.jobs['unit-tests'];

    expect(unit?.strategy?.['fail-fast']).toBe(false);
    expect(unit?.strategy?.matrix?.shard).toEqual(['1/2', '2/2']);
    expect(getStep(unit, 'Run Unit Tests').run).toBe(
      'yarn test --shard=${{ matrix.shard }}',
    );
  });

  it('balances all existing E2E projects across sixteen shards', () => {
    const e2eCaller = ci.jobs['e2e-tests'];
    const include = e2eCaller?.strategy?.matrix?.include ?? [];
    const expected = {
      chromium: ['1/3', '2/3', '3/3'],
      firefox: ['1/4', '2/4', '3/4', '4/4'],
      webkit: ['1/5', '2/5', '3/5', '4/5', '5/5'],
      'chromium-logic': ['1/4', '2/4', '3/4', '4/4'],
    };
    const actual = Object.fromEntries(
      Object.keys(expected).map((project) => [
        project,
        include
          .filter((entry) => entry.project === project)
          .map((entry) => entry.shard),
      ]),
    );

    expect(e2eCaller?.strategy?.['fail-fast']).toBe(false);
    expect(include).toHaveLength(16);
    expect(actual).toEqual(expected);

    for (const entry of include) {
      expect(entry.browser).toBe(
        entry.project === 'chromium-logic' ? 'chromium' : entry.project,
      );
    }
  });

  it('retains per-shard diagnostics and merged PR reports', () => {
    const shard = e2e.jobs['e2e-tests'];
    const failureArtifact = getStep(shard, 'Upload E2E Test Results');
    const blobArtifact = getStep(shard, 'Upload Blob Report');
    const merge = ci.jobs['merge-reports'];
    const download = getStep(merge, 'Download all blob reports');
    const upload = getStep(merge, 'Upload unified HTML report');

    expect(failureArtifact.if).toBe('failure()');
    expect(failureArtifact.with?.name).toBe(
      'playwright-results-${{ inputs.project }}-${{ inputs.artifact-index }}',
    );
    expect(blobArtifact.if).toBe('always()');
    expect(blobArtifact.with?.name).toBe(
      'blob-report-${{ inputs.project }}-${{ inputs.artifact-index }}',
    );
    expect(download.with).toMatchObject({
      pattern: 'blob-report-*',
      'merge-multiple': true,
    });
    expect(upload.with).toMatchObject({
      name: 'playwright-report',
      path: 'playwright-report',
      'retention-days': 14,
    });
  });

  it('requires every reusable-shard input used by the caller', () => {
    expect(e2e.on?.workflow_call?.inputs).toMatchObject({
      'artifact-name': { type: 'string' },
      project: { required: true, type: 'string' },
      browser: { required: true, type: 'string' },
      shard: { required: true, type: 'string' },
      'artifact-index': { required: true, type: 'number' },
    });
  });
});
```

**Step 2: Run the test and confirm the pre-optimization workflow fails**

Run:

```bash
yarn test test/unit/architecture/ci-critical-path-law.test.ts
```

Expected: FAIL because `.github/workflows/ci.yml` has no top-level
`install-browsers` job, unit tests are unsharded, and the caller has no E2E
matrix.

Do not weaken assertions to fit the old workflow.

---

### Task 2: Restructure the caller and shard unit tests

**Files:**
- Modify: `.github/workflows/ci.yml:45-144`
- Test: `test/unit/architecture/ci-critical-path-law.test.ts`

**Step 1: Replace the unit job**

Replace the existing `unit-tests` block with:

```yaml
  unit-tests:
    name: Unit Tests (${{ matrix.shard }})
    needs: [build]
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        shard: ["1/2", "2/2"]
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js and Dependencies
        uses: ./.github/actions/setup-node-deps

      - name: Download Build Artifacts
        uses: actions/download-artifact@v4
        with:
          name: dist
          # Archive keeps repo-relative paths (dist/, packages/*/dist/); extract at root.
          path: .

      - name: Build CLI
        run: yarn build:cli

      - name: Run Unit Tests
        run: yarn test --shard=${{ matrix.shard }}
```

**Step 2: Add the independent browser-preparation job**

Insert this top-level job after `build`:

```yaml
  install-browsers:
    name: Install Browsers
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      # Node is pinned to 24.14.1 because `playwright install` (< 1.60.0) hangs forever
      # after the browser download on Node >= 24.16 (vendored-yauzl extract bug,
      # microsoft/playwright#40998). Remove the pin after bumping @playwright/test to >= 1.60.0.
      - name: Setup Node.js and Dependencies
        uses: ./.github/actions/setup-node-deps
        with:
          node-version: 24.14.1

      - name: Setup Playwright Browsers
        uses: ./.github/actions/setup-playwright-browsers
        with:
          browsers: chromium firefox webkit
```

Do not add `needs` to this job. Its independence from build is the first
critical-path reduction.

**Step 3: Replace the E2E caller with the balanced matrix**

Replace the existing `e2e-tests` caller with:

```yaml
  e2e-tests:
    name: E2E Tests
    needs: [build, install-browsers]
    strategy:
      fail-fast: false
      matrix:
        include:
          - project: chromium
            browser: chromium
            shard: 1/3
          - project: chromium
            browser: chromium
            shard: 2/3
          - project: chromium
            browser: chromium
            shard: 3/3
          - project: firefox
            browser: firefox
            shard: 1/4
          - project: firefox
            browser: firefox
            shard: 2/4
          - project: firefox
            browser: firefox
            shard: 3/4
          - project: firefox
            browser: firefox
            shard: 4/4
          - project: webkit
            browser: webkit
            shard: 1/5
          - project: webkit
            browser: webkit
            shard: 2/5
          - project: webkit
            browser: webkit
            shard: 3/5
          - project: webkit
            browser: webkit
            shard: 4/5
          - project: webkit
            browser: webkit
            shard: 5/5
          - project: chromium-logic
            browser: chromium
            shard: 1/4
          - project: chromium-logic
            browser: chromium
            shard: 2/4
          - project: chromium-logic
            browser: chromium
            shard: 3/4
          - project: chromium-logic
            browser: chromium
            shard: 4/4
    uses: ./.github/workflows/e2e.yml
    with:
      artifact-name: dist
      project: ${{ matrix.project }}
      browser: ${{ matrix.browser }}
      shard: ${{ matrix.shard }}
      artifact-index: ${{ strategy.job-index }}
```

**Step 4: Move the report merge job into the caller**

Insert after `e2e-tests`:

```yaml
  merge-reports:
    name: Merge E2E Reports
    if: ${{ !cancelled() && github.ref != 'refs/heads/master' }}
    needs: [e2e-tests]
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js and Dependencies
        uses: ./.github/actions/setup-node-deps

      - name: Download all blob reports
        uses: actions/download-artifact@v4
        with:
          path: all-blob-reports
          pattern: blob-report-*
          merge-multiple: true

      - name: Merge into unified HTML report
        run: |
          if [ -d ./all-blob-reports ] && [ -n "$(ls -A ./all-blob-reports 2>/dev/null)" ]; then
            npx playwright merge-reports --reporter html ./all-blob-reports
          else
            echo "No blob reports found (e2e tests were skipped or cancelled); nothing to merge."
          fi

      - name: Upload unified HTML report
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report
          retention-days: 14
```

The step bodies must remain byte-for-byte equivalent to the old reusable
workflow behavior.

---

### Task 3: Convert the reusable E2E workflow into one shard

**Files:**
- Modify: `.github/workflows/e2e.yml:1-149`
- Test: `test/unit/architecture/ci-critical-path-law.test.ts`

**Step 1: Replace the reusable workflow**

Use this complete file:

```yaml
name: E2E Test Shard

on:
  workflow_call:
    inputs:
      artifact-name:
        description: "Name of the build artifact to download"
        required: false
        default: "dist"
        type: string
      project:
        description: "Playwright project to run"
        required: true
        type: string
      browser:
        description: "Browser cache and OS dependencies required by the project"
        required: true
        type: string
      shard:
        description: "Playwright shard fraction"
        required: true
        type: string
      artifact-index:
        description: "Unique matrix index for diagnostic artifact names"
        required: true
        type: number

jobs:
  e2e-tests:
    name: E2E (${{ inputs.project }} ${{ inputs.shard }})
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js and Dependencies
        uses: ./.github/actions/setup-node-deps

      - name: Download Build Artifacts
        uses: actions/download-artifact@v4
        with:
          name: ${{ inputs.artifact-name }}
          # Archive keeps repo-relative paths (dist/, packages/*/dist/); extract at root
          # so the react-adapter fixture can load /packages/react/dist/index.mjs.
          path: .

      - name: Mark Build as Available
        run: echo "BLOK_BUILT=true" >> $GITHUB_ENV

      - name: Build React Vendor Files
        run: node scripts/build-react-vendor.mjs

      - name: Restore Playwright Browsers
        uses: ./.github/actions/setup-playwright-browsers
        with:
          browsers: ${{ inputs.browser }}
          download: "false"

      - name: Run E2E Tests
        run: yarn playwright test --project=${{ inputs.project }} --shard=${{ inputs.shard }}

      - name: Upload E2E Test Results
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-results-${{ inputs.project }}-${{ inputs.artifact-index }}
          path: test-results/
          retention-days: 3

      - name: Upload Blob Report
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: blob-report-${{ inputs.project }}-${{ inputs.artifact-index }}
          path: blob-report/
          retention-days: 1
```

**Step 2: Run the contract test**

Run:

```bash
yarn test test/unit/architecture/ci-critical-path-law.test.ts
```

Expected: PASS, six tests.

**Step 3: Parse and lint both workflows**

Run:

```bash
node -e "const {readFileSync}=require('node:fs'); const {parse}=require('yaml'); for (const file of ['.github/workflows/ci.yml','.github/workflows/e2e.yml']) parse(readFileSync(file,'utf8')); console.log('workflow YAML parses')"
actionlint .github/workflows/ci.yml .github/workflows/e2e.yml
```

Expected: both commands exit 0.

**Step 4: Commit the implementation**

Stage only:

```bash
git add .github/workflows/ci.yml .github/workflows/e2e.yml test/unit/architecture/ci-critical-path-law.test.ts
git commit -m "perf(ci): shorten the critical path"
```

---

### Task 4: Prove shard completeness and run project gates

**Files:**
- Verify: `.github/workflows/ci.yml`
- Verify: `.github/workflows/e2e.yml`
- Verify: `test/unit/architecture/ci-critical-path-law.test.ts`

**Step 1: List the full and sharded Vitest file sets**

Run:

```bash
CI=1 yarn vitest list --project=unit --project=unit-angular --filesOnly --json=/tmp/blok-vitest-all.json
CI=1 yarn vitest list --project=unit --project=unit-angular --filesOnly --shard=1/2 --json=/tmp/blok-vitest-1.json
CI=1 yarn vitest list --project=unit --project=unit-angular --filesOnly --shard=2/2 --json=/tmp/blok-vitest-2.json
node -e "const fs=require('node:fs'); const read=p=>JSON.parse(fs.readFileSync(p,'utf8')).map(x=>x.projectName+'\\0'+x.file); const all=new Set(read('/tmp/blok-vitest-all.json')); const a=read('/tmp/blok-vitest-1.json'); const b=read('/tmp/blok-vitest-2.json'); const union=new Set([...a,...b]); const overlap=a.filter(x=>new Set(b).has(x)); if(union.size!==all.size||[...all].some(x=>!union.has(x))||overlap.length) throw new Error(JSON.stringify({all:all.size,union:union.size,overlap:overlap.length})); console.log({all:all.size,shard1:a.length,shard2:b.length,overlap:0})"
```

Expected: the union equals the full set and overlap is zero.

**Step 2: List the full and sharded Playwright test sets**

For each project, write JSON reports for the full list and every configured
shard:

```bash
CI=1 PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/blok-pw-chromium-all.json yarn playwright test --list --project=chromium --reporter=json
CI=1 PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/blok-pw-chromium-1.json yarn playwright test --list --project=chromium --shard=1/3 --reporter=json
CI=1 PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/blok-pw-chromium-2.json yarn playwright test --list --project=chromium --shard=2/3 --reporter=json
CI=1 PLAYWRIGHT_JSON_OUTPUT_FILE=/tmp/blok-pw-chromium-3.json yarn playwright test --list --project=chromium --shard=3/3 --reporter=json
```

Repeat the same pattern for:

- Firefox shards `1/4` through `4/4`
- WebKit shards `1/5` through `5/5`
- Chromium logic shards `1/4` through `4/4`

Use this recursive check for each project:

```bash
node -e "const fs=require('node:fs'); const project=process.argv[1]; const count=Number(process.argv[2]); const ids=value=>{const out=[]; const visit=node=>{if(Array.isArray(node)){for(const item of node)visit(item);return} if(node&&typeof node==='object'){if(typeof node.id==='string'&&Array.isArray(node.tests))out.push(node.id); for(const child of Object.values(node))visit(child)}}; visit(value.suites); return out}; const read=p=>ids(JSON.parse(fs.readFileSync(p,'utf8'))); const all=new Set(read('/tmp/blok-pw-'+project+'-all.json')); const shards=Array.from({length:count},(_,i)=>read('/tmp/blok-pw-'+project+'-'+(i+1)+'.json')); const flat=shards.flat(); const union=new Set(flat); if(union.size!==all.size||flat.length!==union.size||[...all].some(id=>!union.has(id)))throw new Error(JSON.stringify({project,all:all.size,sharded:flat.length,unique:union.size})); console.log({project,all:all.size,shards:shards.map(x=>x.length),overlap:0})" chromium 3
```

Run the checker as:

```bash
node -e "<same checker>" firefox 4
node -e "<same checker>" webkit 5
node -e "<same checker>" chromium-logic 4
```

Expected: each project reports the same full and unique sharded count with zero
overlap.

**Step 3: Execute both unit shards**

Run:

```bash
yarn test --shard=1/2
yarn test --shard=2/2
```

Expected: both pass. Together they must report the same total test-file count as
the unsharded suite.

**Step 4: Run existing CI validators**

Run:

```bash
yarn validate:spec-coverage
yarn lint
```

Expected: both pass. If unrelated pre-existing user changes cause a failure,
record the exact failure and separately prove the CI files and new architecture
test are clean.

**Step 5: Run the repository refactor review**

Follow the repository's `/refactor` procedure over:

- `.github/workflows/ci.yml`
- `.github/workflows/e2e.yml`
- `test/unit/architecture/ci-critical-path-law.test.ts`

Keep all required steps and assertions. Only apply simplifications that preserve
the approved design.

**Step 6: Re-run final local verification**

Run:

```bash
yarn test test/unit/architecture/ci-critical-path-law.test.ts
actionlint .github/workflows/ci.yml .github/workflows/e2e.yml
yarn validate:spec-coverage
git diff --check HEAD^
```

Expected: all pass.

---

### Task 5: Push and verify the real pipeline

**Files:**
- Verify: GitHub Actions run created by the pushed commit
- Update only if evidence requires: `.github/workflows/ci.yml`
- Update only if evidence requires: `.github/workflows/e2e.yml`
- Update only if evidence requires: `test/unit/architecture/ci-critical-path-law.test.ts`

**Step 1: Synchronize without overwriting user changes**

Run:

```bash
git status --short --branch
git pull --rebase --autostash
```

Expected: the branch updates cleanly and all unrelated user changes remain.

**Step 2: Push**

Run:

```bash
git push
```

Expected: push succeeds.

**Step 3: Inspect the new CI run**

Run:

```bash
gh run list --workflow CI --commit "$(git rev-parse HEAD)" --limit 1 --json databaseId,status,conclusion,url,createdAt,updatedAt
```

Wait for completion, then inspect every job:

```bash
gh run view <run-id> --json status,conclusion,jobs,url
gh api --paginate "repos/JackUait/blok/actions/runs/<run-id>/jobs?per_page=100"
```

Expected evidence:

- browser installation and build overlap
- two unit shards execute
- exactly 16 E2E shards execute
- all current projects and shard fractions execute
- every E2E shard uploads a blob report
- PR report behavior remains configured; master correctly skips merge
- all non-user-change-related jobs pass
- total wall-clock duration is materially below the 7.5–8 minute baseline

**Step 4: Diagnose any workflow failure before changing code**

If the run fails, use `superpowers:systematic-debugging` before proposing or
applying a fix. Preserve every pipeline step and repeat local verification,
commit, push, and run inspection.

**Step 5: Run final repository completion checks**

Follow the repository's `/final-verification` procedure, then run:

```bash
git status --short --branch
```

Expected: `master` is up to date with `origin/master`; only unrelated,
pre-existing user changes remain.
