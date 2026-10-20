import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

/*
 * jsdom resolves no var() and loads no stylesheet from an import, so these read
 * the source, like selected-state-neutral.test.ts.
 */
const ASSISTANT_CSS = readFileSync(resolve(__dirname, '../../../src/styles/assistant.css'), 'utf8');
const MAIN_CSS = readMainCss();

/** Every rule whose selector names `attribute`: [selector, body]. */
const rulesFor = (attribute: string): Array<[string, string]> =>
  [...ASSISTANT_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selector]) => selector.includes(attribute))
    .map(([, selector, body]) => [selector.trim(), body]);

const PAINT = /(?:^|;)\s*(color|background|background-color)\s*:\s*([^;]+)/g;

const declarations = (token: string): string[] =>
  [...MAIN_CSS.matchAll(new RegExp(`${token}:\\s*([^;]+);`, 'g'))].map((match) => match[1].trim());

const channels = (paint: string): [number, number, number] | null => {
  const named: Record<string, [number, number, number]> = { black: [0, 0, 0], white: [255, 255, 255] };

  if (paint in named) {
    return named[paint];
  }

  const hex = paint.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];

  if (hex !== undefined) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;

    return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as [number, number, number];
  }

  const rgb = paint.match(/^rgba?\((\d+),?\s*(\d+),?\s*(\d+)/);

  return rgb === null ? null : [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
};

/** Every colour a value can paint, in every theme, through var() aliases. */
const paints = (value: string, seen = new Set<string>()): string[] => {
  const alias = value.match(/^var\((--[\w-]+)\)$/)?.[1];

  if (alias === undefined) {
    return [value];
  }
  if (seen.has(alias)) {
    return [];
  }
  seen.add(alias);

  return declarations(alias).flatMap((next) => paints(next, seen));
};

/** Blue family: blue clearly above both red and green. */
const isBlue = (paint: string): boolean => {
  const rgb = channels(paint);

  if (rgb === null) {
    return paint !== 'transparent';
  }

  const [r, g, b] = rgb;

  return b - Math.max(r, g) > 16;
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('Ask AI bar colours', () => {
  it('the colour reader flags blue and passes ink', () => {
    expect(isBlue('#2383e2')).toBe(true);
    expect(isBlue('rgb(76, 159, 255)')).toBe(true);
    expect(isBlue('black')).toBe(false);
    expect(isBlue('#e2e0dc')).toBe(false);
  });

  it.each([
    ['send', 'data-blok-assistant-send'],
    ['keep', 'data-blok-assistant-keep'],
    ['undo', 'data-blok-assistant-undo'],
  ])('%s and its states are not blue in any theme', (_name, attribute) => {
    const rules = rulesFor(attribute);
    const values = rules.flatMap(([, body]) => [...body.matchAll(PAINT)].map((match) => match[2].trim()));

    expect(values.length).toBeGreaterThan(0);
    values.forEach((value) => {
      const resolved = paints(value);

      expect(resolved.length, value).toBeGreaterThan(0);
      resolved.forEach((paint) => expect(isBlue(paint), `${value} → ${paint}`).toBe(false));
    });
  });

  it('send is ink when ready and a gray fill while the field is empty', () => {
    const send = rulesFor('data-blok-assistant-send');
    const ready = send.find(([selector]) => selector === '[data-blok-assistant-send]');
    const empty = send.find(([selector]) => selector.includes(':disabled'));

    expect(ready?.[1]).toMatch(/background:\s*var\(--blok-text-primary\)/);
    expect(empty?.[1]).toMatch(/background:\s*var\(--blok-border-subtle\)/);
  });

  it('the bar is not docked to the bottom of the window', () => {
    const bar = rulesFor('[data-blok-assistant]').filter(([selector]) => /^\[data-blok-assistant\](?:,|\[|$)/.test(selector));

    expect(bar.length).toBeGreaterThan(0);
    bar.forEach(([, body]) => expect(body).not.toMatch(/(?:^|;|\s)bottom\s*:/));
  });
});
