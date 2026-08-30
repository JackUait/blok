import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

type WorkflowValue = boolean | number | string;

interface WorkflowStep {
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, WorkflowValue>;
}

interface WorkflowJob {
  if?: string;
  needs?: string | string[];
  'runs-on'?: string;
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
  strategy?: {
    matrix?: {
      include?: Array<Record<string, WorkflowValue>>;
    };
  };
}

interface Workflow {
  on?: Record<string, unknown>;
  jobs?: Record<string, WorkflowJob>;
  permissions?: Record<string, string>;
}

interface DependabotUpdate {
  directory?: string;
  'package-ecosystem'?: string;
}

interface Dependabot {
  updates?: DependabotUpdate[];
}

const root = resolve(__dirname, '../../..');

const read = (path: string): string =>
  readFileSync(resolve(root, path), 'utf8');

const workflow = (path: string): Workflow =>
  parse(read(path)) as Workflow;

const job = (definition: Workflow, id: string): WorkflowJob => {
  const value = definition.jobs?.[id];

  if (value === undefined) {
    throw new Error(`Missing workflow job: ${id}`);
  }

  return value;
};

const needsList = (value: string | string[] | undefined): string[] =>
  typeof value === 'string' ? [value] : value ?? [];

describe('production readiness gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has one blocking CI result covering every release-critical job', () => {
    const ci = workflow('.github/workflows/ci.yml');
    const readiness = job(ci, 'production-readiness');
    const required = [
      'i18n',
      'lint',
      'workflow-lint',
      'codeql',
      'server-security',
      'server',
      'unit-tests',
      'validate-spec-coverage',
      'build',
      'install-browsers',
      'e2e-tests',
      'storybook-tests',
      'frontend-coverage',
      'docs-quality',
      'visual-regression',
    ];

    expect(readiness.if).toBe('always()');
    expect(new Set(needsList(readiness.needs))).toEqual(new Set(required));
    expect(readiness.steps?.some(step =>
      step.run?.includes('result !== \'success\'') === true
    )).toBe(true);
  });

  it('deploys docs and mirrors main only after successful CI for the exact SHA', () => {
    for (const path of [
      '.github/workflows/deploy-docs.yml',
      '.github/workflows/mirror.yml',
    ]) {
      const source = read(path);

      expect(source).toContain('workflow_run:');
      expect(source).toContain('workflows: ["CI"]');
      expect(source).toContain('types: [completed]');
      expect(source).toContain('github.event.workflow_run.conclusion == \'success\'');
      expect(source).toContain("github.event.workflow_run.event == 'push'");
      expect(source).toContain('github.event.workflow_run.head_repository.full_name == github.repository');
      expect(source).toContain('github.event.workflow_run.head_sha');
    }

    const docs = workflow('.github/workflows/deploy-docs.yml');
    const mirror = workflow('.github/workflows/mirror.yml');

    for (const id of ['docs-tests', 'verify-release', 'build']) {
      expect(job(docs, id).if).toContain("github.event.workflow_run.event == 'push'");
      expect(job(docs, id).if).toContain(
        'github.event.workflow_run.head_repository.full_name == github.repository'
      );
    }

    expect(Object.keys(mirror.on ?? {})).toEqual(['push', 'workflow_run']);
    expect(read('.github/workflows/mirror.yml')).toContain(
      'gh run list --workflow CI --branch main --event push --commit "$GITHUB_SHA"'
    );
  });

  it('skips stale workflow runs and cancels obsolete docs deploys', () => {
    const docs = read('.github/workflows/deploy-docs.yml');
    const mirror = read('.github/workflows/mirror.yml');

    expect(docs).toContain('cancel-in-progress: true');
    expect(docs).toContain('github.event.workflow_run.head_sha == github.sha');
    expect(mirror).toContain('github.event.workflow_run.head_sha == github.sha');
  });

  it('gates every mirrored release tag independently', () => {
    const mirror = read('.github/workflows/mirror.yml');

    expect(mirror).not.toContain('git push mirror --tags');
    expect(mirror).toContain('git push mirror "+${{ github.event.workflow_run.head_sha }}:refs/heads/main"');
  });

  it('accepts only main push CI runs for release publication', () => {
    for (const source of [
      read('scripts/release.mjs'),
      read('.github/workflows/mirror.yml'),
      read('.github/workflows/release-server.yml'),
    ]) {
      expect(source).toContain('--branch main --event push');
    }
  });

  it('includes visual specs in the static project coverage gate', () => {
    expect(read('scripts/validate-spec-file-coverage.mjs')).toContain("BLOK_VISUAL: '1'");
  });

  it('allows one hour for the blocking release CI result', () => {
    const release = read('scripts/release.mjs');
    const mirror = read('.github/workflows/mirror.yml');
    const serverRelease = read('.github/workflows/release-server.yml');

    expect(release).toContain('attempts = 360');
    for (const source of [mirror, serverRelease]) {
      expect(source).toContain('seq 1 360');
      expect(source).toContain('after 60 minutes');
    }
  });

  it('rechecks the current main source before package publication', () => {
    const release = read('scripts/release.mjs');
    const sourceSha = release.indexOf("runCapture('git rev-parse HEAD')");
    const branchCheck = release.indexOf("runCapture('git branch --show-current')");
    const firstFetch = release.indexOf("run('git fetch origin main')");
    const releaseCommit = release.indexOf('run(`git commit -m "chore(release): ${version}"`)');
    const secondFetch = release.indexOf("run('git fetch origin main')", firstFetch + 1);
    const npmPublish = release.indexOf('await publishPackagePair({');

    expect(branchCheck).toBeGreaterThan(-1);
    expect(firstFetch).toBeGreaterThan(sourceSha);
    expect(firstFetch).toBeLessThan(releaseCommit);
    expect(secondFetch).toBeGreaterThan(releaseCommit);
    expect(secondFetch).toBeLessThan(npmPublish);
    expect(release).toContain("runCapture('git rev-parse origin/main') !== sourceSha");
  });

  it('does not deploy release-version docs before every package is published', () => {
    const docs = workflow('.github/workflows/deploy-docs.yml');
    const verifyRelease = job(docs, 'verify-release');

    expect(verifyRelease.if).toContain("github.event_name == 'workflow_run'");
    expect(verifyRelease.steps?.some(step =>
      step.run?.includes('v$(node -p') === true
    )).toBe(true);
  });

  it('routes catch-all and visual Playwright specs through blocking CI jobs', () => {
    const ci = workflow('.github/workflows/ci.yml');
    const matrix = job(ci, 'e2e-tests').strategy?.matrix?.include ?? [];
    const projects = new Set(matrix.map(entry => entry.project));
    const visual = job(ci, 'visual-regression');
    const visualDiagnostics = visual.steps?.find(
      step => step.name === 'Upload visual regression diagnostics'
    );
    const readiness = job(ci, 'production-readiness');

    expect(projects).toContain('chromium-default');
    expect(visual['runs-on']).toBe('macos-15');
    expect(visual.steps?.some(step =>
      step.run?.includes('BLOK_VISUAL=1') === true &&
      step.run.includes('test/playwright/tests/visual-regression')
    )).toBe(true);
    expect(visualDiagnostics?.if).toBe('failure()');
    expect(visualDiagnostics?.uses?.startsWith('actions/upload-artifact@')).toBe(true);
    expect(visualDiagnostics?.with?.name).toBe('visual-regression-${{ github.run_attempt }}');
    expect(visualDiagnostics?.with?.path).toBe('test-results/');
    expect(needsList(readiness.needs)).toContain('visual-regression');
    expect(read('playwright.config.ts')).toContain('failOnFlakyTests: true');
    expect(read('scripts/validate-test-categories.mjs')).toContain(
      'visual: extractPatterns(visualMatch)'
    );
  });

  it('ships every catch-all browser fixture in the shared build artifact', () => {
    const ci = workflow('.github/workflows/ci.yml');
    const build = job(ci, 'build');
    const fixtureBuild = build.steps?.find(step => step.name === 'Build E2E fixtures');
    const artifact = build.steps?.find(step => step.name === 'Upload build artifacts');

    for (const command of [
      'node scripts/build-react-vendor.mjs',
      'node scripts/build-vue-vendor.mjs',
      'node scripts/build-angular-vendor.mjs',
      'node scripts/override/sync.mjs',
    ]) {
      expect(fixtureBuild?.run).toContain(command);
    }
    expect(artifact?.with?.path).toContain('test/playwright/fixtures/vendor/');
    expect(artifact?.with?.path).toContain('override-extension/payload/');
  });

  it('enforces measured root and docs coverage floors in blocking CI jobs', () => {
    const rootConfig = read('vitest.config.ts');
    const docsConfig = read('docs/vitest.config.ts');
    const ci = workflow('.github/workflows/ci.yml');

    for (const [source, thresholds] of [
      [rootConfig, { statements: 85, lines: 85, functions: 84, branches: 80 }],
      [docsConfig, { statements: 78, lines: 80, functions: 80, branches: 71 }],
    ] as const) {
      expect(source).toContain('thresholds:');
      for (const [name, value] of Object.entries(thresholds)) {
        expect(source).toMatch(new RegExp(`\\b${name}: ${value}\\b`));
      }
    }

    const frontendCoverage = job(ci, 'frontend-coverage');
    const unitTests = job(ci, 'unit-tests');
    const docsQuality = job(ci, 'docs-quality');

    expect(needsList(frontendCoverage.needs)).toContain('unit-tests');
    expect(frontendCoverage.steps?.some(step =>
      step.run?.includes('--merge-reports=') === true && step.run.includes('--coverage')
    )).toBe(true);
    expect(needsList(unitTests.needs)).toContain('build');
    expect(unitTests.steps?.some(step =>
      step.run === 'yarn build:cli'
    )).toBe(true);
    expect(unitTests.steps?.some(step =>
      step.run?.includes('vitest run --coverage') === true
    )).toBe(true);
    expect(needsList(docsQuality.needs)).toContain('build');
    expect(docsQuality.steps?.some(step =>
      step.run?.includes('yarn --cwd docs test:coverage') === true
    )).toBe(true);
  });

  it('makes Storybook accessibility violations fail', () => {
    expect(read('.storybook/preview.ts')).toMatch(/test:\s*['"]error['"]/);
  });

  it('monitors both npm lockfiles and analyzes C# plus JavaScript', () => {
    const dependabot = parse(read('.github/dependabot.yml')) as Dependabot;
    const npmDirectories = new Set(
      (dependabot.updates ?? [])
        .filter(update => update['package-ecosystem'] === 'npm')
        .map(update => update.directory)
    );
    const codeql = read('.github/workflows/codeql.yml');

    expect(npmDirectories).toEqual(new Set(['/', '/docs']));
    expect(codeql).toContain('language: csharp');
    expect(codeql).toContain('language: javascript-typescript');
    expect(read('.github/workflows/ci.yml')).toContain('check-codeql-results.mjs');
  });

  it('grants Pages write access only to the deploy job', () => {
    const docs = workflow('.github/workflows/deploy-docs.yml');

    expect(docs.permissions).toEqual({ contents: 'read' });
    expect(job(docs, 'build').permissions).toEqual({
      contents: 'read',
      pages: 'read',
    });
    expect(job(docs, 'deploy').permissions).toEqual({
      pages: 'write',
      'id-token': 'write',
    });
  });

  it('pins every external GitHub Action to a full commit SHA', () => {
    const githubRoot = resolve(root, '.github');
    const yamlFiles = readdirSync(githubRoot, { recursive: true })
      .map(path => path.toString())
      .filter(path => /\.ya?ml$/.test(path));
    const unpinned = yamlFiles.flatMap(path => {
      const source = read(resolve('.github', path));
      const actions = source.matchAll(/^\s*uses:\s+([^./\s][^@\s]+)@([^\s#]+)/gm);

      return Array.from(actions)
        .filter(action => !/^[a-f0-9]{40}$/.test(action[2]))
        .map(action => `${path}: ${action[1]}@${action[2]}`);
    });

    expect(unpinned).toEqual([]);
  });

  it('cleans temporary npm credentials on every exit', () => {
    const release = read('scripts/release.mjs');

    expect(release).toContain("process.once('exit'");
    expect(release).toContain("cleanupNpmrc && existsSync('.npmrc')");
  });

  it('checks green source before releasing and publishes before git push', () => {
    const release = read('scripts/release.mjs');
    const serverRelease = read('.github/workflows/release-server.yml');
    const sourceSha = release.indexOf("runCapture('git rev-parse HEAD')");
    const localWait = release.indexOf('await waitForSuccessfulCi({');
    const sourceCheck = release.indexOf("runCapture('git status --porcelain')", localWait);
    const versionBump = release.indexOf('run(`npm version ${version}');
    const releasePreflight = release.indexOf("run('yarn release:preflight')");
    const releaseCommit = release.indexOf('run(`git commit -m "chore(release): ${version}"`)');
    const npmPublish = release.indexOf('await publishPackagePair({');
    const gitPush = release.indexOf("run('git push')");
    const gitTag = release.indexOf('run(`git tag ${gitTag}`)');
    const serverWait = serverRelease.indexOf('Wait for successful CI');
    const nugetPublish = serverRelease.indexOf('Publish NuGet packages');

    expect(sourceSha).toBeGreaterThan(-1);
    expect(localWait).toBeGreaterThan(sourceSha);
    expect(sourceCheck).toBeGreaterThan(localWait);
    expect(versionBump).toBeGreaterThan(sourceCheck);
    expect(releasePreflight).toBeGreaterThan(versionBump);
    expect(releaseCommit).toBeGreaterThan(releasePreflight);
    expect(npmPublish).toBeGreaterThan(releaseCommit);
    expect(gitTag).toBeGreaterThan(npmPublish);
    expect(gitPush).toBeGreaterThan(gitTag);
    expect(serverWait).toBeGreaterThan(-1);
    expect(serverWait).toBeLessThan(nugetPublish);
  });
});
