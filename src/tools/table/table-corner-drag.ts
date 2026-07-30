import type { I18n } from '../../../types/api';
import { createTooltipContent } from '../../components/modules/toolbar/tooltip';
import { show as showTooltip, hide as hideTooltip } from '../../components/utils/tooltip';

const CORNER_DRAG_ATTR = 'data-blok-table-corner-drag';

export interface TableCornerDragOptions {
  wrapper: HTMLElement;
  gridEl: HTMLElement;
  i18n: I18n;
  onAddRow: () => void;
  onAddColumn: () => void;
  onRemoveLastRow: () => void;
  onRemoveLastColumn: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  getTableSize: () => { rows: number; cols: number };
  canRemoveLastRow: () => boolean;
  canRemoveLastColumn: () => boolean;
  onClickAdd?: () => void;
}

const DRAG_THRESHOLD = 5;

/** How far the 36x36 hit zone straddles the grid corner, in px. */
const CORNER_OFFSET = 16;

/**
 * Upper bound on how many rows/columns a single pointermove may add or remove.
 * Only a runaway guard — a full-screen flick adds a few dozen at most.
 */
const MAX_STEPS_PER_MOVE = 200;

/**
 * How far past the scroll container's right edge the pointer must be to arm the
 * auto-scroll. Kept at 0: while the pointer is still inside the container the
 * corner can be dragged normally, and growing on top of that would move the
 * table without the user asking.
 */
const AUTO_SCROLL_OVERSHOOT = 0;

/**
 * Auto-scroll speed, as table growth per second per pixel the pointer is held
 * past the edge: 10px out grows 80px/s, 100px out grows 800px/s. Speed follows
 * the pointer rather than a fixed cadence, so how fast the table expands stays
 * under the reader's thumb — the same proportional rule drag-autoscroll uses
 * everywhere else.
 *
 * The budget accrues in pixels but is only ever spent in WHOLE rows/columns:
 * asking the geometry walk to grow by a fraction of one still appends a whole
 * one, which is how a px/ms budget once appended one per frame (~3600px/s).
 */
const AUTO_SCROLL_GAIN_PER_SECOND = 8;

/**
 * How close to the viewport's lower edge counts as having run out of screen.
 * Rows are never clipped the way columns are, so the vertical trigger is the
 * pointer running out of room to drag with rather than the corner being hidden.
 */
const AUTO_SCROLL_VIEWPORT_BAND = 24;

/** Which way the page auto-scroll is running, if at all. */
type VerticalAutoScroll = 'none' | 'down' | 'up';

interface DragState {
  startX: number;
  startY: number;
  /**
   * Where the pointer landed inside the handle, as the distance to the grid's
   * corner. Held for the whole gesture so the corner tracks the pointer from
   * wherever it was grabbed instead of jumping under it.
   */
  grabOffsetX: number;
  grabOffsetY: number;
  pointerId: number;
  didDrag: boolean;
  /** Last seen pointer position — the auto-scroll runs without new events. */
  pointerX: number;
  pointerY: number;
  autoScrollFrame: number | null;
  /** Timestamp of the previous auto-scroll frame; 0 before the first one. */
  autoScrollAt: number;
  /** Growth earned from the pointer but not yet spent on a whole row/column. */
  pendingX: number;
  pendingY: number;
  /**
   * Which way the page auto-scroll is running. Sticky on purpose: its own reveal
   * scroll parks the corner exactly on the arming threshold, so re-deriving this
   * every frame let sub-pixel jitter cancel the loop.
   */
  verticalArm: VerticalAutoScroll;
}

export class TableCornerDrag {
  private wrapper: HTMLElement;
  private gridEl: HTMLElement;
  private hitZone: HTMLElement;
  private i18n: I18n;
  private getTableSize: () => { rows: number; cols: number };
  private onAddRow: () => void;
  private onAddColumn: () => void;
  private onRemoveLastRow: () => void;
  private onRemoveLastColumn: () => void;
  private onDragStart: () => void;
  private onDragEnd: () => void;
  private canRemoveLastRow: () => boolean;
  private canRemoveLastColumn: () => boolean;
  private onClickAdd: (() => void) | null;
  private dragState: DragState | null = null;
  private scrollContainer: HTMLElement | null = null;
  private boundScrollHandler: (() => void) | null = null;
  private scrollContainerResizeObserver: ResizeObserver | null = null;
  private readonly boundMouseEnter: () => void;
  private readonly boundMouseLeave: () => void;
  private readonly boundPointerDown: (e: PointerEvent) => void;
  private readonly boundPointerMove: (e: PointerEvent) => void;
  private readonly boundPointerUp: (e: PointerEvent) => void;
  private readonly boundPointerCancel: () => void;

  constructor(options: TableCornerDragOptions) {
    this.wrapper = options.wrapper;
    this.gridEl = options.gridEl;
    this.i18n = options.i18n;
    this.getTableSize = options.getTableSize;
    this.onAddRow = options.onAddRow;
    this.onAddColumn = options.onAddColumn;
    this.onRemoveLastRow = options.onRemoveLastRow;
    this.onRemoveLastColumn = options.onRemoveLastColumn;
    this.onDragStart = options.onDragStart;
    this.onDragEnd = options.onDragEnd;
    this.canRemoveLastRow = options.canRemoveLastRow;
    this.canRemoveLastColumn = options.canRemoveLastColumn;
    this.onClickAdd = options.onClickAdd ?? null;

    this.hitZone = document.createElement('div');
    this.hitZone.setAttribute(CORNER_DRAG_ATTR, '');
    this.hitZone.setAttribute('contenteditable', 'false');
    this.hitZone.style.position = 'absolute';
    this.hitZone.style.width = '36px';
    this.hitZone.style.height = '36px';
    this.hitZone.style.cursor = 'nwse-resize';
    this.hitZone.style.zIndex = '2';
    this.hitZone.style.pointerEvents = 'auto';
    this.hitZone.style.bottom = '-36px';
    this.hitZone.style.right = '-16px';

    this.boundMouseEnter = this.handleMouseEnter.bind(this);
    this.boundMouseLeave = this.handleMouseLeave.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundPointerCancel = this.handlePointerCancel.bind(this);

    this.hitZone.addEventListener('mouseenter', this.boundMouseEnter);
    this.hitZone.addEventListener('mouseleave', this.boundMouseLeave);
    this.hitZone.addEventListener('pointerdown', this.boundPointerDown);

    this.wrapper.appendChild(this.hitZone);
    this.syncPosition();
  }

  /**
   * Pin the hit zone to the grid's bottom-right corner.
   *
   * The old static `bottom: -36px; right: -16px` was measured against the
   * wrapper, which does not grow with the grid inside its scroll container — so
   * adding a column left the handle stranded well inside the table (measured:
   * grid right edge moved 699px -> 816px while the handle stayed put).
   *
   * The right edge is clamped to the scroll container's visible right edge, the
   * same rule TableAddControls.computeVisibleWidth() applies.
   */
  public syncPosition(): void {
    const gridRect = this.gridEl.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();

    // jsdom and pre-layout return all-zero rects; keep the static offsets.
    if (gridRect.width === 0 && gridRect.height === 0) {
      return;
    }

    const visibleRight = this.scrollContainer !== null
      ? Math.min(gridRect.right, this.scrollContainer.getBoundingClientRect().right)
      : gridRect.right;

    this.hitZone.style.bottom = '';
    this.hitZone.style.right = '';
    this.hitZone.style.left = `${visibleRight - wrapperRect.left - CORNER_OFFSET}px`;
    this.hitZone.style.top = `${gridRect.bottom - wrapperRect.top - CORNER_OFFSET}px`;
  }

  public attachScrollContainer(sc: HTMLElement): void {
    if (this.scrollContainer && this.boundScrollHandler) {
      this.scrollContainer.removeEventListener('scroll', this.boundScrollHandler);
    }

    this.scrollContainerResizeObserver?.disconnect();

    this.scrollContainer = sc;
    this.boundScrollHandler = (): void => { this.syncPosition(); };
    sc.addEventListener('scroll', this.boundScrollHandler, { passive: true });

    this.scrollContainerResizeObserver = new ResizeObserver(() => {
      this.syncPosition();
    });
    this.scrollContainerResizeObserver.observe(sc);
  }

  private updateTooltip(): void {
    const size = this.getTableSize();

    showTooltip(this.hitZone, `${size.cols}\u00D7${size.rows}`, { placement: 'bottom' });
  }

  /**
   * Hovering teaches the gesture; only once a drag is under way does the size
   * readout take over. The corner carries no painted mark, so a bare "3x2"
   * would name the table's size without ever saying what the handle does.
   */
  private handleMouseEnter(): void {
    showTooltip(
      this.hitZone,
      createTooltipContent([this.i18n.t('tools.table.dragToAddRemoveRowsColumns')]),
      { placement: 'bottom' }
    );
  }

  private handleMouseLeave(): void {
    if (this.dragState !== null) {
      return;
    }
    hideTooltip();
  }

  /**
   * Height of the bottom row, measured live. Rows are not uniform — one with
   * wrapped text is several times taller than an empty one — so a frozen step
   * would detach the grid's edge from the pointer after the first removal.
   */
  private measureLastRowHeight(): number {
    const rows = this.gridEl.querySelectorAll('[data-blok-table-row]');
    const lastRow = rows[rows.length - 1] as HTMLElement | undefined;

    return lastRow?.getBoundingClientRect().height ?? 0;
  }

  /**
   * Width of the rightmost column, measured live: columns carry whatever width
   * the user resized them to.
   *
   * Taken as the innermost cell that ends at the grid's right edge, so a cell
   * merged across the last two columns does not report the pair as one column
   * whenever some other row still splits them.
   */
  private measureLastColumnWidth(gridRight: number): number {
    const cells = Array.from(this.gridEl.querySelectorAll<HTMLElement>('[data-blok-table-cell]'));
    const left = cells.reduce((innermost, cell) => {
      const rect = cell.getBoundingClientRect();

      return Math.abs(rect.right - gridRight) <= 1 && rect.left > innermost ? rect.left : innermost;
    }, -Infinity);

    return left === -Infinity ? 0 : gridRight - left;
  }

  private handlePointerDown(e: PointerEvent): void {
    const gridRect = this.gridEl.getBoundingClientRect();

    this.dragState = {
      startX: e.clientX,
      startY: e.clientY,
      grabOffsetX: gridRect.right - e.clientX,
      grabOffsetY: gridRect.bottom - e.clientY,
      pointerId: e.pointerId,
      didDrag: false,
      pointerX: e.clientX,
      pointerY: e.clientY,
      autoScrollFrame: null,
      autoScrollAt: 0,
      pendingX: 0,
      pendingY: 0,
      verticalArm: 'none',
    };

    this.updateTooltip();

    this.hitZone.setPointerCapture(e.pointerId);
    this.hitZone.addEventListener('pointermove', this.boundPointerMove);
    this.hitZone.addEventListener('pointerup', this.boundPointerUp);
    // Pointer capture makes the browser fire pointercancel INSTEAD of pointerup
    // when it takes the gesture over, so without this the drag state (and the
    // body cursor/user-select overrides) would never be released.
    this.hitZone.addEventListener('pointercancel', this.boundPointerCancel);
  }

  /**
   * The gesture was taken away (touch pan, device disruption). Rows/columns
   * added during the drag are already committed one by one, so this only tears
   * the drag down — and, unlike pointerup, it must NOT fall into the
   * "tap = add a row and a column" branch: the user never released the pointer.
   */
  private handlePointerCancel(): void {
    if (this.dragState === null) {
      return;
    }

    const { didDrag, pointerId } = this.dragState;

    this.stopAutoScroll();
    this.dragState = null;
    hideTooltip();
    this.hitZone.releasePointerCapture(pointerId);
    this.hitZone.removeEventListener('pointermove', this.boundPointerMove);
    this.hitZone.removeEventListener('pointerup', this.boundPointerUp);
    this.hitZone.removeEventListener('pointercancel', this.boundPointerCancel);

    if (didDrag) {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this.onDragEnd();
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.dragState === null) {
      return;
    }

    const dx = e.clientX - this.dragState.startX;
    const dy = e.clientY - this.dragState.startY;

    if (!this.dragState.didDrag) {
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < DRAG_THRESHOLD) {
        return;
      }

      this.dragState.didDrag = true;
      document.body.style.cursor = 'nwse-resize';
      document.body.style.userSelect = 'none';
      this.onDragStart();
    }

    this.dragState.pointerX = e.clientX;
    this.dragState.pointerY = e.clientY;
    this.updateVerticalArming();

    /*
     * Once the auto-scroll is armed it owns horizontal growth, so the pointer
     * must stop driving it: each frame re-anchors the grab offset to the corner
     * the scroll just parked at the container edge, which would otherwise make
     * every further pixel of travel worth a whole column (measured: a 180px drag
     * grew the table 1751px). Targeting the current edge leaves columns alone —
     * neither the grow nor the shrink branch fires.
     */
    const rect = this.gridEl.getBoundingClientRect();
    const targetRight = this.shouldAutoScrollRight()
      ? rect.right
      : e.clientX + this.dragState.grabOffsetX;
    const targetBottom = this.verticalAutoScroll() === 'none'
      ? e.clientY + this.dragState.grabOffsetY
      : rect.bottom;

    this.resizeToCorner(targetRight, targetBottom);

    this.updateTooltip();
    // Rows/columns just committed changed the grid's extent; follow it.
    this.syncPosition();
    this.updateAutoScroll();
  }

  /**
   * Notion keeps extending a table that has run out of visible room: drag the
   * corner past the scroll container's right edge and it scrolls to keep the
   * corner in view, appending columns for as long as the pointer is held there.
   *
   * Two conditions, both required. The pointer must be outside the container —
   * inside it the geometry walk reaches the corner unaided, and scrolling then
   * would move the table without being asked. And the grid must actually
   * overflow, or there is nothing to scroll into view.
   */
  private updateAutoScroll(): void {
    if (this.dragState === null) {
      return;
    }

    // Re-check after the walk: growing the table may have brought the corner down.
    this.updateVerticalArming();

    if (!this.shouldAutoScroll()) {
      this.stopAutoScroll();

      return;
    }

    if (this.dragState.autoScrollFrame !== null) {
      return;
    }

    this.dragState.autoScrollAt = 0;
    this.dragState.autoScrollFrame = requestAnimationFrame(timestamp => { this.autoScrollTick(timestamp); });
  }

  private shouldAutoScroll(): boolean {
    return this.shouldAutoScrollRight() || this.verticalAutoScroll() !== 'none';
  }

  private shouldAutoScrollRight(): boolean {
    const sc = this.scrollContainer;

    if (sc === null || this.dragState === null || !this.dragState.didDrag) {
      return false;
    }

    if (sc.scrollWidth <= sc.clientWidth + 1) {
      return false;
    }

    return this.dragState.pointerX > sc.getBoundingClientRect().right + AUTO_SCROLL_OVERSHOOT;
  }

  private shouldAutoScrollDown(): boolean {
    return this.verticalAutoScroll() === 'down';
  }

  /** How far past each trigger edge the pointer is being held, in px. */
  private overshootRight(): number {
    const sc = this.scrollContainer;

    if (sc === null || this.dragState === null) {
      return 0;
    }

    return Math.max(0, this.dragState.pointerX - sc.getBoundingClientRect().right);
  }

  private overshootDown(): number {
    if (this.dragState === null) {
      return 0;
    }

    return Math.max(0, this.dragState.pointerY - (window.innerHeight - AUTO_SCROLL_VIEWPORT_BAND));
  }

  private overshootUp(): number {
    if (this.dragState === null) {
      return 0;
    }

    return Math.max(0, AUTO_SCROLL_VIEWPORT_BAND - this.dragState.pointerY);
  }

  private shouldAutoScrollUp(): boolean {
    return this.verticalAutoScroll() === 'up';
  }

  /** One metered step for the vertical axis: down appends a row, up drops one. */
  private meteredBottom(edge: DOMRect, down: boolean, up: boolean): number {
    if (down) {
      return edge.bottom + 1;
    }

    if (up) {
      return edge.bottom - this.measureLastRowHeight() - 1;
    }

    return edge.bottom;
  }

  private verticalAutoScroll(): VerticalAutoScroll {
    if (this.dragState === null || !this.dragState.didDrag) {
      return 'none';
    }

    return this.dragState.verticalArm;
  }

  /**
   * Vertically the table is bounded by the page, not by its own scroller (which
   * hides overflow-y), so this arms on the viewport and scrolls the window. Both
   * ends matter: the bottom band grows the table when the pointer runs out of
   * screen, the top band keeps shrinking it in the mirrored case.
   *
   * Arming needs the pointer AND the corner inside the band — a corner still
   * mid-screen can be dragged to the pointer normally, and metering on top of
   * that would resize the table without being asked. Staying armed needs only the
   * pointer, because the reveal scroll parks the corner right on the threshold:
   * measured in Chrome, a corner at 695.98 against a 696 limit cancelled the
   * loop after two rows.
   */
  private updateVerticalArming(): void {
    const state = this.dragState;

    if (state === null || !state.didDrag) {
      return;
    }

    const lower = window.innerHeight - AUTO_SCROLL_VIEWPORT_BAND;
    const bottom = this.gridEl.getBoundingClientRect().bottom;

    if (state.pointerY >= lower) {
      if (state.verticalArm !== 'down') {
        state.verticalArm = bottom >= lower ? 'down' : 'none';
      }

      return;
    }

    if (state.pointerY <= AUTO_SCROLL_VIEWPORT_BAND) {
      if (state.verticalArm !== 'up') {
        state.verticalArm = bottom <= AUTO_SCROLL_VIEWPORT_BAND ? 'up' : 'none';
      }

      return;
    }

    state.verticalArm = 'none';
  }

  private stopAutoScroll(): void {
    const state = this.dragState;

    if (state === null) {
      return;
    }

    if (state.autoScrollFrame !== null) {
      cancelAnimationFrame(state.autoScrollFrame);
      state.autoScrollFrame = null;
    }

    state.autoScrollAt = 0;
    state.pendingX = 0;
    state.pendingY = 0;
    state.verticalArm = 'none';
  }

  private autoScrollTick(timestamp: number): void {
    const state = this.dragState;

    if (state === null) {
      return;
    }

    state.autoScrollFrame = null;

    const right = this.shouldAutoScrollRight();
    const down = this.shouldAutoScrollDown();
    const up = this.shouldAutoScrollUp();

    if (!right && !down && !up) {
      return;
    }

    /*
     * The first frame only starts the clock — holding briefly (a drag that ends
     * just past the edge) must not append anything. Everything after is measured
     * off the frame timestamp, so the rate does not follow the refresh rate.
     */
    const elapsed = state.autoScrollAt === 0 ? 0 : (timestamp - state.autoScrollAt) / 1000;

    state.autoScrollAt = timestamp;

    if (right) {
      state.pendingX += this.overshootRight() * AUTO_SCROLL_GAIN_PER_SECOND * elapsed;

      const rect = this.gridEl.getBoundingClientRect();
      const step = this.measureLastColumnWidth(rect.right);

      if (step > 0 && state.pendingX >= step) {
        state.pendingX -= step;
        // Any target past the edge appends exactly one column, then settles.
        this.resizeToCorner(rect.right + 1, rect.bottom);
      }
    }

    if (down || up) {
      const overshoot = down ? this.overshootDown() : this.overshootUp();

      state.pendingY += overshoot * AUTO_SCROLL_GAIN_PER_SECOND * elapsed;

      const step = this.measureLastRowHeight();

      if (step > 0 && state.pendingY >= step) {
        state.pendingY -= step;

        const edge = this.gridEl.getBoundingClientRect();

        this.resizeToCorner(edge.right, this.meteredBottom(edge, down, up));
      }
    }

    // Scrolling stays per-frame even between columns, so the reveal is smooth.
    if (right && this.scrollContainer !== null) {
      this.scrollContainer.scrollLeft = this.scrollContainer.scrollWidth;
    }

    if (down) {
      const overshoot = this.gridEl.getBoundingClientRect().bottom - (window.innerHeight - AUTO_SCROLL_VIEWPORT_BAND);

      if (overshoot > 0) {
        window.scrollBy(0, overshoot);
      }
    }

    if (up) {
      // Negative: the corner has risen above the band, so bring the page back up.
      const rise = this.gridEl.getBoundingClientRect().bottom - AUTO_SCROLL_VIEWPORT_BAND;

      if (rise < 0) {
        window.scrollBy(0, rise);
      }
    }

    /*
     * Re-anchor to the corner's new on-screen position. Without this the pointer
     * would owe back every pixel the auto-scroll travelled before it could
     * shrink anything — dragging away from the edge would do nothing.
     */
    const parked = this.gridEl.getBoundingClientRect();

    if (right) {
      state.grabOffsetX = parked.right - state.pointerX;
    }

    if (down || up) {
      state.grabOffsetY = parked.bottom - state.pointerY;
    }

    this.syncPosition();
    this.updateTooltip();

    state.autoScrollFrame = requestAnimationFrame(next => { this.autoScrollTick(next); });
  }

  /**
   * Grow or shrink the grid until its bottom-right corner meets the dragged
   * point — Notion's model. Every decision is made against the grid's live
   * geometry rather than a step frozen at pointerdown, which is what keeps the
   * corner glued to the pointer across columns and rows of unequal size.
   *
   * Adding stops as soon as the edge reaches the pointer, and removing only
   * fires once the pointer has cleared the whole last column/row, so the two
   * directions can never fight over the same pixel.
   */
  private resizeToCorner(targetRight: number, targetBottom: number): void {
    const cursor = { rect: this.gridEl.getBoundingClientRect(),
      steps: 0 };

    // jsdom and pre-layout report an empty box; there is nothing to measure.
    if (cursor.rect.width === 0 && cursor.rect.height === 0) {
      return;
    }

    while (targetRight > cursor.rect.right && cursor.steps++ < MAX_STEPS_PER_MOVE) {
      this.onAddColumn();

      const grown = this.nextRect(cursor.rect, (next, prev) => next.right > prev.right);

      if (grown === null) {
        break;
      }
      cursor.rect = grown;
    }

    // Measuring the last column costs a pass over every cell; only pay for it
    // while the corner is actually being dragged back into the grid.
    while (targetRight < cursor.rect.right && cursor.steps++ < MAX_STEPS_PER_MOVE && this.canRemoveLastColumn()) {
      const width = this.measureLastColumnWidth(cursor.rect.right);

      if (width <= 0 || targetRight > cursor.rect.right - width) {
        break;
      }
      this.onRemoveLastColumn();

      const shrunk = this.nextRect(cursor.rect, (next, prev) => next.right < prev.right);

      if (shrunk === null) {
        break;
      }
      cursor.rect = shrunk;
    }

    while (targetBottom > cursor.rect.bottom && cursor.steps++ < MAX_STEPS_PER_MOVE) {
      this.onAddRow();

      const grown = this.nextRect(cursor.rect, (next, prev) => next.bottom > prev.bottom);

      if (grown === null) {
        break;
      }
      cursor.rect = grown;
    }

    while (targetBottom < cursor.rect.bottom && cursor.steps++ < MAX_STEPS_PER_MOVE && this.canRemoveLastRow()) {
      const height = this.measureLastRowHeight();

      if (height <= 0 || targetBottom > cursor.rect.bottom - height) {
        break;
      }
      this.onRemoveLastRow();

      const shrunk = this.nextRect(cursor.rect, (next, prev) => next.bottom < prev.bottom);

      if (shrunk === null) {
        break;
      }
      cursor.rect = shrunk;
    }
  }

  /**
   * The grid's geometry after a row/column was committed, or null when the edge
   * did not move the way the caller expected — a grid that cannot follow (a
   * width-constrained layout, a rejected operation) would otherwise spin its
   * loop until the step budget ran out.
   */
  private nextRect(
    previous: DOMRect,
    moved: (next: DOMRect, previous: DOMRect) => boolean
  ): DOMRect | null {
    const next = this.gridEl.getBoundingClientRect();

    return moved(next, previous) ? next : null;
  }

  private handlePointerUp(_e: PointerEvent): void {
    if (this.dragState === null) {
      return;
    }

    const { didDrag, pointerId } = this.dragState;

    this.stopAutoScroll();
    this.dragState = null;
    hideTooltip();
    this.hitZone.releasePointerCapture(pointerId);
    this.hitZone.removeEventListener('pointermove', this.boundPointerMove);
    this.hitZone.removeEventListener('pointerup', this.boundPointerUp);
    // handlePointerDown binds pointercancel on every drag; without this a stale
    // listener accumulates per completed drag.
    this.hitZone.removeEventListener('pointercancel', this.boundPointerCancel);

    if (!didDrag) {
      if (this.onClickAdd) {
        this.onClickAdd();
      } else {
        this.onAddRow();
        this.onAddColumn();
      }
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this.onDragEnd();
    }
  }

  public setDisplay(visible: boolean): void {
    this.hitZone.style.display = visible ? '' : 'none';
  }

  public setInteractive(interactive: boolean): void {
    this.hitZone.style.pointerEvents = interactive ? 'auto' : 'none';
  }

  public destroy(): void {
    if (this.scrollContainer && this.boundScrollHandler) {
      this.scrollContainer.removeEventListener('scroll', this.boundScrollHandler);
      this.scrollContainer = null;
      this.boundScrollHandler = null;
    }

    this.scrollContainerResizeObserver?.disconnect();
    this.scrollContainerResizeObserver = null;

    this.hitZone.removeEventListener('mouseenter', this.boundMouseEnter);
    this.hitZone.removeEventListener('mouseleave', this.boundMouseLeave);
    this.hitZone.removeEventListener('pointerdown', this.boundPointerDown);
    this.hitZone.removeEventListener('pointermove', this.boundPointerMove);
    this.hitZone.removeEventListener('pointerup', this.boundPointerUp);
    this.hitZone.removeEventListener('pointercancel', this.boundPointerCancel);
    if (this.dragState?.didDrag) {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    this.stopAutoScroll();
    this.dragState = null;
    hideTooltip();
    this.hitZone.remove();
  }
}
