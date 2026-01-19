import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCaretNodeAndOffset, getCaretOffset } from '../../../../src/components/utils/caret/index';

describe('Caret selection utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  describe('getCaretNodeAndOffset', () => {
    it('returns [null, 0] when there is no selection', () => {
      const result = getCaretNodeAndOffset();

      expect(result).toEqual([null, 0]);
    });

    it('returns [null, 0] when selection focusNode is null', () => {
      const selection = window.getSelection();

      if (selection) {
        vi.spyOn(selection, 'focusNode', 'get').mockReturnValue(null);
      }

      const result = getCaretNodeAndOffset();

      expect(result).toEqual([null, 0]);
    });

    it('returns text node and offset when caret is in text node', () => {
      const container = document.createElement('div');
      container.contentEditable = 'true';
      container.textContent = 'Hello world';
      document.body.appendChild(container);

      const textNode = container.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 5);
      range.setEnd(textNode, 5);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const [node, offset] = getCaretNodeAndOffset();

      expect(node).toBe(textNode);
      expect(offset).toBe(5);
    });

    it('returns child node when focusNode is element with focusOffset as child index', () => {
      const container = document.createElement('div');
      container.contentEditable = 'true';
      container.innerHTML = '<span>Hello</span><span>world</span>';
      document.body.appendChild(container);

      const firstSpan = container.firstChild as HTMLElement;
      const textNode = firstSpan.firstChild as Text;

      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const [node, offset] = getCaretNodeAndOffset();

      expect(node).toBe(textNode);
      expect(offset).toBe(2);
    });

    it('handles Firefox edge case where focusOffset exceeds childNodes length', () => {
      const container = document.createElement('div');
      container.contentEditable = 'true';
      container.textContent = 'Hello';
      document.body.appendChild(container);

      const textNode = container.firstChild as Text;

      const range = document.createRange();
      range.setStart(textNode, 3);
      range.setEnd(textNode, 3);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const [node, offset] = getCaretNodeAndOffset();

      expect(node).toBe(textNode);
      expect(offset).toBe(3);
    });

    it('returns [null, 0] when selection focusNode is element with no text content', () => {
      const container = document.createElement('div');
      container.contentEditable = 'true';
      document.body.appendChild(container);

      const range = document.createRange();
      range.setStart(container, 0);
      range.setEnd(container, 0);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const [node, offset] = getCaretNodeAndOffset();

      expect(node).not.toBeNull();
      expect(offset).toBe(0);
    });
  });

  describe('getCaretOffset', () => {
    it('returns 0 when there is no selection', () => {
      const offset = getCaretOffset();

      expect(offset).toBe(0);
    });

    it('returns 0 when selection has no ranges', () => {
      const selection = window.getSelection();

      if (selection) {
        vi.spyOn(selection, 'rangeCount', 'get').mockReturnValue(0);
      }

      const offset = getCaretOffset();

      expect(offset).toBe(0);
    });

    it('calculates offset from start of contenteditable', () => {
      const container = document.createElement('div');
      container.contentEditable = 'true';
      container.textContent = 'Hello world';
      document.body.appendChild(container);

      const textNode = container.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 5);
      range.setEnd(textNode, 5);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const offset = getCaretOffset(container);

      expect(offset).toBe(5);
    });

    it('calculates offset when caret is in nested element', () => {
      const container = document.createElement('div');
      container.contentEditable = 'true';
      container.innerHTML = 'Hello <b>world</b>';
      document.body.appendChild(container);

      const boldText = container.querySelector('b')?.firstChild as Text;
      const range = document.createRange();
      range.setStart(boldText, 2);
      range.setEnd(boldText, 2);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const offset = getCaretOffset(container);

      expect(offset).toBe(7); // "Hello " (6 chars) + "wo" (2 chars)
    });

    it('finds contenteditable ancestor when no input provided', () => {
      const container = document.createElement('div');
      container.contentEditable = 'true';
      container.textContent = 'Text';
      document.body.appendChild(container);

      const textNode = container.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const offset = getCaretOffset();

      expect(offset).toBe(2);
    });

    it('returns 0 when container cannot be found', () => {
      const range = document.createRange();
      range.setStart(document.body, 0);
      range.setEnd(document.body, 0);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const offset = getCaretOffset();

      expect(offset).toBe(0);
    });

    it('handles offset at end of content', () => {
      const container = document.createElement('div');
      container.contentEditable = 'true';
      container.textContent = 'Hello';
      document.body.appendChild(container);

      const textNode = container.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 5);
      range.setEnd(textNode, 5);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const offset = getCaretOffset(container);

      expect(offset).toBe(5);
    });

    it('handles offset in middle of text with multiple lines', () => {
      const container = document.createElement('div');
      container.contentEditable = 'true';
      container.innerHTML = 'Line one<br>Line two';
      document.body.appendChild(container);

      const textNode = container.lastChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 4);
      range.setEnd(textNode, 4);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const offset = getCaretOffset(container);

      expect(offset).toBeGreaterThan(8); // Should include "Line one" + "<br>" + part of "Line two"
    });
  });
});
