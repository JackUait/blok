import { IconChevronLeft, IconChevronRight, IconMinus, IconPlus } from '../../components/icons';
import { buildPill, iconButton, pillDivider, pillText, type PreviewChrome } from './preview-chrome';
import { counted, fill } from './preview-labels';

/** Space kept on both sides of a fitted page, in px. */
const FIT_GUTTER = 48;
/** How far above a page's top edge a jump lands, so the edge stays in view. */
const JUMP_PAD = 20;
const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const PX_PER_PT = 96 / 72;

/** A run of pages the pager can count, jump between and zoom. */
export interface PagedView {
  count: number;
  /** Index of the page at the reading line (a third down the scroller). */
  currentPage(): number;
  scrollToPage(index: number): void;
  /** Widest page width at 100%, in px. */
  naturalWidth(): number;
  /** Scale every page; 1 = natural size. */
  setScale(scale: number): void;
}

/** A page's width at 100%, in px. The docx renderer writes it inline in pt. */
function docxPageWidth(page: HTMLElement): number {
  return (parseFloat(page.style.width) || 0) * PX_PER_PT;
}

/** The docx pages in `scroller`, or null when the renderer drew none. */
export function docxPagedView(scroller: HTMLElement): PagedView | null {
  const wrapper = scroller.querySelector<HTMLElement>('.blok-docx-wrapper');
  const pages = Array.from(scroller.querySelectorAll<HTMLElement>('section.blok-docx'));
  if (wrapper === null || pages.length === 0) {
    return null;
  }
  const topOf = (page: HTMLElement): number =>
    page.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

  return {
    count: pages.length,
    currentPage: () => {
      const line = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;

      return pages.reduce((found, page, index) => (page.getBoundingClientRect().top <= line ? index : found), 0);
    },
    scrollToPage: (index) => {
      const page = pages[index];
      if (page !== undefined) {
        scroller.scrollTo({ top: Math.max(0, topOf(page) - JUMP_PAD), behavior: 'smooth' });
      }
    },
    naturalWidth: () => Math.max(...pages.map(docxPageWidth)),
    setScale: (scale) => wrapper.style.setProperty('--blok-docx-zoom', String(scale)),
  };
}

/**
 * Page counter and zoom for a scroller of pages. The counter follows the
 * scroll; the arrows jump a page; zoom scales the pages. 100% means "fits the
 * view", never larger than the real page.
 */
export function mountPager(scroller: HTMLElement, view: PagedView, chrome: PreviewChrome): void {
  if (view.count === 0) {
    return;
  }
  const { labels } = chrome;
  const state = { current: 0, zoom: 1, frame: 0, released: false };
  const pageText = pillText('file-preview-page');
  const zoomText = pillText('file-preview-zoom');

  const track = (): void => {
    state.current = view.currentPage();
    pageText.textContent = fill(labels.pageOf, { page: state.current + 1, total: view.count });
  };

  // currentPage() may measure every page, so read it once per frame at most.
  const onScroll = (): void => {
    if (state.frame !== 0 || state.released) {
      return;
    }
    state.frame = requestAnimationFrame(() => {
      state.frame = 0;
      if (!state.released) {
        track();
      }
    });
  };

  const go = (index: number): void => {
    if (index >= 0 && index < view.count) {
      view.scrollToPage(index);
    }
  };

  const applyZoom = (): void => {
    const widest = view.naturalWidth();
    const room = scroller.clientWidth - FIT_GUTTER;
    const fit = widest > 0 && room > 0 ? Math.min(1, room / widest) : 1;
    view.setScale(fit * state.zoom);
    zoomText.textContent = `${Math.round(state.zoom * 100)}%`;
  };

  const zoomBy = (delta: number): void => {
    state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((state.zoom + delta) / ZOOM_STEP) * ZOOM_STEP));
    applyZoom();
    track();
  };

  scroller.addEventListener('scroll', onScroll, { passive: true });
  chrome.onRelease(() => {
    state.released = true;
    scroller.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(state.frame);
  });
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(applyZoom);
    observer.observe(scroller);
    chrome.onRelease(() => observer.disconnect());
  }

  chrome.setFacts([counted(view.count, labels.pagesOne, labels.pages)]);
  chrome.addOverlay(buildPill([
    iconButton(IconChevronLeft, labels.prevPage, 'preview-prev-page', () => go(state.current - 1)),
    pageText,
    iconButton(IconChevronRight, labels.nextPage, 'preview-next-page', () => go(state.current + 1)),
    pillDivider(),
    iconButton(IconMinus, labels.zoomOut, 'preview-zoom-out', () => zoomBy(-ZOOM_STEP)),
    zoomText,
    iconButton(IconPlus, labels.zoomIn, 'preview-zoom-in', () => zoomBy(ZOOM_STEP)),
  ]));
  applyZoom();
  track();
}
