import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';

import {
  ANONYMOUS_GLYPHS,
  UNKNOWN_GLYPH,
} from '../../../../../src/components/modules/collaboration/anonymous-identity';

const stylesheet = postcss.parse(readFileSync(resolve(__dirname, '../../../../../src/styles/presence.css'), 'utf8'));

const glyphSvg = (glyph: string): Element => {
  let source = '';

  stylesheet.walkRules(`[data-blok-presence-glyph="${glyph}"]`, rule => {
    rule.walkDecls('--blok-presence-glyph', declaration => {
      const url = declaration.value.match(/^url\("data:image\/svg\+xml,([^"]+)"\)$/);

      source = decodeURIComponent(url?.[1] ?? '');
    });
  });

  const document = new DOMParser().parseFromString(source, 'image/svg+xml');

  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') {
    throw new Error(`Invalid mask for ${glyph}`);
  }

  return document.documentElement;
};

const value = (element: Element | undefined | null, attribute: string): number =>
  Number(element?.getAttribute(attribute) ?? Number.NaN);

const inherited = (element: Element | undefined | null, attribute: string): string | null | undefined =>
  element?.closest(`[${attribute}]`)?.getAttribute(attribute);

const glyphs = [...ANONYMOUS_GLYPHS, UNKNOWN_GLYPH];

describe('anonymous presence micro-illustrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(glyphs)('%s uses the same optical canvas as the rest of the collection', glyph => {
    const svg = glyphSvg(glyph);

    expect(svg.getAttribute('viewBox')).toBe('0 0 20 20');
    expect(svg.getAttribute('width')).toBe('20');
    expect(svg.getAttribute('height')).toBe('20');
  });

  it.each(glyphs)('%s stays self-contained and monochrome inside a CSS mask', glyph => {
    const svg = glyphSvg(glyph);

    // A mask or gradient would bring a second paint into the artwork; knock
    // shapes out with evenodd clip paths instead.
    expect(svg.querySelector('image, use, text, style, script, foreignObject, filter, mask, linearGradient, radialGradient, pattern')).toBeNull();

    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      for (const paint of ['fill', 'stroke']) {
        expect([null, 'none', 'currentColor']).toContain(element.getAttribute(paint));
      }
    }
  });

  it.each(glyphs)('%s carries one see-through layer on top of its solid form', glyph => {
    const svg = glyphSvg(glyph);
    const opacities = Array.from(svg.querySelectorAll('[opacity]'), element => Number(element.getAttribute('opacity')));

    expect(svg.querySelector('[fill-opacity], [stroke-opacity]')).toBeNull();
    expect(opacities.length).toBeGreaterThan(0);

    for (const opacity of opacities) {
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThan(1);
    }
  });

  it('gives the satellite mirrored solar panels with equal air either side of a centred body', () => {
    const [body] = Array.from(glyphSvg('satellite').querySelectorAll('rect'));
    const [left, right] = Array.from(glyphSvg('satellite').querySelectorAll('path[fill-rule="evenodd"]'))
      .map(panel => panel.getAttribute('d')?.match(/^M(-?\d*\.?\d+)[ ,]?(-?\d*\.?\d+)h(\d*\.?\d+)/)?.slice(1).map(Number) ?? []);
    const bodyX = value(body, 'x');
    const bodyWidth = value(body, 'width');

    expect(bodyX + bodyWidth / 2).toBe(10);
    expect(inherited(body, 'fill')).toBe('currentColor');
    expect(right[2]).toBe(left[2]);
    expect(right[1]).toBe(left[1]);
    expect(left[0] + right[0] + right[2]).toBeCloseTo(20, 10);

    const leftGap = bodyX - left[0] - left[2];
    const rightGap = right[0] - bodyX - bodyWidth;

    expect(leftGap).toBeGreaterThanOrEqual(1.25);
    expect(rightGap).toBeCloseTo(leftGap, 10);
  });

  it('leaves a readable glyph canvas inside the block-side ring', () => {
    const declarations = new Map<string, string>();

    stylesheet.walkRules(rule => {
      if (rule.selector === '[data-blok-interface]' || rule.selector === '[data-blok-presence-glyph]::after') {
        rule.walkDecls(declaration => {
          declarations.set(declaration.prop, declaration.value);
        });
      }
    });

    const face = parseFloat(declarations.get('--blok-presence-face-size') ?? '0');
    const ring = parseFloat(declarations.get('--blok-presence-ring') ?? '0');
    const scale = parseFloat(declarations.get('width') ?? '0') / 100;
    const canvas = (face - 2 * ring) * scale;

    expect(canvas).toBeGreaterThanOrEqual(20);
    expect((face - 2 * ring - canvas) / 2).toBeGreaterThanOrEqual(3);
    expect(declarations.get('height')).toBe(declarations.get('width'));
  });

  it.each(['astronaut', 'rocket', 'satellite', 'telescope', 'saucer', 'asteroid'])('%s cuts its holes with closed evenodd contours', glyph => {
    const paths = Array.from(glyphSvg(glyph).querySelectorAll('path[fill-rule="evenodd"]'));

    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      const contours = path.getAttribute('d')?.match(/[Mm][^Mm]*/g) ?? [];

      expect(inherited(path, 'fill')).toBe('currentColor');
      expect(contours.length).toBeGreaterThan(1);

      for (const contour of contours) {
        expect(contour.trim()).toMatch(/[Zz]$/);
      }
    }
  });

  it('cuts the star into ten facets from its centre, alternately solid and see-through', () => {
    const svg = glyphSvg('star');
    const [lit, shade] = Array.from(svg.querySelectorAll(':scope > path[clip-path]'));
    const facets = (element: Element | undefined): string[] => {
      const id = element?.getAttribute('clip-path')?.match(/^url\(#([^)]+)\)$/)?.[1];
      const d = id ? svg.querySelector(`clipPath[id="${id}"] path`)?.getAttribute('d') : null;

      return d?.match(/M[^M]*/g) ?? [];
    };

    expect(lit?.getAttribute('d')).toBeTruthy();
    expect(shade?.getAttribute('d')).toBe(lit?.getAttribute('d'));
    expect(lit?.hasAttribute('opacity')).toBe(false);
    expect(Number(shade?.getAttribute('opacity'))).toBeLessThan(1);
    expect(facets(lit)).toHaveLength(5);
    expect(facets(shade)).toHaveLength(5);

    // Every facet is a wedge fanned out from one shared centre.
    const centres = [...facets(lit), ...facets(shade)].map(facet => facet.match(/^M(-?\d*\.?\d+) (-?\d*\.?\d+)/)?.[0]);

    expect(new Set(centres).size).toBe(1);

    for (const facet of [...facets(lit), ...facets(shade)]) {
      expect(facet.trim()).toMatch(/^M(?:\s*-?\d*\.?\d+ -?\d*\.?\d+\s*L){2}\s*-?\d*\.?\d+ -?\d*\.?\d+\s*Z$/);
    }
  });

  describe('moon', () => {
    type Circle = { x: number; y: number; r: number };

    // Contours are drawn as `M cx top a r r ...`, so the centre is one radius below the start.
    const circle = (contour: string): Circle => {
      const [x = Number.NaN, top = Number.NaN, r = Number.NaN] = (contour.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);

      return { x, y: top + r, r };
    };
    const contours = (d: string | null | undefined): string[] => d?.match(/M[^M]*/g) ?? [];
    const apart = (a: Circle, b: Circle): number => Math.hypot(a.x - b.x, a.y - b.y);
    // The shadow is the second contour of an evenodd clip: canvas minus one circle.
    const clipCircle = (svg: Element, id: string): Circle =>
      circle(contours(svg.querySelector(`clipPath[id="${id}"] path`)?.getAttribute('d'))[1] ?? '');
    const lensArea = (a: Circle, b: Circle): number => {
      const d = apart(a, b);

      if (d >= a.r + b.r) {
        return 0;
      }
      if (d <= Math.abs(a.r - b.r)) {
        return Math.PI * Math.min(a.r, b.r) ** 2;
      }

      const alpha = Math.acos((d ** 2 + a.r ** 2 - b.r ** 2) / (2 * d * a.r));
      const beta = Math.acos((d ** 2 + b.r ** 2 - a.r ** 2) / (2 * d * b.r));

      return a.r ** 2 * (alpha - Math.sin(2 * alpha) / 2) + b.r ** 2 * (beta - Math.sin(2 * beta) / 2);
    };
    const parts = (): { svg: Element; disc: Circle; craters: Circle[]; shadow: Circle } => {
      const svg = glyphSvg('moon');
      const [disc = '', ...craters] = contours(svg.querySelector('path[clip-path="url(#bk-moon-lit)"]')?.getAttribute('d'));

      return { svg, disc: circle(disc), craters: craters.map(circle), shadow: clipCircle(svg, 'bk-moon-lit') };
    };

    it('lights at least half of its face, so the solid crescent reads before the see-through shade', () => {
      const { disc, shadow } = parts();
      const lit = Math.PI * disc.r ** 2 - lensArea(disc, shadow);

      expect(lit / (Math.PI * disc.r ** 2)).toBeGreaterThanOrEqual(0.5);
    });

    it('rounds the shade with a see-through terminator band one unit or wider', () => {
      const { svg, disc, shadow } = parts();
      const shades = Array.from(svg.querySelectorAll('path[opacity]'));
      const band = clipCircle(svg, 'bk-moon-band');

      // Earthshine over the whole disc, plus the band copy clipped past the terminator.
      expect(shades).toHaveLength(2);
      expect(shades.map(shade => contours(shade.getAttribute('d'))[0])).toStrictEqual([
        contours(svg.querySelector('path[clip-path="url(#bk-moon-lit)"]')?.getAttribute('d'))[0],
        contours(svg.querySelector('path[clip-path="url(#bk-moon-lit)"]')?.getAttribute('d'))[0],
      ]);
      expect(shades[1]?.getAttribute('clip-path')).toBe('url(#bk-moon-band)');
      expect(band.r).toBe(shadow.r);
      // The band's shadow slides straight away from the disc centre.
      expect(apart(band, disc) - apart(shadow, disc)).toBeGreaterThanOrEqual(1);
      expect(apart(band, shadow) + apart(shadow, disc)).toBeCloseTo(apart(band, disc), 2);
    });

    it('pits the lit crescent with a few craters big enough to read at face size', () => {
      const { disc, shadow, craters } = parts();

      expect(craters.length).toBeGreaterThanOrEqual(2);
      expect(craters.length).toBeLessThanOrEqual(4);

      for (const crater of craters) {
        // Under 0.9 units a crater is a one-pixel speck on the 21px glyph.
        expect(crater.r).toBeGreaterThanOrEqual(0.9);
        expect(apart(crater, disc) + crater.r).toBeLessThanOrEqual(disc.r);
        expect(apart(crater, shadow) - crater.r).toBeGreaterThanOrEqual(0);
      }
    });
  });

  it('alternates four long and four short sun rays every 45 degrees around the center', () => {
    const rays = Array.from(glyphSvg('sun').querySelectorAll('path'));
    const angle = (ray: Element): number => Number(ray.getAttribute('transform')?.match(/^rotate\((\d+) 10 10\)$/)?.[1] ?? 0);
    const long = rays.filter(ray => angle(ray) % 90 === 0);
    const short = rays.filter(ray => angle(ray) % 90 === 45);

    expect(rays.map(angle).sort((a, b) => a - b)).toStrictEqual([0, 45, 90, 135, 180, 225, 270, 315]);
    expect(new Set(long.map(ray => ray.getAttribute('d'))).size).toBe(1);
    expect(new Set(short.map(ray => ray.getAttribute('d'))).size).toBe(1);
    expect(short[0]?.getAttribute('d')).not.toBe(long[0]?.getAttribute('d'));

    for (const disk of glyphSvg('sun').querySelectorAll('circle')) {
      expect([value(disk, 'cx'), value(disk, 'cy')]).toEqual([10, 10]);
    }
  });

  it('draws the saucer canopy and tractor beam as see-through glass around a solid hull', () => {
    const paths = Array.from(glyphSvg('saucer').querySelectorAll('path'));
    const group = paths[0]?.parentElement;
    const hull = paths.find(path => path.getAttribute('fill-rule') === 'evenodd');
    const glass = paths.filter(path => path.hasAttribute('opacity'));

    expect(paths).toHaveLength(4);
    expect(group?.localName).toBe('g');
    expect(paths.every(path => path.parentElement === group)).toBe(true);
    expect(glass).toHaveLength(2);
    expect(hull?.hasAttribute('opacity')).toBe(false);
  });

  it('pairs identical galaxy arms with a half-turn around the center', () => {
    const svg = glyphSvg('galaxy');
    const arms = Array.from(svg.querySelectorAll('path')).filter(path => inherited(path, 'stroke') === 'currentColor');
    const center = svg.querySelector('circle');
    const [first, second] = arms;

    expect(arms).toHaveLength(2);
    expect([value(center, 'cx'), value(center, 'cy')]).toEqual([10, 10]);
    expect(value(center, 'r')).toBeGreaterThan(0);
    expect(first?.getAttribute('d')).toBeTruthy();
    expect(second?.getAttribute('d')).toBe(first?.getAttribute('d'));
    expect(first?.getAttribute('transform') ?? 'rotate(0 10 10)').toBe('rotate(0 10 10)');
    expect(second?.getAttribute('transform')).toBe('rotate(180 10 10)');
    expect(second?.parentElement).toBe(first?.parentElement);
  });
});
