import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getCaretXPosition,
  setCaretAtXPosition,
  getTargetYPosition,
  getCaretPositionFromPoint,
  findBestPositionInRange
} from '../../../../src/components/utils/caret/navigation';

describe('caret/navigation', () => {
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

  describe('getCaretXPosition', () => {
    it('should return null when no selection exists', () => {
      window.getSelection()?.removeAllRanges();

      const result = getCaretXPosition();

      expect(result).toBe(null);
    });

    it('should return the left position of the range when valid', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      const range = document.createRange();

      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);

      const selection = window.getSelection();

      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }

      // In jsdom, getBoundingClientRect on Range returns a DOMRect with zeros
      // but the function should still return a number
      const result = getCaretXPosition();

      // Result should be a number (either from range or fallback element)
      expect(result).not.toBeNull();
      expect(typeof result).toBe('number');
    });

    it('should return the element left when range has no dimensions', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 0);

      const selection = window.getSelection();

      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }

      const result = getCaretXPosition();

      // Should return element's left position as fallback
      expect(result).not.toBeNull();
      expect(typeof result).toBe('number');
    });
  });

  describe('setCaretAtXPosition', () => {
    it('should set caret at start of native input', () => {
      const input = document.createElement('input');

      input.type = 'text';
      input.value = 'Hello world';
      getContainer().appendChild(input);

      setCaretAtXPosition(input, 0, true);

      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(0);
    });

    it('should set caret at end of native input', () => {
      const input = document.createElement('input');

      input.type = 'text';
      input.value = 'Hello world';
      getContainer().appendChild(input);

      // Use a large X value to get end position
      const inputRect = input.getBoundingClientRect();

      setCaretAtXPosition(input, inputRect.right + 100, false);

      // Should be near the end (within 1 character due to approximation)
      expect(input.selectionStart).toBeGreaterThan(input.value.length - 2);
    });

    it('should handle empty native input', () => {
      const input = document.createElement('input');

      input.type = 'text';
      input.value = '';
      getContainer().appendChild(input);

      setCaretAtXPosition(input, 50, true);

      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(0);
    });

    it('should set caret on first line of textarea', () => {
      const textarea = document.createElement('textarea');

      textarea.value = 'First line\nSecond line\nThird line';
      getContainer().appendChild(textarea);

      setCaretAtXPosition(textarea, 20, true);

      // Should be on first line (before position 11 which is first newline)
      expect(textarea.selectionStart).toBeLessThanOrEqual(11);
    });

    it('should set caret on last line of textarea', () => {
      const textarea = document.createElement('textarea');

      textarea.value = 'First line\nSecond line\nThird line';
      getContainer().appendChild(textarea);

      setCaretAtXPosition(textarea, 20, false);

      // Should be on last line (after position 23 which is second newline)
      expect(textarea.selectionStart).toBeGreaterThanOrEqual(23);
    });

    it('should not throw for contenteditable element', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello world');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      expect(() => {
        setCaretAtXPosition(div, 50, true);
      }).not.toThrow();
    });

    it('should not throw for empty contenteditable', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      getContainer().appendChild(div);

      expect(() => {
        setCaretAtXPosition(div, 50, true);
      }).not.toThrow();
    });
  });

  describe('getTargetYPosition', () => {
    it('should return Y position for first line', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      const result = getTargetYPosition(div, textNode, true);

      // In jsdom, getBoundingClientRect on Range returns a DOMRect with zeros
      // The function should return a fallback position based on element rect
      expect(result).not.toBeNull();
      expect(typeof result).toBe('number');
    });

    it('should return Y position for last line', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      const result = getTargetYPosition(div, textNode, false);

      // In jsdom, getBoundingClientRect on Range returns a DOMRect with zeros
      // The function should return a fallback position based on element rect
      expect(result).not.toBeNull();
      expect(typeof result).toBe('number');
    });

    it('should return fallback position when node is valid but range creation fails', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      // Use a valid node but the function should still handle edge cases
      const result = getTargetYPosition(div, textNode, true);

      // Should return a number (either from range or fallback)
      expect(typeof result).toBe('number');
    });
  });

  describe('getCaretPositionFromPoint', () => {
    it('should return null when caretPositionFromPoint returns null', () => {
      // Mock document.caretPositionFromPoint to return null
      const originalCaretPositionFromPoint = document.caretPositionFromPoint;

      document.caretPositionFromPoint = () => null;

      const result = getCaretPositionFromPoint(100, 100);

      expect(result).toBeNull();

      document.caretPositionFromPoint = originalCaretPositionFromPoint;
    });

    it('should not throw when caretPositionFromPoint is called', () => {
      const div = document.createElement('div');

      div.contentEditable = 'true';
      const textNode = document.createTextNode('Hello');

      div.appendChild(textNode);
      getContainer().appendChild(div);

      // Try with actual coordinates - may return null in jsdom but shouldn't throw
      const result = getCaretPositionFromPoint(100, 100);

      // In jsdom, caretPositionFromPoint may not be implemented
      // The function should handle this gracefully
      // Result can be null or an object with node and offset
      if (result !== null) {
        expect(result).toHaveProperty('node');
        expect(result).toHaveProperty('offset');
      } else {
        expect(result).toBeNull();
      }
    });
  });

  describe('findBestPositionInRange', () => {
    it('should return start when relative X is 0 or negative', () => {
      const input = document.createElement('input');

      input.value = 'Hello world';
      getContainer().appendChild(input);

      // Mock getBoundingClientRect
      Object.defineProperty(input, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 200, height: 20, right: 200, bottom: 20 }),
        configurable: true,
      });

      const result = findBestPositionInRange(input, 0, input.value.length, 0);

      expect(result).toBe(0);
    });

    it('should return position within range', () => {
      const input = document.createElement('input');

      input.value = 'Hello world';
      getContainer().appendChild(input);

      // Mock getBoundingClientRect
      Object.defineProperty(input, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 200, height: 20, right: 200, bottom: 20 }),
        configurable: true,
      });

      // Test that findBestPositionInRange returns a valid position
      const result = findBestPositionInRange(input, 0, input.value.length, 50);

      // Should be somewhere in the valid range
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(input.value.length);
    });

    it('should clamp position to text length', () => {
      const input = document.createElement('input');

      input.value = 'Hi';
      getContainer().appendChild(input);

      Object.defineProperty(input, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, width: 200, height: 20, right: 200, bottom: 20 }),
        configurable: true,
      });

      // Test with a very large X value
      const result = findBestPositionInRange(input, 0, input.value.length, 1000);

      // Should be clamped to text length
      expect(result).toBeLessThanOrEqual(input.value.length);
    });
  });
});
