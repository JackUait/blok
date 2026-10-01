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
      'ray',
      'range-light',
      'range-reflection',
      'forest',
      'house',
      'flag',
      'crag',
      'pier',
      'rower',
      'flower',
      'rock',
      'lamp',
      'wing-left',
      'wing-right',
      'canopy',
      'canopy-stripe',
      'boat-reflection',
      'swan',
      'swan-neck',
      'swan-wing',
      'passenger',
      'pier-deck',
      'pier-plank',
      'cattail',
      'stair',
      'smoke',
      'window-reflection',
      'tuft',
      'bush',
      'bench',
      'deer',
      'firefly',
      'footpath',
      'sparkle',
    ]));
  });

  // Riders share the boat's motion, so they can never drift out of it.
  it('keeps the rower and passengers inside the boat, and the swan in one piece', () => {
    const preview = renderImagePreview();

    expect(preview.querySelector("[data-part='boat'] [data-part='rower']")).not.toBeNull();
    expect(preview.querySelector("[data-part='boat'] [data-part='passenger']")).not.toBeNull();
    expect(preview.querySelector("[data-part='swan'] [data-part='swan-neck']")).not.toBeNull();
  });

  // An SVG shape with no rule paints solid black in both themes.
  it('gives every drawn part a fill or stroke rule', () => {
    partsOf(renderImagePreview()).forEach((part) => {
      expect(css, part).toContain(`[data-blok-preview='image'] [data-part='${part}']`);
    });
  });
});

describe('image toolbox preview motion', () => {
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));

  it.each([ 'star', 'cloud', 'bird', 'ray', 'shimmer', 'ripple', 'boat', 'flag', 'lamp', 'wing-left', 'wing-right', 'swan', 'smoke', 'firefly', 'sparkle' ])(
    'animates the %s only when motion is allowed',
    (part) => {
      const rule = new RegExp(`\\[data-blok-preview='image'\\] \\[data-part='${part}'\\][^{]*\\{[^}]*animation:`);

      expect(motion).toMatch(rule);
      expect(css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'))).not.toMatch(rule);
    }
  );
});
