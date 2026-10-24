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

/** The head once an answer shows in it. */
const LANDED = '[data-blok-assistant-head]:has([data-blok-assistant-summary]:not([hidden]))';

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

  it.each([
    '[data-blok-assistant-send]:hover:not(:disabled)::before',
    '[data-blok-assistant-keep]:hover::before',
  ])('the hover halo %s stays faint and close to the button', (hover) => {
    const body = bodyOf(hover);

    expect(Number(body.match(/opacity:\s*([\d.]+)/)?.[1])).toBeLessThanOrEqual(0.3);
    // No inset on hover: the halo keeps its 3px rest spread and does not grow.
    expect(body).not.toMatch(/inset:/);
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

  it('the mark is drawn at 24px, so the rose reads next to 16px text', () => {
    const mark = bodyOf('[data-blok-assistant-icon] svg');

    expect(mark).toMatch(/width:\s*24px/);
    expect(mark).toMatch(/height:\s*24px/);
  });

  it('while working, the mark turns at one steady speed', () => {
    const mark = bodyOf('[data-blok-assistant-working] [data-blok-assistant-icon] svg');
    const turn = ASSISTANT_CSS.match(/@keyframes blok-assistant-rose\s*\{([\s\S]*?\})\s*\}/)?.[1] ?? '';

    expect(mark).toMatch(/animation:\s*blok-assistant-rose\s+[\d.]+s\s+linear\s+infinite/);
    expect(bodyOf('[data-blok-assistant-working] [data-blok-assistant-icon]')).toMatch(/color:\s*var\(--blok-text-secondary\)/);
    // One step to a full turn: no pause, no easing back, so it has no start or end.
    expect(turn.match(/\{/g)).toHaveLength(1);
    expect(turn).toMatch(/^\s*to\s*\{\s*transform:\s*rotate\(1turn\);?\s*\}$/);
  });

  it('while working, the rose dims and a light runs round it at one steady speed', () => {
    const light = bodyOf('[data-blok-assistant-working] [data-blok-assistant-light]');
    const run = ASSISTANT_CSS.match(/@keyframes blok-assistant-light\s*\{([\s\S]*?\})\s*\}/)?.[1] ?? '';

    expect(bodyOf('[data-blok-assistant-light]')).toMatch(/display:\s*none/);
    expect(light).toMatch(/display:\s*inline/);
    expect(light).toMatch(/stroke-dasharray:\s*14\s+36/);
    expect(light).toMatch(/animation:\s*blok-assistant-light\s+5s\s+linear\s+infinite/);
    expect(run).toMatch(/^\s*to\s*\{\s*stroke-dashoffset:\s*-100;?\s*\}$/);
    expect(bodyOf('[data-blok-assistant-working] [data-blok-assistant-icon] path:not([data-blok-assistant-light])')).toMatch(/opacity:\s*0?\.\d+/);
  });

  it('the light has no glow', () => {
    [...rulesFor('data-blok-assistant-icon'), ...rulesFor('data-blok-assistant-light')]
      .forEach(([selector, body]) => expect(body, selector).not.toMatch(/filter|blur|drop-shadow|box-shadow/));
  });

  it('under reduced motion the light is gone and the rose is drawn at full strength', () => {
    expect(reducedRule('[data-blok-assistant-working] [data-blok-assistant-light]')).toMatch(/display:\s*none/);
    expect(reducedRule('[data-blok-assistant-working] [data-blok-assistant-icon] path:not([data-blok-assistant-light])')).toMatch(/opacity:\s*1/);
  });

  it('under reduced motion the halo, the Stop arc and the rise-in stay still', () => {
    ['[data-blok-assistant-working] [data-blok-assistant-icon] svg',
      '[data-blok-assistant-send]::before', '[data-blok-assistant-stop]::before', '[data-blok-assistant-keep]::before', '[data-blok-assistant-keep]:hover svg path', '[data-blok-assistant-action]']
      .forEach((selector) => expect(reducedRule(selector), selector).toMatch(/animation:\s*none/));
  });

  it('a long answer keeps the rose and the buttons at the top, not centred on the text', () => {
    expect(bodyOf('[data-blok-assistant-head]')).toMatch(/align-items:\s*flex-start/);
    expect(bodyOf('[data-blok-assistant-row]')).toMatch(/align-items:\s*center/);
  });

  it('when the answer lands, the light draws the whole rose once, then sinks back to ink', () => {
    const bloom = bodyOf(`${LANDED} [data-blok-assistant-light]`);
    const draw = ASSISTANT_CSS.match(/@keyframes blok-assistant-bloom\s*\{([\s\S]*?\})\s*\}/)?.[1] ?? '';

    expect(bloom).toMatch(/display:\s*inline/);
    expect(bloom).toMatch(/animation:\s*blok-assistant-bloom\s/);
    expect(bloom).not.toMatch(/infinite/);
    expect(draw).toMatch(/stroke-dashoffset:\s*100/);
    expect(draw).toMatch(/opacity:\s*0/);
    expect(bodyOf(`${LANDED} [data-blok-assistant-icon] svg`)).toMatch(/animation:\s*blok-assistant-bloom-pop\s[^;]*both/);
  });

  it('the answer reveals left to right, from soft to sharp, in one pass', () => {
    const summary = bodyOf('[data-blok-assistant-summary]');
    const reveal = ASSISTANT_CSS.match(/@keyframes blok-assistant-reveal\s*\{([\s\S]*?\})\s*\}/)?.[1] ?? '';

    expect(summary).toMatch(/mask-image:\s*linear-gradient\(90deg/);
    expect(summary).toMatch(/animation:\s*blok-assistant-reveal\s[^;]*both/);
    expect(summary).not.toMatch(/infinite/);
    expect(reveal).toMatch(/mask-position/);
    expect(reveal).toMatch(/filter:\s*blur\(/);
  });

  it('under reduced motion the answer lands still', () => {
    expect(reducedRule(`${LANDED} [data-blok-assistant-light]`)).toMatch(/display:\s*none/);
    [`${LANDED} [data-blok-assistant-icon] svg`, '[data-blok-assistant-summary]']
      .forEach((selector) => expect(reducedRule(selector), selector).toMatch(/animation:\s*none/));
  });

  it('the actions row folds to nothing: its padding is inside its height, and it clips only while it moves', () => {
    expect(bodyOf('[data-blok-assistant-actions]')).toMatch(/box-sizing:\s*border-box/);
    expect(bodyOf('[data-blok-assistant-actions]')).not.toMatch(/overflow/);
    expect(bodyOf('[data-blok-assistant-actions][data-blok-assistant-actions-motion]')).toMatch(/overflow:\s*clip/);
  });

  it('as the row folds, the chips dissolve one after another, and stay still under reduced motion', () => {
    const chip = "[data-blok-assistant-actions-motion='out'] [data-blok-assistant-action]";

    expect(bodyOf(chip)).toMatch(/animation:\s*blok-assistant-dissolve\b/);
    expect(bodyOf(chip)).toMatch(/animation-delay:\s*calc\(var\(--blok-assistant-action-index\)/);
    expect(ASSISTANT_CSS).toMatch(/@keyframes blok-assistant-dissolve\s*\{[\s\S]*?opacity:\s*0/);
    expect(reducedRule(chip)).toMatch(/animation:\s*none/);
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

  it('the bar opens, chips and icon drawings included, in about half a second', () => {
    const ms = (time: string): number => time.endsWith('ms') ? parseFloat(time) : parseFloat(time) * 1000;
    const iconsCss = readFileSync(resolve(__dirname, '../../../src/styles/ask-ai-icons.css'), 'utf8');
    const barTs = readFileSync(resolve(__dirname, '../../../src/components/modules/assistant/assistant-bar.ts'), 'utf8');
    /** The fourth chip, the last to arrive. */
    const last = 3;
    /** When `animation` plus `calc(index * step + offset)` ends for the last chip. */
    const endOf = (css: string, keyframes: string): number => {
      const match = css.match(new RegExp(`animation:\\s*${keyframes}\\s+([\\d.]+m?s)[^;]*;\\s*animation-delay:\\s*calc\\(var\\(--blok-assistant-action-index\\)\\s*\\*\\s*([\\d.]+m?s)(?:\\s*\\+\\s*([\\d.]+m?s))?\\)`));

      expect(match, keyframes).not.toBeNull();

      const [, duration, step, offset] = match ?? ['', '0ms', '0ms', undefined];

      return ms(duration) + last * ms(step) + (offset === undefined ? 0 : ms(offset));
    };
    const barIn = ASSISTANT_CSS.match(/animation:\s*blok-assistant-in\s+([\d.]+m?s)/)?.[1] ?? '';
    const unfold = Number(barTs.match(/const UNFOLD = \{ duration: (\d+)/)?.[1]);

    const ends = [
      ms(barIn),
      unfold,
      endOf(ASSISTANT_CSS, 'blok-assistant-rise'),
      endOf(iconsCss, 'blok-ask-ai-draw'),
      endOf(iconsCss, 'blok-ask-ai-dot-in'),
    ];

    ends.forEach((end) => {
      expect(end).toBeGreaterThan(0);
      expect(end).toBeLessThanOrEqual(480);
    });
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
