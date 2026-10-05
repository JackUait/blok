import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nodeDigests } from '../../scripts/source-digest.mjs';

const PAGE_DIR = 'docs/src/components/home';
const REPO_ROOT = path.resolve(__dirname, '../../..');
const strays: string[] = [];

const addStray = (name: string): void => {
  const file = path.join(REPO_ROOT, PAGE_DIR, name);
  fs.writeFileSync(file, 'local only');
  strays.push(file);
};

afterEach(() => {
  for (const file of strays.splice(0)) fs.rmSync(file, { force: true });
});

// The ledger is written on a laptop and checked in CI. A file only one of them
// has must not move a page's digest, or CI can never reproduce the ledger.
describe('source digest', () => {
  it('ignores a git-ignored file in a page folder', () => {
    const before = nodeDigests.digestSource(PAGE_DIR);
    addStray('.DS_Store');

    expect(nodeDigests.digestSource(PAGE_DIR)).toBe(before);
  });

  it('ignores deferred tests and snapshots, which are not page content', () => {
    const before = nodeDigests.digestSource(PAGE_DIR);
    addStray('Stray.test.deferred.tsx');

    expect(nodeDigests.digestSource(PAGE_DIR)).toBe(before);
  });

  it('notices an untracked page file that is not ignored', () => {
    const before = nodeDigests.digestSource(PAGE_DIR);
    addStray('NewSection.tsx');

    expect(nodeDigests.digestSource(PAGE_DIR)).not.toBe(before);
  });
});
