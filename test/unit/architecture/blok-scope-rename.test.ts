import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Legacy-name law: after the @blok/* rebrand, the only places allowed to
 * mention @jackuait/* are migration artifacts (the legacy grammar the codemod
 * rewrites FROM, codemod fixtures), historical changelogs, and the release
 * deprecation runbook. Everything else must use the @blok/* family names.
 */
const ALLOWLIST: RegExp[] = [
  /^CHANGELOG\.md$/,
  /^packages\/cli\/CHANGELOG\.md$/,
  /^src\/cli\/.*legacy/,
  /^src\/cli\/codemod\//,
  /^packages\/cli\/(test\/)?fixtures\//,
  /^docs\/superpowers\//,
  /^scripts\/deprecate-legacy\.mjs$/,
  // Dropped to specific migration-doc paths in the final rebrand task:
  /^docs\//,
];

describe('@blok scope rename', () => {
  it('root package is @blok/core', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { name: string };

    expect(pkg.name).toBe('@blok/core');
  });

  it('has no stray @jackuait/ references outside the allowlist', () => {
    let files: string[] = [];

    try {
      files = execFileSync('git', ['grep', '-l', '@jackuait/'], { encoding: 'utf-8' })
        .split('\n')
        .filter(Boolean);
    } catch {
      // git grep exits 1 when there are no matches at all — that's a pass
    }

    const strays = files.filter((file) => !ALLOWLIST.some((pattern) => pattern.test(file)));

    expect(strays).toEqual([]);
  });
});
