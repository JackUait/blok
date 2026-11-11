import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * A `var(--desktop-…)` naming a token nobody defines is not an error: the
 * declaration is simply dropped. The tab context menu shipped with
 * `background: var(--desktop-surface)` — a token that never existed — so the
 * menu rendered fully transparent, with the page showing through it.
 */
describe('desktop theme tokens', () => {
  const css = readFileSync(join(process.cwd(), 'src/shell.css'), 'utf8');

  it('defines every --desktop-* token it uses', () => {
    const defined = new Set([...css.matchAll(/^\s*(--desktop-[a-z-]+)\s*:/gm)].map((m) => m[1]));
    const used = new Set([...css.matchAll(/var\(\s*(--desktop-[a-z-]+)/g)].map((m) => m[1]));
    const missing = [...used].filter((token) => !defined.has(token)).sort();

    expect(missing, `used but never defined: ${missing.join(', ')}`).toEqual([]);
  });
});
