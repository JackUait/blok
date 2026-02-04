import { CELL_ATTR, ROW_ATTR } from './table-core';
import type { RowColAction } from './table-row-col-controls';

const DRAG_THRESHOLD = 10;

/**
 * Build cumulative column edge positions from the first row's cells.
 * Returns an array of [0, w0, w0+w1, ...] representing left edges of each column
 * plus the right edge of the last column.
 */
export const getCumulativeColEdges = (grid: HTMLElement): number[] => {
  const firstRow = grid.querySelector(`[${ROW_ATTR}]`);

  if (!firstRow) {
    return [0];
  }

  const cells = Array.from(firstRow.querySelectorAll(`[${CELL_ATTR}]`));

  return cells.reduce<number[]>(
    (edges, cell) => {
      const last = edges[edges.length - 1];

      return [...edges, last + (cell as HTMLElement).offsetWidth];
    },
    [0]
  );
};

export interface TableDragOptions {
  grid: HTMLElement;
  onAction: (action: RowColAction) => void;
}

/**
 * Handles drag-to-reorder for table rows and columns.
 * Tracks pointer movement, highlights source cells, and shows a drop indicator line.
 */
export class TableRowColDrag {
  private grid: HTMLElement;
  private onAction: (action: RowColAction) => void;

  private isDragging = false;
  private dragType: 'row' | 'col' | null = null;
  private dragFromIndex = -1;
  private dragStartX = 0;
  private dragStartY = 0;
  private dropIndicator: HTMLElement | null = null;
  private dragOverlayCells: HTMLElement[] = [];

  private boundDocPointerMove: (e: PointerEvent) => void;
  private boundDocPointerUp: (e: PointerEvent) => void;

  /** Resolves when drag ends — set by beginTracking, consumed by caller */
  private resolveTracking: ((wasDrag: boolean) => void) | null = null;

  constructor(options: TableDragOptions) {
    this.grid = options.grid;
    this.onAction = options.onAction;

    this.boundDocPointerMove = this.handleDocPointerMove.bind(this);
    this.boundDocPointerUp = this.handleDocPointerUp.bind(this);
  }

  /**
   * Start tracking pointer after a grip pointerdown.
   * Returns a promise that resolves to `true` if the user dragged (>threshold)
   * or `false` if it was a click.
   */
  public beginTracking(
    type: 'row' | 'col',
    index: number,
    startX: number,
    startY: number
  ): Promise<boolean> {
    this.dragType = type;
    this.dragFromIndex = index;
    this.dragStartX = startX;
    this.dragStartY = startY;

    document.addEventListener('pointermove', this.boundDocPointerMove);
    document.addEventListener('pointerup', this.boundDocPointerUp);

    return new Promise<boolean>(resolve => {
      this.resolveTracking = resolve;
    });
  }

  public cleanup(): void {
    this.grid.style.userSelect = '';

    this.dragOverlayCells.forEach(overlayCell => {
      const el: HTMLElement = overlayCell;

      el.style.backgroundColor = '';
    });
    this.dragOverlayCells = [];

    this.dropIndicator?.remove();
    this.dropIndicator = null;

    document.removeEventListener('pointermove', this.boundDocPointerMove);
    document.removeEventListener('pointerup', this.boundDocPointerUp);

    this.isDragging = false;
    this.dragType = null;
    this.dragFromIndex = -1;
    this.resolveTracking = null;
  }

  private handleDocPointerMove(e: PointerEvent): void {
    const dx = Math.abs(e.clientX - this.dragStartX);
    const dy = Math.abs(e.clientY - this.dragStartY);

    if (!this.isDragging && (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD)) {
      this.isDragging = true;
      this.startDrag();
    }

    if (this.isDragging) {
      this.updateDragIndicator(e);
    }
  }

  private handleDocPointerUp(e: PointerEvent): void {
    document.removeEventListener('pointermove', this.boundDocPointerMove);
    document.removeEventListener('pointerup', this.boundDocPointerUp);

    if (this.isDragging) {
      this.finishDrag(e);
      this.resolveTracking?.(true);
    } else {
      this.resolveTracking?.(false);
    }

    this.cleanup();
  }

  private startDrag(): void {
    this.grid.style.userSelect = 'none';

    this.highlightSourceCells();
    this.createDropIndicator();
  }

  private highlightSourceCells(): void {
    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);

    if (this.dragType === 'row') {
      this.highlightRowCells(rows);

      return;
    }

    if (this.dragType === 'col') {
      this.highlightColumnCells(rows);
    }
  }

  private highlightRowCells(rows: NodeListOf<Element>): void {
    const row = rows[this.dragFromIndex];

    if (!row) {
      return;
    }

    const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

    cells.forEach(node => {
      const cellEl = node as HTMLElement;

      cellEl.style.backgroundColor = '#eff6ff';
      this.dragOverlayCells.push(cellEl);
    });
  }

  private highlightColumnCells(rows: NodeListOf<Element>): void {
    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      if (this.dragFromIndex >= cells.length) {
        return;
      }

      const cellEl = cells[this.dragFromIndex] as HTMLElement;

      cellEl.style.backgroundColor = '#eff6ff';
      this.dragOverlayCells.push(cellEl);
    });
  }

  private createDropIndicator(): void {
    this.dropIndicator = document.createElement('div');
    this.dropIndicator.style.position = 'absolute';
    this.dropIndicator.style.backgroundColor = '#3b82f6';
    this.dropIndicator.style.zIndex = '5';
    this.dropIndicator.style.pointerEvents = 'none';
    this.dropIndicator.setAttribute('contenteditable', 'false');

    if (this.dragType === 'row') {
      this.dropIndicator.style.height = '2px';
      this.dropIndicator.style.left = '0';
      this.dropIndicator.style.right = '0';
    } else {
      this.dropIndicator.style.width = '2px';
      this.dropIndicator.style.top = '0';
      this.dropIndicator.style.bottom = '0';
    }

    this.grid.appendChild(this.dropIndicator);
  }

  private updateDragIndicator(e: PointerEvent): void {
    if (!this.dropIndicator) {
      return;
    }

    const gridRect = this.grid.getBoundingClientRect();

    if (this.dragType === 'row') {
      this.updateRowIndicator(e, gridRect);

      return;
    }

    if (this.dragType === 'col') {
      this.updateColIndicator(e, gridRect);
    }
  }

  private updateRowIndicator(e: PointerEvent, gridRect: DOMRect): void {
    if (!this.dropIndicator) {
      return;
    }

    const relativeY = e.clientY - gridRect.top;
    const dropIndex = this.getRowDropIndex(relativeY);
    const topPx = this.getRowDropTopPx(dropIndex);

    this.dropIndicator.style.top = `${topPx}px`;
  }

  private updateColIndicator(e: PointerEvent, gridRect: DOMRect): void {
    if (!this.dropIndicator) {
      return;
    }

    const relativeX = e.clientX - gridRect.left;
    const dropIndex = this.getColDropIndex(relativeX);
    const edges = getCumulativeColEdges(this.grid);

    this.dropIndicator.style.left = `${edges[dropIndex] ?? 0}px`;
  }

  private finishDrag(e: PointerEvent): void {
    const gridRect = this.grid.getBoundingClientRect();

    if (this.dragType === 'row') {
      this.finishRowDrag(e, gridRect);

      return;
    }

    if (this.dragType === 'col') {
      this.finishColDrag(e, gridRect);
    }
  }

  private finishRowDrag(e: PointerEvent, gridRect: DOMRect): void {
    const relativeY = e.clientY - gridRect.top;
    const rawDropIndex = this.getRowDropIndex(relativeY);
    const dropIndex = rawDropIndex > this.dragFromIndex ? rawDropIndex - 1 : rawDropIndex;

    if (dropIndex !== this.dragFromIndex) {
      this.onAction({ type: 'move-row', fromIndex: this.dragFromIndex, toIndex: dropIndex });
    }
  }

  private finishColDrag(e: PointerEvent, gridRect: DOMRect): void {
    const relativeX = e.clientX - gridRect.left;
    const rawDropIndex = this.getColDropIndex(relativeX);
    const dropIndex = rawDropIndex > this.dragFromIndex ? rawDropIndex - 1 : rawDropIndex;

    if (dropIndex !== this.dragFromIndex) {
      this.onAction({ type: 'move-col', fromIndex: this.dragFromIndex, toIndex: dropIndex });
    }
  }

  private getRowDropIndex(relativeY: number): number {
    const rows = Array.from(this.grid.querySelectorAll(`[${ROW_ATTR}]`));

    const edges = rows.map(row => (row as HTMLElement).offsetTop);

    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1] as HTMLElement;

      edges.push(lastRow.offsetTop + lastRow.offsetHeight);
    }

    const distances = edges.map(edge => Math.abs(relativeY - edge));
    const minDist = Math.min(...distances);

    return distances.indexOf(minDist);
  }

  private getRowDropTopPx(dropIndex: number): number {
    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);

    if (dropIndex < rows.length) {
      return (rows[dropIndex] as HTMLElement).offsetTop;
    }

    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1] as HTMLElement;

      return lastRow.offsetTop + lastRow.offsetHeight;
    }

    return 0;
  }

  private getColDropIndex(relativeX: number): number {
    const edges = getCumulativeColEdges(this.grid);
    const distances = edges.map(edge => Math.abs(relativeX - edge));
    const minDist = Math.min(...distances);

    return distances.indexOf(minDist);
  }
}
