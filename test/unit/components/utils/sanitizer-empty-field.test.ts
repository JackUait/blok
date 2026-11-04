import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as cleaner from '../../../../src/components/utils/html-cleaner';
import { sanitizeBlocks } from '../../../../src/components/utils/sanitizer';

describe('sanitizeBlocks with an empty field', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps an empty string without running the cleaner over the tool\'s rules', () => {
    const run = vi.spyOn(cleaner, 'cleanHtml');

    const [block] = sanitizeBlocks([{ tool: 'paragraph', data: { text: '' } }], { text: { b: true, a: { href: true } } });

    expect(block.data).toEqual({ text: '' });
    expect(run).not.toHaveBeenCalled();
  });

  it('still cleans a non-empty field', () => {
    const [block] = sanitizeBlocks([{ tool: 'paragraph', data: { text: '<i>x</i><b>y</b>' } }], { text: { b: true } });

    expect(block.data).toEqual({ text: 'x<b>y</b>' });
  });
});
