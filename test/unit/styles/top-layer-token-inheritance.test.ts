/**
 * A top-layer element that stays inside the editor (the database side and
 * center peeks) must inherit the editor's tokens. If the palette re-declared
 * them on it, a host's `[data-blok-interface] { --blok-*: … }` override would
 * stop at the peek (measured: the peek went back to white while the editor
 * was themed red). Elements portaled to body still get the palette.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SHEETS = ['src/styles/colors.css', 'src/styles/database.css', 'src/styles/popover-animation.css'];

/** Every `[data-blok-top-layer]` that a palette `:where(...)` selector list declares tokens on. */
const tokenScopes = (css: string): string[] =>
  Array.from(css.matchAll(/:where\(([^{}]*?\[data-blok-top-layer\][^{}]*?)\)\s*(?:,|\{)/g)).map((match) => match[1] ?? '');

describe('top-layer token inheritance', () => {
  it.each(SHEETS)('%s declares palette tokens only on top-layer elements outside an editor', (sheet) => {
    const scopes = tokenScopes(readFileSync(join(process.cwd(), sheet), 'utf8'));

    expect(scopes.length).toBeGreaterThan(0);
    scopes.forEach((scope) => {
      expect(scope).toMatch(/\[data-blok-top-layer\]:not\(\[data-blok-interface\] \*\)$/);
    });
  });
});
