import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mountPdfView } from '../../../../../src/tools/file/pdf/pdf-view';
import {
  FakeHighlight, FakeObserver, PX_PER_PT, harness, highlights, manualIdle, pageObserver, painted, press, releaseAll, settle, textDoc, textLayerLib,
  type Harness,
} from './pdf-fakes';

const field = (h: Harness): HTMLInputElement | null => h.container.querySelector<HTMLInputElement>('[data-role="file-preview-find"]');
const counter = (h: Harness): string => h.container.querySelector('[data-role="file-preview-find-count"]')?.textContent ?? '';

const openFind = (h: Harness): HTMLInputElement => {
  press(h.scroller(), { key: 'f', code: 'KeyF', metaKey: true });
  const input = field(h);
  if (input === null) {
    throw new Error('no find field');
  }

  return input;
};

const type = (input: HTMLInputElement, query: string): void => {
  Object.assign(input, { value: query });
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('find in a PDF', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeObserver.all = [];
    highlights.clear();
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', { highlights });
    // jsdom has no element scrolling.
    Object.assign(HTMLElement.prototype, { scrollTo: () => undefined, scrollBy: () => undefined });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function getContext(this: HTMLCanvasElement) {
      return { canvas: this } as unknown as CanvasRenderingContext2D;
    });
  });

  afterEach(() => {
    releaseAll();
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollBy');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('opens a find field in the pill on Cmd+F and on Ctrl+F, and keeps the browser find shut', async () => {
    const h = harness();
    await mountPdfView(h.container, textDoc(3), {}, h.chrome);

    expect(field(h)).toBeNull();
    const event = press(h.scroller(), { key: 'f', code: 'KeyF', metaKey: true });

    expect(event.defaultPrevented).toBe(true);
    const input = field(h);
    expect(input?.closest('[data-role="file-preview-pill"]')).not.toBeNull();
    expect(input).toHaveFocus();
    expect(input?.getAttribute('aria-label')).toBe('Find in page');

    input?.blur();
    press(h.scroller(), { key: 'f', code: 'KeyF', ctrlKey: true });
    expect(h.container.querySelectorAll('[data-role="file-preview-find"]')).toHaveLength(1);
    expect(field(h)).toHaveFocus();
  });

  it('leaves Cmd+Shift+F and plain F alone', async () => {
    const h = harness();
    await mountPdfView(h.container, textDoc(3), {}, h.chrome);

    expect(press(h.scroller(), { key: 'F', code: 'KeyF', metaKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(h.scroller(), { key: 'f', code: 'KeyF' }).defaultPrevented).toBe(false);
    expect(field(h)).toBeNull();
  });

  it('counts the matches across pages and walks them with Enter and Shift+Enter', async () => {
    const idle = manualIdle();
    const h = harness();
    await mountPdfView(h.container, textDoc(3), {}, h.chrome);
    const scrollTo = vi.fn();
    Object.assign(h.scroller(), { scrollTo });
    pageObserver().show(1, 1);
    await settle();

    const input = openFind(h);
    type(input, 'blok pdf');
    await idle.runAll();

    expect(counter(h)).toBe('1 / 3');

    press(input, { key: 'Enter' });
    expect(counter(h)).toBe('2 / 3');
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 792 * PX_PER_PT - 20, behavior: 'smooth' });

    press(input, { key: 'Enter' });
    press(input, { key: 'Enter' });
    expect(counter(h)).toBe('1 / 3');

    press(input, { key: 'Enter', shiftKey: true });
    expect(counter(h)).toBe('3 / 3');
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 2 * 792 * PX_PER_PT - 20, behavior: 'smooth' });
  });

  it('moves with the next and previous buttons', async () => {
    const idle = manualIdle();
    const h = harness();
    await mountPdfView(h.container, textDoc(3), {}, h.chrome);

    type(openFind(h), 'page');
    await idle.runAll();
    h.container.querySelector<HTMLButtonElement>('[data-action="preview-find-next"]')?.click();
    expect(counter(h)).toBe('2 / 3');
    h.container.querySelector<HTMLButtonElement>('[data-action="preview-find-prev"]')?.click();
    expect(counter(h)).toBe('1 / 3');
  });

  it('starts from the page on screen', async () => {
    const idle = manualIdle();
    const h = harness();
    await mountPdfView(h.container, textDoc(5), {}, h.chrome);
    Object.defineProperty(h.scroller(), 'scrollTop', { configurable: true, value: 3 * 792 * PX_PER_PT + 10 });

    type(openFind(h), 'blok');
    await idle.runAll();

    expect(counter(h)).toBe('4 / 5');
  });

  it('leaves an IME Enter to the composition', async () => {
    const idle = manualIdle();
    const h = harness();
    await mountPdfView(h.container, textDoc(3), {}, h.chrome);
    const input = openFind(h);
    type(input, 'page');
    await idle.runAll();

    press(input, { key: 'Enter', isComposing: true });

    expect(counter(h)).toBe('1 / 3');
  });

  it('says so when nothing matches, and shows no count for an empty field', async () => {
    const idle = manualIdle();
    const h = harness();
    await mountPdfView(h.container, textDoc(3), {}, h.chrome);
    const input = openFind(h);

    type(input, 'zebra');
    await idle.runAll();
    expect(counter(h)).toBe('No results');

    type(input, '');
    await idle.runAll();
    expect(counter(h)).toBe('');
  });

  it('paints the matches in the text layer of drawn pages, the current one apart', async () => {
    const idle = manualIdle();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    const h = harness();
    await mountPdfView(h.container, textDoc(3, (n) => [`Blok PDF page ${n}`, 'see page notes']), textLayerLib, h.chrome);
    pageObserver().show(1, 1);
    await settle();

    type(openFind(h), 'PAGE');
    await idle.runAll();
    frames.splice(0).forEach((callback) => callback(0));

    expect(painted('blok-find-match-active')).toEqual(['page']);
    expect(painted('blok-find-match')).toEqual(['page', 'page', 'page', 'page', 'page']);
    const [active] = highlights.get('blok-find-match-active') ?? [];
    expect(active?.startContainer.parentElement?.textContent).toBe('Blok PDF page 1');
  });

  it('paints a page whose text layer arrives after the search', async () => {
    const idle = manualIdle();
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
    const h = harness();
    await mountPdfView(h.container, textDoc(3), textLayerLib, h.chrome);

    type(openFind(h), 'page');
    await idle.runAll();
    frames.splice(0).forEach((callback) => callback(0));
    expect(painted('blok-find-match-active')).toEqual([]);

    pageObserver().show(1, 1);
    await settle();
    await settle();
    frames.splice(0).forEach((callback) => callback(0));

    expect(painted('blok-find-match-active')).toEqual(['page']);
  });

  it('reads the text in idle chunks, one page per idle callback', async () => {
    const idle = manualIdle();
    const h = harness();
    const doc = textDoc(600);
    await mountPdfView(h.container, doc, {}, h.chrome);
    const input = openFind(h);

    type(input, 'blok');
    expect(doc.textReads).toEqual([]);

    idle.run();
    await settle();
    expect(doc.textReads).toHaveLength(1);
    idle.run();
    await settle();
    expect(doc.textReads).toHaveLength(2);

    await idle.runAll();
    expect(doc.textReads).toHaveLength(600);
    expect(counter(h)).toBe('1 / 600');
  });

  it('matches a new query on the text it already read, in bounded chunks', async () => {
    const idle = manualIdle();
    const h = harness();
    const doc = textDoc(600);
    await mountPdfView(h.container, doc, {}, h.chrome);
    const input = openFind(h);
    type(input, 'blok');
    await idle.runAll();

    type(input, 'pdf');
    idle.budget = 9;
    idle.run();
    expect(counter(h)).toBe('1 / 10');

    await idle.runAll();
    expect(counter(h)).toBe('1 / 600');
    expect(doc.textReads).toHaveLength(600);
  });

  it('drops a search that a newer query replaced', async () => {
    const idle = manualIdle();
    const h = harness();
    await mountPdfView(h.container, textDoc(50, (n) => [n === 50 ? 'zebra' : 'plain']), {}, h.chrome);
    const input = openFind(h);

    type(input, 'plain');
    idle.run();
    await settle();
    type(input, 'zebra');
    await idle.runAll();

    expect(counter(h)).toBe('1 / 1');
  });

  it('closes on Escape, clears the paint and gives focus back', async () => {
    const idle = manualIdle();
    const h = harness();
    await mountPdfView(h.container, textDoc(3), textLayerLib, h.chrome);
    pageObserver().show(1, 1);
    await settle();
    const before = h.container.querySelector<HTMLButtonElement>('[data-action="preview-zoom-in"]');
    before?.focus();
    const input = openFind(h);
    type(input, 'page');
    await idle.runAll();

    const escape = press(input, { key: 'Escape' });

    expect(escape.defaultPrevented).toBe(true);
    expect(field(h)).toBeNull();
    expect(before).toHaveFocus();
    expect(highlights.has('blok-find-match-active')).toBe(false);
  });

  it('closes with its close button', async () => {
    const h = harness();
    await mountPdfView(h.container, textDoc(3), {}, h.chrome);
    openFind(h);

    h.container.querySelector<HTMLButtonElement>('[data-action="preview-find-close"]')?.click();

    expect(field(h)).toBeNull();
  });

  it('stops reading text when the preview closes mid-search', async () => {
    const idle = manualIdle();
    const warn = vi.spyOn(console, 'warn');
    const h = harness();
    const doc = textDoc(600);
    await mountPdfView(h.container, doc, textLayerLib, h.chrome);
    type(openFind(h), 'blok');
    idle.run();
    await settle();

    h.release();
    await idle.runAll();

    expect(doc.textReads).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    expect(highlights.size).toBe(0);
  });

  it('keeps quiet when a page text cannot be read after close', async () => {
    const idle = manualIdle();
    const warn = vi.spyOn(console, 'warn');
    const h = harness();
    const doc = textDoc(5);
    const getPage = doc.getPage.bind(doc);
    doc.getPage = async (n) => ({ ...await getPage(n), getTextContent: () => Promise.reject(new Error('Worker was destroyed')) });
    const view = await mountPdfView(h.container, doc, {}, h.chrome);
    type(openFind(h), 'blok');

    view.destroy();
    await idle.runAll();

    expect(warn).not.toHaveBeenCalled();
  });

  it('labels its parts with the preview labels', async () => {
    const h = harness();
    const labels = { ...h.chrome.labels, findPlaceholder: 'Suchen', findNoResults: 'Keine Treffer', findNext: 'Weiter' };
    const idle = manualIdle();
    await mountPdfView(h.container, textDoc(1), {}, { ...h.chrome, labels });
    const input = openFind(h);
    type(input, 'zebra');
    await idle.runAll();

    expect(input.getAttribute('aria-label')).toBe('Suchen');
    expect(counter(h)).toBe('Keine Treffer');
    expect(h.container.querySelector('[data-action="preview-find-next"]')?.getAttribute('aria-label')).toBe('Weiter');
    expect(h.container.querySelector('[data-action="preview-find-next"]')?.hasAttribute('title')).toBe(false);
  });
});
