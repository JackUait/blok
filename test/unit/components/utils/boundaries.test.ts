import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  checkContenteditableSliceForEmptiness,
  isCaretAtStartOfInput,
  isCaretAtEndOfInput,
} from '../../../../src/components/utils/caret/boundaries';
import { Dom as $ } from '../../../../src/components/dom';

describe('Caret boundary utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  describe('checkContenteditableSliceForEmptiness', () => {
    const createCaretInElement = (element: HTMLElement, offset: number): void => {
      const textNode = element.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    it('returns true when left slice is empty', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      createCaretInElement(div, 0);

      const result = checkContenteditableSliceForEmptiness(div, div.firstChild as Node, 0, 'left');

      expect(result).toBe(true);
    });

    it('returns false when left slice has text', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      createCaretInElement(div, 2);

      const result = checkContenteditableSliceForEmptiness(div, div.firstChild as Node, 2, 'left');

      expect(result).toBe(false);
    });

    it('returns true when right slice is empty', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      createCaretInElement(div, 4);

      const result = checkContenteditableSliceForEmptiness(div, div.firstChild as Node, 4, 'right');

      expect(result).toBe(true);
    });

    it('returns false when right slice has text', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      createCaretInElement(div, 2);

      const result = checkContenteditableSliceForEmptiness(div, div.firstChild as Node, 2, 'right');

      expect(result).toBe(false);
    });

    it('returns false when slice contains an image', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = 'text<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="1" height="1">more';
      document.body.appendChild(div);

      const textNode = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = checkContenteditableSliceForEmptiness(div, textNode, 2, 'right');

      expect(result).toBe(false);
    });

    it('returns false when slice contains a br tag', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = 'text<br>more';
      document.body.appendChild(div);

      const textNode = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = checkContenteditableSliceForEmptiness(div, textNode, 2, 'right');

      expect(result).toBe(false);
    });

    it('returns false when slice contains non-breaking space (\\u00A0)', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text\u00A0more';
      document.body.appendChild(div);

      const textNode = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = checkContenteditableSliceForEmptiness(div, textNode, 4, 'left');

      expect(result).toBe(false);
    });

    it('returns false when slice contains &nbsp; in HTML', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = 'text&nbsp;more';
      document.body.appendChild(div);

      const textNode = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = checkContenteditableSliceForEmptiness(div, textNode, 4, 'left');

      expect(result).toBe(false);
    });

    it('returns false when visual width is greater than zero', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = '<span style="display:inline-block;width:10px"></span>';
      document.body.appendChild(div);

      const span = div.querySelector('span') as HTMLElement;
      const range = document.createRange();
      range.setStart(span, 0);
      range.setEnd(span, 0);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = checkContenteditableSliceForEmptiness(div, span, 0, 'right');

      // The span has width, so it should not be considered empty
      expect(result).toBe(false);
    });

    it('returns true for collapsed whitespace', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = '   ';
      document.body.appendChild(div);

      const textNode = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 1);
      range.setEnd(textNode, 1);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = checkContenteditableSliceForEmptiness(div, textNode, 1, 'left');

      expect(result).toBe(true);
    });

    it('returns false for non-collapsed whitespace in pre element', () => {
      const pre = document.createElement('pre');
      pre.contentEditable = 'true';
      pre.textContent = '   ';
      pre.style.whiteSpace = 'pre';
      document.body.appendChild(pre);

      const textNode = pre.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 1);
      range.setEnd(textNode, 1);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = checkContenteditableSliceForEmptiness(pre, textNode, 1, 'left');

      expect(result).toBe(false);
    });

    it('checks NBSP in text node itself', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = '\u00A0';
      document.body.appendChild(div);

      const textNode = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 0);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = checkContenteditableSliceForEmptiness(div, textNode, 0, 'right');

      expect(result).toBe(false);
    });
  });

  describe('isCaretAtStartOfInput', () => {
    const setCaretAt = (element: HTMLElement, offset: number): void => {
      const textNode = element.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    it('returns true for empty input', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);

      const result = isCaretAtStartOfInput(div);

      expect(result).toBe(true);
    });

    it('returns true when caret is at start of native input', () => {
      const input = document.createElement('input');
      input.value = 'text';
      document.body.appendChild(input);

      input.setSelectionRange(0, 0);
      input.focus();

      const result = isCaretAtStartOfInput(input);

      expect(result).toBe(true);
    });

    it('returns false when caret is not at start of native input', () => {
      const input = document.createElement('input');
      input.value = 'text';
      document.body.appendChild(input);

      input.setSelectionRange(2, 2);
      input.focus();

      const result = isCaretAtStartOfInput(input);

      expect(result).toBe(false);
    });

    it('returns true when caret is at start of contenteditable', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      setCaretAt(div, 0);

      const result = isCaretAtStartOfInput(div);

      expect(result).toBe(true);
    });

    it('returns false when caret is in middle of contenteditable', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      setCaretAt(div, 2);

      const result = isCaretAtStartOfInput(div);

      expect(result).toBe(false);
    });

    it('returns true when only whitespace before caret', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = '  text';
      document.body.appendChild(div);

      setCaretAt(div, 2);

      const result = isCaretAtStartOfInput(div);

      expect(result).toBe(true);
    });

    it('returns false when NBSP before caret', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = '\u00A0text';
      document.body.appendChild(div);

      setCaretAt(div, 1);

      const result = isCaretAtStartOfInput(div);

      expect(result).toBe(false);
    });

    it('returns false when caret is inside nested tag', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = '<b>bold</b>';
      document.body.appendChild(div);

      const boldText = div.querySelector('b')?.firstChild as Text;
      const range = document.createRange();
      range.setStart(boldText, 0);
      range.setEnd(boldText, 0);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = isCaretAtStartOfInput(div);

      expect(result).toBe(false);
    });

    it('returns false when no selection exists', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      window.getSelection()?.removeAllRanges();

      const result = isCaretAtStartOfInput(div);

      expect(result).toBe(false);
    });

    it('returns true when input is empty via isEmpty check', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);

      const isEmptySpy = vi.spyOn($, 'isEmpty').mockReturnValue(true);

      const result = isCaretAtStartOfInput(div);

      expect(result).toBe(true);
      isEmptySpy.mockRestore();
    });
  });

  describe('isCaretAtEndOfInput', () => {
    const setCaretAt = (element: HTMLElement, offset: number): void => {
      const textNode = element.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };

    it('returns true when caret is at end of native input', () => {
      const input = document.createElement('input');
      input.value = 'text';
      document.body.appendChild(input);

      input.setSelectionRange(4, 4);
      input.focus();

      const result = isCaretAtEndOfInput(input);

      expect(result).toBe(true);
    });

    it('returns false when caret is not at end of native input', () => {
      const input = document.createElement('input');
      input.value = 'text';
      document.body.appendChild(input);

      input.setSelectionRange(2, 2);
      input.focus();

      const result = isCaretAtEndOfInput(input);

      expect(result).toBe(false);
    });

    it('returns true when caret is at end of contenteditable', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      setCaretAt(div, 4);

      const result = isCaretAtEndOfInput(div);

      expect(result).toBe(true);
    });

    it('returns false when caret is in middle of contenteditable', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      setCaretAt(div, 2);

      const result = isCaretAtEndOfInput(div);

      expect(result).toBe(false);
    });

    it('returns true when only whitespace after caret', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text  ';
      document.body.appendChild(div);

      setCaretAt(div, 4);

      const result = isCaretAtEndOfInput(div);

      expect(result).toBe(true);
    });

    it('returns false when NBSP after caret', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text\u00A0';
      document.body.appendChild(div);

      setCaretAt(div, 4);

      const result = isCaretAtEndOfInput(div);

      expect(result).toBe(false);
    });

    it('returns false when no selection exists', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      window.getSelection()?.removeAllRanges();

      const result = isCaretAtEndOfInput(div);

      expect(result).toBe(false);
    });

    it('returns true for empty contenteditable', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);

      const result = isCaretAtEndOfInput(div);

      expect(result).toBe(true);
    });

    it('handles nested elements for end position', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = 'text<b>bold</b>';
      document.body.appendChild(div);

      const boldText = div.querySelector('b')?.firstChild as Text;
      const range = document.createRange();
      range.setStart(boldText, 4);
      range.setEnd(boldText, 4);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = isCaretAtEndOfInput(div);

      expect(result).toBe(true);
    });
  });
});
