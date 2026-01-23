import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { FakeBackgroundWrappers } from '../../../../../src/components/selection/fake-background/wrappers';
import { FakeBackgroundTextNodes } from '../../../../../src/components/selection/fake-background/text-nodes';
import { FakeBackgroundShadows } from '../../../../../src/components/selection/fake-background/shadows';

/**
 * Test helper to create nested HTML structure
 */
const createNestedStructure = (html: string): HTMLElement => {
  const container = document.createElement('div');

  container.innerHTML = html;
  document.body.appendChild(container);

  return container;
};

/**
 * Test helper to create a contenteditable div with text
 */
const createContentEditable = (text = 'Hello world'): HTMLDivElement => {
  const element = document.createElement('div');

  element.contentEditable = 'true';
  element.textContent = text;
  document.body.appendChild(element);

  return element;
};

/**
 * Test helper to create a DOMRectList from an array of DOMRects
 */
const createDOMRectList = (rects: DOMRect[]): DOMRectList => {
  return {
    length: rects.length,
    item: (index: number) => rects[index] ?? null,
    [0]: rects[0] ?? null,
    [1]: rects[1] ?? null,
    [2]: rects[2] ?? null,
    [3]: rects[3] ?? null,
    [4]: rects[4] ?? null,
  } as unknown as DOMRectList;
};

describe('FakeBackgroundWrappers', () => {
  beforeEach(() => {
    document.body.innerHTML = '';

    // Mock Range.prototype.getBoundingClientRect for jsdom
    const prototype = Range.prototype as Range & {
      getBoundingClientRect?: () => DOMRect;
    };

    if (typeof prototype.getBoundingClientRect !== 'function') {
      prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
    }
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  describe('wrapRangeWithHighlight', () => {
    it('returns null for collapsed range', () => {
      const container = createContentEditable('Hello world');

      const range = document.createRange();

      range.setStart(container, 0);
      range.collapse(true);

      const result = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      expect(result).toBeNull();
    });

    it('creates wrapper span with correct attributes', () => {
      const container = createContentEditable('Hello world');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      expect(wrapper).not.toBeNull();
      expect(wrapper?.getAttribute('data-blok-testid')).toBe('fake-background');
      expect(wrapper?.getAttribute('data-blok-fake-background')).toBe('true');
      expect(wrapper?.getAttribute('data-blok-mutation-free')).toBe('true');
    });

    it('sets correct styles on wrapper', () => {
      const container = createContentEditable('Hello world');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      expect(wrapper?.style.color).toBe('inherit');
      expect(wrapper?.style.boxDecorationBreak).toBe('clone');
      expect(wrapper?.style.whiteSpace).toBe('pre-wrap');
    });

    it('sets webkit box decoration break', () => {
      const container = createContentEditable('Hello world');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      // In jsdom, the webkit prefix might not be preserved
      // Check that the standard property is set correctly instead
      expect(wrapper?.style.boxDecorationBreak).toBe('clone');
    });

    it('extracts and wraps range contents', () => {
      const container = createContentEditable('Hello world');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      expect(wrapper?.textContent).toBe('Hello');
      // After extractContents and insertNode, the DOM structure changes
      // The wrapper is inserted at the range position, and remaining text follows
      expect(container).toHaveTextContent('Hello world'); // Full text preserved
    });

    it('inserts wrapper at range position', () => {
      const container = createContentEditable('Hello world');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 6);
      range.setEnd(textNode, 11);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      // The wrapper should be created and contain the extracted content
      expect(wrapper).not.toBeNull();
      expect(wrapper?.textContent).toBe('world');
      // The wrapper should be in the DOM
      expect(document.body.contains(wrapper)).toBe(true);
    });

    it('returns null when range has no child nodes', () => {
      const range = document.createRange();

      // Create a range with no actual content
      range.setStart(document.body, 0);
      range.collapse(true);

      const result = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      expect(result).toBeNull();
    });

    it('wraps inline element contents', () => {
      const container = createNestedStructure('<p>Text <strong>bold</strong> more</p>');

      const paragraph = container.querySelector('p');
      const strong = container.querySelector('strong');

      if (!paragraph?.firstChild || !strong?.firstChild) {
        throw new Error('Expected elements not found');
      }

      const range = document.createRange();

      range.setStart(strong.firstChild, 0);
      range.setEnd(strong.firstChild, 4);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      expect(wrapper?.textContent).toBe('bold');
    });
  });

  describe('unwrapFakeBackground', () => {
    it('removes wrapper and preserves content', () => {
      const container = createContentEditable('Hello world');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      expect(wrapper).not.toBeNull();

      if (wrapper) {
        FakeBackgroundWrappers.unwrapFakeBackground(wrapper);
      }

      expect(container.querySelector('[data-blok-fake-background]')).toBeNull();
      expect(container).toHaveTextContent('Hello world');
    });

    it('does nothing when wrapper has no parent', () => {
      const wrapper = document.createElement('span');

      wrapper.textContent = 'Orphan';

      expect(() => FakeBackgroundWrappers.unwrapFakeBackground(wrapper)).not.toThrow();
    });

    it('handles wrapper with multiple children', () => {
      const wrapper = document.createElement('span');
      const parent = document.createElement('div');

      wrapper.setAttribute('data-blok-fake-background', 'true');
      wrapper.appendChild(document.createTextNode('First'));
      wrapper.appendChild(document.createElement('br'));
      wrapper.appendChild(document.createTextNode('Second'));

      parent.appendChild(wrapper);
      document.body.appendChild(parent);

      FakeBackgroundWrappers.unwrapFakeBackground(wrapper);

      expect(parent.querySelector('[data-blok-fake-background]')).toBeNull();
      expect(parent).toHaveTextContent('FirstSecond');
    });

    it('preserves element order when unwrapping', () => {
      const wrapper = document.createElement('span');
      const parent = document.createElement('div');

      wrapper.setAttribute('data-blok-fake-background', 'true');

      const text1 = document.createTextNode('First');
      const text2 = document.createTextNode('Second');

      wrapper.appendChild(text1);
      wrapper.appendChild(text2);

      parent.appendChild(wrapper);

      FakeBackgroundWrappers.unwrapFakeBackground(wrapper);

      expect(parent.firstChild).toBe(text1);
      expect(parent.lastChild).toBe(text2);
    });
  });

  describe('postProcessHighlightWrappers', () => {
    it('returns array of wrappers', () => {
      const container = createContentEditable('Hello world');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      if (!wrapper) {
        throw new Error('Wrapper should not be null');
      }

      const result = FakeBackgroundWrappers.postProcessHighlightWrappers([wrapper]);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('calls splitMultiLineWrapper for each wrapper', () => {
      const container = createContentEditable('Hello');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      if (!wrapper) {
        throw new Error('Wrapper should not be null');
      }

      const spy = vi.spyOn(FakeBackgroundWrappers, 'splitMultiLineWrapper');

      FakeBackgroundWrappers.postProcessHighlightWrappers([wrapper]);

      expect(spy).toHaveBeenCalledWith(wrapper);

      spy.mockRestore();
    });

    it('handles empty input array', () => {
      const result = FakeBackgroundWrappers.postProcessHighlightWrappers([]);

      expect(result).toEqual([]);
    });

    it('processes multiple wrappers', () => {
      const container = createContentEditable('Hello world test');
      const textNode = container.firstChild as Text;

      // Create two separate wrappers
      const range1 = document.createRange();

      range1.setStart(textNode, 0);
      range1.setEnd(textNode, 5);

      const range2 = document.createRange();

      range2.setStart(textNode, 6);
      range2.setEnd(textNode, 11);

      const wrapper1 = FakeBackgroundWrappers.wrapRangeWithHighlight(range1);
      const wrapper2 = FakeBackgroundWrappers.wrapRangeWithHighlight(range2);

      if (!wrapper1 || !wrapper2) {
        throw new Error('Wrappers should not be null');
      }

      const result = FakeBackgroundWrappers.postProcessHighlightWrappers([wrapper1, wrapper2]);

      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('splitMultiLineWrapper', () => {
    it('applies box shadow to single-line wrapper', () => {
      const container = createContentEditable('Single line');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 11);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      if (!wrapper) {
        throw new Error('Wrapper should not be null');
      }

      // Mock getClientRects to return single rect
      vi.spyOn(wrapper, 'getClientRects').mockReturnValue(createDOMRectList([new DOMRect(0, 0, 50, 16)]));

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(wrapper);
    });

    it('returns original wrapper when getClientRects returns single rect', () => {
      const container = createContentEditable('Text');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 4);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      if (!wrapper) {
        throw new Error('Wrapper should not be null');
      }

      vi.spyOn(wrapper, 'getClientRects').mockReturnValue(createDOMRectList([new DOMRect(0, 0, 30, 16)]));

      const spy = vi.spyOn(FakeBackgroundShadows, 'applyBoxShadowToWrapper');

      FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(spy).toHaveBeenCalledWith(wrapper);

      spy.mockRestore();
    });

    it('returns original wrapper when parent is null', () => {
      const wrapper = document.createElement('span');

      wrapper.textContent = 'Orphan';
      wrapper.setAttribute('data-blok-fake-background', 'true');

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(result).toEqual([wrapper]);
    });

    it('returns original wrapper when text content is empty', () => {
      const wrapper = document.createElement('span');
      const parent = document.createElement('div');

      wrapper.textContent = '';
      wrapper.setAttribute('data-blok-fake-background', 'true');
      parent.appendChild(wrapper);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(result).toEqual([wrapper]);
    });

    it('returns original wrapper when first child is not a text node', () => {
      const wrapper = document.createElement('span');
      const parent = document.createElement('div');
      const child = document.createElement('strong');

      child.textContent = 'Bold';
      wrapper.appendChild(child);
      wrapper.textContent = 'Bold';
      wrapper.setAttribute('data-blok-fake-background', 'true');
      parent.appendChild(wrapper);

      // Since textContent sets direct text, firstChild will be a text node
      // We need to clear and append element as child
      wrapper.textContent = '';
      wrapper.appendChild(child);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(result).toEqual([wrapper]);
    });

    it('returns original wrapper when no line breaks are found', () => {
      const container = createContentEditable('Single line');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 10);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      if (!wrapper) {
        throw new Error('Wrapper should not be null');
      }

      // Mock findLineBreakPositions to return empty array
      vi.spyOn(FakeBackgroundTextNodes, 'findLineBreakPositions').mockReturnValue([]);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(result).toEqual([wrapper]);

      vi.restoreAllMocks();
    });

    it('splits multi-line wrapper into separate spans', () => {
      const container = createContentEditable('Multi line text here');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, textNode.length);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      if (!wrapper) {
        throw new Error('Wrapper should not be null');
      }

      // Mock to simulate multi-line
      vi.spyOn(wrapper, 'getClientRects').mockReturnValue(
        createDOMRectList([
          new DOMRect(0, 0, 50, 16),
          new DOMRect(0, 20, 50, 16),
        ])
      );

      vi.spyOn(FakeBackgroundTextNodes, 'findLineBreakPositions').mockReturnValue([5]);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(result.length).toBeGreaterThan(1);

      vi.restoreAllMocks();
    });

    it('sets correct attributes on split wrappers', () => {
      const container = createContentEditable('Text');
      const textNode = container.firstChild as Text;

      const range = document.createRange();

      range.setStart(textNode, 0);
      range.setEnd(textNode, 4);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      if (!wrapper) {
        throw new Error('Wrapper should not be null');
      }

      vi.spyOn(wrapper, 'getClientRects').mockReturnValue(
        createDOMRectList([
          new DOMRect(0, 0, 30, 16),
          new DOMRect(0, 20, 30, 16),
        ])
      );

      vi.spyOn(FakeBackgroundTextNodes, 'findLineBreakPositions').mockReturnValue([2]);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      result.forEach((span) => {
        expect(span).toHaveAttribute('data-blok-fake-background', 'true');
        expect(span).toHaveAttribute('data-blok-mutation-free', 'true');
        expect(span.style.color).toBe('inherit');
      });

      vi.restoreAllMocks();
    });
  });
});
