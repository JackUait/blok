// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

type MatrixValue = string | number | boolean;

type Workflow = {
  jobs?: Record<string, {
    strategy?: { matrix?: { include?: Array<Record<string, MatrixValue>> } };
    steps?: Array<{ run?: string }>;
  }>;
};

type McpRun = { target?: string; suites: string[]; filtered: boolean };

const repoRoot = resolve(__dirname, '../../..');
const TARGETS = ['node', 'csharp', 'go', 'rust'];

/** The suites the runner registers, from its own usage text. */
const runnerSuites = (): string[] => {
  const result = spawnSync(process.execPath, [resolve(repoRoot, 'scripts/test-mcp-conformance.mjs'), '--target', 'java'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
    timeout: 30_000,
  });
  const line = /^Suites: (.+)\.$/m.exec(result.stderr)?.[1] ?? '';

  return line.split(', ').filter(Boolean).sort();
};

const SUITES = runnerSuites();

// Each test file is one suite; a file the runner does not register never runs.
const SUITE_FILES = readdirSync(resolve(repoRoot, 'test/unit/mcp-conformance'))
  .filter((name) => name.endsWith('.test.ts'))
  .map((name) => name.slice(0, -'.test.ts'.length))
  .sort();

/** Splits a run line into words, keeping a quoted word whole. */
const words = (line: string): string[] =>
  [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);

const parseRun = (line: string): McpRun => {
  const args = words(line).slice(2);
  const valueOf = (flag: string): string[] =>
    args.flatMap((arg, index) => (arg === flag ? [args[index + 1]] : []));

  return {
    target: valueOf('--target')[0],
    suites: valueOf('--suite'),
    filtered: args.includes('--test-name-pattern') || args.includes('--update'),
  };
};

/** Every MCP conformance run in the workflow, with each matrix entry expanded. */
const mcpRuns = (workflowText: string): McpRun[] => {
  const workflow = parse(workflowText) as Workflow;

  return Object.values(workflow.jobs ?? {}).flatMap((job) => {
    const entries = job.strategy?.matrix?.include ?? [{}];

    return entries.flatMap((entry) => (job.steps ?? [])
      .flatMap((step) => step.run === undefined ? [] : step.run.split('\n'))
      .map((line) => line.trim())
      .filter((line) => line.startsWith('node scripts/test-mcp-conformance.mjs'))
      .map((line) => line.replaceAll(/\$\{\{\s*matrix\.([\w-]+)\s*\}\}/g, (_, key: string) => String(entry[key] ?? '')))
      .map(parseRun));
  });
};

/** The suites CI runs for a target. A run with no --suite runs them all. */
const suitesRunFor = (runs: McpRun[], target: string): string[] => [
  ...new Set(runs
    .filter((run) => run.target === target && !run.filtered)
    .flatMap((run) => (run.suites.length === 0 ? SUITES : run.suites))),
].sort();

const ciText = (): string => readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');

describe('MCP conformance CI law', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the runner suites, and every suite file is one of them', () => {
    expect(SUITES).toContain('live');
    expect(SUITES).toEqual(SUITE_FILES);
  });

  it.each(TARGETS)('runs every MCP conformance suite on %s in CI', (target) => {
    expect(suitesRunFor(mcpRuns(ciText()), target)).toEqual(SUITES);
  });

  it('runs no MCP conformance with a name filter or --update', () => {
    expect(mcpRuns(ciText()).filter((run) => run.filtered)).toEqual([]);
  });

  it('runs no target the runner does not know', () => {
    const unknown = mcpRuns(ciText()).filter((run) => run.target === undefined || !TARGETS.includes(run.target));

    expect(unknown).toEqual([]);
  });

  describe('catches controlled mutations', () => {
    const ciWith = (steps: string[], include?: string): string => [
      'jobs:',
      '  a:',
      ...(include === undefined ? [] : ['    strategy:', '      matrix:', '        include:', include]),
      '    steps:',
      ...steps,
      '',
    ].join('\n');

    it('a missing target', () => {
      expect(suitesRunFor(mcpRuns(ciWith(['      - run: echo hi'])), 'go')).toEqual([]);
    });

    it('a step that is only a comment', () => {
      expect(suitesRunFor(mcpRuns(ciWith([
        '      # - run: node scripts/test-mcp-conformance.mjs --target go',
        '      - run: echo hi',
      ])), 'go')).toEqual([]);
    });

    it('a step narrowed by a name pattern', () => {
      expect(suitesRunFor(mcpRuns(ciWith([
        "      - run: node scripts/test-mcp-conformance.mjs --target go --test-name-pattern 'stdio exits'",
      ])), 'go')).toEqual([]);
    });

    it('a step narrowed to some suites', () => {
      expect(suitesRunFor(mcpRuns(ciWith([
        '      - run: node scripts/test-mcp-conformance.mjs --target go --suite live',
      ])), 'go')).toEqual(['live']);
    });

    it('a full step, with a host', () => {
      expect(suitesRunFor(mcpRuns(ciWith([
        '      - run: node scripts/test-mcp-conformance.mjs --target go --host go',
      ])), 'go')).toEqual(SUITES);
    });

    it('a matrix that splits one target into parts', () => {
      const [first, second] = [SUITES.slice(0, 4), SUITES.slice(4)];
      const text = ciWith(
        ['      - run: node scripts/test-mcp-conformance.mjs --target ${{ matrix.target }} ${{ matrix.suites }}'],
        [
          `          - { target: csharp, suites: '${first.map((suite) => `--suite ${suite}`).join(' ')}' }`,
          `          - { target: csharp, suites: '${second.map((suite) => `--suite ${suite}`).join(' ')}' }`,
          "          - { target: go, suites: '' }",
        ].join('\n'),
      );

      expect(suitesRunFor(mcpRuns(text), 'csharp')).toEqual(SUITES);
      expect(suitesRunFor(mcpRuns(text), 'go')).toEqual(SUITES);
      expect(suitesRunFor(mcpRuns(text.replace(first.map((suite) => `--suite ${suite}`).join(' '), '--suite live')), 'csharp'))
        .not.toEqual(SUITES);
    });
  });
});
