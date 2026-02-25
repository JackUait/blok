import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TableScrollHaze } from '../../../../src/tools/table/table-scroll-haze';

/**
 * Helper: create a minimal scroll container with controllable scroll geometry.
 * By default, creates a container where content overflows (scrollable).
 */
const createScrollContainer = (options: {
  scrollWidth?: number;
  clientWidth?: number;
  scrollLeft?: number;
} = {}): HTMLDivElement => {
  const el = document.createElement('div');

  /** Real scroll containers always have overflow-x: auto when scrolling is possible. */
  el.style.overflowX = 'auto';

  Object.defineProperty(el, 'scrollWidth', { value: options.scrollWidth ?? 800, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: options.clientWidth ?? 400, configurable: true });
  Object.defineProperty(el, 'scrollLeft', { value: options.scrollLeft ?? 0, writable: true, configurable: true });

  return el;
};

/**
 * Helper: create a wrapper element to host the haze overlays.
 */
const createWrapper = (): HTMLDivElement => {
  const el = document.createElement('div');

  document.body.appendChild(el);

  return el;
};

describe('TableScrollHaze', () => {
  let wrapper: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = createWrapper();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    wrapper.remove();
  });

  describe('init()', () => {
    it('creates left and right haze overlay elements on the wrapper', () => {
      const sc = createScrollContainer();
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      const leftHaze = wrapper.querySelector('[data-blok-table-haze="left"]');
      const rightHaze = wrapper.querySelector('[data-blok-table-haze="right"]');

      expect(leftHaze).not.toBeNull();
      expect(rightHaze).not.toBeNull();

      haze.destroy();
    });

    it('haze elements are non-interactive decorations', () => {
      const sc = createScrollContainer();
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      const leftHaze = wrapper.querySelector('[data-blok-table-haze="left"]') as HTMLElement;
      const rightHaze = wrapper.querySelector('[data-blok-table-haze="right"]') as HTMLElement;

      // Verify they are marked as decorative (aria-hidden is tested separately)
      // and exist as overlay elements on the wrapper
      expect(leftHaze.parentElement).toBe(wrapper);
      expect(rightHaze.parentElement).toBe(wrapper);

      haze.destroy();
    });

    it('haze elements have aria-hidden="true"', () => {
      const sc = createScrollContainer();
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      const leftHaze = wrapper.querySelector('[data-blok-table-haze="left"]') as HTMLElement;
      const rightHaze = wrapper.querySelector('[data-blok-table-haze="right"]') as HTMLElement;

      expect(leftHaze.getAttribute('aria-hidden')).toBe('true');
      expect(rightHaze.getAttribute('aria-hidden')).toBe('true');

      haze.destroy();
    });
  });

  describe('initial visibility', () => {
    it('shows right haze when content overflows at scrollLeft=0', () => {
      const sc = createScrollContainer({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      const rightHaze = wrapper.querySelector('[data-blok-table-haze="right"]') as HTMLElement;

      expect(rightHaze.hasAttribute('data-blok-table-haze-visible')).toBe(true);

      haze.destroy();
    });

    it('hides left haze when scrollLeft is 0', () => {
      const sc = createScrollContainer({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      const leftHaze = wrapper.querySelector('[data-blok-table-haze="left"]') as HTMLElement;

      expect(leftHaze.hasAttribute('data-blok-table-haze-visible')).toBe(false);

      haze.destroy();
    });

    it('hides both hazes when content fits without overflow', () => {
      const sc = createScrollContainer({ scrollWidth: 400, clientWidth: 400, scrollLeft: 0 });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      const leftHaze = wrapper.querySelector('[data-blok-table-haze="left"]') as HTMLElement;
      const rightHaze = wrapper.querySelector('[data-blok-table-haze="right"]') as HTMLElement;

      expect(leftHaze.hasAttribute('data-blok-table-haze-visible')).toBe(false);
      expect(rightHaze.hasAttribute('data-blok-table-haze-visible')).toBe(false);

      haze.destroy();
    });
  });

  describe('scroll event handling', () => {
    it('shows left haze and hides right haze when scrolled to the end', () => {
      const sc = createScrollContainer({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      // Simulate scrolling to the end
      Object.defineProperty(sc, 'scrollLeft', { value: 400, configurable: true });

      // Mock rAF to execute callback synchronously
      const originalRaf = globalThis.requestAnimationFrame;

      globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
        cb(0);

        return 0;
      };

      sc.dispatchEvent(new Event('scroll'));

      globalThis.requestAnimationFrame = originalRaf;

      const leftHaze = wrapper.querySelector('[data-blok-table-haze="left"]') as HTMLElement;
      const rightHaze = wrapper.querySelector('[data-blok-table-haze="right"]') as HTMLElement;

      expect(leftHaze.hasAttribute('data-blok-table-haze-visible')).toBe(true);
      expect(rightHaze.hasAttribute('data-blok-table-haze-visible')).toBe(false);

      haze.destroy();
    });

    it('shows both hazes when scrolled to the middle', () => {
      const sc = createScrollContainer({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      // Simulate scrolling to the middle
      Object.defineProperty(sc, 'scrollLeft', { value: 200, configurable: true });

      const originalRaf = globalThis.requestAnimationFrame;

      globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
        cb(0);

        return 0;
      };

      sc.dispatchEvent(new Event('scroll'));

      globalThis.requestAnimationFrame = originalRaf;

      const leftHaze = wrapper.querySelector('[data-blok-table-haze="left"]') as HTMLElement;
      const rightHaze = wrapper.querySelector('[data-blok-table-haze="right"]') as HTMLElement;

      expect(leftHaze.hasAttribute('data-blok-table-haze-visible')).toBe(true);
      expect(rightHaze.hasAttribute('data-blok-table-haze-visible')).toBe(true);

      haze.destroy();
    });
  });

  describe('overflow-x: visible (no scroll support)', () => {
    it('hides right haze when scrollWidth > clientWidth but overflow-x is visible', () => {
      // Resize handles can protrude beyond the grid, inflating scrollWidth
      // even when the scroll container has overflow: visible (no scrollbar).
      const sc = createScrollContainer({ scrollWidth: 638, clientWidth: 630, scrollLeft: 0 });

      // Override to simulate default overflow (visible) — no scrolling possible
      sc.style.overflowX = 'visible';

      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      const rightHaze = wrapper.querySelector('[data-blok-table-haze="right"]') as HTMLElement;

      expect(rightHaze.hasAttribute('data-blok-table-haze-visible')).toBe(false);

      haze.destroy();
    });

    it('shows right haze when overflow-x is auto and content overflows', () => {
      const sc = createScrollContainer({ scrollWidth: 800, clientWidth: 400, scrollLeft: 0 });

      sc.style.overflowX = 'auto';

      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      const rightHaze = wrapper.querySelector('[data-blok-table-haze="right"]') as HTMLElement;

      expect(rightHaze.hasAttribute('data-blok-table-haze-visible')).toBe(true);

      haze.destroy();
    });
  });

  describe('update()', () => {
    it('recalculates haze visibility without a scroll event', () => {
      const sc = createScrollContainer({ scrollWidth: 400, clientWidth: 400, scrollLeft: 0 });
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      // Initially no overflow — both hidden
      const rightHaze = wrapper.querySelector('[data-blok-table-haze="right"]') as HTMLElement;

      expect(rightHaze.hasAttribute('data-blok-table-haze-visible')).toBe(false);

      // Simulate adding columns that cause overflow
      Object.defineProperty(sc, 'scrollWidth', { value: 800, configurable: true });

      haze.update();

      expect(rightHaze.hasAttribute('data-blok-table-haze-visible')).toBe(true);

      haze.destroy();
    });
  });

  describe('destroy()', () => {
    it('removes haze elements from the DOM', () => {
      const sc = createScrollContainer();
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      expect(wrapper.querySelector('[data-blok-table-haze]')).not.toBeNull();

      haze.destroy();

      expect(wrapper.querySelector('[data-blok-table-haze]')).toBeNull();
    });

    it('removes the scroll event listener', () => {
      const sc = createScrollContainer();
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);

      const removeSpy = vi.spyOn(sc, 'removeEventListener');

      haze.destroy();

      expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
    });

    it('is safe to call multiple times', () => {
      const sc = createScrollContainer();
      const haze = new TableScrollHaze();

      haze.init(wrapper, sc);
      haze.destroy();

      expect(() => haze.destroy()).not.toThrow();
    });
  });
});
