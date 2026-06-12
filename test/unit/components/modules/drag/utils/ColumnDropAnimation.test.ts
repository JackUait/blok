/**
 * Tests for ColumnDropAnimation — the FLIP-style motion played when a drag
 * creates a new column (wrap or add-beside).
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import {
  COLUMN_DROP_ANIMATION_MS,
  COLUMN_DROP_ANIMATING_ATTR,
  computeStartGrows,
  animateColumnWidths,
  captureSiblingTops,
  playSiblingShift,
  settleDragPreview,
  finishColumnDropAnimations,
} from '../../../../../../src/components/modules/drag/utils/ColumnDropAnimation';

/** matchMedia stub: both guard queries (reduced motion, stacked layout) say no. */
const stubMatchMedia = (matchesByQuery: Record<string, boolean> = {}): void => {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: matchesByQuery[query] ?? false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
};

const makeHolder = (flexGrow = '1'): HTMLElement => {
  const holder = document.createElement('div');

  holder.setAttribute('data-blok-element', '');
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

describe('ColumnDropAnimation', () => {
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

  describe('computeStartGrows', () => {
    it('makes start grows proportional to start widths, preserving the final grow sum', () => {
      // 600px existing + 0px new column, final grows [1, 1] (sum 2)
      expect(computeStartGrows([600, 0], [1, 1])).toEqual([2, 0]);
    });

    it('splits three columns proportionally', () => {
      expect(computeStartGrows([300, 300, 0], [1, 1, 1])).toEqual([1.5, 1.5, 0]);
    });

    it('handles uneven pre-drop widths', () => {
      // 400/200 split + new column, sum of final grows = 3
      const grows = computeStartGrows([400, 200, 0], [1, 1, 1]);

      expect(grows[0]).toBeCloseTo(2);
      expect(grows[1]).toBeCloseTo(1);
      expect(grows[2]).toBe(0);
    });

    it('returns final grows untouched when start widths sum to zero', () => {
      expect(computeStartGrows([0, 0], [1, 1])).toEqual([1, 1]);
    });

    it('returns final grows when lengths mismatch', () => {
      expect(computeStartGrows([600], [1, 1])).toEqual([1, 1]);
    });
  });

  describe('animateColumnWidths', () => {
    it('pins start grows then transitions to the final grows', () => {
      const existing = makeHolder('1');
      const added = makeHolder('1');

      makeRow([existing, added]);

      animateColumnWidths({
        holders: [existing, added],
        startWidths: [600, 0],
        newColumnHolder: added,
      });

      // After the synchronous pin+release, inline grow is back at the final
      // value and a transition drives the visual interpolation.
      expect(existing.style.flexGrow).toBe('1');
      expect(added.style.flexGrow).toBe('1');
      expect(existing.style.transition).toContain('flex-grow');
      expect(added.style.transition).toContain('flex-grow');
    });

    it('fades the new column in via opacity', () => {
      const existing = makeHolder('1');
      const added = makeHolder('1');

      makeRow([existing, added]);

      animateColumnWidths({
        holders: [existing, added],
        startWidths: [600, 0],
        newColumnHolder: added,
      });

      expect(added.style.opacity).toBe('1');
      expect(added.style.transition).toContain('opacity');
    });

    it('marks the row container with the animating attribute', () => {
      const existing = makeHolder('1');
      const added = makeHolder('1');
      const container = makeRow([existing, added]);

      animateColumnWidths({
        holders: [existing, added],
        startWidths: [600, 0],
        newColumnHolder: added,
      });

      expect(container.hasAttribute(COLUMN_DROP_ANIMATING_ATTR)).toBe(true);
    });

    it('cleans up inline transition, opacity and the attribute on transitionend', () => {
      const existing = makeHolder('1');
      const added = makeHolder('1');
      const container = makeRow([existing, added]);

      animateColumnWidths({
        holders: [existing, added],
        startWidths: [600, 0],
        newColumnHolder: added,
      });

      const event = new Event('transitionend');

      existing.dispatchEvent(event);

      expect(existing.style.transition).toBe('');
      expect(added.style.transition).toBe('');
      expect(added.style.opacity).toBe('');
      expect(container.hasAttribute(COLUMN_DROP_ANIMATING_ATTR)).toBe(false);
      // The persisted source of truth survives cleanup.
      expect(existing.style.flexGrow).toBe('1');
    });

    it('cleans up via the fallback timer when transitionend never fires', () => {
      const existing = makeHolder('1');
      const added = makeHolder('1');
      const container = makeRow([existing, added]);

      animateColumnWidths({
        holders: [existing, added],
        startWidths: [600, 0],
        newColumnHolder: added,
      });

      vi.advanceTimersByTime(COLUMN_DROP_ANIMATION_MS + 200);

      expect(existing.style.transition).toBe('');
      expect(container.hasAttribute(COLUMN_DROP_ANIMATING_ATTR)).toBe(false);
    });

    it('ignores transitionend bubbling from a holder child', () => {
      const existing = makeHolder('1');
      const added = makeHolder('1');

      makeRow([existing, added]);
      const child = document.createElement('div');

      existing.appendChild(child);

      animateColumnWidths({
        holders: [existing, added],
        startWidths: [600, 0],
        newColumnHolder: added,
      });

      child.dispatchEvent(new Event('transitionend', { bubbles: true }));

      expect(existing.style.transition).not.toBe('');
    });

    it('does nothing when prefers-reduced-motion is set', () => {
      stubMatchMedia({ '(prefers-reduced-motion: reduce)': true });
      const existing = makeHolder('1');
      const added = makeHolder('1');

      makeRow([existing, added]);

      animateColumnWidths({
        holders: [existing, added],
        startWidths: [600, 0],
        newColumnHolder: added,
      });

      expect(existing.style.transition).toBe('');
      expect(added.style.opacity).toBe('');
    });

    it('does nothing in stacked (mobile) layout', () => {
      stubMatchMedia({ '(max-width: 650px)': true });
      const existing = makeHolder('1');
      const added = makeHolder('1');

      makeRow([existing, added]);

      animateColumnWidths({
        holders: [existing, added],
        startWidths: [600, 0],
        newColumnHolder: added,
      });

      expect(existing.style.transition).toBe('');
    });

    it('does nothing when start widths are all zero (jsdom-style no layout)', () => {
      const existing = makeHolder('1');
      const added = makeHolder('1');

      makeRow([existing, added]);

      animateColumnWidths({
        holders: [existing, added],
        startWidths: [0, 0],
        newColumnHolder: added,
      });

      expect(existing.style.transition).toBe('');
    });

    it('does nothing when holders and startWidths lengths mismatch', () => {
      const existing = makeHolder('1');

      makeRow([existing]);

      animateColumnWidths({
        holders: [existing],
        startWidths: [600, 0],
        newColumnHolder: null,
      });

      expect(existing.style.transition).toBe('');
    });
  });

  describe('captureSiblingTops / playSiblingShift', () => {
    it('captures following [data-blok-element] siblings with their tops', () => {
      const first = makeHolder();
      const second = makeHolder();
      const third = makeHolder();
      const container = document.createElement('div');

      container.append(first, second, third);
      document.body.appendChild(container);

      vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect);
      vi.spyOn(third, 'getBoundingClientRect').mockReturnValue({ top: 200 } as DOMRect);

      const captured = captureSiblingTops(first);

      expect(captured).toEqual([
        { element: second, top: 100 },
        { element: third, top: 200 },
      ]);
    });

    it('skips siblings without the data-blok-element attribute', () => {
      const first = makeHolder();
      const stranger = document.createElement('div');
      const second = makeHolder();
      const container = document.createElement('div');

      container.append(first, stranger, second);
      document.body.appendChild(container);

      vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ top: 50 } as DOMRect);

      const captured = captureSiblingTops(first);

      expect(captured).toEqual([{ element: second, top: 50 }]);
    });

    it('plays an inverted translateY then releases it with a transition', () => {
      const block = makeHolder();

      document.body.appendChild(block);
      // Block moved DOWN by 40px after the mutation (old top 100, new top 140).
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({ top: 140 } as DOMRect);

      playSiblingShift([{ element: block, top: 100 }]);

      // Released to its natural position with a transform transition running.
      expect(block.style.transform).toBe('');
      expect(block.style.transition).toContain('transform');
    });

    it('skips blocks that moved less than a pixel', () => {
      const block = makeHolder();

      document.body.appendChild(block);
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({ top: 100.4 } as DOMRect);

      playSiblingShift([{ element: block, top: 100 }]);

      expect(block.style.transition).toBe('');
    });

    it('cleans the transition up via the fallback timer', () => {
      const block = makeHolder();

      document.body.appendChild(block);
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({ top: 140 } as DOMRect);

      playSiblingShift([{ element: block, top: 100 }]);
      vi.advanceTimersByTime(COLUMN_DROP_ANIMATION_MS + 200);

      expect(block.style.transition).toBe('');
    });

    it('does nothing under prefers-reduced-motion', () => {
      stubMatchMedia({ '(prefers-reduced-motion: reduce)': true });
      const block = makeHolder();

      document.body.appendChild(block);
      vi.spyOn(block, 'getBoundingClientRect').mockReturnValue({ top: 140 } as DOMRect);

      playSiblingShift([{ element: block, top: 100 }]);

      expect(block.style.transition).toBe('');
    });
  });

  describe('settleDragPreview', () => {
    const makePreview = (): HTMLElement => {
      const preview = document.createElement('div');

      preview.style.position = 'fixed';
      preview.style.left = '300px';
      preview.style.top = '400px';
      document.body.appendChild(preview);

      return preview;
    };

    it('flies the preview to the target rect while fading out', () => {
      const preview = makePreview();

      settleDragPreview({ preview, targetRect: { left: 50, top: 120 } });

      expect(preview.style.left).toBe('50px');
      expect(preview.style.top).toBe('120px');
      expect(preview.style.opacity).toBe('0');
      expect(preview.style.transition).toContain('left');
      expect(preview.style.transition).toContain('opacity');
    });

    it('removes the preview from the DOM when the transition ends', () => {
      const preview = makePreview();

      settleDragPreview({ preview, targetRect: { left: 50, top: 120 } });
      preview.dispatchEvent(new Event('transitionend'));

      expect(preview.isConnected).toBe(false);
    });

    it('removes the preview via the fallback timer when transitionend never fires', () => {
      const preview = makePreview();

      settleDragPreview({ preview, targetRect: { left: 50, top: 120 } });
      vi.advanceTimersByTime(COLUMN_DROP_ANIMATION_MS + 200);

      expect(preview.isConnected).toBe(false);
    });

    it('removes the preview immediately under prefers-reduced-motion', () => {
      stubMatchMedia({ '(prefers-reduced-motion: reduce)': true });
      const preview = makePreview();

      settleDragPreview({ preview, targetRect: { left: 50, top: 120 } });

      expect(preview.isConnected).toBe(false);
    });
  });

  describe('finishColumnDropAnimations', () => {
    it('instantly completes every in-flight animation', () => {
      const existing = makeHolder('1');
      const added = makeHolder('1');
      const container = makeRow([existing, added]);
      const preview = document.createElement('div');

      document.body.appendChild(preview);

      animateColumnWidths({
        holders: [existing, added],
        startWidths: [600, 0],
        newColumnHolder: added,
      });
      settleDragPreview({ preview, targetRect: { left: 0, top: 0 } });

      finishColumnDropAnimations();

      expect(existing.style.transition).toBe('');
      expect(container.hasAttribute(COLUMN_DROP_ANIMATING_ATTR)).toBe(false);
      expect(preview.isConnected).toBe(false);
    });

    it('is safe to call with nothing in flight', () => {
      expect(() => finishColumnDropAnimations()).not.toThrow();
    });
  });
});
