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
  '--blok-database-feed-fade',
  '--blok-database-feed-see-more-shadow',
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

  // notion-motion.md Round 72 §5 Feed: Notion's avatar, name and time sit 2px lower (avatar at card + 18); the title and the rest do not move.
  it('draws the byline 2px lower without moving what follows it', () => {
    const byline = ruleBody('[data-blok-database-feed-byline]');

    expect(byline).toContain('position: relative');
    expect(byline).toContain('inset-block-start: var(--blok-space-0-5)');
    expect(byline).not.toMatch(/margin|padding|translate|transform/);
  });

  // notion-motion.md Round 72 §5, Round 73 §1: Notion's time is a 12/16 box at card + 23, 1 under the
  // byline's centre (avatar 24 at + 18). A 2px top margin in the centred row puts the 16 box there.
  it('sets the byline time as a 12/16 box at card + 23', () => {
    for (const part of ['time', 'edited']) {
      const rule = ruleBody(`[data-blok-database-feed-${part}]`);

      expect(rule).toContain('line-height: 16px');
      expect(rule).toContain('margin-block-start: var(--blok-space-0-5)');
    }
  });

  // notion-motion.md Round 72 §5: Notion's title under a byline is a 30.5 box at card + 45.5; Blok's was 26 at + 48.
  // The box grows 2.25 each side and pulls 2.5 up, 2 in below, so what follows stays put.
  it('boxes the title under a byline as Notion\'s: 30.5 tall at card + 45.5, nothing under it moves', () => {
    const title = ruleBody('[data-blok-database-feed-byline] + [data-blok-database-feed-title]');

    expect(title).toContain('padding-block: 2.25px');
    expect(title).toContain('margin-block: -2.5px calc(var(--blok-space-0-5) * -1)');
  });

  // notion-motion.md Round 72 §5 Feed (notion-live/r45-n-feed-svg.raw): "More actions" is a 16px glyph at 1192, React stays 20.
  it('draws the "More actions" glyph at 16px and leaves React at 20', () => {
    const more = ruleBody('[data-blok-database-feed-more-actions] > svg');

    expect(more).toContain('inline-size: 16px');
    expect(more).toContain('block-size: 16px');
    expect(ruleBody('[data-blok-database-feed-react] > svg')).toBe('');
    expect(ruleBody('[data-blok-database-feed-react] svg')).toBe('');
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

  // notion-motion.md Round 61 §6 Feed: the first card sits 50 under the tab row, 2 higher than a 16 top pad put it.
  it('pads the feed 14 above the first card and 16 below the last', () => {
    expect(ruleBody('[data-blok-database-feed]')).toContain('padding-block: var(--blok-space-3-5) var(--blok-space-4)');
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

  // notion-motion.md Round 49 §A4 (r49-n-feed-cols.raw): under a byline the preview is 600 wide with 30 each side
  // (card content 555..1215 → 585..1185), and its text sits 8 in (593..1177).
  it('sets the body preview in Notion\'s 600 column with its text 8 in, in 14/21', () => {
    const body = ruleBody('[data-blok-database-feed-byline] ~ [data-blok-database-feed-body]');

    expect(body).toContain('margin-inline: 30px');
    expect(body).toContain('padding-inline: var(--blok-space-2)');
    expect(ruleBody('[data-blok-database-feed-body]')).toMatch(/font-size:\s*14px/);
    expect(ruleBody('[data-blok-database-feed-body]')).toMatch(/line-height:\s*21px/);
  });

  // notion-motion.md Round 47 §C (r47-n-feed-delta.raw): each preview block has 6 above and below, its text 2 more;
  // headings take the page sizes x 0.875 with the page's top padding.
  it('sets preview headings at Notion\'s page sizes with their top padding', () => {
    expect(ruleBody('[data-blok-database-feed-body]')).toMatch(/gap:\s*0/);
    expect(ruleBody('[data-blok-database-feed-line]')).toContain('padding-block: var(--blok-space-2)');
    for (const [level, size, line, top] of [['h1', '26.25px', '34.125px', '32px'], ['h2', '21px', '27.3px', 'calc(var(--blok-space-6) + var(--blok-space-1))'], ['h3', '17.5px', '22.75px', 'var(--blok-space-6)']]) {
      const rule = ruleBody(`[data-blok-database-feed-line][data-level="${level}"]`);

      expect(rule).toContain(`font-size: ${size}`);
      expect(rule).toContain(`line-height: ${line}`);
      expect(rule).toContain(`padding-block-start: ${top}`);
    }
  });

  // notion-motion.md Round 47 §C: the title block is 28.5 + a 5 margin, so the preview starts 7.5 under Blok's 26 title
  // (the card gap gives 8); the footer's 12 top padding puts the chip 12 under the preview.
  it('spaces the preview under the title and the chip under the preview as Notion', () => {
    for (const before of ['title', 'head']) {
      expect(ruleBody(`[data-blok-database-feed-${before}] + [data-blok-database-feed-body]`)).toContain('margin-block-start: -0.5px');
    }
    expect(ruleBody('[data-blok-database-feed-body] + [data-blok-database-feed-reactions]')).toContain('margin-block-start: var(--blok-space-1)');
  });

  // notion-motion.md Round 48 §C (r48-n-feed-alpha-prop.raw): the property row ends 111.5 with a 12 margin, so the
  // preview starts 123.5. Blok's 21 row ends 107 and the card gap gives 8, so 8.5 more.
  it('starts the preview under a property line where Notion does', () => {
    expect(ruleBody('[data-blok-database-feed-properties] + [data-blok-database-feed-body]')).toContain('margin-block-start: 8.5px');
  });

  // notion-motion.md Round 48 §C (r48-n-feed-alpha.raw): the image block has 8 padding, the image is the 600 preview
  // less 16 (584), radius 2.
  it('pads a preview image as Notion\'s image block', () => {
    const image = ruleBody('[data-blok-database-feed-image]');

    expect(image).toContain('margin-block: var(--blok-space-2)');
    expect(image).toContain('max-inline-size: min(100%, 584px)');
    expect(image).toContain('border-radius: var(--blok-radius-mark)');
  });

  // notion-motion.md Round 48 §C (r48-n-feed-alpha.raw): the preview is max-height 500, overflow hidden. The chip is
  // 24.8 tall, centred; padding 4 10 4 8, gap 5, 12/16.8, radius 6, dark fill. Round 49 §A2 (r49-n-feed-cols.raw):
  // the chip sits in a 30 fade strip at bottom -2, with margin-top -4, so its top is 468 under the preview's.
  it('caps the preview at 500 with Notion\'s See more chip over its end', () => {
    const body = ruleBody('[data-blok-database-feed-body]');

    expect(body).toContain('position: relative');
    expect(body).toContain('max-block-size: 500px');
    expect(body).toContain('overflow: hidden');
    expect(ruleBody('[data-blok-database-feed-body][data-expanded]')).toContain('max-block-size: none');
    expect(ruleBody('[data-blok-database-feed-body] > *')).toContain('flex-shrink: 0');
    const fade = ruleBody('[data-blok-database-feed-fade]');

    expect(fade).toContain('position: absolute');
    expect(fade).toContain('inset-inline: 0');
    expect(fade).toContain('inset-block-end: 0');
    expect(fade).toContain('block-size: 28px');
    expect(fade).toContain('z-index: 1');
    expect(fade).toContain('justify-content: center');
    expect(fade).toContain('align-items: flex-start');
    expect(fade).toContain('background: var(--blok-database-feed-fade) top / 100% 30px no-repeat');
    expect(css).toMatch(/--blok-database-feed-fade:\s*linear-gradient\(rgba\(255, 255, 255, 0\) 0, rgb\(255, 255, 255\) 30px\)/);
    const chip = ruleBody('[data-blok-database-feed-see-more]');

    expect(chip).not.toContain('position: absolute');
    expect(chip).toContain('margin-block-start: calc(-1 * var(--blok-space-1))');
    expect(chip).toContain('padding: var(--blok-space-1) 10px var(--blok-space-1) var(--blok-space-2)');
    expect(chip).toContain('gap: var(--blok-space-1-25)');
    expect(chip).toContain('font-size: 12px');
    expect(chip).toContain('line-height: 16.8px');
    expect(chip).toContain('border-radius: var(--blok-radius-control)');
    expect(chip).toContain('background-color: var(--blok-tooltip-bg)');
    expect(chip).toContain('color: var(--blok-tooltip-font)');
    expect(chip).toContain('box-shadow: var(--blok-database-feed-see-more-shadow)');
    expect(css).toMatch(/--blok-database-feed-see-more-shadow:\s*rgba\(0, 0, 0, 0\.08\) 0 4px 12px -2px, rgba\(255, 255, 255, 0\.05\) 0 0 0 1px inset;/);
    expect(ruleBody('[data-blok-database-feed-see-more] svg')).toContain('inline-size: 12px');
  });

  // notion-motion.md Round 47 §C: with no byline the chip and composer keep an 8 inset (card x + 24).
  it('keeps the footer column 8 in when there is no byline', () => {
    for (const part of ['reactions', 'comments']) {
      expect(ruleBody(`[data-blok-database-feed-card]:not(:has(> [data-blok-database-feed-byline])) > [data-blok-database-feed-${part}]`))
        .toContain('margin-inline-start: var(--blok-space-2)');
    }
  });

  // notion-motion.md Round 50 §7: with no byline Notion's preview fills the card (555..1215) and its text sits 8 in (563..1207).
  it('fills the card with a byline-less preview and keeps its text 8 in on both sides', () => {
    const body = ruleBody('[data-blok-database-feed-card]:not(:has(> [data-blok-database-feed-byline])) > [data-blok-database-feed-body]');

    expect(body).toContain('padding-inline: var(--blok-space-2)');
    expect(body).not.toContain('margin-inline-start');
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
