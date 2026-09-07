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

  describe('how it listens', () => {
    it('catches scroll in the capture phase, passively', () => {
      const body = document.createElement('div');

      document.body.appendChild(body);

      const listen = vi.spyOn(body, 'addEventListener');

      new ScrollHaze().init(body);

      expect(listen).toHaveBeenCalledWith('scroll', expect.any(Function), { capture: true, passive: true });
    });

    it('watches for the content and view changes that move the edges', () => {
      const observe = vi.spyOn(MutationObserver.prototype, 'observe');
      const { body } = mount();

      expect(observe).toHaveBeenCalledTimes(1);
      expect(observe.mock.calls[0][0]).toBe(body);
      expect(observe.mock.calls[0][1]).toStrictEqual({
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'style', 'class'],
      });
    });

    it('schedules a frame again after the previous one has run', () => {
      const scroller = view({ scrollTop: 0, scrollHeight: 300, clientHeight: 100 });

      mount([scroller]);

      vi.mocked(globalThis.requestAnimationFrame).mockClear();

      scroller.dispatchEvent(new Event('scroll'));
      scroller.dispatchEvent(new Event('scroll'));

      expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(2);
    });
  });

  describe('clearing', () => {
    it('hides every edge once the views are gone', () => {
      const scroller = view({ scrollTop: 150, scrollHeight: 300, clientHeight: 100 });
      const { haze, body } = mount([scroller]);

      expect(shown(body, 'top')).toBe(true);

      scroller.remove();
      haze.update();

      for (const side of ['top', 'bottom', 'left', 'right']) {
        expect(shown(body, side)).toBe(false);
      }
    });

    it('tracks the surface even when it is transparent', () => {
      const { body } = mount([view({ scrollTop: 10, scrollHeight: 300, clientHeight: 100 })]);

      expect(body.style.getPropertyValue('--blok-haze-color')).toBe('rgba(0, 0, 0, 0)');
    });
  });

  describe('edge cases at the exact threshold', () => {
    it('hides the bottom edge when the view is scrolled one pixel from its end', () => {
      const { body } = mount([view({ scrollTop: 199, scrollHeight: 300, clientHeight: 100 })]);

      expect(shown(body, 'bottom')).toBe(false);
    });

    it('hides the right edge when the view is scrolled one pixel from its end', () => {
      const { body } = mount([view({ scrollLeft: 199, scrollWidth: 300, clientWidth: 100 })]);

      expect(shown(body, 'right')).toBe(false);
    });

    it('never measures a strip, even one that would look like it overflows', () => {
      const flat = view({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 });
      const { body } = mount([flat]);

      withMetrics(strip(body, 'top'), { scrollHeight: 400, clientHeight: 100, scrollTop: 200 });
      new ScrollHaze().update();

      expect(shown(body, 'top')).toBe(false);
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

    it('can be mounted again after being torn down', () => {
      const first = view({ scrollTop: 0, scrollHeight: 300, clientHeight: 100 });
      const { haze, body } = mount([first]);

      haze.destroy();
      haze.init(body);

      Object.defineProperty(first, 'scrollTop', { value: 150, configurable: true });
      first.dispatchEvent(new Event('scroll'));

      expect(shown(body, 'top')).toBe(true);
    });
  });
});
