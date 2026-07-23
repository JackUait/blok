import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { sanitizeHtmlFragment } from '../../../src/view/sanitize';
import { sanitizeBlocks } from '../../../src/components/utils/sanitizer';
import { INLINE_TEXT_SANITIZE } from '../../../src/components/shared/inline-content-sanitize';
import { markSanitizerConfig } from '../../../src/components/marks/mark-engine';
import type { MarkSpec } from '../../../types/api/marks';
import type { SanitizerConfig } from '../../../types';

/**
 * Runs a string through the editor's real DOM sanitizer pipeline
 * (html-janitor clean + applyAttributeOverrides + stripUnsafeUrls) the way
 * cleanOneItem applies it to a tool field.
 * @param html - taint string
 * @param config - tag allowlist for the field
 */
const domPipeline = (html: string, config: SanitizerConfig): string => {
  const [block] = sanitizeBlocks(
    [{ tool: 'any', data: { text: html } }],
    { text: config },
    {}
  );

  return block.data.text as string;
};

/**
 * Normalizes trivial serialization differences (attribute order, style
 * attribute whitespace) so only semantic drift fails the comparison.
 * @param html - markup to normalize
 */
const normalizeHtml = (html: string): string => {
  const template = document.createElement('template');

  template.innerHTML = html;

  const normalizeElement = (element: Element): void => {
    const attrs = Array.from(element.attributes)
      .map((attr) => ({ name: attr.name, value: attr.value }))
      .sort((a, b) => a.name.localeCompare(b.name));

    attrs.forEach((attr) => element.removeAttribute(attr.name));
    attrs.forEach((attr) => {
      const value = attr.name === 'style'
        ? attr.value.split(';').map((declaration) => declaration.trim()).filter(Boolean)
          .join('; ')
        : attr.value;

      element.setAttribute(attr.name, value);
    });

    Array.from(element.children).forEach(normalizeElement);
  };

  Array.from(template.content.children).forEach(normalizeElement);

  return template.innerHTML;
};

/**
 * Asserts view-sanitizer output matches the DOM pipeline for the same input
 * and config, modulo trivial serialization differences.
 * @param html - taint string
 * @param config - tag allowlist
 */
const expectParity = (html: string, config: SanitizerConfig): void => {
  const viewResult = sanitizeHtmlFragment(html, config);
  const domResult = domPipeline(html, config);

  expect(normalizeHtml(viewResult)).toBe(normalizeHtml(domResult));
};

describe('view sanitizeHtmlFragment parity with the DOM sanitizer pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('matches on the inline mark set incl. color styles and equation spans', () => {
    const input = '<strong>b</strong> <em>i</em> <mark style="color: red; font-size: 2em">m</mark>'
      + '<span data-latex="a^2">eq</span><span class="decor">plain</span>'
      + '<a href="https://x.y" target="_blank" rel="noopener">l</a><code>c</code><br>';

    expectParity(input, INLINE_TEXT_SANITIZE);
  });

  it('matches on `true` rules (safe attributes only) and unwrapping', () => {
    const input = '<p class="c" data-x="1" aria-label="l" onclick="y()" style="color:red">a<b>b</b></p>'
      + '<div>unwrapped <i>kept text</i></div>';

    expectParity(input, { p: true, b: {} });
  });

  it('matches on empty config (strip everything to text)', () => {
    expectParity('<p>a<b>b</b><script>x()</script><!-- c --></p>', {});
  });

  it('matches on attr-map string values (keep-if-equal)', () => {
    const config: SanitizerConfig = { a: { href: true, rel: 'nofollow' } };

    expectParity('<a href="/x" rel="nofollow">keep</a>', config);
    expectParity('<a href="/x" rel="noopener">drop</a>', config);
  });

  it('matches on nested-block and invalid-inline unwrapping + whitespace trimming', () => {
    expectParity('<li><p>x</p></li>\n  <p>y</p>', { li: {}, p: {} });
    expectParity('<b><p>x</p></b>', { b: {}, p: {} });
  });

  it('matches on URL scheme stripping', () => {
    const config: SanitizerConfig = { a: { href: true }, img: { src: true } };
    const input = '<a href="javascript:alert(1)">j</a>'
      + '<a href="blob:https://x/id">b</a>'
      + '<img src="data:image/png;base64,AAAA">'
      + '<img src="data:image/svg+xml,<svg/>">'
      + '<a href="slack://open">custom</a>';

    expectParity(input, config);
  });

  it('matches on function rules with forced string attribute values', () => {
    const config: SanitizerConfig = {
      a: () => ({ href: true, rel: 'nofollow', target: '_blank' }),
    };

    expectParity('<a href="/x" rel="noopener">l</a>', config);
    expectParity('<a href="/x">bare</a>', config);
  });

  it('matches on script/style content removal', () => {
    expectParity('a<script>alert(1)</script><style>.x{}</style>b', { p: true });
  });

  it('matches on a class-based MarkSpec rule (BlokView inline mark path)', () => {
    const classSpec: MarkSpec = { tag: 'span', className: 'hl-description' };
    const config = markSanitizerConfig(classSpec);

    expectParity('<span class="hl-description sneaky">x</span>', config);
    expectParity('<span class="sneaky">y</span>', config);
  });

  it('matches on a tag-only / style-only MarkSpec rule (no declared classes)', () => {
    const colorSpec: MarkSpec<string> = {
      tag: 'mark',
      style: { color: (value: string): string => value },
    };
    const config = markSanitizerConfig(colorSpec);

    expectParity('<mark style="color: red; font-size: 2em">x</mark>', config);
    expectParity('<mark class="stray">y</mark>', config);
  });
});
