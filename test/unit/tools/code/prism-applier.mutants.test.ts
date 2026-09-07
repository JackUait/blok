import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  applyPrismHighlight,
  ensurePrismStyles,
  disposePrismStyles,
  LIGHT_RULES,
  DARK_RULES,
} from '../../../../src/tools/code/prism-applier';

const codeElement = (text: string): HTMLElement => {
  const el = document.createElement('code');

  el.contentEditable = 'true';
  el.textContent = text;
  document.body.appendChild(el);

  return el;
};

const adoptedText = (): string =>
  Array.from(document.adoptedStyleSheets ?? [])
    .flatMap((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText))
    .join('\n');

describe('prism applier mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    disposePrismStyles();
  });

  afterEach(() => {
    disposePrismStyles();
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  describe('the stylesheet', () => {
    it('is adopted once, however many times it is asked for', () => {
      const before = (document.adoptedStyleSheets ?? []).length;

      ensurePrismStyles();
      ensurePrismStyles();
      ensurePrismStyles();

      expect((document.adoptedStyleSheets ?? []).length).toBe(before + 1);
    });

    it('is removed again on teardown, and can be adopted afresh', () => {
      const before = (document.adoptedStyleSheets ?? []).length;

      ensurePrismStyles();
      disposePrismStyles();

      expect((document.adoptedStyleSheets ?? []).length).toBe(before);

      ensurePrismStyles();

      expect((document.adoptedStyleSheets ?? []).length).toBe(before + 1);
    });

    it('leaves other sheets alone when it removes its own', () => {
      const other = new CSSStyleSheet();

      other.replaceSync('.someone-else { color: red; }');
      document.adoptedStyleSheets = [other];

      ensurePrismStyles();
      disposePrismStyles();

      expect(document.adoptedStyleSheets).toStrictEqual([other]);
    });

    it('teardown is a no-op when nothing was adopted', () => {
      const other = new CSSStyleSheet();

      other.replaceSync('.someone-else { color: red; }');
      document.adoptedStyleSheets = [other];

      disposePrismStyles();

      expect(document.adoptedStyleSheets).toStrictEqual([other]);
    });
  });

  describe('the dark palette gates', () => {
    it('is authored against .dark, which nothing in Blok ever sets', () => {
      expect(DARK_RULES).toContain('.dark ');
      expect(LIGHT_RULES).not.toContain('.dark ');
    });

    it('re-gates every dark rule onto the selectors Blok really uses', () => {
      ensurePrismStyles();

      const css = adoptedText();

      expect(css).toContain('[data-blok-theme="dark"]');
      expect(css).toContain(':root:not([data-blok-theme="light"])');
      expect(css).not.toContain('.dark ');
    });

    it('emits the attribute gate outside the media query, so an explicit theme wins', () => {
      ensurePrismStyles();

      const media = Array.from(document.adoptedStyleSheets ?? [])
        .flatMap((sheet) => Array.from(sheet.cssRules))
        .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule);

      expect(media).toHaveLength(1);
      expect(media[0].conditionText).toContain('prefers-color-scheme: dark');
      expect(media[0].cssText).toContain(':root:not([data-blok-theme="light"])');
      expect(media[0].cssText).not.toContain('[data-blok-theme="dark"]');
    });

    it('keeps the light palette ungated', () => {
      ensurePrismStyles();

      const css = adoptedText();

      expect(css).toContain('.blok-code .token.punctuation');
    });
  });

  describe('applying a highlight', () => {
    it('swaps in the highlighted markup and names the element', () => {
      const el = codeElement('const a = 1;');

      applyPrismHighlight(el, '<span class="token keyword">const</span> a = 1;');

      expect(el.classList.contains('blok-code')).toBe(true);
      expect(el.querySelector('.token.keyword')?.textContent).toBe('const');
    });

    it('adds a language class only when a language is given', () => {
      const withLang = codeElement('x');
      const without = codeElement('x');

      applyPrismHighlight(withLang, 'x', 'mermaid');
      applyPrismHighlight(without, 'x');

      expect(withLang.classList.contains('lang-mermaid')).toBe(true);
      expect(Array.from(without.classList).some((c) => c.startsWith('lang-'))).toBe(false);
    });

    it('adopts the stylesheet on the way in', () => {
      const before = (document.adoptedStyleSheets ?? []).length;

      applyPrismHighlight(codeElement('x'), 'x');

      expect((document.adoptedStyleSheets ?? []).length).toBe(before + 1);
    });

    it('restores the plain text and both classes when disposed', () => {
      const el = codeElement('const a = 1;');
      const dispose = applyPrismHighlight(el, '<span class="token keyword">const</span> a = 1;', 'javascript');

      dispose();

      expect(el.textContent).toBe('const a = 1;');
      expect(el.querySelector('.token')).toBeNull();
      expect(el.classList.contains('blok-code')).toBe(false);
      expect(el.classList.contains('lang-javascript')).toBe(false);
    });
  });

  describe('the caret across a re-highlight', () => {
    const putCaret = (el: HTMLElement, offset: number): void => {
      const text = el.firstChild;

      if (text === null) {
        throw new Error('no text node');
      }

      const range = document.createRange();

      range.setStart(text, offset);
      range.collapse(true);

      const selection = window.getSelection();

      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    const caretOffsetWithin = (el: HTMLElement): number => {
      const selection = window.getSelection();

      if (selection === null || selection.rangeCount === 0) {
        return -1;
      }

      const measure = selection.getRangeAt(0).cloneRange();

      measure.selectNodeContents(el);
      measure.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);

      return measure.toString().length;
    };

    it('keeps the caret at the same character offset across the swap', () => {
      const el = codeElement('const a = 1;');

      putCaret(el, 7);
      applyPrismHighlight(el, '<span class="token keyword">const</span> a = 1;');

      expect(caretOffsetWithin(el)).toBe(7);
    });

    it('places no caret when there was none to save', () => {
      const el = codeElement('const a = 1;');

      window.getSelection()?.removeAllRanges();
      applyPrismHighlight(el, '<span class="token keyword">const</span> a = 1;');

      expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
    });

    it('leaves the caret alone when the offset is past the new content', () => {
      const el = codeElement('const a = 1;');

      putCaret(el, 12);
      applyPrismHighlight(el, 'x');

      expect(el.textContent).toBe('x');
    });
  });
});
