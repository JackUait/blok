/**
 * Emoji sections after the first skip rendering until they near the view.
 * The picker script marks them and publishes their row count
 * (test/unit/tools/callout/emoji-picker/emoji-picker-deferred-sections.test.ts);
 * the stylesheet must turn that into a size estimate, or a skipped section
 * collapses to 0px and every section-jump and scrollbar position is wrong.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss().replace(/\/\*[\s\S]*?\*\//g, '');

function declarations(selector: string): string {
  const start = css.indexOf(`${selector} {`);

  if (start < 0) {
    return '';
  }

  return css.slice(start, css.indexOf('}', start));
}

describe('emoji picker deferred sections', () => {
  const rule = declarations('[data-blok-emoji-picker] [data-emoji-section][data-emoji-section-deferred]');

  it('skips rendering marked sections until they near the view', () => {
    expect(rule).toMatch(/content-visibility:\s*auto;/);
  });

  it('sizes a skipped section from its row count and the measured cell', () => {
    const size = /contain-intrinsic-size:\s*([^;]+);/.exec(rule)?.[1] ?? '';

    expect(size).toMatch(/^auto\s+calc\(/);
    expect(size).toContain('var(--emoji-rows');
    expect(size).toContain('var(--emoji-cell');
  });

  it('gives the cell a fallback for the first layout, before it is measured', () => {
    expect(declarations('[data-blok-emoji-picker] [data-emoji-picker-body]')).toMatch(/--emoji-cell:\s*[\d.]+px;/);
  });
});

describe('emoji picker compact grid', () => {
  const picker = '[data-blok-emoji-picker]:not([data-emoji-picker-inline])';

  it('lays ten emoji across with no gaps', () => {
    const grid = declarations(`${picker} [data-emoji-grid]`);

    expect(grid).toMatch(/grid-template-columns:\s*repeat\(10,/);
    expect(grid).toMatch(/gap:\s*0;/);
  });

  it('makes rows 34px tall instead of square', () => {
    const cell = declarations(`${picker} [data-emoji-native]`);

    expect(cell).toMatch(/height:\s*34px;/);
    expect(cell).toMatch(/aspect-ratio:\s*auto;/);
  });

  it('pulls the section names closer to the rows around them', () => {
    expect(declarations(`${picker} [data-emoji-section-title]`))
      .toMatch(/padding:\s*var\(--blok-space-2\) var\(--blok-space-1-5\) var\(--blok-space-0-75\);/);
  });

  it('sizes a skipped section from the compact heading, the grid padding and gapless rows', () => {
    const size = /contain-intrinsic-size:\s*([^;]+);/.exec(declarations(`${picker} [data-emoji-section][data-emoji-section-deferred]`))?.[1] ?? '';

    expect(size.replace(/\s+/g, ' ')).toBe(
      'auto calc(var(--blok-space-2) + 18px + var(--blok-space-0-75) + var(--blok-space-1) + var(--emoji-rows, 1) * var(--emoji-cell))'
    );
  });
});
