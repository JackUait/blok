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
const SIZE_EDITOR_ATTR = 'data-blok-table-fullscreen-size-editor';
const NEAR_ATTR = 'data-blok-table-fullscreen-near';
const CLOSING_ATTR = 'data-blok-table-fullscreen-closing';

/** How far the button sits in from the table's inline-end edge. */
const CORNER_INSET = 6;
/** How close the pointer must come before the button shows. Same reach as the add bars. */
const NEAR_PX = 40;

/** Highest row or column count the size field accepts: each new cell holds a block. */
const MAX_SIZE = 100;

interface TableSize {
  rows: number;
  cols: number;
}

const OPEN_MS = 460;
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
  getSize: () => TableSize;
  /** The smallest size that keeps every filled cell. */
  getMinSize: () => TableSize;
  /** Grows or shrinks the table at its end, as one undo step. */
  setSize: (size: TableSize) => void;
  /** A read-only table shows its size but cannot change it. */
  isReadOnly: () => boolean;
  /** The table changed width: a fluid table's handles and grips were placed for the old one. */
  onRelayout: () => void;
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

/** The grid's box, cut to what the scroll container shows of it. */
const visibleGrid = (scroller: HTMLElement, box: DOMRect): DOMRect => {
  const grid = scroller.firstElementChild;

  if (!(grid instanceof HTMLElement)) {
    return box;
  }
  const g = grid.getBoundingClientRect();
  const left = Math.max(g.left, box.left);
  const right = Math.min(g.right, box.right);

  return new DOMRect(left, g.top, Math.max(right - left, 0), g.height);
};

/**
 * Where the page after the holder starts, in page coordinates: the next block,
 * or the container's end. Page, not viewport: the holder's height changes in between.
 */
const flowEdge = (holder: HTMLElement): number =>
  window.scrollY + (
    holder.nextElementSibling?.getBoundingClientRect().top
    ?? holder.parentElement?.getBoundingClientRect().bottom
    ?? 0
  );

/**
 * Moves the tool root with a transform, which stays on the compositor; left/top
 * relaid the table out every frame. The root, not the scroll container: the
 * grips and add buttons measure the grid against the root, so both must move.
 */
const shift = (to: DOMRect, from: DOMRect): Keyframe => ({
  transform: `translate(${to.left - from.left}px, ${to.top - from.top}px)`,
});

/**
 * Shows the live table in a modal over the page. The table never moves in the
 * DOM, so editing, saving and the block tree work as they do inline.
 * The modal grows out of the table's inline box and shrinks back into it.
 */
export class TableFullscreen {
  public readonly button: HTMLButtonElement;
  /**
   * Sits in the tool root and stays empty until the modal opens. Its size
   * fields would otherwise count as the block's caret inputs.
   */
  public readonly header: HTMLElement;

  /** The header's contents, mounted only while the modal is open. */
  private readonly headerParts: Node[];
  private readonly titleEl: HTMLElement;
  private readonly sizeButton: HTMLButtonElement;
  private readonly sizeEditor: HTMLElement;
  private readonly colsInput: HTMLInputElement;
  private readonly rowsInput: HTMLInputElement;
  /** The size fields' floor while they are open. */
  private minSize: TableSize | null = null;

  private host: HTMLElement | null = null;
  /** The tool root the button sits in, watched for the pointer coming near. */
  private root: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;
  /** The table's inline box at open. The page is scroll-locked, so it holds until close. */
  private origin: DOMRect | null = null;
  /** The table's own visible box at open: the scroll container runs past a narrow grid. */
  private shape: DOMRect | null = null;
  /** The tool root's width on the page. A fluid table takes it back the moment close starts. */
  private inlineWidth = 0;
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
    // The size fields take Enter, Escape and arrows; Blok's block keys must stand down.
    header.setAttribute(DATA_ATTR.keyboardOwner, '');
    header.contentEditable = 'false';
    header.innerHTML = `${IconTable}<span ${TITLE_ATTR}></span><button type="button" ${SIZE_ATTR}></button>`
      + `<span ${SIZE_EDITOR_ATTR} hidden><input data-blok-field="text" inputmode="numeric" autocomplete="off">`
      + '<span aria-hidden="true">×</span><input data-blok-field="text" inputmode="numeric" autocomplete="off"></span>';
    this.header = header;

    const [colsInput, rowsInput] = Array.from(header.querySelectorAll('input'));

    this.titleEl = header.querySelector<HTMLElement>(`[${TITLE_ATTR}]`) ?? document.createElement('span');
    this.sizeButton = header.querySelector<HTMLButtonElement>(`[${SIZE_ATTR}]`) ?? document.createElement('button');
    this.sizeEditor = header.querySelector<HTMLElement>(`[${SIZE_EDITOR_ATTR}]`) ?? document.createElement('span');
    this.headerParts = Array.from(header.childNodes);
    header.replaceChildren();
    this.colsInput = colsInput;
    this.rowsInput = rowsInput;
    this.sizeButton.setAttribute('aria-label', options.t('tools.table.changeSize'));
    colsInput.setAttribute('aria-label', options.t('tools.table.columns'));
    rowsInput.setAttribute('aria-label', options.t('tools.table.rows'));
    this.sizeButton.addEventListener('click', () => this.startSizeEdit());
    this.sizeEditor.addEventListener('input', () => this.flagTooSmall());
    this.sizeEditor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.commitSizeEdit();
      }
    });
    this.sizeEditor.addEventListener('focusout', (event) => {
      if (!(event.relatedTarget instanceof Node && this.sizeEditor.contains(event.relatedTarget))) {
        this.commitSizeEdit();
      }
    });

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

    // One layout for every read before the box moves.
    const source = host.querySelector<HTMLElement>('[data-blok-table-scroll]') ?? host;
    const origin = source.getBoundingClientRect();
    const shape = visibleGrid(source, origin);
    const inlineWidth = source.parentElement?.offsetWidth ?? 0;
    const holder = host.parentElement;
    const flowBefore = holder === null ? 0 : flowEdge(holder);
    const room = holder === null ? 0 : flowBefore - (window.scrollY + holder.getBoundingClientRect().top);
    const title = this.options.getTitle() ?? this.options.t('tools.table.title');

    // Inside the mutation-free header, so filling it is not an edit.
    this.header.replaceChildren(...this.headerParts);
    this.syncTitle(title);
    this.syncSize();
    this.sizeButton.disabled = this.options.isReadOnly();
    this.sizeWatch.observe(source, { childList: true, subtree: true });

    const backdrop = document.createElement('div');

    backdrop.setAttribute(BACKDROP_ATTR, '');
    backdrop.addEventListener('click', () => this.close());
    document.body.appendChild(backdrop);
    // The top layer stacks in show order: the backdrop goes first.
    promoteToTopLayer(backdrop);
    this.backdrop = backdrop;

    // Pinned to the full gap down to the next block, so the page never gets
    // shorter and the scroll position cannot clamp.
    if (holder !== null) {
      holder.style.minHeight = `${room}px`;
    }

    host.setAttribute(FULLSCREEN_ATTR, '');
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.setAttribute('aria-label', title);
    promoteToTopLayer(host);

    // One more layout for every read after it. The pin overshoots by the next
    // block's own margin, which stops collapsing once the holder is empty.
    if (holder !== null) {
      holder.style.minHeight = `${room + flowBefore - flowEdge(holder)}px`;
    }
    this.holder = holder;
    this.options.onRelayout();

    window.addEventListener('keydown', this.onKeydown, true);
    this.host = host;
    this.origin = origin;
    this.shape = shape;
    this.inlineWidth = inlineWidth;
    this.syncButton();
    this.animateOpen(host, backdrop, source, origin, shape);
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
    this.endSizeEdit();
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

  /**
   * Keeps the button in the table's top inline-end corner and shows it only
   * when the pointer comes near. The tool root is wider than a narrow table.
   */
  public watchCorner(root: HTMLElement): void {
    this.root?.removeEventListener('pointermove', this.onRootPointerMove);
    this.root?.removeEventListener('pointerleave', this.onRootPointerLeave);
    root.addEventListener('pointermove', this.onRootPointerMove);
    root.addEventListener('pointerleave', this.onRootPointerLeave);
    this.root = root;
  }

  public destroy(): void {
    this.close();
    this.finishClose();
    this.root?.removeEventListener('pointermove', this.onRootPointerMove);
    this.root?.removeEventListener('pointerleave', this.onRootPointerLeave);
    this.root = null;
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
    this.shape = null;
    closing.host.removeAttribute(CLOSING_ATTR);
    closing.host.style.removeProperty('--blok-table-inline-width');

    closing.animations.forEach(a => a.cancel());
    this.header.replaceChildren();
    removeFromTopLayer(closing.host);
    closing.host.removeAttribute(FULLSCREEN_ATTR);
    this.holder?.style.removeProperty('min-height');
    this.holder = null;

    if (closing.backdrop !== null) {
      removeFromTopLayer(closing.backdrop);
      closing.backdrop.remove();
    }

    this.scroll.unlock();

    if (closing.host.isConnected) {
      this.options.onRelayout();
    }

    if (this.button.isConnected) {
      this.button.focus({ preventScroll: true });
    }
  }

  /**
   * Only clip-path, transform and opacity move, so no frame relays the table out.
   * WAAPI writes no attributes, so none of this reaches the block's mutation observer.
   */
  private animateOpen(host: HTMLElement, backdrop: HTMLElement, source: HTMLElement, origin: DOMRect, shape: DOMRect): void {
    if (!canAnimate(host)) {
      return;
    }
    const landed = source.getBoundingClientRect();
    const timing = { duration: OPEN_MS, easing: SPRING };

    host.animate([{ clipPath: insetOf(host.getBoundingClientRect(), shape) }, { clipPath: SHEET_CLIP }], timing);
    source.parentElement?.animate([shift(origin, landed), { transform: 'none' }], timing);
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * 0.8, easing: 'linear' });
    // The header and button are position: fixed inside the moving root, which
    // holds them while it has a transform. They show once it stops.
    [this.header, this.button].forEach(el => el.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 180, delay: OPEN_MS, easing: 'ease-out', fill: 'backwards' }
    ));
  }

  private animateClose(host: HTMLElement, backdrop: HTMLElement | null): Animation[] {
    const origin = this.origin;
    const shape = this.shape;

    host.getAnimations({ subtree: true }).forEach(a => a.cancel());

    if (origin === null || shape === null || !host.isConnected || !canAnimate(host)) {
      return [];
    }
    // The table takes its page width back now, while it moves: after the
    // motion a fluid table's columns would snap narrower at rest.
    host.style.setProperty('--blok-table-inline-width', `${this.inlineWidth}px`);
    host.setAttribute(CLOSING_ATTR, '');
    this.options.onRelayout();

    const source = host.querySelector<HTMLElement>('[data-blok-table-scroll]');
    const timing = { duration: CLOSE_MS, easing: SPRING, fill: 'forwards' as const };
    const animations = [
      host.animate([{ clipPath: SHEET_CLIP }, { clipPath: insetOf(host.getBoundingClientRect(), shape) }], timing),
    ];

    if (source?.parentElement) {
      animations.push(source.parentElement.animate([{ transform: 'none' }, shift(origin, source.getBoundingClientRect())], timing));
      source.scrollLeft = 0;
    }
    if (backdrop !== null) {
      animations.push(backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { ...timing, easing: 'linear' }));
    }
    // Hidden at once: the moving root would carry them off their place (see animateOpen).
    [this.header, this.button].forEach(el => animations.push(
      el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: CLOSE_MS, fill: 'forwards' })
    ));

    return animations;
  }

  /**
   * Window capture runs before every document handler. Blok's Escape there stops
   * the event before it reaches the holder, and a menu's Escape closes the menu
   * before hasLayerAbove could see it. A menu above the table closes first.
   */
  /** Reads every box first and writes after, so a pointer move forces no extra layout. */
  private readonly onRootPointerMove = (event: PointerEvent): void => {
    const root = this.root;
    const scroller = root?.querySelector<HTMLElement>('[data-blok-table-scroll]');
    const grid = scroller?.firstElementChild;

    if (this.isOpen || root === null || scroller == null || !(grid instanceof HTMLElement)) {
      return;
    }

    const rootBox = root.getBoundingClientRect();
    const scrollerBox = scroller.getBoundingClientRect();
    const gridBox = grid.getBoundingClientRect();
    // Centred on the first row, however tall its text makes it.
    const rowBox = grid.querySelector('[data-blok-table-row]')?.getBoundingClientRect() ?? gridBox;
    const style = getComputedStyle(scroller);
    const rtl = style.direction === 'rtl';
    const size = this.button.offsetWidth;
    // A clipped grid ends where the add-column strip starts.
    const corner = rtl
      ? Math.max(gridBox.left, scrollerBox.left + parseFloat(style.paddingLeft))
      : Math.min(gridBox.right, scrollerBox.right - parseFloat(style.paddingRight));
    const end = rtl ? corner - rootBox.left + CORNER_INSET : rootBox.right - corner + CORNER_INSET;
    const buttonTop = rowBox.top + (rowBox.height - size) / 2;
    const top = buttonTop - rootBox.top;
    const left = rtl ? corner + CORNER_INSET : corner - CORNER_INSET - size;
    const dx = Math.max(left - event.clientX, 0, event.clientX - (left + size));
    const dy = Math.max(buttonTop - event.clientY, 0, event.clientY - (buttonTop + size));

    this.button.style.setProperty('--blok-table-toggle-end', `${end}px`);
    this.button.style.setProperty('--blok-table-toggle-top', `${top}px`);
    this.button.toggleAttribute(NEAR_ATTR, Math.hypot(dx, dy) <= NEAR_PX);
  };

  private readonly onRootPointerLeave = (): void => {
    this.button.removeAttribute(NEAR_ATTR);
  };

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.hasLayerAbove()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();

    if (this.minSize !== null) {
      this.endSizeEdit();
      this.sizeButton.focus();

      return;
    }
    this.close();
  };

  private startSizeEdit(): void {
    if (!this.isOpen || this.options.isReadOnly()) {
      return;
    }
    const { rows, cols } = this.options.getSize();

    this.minSize = this.options.getMinSize();
    this.colsInput.value = String(cols);
    this.rowsInput.value = String(rows);
    this.sizeButton.hidden = true;
    this.sizeEditor.hidden = false;
    this.colsInput.focus();
    this.colsInput.select();
  }

  /** Marks a field whose value would drop filled cells, so the floor shows before Enter. */
  private flagTooSmall(): void {
    const min = this.minSize;

    if (min === null) {
      return;
    }
    const flag = (input: HTMLInputElement, floor: number): void => {
      const value = Number.parseInt(input.value, 10);

      input.setAttribute('aria-invalid', String(Number.isFinite(value) && value < floor));
    };

    flag(this.colsInput, min.cols);
    flag(this.rowsInput, min.rows);
  }

  private commitSizeEdit(): void {
    const min = this.minSize;

    if (min === null) {
      return;
    }
    const current = this.options.getSize();
    const read = (input: HTMLInputElement, fallback: number, floor: number): number => {
      const value = Number.parseInt(input.value, 10);

      return Math.min(MAX_SIZE, Math.max(floor, Number.isFinite(value) ? value : fallback));
    };
    const next = { cols: read(this.colsInput, current.cols, min.cols), rows: read(this.rowsInput, current.rows, min.rows) };

    this.endSizeEdit();

    if (next.cols !== current.cols || next.rows !== current.rows) {
      this.options.setSize(next);
      this.syncSize();
    }
    if (this.isOpen) {
      this.sizeButton.focus();
    }
  }

  private endSizeEdit(): void {
    // No writes when not editing: close may empty the header in the same task,
    // and a record on a detached part reads as a block edit.
    if (this.minSize === null) {
      return;
    }
    this.minSize = null;
    this.sizeEditor.hidden = true;
    this.sizeButton.hidden = false;
    this.colsInput.removeAttribute('aria-invalid');
    this.rowsInput.removeAttribute('aria-invalid');
  }

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
    this.titleEl.textContent = title;
  }

  /** Columns first, like the readout while dragging the add bars. */
  private syncSize(): void {
    const { rows, cols } = this.options.getSize();
    const size = `${cols} × ${rows}`;

    if (this.sizeButton.textContent !== size) {
      this.sizeButton.textContent = size;
    }
  }

  private syncButton(): void {
    const label = this.options.t(this.isOpen ? 'tools.table.closeFullScreen' : 'tools.table.openFullScreen');

    this.button.innerHTML = this.isOpen ? `${IconCross}<kbd>Esc</kbd>` : IconExpandDiagonal;
    this.button.setAttribute('aria-label', label);
    onHover(this.button, label);
  }
}
