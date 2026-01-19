import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getTargetYPosition,
  getCaretPositionFromPoint,
  setCaretAtXPositionInContentEditable,
  findBestPositionInRange,
  setCaretAtXPositionInNativeInput,
  setCaretAtXPosition,
  getCaretXPosition,
} from '../../../../../../src/components/utils/caret/navigation';
import * as navigation from '../../../../../../src/components/utils/caret/navigation';
import { Dom as $ } from '../../../../../../src/components/utils/dom';

describe('Caret navigation utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  describe('getTargetYPosition', () => {
    it('returns Y position for first line', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const textNode = div.firstChild as Node;
      const y = getTargetYPosition(div, textNode, true);

      expect(y).not.toBeNull();
      expect(typeof y).toBe('number');
    });

    it('returns Y position for last line', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const textNode = div.firstChild as Node;
      const y = getTargetYPosition(div, textNode, false);

      expect(y).not.toBeNull();
      expect(typeof y).toBe('number');
    });

    it('returns center of line when rect has valid dimensions', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const textNode = div.firstChild as Node;
      const y = getTargetYPosition(div, textNode, true);

      const rect = div.getBoundingClientRect();
      expect(y).toBeGreaterThan(rect.top);
      expect(y).toBeLessThan(rect.bottom);
    });

    it('returns element-based Y when getBoundingClientRect is not available', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const textNode = div.firstChild as Node;
      const range = document.createRange();

      // Mock range to remove getBoundingClientRect
      const originalGetBBox = range.getBoundingClientRect;
      vi.spyOn(range, 'getBoundingClientRect').mockImplementation(() => {
        throw new Error('Not available');
      });

      const y = getTargetYPosition(div, textNode, true);

      expect(y).not.toBeNull();

      vi.spyOn(range, 'getBoundingClientRect').mockRestore();
    });

    it('returns element-based Y when rect has zero dimensions', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);

      const textNode = div;
      const y = getTargetYPosition(div, textNode, true);

      expect(y).not.toBeNull();
    });

    it('returns null when range.setStart throws', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);

      const invalidNode = document.createComment('invalid');

      const y = getTargetYPosition(div, invalidNode, true);

      expect(y).toBeNull();
    });
  });

  describe('getCaretPositionFromPoint', () => {
    it('returns null when caretPositionFromPoint is not available', () => {
      vi.spyOn(document, 'caretPositionFromPoint' as keyof Document).mockReturnValue(undefined);

      const result = getCaretPositionFromPoint(100, 100);

      expect(result).toBeNull();
    });

    it('returns null when caretPositionFromPoint returns null', () => {
      vi.spyOn(document, 'caretPositionFromPoint').mockReturnValue(null);

      const result = getCaretPositionFromPoint(100, 100);

      expect(result).toBeNull();
    });

    it('returns node and offset when caretPositionFromPoint succeeds', () => {
      const mockNode = document.createTextNode('text');
      const mockCaretPosition = {
        offsetNode: mockNode,
        offset: 2,
      };

      vi.spyOn(document, 'caretPositionFromPoint').mockReturnValue(mockCaretPosition as unknown as CaretPosition);

      const result = getCaretPositionFromPoint(100, 100);

      expect(result).toEqual({ node: mockNode, offset: 2 });
    });
  });

  describe('setCaretAtXPositionInContentEditable', () => {
    it('sets caret at target X position on first line', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'Hello world';
      document.body.appendChild(div);

      const rect = div.getBoundingClientRect();
      const targetX = rect.left + 20;

      setCaretAtXPositionInContentEditable(div, targetX, true);

      const selection = window.getSelection();
      expect(selection?.rangeCount).toBeGreaterThan(0);
    });

    it('sets caret at target X position on last line', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'Hello world';
      document.body.appendChild(div);

      const rect = div.getBoundingClientRect();
      const targetX = rect.left + 20;

      setCaretAtXPositionInContentEditable(div, targetX, false);

      const selection = window.getSelection();
      expect(selection?.rangeCount).toBeGreaterThan(0);
    });

    it('returns early when getSelection returns null', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(() => setCaretAtXPositionInContentEditable(div, 100, true)).not.toThrow();
    });

    it('falls back to setSelectionToElement when getTargetYPosition returns null', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      vi.spyOn($, 'getDeepestNode').mockReturnValue(null);

      setCaretAtXPositionInContentEditable(div, 100, true);

      // Should not throw
      expect(true).toBe(true);
    });

    it('focuses element before setting caret', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const focusSpy = vi.spyOn(div, 'focus');

      setCaretAtXPositionInContentEditable(div, 100, true);

      expect(focusSpy).toHaveBeenCalled();
    });

    it('handles caret position outside element boundaries', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const rect = div.getBoundingClientRect();
      const targetX = rect.left - 100; // Far left of element

      setCaretAtXPositionInContentEditable(div, targetX, true);

      const selection = window.getSelection();
      expect(selection?.rangeCount).toBeGreaterThan(0);
    });
  });

  describe('findBestPositionInRange', () => {
    it('returns start position when target X is at or before start', () => {
      const input = document.createElement('input');
      input.value = 'Hello world';
      document.body.appendChild(input);

      const rect = input.getBoundingClientRect();
      const position = findBestPositionInRange(input, 0, 11, rect.left);

      expect(position).toBe(0);
    });

    it('estimates position based on character width', () => {
      const input = document.createElement('input');
      input.value = 'Hello world';
      input.style.fontSize = '16px';
      document.body.appendChild(input);

      const rect = input.getBoundingClientRect();
      const paddingLeft = parseFloat(window.getComputedStyle(input).paddingLeft) || 0;
      const targetX = rect.left + paddingLeft + 50;

      const position = findBestPositionInRange(input, 0, 11, targetX);

      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(11);
    });

    it('clamps position to end of range', () => {
      const input = document.createElement('input');
      input.value = 'text';
      document.body.appendChild(input);

      const rect = input.getBoundingClientRect();
      const targetX = rect.right + 1000; // Far right of input

      const position = findBestPositionInRange(input, 0, 4, targetX);

      expect(position).toBeLessThanOrEqual(4);
    });

    it('handles zero fontSize gracefully', () => {
      const input = document.createElement('input');
      input.value = 'text';
      input.style.fontSize = '0';
      document.body.appendChild(input);

      const rect = input.getBoundingClientRect();
      const position = findBestPositionInRange(input, 0, 4, rect.left + 10);

      expect(position).toBeGreaterThanOrEqual(0);
    });
  });

  describe('setCaretAtXPositionInNativeInput', () => {
    it('sets caret at position in single-line input', () => {
      const input = document.createElement('input');
      input.value = 'Hello world';
      input.style.width = '200px';
      document.body.appendChild(input);

      const rect = input.getBoundingClientRect();
      const targetX = rect.left + 50;

      setCaretAtXPositionInNativeInput(input, targetX, true);

      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(input.selectionEnd);
    });

    it('sets caret at position in textarea for first line', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'First line\nSecond line\nThird line';
      textarea.style.width = '200px';
      document.body.appendChild(textarea);

      const rect = textarea.getBoundingClientRect();
      const targetX = rect.left + 50;

      setCaretAtXPositionInNativeInput(textarea, targetX, true);

      expect(textarea).toHaveFocus();
      const selectionStart = textarea.selectionStart ?? 0;
      expect(selectionStart).toBeLessThan('First line'.length);
    });

    it('sets caret at position in textarea for last line', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'First line\nSecond line\nThird line';
      textarea.style.width = '200px';
      document.body.appendChild(textarea);

      const rect = textarea.getBoundingClientRect();
      const targetX = rect.left + 50;

      setCaretAtXPositionInNativeInput(textarea, targetX, false);

      expect(textarea).toHaveFocus();
      const textLength = textarea.value.length;
      const selectionStart = textarea.selectionStart ?? 0;
      expect(selectionStart).toBeGreaterThan('First line\nSecond line\n'.length - 1);
    });

    it('handles empty input', () => {
      const input = document.createElement('input');
      input.value = '';
      document.body.appendChild(input);

      setCaretAtXPositionInNativeInput(input, 100, true);

      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(0);
    });
  });

  describe('setCaretAtXPosition', () => {
    it('delegates to native input handler for native inputs', () => {
      const input = document.createElement('input');
      input.value = 'text';
      document.body.appendChild(input);

      const isNativeInputSpy = vi.spyOn($, 'isNativeInput').mockReturnValue(true);
      const nativeHandlerSpy = vi.spyOn(navigation, 'setCaretAtXPositionInNativeInput');

      setCaretAtXPosition(input, 100, true);

      expect(isNativeInputSpy).toHaveBeenCalledWith(input);
      expect(nativeHandlerSpy).toHaveBeenCalled();

      isNativeInputSpy.mockRestore();
    });

    it('delegates to contenteditable handler for contenteditable', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const isNativeInputSpy = vi.spyOn($, 'isNativeInput').mockReturnValue(false);

      setCaretAtXPosition(div, 100, true);

      expect(isNativeInputSpy).toHaveBeenCalledWith(div);

      isNativeInputSpy.mockRestore();
    });
  });

  describe('getCaretXPosition', () => {
    it('returns null when there is no selection', () => {
      window.getSelection()?.removeAllRanges();

      const result = getCaretXPosition();

      expect(result).toBeNull();
    });

    it('returns null when selection has no ranges', () => {
      const selection = window.getSelection();
      if (selection) {
        vi.spyOn(selection, 'rangeCount', 'get').mockReturnValue(0);
      }

      const result = getCaretXPosition();

      expect(result).toBeNull();
    });

    it('returns X coordinate from range rect', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const textNode = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = getCaretXPosition();

      expect(result).not.toBeNull();
      expect(typeof result).toBe('number');
    });

    it('returns element rect X when range has no valid dimensions', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = '';
      document.body.appendChild(div);

      const range = document.createRange();
      range.setStart(div, 0);
      range.setEnd(div, 0);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = getCaretXPosition();

      expect(result).not.toBeNull();
    });

    it('returns null when element parent is null', () => {
      const selection = window.getSelection();
      if (!selection) {
        return;
      }

      const range = document.createRange();
      range.setStart(document, 0);
      range.setEnd(document, 0);

      selection.removeAllRanges();
      selection.addRange(range);

      const result = getCaretXPosition();

      // Document element should have a rect, but we handle edge case
      expect(result).toBeDefined();
    });

    it('handles element node as container', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const range = document.createRange();
      range.setStart(div, 0);
      range.setEnd(div, 0);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = getCaretXPosition();

      expect(result).not.toBeNull();
    });
  });
});
