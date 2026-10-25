import { promoteToTopLayer, removeFromTopLayer } from '../../components/utils/top-layer';

/** The closest the text column comes to the window edge, so the +/⋮⋮ handles stay clear of it and of side chrome. */
const PAGE_INSET = 96;

const isHorizontalScroller = (el: Element): boolean => {
  const overflowX = getComputedStyle(el).overflowX;

  return overflowX === 'auto' || overflowX === 'scroll';
};

/** Whether `el` can still scroll by `delta` on its own. RTL scrollLeft runs from 0 down to negative. */
const canScrollBy = (el: Element, delta: number): boolean => {
  const position = Math.abs(el.scrollLeft);
  const max = el.scrollWidth - el.clientWidth;
  const forward = getComputedStyle(el).direction === 'rtl' ? delta < 0 : delta > 0;

  return max > 0 && (forward ? position < max - 1 : position > 0);
};

/** Whether something between `el` and `host` can still scroll by `delta` on its own, like a board. */
const innerScrollerTakes = (el: Element | null, host: Element, delta: number): boolean =>
  el !== null && el !== host && ((isHorizontalScroller(el) && canScrollBy(el, delta)) || innerScrollerTakes(el.parentElement, host, delta));

/**
 * The page beside a side peek keeps its width. It first moves into the free space
 * at its start; a scrollbar under the uncovered part then pans the rest out from
 * under the peek. The page moves by a relative offset, never by a document scroll,
 * so no scrollbar runs under the peek.
 */
export class PeekPagePan {
  private host: HTMLElement | null = null;
  /** The page that carries the marks; it outlives `host` while the peek slides out. */
  private marked: HTMLElement | null = null;
  private bar: HTMLElement | null = null;
  private shift = 0;
  private pan = 0;
  private travel = 0;
  private rtl = false;

  /**
   * Measures the page and the drawer's `width`, then places the page and its bar.
   * A resize drag calls this on every move, so it undoes its own offset before measuring.
   */
  fit(host: HTMLElement, mount: HTMLElement, width: number, rtl: boolean): void {
    const offset = this.host === host ? this.shift + this.pan : 0;
    const rect = host.getBoundingClientRect();
    const covered = Math.max(0, rtl ? width - (rect.left - offset) : rect.right + offset - (window.innerWidth - width));
    const free = Math.max(0, this.columnStart(host, rtl) + offset - PAGE_INSET);

    if (this.host !== host) {
      this.detach();
      this.host = host;
      this.marked = host;
      host.addEventListener('wheel', this.onWheel, { passive: false });
      // Capture on window runs before the window capture listeners of menus opened later, so they place against the panned page.
      window.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    }
    this.rtl = rtl;
    this.shift = Math.round(Math.min(free, covered));
    this.travel = Math.round(covered - this.shift);
    this.pan = Math.min(this.pan, this.travel);
    host.setAttribute('data-blok-database-peek', '');
    this.syncBar(mount, width);
    this.apply();
  }

  /** The peek is sliding out: the page eases back and the bar goes at once. */
  leave(): void {
    const host = this.marked;

    this.detach();
    host?.removeAttribute('data-blok-database-peek-panning');
    host?.style.setProperty('--_blok-peek-offset', '0px');
  }

  /** Drops every mark on the page. */
  release(): void {
    const host = this.marked;

    this.detach();
    this.marked = null;
    host?.removeAttribute('data-blok-database-peek');
    host?.removeAttribute('data-blok-database-peek-panning');
    host?.style.removeProperty('--_blok-peek-offset');
  }

  private detach(): void {
    this.host?.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('scroll', this.onScroll, { capture: true });
    this.removeBar();
    this.host = null;
    this.shift = 0;
    this.pan = 0;
    this.travel = 0;
  }

  /**
   * How far the text column starts from the window's start edge. Worked out from the
   * editor's content box, since a page of wide blocks (a database) has no column block to measure.
   * Blocks centre the column in the box past the gutter (main.css).
   */
  private columnStart(host: HTMLElement, rtl: boolean): number {
    const redactor = host.querySelector<HTMLElement>('[data-blok-redactor]');

    if (redactor === null) {
      return PAGE_INSET;
    }
    const style = getComputedStyle(redactor);
    const rect = redactor.getBoundingClientRect();
    const gutter = Number.parseFloat(rtl ? style.paddingRight : style.paddingLeft) || 0;
    const box = rect.width - gutter - (Number.parseFloat(rtl ? style.paddingLeft : style.paddingRight) || 0);
    const token = style.getPropertyValue('--blok-content-max-width').trim();
    // Full width drops the --max-width-content fallback (main.css).
    const fallback = host.getAttribute('data-blok-width') === 'full' ? 'none' : style.getPropertyValue('--max-width-content');
    // NaN for `none`: the column fills the box.
    const max = Number.parseFloat(token !== '' ? token : fallback);
    const column = Number.isNaN(max) ? box : Math.min(box, max);
    const start = gutter + (box - column) / 2;

    return rtl ? window.innerWidth - rect.right + start : rect.left + start;
  }

  private syncBar(mount: HTMLElement, width: number): void {
    if (this.travel === 0) {
      this.removeBar();

      return;
    }
    if (this.bar === null) {
      const bar = document.createElement('div');

      bar.setAttribute('data-blok-database-peek-scrollbar', '');
      bar.setAttribute('aria-hidden', 'true');
      bar.appendChild(document.createElement('div'));
      mount.appendChild(bar);
      promoteToTopLayer(bar);
      this.bar = bar;
    }
    this.bar.style.setProperty('--_blok-peek-width', `${width}px`);
    this.bar.style.setProperty('--_blok-peek-travel', `${this.travel}px`);
    this.bar.scrollLeft = this.rtl ? -this.pan : this.pan;
  }

  private removeBar(): void {
    if (this.bar === null) {
      return;
    }
    removeFromTopLayer(this.bar);
    this.bar.remove();
    this.bar = null;
  }

  private apply(): void {
    this.host?.style.setProperty('--_blok-peek-offset', `${this.shift + this.pan}px`);
  }

  private panTo(next: number): void {
    this.pan = Math.max(0, Math.min(this.travel, next));
    // A pan follows the hand; only open and close ease.
    this.host?.setAttribute('data-blok-database-peek-panning', '');
    this.apply();
  }

  private readonly onScroll = (event: Event): void => {
    if (this.bar !== null && event.target === this.bar) {
      this.panTo(Math.abs(this.bar.scrollLeft));
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    const host = this.host;
    const dx = event.deltaX === 0 && event.shiftKey ? event.deltaY : event.deltaX;

    if (host === null || this.bar === null || dx === 0 || !(event.target instanceof Element)) {
      return;
    }
    if (event.target.closest('[data-blok-database-drawer]') !== null) {
      return;
    }
    // Over the bar the handler pans too: the browser does not always deliver a wheel to a scroller at the window's bottom edge.
    const start = this.bar.contains(event.target) ? null : event.target;

    if (innerScrollerTakes(start, host, dx)) {
      return;
    }
    const before = this.pan;

    this.panTo(this.pan + (this.rtl ? -dx : dx));
    if (this.pan === before) {
      return;
    }
    event.preventDefault();
    this.bar.scrollLeft = this.rtl ? -this.pan : this.pan;
  };
}
