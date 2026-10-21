import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

/**
 * Customize chips and view cards (research/27 §1b) ring a pick in blue in
 * Notion. Blok marks it with primary ink only (CLAUDE.md "No blue selected states").
 */
const css = readMainCss();

const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);

  if (at < 0) throw new Error(`no rule ${selector}`);

  return css.slice(at, css.indexOf('}', at));
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('starter Customize picks are neutral', () => {
  it.each(['[data-blok-database-starter-chip][aria-pressed="true"]', '[data-blok-database-starter-card][aria-pressed="true"]'])('%s has no fill and no ink of its own, and rings in primary ink', (selector) => {
    const body = rule(selector);

    expect(body).not.toMatch(/background/);
    expect(body).not.toMatch(/(^|[\s;{])color:/);
    expect(body).toMatch(/box-shadow:[^;]*var\(--blok-database-ink\)/);
  });
});

describe('the database icon a template gives (research/27:42)', () => {
  it('is a 21x21 tile, radius 4px, tinted with the Suggested tile tokens', () => {
    const body = rule('[data-blok-database-icon]');

    expect(body).toMatch(/inline-size:\s*21px/);
    expect(body).toMatch(/block-size:\s*21px/);
    expect(body).toContain('border-radius: var(--blok-radius-control-sm)');
    for (const tint of ['green', 'blue', 'gray']) {
      const tinted = rule(`[data-blok-database-icon="${tint}"]`);

      expect(tinted).toContain(`var(--blok-database-starter-tile-${tint}-bg)`);
      expect(tinted).toContain(`var(--blok-database-starter-tile-${tint}-ink)`);
    }
  });

  it('the template menu\'s "Default" reads in secondary ink, no fill', () => {
    const body = rule('[data-blok-database-template-default]');

    expect(body).toContain('var(--blok-database-ink-secondary)');
    expect(body).not.toMatch(/background/);
  });
});

describe('a template\'s database icon sits right before the title', () => {
  // With tabs the title carries the centring offset itself, so the icon took it over (research/27:42).
  it('the icon takes the content offset and the title after it drops its own', () => {
    expect(rule('[data-blok-database-icon]')).toMatch(/margin-inline-start: max\(0px, calc\(\(100% - var\(--blok-content-max-width, var\(--max-width-content\)\)\) \/ 2\)\)/);
    expect(rule('[data-blok-database-icon] + [data-blok-database-title]')).toMatch(/padding-inline-start: 0/);
    expect(rule('[data-blok-database-title-row][data-single-view] [data-blok-database-icon]')).toMatch(/margin-inline-start: 0/);
  });
});
