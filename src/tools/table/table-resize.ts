const RESIZE_ATTR = 'data-blok-table-resize';
const CELL_ATTR = 'data-blok-table-cell';
const ROW_ATTR = 'data-blok-table-row';
const MIN_COL_WIDTH = 10;
const MIN_TABLE_WIDTH = 10;
const HANDLE_HIT_WIDTH = 16;

const clampPair = (left: number, right: number, total: number): [number, number] => {
  if (left < MIN_COL_WIDTH) {
    return [MIN_COL_WIDTH, Math.round((total - MIN_COL_WIDTH) * 100) / 100];
  }

  if (right < MIN_COL_WIDTH) {
    return [Math.round((total - MIN_COL_WIDTH) * 100) / 100, MIN_COL_WIDTH];
  }

  return [Math.round(left * 100) / 100, Math.round(right * 100) / 100];
};

/**
 * Handles column resize drag interaction on the table grid.
 * Creates full-height resize handles positioned on the grid element.
 * Includes a handle at the right edge for resizing the overall table width.
 */
export class TableResize {
  private gridEl: HTMLElement;
  private colWidths: number[];
  private tableWidth: number;
  private onChange: (widths: number[], tableWidth: number) => void;
  private isDragging = false;
  private dragStartX = 0;
  private dragColIndex = -1;
  private isRightEdgeDrag = false;
  private startLeftWidth = 0;
  private startRightWidth = 0;
  private startTableWidth = 0;
  private handles: HTMLElement[] = [];

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;

  constructor(gridEl: HTMLElement, colWidths: number[], tableWidth: number, onChange: (widths: number[], tableWidth: number) => void) {
    this.gridEl = gridEl;
    this.colWidths = [...colWidths];
    this.tableWidth = tableWidth;
    this.onChange = onChange;

    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);

    this.gridEl.style.position = 'relative';
    this.gridEl.style.width = `${tableWidth}%`;
    this.createHandles();

    this.gridEl.addEventListener('pointerdown', this.boundPointerDown);
  }

  public destroy(): void {
    this.gridEl.removeEventListener('pointerdown', this.boundPointerDown);
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);

    this.handles.forEach(handle => handle.remove());
    this.handles = [];
  }

  private createHandles(): void {
    const colCount = this.colWidths.length;

    if (colCount < 2) {
      return;
    }

    // Create N handles for N columns: N-1 between pairs + 1 at right edge
    Array.from({ length: colCount }).forEach((_, i) => {
      const handle = this.createHandle(i);

      this.handles.push(handle);
      this.gridEl.appendChild(handle);
    });
  }

  private createHandle(colIndex: number): HTMLElement {
    const handle = document.createElement('div');
    const leftPosition = this.getHandleLeft(colIndex);

    handle.setAttribute(RESIZE_ATTR, '');
    handle.setAttribute('data-col', String(colIndex));
    handle.style.position = 'absolute';
    handle.style.top = '0px';
    handle.style.bottom = '0px';
    handle.style.width = `${HANDLE_HIT_WIDTH}px`;
    handle.style.left = `calc(${leftPosition}% - ${HANDLE_HIT_WIDTH / 2}px)`;
    handle.style.cursor = 'col-resize';
    handle.style.zIndex = '2';
    handle.setAttribute('contenteditable', 'false');

    handle.addEventListener('mouseenter', () => {
      if (!this.isDragging) {
        handle.style.background = 'linear-gradient(to right, transparent 7px, #3b82f6 7px, #3b82f6 9px, transparent 9px)';
      }
    });

    handle.addEventListener('mouseleave', () => {
      if (!this.isDragging) {
        handle.style.background = '';
      }
    });

    return handle;
  }

  private getHandleLeft(colIndex: number): number {
    const left = this.colWidths
      .slice(0, colIndex + 1)
      .reduce((sum, w) => sum + w, 0);

    return Math.round(left * 100) / 100;
  }

  private updateHandlePositions(): void {
    this.handles.forEach((el, i) => {
      const leftPosition = this.getHandleLeft(i);
      const handleEl: HTMLElement = el;

      handleEl.style.left = `calc(${leftPosition}% - ${HANDLE_HIT_WIDTH / 2}px)`;
    });
  }

  private onPointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;

    if (!target.hasAttribute(RESIZE_ATTR)) {
      return;
    }

    e.preventDefault();

    const colStr = target.getAttribute('data-col');

    if (colStr === null) {
      return;
    }

    this.dragColIndex = Number(colStr);
    this.isRightEdgeDrag = this.dragColIndex === this.colWidths.length - 1;

    if (!this.isRightEdgeDrag && this.dragColIndex >= this.colWidths.length - 1) {
      return;
    }

    this.isDragging = true;
    this.dragStartX = e.clientX;

    if (this.isRightEdgeDrag) {
      this.startTableWidth = this.tableWidth;
    } else {
      this.startLeftWidth = this.colWidths[this.dragColIndex];
      this.startRightWidth = this.colWidths[this.dragColIndex + 1];
    }

    this.gridEl.style.userSelect = 'none';

    // Show active indicator during drag
    target.style.background = 'linear-gradient(to right, transparent 7px, #3b82f6 7px, #3b82f6 9px, transparent 9px)';

    if (target.setPointerCapture) {
      target.setPointerCapture(e.pointerId);
    }

    document.addEventListener('pointermove', this.boundPointerMove);
    document.addEventListener('pointerup', this.boundPointerUp);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDragging) {
      return;
    }

    if (this.isRightEdgeDrag) {
      this.onRightEdgeMove(e);
    } else {
      this.onPairMove(e);
      this.applyCellWidths();
      this.updateHandlePositions();
    }
  }

  private onPairMove(e: PointerEvent): void {
    const tableWidth = this.gridEl.getBoundingClientRect().width;
    const deltaPercent = ((e.clientX - this.dragStartX) / tableWidth) * 100;

    const total = this.startLeftWidth + this.startRightWidth;
    const rawLeft = this.startLeftWidth + deltaPercent;
    const rawRight = this.startRightWidth - deltaPercent;

    const [clampedLeft, clampedRight] = clampPair(rawLeft, rawRight, total);

    this.colWidths[this.dragColIndex] = clampedLeft;
    this.colWidths[this.dragColIndex + 1] = clampedRight;
  }

  private onRightEdgeMove(e: PointerEvent): void {
    const containerWidth = this.gridEl.getBoundingClientRect().width;
    const deltaPx = e.clientX - this.dragStartX;
    const startTablePx = (this.startTableWidth / 100) * containerWidth;
    const newTablePx = startTablePx + deltaPx;
    const rawPct = Math.round((newTablePx / containerWidth) * 100 * 100) / 100;

    this.tableWidth = Math.max(MIN_TABLE_WIDTH, Math.min(100, rawPct));
    this.gridEl.style.width = `${this.tableWidth}%`;
  }

  private onPointerUp(): void {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;
    this.isRightEdgeDrag = false;
    this.gridEl.style.userSelect = '';

    // Clear drag indicator from the active handle
    const handleIndex = this.dragColIndex < this.handles.length ? this.dragColIndex : this.handles.length - 1;
    const activeHandle = this.handles[handleIndex];

    if (activeHandle) {
      activeHandle.style.background = '';
    }

    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);

    this.onChange([...this.colWidths], this.tableWidth);
  }

  private applyCellWidths(): void {
    const rows = this.gridEl.querySelectorAll(`[${ROW_ATTR}]`);

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      cells.forEach((node, i) => {
        if (i < this.colWidths.length) {
          const cellEl = node as HTMLElement;

          cellEl.style.width = `${this.colWidths[i]}%`;
        }
      });
    });
  }
}
