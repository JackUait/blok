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

  it('keeps text with no markup without running the cleaner (a table holds one block id per cell)', () => {
    const run = vi.spyOn(cleaner, 'cleanHtml');

    const [block] = sanitizeBlocks(
      [{ tool: 'table', data: { content: [[{ blocks: ['b1'] }, { blocks: ['b2'] }]], caption: 'plain words' } }],
      { content: { b: true }, caption: { b: true } }
    );

    expect(block.data).toEqual({ content: [[{ blocks: ['b1'] }, { blocks: ['b2'] }]], caption: 'plain words' });
    expect(run).not.toHaveBeenCalled();
  });

  it('still cleans text whose only markup is an entity', () => {
    const [block] = sanitizeBlocks([{ tool: 'paragraph', data: { text: 'Tom &amp Jerry' } }], { text: { b: true } });

    expect(block.data).toEqual({ text: 'Tom &amp; Jerry' });
  });

  it('still cleans a non-empty field', () => {
    const [block] = sanitizeBlocks([{ tool: 'paragraph', data: { text: '<i>x</i><b>y</b>' } }], { text: { b: true } });

    expect(block.data).toEqual({ text: 'x<b>y</b>' });
  });
});
