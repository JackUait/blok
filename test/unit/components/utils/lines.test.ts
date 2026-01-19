import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getValidCaretRect,
  isCaretAtFirstLine,
  isCaretAtLastLine,
} from '../../../../../../src/components/utils/caret/lines';
import { Dom as $ } from '../../../../../../src/components/utils/dom';

describe('Caret line detection utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  describe('getValidCaretRect', () => {
    it('returns range rect when it has valid dimensions', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const textNode = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);

      const rect = getValidCaretRect(range, div);

      expect(rect.height).not.toBe(0);
      expect(rect.top).not.toBe(0);
    });

    it('returns element rect when range rect has zero dimensions', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = '';
      document.body.appendChild(div);

      const range = document.createRange();
      range.setStart(div, 0);
      range.setEnd(div, 0);

      const divRect = div.getBoundingClientRect();
      const rect = getValidCaretRect(range, div);

      // Should fall back to element rect
      expect(rect).toBeDefined();
    });

    it('returns input rect when both range and element rects are invalid', () => {
      const range = document.createRange();
      const input = document.createElement('input');
      document.body.appendChild(input);

      const inputRect = input.getBoundingClientRect();
      const rect = getValidCaretRect(range, input);

      expect(rect).toBeDefined();
    });

    it('handles element node as container', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const range = document.createRange();
      range.setStart(div, 0);
      range.setEnd(div, 0);

      const rect = getValidCaretRect(range, div);

      expect(rect).toBeDefined();
    });
  });

  describe('isCaretAtFirstLine', () => {
    const setCaretAt = (element: HTMLElement, offset: number): void => {
      const textNode = element.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    it('returns true for single-line native input', () => {
      const input = document.createElement('input');
      input.value = 'text';
      document.body.appendChild(input);

      input.focus();

      const result = isCaretAtFirstLine(input);

      expect(result).toBe(true);
    });

    it('returns true for textarea when cursor is before first newline', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'first line\nsecond line';
      document.body.appendChild(textarea);

      textarea.setSelectionRange(5, 5);
      textarea.focus();

      const result = isCaretAtFirstLine(textarea);

      expect(result).toBe(true);
    });

    it('returns false for textarea when cursor is after first newline', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'first line\nsecond line';
      document.body.appendChild(textarea);

      textarea.setSelectionRange(12, 12);
      textarea.focus();

      const result = isCaretAtFirstLine(textarea);

      expect(result).toBe(false);
    });

    it('returns true for contenteditable when caret is on first line', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'single line';
      document.body.appendChild(div);

      setCaretAt(div, 5);

      const result = isCaretAtFirstLine(div);

      expect(result).toBe(true);
    });

    it('returns true when caret is at start of contenteditable', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      setCaretAt(div, 0);

      const result = isCaretAtFirstLine(div);

      expect(result).toBe(true);
    });

    it('returns true when there is no selection', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      window.getSelection()?.removeAllRanges();

      const result = isCaretAtFirstLine(div);

      expect(result).toBe(true);
    });

    it('returns true when getDeepestNode returns null', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);

      vi.spyOn($, 'getDeepestNode').mockReturnValue(null);

      const result = isCaretAtFirstLine(div);

      expect(result).toBe(true);
    });

    it('handles zero-dimension first line rect with fallback', () => {
      const div = document.createElement('div');
      div.style.fontSize = '16px';
      div.style.lineHeight = '24px';
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      setCaretAt(div, 2);

      const result = isCaretAtFirstLine(div);

      expect(result).toBe(true);
    });

    it('compares caret position with first line position', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'First line\nSecond line';
      document.body.appendChild(div);

      setCaretAt(div, 5);

      const result = isCaretAtFirstLine(div);

      expect(result).toBe(true);
    });

    it('returns false when caret is on second line', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = 'Line 1<br>Line 2';
      document.body.appendChild(div);

      const secondLineText = div.lastChild as Text;
      const range = document.createRange();
      range.setStart(secondLineText, 2);
      range.setEnd(secondLineText, 2);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = isCaretAtFirstLine(div);

      expect(result).toBe(false);
    });

    it('handles nested elements correctly', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = '<b>bold text</b>';
      document.body.appendChild(div);

      const boldText = div.querySelector('b')?.firstChild as Text;
      const range = document.createRange();
      range.setStart(boldText, 4);
      range.setEnd(boldText, 4);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = isCaretAtFirstLine(div);

      expect(result).toBe(true);
    });

    it('returns true when caret and first line are within threshold', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      setCaretAt(div, 2);

      const result = isCaretAtFirstLine(div);

      expect(result).toBe(true);
    });
  });

  describe('isCaretAtLastLine', () => {
    const setCaretAt = (element: HTMLElement, offset: number): void => {
      const textNode = element.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    it('returns true for single-line native input', () => {
      const input = document.createElement('input');
      input.value = 'text';
      document.body.appendChild(input);

      input.focus();

      const result = isCaretAtLastLine(input);

      expect(result).toBe(true);
    });

    it('returns true for textarea when cursor is after last newline', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'first line\nsecond line';
      document.body.appendChild(textarea);

      textarea.setSelectionRange(15, 15);
      textarea.focus();

      const result = isCaretAtLastLine(textarea);

      expect(result).toBe(true);
    });

    it('returns false for textarea when cursor is before last newline', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'first line\nsecond line';
      document.body.appendChild(textarea);

      textarea.setSelectionRange(5, 5);
      textarea.focus();

      const result = isCaretAtLastLine(textarea);

      expect(result).toBe(false);
    });

    it('returns true for contenteditable when caret is on last line', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'single line';
      document.body.appendChild(div);

      setCaretAt(div, 5);

      const result = isCaretAtLastLine(div);

      expect(result).toBe(true);
    });

    it('returns true when caret is at end of contenteditable', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      setCaretAt(div, 4);

      const result = isCaretAtLastLine(div);

      expect(result).toBe(true);
    });

    it('returns true when there is no selection', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      window.getSelection()?.removeAllRanges();

      const result = isCaretAtLastLine(div);

      expect(result).toBe(true);
    });

    it('returns true when getDeepestNode returns null', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);

      vi.spyOn($, 'getDeepestNode').mockReturnValue(null);

      const result = isCaretAtLastLine(div);

      expect(result).toBe(true);
    });

    it('handles zero-dimension last line rect with fallback', () => {
      const div = document.createElement('div');
      div.style.fontSize = '16px';
      div.style.lineHeight = '24px';
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      setCaretAt(div, 2);

      const result = isCaretAtLastLine(div);

      expect(result).toBe(true);
    });

    it('returns false when caret is on first line of multi-line content', () => {
      const div = document.createElement('div');
      div.style.width = '100px';
      div.contentEditable = 'true';
      div.innerHTML = 'Line 1<br>Line 2';
      document.body.appendChild(div);

      const firstLineText = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(firstLineText, 2);
      range.setEnd(firstLineText, 2);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = isCaretAtLastLine(div);

      expect(result).toBe(false);
    });

    it('handles nested elements correctly', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = '<b>bold text</b>';
      document.body.appendChild(div);

      const boldText = div.querySelector('b')?.firstChild as Text;
      const range = document.createRange();
      range.setStart(boldText, 4);
      range.setEnd(boldText, 4);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = isCaretAtLastLine(div);

      expect(result).toBe(true);
    });

    it('compares caret position with last line position', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'only one line';
      document.body.appendChild(div);

      setCaretAt(div, 8);

      const result = isCaretAtLastLine(div);

      expect(result).toBe(true);
    });

    it('returns true when caret and last line are within threshold', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      setCaretAt(div, 2);

      const result = isCaretAtLastLine(div);

      expect(result).toBe(true);
    });
  });
});
