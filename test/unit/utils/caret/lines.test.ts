import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isCaretAtFirstLine, isCaretAtLastLine } from '../../../../src/components/utils/caret/lines';

describe('caret/lines', () => {
  const containerState = { element: null as HTMLElement | null };

  beforeEach(() => {
    containerState.element = document.createElement('div');
    document.body.appendChild(containerState.element);
  });

  afterEach(() => {
    // Clear selection
    window.getSelection()?.removeAllRanges();
    if (containerState.element) {
      containerState.element.remove();
      containerState.element = null;
    }
  });

  const getContainer = (): HTMLElement => {
    if (!containerState.element) {
      throw new Error('Container not initialized');
    }

    return containerState.element;
  };

  describe('isCaretAtFirstLine', () => {
    it('should return true for single-line INPUT elements', () => {
      const input = document.createElement('input');

      input.type = 'text';
      input.value = 'Hello world';
      getContainer().appendChild(input);
      input.focus();
      input.setSelectionRange(5, 5);

      const result = isCaretAtFirstLine(input);

      expect(result).toBe(true);
    });

    it('should return true for textarea when cursor is on first line', () => {
      const textarea = document.createElement('textarea');

      textarea.value = 'First line\nSecond line\nThird line';
      getContainer().appendChild(textarea);
      textarea.focus();
      textarea.setSelectionRange(5, 5); // Middle of first line

      const result = isCaretAtFirstLine(textarea);

      expect(result).toBe(true);
    });

    it('should return false for textarea when cursor is on second line', () => {
      const textarea = document.createElement('textarea');

      textarea.value = 'First line\nSecond line\nThird line';
      getContainer().appendChild(textarea);
      textarea.focus();
      textarea.setSelectionRange(15, 15); // Middle of second line

      const result = isCaretAtFirstLine(textarea);

      expect(result).toBe(false);
    });

    it('should return true when no selection exists', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      input.textContent = 'Hello world';
      getContainer().appendChild(input);

      // Clear any existing selection
      window.getSelection()?.removeAllRanges();

      const result = isCaretAtFirstLine(input);

      expect(result).toBe(true);
    });

    it('should return true for empty contenteditable', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      getContainer().appendChild(input);
      input.focus();

      const result = isCaretAtFirstLine(input);

      expect(result).toBe(true);
    });
  });

  describe('isCaretAtLastLine', () => {
    it('should return true for single-line INPUT elements', () => {
      const input = document.createElement('input');

      input.type = 'text';
      input.value = 'Hello world';
      getContainer().appendChild(input);
      input.focus();
      input.setSelectionRange(5, 5);

      const result = isCaretAtLastLine(input);

      expect(result).toBe(true);
    });

    it('should return true for textarea when cursor is on last line', () => {
      const textarea = document.createElement('textarea');

      textarea.value = 'First line\nSecond line\nThird line';
      getContainer().appendChild(textarea);
      textarea.focus();
      textarea.setSelectionRange(30, 30); // On third line

      const result = isCaretAtLastLine(textarea);

      expect(result).toBe(true);
    });

    it('should return false for textarea when cursor is on first line', () => {
      const textarea = document.createElement('textarea');

      textarea.value = 'First line\nSecond line\nThird line';
      getContainer().appendChild(textarea);
      textarea.focus();
      textarea.setSelectionRange(5, 5); // Middle of first line

      const result = isCaretAtLastLine(textarea);

      expect(result).toBe(false);
    });

    it('should return true when no selection exists', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      input.textContent = 'Hello world';
      getContainer().appendChild(input);

      // Clear any existing selection
      window.getSelection()?.removeAllRanges();

      const result = isCaretAtLastLine(input);

      expect(result).toBe(true);
    });

    it('should return true for empty contenteditable', () => {
      const input = document.createElement('div');

      input.contentEditable = 'true';
      getContainer().appendChild(input);
      input.focus();

      const result = isCaretAtLastLine(input);

      expect(result).toBe(true);
    });
  });
});
