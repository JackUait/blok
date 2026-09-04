import { describe, it, expect } from 'vitest';
import { clean } from '../../../../src/components/utils/sanitizer';
import {
  INLINE_TEXT_SANITIZE,
  preserveColorStyles,
  preserveEquationSpan,
} from '../../../../src/components/shared/inline-content-sanitize';

describe('inline-content-sanitize', () => {
  describe('INLINE_TEXT_SANITIZE used as a text-field whitelist', () => {
    it('preserves bold/italic/underline/strike/link/code tags', () => {
      const dirty =
        '<strong>b</strong><em>i</em><u>u</u><s>s</s><a href="https://x.test">l</a><code>c</code>';
      const result = clean(dirty, INLINE_TEXT_SANITIZE);

      expect(result).toContain('<strong>b</strong>');
      expect(result).toContain('<em>i</em>');
      expect(result).toContain('<u>u</u>');
      expect(result).toContain('<s>s</s>');
      expect(result).toContain('href="https://x.test"');
      expect(result).toContain('<code>c</code>');
    });

    it('strips block-level junk that has no place in a text field', () => {
      const dirty = '<div>x</div><h1>y</h1><script>bad()</script>z';
      const result = clean(dirty, INLINE_TEXT_SANITIZE);

      expect(result).not.toContain('<div>');
      expect(result).not.toContain('<h1>');
      expect(result).not.toContain('<script>');
      expect(result).toContain('x');
      expect(result).toContain('y');
      expect(result).toContain('z');
    });

    it('keeps a colored <mark> with only its color styles', () => {
      const dirty = '<mark style="color: red; position: fixed; background-color: yellow;">m</mark>';
      const result = clean(dirty, INLINE_TEXT_SANITIZE);

      expect(result).toContain('<mark');
      expect(result).toContain('color: red');
      expect(result).toContain('background-color: yellow');
      expect(result).not.toContain('position');
    });

    it('keeps an equation <span data-latex> but drops decorative spans', () => {
      const dirty = '<span data-latex="x^2">x²</span><span style="color:red">plain</span>';
      const result = clean(dirty, INLINE_TEXT_SANITIZE);

      expect(result).toContain('data-latex="x^2"');
      expect(result).not.toContain('color:red');
      // The decorative span must be unwrapped (tag gone), not just emptied —
      // otherwise every span leaks through as a bare <span>.
      expect(result).not.toContain('<span style');
      expect(result).toContain('plain');
      expect(result.match(/<span/g) ?? []).toHaveLength(1);
    });

    /**
     * ROOT CAUSE this fixes: the KaTeX markup inside an equation span is
     * DERIVED from `data-latex`. The sanitizer dropped its tags but kept their
     * text, so what got persisted was the MathML layer's text plus the
     * annotation plus the HTML layer's text — `E=mc2E=mc^2E=mc2`. Every
     * consumer that does not re-render KaTeX (the view renderer, plain-text
     * extraction, search indexing, the editor itself on reload) showed that
     * concatenation verbatim.
     */
    it('replaces rendered KaTeX markup with the LaTeX source (derived content is never persisted)', () => {
      const rendered =
        '<span data-latex="E=mc^2">'
        + '<span class="katex"><span class="katex-mathml">E=mc2E=mc^2</span>'
        + '<span class="katex-html" aria-hidden="true">E=mc2</span></span>'
        + '</span>';

      expect(clean(rendered, INLINE_TEXT_SANITIZE)).toBe('<span data-latex="E=mc^2">E=mc^2</span>');
    });

    it('escapes a LaTeX source carrying markup characters', () => {
      const rendered = '<span data-latex="a &lt; b &amp; c">rendered junk</span>';
      const result = clean(rendered, INLINE_TEXT_SANITIZE);

      // `<` needs no escape inside an attribute value, but does in text.
      expect(result).toBe('<span data-latex="a < b &amp; c">a &lt; b &amp; c</span>');
    });
  });

  describe('preserveColorStyles', () => {
    it('removes non-color properties in place and reports style kept', () => {
      const el = document.createElement('mark');

      el.setAttribute('style', 'color: blue; font-size: 40px; position: absolute;');

      const attrs = preserveColorStyles(el);

      expect(attrs).toEqual({ style: true });
      expect(el.style.color).toBe('blue');
      expect(el.style.getPropertyValue('font-size')).toBe('');
      expect(el.style.getPropertyValue('position')).toBe('');
    });

    it('reports no style when nothing color-related remains', () => {
      const el = document.createElement('mark');

      el.setAttribute('style', 'font-weight: bold;');

      expect(preserveColorStyles(el)).toEqual({});
    });
  });

  describe('preserveEquationSpan', () => {
    it('keeps data-latex when present', () => {
      const el = document.createElement('span');

      el.setAttribute('data-latex', 'a+b');

      expect(preserveEquationSpan(el)).toEqual({ 'data-latex': true });
    });

    it('drops a plain span (returns false so HTMLJanitor unwraps it)', () => {
      const el = document.createElement('span');

      expect(preserveEquationSpan(el)).toBe(false);
    });

    // The guard is what makes this a no-op when there is nothing to fix. Without
    // it every already-normalized span is rewritten, which replaces its children
    // with one fresh text node — losing any markup a later pass put inside a span
    // whose text already equals its source.
    it('leaves an already-normalized span untouched', () => {
      const el = document.createElement('span');

      el.setAttribute('data-latex', 'a+b');
      el.innerHTML = '<b>a+b</b>';

      const before = el.firstChild;

      preserveEquationSpan(el);

      expect(el.firstChild).toBe(before);
      expect(el.innerHTML).toBe('<b>a+b</b>');
    });

    it('normalizes the span content to the LaTeX source in place', () => {
      const el = document.createElement('span');

      el.setAttribute('data-latex', 'a+b');
      el.innerHTML = '<span class="katex">a+ba+b</span>';

      preserveEquationSpan(el);

      expect(el.textContent).toBe('a+b');
      expect(el.querySelector('span')).toBeNull();
    });
  });
});
