/**
 * Skin-tone segments: a surface-coloured rim around each tone, a pointer
 * cursor, and a hover that keeps the tone's own colours (the header's grey
 * button hover must not reach them).
 */
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

import { readMainCss } from './helpers/read-main-css';

const SEGMENT = '[data-blok-emoji-picker] [data-emoji-picker-skin-tone] button';

const declarations = (selector: string): Record<string, string> => {
  const found: Record<string, string> = {};

  postcss.parse(readMainCss()).walkRules(rule => {
    if (rule.selectors.includes(selector)) {
      rule.walkDecls(declaration => {
        found[declaration.prop] = declaration.value;
      });
    }
  });

  return found;
};

describe('emoji picker skin-tone segments', () => {
  it('rims each tone with the popover surface and paints the tone inset', () => {
    expect(declarations(SEGMENT)).toMatchObject({ background: 'var(--blok-popover-bg)' });
    expect(declarations(`${SEGMENT}::before`)).toMatchObject({
      background: 'var(--emoji-tone-color)',
      'clip-path': 'var(--emoji-tone-fill)',
    });
  });

  it('shows a pointer cursor', () => {
    expect(declarations(SEGMENT)).toMatchObject({ cursor: 'pointer' });
  });

  it('keeps the rim colour on hover and grows the tone with its segment', () => {
    const greyHovers: string[] = [];

    postcss.parse(readMainCss()).walkRules(rule => {
      rule.selectors
        .filter(selector => selector.includes('[data-emoji-picker-header] button') && selector.includes(':hover'))
        .filter(selector => !selector.includes(':not([data-emoji-picker-skin-tone] button)'))
        .forEach(selector => greyHovers.push(selector));
    });

    expect(greyHovers).toEqual([]);
    expect(declarations(`${SEGMENT}:hover`)).toMatchObject({ 'clip-path': 'var(--emoji-tone-shape-hover)' });
    expect(declarations(`${SEGMENT}:hover::before`)).toMatchObject({ 'clip-path': 'var(--emoji-tone-fill-hover)' });
  });

  it('grows the tone with the chosen segment', () => {
    expect(declarations(`${SEGMENT}[aria-pressed='true']::before`)).toMatchObject({ 'clip-path': 'var(--emoji-tone-fill-on)' });
  });
});
