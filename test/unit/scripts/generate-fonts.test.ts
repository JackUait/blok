import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const FONTS_CSS = join(ROOT, 'src/styles/fonts.css');

const runGenerator = (): void => {
  const result = spawnSync('node', ['scripts/generate-fonts.mjs'], { cwd: ROOT });

  expect(result.status, String(result.stderr)).toBe(0);
};

describe('generate-fonts', () => {
  it('does not rewrite fonts.css when the content is unchanged', () => {
    // fonts.css lives inside src/, which the e2e build-freshness check scans:
    // a gratuitous mtime bump during every build would mark the whole source
    // tree as modified and force a full rebuild on every e2e run.
    runGenerator();
    const contentBefore = readFileSync(FONTS_CSS, 'utf8');
    const mtimeBefore = statSync(FONTS_CSS).mtimeMs;

    runGenerator();

    expect(readFileSync(FONTS_CSS, 'utf8')).toBe(contentBefore);
    expect(statSync(FONTS_CSS).mtimeMs).toBe(mtimeBefore);
  });
});
