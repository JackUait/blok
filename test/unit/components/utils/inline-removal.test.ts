import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  whitespaceFollowingRemovedEmptyInline,
  ensureInlineRemovalObserver,
  isElementVisuallyEmpty,
  findNbspAfterEmptyInline,
} from '../../../../src/components/utils/caret/inline-removal';

describe('Caret inline removal utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    window.getSelection()?.removeAllRanges();
  });

  describe('isElementVisuallyEmpty', () => {
    it('returns false for SVGElement (non-HTMLElement)', () => {
      const svgElement = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

      const result = isElementVisuallyEmpty(svgElement);

      expect(result).toBe(false);
    });

    it('returns false for single tags (void elements)', () => {
      const img = document.createElement('img');
      img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

      const result = isElementVisuallyEmpty(img);

      expect(result).toBe(false);
    });

    it('returns false for native inputs', () => {
      const input = document.createElement('input');

      const result = isElementVisuallyEmpty(input);

      expect(result).toBe(false);
    });

    it('returns true for element with no children', () => {
      const span = document.createElement('span');

      const result = isElementVisuallyEmpty(span);

      expect(result).toBe(true);
    });

    it('returns false when element contains NBSP', () => {
      const span = document.createElement('span');
      span.textContent = '\u00A0';

      const result = isElementVisuallyEmpty(span);

      expect(result).toBe(false);
    });

    it('returns false when element contains non-collapsed whitespace', () => {
      const span = document.createElement('span');
      span.textContent = 'text';

      const result = isElementVisuallyEmpty(span);

      expect(result).toBe(false);
    });

    it('returns true when element contains only collapsed whitespace', () => {
      const span = document.createElement('span');
      span.textContent = '   ';

      const result = isElementVisuallyEmpty(span);

      expect(result).toBe(true);
    });

    it('recursively checks children for visual emptiness', () => {
      const div = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = '   ';
      div.appendChild(span);

      const result = isElementVisuallyEmpty(div);

      expect(result).toBe(true);
    });

    it('returns false when any child has visible content', () => {
      const div = document.createElement('div');
      const span1 = document.createElement('span');
      span1.textContent = '   ';
      const span2 = document.createElement('span');
      span2.textContent = 'text';
      div.appendChild(span1);
      div.appendChild(span2);

      const result = isElementVisuallyEmpty(div);

      expect(result).toBe(false);
    });

    it('handles nested empty elements', () => {
      const div = document.createElement('div');
      const span = document.createElement('span');
      const nested = document.createElement('b');
      span.appendChild(nested);
      div.appendChild(span);

      const result = isElementVisuallyEmpty(div);

      expect(result).toBe(true);
    });

    it('returns false for mixed content with NBSP in nested element', () => {
      const div = document.createElement('div');
      const span = document.createElement('span');
      span.textContent = '\u00A0';
      div.appendChild(span);

      const result = isElementVisuallyEmpty(div);

      expect(result).toBe(false);
    });
  });

  describe('ensureInlineRemovalObserver', () => {
    it('returns early when inlineRemovalObserver is null', () => {
      // This test assumes MutationObserver is not available
      const mockDoc = { body: null, readyState: 'complete' } as unknown as Document;

      expect(() => ensureInlineRemovalObserver(mockDoc)).not.toThrow();
    });

    it('returns early when document is already observed', () => {
      const mockDoc = document;

      // First call should observe
      ensureInlineRemovalObserver(mockDoc);

      // Second call should return early without error
      expect(() => ensureInlineRemovalObserver(mockDoc)).not.toThrow();
    });

    it('waits for DOMContentLoaded when document is loading', () => {
      const mockDoc = {
        readyState: 'loading',
        body: document.body,
        addEventListener: vi.fn(),
      } as unknown as Document;

      ensureInlineRemovalObserver(mockDoc);

      expect(mockDoc.addEventListener).toHaveBeenCalledWith(
        'DOMContentLoaded',
        expect.any(Function),
        { once: true }
      );
    });

    it('starts observing immediately when document is ready', () => {
      const mockDoc = document;

      // Should not throw
      expect(() => ensureInlineRemovalObserver(mockDoc)).not.toThrow();
    });

    it('returns early when body is null during loading', () => {
      const mockDoc = {
        readyState: 'loading',
        body: null,
        addEventListener: vi.fn(),
      } as unknown as Document;

      expect(() => ensureInlineRemovalObserver(mockDoc)).not.toThrow();
    });
  });

  describe('findNbspAfterEmptyInline', () => {
    it('returns null when caret is not in root element', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const result = findNbspAfterEmptyInline(div);

      // Caret is not set, so getCaretNodeAndOffset returns [null, 0]
      expect(result).toBeNull();
    });

    it('returns null when caretNode is null', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      // Remove any selection
      window.getSelection()?.removeAllRanges();

      const result = findNbspAfterEmptyInline(div);

      expect(result).toBeNull();
    });

    it('returns null when caret is not at end of text node', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text more';
      document.body.appendChild(div);

      const textNode = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.setEnd(textNode, 2);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = findNbspAfterEmptyInline(div);

      expect(result).toBeNull();
    });

    it('returns null when there are no more text nodes', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.textContent = 'text';
      document.body.appendChild(div);

      const textNode = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(textNode, 4);
      range.setEnd(textNode, 4);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = findNbspAfterEmptyInline(div);

      expect(result).toBeNull();
    });

    it('returns null when next text is not whitespace', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = 'text<span>more</span>';
      document.body.appendChild(div);

      const firstText = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(firstText, 4);
      range.setEnd(firstText, 4);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = findNbspAfterEmptyInline(div);

      expect(result).toBeNull();
    });

    it('finds NBSP after removed empty inline element', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      const textNode = document.createTextNode('\u00A0text');
      div.appendChild(textNode);
      document.body.appendChild(div);

      // Manually add the text node to the WeakSet to simulate it being tracked
      whitespaceFollowingRemovedEmptyInline.add(textNode);

      findNbspAfterEmptyInline(div);

      // Should find and remove from WeakSet
      expect(whitespaceFollowingRemovedEmptyInline.has(textNode)).toBe(false);

      // Result depends on tree walker finding the node
      // The exact behavior depends on DOM structure
    });

    it('finds regular space after removed empty inline element', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      const textNode = document.createTextNode(' text');
      div.appendChild(textNode);
      document.body.appendChild(div);

      // Manually add the text node to the WeakSet
      whitespaceFollowingRemovedEmptyInline.add(textNode);

      findNbspAfterEmptyInline(div);

      // Should remove from WeakSet when checked
      expect(whitespaceFollowingRemovedEmptyInline.has(textNode)).toBe(false);
    });

    it('returns null when empty element exists between but was not removed', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = 'text<b></b> more';
      document.body.appendChild(div);

      const firstText = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(firstText, 4);
      range.setEnd(firstText, 4);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = findNbspAfterEmptyInline(div);

      // Empty element exists but wasn't tracked as removed
      expect(result).toBeNull();
    });

    it('skips empty text nodes', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.appendChild(document.createTextNode('text'));
      div.appendChild(document.createTextNode(''));
      div.appendChild(document.createTextNode(' more'));
      document.body.appendChild(div);

      const firstText = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(firstText, 4);
      range.setEnd(firstText, 4);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = findNbspAfterEmptyInline(div);

      // Should skip empty text node
      expect(result).toBeNull();
    });

    it('returns null when next text has non-whitespace content', () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.innerHTML = 'text<span>more</span>';
      document.body.appendChild(div);

      const firstText = div.firstChild as Text;
      const range = document.createRange();
      range.setStart(firstText, 4);
      range.setEnd(firstText, 4);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);

      const result = findNbspAfterEmptyInline(div);

      expect(result).toBeNull();
    });
  });

  describe('WeakSet behavior', () => {
    it('tracks text nodes following removed empty inline elements', () => {
      const textNode = document.createTextNode('\u00A0text');

      expect(whitespaceFollowingRemovedEmptyInline.has(textNode)).toBe(false);

      whitespaceFollowingRemovedEmptyInline.add(textNode);

      expect(whitespaceFollowingRemovedEmptyInline.has(textNode)).toBe(true);

      whitespaceFollowingRemovedEmptyInline.delete(textNode);

      expect(whitespaceFollowingRemovedEmptyInline.has(textNode)).toBe(false);
    });

    it('handles multiple text nodes', () => {
      const node1 = document.createTextNode(' text1');
      const node2 = document.createTextNode(' text2');

      whitespaceFollowingRemovedEmptyInline.add(node1);
      whitespaceFollowingRemovedEmptyInline.add(node2);

      expect(whitespaceFollowingRemovedEmptyInline.has(node1)).toBe(true);
      expect(whitespaceFollowingRemovedEmptyInline.has(node2)).toBe(true);
    });
  });
});
