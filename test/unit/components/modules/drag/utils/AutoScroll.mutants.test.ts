import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { AutoScroll } from '../../../../../../src/components/modules/drag/utils/AutoScroll';
import { DRAG_CONFIG } from '../../../../../../src/components/modules/drag/utils/drag.constants';

const ZONE = DRAG_CONFIG.autoScrollZone;
const SPEED = DRAG_CONFIG.autoScrollSpeed;

let frames: FrameRequestCallback[];
let request: Mock<(callback: FrameRequestCallback) => number>;
let cancel: Mock<(handle: number) => void>;
let scrollBy: Mock<(x: number, y: number) => void>;

/** jsdom clamps scrollTop to 0 with no layout, so the element needs its own. */
const container = (): HTMLElement => {
  const element = document.createElement('div');
  let position = 0;

  Object.defineProperty(element, 'scrollTop', {
    get: () => position,
    set: (next: number) => {
      position = next;
    },
    configurable: true,
  });
  document.body.appendChild(element);

  return element;
};

/** Run the frame the loop last asked for, the way the browser would. */
const runLastFrame = (): void => {
  const frame = frames.at(-1);

  if (frame === undefined) {
    throw new Error('no frame was requested');
  }

  frame(0);
};

/**
 * One survivor is equivalent: blanking the 'down' direction label. Every read
 * of the field compares it against 'up' or against null, and the empty string
 * is neither — so it steers exactly where 'down' did, including through the
 * direction-changed check, which compares it against the same blanked literal.
 */
describe('drag auto-scroll mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frames = [];
    request = vi.fn<(callback: FrameRequestCallback) => number>((callback) => {
      frames.push(callback);

      return frames.length;
    });
    cancel = vi.fn<(handle: number) => void>();
    scrollBy = vi.fn<(x: number, y: number) => void>();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    vi.spyOn(window, 'scrollBy').mockImplementation(scrollBy);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('deciding whether to scroll at all', () => {
    it('leaves the zone boundaries outside the zone', () => {
      const scroller = new AutoScroll(container());

      scroller.start(ZONE);
      scroller.start(window.innerHeight - ZONE);

      expect(request).not.toHaveBeenCalled();
    });

    it('starts one loop inside either zone', () => {
      const up = new AutoScroll(container());
      const down = new AutoScroll(container());

      up.start(ZONE - 1);
      down.start(window.innerHeight - ZONE + 1);

      expect(request).toHaveBeenCalledTimes(2);
    });

    it('cancels a running loop when the cursor leaves the zone', () => {
      const scroller = new AutoScroll(container());

      scroller.start(1);
      scroller.start(window.innerHeight / 2);

      expect(cancel).toHaveBeenCalledTimes(1);
    });

    // A second call in the same zone must not restart anything: restarting
    // would cancel the live frame and queue a second loop.
    it('keeps one loop across repeated calls in the same zone', () => {
      const scroller = new AutoScroll(container());

      scroller.start(1);
      scroller.start(2);

      expect(request).toHaveBeenCalledTimes(1);
      expect(cancel).not.toHaveBeenCalled();
    });
  });

  describe('the scroll step', () => {
    it('moves the container up and keeps the loop going', () => {
      const host = container();
      const scroller = new AutoScroll(host);

      scroller.start(1);
      runLastFrame();

      expect(host.scrollTop).toBe(-SPEED);
      expect(scrollBy).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(2);
    });

    it('scrolls the window when there is no container', () => {
      const scroller = new AutoScroll(null);

      scroller.start(1);
      runLastFrame();

      expect(scrollBy.mock.calls).toStrictEqual([[0, -SPEED]]);
    });

    it('scrolls the window downward in the bottom zone', () => {
      const scroller = new AutoScroll(null);

      scroller.start(window.innerHeight - 1);
      runLastFrame();

      expect(scrollBy.mock.calls).toStrictEqual([[0, SPEED]]);
    });

    // A frame can still be in flight when the drag ends, so the step has to
    // recheck the direction rather than trust that it was cancelled.
    it('does nothing when the frame runs after the loop was stopped', () => {
      const scroller = new AutoScroll(null);

      scroller.start(1);
      scroller.stop();
      runLastFrame();

      expect(scrollBy).not.toHaveBeenCalled();
      expect(request).toHaveBeenCalledTimes(1);
    });
  });
});
