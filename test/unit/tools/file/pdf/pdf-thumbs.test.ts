import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mountPdfView } from '../../../../../src/tools/file/pdf/pdf-view';
import { FakeObserver, PX_PER_PT, harness, pageObserver, releaseAll, settle, textDoc, type Harness, type TextDoc } from './pdf-fakes';

const THUMB_SCALE = 0.2;

const toggle = (h: Harness): HTMLButtonElement => {
  const button = h.container.querySelector<HTMLButtonElement>('[data-action="preview-thumbnails"]');
  if (button === null) {
    throw new Error('no thumbnails button');
  }

  return button;
};
const rail = (h: Harness): HTMLElement | null => h.container.querySelector<HTMLElement>('[data-role="file-preview-pdf-thumbs"]');
const thumbs = (h: Harness): HTMLButtonElement[] => Array.from(h.container.querySelectorAll<HTMLButtonElement>('[data-role="file-preview-pdf-thumb"]'));
const thumbObserver = (): FakeObserver => {
  const found = FakeObserver.all[1];
  if (found === undefined) {
    throw new Error('no thumbnail observer');
  }

  return found;
};
const thumbRenders = (doc: TextDoc): number[] => doc.renders.filter((call) => call.viewport.scale === THUMB_SCALE).map((call) => call.page);

describe('PDF page thumbnails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeObserver.all = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    Object.assign(HTMLElement.prototype, { scrollTo: () => undefined });
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
      return { canvas: this } as unknown as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    releaseAll();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('puts a thumbnails toggle in the pill, named by a hover hint', async () => {
    const h = harness();
    await mountPdfView(h.container, textDoc(3), {}, h.chrome);

    const button = toggle(h);
    expect(button.closest('[data-role="file-preview-pill"]')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Page thumbnails');
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.hasAttribute('title')).toBe(false);
    expect(rail(h)).toBeNull();
  });

  it('opens a rail with one labelled thumbnail per page', async () => {
    const h = harness();
    await mountPdfView(h.container, textDoc(3), {}, h.chrome);

    toggle(h).click();

    expect(toggle(h).getAttribute('aria-pressed')).toBe('true');
    expect(rail(h)?.hidden).toBe(false);
    expect(thumbs(h).map((thumb) => thumb.getAttribute('aria-label'))).toEqual(['Page 1', 'Page 2', 'Page 3']);
    expect(thumbs(h).every((thumb) => thumb.tagName === 'BUTTON')).toBe(true);
  });

  it('draws only the thumbnails near view, small', async () => {
    const h = harness();
    const doc = textDoc(50);
    await mountPdfView(h.container, doc, {}, h.chrome);
    toggle(h).click();
    await settle();
    expect(thumbRenders(doc)).toEqual([]);

    thumbObserver().show(1, 3);
    await settle();
    await settle();

    expect(thumbRenders(doc).sort((a, b) => a - b)).toEqual([1, 2, 3]);
    const canvas = thumbs(h)[0].querySelector('canvas');
    expect(canvas?.width).toBe(Math.floor(612 * THUMB_SCALE));
    expect(thumbs(h)[10].querySelector('canvas')?.width ?? 0).toBe(0);
  });

  it('frees a thumbnail that scrolls far away and redraws it when it comes back', async () => {
    const h = harness();
    const doc = textDoc(50);
    await mountPdfView(h.container, doc, {}, h.chrome);
    toggle(h).click();
    thumbObserver().show(1, 3);
    await settle();
    await settle();

    thumbObserver().show(30, 32);
    await settle();
    await settle();

    expect(thumbs(h)[0].querySelector('canvas')?.width).toBe(0);
    expect(thumbs(h)[29].querySelector('canvas')?.width).toBeGreaterThan(0);
  });

  it('marks the page being read and follows the scroll', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    const h = harness();
    await mountPdfView(h.container, textDoc(5), {}, h.chrome);
    toggle(h).click();
    expect(thumbs(h).map((thumb) => thumb.getAttribute('aria-current'))).toEqual(['true', 'false', 'false', 'false', 'false']);

    Object.defineProperty(h.scroller(), 'scrollTop', { configurable: true, value: 2 * 792 * PX_PER_PT + 10 });
    h.scroller().dispatchEvent(new Event('scroll'));
    frames.splice(0).forEach((callback) => callback(0));

    expect(thumbs(h)[2].getAttribute('aria-current')).toBe('true');
    expect(thumbs(h)[0].getAttribute('aria-current')).toBe('false');
  });

  it('jumps to a page when its thumbnail is clicked', async () => {
    const h = harness();
    await mountPdfView(h.container, textDoc(5), {}, h.chrome);
    const scrollTo = vi.fn();
    Object.assign(h.scroller(), { scrollTo });
    toggle(h).click();

    thumbs(h)[2].click();

    expect(scrollTo).toHaveBeenCalledWith({ top: 2 * 792 * PX_PER_PT - 20, behavior: 'smooth' });
  });

  it('hides the rail and frees its canvases when toggled off', async () => {
    const h = harness();
    const doc = textDoc(5);
    await mountPdfView(h.container, doc, {}, h.chrome);
    toggle(h).click();
    thumbObserver().show(1, 3);
    await settle();
    await settle();

    toggle(h).click();

    expect(toggle(h).getAttribute('aria-pressed')).toBe('false');
    expect(rail(h)?.hidden).toBe(true);
    expect(thumbObserver().disconnect).toHaveBeenCalled();
    expect(thumbs(h).every((thumb) => (thumb.querySelector('canvas')?.width ?? 0) === 0)).toBe(true);
  });

  it('cancels a thumbnail still drawing when the preview closes, without a warning', async () => {
    const warn = vi.spyOn(console, 'warn');
    const h = harness();
    const doc = textDoc(5);
    await mountPdfView(h.container, doc, {}, h.chrome);
    toggle(h).click();
    doc.hold = true;
    thumbObserver().show(1, 3);
    await settle();
    const drawing = doc.renders.filter((call) => call.viewport.scale === THUMB_SCALE);
    expect(drawing).toHaveLength(1);

    h.release();
    await settle();
    await settle();

    expect(drawing[0].cancel).toHaveBeenCalled();
    expect(thumbRenders(doc)).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    expect(rail(h)).toBeNull();
  });

  it('draws one thumbnail at a time', async () => {
    const h = harness();
    const doc = textDoc(5);
    doc.hold = true;
    await mountPdfView(h.container, doc, {}, h.chrome);
    pageObserver();
    toggle(h).click();

    thumbObserver().show(1, 3);
    await settle();
    expect(thumbRenders(doc)).toEqual([1]);

    doc.renders.filter((call) => call.viewport.scale === THUMB_SCALE)[0].finish();
    await settle();
    await settle();
    expect(thumbRenders(doc)).toEqual([1, 2]);
  });
});
