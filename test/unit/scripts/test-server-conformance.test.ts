// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const runnerPath = resolve(repoRoot, 'scripts/test-server-conformance.mjs');
const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8');

/** Runs the runner far enough to parse options and announce, never far enough to build. */
const runWithoutDotnet = (
  args: string[],
): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [runnerPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    // No PATH means the `dotnet` spawn fails, so the build never happens.
    env: { ...process.env, PATH: '' },
  });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

describe('test-server-conformance', () => {
  // A command-line `-p:DefineConstants=X` is a GLOBAL property: it replaces the
  // configuration's own DEBUG/TRACE rather than adding to them, so the journal
  // host would be built with DEBUG undefined and every Debug.Assert compiled
  // out of the binary the durability proofs drive.
  it('adds the conformance constant without dropping the configuration\'s own', () => {
    expect(read('scripts/test-server-conformance.mjs')).not.toContain('-p:DefineConstants=');

    // Directory-scoped, never project-local: the seam spans Blok.Server.Host and
    // Blok.Server.AspNetCore, and the old global property reached both by
    // accident. An append in one .csproj leaves the referenced project without
    // the constant and its extension methods stop compiling.
    expect(read('packages/server/dotnet/Directory.Build.props'))
      .toContain('<DefineConstants>$(DefineConstants);BLOK_SERVER_CONFORMANCE</DefineConstants>');
  });

  it('builds the journal host in the requested configuration', () => {
    const release = runWithoutDotnet(['--target', 'csharp', '--configuration', 'Release']);

    expect(release.stdout).toContain('journal host: Release');

    const fallback = runWithoutDotnet(['--target', 'csharp']);

    expect(fallback.stdout).toContain('journal host: Debug');
  });

  it('names the ordinary host configuration too, so neither can be assumed', () => {
    expect(runWithoutDotnet(['--target', 'csharp']).stdout).toContain('ordinary host: Release');
  });

  it('refuses a configuration it cannot build', () => {
    const result = runWithoutDotnet(['--target', 'csharp', '--configuration', 'Fastest']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('--configuration Debug|Release');
  });
});
