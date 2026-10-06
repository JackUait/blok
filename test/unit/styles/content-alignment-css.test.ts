/**
 * Static analysis of the contentAlign rules.
 *
 * Block content elements carry Tailwind's `mx-auto` (both margins auto), so
 * each alignment rule must fully determine BOTH horizontal margins. A rule
 * that only sets `margin-left: auto` inherits `margin-right: auto` from the
 * base class and collapses into centering — which is how `right` alignment
 * silently rendered identical to `center`.
 */
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '');

const css = stripComments(readMainCss());

const ruleBody = (align: string): string => {
  const match = css.match(
    new RegExp(`\\[data-blok-content-align="${align}"\\][^{]*\\{([^}]*)\\}`)
  );

  if (match === null) {
    throw new Error(`no rule found for contentAlign "${align}"`);
  }

  return match[1];
};

describe('content alignment CSS', () => {
  it('left pins the content to the left edge', () => {
    expect(ruleBody('left')).toMatch(/margin-left:\s*0/);
  });

  it('center sets both horizontal margins to auto', () => {
    const body = ruleBody('center');
    expect(body).toMatch(/margin-left:\s*auto/);
    expect(body).toMatch(/margin-right:\s*auto/);
  });

  it('right zeroes margin-right so it does not collapse into centering', () => {
    const body = ruleBody('right');
    expect(body).toMatch(/margin-left:\s*auto/);
    expect(body).toMatch(/margin-right:\s*0/);
  });

  describe('in an RTL editor', () => {
    // Keyed on the wrapper, not logical margins on the content: each block's
    // content carries its own dir, and the column follows the editor's.
    const rtlRuleBody = (align: string): string => {
      const match = css.match(
        new RegExp(`\\[data-blok-rtl="true"\\]\\[data-blok-content-align="${align}"\\] \\[data-blok-element-content\\]\\s*\\{([^}]*)\\}`)
      );

      if (match === null) {
        throw new Error(`no RTL rule found for contentAlign "${align}"`);
      }

      return match[1];
    };

    it('left pins the content to the right (inline-start) edge', () => {
      const body = rtlRuleBody('left');
      expect(body).toMatch(/margin-left:\s*auto/);
      expect(body).toMatch(/margin-right:\s*0/);
    });

    it('right pins the content to the left (inline-end) edge', () => {
      const body = rtlRuleBody('right');
      expect(body).toMatch(/margin-left:\s*0/);
      expect(body).toMatch(/margin-right:\s*auto/);
    });

    it('never uses logical margins, which would follow each block\'s own dir', () => {
      expect(css).not.toMatch(/\[data-blok-content-align="(left|right)"\][^{]*\{[^}]*margin-inline/);
    });
  });
});
