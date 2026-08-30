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
  'working-directory'?: string;
  env?: Record<string, WorkflowValue>;
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
  uses: 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
};

const setupNodeDependencies: Step = {
  name: 'Setup Node.js and Dependencies',
  uses: './.github/actions/setup-node-deps',
};

const lintCachePaths =
  'node_modules/.cache/blok-eslint\nnode_modules/.cache/blok-lint.tsbuildinfo\n';

const buildArtifactPaths = [
  'dist/',
  'packages/react/dist/',
  'packages/vue/dist/',
  'packages/angular/dist/',
  'test/playwright/fixtures/vendor/',
  'override-extension/payload/',
  '',
].join('\n');

const buildE2eFixturesRun = [
  'node scripts/build-react-vendor.mjs',
  'node scripts/build-vue-vendor.mjs',
  'node scripts/build-angular-vendor.mjs',
  'node scripts/override/sync.mjs',
].join('\n');

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
  { project: 'chromium', browser: 'chromium', shard: '1/2' },
  { project: 'chromium', browser: 'chromium', shard: '2/2' },
  { project: 'firefox', browser: 'firefox', shard: '1/2' },
  { project: 'firefox', browser: 'firefox', shard: '2/2' },
  { project: 'webkit', browser: 'webkit', shard: '1/3' },
  { project: 'webkit', browser: 'webkit', shard: '2/3' },
  { project: 'webkit', browser: 'webkit', shard: '3/3' },
  { project: 'chromium-logic', browser: 'chromium', shard: '1/2' },
  { project: 'chromium-logic', browser: 'chromium', shard: '2/2' },
  { project: 'chromium-default', browser: 'chromium', shard: '1/3' },
  { project: 'chromium-default', browser: 'chromium', shard: '2/3' },
  { project: 'chromium-default', browser: 'chromium', shard: '3/3' },
];

describe('CI critical-path law', () => {
  it('keeps every preserved CI job and cancellation setting', () => {
    const requiredJobs = [
      'i18n',
      'lint',
      'workflow-lint',
      'frontend-coverage',
      'docs-quality',
      'codeql',
      'server-security',
      'server',
      'unit-tests',
      'workspace-unit-tests',
      'validate-spec-coverage',
      'build',
      'install-browsers',
      'e2e-tests',
      'merge-reports',
      'storybook-tests',
      'visual-regression',
      'production-readiness',
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
        uses: 'actions/cache/restore@0057852bfaa89a56745cba8c7296529d2fc39830',
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
        uses: 'actions/cache/save@0057852bfaa89a56745cba8c7296529d2fc39830',
        with: {
          path: lintCachePaths,
          key: '${{ steps.lint-cache.outputs.cache-primary-key }}',
        },
      },
    ]);
  });

  it('retains the exact final server job contract', () => {
    const server = getJob(ci, 'server');

    expect(server.name).toBe('Server');
    expect(server.needs).toBeUndefined();
    expect(server['runs-on']).toBe('ubuntu-latest');
    expectOrderedSteps('ci.server', server, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Setup .NET',
        uses: 'actions/setup-dotnet@67a3573c9a986a3f9c594539f4ab511d57bb3ce9',
        with: {
          'dotnet-version': '10.0.x',
        },
      },
      {
        name: 'Test .NET server with coverage',
        run: [
          'rm -rf .server-test-results .server-coverage',
          'dotnet test packages/server/dotnet/Blok.Server.slnx \\',
          '  --configuration Release \\',
          '  --collect:"Code Coverage;Format=Cobertura" \\',
          '  --results-directory .server-test-results',
        ].join('\n'),
      },
      {
        name: 'Enforce .NET server coverage',
        run: [
          'dotnet tool restore',
          'dotnet reportgenerator \\',
          "  '-reports:.server-test-results/**/*.cobertura.xml' \\",
          "  '-targetdir:.server-coverage' \\",
          "  '-reporttypes:Cobertura;MarkdownSummaryGithub' \\",
          "  '-assemblyfilters:+Blok.Server*;-*.Tests'",
          'node scripts/check-server-coverage.mjs .server-coverage/Cobertura.xml',
          'cat .server-coverage/SummaryGithub.md >> "$GITHUB_STEP_SUMMARY"',
        ].join('\n'),
      },
      {
        name: 'Check .NET formatting',
        run: 'dotnet format packages/server/dotnet/Blok.Server.slnx --verify-no-changes',
      },
      {
        name: 'Test packed .NET packages',
        run: 'node scripts/test-server-packages.mjs',
      },
      {
        name: 'Test C# conformance',
        run: 'node scripts/test-server-conformance.mjs --target csharp',
      },
      {
        name: 'Dry-run server artifacts',
        run: 'node scripts/publish-server.mjs --version 1.10.1 --dry-run',
      },
      {
        name: 'Test server delivery wiring',
        run: [
          'yarn vitest run --project=unit \\',
          '  test/unit/server/bin.test.ts \\',
          '  test/unit/scripts/check-server-coverage.test.ts \\',
          '  test/unit/scripts/publish-server.test.ts \\',
          '  test/unit/scripts/verify-docs-release.test.ts \\',
          '  test/unit/scripts/release-cli.test.ts \\',
          '  test/unit/architecture/server-release-wiring.test.ts \\',
          '  test/unit/architecture/server-quality-gates.test.ts \\',
          '  test/unit/architecture/ci-critical-path-law.test.ts \\',
          '  test/unit/architecture/package-metadata-law.test.ts',
        ].join('\n'),
      },
    ]);
  });

  it('runs four exact unit-only coverage shards after build', () => {
    const unit = getJob(ci, 'unit-tests');

    expect(unit.name).toBe('Unit Tests (${{ matrix.shard }})');
    expect(unit.needs).toEqual(['build']);
    expect(unit['runs-on']).toBe('ubuntu-latest');
    expect(unit.strategy).toEqual({
      'fail-fast': false,
      matrix: { shard: ['1/4', '2/4', '3/4', '4/4'] },
    });
    expectOrderedSteps('ci.unit-tests', unit, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Download Build Artifacts',
        uses: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
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
        name: 'Run Unit Tests with coverage',
        run: [
          'yarn vitest run --coverage --project=unit \\',
          '  --shard=${{ matrix.shard }} \\',
          '  --reporter=default \\',
          '  --reporter=blob \\',
          '  --coverage.reporter=json \\',
          '  --coverage.thresholds.statements=0 \\',
          '  --coverage.thresholds.lines=0 \\',
          '  --coverage.thresholds.functions=0 \\',
          '  --coverage.thresholds.branches=0',
        ].join('\n'),
      },
      {
        name: 'Upload frontend coverage shard',
        uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
        with: {
          name: 'frontend-coverage-${{ strategy.job-index }}',
          path: '.vitest-reports/',
          'if-no-files-found': 'error',
          'include-hidden-files': true,
          'retention-days': 1,
        },
      },
    ]);
  });

  it('runs unsharded workspace suites in parallel after build', () => {
    const workspace = getJob(ci, 'workspace-unit-tests');

    expect(workspace.name).toBe('Workspace Unit Tests');
    expect(workspace.needs).toEqual(['build']);
    expect(workspace['runs-on']).toBe('ubuntu-latest');
    expectOrderedSteps('ci.workspace-unit-tests', workspace, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Download Build Artifacts',
        uses: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
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
        name: 'Run Angular Unit Tests',
        run: 'yarn test:angular',
      },
      {
        name: 'Run @bloklabs/react Unit Tests',
        run: 'yarn workspace @bloklabs/react test',
      },
      {
        name: 'Run @bloklabs/presets Unit Tests',
        run: 'yarn workspace @bloklabs/presets test',
      },
      {
        name: 'Run @bloklabs/server Unit Tests',
        run: 'yarn workspace @bloklabs/server test',
      },
    ]);
  });

  it('merges shard coverage and keeps CodeQL dependency-free', () => {
    const coverage = getJob(ci, 'frontend-coverage');
    const codeql = getJob(ci, 'codeql');

    expect(coverage.needs).toEqual(['unit-tests']);
    expectOrderedSteps('ci.frontend-coverage', coverage, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Download frontend coverage shards',
        uses: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
        with: {
          pattern: 'frontend-coverage-*',
          path: '.vitest-reports',
          'merge-multiple': true,
        },
      },
      {
        name: 'Merge frontend coverage',
        run: 'yarn vitest --merge-reports=.vitest-reports --coverage --reporter=default',
      },
      {
        name: 'Upload coverage diagnostics',
        if: 'failure()',
        uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
        with: {
          name: 'frontend-coverage',
          path: 'coverage/',
          'if-no-files-found': 'ignore',
          'retention-days': 3,
        },
      },
    ]);
    expect(codeql.steps).not.toContainEqual(setupNodeDependencies);
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
        env: {
          BLOK_VISUAL: '1',
        },
        run: 'yarn validate:spec-coverage',
      },
      {
        name: 'Validate test categories',
        run: 'yarn e2e:validate-categories',
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
        name: 'Build E2E fixtures',
        run: buildE2eFixturesRun,
      },
      {
        name: 'Upload build artifacts',
        uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
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
      "${{ !cancelled() && github.ref != 'refs/heads/main' }}",
    );
    expect(merge.needs).toEqual(['e2e-tests']);
    expect(merge['runs-on']).toBe('ubuntu-latest');
    expectOrderedSteps('ci.merge-reports', merge, [
      checkout,
      setupNodeDependencies,
      {
        name: 'Download all blob reports',
        uses: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
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
        uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
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
        uses: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
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
        uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
        with: {
          name: 'playwright-results-${{ inputs.project }}-${{ inputs.artifact-index }}',
          path: 'test-results/',
          'retention-days': 3,
        },
      },
      {
        name: 'Upload Blob Report',
        if: "always() && github.ref != 'refs/heads/main'",
        uses: 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
        with: {
          name: 'blob-report-${{ inputs.project }}-${{ inputs.artifact-index }}',
          path: 'blob-report/',
          'retention-days': 1,
        },
      },
    ]);
  });
});
