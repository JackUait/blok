import { describe, it, expect } from 'vitest';
import {
  isPasteEventHTMLElement,
  detectStyleFromPastedContent,
  extractPastedContent,
} from '../../../../src/tools/list/paste-handler';

describe('paste-handler', () => {
  describe('isPasteEventHTMLElement', () => {
    it('returns true for HTMLElement', () => {
      const element = document.createElement('div');

      expect(isPasteEventHTMLElement(element)).toBe(true);
    });

    it('returns true for HTMLSpanElement', () => {
      const element = document.createElement('span');

      expect(isPasteEventHTMLElement(element)).toBe(true);
    });

    it('returns true for HTMLLIElement', () => {
      const element = document.createElement('li');

      expect(isPasteEventHTMLElement(element)).toBe(true);
    });

    it('returns false for null', () => {
      expect(isPasteEventHTMLElement(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isPasteEventHTMLElement(undefined)).toBe(false);
    });

    it('returns false for plain object', () => {
      expect(isPasteEventHTMLElement({})).toBe(false);
    });

    it('returns false for string', () => {
      expect(isPasteEventHTMLElement('string')).toBe(false);
    });

    it('returns false for number', () => {
      expect(isPasteEventHTMLElement(123)).toBe(false);
    });
  });

  describe('detectStyleFromPastedContent', () => {
    it('returns ordered when parent is OL', () => {
      const content = document.createElement('li');
      content.textContent = 'Item text';
      const ol = document.createElement('ol');
      ol.appendChild(content);

      const result = detectStyleFromPastedContent(content, 'unordered');

      expect(result).toBe('ordered');
    });

    it('returns unordered when parent is UL and no checkbox', () => {
      const content = document.createElement('li');
      content.textContent = 'Item text';
      const ul = document.createElement('ul');
      ul.appendChild(content);

      const result = detectStyleFromPastedContent(content, 'ordered');

      expect(result).toBe('unordered');
    });

    it('returns checklist when parent is UL and has checkbox', () => {
      const content = document.createElement('li');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      content.appendChild(checkbox);
      const ul = document.createElement('ul');
      ul.appendChild(content);

      const result = detectStyleFromPastedContent(content, 'ordered');

      expect(result).toBe('checklist');
    });

    it('returns checklist when checkbox is nested in content', () => {
      const content = document.createElement('li');
      const span = document.createElement('span');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      span.appendChild(checkbox);
      content.appendChild(span);
      const ul = document.createElement('ul');
      ul.appendChild(content);

      const result = detectStyleFromPastedContent(content, 'ordered');

      expect(result).toBe('checklist');
    });

    it('returns current style when parent is neither UL nor OL', () => {
      const content = document.createElement('div');
      content.textContent = 'Some text';
      const container = document.createElement('div');
      container.appendChild(content);

      const result = detectStyleFromPastedContent(content, 'checklist');

      expect(result).toBe('checklist');
    });

    it('returns current style when parent is UL but checkbox is not found', () => {
      const content = document.createElement('li');
      content.textContent = 'Item text';
      const ul = document.createElement('ul');
      ul.appendChild(content);

      const result = detectStyleFromPastedContent(content, 'checklist');

      expect(result).toBe('unordered');
    });

    it('returns current style when content has no parent', () => {
      const content = document.createElement('li');
      content.textContent = 'Orphan item';

      const result = detectStyleFromPastedContent(content, 'ordered');

      expect(result).toBe('ordered');
    });

    it('returns unordered when parent is UL and checkbox type is different', () => {
      const content = document.createElement('li');
      const input = document.createElement('input');
      input.type = 'text';
      content.appendChild(input);
      const ul = document.createElement('ul');
      ul.appendChild(content);

      const result = detectStyleFromPastedContent(content, 'checklist');

      expect(result).toBe('unordered');
    });
  });

  describe('extractPastedContent', () => {
    it('extracts text from innerHTML when available', () => {
      const content = document.createElement('li');
      content.innerHTML = '<strong>Bold text</strong>';

      const result = extractPastedContent(content);

      expect(result.text).toBe('<strong>Bold text</strong>');
    });

    it('extracts text from textContent when innerHTML is empty', () => {
      const content = document.createElement('li');
      content.textContent = 'Plain text';

      const result = extractPastedContent(content);

      expect(result.text).toBe('Plain text');
    });

    it('returns empty string when both innerHTML and textContent are empty', () => {
      const content = document.createElement('li');

      const result = extractPastedContent(content);

      expect(result.text).toBe('');
    });

    it('extracts checked state from checkbox when present', () => {
      const content = document.createElement('li');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      content.appendChild(checkbox);

      const result = extractPastedContent(content);

      expect(result.checked).toBe(true);
    });

    it('returns false when checkbox is not checked', () => {
      const content = document.createElement('li');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = false;
      content.appendChild(checkbox);

      const result = extractPastedContent(content);

      expect(result.checked).toBe(false);
    });

    it('returns false when checkbox is not present', () => {
      const content = document.createElement('li');
      content.textContent = 'Item text';

      const result = extractPastedContent(content);

      expect(result.checked).toBe(false);
    });

    it('extracts from nested checkbox', () => {
      const content = document.createElement('li');
      const span = document.createElement('span');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      span.appendChild(checkbox);
      content.appendChild(span);

      const result = extractPastedContent(content);

      expect(result.checked).toBe(true);
    });

    it('uses first checkbox when multiple exist', () => {
      const content = document.createElement('li');
      const checkbox1 = document.createElement('input');
      checkbox1.type = 'checkbox';
      checkbox1.checked = true;
      const checkbox2 = document.createElement('input');
      checkbox2.type = 'checkbox';
      checkbox2.checked = false;
      content.appendChild(checkbox1);
      content.appendChild(checkbox2);

      const result = extractPastedContent(content);

      expect(result.checked).toBe(true);
    });

    it('extracts text content with mixed HTML', () => {
      const content = document.createElement('li');
      content.innerHTML = 'Text with <b>bold</b> and <i>italic</i>';

      const result = extractPastedContent(content);

      expect(result.text).toContain('Text with');
      expect(result.text).toContain('<b>');
      expect(result.text).toContain('<i>');
    });

    it('handles content with only checkbox', () => {
      const content = document.createElement('li');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      content.appendChild(checkbox);

      const result = extractPastedContent(content);

      // innerHTML will include the checkbox element
      expect(result.text).toContain('input');
      expect(result.checked).toBe(true);
    });

    it('handles content with link', () => {
      const content = document.createElement('li');
      content.innerHTML = '<a href="https://example.com">Link text</a>';

      const result = extractPastedContent(content);

      expect(result.text).toContain('a href');
      expect(result.text).toContain('Link text');
    });
  });
});
