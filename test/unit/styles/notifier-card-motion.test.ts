/**
 * How a media card arrives, and how waiting cards join the deck behind it.
 * jsdom has no CSS, so these read the authored source.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(__dirname, '../../../src/styles/notifier-card.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

// The opt-out block is the file's tail; split it off so normal rules do not read its `none`s.
const css = source.slice(0, source.indexOf(REDUCED_MOTION));
const reducedMotion = source.slice(source.indexOf(REDUCED_MOTION));

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Bodies of every top-level rule whose selector list contains `selector`. */
const bodies = (source: string, selector: string): string[] =>
  [ ...source.matchAll(/(?<=^|[{}])\s*([^{}@]+?)\s*\{([^{}]*)\}/g) ]
    .filter((rule) => rule[1].split(/,(?![^(]*\))/).map((part) => part.trim()).includes(selector))
    .map((rule) => rule[2]);

const prop = (selector: string, name: string, source = css): string | null => {
  const values = bodies(source, selector)
    .map((body) => body.match(new RegExp(`(?:^|[;\\s])${escape(name)} ?: ?([^;]+);`)))
    .filter((match) => match !== null)
    .map((match) => match[1].trim());

  return values.at(-1) ?? null;
};

const keyframes = (name: string): string => {
  const match = css.match(new RegExp(`@keyframes ${name} \\{((?:[^{}]*\\{[^{}]*\\})*[^{}]*)\\}`));

  if (match === null) {
    throw new Error(`no @keyframes ${name}`);
  }

  return match[1];
};

const WRAPPER = "[data-blok-interface='notifier']";
const LAUNCH = `${WRAPPER} [data-blok-toast='card'][data-state='open']:not([data-blok-toast-rise], [data-resolved])`;
const NEAR_PEEK = `${WRAPPER}[data-blok-toast-behind]::after`;
const FAR_PEEK = `${WRAPPER}[data-blok-toast-behind='2']::before`;

const delayOf = (part: string): number => {
  const value = prop(`${LAUNCH} ${part}`, 'animation-delay');

  if (value === null) {
    throw new Error(`no delay for ${part}`);
  }

  return Number.parseFloat(value);
};

describe('media card launch', () => {
  it('springs in when it is the first card, not when it rises from the deck or resolves', () => {
    expect(prop(LAUNCH, 'animation')).toMatch(/^blok-toast-launch \d+ms var\(--_blok-toast-spring\)/);
    expect(prop(LAUNCH, 'animation')).toContain('blok-toast-launch-fade');
  });

  it('springs past its spot and settles exactly on it', () => {
    const spring = css.match(/--_blok-toast-spring: ?linear\(([^)]*)\);/);

    expect(spring).not.toBeNull();

    const points = (spring?.[1] ?? '').split(',').map((point) => Number.parseFloat(point));

    expect(Math.max(...points)).toBeGreaterThan(1);
    expect(points.at(-1)).toBe(1);
  });

  it('comes in from past the screen edge: below for a bottom stack, above for a top one', () => {
    const from = keyframes('blok-toast-launch');

    expect(from).toContain('var(--_blok-toast-launch-from)');
    // On the wrapper rules that also lay out the stack: view.css copies a rule holding only tokens.
    expect(prop(`${WRAPPER}:has(> [data-blok-toast='card'])`, '--_blok-toast-launch-from')).toBe('120%');
    expect(prop(`${WRAPPER}[data-blok-position^='top']:has(> [data-blok-toast='card'])`, '--_blok-toast-launch-from')).toBe('-120%');
  });

  it('sends one light across the card as it lands', () => {
    expect(prop(`${LAUNCH}::before`, 'animation')).toMatch(/^blok-toast-sweep /);
    expect(prop(`${LAUNCH}::before`, 'pointer-events')).toBe('none');
  });

  it('brings its insides in one after another: title, detail, buttons, close', () => {
    const order = [
      "[data-blok-testid='notification-message-text']",
      "[data-blok-toast-part='detail']",
      "[data-blok-toast-part='actions']",
      "[data-blok-testid='notification-dismiss']",
    ].map(delayOf);

    expect(order).toEqual([ ...order ].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });
});

describe('a card joining the deck', () => {
  it('springs each peeking edge out from behind the card in front of it', () => {
    expect(prop(NEAR_PEEK, 'animation')).toMatch(/^blok-toast-peek-in \d+ms var\(--_blok-toast-spring\)/);
    expect(keyframes('blok-toast-peek-in')).toMatch(/from \{ ?translate: 0 0;/);
  });

  it('keeps the edges hidden while a launching card is still on its way (nudgeFront sets the wait)', () => {
    expect(prop(NEAR_PEEK, 'animation')).toContain('var(--_blok-toast-peek-delay, 0ms) backwards');
    expect(keyframes('blok-toast-peek-in')).toMatch(/opacity: 0;/);
  });

  it('springs the far edge out later than the near one, so a burst reads as one deck', () => {
    expect(prop(FAR_PEEK, 'animation-delay')).toBe('calc(var(--_blok-toast-peek-delay, 0ms) + 90ms)');
  });
});

describe('reduced motion', () => {
  it('turns off the launch, the light, the insides and the peek entrance', () => {
    expect(prop(LAUNCH, 'animation', reducedMotion)).toBe('none');
    expect(prop(`${LAUNCH}::before`, 'animation', reducedMotion)).toBe('none');
    expect(prop(`${LAUNCH} [data-blok-testid='notification-message-text']`, 'animation', reducedMotion)).toBe('none');
    expect(prop(NEAR_PEEK, 'animation', reducedMotion)).toBe('none');
  });
});
