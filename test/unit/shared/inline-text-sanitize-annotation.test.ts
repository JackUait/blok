import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clean } from '../../../src/components/utils/sanitizer';
import { ANNOTATION_ATTR, ANNOTATION_SUBTITLE_ATTR } from '../../../src/shared/annotation-mark';
import { INLINE_TEXT_SANITIZE } from '../../../src/shared/inline-text-sanitize';
import { sanitizeHtmlFragment } from '../../../src/view/sanitize';

const SANITIZERS: Array<[string, (html: string) => string]> = [
  ['editor', html => clean(html, INLINE_TEXT_SANITIZE)],
  ['headless', html => sanitizeHtmlFragment(html, INLINE_TEXT_SANITIZE)],
];

describe.each(SANITIZERS)('annotation span in the %s sanitizer', (_name, run) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('names the two attributes', () => {
    expect(ANNOTATION_ATTR).toBe('data-blok-annotation');
    expect(ANNOTATION_SUBTITLE_ATTR).toBe('data-blok-annotation-subtitle');
  });

  it('keeps the span with its text and subtitle', () => {
    const html = '<span data-blok-annotation="A quote" data-blok-annotation-subtitle="Anna">phrase</span>';

    expect(run(html)).toBe(html);
  });

  it('keeps a span that has no subtitle', () => {
    const html = 'see <span data-blok-annotation="A quote">phrase</span> here';

    expect(run(html)).toBe(html);
  });

  it('drops every other attribute on the span', () => {
    const result = run('<span data-blok-annotation="A quote" class="x" style="color:red" tabindex="0" role="button">phrase</span>');

    expect(result).toBe('<span data-blok-annotation="A quote">phrase</span>');
  });

  it('drops an empty subtitle', () => {
    const result = run('<span data-blok-annotation="A quote" data-blok-annotation-subtitle="  ">phrase</span>');

    expect(result).toBe('<span data-blok-annotation="A quote">phrase</span>');
  });

  it('unwraps a span whose annotation text is blank', () => {
    const result = run('a <span data-blok-annotation="   " data-blok-annotation-subtitle="Anna">phrase</span> b');

    expect(result).toBe('a phrase b');
  });

  it('keeps formatting inside the span', () => {
    const html = '<span data-blok-annotation="A quote">see <a href="https://example.com">the <strong>report</strong></a></span>';

    expect(run(html)).toBe(html);
  });

  it('carries quotes, angle brackets, ampersands and line breaks in the text', () => {
    const html = '<span data-blok-annotation="«a» &quot;b&quot; &lt;c&gt; &amp; d\ne">phrase</span>';
    const host = document.createElement('div');

    host.innerHTML = run(html);

    expect(host.querySelector('span')?.getAttribute('data-blok-annotation')).toBe('«a» "b" <c> & d\ne');
  });

  it('still unwraps a plain span', () => {
    expect(run('a <span class="x">b</span> c')).toBe('a b c');
  });

  it('still keeps an equation span and rewrites its text', () => {
    const result = run('<span data-latex="a^2" class="katex">a²</span>');

    expect(result).toBe('<span data-latex="a^2">a^2</span>');
  });
});
