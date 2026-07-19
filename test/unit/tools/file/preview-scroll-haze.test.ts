import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScrollHaze } from '../../../../src/tools/file/preview-scroll-haze';

/** A fake scroll container with fixed, jsdom-absent scroll metrics. */
function makeScroller(metrics: Record<string, number>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'view';
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(el, key, { value, configurable: true });
  }

  return el;
}

function visible(body: HTMLElement, side: string): boolean {
  const strip = body.querySelector(`[data-blok-haze="${side}"]`);

  return strip?.hasAttribute('data-blok-haze-visible') ?? false;
}

describe('ScrollHaze', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('shows the bottom edge when scrollable down from the top', () => {
    const body = document.createElement('div');
    body.appendChild(makeScroller({
      scrollTop: 0, scrollLeft: 0,
      scrollHeight: 1000, clientHeight: 500,
      scrollWidth: 500, clientWidth: 500,
    }));
    const haze = new ScrollHaze();
    haze.init(body);

    expect(visible(body, 'top')).toBe(false);
    expect(visible(body, 'bottom')).toBe(true);
    expect(visible(body, 'left')).toBe(false);
    expect(visible(body, 'right')).toBe(false);

    haze.destroy();
  });

  it('shows the top edge once scrolled to the bottom', () => {
    const body = document.createElement('div');
    body.appendChild(makeScroller({
      scrollTop: 500, scrollLeft: 0,
      scrollHeight: 1000, clientHeight: 500,
      scrollWidth: 500, clientWidth: 500,
    }));
    const haze = new ScrollHaze();
    haze.init(body);

    expect(visible(body, 'top')).toBe(true);
    expect(visible(body, 'bottom')).toBe(false);

    haze.destroy();
  });

  it('shows both horizontal edges when scrolled mid-way across a wide view', () => {
    const body = document.createElement('div');
    body.appendChild(makeScroller({
      scrollTop: 0, scrollLeft: 250,
      scrollHeight: 500, clientHeight: 500,
      scrollWidth: 1000, clientWidth: 500,
    }));
    const haze = new ScrollHaze();
    haze.init(body);

    expect(visible(body, 'left')).toBe(true);
    expect(visible(body, 'right')).toBe(true);
    expect(visible(body, 'top')).toBe(false);
    expect(visible(body, 'bottom')).toBe(false);

    haze.destroy();
  });

  it('hides every edge when nothing overflows', () => {
    const body = document.createElement('div');
    body.appendChild(makeScroller({
      scrollTop: 0, scrollLeft: 0,
      scrollHeight: 400, clientHeight: 500,
      scrollWidth: 400, clientWidth: 500,
    }));
    const haze = new ScrollHaze();
    haze.init(body);

    for (const side of ['top', 'bottom', 'left', 'right']) {
      expect(visible(body, side)).toBe(false);
    }

    haze.destroy();
  });

  it('ignores a hidden view (e.g. the Markdown source pane while Preview shows)', () => {
    const body = document.createElement('div');
    const hidden = makeScroller({
      scrollTop: 200, scrollHeight: 1000, clientHeight: 500, scrollWidth: 500, clientWidth: 500, scrollLeft: 0,
    });
    hidden.hidden = true;
    body.appendChild(hidden);
    const haze = new ScrollHaze();
    haze.init(body);

    // No visible scroller → no haze, despite the hidden pane being scrollable.
    expect(visible(body, 'top')).toBe(false);
    expect(visible(body, 'bottom')).toBe(false);

    haze.destroy();
  });

  it('removes its strips on destroy', () => {
    const body = document.createElement('div');
    body.appendChild(makeScroller({ scrollHeight: 1000, clientHeight: 500, scrollWidth: 500, clientWidth: 500, scrollTop: 0, scrollLeft: 0 }));
    const haze = new ScrollHaze();
    haze.init(body);
    expect(body.querySelectorAll('[data-blok-haze]').length).toBe(4);

    haze.destroy();
    expect(body.querySelectorAll('[data-blok-haze]').length).toBe(0);
  });
});
