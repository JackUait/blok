/**
 * Mutation-hardening tests for ColumnDropAnimation.
 *
 * The module writes styles that a later line overwrites inside the same tick,
 * so an end-state assertion cannot see the FLIP "pin" at all. Those steps are
 * read back through a MutationObserver with `attributeOldValue`, drained
 * synchronously with `takeRecords()`; the resulting array is the full timeline
 * of the element's `style` attribute (every recorded old value, then the value
 * it ended on).
 *
 * Rects are stubbed per element with distinct numbers because jsdom reports
 * all-zero geometry, and cssstyle silently REJECTS an invalid value (`NaN`,
 * `undefined`, `false`), leaving the previous one in place — which is what
 * makes a blanked or retyped `flex-grow` observable.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COLUMN_DROP_ANIMATING_ATTR,
  animateColumnWidths,
  captureSiblingTops,
  computeStartGrows,
  finishColumnDropAnimations,
  playSiblingShift,
  settleDragPreview,
} from '../../../../../../src/components/modules/drag/utils/ColumnDropAnimation';

/** Serialized `transition` the width animation writes on every holder. */
const WIDTH_TRANSITION =
  'flex-grow 200ms cubic-bezier(0.2, 0, 0, 1), opacity 200ms cubic-bezier(0.2, 0, 0, 1)';

/** Serialized `transition` the sibling FLIP writes. */
const SHIFT_TRANSITION = 'transform 200ms cubic-bezier(0.2, 0, 0, 1)';

/** matchMedia stub: both guard queries (reduced motion, stacked layout) say no. */
const stubMatchMedia = (matchesByQuery: Record<string, boolean> = {}): void => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: matchesByQuery[query] ?? false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
};

const rectOf = (values: { top?: number; height?: number }): DOMRect => {
  const top = values.top ?? 0;
  const height = values.height ?? 0;

  return {
    x: 0,
    y: top,
    top,
    left: 0,
    right: 0,
    bottom: top + height,
    width: 0,
    height,
    toJSON: () => ({}),
  };
};

/** A block-ish element with no inline styles at all, so `style` starts as null. */
const makeBlock = (): HTMLElement => {
  const element = document.createElement('div');

  element.setAttribute('data-blok-element', '');

  return element;
};

const makeHolder = (flexGrow = '1'): HTMLElement => {
  const holder = makeBlock();

  holder.style.flexGrow = flexGrow;

  return holder;
};

/** Build a columns row with the given holders attached to a container. */
const makeRow = (holders: HTMLElement[]): HTMLElement => {
  const container = document.createElement('div');

  container.setAttribute('data-blok-columns', '');
  holders.forEach(holder => container.appendChild(holder));
  document.body.appendChild(container);

  return container;
};

interface StyleTimeline {
  /** Every recorded old value of `style`, then the value the element ended on. */
  read: () => (string | null)[];
}

const watchStyle = (element: HTMLElement): StyleTimeline => {
  const observer = new MutationObserver(() => undefined);

  observer.observe(element, {
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['style'],
  });

  return {
    read: () => [
      ...observer.takeRecords().map(record => record.oldValue),
      element.getAttribute('style'),
    ],
  };
};

describe('ColumnDropAnimation — mutation coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    stubMatchMedia();
  });

  afterEach(() => {
    finishColumnDropAnimations();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('media-query guards', () => {
    it('animates when the environment has no matchMedia at all', () => {
      vi.stubGlobal('matchMedia', undefined);

      const first = makeHolder('1');
      const second = makeHolder('1');
      const container = makeRow([first, second]);

      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rectOf({ height: 600 }));

      expect(() => animateColumnWidths({
        holders: [first, second],
        startWidths: [600, 200],
        newColumnHolder: second,
      })).not.toThrow();

      expect(first.getAttribute('style')).toBe(`transition: ${WIDTH_TRANSITION}; flex-grow: 1;`);
      expect(container.getAttribute(COLUMN_DROP_ANIMATING_ATTR)).toBe('');
    });
  });

  describe('computeStartGrows', () => {
    it('falls back to the final grows when they sum to exactly zero', () => {
      expect(computeStartGrows([600, 200], [1, -1])).toEqual([1, -1]);
    });
  });

  describe('animateColumnWidths — row container', () => {
    it('pins the row height and clips it, then releases both on finish', () => {
      const first = makeHolder('1');
      const second = makeHolder('1');
      const container = makeRow([first, second]);

      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rectOf({ height: 600 }));

      animateColumnWidths({
        holders: [first, second],
        startWidths: [600, 200],
        newColumnHolder: second,
      });

      expect(container.getAttribute('style')).toBe('height: 600px; overflow: hidden;');
      expect(container.getAttribute(COLUMN_DROP_ANIMATING_ATTR)).toBe('');

      finishColumnDropAnimations();

      expect(container.getAttribute('style')).toBe('');
      expect(container.hasAttribute(COLUMN_DROP_ANIMATING_ATTR)).toBe(false);
    });

    it('leaves a row that measures zero height unpinned', () => {
      const first = makeHolder('1');
      const second = makeHolder('1');
      const container = makeRow([first, second]);

      animateColumnWidths({
        holders: [first, second],
        startWidths: [600, 200],
        newColumnHolder: second,
      });

      // The animation ran; only the height/overflow pin was skipped.
      expect(first.getAttribute('style')).toBe(`transition: ${WIDTH_TRANSITION}; flex-grow: 1;`);
      expect(container.getAttribute('style')).toBe(null);
      expect(container.getAttribute(COLUMN_DROP_ANIMATING_ATTR)).toBe('');
    });

    it('animates detached holders that have no row container', () => {
      const first = makeHolder('1');
      const second = makeHolder('1');

      expect(() => animateColumnWidths({
        holders: [first, second],
        startWidths: [600, 200],
        newColumnHolder: second,
      })).not.toThrow();

      expect(first.getAttribute('style')).toBe(`transition: ${WIDTH_TRANSITION}; flex-grow: 1;`);

      expect(() => finishColumnDropAnimations()).not.toThrow();

      expect(first.getAttribute('style')).toBe('flex-grow: 1;');
    });
  });

  describe('animateColumnWidths — grows', () => {
    it('animates without a new column holder', () => {
      const first = makeHolder('1');
      const second = makeHolder('1');
      const container = makeRow([first, second]);

      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rectOf({ height: 600 }));

      expect(() => animateColumnWidths({
        holders: [first, second],
        startWidths: [600, 200],
      })).not.toThrow();

      expect(second.getAttribute('style')).toBe(`transition: ${WIDTH_TRANSITION}; flex-grow: 1;`);

      expect(() => finishColumnDropAnimations()).not.toThrow();

      expect(second.getAttribute('style')).toBe('flex-grow: 1;');
    });

    it('treats a holder with no inline flex-grow as grow 1', () => {
      const first = makeBlock();
      const second = makeBlock();
      const container = makeRow([first, second]);

      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rectOf({ height: 600 }));

      animateColumnWidths({
        holders: [first, second],
        startWidths: [600, 200],
        newColumnHolder: second,
      });

      expect(first.getAttribute('style')).toBe(`transition: ${WIDTH_TRANSITION}; flex-grow: 1;`);

      finishColumnDropAnimations();

      expect(first.getAttribute('style')).toBe('flex-grow: 1;');
    });

    it('pins the start grows and the new column opacity for one frame', () => {
      const first = makeHolder('1');
      const second = makeHolder('1');
      const container = makeRow([first, second]);

      vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(rectOf({ height: 600 }));

      const firstTimeline = watchStyle(first);
      const secondTimeline = watchStyle(second);

      // 600 + 200 of pre-drop width against final grows [1, 1] -> [1.5, 0.5].
      animateColumnWidths({
        holders: [first, second],
        startWidths: [600, 200],
        newColumnHolder: second,
      });

      expect(firstTimeline.read()).toEqual([
        'flex-grow: 1;',
        '',
        'flex-grow: 1.5;',
        `flex-grow: 1.5; transition: ${WIDTH_TRANSITION};`,
        `transition: ${WIDTH_TRANSITION};`,
        `transition: ${WIDTH_TRANSITION}; flex-grow: 1;`,
      ]);

      expect(secondTimeline.read()).toEqual([
        'flex-grow: 1;',
        '',
        'flex-grow: 0.5;',
        'flex-grow: 0.5; opacity: 0;',
        `flex-grow: 0.5; opacity: 0; transition: ${WIDTH_TRANSITION};`,
        `opacity: 0; transition: ${WIDTH_TRANSITION};`,
        `opacity: 0; transition: ${WIDTH_TRANSITION}; flex-grow: 1;`,
        `opacity: 1; transition: ${WIDTH_TRANSITION}; flex-grow: 1;`,
      ]);
    });
  });

  describe('runOnce bookkeeping', () => {
    const makePreview = (): HTMLElement => {
      const preview = document.createElement('div');

      document.body.appendChild(preview);

      return preview;
    };

    it('clears the fallback timer once the element transition ends', () => {
      const preview = makePreview();

      settleDragPreview({ preview, targetRect: { left: 50, top: 120 } });

      expect(vi.getTimerCount()).toBe(1);

      preview.dispatchEvent(new Event('transitionend'));

      expect(vi.getTimerCount()).toBe(0);
    });

    it('detaches exactly the transitionend listener it added', () => {
      const preview = makePreview();
      const addSpy = vi.spyOn(preview, 'addEventListener');
      const removeSpy = vi.spyOn(preview, 'removeEventListener');

      settleDragPreview({ preview, targetRect: { left: 50, top: 120 } });

      expect(addSpy.mock.calls).toHaveLength(1);

      const added = addSpy.mock.calls[0];

      expect(added[0]).toBe('transitionend');

      preview.dispatchEvent(new Event('transitionend'));

      expect(removeSpy.mock.calls).toEqual([[added[0], added[1]]]);
    });

    it('runs the cleanup once even when a late transitionend re-enters it', () => {
      const preview = makePreview();
      const removeSpy = vi.spyOn(preview, 'remove');

      // Neutralizing the detach keeps the transitionend path armed after the
      // flush, which is the only way to exercise the once-guard on its own.
      vi.spyOn(preview, 'removeEventListener').mockReturnValue(undefined);

      settleDragPreview({ preview, targetRect: { left: 0, top: 0 } });
      finishColumnDropAnimations();
      preview.dispatchEvent(new Event('transitionend'));

      expect(removeSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('captureSiblingTops', () => {
    it('returns nothing for an element that has no parent', () => {
      expect(captureSiblingTops(makeBlock())).toEqual([]);
    });
  });

  describe('playSiblingShift', () => {
    it('skips a captured block that left the document', () => {
      const block = makeBlock();

      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rectOf({ top: 0 }));

      playSiblingShift([{ element: block, top: 100 }]);

      expect(block.getAttribute('style')).toBe(null);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('animates a block that moved exactly one pixel', () => {
      const block = makeBlock();

      document.body.appendChild(block);
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rectOf({ top: 101 }));

      playSiblingShift([{ element: block, top: 100 }]);

      expect(block.getAttribute('style')).toBe(`transition: ${SHIFT_TRANSITION};`);
    });

    it('pins the inverted translateY for one frame before releasing it', () => {
      const block = makeBlock();

      document.body.appendChild(block);
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rectOf({ top: 140 }));

      const timeline = watchStyle(block);

      playSiblingShift([{ element: block, top: 100 }]);

      expect(timeline.read()).toEqual([
        null,
        'transform: translateY(-40px);',
        `transform: translateY(-40px); transition: ${SHIFT_TRANSITION};`,
        `transition: ${SHIFT_TRANSITION};`,
      ]);
    });

    it('clears an inline transform written while the shift is in flight', () => {
      const block = makeBlock();

      document.body.appendChild(block);
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue(rectOf({ top: 140 }));

      playSiblingShift([{ element: block, top: 100 }]);
      block.style.transform = 'translateY(5px)';

      finishColumnDropAnimations();

      expect(block.getAttribute('style')).toBe('');
    });
  });

  /**
   * Strongest attempts at the mutants the equivalence block below claims are
   * unkillable. Each one drives the exact input the mutant would need to
   * diverge on; they pass under the mutant too, which is the measurement behind
   * those claims.
   */
  describe('equivalence probes', () => {
    it('returns nothing when the parent element is undefined rather than null', () => {
      const block = makeBlock();

      // Reaches the `?? []` fallback through the OTHER nullish value, so the
      // only thing left between the injected filler and the result is the
      // `instanceof HTMLElement` filter.
      Object.defineProperty(block, 'parentElement', { value: undefined, configurable: true });

      expect(captureSiblingTops(block)).toEqual([]);
    });

    it('never reads the media queries for an empty holder list', () => {
      const matchMedia = vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }));

      vi.stubGlobal('matchMedia', matchMedia);

      animateColumnWidths({ holders: [], startWidths: [] });

      // Returns on the length guard, short of the reduced-motion query. The
      // zero-sum guard sits next in line and would return on its own.
      expect(matchMedia).not.toHaveBeenCalled();
    });

    it('animates holders whose row container is undefined', () => {
      const first = makeHolder('1');
      const second = makeHolder('1');

      Object.defineProperty(first, 'parentElement', { value: undefined, configurable: true });

      expect(() => animateColumnWidths({
        holders: [first, second],
        startWidths: [600, 200],
        newColumnHolder: second,
      })).not.toThrow();

      // `container?.height ?? 0` collapsed the missing container to a zero
      // height, so the pin was skipped and nothing needed releasing.
      expect(first.getAttribute('style')).toBe(`transition: ${WIDTH_TRANSITION}; flex-grow: 1;`);

      expect(() => finishColumnDropAnimations()).not.toThrow();

      expect(first.getAttribute('style')).toBe('flex-grow: 1;');
    });

    it('flushes every in-flight animation exactly once across repeated flushes', () => {
      const first = document.createElement('div');
      const second = document.createElement('div');

      document.body.append(first, second);

      const firstRemove = vi.spyOn(first, 'remove');
      const secondRemove = vi.spyOn(second, 'remove');

      // Leaving each listener attached is what lets the later entry points
      // reach the once-guard instead of short-circuiting on a missing listener.
      vi.spyOn(first, 'removeEventListener').mockReturnValue(undefined);
      vi.spyOn(second, 'removeEventListener').mockReturnValue(undefined);

      settleDragPreview({ preview: first, targetRect: { left: 0, top: 0 } });
      settleDragPreview({ preview: second, targetRect: { left: 0, top: 0 } });

      finishColumnDropAnimations();
      finishColumnDropAnimations();
      first.dispatchEvent(new Event('transitionend'));
      second.dispatchEvent(new Event('transitionend'));

      expect(firstRemove).toHaveBeenCalledTimes(1);
      expect(secondRemove).toHaveBeenCalledTimes(1);
    });
  });
});

/*
 * Proven-equivalent mutants — no input can distinguish them, so no test can
 * kill them. Measured: each survives the `equivalence probes` block above,
 * which drives the exact input the mutant would need to diverge on. Evidence
 * for each:
 *
 * - ObjectLiteral `{ done: false }` -> `{}` (runOnce state): `state.done` is
 *   read only by the once-guard. `undefined` and `false` are both falsy, and
 *   the only write sets it to `true`.
 *
 * - CallExpression `activeFinishers.delete(finish)` -> removed: the Set is
 *   module-private and read only by finishColumnDropAnimations, which invokes
 *   each finisher. A stale finisher re-invoked there returns at the once-guard,
 *   so leaving it in the Set has no observable effect.
 *
 * - ConditionalExpression `holders.length === 0` -> `false`: with the lengths
 *   already known equal (first disjunct), an empty `holders` implies an empty
 *   `startWidths`, whose reduce seeds 0, so `widthSum <= 0` returns on the very
 *   next disjunct. The guard is redundant.
 *
 * - ArrayDeclaration `?? []` -> `?? ["Stryker was here"]` (captureSiblingTops):
 *   only reachable when `after` has no parent. `indexOf(after)` is then -1, so
 *   `slice(0)` keeps the injected string, and `sibling instanceof HTMLElement`
 *   filters it out. Both versions return [].
 *
 * - The four `container` nullish checks in animateColumnWidths —
 *   `container !== null` -> `true`, `container !== undefined` -> `true`,
 *   `container !== null && container !== undefined` -> `true`, and that same
 *   pair's `&&` -> `||`: `settledHeight` is
 *   `container?.getBoundingClientRect().height ?? 0`, so a nullish container
 *   forces `settledHeight` to 0 and the trailing `settledHeight > 0` blocks the
 *   body no matter what the nullish checks say. `parentElement` is typed
 *   `HTMLElement | null`, so `container !== undefined` is a tautology on top of
 *   that.
 */
