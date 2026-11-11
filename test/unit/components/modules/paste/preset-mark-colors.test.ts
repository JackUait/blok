/**
 * Blok's copy writes preset mark colours as literals (other apps cannot read
 * its tokens). A paste must turn them back into tokens, or the mark keeps
 * its light colour in dark mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { preprocessPastedHtml } from '../../../../../src/components/modules/paste/preprocess-pasted-html';
import { clean } from '../../../../../src/components/utils/sanitizer';
import { markerSanitize } from '../../../../../src/shared/tool-descriptions/sanitize/inline';

/** The mark's style as `prop: value` pairs; jsdom prints colours as rgb(). */
const pasteMark = (style: string): string => {
  const html = clean(preprocessPastedHtml(`<p>a <mark style="${style}">m</mark> b</p>`), { p: {}, ...markerSanitize() });
  const mark = new DOMParser().parseFromString(html, 'text/html').querySelector('mark');

  if (mark === null) {
    return 'no mark';
  }

  return Array.from(mark.style).map(prop => `${prop}: ${mark.style.getPropertyValue(prop)};`).join(' ');
};

describe('pasted preset mark colours', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['light text preset as hex', 'color: #d44c47', 'color: var(--blok-color-red-text); background-color: transparent;'],
    ['light text preset as rgb()', 'color: rgb(212, 76, 71); background-color: transparent', 'color: var(--blok-color-red-text); background-color: transparent;'],
    ['light bg preset as hex', 'background-color: #fbf3db', 'background-color: var(--blok-color-yellow-bg);'],
    ['light bg preset as rgb()', 'background-color: rgb(251, 243, 219)', 'background-color: var(--blok-color-yellow-bg);'],
    ['dark text preset', 'color: #dd5e5a', 'color: var(--blok-color-red-text); background-color: transparent;'],
    ['dark bg preset', 'background-color: rgb(84, 64, 18)', 'background-color: var(--blok-color-yellow-bg);'],
    ['text and bg presets', 'color: #337ea9; background-color: #edf3ec', 'color: var(--blok-color-blue-text); background-color: var(--blok-color-green-bg);'],
    ['inherited text colour on a bg mark', 'color: inherit; background-color: rgb(251, 243, 219)', 'background-color: var(--blok-color-yellow-bg);'],
    ['currentcolor text with transparent filler', 'color: currentcolor; background-color: transparent', ''],
  ])('%s', (_name, input, expected) => {
    expect(pasteMark(input)).toBe(expected);
  });

  it.each([
    ['a non-preset text colour', 'color: #c80a0a', 'color: rgb(200, 10, 10); background-color: transparent;'],
    ['a near-preset bg colour', 'background-color: #fbf3dc', 'background-color: rgb(251, 243, 220);'],
    ['a text preset used as a bg', 'background-color: #d44c47', 'background-color: rgb(212, 76, 71);'],
  ])('keeps %s literal', (_name, input, expected) => {
    expect(pasteMark(input)).toBe(expected);
  });

  it('leaves tokens as they are', () => {
    expect(pasteMark('color: var(--blok-color-red-text); background-color: transparent')).toBe('color: var(--blok-color-red-text); background-color: transparent;');
  });
});
