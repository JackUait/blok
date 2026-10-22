/**
 * The database confirm dialog uses the measured Notion values (research/08,
 * "Would you like to remove sorting?"). jsdom has no CSS, so these read the source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (file: string): string => readFileSync(resolve(__dirname, '../../../src/styles', file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const database = read('database.css');
const keyframes = read('keyframes.css');

const ruleBody = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^{}]*)\\}`));

  return match?.[1] ?? '';
};

const tokenValues = (name: string): string[] =>
  [ ...database.matchAll(new RegExp(`${name}: ([^;]+);`, 'g')) ].map((m) => m[1].trim());

describe('database confirm dialog css', () => {
  it('dims the page behind with the measured backdrop', () => {
    expect(ruleBody(database, '[data-blok-database-confirm]')).toContain('background-color: var(--blok-database-confirm-backdrop)');
    expect(tokenValues('--blok-database-confirm-backdrop')[0]).toBe('rgba(15, 15, 15, 0.6)');
  });

  it('draws a 324px panel with 20px padding, the dialog radius and the three-layer shadow', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-dialog]');

    expect(body).toContain('width: 324px');
    expect(body).toContain('padding: 20px');
    expect(body).toContain('border-radius: var(--blok-radius-dialog)');
    expect(body).toContain('box-shadow: var(--blok-database-confirm-shadow)');
    expect(tokenValues('--blok-database-confirm-shadow')[0])
      .toBe('rgba(25, 25, 25, 0.24) 0 24px 48px, rgba(25, 25, 25, 0.14) 0 4px 12px, rgba(42, 28, 0, 0.07) 0 0 0 1px');
  });

  it('enters with scale .97 to 1 and opacity over 200ms ease', () => {
    expect(ruleBody(database, '[data-blok-database-confirm-dialog]')).toContain('animation: blok-database-confirm-in 200ms ease both');
    expect(keyframes).toMatch(/@keyframes blok-database-confirm-in \{ from \{ opacity: 0; transform: scale\(0\.97\); \} to \{ opacity: 1; transform: none; \} \}/);
  });

  // research/33 §3.10 and 26 §5a read weight 500 (the older 08 and 10 read 600).
  it('centres a 16px/24px medium title', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-title]');

    expect(body).toContain('font-weight: 500');
    expect(body).toContain('font-size: 16px');
    expect(body).toContain('line-height: 24px');
    expect(body).toContain('text-align: center');
  });

  // research/26 §5a reads 17px/22px on "Delete the last view…"; research/10 §5 reads 17px on Reset.
  it('grows the title to 17px/22px on a dialog marked large', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-dialog][data-large-title] [data-blok-database-confirm-title]');

    expect(body).toContain('font-size: 17px');
    expect(body).toContain('line-height: 22px');
  });

  // research/10 §5: Reset's Cancel has no border or fill and Notion's grey rgb(125, 122, 117),
  // which is 4.27:1 on white; the secondary ink is the nearest AA step.
  it('draws a quiet Cancel with no border and the secondary ink', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-action][data-quiet]');

    expect(body).toContain('border-color: transparent');
    expect(body).toContain('color: var(--blok-database-ink-secondary)');
  });

  // research/33 §3.10 reads the body 12px/400 (the older 10 §5 read 14px). Notion's grey
  // rgb(125, 122, 117) is 4.27:1 on white, so Blok keeps its AA secondary ink.
  it('centres a 12px secondary description under the title', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-description]');

    expect(body).toContain('font-size: 12px');
    expect(body).toContain('line-height: 16px');
    expect(body).toContain('font-weight: 400');
    expect(body).toContain('text-align: center');
    expect(body).toContain('color: var(--blok-database-ink-secondary)');
  });

  it('stacks full-width 32px buttons with the control radius', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-action]');

    expect(body).toContain('width: 100%');
    expect(body).toContain('height: 32px');
    expect(body).toContain('margin-top: var(--blok-space-2)');
    expect(body).toContain('border-radius: var(--blok-radius-control)');
    expect(body).toContain('font-size: 14px');
    expect(body).toContain('font-weight: 500');
  });

  it('paints the destructive button with red text and a red hairline', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-action][data-destructive]');

    expect(body).toContain('color: var(--blok-database-confirm-destructive-text)');
    expect(body).toContain('border-color: var(--blok-database-confirm-destructive-border)');
    // Light is the AA step of Notion's rgb(229, 100, 88); dark keeps the measured value.
    expect(tokenValues('--blok-database-confirm-destructive-text')).toEqual(['rgb(182, 79, 70)', 'rgb(229, 100, 88)', 'rgb(229, 100, 88)']);
    expect(tokenValues('--blok-database-confirm-destructive-border')[0]).toBe('rgba(206, 24, 0, 0.165)');
  });

  // research/26 §5a, 23 §7, 10 §5: Notion fills with rgb(229, 100, 88) under a rgb(253, 246, 246) label,
  // 3.13:1 and failing AA. Blok keeps its AA red as the fill in both themes (4.69:1).
  it('fills a filled destructive button with the AA red under the measured label ink', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-action][data-destructive][data-filled]');

    expect(body).toContain('border-color: transparent');
    expect(body).toContain('background-color: var(--blok-database-confirm-destructive-fill)');
    expect(body).toContain('color: var(--blok-database-confirm-destructive-fill-text)');
    expect(tokenValues('--blok-database-confirm-destructive-fill')).toEqual(['rgb(182, 79, 70)', 'rgb(182, 79, 70)', 'rgb(182, 79, 70)']);
    expect(tokenValues('--blok-database-confirm-destructive-fill-text')).toEqual(['rgb(253, 246, 246)', 'rgb(253, 246, 246)', 'rgb(253, 246, 246)']);
  });

  // research/26 §5a: the picked card's ring and dot are rgb(229, 100, 88). Not text, so 3.34:1 passes the 3:1 bar.
  it('rings the picked card in Notion red in both themes', () => {
    expect(ruleBody(database, '[data-blok-database-confirm-choice][aria-checked="true"]'))
      .toContain('box-shadow: inset 0 0 0 1px var(--blok-database-confirm-choice-ring)');
    expect(ruleBody(database, '[data-blok-database-confirm-choice][aria-checked="true"] [data-blok-database-confirm-choice-dot]'))
      .toContain('border: 5px solid var(--blok-database-confirm-choice-ring)');
    expect(tokenValues('--blok-database-confirm-choice-ring')).toEqual(['rgb(229, 100, 88)', 'rgb(229, 100, 88)', 'rgb(229, 100, 88)']);
  });

  it('defines every confirm token in light and both dark blocks', () => {
    for (const name of ['backdrop', 'bg', 'shadow', 'destructive-text', 'destructive-border', 'destructive-hover-bg', 'destructive-fill', 'destructive-fill-text', 'choice-ring', 'choice-border', 'choice-dot', 'radio-border', 'radio-bg', 'divider', 'close-bg']) {
      expect(tokenValues(`--blok-database-confirm-${name}`), name).toHaveLength(3);
    }
  });

  // research/35 §1.7: dark dims harder (0.8), light stays 0.6.
  it('dims the page 0.8 in dark', () => {
    expect(tokenValues('--blok-database-confirm-backdrop')).toEqual(['rgba(15, 15, 15, 0.6)', 'rgba(15, 15, 15, 0.8)', 'rgba(15, 15, 15, 0.8)']);
  });

  // research/35 §1.7 (dark) and 36 §8.1 (light) "Undo Task Database?". Light is Notion's 16/255 alpha written out:
  // rounded to 0.063 the AA red label lands at 4.499:1.
  it('gives the destructive button the measured hairline and red hover', () => {
    expect(tokenValues('--blok-database-confirm-destructive-border'))
      .toEqual(['rgba(206, 24, 0, 0.165)', 'rgba(255, 104, 92, 0.24)', 'rgba(255, 104, 92, 0.24)']);
    expect(ruleBody(database, '[data-blok-database-confirm-action][data-destructive]:hover'))
      .toContain('background-color: var(--blok-database-confirm-destructive-hover-bg)');
    expect(tokenValues('--blok-database-confirm-destructive-hover-bg'))
      .toEqual(['rgba(223, 16, 0, 0.0627)', 'rgba(255, 105, 96, 0.114)', 'rgba(255, 105, 96, 0.114)']);
  });

  // research/36 §8.2: Reset is 300 wide; a 22px × 10px in, an older grey circle; a 32px icon; a 17px/600 title; 14px body.
  it('draws the small Reset dialog as measured', () => {
    expect(ruleBody(database, '[data-blok-database-confirm-dialog][data-small]')).toContain('width: 300px');
    const close = ruleBody(database, '[data-blok-database-confirm-dialog][data-small] [data-blok-database-confirm-close]');

    expect(close).toContain('width: 22px');
    expect(close).toContain('height: 22px');
    expect(close).toContain('inset-block-start: var(--blok-space-2-5)');
    expect(close).toContain('inset-inline-end: var(--blok-space-2-5)');
    expect(close).toContain('background-color: var(--blok-database-confirm-small-close-bg)');
    expect(close).toContain('color: var(--blok-database-confirm-small-close-icon)');
    expect(ruleBody(database, '[data-blok-database-confirm-dialog][data-small] [data-blok-database-confirm-close]:hover'))
      .toContain('background-color: var(--blok-database-confirm-small-close-hover-bg)');
    // Dark is unmeasured: the last-view circle, no hover change.
    expect(tokenValues('--blok-database-confirm-small-close-bg'))
      .toEqual(['rgba(55, 53, 47, 0.06)', 'var(--blok-database-confirm-close-bg)', 'var(--blok-database-confirm-close-bg)']);
    expect(tokenValues('--blok-database-confirm-small-close-hover-bg'))
      .toEqual(['rgba(55, 53, 47, 0.16)', 'var(--blok-database-confirm-close-bg)', 'var(--blok-database-confirm-close-bg)']);
    // Notion's glyph 142,139,134 is 2.54:1 on the hovered circle; 129,126,121 is the nearest 3:1 step.
    expect(tokenValues('--blok-database-confirm-small-close-icon'))
      .toEqual(['rgb(129, 126, 121)', 'var(--blok-database-table-header-icon)', 'var(--blok-database-table-header-icon)']);
    const art = ruleBody(database, '[data-blok-database-confirm-dialog][data-small] [data-blok-database-confirm-art]');

    expect(art).toContain('margin-bottom: var(--blok-space-2)');
    expect(art).toContain('color: var(--blok-database-table-header-icon)');
    const svg = ruleBody(database, '[data-blok-database-confirm-dialog][data-small] [data-blok-database-confirm-art] svg');

    expect(svg).toContain('inline-size: 32px');
    expect(svg).toContain('block-size: 32px');
    expect(ruleBody(database, '[data-blok-database-confirm-dialog][data-small] [data-blok-database-confirm-title]')).toContain('font-weight: 600');
    const body = ruleBody(database, '[data-blok-database-confirm-dialog][data-small] [data-blok-database-confirm-description]');

    expect(body).toContain('font-size: 14px');
    expect(body).toContain('line-height: 20px');
    // Dump rects: the body 8px under the title, Reset 24px under the body (box 226 tall).
    expect(body).toContain('margin-top: var(--blok-space-2)');
    expect(ruleBody(database, '[data-blok-database-confirm-dialog][data-small] [data-blok-database-confirm-action="confirm"]')).toContain('margin-top: var(--blok-space-6)');
  });

  // research/36 §8.2: Reset's label is pure white; dark is unmeasured and keeps the shared label ink.
  it('writes the small dialog\'s filled button label in white', () => {
    expect(ruleBody(database, '[data-blok-database-confirm-dialog][data-small] [data-blok-database-confirm-action][data-destructive][data-filled]'))
      .toContain('color: var(--blok-database-confirm-small-fill-text)');
    expect(tokenValues('--blok-database-confirm-small-fill-text'))
      .toEqual(['rgb(255, 255, 255)', 'var(--blok-database-confirm-destructive-fill-text)', 'var(--blok-database-confirm-destructive-fill-text)']);
  });

  // research/35 §10: a filled circle, 10px from the box's top and right.
  it('draws the last-view × as a filled circle 10px in from the corner', () => {
    expect(tokenValues('--blok-database-confirm-close-bg'))
      .toEqual(['rgba(42, 28, 0, 0.07)', 'rgba(255, 255, 243, 0.082)', 'rgba(255, 255, 243, 0.082)']);
    const body = ruleBody(database, '[data-blok-database-confirm-dialog][data-wide] [data-blok-database-confirm-close]');

    expect(body).toContain('inset-block-start: var(--blok-space-2-5)');
    expect(body).toContain('inset-inline-end: var(--blok-space-2-5)');
  });

  // research/35 §1.7: a 32px trash in the icon grey, 10px above the title.
  it('draws the last-view trash 32px in the icon grey', () => {
    expect(ruleBody(database, '[data-blok-database-confirm-dialog][data-wide] [data-blok-database-confirm-art]'))
      .toContain('margin-bottom: var(--blok-space-2-5)');
    expect(ruleBody(database, '[data-blok-database-confirm-dialog][data-wide] [data-blok-database-confirm-art]'))
      .toContain('color: var(--blok-database-table-header-icon)');
    const svg = ruleBody(database, '[data-blok-database-confirm-dialog][data-wide] [data-blok-database-confirm-art] svg');

    expect(svg).toContain('inline-size: 32px');
    expect(svg).toContain('block-size: 32px');
  });

  // research/35 §1.7: the cards sit between two full-width hairlines, 14px under the title and 20px above Delete view.
  it('frames the radio cards with full-width hairlines', () => {
    const body = ruleBody(database, '[data-blok-database-confirm-choices]');

    expect(body).toContain('margin-block: var(--blok-space-3-5) var(--blok-space-3)');
    expect(body).toContain('margin-inline: calc(-1 * var(--blok-space-5))');
    expect(body).toContain('padding-inline: var(--blok-space-5)');
    expect(body).toContain('border-block: 1px solid var(--blok-database-confirm-divider)');
    expect(tokenValues('--blok-database-confirm-divider'))
      .toEqual(['rgba(42, 28, 0, 0.07)', 'rgba(255, 255, 243, 0.082)', 'rgba(255, 255, 243, 0.082)']);
  });

  // research/35 §1.7: unpicked ring and radio, and the picked radio's light dot, as measured.
  // research/35 §1.7: label 14px from the card's start, radio 14px from its end (research/26 read 6px at the end).
  it('pads the radio cards 14px on both sides', () => {
    expect(ruleBody(database, '[data-blok-database-confirm-choice]')).toContain('padding-inline: var(--blok-space-3-5);');
  });

  // research/35 §1.7 dumps: cards 78 and 70 tall, the subtitle 2px under the label (a one-line card centres in 70).
  it('keeps the radio cards at least 70px with a 2px label gap', () => {
    expect(ruleBody(database, '[data-blok-database-confirm-choice]')).toContain('min-height: 70px');
    expect(ruleBody(database, '[data-blok-database-confirm-choice-description]')).toContain('margin-top: var(--blok-space-0-5)');
  });

  it('draws the unpicked card and both radios with the measured colours', () => {
    expect(ruleBody(database, '[data-blok-database-confirm-choice]'))
      .toContain('box-shadow: inset 0 0 0 1px var(--blok-database-confirm-choice-border)');
    expect(tokenValues('--blok-database-confirm-choice-border')).toEqual(['rgb(230, 229, 227)', 'rgb(56, 56, 54)', 'rgb(56, 56, 54)']);
    const dot = ruleBody(database, '[data-blok-database-confirm-choice-dot]');

    expect(dot).toContain('border: 1px solid var(--blok-database-confirm-radio-border)');
    expect(dot).toContain('background-color: var(--blok-database-confirm-radio-bg)');
    expect(tokenValues('--blok-database-confirm-radio-border')).toEqual(['rgba(27, 21, 0, 0.19)', 'rgba(255, 252, 235, 0.306)', 'rgba(255, 252, 235, 0.306)']);
    expect(tokenValues('--blok-database-confirm-radio-bg')).toEqual(['rgb(255, 255, 255)', 'rgb(37, 37, 37)', 'rgb(37, 37, 37)']);
    expect(ruleBody(database, '[data-blok-database-confirm-choice][aria-checked="true"] [data-blok-database-confirm-choice-dot]'))
      .toContain('background-color: var(--blok-database-confirm-choice-dot)');
    expect(tokenValues('--blok-database-confirm-choice-dot')).toEqual(['rgb(240, 239, 237)', 'rgb(240, 239, 237)', 'rgb(240, 239, 237)']);
  });

  it('drops the entrance under reduced motion', () => {
    expect(database).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\[data-blok-database-confirm-dialog\][^{]*\{ animation: none; \}/);
  });
});
