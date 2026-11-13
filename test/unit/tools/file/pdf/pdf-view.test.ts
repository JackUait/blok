import { describe, it, expect, afterEach, beforeEach, vi, type Mock } from 'vitest';
import { mountPdfView, type PdfViewLib } from '../../../../../src/tools/file/pdf/pdf-view';
import type { PdfDocumentLike, PdfPageLike, PdfViewport } from '../../../../../src/tools/file/pdf/pdf-types';
import { detachedChrome, type PreviewChrome } from '../../../../../src/tools/file/preview-chrome';

const CANVAS_CAP = 16_777_216;
const PX_PER_PT = 96 / 72;

interface RenderCall {
  page: number;
  viewport: PdfViewport;
  transform: number[] | undefined;
  canvas: HTMLCanvasElement;
  cancel: Mock<() => void>;
}

interface FakeDoc extends PdfDocumentLike {
  renders: RenderCall[];
  cleaned: number[];
  /** Renders stay pending until cancelled when true. */
  hold: boolean;
}

/** A doc of `count` pages, 612×792 pt unless `sizes` says otherwise. */
function fakeDoc(count: number, sizes: Record<number, [number, number]> = {}): FakeDoc {
  const doc: FakeDoc = {
    numPages: count,
    renders: [],
    cleaned: [],
    hold: false,
    getPage: (n) => {
      const [w, h] = sizes[n] ?? [612, 792];
      const page: PdfPageLike = {
        getViewport: ({ scale }) => ({ width: w * scale, height: h * scale, scale }),
        render: ({ canvasContext, viewport, transform }) => {
          const call: RenderCall = { page: n, viewport, transform, canvas: canvasContext.canvas, cancel: vi.fn<() => void>() };
          doc.renders.push(call);
          const promise = doc.hold
            ? new Promise<void>((_, reject) => {
              call.cancel.mockImplementation(() => reject(Object.assign(new Error('cancelled'), { name: 'RenderingCancelledException' })));
            })
            : Promise.resolve();

          return { promise, cancel: call.cancel };
        },
        getTextContent: () => Promise.resolve({ items: [] }),
        getAnnotations: () => Promise.resolve([]),
        cleanup: () => doc.cleaned.push(n),
      };

      return Promise.resolve(page);
    },
  };

  return doc;
}

/** A stand-in IntersectionObserver the test drives by page number. */
class FakeObserver {
  static last: FakeObserver | null = null;
  readonly targets: Element[] = [];
  readonly disconnect = vi.fn();

  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.last = this;
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(): void {}

  /** Report pages `from`..`to` (1-based) on screen and every other page off it. */
  show(from: number, to: number): void {
    const entries = this.targets.map((target, i) => ({ target, isIntersecting: i + 1 >= from && i + 1 <= to }));
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

const observer = (): FakeObserver => {
  if (FakeObserver.last === null) {
    throw new Error('no observer');
  }

  return FakeObserver.last;
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const frames: FrameRequestCallback[] = [];

interface Harness {
  container: HTMLElement;
  chrome: PreviewChrome;
  facts: string[][];
  releases: Array<() => void>;
  scroller: () => HTMLElement;
  pages: () => HTMLElement[];
}

function harness(): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const facts: string[][] = [];
  const releases: Array<() => void> = [];
  const chrome: PreviewChrome = {
    ...detachedChrome(container, () => false, (release) => releases.push(release)),
    setFacts: (next) => facts.push(next),
  };
  const scroller = (): HTMLElement => {
    const found = container.querySelector<HTMLElement>('[data-role="file-preview-pdf"]');
    if (found === null) {
      throw new Error('no scroller');
    }

    return found;
  };

  return {
    container, chrome, facts, releases, scroller,
    pages: () => Array.from(container.querySelectorAll<HTMLElement>('[data-role="file-preview-pdf-page"]')),
  };
}

const renderedPages = (doc: FakeDoc): number[] => [...new Set(doc.renders.map((call) => call.page))].sort((a, b) => a - b);

describe('mountPdfView', () => {
  const originalDpr = window.devicePixelRatio;

  beforeEach(() => {
    vi.clearAllMocks();
    FakeObserver.last = null;
    frames.length = 0;
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);

      return frames.length;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
      return { canvas: this } as unknown as CanvasRenderingContext2D;
    });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
  });

  afterEach(() => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: originalDpr });
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('builds one labelled page box per page, sized from page 1', async () => {
    const h = harness();
    await mountPdfView(h.container, fakeDoc(50), {}, h.chrome);

    const pages = h.pages();
    expect(pages).toHaveLength(50);
    expect(pages[0].getAttribute('aria-label')).toBe('Page 1');
    expect(pages[49].getAttribute('aria-label')).toBe('Page 50');
    expect(pages[0].getAttribute('role')).toBe('region');
    expect(pages[49].style.width).toBe(`${612 * PX_PER_PT}px`);
    expect(pages[49].style.height).toBe(`${792 * PX_PER_PT}px`);
    expect(pages[0].querySelector('canvas')).not.toBeNull();
    expect(pages[0].querySelector('.blok-file-preview-pdf-text')).not.toBeNull();
  });

  it('counts the pages once, through the pager', async () => {
    const h = harness();
    await mountPdfView(h.container, fakeDoc(50), {}, h.chrome);

    expect(h.facts).toEqual([['50 pages']]);
    expect(h.container.querySelector('[data-role="file-preview-page"]')?.textContent).toBe('Page 1 / 50');
  });

  it('renders only the pages on screen and two either side', async () => {
    const h = harness();
    const doc = fakeDoc(50);
    await mountPdfView(h.container, doc, {}, h.chrome);

    observer().show(1, 1);
    await settle();

    expect(renderedPages(doc)).toEqual([1, 2, 3]);
  });

  it('frees pages that leave and renders the new window', async () => {
    const h = harness();
    const doc = fakeDoc(50);
    await mountPdfView(h.container, doc, {}, h.chrome);
    observer().show(1, 1);
    await settle();
    doc.renders.length = 0;

    observer().show(30, 30);
    await settle();

    expect(renderedPages(doc)).toEqual([28, 29, 30, 31, 32]);
    expect(doc.cleaned.sort((a, b) => a - b)).toEqual([1, 2, 3]);
    [0, 1, 2].forEach((i) => {
      const canvas = h.pages()[i].querySelector('canvas');
      expect(canvas?.width).toBe(0);
      expect(canvas?.height).toBe(0);
    });
  });

  it('cancels a render whose page left, without logging', async () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const h = harness();
    const doc = fakeDoc(50);
    doc.hold = true;
    await mountPdfView(h.container, doc, {}, h.chrome);
    observer().show(1, 1);
    await settle();
    const first = doc.renders.filter((call) => call.page === 1);
    expect(first).toHaveLength(1);

    observer().show(30, 30);
    await settle();

    expect(first[0].cancel).toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('caps a huge page canvas at 16,777,216 pixels and still draws it', async () => {
    const h = harness();
    const doc = fakeDoc(1, { 1: [14400, 14400] });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    await mountPdfView(h.container, doc, {}, h.chrome);

    observer().show(1, 1);
    await settle();

    expect(doc.renders).toHaveLength(1);
    const { canvas, transform } = doc.renders[0];
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(CANVAS_CAP);
    expect(canvas.width).toBeGreaterThan(0);
    expect(transform?.[0]).toBeCloseTo(canvas.width / (14400 * PX_PER_PT));
  });

  it('caps each side of a long thin page at 32,767 pixels', async () => {
    const h = harness();
    const doc = fakeDoc(1, { 1: [100, 40000] });
    await mountPdfView(h.container, doc, {}, h.chrome);

    observer().show(1, 1);
    await settle();

    expect(doc.renders[0].canvas.height).toBeLessThanOrEqual(32_767);
  });

  it('draws at the device pixel ratio', async () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    const h = harness();
    const doc = fakeDoc(1);
    await mountPdfView(h.container, doc, {}, h.chrome);

    observer().show(1, 1);
    await settle();

    const { canvas, transform } = doc.renders[0];
    expect(canvas.width).toBe(612 * PX_PER_PT * 2);
    expect(canvas.height).toBe(792 * PX_PER_PT * 2);
    expect(transform).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('passes no transform at a ratio of 1', async () => {
    const h = harness();
    const doc = fakeDoc(1);
    await mountPdfView(h.container, doc, {}, h.chrome);

    observer().show(1, 1);
    await settle();

    expect(doc.renders[0].transform).toBeUndefined();
  });

  it('sizes a page from its own viewport once it is known', async () => {
    const h = harness();
    await mountPdfView(h.container, fakeDoc(3, { 2: [792, 612] }), {}, h.chrome);
    expect(h.pages()[1].style.width).toBe(`${612 * PX_PER_PT}px`);

    observer().show(1, 1);
    await settle();

    expect(h.pages()[1].style.width).toBe(`${792 * PX_PER_PT}px`);
    expect(h.pages()[1].style.height).toBe(`${612 * PX_PER_PT}px`);
  });

  it('runs the text layer and link hooks on each rendered page and cancels the text layer when it leaves', async () => {
    const h = harness();
    const cancels: Array<Mock<() => void>> = [];
    const lib: PdfViewLib = {
      renderTextLayer: vi.fn((_page, _viewport, host: HTMLElement) => {
        host.appendChild(document.createElement('span'));
        const cancel = vi.fn<() => void>();
        cancels.push(cancel);

        return Promise.resolve({ cancel });
      }),
      renderLinks: vi.fn(() => Promise.resolve()),
    };
    await mountPdfView(h.container, fakeDoc(50), lib, h.chrome);

    observer().show(1, 1);
    await settle();

    expect(lib.renderTextLayer).toHaveBeenCalledTimes(3);
    expect(lib.renderLinks).toHaveBeenCalledTimes(3);
    expect(h.pages()[0].querySelector('.blok-file-preview-pdf-text')?.childElementCount).toBe(1);

    observer().show(30, 30);
    await settle();

    expect(cancels.slice(0, 3).every((cancel) => cancel.mock.calls.length > 0)).toBe(true);
    expect(h.pages()[0].querySelector('.blok-file-preview-pdf-text')?.childElementCount).toBe(0);
  });

  /** Link hooks that add one anchor each once the test lets them finish. */
  const slowLinks = (): { lib: PdfViewLib; finish: () => void } => {
    const pending: Array<() => void> = [];
    const lib: PdfViewLib = {
      renderLinks: (host) => new Promise<void>((resolve) => {
        pending.push(() => {
          host.appendChild(document.createElement('a'));
          resolve();
        });
      }),
    };

    return { lib, finish: () => pending.splice(0).forEach((done) => done()) };
  };

  it('keeps a late link hook from a previous zoom off the page', async () => {
    const h = harness();
    const { lib, finish } = slowLinks();
    await mountPdfView(h.container, fakeDoc(5), lib, h.chrome);
    observer().show(1, 1);
    await settle();

    h.container.querySelector<HTMLButtonElement>('[data-action="preview-zoom-in"]')?.click();
    await settle();
    finish();
    await settle();

    expect(h.pages()[0].querySelectorAll('.blok-file-preview-pdf-links a')).toHaveLength(1);
  });

  it('keeps a late link hook off a page that left', async () => {
    const h = harness();
    const { lib, finish } = slowLinks();
    await mountPdfView(h.container, fakeDoc(50), lib, h.chrome);
    observer().show(1, 1);
    await settle();

    observer().show(30, 30);
    await settle();
    finish();
    await settle();

    expect(h.pages()[0].querySelectorAll('.blok-file-preview-pdf-links a')).toHaveLength(0);
  });

  it('sets the scale factor the text layer reads', async () => {
    const h = harness();
    await mountPdfView(h.container, fakeDoc(2), {}, h.chrome);

    expect(h.scroller().style.getPropertyValue('--total-scale-factor')).toBe(String(PX_PER_PT));
  });

  it('re-renders the rendered pages at the new zoom', async () => {
    const h = harness();
    const doc = fakeDoc(50);
    await mountPdfView(h.container, doc, {}, h.chrome);
    observer().show(1, 1);
    await settle();
    doc.renders.length = 0;

    h.container.querySelector<HTMLButtonElement>('[data-action="preview-zoom-in"]')?.click();
    await settle();

    expect(renderedPages(doc)).toEqual([1, 2, 3]);
    expect(doc.renders[0].viewport.scale).toBeCloseTo(PX_PER_PT * 1.25);
    expect(parseFloat(h.pages()[10].style.width)).toBeCloseTo(612 * PX_PER_PT * 1.25);
  });

  it('finds the current page from known sizes, without measuring pages', async () => {
    const h = harness();
    await mountPdfView(h.container, fakeDoc(50), {}, h.chrome);
    const scroller = h.scroller();
    // jsdom has no layout: a view that measured pages would stay on page 1.
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 29 * 792 * PX_PER_PT + 10 });

    scroller.dispatchEvent(new Event('scroll'));
    frames.splice(0).forEach((callback) => callback(0));

    expect(h.container.querySelector('[data-role="file-preview-page"]')?.textContent).toBe('Page 30 / 50');
  });

  it('destroy() disconnects the observer and cancels renders', async () => {
    const h = harness();
    const doc = fakeDoc(50);
    doc.hold = true;
    const view = await mountPdfView(h.container, doc, {}, h.chrome);
    observer().show(1, 1);
    await settle();

    view.destroy();
    await settle();

    expect(observer().disconnect).toHaveBeenCalled();
    expect(doc.renders.every((call) => call.cancel.mock.calls.length > 0)).toBe(true);
    expect(() => view.destroy()).not.toThrow();
  });

  it('drops a page that arrives after destroy()', async () => {
    const h = harness();
    const doc = fakeDoc(5);
    const view = await mountPdfView(h.container, doc, {}, h.chrome);
    observer().show(1, 1);

    view.destroy();
    await settle();

    // Page 1 is already read at mount, so only it starts drawing.
    expect(renderedPages(doc)).toEqual([1]);
    expect(doc.cleaned.sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('rejects when the first page cannot be read', async () => {
    const h = harness();
    const doc = fakeDoc(2);
    doc.getPage = () => Promise.reject(new Error('broken'));

    await expect(mountPdfView(h.container, doc, {}, h.chrome)).rejects.toThrow('broken');
  });
});
