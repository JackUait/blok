import { describe, it, expect } from 'vitest';
import { readMainCss } from './helpers/read-main-css';

const css = readMainCss();

const PERIOD = 12;
// The cards in DOM order (empty-window.ts DECK_KINDS) and the tone each one gives the window.
const CARDS = [
  ['video', 'red'], ['social', 'blue'], ['design', 'purple'], ['audio', 'pink'], ['table', 'green'],
] as const;

const delayOf = (child: number): number => {
  const match = new RegExp(`\\.blok-embed-deck__card:nth-child\\(${child}\\)\\s*\\{[^}]*animation-delay:\\s*(-?[\\d.]+)s`).exec(css);

  return match ? parseFloat(match[1]) : Number.NaN;
};

const keyframes = (name: string): string => {
  const at = css.indexOf(`@keyframes ${name}`);

  return at === -1 ? '' : css.slice(at, css.indexOf('\n}', at));
};

describe('embed idle deck', () => {
  it('spaces the five cards evenly through the shuffle, so one card leads at a time', () => {
    const phases = CARDS.map((_, i) => ((-delayOf(i + 1) / PERIOD) * 100) % 20);

    expect(new Set(phases.map((phase) => phase.toFixed(3))).size).toBe(1);
    expect(new Set(CARDS.map((_, i) => Math.floor((-delayOf(i + 1) / PERIOD) * 5))).size).toBe(5);
  });

  // A card takes the lead when its own shuffle wraps to 0%. The window must be in that card's colour 6% later.
  it.each(CARDS.map(([kind, tone], i) => [kind, tone, i] as const))('turns the window %s-coloured (%s) when that card takes the lead', (_kind, tone, i) => {
    const lead = Math.round(100 - (-delayOf(i + 1) / PERIOD) * 100);
    const settled = (lead + 6) % 100;
    const block = new RegExp(`(?:^|[\\s,}])${settled}%[^{]*\\{([^}]*)\\}`).exec(keyframes('blok-embed-deck-tone'))?.[1] ?? '';

    expect(block).toContain(`--blok-color-${tone}-text`);
  });

  it('shuffles only for people who have not asked for less motion', () => {
    const calm = css.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, '');

    expect(calm).not.toMatch(/animation:[^;]*blok-embed-deck-(shuffle|tone)/);
    expect(css).toMatch(/animation:[^;]*blok-embed-deck-shuffle/);
  });

  it('keeps the colour cycle running while the window shakes off a bad link', () => {
    const rule = /\.blok-embed-window\[data-kind='idle'\]\[data-anim='rejected'\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(rule).toContain('blok-embed-deck-tone');
    expect(rule).toContain('blok-embed-rejected');
  });
});
