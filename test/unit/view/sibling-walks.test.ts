// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyInlineRenderers } from '../../../src/view/inline-renderers';
import { sanitizeHtmlFragment } from '../../../src/view/sanitize';

/**
 * The sanitizer and the inline renderers walk a node's children one sibling
 * at a time. A walk that recursed per sibling overflowed the stack on about
 * 156 sibling tags: a 2 KB field could not be sanitized at all.
 */
const SIBLINGS = 5000;

describe('sibling walks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('unwraps thousands of disallowed sibling tags', () => {
    expect(sanitizeHtmlFragment('<span>x</span>'.repeat(SIBLINGS), { b: true })).toBe('x'.repeat(SIBLINGS));
  });

  it('merges thousands of identical sibling tags into one', () => {
    expect(sanitizeHtmlFragment('<b>x</b>'.repeat(SIBLINGS), { b: true })).toBe(`<b>${'x'.repeat(SIBLINGS)}</b>`);
  });

  it('drops thousands of sibling comments', () => {
    expect(sanitizeHtmlFragment('<!--c-->x'.repeat(SIBLINGS), { b: true })).toBe('x'.repeat(SIBLINGS));
  });

  it('strips whitespace between thousands of sibling blocks', () => {
    expect(sanitizeHtmlFragment('<p>a</p> '.repeat(SIBLINGS), { p: true })).toBe('<p>a</p>'.repeat(SIBLINGS));
  });

  it('unwraps thousands of sibling tags that repeat their ancestor', () => {
    expect(sanitizeHtmlFragment(`<b>${'<b>x</b>'.repeat(SIBLINGS)}</b>`, { b: true })).toBe(`<b>${'x'.repeat(SIBLINGS)}</b>`);
  });

  it('renders thousands of sibling tags', () => {
    expect(applyInlineRenderers('<i>x</i>'.repeat(SIBLINGS), { i: () => '<em>x</em>' })).toBe('<em>x</em>'.repeat(SIBLINGS));
    expect(applyInlineRenderers('<i>x</i>'.repeat(SIBLINGS), { b: () => '' })).toBe('<i>x</i>'.repeat(SIBLINGS));
  });
});
