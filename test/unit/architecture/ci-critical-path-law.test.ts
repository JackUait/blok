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
