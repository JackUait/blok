/**
 * Exact pins for the shared header class table.
 *
 * The Stryker run reported these lines as NoCoverage: nothing imported this
 * module, so the level lookup, its level-1 fallback and the toggleable-indent
 * branch were all unasserted. Both the tool render() and the view emitter read
 * this table, so a silent change here desynchronises editor and view output.
 *
 * No survivors.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HEADER_BASE_CLASSES,
  HEADER_LEVEL_CLASSES,
  HEADER_TOGGLEABLE_INDENT_CLASS,
  headerClasses,
} from '../../../src/shared/tool-classes/header';

describe('header tool classes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes the exact shared class table', () => {
    expect(HEADER_BASE_CLASSES).toStrictEqual([
      'pt-[var(--blok-block-padding-top,7px)]',
      'pb-[var(--blok-block-padding-bottom,7px)]',
      'px-[var(--blok-block-padding-inline,2px)]',
      'm-0',
      '[&_p]:p-0!',
      '[&_p]:m-0!',
      '[&_div]:p-0!',
      '[&_div]:m-0!',
    ]);
    expect(HEADER_LEVEL_CLASSES).toStrictEqual({
      1: ['text-3xl', 'font-semibold', 'mt-8', 'mb-px'],
      2: ['text-2xl', 'font-semibold', 'mt-[26px]', 'mb-px'],
      3: ['text-xl', 'font-semibold', 'mt-5', 'mb-px'],
      4: ['text-lg', 'font-semibold', 'mt-3', 'mb-px'],
      5: ['text-base', 'font-semibold', 'mt-3', 'mb-px'],
      6: ['text-sm', 'font-semibold', 'mt-3', 'mb-px'],
    });
    expect(HEADER_TOGGLEABLE_INDENT_CLASS).toBe('pl-8');
  });

  it('composes base classes with the requested level and no indent by default', () => {
    expect(headerClasses(1)).toStrictEqual([
      'pt-[var(--blok-block-padding-top,7px)]',
      'pb-[var(--blok-block-padding-bottom,7px)]',
      'px-[var(--blok-block-padding-inline,2px)]',
      'm-0',
      '[&_p]:p-0!',
      '[&_p]:m-0!',
      '[&_div]:p-0!',
      '[&_div]:m-0!',
      'text-3xl',
      'font-semibold',
      'mt-8',
      'mb-px',
    ]);
  });

  it('uses the classes of the level it was asked for', () => {
    expect(headerClasses(3)).toStrictEqual([
      'pt-[var(--blok-block-padding-top,7px)]',
      'pb-[var(--blok-block-padding-bottom,7px)]',
      'px-[var(--blok-block-padding-inline,2px)]',
      'm-0',
      '[&_p]:p-0!',
      '[&_p]:m-0!',
      '[&_div]:p-0!',
      '[&_div]:m-0!',
      'text-xl',
      'font-semibold',
      'mt-5',
      'mb-px',
    ]);
  });

  it('appends the disclosure-arrow indent only for a toggleable heading', () => {
    expect(headerClasses(2, true)).toStrictEqual([
      'pt-[var(--blok-block-padding-top,7px)]',
      'pb-[var(--blok-block-padding-bottom,7px)]',
      'px-[var(--blok-block-padding-inline,2px)]',
      'm-0',
      '[&_p]:p-0!',
      '[&_p]:m-0!',
      '[&_div]:p-0!',
      '[&_div]:m-0!',
      'text-2xl',
      'font-semibold',
      'mt-[26px]',
      'mb-px',
      'pl-8',
    ]);
    expect(headerClasses(2, false)).toStrictEqual(headerClasses(2));
  });

  it('falls back to level 1 for a level outside 1-6', () => {
    expect(headerClasses(9)).toStrictEqual(headerClasses(1));
    expect(headerClasses(0)).toStrictEqual(headerClasses(1));
  });
});
