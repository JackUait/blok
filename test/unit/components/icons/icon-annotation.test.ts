import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconAnnotation, IconInfo, IconMessage, IconUnderline } from '../../../../src/components/icons';

const svgOf = (icon: string): SVGSVGElement => {
  const doc = new DOMParser().parseFromString(icon, 'image/svg+xml');
  const svg = doc.querySelector('svg');

  if (svg === null || doc.querySelector('parsererror') !== null) {
    throw new Error('invalid svg');
  }

  return svg;
};

const num = (el: Element | null | undefined, attr: string): number => Number(el?.getAttribute(attr));

describe('IconAnnotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is not the comment bubble', () => {
    expect(IconAnnotation).not.toBe(IconMessage);
    expect(svgOf(IconAnnotation).querySelector('rect')).not.toBeNull();
  });

  // The card spans the standard panel width with the panel radius.
  it('draws the card on the standard panel width and radius', () => {
    const card = svgOf(IconAnnotation).querySelector('rect');

    expect([num(card, 'x'), num(card, 'width'), num(card, 'rx')]).toEqual([3, 14, 2.5]);
  });

  // The dotted word spans Underline's rule and uses the (i) dot.
  it('draws the dotted word as evenly spaced dots across the underline rule', () => {
    const svg = svgOf(IconAnnotation);
    const dots = [...svg.querySelectorAll('circle')];
    const infoDot = [...svgOf(IconInfo).querySelectorAll('circle')].find((c) => c.getAttribute('fill') === 'currentColor');
    const rule = svgOf(IconUnderline).querySelectorAll('path')[1].getAttribute('d') ?? '';
    const [ruleStart, ruleLength] = (rule.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((_n, i) => i !== 1);
    const xs = dots.map((d) => num(d, 'cx'));
    const steps = xs.slice(1).map((x, i) => x - xs[i]);

    expect(dots.length).toBeGreaterThanOrEqual(3);
    expect(new Set(dots.map((d) => d.getAttribute('cy'))).size).toBe(1);
    expect(new Set(dots.map((d) => d.getAttribute('r')))).toEqual(new Set([infoDot?.getAttribute('r')]));
    expect([xs[0], xs[xs.length - 1]]).toEqual([ruleStart, ruleStart + ruleLength]);
    // Thirds of the rule are not exact in two decimals.
    steps.forEach((step) => expect(step).toBeCloseTo(steps[0], 1));
    // Neighbouring dots stay one stroke apart, so the row reads as dots at 16 px.
    expect(steps[0] - 2 * num(dots[0], 'r')).toBeGreaterThanOrEqual(1.25);
  });

  it('keeps one stroke of clear space between the card and the dots', () => {
    const svg = svgOf(IconAnnotation);
    const card = svg.querySelector('rect');
    const dot = svg.querySelector('circle');
    const cardInkBottom = num(card, 'y') + num(card, 'height') + num(card, 'stroke-width') / 2;
    const dotInkTop = num(dot, 'cy') - num(dot, 'r');

    expect(dotInkTop - cardInkBottom).toBeGreaterThanOrEqual(1.25);
  });
});
