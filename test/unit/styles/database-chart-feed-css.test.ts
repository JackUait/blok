/**
 * Chart and feed look: the feed's measured Notion values (research/08), the
 * chart's validated palette, tokens kept out of colors.css, keyboard-only
 * rings and reduced motion. jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const colors = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8');
const chartSource = readFileSync(resolve(__dirname, '../../../src/tools/database/database-chart-view.ts'), 'utf8');

const ruleBody = (selector: string): string =>
  Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g))
    .filter((match) => (match[1] ?? '').split(',').map((part) => part.trim()).includes(selector))
    .map((match) => match[2] ?? '')
    .join(';');

const HUES = ['blue', 'orange', 'teal', 'yellow', 'pink', 'green', 'purple', 'red', 'gray'];
const TOKENS = [
  ...HUES.map((hue) => `--blok-database-chart-${hue}`),
  '--blok-database-feed-card-bg',
  '--blok-database-feed-card-shadow',
];

describe('database chart and feed styles', () => {
  it.each(TOKENS)('%s is defined for light, system dark and forced dark, and not in colors.css', (token) => {
    expect(css.match(new RegExp(`${token}:`, 'g'))?.length ?? 0).toBe(3);
    expect(colors).not.toContain(`${token}:`);
  });

  it.each(HUES)('the %s chart fallback in the renderer matches the light token', (hue) => {
    const light = new RegExp(`--blok-database-chart-${hue}:\\s*(#[0-9a-f]{6})`).exec(css)?.[1];
    const fallback = new RegExp(`${hue}: '(#[0-9a-f]{6})'`).exec(chartSource)?.[1];

    expect(fallback).toBe(light);
  });

  it('uses the measured feed card: 692 wide, 16px padding, 12px radius, two-layer shadow, 26px title', () => {
    expect(ruleBody('[data-blok-database-feed-card]')).toMatch(/max-inline-size:\s*692px/);
    expect(ruleBody('[data-blok-database-feed-card]')).toContain('padding: var(--blok-space-4)');
    // Measured 12px: the dialog role is the 12px step of the radius scale.
    expect(ruleBody('[data-blok-database-feed-card]')).toContain('border-radius: var(--blok-radius-dialog)');
    expect(ruleBody('[data-blok-database-feed-card]')).toContain('box-shadow: var(--blok-database-feed-card-shadow)');
    expect(css).toMatch(/--blok-database-feed-card-shadow:\s*rgba\(0, 0, 0, 0\.02\) 0 12px 32px, rgba\(0, 0, 0, 0\.05\) 0 0 0 1px/);
    expect(ruleBody('[data-blok-database-feed-title]')).toMatch(/font-size:\s*26px/);
    expect(ruleBody('[data-blok-database-feed-title]')).toMatch(/font-weight:\s*600/);
    expect(ruleBody('[data-blok-database-feed-author]')).toMatch(/font-weight:\s*500/);
  });

  // notion-motion.md Round 32 §3 Feed (notion-live/r32-b-feed-geom.raw): avatar 24 at 555, name at 587, time 12px 6 after it, title at 587, cards 24 apart.
  it('lays out the byline and cards as Notion\'s feed', () => {
    const avatar = ruleBody('[data-blok-database-feed-byline] > [data-blok-database-person-avatar]');

    expect(avatar).toContain('width: 24px');
    expect(avatar).toContain('height: 24px');
    expect(ruleBody('[data-blok-database-feed-byline] > [data-blok-database-person-initial]')).toBe(avatar);
    expect(avatar).toContain('margin-inline-end: var(--blok-space-0-5)');
    expect(ruleBody('[data-blok-database-feed-byline]')).toContain('align-items: center');
    expect(ruleBody('[data-blok-database-feed-byline]')).toContain('gap: var(--blok-space-1-5)');
    expect(ruleBody('[data-blok-database-feed-time]')).toMatch(/font-size:\s*12px/);
    expect(ruleBody('[data-blok-database-feed-byline] + [data-blok-database-feed-title]')).toContain('margin-inline-start: calc(var(--blok-space-6) + var(--blok-space-2))');
    expect(ruleBody('[data-blok-database-feed-byline] + [data-blok-database-feed-head]')).toContain('margin-inline-start: calc(var(--blok-space-6) + var(--blok-space-2))');
    expect(ruleBody('[data-blok-database-feed]')).toContain('gap: var(--blok-space-6)');
  });

  // notion-motion.md Round 33 §5 (r33-feed-*.raw): "(edited)" is 12px, 3.3 after the time (a space). Its ink stays
  // the time's AA ink, not Notion's rgb(161,158,153). With no byline the title sits at card x + 18, not indented.
  it('sets "(edited)" as the time, a space after it, and starts a byline-less title 18 in', () => {
    const edited = ruleBody('[data-blok-database-feed-edited]');

    expect(edited).toMatch(/font-size:\s*12px/);
    expect(edited).toContain('color: var(--blok-database-table-muted-text)');
    expect(edited).toContain('margin-inline-start: calc(var(--blok-space-0-75) * -1)');
    for (const part of ['title', 'head']) {
      expect(ruleBody(`[data-blok-database-feed-card]:not(:has(> [data-blok-database-feed-byline])) > [data-blok-database-feed-${part}]`))
        .toContain('margin-inline-start: var(--blok-space-0-5)');
    }
  });

  // notion-motion.md Round 45 §1 Feed card (r45-n-feed.raw, r45-n-feedprops.raw): under a byline the property line
  // starts at the title column (x 587), the reaction chip and composer 6 further in (x 593), the input at 622.5.
  it('lines the card footer up with the title column', () => {
    expect(ruleBody('[data-blok-database-feed-byline] ~ [data-blok-database-feed-properties]'))
      .toContain('margin-inline-start: calc(var(--blok-space-6) + var(--blok-space-2))');
    for (const part of ['reactions', 'comments']) {
      expect(ruleBody(`[data-blok-database-feed-byline] ~ [data-blok-database-feed-${part}]`))
        .toContain('margin-inline-start: calc(var(--blok-space-6) + var(--blok-space-3-5))');
    }
    expect(ruleBody('[data-blok-database-feed-comments] [data-blok-database-comment-composer]')).toContain('gap: 5.5px');
  });

  // Same raws: the chip at card + 93.5 (+ 123.5 under a property line with its pills at + 87.5), the composer
  // 14 under the chip, its input 27 tall, the card 175.5 tall.
  it('spaces the footer as Notion\'s feed card', () => {
    expect(ruleBody('[data-blok-database-feed-reactions]')).toContain('margin-block-start: 11.5px');
    expect(ruleBody('[data-blok-database-feed-properties] + [data-blok-database-feed-reactions]')).toContain('margin-block-start: 8.5px');
    expect(ruleBody('[data-blok-database-feed-properties]')).toContain('margin-block-start: var(--blok-space-1)');
    expect(ruleBody('[data-blok-database-feed-comments]')).toContain('margin-block-start: var(--blok-space-1-5)');
    expect(ruleBody('[data-blok-database-feed-comments] [data-blok-database-comment-input]')).toContain('min-height: 27px');
    expect(ruleBody('[data-blok-database-feed-comments] [data-blok-database-comment-composer] > [data-blok-database-comment-avatar]'))
      .toContain('align-self: flex-start');
  });

  // Same raws: Notion's composer tools are at opacity 0 until the box has focus. A focused textarea always matches
  // :focus-visible, and so does a send button reached by Tab.
  it('hides the composer send button until the composer has focus', () => {
    expect(ruleBody('[data-blok-database-feed-comments] [data-blok-database-comment-composer]:not(:has(:focus-visible)) > [data-blok-database-comment-send]'))
      .toContain('opacity: 0');
  });

  // r45-n-feedprops.raw: a 21 line, chips 13/18, 18 tall with 8 padding, 14 apart, the checkbox 14.
  it('sets the property line chips at 13px, 14 apart', () => {
    const pill = ruleBody('[data-blok-database-feed-properties] [data-blok-database-option-pill]');

    expect(pill).toMatch(/font-size:\s*13px/);
    expect(pill).toMatch(/line-height:\s*18px/);
    expect(pill).toMatch(/height:\s*18px/);
    expect(pill).toContain('padding: 0 var(--blok-space-2)');
    expect(ruleBody('[data-blok-database-feed-properties]')).toContain('line-height: 21px');
    expect(ruleBody('[data-blok-database-feed-properties]')).toContain('gap: var(--blok-space-1) var(--blok-space-3-5)');
    expect(ruleBody('[data-blok-database-feed-properties] [data-blok-database-checkbox]')).toContain('width: 14px');
    // Each value sits centred on the line: pills 1.5 under its top, the checkbox 3.5.
    expect(ruleBody('[data-blok-database-feed-property]')).toContain('align-items: center');
  });

  it('marks a turned-off legend entry with muted ink, never a fill', () => {
    const off = ruleBody('[data-blok-database-chart-legend-entry][aria-pressed="false"]');

    expect(off).toContain('color: var(--blok-database-table-muted-text)');
    expect(off).not.toMatch(/background/);
  });

  it('rings chart, legend, drilldown and feed controls only after keyboard use', () => {
    for (const selector of ['[data-blok-database-chart-hit]', '[data-blok-database-chart-legend-entry]', '[data-blok-database-drilldown-close]', '[data-blok-database-feed-title]']) {
      expect(css).toContain(`:where(:root:not([data-blok-modality="pointer"])) ${selector}:focus-visible`);
    }
  });

  it('drops the drilldown fade for reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\[data-blok-database-drilldown\]\s*\{\s*animation: none;/);
  });
});

/** The token's value in the media-query dark block, then the theme-attribute copy. */
const darkValues = (name: string): string[] =>
  Array.from(css.matchAll(new RegExp(`${name}:\\s*([^;]+);`, 'g'))).map((m) => (m[1] ?? '').trim()).slice(1);

describe('feed in dark (research/21 §1j)', () => {
  it.each([
    ['--blok-database-feed-card-bg', 'rgb(32, 32, 32)'],
    ['--blok-database-feed-card-shadow', 'rgba(255, 255, 255, 0.05) 0 0 0 1px inset'],
    ['--blok-database-feed-reaction-bg', 'rgb(32, 32, 32)'],
  ])('%s is %s in both dark blocks', (token, value) => {
    expect(darkValues(token)).toEqual([value, value]);
  });

  it('sets the time stamp in tertiary ink, measured rgb(161, 158, 153) light and rgb(125, 122, 117) dark', () => {
    expect(ruleBody('[data-blok-database-feed-time]')).toContain('color: var(--blok-database-table-muted-text)');
  });
});
