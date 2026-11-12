/**
 * The media empty state is one surface: a drawing, a title, a sentence and two
 * actions, with the link field taking the actions' place.
 */
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

import { readMainCss } from './helpers/read-main-css';

const root = postcss.parse(readMainCss());

const decl = (selector: string, prop: string): string | undefined => {
  const values: string[] = [];
  root.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' || !rule.selector.split(',').map((part) => part.trim()).includes(selector)) return;
    rule.walkDecls(prop, (d) => {
      values.push(d.value.replace(/\s+/g, ' '));
    });
  });
  return values.at(-1);
};
const selectors = (): string[] => {
  const all: string[] = [];
  root.walkRules((rule) => {
    all.push(rule.selector);
  });
  return all;
};
const inAtRule = (name: string, params: RegExp, selector: string, prop: string): string | undefined => {
  const values: string[] = [];
  root.walkAtRules(name, (at) => {
    if (!params.test(at.params)) return;
    at.walkRules((rule) => {
      const matches = rule.selector.split(',').map((s) => s.trim()).includes(selector);

      rule.walkDecls(prop, (d) => {
        values.push(...(matches ? [d.value] : []));
      });
    });
  });
  return values.at(-1);
};

const CARD = '.blok-media-empty__card';
const SUBMIT = '.blok-media-empty__embed-submit';
const VALID_SUBMIT = '.blok-media-empty__embed-bar[data-valid="true"] .blok-media-empty__embed-submit';

describe('media empty state: one surface (CSS)', () => {
  it('is one soft surface with no visible border at rest', () => {
    expect(decl(CARD, 'background')).toBe('var(--blok-bg-secondary)');
    expect(decl(CARD, 'border')).toBe('1px solid transparent');
    expect(decl(CARD, 'border-radius')).toBe('var(--blok-radius-block)');
    expect(decl(CARD, 'display')).toBe('flex');
    // image, video and audio centre their own text; the surface must not inherit that
    expect(decl(CARD, 'text-align')).toBe('start');
    expect(decl(CARD, 'gap')).toBe('var(--blok-space-6)');
    expect(decl(CARD, 'padding')).toBe('var(--blok-space-5) var(--blok-space-6)');
  });

  it('has no rules left for tabs, the header, the inner panel or the drop overlay', () => {
    const gone = selectors().filter((s) => /blok-media-empty__(tabs?|header|label|panel|tile|content|primary|drop-|embed-(site|logo|host|type))\b|data-active-tab|embed-bar--large/.test(s));

    expect(gone).toEqual([]);
  });

  it('shows the border on hover and turns accent with a 6% tint while a file is dragged over it', () => {
    expect(decl(`${CARD}:hover`, 'border-color')).toBe('var(--blok-border-primary)');
    expect(decl(`${CARD}.is-dragover`, 'border-color')).toBe('var(--blok-color-accent)');
    expect(decl(`${CARD}.is-dragover`, 'background')).toBe('color-mix(in srgb, var(--blok-color-accent) 6%, var(--blok-bg-secondary))');
    expect(decl(`${CARD}.is-dragover .blok-media-empty__title`, 'color')).toBe('var(--blok-color-accent)');
  });

  it('sets the title and the sentence as in the design', () => {
    expect(decl('.blok-media-empty__title', 'font-size')).toBe('16px');
    expect(decl('.blok-media-empty__title', 'font-weight')).toBe('650');
    expect(decl('.blok-media-empty__title', 'letter-spacing')).toBe('-0.01em');
    expect(decl('.blok-media-empty__title', 'color')).toBe('var(--blok-text-primary)');
    expect(decl('.blok-media-empty__hint', 'font-size')).toBe('13.5px');
    expect(decl('.blok-media-empty__hint', 'color')).toBe('var(--blok-text-secondary)');
  });

  it('keeps the size limit on one line, in tertiary ink, with a capital first letter', () => {
    expect(decl('.blok-media-empty__meta', 'white-space')).toBe('nowrap');
    expect(decl('.blok-media-empty__meta', 'color')).toBe('var(--blok-text-tertiary)');
    expect(decl('.blok-media-empty__meta::first-letter', 'text-transform')).toBe('uppercase');
  });

  it('draws the drawing 168px wide in the row and 150px when narrow', () => {
    expect(decl(`${CARD} > .blok-media-preview svg`, 'width')).toBe('168px');
    expect(inAtRule('container', /max-width:\s*470px/, `${CARD} > .blok-media-preview svg`, 'width')).toBe('150px');
  });

  it('stacks and centres a surface with a drawing below 470px', () => {
    expect(inAtRule('container', /max-width:\s*470px/, `${CARD}[data-preview]`, 'flex-direction')).toBe('column');
    expect(inAtRule('container', /max-width:\s*470px/, `${CARD}[data-preview]`, 'text-align')).toBe('center');
    expect(decl('.blok-media-empty', 'container-type')).toBe('inline-size');
  });

  it('gives "From a link" a white fill with a hairline, not ink', () => {
    expect(decl('.blok-media-empty__from-link', 'background')).toBe('var(--blok-bg-primary)');
    expect(decl('.blok-media-empty__from-link', 'box-shadow')).toBe('inset 0 0 0 1px var(--blok-border-primary)');
    expect(decl('.blok-media-empty__from-link', 'color')).toBe('var(--blok-text-primary)');
    expect(decl('.blok-media-empty__choose', 'background')).toBe('var(--blok-text-primary)');
  });
});

describe('media empty state: buttons and link field share one cell (CSS)', () => {
  it('stacks both in one grid cell so the surface never changes height', () => {
    expect(decl('.blok-media-empty__slot', 'display')).toBe('grid');
    expect(decl('.blok-media-empty__slot', 'min-height')).toBe('var(--blok-space-10)');
    expect(decl('.blok-media-empty__slot > *', 'grid-area')).toBe('1 / 1');
  });

  it('hides the inert one, with a short rise', () => {
    expect(decl('.blok-media-empty__slot > [inert]', 'opacity')).toBe('0');
    expect(decl('.blok-media-empty__slot > [inert]', 'visibility')).toBe('hidden');
    expect(decl('.blok-media-empty__slot > [inert]', 'transform')).toBe('translateY(var(--blok-space-1))');
  });

  it('switches instantly under reduced motion', () => {
    expect(inAtRule('media', /reduce/, '.blok-media-empty__slot > *', 'transition')).toBe('none');
    expect(inAtRule('media', /reduce/, SUBMIT, 'transition')).toBe('none');
  });
});

describe('media empty state: link field (CSS)', () => {
  const BAR = '[data-blok-field].blok-media-empty__embed-bar';

  it('is 40px tall and at most 440px wide, and keeps the shared field look', () => {
    expect(decl(BAR, 'min-height')).toBe('var(--blok-space-10)');
    expect(decl(BAR, 'max-width')).toBe('440px');
    expect(decl(BAR, 'background')).toBeUndefined();
    expect(decl(BAR, 'border')).toBeUndefined();
  });

  it('does not draw Add at all until the link is valid', () => {
    expect(decl(SUBMIT, 'max-width')).toBe('0');
    expect(decl(SUBMIT, 'opacity')).toBe('0');
    expect(decl(SUBMIT, 'padding')).toBe('0');
    expect(decl(VALID_SUBMIT, 'opacity')).toBe('1');
    expect(decl(VALID_SUBMIT, 'max-width')).toBe('180px');
  });

  it('draws Add as plain text: no ink fill, no sweep, no shine', () => {
    expect(decl(SUBMIT, 'background')).toBe('transparent');
    expect(decl(SUBMIT, 'color')).toBe('var(--blok-text-primary)');
    expect(decl(`${VALID_SUBMIT}:hover`, 'background')).toBe('var(--blok-bg-hover)');
    expect(selectors().filter((s) => /embed-submit::(before|after)/.test(s))).toEqual([]);
  });

  it('keeps the chain icon and turns it to primary ink, not accent, when the link is valid', () => {
    expect(decl('.blok-media-empty__embed-bar[data-valid="true"] .blok-media-empty__embed-icon', 'color')).toBe('var(--blok-text-primary)');
  });

  it('gives the cross a 28px hit area', () => {
    expect(decl('.blok-media-empty__embed-cancel', 'width')).toBe('28px');
    expect(decl('.blok-media-empty__embed-cancel', 'height')).toBe('28px');
  });

  it('draws the mirror and the input at the same size, so the caret stays on its glyph', () => {
    expect(decl('.blok-media-empty__embed-mirror', 'font-size')).toBe('14px');
    expect(decl('.blok-media-empty__embed-bar .blok-media-empty__embed-input', 'font-size')).toBe('14px');
    expect(decl('.blok-media-empty__embed-mirror', 'line-height')).toBe(decl('.blok-media-empty__embed-bar .blok-media-empty__embed-input', 'line-height'));
  });
});

describe('cover picker: the popover is the surface (CSS)', () => {
  it('gives the card inside no fill of its own and smaller type', () => {
    expect(decl('.blok-audio-cover-picker .blok-media-empty__card', 'background')).toBe('transparent');
    expect(decl('.blok-audio-cover-picker .blok-media-empty__title', 'font-size')).toBe('14px');
    expect(decl('.blok-audio-cover-picker .blok-media-empty__hint', 'font-size')).toBe('13px');
  });

  it('beside the ink well the card is bare, in the block\'s type sizes, and its buttons never wrap', () => {
    const card = '.blok-audio-cover-picker .blok-ink-well .blok-media-empty__card';

    expect(decl(card, 'padding')).toBe('0');
    expect(decl(card, 'background')).toBe('transparent');
    expect(decl('.blok-audio-cover-picker .blok-ink-well .blok-media-empty__title', 'font-size')).toBe('16px');
    expect(decl('.blok-audio-cover-picker .blok-ink-well .blok-media-empty__hint', 'font-size')).toBe('13.5px');
    expect(decl('.blok-audio-cover-picker .blok-ink-well .blok-media-empty__actions', 'flex-wrap')).toBe('nowrap');
    // The picker takes its width from the buttons; a size container would report none.
    expect(decl('.blok-ink-well > .blok-media-empty', 'container-type')).toBe('normal');
    expect(decl('.blok-audio-cover-picker[data-surface="ink-well"]', 'width')).toBe('max-content');
  });
});
