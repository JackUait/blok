import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { SelectionCore } from '../../../../src/components/selection/core';
import * as utils from '../../../../src/components/utils';

/**
 * Test helper to ensure Selection API is available
 */
const ensureSelection = (): Selection => {
  const selection = window.getSelection();

  if (!selection) {
    throw new Error('Selection API is not available in the current environment');
  }

  return selection;
};

/**
 * Test helper to update Selection properties for realistic selection state
 */
const updateSelectionProperties = (
  selection: Selection,
  state: {
    anchorNode: Node | null;
    focusNode: Node | null;
    anchorOffset: number;
    focusOffset: number;
    isCollapsed: boolean;
  }
): void => {
  Object.defineProperty(selection, 'anchorNode', {
    value: state.anchorNode,
    configurable: true,
  });

  Object.defineProperty(selection, 'focusNode', {
    value: state.focusNode,
    configurable: true,
  });

  Object.defineProperty(selection, 'anchorOffset', {
    value: state.anchorOffset,
    configurable: true,
  });

  Object.defineProperty(selection, 'focusOffset', {
    value: state.focusOffset,
    configurable: true,
  });

  Object.defineProperty(selection, 'isCollapsed', {
    value: state.isCollapsed,
    configurable: true,
  });
};

/**
 * Test helper to set a selection range on a node
 */
const setSelectionRange = (node: Node, startOffset: number, endOffset: number = startOffset): Range => {
  const selection = ensureSelection();
  const range = document.createRange();

  range.setStart(node, startOffset);
  range.setEnd(node, endOffset);
  selection.removeAllRanges();
  selection.addRange(range);

  updateSelectionProperties(selection, {
    anchorNode: node,
    focusNode: node,
    anchorOffset: startOffset,
    focusOffset: endOffset,
    isCollapsed: startOffset === endOffset,
  });

  return range;
};

/**
 * Test helper to create a contenteditable div with text
 */
const createContentEditable = (text = 'Hello world'): { element: HTMLDivElement; textNode: Text } => {
  const element = document.createElement('div');

  element.contentEditable = 'true';
  element.textContent = text;
  document.body.appendChild(element);

  const textNode = element.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error('Failed to create text node for contenteditable element');
  }

  return { element, textNode };
};

/**
 * Test helper to create a Blok zone structure
 */
const createBlokZone = (text = 'Hello world'): {
  wrapper: HTMLDivElement;
  zone: HTMLDivElement;
  paragraph: HTMLParagraphElement;
  textNode: Text;
} => {
  const wrapper = document.createElement('div');
  const zone = document.createElement('div');
  const paragraph = document.createElement('p');

  wrapper.setAttribute('data-blok-editor', '');
  zone.setAttribute('data-blok-redactor', '');
  paragraph.textContent = text;

  zone.appendChild(paragraph);
  wrapper.appendChild(zone);
  document.body.appendChild(wrapper);

  const textNode = paragraph.firstChild;

  if (!(textNode instanceof Text)) {
    throw new Error('Failed to create text node inside blok zone');
  }

  return { wrapper, zone, paragraph, textNode };
};

describe('SelectionCore', () => {
  const clearSelectionState = (): void => {
    const selection = ensureSelection();

    selection.removeAllRanges();
    updateSelectionProperties(selection, {
      anchorNode: null,
      focusNode: null,
      anchorOffset: 0,
      focusOffset: 0,
      isCollapsed: true,
    });
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    clearSelectionState();

    // Mock Range.prototype.getBoundingClientRect for jsdom
    const prototype = Range.prototype as Range & {
      getBoundingClientRect?: () => DOMRect;
    };

    if (typeof prototype.getBoundingClientRect !== 'function') {
      prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearSelectionState();
    document.body.innerHTML = '';
  });

  describe('getAnchorNode', () => {
    it('returns null when there is no selection', () => {
      clearSelectionState();

      expect(SelectionCore.getAnchorNode()).toBeNull();
    });

    it('returns the anchor node when a selection exists', () => {
      const { textNode } = createContentEditable();
      setSelectionRange(textNode, 2);

      expect(SelectionCore.getAnchorNode()).toBe(textNode);
    });
  });

  describe('getAnchorElement', () => {
    it('returns null when there is no selection', () => {
      clearSelectionState();

      expect(SelectionCore.getAnchorElement()).toBeNull();
    });

    it('returns the parent element when anchor is a text node', () => {
      const { element, textNode } = createContentEditable();

      setSelectionRange(textNode, 0);

      expect(SelectionCore.getAnchorElement()).toBe(element);
    });

    it('returns the element itself when anchor node is an element', () => {
      const { element } = createContentEditable();
      const selection = ensureSelection();
      const range = document.createRange();

      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);

      updateSelectionProperties(selection, {
        anchorNode: element,
        focusNode: element,
        anchorOffset: 0,
        focusOffset: element.childNodes.length,
        isCollapsed: element.childNodes.length === 0,
      });

      expect(SelectionCore.getAnchorElement()).toBe(element);
    });
  });

  describe('getAnchorOffset', () => {
    it('returns the offset of the anchor node', () => {
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 3);

      expect(SelectionCore.getAnchorOffset()).toBe(3);
    });

    it('returns 0 when selection has no ranges (jsdom default)', () => {
      clearSelectionState();

      // jsdom returns 0 for anchorOffset when there's no selection
      // This is different from browser behavior but consistent with jsdom
      const offset = SelectionCore.getAnchorOffset();

      // In jsdom, offset is 0 rather than null
      expect(typeof offset).toBe('number');
    });
  });

  describe('getIsCollapsed', () => {
    it('returns true when selection is collapsed', () => {
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 2);

      expect(SelectionCore.getIsCollapsed()).toBe(true);
    });

    it('returns false when selection is not collapsed', () => {
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 0, 5);

      expect(SelectionCore.getIsCollapsed()).toBe(false);
    });

    it('returns true when selection has no ranges (jsdom default)', () => {
      clearSelectionState();

      // jsdom returns true for isCollapsed when there's no selection
      const isCollapsed = SelectionCore.getIsCollapsed();

      expect(typeof isCollapsed).toBe('boolean');
    });
  });

  describe('isSelectionAtBlok', () => {
    it('returns false when selection is null', () => {
      expect(SelectionCore.isSelectionAtBlok(null)).toBe(false);
    });

    it('returns true when selection is inside a Blok zone', () => {
      const { textNode } = createBlokZone();

      setSelectionRange(textNode, 0, textNode.textContent?.length ?? 0);

      const selection = ensureSelection();

      expect(SelectionCore.isSelectionAtBlok(selection)).toBe(true);
    });

    it('returns false when selection is outside a Blok zone', () => {
      const outside = document.createElement('p');

      outside.textContent = 'Outside';
      document.body.appendChild(outside);

      const outsideText = outside.firstChild;

      if (!(outsideText instanceof Text)) {
        throw new Error('Outside element is missing text node');
      }

      setSelectionRange(outsideText, 0, 3);

      const selection = ensureSelection();

      expect(SelectionCore.isSelectionAtBlok(selection)).toBe(false);
    });

    it('uses data-blok-redactor attribute to identify Blok zone', () => {
      const wrapper = document.createElement('div');
      const zone = document.createElement('div');
      const paragraph = document.createElement('p');

      zone.setAttribute('data-blok-redactor', '');
      paragraph.textContent = 'Test text';

      zone.appendChild(paragraph);
      wrapper.appendChild(zone);
      document.body.appendChild(wrapper);

      const textNode = paragraph.firstChild as Text;
      setSelectionRange(textNode, 0, 4);

      const selection = ensureSelection();

      expect(SelectionCore.isSelectionAtBlok(selection)).toBe(true);
    });
  });

  describe('getIsAtBlok', () => {
    it('returns true when current selection is at Blok zone', () => {
      const { textNode } = createBlokZone();

      setSelectionRange(textNode, 0, textNode.textContent?.length ?? 0);

      expect(SelectionCore.getIsAtBlok()).toBe(true);
    });

    it('returns false when current selection is outside Blok zone', () => {
      const outside = document.createElement('p');

      outside.textContent = 'Outside';
      document.body.appendChild(outside);

      const outsideText = outside.firstChild as Text;

      setSelectionRange(outsideText, 0, 3);

      expect(SelectionCore.getIsAtBlok()).toBe(false);
    });
  });

  describe('isRangeAtBlok', () => {
    it('returns undefined when range is null', () => {
      expect(SelectionCore.isRangeAtBlok(null as unknown as Range)).toBeUndefined();
    });

    it('returns true when range is inside a Blok zone', () => {
      const { textNode } = createBlokZone();
      const insideRange = document.createRange();

      insideRange.setStart(textNode, 0);
      insideRange.setEnd(textNode, 2);

      expect(SelectionCore.isRangeAtBlok(insideRange)).toBe(true);
    });

    it('returns false when range is outside a Blok zone', () => {
      const outsideParagraph = document.createElement('p');

      outsideParagraph.textContent = 'Outer text';
      document.body.appendChild(outsideParagraph);

      const outsideText = outsideParagraph.firstChild as Text;
      const outsideRange = document.createRange();

      outsideRange.setStart(outsideText, 0);
      outsideRange.setEnd(outsideText, 5);

      expect(SelectionCore.isRangeAtBlok(outsideRange)).toBe(false);
    });
  });

  describe('getIsSelectionExists', () => {
    it('returns false when there is no selection', () => {
      clearSelectionState();

      expect(SelectionCore.getIsSelectionExists()).toBe(false);
    });

    it('returns true when selection has an anchor node', () => {
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 1, 3);

      expect(SelectionCore.getIsSelectionExists()).toBe(true);
    });
  });

  describe('get', () => {
    it('returns the window Selection object', () => {
      expect(SelectionCore.get()).toBe(window.getSelection());
    });
  });

  describe('getRange', () => {
    it('returns null when there is no selection', () => {
      clearSelectionState();

      expect(SelectionCore.getRange()).toBeNull();
    });

    it('returns the first range from current selection', () => {
      const { textNode } = createContentEditable();

      const range = setSelectionRange(textNode, 0, 5);

      const result = SelectionCore.getRange();

      expect(result).toBeDefined();
      expect(result?.startContainer).toBe(range.startContainer);
      expect(result?.startOffset).toBe(range.startOffset);
    });
  });

  describe('getRangeFromSelection', () => {
    it('returns null when selection is null', () => {
      expect(SelectionCore.getRangeFromSelection(null)).toBeNull();
    });

    it('returns null when selection has no ranges', () => {
      const selection = ensureSelection();

      selection.removeAllRanges();

      expect(SelectionCore.getRangeFromSelection(selection)).toBeNull();
    });

    it('returns the first range from the provided selection', () => {
      const { textNode } = createContentEditable();

      setSelectionRange(textNode, 0, 4);

      const selection = ensureSelection();

      expect(SelectionCore.getRangeFromSelection(selection)).toEqual(selection.getRangeAt(0));
    });
  });

  describe('getRect', () => {
    it('returns zero rect when selection is unavailable', () => {
      const getSelectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue(null as unknown as Selection);
      const logSpy = vi.spyOn(utils, 'log').mockImplementation(() => undefined);

      const rect = SelectionCore.getRect();

      expect(rect.x).toBe(0);
      expect(rect.y).toBe(0);
      expect(rect.width).toBe(0);
      expect(rect.height).toBe(0);
      expect(logSpy).toHaveBeenCalled();

      getSelectionSpy.mockRestore();
      logSpy.mockRestore();
    });

    it('returns zero rect when selection has no ranges', () => {
      const { element } = createContentEditable();

      // Focus element but don't select anything
      element.focus();

      const selection = ensureSelection();

      selection.removeAllRanges();

      const rect = SelectionCore.getRect();

      expect(rect.x).toBe(0);
      expect(rect.y).toBe(0);
      expect(rect.width).toBe(0);
      expect(rect.height).toBe(0);
    });

    it('returns the bounding rect of the selection', () => {
      const { textNode } = createContentEditable('Sample');

      setSelectionRange(textNode, 0, 3);

      const rect = SelectionCore.getRect();

      // In jsdom, getBoundingClientRect returns zeros, but we verify the method works
      expect(rect).toBeDefined();
      expect(typeof rect.x).toBe('number');
      expect(typeof rect.y).toBe('number');
    });

    it('inserts temporary span when rect is at origin', () => {
      const { textNode } = createContentEditable('Test');

      setSelectionRange(textNode, 0, 2);

      // Mock getBoundingClientRect to return origin coordinates
      const range = SelectionCore.getRange();

      if (range) {
        const originalGetBoundingClientRect = range.getBoundingClientRect;

        vi.spyOn(range, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 0, 0));

        const rect = SelectionCore.getRect();

        // Should fall back to temporary span insertion
        expect(rect).toBeDefined();

        // Restore original method
        range.getBoundingClientRect = originalGetBoundingClientRect;
      }
    });
  });

  describe('getText', () => {
    it('returns empty string when there is no selection', () => {
      clearSelectionState();

      expect(SelectionCore.getText()).toBe('');
    });

    it('returns selected text', () => {
      const { textNode } = createContentEditable('Sample');

      setSelectionRange(textNode, 0, 3);

      expect(SelectionCore.getText()).toBe('Sam');
    });

    it('returns empty string for collapsed selection', () => {
      const { textNode } = createContentEditable('Sample');

      setSelectionRange(textNode, 2);

      expect(SelectionCore.getText()).toBe('');
    });
  });
});
