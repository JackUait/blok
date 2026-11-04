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

  it('builds the Go binaries with go, not dotnet', () => {
    const result = runWithoutDotnet(['--target', 'go']);

    expect(result.stdout).toContain('Conformance binaries — go: ordinary build, and one with -tags conformance.');
    expect(result.stderr).toContain('spawn go ENOENT');
  });

  // Suites skip the cases a target has not ported yet by reading this.
  it('tells the suites which target they drive', () => {
    expect(read('scripts/test-server-conformance.mjs'))
      .toContain('BLOK_CONFORMANCE_TARGET: options.target,');
  });

  // Go and Rust have no Debug or Release choice here, so the flag would be silently ignored.
  it.each(['go', 'rust', 'interop-rust'])('refuses --configuration for the %s target', (target) => {
    const result = runWithoutDotnet(['--target', target, '--configuration', 'Release']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'Usage: node scripts/test-server-conformance.mjs [--target csharp|go|interop|rust|interop-rust] ' +
      '[--suite NAME]... [--test-name-pattern PATTERN] [--configuration Debug|Release (csharp and interop)]\n',
    );
  });

  // interop-rust builds Go first, then Rust, for the journal handover suite only.
  it('runs only the interop suites for --target interop-rust', () => {
    const result = runWithoutDotnet(['--target', 'interop-rust']);

    expect(result.stdout).toContain('Conformance suites: all.');
    expect(result.stderr).toContain('spawn go ENOENT');
    expect(runWithoutDotnet(['--target', 'interop-rust', '--suite', 'server-contract']).status).toBe(1);
  });

  it('builds the Rust target with cargo', () => {
    const result = runWithoutDotnet(['--target', 'rust']);

    expect(result.stdout).toContain('Conformance suites: all.');
    expect(result.stderr).toContain('spawn cargo ENOENT');
  });

  // CI runs Go on the suites it passes whole, so a name typo must not
  // quietly run nothing or everything.
  it('runs only the suites it is given', () => {
    const result = runWithoutDotnet([
      '--target', 'go', '--suite', 'server-contract', '--suite', 'routing-contract',
    ]);

    expect(result.stdout).toContain('Conformance suites: server-contract, routing-contract.');
    expect(result.stderr).toContain('spawn go ENOENT');
  });

  it('runs every suite when none is named', () => {
    expect(runWithoutDotnet(['--target', 'go']).stdout).toContain('Conformance suites: all.');
  });

  it('refuses a suite it does not have', () => {
    const result = runWithoutDotnet(['--target', 'go', '--suite', 'server-contrac']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[--suite NAME]...');
  });

  it('refuses an unknown target before any build', () => {
    const result = runWithoutDotnet(['--target', 'ruby']);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[--target csharp|go|interop|rust|interop-rust]');
  });

  // interop builds both servers for the journal handover suite and nothing else.
  it('runs only the interop suites for --target interop', () => {
    const result = runWithoutDotnet(['--target', 'interop']);

    expect(result.stdout).toContain('Conformance suites: all.');
    expect(result.stderr).toContain('spawn dotnet ENOENT');
    expect(runWithoutDotnet(['--target', 'interop', '--suite', 'journal-interop-contract']).stdout)
      .toContain('Conformance suites: journal-interop-contract.');
  });

  it('refuses a single-server suite for --target interop, and the interop suite for one server', () => {
    for (const args of [['--target', 'interop', '--suite', 'server-contract'], ['--target', 'go', '--suite', 'journal-interop-contract']]) {
      const result = runWithoutDotnet(args);

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('[--suite NAME]...');
    }
  });
});
