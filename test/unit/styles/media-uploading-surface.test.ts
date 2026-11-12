/**
 * While a file uploads, the block keeps the empty state's surface: the drawing
 * on the left, then a title, the file name with the percent, and a thin bar.
 */
import { describe, expect, it } from 'vitest';
import postcss from 'postcss';

import { readMainCss } from './helpers/read-main-css';

const root = postcss.parse(readMainCss());

const decl = (selector: string, prop: string): string | undefined => {
  const values: string[] = [];
  root.walkRules((rule) => {
    const matches = rule.parent?.type !== 'atrule' && rule.selector.split(',').map((part) => part.trim()).includes(selector);

    rule.walkDecls(prop, (d) => {
      values.push(...(matches ? [d.value.replace(/\s+/g, ' ')] : []));
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
const inContainer = (selector: string, prop: string): string | undefined => {
  const values: string[] = [];
  root.walkAtRules('container', (at) => {
    at.walkRules((rule) => {
      const matches = /max-width:\s*470px/.test(at.params) && rule.selector.split(',').map((part) => part.trim()).includes(selector);

      rule.walkDecls(prop, (d) => {
        values.push(...(matches ? [d.value] : []));
      });
    });
  });
  return values.at(-1);
};

const U = '.blok-image-uploading';

describe('media uploading state: the same surface as the empty state (CSS)', () => {
  it('is one soft surface with the empty state\'s fill, radius and padding', () => {
    expect(decl(`${U}__card`, 'background')).toBe('var(--blok-bg-secondary)');
    expect(decl(`${U}__card`, 'border')).toBe('1px solid transparent');
    expect(decl(`${U}__card`, 'border-radius')).toBe('var(--blok-radius-block)');
    expect(decl(`${U}__card`, 'padding')).toBe('var(--blok-space-5) var(--blok-space-6)');
    expect(decl(`${U}__card`, 'display')).toBe('grid');
  });

  it('lets the header, the panel and the content dissolve into the surface\'s grid', () => {
    for (const part of ['header', 'panel', 'content']) {
      expect(decl(`${U}__${part}`, 'display'), part).toBe('contents');
    }
    expect(decl(`${U}__panel`, 'border-top')).toBeUndefined();
  });

  it('sets the status as the title and the file line like the sentence', () => {
    expect(decl(`${U}__label`, 'font-size')).toBe('16px');
    expect(decl(`${U}__label`, 'font-weight')).toBe('650');
    expect(decl(`${U}__label`, 'color')).toBe('var(--blok-text-primary)');
    expect(decl(`${U}__filename`, 'font-size')).toBe('13.5px');
    expect(decl(`${U}__filename`, 'color')).toBe('var(--blok-text-secondary)');
    expect(decl(`${U}__sub`, 'font-size')).toBe('13.5px');
    expect(decl(`${U}__sub`, 'text-transform')).toBeUndefined();
  });

  it('keeps a long file name on one line with an ellipsis', () => {
    expect(decl(`${U}__filename`, 'white-space')).toBe('nowrap');
    expect(decl(`${U}__filename`, 'text-overflow')).toBe('ellipsis');
    expect(decl(`${U}__filename`, 'min-width')).toBe('0');
  });

  it('joins the file name and the percent with a dot, but not when there is no name', () => {
    expect(decl(`${U}__sub::before`, 'content')).toBe('\'·\'');
    expect(decl(`${U}__card:has(${U}__header--status-only) ${U}__sub::before`, 'content')).toBe('none');
  });

  it('drops the dot before an empty size', () => {
    expect(decl(`${U}__sep:has(+ ${U}__size:empty)`, 'display')).toBe('none');
  });

  it('shows a thin ink bar, also when the drawing is there', () => {
    expect(decl(`${U}__bar`, 'height')).toBe('2px');
    expect(decl(`${U}__bar`, 'background')).toBe('var(--blok-border-primary)');
    expect(decl(`${U}__bar-fill`, 'background')).toBe('var(--blok-text-primary)');
    expect(selectors().filter((s) => s.includes('[data-preview]') && s.includes(`${U}__bar`))).toEqual([]);
    expect(selectors().filter((s) => s.includes(`${U}__bar-fill::after`))).toEqual([]);
  });

  it('draws the drawing at the empty state\'s size', () => {
    expect(decl(`${U}__card .blok-media-preview svg`, 'width')).toBe('168px');
    expect(inContainer(`${U}__card .blok-media-preview svg`, 'width')).toBe('150px');
  });

  it('stacks and centres below 470px', () => {
    expect(decl(U, 'container-type')).toBe('inline-size');
    expect(inContainer(`${U}__card`, 'text-align')).toBe('center');
    expect(inContainer(`${U}__label`, 'grid-column')).toBe('1 / -1');
  });

  it('has no styles left for the file block\'s old uploading row', () => {
    expect(selectors().filter((s) => /blok-file-(uploading|bar|cancel)/.test(s))).toEqual([]);
  });
});
