import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import postcss, { AtRule, Rule } from 'postcss';

import {
  ANONYMOUS_GLYPHS,
  UNKNOWN_GLYPH,
} from '../../../../../src/components/modules/collaboration/anonymous-identity';

const stylesheet = postcss.parse(readFileSync(resolve(__dirname, '../../../../../src/styles/presence.css'), 'utf8'));

const INK = '#37352f';
const PAPER = '#fff';

/** The two drawings a silhouette carries: one at rest, one that moves. */
type Drawing = '--blok-presence-glyph' | '--blok-presence-glyph-live';

const REST: Drawing = '--blok-presence-glyph';
const LIVE: Drawing = '--blok-presence-glyph-live';

const glyphSource = (glyph: string, drawing: Drawing): string => {
  let source = '';

  stylesheet.walkRules(`[data-blok-presence-glyph="${glyph}"]`, rule => {
    rule.walkDecls(drawing, declaration => {
      const url = declaration.value.match(/^url\("data:image\/svg\+xml,([^"]+)"\)$/);

      source = decodeURIComponent(url?.[1] ?? '');
    });
  });

  return source;
};

const glyphSvg = (glyph: string, drawing: Drawing = REST): Element => {
  const document = new DOMParser().parseFromString(glyphSource(glyph, drawing), 'image/svg+xml');

  if (document.querySelector('parsererror') || document.documentElement.localName !== 'svg') {
    throw new Error(`Invalid drawing for ${glyph} (${drawing})`);
  }

  return document.documentElement;
};

/** Every declaration of every rule with this exact selector, media rules included. */
const declarationsOf = (selector: string): Map<string, string> => {
  const declarations = new Map<string, string>();

  stylesheet.walkRules(rule => {
    if (rule.selector === selector) {
      rule.walkDecls(declaration => {
        declarations.set(declaration.prop, declaration.value);
      });
    }
  });

  return declarations;
};

const glyphs = [...ANONYMOUS_GLYPHS, UNKNOWN_GLYPH];

describe('anonymous presence ink drawings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(glyphs)('%s is drawn on the 32-unit grid of the whole face', glyph => {
    for (const drawing of [REST, LIVE]) {
      const svg = glyphSvg(glyph, drawing);

      expect(svg.getAttribute('viewBox')).toBe('0 0 32 32');
      // No fixed size: the drawing scales to whatever face carries it.
      expect(svg.hasAttribute('width')).toBe(false);
      expect(svg.hasAttribute('height')).toBe(false);
    }
  });

  it.each(glyphs)('%s stays self-contained inside a CSS image', glyph => {
    for (const drawing of [REST, LIVE]) {
      const svg = glyphSvg(glyph, drawing);

      expect(svg.querySelector('image, use, text, script, foreignObject, filter, mask, clipPath, linearGradient, radialGradient, pattern')).toBeNull();
    }
  });

  it.each(glyphs)('%s paints with one ink and paper white, nothing else', glyph => {
    for (const drawing of [REST, LIVE]) {
      const svg = glyphSvg(glyph, drawing);

      expect(svg.getAttribute('stroke')).toBe(INK);
      expect(svg.getAttribute('fill')).toBe('none');

      for (const element of svg.querySelectorAll('*')) {
        expect([null, 'none', INK, PAPER]).toContain(element.getAttribute('fill'));
        expect([null, 'none', INK, PAPER]).toContain(element.getAttribute('stroke'));
      }
    }
  });

  it.each(glyphs)('%s never fades: ink is solid at rest and in motion', glyph => {
    for (const drawing of [REST, LIVE]) {
      const svg = glyphSvg(glyph, drawing);

      expect(svg.querySelector('[opacity], [fill-opacity], [stroke-opacity]')).toBeNull();
      expect(svg.querySelector('style')?.textContent ?? '').not.toContain('opacity');
    }
  });

  it.each(glyphs)('%s draws its line at the weight of a Blok icon, with round ends', glyph => {
    const svg = glyphSvg(glyph);
    const fit = svg.firstElementChild;
    const scale = Number(fit?.getAttribute('transform')?.match(/scale\(([\d.]+)\)/)?.[1] ?? 1);

    // The drawing is fitted into the disc by one group, and nothing else sits beside it.
    expect(fit?.localName).toBe('g');
    expect(svg.children).toHaveLength(1);

    // A 1.25px icon line on the 28px disc is 1.43 of its 32 units.
    const line = Number(svg.getAttribute('stroke-width')) * scale;

    expect(line).toBeGreaterThanOrEqual(1.4);
    expect(line).toBeLessThanOrEqual(1.5);
    expect(svg.getAttribute('stroke-linecap')).toBe('round');
    expect(svg.getAttribute('stroke-linejoin')).toBe('round');
  });

  it.each(glyphs)('%s holds still at rest and moves only in its hover drawing', glyph => {
    const rest = glyphSvg(glyph, REST);
    const live = glyphSvg(glyph, LIVE);
    const motion = live.querySelector('style')?.textContent ?? '';

    expect(rest.querySelector('style, [class]')).toBeNull();
    expect(motion).toContain('@keyframes');
    expect(motion).toContain('infinite');
    expect(live.querySelectorAll('[class]').length).toBeGreaterThan(0);

    // Every moving part has a motion, and every motion a moving part.
    for (const part of live.querySelectorAll('[class]')) {
      expect(motion).toContain(`.${part.getAttribute('class')}{`);
    }
  });

  it.each(glyphs)('%s moves the same drawing it shows at rest', glyph => {
    const rest = glyphSvg(glyph, REST);
    const live = glyphSvg(glyph, LIVE);

    // The resting drawing holds each moving part in its starting pose.
    for (const posed of rest.querySelectorAll('[transform^="matrix("]')) {
      posed.removeAttribute('transform');
    }

    live.querySelector('style')?.remove();

    for (const part of live.querySelectorAll('[class]')) {
      part.removeAttribute('class');
    }

    expect(live.outerHTML).toBe(rest.outerHTML);
  });

  it('gives the planet a whole outline: the ring crosses it without a cut', () => {
    const planet = glyphSvg('planet');

    expect(planet.querySelector(`[stroke="${PAPER}"]`)).toBeNull();
    expect(planet.querySelectorAll('circle[fill="#fff"]')).toHaveLength(1);
  });

  it('keeps the rocket flame one solid shape', () => {
    const flames = glyphSvg('rocket', LIVE).querySelectorAll('.flame');

    expect(flames).toHaveLength(1);
    expect(flames[0].getAttribute('fill')).toBe(INK);
    expect(flames[0].getAttribute('stroke')).toBe('none');
    expect(flames[0].getAttribute('d')).toMatch(/z$/i);
  });

  it('moves the telescope as one piece, tube and tripod together', () => {
    const telescope = glyphSvg('telescope', LIVE);
    const movers = Array.from(telescope.querySelectorAll('[class]'), part => part.getAttribute('class'));

    expect(movers).toStrictEqual(['rock', 'tw']);
    // Tripod (a stroked path) and tube (rects) share the one rocking group.
    expect(telescope.querySelector('.rock > path')).not.toBeNull();
    expect(telescope.querySelector('.rock rect')).not.toBeNull();
  });
});

describe('anonymous presence face paint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('washes the face in a quarter of the peer colour over white', () => {
    expect(declarationsOf('[data-blok-presence-glyph]').get('background'))
      .toBe('color-mix(in oklab, var(--blok-presence-color) 24%, var(--blok-presence-paper, #fff))');
    // The drawings fill with this white, so the wash base must match it in every theme.
    expect(declarationsOf('[data-blok-interface]').get('--blok-presence-paper')).toBe('#fff');
  });

  it('lays the drawing over the whole face inside the ring', () => {
    const painter = declarationsOf('[data-blok-presence-glyph]::after');

    expect(painter.get('width')).toBe('100%');
    expect(painter.get('height')).toBe('100%');
    expect(painter.get('background')).toBe('var(--blok-presence-glyph) center / contain no-repeat');
  });

  it('paints the drawing as an image, never as a single-colour mask', () => {
    const masks: string[] = [];

    stylesheet.walkDecls(/mask/, declaration => {
      masks.push(declaration.prop);
    });

    expect(masks).toStrictEqual([]);
  });

  it('wakes the drawing under the pointer only where motion is welcome', () => {
    const wakers: string[] = [];

    stylesheet.walkDecls(declaration => {
      if (!declaration.value.includes('var(--blok-presence-glyph-live)')) {
        return;
      }

      const rule = declaration.parent;
      const media = rule?.parent;

      expect(declaration.prop).toBe('background-image');
      expect(rule instanceof Rule ? rule.selector : '').toBe('[data-blok-presence-glyph]:hover::after');
      expect(media instanceof AtRule ? `${media.name} ${media.params}` : '').toBe('media (prefers-reduced-motion: no-preference)');
      wakers.push(declaration.value);
    });

    expect(wakers).toHaveLength(1);
  });
});
