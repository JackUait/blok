import { IconCross, IconExpandDiagonal, IconTable } from '../../components/icons';
import { DATA_ATTR } from '../../components/constants';
import { ScrollLocker } from '../../components/utils/scroll-locker';
import { promoteToTopLayer, removeFromTopLayer, TOP_LAYER_MARKER_ATTR } from '../../components/utils/top-layer';
import { onHover } from '../../components/utils/tooltip';

export const FULLSCREEN_ATTR = 'data-blok-table-fullscreen';
const BACKDROP_ATTR = 'data-blok-table-fullscreen-backdrop';
const TOGGLE_ATTR = 'data-blok-table-fullscreen-toggle';
const HEADER_ATTR = 'data-blok-table-fullscreen-header';
const TITLE_ATTR = 'data-blok-table-fullscreen-title';
const SIZE_ATTR = 'data-blok-table-fullscreen-size';

const OPEN_MS = 520;
const CLOSE_MS = 420;
const SPRING = 'cubic-bezier(.16, 1, .3, 1)';
/* Matches the modal's corner radius in tables.css (--blok-radius-dialog). */
const SHEET_CLIP = 'inset(0px 0px 0px 0px round 12px)';

interface TableFullscreenOptions {
  /**
   * The holder's content box. It goes to the top layer, not the tool root:
   * writes on the root count as edits. Its holder stays in the page.
   */
  getHost: () => HTMLElement | null;
  /** Text of the heading right above the table, if there is one. */
  getTitle: () => string | null;
  getSize: () => { rows: number; cols: number };
  t: (key: string) => string;
}

const isOpenPopover = (el: HTMLElement): boolean => {
  try {
    return el.matches(':popover-open');
  } catch {
    // No Popover API: nothing is in the top layer.
    return false;
  }
};

const canAnimate = (el: HTMLElement): boolean =>
  typeof el.animate === 'function'
  && !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/** The clip-path inset that shows only `inner` of `outer`. */
const insetOf = (outer: DOMRect, inner: DOMRect): string =>
  `inset(${inner.top - outer.top}px ${outer.right - inner.right}px ${outer.bottom - inner.bottom}px ${inner.left - outer.left}px round 4px)`;

/**
 * Where the page after the holder starts, in page coordinates: the next block,
 * or the container's end. Page, not viewport: the scroll can clamp in between.
 */
const flowEdge = (holder: HTMLElement): number =>
  window.scrollY + (
    holder.nextElementSibling?.getBoundingClientRect().top
    ?? holder.parentElement?.getBoundingClientRect().bottom
    ?? 0
  );

/**
 * Moves the tool root (position: relative) by offsets, not a transform: a
 * transform would make it the box its position: fixed header and button sit in.
 */
const offset = (to: DOMRect, from: DOMRect): Keyframe => ({
  left: `${to.left - from.left}px`,
  top: `${to.top - from.top}px`,
});

/**
 * Shows the live table in a modal over the page. The table never moves in the
 * DOM, so editing, saving and the block tree work as they do inline.
 * The modal grows out of the table's inline box and shrinks back into it.
 */
export class TableFullscreen {
  public readonly button: HTMLButtonElement;
  /** Sits in the tool root, hidden until the modal opens. */
  public readonly header: HTMLElement;

  private host: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;
  /** The table's inline box at open. The page is scroll-locked, so it holds until close. */
  private origin: DOMRect | null = null;
  /** The holder, held at its inline height so the page under the modal does not reflow. */
  private holder: HTMLElement | null = null;
  private closing: { host: HTMLElement; backdrop: HTMLElement | null; animations: Animation[] } | null = null;
  private readonly scroll = new ScrollLocker();
  /** Rows and columns change while the modal is open, so the size follows the grid. */
  private readonly sizeWatch = new MutationObserver(() => this.syncSize());

  constructor(private readonly options: TableFullscreenOptions) {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(TOGGLE_ATTR, '');
    // Its label and icon swap on open; the table must not see that as an edit.
    button.setAttribute(DATA_ATTR.mutationFree, 'true');
    button.contentEditable = 'false';
    button.addEventListener('click', () => {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    });
    this.button = button;

    const header = document.createElement('div');

    header.setAttribute(HEADER_ATTR, '');
    header.setAttribute(DATA_ATTR.mutationFree, 'true');
    header.contentEditable = 'false';
    header.innerHTML = `${IconTable}<span ${TITLE_ATTR}></span><span ${SIZE_ATTR}></span>`;
    this.header = header;

    this.syncButton();
  }

  public get isOpen(): boolean {
    return this.host !== null;
  }

  public open(): void {
    this.finishClose();

    const host = this.options.getHost();

    if (host === null || this.isOpen) {
      return;
    }

    // First: locking sets overflow on body, which can shift the page by a margin.
    this.scroll.lock();

    const source = host.querySelector<HTMLElement>('[data-blok-table-scroll]') ?? host;
    const origin = source.getBoundingClientRect();
    const title = this.options.getTitle() ?? this.options.t('tools.table.title');

    this.syncTitle(title);
    this.syncSize();
    this.sizeWatch.observe(source, { childList: true, subtree: true });

    const backdrop = document.createElement('div');

    backdrop.setAttribute(BACKDROP_ATTR, '');
    backdrop.addEventListener('click', () => this.close());
    document.body.appendChild(backdrop);
    // The top layer stacks in show order: the backdrop goes first.
    promoteToTopLayer(backdrop);
    this.backdrop = backdrop;

    const holder = host.parentElement;
    const flowBefore = holder === null ? 0 : flowEdge(holder);
    const scrollY = window.scrollY;

    // Pinned before the box leaves the flow: a shorter page would clamp the scroll position.
    if (holder !== null) {
      holder.style.minHeight = `${holder.getBoundingClientRect().height}px`;
    }

    host.setAttribute(FULLSCREEN_ATTR, '');
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', title);
    promoteToTopLayer(host);

    if (holder !== null) {
      // Margins that collapsed through the holder change once it is pinned, so correct by measuring twice.
      const first = holder.getBoundingClientRect().height + flowBefore - flowEdge(holder);

      holder.style.minHeight = `${first}px`;
      holder.style.minHeight = `${first + flowBefore - flowEdge(holder)}px`;
    }
    this.holder = holder;

    if (window.scrollY !== scrollY) {
      window.scrollTo({ top: scrollY, behavior: 'instant' });
    }
    window.addEventListener('keydown', this.onKeydown, true);
    this.host = host;
    this.origin = origin;
    this.syncButton();
    this.animateOpen(host, backdrop, source, origin);
  }

  /**
   * The dialog is gone at once for keyboard and screen reader users. The box
   * stays in the top layer only while it shrinks back into the page.
   */
  public close(): void {
    const host = this.host;

    if (host === null) {
      return;
    }
    this.host = null;

    window.removeEventListener('keydown', this.onKeydown, true);
    this.sizeWatch.disconnect();
    host.removeAttribute('role');
    host.removeAttribute('aria-modal');
    host.removeAttribute('aria-label');

    const backdrop = this.backdrop;

    this.backdrop = null;
    this.closing = { host, backdrop, animations: this.animateClose(host, backdrop) };
    this.syncButton();

    const animations = this.closing.animations;

    if (animations.length === 0) {
      this.finishClose();

      return;
    }
    void Promise.all(animations.map(a => a.finished)).then(() => this.finishClose(), () => undefined);
  }

  public destroy(): void {
    this.close();
    this.finishClose();
    this.button.remove();
    this.header.remove();
  }

  private finishClose(): void {
    const closing = this.closing;

    if (closing === null) {
      return;
    }
    this.closing = null;
    this.origin = null;

    closing.animations.forEach(a => a.cancel());
    removeFromTopLayer(closing.host);
    closing.host.removeAttribute(FULLSCREEN_ATTR);
    this.holder?.style.removeProperty('min-height');
    this.holder = null;

    if (closing.backdrop !== null) {
      removeFromTopLayer(closing.backdrop);
      closing.backdrop.remove();
    }

    this.scroll.unlock();

    if (this.button.isConnected) {
      this.button.focus({ preventScroll: true });
    }
  }

  /** WAAPI writes no attributes, so none of this reaches the block's mutation observer. */
  private animateOpen(host: HTMLElement, backdrop: HTMLElement, source: HTMLElement, origin: DOMRect): void {
    if (!canAnimate(host)) {
      return;
    }
    const landed = source.getBoundingClientRect();
    const content = source.parentElement;
    const timing = { duration: OPEN_MS, easing: SPRING };

    host.animate([{ clipPath: insetOf(host.getBoundingClientRect(), origin) }, { clipPath: SHEET_CLIP }], timing);
    content?.animate([offset(origin, landed), { left: '0px', top: '0px' }], timing);
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * 0.8, easing: 'linear' });
    [this.header, this.button].forEach(el => el.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 240, delay: OPEN_MS * 0.4, easing: 'ease-out', fill: 'backwards' }
    ));
  }

  private animateClose(host: HTMLElement, backdrop: HTMLElement | null): Animation[] {
    const origin = this.origin;

    host.getAnimations({ subtree: true }).forEach(a => a.cancel());

    if (origin === null || !host.isConnected || !canAnimate(host)) {
      return [];
    }
    const source = host.querySelector<HTMLElement>('[data-blok-table-scroll]');
    const content = source?.parentElement;
    const timing = { duration: CLOSE_MS, easing: SPRING, fill: 'forwards' as const };
    const animations = [
      host.animate([{ clipPath: SHEET_CLIP }, { clipPath: insetOf(host.getBoundingClientRect(), origin) }], timing),
    ];

    if (source && content) {
      const from = source.getBoundingClientRect();

      animations.push(content.animate([{ left: '0px', top: '0px' }, offset(origin, from)], timing));
      source.scrollLeft = 0;
    }
    if (backdrop !== null) {
      animations.push(backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, easing: 'linear' }));
    }
    [this.header, this.button].forEach(el => animations.push(
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: 'linear', fill: 'forwards' })
    ));

    return animations;
  }

  /**
   * Window capture runs before every document handler. Blok's Escape there stops
   * the event before it reaches the holder, and a menu's Escape closes the menu
   * before hasLayerAbove could see it. A menu above the table closes first.
   */
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.hasLayerAbove()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.close();
  };

  private hasLayerAbove(): boolean {
    const host = this.host;

    return Array.from(document.querySelectorAll<HTMLElement>(`[${TOP_LAYER_MARKER_ATTR}]`)).some(el =>
      el !== host
      && el !== this.backdrop
      && el.getAttribute('role') !== 'tooltip'
      && host?.contains(el) !== true
      && isOpenPopover(el)
    );
  }

  private syncTitle(title: string): void {
    const titleEl = this.header.querySelector(`[${TITLE_ATTR}]`);

    if (titleEl !== null) {
      titleEl.textContent = title;
    }
  }

  private syncSize(): void {
    const sizeEl = this.header.querySelector(`[${SIZE_ATTR}]`);
    const { rows, cols } = this.options.getSize();
    const size = `${rows} × ${cols}`;

    if (sizeEl !== null && sizeEl.textContent !== size) {
      sizeEl.textContent = size;
    }
  }

  private syncButton(): void {
    const label = this.options.t(this.isOpen ? 'tools.table.closeFullScreen' : 'tools.table.openFullScreen');

    this.button.innerHTML = this.isOpen ? `${IconCross}<kbd>Esc</kbd>` : IconExpandDiagonal;
    this.button.setAttribute('aria-label', label);
    onHover(this.button, label);
  }
}
