import { describe, it, expect } from 'vitest';
import {
  splitContentAtCursor,
  fragmentToHTML,
  parseHTML,
  isAtStart,
  isEntireContentSelected,
} from '../../../../src/tools/list/content-operations';

describe('content-operations', () => {
  describe('splitContentAtCursor', () => {
    it('splits plain text at cursor position', () => {
      const contentEl = document.createElement('div');
      contentEl.innerHTML = 'Hello World';
      const textNode = contentEl.firstChild;

      const range = document.createRange();
      if (textNode) {
        range.setStart(textNode, 5);
        range.collapse(true);
      }

      const result = splitContentAtCursor(contentEl, range);

      expect(result.beforeContent).toBe('Hello');
      expect(result.afterContent).toBe(' World');
    });

    it('handles cursor at start of content', () => {
      const contentEl = document.createElement('div');
      contentEl.innerHTML = 'Hello';
      const textNode = contentEl.firstChild;

      const range = document.createRange();
      if (textNode) {
        range.setStart(textNode, 0);
        range.collapse(true);
      }

      const result = splitContentAtCursor(contentEl, range);

      expect(result.beforeContent).toBe('');
      expect(result.afterContent).toBe('Hello');
    });

    it('handles cursor at end of content', () => {
      const contentEl = document.createElement('div');
      contentEl.innerHTML = 'Hello';
      const textNode = contentEl.firstChild;

      const range = document.createRange();
      if (textNode) {
        range.setStart(textNode, 5);
        range.collapse(true);
      }

      const result = splitContentAtCursor(contentEl, range);

      expect(result.beforeContent).toBe('Hello');
      expect(result.afterContent).toBe('');
    });

    it('splits HTML content with inline formatting', () => {
      const contentEl = document.createElement('div');
      contentEl.innerHTML = 'Hello <strong>World</strong>';
      const strongEl = contentEl.querySelector('strong');
      const textNode = strongEl?.firstChild;

      const range = document.createRange();
      if (textNode) {
        range.setStart(textNode, 2); // 'Wo' | 'rld'
        range.collapse(true);
      }

      const result = splitContentAtCursor(contentEl, range);

      expect(result.beforeContent).toContain('Hello');
      expect(result.beforeContent).toContain('<strong');
      expect(result.afterContent).toContain('</strong>');
    });

    it('handles empty content', () => {
      const contentEl = document.createElement('div');
      // Empty div with no children
      // When content is empty, create a range that would normally start at position 0
      // The function should handle this gracefully by returning empty strings
      const range = document.createRange();
      // Add a temporary text node to create valid range, then remove it
      const tempNode = document.createTextNode('');
      contentEl.appendChild(tempNode);
      range.setStart(tempNode, 0);
      range.setEnd(tempNode, 0);
      contentEl.removeChild(tempNode);

      const result = splitContentAtCursor(contentEl, range);

      expect(result.beforeContent).toBe('');
      expect(result.afterContent).toBe('');
    });
  });

  describe('fragmentToHTML', () => {
    it('converts text fragment to HTML string', () => {
      const fragment = document.createDocumentFragment();
      const textNode = document.createTextNode('Hello World');
      fragment.appendChild(textNode);

      const result = fragmentToHTML(fragment);

      expect(result).toBe('Hello World');
    });

    it('converts fragment with HTML elements', () => {
      const fragment = document.createDocumentFragment();
      const div = document.createElement('div');
      div.innerHTML = '<strong>Bold</strong> text';
      fragment.appendChild(div.firstChild as ChildNode);
      fragment.appendChild(document.createTextNode(' text'));

      const result = fragmentToHTML(fragment);

      expect(result).toContain('<strong>Bold</strong>');
    });

    it('returns empty string for empty fragment', () => {
      const fragment = document.createDocumentFragment();
      const result = fragmentToHTML(fragment);

      expect(result).toBe('');
    });

    it('handles multiple child nodes', () => {
      const fragment = document.createDocumentFragment();
      fragment.appendChild(document.createTextNode('First'));
      fragment.appendChild(document.createElement('br'));
      fragment.appendChild(document.createTextNode('Second'));

      const result = fragmentToHTML(fragment);

      expect(result).toContain('First');
      expect(result).toContain('<br>');
      expect(result).toContain('Second');
    });
  });

  describe('parseHTML', () => {
    it('parses HTML string to fragment', () => {
      const html = '<p>Hello</p>';
      const fragment = parseHTML(html);

      expect(fragment.childNodes).toHaveLength(1);
      const p = fragment.firstChild as HTMLElement;
      expect(p?.tagName).toBe('P');
      expect(p?.innerHTML).toBe('Hello');
    });

    it('handles plain text', () => {
      const html = 'Plain text';
      const fragment = parseHTML(html);

      expect(fragment.childNodes).toHaveLength(1);
      const textNode = fragment.firstChild as Text;
      expect(textNode?.nodeValue).toBe('Plain text');
    });

    it('handles multiple elements', () => {
      const html = '<p>First</p><p>Second</p>';
      const fragment = parseHTML(html);

      expect(fragment.childNodes).toHaveLength(2);
      expect((fragment.childNodes[0] as HTMLElement)?.tagName).toBe('P');
      expect((fragment.childNodes[1] as HTMLElement)?.tagName).toBe('P');
    });

    it('trims whitespace from input', () => {
      const html = '  <p>Hello</p>  ';
      const fragment = parseHTML(html);

      // Should not have whitespace-only text nodes at edges
      const firstChild = fragment.firstChild as HTMLElement;
      expect(firstChild?.tagName).toBe('P');
    });

    it('handles inline formatting', () => {
      const html = '<strong>Bold</strong> and <em>italic</em>';
      const fragment = parseHTML(html);

      expect(fragment.childNodes.length).toBeGreaterThan(0);
      const strong = fragment.querySelector('strong');
      expect(strong?.textContent).toBe('Bold');
    });
  });

  describe('isAtStart', () => {
    it('returns true when cursor is at start', () => {
      const element = document.createElement('div');
      element.textContent = 'Hello';

      const range = document.createRange();
      const textNode = element.firstChild;
      if (textNode) {
        range.setStart(textNode, 0);
        range.collapse(true);
      }

      expect(isAtStart(element, range)).toBe(true);
    });

    it('returns false when cursor is not at start', () => {
      const element = document.createElement('div');
      element.textContent = 'Hello';

      const range = document.createRange();
      const textNode = element.firstChild;
      if (textNode) {
        range.setStart(textNode, 2);
        range.collapse(true);
      }

      expect(isAtStart(element, range)).toBe(false);
    });

    it('handles empty element', () => {
      const element = document.createElement('div');

      const range = document.createRange();
      range.setStart(element, 0);
      range.collapse(true);

      expect(isAtStart(element, range)).toBe(true);
    });

    it('handles HTML content', () => {
      const element = document.createElement('div');
      element.innerHTML = '<strong>Bold</strong> text';
      const strong = element.querySelector('strong');
      const textNode = strong?.firstChild;

      const range = document.createRange();
      if (textNode) {
        range.setStart(textNode, 0);
        range.collapse(true);
      }

      // Cursor at start of bold text within the element
      expect(isAtStart(element, range)).toBe(true);
    });
  });

  describe('isEntireContentSelected', () => {
    it('returns true when entire content is selected', () => {
      const element = document.createElement('div');
      element.textContent = 'Hello';

      const range = document.createRange();
      const textNode = element.firstChild;
      if (textNode) {
        range.setStart(textNode, 0);
        range.setEnd(textNode, 5);
      }

      expect(isEntireContentSelected(element, range)).toBe(true);
    });

    it('returns false when only part is selected', () => {
      const element = document.createElement('div');
      element.textContent = 'Hello';

      const range = document.createRange();
      const textNode = element.firstChild;
      if (textNode) {
        range.setStart(textNode, 1);
        range.setEnd(textNode, 4);
      }

      expect(isEntireContentSelected(element, range)).toBe(false);
    });

    it('returns false for collapsed selection at start', () => {
      const element = document.createElement('div');
      element.textContent = 'Hello';

      const range = document.createRange();
      const textNode = element.firstChild;
      if (textNode) {
        range.setStart(textNode, 0);
        range.collapse(true);
      }

      expect(isEntireContentSelected(element, range)).toBe(false);
    });

    it('returns false for collapsed selection in middle', () => {
      const element = document.createElement('div');
      element.textContent = 'Hello';

      const range = document.createRange();
      const textNode = element.firstChild;
      if (textNode) {
        range.setStart(textNode, 2);
        range.collapse(true);
      }

      expect(isEntireContentSelected(element, range)).toBe(false);
    });

    it('handles empty element', () => {
      const element = document.createElement('div');

      const range = document.createRange();
      range.setStart(element, 0);
      range.collapse(true);

      expect(isEntireContentSelected(element, range)).toBe(true);
    });

    it('handles HTML content', () => {
      const element = document.createElement('div');
      element.innerHTML = '<strong>Bold</strong> text';

      const range = document.createRange();
      range.selectNodeContents(element);

      expect(isEntireContentSelected(element, range)).toBe(true);
    });
  });

  describe('round-trip conversions', () => {
    it('splitContentAtCursor and parseHTML are compatible', () => {
      const contentEl = document.createElement('div');
      contentEl.innerHTML = 'BeforeAfter';

      const range = document.createRange();
      const textNode = contentEl.firstChild;
      if (textNode) {
        range.setStart(textNode, 6);
        range.collapse(true);
      }

      const result = splitContentAtCursor(contentEl, range);

      // Can parse the result back
      const beforeFragment = parseHTML(result.beforeContent);
      const afterFragment = parseHTML(result.afterContent);

      expect(beforeFragment).toHaveTextContent('Before');
      expect(afterFragment).toHaveTextContent('After');
    });
  });
});
