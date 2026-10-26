import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const DATABASE_CSS = readFileSync(resolve(__dirname, '../../../src/styles/database.css'), 'utf8');
const COLORS_CSS = readFileSync(resolve(__dirname, '../../../src/styles/colors.css'), 'utf8');

type Rgba = [number, number, number, number];

const THEMES = ['light', 'dark (media query)', 'dark (data-theme)'] as const;
const GAUGE_COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

const parseColor = (value: string): Rgba => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value);

  if (hex) {
    return [0, 2, 4].map((at) => parseInt(hex[1].slice(at, at + 2), 16)).concat(1) as Rgba;
  }

  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value);

  if (!rgb) {
    throw new Error(`unsupported color: ${value}`);
  }

  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] === undefined ? 1 : Number(rgb[4])];
};

/** Per theme: [light, dark media, dark attribute]. Two definitions in a file are its dark pair. */
const perTheme = (css: string, name: string): Array<string | undefined> => {
  const values = Array.from(css.matchAll(new RegExp(`^\\s*--${name}:\\s*([^;]+);`, 'gm')), (m) => m[1].trim());

  switch (values.length) {
    case 0: return [undefined, undefined, undefined];
    case 1: return [values[0], values[0], values[0]];
    case 2: return [undefined, values[0], values[1]];
    case 3: return values;
    default: throw new Error(`--${name} has ${values.length} definitions`);
  }
};

/** database.css loads after colors.css, so its value wins. */
const token = (name: string, theme: number): Rgba => {
  const value = perTheme(DATABASE_CSS, name)[theme] ?? perTheme(COLORS_CSS, name)[theme];

  if (value === undefined) {
    throw new Error(`--${name} is not set for theme ${theme}`);
  }

  return parseColor(value);
};

const over = (surface: Rgba, [r, g, b, a]: Rgba): Rgba =>
  [surface[0] * (1 - a) + r * a, surface[1] * (1 - a) + g * a, surface[2] * (1 - a) + b * a, 1];

const channel = (value: number): number => {
  const c = Math.round(value) / 255;

  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: Rgba): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const contrast = (a: Rgba, b: Rgba): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);

  return (hi + 0.05) / (lo + 0.05);
};

/** The token a gauge colour paints its fill with, read from its rule. */
const gaugeInk = (color: string): string => {
  const rule = new RegExp(`\\[data-blok-database-number-bar\\]\\[data-color="${color}"\\], \\[data-blok-database-number-ring\\]\\[data-color="${color}"\\] \\{ --blok-database-number-ink: var\\(--([\\w-]+)\\); \\}`).exec(DATABASE_CSS);

  if (!rule) {
    throw new Error(`no gauge rule for ${color}`);
  }

  return rule[1];
};

/** The surfaces a gauge sits on at rest: the table and row page, board, gallery and feed cards.
    Hover fills are left out: on them Notion's orange, brown, green, purple and pink fall under 3:1 too. */
const surfaces = (theme: number): Record<string, Rgba> => {
  const page = token('blok-bg-primary', theme);

  return {
    page,
    'board card': over(page, token('blok-database-card-bg', theme)),
    'gallery card': over(page, token('blok-database-gallery-card-bg', theme)),
    'feed card': over(page, token('blok-database-feed-card-bg', theme)),
  };
};

describe('number gauge fill contrast (WCAG 1.4.11, 3:1 for graphics)', () => {
  THEMES.forEach((theme, index) => {
    it(`every gauge colour reaches 3:1 on every surface it is drawn on, ${theme}`, () => {
      const failures = GAUGE_COLORS.flatMap((color) => Object.entries(surfaces(index))
        .map(([surface, bg]) => ({ color, surface, ratio: Number(contrast(token(gaugeInk(color), index), bg).toFixed(3)) }))
        .filter(({ ratio }) => ratio < 3));

      expect(failures).toEqual([]);
    });
  });

  it('the yellow gauge keeps Notion\'s hue: rgb(189, 141, 35) is rgb(216, 163, 47) darkened in HSL to the first 3:1 step', () => {
    expect(token(gaugeInk('yellow'), 0)).toEqual([189, 141, 35, 1]);
    // Dark passes with Notion's own value.
    expect(token(gaugeInk('yellow'), 1)).toEqual([216, 163, 47, 1]);
    expect(token(gaugeInk('yellow'), 2)).toEqual([216, 163, 47, 1]);
  });

  it('the yellow status dot keeps Notion\'s value: the gauge has its own token', () => {
    expect(gaugeInk('yellow')).not.toBe('blok-database-status-dot-yellow');
    expect(token('blok-database-status-dot-yellow', 0)).toEqual([216, 163, 47, 1]);
  });
});
