import { CELL_ATTR, ROW_ATTR } from './table-core';
import type { RowColAction } from './table-row-col-controls';

const DRAG_THRESHOLD = 10;
const GHOST_ATTR = 'data-blok-table-drag-ghost';

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
  private ghostEl: HTMLElement | null = null;
  private ghostOffsetX = 0;
  private ghostOffsetY = 0;

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
    document.body.style.cursor = '';

    this.dragOverlayCells.forEach(overlayCell => {
      const el: HTMLElement = overlayCell;

      el.style.backgroundColor = '';
      el.style.opacity = '';
    });
    this.dragOverlayCells = [];

    this.dropIndicator?.remove();
    this.dropIndicator = null;

    this.ghostEl?.remove();
    this.ghostEl = null;

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
      this.updateGhostPosition(e);
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
    document.body.style.cursor = 'grabbing';

    this.highlightSourceCells();
    this.createDropIndicator();
    this.createGhost();
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

      cellEl.style.backgroundColor = '#dbeafe';
      cellEl.style.opacity = '0.6';
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

      cellEl.style.backgroundColor = '#dbeafe';
      cellEl.style.opacity = '0.6';
      this.dragOverlayCells.push(cellEl);
    });
  }

  private createDropIndicator(): void {
    this.dropIndicator = document.createElement('div');

    const style = this.dropIndicator.style;

    style.position = 'absolute';
    style.backgroundColor = '#3b82f6';
    style.borderRadius = '1.5px';
    style.zIndex = '5';
    style.pointerEvents = 'none';
    this.dropIndicator.setAttribute('contenteditable', 'false');

    if (this.dragType === 'row') {
      style.height = '3px';
      style.left = '0';
      style.right = '0';
      style.transition = 'top 100ms ease';
    } else {
      style.width = '3px';
      style.top = '0';
      style.bottom = '0';
      style.transition = 'left 100ms ease';
    }

    this.grid.appendChild(this.dropIndicator);
    this.addIndicatorDots();
  }

  private addIndicatorDots(): void {
    if (!this.dropIndicator) {
      return;
    }

    const dotSize = 8;

    const createDot = (): HTMLElement => {
      const dot = document.createElement('div');
      const dotStyle = dot.style;

      dotStyle.position = 'absolute';
      dotStyle.width = `${dotSize}px`;
      dotStyle.height = `${dotSize}px`;
      dotStyle.borderRadius = '50%';
      dotStyle.backgroundColor = '#3b82f6';

      return dot;
    };

    const dotStart = createDot();
    const dotEnd = createDot();

    if (this.dragType === 'row') {
      dotStart.style.left = `${-dotSize / 2}px`;
      dotStart.style.top = `${-dotSize / 2 + 1.5}px`;
      dotEnd.style.right = `${-dotSize / 2}px`;
      dotEnd.style.top = `${-dotSize / 2 + 1.5}px`;
    } else {
      dotStart.style.top = `${-dotSize / 2}px`;
      dotStart.style.left = `${-dotSize / 2 + 1.5}px`;
      dotEnd.style.bottom = `${-dotSize / 2}px`;
      dotEnd.style.left = `${-dotSize / 2 + 1.5}px`;
    }

    this.dropIndicator.appendChild(dotStart);
    this.dropIndicator.appendChild(dotEnd);
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

  private createGhost(): void {
    const ghost = document.createElement('div');

    ghost.setAttribute(GHOST_ATTR, '');
    ghost.setAttribute('contenteditable', 'false');

    const style = ghost.style;

    style.position = 'fixed';
    style.pointerEvents = 'none';
    style.opacity = '0.5';
    style.zIndex = '50';
    style.borderRadius = '4px';
    style.overflow = 'hidden';
    style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';

    this.ghostEl = ghost;

    if (this.dragType === 'row') {
      this.buildRowGhost();
    }

    if (this.dragType === 'col') {
      this.buildColumnGhost();
    }

    document.body.appendChild(ghost);

    const rect = ghost.getBoundingClientRect();

    this.ghostOffsetX = rect.width / 2;
    this.ghostOffsetY = rect.height / 2;

    style.left = `${this.dragStartX - this.ghostOffsetX}px`;
    style.top = `${this.dragStartY - this.ghostOffsetY}px`;
  }

  private buildRowGhost(): void {
    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);
    const sourceRow = rows[this.dragFromIndex] as HTMLElement | undefined;

    if (!sourceRow || !this.ghostEl) {
      return;
    }

    const ghostStyle = this.ghostEl.style;

    ghostStyle.display = 'flex';
    ghostStyle.height = `${sourceRow.offsetHeight}px`;

    const cells = sourceRow.querySelectorAll(`[${CELL_ATTR}]`);

    cells.forEach(cell => {
      const cellEl = cell as HTMLElement;
      const clone = cellEl.cloneNode(true) as HTMLElement;

      clone.style.width = `${cellEl.offsetWidth}px`;
      clone.style.flexShrink = '0';
      clone.removeAttribute('contenteditable');
      this.ghostEl?.appendChild(clone);
    });
  }

  private buildColumnGhost(): void {
    if (!this.ghostEl) {
      return;
    }

    const rows = this.grid.querySelectorAll(`[${ROW_ATTR}]`);
    const ghostStyle = this.ghostEl.style;

    ghostStyle.display = 'flex';
    ghostStyle.flexDirection = 'column';

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      if (this.dragFromIndex >= cells.length) {
        return;
      }

      const cellEl = cells[this.dragFromIndex] as HTMLElement;
      const clone = cellEl.cloneNode(true) as HTMLElement;

      clone.style.width = `${cellEl.offsetWidth}px`;
      clone.style.height = `${cellEl.offsetHeight}px`;
      clone.removeAttribute('contenteditable');
      this.ghostEl?.appendChild(clone);
    });
  }

  private updateGhostPosition(e: PointerEvent): void {
    if (!this.ghostEl) {
      return;
    }

    const style = this.ghostEl.style;

    style.left = `${e.clientX - this.ghostOffsetX}px`;
    style.top = `${e.clientY - this.ghostOffsetY}px`;
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
