/**
 * The property-type option icon is a bare glyph in a fixed box: no tinted
 * chip behind it, at rest or on row hover, like every other menu icon.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const findRuleBody = (source: string, selector: string): string | null => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|,\\s*|\\s)${escaped}\\s*\\{([^}]*)\\}`, 'm');
  const match = source.match(pattern);

  return match === null ? null : match[1];
};

describe('Database property-type option icon (src/styles/database.css)', () => {
  it('has no background chip at rest', () => {
    const body = findRuleBody(css, '[data-blok-database-property-type-option-icon]');

    expect(body).not.toBeNull();
    expect(body).not.toMatch(/background/);
  });

  it('has no background chip on row hover', () => {
    const body = findRuleBody(
      css,
      '[data-blok-database-property-type-option]:hover [data-blok-database-property-type-option-icon]'
    );

    expect(body).not.toBeNull();
    expect(body).not.toMatch(/background/);
  });
});
