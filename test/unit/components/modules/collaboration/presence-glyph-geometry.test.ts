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
    const panels = Array.from(glyphSvg('satellite').querySelectorAll('rect'));
    const [left, body, right] = panels;
    const value = (element: Element | undefined, attribute: string): number =>
      Number(element?.getAttribute(attribute));

    expect(panels).toHaveLength(3);
    expect(value(left, 'width')).toBe(value(right, 'width'));
    expect(value(left, 'height')).toBe(value(right, 'height'));
    expect(value(left, 'y')).toBe(value(right, 'y'));
    expect(value(left, 'rx')).toBeGreaterThanOrEqual(0.75);
    expect(value(right, 'rx')).toBe(value(left, 'rx'));

    const leftGap = value(body, 'x') - value(left, 'x') - value(left, 'width');
    const rightGap = value(right, 'x') - value(body, 'x') - value(body, 'width');

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

  it('keeps compact stack glyphs legible without enlarging the stack', () => {
    const stack = new Map<string, string>();
    let ring = 0;
    let scale = 0;

    stylesheet.walkRules(rule => {
      if (rule.selector.includes('[data-blok-presence-overflow]') && rule.selector.includes('[data-blok-presence-avatar]')) {
        rule.walkDecls(declaration => {
          stack.set(declaration.prop, declaration.value);
        });
      }
      if (rule.selector === '[data-blok-interface]') {
        rule.walkDecls('--blok-presence-ring', declaration => {
          ring = parseFloat(declaration.value);
        });
      }
      if (rule.selector === '[data-blok-presence-glyph]::after') {
        rule.walkDecls('width', declaration => {
          scale = parseFloat(declaration.value) / 100;
        });
      }
    });

    expect(stack.get('width')).toBe('24px');
    expect(stack.get('height')).toBe(stack.get('width'));
    expect(stack.get('border')).toContain('var(--blok-presence-ring)');

    const canvas = (parseFloat(stack.get('width') ?? '0') - 2 * ring) * scale;

    expect(canvas).toBeGreaterThanOrEqual(15);
    expect(canvas).toBeLessThanOrEqual(16);
  });

  it('softens star tips and sun rays at the same micro-icon weight', () => {
    const star = glyphSvg('star');
    const sun = glyphSvg('sun');

    expect(star.getAttribute('stroke-linejoin')).toBe('round');
    expect(sun.getAttribute('stroke-linecap')).toBe('round');
    expect(star.getAttribute('stroke-width')).toBe('1.5');
    expect(sun.getAttribute('stroke-width')).toBe(star.getAttribute('stroke-width'));
  });
});
