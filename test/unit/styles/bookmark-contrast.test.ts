import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const COLORS_CSS = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8');
const BOOKMARK_CSS = readFileSync(resolve(__dirname, '../../../src/styles/bookmark.css'), 'utf8');

type Rgba = [number, number, number, number];

const parseColor = (value: string): Rgba => {
  if (value === 'black') {
    return [0, 0, 0, 1];
  }

  const hex = /^#([0-9a-f]{6})$/i.exec(value);

  if (hex) {
    return [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16)).concat(1) as Rgba;
  }

  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);

  if (!rgba) {
    throw new Error(`unsupported color: ${value}`);
  }

  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
};

/** One value per theme block in colors.css: light root, dark media query, dark attribute. */
const tokenPerTheme = (name: string): Rgba[] =>
  Array.from(COLORS_CSS.matchAll(new RegExp(`^\\s*--blok-${name}:\\s*([^;]+);`, 'gm')), (m) => parseColor(m[1].trim()));

const over = (surface: Rgba, [r, g, b, a]: Rgba): Rgba =>
  [surface[0] * (1 - a) + r * a, surface[1] * (1 - a) + g * a, surface[2] * (1 - a) + b * a, 1];

const mix = (first: Rgba, second: Rgba, share: number): Rgba =>
  [0, 1, 2].map((i) => first[i] * share + second[i] * (1 - share)).concat(1) as Rgba;

const channel = (value: number): number => {
  const c = Math.round(value) / 255;

  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: Rgba): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const contrast = (a: Rgba, b: Rgba): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

const ruleBody = (selector: string): string => {
  const start = BOOKMARK_CSS.indexOf(`${selector} {`);

  if (start === -1) {
    throw new Error(`missing rule: ${selector}`);
  }

  return BOOKMARK_CSS.slice(start, BOOKMARK_CSS.indexOf('}', start));
};

/**
 * The text ink a rule declares, as a share of --blok-text-secondary mixed into
 * --blok-text-primary. A plain secondary token is a share of 1.
 */
const secondaryShare = (selector: string): number => {
  const color = /\scolor:\s*([^;]+);/.exec(ruleBody(selector))?.[1].trim();

  if (color === 'var(--blok-text-secondary)') {
    return 1;
  }

  const share = /^color-mix\(in srgb, var\(--blok-text-secondary\) (\d+)%, var\(--blok-text-primary\)\)$/.exec(color ?? '');

  if (!share) {
    throw new Error(`${selector} ink is no longer secondary mixed into primary: ${color}`);
  }

  return Number(share[1]) / 100;
};

/** Bar tint share of --blok-text-primary over --blok-bg-primary. */
const windowBarShare = (): number => {
  const share = /background:\s*color-mix\(in srgb, var\(--blok-text-primary\) (\d+)%, var\(--blok-bg-primary\)\);/.exec(
    ruleBody('[data-blok-tool="bookmark"] .blok-bookmark__window-bar')
  );

  if (!share) {
    throw new Error('window bar no longer tints --blok-bg-primary with --blok-text-primary');
  }

  return Number(share[1]) / 100;
};

const THEMES = ['light', 'dark (media query)', 'dark (data-theme)'];

const theme = (index: number): Record<'secondary' | 'primary' | 'bg' | 'hover' | 'selection', Rgba> => ({
  secondary: tokenPerTheme('text-secondary')[index],
  primary: tokenPerTheme('text-primary')[index],
  bg: tokenPerTheme('bg-primary')[index],
  hover: tokenPerTheme('item-hover-bg')[index],
  selection: tokenPerTheme('selection')[index],
});

describe('bookmark gray text contrast', () => {
  it('reads one value per theme block for every token it uses', () => {
    for (const name of ['text-secondary', 'text-primary', 'bg-primary', 'item-hover-bg', 'selection']) {
      expect(tokenPerTheme(name), name).toHaveLength(THEMES.length);
    }
  });

  THEMES.forEach((label, index) => {
    it(`keeps the address pill path at WCAG AA on every card state in ${label}`, () => {
      const t = theme(index);
      const ink = mix(t.secondary, t.primary, secondaryShare('[data-blok-tool="bookmark"] .blok-bookmark__path'));
      const selected = over(t.bg, t.selection);
      // The pill is a translucent tint, so it stacks on whatever the card paints under it.
      const cards: Record<string, Rgba> = {
        resting: t.bg,
        hover: over(t.bg, t.hover),
        selected,
        'selected + hover': over(selected, t.hover),
      };
      const failing = Object.entries(cards)
        .map(([state, card]) => ({ state, ratio: contrast(ink, over(card, t.hover)) }))
        .filter(({ ratio }) => ratio < 4.5);

      expect(failing).toStrictEqual([]);
    });

    it(`keeps the window bar address at WCAG AA in ${label}`, () => {
      const t = theme(index);
      const ink = mix(t.secondary, t.primary, secondaryShare('[data-blok-tool="bookmark"] .blok-bookmark__window-bar > span'));
      // The window is opaque, so card hover and selection never reach the bar.
      const bar = mix(t.primary, t.bg, windowBarShare());

      expect(contrast(ink, over(bar, t.hover))).toBeGreaterThanOrEqual(4.5);
    });
  });
});
