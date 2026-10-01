import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { renderImagePreview } from '../../../../src/tools/image/preview';

const css = readFileSync(resolve(__dirname, '../../../../src/styles/block-preview/media.css'), 'utf8');

const partsOf = (root: HTMLElement): string[] =>
  [...new Set([...root.querySelectorAll('svg [data-part]')].map((el) => el.getAttribute('data-part') ?? ''))];

describe('image toolbox preview', () => {
  it('draws Lake Bled: the castle on its cliff, the island church and a boat', () => {
    const parts = partsOf(renderImagePreview());

    expect(parts).toEqual(expect.arrayContaining([
      'castle',
      'cliff',
      'island',
      'church',
      'boat',
      'pine',
      'snow',
      'bird',
      'star',
      'cloud',
      'ripple',
      'island-reflection',
    ]));
  });

  // An SVG shape with no rule paints solid black in both themes.
  it('gives every drawn part a fill or stroke rule', () => {
    partsOf(renderImagePreview()).forEach((part) => {
      expect(css, part).toContain(`[data-blok-preview='image'] [data-part='${part}']`);
    });
  });
});
