import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as oldBlockColor from '../../../src/components/shared/block-color';
import * as oldInline from '../../../src/components/shared/inline-content-sanitize';
import { clean } from '../../../src/components/utils/sanitizer';
import { BLOCK_COLOR_SANITIZE } from '../../../src/shared/block-color-sanitize';
import {
  INLINE_TEXT_SANITIZE,
  preserveColorStyles,
  preserveEquationSpan,
  preserveDateMention,
} from '../../../src/shared/inline-text-sanitize';
import { sanitizeHtmlFragment } from '../../../src/view/sanitize';

const MARK = '<mark style="color: red; font-size: 40px">hot</mark>';

describe('shared inline sanitize rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('old import paths resolve to the same bindings', () => {
    expect(oldInline.INLINE_TEXT_SANITIZE).toBe(INLINE_TEXT_SANITIZE);
    expect(oldInline.preserveColorStyles).toBe(preserveColorStyles);
    expect(oldInline.preserveEquationSpan).toBe(preserveEquationSpan);
    expect(oldBlockColor.BLOCK_COLOR_SANITIZE).toBe(BLOCK_COLOR_SANITIZE);
  });

  it('keeps color and drops other styles on mark in the editor sanitizer', () => {
    const result = clean(MARK, INLINE_TEXT_SANITIZE);

    expect(result).toBe('<mark style="color: red;">hot</mark>');
  });

  it('drops the style of a mark inside MathML, which has no style object', () => {
    const result = clean('<br><math><mark style="color:red">x</mark></math>', INLINE_TEXT_SANITIZE);

    expect(result).not.toContain('style');
    expect(result).toContain('x');
  });

  it('keeps color and drops other styles on mark in the headless sanitizer', () => {
    const result = sanitizeHtmlFragment(MARK, INLINE_TEXT_SANITIZE);

    expect(result).toBe('<mark style="color: red;">hot</mark>');
  });

  it('keeps fixed date mentions across editor and headless sanitizers', () => {
    const input = '<time datetime="2026-11-08" data-blok-date-mention="" onclick="bad()">8 nov. 2026</time>';
    const expected = '<time datetime="2026-11-08" data-blok-date-mention="">8 nov. 2026</time>';

    expect(clean(input, INLINE_TEXT_SANITIZE)).toBe(expected);
    expect(sanitizeHtmlFragment(input, INLINE_TEXT_SANITIZE)).toBe(expected);
    expect(preserveDateMention(document.createElement('time'))).toBe(false);
  });

  it('rejects invalid date mention metadata', () => {
    const input = '<time datetime="2026-02-30" data-blok-date-mention="">invalid</time>';

    expect(clean(input, INLINE_TEXT_SANITIZE)).toBe('invalid');
    expect(sanitizeHtmlFragment(input, INLINE_TEXT_SANITIZE)).toBe('invalid');
  });
});
