import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  createPositionTracker,
  positionAnchored,
  positionFixedAnchored,
  resolveBoundaryRect,
} from '../../../../../src/components/utils/popover/anchored-position';

/**
 * jsdom has no layout: every getBoundingClientRect() is all-zero and
 * offsetWidth/offsetHeight are 0. Every fixture below stubs both the rects and
 * the viewport explicitly, so the asserted numbers are real geometry.
 */
const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  toJSON: () => ({}),
});

const setViewport = (width: number, height: number): void => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true, writable: true });
};

const setScroll = (x: number, y: number): void => {
  Object.defineProperty(window, 'scrollX', { value: x, configurable: true, writable: true });
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
};

/** Creates a content element with a measurable layout box. */
const makeContent = (width: number, height: number, useOffsets = true): HTMLElement => {
  const el = document.createElement('div');

  document.body.appendChild(el);

  if (useOffsets) {
    Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true });
    Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
  }
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(rect(0, 0, useOffsets ? 0 : width, useOffsets ? 0 : height));

  return el;
};

const makeAnchorElement = (r: DOMRect): HTMLElement => {
  const el = document.createElement('div');

  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue(r);

  return el;
};

describe('anchored-position', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setViewport(1024, 768);
    setScroll(0, 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('resolveBoundaryRect', () => {
    it('returns the live viewport rect when no boundary is given', () => {
      const resolved = resolveBoundaryRect(undefined, { width: 640, height: 480 });

      expect(resolved.left).toBe(0);
      expect(resolved.top).toBe(0);
      expect(resolved.x).toBe(0);
      expect(resolved.y).toBe(0);
      expect(resolved.right).toBe(640);
      expect(resolved.bottom).toBe(480);
      expect(resolved.width).toBe(640);
      expect(resolved.height).toBe(480);
      expect(resolved.toJSON()).toEqual({});
    });

    it('treats document.body as an alias for the viewport, not as an element rect', () => {
      vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(rect(11, 22, 33, 44));

      const resolved = resolveBoundaryRect(document.body, { width: 500, height: 400 });

      expect(resolved.left).toBe(0);
      expect(resolved.top).toBe(0);
      expect(resolved.right).toBe(500);
      expect(resolved.bottom).toBe(400);
    });

    it('treats document.documentElement as an alias for the viewport', () => {
      vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue(rect(11, 22, 33, 44));

      const resolved = resolveBoundaryRect(document.documentElement, { width: 500, height: 400 });

      expect(resolved.left).toBe(0);
      expect(resolved.right).toBe(500);
      expect(resolved.bottom).toBe(400);
    });

    it('reads the live rect of an explicit non-root element boundary', () => {
      const boundary = makeAnchorElement(rect(50, 60, 300, 200));

      const resolved = resolveBoundaryRect(boundary, { width: 1024, height: 768 });

      expect(resolved.left).toBe(50);
      expect(resolved.top).toBe(60);
      expect(resolved.right).toBe(350);
      expect(resolved.bottom).toBe(260);
    });

    it('passes an explicit DOMRect boundary through unchanged', () => {
      const boundary = rect(5, 6, 7, 8);

      expect(resolveBoundaryRect(boundary, { width: 1024, height: 768 })).toBe(boundary);
    });
  });

  describe('positionAnchored — vertical (default side)', () => {
    it('places content below the anchor with the default 8px offset and start align', () => {
      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 200, 120, 40));

      expect(resolved).toEqual({
        side: 'bottom',
        align: 'start',
        top: 248,
        left: 100,
      });
      expect(content.getAttribute('data-side')).toBe('bottom');
      expect(content.getAttribute('data-align')).toBe('start');
      expect(content.style.top).toBe('248px');
      expect(content.style.left).toBe('100px');
    });

    it('honours a custom offset', () => {
      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 200, 120, 40), { offset: 20 });

      expect(resolved.top).toBe(260);
    });

    it('keeps the bottom side at the exact fit threshold', () => {
      const content = makeContent(150, 100);
      // spaceBelow = 768 - 660 - 8 = 100 === height
      const resolved = positionAnchored(content, rect(100, 620, 120, 40));

      expect(resolved.side).toBe('bottom');
      expect(resolved.top).toBe(668);
    });

    it('flips to the top side one pixel past the fit threshold', () => {
      const content = makeContent(150, 100);
      // spaceBelow = 768 - 661 - 8 = 99 < 100, spaceAbove = 621 - 8 = 613 >= 100
      const resolved = positionAnchored(content, rect(100, 621, 120, 40));

      expect(resolved.side).toBe('top');
      expect(resolved.top).toBe(513);
      expect(content.getAttribute('data-side')).toBe('top');
    });

    it('stays on the bottom side when neither side fits', () => {
      const content = makeContent(150, 700);
      const resolved = positionAnchored(content, rect(100, 300, 120, 40));

      expect(resolved.side).toBe('bottom');
    });

    it('reports align "end" when the content flips to the left of the anchor', () => {
      const content = makeContent(150, 100);
      // spaceRight = 1024 - 900 = 124 < 150, spaceLeft = 950 >= 150
      const resolved = positionAnchored(content, rect(900, 200, 50, 40));

      expect(resolved.align).toBe('end');
      expect(resolved.left).toBe(800);
      expect(content.getAttribute('data-align')).toBe('end');
    });

    it('keeps align "start" at the exact horizontal fit threshold', () => {
      const content = makeContent(150, 100);
      // spaceRight = 1024 - 874 = 150 === width
      const resolved = positionAnchored(content, rect(874, 200, 50, 40));

      expect(resolved.align).toBe('start');
      expect(resolved.left).toBe(874);
    });

    it('adds the window scroll offset to the resolved document coordinates', () => {
      setScroll(30, 500);

      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 200, 120, 40));

      expect(resolved.top).toBe(748);
      expect(resolved.left).toBe(130);
      expect(content.style.top).toBe('748px');
      expect(content.style.left).toBe('130px');
    });

    it('constrains placement to an explicit element boundary', () => {
      const content = makeContent(150, 100);
      const boundary = makeAnchorElement(rect(0, 0, 1024, 400));
      // spaceBelow = 400 - 340 - 8 = 52 < 100 -> flips above
      const resolved = positionAnchored(content, rect(100, 300, 120, 40), { boundary });

      expect(resolved.side).toBe('top');
      expect(resolved.top).toBe(192);
    });

    it('reads the anchor rect from an anchor element', () => {
      const content = makeContent(150, 100);
      const anchor = makeAnchorElement(rect(200, 100, 60, 20));
      const resolved = positionAnchored(content, anchor);

      expect(resolved.top).toBe(128);
      expect(resolved.left).toBe(200);
    });
  });

  describe('positionAnchored — measurement', () => {
    it('prefers the layout box over the bounding rect', () => {
      const content = makeContent(150, 100);

      vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 900, 700));

      const resolved = positionAnchored(content, rect(100, 620, 120, 40));

      expect(resolved.side).toBe('bottom');
    });

    it('falls back to the bounding rect when the layout box is zero', () => {
      const content = makeContent(150, 100, false);
      const resolved = positionAnchored(content, rect(100, 621, 120, 40));

      expect(resolved.side).toBe('top');
      expect(resolved.top).toBe(513);
    });
  });

  describe('positionAnchored — apply flag', () => {
    it('stamps the side/align attributes but writes no styles when apply is false', () => {
      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 200, 120, 40), { apply: false });

      expect(resolved.top).toBe(248);
      expect(content.getAttribute('data-side')).toBe('bottom');
      expect(content.getAttribute('data-align')).toBe('start');
      expect(content.style.top).toBe('');
      expect(content.style.left).toBe('');
    });

    it('writes px-suffixed styles for a zero coordinate', () => {
      const content = makeContent(150, 100);

      positionAnchored(content, rect(0, -48, 120, 40));

      expect(content.style.top).toBe('0px');
      expect(content.style.left).toBe('0px');
    });
  });

  describe('positionAnchored — horizontal sides', () => {
    it('places content to the right of the anchor overlapping by the default 4px, vertically centered', () => {
      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 300, 100, 40), { side: 'right' });

      expect(resolved).toEqual({
        side: 'right',
        align: 'center',
        top: 270,
        left: 196,
      });
      expect(content.getAttribute('data-side')).toBe('right');
      expect(content.getAttribute('data-align')).toBe('center');
      expect(content.style.left).toBe('196px');
    });

    it('honours a custom overlap on the right side', () => {
      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 300, 100, 40), {
        side: 'right',
        overlap: 0,
      });

      expect(resolved.left).toBe(200);
    });

    it('keeps the right side at the exact horizontal fit threshold', () => {
      const content = makeContent(150, 100);
      // space right = 1024 - 878 + 4 = 150 === width
      const resolved = positionAnchored(content, rect(778, 300, 100, 40), { side: 'right' });

      expect(resolved.side).toBe('right');
      expect(resolved.left).toBe(874);
    });

    it('flips to the left side one pixel past the horizontal fit threshold', () => {
      const content = makeContent(150, 100);
      // space right = 1024 - 879 + 4 = 149 < 150; space left = 779 >= 150
      const resolved = positionAnchored(content, rect(779, 300, 100, 40), { side: 'right' });

      expect(resolved.side).toBe('left');
      expect(resolved.left).toBe(633);
      expect(content.getAttribute('data-side')).toBe('left');
    });

    it('places content to the left when side is left and it fits', () => {
      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(400, 300, 100, 40), { side: 'left' });

      expect(resolved.side).toBe('left');
      // 400 - 150 + 4
      expect(resolved.left).toBe(254);
    });

    it('flips a left-preferring placement to the right when the left has no room', () => {
      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 300, 100, 40), { side: 'left' });

      expect(resolved.side).toBe('right');
      expect(resolved.left).toBe(196);
    });

    it('aligns the content top with the reference rect for align start', () => {
      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 300, 100, 40), {
        side: 'right',
        align: 'start',
      });

      expect(resolved.align).toBe('start');
      expect(resolved.top).toBe(300);
    });

    it('aligns the content bottom with the reference rect for align end', () => {
      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 300, 100, 40), {
        side: 'right',
        align: 'end',
      });

      expect(resolved.top).toBe(240);
    });

    it('tracks alignTo rather than the anchor on the cross axis', () => {
      const content = makeContent(150, 100);
      const alignTo = makeAnchorElement(rect(120, 500, 80, 40));
      const resolved = positionAnchored(content, rect(100, 300, 100, 40), {
        side: 'right',
        alignTo,
      });

      // centered on alignTo: 500 + 20 - 50
      expect(resolved.top).toBe(470);
      // but the side still comes from the anchor
      expect(resolved.left).toBe(196);
    });

    it('clamps the cross axis to the viewport bottom margin', () => {
      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 740, 100, 40), { side: 'right' });

      // maxTop = 768 - 100 - 8
      expect(resolved.top).toBe(660);
    });

    it('clamps the cross axis to the viewport top margin', () => {
      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 0, 100, 40), { side: 'right' });

      expect(resolved.top).toBe(8);
    });

    it('pins to the top margin when the content is taller than the viewport', () => {
      const content = makeContent(150, 900);
      const resolved = positionAnchored(content, rect(100, 300, 100, 40), { side: 'right' });

      expect(resolved.top).toBe(8);
    });

    it('runs the side decision in boundary-local space', () => {
      const content = makeContent(150, 100);
      const boundary = rect(0, 0, 400, 768);
      // Within the 400px-wide boundary there is only 400 - 300 + 4 = 104px to
      // the right, so the content flips left even though the window is 1024 wide.
      const resolved = positionAnchored(content, rect(200, 300, 100, 40), {
        side: 'right',
        boundary,
      });

      expect(resolved.side).toBe('left');
      expect(resolved.left).toBe(54);
    });

    it('runs the cross-axis clamp in boundary-local space', () => {
      const content = makeContent(150, 100);
      const boundary = rect(0, 200, 1024, 300);
      // boundary 200..500 -> maxTop local = 300 - 100 - 8 = 192 -> viewport 392
      const resolved = positionAnchored(content, rect(100, 460, 100, 40), {
        side: 'right',
        boundary,
      });

      expect(resolved.top).toBe(392);
    });

    it('intersects a boundary that overflows the viewport with the viewport itself', () => {
      const content = makeContent(150, 100);
      const boundary = rect(-200, -100, 2000, 2000);
      const resolved = positionAnchored(content, rect(100, 740, 100, 40), { side: 'right' });
      const clamped = positionAnchored(content, rect(100, 740, 100, 40), {
        side: 'right',
        boundary,
      });

      expect(clamped.top).toBe(resolved.top);
      expect(clamped.top).toBe(660);
    });

    it('clamps a boundary whose left edge is off-screen to the viewport edge', () => {
      const content = makeContent(150, 100);
      const boundary = rect(-200, 0, 1400, 768);
      // The off-screen 200px are not real space: the content must not open left.
      const resolved = positionAnchored(content, rect(100, 300, 100, 40), {
        side: 'left',
        boundary,
      });

      expect(resolved.side).toBe('right');
      expect(resolved.left).toBe(196);
    });

    it('clamps a boundary whose top edge is off-screen to the viewport edge', () => {
      const content = makeContent(150, 100);
      const boundary = rect(0, -100, 1024, 868);
      const resolved = positionAnchored(content, rect(100, 0, 100, 40), {
        side: 'right',
        boundary,
      });

      expect(resolved.top).toBe(8);
      expect(resolved.left).toBe(196);
    });

    it('subtracts the boundary left when measuring the space on the anchor left', () => {
      const content = makeContent(150, 100);
      const boundary = rect(200, 0, 600, 768);
      // Inside the boundary the anchor has only 100px to its left, so a
      // left-preferring placement flips right.
      const resolved = positionAnchored(content, rect(300, 300, 100, 40), {
        side: 'left',
        boundary,
      });

      expect(resolved.side).toBe('right');
      expect(resolved.left).toBe(396);
      expect(resolved.top).toBe(270);
    });

    it('subtracts the boundary left when measuring the space on the anchor right', () => {
      const content = makeContent(150, 100);
      const boundary = rect(200, 0, 600, 768);
      const resolved = positionAnchored(content, rect(500, 300, 100, 40), {
        side: 'right',
        boundary,
      });

      expect(resolved.side).toBe('right');
      expect(resolved.left).toBe(596);
    });

    it('uses the boundary width, not the sum of its edges, as the local viewport', () => {
      const content = makeContent(300, 100);
      const boundary = rect(200, 0, 600, 768);
      // 600-wide boundary leaves 204px right of the anchor; 300 does not fit.
      const resolved = positionAnchored(content, rect(500, 300, 100, 40), {
        side: 'right',
        boundary,
      });

      expect(resolved.side).toBe('left');
      expect(resolved.left).toBe(204);
    });

    it('shifts the desired top into boundary-local space before clamping', () => {
      const content = makeContent(150, 100);
      const boundary = rect(0, 200, 1024, 300);
      // Centred top 270 sits comfortably inside the 200..500 boundary and must
      // not be pushed to the boundary's bottom ceiling.
      const resolved = positionAnchored(content, rect(100, 300, 100, 40), {
        side: 'right',
        boundary,
      });

      expect(resolved.top).toBe(270);
    });

    it('adds the scroll offsets to horizontal placements', () => {
      setScroll(30, 500);

      const content = makeContent(150, 100);
      const resolved = positionAnchored(content, rect(100, 300, 100, 40), { side: 'right' });

      expect(resolved.top).toBe(770);
      expect(resolved.left).toBe(226);
    });
  });

  describe('positionFixedAnchored', () => {
    it('writes viewport coordinates and position fixed', () => {
      setScroll(30, 500);

      const content = makeContent(150, 100);
      const resolved = positionFixedAnchored(content, rect(100, 200, 120, 40));

      expect(content.style.position).toBe('fixed');
      expect(content.style.top).toBe('248px');
      expect(content.style.left).toBe('100px');
      // the returned value stays in document coordinates
      expect(resolved.top).toBe(748);
      expect(resolved.left).toBe(130);
      expect(content.getAttribute('data-side')).toBe('bottom');
    });

    it('writes styles even though the underlying call is asked not to apply them', () => {
      const content = makeContent(150, 100);

      positionFixedAnchored(content, rect(100, 200, 120, 40));

      expect(content.style.top).toBe('248px');
      expect(content.style.left).toBe('100px');
    });

    it('forwards placement options', () => {
      const content = makeContent(150, 100);
      const resolved = positionFixedAnchored(content, rect(100, 300, 100, 40), { side: 'right' });

      expect(resolved.side).toBe('right');
      expect(content.style.left).toBe('196px');
    });
  });

  describe('createPositionTracker', () => {
    class FakeResizeObserver {
      public static instances: FakeResizeObserver[] = [];
      public observed: Element[] = [];
      public disconnected = false;

      public constructor(private readonly callback: () => void) {
        FakeResizeObserver.instances.push(this);
      }

      public observe(target: Element): void {
        this.observed.push(target);
      }

      public unobserve(): void {}

      public disconnect(): void {
        this.disconnected = true;
      }

      public trigger(): void {
        this.callback();
      }
    }

    const originalResizeObserver = globalThis.ResizeObserver;

    beforeEach(() => {
      FakeResizeObserver.instances = [];
      Object.defineProperty(globalThis, 'ResizeObserver', {
        value: FakeResizeObserver,
        configurable: true,
        writable: true,
      });
    });

    afterEach(() => {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        value: originalResizeObserver,
        configurable: true,
        writable: true,
      });
    });

    it('repositions on window resize after attach', () => {
      const reposition = vi.fn();
      const tracker = createPositionTracker(document.createElement('div'), reposition);

      tracker.attach();
      window.dispatchEvent(new Event('resize'));

      expect(reposition).toHaveBeenCalledTimes(1);
      expect(reposition).toHaveBeenCalledWith();
    });

    it('observes scrolls in nested containers via the capture phase and forwards the event', () => {
      const reposition = vi.fn();
      const scroller = document.createElement('div');

      document.body.appendChild(scroller);

      const tracker = createPositionTracker(document.createElement('div'), reposition);

      tracker.attach();

      const event = new Event('scroll');

      scroller.dispatchEvent(event);

      expect(reposition).toHaveBeenCalledTimes(1);
      expect(reposition).toHaveBeenCalledWith(event);
    });

    it('repositions when the content resizes', () => {
      const reposition = vi.fn();
      const content = document.createElement('div');
      const tracker = createPositionTracker(content, reposition);

      tracker.attach();

      const observer = FakeResizeObserver.instances[0];

      expect(observer).toBeDefined();
      expect(observer.observed).toEqual([content]);

      observer.trigger();

      expect(reposition).toHaveBeenCalledTimes(1);
      expect(reposition).toHaveBeenCalledWith();
    });

    it('is idempotent — a second attach wires nothing extra', () => {
      const reposition = vi.fn();
      const tracker = createPositionTracker(document.createElement('div'), reposition);

      tracker.attach();
      tracker.attach();

      expect(FakeResizeObserver.instances).toHaveLength(1);

      window.dispatchEvent(new Event('resize'));

      expect(reposition).toHaveBeenCalledTimes(1);
    });

    it('tears all three channels down on detach', () => {
      const reposition = vi.fn();
      const scroller = document.createElement('div');

      document.body.appendChild(scroller);

      const tracker = createPositionTracker(document.createElement('div'), reposition);

      tracker.attach();

      const observer = FakeResizeObserver.instances[0];

      tracker.detach();

      expect(observer.disconnected).toBe(true);

      window.dispatchEvent(new Event('resize'));
      scroller.dispatchEvent(new Event('scroll'));

      expect(reposition).not.toHaveBeenCalled();
    });

    it('can be re-attached after detach', () => {
      const reposition = vi.fn();
      const tracker = createPositionTracker(document.createElement('div'), reposition);

      tracker.attach();
      tracker.detach();
      tracker.attach();

      window.dispatchEvent(new Event('resize'));

      expect(reposition).toHaveBeenCalledTimes(1);
      expect(FakeResizeObserver.instances).toHaveLength(2);
    });

    it('detaching before attaching is a no-op', () => {
      const reposition = vi.fn();
      const tracker = createPositionTracker(document.createElement('div'), reposition);

      expect(() => tracker.detach()).not.toThrow();

      tracker.attach();
      window.dispatchEvent(new Event('resize'));

      expect(reposition).toHaveBeenCalledTimes(1);
    });

    it('a second detach does not disconnect a fresh observer', () => {
      const reposition = vi.fn();
      const tracker = createPositionTracker(document.createElement('div'), reposition);

      tracker.attach();
      tracker.detach();
      tracker.detach();

      expect(FakeResizeObserver.instances).toHaveLength(1);
    });

    it('still wires scroll and resize where ResizeObserver is unavailable', () => {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');

      const reposition = vi.fn();
      const tracker = createPositionTracker(document.createElement('div'), reposition);

      expect(() => tracker.attach()).not.toThrow();

      window.dispatchEvent(new Event('resize'));

      expect(reposition).toHaveBeenCalledTimes(1);
      expect(() => tracker.detach()).not.toThrow();

      window.dispatchEvent(new Event('resize'));

      expect(reposition).toHaveBeenCalledTimes(1);
    });
  });
});
