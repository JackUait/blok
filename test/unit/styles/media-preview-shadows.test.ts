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

describe('media Link-tab button (CSS)', () => {
  const decl = (match: (s: string) => boolean, prop: string): string =>
    declsFor(match, prop).join(' ');
  const isSubmit = (s: string): boolean => s.includes('blok-media-empty__embed-submit');

  it('fills the large field exactly, without making it taller than 48px', () => {
    expect(decl((s) => s.includes('embed-bar--large') && s.endsWith('.blok-media-empty__embed-submit'), 'height')).toBe('34px');
  });

  it('waits as a crisp button that already shows the Enter key, never a faded ghost', () => {
    const idleOpacity = declsFor((s) => isSubmit(s) && !s.includes('data-valid') && !s.includes('::'), 'opacity');

    expect(idleOpacity.filter((v) => Number(v) < 1)).toEqual([]);
    expect(decl((s) => s === '.blok-media-empty__embed-kbd', 'max-width')).not.toBe('0');
  });

  it('sweeps dark ink in from the left once the link is valid, and drains it out to the right', () => {
    expect(decl((s) => s === '.blok-media-empty__embed-submit::before', 'background')).toContain('var(--blok-text-primary)');
    expect(decl((s) => s === '.blok-media-empty__embed-submit::before', 'transform')).toBe('scaleX(0)');
    expect(decl((s) => s === '.blok-media-empty__embed-submit::before', 'transform-origin')).toContain('right');
    expect(decl((s) => s.includes('data-valid="true"') && s.endsWith('.blok-media-empty__embed-submit::before'), 'transform')).toBe('scaleX(1)');
    expect(decl((s) => s.includes('data-valid="true"') && s.endsWith('.blok-media-empty__embed-submit::before'), 'transform-origin')).toContain('left');
  });

  it('glides one shine across the button after the ink lands', () => {
    expect(decl((s) => s.includes('data-valid="true"') && s.endsWith('.blok-media-empty__embed-submit::after'), 'animation')).toContain('blok-media-empty-shine');
  });

  it('switches instantly under reduced motion', () => {
    const reduced: string[] = [];
    root.walkAtRules('media', (rule) => {
      if (!rule.params.includes('reduce')) return;
      rule.walkRules((r) => {
        if (r.selector.includes('embed-submit')) reduced.push(r.toString());
      });
    });

    expect(reduced.join(' ')).toMatch(/::before[\s\S]*transition: none|transition: none[\s\S]*::before/);
    expect(reduced.join(' ')).toContain('::after');
  });
});
