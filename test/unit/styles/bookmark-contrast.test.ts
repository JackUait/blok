import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const BOOKMARK_CSS = readFileSync(resolve(__dirname, '../../../src/styles/bookmark.css'), 'utf8');

const CARD = '[data-blok-tool="bookmark"] .blok-bookmark';

const ruleBody = (selector: string): string => {
  const start = BOOKMARK_CSS.indexOf(`${selector} {`);

  if (start === -1) {
    throw new Error(`missing rule: ${selector}`);
  }

  return BOOKMARK_CSS.slice(start, BOOKMARK_CSS.indexOf('\n}', start));
};

const cardToken = (name: string): string => {
  const value = new RegExp(`--bookmark-${name}:\\s*([^;]+);`).exec(ruleBody(CARD))?.[1];

  if (value === undefined) {
    throw new Error(`the card no longer declares --bookmark-${name}`);
  }

  return value.trim();
};

/** The alpha of a card token that is a translucent black or white. */
const tokenAlpha = (name: string, tone: 0 | 255): number => {
  const value = cardToken(name);
  const alpha = new RegExp(`^rgb\\(${tone} ${tone} ${tone} / ([\\d.]+)\\)$`).exec(value)?.[1];

  if (alpha === undefined) {
    throw new Error(`--bookmark-${name} is no longer a translucent ${tone === 0 ? 'black' : 'white'}: ${value}`);
  }

  return Number(alpha);
};

/** The white share of a rule's text ink. A rule with no colour inherits the card's solid white. */
const inkAlpha = (selector: string): number => {
  const color = /\scolor:\s*([^;]+);/.exec(ruleBody(selector))?.[1].trim();

  if (color === undefined) {
    expect(cardToken('ink')).toBe('rgb(255 255 255)');

    return 1;
  }

  expect(color).toBe('var(--bookmark-ink-soft)');

  return tokenAlpha('ink-soft', 255);
};

const channel = (value: number): number => {
  const c = value / 255;

  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Every colour here is a gray, so one channel carries the luminance. */
const contrast = (ink: number, surface: number): number => (channel(ink) + 0.05) / (channel(surface) + 0.05);

const whiteOver = (surface: number, alpha: number): number => surface * (1 - alpha) + 255 * alpha;

/**
 * The lightest surface the text can ever sit on: a pure white picture after
 * the wash dims it and the scrim darkens it. The grain is left out: it is
 * noise around a mid gray, so it does not move the average.
 */
const worstSurface = (): number => 255 * Number(cardToken('dim')) * (1 - tokenAlpha('scrim', 0));

describe('bookmark text contrast over any picture', () => {
  it('holds the bound the numbers assume: the wash is dimmed by --bookmark-dim, with or without a cover', () => {
    expect(ruleBody(`${CARD}__wash img`)).toContain('brightness(var(--bookmark-dim))');
    expect(ruleBody(`${CARD}--bare .blok-bookmark__glow img`)).toContain('brightness(var(--bookmark-dim))');
    expect(BOOKMARK_CSS).toContain(`${CARD}--bare .blok-bookmark__wash img,\n${CARD}--bare .blok-bookmark__glow img {`);
  });

  it('keeps the full scrim under the whole text column', () => {
    const scrimEnd = /var\(--bookmark-scrim\) (\d+)%/.exec(ruleBody(`${CARD}::before`))?.[1];
    const columnWidth = /\swidth:\s*(\d+)%;/.exec(ruleBody(`${CARD}__content`))?.[1];

    expect(scrimEnd).toBeDefined();
    expect(Number(columnWidth)).toBeLessThanOrEqual(Number(scrimEnd));
  });

  it('keeps the full scrim under the full-width text of a card with no cover', () => {
    expect(ruleBody(`${CARD}--bare::before`)).toContain(
      'linear-gradient(var(--bookmark-scrim), var(--bookmark-scrim))'
    );
  });

  it('does not let the sharp cover reach under the text column', () => {
    const coverWidth = Number(/\swidth:\s*(\d+)%;/.exec(ruleBody(`${CARD}__image`))?.[1]);
    const columnWidth = Number(/\swidth:\s*(\d+)%;/.exec(ruleBody(`${CARD}__content`))?.[1]);

    expect(coverWidth + columnWidth).toBeLessThanOrEqual(100);
  });

  it.each([
    ['title', `${CARD}__title`],
    ['description', `${CARD}__description`],
  ])('keeps the %s at WCAG AA on the card', (_name, selector) => {
    const surface = worstSurface();

    expect(contrast(whiteOver(surface, inkAlpha(selector)), surface)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['host', `${CARD}__host`],
    ['path', `${CARD}__path`],
  ])('keeps the address %s at WCAG AA on the pill', (_name, selector) => {
    // The pill is a translucent white tint, so it lightens whatever is under it.
    const pill = whiteOver(worstSurface(), tokenAlpha('pill', 255));

    expect(ruleBody(`${CARD}__address`)).toContain('background: var(--bookmark-pill);');
    expect(contrast(whiteOver(pill, inkAlpha(selector)), pill)).toBeGreaterThanOrEqual(4.5);
  });
});
