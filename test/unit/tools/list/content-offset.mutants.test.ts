import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getContentOffset,
  getInlineStartMarginFromElement,
  getOffsetFromDepthAttribute,
} from '../../../../src/tools/list/content-offset';
import { INDENT_PER_LEVEL } from '../../../../src/tools/list/constants';

/**
 * Mutation-coverage tests for `src/tools/list/content-offset.ts`.
 *
 * Equivalence proof for the mutant left alive:
 *
 * - L47 `depthAttr === null` replaced by `false`, and its block replaced by
 *   `{}` (which drops the `return undefined`). The branch is unreachable:
 *   `wrapper` is whatever `closest('[data-list-depth]')` returned, and that
 *   selector matches only elements that carry the attribute, so the very next
 *   `getAttribute('data-list-depth')` cannot answer null. Nothing runs between
 *   the two calls that could remove it. Even if the guard is skipped, an absent
 *   attribute would give `parseInt(null, 10)` = NaN and `NaN > 0` is false -
 *   the same `undefined` the branch returns.
 */

const withStyle = (style: string): HTMLElement => {
  const element = document.createElement('div');

  element.setAttribute('style', style);

  return element;
};

const withDepth = (depth: string): HTMLElement => {
  const wrapper = document.createElement('div');

  wrapper.setAttribute('data-list-depth', depth);

  return wrapper;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getInlineStartMarginFromElement mutants', () => {
  it('returns undefined for an element with no style attribute', () => {
    expect(getInlineStartMarginFromElement(document.createElement('div'))).toBeUndefined();
  });

  it('returns undefined for a style that carries other declarations only', () => {
    expect(getInlineStartMarginFromElement(withStyle('color: red; padding: 10px'))).toBeUndefined();
  });

  it('reads a positive inline-start margin', () => {
    expect(getInlineStartMarginFromElement(withStyle('margin-inline-start: 24px'))).toEqual({ left: 24 });
  });

  it('treats a zero inline-start margin as no offset', () => {
    expect(getInlineStartMarginFromElement(withStyle('margin-inline-start: 0px'))).toBeUndefined();
  });
});

describe('getOffsetFromDepthAttribute mutants', () => {
  it('returns undefined when no ancestor carries a depth', () => {
    expect(getOffsetFromDepthAttribute(document.createElement('div'))).toBeUndefined();
  });

  it('scales the depth by the per-level indent', () => {
    const wrapper = withDepth('2');
    const item = document.createElement('div');

    wrapper.appendChild(item);

    expect(getOffsetFromDepthAttribute(item)).toEqual({ left: 2 * INDENT_PER_LEVEL });
  });

  it('returns undefined at depth zero', () => {
    expect(getOffsetFromDepthAttribute(withDepth('0'))).toBeUndefined();
  });

  it('returns undefined for a depth attribute with no number in it', () => {
    expect(getOffsetFromDepthAttribute(withDepth(''))).toBeUndefined();
    expect(getOffsetFromDepthAttribute(withDepth('deep'))).toBeUndefined();
  });
});

describe('getContentOffset mutants', () => {
  it('prefers the margin of the list item the hover is inside', () => {
    const wrapper = withDepth('3');
    const item = withStyle('margin-inline-start: 48px');

    item.setAttribute('role', 'listitem');
    wrapper.appendChild(item);

    expect(getContentOffset(item)).toEqual({ left: 48 });
  });

  it('finds a list item below the hovered wrapper', () => {
    const wrapper = document.createElement('div');
    const item = withStyle('margin-inline-start: 16px');

    item.setAttribute('role', 'listitem');
    wrapper.appendChild(item);

    expect(getContentOffset(wrapper)).toEqual({ left: 16 });
  });

  it('falls back to the wrapper depth when the list item has no margin', () => {
    const wrapper = withDepth('2');
    const item = document.createElement('div');

    item.setAttribute('role', 'listitem');
    wrapper.appendChild(item);

    expect(getContentOffset(item)).toEqual({ left: 2 * INDENT_PER_LEVEL });
  });
});
