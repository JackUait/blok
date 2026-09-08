import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableScrollHaze } from '../../../../src/tools/table/table-scroll-haze';

/**
 * Mutant-directed cover for TableScrollHaze.
 *
 * Every mutant recorded live on src/tools/table/table-scroll-haze.ts is killed
 * here; none is left standing, so this file carries no equivalence proofs.
 *
 * The standard used while triaging: a mutant counts as killable when ANY
 * reachable input distinguishes it, including a DOM dependency faulted on
 * purpose. That is what reaches the two null guards inside the class — a
 * document.createElement that throws once leaves the instance holding a scroll
 * container with no overlay elements, which is the only state in which those
 * guards decide anything.
 */

type RafCallback = FrameRequestCallback;

let rafQueue: RafCallback[] = [];
let rafCalls = 0;

const stubRaf = (): void => {
  rafQueue = [];
  rafCalls = 0;

  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: RafCallback): number => {
    rafCalls += 1;
    rafQueue.push(callback);

    return rafCalls;
  });
};

const flushRaf = (): void => {
  const queued = rafQueue;

  rafQueue = [];
  queued.forEach((callback) => callback(0));
};

const createScrollContainer = (options: {
  scrollWidth?: number;
  clientWidth?: number;
  scrollLeft?: number;
  overflowX?: string;
} = {}): HTMLDivElement => {
  const el = document.createElement('div');

  el.style.overflowX = options.overflowX ?? 'auto';

  Object.defineProperty(el, 'scrollWidth', { value: options.scrollWidth ?? 800, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: options.clientWidth ?? 400, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { value: options.scrollLeft ?? 0, configurable: true });

  return el;
};

const hazeElement = (wrapper: HTMLElement, side: 'left' | 'right'): HTMLElement => {
  const el = wrapper.querySelector<HTMLElement>(`[data-blok-table-haze="${side}"]`);

  if (el === null) {
    throw new Error(`no ${side} haze overlay was created`);
  }

  return el;
};

const isVisible = (el: HTMLElement): boolean => el.hasAttribute('data-blok-table-haze-visible');

describe('TableScrollHaze — mutant cover', () => {
  let wrapper: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('scroll throttling', () => {
    it('collapses a burst of scroll events into a single frame request', () => {
      const sc = createScrollContainer();
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);
      stubRaf();

      sc.dispatchEvent(new Event('scroll'));
      sc.dispatchEvent(new Event('scroll'));

      expect(rafCalls).toBe(1);

      haze.destroy();
    });

    it('requests a new frame for the scroll that follows a flushed one', () => {
      const sc = createScrollContainer();
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);
      stubRaf();

      sc.dispatchEvent(new Event('scroll'));
      flushRaf();
      sc.dispatchEvent(new Event('scroll'));

      expect(rafCalls).toBe(2);

      haze.destroy();
    });

    it('destroy clears the throttle so a re-inited instance still reacts', () => {
      const sc = createScrollContainer();
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);
      haze.destroy();
      haze.init(wrapper, sc);
      stubRaf();

      sc.dispatchEvent(new Event('scroll'));

      expect(rafCalls).toBe(1);

      haze.destroy();
    });
  });

  describe('listener registration', () => {
    it('subscribes passively, so the handler cannot block scrolling', () => {
      const sc = createScrollContainer();
      const addSpy = vi.spyOn(sc, 'addEventListener');
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      expect(addSpy).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });

      haze.destroy();
    });
  });

  describe('half-built instance', () => {
    it('survives an init that failed before the overlays existed', () => {
      const sc = createScrollContainer();
      const haze = new TableScrollHaze();
      const removeSpy = vi.spyOn(sc, 'removeEventListener');

      // The first createElement call after this line is the left overlay's.
      vi.spyOn(document, 'createElement').mockImplementationOnce((): never => {
        throw new Error('createElement refused');
      });

      let initError: unknown = null;

      try {
        haze.init(wrapper, sc);
      } catch (error) {
        initError = error;
      }

      expect(initError).toBeInstanceOf(Error);
      // The container is stored, the overlays are not: the only state where the
      // class has to decide what a null overlay means.
      expect(() => haze.update()).not.toThrow();

      haze.destroy();

      // No listener was ever attached, so destroy must not try to detach one.
      expect(removeSpy).not.toHaveBeenCalled();
    });

    it('update before init is a no-op rather than a crash', () => {
      const haze = new TableScrollHaze();

      expect(() => haze.update()).not.toThrow();
    });
  });

  describe('overlay construction', () => {
    it('gives each side its own edge and gradient direction', () => {
      const sc = createScrollContainer();
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      const left = hazeElement(wrapper, 'left');
      const right = hazeElement(wrapper, 'right');

      expect(left.classList.contains('left-0')).toBe(true);
      expect(left.classList.contains('bg-linear-to-r')).toBe(true);
      expect(left.classList.contains('right-5')).toBe(false);
      expect(right.classList.contains('right-5')).toBe(true);
      expect(right.classList.contains('bg-linear-to-l')).toBe(true);
      expect(right.classList.contains('left-0')).toBe(false);

      haze.destroy();
    });
  });

  describe('visibility rules', () => {
    it('treats overflow-x scroll as scrollable, not just auto', () => {
      const sc = createScrollContainer({ overflowX: 'scroll', scrollWidth: 800, clientWidth: 400 });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      expect(isVisible(hazeElement(wrapper, 'right'))).toBe(true);

      haze.destroy();
    });

    it('hides the left overlay when the container cannot scroll at all', () => {
      const sc = createScrollContainer({
        overflowX: 'visible',
        scrollWidth: 800,
        clientWidth: 400,
        scrollLeft: 200,
      });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      expect(isVisible(hazeElement(wrapper, 'left'))).toBe(false);

      haze.destroy();
    });

    it('keeps the left overlay hidden at exactly the threshold', () => {
      const sc = createScrollContainer({ scrollWidth: 800, clientWidth: 400, scrollLeft: 1 });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      expect(isVisible(hazeElement(wrapper, 'left'))).toBe(false);

      haze.destroy();
    });

    it('keeps the right overlay hidden when the scrollable span is only the threshold', () => {
      // A negative scrollLeft is what an RTL container reports at its origin. It
      // is the only way the second half of the right-overlay test can be true
      // while the span itself is too small to be worth hazing.
      const sc = createScrollContainer({ scrollWidth: 401, clientWidth: 400, scrollLeft: -1 });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      expect(isVisible(hazeElement(wrapper, 'right'))).toBe(false);

      haze.destroy();
    });

    it('hides the right overlay one threshold short of the end', () => {
      const sc = createScrollContainer({ scrollWidth: 800, clientWidth: 400, scrollLeft: 399 });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      expect(isVisible(hazeElement(wrapper, 'right'))).toBe(false);

      haze.destroy();
    });

    it('marks a visible overlay with an empty attribute value', () => {
      const sc = createScrollContainer({ scrollWidth: 800, clientWidth: 400, scrollLeft: 200 });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      expect(hazeElement(wrapper, 'left').getAttribute('data-blok-table-haze-visible')).toBe('');

      haze.destroy();
    });
  });
});
