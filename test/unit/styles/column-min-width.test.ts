/**
 * Column shrink floor — public `--blok-column-min-width` contract.
 *
 * The floor used to be written INLINE on each column's block holder by
 * `Column.rendered()`. An inline declaration outranks every author rule
 * regardless of specificity, so a host that wanted columns to stop shrinking at
 * (say) 120px had to reach for `!important` — and even that fought a value
 * rewritten on every child mount, because rendered() re-fires each time.
 *
 * It now lives in columns.css on the same elements the inline write targeted,
 * read through a token whose fallback keeps the historical behaviour:
 * `min-width: var(--blok-column-min-width, 0)`.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

/** Body of the first rule whose selector list contains `selector`. */
const findRuleBody = (selector: string): string | null => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|,\\s*|\\s)${escaped}\\s*\\{([^}]*)\\}`, 'm'));

  return match === null ? null : match[1];
};

describe('column shrink floor', () => {
  it('declares the floor on the column holders, through a public token defaulting to 0', () => {
    const body = findRuleBody('[data-blok-columns] > [data-blok-element]');

    expect(body).not.toBeNull();
    expect(body).toMatch(/min-width:\s*var\(--blok-column-min-width,\s*0\)/);
  });

  it('does not declare a default for the token on the container', () => {
    // `--blok-column-gutter` IS declared on `[data-blok-columns]` — copying that
    // pattern here would shadow a host that sets the floor on an outer wrapper,
    // which is exactly how a host wants to scope it (per region, per layout).
    // The `var(…, 0)` fallback supplies the default instead.
    const body = findRuleBody('[data-blok-columns]');

    expect(body).not.toBeNull();
    expect(body).not.toContain('--blok-column-min-width:');
  });
});
