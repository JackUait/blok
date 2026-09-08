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

const halfStroke = (element: Element | undefined): number => {
  const stroke = inherited(element, 'stroke');

  return stroke && stroke !== 'none' ? Number(inherited(element, 'stroke-width') ?? 1) / 2 : 0;
};

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

    expect(svg.querySelector('image, use, text, style, script, foreignObject, filter')).toBeNull();

    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      for (const paint of ['fill', 'stroke']) {
        expect([null, 'none', 'currentColor']).toContain(element.getAttribute(paint));
      }
    }
  });

  it('gives the satellite matching rounded solar panels with air around the body', () => {
    const panels = Array.from(glyphSvg('satellite').querySelectorAll('rect'))
      .sort((a, b) => value(a, 'x') - value(b, 'x'));
    const [left, body, right] = panels;

    expect(panels).toHaveLength(3);
    expect(value(left, 'width')).toBe(value(right, 'width'));
    expect(value(left, 'height')).toBe(value(right, 'height'));
    expect(value(left, 'y')).toBe(value(right, 'y'));
    expect(value(left, 'rx')).toBeGreaterThan(0);
    expect(value(left, 'rx') + halfStroke(left)).toBeGreaterThanOrEqual(0.75);
    expect(value(right, 'rx')).toBe(value(left, 'rx'));
    expect(halfStroke(right)).toBe(halfStroke(left));
    expect(value(body, 'x') + value(body, 'width') / 2).toBe(10);
    expect(value(left, 'x') + value(right, 'x') + value(right, 'width')).toBe(20);
    expect(inherited(body, 'fill')).toBe('none');
    expect(inherited(body, 'stroke')).toBe('currentColor');
    expect(inherited(body, 'stroke-width')).toBe('1.25');

    const leftGap = value(body, 'x') - value(left, 'x') - value(left, 'width') - halfStroke(left) - halfStroke(body);
    const rightGap = value(right, 'x') - value(body, 'x') - value(body, 'width') - halfStroke(right) - halfStroke(body);

    expect(leftGap).toBeGreaterThanOrEqual(1.25);
    expect(rightGap).toBe(leftGap);
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

  it.each(['star', 'sun', 'saucer', 'asteroid'])('%s declares closed evenodd contours for its cutouts', glyph => {
    const path = glyphSvg(glyph).querySelector('path');
    const contours = path?.getAttribute('d')?.match(/[Mm][^Mm]*/g) ?? [];

    expect(inherited(path, 'fill-rule')).toBe('evenodd');
    expect(inherited(path, 'fill')).toBe('currentColor');
    expect(contours.length).toBeGreaterThan(1);

    for (const contour of contours) {
      expect(contour.trim()).toMatch(/[Zz]$/);
    }
  });

  it('rounds all five tips in the star\'s exterior contour', () => {
    const paths = glyphSvg('star').querySelectorAll('path');
    const contour = paths[0]?.getAttribute('d')?.match(/^[Mm][^Mm]*/)?.[0]?.trim() ?? '';
    const position = [0, 0];

    expect(paths).toHaveLength(1);
    expect(inherited(paths[0], 'fill')).toBe('currentColor');
    expect(contour).toMatch(/^M[^Mm]+[Zz]$/);
    expect(contour.match(/[Qq]/g)).toHaveLength(5);

    for (const [, command, argumentsText] of contour.matchAll(/([a-z])([^a-z]*)/gi)) {
      expect(['M', 'm', 'L', 'l', 'Q', 'q', 'Z', 'z']).toContain(command);

      const values = argumentsText.match(/-?\d*\.?\d+/g)?.map(Number) ?? [];
      const relative = command === command.toLowerCase();
      const quadratic = command.toLowerCase() === 'q';

      if (quadratic) {
        expect(values).toHaveLength(4);

        const [cx, cy, dx, dy] = values.map((value, index) => relative ? value : value - position[index % 2]);

        // Collinear controls would leave the tip flat despite a Q command.
        expect(Math.abs(cx * dy - cy * dx) / (2 * Math.hypot(dx, dy))).toBeGreaterThanOrEqual(0.5);
      }

      for (let index = quadratic ? 2 : 0; index < values.length; index += 2) {
        position[0] = relative ? position[0] + values[index] : values[index];
        position[1] = relative ? position[1] + values[index + 1] : values[index + 1];
      }
    }
  });

  it('repeats eight filled curved sun flames every 45 degrees around the center', () => {
    const [disk, ...rays] = glyphSvg('sun').querySelectorAll('path');
    const basePath = rays[0]?.getAttribute('d') ?? '';

    expect(rays).toHaveLength(8);
    expect(basePath).toMatch(/^[Mm][^Mm]*[Zz]$/);
    expect(basePath).toMatch(/[CcQqAa]/);
    expect(basePath).not.toMatch(/[LlHhVv]/);

    for (const [index, ray] of rays.entries()) {
      expect(ray.getAttribute('d')).toBe(basePath);
      expect(ray.getAttribute('transform') ?? 'rotate(0 10 10)').toBe(`rotate(${index * 45} 10 10)`);
      expect(ray.parentElement).toBe(rays[0]?.parentElement);
      expect(inherited(ray, 'fill')).toBe('currentColor');
      expect([null, undefined, 'none']).toContain(inherited(ray, 'stroke'));
    }

    expect(inherited(disk, 'fill')).toBe('currentColor');
  });

  it('keeps the saucer canopy, highlight, hull and beam in one tilted group', () => {
    const paths = Array.from(glyphSvg('saucer').querySelectorAll('path'));
    const [canopy] = paths;
    const group = canopy?.parentElement;
    const rotation = group?.getAttribute('transform')?.match(/rotate\(\s*(-?\d*\.?\d+)[ ,]+10[ ,]+10\s*\)/);

    expect(paths).toHaveLength(4);
    expect(group?.localName).toBe('g');
    expect(rotation).toBeTruthy();
    expect(Number(rotation?.[1])).not.toBe(0);

    for (const path of paths) {
      expect(path.parentElement).toBe(group);
    }
  });

  it('pairs identical filled galaxy arms with a half-turn around the center', () => {
    const svg = glyphSvg('galaxy');
    const arms = Array.from(svg.querySelectorAll('path'));
    const center = svg.querySelector('circle');
    const [first, second] = arms;

    expect(arms).toHaveLength(2);
    expect([value(center, 'cx'), value(center, 'cy')]).toEqual([10, 10]);
    expect(value(center, 'r')).toBeGreaterThan(0);
    expect(inherited(center, 'fill')).toBe('currentColor');
    expect(first?.getAttribute('d')).toBeTruthy();
    expect(second?.getAttribute('d')).toBe(first?.getAttribute('d'));
    expect(first?.getAttribute('transform') ?? 'rotate(0 10 10)').toBe('rotate(0 10 10)');
    expect(second?.getAttribute('transform')).toBe('rotate(180 10 10)');
    expect(second?.parentElement).toBe(first?.parentElement);
    expect(inherited(first, 'fill')).toBe('currentColor');
    expect(inherited(second, 'fill')).toBe('currentColor');
  });
});
