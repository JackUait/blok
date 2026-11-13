import { JUMP_PAD, mountPager, type PagedView } from '../page-pager';
import type { PreviewChrome } from '../preview-chrome';
import { fill } from '../preview-labels';
import { renderPdfLinks } from './pdf-links';
import type { PdfDocumentLike, PdfPageLike, PdfRenderTask, PdfViewport } from './pdf-types';

/** pdf.js sizes pages in pt; the screen counts CSS px. */
const PX_PER_PT = 96 / 72;
/** Safari draws nothing on a larger canvas. pdf.js caps the same way (`canvasMaxAreaInBytes`). */
const MAX_CANVAS_AREA = 16_777_216;
/** Browsers refuse a longer canvas side (pdf.js `maxCanvasDim`). */
const MAX_CANVAS_SIDE = 32_767;
/** Pages kept drawn on each side of the ones on screen. */
const NEIGHBOURS = 2;

/** What the viewer needs from pdf.js besides the document. Both hooks are optional. */
export interface PdfViewLib {
  /** Fills `host` with selectable text for the page; `cancel` stops it. */
  renderTextLayer?(page: PdfPageLike, viewport: PdfViewport, host: HTMLElement): Promise<{ cancel(): void }>;
  /** Fills `host` with the page's links. Without it the view draws them with renderPdfLinks. */
  renderLinks?(host: HTMLElement, page: PdfPageLike, viewport: PdfViewport, goTo: (dest: unknown) => void): Promise<void>;
}

async function drawLinks(host: HTMLElement, page: PdfPageLike, viewport: PdfViewport, goTo: (dest: unknown) => void): Promise<void> {
  renderPdfLinks(host, await page.getAnnotations(), viewport, goTo);
}

/**
 * The page index a link destination points at, or null. A named destination
 * is looked up first; an explicit one starts with a page ref or a page index.
 */
async function destPage(doc: PdfDocumentLike, dest: unknown): Promise<number | null> {
  const explicit = typeof dest === 'string' ? await doc.getDestination?.(dest) : dest;
  const target: unknown = Array.isArray(explicit) ? explicit[0] : null;
  if (typeof target === 'number' && Number.isInteger(target)) {
    return target;
  }
  if (target instanceof Object && doc.getPageIndex !== undefined) {
    return doc.getPageIndex(target);
  }

  return null;
}

interface Slot {
  box: HTMLElement;
  canvas: HTMLCanvasElement;
  text: HTMLElement;
  links: HTMLElement;
  /** Size at scale 1, in pt. Page 1's until this page is read. */
  width: number;
  height: number;
  page: PdfPageLike | null;
  task: PdfRenderTask | null;
  textTask: { cancel(): void } | null;
  /** Bumped by every draw and free; an async step that sees another number stops. */
  gen: number;
  /** The scale it is drawn at, or 0 when freed. */
  drawn: number;
}

/** pdf.js rejects with these when we cancel a render or a text layer. */
function isCancel(error: unknown): boolean {
  const name = error instanceof Object && 'name' in error ? error.name : '';

  return name === 'RenderingCancelledException' || name === 'AbortException';
}

function warn(error: unknown): void {
  if (!isCancel(error)) {
    console.warn('[blok] Failed to render a PDF page:', error);
  }
}

/** A zero-size canvas gives its pixel memory back at once. */
function freeCanvas(canvas: HTMLCanvasElement): void {
  Object.assign(canvas, { width: 0, height: 0 });
}

/** Backing pixels per CSS px: the device ratio, lowered until the canvas fits the browser's limits. */
function backingRatio(width: number, height: number): number {
  return Math.min(
    window.devicePixelRatio || 1,
    Math.sqrt(MAX_CANVAS_AREA / (width * height)),
    MAX_CANVAS_SIDE / width,
    MAX_CANVAS_SIDE / height,
  );
}

/**
 * An empty copy of a layer, put in its place. A hook still running on the old
 * one then writes into a detached node instead of the page.
 */
function freshLayer(old: HTMLElement): HTMLElement {
  const layer = part('div', old.className);
  old.replaceWith(layer);

  return layer;
}

function part<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;

  return node;
}

/**
 * A scroller of PDF pages. Only the pages on screen and two either side hold
 * a canvas; the rest are empty boxes of the right size.
 */
export async function mountPdfView(
  container: HTMLElement,
  doc: PdfDocumentLike,
  lib: PdfViewLib,
  chrome: PreviewChrome,
  options: { onError?(error: unknown): void } = {},
): Promise<{ destroy(): void }> {
  const first = await doc.getPage(1);
  const base = first.getViewport({ scale: 1 });
  const state = { scale: 0, destroyed: false, gap: -1, pad: 0 };

  // The office class brings the desk colour, the scroll and the scrollbar.
  const scroller = part('div', 'blok-file-preview-office blok-file-preview-pdf');
  scroller.setAttribute('data-role', 'file-preview-pdf');
  const stack = part('div', 'blok-file-preview-pdf-pages');
  scroller.appendChild(stack);

  const slots: Slot[] = Array.from({ length: doc.numPages }, (_, i) => {
    const box = part('div', 'blok-file-preview-pdf-page');
    box.setAttribute('data-role', 'file-preview-pdf-page');
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', fill(chrome.labels.pdfPageN, { number: i + 1 }));
    const canvas = part('canvas', 'blok-file-preview-pdf-canvas');
    const text = part('div', 'blok-file-preview-pdf-text');
    const links = part('div', 'blok-file-preview-pdf-links');
    box.append(canvas, text, links);
    stack.appendChild(box);

    return {
      box, canvas, text, links, width: base.width, height: base.height,
      page: i === 0 ? first : null, task: null, textTask: null, gen: 0, drawn: 0,
    };
  });
  container.appendChild(scroller);

  const sizeBox = (index: number): void => {
    const slot = slots[index];
    slot.box.style.width = `${slot.width * state.scale}px`;
    slot.box.style.height = `${slot.height * state.scale}px`;
  };

  const free = (index: number): void => {
    const slot = slots[index];
    slot.gen += 1;
    slot.drawn = 0;
    slot.task?.cancel();
    slot.task = null;
    slot.textTask?.cancel();
    slot.textTask = null;
    freeCanvas(slot.canvas);
    slot.text = freshLayer(slot.text);
    slot.links = freshLayer(slot.links);
    slot.page?.cleanup();
  };

  const drawLayers = async (index: number, page: PdfPageLike, viewport: PdfViewport, live: () => boolean): Promise<void> => {
    const slot = slots[index];
    slot.text = freshLayer(slot.text);
    slot.links = freshLayer(slot.links);
    const links = (lib.renderLinks ?? drawLinks)(slot.links, page, viewport, goTo).catch(warn);
    // Missing text or links leave a readable page, so they only warn.
    const handle = await lib.renderTextLayer?.(page, viewport, slot.text).catch(warn);
    if (handle !== undefined && live()) {
      slot.textTask = handle;
    } else {
      handle?.cancel();
    }
    await links;
  };

  const draw = async (index: number): Promise<void> => {
    const slot = slots[index];
    slot.gen += 1;
    const gen = slot.gen;
    const live = (): boolean => !state.destroyed && slot.gen === gen;
    slot.drawn = state.scale;
    slot.task?.cancel();
    slot.textTask?.cancel();
    slot.textTask = null;

    const page = slot.page ?? await doc.getPage(index + 1);
    slot.page = page;
    if (!live()) {
      // Freed while the page loaded: free() had no page to clean up.
      if (slot.drawn === 0) {
        page.cleanup();
      }

      return;
    }
    const natural = page.getViewport({ scale: 1 });
    if (natural.width !== slot.width || natural.height !== slot.height) {
      slot.width = natural.width;
      slot.height = natural.height;
      sizeBox(index);
    }

    const viewport = page.getViewport({ scale: state.scale });
    const ratio = backingRatio(viewport.width, viewport.height);
    const canvas = part('canvas', 'blok-file-preview-pdf-canvas');
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    // Safari returns null past its canvas limits.
    const context = canvas.getContext('2d');
    if (context === null) {
      return;
    }
    const sx = canvas.width / viewport.width;
    const sy = canvas.height / viewport.height;
    const transform = sx === 1 && sy === 1 ? undefined : [sx, 0, 0, sy, 0, 0];
    const task = page.render({ canvasContext: context, viewport, ...(transform === undefined ? {} : { transform }) });
    slot.task = task;
    try {
      await task.promise;
    } catch (error) {
      freeCanvas(canvas);
      throw error;
    }
    if (!live()) {
      freeCanvas(canvas);

      return;
    }
    slot.task = null;
    // The new canvas replaces the old one only when drawn, so a zoom never flashes blank.
    freeCanvas(slot.canvas);
    slot.canvas.replaceWith(canvas);
    slot.canvas = canvas;
    await drawLayers(index, page, viewport, live);
  };

  // A page that cannot be drawn is a broken view: the caller shows an error.
  const report = (error: unknown): void => {
    warn(error);
    if (!isCancel(error) && !state.destroyed) {
      options.onError?.(error);
    }
  };

  const visible = new Set<number>();
  const sync = (): void => {
    if (visible.size === 0 || state.destroyed) {
      return;
    }
    const low = Math.min(...visible) - NEIGHBOURS;
    const high = Math.max(...visible) + NEIGHBOURS;
    slots.forEach((slot, i) => {
      if (i < low || i > high) {
        if (slot.drawn !== 0) {
          free(i);
        }
      } else if (slot.drawn !== state.scale) {
        draw(i).catch(report);
      }
    });
  };

  /** Gap between pages and the space above the first, from the stylesheet. Read once. */
  const spacing = (): { gap: number; pad: number } => {
    if (state.gap < 0) {
      const style = getComputedStyle(stack);
      state.gap = parseFloat(style.rowGap) || 0;
      state.pad = parseFloat(style.paddingTop) || 0;
    }

    return { gap: state.gap, pad: state.pad };
  };

  /** Top of every page in scroller px, from known sizes: nothing is measured. */
  const tops = (): number[] => {
    const { gap, pad } = spacing();

    return slots.reduce<number[]>((acc, slot, i) => {
      acc.push(i === 0 ? pad : acc[i - 1] + slots[i - 1].height * state.scale + gap);

      return acc;
    }, []);
  };

  const view: PagedView = {
    count: slots.length,
    currentPage: () => {
      const line = scroller.scrollTop + scroller.clientHeight / 3;

      return tops().reduce((found, top, index) => (top <= line ? index : found), 0);
    },
    scrollToPage: (index) => {
      const top = tops()[index];
      if (top !== undefined) {
        scroller.scrollTo({ top: Math.max(0, top - JUMP_PAD), behavior: 'smooth' });
      }
    },
    naturalWidth: () => Math.max(...slots.map((slot) => slot.width)) * PX_PER_PT,
    setScale: (scale) => {
      const next = scale * PX_PER_PT;
      if (next === state.scale) {
        return;
      }
      state.scale = next;
      // The pdf.js text layer sizes itself from this.
      scroller.style.setProperty('--total-scale-factor', String(next));
      slots.forEach((_, i) => sizeBox(i));
      sync();
    },
  };

  // A broken destination is the PDF's fault; the click just does nothing.
  const goTo = (dest: unknown): void => {
    destPage(doc, dest).then((index) => {
      if (index !== null && !state.destroyed) {
        view.scrollToPage(index);
      }
    }, () => undefined);
  };

  // The pager sets the fitted scale first, so pages never draw at a throwaway size.
  mountPager(scroller, view, chrome);

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const index = slots.findIndex((slot) => slot.box === entry.target);
      if (entry.isIntersecting) {
        visible.add(index);
      } else {
        visible.delete(index);
      }
    });
    sync();
  }, { root: scroller });
  slots.forEach((slot) => observer.observe(slot.box));

  return {
    destroy: () => {
      if (state.destroyed) {
        return;
      }
      state.destroyed = true;
      observer.disconnect();
      slots.forEach((_, i) => free(i));
    },
  };
}
