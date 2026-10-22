import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as icons from '../../../../src/components/icons';

const parse = (markup: string | undefined): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(markup ?? '', 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error('Not an SVG');
  }

  return svg;
};

const attrs = (element: Element | null, names: string[]): Record<string, number> =>
  Object.fromEntries(names.map((name) => [name, Number(element?.getAttribute(name))]));

const pathData = (markup: string | undefined): string[] =>
  [...parse(markup).querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '');

describe('Notion template glyphs (database icons)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('the currency coin is the standalone circle', () => {
    expect(attrs(parse(icons.IconCurrency).querySelector('circle'), ['cx', 'cy', 'r'])).toEqual({ cx: 10, cy: 10, r: 6.5 });
  });

  it('the currency sign is stroked, with a stroke of air between each stem cap and the coin', () => {
    const [sign] = pathData(icons.IconCurrency);
    const stem = /M10 (\d+(?:\.\d+)?)v1/g;
    const [top, bottom] = [...sign.matchAll(stem)].map((match) => Number(match[1]));
    const cap = 1.25 / 2;
    const coinInner = 10 - 6.5 + cap;

    expect(top - cap - coinInner).toBeGreaterThanOrEqual(1.25);
    expect(20 - coinInner - (bottom + 1 + cap)).toBeGreaterThanOrEqual(1.25);
  });

  it('the card is the panel at card height: x 3, width 14, radius 2', () => {
    expect(attrs(parse(icons.IconCreditCard).querySelector('rect'), ['x', 'y', 'width', 'height', 'rx'])).toEqual({ x: 3, y: 5, width: 14, height: 10, rx: 2 });
  });

  it('the ticket shares the card box and cuts a notch of the same size into each side', () => {
    const [outline] = pathData(icons.IconTicket);

    // Corners of radius 2 on the card's 3..17 by 5..15 box.
    expect(outline.startsWith('M5 5h10a2 2 0 0 1 2 2')).toBe(true);
    expect(outline).toContain('V13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2');
    // Sweep 0 on both sides bends each notch inward.
    expect(outline).toContain('a1.5 1.5 0 0 0 0 3');
    expect(outline).toContain('a1.5 1.5 0 0 0 0-3');
  });

  it('the paint brush is a handle centred on x = 10 over a wider head', () => {
    const [handle, head, marks] = pathData(icons.IconPaintBrush);

    // Handle x 8.75..11.25; head x 6.5..13.5 at the ferrule, both centred on 10.
    expect(handle).toBe('M8.75 8V4.25a1.25 1.25 0 0 1 2.5 0V8');
    expect(head.startsWith('M6.5 8h7')).toBe(true);
    expect(marks).toBe('M6.5 11h7M10 14v3');
  });

  it('the package is a box symmetric about x = 10, on the 3.5..16.5 width of the circle', () => {
    const [outline, edges] = pathData(icons.IconPackage);

    expect(outline).toBe('M10 2.75 16.5 6.25v7.5L10 17.25 3.5 13.75v-7.5L10 2.75Z');
    expect(edges).toContain('M3.5 6.25 10 9.75l6.5-3.5M10 9.75v7.5');
  });

  it('the fan deck pivots on the dot at the centre of the upright swatch\'s rounded end', () => {
    const svg = parse(icons.IconFanDeck);
    const [upright] = pathData(icons.IconFanDeck);

    expect(attrs(svg.querySelector('circle'), ['cx', 'cy'])).toEqual({ cx: 5.75, cy: 14.75 });
    // The upright swatch spans x 3.5..8, so its 2.25 end arc centres on x 5.75, y 14.75.
    expect(upright).toContain('M3.5 14.75');
    expect(upright).toContain('v10.25a2.25 2.25 0 0 1-4.5 0Z');
  });
});
