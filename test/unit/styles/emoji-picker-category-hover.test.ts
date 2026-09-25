/**
 * Category buttons show hover with colour only. The icon stays put: a
 * one-pixel hop per button reads as jitter when the pointer sweeps the row.
 */
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

describe('emoji picker category hover', () => {
  it('never moves a category icon on hover', () => {
    const moves: string[] = [];
    let hoverRules = 0;

    postcss.parse(readMainCss()).walkRules(rule => {
      if (!rule.selector.includes('[data-emoji-nav]:hover')) {
        return;
      }
      hoverRules++;
      rule.walkDecls(/^(transform|translate|scale)$/, declaration => {
        moves.push(`${rule.selector} { ${declaration.toString()} }`);
      });
    });

    expect(hoverRules).toBeGreaterThan(0);
    expect(moves).toEqual([]);
  });
});
