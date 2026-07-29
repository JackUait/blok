import { show as showTooltip, hide as hideTooltip } from '../../components/utils/tooltip';
import { twMerge } from '../../components/utils/tw';

const CORNER_DRAG_ATTR = 'data-blok-table-corner-drag';

export interface TableCornerDragOptions {
  wrapper: HTMLElement;
  gridEl: HTMLElement;
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

/** How close to the scroll container's right edge arms the auto-scroll, in px. */
const AUTO_SCROLL_BAND = 24;

/** How fast a table parked at that edge keeps growing, in px per millisecond. */
const AUTO_SCROLL_SPEED = 0.25;

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
  /** Width the auto-scroll has asked for but no column has covered yet, in px. */
  pendingGrowth: number;
}

export class TableCornerDrag {
  private wrapper: HTMLElement;
  private gridEl: HTMLElement;
  private hitZone: HTMLElement;
  private grip: HTMLElement;
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

    /*
     * The affordance itself. Idle-hidden and revealed on proximity, using the
     * same opacity transition and gray tone as the row/column grips
     * (see table-grip-visuals.ts) so the table reads as one visual family.
     */
    this.grip = document.createElement('div');
    this.grip.setAttribute('data-blok-testid', 'table-corner-grip');
    this.grip.setAttribute('contenteditable', 'false');
    this.grip.className = twMerge(
      'absolute',
      'rounded-sm',
      'border-b-2',
      'border-r-2',
      'border-gray-400',
      'opacity-0',
      'transition-opacity',
      'duration-150'
    );
    Object.assign(this.grip.style, {
      width: '8px',
      height: '8px',
      left: '12px',
      top: '12px',
      // The hit zone owns the gesture; the mark must never intercept it.
      pointerEvents: 'none',
    });

    this.hitZone.appendChild(this.grip);

    this.wrapper.appendChild(this.hitZone);
    this.syncPosition();
  }

  /**
   * Reveal or hide the grip. Driven by pointer proximity to the table so the
   * affordance is discoverable without becoming permanent chrome.
   */
  public setProximity(near: boolean): void {
    this.grip.classList.toggle('opacity-0', !near);
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

  private handleMouseEnter(): void {
    this.updateTooltip();
    this.setProximity(true);
    this.grip.classList.add('border-gray-600');
  }

  private handleMouseLeave(): void {
    if (this.dragState !== null) {
      return;
    }
    hideTooltip();
    this.setProximity(false);
    this.grip.classList.remove('border-gray-600');
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
      pendingGrowth: 0,
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

    this.resizeToCorner(
      e.clientX + this.dragState.grabOffsetX,
      e.clientY + this.dragState.grabOffsetY
    );

    this.updateTooltip();
    // Rows/columns just committed changed the grid's extent; follow it.
    this.syncPosition();
    this.updateAutoScroll();
  }

  /**
   * Notion keeps extending a table that has run out of visible room: hold the
   * corner against the scroll container's right edge and it scrolls, appending
   * columns as it goes.
   *
   * Armed only once the grid actually overflows the container. While it still
   * fits, the geometry walk above can reach the pointer on its own, and growing
   * on top of that would run away from it.
   */
  private updateAutoScroll(): void {
    if (this.dragState === null) {
      return;
    }

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
    const sc = this.scrollContainer;

    if (sc === null || this.dragState === null || !this.dragState.didDrag) {
      return false;
    }

    if (sc.scrollWidth <= sc.clientWidth + 1) {
      return false;
    }

    return this.dragState.pointerX >= sc.getBoundingClientRect().right - AUTO_SCROLL_BAND;
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
    state.pendingGrowth = 0;
  }

  private autoScrollTick(timestamp: number): void {
    const state = this.dragState;
    const sc = this.scrollContainer;

    if (state === null || sc === null) {
      return;
    }

    state.autoScrollFrame = null;

    if (!this.shouldAutoScroll()) {
      return;
    }

    // The first frame only establishes the clock, so the rate is independent of
    // the display's refresh interval.
    const elapsed = state.autoScrollAt === 0 ? 0 : timestamp - state.autoScrollAt;

    state.autoScrollAt = timestamp;
    state.pendingGrowth += elapsed * AUTO_SCROLL_SPEED;

    const before = this.gridEl.getBoundingClientRect();

    this.resizeToCorner(before.right + state.pendingGrowth, state.pointerY + state.grabOffsetY);

    // Only width that materialised pays the debt down: a fraction of a column
    // carries over to the next frame instead of appending one per frame.
    const grown = this.gridEl.getBoundingClientRect().right - before.right;

    state.pendingGrowth = Math.max(0, state.pendingGrowth - grown);

    sc.scrollLeft = sc.scrollWidth;

    /*
     * Re-anchor to the corner's new on-screen position. Without this the pointer
     * would owe back every pixel the auto-scroll travelled before it could
     * shrink anything — dragging away from the edge would do nothing.
     */
    state.grabOffsetX = this.gridEl.getBoundingClientRect().right - state.pointerX;

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
