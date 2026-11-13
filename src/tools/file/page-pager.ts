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

/** A page's width at 100%, in px. The docx renderer writes it inline in pt. */
function naturalWidth(page: HTMLElement): number {
  return (parseFloat(page.style.width) || 0) * PX_PER_PT;
}

/**
 * Page counter and zoom for a scroller of docx pages. The counter follows the
 * scroll; the arrows jump a page; zoom scales the pages. 100% means "fits the
 * view", never larger than the real page.
 */
export function mountPager(scroller: HTMLElement, chrome: PreviewChrome): void {
  const wrapper = scroller.querySelector<HTMLElement>('.blok-docx-wrapper');
  const pages = Array.from(scroller.querySelectorAll<HTMLElement>('section.blok-docx'));
  if (wrapper === null || pages.length === 0) {
    return;
  }
  const { labels } = chrome;
  const state = { current: 0, zoom: 1 };
  const pageText = pillText('file-preview-page');
  const zoomText = pillText('file-preview-zoom');

  const topOf = (page: HTMLElement): number =>
    page.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

  const track = (): void => {
    const line = scroller.getBoundingClientRect().top + scroller.clientHeight / 3;
    state.current = pages.reduce((found, page, index) => (page.getBoundingClientRect().top <= line ? index : found), 0);
    pageText.textContent = fill(labels.pageOf, { page: state.current + 1, total: pages.length });
  };

  const go = (index: number): void => {
    const page = pages[index];
    if (page === undefined) {
      return;
    }
    scroller.scrollTo({ top: Math.max(0, topOf(page) - JUMP_PAD), behavior: 'smooth' });
  };

  const applyZoom = (): void => {
    const widest = Math.max(...pages.map(naturalWidth));
    const room = scroller.clientWidth - FIT_GUTTER;
    const fit = widest > 0 && room > 0 ? Math.min(1, room / widest) : 1;
    wrapper.style.setProperty('--blok-docx-zoom', String(fit * state.zoom));
    zoomText.textContent = `${Math.round(state.zoom * 100)}%`;
  };

  const zoomBy = (delta: number): void => {
    state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((state.zoom + delta) / ZOOM_STEP) * ZOOM_STEP));
    applyZoom();
    track();
  };

  scroller.addEventListener('scroll', track, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(applyZoom);
    observer.observe(scroller);
    chrome.onRelease(() => observer.disconnect());
  }

  chrome.setFacts([counted(pages.length, labels.pagesOne, labels.pages)]);
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
