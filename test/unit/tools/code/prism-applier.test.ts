import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { applyPrismHighlight, disposePrismStyles } from '../../../../src/tools/code/prism-applier';

describe('prism-applier', () => {
  let codeEl: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    codeEl = document.createElement('code');
    document.body.appendChild(codeEl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.removeChild(codeEl);
    disposePrismStyles();
  });

  describe('applyPrismHighlight', () => {
    it('sets innerHTML with highlighted HTML', () => {
      const html = '<span class="token keyword">const</span> x = 1;';
      applyPrismHighlight(codeEl, html);
      expect(codeEl.innerHTML).toContain('token keyword');
    });

    it('adds blok-code class to element', () => {
      applyPrismHighlight(codeEl, 'hello');
      expect(codeEl.classList.contains('blok-code')).toBe(true);
    });

    it('returns a dispose function that restores plain textContent', () => {
      const original = 'const x = 1;';
      codeEl.textContent = original;
      const html = '<span class="token keyword">const</span> x = 1;';
      const dispose = applyPrismHighlight(codeEl, html);
      dispose();
      expect(codeEl.textContent).toBe(original);
      expect(codeEl.innerHTML).toBe(original);
    });

    it('injects a stylesheet with token color rules', () => {
      applyPrismHighlight(codeEl, '<span class="token keyword">if</span>');
      expect(document.adoptedStyleSheets.length).toBeGreaterThan(0);
    });

    it('does not duplicate stylesheet injection on multiple calls', () => {
      applyPrismHighlight(codeEl, '<span class="token keyword">if</span>');
      const count1 = document.adoptedStyleSheets.length;
      applyPrismHighlight(codeEl, '<span class="token string">"hi"</span>');
      expect(document.adoptedStyleSheets.length).toBe(count1);
    });

    it('preserves caret position after highlight', () => {
      codeEl.setAttribute('contenteditable', 'plaintext-only');
      codeEl.textContent = 'const x = 1;';
      // Place caret at offset 5 (after "const")
      const range = document.createRange();
      const textNode = codeEl.firstChild as Text;
      range.setStart(textNode, 5);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);

      const html = '<span class="token keyword">const</span> x = 1;';
      applyPrismHighlight(codeEl, html);

      // Caret should still be at offset 5 in the resulting text
      const newSel = window.getSelection()!;
      expect(newSel.rangeCount).toBeGreaterThan(0);
    });
  });

  describe('disposePrismStyles', () => {
    it('removes the injected stylesheet', () => {
      applyPrismHighlight(codeEl, '<span class="token keyword">if</span>');
      const countBefore = document.adoptedStyleSheets.length;
      expect(countBefore).toBeGreaterThan(0);
      disposePrismStyles();
      expect(document.adoptedStyleSheets.length).toBe(countBefore - 1);
    });
  });
});
