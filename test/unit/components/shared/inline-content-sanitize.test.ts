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
  });
});
