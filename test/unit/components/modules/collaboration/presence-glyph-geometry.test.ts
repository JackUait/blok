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

  it('glazes each satellite panel with a grid of six see-through cells', () => {
    const svg = glyphSvg('satellite');
    const glass = svg.querySelector('g > path[opacity]')?.getAttribute('d') ?? '';

    for (const panel of svg.querySelectorAll('path[fill-rule="evenodd"]')) {
      const [, ...cells] = panel.getAttribute('d')?.match(/M[^M]*/g) ?? [];

      expect(cells).toHaveLength(6);
      for (const cell of cells) {
        expect(glass).toContain(cell);
      }
    }
  });

  it('cuts a see-through porthole into the lit satellite body', () => {
    const svg = glyphSvg('satellite');
    const body = svg.querySelector('rect[clip-path]');
    // The lit clip is the lit half, then the cut-outs drawn from their top.
    const [, porthole = ''] = svg.querySelector('clipPath[id="bk-satellite-lit"] path')?.getAttribute('d')?.match(/M[^M]*/g) ?? [];
    const [x = Number.NaN, top = Number.NaN, r = Number.NaN] = (porthole.match(/-?\d*\.?\d+/g) ?? []).map(Number);

    expect(porthole).toMatch(/^M[^M]*a[^M]*Z$/);
    expect(x - r).toBeGreaterThan(value(body, 'x'));
    expect(top).toBeGreaterThan(value(body, 'y'));
    expect(top + 2 * r).toBeLessThan(value(body, 'y') + value(body, 'height'));
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

    it('plants a flag on the lit crescent, its pole rising above the disc', () => {
      const { svg, disc, shadow } = parts();
      // The pole is drawn `M left base V top h width V base Z`, then the flag flies from its top.
      const pole = Array.from(svg.querySelectorAll('path:not([opacity]):not([clip-path])'))
        .flatMap(path => contours(path.getAttribute('d')))
        .find(contour => /^M[^M]*V[^M]*h[^M]*V[^M]*Z$/.test(contour));
      const [left = Number.NaN, base = Number.NaN, top = Number.NaN, width = Number.NaN] = (pole?.match(/-?(?:\d+\.?\d*|\.\d+)/g) ?? []).map(Number);
      const foot = { x: left + width / 2, y: base, r: 0 };

      expect(pole).toBeDefined();
      expect(apart(foot, disc)).toBeLessThan(disc.r);
      expect(apart(foot, shadow)).toBeGreaterThan(shadow.r);
      expect(top).toBeLessThan(disc.y - disc.r - 2);
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

  describe('astronaut', () => {
    const contours = (d: string | null | undefined): string[] => d?.match(/M[^M]*/g) ?? [];
    const numbers = (d: string | null | undefined): number[] => (d?.match(/-?\d*\.?\d+/g) ?? []).map(Number);

    // Endpoints of an absolute path (M, L, H, V, Q, A), enough to find its bounds.
    const ys = (d: string | null | undefined): number[] => {
      const result: number[] = [];
      let y = 0;

      for (const [, command = '', args = ''] of (d ?? '').matchAll(/([MLHVQAZ])([^MLHVQAZ]*)/g)) {
        const values = numbers(args);
        const arity = { M: 2, L: 2, H: 1, V: 1, Q: 4, A: 7, Z: 0 }[command] ?? 0;

        for (let i = 0; arity > 0 && i + arity <= values.length; i += arity) {
          y = command === 'H' ? y : values[i + arity - 1] ?? y;
          result.push(y);
        }
      }

      return result;
    };

    it('reflects a planet rising in the visor, its atmosphere around it, inset from the helmet', () => {
      const svg = glyphSvg('astronaut');
      const [, visor = ''] = contours(svg.querySelector('path[fill-rule="evenodd"]')?.getAttribute('d'));
      const visorYs = ys(visor);
      const scene = svg.querySelector('g[clip-path="url(#bk-astronaut-visor)"]');
      const planet = scene?.querySelector('path:not([opacity])')?.getAttribute('d');
      const haze = scene?.querySelector('path[opacity]')?.getAttribute('d');
      // Both are circles drawn from their top: `M x top a r ...`.
      const [planetX = Number.NaN, planetTop = Number.NaN, planetR = Number.NaN] = numbers(planet);
      const [hazeX = Number.NaN, hazeTop = Number.NaN, hazeR = Number.NaN] = numbers(haze);
      const clipYs = ys(svg.querySelector('clipPath[id="bk-astronaut-visor"] path')?.getAttribute('d'));

      expect(planetTop).toBeGreaterThan(Math.min(...visorYs));
      expect(planetTop).toBeLessThan(Math.max(...visorYs));
      expect(hazeX).toBe(planetX);
      expect(hazeTop + hazeR).toBeCloseTo(planetTop + planetR);
      expect(hazeR).toBeGreaterThan(planetR);
      // The see-through gutter keeps the solid planet off the solid helmet.
      expect(Math.max(...clipYs)).toBeLessThan(Math.max(...visorYs));
    });

    it('fills every chest panel on the suit with see-through glass', () => {
      const svg = glyphSvg('astronaut');
      const suit = Array.from(svg.querySelectorAll('path[fill-rule="evenodd"]')).at(-1);
      const [, ...panels] = contours(suit?.getAttribute('d'));
      const glass = Array.from(svg.querySelectorAll('path[opacity]')).flatMap(path => contours(path.getAttribute('d')));

      expect(panels.length).toBeGreaterThan(0);
      for (const panel of panels) {
        expect(glass).toContain(panel);
      }
    });
  });

  describe('rocket', () => {
    it('lights the rocket body and shades the rest with a see-through copy cut by the same porthole', () => {
      const svg = glyphSvg('rocket');
      const lit = svg.querySelector('path[clip-path="url(#bk-rocket-lit)"]');
      const shade = Array.from(svg.querySelectorAll('path[opacity]')).find(path => path.getAttribute('d') === lit?.getAttribute('d'));

      expect(svg.querySelector('clipPath[id="bk-rocket-lit"] path')).not.toBeNull();
      expect(lit?.getAttribute('fill-rule')).toBe('evenodd');
      expect(lit?.getAttribute('d')?.match(/M/g)?.length).toBeGreaterThanOrEqual(2);
      expect(shade).toBeDefined();
    });

    it('trails one continuous plume of smoke puffs, each overlapping the next', () => {
      // Circle contours are drawn as `M cx top a r r ...`, so the centre is one radius below the start.
      const puffs = Array.from(glyphSvg('rocket').querySelectorAll('path[opacity]'))
        .map(path => path.getAttribute('d')?.match(/M[^M]*/g) ?? [])
        .find(contours => contours.length >= 4 && contours.every(contour => /^M[^M]*a/.test(contour)))
        ?.map(contour => {
          const [x = 0, top = 0, r = 0] = (contour.match(/-?\d*\.?\d+/g) ?? []).map(Number);

          return { x, y: top + r, r };
        }) ?? [];

      expect(puffs.length).toBeGreaterThanOrEqual(4);

      // Smoke expands as it drifts off. Only the last puff, which billows beside its neighbour, may be smaller.
      for (let i = 1; i < puffs.length - 1; i++) {
        expect(puffs[i]?.r ?? 0).toBeGreaterThanOrEqual(puffs[i - 1]?.r ?? Infinity);
      }

      // Gaps between puffs read as a string of beads, not smoke.
      for (let i = 1; i < puffs.length; i++) {
        const [a, b] = [puffs[i - 1], puffs[i]];

        expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0))).toBeLessThan((a?.r ?? 0) + (b?.r ?? 0));
      }
    });
  });

  describe('telescope', () => {
    const numbers = (d: string | null | undefined): number[] => (d?.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    // The dome is drawn as `M left base A r r 0 0 1 right base Z`.
    const dome = (svg: Element): { x: number; y: number; r: number; d: string } => {
      const d = svg.querySelector('path[clip-path="url(#bk-telescope-lit)"]')?.getAttribute('d') ?? '';
      const [left = Number.NaN, y = Number.NaN, r = Number.NaN, , , , , right = Number.NaN] = numbers(d);

      return { x: (left + right) / 2, y, r, d };
    };

    it('houses the telescope in a lit observatory dome over a see-through copy, with a slit cut through the lit side', () => {
      const svg = glyphSvg('telescope');
      const { d } = dome(svg);
      const shade = Array.from(svg.querySelectorAll('path[opacity]')).find(path => path.getAttribute('d') === d);

      expect(d).toMatch(/^M[^M]*A[^M]*Z$/);
      expect(shade).toBeDefined();
      // The slit clips only the lit dome, so the see-through copy shows as the dark inside.
      expect(svg.querySelector('path[clip-path="url(#bk-telescope-lit)"]')?.closest('[clip-path="url(#bk-telescope-slit)"]')).not.toBeNull();
      expect(shade?.closest('[clip-path="url(#bk-telescope-slit)"]')).toBeNull();
    });

    it('ends the slit in a rounded cut above the dome base, so it reads as an opening, not a wedge', () => {
      const svg = glyphSvg('telescope');
      const { y } = dome(svg);
      // The slit clip is the canvas plus the slit; the slit starts where its rounded end begins.
      const slit = svg.querySelector('clipPath[id="bk-telescope-slit"] path')?.getAttribute('d')?.match(/M[^M]*/g)?.[1] ?? '';
      const [, startY = Number.NaN] = numbers(slit);

      expect(slit).toMatch(/^M[^M]*A/);
      expect(startY).toBeLessThan(y - 1);
    });

    it('pokes the telescope tube out through the slit, past the dome', () => {
      const svg = glyphSvg('telescope');
      const { x, y, r } = dome(svg);
      // The tube and its hood are the solid path of two or more arc-free contours.
      const tube = Array.from(svg.querySelectorAll('path:not([opacity]):not([clip-path])'))
        .find(path => /^(M[^MAa]*L[^MAa]*Z){2,}$/.test(path.getAttribute('d') ?? ''));
      const points = numbers(tube?.getAttribute('d'));
      let reach = 0;

      for (let i = 0; i + 1 < points.length; i += 2) {
        reach = Math.max(reach, Math.hypot((points[i] ?? 0) - x, (points[i + 1] ?? 0) - y));
      }

      expect(tube).toBeDefined();
      expect(reach).toBeGreaterThan(r);
    });

    it('rings the tube with a thin collar between the barrel and the hood', () => {
      const tube = Array.from(glyphSvg('telescope').querySelectorAll('path:not([opacity]):not([clip-path])'))
        .find(path => /^(M[^MAa]*L[^MAa]*Z){2,}$/.test(path.getAttribute('d') ?? ''));
      // Shoelace area over every point of the contour, control points included.
      const areas = (tube?.getAttribute('d')?.match(/M[^M]*/g) ?? []).map(contour => {
        const points = numbers(contour);
        let area = 0;

        for (let i = 0; i + 1 < points.length; i += 2) {
          const next = (i + 2) % points.length;

          area += (points[i] ?? 0) * (points[next + 1] ?? 0) - (points[next] ?? 0) * (points[i + 1] ?? 0);
        }

        return Math.abs(area / 2);
      });
      const [barrel = 0, collar = 0, hood = 0] = areas;

      expect(areas).toHaveLength(3);
      expect(collar).toBeLessThan(barrel);
      expect(collar).toBeLessThan(hood);
    });

    it('catches starlight: a see-through beam runs from the big star into the telescope', () => {
      const svg = glyphSvg('telescope');
      const { x, y, r } = dome(svg);
      // The big star is the solid four-point sparkle, drawn from its top tip.
      const star = Array.from(svg.querySelectorAll('path:not([opacity])'))
        .find(path => /^M[^M]*(Q[^M]*){4}Z$/.test(path.getAttribute('d') ?? ''));
      const [tipX = Number.NaN, tipY = Number.NaN, , centreY = Number.NaN] = numbers(star?.getAttribute('d'));
      const beam = Array.from(svg.querySelectorAll('path[opacity]'))
        .find(path => /^M[^M]*L[^M]*L[^M]*Z$/.test(path.getAttribute('d') ?? ''));
      const [fromX = Number.NaN, fromY = Number.NaN, ...mouth] = numbers(beam?.getAttribute('d'));

      expect(beam).toBeDefined();
      expect(fromX).toBeCloseTo(tipX);
      expect(fromY).toBeCloseTo(centreY);
      expect(centreY).toBeGreaterThan(tipY);

      for (let i = 0; i + 1 < mouth.length; i += 2) {
        expect(Math.hypot((mouth[i] ?? 0) - x, (mouth[i + 1] ?? 0) - y)).toBeGreaterThan(r);
      }
    });

    it('rounds the building and arches its windows, so the base matches the dome', () => {
      const svg = glyphSvg('telescope');
      const { y } = dome(svg);
      const building = Array.from(svg.querySelectorAll('path[fill-rule="evenodd"]'))
        .find(path => (numbers(path.getAttribute('d'))[1] ?? 0) > y);
      const contours = building?.getAttribute('d')?.match(/M[^M]*/g) ?? [];

      // The outline, the door, then two windows: each one has a curve.
      expect(contours).toHaveLength(4);
      for (const contour of contours) {
        expect(contour).toMatch(/A/);
      }
    });

    it('puts a see-through glint on the lit dome', () => {
      const svg = glyphSvg('telescope');
      const { x, y, r } = dome(svg);
      // The canvas, then the glint cut out of it.
      const [canvas, glint = ''] = svg.querySelector('clipPath[id="bk-telescope-lit"] path')?.getAttribute('d')?.match(/M[^M]*/g) ?? [];
      const [startX = Number.NaN, startY = Number.NaN] = numbers(glint);

      expect(canvas).toBe('M0 0h20v20H0Z');
      expect(startY).toBeLessThan(y);
      expect(Math.hypot(startX - x, startY - y)).toBeLessThan(r - 0.5);
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

  describe('sun', () => {
    const numbers = (d: string | null | undefined): number[] => (d?.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    const rays = (): Element[] => Array.from(glyphSvg('sun').querySelectorAll('g[clip-path="url(#bk-sun-rays)"] > path'));

    it('alternates four long and four short flame rays every 45 degrees around the center', () => {
      const angle = (ray: Element): number => Number(ray.getAttribute('transform')?.match(/^rotate\((\d+) 10 10\)$/)?.[1] ?? 0);
      const all = rays();
      const long = all.filter(ray => angle(ray) % 90 === 0);
      const short = all.filter(ray => angle(ray) % 90 === 45);

      expect(all.map(angle).sort((a, b) => a - b)).toStrictEqual([0, 45, 90, 135, 180, 225, 270, 315]);
      expect(new Set(long.map(ray => ray.getAttribute('d'))).size).toBe(1);
      expect(new Set(short.map(ray => ray.getAttribute('d'))).size).toBe(1);
      expect(short[0]?.getAttribute('d')).not.toBe(long[0]?.getAttribute('d'));

      for (const disk of glyphSvg('sun').querySelectorAll('circle')) {
        expect([value(disk, 'cx'), value(disk, 'cy')]).toEqual([10, 10]);
      }
    });

    it('curves every ray and sweeps its tip clockwise, so the sun swirls', () => {
      // The unrotated ray points up: `M left base Q c tip Q c right base Z`.
      const [leftX = Number.NaN, , , , tipX = Number.NaN, , , , rightX = Number.NaN] = numbers(rays()[0]?.getAttribute('d'));

      expect(rays()[0]?.getAttribute('d')).toMatch(/^M[^M]*Q[^M]*Q[^M]*Z$/);
      expect(tipX).toBeGreaterThan((leftX + rightX) / 2);
    });

    it('rings the solid disc with a see-through corona, set apart from the rays', () => {
      const svg = glyphSvg('sun');
      const disc = svg.querySelector('circle[clip-path="url(#bk-sun-lit)"]');
      const corona = Math.max(...Array.from(svg.querySelectorAll('circle[opacity]')).map(circle => value(circle, 'r')));
      // The ray clip is the canvas minus a circle drawn from its top: `M10 top a r ...`.
      const hole = svg.querySelector('clipPath[id="bk-sun-rays"] path')?.getAttribute('d')?.match(/M[^M]*/g)?.[1];
      const [, top = Number.NaN] = numbers(hole);

      expect(disc).not.toBeNull();
      expect(corona).toBeGreaterThan(value(disc, 'r'));
      expect(10 - top).toBeGreaterThan(corona);
    });
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

  describe('galaxy', () => {
    type Point = [number, number];
    type Ellipse = { x: number; y: number; rx: number; ry: number; rot: number };

    const numbers = (contour: string): number[] => (contour.match(/-?\d*\.?\d+/g) ?? []).map(Number);
    const contours = (element: Element | null | undefined): string[] => element?.getAttribute('d')?.match(/M[^M]*/g) ?? [];
    // `M x y` then `C c1 c2 end` segments: every sixth pair after the start is on the curve.
    const onCurve = (contour: string): Point[] => {
      const [x = Number.NaN, y = Number.NaN, ...rest] = numbers(contour);
      const points: Point[] = [[x, y]];

      for (let i = 4; i < rest.length; i += 6) {
        points.push([rest[i] ?? Number.NaN, rest[i + 1] ?? Number.NaN]);
      }

      return points;
    };
    // Ellipses are drawn `M p0 A rx ry rot 1 0 p1 A ...`, from one end of the long axis to the other.
    const ellipse = (contour: string | undefined): Ellipse => {
      const [x0 = Number.NaN, y0 = Number.NaN, rx = Number.NaN, ry = Number.NaN, rot = Number.NaN, , , x1 = Number.NaN, y1 = Number.NaN] = numbers(contour ?? '');

      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, rx, ry, rot };
    };
    // Undoes the tilt, so the distance is measured in the galaxy's own face-on plane.
    const faceOn = ([px, py]: Point, frame: Ellipse): number => {
      const angle = -frame.rot * Math.PI / 180;
      const dx = px - frame.x;
      const dy = py - frame.y;

      return Math.hypot(dx * Math.cos(angle) - dy * Math.sin(angle), (dx * Math.sin(angle) + dy * Math.cos(angle)) * frame.rx / frame.ry);
    };

    const parts = (): { arms: string[]; halo: Ellipse; spines: string[]; core: Ellipse; dots: string[]; sparkles: string[] } => {
      const svg = glyphSvg('galaxy');
      const [glow, ...extraGlow] = Array.from(svg.querySelectorAll('path[opacity]'));
      const solid = contours(svg.querySelector('path:not([opacity])'));

      expect(extraGlow).toHaveLength(0);

      return {
        arms: contours(glow).filter(contour => contour.includes('C')),
        halo: ellipse(contours(glow).find(contour => contour.includes('A'))),
        spines: solid.filter(contour => contour.includes('C')),
        core: ellipse(solid.find(contour => contour.includes('A'))),
        dots: solid.filter(contour => contour.includes('a')),
        sparkles: solid.filter(contour => contour.includes('Q')),
      };
    };
    const twins = (first: string | undefined, second: string | undefined): void => {
      const a = onCurve(first ?? '');
      const b = onCurve(second ?? '');

      expect(a.length).toBeGreaterThan(4);
      expect(b).toHaveLength(a.length);
      a.forEach(([x, y], i) => {
        const [tx = Number.NaN, ty = Number.NaN] = b[i] ?? [];

        expect(Math.abs(x + tx - 20)).toBeLessThanOrEqual(0.15);
        expect(Math.abs(y + ty - 20)).toBeLessThanOrEqual(0.15);
      });
    };

    it('tilts its disc: the core and its halo are centred, flattened ellipses at the same angle', () => {
      const { halo, core } = parts();

      for (const disc of [halo, core]) {
        expect(disc.x).toBeCloseTo(10, 1);
        expect(disc.y).toBeCloseTo(10, 1);
        expect(disc.ry / disc.rx).toBeLessThan(0.85);
        expect(disc.rot).not.toBe(0);
      }

      expect(core.rot).toBe(halo.rot);
      expect(core.ry / core.rx).toBeCloseTo(halo.ry / halo.rx, 1);
      expect(halo.rx - core.rx).toBeGreaterThanOrEqual(1.5);
    });

    it('sweeps two see-through arms, a half-turn apart, that taper out to their tips', () => {
      const { arms } = parts();

      expect(arms).toHaveLength(2);
      twins(arms[0], arms[1]);

      // Each arm runs out along one edge, round the tip and back along the other;
      // the last point closes onto the first, so drop it.
      const edge = onCurve(arms[0] ?? '').slice(0, -1);
      const across = (i: number): number => {
        const [ax = 0, ay = 0] = edge[i] ?? [];
        const [bx = 0, by = 0] = edge[edge.length - 1 - i] ?? [];

        return Math.hypot(ax - bx, ay - by);
      };
      const tip = (edge.length - 3) / 2;

      expect(across(0)).toBeGreaterThan(2 * across(tip));
    });

    it('winds a solid spine through each arm, stopping short of the core so the halo shows between', () => {
      const { spines, core, halo } = parts();

      expect(spines).toHaveLength(2);
      twins(spines[0], spines[1]);

      for (const point of spines.flatMap(onCurve)) {
        expect(faceOn(point, core)).toBeGreaterThan(core.rx);
      }

      // Each spine starts inside the halo, so it reads as growing out of the glow.
      expect(Math.min(...spines.flatMap(onCurve).map(point => faceOn(point, halo)))).toBeLessThan(halo.rx);
    });

    it('studs the arms with twin star clusters and keeps its sparkle out in open sky', () => {
      const { arms, dots, sparkles } = parts();
      // Circles are drawn `M cx top a r r ...`, so the centre is one radius below the start.
      const circles = dots.map(contour => {
        const [x = Number.NaN, top = Number.NaN, r = Number.NaN] = numbers(contour);

        return { x, y: top + r, r };
      });
      const clusters = circles.filter(({ x, y }) => Math.hypot(x - 10, y - 10) < 6);

      expect(clusters.length).toBeGreaterThanOrEqual(2);
      expect(clusters.length % 2).toBe(0);

      for (let i = 0; i < clusters.length; i += 2) {
        const [a, b] = [clusters[i], clusters[i + 1]];

        expect((a?.x ?? 0) + (b?.x ?? 0)).toBeCloseTo(20, 1);
        expect((a?.y ?? 0) + (b?.y ?? 0)).toBeCloseTo(20, 1);
      }

      expect(sparkles).toHaveLength(1);

      // Sparkles are drawn `M cx top Q cx cy ...`, so the second pair is the centre.
      const [, top = Number.NaN, x = Number.NaN, y = Number.NaN] = numbers(sparkles[0] ?? '');
      const reach = y - top;

      for (const [px, py] of arms.flatMap(onCurve)) {
        expect(Math.hypot(px - x, py - y)).toBeGreaterThan(reach + 0.5);
      }
    });
  });
});
