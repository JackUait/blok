import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BoldNormalizationPass } from '../../../../../src/components/inline-tools/services/bold-normalization-pass';

describe('BoldNormalizationPass', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.setAttribute('data-blok-editor', '');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  describe('convertLegacyTags', () => {
    it('should convert <b> tags to <strong> tags', () => {
      container.innerHTML = '<b>Bold text</b>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.querySelector('b')).toBeNull();
      expect(container.querySelector('strong')).not.toBeNull();
      expect(container.querySelector('strong')?.textContent).toBe('Bold text');
    });

    it('should convert multiple <b> tags', () => {
      container.innerHTML = '<b>First</b> and <b>Second</b>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.querySelectorAll('b')).toHaveLength(0);
      expect(container.querySelectorAll('strong')).toHaveLength(2);
    });

    it('should preserve attributes when converting <b> to <strong>', () => {
      container.innerHTML = '<b id="test" data-custom="value" data-type="bold">Text</b>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      const strong = container.querySelector('strong');

      expect(strong?.getAttribute('id')).toBe('test');
      expect(strong?.getAttribute('data-custom')).toBe('value');
      expect(strong?.getAttribute('data-type')).toBe('bold');
    });

    it('should skip <b> conversion when convertLegacyTags is false', () => {
      container.innerHTML = '<b>Bold text</b>';

      const pass = new BoldNormalizationPass({ convertLegacyTags: false });

      pass.run(container);

      expect(container.querySelector('b')).not.toBeNull();
      expect(container.querySelector('strong')).toBeNull();
    });
  });

  describe('normalizeWhitespace', () => {
    it('should replace non-breaking spaces with regular spaces', () => {
      const nbsp = '\u00A0';

      container.innerHTML = `<p>Text${nbsp}with${nbsp}nbsp</p>`;

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.textContent).toBe('Text with nbsp');
      expect(container.textContent).not.toContain(nbsp);
    });

    it('should replace nbsp in multiple text nodes', () => {
      const nbsp = '\u00A0';

      container.innerHTML = `<p>First${nbsp}text</p><p>Second${nbsp}text</p>`;

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.textContent).not.toContain(nbsp);
    });

    it('should skip nbsp replacement when normalizeWhitespace is false', () => {
      const nbsp = '\u00A0';

      container.innerHTML = `<p>Text${nbsp}with${nbsp}nbsp</p>`;

      const pass = new BoldNormalizationPass({ normalizeWhitespace: false });

      pass.run(container);

      expect(container.textContent).toContain(nbsp);
    });
  });

  describe('removeEmpty', () => {
    it('should remove empty <strong> elements', () => {
      container.innerHTML = '<p>Text <strong></strong> more text</p>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.querySelector('strong')).toBeNull();
      expect(container.textContent).toBe('Text  more text');
    });

    it('should remove multiple empty <strong> elements', () => {
      container.innerHTML = '<p><strong></strong>Text<strong></strong></p>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.querySelectorAll('strong')).toHaveLength(0);
    });

    it('should not remove <strong> elements with content', () => {
      container.innerHTML = '<p><strong>Content</strong></p>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.querySelector('strong')).not.toBeNull();
      expect(container.querySelector('strong')?.textContent).toBe('Content');
    });

    it('should preserve empty <strong> when it contains preserveNode', () => {
      container.innerHTML = '<p>Text <strong id="target"></strong> more</p>';
      const preserveNode = container.querySelector('#target') as Node;

      const pass = new BoldNormalizationPass({ preserveNode });

      pass.run(container);

      expect(container.querySelector('strong')).not.toBeNull();
    });

    it('should preserve empty <strong> when preserveNode is inside it', () => {
      container.innerHTML = '<p>Text <strong id="target"><span id="inner"></span></strong> more</p>';
      const preserveNode = container.querySelector('#inner') as Node;

      const pass = new BoldNormalizationPass({ preserveNode });

      pass.run(container);

      expect(container.querySelector('strong')).not.toBeNull();
    });

    it('should preserve empty <strong> with data-blok-bold-collapsed-active attribute', () => {
      container.innerHTML = '<p>Text <strong data-blok-bold-collapsed-active="true"></strong> more</p>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.querySelector('strong')).not.toBeNull();
    });

    it('should preserve empty <strong> with data-blok-bold-collapsed-length attribute', () => {
      container.innerHTML = '<p>Text <strong data-blok-bold-collapsed-length="0"></strong> more</p>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.querySelector('strong')).not.toBeNull();
    });

    it('should skip empty removal when removeEmpty is false', () => {
      container.innerHTML = '<p>Text <strong></strong> more</p>';

      const pass = new BoldNormalizationPass({ removeEmpty: false });

      pass.run(container);

      expect(container.querySelector('strong')).not.toBeNull();
    });
  });

  describe('mergeAdjacent', () => {
    it('should merge adjacent <strong> elements', () => {
      container.innerHTML = '<p><strong>First</strong><strong>Second</strong></p>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      const strongs = container.querySelectorAll('strong');

      expect(strongs).toHaveLength(1);
      expect(strongs[0].textContent).toBe('FirstSecond');
    });

    it('should merge multiple consecutive <strong> elements', () => {
      container.innerHTML = '<p><strong>A</strong><strong>B</strong><strong>C</strong></p>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      const strongs = container.querySelectorAll('strong');

      expect(strongs).toHaveLength(1);
      expect(strongs[0].textContent).toBe('ABC');
    });

    it('should not merge <strong> elements separated by text', () => {
      container.innerHTML = '<p><strong>First</strong> text <strong>Second</strong></p>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.querySelectorAll('strong')).toHaveLength(2);
    });

    it('should not merge <strong> elements separated by other elements', () => {
      container.innerHTML = '<p><strong>First</strong><span>separator</span><strong>Second</strong></p>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.querySelectorAll('strong')).toHaveLength(2);
    });

    it('should merge <b> and <strong> after conversion', () => {
      container.innerHTML = '<p><b>First</b><strong>Second</strong></p>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      const strongs = container.querySelectorAll('strong');

      expect(strongs).toHaveLength(1);
      expect(strongs[0].textContent).toBe('FirstSecond');
    });

    it('should skip merging when mergeAdjacent is false', () => {
      container.innerHTML = '<p><strong>First</strong><strong>Second</strong></p>';

      const pass = new BoldNormalizationPass({ mergeAdjacent: false });

      pass.run(container);

      expect(container.querySelectorAll('strong')).toHaveLength(2);
    });
  });

  describe('combined operations', () => {
    it('should perform all operations in correct order', () => {
      const nbsp = '\u00A0';

      container.innerHTML = `<p><b>Bold${nbsp}text</b><strong></strong><strong>More</strong></p>`;

      const pass = new BoldNormalizationPass();

      pass.run(container);

      // Should convert <b> to <strong>
      expect(container.querySelector('b')).toBeNull();

      // Should merge adjacent <strong> elements
      expect(container.querySelectorAll('strong')).toHaveLength(1);

      // Should replace nbsp
      expect(container.textContent).not.toContain(nbsp);

      // Should remove empty <strong>
      expect(container.querySelector('strong')?.textContent).toBe('Bold textMore');
    });

    it('should handle complex nested structures', () => {
      container.innerHTML = '<div><p><b>A</b><strong>B</strong></p><p><strong></strong>Text</p></div>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      const firstP = container.querySelector('p:first-child');
      const secondP = container.querySelector('p:last-child');

      // First paragraph: <b>A</b><strong>B</strong> → <strong>AB</strong>
      expect(firstP?.querySelectorAll('strong')).toHaveLength(1);
      expect(firstP?.querySelector('strong')?.textContent).toBe('AB');

      // Second paragraph: empty <strong> removed
      expect(secondP?.querySelector('strong')).toBeNull();
    });
  });

  describe('normalizeAroundSelection', () => {
    it('should normalize block containing selection anchor', () => {
      container.innerHTML = '<p data-blok-component="paragraph"><b>Bold</b></p>';
      const textNode = container.querySelector('b')?.firstChild as Text;

      const selection = window.getSelection();

      if (selection && textNode) {
        const range = document.createRange();

        range.setStart(textNode, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);

        BoldNormalizationPass.normalizeAroundSelection(selection);

        expect(container.querySelector('b')).toBeNull();
        expect(container.querySelector('strong')).not.toBeNull();
      }
    });

    it('should handle null selection gracefully', () => {
      container.innerHTML = '<p><b>Bold</b></p>';

      // Should not throw
      expect(() => {
        BoldNormalizationPass.normalizeAroundSelection(null);
      }).not.toThrow();

      // Content should remain unchanged
      expect(container.querySelector('b')).not.toBeNull();
    });

    it('should find editor root when no block found', () => {
      container.innerHTML = '<div><b>Bold</b></div>';
      const textNode = container.querySelector('b')?.firstChild as Text;

      const selection = window.getSelection();

      if (selection && textNode) {
        const range = document.createRange();

        range.setStart(textNode, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);

        BoldNormalizationPass.normalizeAroundSelection(selection);

        expect(container.querySelector('b')).toBeNull();
        expect(container.querySelector('strong')).not.toBeNull();
      }
    });

    it('should pass options to normalization pass', () => {
      container.innerHTML = '<p data-blok-component="paragraph"><b>Bold</b></p>';
      const textNode = container.querySelector('b')?.firstChild as Text;

      const selection = window.getSelection();

      if (selection && textNode) {
        const range = document.createRange();

        range.setStart(textNode, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);

        BoldNormalizationPass.normalizeAroundSelection(selection, {
          convertLegacyTags: false,
        });

        // <b> should not be converted
        expect(container.querySelector('b')).not.toBeNull();
        expect(container.querySelector('strong')).toBeNull();
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty container', () => {
      container.innerHTML = '';

      const pass = new BoldNormalizationPass();

      expect(() => pass.run(container)).not.toThrow();
      expect(container.innerHTML).toBe('');
    });

    it('should handle container with no bold elements', () => {
      container.innerHTML = '<p>Regular text</p>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.innerHTML).toBe('<p>Regular text</p>');
    });

    it('should handle deeply nested bold elements', () => {
      container.innerHTML = '<div><span><p><b>Nested</b></p></span></div>';

      const pass = new BoldNormalizationPass();

      pass.run(container);

      expect(container.querySelector('b')).toBeNull();
      expect(container.querySelector('strong')).not.toBeNull();
      expect(container.querySelector('strong')?.textContent).toBe('Nested');
    });

    it('should not affect elements already removed during processing', () => {
      // This tests that we check isConnected before processing
      container.innerHTML = '<p><strong></strong><strong></strong></p>';

      const pass = new BoldNormalizationPass();

      // Should not throw even if elements are removed during iteration
      expect(() => pass.run(container)).not.toThrow();
      expect(container.querySelectorAll('strong')).toHaveLength(0);
    });
  });
});
