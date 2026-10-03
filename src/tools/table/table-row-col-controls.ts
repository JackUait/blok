import type { I18n } from '../../../types/api';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import { getElementDirection } from '../../components/utils/direction';
import { twMerge } from '../../components/utils/tw';

import type { CellColorMode } from './table-cell-color-picker';
import { BORDER_WIDTH, CELL_ATTR, CELL_COL_ATTR, CELL_ROW_ATTR, ownRows } from './table-core';
import { colEdgeX, gridX } from './table-direction';
import { collapseGrip, createGripDotsSvg, expandGrip, GRIP_HOVER_SIZE, setGripPillSize } from './table-grip-visuals';
import { getCumulativeColEdges, TableRowColDrag } from './table-row-col-drag';
import { createGripPopover } from './table-row-col-popover';
import type { PopoverState } from './table-row-col-popover';

const GRIP_ATTR = 'data-blok-table-grip';
const GRIP_COL_ATTR = 'data-blok-table-grip-col';
const GRIP_ROW_ATTR = 'data-blok-table-grip-row';
/** Present on grips whose row/column is locked in place by a merge. */
export const GRIP_DRAG_DISABLED_ATTR = 'data-blok-table-grip-drag-disabled';
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
  | { type: 'duplicate-row'; index: number; count?: number }
  | { type: 'duplicate-col'; index: number; count?: number }
  | { type: 'delete-row'; index: number; count?: number }
  | { type: 'delete-col'; index: number; count?: number }
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
  /** Wipe the content of every cell in the grip's rows/columns (colors survive). */
  onClearContents: (type: 'row' | 'col', index: number, count: number) => void;
  /** Paint every cell in the grip's rows/columns. */
  onColorChange: (type: 'row' | 'col', index: number, color: string | null, mode: CellColorMode, count: number) => void;
  onDragStateChange?: (isDragging: boolean, dragType: 'row' | 'col' | null, dragIndex: number) => void;
  onGripClick?: (type: 'row' | 'col', index: number) => void;
  onGripPopoverClose?: () => void;
  /** Can this row/column be dragged at all? See TableDragOptions.canDrag. */
  canDrag?: (type: 'row' | 'col', index: number) => boolean;
  /** Can the dragged row/column land here? See TableDragOptions.canDrop. */
  canDrop?: (type: 'row' | 'col', fromIndex: number, toIndex: number) => boolean;
  i18n: I18n;
}

export const GRIP_CAPSULE_CLASSES = [
  'absolute',
  'z-3',
  'rounded-(--blok-radius-control-sm)',
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

export const GRIP_IDLE_CLASSES = [
  'bg-gray-300',
  'opacity-0',
  'pointer-events-none',
];

export const GRIP_VISIBLE_CLASSES = [
  'bg-gray-300',
  'opacity-100',
  'pointer-events-auto',
];

export const GRIP_ACTIVE_CLASSES = [
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
  private onClearContents: (type: 'row' | 'col', index: number, count: number) => void;
  private onColorChange: (type: 'row' | 'col', index: number, color: string | null, mode: CellColorMode, count: number) => void;
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
  /** Row/col of the cell holding the caret. Its grips stay up whatever the pointer hovers. */
  private pinnedRowIndex = -1;
  private pinnedColIndex = -1;
  /**
   * How many rows/cols the hovered and the pinned grip stand for. A merged cell
   * acts as one cell: one grip per axis, centred on it, acting on every row/col it covers.
   */
  private hoverRowSpan = 1;
  private hoverColSpan = 1;
  private pinnedRowSpan = 1;
  private pinnedColSpan = 1;
  private isInsideTable = false;
  private rowResizeObserver: ResizeObserver | null = null;

  private drag: TableRowColDrag;
  private canDrag: ((type: 'row' | 'col', index: number) => boolean) | undefined;

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
    this.onClearContents = options.onClearContents;
    this.onColorChange = options.onColorChange;
    this.onGripClick = options.onGripClick;
    this.onGripPopoverClose = options.onGripPopoverClose;
    this.canDrag = options.canDrag;
    this.i18n = options.i18n;

    this.drag = new TableRowColDrag({
      grid: this.grid,
      onAction: this.onAction,
      onDragStateChange: (isDragging, dragType, dragIndex) => {
        this.handleDragStateChange(isDragging, dragType);
        options.onDragStateChange?.(isDragging, dragType, dragIndex);
      },
      canDrag: options.canDrag,
      canDrop: options.canDrop,
    });

    this.boundMouseOver = this.handleMouseOver.bind(this);
    this.boundMouseLeave = this.handleMouseLeave.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundUnlockGrip = this.handleUnlockGrip.bind(this);

    this.createGrips();

    this.grid.addEventListener('mouseover', this.boundMouseOver);
    // A merged cell covers several rows/cols, and mouseover fires only on entry.
    this.grid.addEventListener('mousemove', this.boundMouseOver);
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

  /**
   * Keep the grips of `cell` visible on top of the hover pair. Pass null to release them.
   */
  public pinCell(cell: { row: number; col: number; rowSpan?: number; colSpan?: number } | null): void {
    const prevRow = this.pinnedRowIndex;
    const prevCol = this.pinnedColIndex;

    this.pinnedRowIndex = cell?.row ?? -1;
    this.pinnedColIndex = cell?.col ?? -1;
    this.pinnedRowSpan = cell?.rowSpan ?? 1;
    this.pinnedColSpan = cell?.colSpan ?? 1;

    if (prevCol >= 0 && prevCol !== this.pinnedColIndex && prevCol !== this.activeColGripIndex && prevCol < this.colGrips.length) {
      this.applyIdleClasses(this.colGrips[prevCol]);
      this.positionGrip('col', prevCol);
    }
    if (prevRow >= 0 && prevRow !== this.pinnedRowIndex && prevRow !== this.activeRowGripIndex && prevRow < this.rowGrips.length) {
      this.applyIdleClasses(this.rowGrips[prevRow]);
      this.positionGrip('row', prevRow);
    }

    this.showPinnedGrips();
  }

  private showPinnedGrips(): void {
    this.syncPinnedGrip('col');
    this.syncPinnedGrip('row');
  }

  /**
   * Show the pinned grip of one axis, at its span. When the hovered grip's rows
   * overlap the pinned grip's rows, the pinned one hides: they would stack.
   */
  private syncPinnedGrip(type: 'row' | 'col'): void {
    // An open menu or a locked grip shows only its own grip.
    if (this.isGripInteractionLocked()) {
      return;
    }

    const pinned = type === 'row' ? this.pinnedRowIndex : this.pinnedColIndex;
    const span = type === 'row' ? this.pinnedRowSpan : this.pinnedColSpan;
    const active = type === 'row' ? this.activeRowGripIndex : this.activeColGripIndex;
    const activeSpan = type === 'row' ? this.hoverRowSpan : this.hoverColSpan;
    const grip = (type === 'row' ? this.rowGrips : this.colGrips)[pinned];

    if (grip === undefined) {
      return;
    }

    this.positionGrip(type, pinned);

    if (active >= 0 && active !== pinned && active < pinned + span && pinned < active + activeSpan) {
      this.applyIdleClasses(grip);

      return;
    }

    // No fade: the grips mark the caret cell like its box does, and a fade replays after every undo rebuild.
    if (!grip.hasAttribute('data-blok-table-grip-visible')) {
      this.applyVisibleClasses(grip, true);
    }
  }

  /**
   * How many rows/cols a grip stands for right now. Hover wins over the pin:
   * the grip under the pointer describes what the pointer is on.
   */
  private getGripSpan(type: 'row' | 'col', index: number): number {
    if (type === 'row') {
      if (index === this.activeRowGripIndex) {
        return this.hoverRowSpan;
      }

      return index === this.pinnedRowIndex ? this.pinnedRowSpan : 1;
    }

    if (index === this.activeColGripIndex) {
      return this.hoverColSpan;
    }

    return index === this.pinnedColIndex ? this.pinnedColSpan : 1;
  }

  private handleUnlockGrip(e: PointerEvent): void {
    document.removeEventListener('pointerdown', this.boundUnlockGrip);

    if (this.lockedGrip) {
      this.applyIdleClasses(this.lockedGrip);
      this.lockedGrip = null;
    }

    this.showPinnedGrips();

    // Re-evaluate grip visibility: the preceding mouseover was blocked
    // by isGripInteractionLocked(). Check if pointer is over a table cell.
    const target = e.target instanceof HTMLElement ? e.target : null;
    const cell = target ? this.findOwnCell(target) : null;

    if (cell) {
      const position = this.getPointerPosition(cell);

      if (position) {
        this.clearHideTimeout();
        this.showColGrip(position.col, position.colSpan);
        this.showRowGrip(position.row, position.rowSpan);
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
    // The indices were read before the rebuild. An undo can remove the row or
    // column they point at, so an index past the end shows nothing.
    const colIndex = col < this.colGrips.length ? col : -1;
    const rowIndex = row < this.rowGrips.length ? row : -1;

    // Set isInsideTable BEFORE showing grips so applyVisibleClasses()
    // skips the CSS opacity transition (no flash).
    this.isInsideTable = colIndex >= 0 || rowIndex >= 0;

    if (colIndex >= 0) {
      this.showColGrip(colIndex);
    }
    if (rowIndex >= 0) {
      this.showRowGrip(rowIndex);
    }
  }

  public get isPopoverOpen(): boolean {
    return this.popoverState.popover !== null;
  }

  public destroy(): void {
    this.destroyPopover();
    this.unlockGrip();
    this.drag.cleanup();
    this.grid.removeEventListener('mouseover', this.boundMouseOver);
    this.grid.removeEventListener('mousemove', this.boundMouseOver);
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
    this.showPinnedGrips();
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
    this.hoverColSpan = 1;
    this.hoverRowSpan = 1;
    this.isInsideTable = false;
  }

  private createGripElement(type: 'row' | 'col', index: number): HTMLElement {
    const grip = document.createElement('div');
    const isDragLocked = this.canDrag !== undefined && !this.canDrag(type, index);

    grip.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_IDLE_CLASSES);
    grip.setAttribute(GRIP_ATTR, '');
    grip.setAttribute(type === 'col' ? GRIP_COL_ATTR : GRIP_ROW_ATTR, String(index));
    grip.setAttribute('contenteditable', 'false');
    // Chrome, not content: moving it (scroll, direction flip) is not an edit.
    grip.setAttribute(DATA_ATTR.mutationFree, 'true');
    grip.setAttribute('role', 'button');
    grip.setAttribute('tabindex', '0');
    grip.setAttribute('aria-haspopup', 'menu');
    // A locked grip advertises only the half of its contract that still works.
    grip.setAttribute(
      'aria-label',
      isDragLocked
        ? this.i18n.t('blockSettings.clickToOpenMenu')
        : `${this.i18n.t('blockSettings.dragToMove')}. ${this.i18n.t('blockSettings.clickToOpenMenu')}`
    );

    // A row/column locked inside a merge cannot be reordered. Mark it so the
    // drag affordance reads as disabled (not-allowed cursor) rather than
    // inviting a drag that would snap back with no explanation. The grip still
    // opens its menu on click — insert/delete remain valid there.
    if (isDragLocked) {
      grip.setAttribute(GRIP_DRAG_DISABLED_ATTR, '');
      grip.style.cursor = 'not-allowed';
    }

    const idleWidth = type === 'col' ? COL_PILL_WIDTH : ROW_PILL_WIDTH;
    const idleHeight = type === 'col' ? COL_PILL_HEIGHT : ROW_PILL_HEIGHT;
    const pillSize = type === 'col' ? COL_PILL_HEIGHT : ROW_PILL_WIDTH;

    grip.style.width = `${idleWidth}px`;
    grip.style.height = `${idleHeight}px`;
    grip.style.transform = 'translate(-50%, -50%)';
    grip.style.outline = '2px solid var(--blok-table-grip-outline, transparent)';

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

    // Grips are revealed by hovering their row/column, so keyboard focus has to
    // reveal them too — otherwise the tab stop lands on something at opacity 0.
    grip.addEventListener('focus', () => {
      this.clearHideTimeout();

      if (type === 'col') {
        this.showColGrip(index);
      } else {
        this.showRowGrip(index);
      }

      if (!this.isGripInteractionLocked()) {
        expandGrip(grip, type);
      }
    });
    grip.addEventListener('blur', () => {
      if (this.isGripInteractionLocked()) {
        return;
      }
      collapseGrip(grip, type, pillSize);
      this.scheduleHideAll();
    });

    // The grip lives inside the block's contenteditable subtree: an unswallowed
    // Enter splits the block and Space types into it.
    grip.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      this.openPopover(type, index);
    });

    return grip;
  }

  /**
   * Reposition grips to match current row/column layout.
   * Called after resize or structural changes.
   */
  public positionGrips(): void {
    const rows = ownRows(this.grid);
    const firstRow = rows[0];

    if (!firstRow) {
      return;
    }

    const edges = getCumulativeColEdges(this.grid);
    const direction = getElementDirection(this.grid);
    const frame = this.getGripFrame(direction);

    this.colGrips.forEach((grip, i) => this.placeColGrip(grip, i, edges, direction, frame));
    this.rowGrips.forEach((grip, i) => this.placeRowGrip(grip, i, rows, frame));
  }

  private positionGrip(type: 'row' | 'col', index: number): void {
    const grip = (type === 'row' ? this.rowGrips : this.colGrips)[index];

    if (grip === undefined) {
      return;
    }

    const direction = getElementDirection(this.grid);
    const frame = this.getGripFrame(direction);

    if (type === 'row') {
      this.placeRowGrip(grip, index, ownRows(this.grid), frame);
    } else {
      this.placeColGrip(grip, index, getCumulativeColEdges(this.grid), direction, frame);
    }
  }

  private placeColGrip(
    grip: HTMLElement,
    i: number,
    edges: number[],
    direction: 'ltr' | 'rtl',
    frame: { gridOffset: number; visibleStart: number; visibleWidth: number }
  ): void {
    if (i + 1 >= edges.length) {
      return;
    }

    const end = Math.min(i + this.getGripSpan('col', i), edges.length - 1);
    const centerX = (colEdgeX(edges, i, direction) + colEdgeX(edges, end, direction)) / 2;
    const adjustedX = centerX + frame.gridOffset;
    const style = grip.style;

    style.top = `${BORDER_WIDTH / 2}px`;
    style.left = `${adjustedX}px`;

    // Hide grips scrolled out of the visible area
    if (this.overlay) {
      style.visibility = (adjustedX < frame.visibleStart || adjustedX > frame.visibleStart + frame.visibleWidth) ? 'hidden' : '';
    }
  }

  private placeRowGrip(grip: HTMLElement, i: number, rows: ArrayLike<HTMLElement>, frame: { rowGripX: number }): void {
    if (i >= rows.length) {
      return;
    }

    // Only a grip standing for a merged cell spans rows; an idle one stays in
    // its own row, or grip 0 of a rowspan would sit on top of grip 1.
    const first = rows[i];
    const last = rows[Math.min(i + this.getGripSpan('row', i), rows.length) - 1];
    const centerY = (first.offsetTop + last.offsetTop + last.offsetHeight) / 2;
    const style = grip.style;

    style.left = `${frame.rowGripX}px`;
    style.top = `${centerY}px`;
  }

  /**
   * Where the grid and the visible strip sit inside the grip container.
   * A frame line starts at the grid edge and runs inward, so a grip centred on
   * it sits BORDER_WIDTH / 2 inside that edge.
   * Row grips ride the scroller's inline-start edge, so they stay put while
   * the grid scrolls under them.
   */
  private getGripFrame(direction: 'ltr' | 'rtl'): { gridOffset: number; visibleStart: number; visibleWidth: number; rowGripX: number } {
    const scroller = this.overlay ? this.scrollContainer : undefined;

    if (!scroller) {
      const gridWidth = this.grid.offsetWidth;

      return { gridOffset: 0, visibleStart: 0, visibleWidth: Infinity, rowGripX: gridX(BORDER_WIDTH / 2, gridWidth, direction) };
    }

    if (direction === 'ltr') {
      return { gridOffset: -scroller.scrollLeft, visibleStart: 0, visibleWidth: scroller.clientWidth, rowGripX: BORDER_WIDTH / 2 };
    }

    const containerLeft = (this.overlay ?? scroller).getBoundingClientRect().left;
    const scrollerRect = scroller.getBoundingClientRect();

    return {
      gridOffset: this.grid.getBoundingClientRect().left - containerLeft,
      visibleStart: scrollerRect.left - containerLeft,
      visibleWidth: scroller.clientWidth,
      rowGripX: scrollerRect.right - containerLeft - BORDER_WIDTH / 2,
    };
  }

  /**
   * Set up ResizeObserver to watch for row height changes and reposition grips.
   */
  private observeRowHeights(): void {
    this.rowResizeObserver?.disconnect();

    this.rowResizeObserver = new ResizeObserver(() => {
      this.positionGrips();
    });

    const rows = ownRows(this.grid);

    rows.forEach(row => {
      this.rowResizeObserver?.observe(row);
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
    const cell = this.findOwnCell(target);

    if (!cell) {
      return;
    }

    this.clearHideTimeout();

    const position = this.getPointerPosition(cell);

    if (!position) {
      return;
    }

    this.showColGrip(position.col, position.colSpan);
    this.showRowGrip(position.row, position.rowSpan);
    this.isInsideTable = true;
  }

  private handleMouseLeave(): void {
    if (this.isGripInteractionLocked()) {
      return;
    }

    this.scheduleHideAll();
  }

  /**
   * The cell of THIS table that contains `target`. Inside a nested table the
   * closest cell belongs to the inner table and carries its coordinates.
   */
  private findOwnCell(target: Element): HTMLElement | null {
    const cell = target.closest<HTMLElement>(`[${CELL_ATTR}]`);
    const row = cell?.parentElement;

    if (!cell || !row) {
      return null;
    }

    if (Array.from(ownRows(this.grid)).includes(row)) {
      return cell;
    }

    return this.findOwnCell(row);
  }

  /**
   * The cell under the pointer. A merged cell counts as one cell: its origin
   * and the rows/cols it covers.
   */
  private getPointerPosition(cell: HTMLElement): { row: number; col: number; rowSpan: number; colSpan: number } | null {
    const position = this.getCellPosition(cell);

    if (!position) {
      return null;
    }

    return {
      ...position,
      rowSpan: (cell as HTMLTableCellElement).rowSpan || 1,
      colSpan: (cell as HTMLTableCellElement).colSpan || 1,
    };
  }

  private getCellPosition(cell: HTMLElement): { row: number; col: number } | null {
    const rowAttr = cell.getAttribute(CELL_ROW_ATTR);
    const colAttr = cell.getAttribute(CELL_COL_ATTR);

    if (rowAttr === null || colAttr === null) {
      return null;
    }

    const row = parseInt(rowAttr, 10);
    const col = parseInt(colAttr, 10);

    if (isNaN(row) || isNaN(col)) {
      return null;
    }

    return { row, col };
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

  private showColGrip(index: number, span = 1): void {
    if (this.activeColGripIndex === index && this.hoverColSpan === span) {
      return;
    }

    this.hideColGrip();
    this.activeColGripIndex = index;
    this.hoverColSpan = span;
    this.applyVisibleClasses(this.colGrips[index]);
    this.positionGrip('col', index);
    this.syncPinnedGrip('col');
  }

  private hideColGrip(): void {
    const prev = this.activeColGripIndex;

    if (prev >= 0 && prev < this.colGrips.length && prev !== this.pinnedColIndex) {
      this.applyIdleClasses(this.colGrips[prev]);
    }

    this.activeColGripIndex = -1;
    this.hoverColSpan = 1;
    this.positionGrip('col', prev);
    this.syncPinnedGrip('col');
  }

  private showRowGrip(index: number, span = 1): void {
    if (this.activeRowGripIndex === index && this.hoverRowSpan === span) {
      return;
    }

    this.hideRowGrip();
    this.activeRowGripIndex = index;
    this.hoverRowSpan = span;
    this.applyVisibleClasses(this.rowGrips[index]);
    this.positionGrip('row', index);
    this.syncPinnedGrip('row');
  }

  private hideRowGrip(): void {
    const prev = this.activeRowGripIndex;

    if (prev >= 0 && prev < this.rowGrips.length && prev !== this.pinnedRowIndex) {
      this.applyIdleClasses(this.rowGrips[prev]);
    }

    this.activeRowGripIndex = -1;
    this.hoverRowSpan = 1;
    this.positionGrip('row', prev);
    this.syncPinnedGrip('row');
  }

  private applyVisibleClasses(grip: HTMLElement, instant = this.isInsideTable): void {
    const el = grip;
    const isCol = el.hasAttribute(GRIP_COL_ATTR);
    const type: 'col' | 'row' = isCol ? 'col' : 'row';
    const pillSize = isCol ? COL_PILL_HEIGHT : ROW_PILL_WIDTH;

    setGripPillSize(el, type, pillSize);

    if (instant) {
      el.style.transition = 'none';
    }

    el.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_VISIBLE_CLASSES);
    el.setAttribute('data-blok-table-grip-visible', '');

    if (instant) {
      void el.offsetHeight;
      el.style.transition = '';
    }

    const svg = el.querySelector('svg');

    if (svg) {
      svg.classList.remove('text-white', 'opacity-100');
      svg.classList.add('text-gray-400', 'opacity-0');
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
    // Same size as the visible pill: size is in the transition list, so any
    // difference would play on reveal as a blob shrinking into the pill.
    const pillSize = isCol ? COL_PILL_HEIGHT : ROW_PILL_WIDTH;

    if (this.isInsideTable) {
      el.style.transition = 'none';
    }

    setGripPillSize(el, type, pillSize);
    el.className = twMerge(GRIP_CAPSULE_CLASSES, GRIP_IDLE_CLASSES);
    el.removeAttribute('data-blok-table-grip-visible');

    const svg = el.querySelector('svg');

    if (svg) {
      svg.classList.add('opacity-0');
      svg.classList.remove('opacity-100');
    }

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
      this.showPinnedGrips();
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
      this.getGripSpan(type, index),
      { col: this.colGrips, row: this.rowGrips },
      {
        getColumnCount: this.getColumnCount,
        getRowCount: this.getRowCount,
        isHeadingRow: this.isHeadingRow,
        isHeadingColumn: this.isHeadingColumn,
        onAction: this.onAction,
        onClearContents: this.onClearContents,
        onColorChange: this.onColorChange,
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
