import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as oldBlockColor from '../../../src/components/shared/block-color';
import * as oldInline from '../../../src/components/shared/inline-content-sanitize';
import { clean } from '../../../src/components/utils/sanitizer';
import { BLOCK_COLOR_SANITIZE } from '../../../src/shared/block-color-sanitize';
import {
  INLINE_TEXT_SANITIZE,
  preserveColorStyles,
  preserveEquationSpan,
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

  it('keeps color and drops other styles on mark in the headless sanitizer', () => {
    const result = sanitizeHtmlFragment(MARK, INLINE_TEXT_SANITIZE);

    expect(result).toBe('<mark style="color: red;">hot</mark>');
  });
});
