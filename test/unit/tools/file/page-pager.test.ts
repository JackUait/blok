import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mountPager } from '../../../../src/tools/file/page-pager';
import { detachedChrome, type PreviewChrome } from '../../../../src/tools/file/preview-chrome';

interface Harness {
  chrome: PreviewChrome;
  scroller: HTMLElement;
  pages: HTMLElement[];
  facts: string[][];
  pill: () => HTMLElement;
  press: (action: string) => void;
  text: (role: string) => string;
}

/** A scroller of `count` pages, each 612pt wide and 1000px tall with a 24px gap. */
function harness(count: number, viewport = { width: 1000, height: 600 }): Harness {
  const body = document.createElement('div');
  const scroller = document.createElement('div');
  const wrapper = document.createElement('div');
  wrapper.className = 'blok-docx-wrapper';
  scroller.appendChild(wrapper);
  body.appendChild(scroller);
  document.body.appendChild(body);
  const pages = Array.from({ length: count }, (_, i) => {
    const page = document.createElement('section');
    page.className = 'blok-docx';
    page.style.width = '612pt';
    page.getBoundingClientRect = () => new DOMRect(0, i * 1024 - scroller.scrollTop, 816, 1000);
    wrapper.appendChild(page);

    return page;
  });
  Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => viewport.width });
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, get: () => viewport.height });
  scroller.getBoundingClientRect = () => new DOMRect(0, 0, viewport.width, viewport.height);
  scroller.scrollTo = ((options: ScrollToOptions) => {
    scroller.scrollTop = options.top ?? 0;
    scroller.dispatchEvent(new Event('scroll'));
  }) as typeof scroller.scrollTo;

  const facts: string[][] = [];
  const chrome: PreviewChrome = { ...detachedChrome(body), setFacts: (next) => facts.push(next) };
  const pill = (): HTMLElement => {
    const found = body.querySelector<HTMLElement>('[data-role="file-preview-pill"]');
    if (found === null) {
      throw new Error('no pill');
    }

    return found;
  };

  return {
    chrome, scroller, pages, facts, pill,
    press: (action) => pill().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click(),
    text: (role) => pill().querySelector(`[data-role="${role}"]`)?.textContent ?? '',
  };
}

describe('mountPager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('reports the page count as a header fact', () => {
    const h = harness(3);
    mountPager(h.scroller, h.chrome);

    expect(h.facts).toEqual([['3 pages']]);
  });

  it('says "1 page" for a single page', () => {
    const h = harness(1);
    mountPager(h.scroller, h.chrome);

    expect(h.facts).toEqual([['1 page']]);
  });

  it('starts on page 1 and follows the scroll', () => {
    const h = harness(3);
    mountPager(h.scroller, h.chrome);
    expect(h.text('file-preview-page')).toBe('Page 1 / 3');

    h.scroller.scrollTop = 1100;
    h.scroller.dispatchEvent(new Event('scroll'));

    expect(h.text('file-preview-page')).toBe('Page 2 / 3');
  });

  it('counts a page as current once its top passes the upper third of the view', () => {
    const h = harness(3);
    mountPager(h.scroller, h.chrome);

    // Page 2 starts at 1024. The upper third of a 600px view is 200px down.
    h.scroller.scrollTop = 1024 - 201;
    h.scroller.dispatchEvent(new Event('scroll'));
    expect(h.text('file-preview-page')).toBe('Page 1 / 3');

    h.scroller.scrollTop = 1024 - 200;
    h.scroller.dispatchEvent(new Event('scroll'));
    expect(h.text('file-preview-page')).toBe('Page 2 / 3');
  });

  it('jumps to the next and previous page, a little above its top edge', () => {
    const h = harness(3);
    mountPager(h.scroller, h.chrome);

    h.press('preview-next-page');
    expect(h.scroller.scrollTop).toBe(1024 - 20);
    expect(h.text('file-preview-page')).toBe('Page 2 / 3');

    h.press('preview-prev-page');
    expect(h.scroller.scrollTop).toBe(0);
    expect(h.text('file-preview-page')).toBe('Page 1 / 3');
  });

  it('stays put when asked to go before the first or past the last page', () => {
    const h = harness(2);
    mountPager(h.scroller, h.chrome);

    h.press('preview-prev-page');
    expect(h.scroller.scrollTop).toBe(0);

    h.press('preview-next-page');
    h.press('preview-next-page');
    expect(h.text('file-preview-page')).toBe('Page 2 / 2');
  });

  it('fits a page wider than the view, and shows that as 100%', () => {
    // 612pt = 816px. A 500px view leaves 500 - 48 = 452px for the page.
    const h = harness(1, { width: 500, height: 600 });
    mountPager(h.scroller, h.chrome);

    const wrapper = h.scroller.querySelector<HTMLElement>('.blok-docx-wrapper');
    expect(Number(wrapper?.style.getPropertyValue('--blok-docx-zoom'))).toBeCloseTo(452 / 816, 5);
    expect(h.text('file-preview-zoom')).toBe('100%');
  });

  it('never enlarges a page that already fits', () => {
    const h = harness(1);
    mountPager(h.scroller, h.chrome);

    expect(h.scroller.querySelector<HTMLElement>('.blok-docx-wrapper')?.style.getPropertyValue('--blok-docx-zoom')).toBe('1');
  });

  it('zooms in quarter steps between 50% and 200%', () => {
    const h = harness(1);
    mountPager(h.scroller, h.chrome);
    const zoom = (): string => h.scroller.querySelector<HTMLElement>('.blok-docx-wrapper')?.style.getPropertyValue('--blok-docx-zoom') ?? '';

    h.press('preview-zoom-in');
    expect(h.text('file-preview-zoom')).toBe('125%');
    expect(zoom()).toBe('1.25');

    Array.from({ length: 6 }, () => h.press('preview-zoom-in'));
    expect(h.text('file-preview-zoom')).toBe('200%');

    Array.from({ length: 10 }, () => h.press('preview-zoom-out'));
    expect(h.text('file-preview-zoom')).toBe('50%');
    expect(zoom()).toBe('0.5');
  });

  it('names its buttons for screen readers', () => {
    const h = harness(2);
    mountPager(h.scroller, h.chrome);

    const names = Array.from(h.pill().querySelectorAll('button')).map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Previous page', 'Next page', 'Zoom out', 'Zoom in']);
  });

  it('mounts nothing when the document drew no page', () => {
    const h = harness(0);
    mountPager(h.scroller, h.chrome);

    expect(h.chrome.body.querySelector('[data-role="file-preview-pill"]')).toBeNull();
    expect(h.facts).toEqual([]);
  });
});
