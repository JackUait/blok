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
    expect(body).toMatch(/box-shadow:[^;]*var\(--blok-text-primary\)/);
  });
});
