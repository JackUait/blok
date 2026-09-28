/**
 * The media preview's shadows behave like light: they fall away from the
 * pointer, and they fade as the drawing lifts off the floor.
 */
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

import { readMainCss } from './helpers/read-main-css';

const root = postcss.parse(readMainCss());

const declsFor = (match: (selector: string) => boolean, prop: string): string[] => {
  const values: string[] = [];
  root.walkRules((rule) => {
    if (!match(rule.selector)) return;
    rule.walkDecls(prop, (decl) => {
      values.push(decl.value);
    });
  });
  return values;
};

const contactOpacity = (match: (selector: string) => boolean): number =>
  Number(declsFor((s) => s.includes('blok-media-preview__contact') && match(s), 'opacity')[0]);

describe('media preview shadows (CSS)', () => {
  it('moves the cast shadow away from the side the pointer leans to', () => {
    const transforms = declsFor((s) => s.includes('.blok-media-preview__cast'), 'transform').join(' ');

    expect(transforms).toMatch(/var\(--tilt-x\)\s*\*\s*-/);
  });

  it('fades the contact shadow as the drawing lifts, and more while a file hovers it', () => {
    const resting = contactOpacity((s) => !s.includes('data-hover') && !s.includes('is-dragover'));
    const lifted = contactOpacity((s) => s.includes('data-hover'));
    const dragged = contactOpacity((s) => s.includes('is-dragover'));

    expect(lifted).toBeLessThan(resting);
    expect(dragged).toBeLessThan(lifted);
  });

  it('writes the file preview lines in, one after another, as the upload advances', () => {
    const transforms = declsFor((s) => s.includes('data-uploading') && s.includes('blok-media-preview__line--write'), 'transform').join(' ');

    expect(transforms).toMatch(/var\(--p\)/);
    expect(transforms).toMatch(/var\(--row\)/);
  });

  it('colors every shadow with the themeable shadow token', () => {
    expect(declsFor((s) => s.includes('blok-media-preview'), 'flood-color')).toContain('var(--blok-media-preview-shadow)');
  });
});
