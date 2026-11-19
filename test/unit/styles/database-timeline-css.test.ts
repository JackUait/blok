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
  '--blok-database-timeline-panel-bg',
  '--blok-database-timeline-panel-shadow',
  '--blok-database-timeline-header-text',
  '--blok-database-timeline-fade-end',
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

  // motion-r6-timelinepanel.json: the panel is a white card with a soft shadow, over the chart, under the toolbar.
  it('draws the table panel as a card above the chart and below the toolbar', () => {
    expect(css).toContain('--blok-database-timeline-panel-bg: rgb(255, 255, 255)');
    expect(css).toContain('--blok-database-timeline-panel-shadow: rgba(25, 25, 25, 0.027) 0 4px 12px 0, rgba(25, 25, 25, 0.02) 0 1px 2px 0');
    expect(ruleBody('[data-blok-database-timeline-table]')).toContain('background-color: var(--blok-database-timeline-panel-bg)');
    expect(ruleBody('[data-blok-database-timeline-table]')).toContain('box-shadow: var(--blok-database-timeline-panel-shadow)');
  });

  // timeline.png (Alpha row): the "←" chip starts 8px into the chart, before the row handle.
  it('puts the off-screen "←" chip first in the row edge, 8px in', () => {
    const rule = ruleBody('[data-blok-database-timeline-row-edge] > [data-blok-database-timeline-offscreen]');

    expect(rule).toMatch(/order:\s*-1/);
    expect(rule).toContain('margin-inline-start: var(--blok-space-1)');
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
    expect(ruleBody('[data-blok-database-timeline-scroller]')).toContain('var(--blok-database-timeline-canvas-bg) 0)');
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
    // notion-motion.md Round 65 §4: Notion's dot paints over a bar that starts today; bars are z-index 1.
    expect(dot).toContain('z-index: 2');
  });

  // findings C17: the chip before a cut bar's title, the same 16px chip as the off-screen one.
  it('shows the cut-start chip only on a bar the view marks, and keeps it and the title at the screen\'s start', () => {
    expect(ruleBody('[data-blok-database-timeline-bar-chip]')).toMatch(/display:\s*none/);
    expect(ruleBody('[data-blok-database-timeline-bar][data-clipped-start] > [data-blok-database-timeline-bar-chip="start"]')).toMatch(/display:\s*inline-flex/);
    expect(ruleBody('[data-blok-database-timeline-bar][data-clipped-start] > [data-blok-database-timeline-bar-chip="start"]')).toMatch(/position:\s*sticky/);
  });

  // notion-motion.md Timeline (tlcollapse.png): the cut-end chip mirrors the cut-start one, held at the screen's end.
  it('shows the cut-end chip only on a bar cut at the end, held at the screen\'s end', () => {
    const end = ruleBody('[data-blok-database-timeline-bar][data-clipped-end] > [data-blok-database-timeline-bar-chip="end"]');

    expect(end).toMatch(/display:\s*inline-flex/);
    expect(end).toMatch(/position:\s*sticky/);
    expect(end).toContain('inset-inline-end: var(--blok-space-2)');
    expect(end).toMatch(/margin-inline-start:\s*auto/);
    expect(ruleBody('[data-blok-database-timeline-bar][data-clipped-start] > [data-blok-database-timeline-bar-chip="start"]')).toMatch(/display:\s*inline-flex/);
  });

  // notion-motion.md Round 6 "Timeline left table panel": 376 wide with 96 of it padding before the Name column, at 1512 and 1100.
  // Round 48 A7: Notion's first 6px sit under its sidebar, so it shows 370, from the page edge to 640, rows at 90.
  // Its « sits at the panel's end, beside the month.
  it('draws the table panel 370px wide, 90 of it padding, and turns the toggle into « at its end while it shows', () => {
    expect(ruleBody('[data-blok-database-timeline]')).toContain('--blok-database-timeline-table-width: 370px');
    expect(ruleBody('[data-blok-database-timeline]')).toContain('--blok-database-timeline-table-more: 0');
    // Round 53 §3: the panel grows 200 per shown column (Notion 480 with Date, 1880 with 8 more), cut at the view's edge.
    expect(ruleBody('[data-blok-database-timeline-table]')).toMatch(/[;\s]inline-size: max-content/);
    expect(ruleBody('[data-blok-database-timeline-table]')).toContain('min-inline-size: var(--blok-database-timeline-table-width)');
    expect(ruleBody('[data-blok-database-timeline-table]')).toContain('max-inline-size: 100%');
    expect(ruleBody('[data-blok-database-timeline-table]')).toContain('padding-inline-start: 90px');
    const shown = '[data-blok-database-timeline-toolbar] [data-blok-database-timeline-table-toggle][aria-pressed="true"]';

    // notion-motion.md Round 50 item 6: open, « is 28x24 with 6px sides, starts 37 before the panel's end, its glyph 2.5 above centre (Notion 12 into the card).
    // Round 54 §4: it follows the panel's end, 200 per column past Name (603 → 1003). The gap before it is a
    // shrinkable box, so a panel wider than the view does not push Today and the zoom off the toolbar.
    const before = ruleBody('[data-blok-database-timeline-toolbar]:has(> [data-blok-database-timeline-table-toggle][aria-pressed="true"])::before');

    expect(before).toContain('flex: 0 1 calc(var(--blok-database-timeline-table-width) + var(--blok-database-timeline-table-more) * 200px - 41px)');
    expect(before).toContain('min-inline-size: 0');
    expect(ruleBody('[data-blok-database-timeline-toolbar]:has(> [data-blok-database-timeline-table-toggle][aria-pressed="true"]) > *')).toContain('flex-shrink: 0');
    expect(ruleBody(shown)).not.toContain('margin-inline-start');
    expect(ruleBody(shown)).toContain('margin-inline-end: 21px');
    expect(ruleBody(shown)).toContain('inline-size: 28px');
    expect(ruleBody(shown)).toContain('block-size: 24px');
    expect(ruleBody(shown)).toContain('padding: 0 var(--blok-space-1-5)');
    expect(ruleBody(shown)).toContain('inset-block-start: -2.5px');
    expect(ruleBody('[data-blok-database-timeline-toolbar]:has(> [data-blok-database-timeline-table-toggle][aria-pressed="true"])')).toContain('padding-inline-start: 0');
    expect(ruleBody(`${shown} svg`)).toContain('transform: scaleX(-1)');
  });

  // notion-motion.md Round 51 §3: with Name, Date and Status shown Notion's panel row is 679 wide, the Name
  // editor 280 at 359. Name keeps the 279 of a Name-only row; 2 × 200 is a fit to the total, not a per-cell read.
  it('keeps the Name column 279 wide and gives each other column 200, so the row grows past the panel', () => {
    for (const part of ['header', 'row', 'footer']) {
      const body = ruleBody(`[data-blok-database-timeline-table-${part}]`);

      expect(body).toContain('grid-template-columns: 279px');
      expect(body).toContain('grid-auto-columns: 200px');
      expect(body).toContain('inline-size: max-content');
      expect(body).toMatch(/padding-inline: 0[;\s]/);
    }
    expect(ruleBody('[data-blok-database-timeline-table-row] > *')).toContain('padding-inline: var(--blok-space-2)');
    expect(ruleBody('[data-blok-database-timeline-table-header] > *')).toContain('padding-inline: var(--blok-space-2)');
    expect(ruleBody('[data-blok-database-timeline-table-title]')).toContain('margin-inline-end: -1px');
    expect(ruleBody('[data-blok-database-timeline-table-footer] > :first-child')).toBe('');
    expect(ruleBody('[data-blok-database-timeline-table]')).toContain('overflow: clip');
  });

  // notion-motion.md Timeline: the chevrons crossfade with a scale, 0.3 to 1, over 160ms ease-in-out.
  it('crossfades the table chevrons with a 0.3 scale over 160ms ease-in-out', () => {
    const toggle = '[data-blok-database-timeline-toolbar] [data-blok-database-timeline-table-toggle]';
    const incoming = ruleBody(`${toggle}[data-swapped] > svg`);
    const outgoing = ruleBody(`${toggle} [data-blok-database-timeline-toggle-out]`);
    const starting = css.slice(css.indexOf('@starting-style', css.indexOf('data-blok-database-timeline-toggle-out')));

    for (const part of [incoming, outgoing]) {
      expect(part).toMatch(/transition:\s*opacity 160ms ease-in-out, scale 160ms ease-in-out/);
    }
    expect(outgoing).toMatch(/opacity:\s*0/);
    expect(outgoing).toMatch(/scale:\s*0\.3/);
    // The mirror is the old direction, whatever the page direction.
    expect(outgoing).toMatch(/transform:\s*scaleX\(-1\)/);
    expect(starting).toMatch(/\[data-swapped\] > svg\s*\{\s*opacity:\s*0;\s*scale:\s*0\.3;/);
    expect(starting).toMatch(/toggle-out\]\s*\{\s*opacity:\s*1;\s*scale:\s*1;/);
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

  // notion-motion.md Round 72 §2 "Dependency dot": full opacity in the first frame, no transition on it or its parents.
  // Notion's fade-out is unread, so leaving keeps the 200ms fade. A drag still hides it at once.
  it('shows the connector at once on bar hover and fades it out over 200ms, with a pointer cursor', () => {
    const handle = ruleBody('[data-blok-database-timeline-link-handle]');
    const shown = ruleBody('[data-blok-database-timeline-bar]:hover [data-blok-database-timeline-link-handle]');

    expect(shown).toContain('transition: none');
    expect(ruleBody('[data-blok-database-timeline][data-dragging="link"] [data-blok-database-timeline-link-handle]')).toBe(shown);
    expect(handle).toContain('transition: opacity 0.2s ease-out');
    expect(handle).toContain('cursor: pointer');
    expect(handle).not.toContain('crosshair');
    const dragging = css.indexOf('[data-blok-database-timeline]:is([data-dragging="move"], [data-dragging="start"], [data-dragging="end"]) [data-blok-database-timeline-link-handle] {');

    expect(dragging).toBeGreaterThan(-1);
    expect(css.slice(dragging, css.indexOf('}', dragging))).toContain('transition: none');
  });

  it('runs the hover pill 4px past each end of the bar\'s days', () => {
    const pill = ruleBody('[data-blok-database-timeline-range][data-hover]');

    // --blok-space-1 is 4px.
    expect(pill).toMatch(/margin-inline-start:\s*calc\(-1 \* var\(--blok-space-1\)\)/);
    expect(pill).toMatch(/padding-inline:\s*var\(--blok-space-1\)/);
    expect(pill).toMatch(/box-sizing:\s*content-box/);
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
    const halo = ruleBody('[data-blok-database-timeline-bar]::after');

    expect(ruleBody(`${picked} [data-blok-database-timeline-bar]::after`)).toContain('opacity: 1');
    expect(halo).toContain('inset: 2px');
    expect(halo).toContain('border-start-start-radius: inherit');
    expect(halo).toContain('border-end-end-radius: inherit');
    expect(halo).toContain('pointer-events: none');
    expect(halo).toContain('background-color: var(--blok-icon-active-bg)');
  });

  // notion-motion.md Round 50 §2, Round 51 §5: a cleared pick fades its halo out over 200ms ease (Escape or a click outside).
  it('fades a picked bar halo out over 200ms ease and shows it at once', () => {
    const halo = ruleBody('[data-blok-database-timeline-bar]::after');
    const picked = ruleBody('[data-blok-database-timeline-row][data-blok-database-row-selected] [data-blok-database-timeline-bar]::after');

    expect(halo).toContain('opacity: 0');
    expect(halo).toMatch(/transition:\s*opacity 200ms ease/);
    expect(picked).toContain('opacity: 1');
    expect(picked).toMatch(/transition:\s*none/);
    expect(timelineCss.slice(timelineCss.lastIndexOf('@media (prefers-reduced-motion: reduce)'))).toContain('[data-blok-database-timeline-bar]::after');
  });

  // research/35 §1.5: hover ≈ rgba(33, 27, 23, 0.051) light, rgba(255, 255, 255, 0.055) dark, over the bar fill.
  // notion-motion.md Timeline: the tint comes in over 20ms ease-in. A layer under the bar's content keeps it over a colour fill.
  it('hovers a bar to the measured overlay over 20ms ease-in', () => {
    const layer = ruleBody('[data-blok-database-timeline-bar]::before');

    expect(layer).toContain('z-index: -1');
    expect(layer).toContain('pointer-events: none');
    expect(layer).toMatch(/transition:\s*background-color 20ms ease-in/);
    expect(ruleBody('[data-blok-database-timeline-bar]:hover::before')).toContain('background-color: var(--blok-database-table-header-hover-bg)');
    expect(ruleBody('[data-blok-database-timeline-bar]:hover')).not.toContain('background-image');
    expect(css).toContain('--blok-database-hover-bg: rgba(33, 27, 23, 0.051);');
    expect(darkValues('--blok-database-table-header-hover-bg')).toEqual(['rgba(255, 255, 255, 0.055)', 'rgba(255, 255, 255, 0.055)']);
    expect(css).toContain('--blok-database-timeline-bar-bg: #ffffff;');
  });

  it('turns every timeline transition off under reduced motion', () => {
    const reduced = timelineCss.slice(timelineCss.lastIndexOf('@media (prefers-reduced-motion: reduce)'));

    expect(timelineCss).toContain('transition');
    for (const selector of ['[data-blok-database-timeline-bar]', '[data-blok-database-timeline-bar]::before', '[data-blok-database-timeline-row-handle]', '[data-blok-database-timeline-toggle-out]']) {
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

  // r9-timeline-dark.raw: the panel shadow and the "Name" header ink.
  it('draws the dark panel with Notion\'s dark shadow and a brighter "Name" header', () => {
    expect(darkValues('--blok-database-timeline-panel-shadow')).toEqual(['rgba(25, 25, 25, 0.08) 0 2px 4px 0', 'rgba(25, 25, 25, 0.08) 0 2px 4px 0']);
    expect(darkValues('--blok-database-timeline-header-text')).toEqual(['rgb(173, 169, 163)', 'rgb(173, 169, 163)']);
    expect(ruleBody('[data-blok-database-timeline-table-header]')).toContain('color: var(--blok-database-timeline-header-text)');
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
    // Round 46 B: less the 6 the « sits before the column.
    expect(ruleBody('[data-blok-database-timeline-toolbar]')).toContain('padding-inline-start: max(0px, calc((100% - var(--blok-content-max-width, var(--max-width-content))) / 2 - var(--blok-space-1-5)))');
    expect(ruleBody('[data-blok-database-timeline-scroller]')).not.toMatch(/padding-inline|padding-left/);
  });

  it('keeps "+ New" at the text column while the canvas scrolls, measured against the view\'s width', () => {
    expect(ruleBody('[data-blok-database-timeline]')).toMatch(/container(-type)?: [^;]*inline-size/);
    expect(ruleBody('[data-blok-database-timeline-new-lane] [data-blok-database-timeline-new]')).toContain('inset-inline-start: max(0px, calc((100cqi - var(--blok-content-max-width, var(--max-width-content))) / 2))');
  });
});

// notion-motion.md Round 41 Part B Timeline (r41-n-empty-tl.png): in a page-wide editor the grid spans x 531-1238.5,
// the text column plus 8 each side, and › ends with the column. Round 6: with the table panel open the view is full-bleed.
describe('page-wide editor: the timeline keeps to the text column', () => {
  const inset = 'max(0px, calc((100% - var(--blok-content-max-width, var(--max-width-content))) / 2))';
  const closed = '[data-blok-database-timeline]:not(:has(> [data-blok-database-timeline-toolbar] > [data-blok-database-timeline-table-toggle][aria-pressed="true"]))';
  const open = '[data-blok-database-timeline-toolbar]:has(> [data-blok-database-timeline-table-toggle][aria-pressed="true"])';

  it('narrows the closed-panel view to the column plus 8px each side', () => {
    expect(ruleBody(closed)).toContain(`margin-inline: max(0px, calc(${inset} - var(--blok-space-2)))`);
  });

  it('ends the toolbar at the column', () => {
    expect(ruleBody('[data-blok-database-timeline-toolbar]')).toContain(`padding-inline-end: ${inset}`);
  });

  it('keeps the open-panel toolbar full-bleed on both sides', () => {
    expect(ruleBody(open)).toContain('padding-inline-start: 0');
    expect(ruleBody(open)).toContain('padding-inline-end: 0');
  });
});

// notion-motion.md Round 49 B9 (and R48 A3): the edge readout sits 10 outside the bar.
describe('edge readout offset (Round 49 B9)', () => {
  it('sits 10px outside either edge', () => {
    expect(ruleBody('[data-blok-database-timeline-edge-readout="end"]')).toContain('inset-inline-start: calc(100% + 10px)');
    expect(ruleBody('[data-blok-database-timeline-edge-readout="start"]')).toContain('inset-inline-end: calc(100% + 10px)');
  });

  // notion-motion.md Round 50 item 1: a 22-tall box on the canvas fill, 4 padding, radius 6, no border or shadow, top at bar top + 7.
  it('draws the readout as a light 22-tall box, 7 below the bar top', () => {
    const body = ruleBody('[data-blok-database-timeline-edge-readout]');

    expect(body).toContain('background-color: var(--blok-database-timeline-canvas-bg)');
    expect(body).toContain('padding: var(--blok-space-1)');
    expect(body).toContain('line-height: 14px');
    expect(body).toContain('border-radius: var(--blok-radius-control)');
    expect(body).toContain('inset-block-start: 7px');
    expect(body).not.toContain('translate');
    expect(body).not.toContain('box-shadow');
  });
});

// notion-motion.md Round 50 item 6: the header glyph is 16 centred in an 18 box at the row icon's x; "Name" 6 after it, at the titles' x.
describe('panel header icon (Round 50)', () => {
  it('centres the 16 glyph in an 18 box, the label 6 after', () => {
    const icon = ruleBody('[data-blok-database-timeline-table-header-icon]');

    expect(icon).toContain('inline-size: 18px');
    expect(icon).toContain('justify-content: center');
    expect(ruleBody('[data-blok-database-timeline-table-header] > *')).toContain('gap: var(--blok-space-1-5)');
  });
});

// notion-motion.md Round 24 §4 Timeline: a plain "+ New" label at rest; a ghost bar on lane hover.
describe('"+ New" lane (Round 24)', () => {
  const label = '[data-blok-database-timeline-new-lane] [data-blok-database-timeline-new]';

  it('draws "+ New" as a plain 36px label: 16px plus, 6 gap, no padding and no hover fill', () => {
    const body = ruleBody(label);

    expect(body).toMatch(/block-size:\s*36px/);
    expect(body).toMatch(/gap:\s*var\(--blok-space-1-5\)/);
    expect(body).toMatch(/padding:\s*0/);
    expect(body).not.toMatch(/inline-size:\s*197px/);
    expect(ruleBody(`${label}:hover`)).toMatch(/background-color:\s*transparent/);
    expect(ruleBody(`${label} svg`)).toMatch(/color:\s*var\(--blok-database-timeline-control-text\)/);
  });

  it('hides the label while the lane is hovered', () => {
    expect(ruleBody('[data-blok-database-timeline-new-lane]:hover [data-blok-database-timeline-new]')).toMatch(/opacity:\s*0/);
  });

  it('draws the ghost bar 34 tall, radius 6, in the 0.06 fill, fading in over 200ms ease-out', () => {
    const ghost = ruleBody('[data-blok-database-timeline-new-ghost]');

    expect(ghost).toMatch(/block-size:\s*34px/);
    expect(ghost).toMatch(/border-radius:\s*var\(--blok-radius-control\)/);
    expect(ghost).toMatch(/background-color:\s*var\(--blok-database-add-hover-bg\)/);
    expect(ghost).toMatch(/opacity:\s*0/);
    expect(ghost).toMatch(/transition:\s*opacity 0\.2s ease-out/);
    expect(ruleBody('[data-blok-database-timeline-new-lane]:hover [data-blok-database-timeline-new-ghost][data-day]')).toMatch(/opacity:\s*1/);
  });
});

// notion-motion.md Round 32 §3 Timeline: Today at y 319.7 and the month at 320.7. Round 47 A4: the toolbar block is 40
// (Notion 4 + 36), so the tick row starts at 345.2. The controls keep their place: 2 off the height, 2 onto the top.
describe('timeline toolbar row (Round 32, Round 47 A4)', () => {
  it('is 40 tall with the controls where they were', () => {
    const body = ruleBody('[data-blok-database-timeline-toolbar]');

    expect(body).toContain('min-block-size: 40px');
    expect(body).toContain('box-sizing: border-box');
    expect(body).toContain('padding-block-start: var(--blok-space-3-25)');
  });

  // notion-motion.md Round 47 A4: Notion's content starts 4 under the view top; r46-n-tltable.png: the card's border starts there.
  it('starts the table card 4px under the toolbar top', () => {
    expect(ruleBody('[data-blok-database-timeline-table]')).toContain('--blok-database-timeline-panel-reach: 36px');
  });
});

// notion-motion.md Round 34 §5 (r34-timeline-hours-nowlabel.raw): a 12px 500 / 18 label, 3 end padding, centred on the
// now-line in the tick row. Notion's rgb(229, 100, 88) is 3.3:1 on the canvas; Blok keeps AA ink (user-approved).
describe('Hours zoom now label (Round 34)', () => {
  const label = '[data-blok-database-timeline-units] > [data-blok-database-timeline-now-label]';

  it('centres a zero-width box on the line, over the ticks', () => {
    const body = ruleBody(label);

    expect(body).toContain('inline-size: 0');
    expect(body).toContain('display: flex');
    expect(body).toContain('justify-content: center');
    expect(body).toContain('align-items: center');
    expect(body).toContain('overflow: visible');
  });

  it('draws the time 12px 500 / 18 in an AA red, 3 end padding', () => {
    const text = ruleBody(`${label} > span`);

    expect(text).toContain('flex: none');
    expect(text).toContain('font-size: 12px');
    expect(text).toContain('font-weight: 500');
    expect(text).toContain('line-height: 18px');
    expect(text).toContain('padding-inline-end: var(--blok-space-0-75)');
    expect(text).toContain('color: var(--blok-database-timeline-now-text)');
  });

  // 5.55:1 on rgb(253, 253, 253); 6.79:1 on rgb(25, 25, 25).
  it('takes the AA reds in light and both darks, outside colors.css', () => {
    expect(css).toContain('--blok-database-timeline-now-text: #b93a35;');
    expect(darkValues('--blok-database-timeline-now-text')).toEqual(['#ea8480', '#ea8480']);
    expect(colors).not.toContain('--blok-database-timeline-now-text:');
  });
});

// notion-motion.md Round 35 Part B (r35-timeline-hours-grid.raw, r35-timeline-hours.png): a 1px line every
// 15 minutes in the body, at Notion's rgba(42, 28, 0, 0.07), which is the grid-line token in light.
describe('Hours zoom 15-minute lines and day period (Round 35)', () => {
  it('draws each line 1px wide, full body height, in the grid-line token', () => {
    const body = ruleBody('[data-blok-database-timeline-tick-line]');

    expect(body).toContain('position: absolute');
    expect(body).toContain('inset-block: 0');
    expect(body).toContain('inline-size: 1px');
    expect(body).toContain('background-color: var(--blok-database-timeline-grid-line)');
  });

  // Notion's lighter rgb(161, 158, 154) is 2.6:1 on the canvas; tick text keeps Blok's AA ink (user-approved).
  it('inks the day period with its own token, held at the tick ink', () => {
    expect(ruleBody('[data-blok-database-timeline-day-period]')).toContain('color: var(--blok-database-timeline-period-text)');
    expect(css).toContain('--blok-database-timeline-period-text: var(--blok-database-timeline-muted-text);');
    expect(colors).not.toContain('--blok-database-timeline-period-text:');
  });

  describe('notion-motion.md Round 46 B', () => {
    it('draws the table panel row glyph 18 in an 18 box, so the title starts 32 in', () => {
      const at = css.indexOf('[data-blok-database-timeline-table-title] > :is([data-blok-database-page-icon], [data-blok-database-page-icon-placeholder]) {');
      const box = css.slice(at, css.indexOf('}', at));

      expect(box).toMatch(/inline-size:\s*18px/);
      expect(box).toMatch(/block-size:\s*18px/);
      expect(ruleBody('[data-blok-database-timeline-table-title] > [data-blok-database-page-icon-placeholder] svg')).toMatch(/inline-size:\s*18px;\s*block-size:\s*18px/);
    });

    it('draws the No date row glyph 18', () => {
      expect(ruleBody('[data-blok-database-no-date-row] > [data-blok-database-page-icon-placeholder] svg')).toMatch(/inline-size:\s*18px;\s*block-size:\s*18px/);
    });

    // Round 47 A2: the day row is 32 in every zoom.
    it('makes the day row 32 tall in every zoom, the day line staying 28', () => {
      expect(ruleBody('[data-blok-database-timeline]')).toContain('--blok-database-timeline-header-under: 4px');
      expect(ruleBody('[data-blok-database-timeline][data-zoom="month"]')).toBe('');
      expect(ruleBody('[data-blok-database-timeline-header]')).toContain('var(--blok-database-timeline-header-block)');
      expect(ruleBody('[data-blok-database-timeline-units]')).toContain('block-size: var(--blok-database-timeline-line)');
    });

    it('keeps the range pill on the day line when the row grows', () => {
      const pill = ruleBody('[data-blok-database-timeline-range]');

      expect(pill).toContain('inset-block-start: calc(var(--blok-database-timeline-header-band) + var(--blok-space-0-75))');
      expect(pill).not.toContain('inset-block-end');
    });

    it('sizes the « toggle 24x22 with 4px sides', () => {
      const toggle = ruleBody('[data-blok-database-timeline-toolbar] [data-blok-database-timeline-table-toggle]');

      expect(toggle).toContain('inline-size: var(--blok-space-6)');
      expect(toggle).toMatch(/block-size:\s*22px/);
      expect(toggle).toMatch(/padding:\s*0 var\(--blok-space-1\)/);
      expect(toggle).not.toContain('margin-inline-start');
      // 6 before the text column, never outside a narrow view.
      expect(ruleBody('[data-blok-database-timeline-toolbar]')).toContain('padding-inline-start: max(0px, calc((100% - var(--blok-content-max-width, var(--max-width-content))) / 2 - var(--blok-space-1-5)))');
    });

    it('packs ‹, Today and › with no gap', () => {
      const at = css.indexOf('[data-blok-database-timeline-toolbar] > :is([data-blok-database-timeline-today], [data-blok-database-timeline-next]) {');

      expect(at).toBeGreaterThan(-1);
      expect(css.slice(at, css.indexOf('}', at))).toContain('margin-inline-start: calc(-1 * var(--blok-space-1))');
    });

    it('gives the zoom chevron a 10 wide box 6 after the label', () => {
      expect(ruleBody('[data-blok-database-timeline-toolbar] [data-blok-database-timeline-zoom]')).toContain('gap: var(--blok-space-1-5)');
      expect(ruleBody('[data-blok-database-timeline-zoom] svg')).toContain('margin-inline: calc(-1 * var(--blok-space-0-75))');
    });

    it('sets the zoom menu items 14px regular', () => {
      const title = ruleBody('[data-blok-item-name^="database-timeline-zoom-"] [data-blok-popover-item-title]');

      expect(title).toContain('font-size: 14px');
      expect(title).toContain('font-weight: 400');
    });

    it('hides the link handle while a bar moves', () => {
      const at = css.indexOf('[data-blok-database-timeline]:is([data-dragging="move"], [data-dragging="start"], [data-dragging="end"]) [data-blok-database-timeline-link-handle] {');

      expect(at).toBeGreaterThan(-1);
      expect(css.slice(at, css.indexOf('}', at))).toContain('opacity: 0');
    });
  });
});

// notion-motion.md Round 47 A2: Quarter, Year and 5 Years put their month or year labels in the 36 toolbar row
// (box at its top, 13 padding, 14/21), so the first bar is at 378.2 in every zoom, not under a second header row.
describe('timeline group labels share the toolbar row (Round 47 A2)', () => {
  it('makes the band 36 for each header row past the first', () => {
    expect(ruleBody('[data-blok-database-timeline]')).toContain('--blok-database-timeline-header-block: calc(var(--blok-database-timeline-line) + var(--blok-database-timeline-header-under))');
    expect(ruleBody('[data-blok-database-timeline]')).toContain('--blok-database-timeline-header-band: calc((var(--blok-database-timeline-header-rows) - 1) * 36px)');
  });

  // notion-motion.md Round 48 A4: the tick row is white (255), not the canvas tint.
  it('pulls the chart up under the toolbar by the band, painting no fill there or in the tick row', () => {
    const scroller = ruleBody('[data-blok-database-timeline-scroller]');

    expect(scroller).toContain('margin-block-start: calc(-1 * var(--blok-database-timeline-header-band))');
    expect(scroller).toContain('background: linear-gradient(transparent calc(var(--blok-database-timeline-header-band) + var(--blok-database-timeline-header-block)), var(--blok-database-timeline-canvas-bg) 0)');
  });

  it('puts the group row in the band, over the day row', () => {
    expect(ruleBody('[data-blok-database-timeline-header]')).toContain('block-size: calc(var(--blok-database-timeline-header-band) + var(--blok-database-timeline-header-block))');
    expect(ruleBody('[data-blok-database-timeline-groups]')).toContain('block-size: var(--blok-database-timeline-header-band)');
    expect(ruleBody('[data-blok-database-timeline-groups] > *')).toContain('padding-block-start: var(--blok-space-3-25)');
    expect(ruleBody('[data-blok-database-timeline-background]')).toContain('inset-block: calc(var(--blok-database-timeline-header-band) + var(--blok-database-timeline-header-block)) 0');
  });

  it('keeps the table panel header to the day row alone', () => {
    expect(ruleBody('[data-blok-database-timeline-table-header]')).toContain('block-size: var(--blok-database-timeline-header-block)');
  });

  // notion-motion.md Round 48 A1, A2: a group label starts on its line with no inset, and the header draws no divider.
  it('starts each group label on its line, with no divider in the band', () => {
    const group = ruleBody('[data-blok-database-timeline-groups] > *');

    expect(group).not.toMatch(/padding-inline-start/);
    expect(group).not.toMatch(/border-inline-end/);
  });

  // notion-motion.md Round 48 A2, A3: month lines in the body only, 1px rgba(42, 28, 0, 0.07).
  it('draws each month line 1px wide, full body height, in the grid-line token', () => {
    const body = ruleBody('[data-blok-database-timeline-month-line]');

    expect(body).toContain('position: absolute');
    expect(body).toContain('inset-block: 0');
    expect(body).toContain('inline-size: 1px');
    expect(body).toContain('background-color: var(--blok-database-timeline-grid-line)');
  });

  it('puts the today dot on the day line under the band', () => {
    expect(ruleBody('[data-blok-database-timeline-today-dot]')).toContain('inset-block-start: calc(var(--blok-database-timeline-header-band) + 3px)');
  });
});

// Blok choice, pending a Notion measurement: a group label in the toolbar band slides under the controls, not over them.
describe('timeline toolbar controls hide the group labels under them', () => {
  const control = '[data-blok-database-timeline-toolbar] > :not([data-blok-database-timeline-toolbar-spacer])';

  it('stacks the toolbar over the chart', () => {
    expect(ruleBody('[data-blok-database-timeline-toolbar]')).toMatch(/position:\s*relative;[\s\S]*z-index:\s*2/);
    expect(ruleBody('[data-blok-database-timeline-scroller]')).not.toContain('z-index');
  });

  // notion-motion.md Round 48 A2 (r48-n-quarter-hdr.raw): two white boxes, « and the month (531..653.6) and the controls (876.1..1239).
  // Flush with the controls inside; out to the chart's edge outside; one box per group.
  it('puts a page-coloured backing under each control, flush with its edges', () => {
    expect(ruleBody(control)).toContain('position: relative');
    expect(ruleBody(control)).toContain('isolation: isolate');
    const backing = ruleBody(`${control}::before`);

    expect(backing).toContain('position: absolute');
    expect(backing).toContain('inset: 0');
    expect(backing).not.toContain('--blok-space-0-5');
    expect(backing).toContain('z-index: -1');
    expect(backing).toContain('background-color: var(--blok-bg-primary)');
  });

  it('covers the 4px gap after a control, so each group is one box', () => {
    const gap = ruleBody('[data-blok-database-timeline-toolbar] > :not([data-blok-database-timeline-toolbar-spacer]):not(:last-child):not(:has(+ [data-blok-database-timeline-toolbar-spacer]))::before');

    expect(ruleBody('[data-blok-database-timeline-toolbar]')).toContain('gap: var(--blok-space-1)');
    expect(gap).toContain('inset-inline-end: calc(-1 * var(--blok-space-1))');
  });

  // r48-n-quarter-phdr.raw: with the panel open the label box runs on to the month's end (264..748.6),
  // but the panel's border and shadow still show over it (r48-pair-quarter-p.png, 240 at x 639 in the toolbar row).
  it('backs the chart from its start to the month while the panel is open, clear of the panel', () => {
    const open = '[data-blok-database-timeline-toolbar]:has(> [data-blok-database-timeline-table-toggle][aria-pressed="true"]) > [data-blok-database-timeline-month]::before';

    expect(ruleBody(open)).toContain('inset-inline-start: calc(-1 * var(--blok-space-4))');
    expect(ruleBody('[data-blok-database-timeline-toolbar] > [data-blok-database-timeline-table-toggle][aria-pressed="true"]::before')).toBe('');
  });

  it('runs the outer boxes to the chart edges while the panel is shut', () => {
    const shut = '[data-blok-database-timeline-toolbar]:not(:has(> [data-blok-database-timeline-table-toggle][aria-pressed="true"]))';

    expect(ruleBody(`${shut} > :first-child::before`)).toContain('inset-inline-start: calc(-1 * max(0px, calc((100cqi - var(--blok-content-max-width, var(--max-width-content))) / 2 - var(--blok-space-1-5))))');
    expect(ruleBody(`${shut} > :last-child::before`)).toContain('inset-inline-end: calc(-1 * max(0px, calc((100cqi - var(--blok-content-max-width, var(--max-width-content))) / 2)))');
  });
});

// notion-motion.md Round 48 A5 (r48-n-hours-body.raw): chips sit 8 in from the chart's edges.
// Off-screen right 1215 and cut start 539 in a chart 531..1239; the cut bar's title at 558.
describe('timeline off-screen chips sit 8px in from the chart edges (Round 48 A5)', () => {
  it('ends the off-screen "→" chip 8px before the chart end', () => {
    expect(ruleBody('[data-blok-database-timeline-row-end] > [data-blok-database-timeline-offscreen]')).toContain('margin-inline-end: var(--blok-space-1)');
  });

  it('holds a cut bar\'s start chip 8px in, and its title 3px after the chip', () => {
    const chip = ruleBody('[data-blok-database-timeline-bar][data-clipped-start] > [data-blok-database-timeline-bar-chip="start"]');

    expect(chip).toContain('inset-inline-start: var(--blok-space-2)');
    expect(ruleBody('[data-blok-database-timeline-bar][data-clipped-start] > [data-blok-database-timeline-bar-title]'))
      .toContain('inset-inline-start: calc(var(--blok-space-2) + 16px + var(--blok-space-0-75))');
  });
});

// notion-motion.md Round 48 A5: a far-zoom bar can be 11 wide. The bar's 6px sides would hold it at 12.
describe('timeline far-zoom bars can be 11px wide (Round 48 A5)', () => {
  it.each(['quarter', 'year', '5_years'])('drops the end padding of a %s bar', (zoom) => {
    expect(ruleBody(`[data-blok-database-timeline][data-zoom="${zoom}"] [data-blok-database-timeline-bar]`)).toContain('padding-inline-end: 0');
  });
});

// notion-motion.md Round 48 A4 (r48-n-week-hdr.raw): "M 16". Spans are the glyphs plus 3 after the letter
// (M 13.5, S 10.6) and 7 each side of the number (16 27.2, 20 28.8); the circle is centred on the number.
describe('timeline Week and Bi-week weekday letters (Round 48 A4)', () => {
  it('spaces the letter and the number like Notion', () => {
    expect(ruleBody('[data-blok-database-timeline-weekday]')).toContain('padding-inline-end: var(--blok-space-0-75)');
    const number = ruleBody('[data-blok-database-timeline-day-number]');

    expect(number).toContain('padding-inline: var(--blok-space-1-75)');
    expect(number).toContain('display: inline-block');
    expect(number).toContain('position: relative');
  });

  it('centres today\'s circle on its number and sets today\'s letter in 500', () => {
    expect(ruleBody('[data-blok-database-timeline-day-number] > [data-blok-database-timeline-today-dot]')).toContain('inset-inline-start: 50%');
    expect(ruleBody('[data-blok-database-timeline-units] > [data-day]:has([data-blok-database-timeline-today-dot])')).toContain('font-weight: 500');
  });

  // notion-motion.md Round 57 §5: the panel row's OPEN frame (69x24) sits 6px under the row top and 5px in from
  // its end, shows on row hover, and keeps its shadow unclipped.
  it('shows the OPEN pill on a panel row hover, 6px down and 5px in from the row end', () => {
    expect(ruleBody('[data-blok-database-timeline-table-row]:hover [data-blok-database-table-open]')).toContain('display: inline-flex');
    expect(ruleBody('[data-blok-database-timeline-table-title]')).toMatch(/position:\s*relative/);
    expect(ruleBody('[data-blok-database-timeline-table-title]')).toMatch(/align-self:\s*stretch/);
    expect(ruleBody('[data-blok-database-timeline-table-row] > [data-blok-database-timeline-table-title]')).toMatch(/overflow:\s*visible/);
    expect(ruleBody('[data-blok-database-timeline-table-title] > [data-blok-database-table-open]')).toMatch(/inset-block-start:\s*6px/);
    expect(ruleBody('[data-blok-database-timeline-table-title] > [data-blok-database-table-open]')).toMatch(/inset-inline-end:\s*5px/);
    // The table's 18px glyph, not the timeline's 16px svg rule.
    expect(ruleBody('[data-blok-database-timeline-table-title] > [data-blok-database-table-open] svg')).toMatch(/inline-size:\s*18px;\s*block-size:\s*18px/);
  });

  // notion-motion.md Round 70 §3 "Timeline + New": no ⋮⋮ handle and no dependency dot while the name is typed.
  // visibility, not opacity: the hover rules set opacity 1, and the see-through edge would still catch clicks on the field.
  it('hides the row handle and the dependency dot while a bar\'s name is typed', () => {
    expect(ruleBody('[data-blok-database-timeline-row]:has([data-blok-database-timeline-title-input]) > [data-blok-database-timeline-row-edge]')).toContain('visibility: hidden');
    expect(ruleBody('[data-blok-database-timeline-bar]:has([data-blok-database-timeline-title-input]) [data-blok-database-timeline-link-handle]')).toContain('visibility: hidden');
  });

  // notion-motion.md Round 78 §1: with no dated row the panel still ends on its 36 Calculate row, so it gets no padding of its own.
  it('gives the panel no extra room when no row is dated', () => {
    expect(css).not.toContain('[data-no-dated]');
  });

  // notion-motion.md Round 76 §5 (r76-n-tl-fades.raw): two edge fades, always drawn, page colour 20% to clear.
  describe('header edge fades (Round 76 §5)', () => {
    const month = '[data-blok-database-timeline-month]::after';
    const controls = '[data-blok-database-timeline-toolbar-spacer] + *::after';

    it('fades 30x30 off the month box\'s end, 5px above the label (316.2 vs 321)', () => {
      const body = ruleBody(month);

      expect(body).toContain('inset-inline-start: 100%');
      expect(body).toContain('inset-block-start: -4.8px');
      expect(body).toContain('inline-size: 30px');
      expect(body).toContain('block-size: 30px');
      expect(body).toContain('background-image: linear-gradient(90deg, var(--blok-bg-primary) 20%, var(--blok-database-timeline-fade-end) 100%)');
    });

    it('fades 30x29 off the controls box\'s start, 3px above them (317.2 vs 320)', () => {
      const body = ruleBody(controls);

      expect(body).toContain('inset-inline-end: 100%');
      expect(body).toContain('inset-block-start: -2.8px');
      expect(body).toContain('inline-size: 30px');
      expect(body).toContain('block-size: 29px');
      expect(body).toContain('background-image: linear-gradient(-90deg, var(--blok-bg-primary) 20%, var(--blok-database-timeline-fade-end) 100%)');
    });

    it('ends on the measured clear colour in light and dark', () => {
      expect(css).toContain('--blok-database-timeline-fade-end: rgba(255, 255, 255, 0);');
      expect(darkValues('--blok-database-timeline-fade-end')).toEqual(['rgba(241, 241, 239, 0)', 'rgba(241, 241, 239, 0)']);
    });

    it('mirrors both fades in RTL', () => {
      expect(ruleBody(`[dir="rtl"] ${month}`)).toContain('linear-gradient(-90deg');
      expect(ruleBody(`[dir="rtl"] ${controls}`)).toContain('linear-gradient(90deg');
    });
  });

  // notion-motion.md Round 72 §2 B "Height with no lanes": Notion's 212 canvas ends 108 under "+ New" (413.2 → 521.2).
  it('ends the view 108px under "+ New" when it is the only lane (107 + the scroller\'s 1)', () => {
    expect(ruleBody('[data-blok-database-timeline-canvas][data-no-lanes]')).toContain('padding-block-end: 107px');
  });

  // notion-motion.md Round 70 §3 "Timeline at rest": the view ends 4px under its last row.
  it('ends the canvas 4px under its last row, with no fixed floor', () => {
    const canvas = ruleBody('[data-blok-database-timeline-canvas]');

    expect(canvas).toContain('padding-block-end: var(--blok-space-1)');
    expect(canvas).toContain('min-block-size: 100%');
    expect(canvas).not.toContain('120px');
  });

  // notion-motion.md Round 71 §3 "Draft card while typing": no "←" chip while the name field is focused, so the text sits at +6.
  it('hides the start chip while a bar\'s name field is focused', () => {
    expect(ruleBody('[data-blok-database-timeline-bar][data-clipped-start]:has(> [data-blok-database-timeline-title-input]) > [data-blok-database-timeline-bar-chip="start"]')).toContain('display: none');
  });

  // notion-motion.md Round 71 §1 "Bottom with one lane": the block ends 4 under "+ New"; the view's 16px bottom padding put the next block 22 under.
  it('adds no bottom padding under the view', () => {
    expect(ruleBody('[data-blok-database-timeline]')).not.toMatch(/padding-block-end|padding-bottom|padding:/);
  });

  // notion-motion.md Round 71 §3 "Escape on an empty draft": the untitled bar reads "New page" in primary ink.
  it('draws an untitled bar\'s "New page" in primary ink', () => {
    expect(ruleBody('[data-blok-database-timeline-bar-title]:empty::before')).toContain('color: var(--blok-database-timeline-text)');
  });
  // notion-motion.md Round 76 §6 "grouped by Status, table hidden": the group header row is 32 (lanes start 32 under it),
  // and the view ends 12 under the last group's "+ New".
  it('draws grouped lanes under a 32px group header and ends the view 12 under the last "+ New"', () => {
    expect(ruleBody('[data-blok-database-timeline-canvas][data-grouped-lanes] > [data-blok-database-timeline-group]')).toContain('block-size: 32px');
    expect(ruleBody('[data-blok-database-timeline-canvas][data-grouped-lanes]')).toContain('padding-block-end: 11px');
  });
});
