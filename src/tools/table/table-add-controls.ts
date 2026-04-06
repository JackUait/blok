import type { I18n } from '../../../types/api';
import { IconPlus } from '../../components/icons';
import { createTooltipContent } from '../../components/modules/toolbar/tooltip';
import { hide as hideTooltip, onHover, show as showTooltip } from '../../components/utils/tooltip';
import { twMerge } from '../../components/utils/tw';

const ADD_ROW_ATTR = 'data-blok-table-add-row';
const ADD_COL_ATTR = 'data-blok-table-add-col';
const HIDE_DELAY_MS = 150;
const DRAG_THRESHOLD = 5;

/**
 * How close (px) the cursor must be to a grid edge for
 * the corresponding add button to appear.
 */
const PROXIMITY_PX = 40;

const HIT_AREA_CLASSES = [
  'flex',
  'items-center',
  'justify-center',
  'transition-opacity',
  'duration-150',
];

const VISUAL_CLASSES = [
  'flex',
  'items-center',
  'justify-center',
  'border',
  'border-gray-300',
  'rounded-sm',
  'group-hover/add:bg-gray-50',
];

const ICON_SIZE = '12';

interface DragState {
  axis: 'row' | 'col';
  startPos: number;
  unitSize: number;
  addedCount: number;
  pointerId: number;
  didDrag: boolean;
}

interface TableAddControlsOptions {
  wrapper: HTMLElement;
  grid: HTMLElement;
  i18n: I18n;
  onAddRow: () => void;
  onAddColumn: () => void;
  onDragStart: () => void;
  onDragAddRow: () => void;
  onDragRemoveRow: () => void;
  onDragAddCol: () => void;
  onDragRemoveCol: () => void;
  onDragEnd: () => void;
  getTableSize: () => { rows: number; cols: number };
  /** Returns the pixel width of a newly added column, used as the drag unit size. */
  getNewColumnWidth?: () => number;
}

/**
 * Manages hover-to-reveal "+" buttons for adding rows and columns to the table.
 * Buttons only appear when the cursor is near the relevant edge of the grid.
 * Supports both click (add one) and drag (add multiple) interactions.
 */
export class TableAddControls {
  private wrapper: HTMLElement;
  private grid: HTMLElement;
  private i18n: I18n;
  private addRowBtn: HTMLElement;
  private addColBtn: HTMLElement;
  private rowHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private colHideTimeout: ReturnType<typeof setTimeout> | null = null;
  private rowVisible = false;
  private colVisible = false;
  private interactive = true;
  private dragState: DragState | null = null;

  private boundMouseMove: (e: MouseEvent) => void;
  private boundDocumentMouseMove: (e: MouseEvent) => void;
  private boundMouseLeave: () => void;
  private boundAddRowClick: () => void;
  private boundAddColClick: () => void;
  private onDragStart: () => void;
  private onDragAddRow: () => void;
  private onDragRemoveRow: () => void;
  private onDragAddCol: () => void;
  private onDragRemoveCol: () => void;
  private onDragEnd: () => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundPointerCancel: (e: PointerEvent) => void;
  private boundRowPointerDown: (e: PointerEvent) => void;
  private boundColPointerDown: (e: PointerEvent) => void;
  private getTableSize: () => { rows: number; cols: number };
  private getNewColumnWidth: (() => number) | undefined;
  private scrollContainer: HTMLElement | null = null;
  private boundScrollHandler: (() => void) | null = null;
  private scrollContainerResizeObserver: ResizeObserver | null = null;

  constructor(options: TableAddControlsOptions) {
    this.wrapper = options.wrapper;
    this.grid = options.grid;
    this.i18n = options.i18n;

    this.boundAddRowClick = options.onAddRow;
    this.boundAddColClick = options.onAddColumn;
    this.onDragStart = options.onDragStart;
    this.onDragAddRow = options.onDragAddRow;
    this.onDragRemoveRow = options.onDragRemoveRow;
    this.onDragAddCol = options.onDragAddCol;
    this.onDragRemoveCol = options.onDragRemoveCol;
    this.onDragEnd = options.onDragEnd;
    this.getTableSize = options.getTableSize;
    this.getNewColumnWidth = options.getNewColumnWidth;
    this.boundMouseMove = this.handleMouseMove.bind(this);
    this.boundDocumentMouseMove = this.handleDocumentMouseMove.bind(this);
    this.boundMouseLeave = this.handleMouseLeave.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundPointerCancel = this.handlePointerCancel.bind(this);
    this.boundRowPointerDown = (e: PointerEvent): void => this.handlePointerDown('row', e);
    this.boundColPointerDown = (e: PointerEvent): void => this.handlePointerDown('col', e);

    this.addRowBtn = this.createAddRowButton();
    this.addColBtn = this.createAddColumnButton();

    this.wrapper.appendChild(this.addRowBtn);
    this.wrapper.appendChild(this.addColBtn);
    this.syncRowButtonWidth();

    this.wrapper.addEventListener('mousemove', this.boundMouseMove);
    this.wrapper.addEventListener('mouseleave', this.boundMouseLeave);
    document.addEventListener('mousemove', this.boundDocumentMouseMove);

    this.addRowBtn.addEventListener('pointerdown', this.boundRowPointerDown);
    this.addColBtn.addEventListener('pointerdown', this.boundColPointerDown);
  }

  /**
   * Compute the visible pixel width for the add-row button when the grid has
   * explicit pixel widths set. Accounts for scroll-container clipping.
   */
  private computeVisibleWidth(numericWidth: number, isInsideScrollContainer: boolean, scrollContainer: HTMLElement | null): number {
    if (!isInsideScrollContainer || scrollContainer === null) {
      return numericWidth;
    }

    const wrapperRect = this.wrapper.getBoundingClientRect();

    if (wrapperRect.width > 0) {
      const gridRect = this.grid.getBoundingClientRect();
      const scrollRect = scrollContainer.getBoundingClientRect();

      return Math.min(gridRect.right, scrollRect.right) - wrapperRect.left;
    }

    if (scrollContainer.clientWidth > 0) {
      return Math.min(numericWidth, scrollContainer.clientWidth);
    }

    return numericWidth;
  }

  /**
   * Match the add-row button width and horizontal position to the grid.
   *
   * Pixel mode (colWidths set): clamp to the scroll container's visible
   * width so the button never overflows the table boundary.
   *
   * Percent mode (no colWidths): clear `width` and use `left`/`right`
   * constraints so the browser auto-sizes the button to the wrapper's
   * content area, avoiding the wrapper's right padding.
   */
  public syncRowButtonWidth(): void {
    const gridWidth = this.grid.style.width;

    if (gridWidth && gridWidth.endsWith('px')) {
      const numericWidth = parseFloat(gridWidth);
      const scrollContainer = this.grid.parentElement;
      const isInsideScrollContainer = scrollContainer !== null && scrollContainer !== this.wrapper;

      /**
       * Use getBoundingClientRect() to get the true rendered visible width —
       * this accounts for absolutely-positioned children (resize handles) that
       * inflate scrollWidth beyond the grid's logical width, and for the current
       * scroll position. Fall back to clientWidth in pre-layout / jsdom where
       * getBoundingClientRect returns all-zero rects.
       */
      const visibleWidth = this.computeVisibleWidth(numericWidth, isInsideScrollContainer, scrollContainer);

      this.addRowBtn.style.width = `${visibleWidth}px`;
      this.addRowBtn.style.right = '';
      this.addRowBtn.style.left = '0px';
      this.addRowBtn.style.transform = '';

      this.addColBtn.style.left = `${visibleWidth + 4}px`;
      this.addColBtn.style.right = '';
    } else {
      this.addRowBtn.style.width = '';
      this.addRowBtn.style.left = '0px';
      this.addRowBtn.style.transform = '';

      const paddingRight = parseFloat(getComputedStyle(this.wrapper).paddingRight) || 0;

      this.addRowBtn.style.right = `${paddingRight}px`;

      this.addColBtn.style.left = '';
      this.addColBtn.style.right = `${paddingRight - 36}px`;
    }

    // Pin both buttons' positions to the grid's rendered rect to prevent
    // scrollbar-induced wrapper height inflation from shifting them.
    //
    // On systems with traditional (non-overlay) scrollbars a horizontal scrollbar
    // consumes layout height in the scroll container; the wrapper inherits that extra
    // height. Without explicit pinning:
    //   - add-col button: `bottom: 0` stretches it taller than the grid
    //   - add-row button: `bottom: -36px` shifts it further below the grid
    const gridRect = this.grid.getBoundingClientRect();
    const wrapperRect = this.wrapper.getBoundingClientRect();
    const gridHeight = gridRect.height;

    if (gridHeight > 0) {
      // add-col: fix height to grid height
      this.addColBtn.style.height = `${gridHeight}px`;
      this.addColBtn.style.bottom = '';

      // add-row: fix top to grid bottom (relative to wrapper top) + 4px gap
      const gridBottomRelativeToWrapper = gridRect.bottom - wrapperRect.top;

      this.addRowBtn.style.top = `${gridBottomRelativeToWrapper + 4}px`;
      this.addRowBtn.style.bottom = '';
    } else {
      // Pre-layout fallback (e.g. JSDOM where getBoundingClientRect returns zeros)
      this.addColBtn.style.height = '';
      this.addColBtn.style.bottom = '0px';

      this.addRowBtn.style.top = '';
      this.addRowBtn.style.bottom = '-36px';
    }
  }

  /**
   * Toggle display of both add buttons.
   * Used to hide controls during row/column drag operations.
   */
  public setDisplay(visible: boolean): void {
    const display = visible ? '' : 'none';

    this.addRowBtn.style.display = display;
    this.addColBtn.style.display = display;
  }

  /**
   * Toggle interactivity of both add buttons without removing them from the DOM.
   * Disables pointer events and hover effects during cell selection.
   */
  public setInteractive(interactive: boolean): void {
    this.interactive = interactive;

    if (!interactive) {
      this.addRowBtn.style.pointerEvents = 'none';
      this.addColBtn.style.pointerEvents = 'none';

      return;
    }

    this.addRowBtn.style.pointerEvents = this.rowVisible ? '' : 'none';
    this.addColBtn.style.pointerEvents = this.colVisible ? '' : 'none';
  }

  /**
   * Attach a passive scroll listener to the scroll container so button
   * positions are kept in sync when the user scrolls the table horizontally.
   */
  public attachScrollContainer(sc: HTMLElement): void {
    if (this.scrollContainer && this.boundScrollHandler) {
      this.scrollContainer.removeEventListener('scroll', this.boundScrollHandler);
    }

    this.scrollContainerResizeObserver?.disconnect();

    this.scrollContainer = sc;
    this.boundScrollHandler = (): void => { this.syncRowButtonWidth(); };
    sc.addEventListener('scroll', this.boundScrollHandler, { passive: true });

    this.scrollContainerResizeObserver = new ResizeObserver(() => {
      this.syncRowButtonWidth();
    });
    this.scrollContainerResizeObserver.observe(sc);
  }

  public destroy(): void {
    if (this.scrollContainer && this.boundScrollHandler) {
      this.scrollContainer.removeEventListener('scroll', this.boundScrollHandler);
      this.scrollContainer = null;
      this.boundScrollHandler = null;
    }

    this.scrollContainerResizeObserver?.disconnect();
    this.scrollContainerResizeObserver = null;

    this.wrapper.removeEventListener('mousemove', this.boundMouseMove);
    this.wrapper.removeEventListener('mouseleave', this.boundMouseLeave);
    document.removeEventListener('mousemove', this.boundDocumentMouseMove);
    this.addRowBtn.removeEventListener('pointerdown', this.boundRowPointerDown);
    this.addColBtn.removeEventListener('pointerdown', this.boundColPointerDown);

    if (this.dragState) {
      const target = this.dragState.axis === 'row' ? this.addRowBtn : this.addColBtn;

      target.removeEventListener('pointermove', this.boundPointerMove);
      target.removeEventListener('pointerup', this.boundPointerUp);
      target.removeEventListener('pointercancel', this.boundPointerCancel);
      document.body.style.cursor = '';
      this.dragState = null;
    }

    this.clearRowTimeout();
    this.clearColTimeout();

    this.addRowBtn.remove();
    this.addColBtn.remove();
  }

  private showDimensionTooltip(): void {
    if (!this.dragState) {
      return;
    }

    const size = this.getTableSize();
    const target = this.dragState.axis === 'row' ? this.addRowBtn : this.addColBtn;
    const opts = this.dragState.axis === 'row'
      ? { placement: 'bottom' as const, marginTop: -16 }
      : { placement: 'bottom' as const };

    showTooltip(target, `${size.cols}\u00D7${size.rows}`, opts);
  }

  private handlePointerDown(axis: 'row' | 'col', e: PointerEvent): void {
    e.preventDefault();

    const target = axis === 'row' ? this.addRowBtn : this.addColBtn;

    target.setPointerCapture(e.pointerId);

    const unitSize = this.measureUnitSize(axis);

    this.dragState = {
      axis,
      startPos: axis === 'row' ? e.clientY : e.clientX,
      unitSize,
      addedCount: 0,
      pointerId: e.pointerId,
      didDrag: false,
    };

    target.addEventListener('pointermove', this.boundPointerMove);
    target.addEventListener('pointerup', this.boundPointerUp);
    target.addEventListener('pointercancel', this.boundPointerCancel);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.dragState) {
      return;
    }

    const { axis, startPos, unitSize } = this.dragState;
    const currentPos = axis === 'row' ? e.clientY : e.clientX;
    const delta = currentPos - startPos;
    const targetCount = Math.floor(delta / unitSize);

    while (this.dragState.addedCount < targetCount) {
      if (axis === 'row') {
        this.onDragAddRow();
      } else {
        this.onDragAddCol();
      }

      this.dragState.addedCount++;
    }

    while (this.dragState.addedCount > targetCount) {
      if (axis === 'row') {
        this.onDragRemoveRow();
      } else {
        this.onDragRemoveCol();
      }

      this.dragState.addedCount--;
    }

    if (Math.abs(delta) > DRAG_THRESHOLD && !this.dragState.didDrag) {
      this.dragState.didDrag = true;
      document.body.style.cursor = axis === 'row' ? 'row-resize' : 'col-resize';
      this.showDimensionTooltip();
      this.onDragStart();
    }

    if (this.dragState.didDrag) {
      this.showDimensionTooltip();
    }
  }

  private handlePointerUp(_e: PointerEvent): void {
    if (!this.dragState) {
      return;
    }

    const { axis, pointerId, didDrag } = this.dragState;

    const target = axis === 'row' ? this.addRowBtn : this.addColBtn;

    target.releasePointerCapture(pointerId);
    target.removeEventListener('pointermove', this.boundPointerMove);
    target.removeEventListener('pointerup', this.boundPointerUp);
    target.removeEventListener('pointercancel', this.boundPointerCancel);

    document.body.style.cursor = '';
    hideTooltip();
    this.dragState = null;

    if (!didDrag) {
      const clickHandler = axis === 'row' ? this.boundAddRowClick : this.boundAddColClick;

      clickHandler();

      return;
    }

    this.onDragEnd();
  }

  /**
   * Handle pointercancel — browser aborted the pointer (touch gesture, system dialog, etc.).
   * Cleans up drag state without triggering click or commit actions.
   */
  private handlePointerCancel(_e: PointerEvent): void {
    if (!this.dragState) {
      return;
    }

    const { axis, didDrag } = this.dragState;

    const target = axis === 'row' ? this.addRowBtn : this.addColBtn;

    target.removeEventListener('pointermove', this.boundPointerMove);
    target.removeEventListener('pointerup', this.boundPointerUp);
    target.removeEventListener('pointercancel', this.boundPointerCancel);

    document.body.style.cursor = '';
    hideTooltip();
    this.dragState = null;

    if (didDrag) {
      this.onDragEnd();
    }
  }

  private measureUnitSize(axis: 'row' | 'col'): number {
    if (axis === 'row') {
      const rows = this.grid.querySelectorAll('[data-blok-table-row]');
      const lastRow = rows[rows.length - 1] as HTMLElement | undefined;

      return lastRow?.offsetHeight || 30;
    }

    if (this.getNewColumnWidth) {
      return this.getNewColumnWidth() || 100;
    }

    const firstRow = this.grid.querySelector('[data-blok-table-row]');

    if (!firstRow) {
      return 100;
    }

    const cells = firstRow.querySelectorAll('[data-blok-table-cell]');
    const lastCell = cells[cells.length - 1] as HTMLElement | undefined;

    return lastCell?.offsetWidth || 100;
  }

  private handleMouseMove(e: MouseEvent): void {
    const gridRect = this.grid.getBoundingClientRect();
    const scrollContainer = this.grid.parentElement;
    const isInsideScrollContainer = scrollContainer !== null && scrollContainer !== this.wrapper;
    const visibleRight = isInsideScrollContainer
      ? Math.min(gridRect.right, scrollContainer.getBoundingClientRect().right)
      : gridRect.right;

    const distFromBottom = Math.abs(e.clientY - gridRect.bottom);
    const distFromRight = Math.abs(e.clientX - visibleRight);

    if (distFromBottom <= PROXIMITY_PX) {
      this.showRow();
    } else {
      this.scheduleHideRow();
    }

    if (distFromRight <= PROXIMITY_PX) {
      this.showCol();
    } else {
      this.scheduleHideCol();
    }
  }

  private handleMouseLeave(): void {
    this.scheduleHideRow();
    this.scheduleHideCol();
  }

  /**
   * Document-level mousemove handler.
   * Catches mouse movements outside the wrapper (e.g. in the ::after
   * pseudo-element zone below the grid, which has pointer-events-none).
   * Delegates to handleMouseMove when the cursor is within the proximity
   * zone around the grid; schedules hiding when the cursor is far away.
   */
  private handleDocumentMouseMove(e: MouseEvent): void {
    if (this.wrapper.contains(e.target as Node)) {
      return;
    }

    const gridRect = this.grid.getBoundingClientRect();
    const margin = PROXIMITY_PX;
    const nearGrid =
      e.clientX >= gridRect.left - margin &&
      e.clientX <= gridRect.right + margin &&
      e.clientY >= gridRect.top - margin &&
      e.clientY <= gridRect.bottom + margin;

    if (nearGrid) {
      this.handleMouseMove(e);
    } else {
      this.scheduleHideRow();
      this.scheduleHideCol();
    }
  }

  private showRow(): void {
    this.clearRowTimeout();

    if (!this.rowVisible) {
      this.addRowBtn.style.opacity = '1';
      this.addRowBtn.style.pointerEvents = this.interactive ? '' : 'none';
      this.rowVisible = true;
    }
  }

  private showCol(): void {
    this.clearColTimeout();

    if (!this.colVisible) {
      this.addColBtn.style.opacity = '1';
      this.addColBtn.style.pointerEvents = this.interactive ? '' : 'none';
      this.colVisible = true;
    }
  }

  private scheduleHideRow(): void {
    if (!this.rowVisible || this.rowHideTimeout !== null || this.dragState?.axis === 'row') {
      return;
    }

    this.rowHideTimeout = setTimeout(() => {
      this.addRowBtn.style.opacity = '0';
      this.addRowBtn.style.pointerEvents = 'none';
      this.rowVisible = false;
      this.rowHideTimeout = null;
    }, HIDE_DELAY_MS);
  }

  private scheduleHideCol(): void {
    if (!this.colVisible || this.colHideTimeout !== null || this.dragState?.axis === 'col') {
      return;
    }

    this.colHideTimeout = setTimeout(() => {
      this.addColBtn.style.opacity = '0';
      this.addColBtn.style.pointerEvents = 'none';
      this.colVisible = false;
      this.colHideTimeout = null;
    }, HIDE_DELAY_MS);
  }

  private clearRowTimeout(): void {
    if (this.rowHideTimeout !== null) {
      clearTimeout(this.rowHideTimeout);
      this.rowHideTimeout = null;
    }
  }

  private clearColTimeout(): void {
    if (this.colHideTimeout !== null) {
      clearTimeout(this.colHideTimeout);
      this.colHideTimeout = null;
    }
  }

  private createAddRowButton(): HTMLElement {
    const btn = document.createElement('div');

    btn.className = twMerge(HIT_AREA_CLASSES, 'group/add', 'items-start', 'cursor-row-resize');
    btn.setAttribute(ADD_ROW_ATTR, '');
    btn.setAttribute('contenteditable', 'false');
    btn.style.opacity = '0';
    btn.style.pointerEvents = 'none';
    btn.style.position = 'absolute';
    btn.style.left = '0';
    btn.style.bottom = '-36px';
    btn.style.zIndex = '1';
    btn.style.height = '32px';

    const visual = document.createElement('div');

    visual.className = twMerge(VISUAL_CLASSES);
    visual.style.width = '100%';
    visual.style.height = '16px';

    this.appendIcon(visual);
    btn.appendChild(visual);

    onHover(btn, createTooltipContent([
      this.i18n.t('tools.table.clickToAddRow'),
      this.i18n.t('tools.table.dragToAddRemoveRows'),
    ]), { placement: 'bottom', marginTop: -16 });

    return btn;
  }

  private createAddColumnButton(): HTMLElement {
    const btn = document.createElement('div');

    btn.className = twMerge(HIT_AREA_CLASSES, 'group/add', 'justify-start', 'cursor-col-resize');
    btn.setAttribute(ADD_COL_ATTR, '');
    btn.setAttribute('contenteditable', 'false');
    btn.style.opacity = '0';
    btn.style.pointerEvents = 'none';
    btn.style.position = 'absolute';
    btn.style.right = '-36px';
    btn.style.top = '0px';
    btn.style.bottom = '0px';
    btn.style.width = '32px';

    const visual = document.createElement('div');

    visual.className = twMerge(VISUAL_CLASSES);
    visual.style.width = '16px';
    visual.style.height = '100%';

    this.appendIcon(visual);
    btn.appendChild(visual);

    onHover(btn, createTooltipContent([
      this.i18n.t('tools.table.clickToAddColumn'),
      this.i18n.t('tools.table.dragToAddRemoveColumns'),
    ]), { placement: 'bottom' });

    return btn;
  }

  private appendIcon(parent: HTMLElement): void {
    parent.insertAdjacentHTML('beforeend', IconPlus);

    const svg = parent.querySelector('svg');

    if (svg) {
      svg.setAttribute('width', ICON_SIZE);
      svg.setAttribute('height', ICON_SIZE);
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.classList.add('text-gray-500', 'pointer-events-none');
    }
  }
}
