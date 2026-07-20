/**
 * Architectural enforcement: fast CI must retain the complete pipeline.
 *
 * The workflow deliberately spends more runner-minutes to shorten wall-clock
 * time. This test protects both sides of that contract: the dependency graph
 * and shard counts stay optimized, while every original command, diagnostic
 * artifact, and report step remains represented in its intended job.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type WorkflowValue = boolean | number | string;

type Step = {
  name?: string;
  id?: string;
  run?: string;
  uses?: string;
  if?: string;
  with?: Record<string, WorkflowValue>;
};

type MatrixEntry = {
  project: string;
  browser: string;
  shard: string;
};

type Job = {
  name?: string;
  needs?: string | string[];
  uses?: string;
  'runs-on'?: string;
  'timeout-minutes'?: number;
  if?: string;
  with?: Record<string, WorkflowValue>;
  steps?: Step[];
  strategy?: {
    'fail-fast'?: boolean;
    matrix?: {
      shard?: string[];
      include?: MatrixEntry[];
    };
  };
};

type WorkflowInput = {
  description?: string;
  required?: boolean;
  default?: WorkflowValue;
  type?: string;
};

type Workflow = {
  name?: string;
  concurrency?: {
    group?: string;
    'cancel-in-progress'?: boolean;
  };
  on?: {
    workflow_call?: {
      inputs?: Record<string, WorkflowInput>;
    };
  };
  jobs: Record<string, Job>;
};

const root = resolve(__dirname, '../../..');

const readWorkflow = (path: string): Workflow =>
  parse(readFileSync(resolve(root, path), 'utf8')) as Workflow;

const ci = readWorkflow('.github/workflows/ci.yml');
const e2e = readWorkflow('.github/workflows/e2e.yml');

const getJob = (workflow: Workflow, id: string): Job => {
  const job = workflow.jobs[id];

  if (job === undefined) {
    throw new Error(`Missing workflow job: ${id}`);
  }

  return job;
};

const normalizeRun = (run: string): string =>
  run.replaceAll('\r\n', '\n').replace(/\n$/, '');

const normalizeStep = (step: Step): Step =>
  step.run === undefined ? step : { ...step, run: normalizeRun(step.run) };

const expectOrderedSteps = (
  jobId: string,
  job: Job,
  expected: Step[],
): void => {
  expect(
    (job.steps ?? []).map(normalizeStep),
    `${jobId} must retain its exact ordered step contract`,
  ).toEqual(expected);
};

const checkout: Step = {
  name: 'Checkout code',
  uses: 'actions/checkout@v4',
};

const setupNodeDependencies: Step = {
  name: 'Setup Node.js and Dependencies',
  uses: './.github/actions/setup-node-deps',
};

const lintCachePaths =
  'node_modules/.cache/blok-eslint\nnode_modules/.cache/blok-lint.tsbuildinfo\n';

const buildArtifactPaths =
  'dist/\npackages/react/dist/\npackages/vue/dist/\npackages/angular/dist/\n';

const mergeReportRun = [
  'if [ -d ./all-blob-reports ] && [ -n "$(ls -A ./all-blob-reports 2>/dev/null)" ]; then',
  '  npx playwright merge-reports --reporter html ./all-blob-reports',
  'else',
  '  echo "No blob reports found (e2e tests were skipped or cancelled); nothing to merge."',
  'fi',
].join('\n');

const markBuildRun = [
  '# shellcheck disable=SC2086',
  'echo "BLOK_BUILT=true" >> $GITHUB_ENV',
].join('\n');

const e2eMatrix: MatrixEntry[] = [
  { project: 'chromium', browser: 'chromium', shard: '1/3' },
  { project: 'chromium', browser: 'chromium', shard: '2/3' },
  { project: 'chromium', browser: 'chromium', shard: '3/3' },
  { project: 'firefox', browser: 'firefox', shard: '1/4' },
  { project: 'firefox', browser: 'firefox', shard: '2/4' },
  { project: 'firefox', browser: 'firefox', shard: '3/4' },
  { project: 'firefox', browser: 'firefox', shard: '4/4' },
  { project: 'webkit', browser: 'webkit', shard: '1/5' },
  { project: 'webkit', browser: 'webkit', shard: '2/5' },
  { project: 'webkit', browser: 'webkit', shard: '3/5' },
  { project: 'webkit', browser: 'webkit', shard: '4/5' },
  { project: 'webkit', browser: 'webkit', shard: '5/5' },
  { project: 'chromium-logic', browser: 'chromium', shard: '1/4' },
  { project: 'chromium-logic', browser: 'chromium', shard: '2/4' },
  { project: 'chromium-logic', browser: 'chromium', shard: '3/4' },
  { project: 'chromium-logic', browser: 'chromium', shard: '4/4' },
];

describe('CI critical-path law', () => {
  it('keeps every preserved CI job and cancellation setting', () => {
    const requiredJobs = [
      'i18n',
      'lint',
      'unit-tests',
      'validate-spec-coverage',
      'build',
      'install-browsers',
      'e2e-tests',
      'merge-reports',
      'storybook-tests',
    ];

    for (const id of requiredJobs) {
      expect(ci.jobs[id], `missing preserved CI job "${id}"`).toBeDefined();
    }

    expect(ci.concurrency).toEqual({
      group: '${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': true,
    });
  });

  it('retains the exact i18n and lint job contracts', () => {
    const i18n = getJob(ci, 'i18n');
    const lint = getJob(ci, 'lint');

    expect(i18n.name).toBe('i18n Check');
    expect(i18n['runs-on']).toBe('ubuntu-latest');
    expectOrderedSteps('ci.i18n', i18n, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Check translations',
        run: 'node scripts/i18n/check-translations.mjs',
      },
      {
        name: 'Check docs translations',
        run: 'node scripts/i18n/check-docs-translations.mjs',
      },
    ]);

    expect(lint.name).toBe('Lint');
    expect(lint['runs-on']).toBe('ubuntu-latest');
    expectOrderedSteps('ci.lint', lint, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Restore lint cache',
        id: 'lint-cache',
        uses: 'actions/cache/restore@v4',
        with: {
          path: lintCachePaths,
          // v2: v1 caches are poisoned — ESLint's cache persists errored
          // per-file results keyed only on that file's own content, so errors
          // computed against broken types replay forever via restore-keys.
          key: "lint-v2-${{ runner.os }}-${{ hashFiles('yarn.lock', 'eslint.config.mjs', 'tsconfig.json') }}-${{ github.sha }}",
          'restore-keys':
            "lint-v2-${{ runner.os }}-${{ hashFiles('yarn.lock', 'eslint.config.mjs', 'tsconfig.json') }}-\n",
        },
      },
      { name: 'Lint', run: 'yarn lint' },
      {
        name: 'Save lint cache',
        // success() only: a red run's ESLint cache carries the error entries.
        if: "success() && steps.lint-cache.outputs.cache-hit != 'true'",
        uses: 'actions/cache/save@v4',
        with: {
          path: lintCachePaths,
          key: '${{ steps.lint-cache.outputs.cache-primary-key }}',
        },
      },
    ]);
  });

  it('runs two exact unit shards after build without fail-fast cancellation', () => {
    const unit = getJob(ci, 'unit-tests');

    expect(unit.name).toBe('Unit Tests (${{ matrix.shard }})');
    expect(unit.needs).toEqual(['build']);
    expect(unit['runs-on']).toBe('ubuntu-latest');
    expect(unit.strategy).toEqual({
      'fail-fast': false,
      matrix: { shard: ['1/2', '2/2'] },
    });
    expectOrderedSteps('ci.unit-tests', unit, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Download Build Artifacts',
        uses: 'actions/download-artifact@v4',
        with: {
          name: 'dist',
          path: '.',
        },
      },
      {
        name: 'Build CLI',
        run: 'yarn build:cli',
      },
      {
        name: 'Run Unit Tests',
        run: 'yarn test --shard=${{ matrix.shard }}',
      },
    ]);
  });

  it('retains the exact spec-coverage and build job contracts', () => {
    const coverage = getJob(ci, 'validate-spec-coverage');
    const build = getJob(ci, 'build');

    expect(coverage.name).toBe('Validate Spec File Coverage');
    expect(coverage['runs-on']).toBe('ubuntu-latest');
    expectOrderedSteps('ci.validate-spec-coverage', coverage, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Validate all spec files match a Playwright project',
        run: 'yarn validate:spec-coverage',
      },
    ]);

    expect(build.name).toBe('Build');
    expect(build.needs).toBeUndefined();
    expect(build['runs-on']).toBe('ubuntu-latest');
    expectOrderedSteps('ci.build', build, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Build',
        run: 'yarn build',
      },
      {
        name: 'Upload build artifacts',
        uses: 'actions/upload-artifact@v4',
        with: {
          name: 'dist',
          path: buildArtifactPaths,
          'retention-days': 1,
        },
      },
    ]);
  });

  it('prepares every E2E browser independently of build', () => {
    const installer = getJob(ci, 'install-browsers');

    expect(installer.name).toBe('Install Browsers');
    expect(installer.needs).toBeUndefined();
    expect(installer['runs-on']).toBe('ubuntu-latest');
    expect(installer['timeout-minutes']).toBe(10);
    expectOrderedSteps('ci.install-browsers', installer, [
      checkout,
      {
        name: 'Setup Node.js and Dependencies',
        uses: './.github/actions/setup-node-deps',
      },
      {
        name: 'Setup Playwright Browsers',
        uses: './.github/actions/setup-playwright-browsers',
        with: { browsers: 'chromium firefox webkit' },
      },
    ]);
  });

  it('fans out the exact balanced E2E caller matrix after both prerequisites', () => {
    const caller = getJob(ci, 'e2e-tests');

    expect(caller.name).toBe('E2E Tests');
    expect(caller.needs).toEqual(['build', 'install-browsers']);
    expect(caller.strategy).toEqual({
      'fail-fast': false,
      matrix: { include: e2eMatrix },
    });
    expect(caller.uses).toBe('./.github/workflows/e2e.yml');
    expect(caller.with).toEqual({
      'artifact-name': 'dist',
      project: '${{ matrix.project }}',
      browser: '${{ matrix.browser }}',
      shard: '${{ matrix.shard }}',
      'artifact-index': '${{ strategy.job-index }}',
    });
  });

  it('retains the exact Storybook job contract', () => {
    const storybook = getJob(ci, 'storybook-tests');

    expect(storybook.name).toBe('Storybook Tests');
    expect(storybook['runs-on']).toBe('ubuntu-latest');
    expect(storybook['timeout-minutes']).toBe(15);
    expectOrderedSteps('ci.storybook-tests', storybook, [
      checkout,
      {
        name: 'Setup Node.js and Dependencies',
        uses: './.github/actions/setup-node-deps',
      },
      {
        name: 'Setup Playwright Browsers',
        uses: './.github/actions/setup-playwright-browsers',
        with: {
          browsers: 'chromium',
          'cache-key-prefix': 'playwright-storybook',
        },
      },
      {
        name: 'Run Storybook Tests',
        run: 'yarn storybook:test',
      },
    ]);
  });

  it('retains the exact PR report merge contract after every E2E shard', () => {
    const merge = getJob(ci, 'merge-reports');

    expect(merge.name).toBe('Merge E2E Reports');
    expect(merge.if).toBe(
      "${{ !cancelled() && github.ref != 'refs/heads/master' }}",
    );
    expect(merge.needs).toEqual(['e2e-tests']);
    expect(merge['runs-on']).toBe('ubuntu-latest');
    expectOrderedSteps('ci.merge-reports', merge, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Download all blob reports',
        uses: 'actions/download-artifact@v4',
        with: {
          path: 'all-blob-reports',
          pattern: 'blob-report-*',
          'merge-multiple': true,
        },
      },
      {
        name: 'Merge into unified HTML report',
        run: mergeReportRun,
      },
      {
        name: 'Upload unified HTML report',
        uses: 'actions/upload-artifact@v4',
        with: {
          name: 'playwright-report',
          path: 'playwright-report',
          'retention-days': 14,
        },
      },
    ]);
  });

  it('defines the exact reusable shard input contract', () => {
    const inputs = e2e.on?.workflow_call?.inputs;

    expect(inputs).toEqual({
      'artifact-name': {
        description: 'Name of the build artifact to download',
        required: false,
        default: 'dist',
        type: 'string',
      },
      project: {
        description: 'Playwright project to run',
        required: true,
        type: 'string',
      },
      browser: {
        description: 'Browser cache and OS dependencies required by the project',
        required: true,
        type: 'string',
      },
      shard: {
        description: 'Playwright shard fraction',
        required: true,
        type: 'string',
      },
      'artifact-index': {
        description: 'Unique matrix index for diagnostic artifact names',
        required: true,
        type: 'number',
      },
    });
  });

  it('runs one exact reusable E2E shard with complete diagnostics', () => {
    const shard = getJob(e2e, 'e2e-tests');

    expect(e2e.name).toBe('E2E Test Shard');
    expect(Object.keys(e2e.jobs)).toEqual(['e2e-tests']);
    expect(shard.name).toBe('E2E (${{ inputs.project }} ${{ inputs.shard }})');
    expect(shard['runs-on']).toBe('ubuntu-latest');
    expect(shard['timeout-minutes']).toBe(15);
    expectOrderedSteps('e2e.e2e-tests', shard, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Download Build Artifacts',
        uses: 'actions/download-artifact@v4',
        with: {
          name: '${{ inputs.artifact-name }}',
          path: '.',
        },
      },
      {
        name: 'Mark Build as Available',
        run: markBuildRun,
      },
      {
        name: 'Build React Vendor Files',
        run: 'node scripts/build-react-vendor.mjs',
      },
      {
        name: 'Restore Playwright Browsers',
        uses: './.github/actions/setup-playwright-browsers',
        with: {
          browsers: '${{ inputs.browser }}',
          download: 'false',
        },
      },
      {
        name: 'Run E2E Tests',
        run: 'yarn playwright test --project=${{ inputs.project }} --shard=${{ inputs.shard }}',
      },
      {
        name: 'Upload E2E Test Results',
        if: 'failure()',
        uses: 'actions/upload-artifact@v4',
        with: {
          name: 'playwright-results-${{ inputs.project }}-${{ inputs.artifact-index }}',
          path: 'test-results/',
          'retention-days': 3,
        },
      },
      {
        name: 'Upload Blob Report',
        if: 'always()',
        uses: 'actions/upload-artifact@v4',
        with: {
          name: 'blob-report-${{ inputs.project }}-${{ inputs.artifact-index }}',
          path: 'blob-report/',
          'retention-days': 1,
        },
      },
    ]);
  });
});
