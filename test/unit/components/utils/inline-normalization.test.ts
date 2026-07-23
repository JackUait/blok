import { describe, it, expect } from 'vitest';

import { normalizeInlineMarkupHtml } from '../../../../src/components/utils/inline-normalization';

/**
 * The normalizer collapses the redundant inline markup that per-run clipboard
 * converters and range-splitting inline tools leave behind. It must never
 * change what the reader sees — only how many elements it takes to say it.
 */
describe('normalizeInlineMarkupHtml', () => {
  describe('merging directly adjacent identical wrappers', () => {
    it('merges a run of identical <mark> siblings into one', () => {
      const input =
        '<mark style="color: red;">a</mark><mark style="color: red;">b</mark><mark style="color: red;">c</mark>';

      expect(normalizeInlineMarkupHtml(input)).toBe('<mark style="color: red;">abc</mark>');
    });

    it('merges identical wrappers for every inline formatting tag, not just <mark>', () => {
      expect(normalizeInlineMarkupHtml('<b>a</b><b>b</b>')).toBe('<b>ab</b>');
      expect(normalizeInlineMarkupHtml('<i>a</i><i>b</i>')).toBe('<i>ab</i>');
      expect(normalizeInlineMarkupHtml('<code>a</code><code>b</code>')).toBe('<code>ab</code>');
      expect(normalizeInlineMarkupHtml('<s>a</s><s>b</s>')).toBe('<s>ab</s>');
      expect(normalizeInlineMarkupHtml('<a href="/x">a</a><a href="/x">b</a>')).toBe('<a href="/x">ab</a>');
    });

    it('merges nested runs too, not only the top level', () => {
      const input = '<p><b><mark style="color: red;">a</mark><mark style="color: red;">b</mark></b></p>';

      expect(normalizeInlineMarkupHtml(input)).toBe('<p><b><mark style="color: red;">ab</mark></b></p>');
    });

    it('treats style declaration order as irrelevant when comparing', () => {
      const input =
        '<mark style="color: red; background-color: blue;">a</mark><mark style="background-color: blue; color: red;">b</mark>';

      expect((normalizeInlineMarkupHtml(input).match(/<mark/g) ?? []).length).toBe(1);
    });

    it('does NOT merge wrappers with different values', () => {
      const input = '<mark style="color: red;">a</mark><mark style="color: blue;">b</mark>';

      expect(normalizeInlineMarkupHtml(input)).toBe(input);
    });

    it('does NOT merge wrappers separated by a text node', () => {
      const input = '<mark style="color: red;">a</mark> <mark style="color: red;">b</mark>';

      expect(normalizeInlineMarkupHtml(input)).toBe(input);
    });

    it('does NOT merge wrappers carrying an id', () => {
      const input = '<mark id="m1">a</mark><mark id="m1">b</mark>';

      expect(normalizeInlineMarkupHtml(input)).toBe(input);
    });

    it('does NOT merge block-level siblings', () => {
      const input = '<p>a</p><p>b</p>';

      expect(normalizeInlineMarkupHtml(input)).toBe(input);
    });
  });

  describe('unwrapping wrappers that cannot affect anything', () => {
    it('drops a wrapper with no content at all', () => {
      expect(normalizeInlineMarkupHtml('a<mark style="color: red;"></mark>b')).toBe('ab');
    });

    it('unwraps a wrapper holding only a <br>', () => {
      expect(normalizeInlineMarkupHtml('<mark style="color: red;"><br></mark>')).toBe('<br>');
    });

    it('unwraps a text-colour wrapper holding only whitespace', () => {
      expect(normalizeInlineMarkupHtml('a<mark style="color: red;"> </mark>b')).toBe('a b');
    });

    it('KEEPS a whitespace-only wrapper whose styling is visible on whitespace', () => {
      const bg = '<mark style="background-color: yellow;"> </mark>';
      const underline = '<u> </u>';

      expect(normalizeInlineMarkupHtml(bg)).toBe(bg);
      expect(normalizeInlineMarkupHtml(underline)).toBe(underline);
    });

    it('KEEPS a wrapper holding a void media element', () => {
      const input = '<mark style="color: red;"><img src="/x.png"></mark>';

      expect(normalizeInlineMarkupHtml(input)).toBe(input);
    });

    it('KEEPS an empty anchor (identity, not decoration)', () => {
      const input = '<a href="/x"></a>';

      expect(normalizeInlineMarkupHtml(input)).toBe(input);
    });
  });

  describe('unwrapping redundantly nested duplicates', () => {
    it('unwraps a wrapper nested inside an identical one', () => {
      expect(normalizeInlineMarkupHtml('<b><b>x</b></b>')).toBe('<b>x</b>');
      expect(normalizeInlineMarkupHtml('<mark style="color: red;"><mark style="color: red;">x</mark></mark>')).toBe(
        '<mark style="color: red;">x</mark>'
      );
    });

    it('KEEPS a nested wrapper that adds something', () => {
      const input = '<mark style="color: red;"><mark style="background-color: blue;">x</mark></mark>';

      expect(normalizeInlineMarkupHtml(input)).toBe(input);
    });
  });

  describe('convergence', () => {
    it('reaches a fixpoint — normalizing twice changes nothing', () => {
      const input =
        '<p><mark style="color: red;">a</mark><mark style="color: red;"><br></mark><mark style="color: red;">b</mark></p>';
      const once = normalizeInlineMarkupHtml(input);

      expect(normalizeInlineMarkupHtml(once)).toBe(once);
      /**
       * The freed <br> stays between the two marks rather than being pulled
       * inside one of them — moving content across a wrapper boundary is a
       * bigger claim than this pass is allowed to make.
       */
      expect(once).toBe('<p><mark style="color: red;">a</mark><br><mark style="color: red;">b</mark></p>');
    });

    it('preserves the reader-visible text exactly', () => {
      const input =
        '<mark style="color: red;">Как контролировать</mark><mark style="color: red;">»</mark><mark style="color: red;">. </mark>';

      const out = normalizeInlineMarkupHtml(input);
      const read = (html: string): string => {
        const el = document.createElement('div');

        el.innerHTML = html;

        return el.textContent ?? '';
      };

      expect(read(out)).toBe(read(input));
    });

    it('leaves already-clean markup byte-identical', () => {
      const input = '<p>plain <b>bold</b> and <a href="/x">a link</a></p>';

      expect(normalizeInlineMarkupHtml(input)).toBe(input);
    });

    /**
     * This pass sits on the sanitize path, which also carries strings that are
     * not markup at all. Parsing and re-serializing those is lossy, so the
     * input must come back verbatim whenever there was nothing to collapse.
     */
    it.each([
      ['less-than in a for loop', 'for (let i = 0; i < n; i++)'],
      ['unspaced comparison', 'if (a<b) { }'],
      ['ampersand beside less-than', 'a & b < c'],
      ['lone closing tag', '</div>'],
      ['mixed operators', '5 < 6 && 7 > 8'],
    ])('returns non-markup text verbatim: %s', (_label, text) => {
      expect(normalizeInlineMarkupHtml(text)).toBe(text);
    });
  });
});
