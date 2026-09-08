import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBackgroundWrappers } from '../../../../../src/components/selection/fake-background/wrappers';
import { FakeBackgroundTextNodes } from '../../../../../src/components/selection/fake-background/text-nodes';
import { FakeBackgroundShadows } from '../../../../../src/components/selection/fake-background/shadows';

/**
 * The complete style string every highlight span carries, in jsdom's read-back
 * form (first-write order, normalised values).
 *
 * `-webkit-box-decoration-break` is deliberately absent: jsdom's cssstyle does
 * not know the property, so the module's bracket write lands as a plain JS own
 * property on the CSSStyleDeclaration and never reaches cssText. It is asserted
 * separately through WEBKIT_KEY.
 */
const STYLE = 'color: inherit; box-decoration-break: clone; white-space: pre-wrap;';

/**
 * The dashed property name the module writes through a bracket cast.
 */
const WEBKIT_KEY = '-webkit-box-decoration-break';

/**
 * The complete markup of one highlight span, attributes in write order.
 * @param text - the span's text content
 */
const spanHtml = (text: string): string =>
  '<span data-blok-testid="fake-background" data-blok-fake-background="true"'
  + ` data-blok-mutation-free="true" style="${STYLE}">${text}</span>`;

/**
 * DOMRectList has no constructor, so a stub reproduces the shape the module
 * reads: `length` only, plus enough of the interface to stay assignable.
 * @param rects - the rectangles the list should report
 */
const toDOMRectList = (rects: DOMRect[]): DOMRectList => {
  return {
    length: rects.length,
    item: (index: number) => rects[index] ?? null,
    [Symbol.iterator]: function* () {
      for (const rect of rects) {
        yield rect;
      }
    },
    ...rects.reduce<Record<number, DOMRect>>((acc, rect, i) => ({
      ...acc,
      [i]: rect,
    }), {}),
  } as DOMRectList;
};

/**
 * Reads a style declaration through the same bracket cast the module writes
 * with, which is the only seam that can see the webkit property in jsdom.
 * @param element - element whose inline style to read
 */
const dashedStyleOf = (element: HTMLElement): Record<string, string> =>
  element.style as unknown as Record<string, string>;

/**
 * Test helper stubbing the layout query jsdom never answers.
 * @param element - element whose client rects to stub
 * @param count - how many painted line boxes to report
 */
const stubClientRects = (element: HTMLElement, count: number): void => {
  const rects = Array.from({ length: count }, (_, i) => new DOMRect(0, i * 20, 40, 16));

  vi.spyOn(element, 'getClientRects').mockReturnValue(toDOMRectList(rects));
};

/**
 * Test helper creating an attached block-level parent.
 */
const makeParent = (): HTMLElement => {
  const parent = document.createElement('div');

  document.body.appendChild(parent);

  return parent;
};

/**
 * Test helper creating a highlight span holding one text node.
 * @param parent - parent to attach to, or null to leave it detached
 * @param text - text content for the span
 */
const makeWrapper = (parent: HTMLElement | null, text: string): HTMLElement => {
  const wrapper = document.createElement('span');

  wrapper.appendChild(document.createTextNode(text));
  parent?.appendChild(wrapper);

  return wrapper;
};

/**
 * Test helper reading an editable host's text node with a real type guard.
 * @param host - element expected to hold a single text node
 */
const textChildOf = (host: HTMLElement): Text => {
  const child = host.firstChild;

  if (!(child instanceof Text)) {
    throw new Error(`Expected a text child in <${host.tagName}>`);
  }

  return child;
};

describe('FakeBackgroundWrappers — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('wrapRangeWithHighlight', () => {
    it('leaves a collapsed range untouched instead of extracting from it', () => {
      const host = makeParent();

      host.textContent = 'Hello world';

      const range = document.createRange();

      range.setStart(textChildOf(host), 3);
      range.collapse(true);

      // A collapsed extraction is a no-op, so the returned null is the same on
      // both sides of the guard: the extraction attempt is the only witness.
      const extract = vi.spyOn(Range.prototype, 'extractContents');

      const result = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      expect(extract).not.toHaveBeenCalled();
      expect(result).toBeNull();
      expect(host.innerHTML).toBe('Hello world');
    });

    it('returns null and inserts nothing when the extraction yields no nodes', () => {
      const host = makeParent();

      host.textContent = 'Hello world';

      const range = document.createRange();

      range.setStart(textChildOf(host), 0);
      range.setEnd(textChildOf(host), 5);

      vi.spyOn(Range.prototype, 'extractContents').mockReturnValue(document.createDocumentFragment());

      const result = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      expect(result).toBeNull();
      expect(host.innerHTML).toBe('Hello world');
    });

    it('produces exactly one span carrying every attribute and style', () => {
      const host = makeParent();

      host.textContent = 'Hello world';

      const range = document.createRange();

      range.setStart(textChildOf(host), 0);
      range.setEnd(textChildOf(host), 5);

      const wrapper = FakeBackgroundWrappers.wrapRangeWithHighlight(range);

      if (wrapper === null) {
        throw new Error('Expected a wrapper');
      }

      expect(wrapper.outerHTML).toBe(spanHtml('Hello'));
      expect(wrapper.style.cssText).toBe(STYLE);
      expect(dashedStyleOf(wrapper)[WEBKIT_KEY]).toBe('clone');
      expect(host.innerHTML).toBe(`${spanHtml('Hello')} world`);
    });
  });

  describe('splitMultiLineWrapper', () => {
    it('keeps a single painted line whole even when a break position is reported', () => {
      const parent = makeParent();
      const wrapper = makeWrapper(parent, 'abcdef');
      const shadow = vi.spyOn(FakeBackgroundShadows, 'applyBoxShadowToWrapper').mockImplementation(() => {});

      stubClientRects(wrapper, 1);

      // Exactly one rect is the boundary of `length <= 1`. The stubbed break
      // position is what makes the boundary observable: the real
      // findLineBreakPositions returns [] for expectedLines === 1 (text-nodes.ts,
      // `acc.positions.length >= expectedLines - 1`), which would send both sides
      // of the comparison down the same line 93 early return.
      vi.spyOn(FakeBackgroundTextNodes, 'findLineBreakPositions').mockReturnValue([3]);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(wrapper);
      expect(shadow).toHaveBeenCalledTimes(1);
      expect(shadow).toHaveBeenCalledWith(wrapper);
      expect(parent.innerHTML).toBe('<span>abcdef</span>');
    });

    it('shadows and returns a detached wrapper without splitting it', () => {
      const wrapper = makeWrapper(null, 'abcdef');
      const shadow = vi.spyOn(FakeBackgroundShadows, 'applyBoxShadowToWrapper').mockImplementation(() => {});

      stubClientRects(wrapper, 2);
      vi.spyOn(FakeBackgroundTextNodes, 'findLineBreakPositions').mockReturnValue([3]);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(wrapper);
      expect(shadow).toHaveBeenCalledTimes(1);
      expect(shadow).toHaveBeenCalledWith(wrapper);
      expect(wrapper.outerHTML).toBe('<span>abcdef</span>');
    });

    it('shadows and returns a wrapper whose first child is an element', () => {
      const parent = makeParent();
      const wrapper = document.createElement('span');
      const bold = document.createElement('strong');

      bold.textContent = 'abcdef';
      wrapper.appendChild(bold);
      parent.appendChild(wrapper);

      const shadow = vi.spyOn(FakeBackgroundShadows, 'applyBoxShadowToWrapper').mockImplementation(() => {});

      stubClientRects(wrapper, 2);
      vi.spyOn(FakeBackgroundTextNodes, 'findLineBreakPositions').mockReturnValue([3]);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(wrapper);
      expect(shadow).toHaveBeenCalledTimes(1);
      expect(shadow).toHaveBeenCalledWith(wrapper);
      expect(parent.innerHTML).toBe('<span><strong>abcdef</strong></span>');
    });

    it('shadows and returns a wrapper holding an empty text node', () => {
      const parent = makeParent();
      const wrapper = makeWrapper(parent, '');
      const shadow = vi.spyOn(FakeBackgroundShadows, 'applyBoxShadowToWrapper').mockImplementation(() => {});

      stubClientRects(wrapper, 2);

      // The empty text content is what the `|| ''` fallback produces, so a
      // fallback carrying real characters would split THAT text into spans. The
      // stubbed break position is again the witness: the real callee reads the
      // same empty text node and returns [].
      vi.spyOn(FakeBackgroundTextNodes, 'findLineBreakPositions').mockReturnValue([3]);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(result).toHaveLength(1);
      expect(result[0]).toBe(wrapper);
      expect(shadow).toHaveBeenCalledTimes(1);
      expect(shadow).toHaveBeenCalledWith(wrapper);
      expect(parent.innerHTML).toBe('<span></span>');
    });

    it('shadows and returns the same wrapper when no line break is found', () => {
      const parent = makeParent();
      const wrapper = makeWrapper(parent, 'abcdef');
      const shadow = vi.spyOn(FakeBackgroundShadows, 'applyBoxShadowToWrapper').mockImplementation(() => {});

      // No stub on findLineBreakPositions here: jsdom answers every Range
      // measurement with an all-zero rect, so the real callee finds no break.
      stubClientRects(wrapper, 2);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(result).toHaveLength(1);
      // Identity, not equality: skipping the guard rebuilds a span that is
      // structurally identical to the wrapper, and toEqual cannot tell DOM
      // nodes apart.
      expect(result[0]).toBe(wrapper);
      expect(parent.firstChild).toBe(wrapper);
      expect(parent.childNodes).toHaveLength(1);
      expect(shadow).toHaveBeenCalledTimes(1);
      expect(shadow).toHaveBeenCalledWith(wrapper);
    });

    it('replaces a multi-line wrapper with one fully styled span per line', () => {
      const parent = makeParent();
      const wrapper = makeWrapper(parent, 'abcdef');
      const shadow = vi.spyOn(FakeBackgroundShadows, 'applyBoxShadowToWrapper').mockImplementation(() => {});

      stubClientRects(wrapper, 2);
      vi.spyOn(FakeBackgroundTextNodes, 'findLineBreakPositions').mockReturnValue([3]);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(parent.innerHTML).toBe(`${spanHtml('abc')}${spanHtml('def')}`);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(parent.firstChild);
      expect(result[1]).toBe(parent.lastChild);
      expect(result[0].style.cssText).toBe(STYLE);
      expect(result[1].style.cssText).toBe(STYLE);
      expect(dashedStyleOf(result[0])[WEBKIT_KEY]).toBe('clone');
      expect(dashedStyleOf(result[1])[WEBKIT_KEY]).toBe('clone');
      expect(shadow).not.toHaveBeenCalled();
    });

    it('skips an empty segment instead of painting an empty span', () => {
      const parent = makeParent();
      const wrapper = makeWrapper(parent, 'abcdef');

      stubClientRects(wrapper, 2);
      vi.spyOn(FakeBackgroundTextNodes, 'findLineBreakPositions').mockReturnValue([3]);

      // The real splitTextAtPositions ends in `.filter((segment) => segment.length > 0)`
      // (text-nodes.ts), so an empty segment can only reach the loop through a stub.
      vi.spyOn(FakeBackgroundTextNodes, 'splitTextAtPositions').mockReturnValue(['abc', '', 'def']);

      const result = FakeBackgroundWrappers.splitMultiLineWrapper(wrapper);

      expect(parent.innerHTML).toBe(`${spanHtml('abc')}${spanHtml('def')}`);
      expect(result).toHaveLength(2);
    });
  });
});
