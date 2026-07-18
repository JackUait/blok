import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Regression guard for the 1.2.3 release breakage: release.mjs rewrites the
 * "@bloklabs/core" peerDependencies range in the workspace manifests, but the
 * script neither refreshed yarn.lock nor committed it — so every CI job on the
 * release commit died at `yarn install --immutable` (YN0028 lockfile drift).
 *
 * These are static scans of the script source (same pattern as the
 * architecture law tests) because main() shells out and cannot run in vitest.
 */
describe('release.mjs lockfile sync', () => {
  const source = readFileSync(join(__dirname, '../../../scripts/release.mjs'), 'utf-8');

  it('refreshes yarn.lock after bumping workspace manifests', () => {
    const bumpIndex = source.indexOf("manifest.peerDependencies['@bloklabs/core']");
    const syncIndex = source.indexOf('yarn install --mode=update-lockfile');

    expect(bumpIndex).toBeGreaterThan(-1);
    expect(syncIndex).toBeGreaterThan(bumpIndex);
  });

  it('commits yarn.lock together with the bumped manifests', () => {
    expect(source).toMatch(/git add [^\n]*yarn\.lock/);
  });

  it('restores yarn.lock on dry runs', () => {
    expect(source).toMatch(/git checkout -- [^\n]*yarn\.lock/);
  });
});
