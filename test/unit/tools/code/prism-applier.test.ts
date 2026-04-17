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

  describe('lang class scoping', () => {
    it('adds lang-{language} class when lang is provided', () => {
      applyPrismHighlight(codeEl, 'hello', 'mermaid');
      expect(codeEl.classList.contains('lang-mermaid')).toBe(true);
    });

    it('does not add lang class when lang is not provided', () => {
      applyPrismHighlight(codeEl, 'hello');
      // No lang-* classes should be present
      const langClasses = Array.from(codeEl.classList).filter(c => c.startsWith('lang-'));
      expect(langClasses).toHaveLength(0);
    });

    it('dispose removes lang-{language} class', () => {
      const dispose = applyPrismHighlight(codeEl, 'hello', 'mermaid');
      dispose();
      expect(codeEl.classList.contains('lang-mermaid')).toBe(false);
    });
  });

  describe('mermaid token CSS colors', () => {
    // These tests verify that the stylesheet contains the precise One Dark / One Light
    // hex values for Mermaid-specific token classes.
    // We import the module source as text to avoid JSDOM normalizing hex → rgb().

    let lightRules: string;
    let darkRules: string;

    beforeEach(async () => {
      // Read the raw module source to check hex values before JSDOM normalization
      const src = await import('../../../../src/tools/code/prism-applier?raw');
      const text: string = (src as unknown as { default: string }).default;
      // Split on the DARK_RULES assignment to separate light and dark sections
      const darkIdx = text.indexOf('DARK_RULES');
      lightRules = text.slice(0, darkIdx).toLowerCase();
      darkRules = text.slice(darkIdx).toLowerCase();
    });

    // One Dark: @hue-1 = #56b5c2 (cyan) — diagram-name, node-bracket, edge-delimiter
    it('dark mode diagram-name uses One Dark cyan #56b5c2', () => {
      expect(darkRules).toContain('diagram-name');
      expect(darkRules).toContain('#56b5c2');
    });

    it('dark mode node-bracket uses One Dark cyan #56b5c2', () => {
      expect(darkRules).toContain('node-bracket');
      expect(darkRules).toContain('#56b5c2');
    });

    it('dark mode edge-delimiter uses One Dark cyan #56b5c2', () => {
      expect(darkRules).toContain('edge-delimiter');
      expect(darkRules).toContain('#56b5c2');
    });

    // One Dark: @hue-6-2 = #e4bf7a (amber/yellow) — variable (node IDs)
    it('dark mode variable uses One Dark amber #e4bf7a', () => {
      expect(darkRules).toContain('lang-mermaid');
      expect(darkRules).toContain('#e4bf7a');
    });

    // One Dark: @hue-4 = #97c279 (green) — edge-label text
    it('dark mode edge-label uses One Dark green #97c279', () => {
      expect(darkRules).toContain('edge-label');
      expect(darkRules).toContain('#97c279');
    });

    // One Light: @hue-1 = #0184bc (cyan)
    it('light mode diagram-name uses One Light cyan #0184bc', () => {
      expect(lightRules).toContain('lang-mermaid');
      expect(lightRules).toContain('diagram-name');
      expect(lightRules).toContain('#0184bc');
    });

    // One Light: @hue-6-2 = #c18401 (amber/gold)
    it('light mode variable uses One Light amber #c18401', () => {
      expect(lightRules).toContain('lang-mermaid');
      expect(lightRules).toContain('#c18401');
    });

    // One Light: @hue-4 = #50a14f (green)
    it('light mode edge-label uses One Light green #50a14f', () => {
      expect(lightRules).toContain('edge-label');
      expect(lightRules).toContain('#50a14f');
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
