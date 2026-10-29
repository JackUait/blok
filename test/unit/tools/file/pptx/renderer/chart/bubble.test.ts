import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { chartXml, ser } from './chartXml';
import { n, numRef, part, parts, render, texts } from './renderXml';

const XS = [1.5, 3, 5, 2.5];
const YS = [2.5, 4, 1.5, 3.5];
const SIZES = [10, 25, 15, 30];

function bubbles(plotExtra = '', sizes = SIZES): string {
  return chartXml(`<c:bubbleChart>${ser({ name: 'Markets', xs: XS, vals: YS, extra: numRef('bubbleSize', sizes) })}${plotExtra}
    <c:axId val="1"/><c:axId val="2"/></c:bubbleChart>
    <c:valAx><c:axId val="1"/><c:axPos val="b"/></c:valAx><c:valAx><c:axId val="2"/><c:axPos val="l"/><c:majorGridlines/></c:valAx>`,
  { tail: '<c:legend><c:legendPos val="r"/></c:legend>' });
}

const circles = (frame: Element): Element[] => parts(frame, 'bubble');

describe('bubble charts', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('sizes bubble areas in proportion to c:bubbleSize', () => {
    const radii = circles(render(bubbles())).map((c) => n(c, 'r'));
    const largest = radii[3];

    expect(radii).toHaveLength(4);
    radii.forEach((r, i) => expect(r / largest).toBeCloseTo(Math.sqrt(SIZES[i] / 30), 3));
  });

  it('places bubble centres by their x and y values', () => {
    const frame = render(bubbles());
    const [a, b, c] = circles(frame);

    expect((n(b, 'cx') - n(a, 'cx')) / (n(c, 'cx') - n(b, 'cx'))).toBeCloseTo((3 - 1.5) / (5 - 3), 2);
    expect(n(b, 'cy')).toBeLessThan(n(a, 'cy'));
    expect(texts(part(frame, 'category-axis'))[0]).toBe('0');
  });

  it('scales every bubble by c:bubbleScale', () => {
    const full = circles(render(bubbles())).map((c) => n(c, 'r'));
    const half = circles(render(bubbles('<c:bubbleScale val="50"/>'))).map((c) => n(c, 'r'));

    expect(half).toHaveLength(4);
    half.forEach((r, i) => expect(r).toBeCloseTo(full[i] / 2, 2));
  });

  it('sizes widths, not areas, when c:sizeRepresents is w', () => {
    const radii = circles(render(bubbles('<c:sizeRepresents val="w"/>'))).map((c) => n(c, 'r'));

    expect(radii).toHaveLength(4);
    radii.forEach((r, i) => expect(r / radii[3]).toBeCloseTo(SIZES[i] / 30, 3));
  });

  it('skips points with no positive size', () => {
    expect(circles(render(bubbles('', [10, 0, -5, 30])))).toHaveLength(2);
  });

  it('fills bubbles in the series colour, semi-transparent, and lists the series', () => {
    const frame = render(bubbles());
    const [first] = circles(frame);

    expect(first.getAttribute('fill')?.toLowerCase()).toBe('#4472c4');
    expect(Number(first.getAttribute('fill-opacity'))).toBeLessThan(1);
    expect(texts(part(frame, 'legend'))).toEqual(['Markets']);
  });
});
