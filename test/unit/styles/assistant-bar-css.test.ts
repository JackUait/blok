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

/** Every declaration that applies to exactly `selector`, from each rule whose selector list names it. */
const bodyOf = (selector: string): string => rulesFor(selector.match(/data-blok-[\w-]+/)?.[0] ?? selector)
  .filter(([selectors]) => selectors.split(',').map((part) => part.trim()).includes(selector))
  .map(([, body]) => body)
  .join(';');

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
    ['stop', 'data-blok-assistant-stop'],
    ['action', 'data-blok-assistant-action'],
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
    expect(bodyOf('[data-blok-assistant-send]::after')).toMatch(/background:\s*var\(--blok-text-primary\)/);
    expect(bodyOf('[data-blok-assistant-send]:disabled::after')).toMatch(/background:\s*var\(--blok-border-subtle\)/);
  });

  it.each(['send', 'stop', 'keep'])('the %s ink sits over its halo, so a press or hover scale never lifts the halo over the ink', (name) => {
    const button = `[data-blok-assistant-${name}]`;

    expect(bodyOf(button)).toMatch(/isolation:\s*isolate/);
    expect(bodyOf(`${button}::after`)).toMatch(/z-index:\s*-1/);
    expect(bodyOf(`${button}::before`)).toMatch(/z-index:\s*-2/);
  });

  it.each([
    ['send', '[data-blok-assistant-send]:hover:not(:disabled)::before'],
    ['keep', '[data-blok-assistant-keep]:hover::before'],
  ])('the %s halo shows and turns only on hover', (name, hover) => {
    const rest = bodyOf(`[data-blok-assistant-${name}]::before`);

    expect(rest).toMatch(/background-image:\s*conic-gradient\(/);
    expect(rest).toMatch(/animation:[^;]*infinite/);
    expect(rest).toMatch(/opacity:\s*0\s*(;|$)/);
    expect(rest).toMatch(/animation-play-state:\s*paused/);
    expect(bodyOf(hover)).toMatch(/opacity:\s*(1|0\.\d+)\s*(;|$)/);
    expect(bodyOf(hover)).toMatch(/animation-play-state:\s*running/);
  });

  it('Keep and Discard are pills; Keep is ink and redraws its check on hover', () => {
    expect(bodyOf('[data-blok-assistant-keep]')).toMatch(/border-radius:\s*var\(--blok-radius-pill\)/);
    expect(bodyOf('[data-blok-assistant-undo]')).toMatch(/border-radius:\s*var\(--blok-radius-pill\)/);
    expect(bodyOf('[data-blok-assistant-keep]::after')).toMatch(/background:\s*var\(--blok-text-primary\)/);
    expect(bodyOf('[data-blok-assistant-keep]:hover svg path')).toMatch(/animation:[^;]*blok-assistant-draw/);
  });

  const reducedRule = (selector: string): string => {
    const reduced = [...ASSISTANT_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)]
      .map((match) => match[1])
      .join('\n');
    const found = [...reduced.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, selectors]) => selectors.split(',').map((part) => part.trim()).includes(selector));

    return found?.[2] ?? '';
  };

  it('under reduced motion buttons do not press in', () => {
    ['[data-blok-assistant-send]:active:not(:disabled)', '[data-blok-assistant-undo]:active', '[data-blok-assistant-keep]:active', '[data-blok-assistant-button]:active']
      .forEach((selector) => expect(reducedRule(selector), selector).toMatch(/transform:\s*none/));
  });

  it('under reduced motion the halo, the Stop arc and the rise-in stay still', () => {
    ['[data-blok-assistant-send]::before', '[data-blok-assistant-stop]::before', '[data-blok-assistant-keep]::before', '[data-blok-assistant-keep]:hover svg path', '[data-blok-assistant-action]']
      .forEach((selector) => expect(reducedRule(selector), selector).toMatch(/animation:\s*none/));
  });

  it('Stop is an ink disc with an arc that spins without a hover', () => {
    const arc = bodyOf('[data-blok-assistant-stop]::before');

    expect(bodyOf('[data-blok-assistant-stop]')).toMatch(/border-radius:\s*50%/);
    expect(bodyOf('[data-blok-assistant-stop]::after')).toMatch(/background:\s*var\(--blok-text-primary\)/);
    expect(arc).toMatch(/animation:[^;]*infinite/);
    expect(arc).not.toMatch(/animation-play-state:\s*paused/);
    expect(arc).not.toMatch(/opacity:\s*0\s*(;|$)/);
  });

  it('actions are outlined pills that rise in one after another', () => {
    const [, body] = rulesFor('data-blok-assistant-action').find(([selector]) => selector === '[data-blok-assistant-action]') ?? ['', ''];

    expect(body).toMatch(/border-radius:\s*var\(--blok-radius-pill\)/);
    expect(body).toMatch(/animation-delay:\s*calc\(var\(--blok-assistant-action-index\)/);
  });

  it('the bar is not docked to the bottom of the window', () => {
    const bar = rulesFor('[data-blok-assistant]').filter(([selector]) => /^\[data-blok-assistant\](?:,|\[|$)/.test(selector));

    expect(bar.length).toBeGreaterThan(0);
    bar.forEach(([, body]) => expect(body).not.toMatch(/(?:^|;|\s)bottom\s*:/));
  });

  it('the prompt field has square corners, so a short textarea does not clip its caret', () => {
    const [, body] = rulesFor('textarea[data-blok-field]').find(([selector]) => selector === '[data-blok-assistant] [data-blok-assistant-field] textarea[data-blok-field]') ?? ['', ''];

    expect(body).toMatch(/border-radius:\s*0\s*;/);
  });
});
