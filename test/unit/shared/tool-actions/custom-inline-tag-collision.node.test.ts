// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { composeToolSanitize } from '../../../../src/shared/tool-actions/runtime';
import { BUILT_IN_BLOCK_SANITIZE } from '../../../../src/shared/tool-descriptions/sanitize/blocks';
import { BUILT_IN_INLINE_SANITIZE } from '../../../../src/shared/tool-descriptions/sanitize/inline';
import { sanitizeHtmlFragment } from '../../../../src/view/sanitize';

import type { SanitizerConfig } from '../../../../types';

const isConfig = (value: unknown): value is SanitizerConfig => typeof value === 'object' && value !== null;

/** The headless paragraph `text` rules with a host inline tool on `span` added after the built-ins. */
const paragraphText = (custom: SanitizerConfig): SanitizerConfig => {
  const inline = Object.values(BUILT_IN_INLINE_SANITIZE).map(factory => factory());
  const text: unknown = composeToolSanitize(BUILT_IN_BLOCK_SANITIZE.paragraph(), [...inline, custom]).text;

  if (!isConfig(text)) {
    throw new Error('paragraph has no text rules');
  }

  return text;
};

describe('headless: a custom inline tool on a tag the block tool also rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the span the custom tool declares', () => {
    expect(sanitizeHtmlFragment('a <span class="cdx-x">x</span> b', paragraphText({ span: { class: 'cdx-x' } })))
      .toBe('a <span class="cdx-x">x</span> b');
  });

  it('still unwraps a bare span and a span with another class', () => {
    expect(sanitizeHtmlFragment('a <span>x</span> <span class="other">y</span> b', paragraphText({ span: { class: 'cdx-x' } })))
      .toBe('a x y b');
  });

  it('still keeps an equation span and nothing else on it', () => {
    expect(sanitizeHtmlFragment('<span data-latex="x" class="cdx-y">x</span>', paragraphText({ span: { class: 'cdx-x' } })))
      .toBe('<span data-latex="x">x</span>');
  });

  it('keeps every span, with safe attributes only, for a tool that declares span: true', () => {
    expect(sanitizeHtmlFragment('<span>a</span><span class="k" onclick="x">b</span>', paragraphText({ span: true })))
      .toBe('<span>a</span><span class="k">b</span>');
  });

  it('adds the custom attribute to a span that is also an equation', () => {
    expect(sanitizeHtmlFragment('<span data-latex="x" class="cdx-x">x</span>', paragraphText({ span: { class: 'cdx-x' } })))
      .toBe('<span data-latex="x" class="cdx-x">x</span>');
  });
});
