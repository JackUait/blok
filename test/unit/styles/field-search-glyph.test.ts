import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IconSearch } from '../../../src/components/icons';

const css = readFileSync(resolve(__dirname, '../../../src/styles/field.css'), 'utf8');

const parse = (source: string): SVGSVGElement => {
  const svg = new DOMParser().parseFromString(source, 'image/svg+xml').querySelector('svg');

  if (svg === null) {
    throw new Error('Missing SVG');
  }

  return svg;
};

const shapeOf = (svg: SVGSVGElement): string[] => [
  ...Array.from(svg.querySelectorAll('circle'), circle => `circle ${circle.getAttribute('cx')} ${circle.getAttribute('cy')} ${circle.getAttribute('r')}`),
  ...Array.from(svg.querySelectorAll('path'), path => `path ${path.getAttribute('d')}`),
];

describe('search field glyph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The field draws its glass as a CSS mask, so it is a copy of IconSearch.
  it('draws the same lens and handle as IconSearch', () => {
    const payload = css.match(/--_blok-search-glyph: url\("data:image\/svg\+xml,([^"]+)"\)/)?.[1];

    if (payload === undefined) {
      throw new Error('Missing search glyph');
    }

    expect(shapeOf(parse(decodeURIComponent(payload)))).toStrictEqual(shapeOf(parse(IconSearch)));
  });
});
