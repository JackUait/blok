import type { I18n } from '../../../types/api';
import { twMerge } from '../../components/utils/tw';

import { BORDER_WIDTH, CELL_ATTR, ROW_ATTR } from './table-core';
import { collapseGrip, createGripDotsSvg, expandGrip, GRIP_HOVER_SIZE } from './table-grip-visuals';
import { getCumulativeColEdges, TableRowColDrag } from './table-row-col-drag';
import { createGripPopover } from './table-row-col-popover';
import type { PopoverState } from './table-row-col-popover';

const GRIP_ATTR = 'data-blok-table-grip';
const GRIP_COL_ATTR = 'data-blok-table-grip-col';
const GRIP_ROW_ATTR = 'data-blok-table-grip-row';
const HIDE_DELAY_MS = 150;
const COL_PILL_WIDTH = 24;
const COL_PILL_HEIGHT = 4;
const ROW_PILL_WIDTH = 4;
const ROW_PILL_HEIGHT = 20;

/**
 * Actions that can be performed on rows/columns
 */
export type RowColAction =
  | { type: 'insert-row-above'; index: number }
  | { type: 'insert-row-below'; index: number }
  | { type: 'insert-col-left'; index: number }
  | { type: 'insert-col-right'; index: number }
  | { type: 'move-row'; fromIndex: number; toIndex: number }
  | { type: 'move-col'; fromIndex: number; toIndex: number }
  | { type: 'delete-row'; index: number }
  | { type: 'delete-col'; index: number }
  | { type: 'toggle-heading' }
  | { type: 'toggle-heading-column' };

export interface TableRowColControlsOptions {
  grid: HTMLElement;
  overlay?: HTMLElement;
  scrollContainer?: HTMLElement;
  getColumnCount: () => number;
  getRowCount: () => number;
  isHeadingRow: () => boolean;
  isHeadingColumn: () => boolean;
  onAction: (action: RowColAction) => void;
  onDragStateChange?: (isDragging: boolean, dragType: 'row' | 'col' | null) => void;
  onGripClick?: (type: 'row' | 'col', index: number) => void;
  onGripPopoverClose?: () => void;
  i18n: I18n;
}

const GRIP_CAPSULE_CLASSES = [
  'absolute',
  'z-3',
  'rounded-sm',
  'cursor-grab',
  'select-none',
  'transition-[opacity,background-color,width,height]',
  'duration-150',
  'group',
  'flex',
  'items-center',
  'justify-center',
  'overflow-hidden',
];

const GRIP_IDLE_CLASSES = [
  'bg-gray-300',
  'opacity-0',
  'pointer-events-none',
];

const GRIP_VISIBLE_CLASSES = [
  'bg-gray-300',
  'opacity-100',
  'pointer-events-auto',
];

const GRIP_ACTIVE_CLASSES = [
  'bg-blue-500',
  'text-white',
  'opacity-100',
  'pointer-events-auto',
];

/**
 * Manages row and column grip handles with popover menus and drag-to-reorder.
 */
export class TableRowColControls {
  private grid: HTMLElement;
  private overlay: HTMLElement | undefined;
  private scrollContainer: HTMLElement | undefined;
  private getColumnCount: () => number;
  private getRowCount: () => number;
  private isHeadingRow: () => boolean;
  private isHeadingColumn: () => boolean;
  private onAction: (action: RowColAction) => void;
  private onGripClick: ((type: 'row' | 'col', index: number) => void) | undefined;
  private onGripPopoverClose: (() => void) | undefined;
  private i18n: I18n;

  private colGrips: HTMLElement[] = [];
  private rowGrips: HTMLElement[] = [];
  private popoverState: PopoverState = { popover: null, grip: null };
  private lockedGrip: HTMLElement | null = null;
  private boundUnlockGrip: (e: PointerEvent) => void;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private activeColGripIndex = -1;
  private activeRowGripIndex = -1;
  private isInsideTable = false;
  private rowResizeObserver: ResizeObserver | null = null;

  private drag: TableRowColDrag;

  private boundMouseOver: (e: MouseEvent) => void;
  private boundMouseLeave: (e: MouseEvent) => void;
  private boundPointerDown: (e: PointerEvent) => void;
  private boundScrollHandler: (() => void) | null = null;

  constructor(options: TableRowColControlsOptions) {
    this.grid = options.grid;
    this.overlay = options.overlay;
    this.scrollContainer = options.scrollContainer;
    this.getColumnCount = options.getColumnCount;
    this.getRowCount = options.getRowCount;
    this.isHeadingRow = options.isHeadingRow;
    this.isHeadingColumn = options.isHeadingColumn;
    this.onAction = options.onAction;
    this.onGripClick = options.onGripClick;
    this.onGripPopoverClose = options.onGripPopoverClose;
    this.i18n = options.i18n;

    this.drag = new TableRowColDrag({
      grid: this.grid,
      onAction: this.onAction,
      onDragStateChange: (isDragging, dragType) => {
        this.handleDragStateChange(isDragging, dragType);
        options.onDragStateChange?.(isDragging, dragType);
      },
    });

    this.boundMouseOver = this.handleMouseOver.bind(this);
    this.boundMouseLeave = this.handleMouseLeave.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundUnlockGrip = this.handleUnlockGrip.bind(this);

    this.createGrips();

    this.grid.addEventListener('mouseover', this.boundMouseOver);
    this.grid.addEventListener('mouseleave', this.boundMouseLeave);
  }

  /**
   * Recreate grips after structural changes (row/column add/delete/move).
   * Preserves the active grip state when a popover is open so the grip
   * remains visible after being recreated.
   */
  public refresh(): void {
    const popoverGripInfo = this.popoverState.grip
      ? this.detectGripType(this.popoverState.grip)
      : null;

    this.destroyGrips();
    this.createGrips();

    if (!popoverGripInfo) {
      return;
    }

    const newGrip = popoverGripInfo.type === 'col'
      ? this.colGrips[popoverGripInfo.index]
      : this.rowGrips[popoverGripInfo.index];

    if (!newGrip) {
      return;
    }

    this.popoverState.grip = newGrip;
    this.hideAllGripsExcept(newGrip);
    this.applyActiveClasses(newGrip);

    if (popoverGripInfo.type === 'col') {
      newGrip.style.height = `${GRIP_HOVER_SIZE}px`;
    } else {
      newGrip.style.width = `${GRIP_HOVER_SIZE}px`;
    }
  }

  /**
   * Set a specific grip to active (blue) state without opening the popover.
   * Hides all other grips.
   */
  public setActiveGrip(type: 'row' | 'col', index: number): void {
    const grip = type === 'col'
      ? this.colGrips[index]
      : this.rowGrips[index];

    if (!grip) {
      return;
    }

    this.unlockGrip();
    this.clearHideTimeout();
    this.hideAllGripsExcept(grip);
    this.applyActiveClasses(grip);

    if (type === 'col') {
      grip.style.height = `${GRIP_HOVER_SIZE}px`;
    } else {
      grip.style.width = `${GRIP_HOVER_SIZE}px`;
    }

    this.lockedGrip = grip;

    document.addEventListener('pointerdown', this.boundUnlockGrip);
  }

  private handleUnlockGrip(e: PointerEvent): void {
    document.removeEventListener('pointerdown', this.boundUnlockGrip);

    if (this.lockedGrip) {
      this.applyIdleClasses(this.lockedGrip);
      this.lockedGrip = null;
    }

    // Re-evaluate grip visibility: the preceding mouseover was blocked
    // by isGripInteractionLocked(). Check if pointer is over a table cell.
    const target = e.target instanceof HTMLElement ? e.target : null;
    const cell = target?.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (cell) {
      const position = this.getCellPosition(cell);

      if (position) {
        this.clearHideTimeout();
        this.showColGrip(position.col);
        this.showRowGrip(position.row);
        this.isInsideTable = true;
      }
    }
  }

  private unlockGrip(): void {
    document.removeEventListener('pointerdown', this.boundUnlockGrip);
    this.lockedGrip = null;
  }

  /**
   * Return the indices of the currently visible grips, or null if none are active.
   */
  public getVisibleGripIndices(): { col: number; row: number } | null {
    if (this.activeColGripIndex < 0 && this.activeRowGripIndex < 0) {
      return null;
    }

    return { col: this.activeColGripIndex, row: this.activeRowGripIndex };
  }

  /**
   * Programmatically restore grip visibility (e.g. after a DOM rebuild during undo).
   */
  public restoreVisibleGrips(col: number, row: number): void {
    if (col >= 0) {
      this.showColGrip(col);
    }
    if (row >= 0) {
      this.showRowGrip(row);
    }
    this.isInsideTable = col >= 0 || row >= 0;
  }

  public get isPopoverOpen(): boolean {
    return this.popoverState.popover !== null;
  }

  public destroy(): void {
    this.destroyPopover();
    this.unlockGrip();
    this.drag.cleanup();
    this.grid.removeEventListener('mouseover', this.boundMouseOver);
    this.grid.removeEventListener('mouseleave', this.boundMouseLeave);
    this.clearHideTimeout();
    this.destroyGrips();
  }

  private createGrips(): void {
    const colCount = this.getColumnCount();
    const rowCount = this.getRowCount();
    const gripContainer = this.overlay ?? this.grid;

    Array.from({ length: colCount }).forEach((_, i) => {
      const grip = this.createGripElement('col', i);

      this.colGrips.push(grip);
      gripContainer.appendChild(grip);
    });

    Array.from({ length: rowCount }).forEach((_, i) => {
      const grip = this.createGripElement('row', i);

      this.rowGrips.push(grip);
      gripContainer.appendChild(grip);
    });

    this.positionGrips();
    this.observeRowHeights();
    this.attachScrollListener();
  }

  private attachScrollListener(): void {
    if (this.overlay && this.scrollContainer) {
      this.boundScrollHandler = () => this.positionGrips();
      this.scrollContainer.addEventListener('scroll', this.boundScrollHandler);
    }
  }

  private detachScrollListener(): void {
    if (this.boundScrollHandler && this.scrollContainer) {
      this.scrollContainer.removeEventListener('scroll', this.boundScrollHandler);
      this.boundScrollHandler = null;
    }
  }

  private destroyGrips(): void {
    this.rowResizeObserver?.disconnect();
    this.rowResizeObserver = null;
    this.detachScrollListener();
    this.colGrips.forEach(g => g.remove());
    this.rowGrips.forEach(g => g.remove());
    this.colGrips = [];
    this.rowGrips = [];
    this.activeColGripIndex = -1;
    this.activeRowGripIndex = -1;
    this.isInsideTable = false;
  }

  private createGripElement(type: 'row' | 'col', index: number): HTMLElement {
    const grip = document.createElement('div');

    grip.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_IDLE_CLASSES);
    grip.setAttribute(GRIP_ATTR, '');
    grip.setAttribute(type === 'col' ? GRIP_COL_ATTR : GRIP_ROW_ATTR, String(index));
    grip.setAttribute('contenteditable', 'false');

    const idleWidth = type === 'col' ? COL_PILL_WIDTH : ROW_PILL_WIDTH;
    const idleHeight = type === 'col' ? COL_PILL_HEIGHT : ROW_PILL_HEIGHT;
    const pillSize = type === 'col' ? COL_PILL_HEIGHT : ROW_PILL_WIDTH;

    grip.style.width = `${idleWidth}px`;
    grip.style.height = `${idleHeight}px`;
    grip.style.transform = 'translate(-50%, -50%)';
    grip.style.outline = '2px solid white';

    grip.appendChild(createGripDotsSvg(type === 'col' ? 'horizontal' : 'vertical'));

    grip.addEventListener('pointerdown', this.boundPointerDown);
    grip.addEventListener('mouseenter', () => {
      if (this.overlay) {
        this.clearHideTimeout();
      }
      if (!this.isGripInteractionLocked()) {
        expandGrip(grip, type);
      }
    });
    grip.addEventListener('mouseleave', () => {
      if (this.isGripInteractionLocked()) {
        return;
      }
      collapseGrip(grip, type, pillSize);
      if (this.overlay) {
        this.scheduleHideAll();
      }
    });

    return grip;
  }

  /**
   * Reposition grips to match current row/column layout.
   * Called after resize or structural changes.
   */
  public positionGrips(): void {
    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);
    const firstRow = rows[0];

    if (!firstRow) {
      return;
    }

    const edges = getCumulativeColEdges(this.grid);
    const scrollLeft = this.overlay && this.scrollContainer
      ? this.scrollContainer.scrollLeft
      : 0;
    const containerWidth = this.overlay && this.scrollContainer
      ? this.scrollContainer.clientWidth
      : Infinity;

    this.colGrips.forEach((grip, i) => {
      if (i + 1 >= edges.length) {
        return;
      }

      const centerX = (edges[i] + edges[i + 1]) / 2;
      const adjustedX = centerX - scrollLeft;
      const style = grip.style;

      style.top = `${-BORDER_WIDTH / 2}px`;
      style.left = `${adjustedX}px`;

      // Hide grips scrolled out of the visible area
      if (this.overlay) {
        style.visibility = (adjustedX < 0 || adjustedX > containerWidth) ? 'hidden' : '';
      }
    });

    this.rowGrips.forEach((grip, i) => {
      if (i >= rows.length) {
        return;
      }

      const rowEl = rows[i] as HTMLElement;
      const centerY = rowEl.offsetTop + rowEl.offsetHeight / 2;
      const style = grip.style;

      style.left = `${-BORDER_WIDTH / 2}px`;
      style.top = `${centerY}px`;
    });
  }

  /**
   * Set up ResizeObserver to watch for row height changes and reposition grips.
   */
  private observeRowHeights(): void {
    this.rowResizeObserver?.disconnect();

    this.rowResizeObserver = new ResizeObserver(() => {
      this.positionGrips();
    });

    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);

    rows.forEach(row => {
      this.rowResizeObserver?.observe(row as HTMLElement);
    });
  }

  private isGripInteractionLocked(): boolean {
    return this.popoverState.popover !== null || this.lockedGrip !== null;
  }

  private handleMouseOver(e: MouseEvent): void {
    if (this.isGripInteractionLocked()) {
      return;
    }

    const target = e.target as HTMLElement;
    const cell = target.closest<HTMLElement>(`[${CELL_ATTR}]`);

    if (!cell) {
      return;
    }

    this.clearHideTimeout();

    const position = this.getCellPosition(cell);

    if (!position) {
      return;
    }

    this.showColGrip(position.col);
    this.showRowGrip(position.row);
    this.isInsideTable = true;
  }

  private handleMouseLeave(): void {
    if (this.isGripInteractionLocked()) {
      return;
    }

    this.scheduleHideAll();
  }

  private getCellPosition(cell: HTMLElement): { row: number; col: number } | null {
    const row = cell.closest<HTMLElement>(`[${ROW_ATTR}]`);

    if (!row) {
      return null;
    }

    const rows = Array.from(this.grid.querySelectorAll(`[${ROW_ATTR}]`));
    const rowIndex = rows.indexOf(row);

    if (rowIndex < 0) {
      return null;
    }

    const cells = Array.from(row.querySelectorAll(`[${CELL_ATTR}]`));
    const colIndex = cells.indexOf(cell);

    if (colIndex < 0) {
      return null;
    }

    return { row: rowIndex, col: colIndex };
  }

  /**
   * Show or hide all grip elements by toggling display.
   * Used to hide grips during add-button drag operations.
   * Preserves visibility of the grip with an active popover.
   */
  public setGripsDisplay(visible: boolean): void {
    const display = visible ? '' : 'none';

    [...this.colGrips, ...this.rowGrips].forEach(grip => {
      const el: HTMLElement = grip;

      // Don't hide the grip that has an active popover
      if (!visible && grip === this.popoverState.grip) {
        return;
      }

      el.style.display = display;
    });
  }

  /**
   * Immediately hide all grips (no delay). Used when resize drag starts.
   */
  public hideAllGrips(): void {
    this.clearHideTimeout();
    this.hideColGrip();
    this.hideRowGrip();
    this.isInsideTable = false;
  }

  private showColGrip(index: number): void {
    if (this.activeColGripIndex === index) {
      return;
    }

    this.hideColGrip();
    this.activeColGripIndex = index;
    this.applyVisibleClasses(this.colGrips[index]);
  }

  private hideColGrip(): void {
    if (this.activeColGripIndex >= 0 && this.activeColGripIndex < this.colGrips.length) {
      this.applyIdleClasses(this.colGrips[this.activeColGripIndex]);
    }

    this.activeColGripIndex = -1;
  }

  private showRowGrip(index: number): void {
    if (this.activeRowGripIndex === index) {
      return;
    }

    this.hideRowGrip();
    this.activeRowGripIndex = index;
    this.applyVisibleClasses(this.rowGrips[index]);
  }

  private hideRowGrip(): void {
    if (this.activeRowGripIndex >= 0 && this.activeRowGripIndex < this.rowGrips.length) {
      this.applyIdleClasses(this.rowGrips[this.activeRowGripIndex]);
    }

    this.activeRowGripIndex = -1;
  }

  private applyVisibleClasses(grip: HTMLElement): void {
    const el = grip;
    const isCol = el.hasAttribute(GRIP_COL_ATTR);
    const type: 'col' | 'row' = isCol ? 'col' : 'row';
    const pillSize = isCol ? COL_PILL_HEIGHT : ROW_PILL_WIDTH;

    // Reset to pill size before making visible
    collapseGrip(el, type, pillSize);

    if (this.isInsideTable) {
      el.style.transition = 'none';
    }

    el.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_VISIBLE_CLASSES);
    el.setAttribute('data-blok-table-grip-visible', '');

    if (this.isInsideTable) {
      void el.offsetHeight;
      el.style.transition = '';
    }

    const svg = el.querySelector('svg');

    if (svg) {
      svg.classList.remove('text-white');
      svg.classList.add('text-gray-400');
    }
  }

  private applyActiveClasses(grip: HTMLElement): void {
    Object.assign(grip, { className: twMerge(GRIP_CAPSULE_CLASSES, GRIP_ACTIVE_CLASSES) });
    grip.setAttribute('data-blok-table-grip-visible', '');

    const svg = grip.querySelector('svg');

    if (svg) {
      svg.classList.remove('text-gray-400', 'opacity-0');
      svg.classList.add('text-white', 'opacity-100');
    }
  }

  private hideAllGripsExcept(activeGrip: HTMLElement): void {
    [...this.colGrips, ...this.rowGrips].forEach(grip => {
      if (grip !== activeGrip) {
        this.applyIdleClasses(grip);
      }
    });
  }

  private applyIdleClasses(grip: HTMLElement): void {
    const el = grip;
    const isCol = el.hasAttribute(GRIP_COL_ATTR);
    const type: 'col' | 'row' = isCol ? 'col' : 'row';
    // With border-box, pillSize must account for the 12px padding (6px each side)
    const HIT_AREA_PADDING = 12;
    const pillSize = isCol ? (COL_PILL_HEIGHT + HIT_AREA_PADDING) : (ROW_PILL_WIDTH + HIT_AREA_PADDING);

    if (this.isInsideTable) {
      el.style.transition = 'none';
    }

    collapseGrip(el, type, pillSize);
    el.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_IDLE_CLASSES);
    el.removeAttribute('data-blok-table-grip-visible');

    if (this.isInsideTable) {
      void el.offsetHeight;
      el.style.transition = '';
    }
  }

  private handleDragStateChange(isDragging: boolean, _dragType: 'row' | 'col' | null): void {
    [...this.colGrips, ...this.rowGrips].forEach(grip => {
      const el: HTMLElement = grip;

      el.style.display = isDragging ? 'none' : '';
    });
  }

  private scheduleHideAll(): void {
    this.hideTimeout = setTimeout(() => {
      this.hideColGrip();
      this.hideRowGrip();
      this.isInsideTable = false;
      this.hideTimeout = null;
    }, HIDE_DELAY_MS);
  }

  private clearHideTimeout(): void {
    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  // ── Click / Drag discrimination ──────────────────────────────

  private handlePointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    const grip = target.closest<HTMLElement>(`[${GRIP_ATTR}]`);

    if (!grip) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    const detected = this.detectGripType(grip);

    if (!detected) {
      return;
    }

    void this.drag
      .beginTracking(detected.type, detected.index, e.clientX, e.clientY)
      .then(wasDrag => {
        if (!wasDrag) {
          this.openPopover(detected.type, detected.index);
        }
      });
  }

  private detectGripType(grip: HTMLElement): { type: 'row' | 'col'; index: number } | null {
    const colStr = grip.getAttribute(GRIP_COL_ATTR);

    if (colStr !== null) {
      return { type: 'col', index: Number(colStr) };
    }

    const rowStr = grip.getAttribute(GRIP_ROW_ATTR);

    if (rowStr !== null) {
      return { type: 'row', index: Number(rowStr) };
    }

    return null;
  }

  // ── Popover menus ────────────────────────────────────────────

  private openPopover(type: 'row' | 'col', index: number): void {
    this.popoverState = createGripPopover(
      type,
      index,
      { col: this.colGrips, row: this.rowGrips },
      {
        getColumnCount: this.getColumnCount,
        getRowCount: this.getRowCount,
        isHeadingRow: this.isHeadingRow,
        isHeadingColumn: this.isHeadingColumn,
        onAction: this.onAction,
        i18n: this.i18n,
      },
      {
        clearHideTimeout: () => this.clearHideTimeout(),
        hideAllGripsExcept: (grip) => this.hideAllGripsExcept(grip),
        applyActiveClasses: (grip) => this.applyActiveClasses(grip),
        applyVisibleClasses: (grip) => this.applyVisibleClasses(grip),
        scheduleHideAll: () => this.scheduleHideAll(),
        destroyPopover: () => this.destroyPopover(),
        onGripPopoverClose: this.onGripPopoverClose,
      }
    );

    // Show after storing state so callbacks (e.g. onGripClick → setGripsDisplay)
    // see the updated popoverState.grip reference
    this.popoverState.popover?.show();
    this.onGripClick?.(type, index);
  }

  private destroyPopover(): void {
    if (this.popoverState.popover !== null) {
      const popoverRef = this.popoverState.popover;

      this.popoverState = { popover: null, grip: null };
      popoverRef.destroy();
    }
  }
}
