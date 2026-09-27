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

  it('lights most of the satellite body and shades the rest with a see-through copy', () => {
    const svg = glyphSvg('satellite');
    const [lit, shade] = Array.from(svg.querySelectorAll('rect'));
    const geometry = (rect: Element | undefined): string[] => ['x', 'y', 'width', 'height', 'rx'].map(key => rect?.getAttribute(key) ?? '');
    const edge = Number(svg.querySelector('clipPath[id="bk-satellite-lit"] path')?.getAttribute('d')?.match(/H(-?\d*\.?\d+)/)?.[1]);

    expect(lit?.getAttribute('clip-path')).toBe('url(#bk-satellite-lit)');
    expect(lit?.hasAttribute('opacity')).toBe(false);
    expect(Number(shade?.getAttribute('opacity'))).toBeLessThan(1);
    expect(geometry(shade)).toStrictEqual(geometry(lit));
    // The lit edge must fall inside the body, past its middle.
    expect(edge).toBeGreaterThan(value(lit, 'x') + value(lit, 'width') / 2);
    expect(edge).toBeLessThan(value(lit, 'x') + value(lit, 'width'));
  });

  it('beams two widening waves from the satellite dish, a solid one and a see-through one', () => {
    type Arc = { r: number; opacity: string | null };
    const waves: Arc[] = Array.from(glyphSvg('satellite').querySelectorAll('path'))
      .filter(path => inherited(path, 'stroke') === 'currentColor')
      .map(path => ({ r: Number(path.getAttribute('d')?.match(/A(\d*\.?\d+)/)?.[1]), opacity: path.getAttribute('opacity') }));

    expect(waves).toHaveLength(2);
    expect(waves[0]?.opacity).toBeNull();
    expect(Number(waves[1]?.opacity)).toBeLessThan(1);
    expect(waves[1]?.r).toBeGreaterThan(waves[0]?.r ?? Number.POSITIVE_INFINITY);
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

  describe('asteroid', () => {
    const contours = (d: string | null | undefined): string[] => d?.match(/M[^M]*/g) ?? [];
    const lit = (): Element | null => glyphSvg('asteroid').querySelector('path[clip-path="url(#bk-asteroid-lit)"]');

    it('lights part of the rock and shades the rest with a see-through copy of the same outline', () => {
      const svg = glyphSvg('asteroid');
      const [outline] = contours(lit()?.getAttribute('d'));

      expect(svg.querySelector('clipPath[id="bk-asteroid-lit"] path')).not.toBeNull();
      expect(lit()?.getAttribute('fill-rule')).toBe('evenodd');
      expect(lit()?.hasAttribute('opacity')).toBe(false);
      expect(outline).toBeTruthy();
      expect(Array.from(svg.querySelectorAll('path[opacity]'), shade => shade.getAttribute('d'))).toContain(outline);
    });

    it('cuts one or two craters, each big enough to read at face size', () => {
      // Crater contours are drawn as `M cx top a r r ...`.
      const radii = contours(lit()?.getAttribute('d')).slice(1)
        .map(contour => Number(contour.match(/a(-?(?:\d+\.?\d*|\.\d+))/)?.[1]));

      expect(radii.length).toBeGreaterThanOrEqual(1);
      expect(radii.length).toBeLessThanOrEqual(2);

      for (const r of radii) {
        expect(r).toBeGreaterThanOrEqual(0.9);
      }
    });

    it('gives the companion rock its own lit side and see-through shade', () => {
      const svg = glyphSvg('asteroid');
      const moonlet = svg.querySelector('path[clip-path="url(#bk-asteroid-moonlet)"]');
      const shade = Array.from(svg.querySelectorAll('path[opacity]')).find(path => path.getAttribute('d') === moonlet?.getAttribute('d'));

      expect(svg.querySelector('clipPath[id="bk-asteroid-moonlet"] path')).not.toBeNull();
      expect(moonlet?.getAttribute('d')).toBeTruthy();
      expect(shade).toBeDefined();
    });
  });

  describe('comet', () => {
    // Circle contours are drawn as `M cx top a r r ...`.
    const radius = (element: Element | null | undefined): number =>
      Number(element?.getAttribute('d')?.match(/a(\d*\.?\d+)/)?.[1]);
    const solid = (svg: Element): Element[] => Array.from(svg.querySelectorAll('path:not([opacity])'));
    // The core is the only solid circle; the streaks are the solid path with several contours.
    const core = (svg: Element): Element | undefined => solid(svg).find(path => /^M[^M]*a[^M]*Z$/.test(path.getAttribute('d') ?? ''));
    const streaks = (svg: Element): Element | undefined =>
      solid(svg).find(path => (path.getAttribute('d')?.match(/M/g)?.length ?? 0) >= 3);

    it('glows from a solid core through an inner glow into the see-through tail, with no clipped seams', () => {
      const svg = glyphSvg('comet');
      const glow = Array.from(svg.querySelectorAll('path[opacity]')).find(path => radius(path) > radius(core(svg)));

      expect(core(svg)).toBeDefined();
      expect(glow).toBeDefined();
      // Clip edges drew hard cuts across the streaks and a seam between coma and tail.
      expect(svg.querySelector('clipPath, [clip-path]')).toBeNull();
    });

    it('fans at least three solid streaks out from behind the core', () => {
      const svg = glyphSvg('comet');
      const all = solid(svg);
      const contours = streaks(svg)?.getAttribute('d')?.match(/M[^M]*/g) ?? [];
      // Each streak is `M base Q ctrl tip Q ctrl base Z`: the tip is the fourth number pair.
      const angles = contours.map(contour => {
        const [x = 0, y = 0, , , tx = 0, ty = 0] = (contour.match(/-?\d*\.?\d+/g) ?? []).map(Number);

        return Math.atan2(ty - y, tx - x) * 180 / Math.PI;
      });

      expect(contours.length).toBeGreaterThanOrEqual(3);
      // Painted first, so the core hides where they start.
      expect(all.findIndex(path => path === streaks(svg))).toBeLessThan(all.findIndex(path => path === core(svg)));
      expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThanOrEqual(4);
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

  it('draws the saucer beam, underside and canopy as see-through glass around a solid deck', () => {
    const group = glyphSvg('saucer').querySelector(':scope > g');
    const own = Array.from(group?.querySelectorAll(':scope > path') ?? []);
    const hull = own.find(path => path.getAttribute('fill-rule') === 'evenodd');
    const glass = own.filter(path => path.hasAttribute('opacity'));

    expect(glass).toHaveLength(3);
    expect(hull?.hasAttribute('opacity')).toBe(false);
  });

  it('sizes the saucer portholes by perspective, largest in the middle and mirrored', () => {
    // Scoped to the saucer's own paths: the cow body is evenodd too.
    const hull = glyphSvg('saucer').querySelector(':scope > g > path[fill-rule="evenodd"]');
    // Porthole contours are drawn as `M cx top a r r ...`.
    const radii = (hull?.getAttribute('d')?.match(/M[^M]*/g) ?? []).slice(1)
      .map(contour => Number(contour.match(/a(\d*\.?\d+)/)?.[1]));
    const middle = Math.floor(radii.length / 2);

    expect(radii).toHaveLength(5);
    expect(radii).toStrictEqual([...radii].reverse());
    expect(Math.max(...radii)).toBe(radii[middle]);
    expect(radii[0]).toBeLessThan(radii[middle] ?? 0);
  });

  it('lifts a solid spotted cow inside the saucer beam', () => {
    const group = glyphSvg('saucer').querySelector(':scope > g');
    const cow = group?.querySelector(':scope > g');
    const [beam] = Array.from(group?.querySelectorAll(':scope > path[opacity]') ?? []);
    const [body] = Array.from(cow?.querySelectorAll('path') ?? []);

    // Painted after the beam, so the glass never washes over it.
    expect(beam?.compareDocumentPosition(cow ?? beam) ?? 0).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(cow?.querySelector('[opacity]')).toBeNull();
    expect(body?.getAttribute('fill-rule')).toBe('evenodd');
    // Its outline plus one spot.
    expect(body?.getAttribute('d')?.match(/M/g)).toHaveLength(2);
    // A gap splits the beam into bands, so it reads as pulling upward.
    expect(beam?.getAttribute('d')?.match(/M/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('pairs identical galaxy arms with a half-turn and strings mirrored stars along them', () => {
    const svg = glyphSvg('galaxy');
    const [first, second, ...rest] = Array.from(svg.querySelectorAll('path[opacity]'));
    const solid = svg.querySelector('path:not([opacity])');
    const [core = '', ...stars] = solid?.getAttribute('d')?.match(/M[^M]*/g) ?? [];
    const numbers = (contour: string): number[] => (contour.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    // Circle contours are drawn as `M cx top a r r ...`, so the centre is one radius below the start.
    const [x = Number.NaN, top = Number.NaN, r = Number.NaN] = numbers(core);
    // Stars are drawn as `M tip Q centre ...`, so the second pair is the centre.
    const centres = stars.map(star => numbers(star).slice(2, 4));

    expect(svg.querySelector('[stroke]')).toBeNull();
    expect(rest).toHaveLength(0);
    expect(first?.getAttribute('d')).toBeTruthy();
    expect(second?.getAttribute('d')).toBe(first?.getAttribute('d'));
    expect(first?.getAttribute('transform') ?? 'rotate(0 10 10)').toBe('rotate(0 10 10)');
    expect(second?.getAttribute('transform')).toBe('rotate(180 10 10)');

    expect([x, top + r]).toEqual([10, 10]);
    expect(r).toBeGreaterThan(0);

    expect(stars.length).toBeGreaterThanOrEqual(4);
    expect(stars.length % 2).toBe(0);

    // Each star has a twin on the other arm, a half-turn away.
    for (let i = 0; i < centres.length; i += 2) {
      const [ax = 0, ay = 0] = centres[i] ?? [];
      const [bx = 0, by = 0] = centres[i + 1] ?? [];

      expect(ax + bx).toBeCloseTo(20, 0);
      expect(ay + by).toBeCloseTo(20, 0);
    }
  });
});
