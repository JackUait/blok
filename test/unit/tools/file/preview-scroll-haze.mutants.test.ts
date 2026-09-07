import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ScrollHaze } from '../../../../src/tools/file/preview-scroll-haze';

interface Metrics {
  scrollTop?: number;
  scrollLeft?: number;
  scrollWidth?: number;
  scrollHeight?: number;
  clientWidth?: number;
  clientHeight?: number;
}

/** jsdom reports every scroll metric as 0, so each one has to be defined. */
const withMetrics = (el: HTMLElement, metrics: Metrics): HTMLElement => {
  for (const [name, value] of Object.entries(metrics)) {
    Object.defineProperty(el, name, { value, configurable: true });
  }

  return el;
};

const view = (metrics: Metrics = {}): HTMLElement => withMetrics(document.createElement('div'), metrics);

const mount = (children: HTMLElement[] = []): { haze: ScrollHaze; body: HTMLElement } => {
  const body = document.createElement('div');

  for (const child of children) {
    body.appendChild(child);
  }

  document.body.appendChild(body);

  const haze = new ScrollHaze();

  haze.init(body);

  return { haze, body };
};

const strip = (body: HTMLElement, side: string): HTMLElement => {
  const el = body.querySelector<HTMLElement>(`[data-blok-haze="${side}"]`);

  if (el === null) {
    throw new Error(`no ${side} strip`);
  }

  return el;
};

const shown = (body: HTMLElement, side: string): boolean => strip(body, side).hasAttribute('data-blok-haze-visible');

describe('preview scroll haze mutants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);

      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('mounting', () => {
    it('adds one inert strip per side', () => {
      const { body } = mount();

      expect(body.querySelectorAll('[data-blok-haze]')).toHaveLength(4);

      for (const side of ['top', 'bottom', 'left', 'right']) {
        expect(strip(body, side).getAttribute('aria-hidden')).toBe('true');
        expect(strip(body, side).className).toBe('blok-file-preview-haze');
      }
    });

    it('shows nothing when there is no view to scroll', () => {
      const { body } = mount();

      for (const side of ['top', 'bottom', 'left', 'right']) {
        expect(shown(body, side)).toBe(false);
      }
    });
  });

  describe('which edges it shows', () => {
    it('shows the bottom edge on a view scrolled to its top', () => {
      const { body } = mount([view({ scrollTop: 0, scrollHeight: 300, clientHeight: 100 })]);

      expect(shown(body, 'top')).toBe(false);
      expect(shown(body, 'bottom')).toBe(true);
    });

    it('shows the top edge on a view scrolled to its bottom', () => {
      const { body } = mount([view({ scrollTop: 200, scrollHeight: 300, clientHeight: 100 })]);

      expect(shown(body, 'top')).toBe(true);
      expect(shown(body, 'bottom')).toBe(false);
    });

    it('shows both vertical edges in the middle of a view', () => {
      const { body } = mount([view({ scrollTop: 100, scrollHeight: 300, clientHeight: 100 })]);

      expect(shown(body, 'top')).toBe(true);
      expect(shown(body, 'bottom')).toBe(true);
    });

    it('shows neither vertical edge on a view that does not overflow', () => {
      const { body } = mount([view({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })]);

      expect(shown(body, 'top')).toBe(false);
      expect(shown(body, 'bottom')).toBe(false);
    });

    it('shows the right edge on a view scrolled to its left', () => {
      const { body } = mount([view({ scrollLeft: 0, scrollWidth: 300, clientWidth: 100 })]);

      expect(shown(body, 'left')).toBe(false);
      expect(shown(body, 'right')).toBe(true);
    });

    it('shows the left edge on a view scrolled to its right', () => {
      const { body } = mount([view({ scrollLeft: 200, scrollWidth: 300, clientWidth: 100 })]);

      expect(shown(body, 'left')).toBe(true);
      expect(shown(body, 'right')).toBe(false);
    });

    it('ignores a sub-pixel scroll rather than flickering', () => {
      const { body } = mount([view({ scrollTop: 1, scrollLeft: 1, scrollHeight: 300, clientHeight: 100, scrollWidth: 300, clientWidth: 100 })]);

      expect(shown(body, 'top')).toBe(false);
      expect(shown(body, 'left')).toBe(false);
    });

    it('treats a scroll past the threshold as scrolled', () => {
      const { body } = mount([view({ scrollTop: 2, scrollLeft: 2, scrollHeight: 300, clientHeight: 100, scrollWidth: 300, clientWidth: 100 })]);

      expect(shown(body, 'top')).toBe(true);
      expect(shown(body, 'left')).toBe(true);
    });
  });

  describe('which view it measures', () => {
    it('never measures its own strips', () => {
      const { body } = mount();

      expect(shown(body, 'bottom')).toBe(false);
      expect(body.querySelectorAll('[data-blok-haze]')).toHaveLength(4);
    });

    it('skips a hidden view in favour of the visible one', () => {
      const hidden = view({ scrollTop: 50, scrollHeight: 300, clientHeight: 100 });

      hidden.hidden = true;

      const { body } = mount([hidden, view({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })]);

      expect(shown(body, 'top')).toBe(false);
      expect(shown(body, 'bottom')).toBe(false);
    });

    it('skips a display:none view in favour of the visible one', () => {
      const none = view({ scrollTop: 50, scrollHeight: 300, clientHeight: 100 });

      none.style.display = 'none';

      const { body } = mount([none, view({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })]);

      expect(shown(body, 'top')).toBe(false);
    });

    it('prefers the view that actually overflows over the first one', () => {
      const flat = view({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 });
      const tall = view({ scrollTop: 150, scrollHeight: 400, clientHeight: 100 });

      const { body } = mount([flat, tall]);

      expect(shown(body, 'top')).toBe(true);
      expect(shown(body, 'bottom')).toBe(true);
    });

    it('falls back to the first visible view when nothing overflows', () => {
      const { body } = mount([
        view({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 }),
        view({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 }),
      ]);

      expect(shown(body, 'bottom')).toBe(false);
    });
  });

  describe('the haze colour', () => {
    it('takes the colour of the surface that is scrolling', () => {
      const scroller = view({ scrollTop: 10, scrollHeight: 300, clientHeight: 100 });

      scroller.style.backgroundColor = 'rgb(12, 34, 56)';

      const { body } = mount([scroller]);

      expect(body.style.getPropertyValue('--blok-haze-color')).toBe('rgb(12, 34, 56)');
    });
  });

  describe('staying in sync', () => {
    it('refreshes when a descendant scrolls, which does not bubble', () => {
      const scroller = view({ scrollTop: 0, scrollHeight: 300, clientHeight: 100 });
      const { body } = mount([scroller]);

      expect(shown(body, 'top')).toBe(false);

      Object.defineProperty(scroller, 'scrollTop', { value: 150, configurable: true });
      scroller.dispatchEvent(new Event('scroll'));

      expect(shown(body, 'top')).toBe(true);
    });

    it('refreshes on a window resize', () => {
      const scroller = view({ scrollTop: 0, scrollHeight: 300, clientHeight: 100 });
      const { body } = mount([scroller]);

      Object.defineProperty(scroller, 'scrollTop', { value: 150, configurable: true });
      window.dispatchEvent(new Event('resize'));

      expect(shown(body, 'top')).toBe(true);
    });

    it('coalesces a burst of scrolls into one frame', () => {
      const scroller = view({ scrollTop: 0, scrollHeight: 300, clientHeight: 100 });

      mount([scroller]);

      vi.mocked(globalThis.requestAnimationFrame).mockClear();
      vi.mocked(globalThis.requestAnimationFrame).mockImplementation(() => 1);

      scroller.dispatchEvent(new Event('scroll'));
      scroller.dispatchEvent(new Event('scroll'));
      scroller.dispatchEvent(new Event('scroll'));

      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
    });
  });

  describe('destroy', () => {
    it('removes the strips and stops refreshing', () => {
      const scroller = view({ scrollTop: 0, scrollHeight: 300, clientHeight: 100 });
      const { haze, body } = mount([scroller]);

      haze.destroy();

      expect(body.querySelectorAll('[data-blok-haze]')).toHaveLength(0);

      Object.defineProperty(scroller, 'scrollTop', { value: 150, configurable: true });

      expect(() => scroller.dispatchEvent(new Event('scroll'))).not.toThrow();
      expect(() => window.dispatchEvent(new Event('resize'))).not.toThrow();
    });

    it('is safe to call before anything was mounted', () => {
      expect(() => new ScrollHaze().destroy()).not.toThrow();
    });
  });
});
