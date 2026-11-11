/**
 * A nested block's depth margin narrows its holder. A centred or right-aligned
 * column placed in that holder would move half a step or not at all, so it is
 * sized from the un-indented width. Pixels: undo-audit/w5-toggle-kid.spec.ts.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const css = readMainCss().replace(/\/\*[\s\S]*?\*\//g, '');

const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector, body }));

const rulesFor = (selectorPart: string): string[] => rules
  .filter(({ selector }) => selector.includes(selectorPart) && selector.includes('[data-blok-element-content]'))
  .map(({ body }) => body);

describe('nested indent in a centred or right-aligned column', () => {
  it('narrows the column by the indent so the text moves one full step', () => {
    for (const align of ['[data-blok-content-align="center"]', '[data-blok-content-align="right"]']) {
      const bodies = rulesFor(align).join('\n');

      expect(bodies, align).toMatch(/max-width:\s*calc\(min\([^;]*100%\s*\+\s*var\(--_blok-indent\)\)\s*-\s*var\(--_blok-indent\)\)/);
    }
  });

  it('centres the column in the un-indented width', () => {
    const bodies = rulesFor('[data-blok-content-align="center"]').join('\n');

    expect(bodies).toMatch(/margin-(?:left|right):\s*max\(0px,\s*\(100%\s*\+\s*var\(--_blok-indent\)/);
  });

  it('derives the indent from the same depth and slot terms as the holder margin', () => {
    const bodies = rulesFor('[data-blok-content-align="center"]').join('\n');

    expect(bodies).toMatch(
      /--_blok-indent:\s*calc\(var\(--_blok-block-depth,\s*0\)\s*\*\s*var\(--blok-block-indent-step,\s*24px\)\s*\+\s*var\(--_blok-slot-depth,\s*0\)\s*\*\s*var\(--_blok-slot-indent-step,\s*0px\)\)/
    );
  });

  it('matches only nested holders, and never full width or stretched blocks', () => {
    const selectors = rules.filter(({ body }) => body.includes('--_blok-indent:')).map(({ selector }) => selector);

    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector).toContain(':not([data-blok-width="full"])');
      expect(selector).toContain(':not([data-blok-stretched="true"])');
      expect(selector).toContain('[data-blok-depth]:not([data-blok-depth="0"])');
    }
  });
});
