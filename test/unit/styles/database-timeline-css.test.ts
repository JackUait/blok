/**
 * Timeline look: measured Notion values (research/07, research/08), tokens kept
 * out of colors.css, logical properties and reduced motion. jsdom has no CSS,
 * so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const colors = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8');

/** Body of every rule whose selector list holds `selector`, joined. */
const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2] ?? '')
    .join(';');

const timelineStart = css.indexOf('[data-blok-database-timeline] {');
const timelineCss = css.slice(timelineStart, css.indexOf('[data-blok-database-card]:focus-visible', timelineStart));

const TOKENS = [
  '--blok-database-timeline-bar-bg',
  '--blok-database-timeline-bar-shadow',
  '--blok-database-timeline-grid-line',
  '--blok-database-timeline-header-line',
  '--blok-database-timeline-weekend-bg',
  '--blok-database-timeline-muted-text',
  '--blok-database-timeline-text',
  '--blok-database-timeline-control-text',
  '--blok-database-timeline-arrow-bg',
  '--blok-database-timeline-arrow-icon',
];

describe('database timeline styles', () => {
  it.each(TOKENS)('%s is defined for light, system dark and forced dark, and not in colors.css', (token) => {
    expect(css.match(new RegExp(`${token}:`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(colors).not.toContain(`${token}:`);
  });

  it('uses the measured light values', () => {
    expect(css).toContain('--blok-database-timeline-bar-shadow: rgba(0, 0, 0, 0.04) 0 2px 4px 0, rgba(42, 28, 0, 0.07) 0 0 0 1px;');
    expect(css).toContain('--blok-database-timeline-weekend-bg: rgb(247, 247, 247);');
    expect(css).toContain('--blok-database-timeline-arrow-bg: rgb(142, 139, 134);');
  });

  it('draws 34px bars with a 6px radius in 36px rows', () => {
    expect(ruleBody('[data-blok-database-timeline-row]')).toMatch(/block-size:\s*36px/);
    expect(ruleBody('[data-blok-database-timeline-bar]')).toMatch(/block-size:\s*34px/);
    expect(ruleBody('[data-blok-database-timeline-bar]')).toContain('border-radius: var(--blok-radius-control)');
    expect(ruleBody('[data-blok-database-timeline-bar]')).toContain('box-shadow: var(--blok-database-timeline-bar-shadow)');
    expect(ruleBody('[data-blok-database-timeline-bar-title]')).toMatch(/font-size:\s*14px/);
    expect(ruleBody('[data-blok-database-timeline-bar-title]')).toMatch(/font-weight:\s*500/);
  });

  it('draws the measured today marker and off-screen arrow', () => {
    expect(ruleBody('[data-blok-database-timeline-today-dot]')).toMatch(/inline-size:\s*22px/);
    expect(ruleBody('[data-blok-database-timeline-today-dot]')).toContain('background-color: var(--blok-database-today)');
    expect(ruleBody('[data-blok-database-timeline-today-line]')).toMatch(/inline-size:\s*1px/);
    expect(ruleBody('[data-blok-database-timeline-offscreen]')).toMatch(/inline-size:\s*16px/);
    expect(ruleBody('[data-blok-database-timeline-offscreen]')).toContain('border-radius: var(--blok-radius-control-sm)');
  });

  it('hides an off-screen arrow that the view marks hidden', () => {
    expect(ruleBody('[data-blok-database-timeline-offscreen][hidden]')).toMatch(/display:\s*none/);
  });

  it('uses logical properties only', () => {
    expect(timelineCss).not.toMatch(/(?:^|[\s;{])(?:left|right|margin-left|margin-right|padding-left|padding-right)\s*:/);
  });

  it('turns every timeline transition off under reduced motion', () => {
    const reduced = timelineCss.slice(timelineCss.lastIndexOf('@media (prefers-reduced-motion: reduce)'));

    expect(timelineCss).toContain('transition');
    for (const selector of ['[data-blok-database-timeline-bar]', '[data-blok-database-timeline-row-handle]']) {
      expect(reduced).toContain(selector);
    }
    expect(reduced).toMatch(/transition:\s*none/);
  });
});

/** The token's value in the media-query dark block, then the theme-attribute copy. */
const darkValues = (name: string): string[] =>
  Array.from(css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))).map((m) => (m[1] ?? '').trim()).slice(1);

describe('timeline in dark (research/21 §1i)', () => {
  it.each([
    ['--blok-database-timeline-header-line', 'rgb(56, 56, 54)'],
    ['--blok-database-timeline-weekend-bg', 'rgba(255, 255, 255, 0.03)'],
    ['--blok-database-timeline-muted-text', 'rgb(125, 122, 117)'],
    ['--blok-database-timeline-bar-bg', 'rgb(37, 37, 37)'],
    ['--blok-database-timeline-bar-shadow', 'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px'],
    ['--blok-database-timeline-arrow-bg', 'rgb(173, 169, 163)'],
  ])('%s is %s in both dark blocks', (token, value) => {
    expect(darkValues(token)).toEqual([value, value]);
  });

  it('keeps the today chip digit white in dark', () => {
    expect(ruleBody('[data-blok-database-timeline-today-dot]')).toContain('color: var(--blok-database-calendar-today-text)');
    expect(darkValues('--blok-database-calendar-today-text')).toEqual(['#ffffff', '#ffffff']);
  });
});
