/**
 * Database blocks must honour the PUBLIC content-width token.
 *
 * `--blok-content-max-width` is the documented host hook for the content
 * column cap, and every other consumer resolves it as
 * `var(--blok-content-max-width, var(--max-width-content))`. Database/kanban
 * blocks stretch and re-centre themselves with symmetric padding computed from
 * the cap — but they read the private `--max-width-content` directly, so a host
 * that narrowed the column kept database content centred at the untouched 720px
 * default while every other block honoured the override. Overriding the private
 * token instead is not an option: `tokens.css:1` marks it non-overridable.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const DATABASE_CSS = readFileSync(join(process.cwd(), 'src/styles/database.css'), 'utf8');

/** Every `calc((100% - <cap>) / 2)` centring expression in the file. */
const centringCaps = (): string[] =>
  Array.from(DATABASE_CSS.matchAll(/calc\(\(100% - (.+?)\) \/ 2\)/g)).map(match => match[1] ?? '');

describe('database.css content max-width', () => {
  it('has centring expressions to check', () => {
    expect(centringCaps().length).toBeGreaterThan(0);
  });

  it('resolves the cap through the public token with the private default as fallback', () => {
    for (const cap of centringCaps()) {
      expect(cap).toBe('var(--blok-content-max-width, var(--max-width-content))');
    }
  });

  it('never reads the private token without the public token in front of it', () => {
    const bareUsages = Array.from(DATABASE_CSS.matchAll(/var\(--max-width-content\)/g));
    const chainedUsages = Array.from(
      DATABASE_CSS.matchAll(/var\(--blok-content-max-width, var\(--max-width-content\)\)/g)
    );

    expect(bareUsages).toHaveLength(chainedUsages.length);
  });
});
