import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeBackgroundShadows } from '../../../../../src/components/selection/fake-background/shadows';
import type { LineRect } from '../../../../../src/components/selection/fake-background/types';

/**
 * The exact token the module paints with. Every expectation below spells out the
 * complete box-shadow string, so a change to this value fails loudly instead of
 * sliding past a `toContain` check.
 */
const COLOR = 'var(--blok-selection-inline, #d4ecff)';

/**
 * DOMRectList has no constructor, so a stub has to reproduce its shape by hand:
 * the module reads it through both Array.from and numeric indexing.
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
 * Test helper creating a block-level parent. Omitting lineHeight leaves the
 * computed value at "normal", which is the NaN branch of the extension maths.
 */
const makeParent = (lineHeight?: string): HTMLDivElement => {
  const parent = document.createElement('div');

  if (lineHeight !== undefined) {
    parent.style.lineHeight = lineHeight;
  }

  document.body.appendChild(parent);

  return parent;
};

/**
 * Test helper creating a highlight span. Passing null leaves it detached so
 * `parentElement` is null.
 */
const makeSpan = (parent: HTMLElement | null, fontSize = '16px'): HTMLSpanElement => {
  const span = document.createElement('span');

  span.style.fontSize = fontSize;
  parent?.appendChild(span);

  return span;
};

/**
 * Test helper stubbing the layout query jsdom never answers.
 */
const stubClientRects = (span: HTMLElement, rects: DOMRect[]): void => {
  vi.spyOn(span, 'getClientRects').mockReturnValue(toDOMRectList(rects));
};

describe('FakeBackgroundShadows — exact painted values', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('applyBoxShadowToWrapper', () => {
    it('extends by half the leftover line-height', () => {
      const parent = makeParent('24px');
      const wrapper = makeSpan(parent);

      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 16));

      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);

      expect(wrapper.style.boxShadow).toBe(`0 4px 0 ${COLOR}, 0 -4px 0 ${COLOR}`);
    });

    it('estimates a "normal" line-height as 1.2x the font size', () => {
      // 20px font with no line-height declared: 20 * 1.2 = 24, so the 16px-tall
      // wrapper gets (24 - 16) / 2 = 4px on each side. Dividing instead of
      // multiplying would land on 0.333px.
      const parent = makeParent();
      const wrapper = makeSpan(parent, '20px');

      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 16));

      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);

      expect(wrapper.style.boxShadow).toBe(`0 4px 0 ${COLOR}, 0 -4px 0 ${COLOR}`);
    });

    it('paints nothing when the wrapper already fills the line', () => {
      const parent = makeParent('16px');
      const wrapper = makeSpan(parent);

      vi.spyOn(wrapper, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 50, 16));

      FakeBackgroundShadows.applyBoxShadowToWrapper(wrapper);

      expect(wrapper.style.boxShadow).toBe('');
    });
  });

  describe('groupRectsByLine', () => {
    it('keeps rects exactly 2px apart on separate lines', () => {
      const span = makeSpan(makeParent('24px'));
      const rects: LineRect[] = [
        { top: 0,
          bottom: 10,
          span },
        { top: 2,
          bottom: 30,
          span },
      ];

      expect(FakeBackgroundShadows.groupRectsByLine(rects)).toEqual([
        { top: 0,
          bottom: 10 },
        { top: 2,
          bottom: 30 },
      ]);
    });

    it('merges rects 1px apart into one line that spans both', () => {
      // Tops 3 and 4 rather than 0 and 1: with a zero in the expression the
      // distance and the sum agree, and a "+ instead of -" defect hides.
      const span = makeSpan(makeParent('24px'));
      const rects: LineRect[] = [
        { top: 3,
          bottom: 10,
          span },
        { top: 4,
          bottom: 30,
          span },
      ];

      expect(FakeBackgroundShadows.groupRectsByLine(rects)).toEqual([
        { top: 3,
          bottom: 30 },
      ]);
    });
  });

  describe('applyLineHeightExtensions — guards', () => {
    it('paints nothing when no span reports a rect', () => {
      // The measure pass and the paint pass each call getClientRects(), so the
      // early return can only be observed by a span that measures empty and
      // would have painted had the pass continued.
      const parent = makeParent('24px');
      const span = makeSpan(parent);

      vi.spyOn(span, 'getClientRects')
        .mockReturnValueOnce(toDOMRectList([]))
        .mockReturnValue(toDOMRectList([new DOMRect(0, 0, 50, 16)]));

      FakeBackgroundShadows.applyLineHeightExtensions([span]);

      expect(span.style.boxShadow).toBe('');
    });

    it('skips a span that has no client rects at paint time', () => {
      const parent = makeParent('24px');
      const painted = makeSpan(parent);
      const empty = makeSpan(parent);

      stubClientRects(painted, [new DOMRect(0, 0, 50, 16)]);
      stubClientRects(empty, []);

      expect(() => FakeBackgroundShadows.applyLineHeightExtensions([painted, empty])).not.toThrow();

      expect(empty.style.boxShadow).toBe('');
      expect(painted.style.boxShadow).toBe(`inset 0 0 0 9999px ${COLOR}, 0 4px 0 ${COLOR}, 0 -4px 0 ${COLOR}`);
    });

    it('skips a detached span instead of reading its parent style', () => {
      const orphan = makeSpan(null);

      stubClientRects(orphan, [new DOMRect(0, 0, 50, 16)]);

      expect(() => FakeBackgroundShadows.applyLineHeightExtensions([orphan])).not.toThrow();

      expect(orphan.style.boxShadow).toBe('');
    });
  });

  describe('applyLineHeightExtensions — sorting before grouping', () => {
    it('sorts rects top-down so a bottom-up chain does not collapse into one line', () => {
      // Five rects 1.5px apart, reported bottom-up. Each step is under the 2px
      // merge threshold, so grouping them in the order given walks one line's
      // top all the way down and yields a single line. Sorted ascending they
      // form three lines instead. The 6px total spread is what makes the two
      // outcomes visible: it is wider than findLineIndex's 5px window, so only
      // the sorted grouping puts the first and last rect on different lines.
      // Heights are 0 so each line's bottom is its own top; the 2px line-height
      // then gives a 1px base extension, under the 1.5px inter-line gap.
      const parent = makeParent('2px');
      const span = makeSpan(parent);

      stubClientRects(span, [
        new DOMRect(0, 6, 50, 0),
        new DOMRect(0, 4.5, 50, 0),
        new DOMRect(0, 3, 50, 0),
        new DOMRect(0, 1.5, 50, 0),
        new DOMRect(0, 0, 50, 0),
      ]);

      FakeBackgroundShadows.applyLineHeightExtensions([span]);

      expect(span.style.boxShadow).toBe(`inset 0 0 0 9999px ${COLOR}, 0 1.5px 0 ${COLOR}, 0 -1px 0 ${COLOR}`);
    });
  });

  describe('applyLineHeightExtensions — single-line spans', () => {
    it('uses the base extension on both sides', () => {
      const parent = makeParent('24px');
      const span = makeSpan(parent);

      stubClientRects(span, [new DOMRect(0, 0, 50, 16)]);

      FakeBackgroundShadows.applyLineHeightExtensions([span]);

      expect(span.style.boxShadow).toBe(`inset 0 0 0 9999px ${COLOR}, 0 4px 0 ${COLOR}, 0 -4px 0 ${COLOR}`);
    });

    it('estimates a "normal" line-height as 1.2x the font size', () => {
      const parent = makeParent();
      const span = makeSpan(parent, '20px');

      stubClientRects(span, [new DOMRect(0, 0, 50, 16)]);

      FakeBackgroundShadows.applyLineHeightExtensions([span]);

      expect(span.style.boxShadow).toBe(`inset 0 0 0 9999px ${COLOR}, 0 4px 0 ${COLOR}, 0 -4px 0 ${COLOR}`);
    });

    it('paints only the inset fill when the span already fills the line', () => {
      const parent = makeParent('16px');
      const span = makeSpan(parent);

      stubClientRects(span, [new DOMRect(0, 0, 50, 16)]);

      FakeBackgroundShadows.applyLineHeightExtensions([span]);

      expect(span.style.boxShadow).toBe(`inset 0 0 0 9999px ${COLOR}`);
    });

    it('keeps the base extension when several rects land on the same line', () => {
      // Two rects 1px apart merge into one line group, so the span does not
      // straddle lines even though it reports more than one rect.
      const parent = makeParent('24px');
      const sameLine = makeSpan(parent);
      const below = makeSpan(parent);

      stubClientRects(sameLine, [new DOMRect(0, 0, 50, 16), new DOMRect(0, 1, 50, 16)]);
      stubClientRects(below, [new DOMRect(0, 40, 50, 16)]);

      FakeBackgroundShadows.applyLineHeightExtensions([sameLine, below]);

      expect(sameLine.style.boxShadow).toBe(`inset 0 0 0 9999px ${COLOR}, 0 4px 0 ${COLOR}, 0 -4px 0 ${COLOR}`);
      expect(below.style.boxShadow).toBe(`inset 0 0 0 9999px ${COLOR}, 0 4px 0 ${COLOR}, 0 -4px 0 ${COLOR}`);
    });
  });

  describe('applyLineHeightExtensions — spans straddling lines', () => {
    it('keeps the base extension when the span ends on the last line', () => {
      const parent = makeParent('24px');
      const span = makeSpan(parent);

      stubClientRects(span, [new DOMRect(0, 0, 50, 16), new DOMRect(0, 40, 50, 16)]);

      expect(() => FakeBackgroundShadows.applyLineHeightExtensions([span])).not.toThrow();

      expect(span.style.boxShadow).toBe(`inset 0 0 0 9999px ${COLOR}, 0 4px 0 ${COLOR}, 0 -4px 0 ${COLOR}`);
    });

    it('stretches the bottom across the gap when the span ends on a middle line', () => {
      // Three line groups at tops 0, 5 and 40. The 5px separation is the exact
      // boundary of findLineIndex's window, so the straddling span's last rect
      // resolves to line 1 only while the comparison stays strict.
      // Line 1 ends at 21 and line 2 starts at 40, so the 19px gap minus the
      // next line's own 4px rise leaves 15px to cover: 4 + 15 = 19.
      const parent = makeParent('24px');
      const straddling = makeSpan(parent);
      const below = makeSpan(parent);

      stubClientRects(straddling, [new DOMRect(0, 0, 50, 16), new DOMRect(0, 5, 50, 16)]);
      stubClientRects(below, [new DOMRect(0, 40, 50, 16)]);

      FakeBackgroundShadows.applyLineHeightExtensions([straddling, below]);

      expect(straddling.style.boxShadow).toBe(`inset 0 0 0 9999px ${COLOR}, 0 19px 0 ${COLOR}, 0 -4px 0 ${COLOR}`);
      expect(below.style.boxShadow).toBe(`inset 0 0 0 9999px ${COLOR}, 0 4px 0 ${COLOR}, 0 -4px 0 ${COLOR}`);
    });

    it('treats a rect that matches no line group as the first line', () => {
      // The measure pass and the paint pass each call getClientRects(); only a
      // relayout between them can hand the paint pass a rect that sits outside
      // every line group. Without the fallback the index stays -1, which reads
      // as "straddles lines" and stretches the bottom to 24px.
      const parent = makeParent('24px');
      const moved = makeSpan(parent);
      const below = makeSpan(parent);

      vi.spyOn(moved, 'getClientRects')
        .mockReturnValueOnce(toDOMRectList([new DOMRect(0, 0, 50, 16)]))
        .mockReturnValue(toDOMRectList([new DOMRect(0, 100, 50, 16), new DOMRect(0, 0, 50, 16)]));
      stubClientRects(below, [new DOMRect(0, 40, 50, 16)]);

      FakeBackgroundShadows.applyLineHeightExtensions([moved, below]);

      expect(moved.style.boxShadow).toBe(`inset 0 0 0 9999px ${COLOR}, 0 4px 0 ${COLOR}, 0 -4px 0 ${COLOR}`);
    });
  });
});

/*
 * Six live mutants in shadows.ts have no observable effect through the module's
 * public surface:
 *
 * - line 157 `clientRects.length > 1` -> `true` and -> `>= 1`. Both differ from
 *   the original only when there is exactly one rect, and then firstRect and
 *   lastRect are the same rect, so `firstLineIndex !== lastLineIndex` is false
 *   and the `&&` collapses to false either way.
 * - line 159 `isFirstLine` -> `true`, -> `false`, and `===` -> `!==`. The value
 *   is only ever passed to calculateLineTopExtension's `_isFirstLine`, whose
 *   body is a bare `return baseExtension`, so nothing reads it.
 * - line 184 `index >= 0` -> `index > 0`. The two differ only at index === 0,
 *   where both branches of the conditional produce 0.
 */
