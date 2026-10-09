/**
 * Gallery and calendar look: measured Notion values (research/07, research/08),
 * tokens kept out of colors.css, logical properties and reduced motion.
 * jsdom has no CSS, so these read the authored source.
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

const section = (start: string, end: string): string => css.slice(css.indexOf(start), css.indexOf(end));

const galleryCss = section('[data-blok-database-gallery] {', '/* ─── Calendar ─── */');
const calendarCss = css.slice(css.indexOf('[data-blok-database-calendar] {'));

const TOKENS = [
  '--blok-database-gallery-card-bg',
  '--blok-database-gallery-card-shadow',
  '--blok-database-gallery-card-hover-bg',
  '--blok-database-gallery-preview-bg',
  '--blok-database-gallery-preview-border',
  '--blok-database-gallery-preview-text',
  '--blok-database-gallery-title-text',
  '--blok-database-gallery-muted-text',
  '--blok-database-calendar-border',
  '--blok-database-calendar-weekend-bg',
  '--blok-database-calendar-muted-text',
  '--blok-database-calendar-day-text',
  '--blok-database-calendar-nav-icon',
  '--blok-database-calendar-event-bg',
  '--blok-database-calendar-event-shadow',
  '--blok-database-calendar-event-hover-bg',
  '--blok-database-calendar-today-text',
];

describe('database gallery and calendar styles', () => {
  it.each(TOKENS)('%s is defined for light, system dark and forced dark, and not in colors.css', (token) => {
    expect(css.match(new RegExp(`${token}:`, 'g'))?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(colors).not.toContain(`${token}:`);
  });

  it('uses the measured gallery grid gap, cover height and title type', () => {
    expect(ruleBody('[data-blok-database-gallery-grid]')).toContain('gap: var(--blok-space-4)');
    expect(ruleBody('[data-blok-database-gallery][data-card-size="medium"]')).toMatch(/--blok-database-gallery-preview-height:\s*146px/);
    expect(ruleBody('[data-blok-database-gallery-preview]')).toContain('block-size: var(--blok-database-gallery-preview-height)');
    expect(ruleBody('[data-blok-database-gallery-title]')).toMatch(/font-size:\s*15px/);
    expect(ruleBody('[data-blok-database-gallery-title]')).toMatch(/font-weight:\s*500/);
  });

  it('crops images unless Fit image is on', () => {
    expect(ruleBody('[data-blok-database-gallery-image]')).toMatch(/object-fit:\s*cover/);
    expect(ruleBody('[data-blok-database-gallery][data-fit-image] [data-blok-database-gallery-image]')).toMatch(/object-fit:\s*contain/);
  });

  it('sizes the grid per card size', () => {
    for (const size of ['small', 'medium', 'large']) {
      expect(ruleBody(`[data-blok-database-gallery][data-card-size="${size}"]`)).toContain('--blok-database-gallery-card-min');
    }
  });

  it('uses the measured calendar sizes: 140px day cells, 28px event cards, 24px today circle', () => {
    expect(ruleBody('[data-blok-database-calendar-day]')).toMatch(/140px/);
    expect(ruleBody('[data-blok-database-calendar-event]')).toMatch(/height:\s*28px/);
    expect(ruleBody('[data-blok-database-calendar-event-title]')).toMatch(/font-weight:\s*600/);
    expect(ruleBody('[data-blok-database-calendar-day][data-today] [data-blok-database-calendar-day-number]')).toContain('var(--blok-database-today)');
  });

  it('paints a drop target gray, never blue (D3)', () => {
    const drop = ruleBody('[data-blok-database-calendar-day][data-drop]');

    expect(drop).toContain('var(--blok-icon-active-bg)');
    expect(drop).not.toMatch(/focus-ring|rgb\(39,\s*131,\s*222\)/);
  });

  it('rounds only through role tokens', () => {
    const radii = [...`${galleryCss}${calendarCss}`.matchAll(/border-radius:\s*([^;]+);/g)].map((match) => match[1].trim());

    expect(radii.length).toBeGreaterThan(0);
    for (const radius of radii) {
      expect(radius).toMatch(/^(?:0|50%|var\(--blok-radius-[a-z-]+\)|var\(--blok-radius-inner, var\(--blok-radius-[a-z-]+\)\))$/);
    }
  });

  it('uses logical properties only, so RTL mirrors both layouts', () => {
    for (const block of [galleryCss, calendarCss]) {
      expect(block.length).toBeGreaterThan(500);
      expect(block).not.toMatch(/(?:^|[\s;{])(?:left|right|margin-left|margin-right|padding-left|padding-right|border-left|border-right|text-align:\s*(?:left|right))\s*[:;]/m);
    }
  });

  it('gives no ring on a plain focus, only on keyboard focus', () => {
    expect(`${galleryCss}${calendarCss}`).not.toMatch(/:focus(?![-\w])/);
    expect(ruleBody('[data-blok-database-gallery-card]:focus-visible')).toContain('var(--blok-focus-ring)');
    expect(ruleBody('[data-blok-database-calendar-day]:focus-visible')).toContain('var(--blok-focus-ring)');
  });

  it('turns every gallery and calendar transition off for reduced motion', () => {
    expect(galleryCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(calendarCss).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});
