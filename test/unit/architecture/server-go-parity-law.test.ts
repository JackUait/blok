// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

type Workflow = {
  jobs?: Record<string, { steps?: Array<{ run?: string }> }>;
};

const repoRoot = resolve(__dirname, '../../..');
const runnerPath = resolve(repoRoot, 'scripts/test-server-conformance.mjs');
const GO_MODULE_PATH = 'github.com/JackUait/blok/packages/server/go';
const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8');

/** The module line of go.mod, or undefined when there is none. */
const goModulePath = (goMod: string): string | undefined =>
  /^module\s+(\S+)\s*$/m.exec(goMod)?.[1];

/** Every `--target X` the workflow's run steps pass to the conformance runner. */
const conformanceTargets = (workflowText: string): string[] => {
  const workflow = parse(workflowText) as Workflow;
  const runs = Object.values(workflow.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .flatMap((step) => step.run === undefined ? [] : [step.run]);

  return runs.flatMap((run) => [
    ...run.matchAll(/node scripts\/test-server-conformance\.mjs --target (\S+)/g),
  ].map((match) => match[1]));
};

type RunnerResult = { status: number | null; stdout: string; stderr: string };

const TOOLCHAINS: Record<string, string> = { csharp: 'dotnet', go: 'go' };

/**
 * With no PATH the build spawn fails, so a runner that accepted the target
 * reports its own toolchain as missing instead of printing usage.
 */
const runnerAccepts = (target: string, result: RunnerResult): boolean =>
  !result.stderr.includes('Usage:') &&
  result.stderr.includes(`spawn ${TOOLCHAINS[target]} ENOENT`);

/** Runs a runner with no PATH, so it parses and announces but cannot build. */
const runRunner = (path: string, args: string[]): RunnerResult => {
  const result = spawnSync(process.execPath, [path, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
  });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe('server Go and C# parity law', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has the Go module and its server command', () => {
    const goMod = resolve(repoRoot, 'packages/server/go/go.mod');

    expect(existsSync(goMod)).toBe(true);
    expect(goModulePath(readFileSync(goMod, 'utf8'))).toBe(GO_MODULE_PATH);
    expect(existsSync(resolve(repoRoot, 'packages/server/go/cmd/blok-server/main.go'))).toBe(true);
  });

  it('runs conformance for both targets in CI', () => {
    const targets = conformanceTargets(read('.github/workflows/ci.yml'));

    expect(targets).toContain('csharp');
    expect(targets).toContain('go');
  });

  it.each(['csharp', 'go'])('lets the runner accept --target %s', (target) => {
    expect(runnerAccepts(target, runRunner(runnerPath, ['--target', target]))).toBe(true);
  });

  // The old Go release named its archives `blok-server_<os>_<arch>`, the names
  // the npm wrapper downloads. A goreleaser default would swap its C# binary.
  it('ships no goreleaser config', () => {
    const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
    const config = ['.gore', 'leaser'].join('');

    expect(tracked.filter((path) => path.split('/').at(-1)?.startsWith(config))).toEqual([]);
  });

  describe('catches controlled mutations', () => {
    const ciWith = (run: string): string => [
      'jobs:',
      '  a:',
      '    steps:',
      '      - run: node scripts/test-server-conformance.mjs --target csharp',
      run,
      '',
    ].join('\n');

    it('a missing go conformance step', () => {
      expect(conformanceTargets(ciWith(''))).not.toContain('go');
    });

    it('a go conformance step that is only a comment', () => {
      expect(conformanceTargets(ciWith(
        '      # - run: node scripts/test-server-conformance.mjs --target go',
      ))).not.toContain('go');
    });

    it('a go conformance step that is present', () => {
      expect(conformanceTargets(ciWith(
        '      - run: node scripts/test-server-conformance.mjs --target go --test-name-pattern health',
      ))).toContain('go');
    });

    it('a wrong or missing module path', () => {
      expect(goModulePath('module github.com/JackUait/blok/packages/server\n')).not.toBe(GO_MODULE_PATH);
      expect(goModulePath('go 1.27.1\n')).toBeUndefined();
      expect(goModulePath(`module ${GO_MODULE_PATH}\n\ngo 1.27.1\n`)).toBe(GO_MODULE_PATH);
    });

    it('a runner that refuses go', () => {
      const directory = mkdtempSync(join(tmpdir(), 'blok-parity-runner-'));
      const fake = join(directory, 'runner.mjs');

      try {
        writeFileSync(fake, [
          "if (process.argv.includes('go')) {",
          "  console.error('Usage: node scripts/test-server-conformance.mjs [--target csharp]');",
          '  process.exit(1);',
          '}',
          "console.error('spawn dotnet ENOENT');",
          'process.exit(1);',
          '',
        ].join('\n'));

        expect(runnerAccepts('go', runRunner(fake, ['--target', 'go']))).toBe(false);
        expect(runnerAccepts('csharp', runRunner(fake, ['--target', 'csharp']))).toBe(true);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });
});
