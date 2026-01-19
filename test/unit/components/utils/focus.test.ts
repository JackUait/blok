import { describe, it, expect, beforeEach, vi } from 'vitest';
import { focus, setSelectionToElement } from '../../../../src/components/utils/caret/focus';
import { Dom as $ } from '../../../../src/components/dom';

describe('Caret focus utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  describe('focus', () => {
    it('sets caret to start of native input', () => {
      const input = document.createElement('input');
      input.value = 'Hello world';
      document.body.appendChild(input);

      focus(input, true);

      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(0);
    });

    it('sets caret to end of native input', () => {
      const input = document.createElement('input');
      input.value = 'Hello world';
      document.body.appendChild(input);

      focus(input, false);

      expect(input).toHaveFocus();
      expect(input.selectionStart).toBe(11);
      expect(input.selectionEnd).toBe(11);
    });

    it('sets caret at end of textarea', () => {
      const textarea = document.createElement('textarea');
      textarea.value = 'Line 1\nLine 2';
      document.body.appendChild(textarea);

      focus(textarea, false);

      expect(textarea).toHaveFocus();
      expect(textarea.selectionStart).toBe(12);
      expect(textarea.selectionEnd).toBe(12);
    });

    it('sets caret to start of contenteditable with text content', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'Hello world';
      document.body.appendChild(div);

      focus(div, true);

      expect(div).toHaveFocus();

      const selection = window.getSelection();
      expect(selection?.focusNode).toBe(div.firstChild);
      expect(selection?.focusOffset).toBe(0);
    });

    it('sets caret to end of contenteditable with text content', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'Hello world';
      document.body.appendChild(div);

      focus(div, false);

      expect(div).toHaveFocus();

      const selection = window.getSelection();
      expect(selection?.focusNode).toBe(div.firstChild);
      expect(selection?.focusOffset).toBe(11);
    });

    it('creates text node and sets focus when contenteditable is empty', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);

      focus(div, true);

      expect(div).toHaveFocus();

      const selection = window.getSelection();
      expect(selection?.rangeCount).toBeGreaterThan(0);

      const range = selection?.getRangeAt(0);
      expect(range?.startContainer.nodeType).toBe(Node.TEXT_NODE);
    });

    it('finds nested text node for focus position', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = '<span>Hello</span><span>world</span>';
      document.body.appendChild(div);

      focus(div, true);

      expect(div).toHaveFocus();

      const selection = window.getSelection();
      const textNode = div.querySelector('span')?.firstChild;

      expect(selection?.focusNode).toBe(textNode);
      expect(selection?.focusOffset).toBe(0);
    });

    it('finds last nested text node for end focus', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = '<span>Hello</span><span>world</span>';
      document.body.appendChild(div);

      focus(div, false);

      expect(div).toHaveFocus();

      const selection = window.getSelection();
      const lastSpan = div.querySelectorAll('span')[1];
      const textNode = lastSpan?.firstChild;

      expect(selection?.focusNode).toBe(textNode);
      expect(selection?.focusOffset).toBe(5);
    });

    it('creates text node when element has only element children', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      const span = document.createElement('span');
      div.appendChild(span);
      document.body.appendChild(div);

      focus(div, true);

      expect(div).toHaveFocus();

      const selection = window.getSelection();
      expect(selection?.rangeCount).toBeGreaterThan(0);
    });

    it('handles contenteditable with nested bold tag', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = '<b>Bold text</b>';
      document.body.appendChild(div);

      focus(div, true);

      expect(div).toHaveFocus();

      const selection = window.getSelection();
      const boldText = div.querySelector('b')?.firstChild;

      expect(selection?.focusNode).toBe(boldText);
      expect(selection?.focusOffset).toBe(0);
    });

    it('handles contenteditable with mixed content', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = 'Text <b>bold</b> more';
      document.body.appendChild(div);

      focus(div, false);

      expect(div).toHaveFocus();

      const selection = window.getSelection();
      // Should focus the last text node
      expect(selection?.focusNode?.textContent).toBe(' more');
    });

    it('handles deeply nested text nodes', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = '<div><span><b>Deep</b></span></div>';
      document.body.appendChild(div);

      focus(div, true);

      expect(div).toHaveFocus();

      const selection = window.getSelection();
      const boldText = div.querySelector('b')?.firstChild;

      expect(selection?.focusNode).toBe(boldText);
      expect(selection?.focusOffset).toBe(0);
    });

    it('does not crash when getSelection returns null', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'Text';
      document.body.appendChild(div);

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(() => focus(div, true)).not.toThrow();
    });
  });

  describe('setSelectionToElement', () => {
    it('sets selection to start of element', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'Hello world';
      document.body.appendChild(div);

      const selection = window.getSelection();
      if (!selection) {
        throw new Error('Selection not available');
      }

      setSelectionToElement(div, selection, true);

      expect(div).toHaveFocus();

      const freshSelection = window.getSelection();
      expect(freshSelection?.focusOffset).toBe(0);
    });

    it('sets selection to end of element', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'Hello world';
      document.body.appendChild(div);

      const selection = window.getSelection();
      if (!selection) {
        throw new Error('Selection not available');
      }

      setSelectionToElement(div, selection, false);

      expect(div).toHaveFocus();

      const freshSelection = window.getSelection();
      expect(freshSelection?.focusOffset).toBe(11);
    });

    it('focuses element before setting selection', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'Text';
      document.body.appendChild(div);

      const selection = window.getSelection();
      if (!selection) {
        throw new Error('Selection not available');
      }

      setSelectionToElement(div, selection, true);

      // Verify observable behavior: element should have focus
      expect(div).toHaveFocus();

      // Verify selection is properly set at the start
      const freshSelection = window.getSelection();
      expect(freshSelection?.focusNode).toBe(div.firstChild);
      expect(freshSelection?.focusOffset).toBe(0);
    });

    it('uses getDeepestNode to find target node', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = '<span><b>Nested</b></span>';
      document.body.appendChild(div);

      const selection = window.getSelection();
      if (!selection) {
        throw new Error('Selection not available');
      }

      setSelectionToElement(div, selection, true);

      const freshSelection = window.getSelection();
      const boldText = div.querySelector('b')?.firstChild;

      expect(freshSelection?.focusNode).toBe(boldText);
    });

    it('returns early when getSelection returns null after focus', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'Text';
      document.body.appendChild(div);

      const originalSelection = window.getSelection();
      if (!originalSelection) {
        throw new Error('Selection not available');
      }

      vi.spyOn(window, 'getSelection').mockReturnValue(null);

      expect(() => setSelectionToElement(div, originalSelection, true)).not.toThrow();
    });

    it('returns early when getDeepestNode returns null', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);

      const selection = window.getSelection();
      if (!selection) {
        throw new Error('Selection not available');
      }

      const getDeepestSpy = vi.spyOn($, 'getDeepestNode').mockReturnValue(null);

      expect(() => setSelectionToElement(div, selection, true)).not.toThrow();

      getDeepestSpy.mockRestore();
    });

    it('falls back to focus when range.setStart throws', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'Text';
      document.body.appendChild(div);

      const selection = window.getSelection();
      if (!selection) {
        throw new Error('Selection not available');
      }

      const getDeepestSpy = vi.spyOn($, 'getDeepestNode').mockReturnValue({
        nodeType: Node.TEXT_NODE,
        textContent: 'Text',
      } as unknown as Node);

      vi.spyOn(document, 'createRange').mockImplementation(() => {
        const range = document.createRange();
        range.setStart = vi.fn(() => {
          throw new Error('Invalid node');
        });
        return range;
      });

      // Should not throw, falls back to focus()
      expect(() => setSelectionToElement(div, selection, true)).not.toThrow();

      getDeepestSpy.mockRestore();
    });

    it('handles empty contenteditable', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      document.body.appendChild(div);

      const selection = window.getSelection();
      if (!selection) {
        throw new Error('Selection not available');
      }

      setSelectionToElement(div, selection, true);

      expect(div).toHaveFocus();

      const freshSelection = window.getSelection();
      expect(freshSelection?.rangeCount).toBeGreaterThan(0);
    });

    it('handles contenteditable with only whitespace', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = '   ';
      document.body.appendChild(div);

      const selection = window.getSelection();
      if (!selection) {
        throw new Error('Selection not available');
      }

      setSelectionToElement(div, selection, true);

      expect(div).toHaveFocus();
    });
  });
});
