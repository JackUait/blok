import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from 'vitest';
import { docxPagedView, mountPager, type PagedView } from '../../../../src/tools/file/page-pager';
import { detachedChrome, type PreviewChrome } from '../../../../src/tools/file/preview-chrome';

interface Harness {
  chrome: PreviewChrome;
  scroller: HTMLElement;
  pages: HTMLElement[];
  pill: () => HTMLElement;
  press: (action: string) => void;
  text: (role: string) => string;
  mount: () => void;
}

/** Animation frames queued by the pager; `flush` runs them. */
const frames: FrameRequestCallback[] = [];
const flush = (): void => {
  frames.splice(0).forEach((callback) => callback(0));
};

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
    flush();
  }) as typeof scroller.scrollTo;

  const chrome = detachedChrome(body);
  const pill = (): HTMLElement => {
    const found = body.querySelector<HTMLElement>('[data-role="file-preview-pill"]');
    if (found === null) {
      throw new Error('no pill');
    }

    return found;
  };

  const mount = (): void => {
    const view = docxPagedView(scroller);
    if (view !== null) {
      mountPager(scroller, view, chrome);
    }
  };

  return {
    chrome, scroller, pages, pill, mount,
    press: (action) => pill().querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click(),
    text: (role) => pill().querySelector(`[data-role="${role}"]`)?.textContent ?? '',
  };
}

describe('mountPager with docx pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frames.length = 0;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);

      return frames.length;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it('starts on page 1 and follows the scroll', () => {
    const h = harness(3);
    h.mount();
    expect(h.text('file-preview-page')).toBe('Page 1 / 3');

    h.scroller.scrollTop = 1100;
    h.scroller.dispatchEvent(new Event('scroll'));
    flush();

    expect(h.text('file-preview-page')).toBe('Page 2 / 3');
  });

  it('counts a page as current once its top passes the upper third of the view', () => {
    const h = harness(3);
    h.mount();

    // Page 2 starts at 1024. The upper third of a 600px view is 200px down.
    h.scroller.scrollTop = 1024 - 201;
    h.scroller.dispatchEvent(new Event('scroll'));
    flush();
    expect(h.text('file-preview-page')).toBe('Page 1 / 3');

    h.scroller.scrollTop = 1024 - 200;
    h.scroller.dispatchEvent(new Event('scroll'));
    flush();
    expect(h.text('file-preview-page')).toBe('Page 2 / 3');
  });

  it('jumps to the next and previous page, a little above its top edge', () => {
    const h = harness(3);
    h.mount();

    h.press('preview-next-page');
    expect(h.scroller.scrollTop).toBe(1024 - 20);
    expect(h.text('file-preview-page')).toBe('Page 2 / 3');

    h.press('preview-prev-page');
    expect(h.scroller.scrollTop).toBe(0);
    expect(h.text('file-preview-page')).toBe('Page 1 / 3');
  });

  it('stays put when asked to go before the first or past the last page', () => {
    const h = harness(2);
    h.mount();

    h.press('preview-prev-page');
    expect(h.scroller.scrollTop).toBe(0);

    h.press('preview-next-page');
    h.press('preview-next-page');
    expect(h.text('file-preview-page')).toBe('Page 2 / 2');
  });

  it('fits a page wider than the view, and shows that as 100%', () => {
    // 612pt = 816px. A 500px view leaves 500 - 48 = 452px for the page.
    const h = harness(1, { width: 500, height: 600 });
    h.mount();

    const wrapper = h.scroller.querySelector<HTMLElement>('.blok-docx-wrapper');
    expect(Number(wrapper?.style.getPropertyValue('--blok-docx-zoom'))).toBeCloseTo(452 / 816, 5);
    expect(h.text('file-preview-zoom')).toBe('100%');
  });

  it('never enlarges a page that already fits', () => {
    const h = harness(1);
    h.mount();

    expect(h.scroller.querySelector<HTMLElement>('.blok-docx-wrapper')?.style.getPropertyValue('--blok-docx-zoom')).toBe('1');
  });

  it('zooms in quarter steps between 50% and 200%', () => {
    const h = harness(1);
    h.mount();
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
    h.mount();

    const names = Array.from(h.pill().querySelectorAll('button')).map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual(['Previous page', 'Next page', 'Zoom out', 'Zoom in']);
  });

  it('mounts nothing when the document drew no page', () => {
    const h = harness(0);
    h.mount();

    expect(h.chrome.body.querySelector('[data-role="file-preview-pill"]')).toBeNull();
  });
});

/** A fake paged view of `count` pages whose reading position the test sets. */
interface FakeView extends PagedView {
  at: number;
  scales: number[];
  jumps: number[];
  currentPage: Mock<() => number>;
}

function fakeView(count: number, natural = 816): FakeView {
  const view: FakeView = {
    count,
    at: 0,
    scales: [],
    jumps: [],
    currentPage: vi.fn(() => view.at),
    scrollToPage: (index: number) => {
      view.jumps.push(index);
    },
    naturalWidth: () => natural,
    setScale: (scale: number) => {
      view.scales.push(scale);
    },
  };

  return view;
}

describe('mountPager with any paged view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    frames.length = 0;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);

      return frames.length;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  const setup = (count: number, width = 500): { scroller: HTMLElement; chrome: PreviewChrome; body: HTMLElement } => {
    const body = document.createElement('div');
    const scroller = document.createElement('div');
    body.appendChild(scroller);
    document.body.appendChild(body);
    Object.defineProperty(scroller, 'clientWidth', { configurable: true, get: () => width });

    return { scroller, body, chrome: detachedChrome(body) };
  };
  const text = (body: HTMLElement, role: string): string => body.querySelector(`[data-role="${role}"]`)?.textContent ?? '';
  const press = (body: HTMLElement, action: string): void => {
    body.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click();
  };

  it('scales the view to fit times the zoom', () => {
    const { scroller, body, chrome } = setup(5);
    const view = fakeView(5);
    mountPager(scroller, view, chrome);
    const fit = (500 - 48) / 816;

    expect(view.scales.at(-1)).toBeCloseTo(fit, 5);

    press(body, 'preview-zoom-in');
    expect(view.scales.at(-1)).toBeCloseTo(fit * 1.25, 5);
  });

  it('shows the page the view reports', () => {
    const { scroller, body, chrome } = setup(5);
    const view = fakeView(5);
    view.at = 1;
    mountPager(scroller, view, chrome);

    expect(text(body, 'file-preview-page')).toBe('Page 2 / 5');
  });

  it('asks the view to go one page back or forward', () => {
    const { scroller, body, chrome } = setup(5);
    const view = fakeView(5);
    view.at = 2;
    mountPager(scroller, view, chrome);

    press(body, 'preview-prev-page');
    press(body, 'preview-next-page');

    expect(view.jumps).toEqual([1, 3]);
  });

  it('does not ask to go past either end', () => {
    const { scroller, body, chrome } = setup(2);
    const view = fakeView(2);
    mountPager(scroller, view, chrome);

    press(body, 'preview-prev-page');
    view.at = 1;
    scroller.dispatchEvent(new Event('scroll'));
    flush();
    press(body, 'preview-next-page');

    expect(view.jumps).toEqual([]);
  });

  it('reads the page at most once per frame while scrolling', () => {
    const { scroller, body, chrome } = setup(5);
    const view = fakeView(5);
    mountPager(scroller, view, chrome);
    view.currentPage.mockClear();

    Array.from({ length: 10 }, () => scroller.dispatchEvent(new Event('scroll')));
    expect(view.currentPage).not.toHaveBeenCalled();

    view.at = 3;
    flush();
    expect(view.currentPage).toHaveBeenCalledTimes(1);
    expect(text(body, 'file-preview-page')).toBe('Page 4 / 5');

    scroller.dispatchEvent(new Event('scroll'));
    flush();
    expect(view.currentPage).toHaveBeenCalledTimes(2);
  });

  it('stops reading the page once the preview is released', () => {
    const releases: Array<() => void> = [];
    const { scroller, chrome } = setup(5);
    const view = fakeView(5);
    mountPager(scroller, view, { ...chrome, onRelease: (release) => releases.push(release) });
    view.currentPage.mockClear();

    scroller.dispatchEvent(new Event('scroll'));
    releases.forEach((release) => release());
    flush();
    scroller.dispatchEvent(new Event('scroll'));
    flush();

    expect(view.currentPage).not.toHaveBeenCalled();
  });
});
