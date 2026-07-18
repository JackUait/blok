# Docs Release Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make published package-family releases the only events that can build and deploy the documentation website while retaining docs tests for documentation changes.

**Architecture:** Keep one GitHub Actions workflow with two trigger classes. Path-filtered branch pushes run the docs test job, while `release.published` events run that same test job and are the only events allowed through the Pages build/deploy chain.

**Tech Stack:** GitHub Actions YAML, Vitest, TypeScript, `yaml`

---

### Task 1: Add the release-deployment regression test

**Files:**
- Create: `test/unit/scripts/deploy-docs-workflow.test.ts`
- Test: `test/unit/scripts/deploy-docs-workflow.test.ts`

**Step 1: Write the failing test**

Create a test that parses the real workflow and describes the complete
deployment invariant:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Workflow {
  on: Record<string, unknown>;
  jobs: Record<string, {
    if?: string;
    needs?: string | string[];
    steps?: Array<{
      name?: string;
      uses?: string;
      with?: Record<string, unknown>;
    }>;
  }>;
}

const workflow = parse(
  readFileSync(join(__dirname, '../../../.github/workflows/deploy-docs.yml'), 'utf-8'),
) as Workflow;

describe('docs deployment workflow', () => {
  it('runs push checks only for documentation inputs', () => {
    expect(workflow.on.push).toEqual({
      branches: ['**'],
      paths: ['docs/**', 'CHANGELOG.md'],
    });
  });

  it('uses published package releases as its only deployment event', () => {
    expect(workflow.on.release).toEqual({ types: ['published'] });
    expect(workflow.on).not.toHaveProperty('workflow_dispatch');
  });

  it('restricts the Pages build to published release events', () => {
    expect(workflow.jobs.build.if).toBe("github.event_name == 'release'");
    expect(workflow.jobs.build.needs).toBe('docs-tests');
  });

  it('builds the source selected by the published release tag', () => {
    const checkout = workflow.jobs.build.steps?.find(
      (step) => step.uses === 'actions/checkout@v4',
    );

    expect(checkout?.with?.ref).toBe('${{ github.event.release.tag_name }}');
  });

  it('deploys only the release-gated build artifact', () => {
    expect(workflow.jobs.deploy.needs).toBe('build');
  });
});
```

**Step 2: Run the test to verify it fails**

Run:

```bash
yarn vitest run --project=unit test/unit/scripts/deploy-docs-workflow.test.ts
```

Expected: FAIL because the current workflow has no `push.paths` or
`release.published` trigger, still has `workflow_dispatch`, and allows the build
for docs changes on `master`.

### Task 2: Gate Pages deployment on published releases

**Files:**
- Modify: `.github/workflows/deploy-docs.yml`
- Test: `test/unit/scripts/deploy-docs-workflow.test.ts`

**Step 1: Replace the workflow triggers**

Use path-filtered pushes for test coverage and published releases for
deployment:

```yaml
on:
  push:
    branches: ["**"]
    paths:
      - "docs/**"
      - "CHANGELOG.md"
  release:
    types: [published]
```

Remove `workflow_dispatch`.

**Step 2: Remove the changed-file detection job**

Delete the `detect` job. GitHub's push path filter now decides whether docs
tests should run, and the event type decides whether deployment is permitted.

**Step 3: Keep docs tests common to both event types**

Remove the `needs: detect` and detection-output condition from `docs-tests`.
The job runs for both matching pushes and published releases.

**Step 4: Gate the build on a release event**

Make `build` depend only on `docs-tests` and allow it only for release events:

```yaml
needs: docs-tests
if: github.event_name == 'release'
```

Configure the build checkout to use the release's tag explicitly:

```yaml
- name: Checkout code
  uses: actions/checkout@v4
  with:
    ref: ${{ github.event.release.tag_name }}
```

Keep the existing library build, docs build, artifact upload, and deploy jobs
unchanged.

**Step 5: Run the focused test to verify it passes**

Run:

```bash
yarn vitest run --project=unit test/unit/scripts/deploy-docs-workflow.test.ts
```

Expected: PASS with 5 tests.

**Step 6: Commit the implementation**

Stage only:

```bash
git add .github/workflows/deploy-docs.yml test/unit/scripts/deploy-docs-workflow.test.ts
```

Commit:

```bash
git commit -m "ci(docs): deploy only on package releases"
```

### Task 3: Verify the complete invariant

**Files:**
- Verify: `.github/workflows/deploy-docs.yml`
- Verify: `test/unit/scripts/deploy-docs-workflow.test.ts`

**Step 1: Parse the final workflow independently**

Run:

```bash
node -e "const fs=require('fs'); const YAML=require('yaml'); YAML.parse(fs.readFileSync('.github/workflows/deploy-docs.yml','utf8'));"
```

Expected: exit 0.

**Step 2: Run all script-level unit tests**

Run:

```bash
yarn vitest run --project=unit test/unit/scripts
```

Expected: all script test files pass.

**Step 3: Run the complete root unit-test suite**

Run:

```bash
yarn test
```

Expected: all `unit` and `unit-angular` tests pass.

**Step 4: Validate the final diff**

Run:

```bash
git diff --check HEAD^
```

Expected: exit 0 with no output.

Inspect the final workflow and commits to prove every requirement from the
approved design is represented.
