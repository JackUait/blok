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
  '--blok-database-timeline-arrow-hover-bg',
  '--blok-database-timeline-canvas-bg',
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
    expect(css).toContain('--blok-database-timeline-arrow-hover-bg: rgb(56, 56, 54);');
  });

  // research/26 §4d: the off-screen chip darkens on hover and draws a 14x12 icon.
  it('fills the off-screen chip on hover and sizes its icon 14x12', () => {
    expect(ruleBody('[data-blok-database-timeline-offscreen]:hover')).toContain('background-color: var(--blok-database-timeline-arrow-hover-bg)');
    expect(ruleBody('[data-blok-database-timeline-offscreen] svg')).toMatch(/inline-size:\s*14px/);
    expect(ruleBody('[data-blok-database-timeline-offscreen] svg')).toMatch(/block-size:\s*12px/);
  });

  it('draws 34px bars with a 6px radius in 36px rows', () => {
    expect(ruleBody('[data-blok-database-timeline-row]')).toMatch(/block-size:\s*36px/);
    expect(ruleBody('[data-blok-database-timeline-bar]')).toMatch(/block-size:\s*34px/);
    expect(ruleBody('[data-blok-database-timeline-bar]')).toContain('border-radius: var(--blok-radius-control)');
    expect(ruleBody('[data-blok-database-timeline-bar]')).toContain('box-shadow: var(--blok-database-timeline-bar-shadow)');
    expect(ruleBody('[data-blok-database-timeline-bar-title]')).toMatch(/font-size:\s*14px/);
    expect(ruleBody('[data-blok-database-timeline-bar-title]')).toMatch(/font-weight:\s*500/);
  });

  // 80-alarm-timeline.png: a one-day bar keeps its title whole and runs it, then the properties, past its end.
  it('never clips the title or properties of a short bar', () => {
    const bar = ruleBody('[data-blok-database-timeline-bar]');
    const title = ruleBody('[data-blok-database-timeline-bar-title]');
    const property = ruleBody('[data-blok-database-timeline-bar-property]');

    expect(bar).toMatch(/overflow:\s*visible/);
    expect(bar).toContain('padding-inline: var(--blok-space-1-5)');
    // Measured cap top 11px into the 34px bar, 2px above centre.
    expect(bar).toContain('padding-block-end: var(--blok-space-1)');
    expect(title).toMatch(/flex:\s*none/);
    expect(title).not.toMatch(/text-overflow|max-inline-size/);
    expect(ruleBody('[data-blok-database-page-icon] + [data-blok-database-timeline-bar-title]')).toBe('');
    expect(property).toMatch(/flex:\s*none/);
    expect(property).not.toMatch(/text-overflow/);
    // notion-spec-2 §21.9: the values after the bar (times, date, email, file chip) are 12/18.
    expect(property).toMatch(/font-size:\s*12px/);
    expect(property).toMatch(/line-height:\s*18px/);
    expect(property).not.toContain('margin-inline-start');
    expect(ruleBody('[data-blok-database-timeline-bar-property] > [data-blok-database-cell="date"]')).toBe('');
    expect(ruleBody('[data-blok-database-timeline-bar-title] + [data-blok-database-timeline-bar-property]')).toContain('margin-inline-start: var(--blok-space-1)');
    expect(ruleBody('[data-blok-database-timeline-bar-property] > [data-blok-database-cell]')).toMatch(/white-space:\s*nowrap/);
    expect(ruleBody('[data-blok-database-timeline-bar-property] > [data-blok-database-cell]')).toMatch(/flex-wrap:\s*nowrap/);
  });

  it('draws the measured today marker and off-screen arrow', () => {
    expect(ruleBody('[data-blok-database-timeline-today-dot]')).toMatch(/inline-size:\s*22px/);
    expect(ruleBody('[data-blok-database-timeline-today-dot]')).toContain('background-color: var(--blok-database-today)');
    expect(ruleBody('[data-blok-database-timeline-today-line]')).toMatch(/inline-size:\s*1px/);
    expect(ruleBody('[data-blok-database-timeline-offscreen]')).toMatch(/inline-size:\s*16px/);
    expect(ruleBody('[data-blok-database-timeline-offscreen]')).toContain('border-radius: var(--blok-radius-control-sm)');
  });

  // research/23 §3b: an 8px col-resize handle per edge, 2px inside the bar and 6px outside.
  it('puts each resize handle 2px inside the bar edge and 6px outside', () => {
    expect(ruleBody('[data-blok-database-timeline-resize]')).toMatch(/inline-size:\s*8px/);
    expect(ruleBody('[data-blok-database-timeline-resize]')).toMatch(/cursor:\s*col-resize/);
    expect(ruleBody('[data-blok-database-timeline-resize="start"]')).toMatch(/inset-inline-start:\s*-6px/);
    expect(ruleBody('[data-blok-database-timeline-resize="end"]')).toMatch(/inset-inline-end:\s*-6px/);
  });

  // The link dot sits past the end handle, so the two never overlap.
  it('keeps the link handle clear of the end resize zone', () => {
    const offset = /inset-inline-end:\s*-(\d+)px/.exec(ruleBody('[data-blok-database-timeline-link-handle]'));

    expect(Number(offset?.[1]) - 10).toBeGreaterThanOrEqual(6);
  });

  // findings C19/C20 (r26 §4d, r33 §4.6): no line under the toolbar; a near-white canvas with a bottom line.
  it('draws no line under the toolbar, and fills the canvas with a line under it', () => {
    expect(ruleBody('[data-blok-database-timeline-body]')).not.toContain('border-block-start');
    expect(ruleBody('[data-blok-database-timeline-scroller]')).toContain('background-color: var(--blok-database-timeline-canvas-bg)');
    expect(ruleBody('[data-blok-database-timeline-scroller]')).toContain('border-block-end: 1px solid var(--blok-database-calendar-border)');
    expect(css).toContain('--blok-database-timeline-canvas-bg: rgb(253, 253, 253);');
    expect(darkValues('--blok-database-timeline-canvas-bg')).toEqual(['rgb(25, 25, 25)', 'rgb(25, 25, 25)']);
  });

  // findings C21: a 7px red dot where the today line meets the header.
  it('tops the today line with a 7px dot', () => {
    const dot = ruleBody('[data-blok-database-timeline-today-line]::before');

    expect(dot).toMatch(/inline-size:\s*7px/);
    expect(dot).toMatch(/block-size:\s*7px/);
    expect(dot).toContain('background-color: var(--blok-database-today)');
  });

  // findings C17: the chip before a cut bar's title, the same 16px chip as the off-screen one.
  it('shows the cut-start chip only on a bar the view marks, and keeps it and the title at the screen\'s start', () => {
    expect(ruleBody('[data-blok-database-timeline-bar-chip]')).toMatch(/display:\s*none/);
    expect(ruleBody('[data-blok-database-timeline-bar][data-clipped-start] > [data-blok-database-timeline-bar-chip]')).toMatch(/display:\s*inline-flex/);
    expect(ruleBody('[data-blok-database-timeline-bar][data-clipped-start] > [data-blok-database-timeline-bar-chip]')).toMatch(/position:\s*sticky/);
  });

  // findings C14: a 244px panel, its « at the panel's end, beside the month.
  it('draws the table panel 244px wide and turns the toggle into « at its end while it shows', () => {
    expect(ruleBody('[data-blok-database-timeline-table]')).toMatch(/inline-size:\s*244px/);
    const shown = '[data-blok-database-timeline-toolbar] [data-blok-database-timeline-table-toggle][aria-pressed="true"]';

    expect(ruleBody(shown)).toMatch(/margin-inline-start:/);
    expect(ruleBody(`${shown} svg`)).toContain('transform: scaleX(-1)');
  });

  // findings C22: Notion's last zoom reads "5 Years".
  it('names the last zoom "5 Years" in English', () => {
    const en = readFileSync(resolve(__dirname, '../../../src/components/i18n/locales/en.json'), 'utf8');

    expect(en).toContain('"tools.database.timelineZoomFiveYears": "5 Years"');
  });

  it('mirrors the cut-bar chip and the connector chevron in RTL', () => {
    expect(ruleBody('[dir="rtl"] [data-blok-database-timeline-bar-chip] svg')).toContain('transform: scaleX(-1)');
    expect(ruleBody('[dir="rtl"] [data-blok-database-timeline-link-handle] svg')).toContain('transform: scaleX(-1)');
  });

  it('hides an off-screen arrow that the view marks hidden', () => {
    expect(ruleBody('[data-blok-database-timeline-offscreen][hidden]')).toMatch(/display:\s*none/);
  });

  it('uses logical properties only', () => {
    expect(timelineCss).not.toMatch(/(?:^|[\s;{])(?:left|right|margin-left|margin-right|padding-left|padding-right)\s*:/);
  });

  // research/35 §1.5: only the bar shows the pick, as a halo 2px inside it; the lane and the bar fill stay. Gray, not Notion's blue.
  it('marks a picked row with a gray halo 2px inside its bar, not a lane tint', () => {
    const picked = '[data-blok-database-timeline-row][data-blok-database-row-selected]';

    expect(ruleBody(picked)).toContain('background-image: none');
    const halo = ruleBody(`${picked} [data-blok-database-timeline-bar]::after`);

    expect(halo).toContain('inset: 2px');
    expect(halo).toContain('border-start-start-radius: inherit');
    expect(halo).toContain('border-end-end-radius: inherit');
    expect(halo).toContain('pointer-events: none');
    expect(halo).toContain('background-color: var(--blok-icon-active-bg)');
  });

  // research/35 §1.5: hover ≈ rgba(33, 27, 23, 0.051) light, rgba(255, 255, 255, 0.055) dark, over the bar fill.
  it('hovers a bar to the measured overlay', () => {
    expect(ruleBody('[data-blok-database-timeline-bar]:hover')).toContain('linear-gradient(var(--blok-database-table-header-hover-bg), var(--blok-database-table-header-hover-bg))');
    expect(css).toContain('--blok-database-hover-bg: rgba(33, 27, 23, 0.051);');
    expect(darkValues('--blok-database-table-header-hover-bg')).toEqual(['rgba(255, 255, 255, 0.055)', 'rgba(255, 255, 255, 0.055)']);
    expect(css).toContain('--blok-database-timeline-bar-bg: #ffffff;');
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
    // Notion's rgb(125, 122, 117) fails AA in dark; the tertiary ink is the AA step rgb(143, 140, 135).
    ['--blok-database-timeline-muted-text', 'var(--blok-database-ink-tertiary)'],
    ['--blok-database-timeline-bar-bg', 'rgb(37, 37, 37)'],
    ['--blok-database-timeline-bar-shadow', 'rgb(56, 56, 54) 0 0 0 1px, rgba(25, 25, 25, 0.08) 0 4px 12px -2px'],
    ['--blok-database-timeline-arrow-bg', 'rgb(173, 169, 163)'],
    ['--blok-database-timeline-arrow-hover-bg', 'rgb(230, 229, 227)'],
  ])('%s is %s in both dark blocks', (token, value) => {
    expect(darkValues(token)).toEqual([value, value]);
  });

  // The dark icon ink is unmeasured. White on the measured chip is 2.3:1, under the 3:1 icon minimum; page ink is 7.5:1.
  it('draws the off-screen arrow in page ink on the light chip, so it stays readable', () => {
    expect(darkValues('--blok-database-timeline-arrow-icon')).toEqual(['rgb(25, 25, 25)', 'rgb(25, 25, 25)']);
  });

  it('keeps the today chip digit white in dark', () => {
    expect(ruleBody('[data-blok-database-timeline-today-dot]')).toContain('color: var(--blok-database-calendar-today-text)');
    expect(darkValues('--blok-database-calendar-today-text')).toEqual(['#ffffff', '#ffffff']);
  });
});

describe('content inset (side-by-side-4 #2)', () => {
  it('starts the toolbar at the text column, like the table, while the grid stays as wide as the view', () => {
    expect(ruleBody('[data-blok-database-timeline-toolbar]')).toContain('padding-inline-start: max(0px, calc((100% - var(--blok-content-max-width, var(--max-width-content))) / 2))');
    expect(ruleBody('[data-blok-database-timeline-scroller]')).not.toMatch(/padding-inline|padding-left/);
  });

  it('keeps "+ New" at the text column while the canvas scrolls, measured against the view\'s width', () => {
    expect(ruleBody('[data-blok-database-timeline]')).toMatch(/container(-type)?: [^;]*inline-size/);
    expect(ruleBody('[data-blok-database-timeline-new-lane] [data-blok-database-timeline-new]')).toContain('inset-inline-start: max(0px, calc((100cqi - var(--blok-content-max-width, var(--max-width-content))) / 2))');
  });
});
