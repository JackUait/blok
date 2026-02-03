const RESIZE_ATTR = 'data-blok-table-resize';
const CELL_ATTR = 'data-blok-table-cell';
const ROW_ATTR = 'data-blok-table-row';
const MIN_COL_WIDTH = 10;

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
 */
export class TableResize {
  private gridEl: HTMLElement;
  private colWidths: number[];
  private onChange: (widths: number[]) => void;
  private isDragging = false;
  private dragStartX = 0;
  private dragColIndex = -1;
  private startLeftWidth = 0;
  private startRightWidth = 0;

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;

  constructor(gridEl: HTMLElement, colWidths: number[], onChange: (widths: number[]) => void) {
    this.gridEl = gridEl;
    this.colWidths = [...colWidths];
    this.onChange = onChange;

    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);

    this.gridEl.addEventListener('pointerdown', this.boundPointerDown);
  }

  public destroy(): void {
    this.gridEl.removeEventListener('pointerdown', this.boundPointerDown);
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
  }

  public updateWidths(widths: number[]): void {
    this.colWidths = [...widths];
  }

  private onPointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;

    if (!target.hasAttribute(RESIZE_ATTR)) {
      return;
    }

    e.preventDefault();

    const cell = target.closest(`[${CELL_ATTR}]`);

    if (!cell) {
      return;
    }

    this.dragColIndex = this.getCellColIndex(cell);

    if (this.dragColIndex === -1) {
      return;
    }

    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.startLeftWidth = this.colWidths[this.dragColIndex];
    this.startRightWidth = this.colWidths[this.dragColIndex + 1];

    this.gridEl.style.userSelect = 'none';

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

    const tableWidth = this.gridEl.getBoundingClientRect().width;
    const deltaPercent = ((e.clientX - this.dragStartX) / tableWidth) * 100;

    const total = this.startLeftWidth + this.startRightWidth;
    const rawLeft = this.startLeftWidth + deltaPercent;
    const rawRight = this.startRightWidth - deltaPercent;

    const [clampedLeft, clampedRight] = clampPair(rawLeft, rawRight, total);

    this.colWidths[this.dragColIndex] = clampedLeft;
    this.colWidths[this.dragColIndex + 1] = clampedRight;

    this.applyCellWidths();
  }

  private onPointerUp(): void {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;
    this.gridEl.style.userSelect = '';

    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);

    this.onChange([...this.colWidths]);
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

  private getCellColIndex(cell: Element): number {
    const row = cell.closest(`[${ROW_ATTR}]`);

    if (!row) {
      return -1;
    }

    const cells = Array.from(row.querySelectorAll(`[${CELL_ATTR}]`));

    return cells.indexOf(cell);
  }
}
