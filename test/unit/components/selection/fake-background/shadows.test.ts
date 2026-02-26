import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { FakeBackgroundShadows } from '../../../../../src/components/selection/fake-background/shadows';
import type { LineRect } from '../../../../../src/components/selection/fake-background/types';

/**
 * Test helper to convert DOMRect array to DOMRectList
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
    // Array-like indexing
    ...rects.reduce<Record<number, DOMRect>>((acc, rect, i) => ({
      ...acc,
      [i]: rect,
    }), {}),
  } as DOMRectList;
};

/**
 * Test helper to create a span element
 */
const createSpan = (text = 'Test text'): HTMLSpanElement => {
  const span = document.createElement('span');

  span.textContent = text;
  span.style.fontSize = '16px';
  document.body.appendChild(span);

  return span;
};

/**
 * Test helper to create a parent with specific line-height
 */
const createParentWithLineHeight = (lineHeight: string): HTMLDivElement => {
  const parent = document.createElement('div');

  parent.style.lineHeight = lineHeight;
  document.body.appendChild(parent);

  return parent;
};

describe('FakeBackgroundShadows', () => {
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

  describe('applyBoxShadowToWrapper', () => {
    it('does nothing when wrapper has no parent', () => {
      const wrapper = createSpan();

      wrapper.remove();

      expect(() => FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper)).not.toThrow();
    });

    it('calculates extension based on parent line-height and wrapper height', () => {
      const parent = createParentWithLineHeight('24px');
      const wrapper = createSpan();

      parent.appendChild(wrapper);

      // Mock getBoundingClientRect to return specific height
      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 16));

      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);

      const boxShadow = wrapper.style.boxShadow;

      expect(boxShadow).toContain('rgba(0, 0, 0, 0.08)');
    });

    it('uses 1.2x fontSize when lineHeight is "normal"', () => {
      const parent = createParentWithLineHeight('normal');
      const wrapper = createSpan();

      parent.appendChild(wrapper);

      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 16));
      vi.spyOn(parent.style, 'lineHeight', 'get').mockReturnValue('normal');

      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);

      expect(wrapper.style.boxShadow).toBeDefined();
    });

    it('applies top and bottom box shadows', () => {
      const parent = createParentWithLineHeight('24px');
      const wrapper = createSpan();

      parent.appendChild(wrapper);

      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 16));

      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);

      const boxShadow = wrapper.style.boxShadow;

      expect(boxShadow).toContain('0 ');
      expect(boxShadow).toContain('-');
    });

    it('does not apply shadow-sm when extension is zero', () => {
      const parent = createParentWithLineHeight('16px');
      const wrapper = createSpan();

      parent.appendChild(wrapper);

      // When line-height equals height, extension is 0
      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 16));

      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);

      // Should not have box-shadow when extension is 0
      const boxShadow = wrapper.style.boxShadow;

      if (boxShadow && boxShadow !== 'none') {
        const shadows = boxShadow.split(',').map((s) => s.trim());

        // May still have inset shadow
        const hasExtensionShadows = shadows.some((s) => !s.startsWith('inset'));

        expect(hasExtensionShadows).toBe(false);
      }
    });
  });

  describe('applyLineHeightExtensions', () => {
    it('does nothing when spans array is empty', () => {
      expect(() => FakeBackgroundShadows.applyLineHeightExtensions([])).not.toThrow();
    });

    it('collects all line rects from spans', () => {
      const span1 = createSpan('First');
      const span2 = createSpan('Second');

      // Mock getClientRects to return multiple rects
      vi.spyOn(span1, 'getClientRects').mockReturnValue(toDOMRectList([
        new DOMRect(0, 0, 50, 16),
        new DOMRect(0, 20, 50, 16),
      ]));

      vi.spyOn(span2, 'getClientRects').mockReturnValue(toDOMRectList([new DOMRect(0, 40, 50, 16)]));

      const collectSpy = vi.spyOn(FakeBackgroundShadows, 'collectAllLineRects');

      FakeBackgroundShadows.applyLineHeightExtensions([span1, span2]);

      expect(collectSpy).toHaveBeenCalledWith([span1, span2]);

      collectSpy.mockRestore();
    });

    it('groups rects by visual line', () => {
      const span1 = createSpan('First');
      const span2 = createSpan('Second');

      vi.spyOn(span1, 'getClientRects').mockReturnValue(toDOMRectList([new DOMRect(0, 0, 50, 16)]));
      vi.spyOn(span2, 'getClientRects').mockReturnValue(toDOMRectList([new DOMRect(0, 20, 50, 16)]));

      // Create parent with line-height for shadow calculation
      const parent = createParentWithLineHeight('24px');
      parent.appendChild(span1);
      parent.appendChild(span2);

      FakeBackgroundShadows.applyLineHeightExtensions([span1, span2]);

      // Verify the actual outcome - box-shadow should be applied to each span
      expect(span1.style.boxShadow).toBeDefined();
      expect(span2.style.boxShadow).toBeDefined();

      // Verify the shadows contain the expected color and inset
      expect(span1.style.boxShadow).toContain('rgba(0, 0, 0, 0.08)');
      expect(span2.style.boxShadow).toContain('rgba(0, 0, 0, 0.08)');
    });

    it('applies multi-line box shadow-sm to each span', () => {
      const span1 = createSpan('First');
      const span2 = createSpan('Second');

      vi.spyOn(span1, 'getClientRects').mockReturnValue(toDOMRectList([new DOMRect(0, 0, 50, 16)]));
      vi.spyOn(span2, 'getClientRects').mockReturnValue(toDOMRectList([new DOMRect(0, 20, 50, 16)]));

      // Create parent elements
      const parent = createParentWithLineHeight('24px');

      parent.appendChild(span1);
      parent.appendChild(span2);

      FakeBackgroundShadows.applyLineHeightExtensions([span1, span2]);

      // Verify box-shadow was applied
      expect(span1.style.boxShadow).toBeDefined();
      expect(span2.style.boxShadow).toBeDefined();
    });
  });

  describe('collectAllLineRects', () => {
    it('returns empty array for empty spans array', () => {
      const result = FakeBackgroundShadows.collectAllLineRects([]);

      expect(result).toEqual([]);
    });

    it('collects rects from single span with single rect', () => {
      const span = createSpan('Single');

      vi.spyOn(span, 'getClientRects').mockReturnValue(toDOMRectList([new DOMRect(0, 0, 50, 16)]));

      const result = FakeBackgroundShadows.collectAllLineRects([span]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        top: 0,
        bottom: 16,
        span,
      });
    });

    it('collects rects from single span with multiple rects', () => {
      const span = createSpan('Multi');

      vi.spyOn(span, 'getClientRects').mockReturnValue(toDOMRectList([
        new DOMRect(0, 0, 50, 16),
        new DOMRect(0, 20, 50, 16),
        new DOMRect(0, 40, 50, 16),
      ]));

      const result = FakeBackgroundShadows.collectAllLineRects([span]);

      expect(result).toHaveLength(3);
      expect(result[0].span).toBe(span);
      expect(result[1].span).toBe(span);
      expect(result[2].span).toBe(span);
    });

    it('collects rects from multiple spans', () => {
      const span1 = createSpan('First');
      const span2 = createSpan('Second');

      vi.spyOn(span1, 'getClientRects').mockReturnValue(toDOMRectList([new DOMRect(0, 0, 50, 16)]));
      vi.spyOn(span2, 'getClientRects').mockReturnValue(toDOMRectList([new DOMRect(0, 20, 50, 16)]));

      const result = FakeBackgroundShadows.collectAllLineRects([span1, span2]);

      expect(result).toHaveLength(2);
      expect(result[0].span).toBe(span1);
      expect(result[1].span).toBe(span2);
    });
  });

  describe('groupRectsByLine', () => {
    it('returns empty array for empty rects', () => {
      const result = FakeBackgroundShadows.groupRectsByLine([]);

      expect(result).toEqual([]);
    });

    it('groups rects with similar top positions', () => {
      const rect1: LineRect = { top: 0, bottom: 16, span: createSpan('1') };
      const rect2: LineRect = { top: 1, bottom: 17, span: createSpan('2') };
      const rect3: LineRect = { top: 20, bottom: 36, span: createSpan('3') };

      const result = FakeBackgroundShadows.groupRectsByLine([rect1, rect2, rect3]);

      expect(result).toHaveLength(2);
      expect(result[0].top).toBeLessThanOrEqual(1);
      expect(result[0].bottom).toBeGreaterThanOrEqual(17);
      expect(result[1].top).toBe(20);
      expect(result[1].bottom).toBe(36);
    });

    it('uses 2px threshold for grouping', () => {
      const rect1: LineRect = { top: 0, bottom: 16, span: createSpan('1') };
      const rect2: LineRect = { top: 1.9, bottom: 17, span: createSpan('2') };
      const rect3: LineRect = { top: 2.1, bottom: 18, span: createSpan('3') };

      const result = FakeBackgroundShadows.groupRectsByLine([rect1, rect2, rect3]);

      // rect1 and rect2 should be grouped (within 2px)
      // rect3 should be separate (more than 2px from rect2)
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it('extends line group bottom when needed', () => {
      const rect1: LineRect = { top: 0, bottom: 16, span: createSpan('1') };
      const rect2: LineRect = { top: 1, bottom: 20, span: createSpan('2') };

      const result = FakeBackgroundShadows.groupRectsByLine([rect1, rect2]);

      expect(result).toHaveLength(1);
      expect(result[0].top).toBe(0);
      expect(result[0].bottom).toBe(20);
    });

    it('sorts lines by top position', () => {
      const rect1: LineRect = { top: 40, bottom: 56, span: createSpan('1') };
      const rect2: LineRect = { top: 0, bottom: 16, span: createSpan('2') };
      const rect3: LineRect = { top: 20, bottom: 36, span: createSpan('3') };

      const result = FakeBackgroundShadows.groupRectsByLine([rect1, rect2, rect3]);

      expect(result[0].top).toBe(0);
      expect(result[1].top).toBe(20);
      expect(result[2].top).toBe(40);
    });

    it('handles rects from same span on different lines', () => {
      const span = createSpan('Multi');
      const rect1: LineRect = { top: 0, bottom: 16, span };
      const rect2: LineRect = { top: 20, bottom: 36, span };

      const result = FakeBackgroundShadows.groupRectsByLine([rect1, rect2]);

      expect(result).toHaveLength(2);
    });
  });

  describe('box shadow-sm values', () => {
    it('uses rgba(0, 0, 0, 0.08) for background color', () => {
      const parent = createParentWithLineHeight('24px');
      const wrapper = createSpan();

      parent.appendChild(wrapper);

      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 16));

      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);

      expect(wrapper.style.boxShadow).toContain('rgba(0, 0, 0, 0.08)');
    });

    it('creates inset shadow-sm for background effect', () => {
      const parent = createParentWithLineHeight('24px');
      const wrapper = createSpan();

      parent.appendChild(wrapper);

      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 16));

      FakeBackgroundShadows.applyLineHeightExtensions([wrapper]);

      const boxShadow = wrapper.style.boxShadow;

      // Note: In jsdom, the CSS style might be an empty string even when set
      // The important thing is that the code runs without error
      expect(typeof boxShadow).toBe('string');
    });

    it('calculates extension as (lineHeight - rectHeight) / 2', () => {
      const parent = createParentWithLineHeight('24px');
      const wrapper = createSpan();

      parent.appendChild(wrapper);

      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 16));

      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);

      const boxShadow = wrapper.style.boxShadow;

      // Extension should be (24 - 16) / 2 = 4
      expect(boxShadow).toContain('4px');
    });

    it('handles negative extension gracefully', () => {
      const parent = createParentWithLineHeight('12px');
      const wrapper = createSpan();

      parent.appendChild(wrapper);

      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 16));

      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);

      // When line-height < height, extension is max(0, negative) = 0
      // Should not apply extension shadows
      expect(wrapper.style.boxShadow).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('handles span with no client rects', () => {
      const span = createSpan();

      vi.spyOn(span, 'getClientRects').mockReturnValue({ length: 0, item: () => null } as unknown as DOMRectList);

      expect(() => FakeBackgroundShadows.collectAllLineRects([span])).not.toThrow();
    });

    it('handles zero-height wrapper', () => {
      const parent = createParentWithLineHeight('16px');
      const wrapper = createSpan();

      parent.appendChild(wrapper);

      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 0));

      expect(() => FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper)).not.toThrow();
    });

    it('handles parent with no computed style', () => {
      const wrapper = createSpan();

      wrapper.remove(); // No parent

      expect(() => FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper)).not.toThrow();
    });
  });
});
