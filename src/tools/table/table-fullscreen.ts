import { IconCross, IconExpandDiagonal, IconHash, IconMinus, IconPlus, IconTable } from '../../components/icons';
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
const SIZE_WRAP_ATTR = 'data-blok-table-fullscreen-size-wrap';
const SIZE_LABEL_ATTR = 'data-blok-table-fullscreen-size-label';
const SIZE_NOTE_ATTR = 'data-blok-table-fullscreen-size-note';
const SIZE_DONE_ATTR = 'data-blok-table-fullscreen-size-done';
const SIZE_MODE_ATTR = 'data-blok-table-fullscreen-size-mode';
const SIZE_GRID_ATTR = 'data-blok-table-fullscreen-size-grid';
const SIZE_CELL_ATTR = 'data-blok-table-fullscreen-size-cell';
const SIZE_READOUT_ATTR = 'data-blok-table-fullscreen-size-readout';
const SIZE_NUMBERS_ATTR = 'data-blok-table-fullscreen-size-numbers';
const STEP_ATTR = 'data-blok-table-fullscreen-step';
/** Holding a stepper: first repeat after this long, then one step per REPEAT_MS. */
const HOLD_MS = 380;
const REPEAT_MS = 70;

/**
 * One row of the size card. The − and + are pointer helpers only: the field is
 * a spinbutton that steps with the arrow keys, so Tab skips them.
 */
const stepperRow = (axis: 'cols' | 'rows'): string =>
  `<span ${SIZE_LABEL_ATTR}="${axis}"></span><span data-blok-table-fullscreen-stepper>`
  + `<button type="button" ${STEP_ATTR}="-1" data-axis="${axis}" tabindex="-1" aria-hidden="true">${IconMinus}</button>`
  + '<input role="spinbutton" inputmode="numeric" autocomplete="off">'
  + `<button type="button" ${STEP_ATTR}="1" data-axis="${axis}" tabindex="-1" aria-hidden="true">${IconPlus}</button></span>`;
const NEAR_ATTR = 'data-blok-table-fullscreen-near';

/* The grid picks up to 10 × 10; a bigger table takes the numbers. tables.css sizes it to fill the card. */
const GRID_SIZE = 10;

/** The size card opens in the mode last chosen. Per viewer, so any storage failure reads as numbers. */
export const SIZE_MODE_STORAGE_KEY = 'blok:table:size-mode';

const readGridPreferred = (): boolean => {
  try {
    return localStorage.getItem(SIZE_MODE_STORAGE_KEY) === 'grid';
  } catch {
    return false;
  }
};

const writeGridPreferred = (grid: boolean): void => {
  try {
    localStorage.setItem(SIZE_MODE_STORAGE_KEY, grid ? 'grid' : 'numbers');
  } catch {
    /* storage blocked: the card keeps opening on numbers */
  }
};

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

/** Arrow keys on the grid: across moves columns, down adds rows. */
const GRID_KEYS: Record<string, { axis: 'cols' | 'rows'; by: number } | undefined> = {
  ArrowRight: { axis: 'cols', by: 1 },
  ArrowLeft: { axis: 'cols', by: -1 },
  ArrowDown: { axis: 'rows', by: 1 },
  ArrowUp: { axis: 'rows', by: -1 },
};

const OPEN_MS = 460;
/** The sheet fades out, then the table fades in on the page: two beats, no copy of the table. */
const FADE_OUT_MS = 180;
const FADE_IN_MS = 220;
const SPRING = 'cubic-bezier(.16, 1, .3, 1)';
const SOFT = 'cubic-bezier(.22, .8, .2, 1)';
/** Set on the header and close button while the sheet has a transform. See tables.css. */
const LEAVING_ATTR = 'data-blok-table-fullscreen-leaving';
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
/** Where the scroller puts its grid: its box less its padding, whatever its scroll. */
const contentBox = (el: HTMLElement): DOMRect => {
  const r = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const left = parseFloat(style.paddingLeft);

  return new DOMRect(r.left + left, r.top, r.width - left - parseFloat(style.paddingRight), r.height);
};

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
  private readonly steppers: HTMLButtonElement[];
  /** Wraps both stepper rows, hidden while the grid shows. */
  private readonly numbers: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly modeButton: HTMLButtonElement;
  private readonly sizeNote: HTMLElement;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  /** The note shows once a value is brought down to the filled cells, not merely sitting there. */
  private hitFloor = false;
  /** The size fields' floor while they are open. */
  private minSize: TableSize | null = null;

  private host: HTMLElement | null = null;
  /** The tool root the button sits in, watched for the pointer coming near. */
  private root: HTMLElement | null = null;
  private backdrop: HTMLElement | null = null;
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
    // The card's fields are steppers, not text boxes, so they skip the data-blok-field look.
    header.innerHTML = `${IconTable}<span ${TITLE_ATTR}></span>`
      + `<span ${SIZE_WRAP_ATTR}><button type="button" ${SIZE_ATTR} aria-expanded="false"></button>`
      + `<span ${SIZE_EDITOR_ATTR} role="group" hidden><span ${SIZE_NUMBERS_ATTR}>${stepperRow('cols')}${stepperRow('rows')}</span>`
      + `<span ${SIZE_READOUT_ATTR} aria-live="polite" hidden></span><span ${SIZE_GRID_ATTR} data-blok-testid="table-size-grid" tabindex="0" hidden></span>`
      + `<span ${SIZE_NOTE_ATTR} hidden></span><button type="button" ${SIZE_MODE_ATTR}></button>`
      + `<button type="button" ${SIZE_DONE_ATTR}></button></span></span>`;
    this.header = header;

    const [colsInput, rowsInput] = Array.from(header.querySelectorAll('input'));
    const label = (axis: string): HTMLElement =>
      header.querySelector<HTMLElement>(`[${SIZE_LABEL_ATTR}="${axis}"]`) ?? document.createElement('span');
    const done = header.querySelector<HTMLElement>(`[${SIZE_DONE_ATTR}]`) ?? document.createElement('button');

    this.steppers = Array.from(header.querySelectorAll<HTMLButtonElement>(`[${STEP_ATTR}]`));
    this.sizeNote = header.querySelector<HTMLElement>(`[${SIZE_NOTE_ATTR}]`) ?? document.createElement('span');
    label('cols').textContent = options.t('tools.table.columns');
    label('rows').textContent = options.t('tools.table.rows');
    this.sizeNote.textContent = options.t('tools.table.sizeKeepsContent');
    done.textContent = options.t('tools.equation.done');
    done.addEventListener('click', () => this.commitSizeEdit());

    this.numbers = header.querySelector<HTMLElement>(`[${SIZE_NUMBERS_ATTR}]`) ?? document.createElement('span');
    this.grid = header.querySelector<HTMLElement>(`[${SIZE_GRID_ATTR}]`) ?? document.createElement('span');
    this.readout = header.querySelector<HTMLElement>(`[${SIZE_READOUT_ATTR}]`) ?? document.createElement('span');
    this.modeButton = header.querySelector<HTMLButtonElement>(`[${SIZE_MODE_ATTR}]`) ?? document.createElement('button');
    this.grid.setAttribute('aria-label', options.t('tools.table.changeSize'));
    this.grid.replaceChildren(...Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => {
      const cell = document.createElement('span');

      cell.setAttribute(SIZE_CELL_ATTR, '');
      cell.setAttribute('data-col', String((i % GRID_SIZE) + 1));
      cell.setAttribute('data-row', String(Math.floor(i / GRID_SIZE) + 1));

      return cell;
    }));
    // Keeps focus in the card while the mode swaps, so focusout does not apply the size.
    this.modeButton.addEventListener('pointerdown', event => event.preventDefault());
    this.modeButton.addEventListener('click', () => {
      const grid = this.grid.hidden !== false;

      writeGridPreferred(grid);
      this.setGridMode(grid);
    });
    this.grid.addEventListener('pointermove', (event) => {
      const pick = this.cellAt(event.target);

      if (pick !== null) {
        this.previewGrid(pick);
      }
    });
    this.grid.addEventListener('pointerleave', () => this.previewGrid(null));
    this.grid.addEventListener('click', (event) => {
      const pick = this.cellAt(event.target);

      if (pick !== null) {
        this.writeFields(pick);
        this.commitSizeEdit();
      }
    });

    this.titleEl = header.querySelector<HTMLElement>(`[${TITLE_ATTR}]`) ?? document.createElement('span');
    this.sizeButton = header.querySelector<HTMLButtonElement>(`[${SIZE_ATTR}]`) ?? document.createElement('button');
    this.sizeEditor = header.querySelector<HTMLElement>(`[${SIZE_EDITOR_ATTR}]`) ?? document.createElement('span');
    this.headerParts = Array.from(header.childNodes);
    header.replaceChildren();
    this.colsInput = colsInput;
    this.rowsInput = rowsInput;
    this.sizeButton.setAttribute('aria-label', options.t('tools.table.changeSize'));
    this.sizeEditor.setAttribute('aria-label', options.t('tools.table.changeSize'));
    colsInput.setAttribute('aria-label', options.t('tools.table.columns'));
    rowsInput.setAttribute('aria-label', options.t('tools.table.rows'));
    // Keeps focus in the card, so clicking the size again applies instead of reopening.
    this.sizeButton.addEventListener('pointerdown', (event) => {
      if (this.minSize !== null) {
        event.preventDefault();
      }
    });
    this.sizeButton.addEventListener('click', () => {
      if (this.minSize === null) {
        this.startSizeEdit();
      } else {
        this.commitSizeEdit();
      }
    });
    this.sizeEditor.addEventListener('pointerdown', (event) => {
      const step = event.target instanceof Element ? event.target.closest<HTMLButtonElement>(`[${STEP_ATTR}]`) : null;

      if (step !== null) {
        // The field keeps focus while a stepper is held.
        event.preventDefault();
        this.holdStep(step);
      }
    });
    ['pointerup', 'pointercancel', 'pointerout'].forEach(type => this.sizeEditor.addEventListener(type, () => this.stopHold()));
    this.sizeEditor.addEventListener('input', (event) => {
      const field = event.target;

      if (field instanceof HTMLInputElement) {
        Object.assign(field, { value: field.value.replace(/\D+/g, '').slice(0, 3) });
        this.syncSteppers();
      }
    });
    // A typed value below the filled cells rises to them as the field is left.
    this.sizeEditor.addEventListener('change', (event) => {
      if (event.target instanceof HTMLInputElement) {
        this.stepSize(event.target, 0);
      }
    });
    this.sizeEditor.addEventListener('keydown', (event) => {
      const gridStep = event.target === this.grid ? GRID_KEYS[event.key] : undefined;

      if (gridStep !== undefined) {
        // Cells run from the inline start, so in RTL the left arrow adds a column.
        const flip = gridStep.axis === 'cols' && getComputedStyle(this.grid).direction === 'rtl' ? -1 : 1;

        event.preventDefault();
        this.stepSize(gridStep.axis === 'cols' ? this.colsInput : this.rowsInput, gridStep.by * flip, GRID_SIZE);
        this.previewGrid(null);
      }
      if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.target instanceof HTMLInputElement) {
        event.preventDefault();
        this.stepSize(event.target, (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1));
        event.target.select();
      }
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
    // The scroller's content box: full screen pads the scroller, so the motion lines up this, not its box.
    const anchor = contentBox(source);
    // The table's own visible box: the scroll container runs past a narrow grid.
    const shape = visibleGrid(source, source.getBoundingClientRect());
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
    this.syncButton();
    this.animateOpen(host, backdrop, source, anchor, shape);
  }

  /**
   * The dialog is gone at once for keyboard and screen reader users. The sheet
   * fades out in the top layer, then the table lands on the page and fades in.
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
    host.getAnimations({ subtree: true }).forEach(a => a.cancel());

    const closing = { host, backdrop, animations: [] as Animation[] };

    this.closing = closing;

    if (!host.isConnected || !canAnimate(host)) {
      this.finishClose();

      return;
    }

    const out = this.animateOut(host);

    closing.animations.push(out);

    if (backdrop !== null) {
      closing.animations.push(backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: FADE_OUT_MS + FADE_IN_MS, easing: 'ease-out', fill: 'forwards',
      }));
    }

    void out.finished.then(() => {
      if (this.closing !== closing) {
        return;
      }
      // A cancelled animation's `finished` rejects, so it leaves the list first.
      closing.animations.splice(closing.animations.indexOf(out), 1);
      out.cancel();
      this.land(host);
      closing.animations.push(host.animate(
        [{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }],
        { duration: FADE_IN_MS, easing: SOFT, fill: 'backwards' }
      ));

      return Promise.all(closing.animations.map(a => a.finished));
    }).then(() => this.finishClose(), () => undefined);
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
    closing.animations.forEach(a => a.cancel());
    this.land(closing.host);

    if (closing.backdrop !== null) {
      removeFromTopLayer(closing.backdrop);
      closing.backdrop.remove();
    }

    if (this.button.isConnected) {
      this.button.focus({ preventScroll: true });
    }
  }

  /**
   * Puts the table back on the page, once: the full-screen attribute says it is
   * still up. The backdrop stays until the fade-in ends.
   */
  private land(host: HTMLElement): void {
    if (!host.hasAttribute(FULLSCREEN_ATTR)) {
      return;
    }
    this.header.replaceChildren();
    [this.header, this.button].forEach((el) => {
      el.removeAttribute(LEAVING_ATTR);
      el.style.removeProperty('--_blok-table-leave-top');
    });
    removeFromTopLayer(host);
    host.removeAttribute(FULLSCREEN_ATTR);
    // Lands at its start, as it was before it opened.
    const scroller = host.querySelector<HTMLElement>('[data-blok-table-scroll]');

    if (scroller !== null) {
      scroller.scrollLeft = 0;
    }
    this.holder?.style.removeProperty('min-height');
    this.holder = null;
    this.scroll.unlock();
    // The button swaps to its page icon only now: the fading sheet still shows it.
    this.syncButton();

    if (host.isConnected) {
      this.options.onRelayout();
    }
  }

  /**
   * Only clip-path, transform and opacity move, so no frame relays the table out.
   * WAAPI writes no attributes, so none of this reaches the block's mutation observer.
   */
  private animateOpen(host: HTMLElement, backdrop: HTMLElement, source: HTMLElement, anchor: DOMRect, shape: DOMRect): void {
    if (!canAnimate(host)) {
      return;
    }
    const landed = contentBox(source);
    const timing = { duration: OPEN_MS, easing: SPRING };

    host.animate([{ clipPath: insetOf(host.getBoundingClientRect(), shape) }, { clipPath: SHEET_CLIP }], timing);
    source.parentElement?.animate([shift(anchor, landed), { transform: 'none' }], timing);
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS * 0.8, easing: 'linear' });
    // The header and button are position: fixed inside the moving root, which
    // holds them while it has a transform. They show once it stops.
    [this.header, this.button].forEach(el => el.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 180, delay: OPEN_MS, easing: 'ease-out', fill: 'backwards' }
    ));
  }

  /**
   * The sheet fades out with a slight shrink, the live table still inside it.
   * A transform makes the sheet the box its fixed header and close button sit
   * in, and the sheet scrolls, so they are pinned to its top for the motion.
   */
  private animateOut(host: HTMLElement): Animation {
    // On these two, not the sheet: a custom property on the sheet restyles every cell.
    [this.header, this.button].forEach((el) => {
      el.style.setProperty('--_blok-table-leave-top', `${host.scrollTop}px`);
      el.setAttribute(LEAVING_ATTR, '');
    });

    return host.animate(
      [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.97)' }],
      { duration: FADE_OUT_MS, easing: 'ease-out', fill: 'forwards' }
    );
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
    this.hitFloor = false;
    this.colsInput.value = String(cols);
    this.rowsInput.value = String(rows);
    this.syncSteppers();
    this.showNumbers();
    this.sizeEditor.hidden = false;
    this.sizeButton.setAttribute('aria-expanded', 'true');
    this.setGridMode(readGridPreferred());
  }

  /** The fields stay the model in both modes; the grid only reads and writes them. */
  private setGridMode(on: boolean): void {
    if (!on) {
      // Focus moves before the grid hides: hiding the focused grid blurs to nothing, and focusout applies the size.
      this.numbers.hidden = false;
      this.colsInput.focus();
      this.colsInput.select();
      this.showNumbers();

      return;
    }
    this.grid.hidden = false;
    this.readout.hidden = false;
    this.renderGrid(null);
    // Focus moves before the fields hide, or focusout would apply the size.
    this.grid.focus();
    this.numbers.hidden = true;
    this.modeButton.innerHTML = `${IconHash}${this.options.t('tools.table.typeNumbers')}`;
  }

  private showNumbers(): void {
    this.numbers.hidden = false;
    this.grid.hidden = true;
    this.readout.hidden = true;
    this.modeButton.innerHTML = `${IconTable}${this.options.t('tools.table.pickOnGrid')}`;
  }

  private readFields(): TableSize {
    const min = this.minSize ?? { cols: 1, rows: 1 };
    const read = (input: HTMLInputElement, floor: number): number => {
      const value = Number.parseInt(input.value, 10);

      return Math.min(MAX_SIZE, Math.max(floor, Number.isFinite(value) ? value : floor));
    };

    return { cols: read(this.colsInput, min.cols), rows: read(this.rowsInput, min.rows) };
  }

  private writeFields(pick: TableSize): void {
    this.colsInput.value = String(pick.cols);
    this.rowsInput.value = String(pick.rows);
    this.stepSize(this.colsInput, 0);
    this.stepSize(this.rowsInput, 0);
  }

  private cellAt(target: EventTarget | null): TableSize | null {
    const cell = target instanceof Element ? target.closest<HTMLElement>(`[${SIZE_CELL_ATTR}]`) : null;

    return cell === null ? null : { cols: Number(cell.dataset.col), rows: Number(cell.dataset.row) };
  }

  /** Shows `pick`, raised to the filled cells, or the fields' size when there is none. */
  private previewGrid(pick: TableSize | null): void {
    const min = this.minSize;

    if (min === null || this.grid.hidden) {
      return;
    }
    if (pick !== null && (pick.cols < min.cols || pick.rows < min.rows)) {
      this.hitFloor = true;
    }
    this.renderGrid(pick === null ? null : { cols: Math.max(min.cols, pick.cols), rows: Math.max(min.rows, pick.rows) });
    this.syncSteppers();
  }

  /** Marks the cells, never replaces them: a new cell under the pointer would drop its hover. */
  private renderGrid(preview: TableSize | null): void {
    const size = preview ?? this.readFields();

    this.grid.querySelectorAll<HTMLElement>(`[${SIZE_CELL_ATTR}]`).forEach((cell) => {
      cell.toggleAttribute('data-on', Number(cell.dataset.col) <= size.cols && Number(cell.dataset.row) <= size.rows);
    });
    this.readout.textContent = `${size.cols} × ${size.rows}`;
  }

  /** Moves a field by `by`, clamped to the filled cells and `cap`. */
  private stepSize(input: HTMLInputElement, by: number, cap = MAX_SIZE): void {
    const min = this.minSize;

    if (min === null) {
      return;
    }
    const floor = input === this.colsInput ? min.cols : min.rows;
    const value = Number.parseInt(input.value, 10);
    const next = Math.min(Math.max(cap, floor), Math.max(floor, (Number.isFinite(value) ? value : floor) + by));

    if (next === floor && (by < 0 || value < floor)) {
      this.hitFloor = true;
    }
    Object.assign(input, { value: String(next) });
    this.syncSteppers();
  }

  private holdStep(step: HTMLButtonElement): void {
    const input = step.dataset.axis === 'rows' ? this.rowsInput : this.colsInput;
    const by = Number(step.getAttribute(STEP_ATTR));
    const repeat = (): void => {
      this.stepSize(input, by);

      if (step.disabled) {
        this.stopHold();
      }
    };

    this.stopHold();
    repeat();
    this.holdTimer = setTimeout(() => {
      this.holdTimer = setInterval(repeat, REPEAT_MS);
    }, HOLD_MS);
  }

  private stopHold(): void {
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      clearInterval(this.holdTimer);
      this.holdTimer = null;
    }
  }

  /** Disables − at the filled cells and + at the cap, and says why at the floor. */
  private syncSteppers(): void {
    const min = this.minSize;

    if (min === null) {
      return;
    }
    const fields = [
      { input: this.colsInput, floor: min.cols, axis: 'cols' },
      { input: this.rowsInput, floor: min.rows, axis: 'rows' },
    ];
    const atFloor = fields.map(({ input, floor, axis }) => {
      const value = Number.parseInt(input.value, 10);

      input.setAttribute('aria-valuemin', String(floor));
      input.setAttribute('aria-valuemax', String(MAX_SIZE));
      input.setAttribute('aria-valuenow', Number.isFinite(value) ? String(value) : '');
      this.steppers.forEach((step) => {
        if (step.dataset.axis === axis) {
          Object.assign(step, { disabled: step.getAttribute(STEP_ATTR) === '-1' ? !(value > floor) : !(value < MAX_SIZE) });
        }
      });

      return Number.isFinite(value) && value <= floor;
    });

    this.sizeNote.hidden = !(this.hitFloor && atFloor.some(Boolean));
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
    this.stopHold();
    this.minSize = null;
    this.showNumbers();
    this.sizeEditor.hidden = true;
    this.sizeButton.setAttribute('aria-expanded', 'false');
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
