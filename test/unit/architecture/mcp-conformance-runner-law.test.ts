// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = resolve(__dirname, '../../..');
const runnerPath = resolve(repoRoot, 'scripts/test-mcp-conformance.mjs');
const fixturesDir = resolve(repoRoot, 'test/unit/mcp-conformance/fixtures');

type RunnerResult = { status: number | null; stderr: string };

// No PATH: a port target cannot reach its toolchain, and node is never built here.
const runRunner = (args: string[]): RunnerResult => {
  const result = spawnSync(process.execPath, [runnerPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, PATH: '' },
    timeout: 30_000,
  });

  return { status: result.status, stderr: result.stderr };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

describe('MCP conformance runner law', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints usage for an unknown target', () => {
    const result = runRunner(['--target', 'java']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage: node scripts/test-mcp-conformance.mjs');
  });

  it('refuses --update for any target but node, the oracle', () => {
    const result = runRunner(['--target', 'go', '--update']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Usage:');
  });

  // A port that does not exist yet must fail fast with a message naming what to build.
  it.each([
    ['csharp', 'packages/server/dotnet/Blok.Mcp/Blok.Mcp.csproj'],
  ])('fails clearly, without hanging, while the %s target is missing', (target, names) => {
    const result = runRunner(['--target', target]);

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('Usage:');
    expect(result.stderr).toContain(`The ${target} MCP target`);
    expect(result.stderr).toContain(names);
  });

  // A built port is found and built with its own toolchain; with no PATH that spawn fails by name.
  it.each([
    ['rust', 'cargo'],
  ])('finds the %s target and builds it with %s', (target, toolchain) => {
    const result = runRunner(['--target', target]);

    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain('Usage:');
    expect(result.stderr).not.toContain(`The ${target} MCP target`);
    expect(result.stderr).toContain(`spawn ${toolchain} ENOENT`);
  });

  it('keeps one case per entry with a unique name in every fixture file', () => {
    const files = readdirSync(fixturesDir).filter((name) => name.endsWith('.json'));

    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const parsed: unknown = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8'));
      const cases = isRecord(parsed) && Array.isArray(parsed.cases) ? parsed.cases : [];
      const names = cases.map((c: unknown) => (isRecord(c) ? c.name : undefined));

      expect(cases.length, `${file} has no cases`).toBeGreaterThan(0);
      expect(names.every((name) => typeof name === 'string'), `${file}: a case has no name`).toBe(true);
      expect(new Set(names).size, `${file}: case names repeat`).toBe(names.length);
    }
  });
});
