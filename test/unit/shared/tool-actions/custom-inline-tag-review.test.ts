// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sanitizeBlocks } from '../../../../src/components/utils/sanitizer';
import { composeToolSanitize } from '../../../../src/shared/tool-actions/runtime';
import { BUILT_IN_BLOCK_SANITIZE } from '../../../../src/shared/tool-descriptions/sanitize/blocks';
import { BUILT_IN_INLINE_SANITIZE } from '../../../../src/shared/tool-descriptions/sanitize/inline';
import { sanitizeHtmlFragment } from '../../../../src/view/sanitize';

import type { SanitizerConfig } from '../../../../types';

const isConfig = (value: unknown): value is SanitizerConfig => typeof value === 'object' && value !== null;

const inline = (): SanitizerConfig[] => Object.values(BUILT_IN_INLINE_SANITIZE).map(factory => factory());

const fieldRules = (tool: 'paragraph' | 'table', field: string, custom?: SanitizerConfig): SanitizerConfig => {
  const rules: unknown = composeToolSanitize(BUILT_IN_BLOCK_SANITIZE[tool](), custom === undefined ? inline() : [...inline(), custom])[field];

  if (typeof rules !== 'object' || rules === null) {
    throw new Error(`${tool} has no ${field} rules`);
  }

  return { ...rules };
};

/** The editor's save path: a block field's rules under the host's global sanitizer. */
const editorClean = (html: string, rules: SanitizerConfig, global: SanitizerConfig = {}): unknown =>
  sanitizeBlocks([{ tool: 'p', data: { text: html } }], { text: rules }, global)[0].data.text;

describe('custom inline tool rules on a tag the block rules: what must not change', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a host global function rule in charge of the tag', () => {
    const global: SanitizerConfig = { u: () => ({}) };
    const html = '<u class="c">u</u>';

    expect(editorClean(html, fieldRules('paragraph', 'text', { u: { class: true } }), global))
      .toBe(editorClean(html, fieldRules('paragraph', 'text'), global));
  });

  it('keeps the block\'s own attributes when a global object rule and a custom rule share a tag', () => {
    const global: SanitizerConfig = { img: { width: true } };
    const html = '<img src="https://e.test/a.png" alt="a" style="color: red;" width="4">';

    expect(editorClean(html, fieldRules('paragraph', 'text', { img: { src: true } }), global))
      .toBe(editorClean(html, fieldRules('paragraph', 'text'), global));
  });

  it('keeps the table\'s forced link target and rel over a custom rule that allows any', () => {
    const html = '<a href="https://e.test" target="_self" rel="opener">x</a>';

    expect(sanitizeHtmlFragment(html, fieldRules('table', 'content', { a: { href: true, target: true, rel: true } })))
      .toBe('<a href="https://e.test" target="_blank" rel="nofollow">x</a>');
  });

  it('keeps the block\'s per-attribute check over a custom claim on the same attribute', () => {
    // The published types have no per-attribute function rule, but the editor sanitizer runs one.
    const own: unknown = { text: { a: { href: (value: string) => value.startsWith('https://') } } };

    if (!isConfig(own)) {
      throw new Error('not a config');
    }
    const rules: unknown = composeToolSanitize(own, [{ a: { href: true, 'data-x': true } }]).text;

    if (!isConfig(rules)) {
      throw new Error('no text rules');
    }

    expect(editorClean('<a href="http://e.test" data-x="1">x</a><a href="https://e.test">y</a>', rules))
      .toBe('<a data-x="1">x</a><a href="https://e.test">y</a>');
  });

  it('never lets a span: true tool revive data-blok-* attributes on a span the block unwraps', () => {
    expect(sanitizeHtmlFragment('<span data-blok-x="1" class="k">a</span>', fieldRules('paragraph', 'text', { span: true })))
      .toBe('<span class="k">a</span>');
  });

  it('strips a javascript: href under a custom a rule', () => {
    expect(sanitizeHtmlFragment('<a href="javascript:alert(1)" data-x="1">x</a>', fieldRules('paragraph', 'text', { a: { href: true, 'data-x': true } })))
      .not.toContain('javascript:');
    expect(editorClean('<a href="javascript:alert(1)" data-x="1">x</a>', fieldRules('paragraph', 'text', { a: { href: true, 'data-x': true } })))
      .not.toContain('javascript:');
  });
});
