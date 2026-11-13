import { IconGallery } from '../../../components/icons';
import { hintButton, pillDivider, type PreviewChrome } from '../preview-chrome';
import { fill } from '../preview-labels';
import type { PdfDocumentLike, PdfRenderTask } from './pdf-types';

/** Thumbnail size against the page at 100%, in pdf.js scale (pt to px at 1). */
const THUMB_SCALE = 0.2;
/** Thumbnails this far past the rail's edges draw ahead of the scroll. */
const AHEAD = '300px 0px';

/** What the rail needs from the page view. */
export interface PdfThumbsView {
  scroller: HTMLElement;
  /** Page 1's size at scale 1, in pt; the boxes use it until a page is read. */
  width: number;
  height: number;
  currentPage(): number;
  scrollToPage(index: number): void;
}

interface Thumb {
  button: HTMLButtonElement;
  canvas: HTMLCanvasElement;
  /** Bumped on every free; a draw that sees another number drops its canvas. */
  gen: number;
  drawn: boolean;
}

function freeCanvas(canvas: HTMLCanvasElement): void {
  Object.assign(canvas, { width: 0, height: 0 });
}

function isCancel(error: unknown): boolean {
  const name = error instanceof Object && 'name' in error ? error.name : '';

  return name === 'RenderingCancelledException' || name === 'AbortException';
}

/**
 * A rail of page thumbnails, toggled from the pager pill. Only thumbnails
 * near the rail's view hold a canvas, drawn one at a time; the page being
 * read is marked in primary ink, and a click jumps to its page.
 */
export function mountPdfThumbs(
  doc: PdfDocumentLike,
  view: PdfThumbsView,
  pill: HTMLElement,
  chrome: PreviewChrome,
): { destroy(): void } {
  const { labels } = chrome;
  const thumbs: Thumb[] = [];
  const near = new Set<number>();
  const state: {
    rail: HTMLElement | null;
    observer: IntersectionObserver | null;
    task: PdfRenderTask | null;
    drawing: number;
    current: number;
    frame: number;
    open: boolean;
    destroyed: boolean;
  } = { rail: null, observer: null, task: null, drawing: -1, current: -1, frame: 0, open: false, destroyed: false };

  const mark = (): void => {
    const current = view.currentPage();
    if (current === state.current) {
      return;
    }
    thumbs[state.current]?.button.setAttribute('aria-current', 'false');
    thumbs[current]?.button.setAttribute('aria-current', 'true');
    thumbs[current]?.button.scrollIntoView?.({ block: 'nearest' });
    state.current = current;
  };

  const free = (index: number): void => {
    const thumb = thumbs[index];
    thumb.gen += 1;
    thumb.drawn = false;
    freeCanvas(thumb.canvas);
    if (state.drawing === index) {
      state.task?.cancel();
    }
  };

  /** Draws the next near thumbnail that has no picture yet, then the one after. */
  const pump = (): void => {
    if (state.drawing !== -1 || !state.open || state.destroyed) {
      return;
    }
    const index = [...near].sort((a, b) => a - b).find((i) => !thumbs[i].drawn);
    if (index === undefined) {
      return;
    }
    const thumb = thumbs[index];
    const gen = thumb.gen;
    state.drawing = index;
    const live = (): boolean => !state.destroyed && thumb.gen === gen;
    const draw = async (): Promise<void> => {
      const page = await doc.getPage(index + 1);
      if (!live()) {
        return;
      }
      const viewport = page.getViewport({ scale: THUMB_SCALE });
      const ratio = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.className = thumb.canvas.className;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext('2d');
      if (context === null) {
        return;
      }
      const task = page.render({ canvasContext: context, viewport, ...(ratio === 1 ? {} : { transform: [ratio, 0, 0, ratio, 0, 0] }) });
      state.task = task;
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
      freeCanvas(thumb.canvas);
      thumb.canvas.replaceWith(canvas);
      thumb.canvas = canvas;
      thumb.drawn = true;
    };
    draw().catch((error: unknown) => {
      // A thumbnail that fails stays blank; the page itself reports the failure.
      if (!isCancel(error) && !state.destroyed) {
        console.warn('[blok] Failed to draw a PDF thumbnail:', error);
        thumb.drawn = true;
      }
    }).finally(() => {
      state.task = null;
      state.drawing = -1;
      pump();
    });
  };

  const build = (): HTMLElement => {
    const rail = document.createElement('div');
    rail.className = 'blok-file-preview-pdf-thumbs';
    rail.setAttribute('data-role', 'file-preview-pdf-thumbs');
    rail.setAttribute('aria-label', labels.thumbnails);
    rail.setAttribute('role', 'group');
    Array.from({ length: doc.numPages }, (_, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'blok-file-preview-pdf-thumb';
      button.setAttribute('data-role', 'file-preview-pdf-thumb');
      button.setAttribute('aria-label', fill(labels.pdfPageN, { number: index + 1 }));
      button.setAttribute('aria-current', 'false');
      const canvas = document.createElement('canvas');
      canvas.className = 'blok-file-preview-pdf-thumb-canvas';
      canvas.width = 0;
      canvas.height = 0;
      canvas.style.width = `${view.width * THUMB_SCALE}px`;
      canvas.style.height = `${view.height * THUMB_SCALE}px`;
      const number = document.createElement('span');
      number.setAttribute('aria-hidden', 'true');
      number.textContent = String(index + 1);
      button.append(canvas, number);
      button.addEventListener('click', () => view.scrollToPage(index));
      rail.appendChild(button);
      thumbs.push({ button, canvas, gen: 0, drawn: false });

      return button;
    });
    chrome.addOverlay(rail);

    return rail;
  };

  const onScroll = (): void => {
    if (state.frame !== 0) {
      return;
    }
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      if (state.open && !state.destroyed) {
        mark();
      }
    });
  };

  const show = (open: boolean): void => {
    state.open = open;
    toggle.setAttribute('aria-pressed', String(open));
    // The pages make room for the rail and refit (file.css).
    view.scroller.toggleAttribute('data-blok-pdf-thumbs', open);
    if (open) {
      const rail = state.rail ?? build();
      state.rail = rail;
      rail.hidden = false;
      state.current = -1;
      mark();
      view.scroller.addEventListener('scroll', onScroll, { passive: true });
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const index = thumbs.findIndex((thumb) => thumb.button === entry.target);
          if (entry.isIntersecting) {
            near.add(index);
          } else {
            near.delete(index);
            if (thumbs[index].drawn || state.drawing === index) {
              free(index);
            }
          }
        });
        pump();
      }, { root: rail, rootMargin: AHEAD });
      thumbs.forEach((thumb) => observer.observe(thumb.button));
      state.observer = observer;

      return;
    }
    view.scroller.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.observer?.disconnect();
    state.observer = null;
    near.clear();
    thumbs.forEach((_, i) => free(i));
    if (state.rail !== null) {
      state.rail.hidden = true;
    }
  };

  const toggle = hintButton(IconGallery, labels.thumbnails, 'preview-thumbnails', () => show(!state.open));
  toggle.setAttribute('aria-pressed', 'false');
  pill.append(pillDivider(), toggle);

  const destroy = (): void => {
    if (state.destroyed) {
      return;
    }
    show(false);
    state.destroyed = true;
    state.rail?.remove();
    state.rail = null;
  };
  chrome.onRelease(destroy);

  return { destroy };
}
