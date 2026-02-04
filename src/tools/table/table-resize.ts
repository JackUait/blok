import { BORDER_WIDTH } from './table-core';

const RESIZE_ATTR = 'data-blok-table-resize';
const CELL_ATTR = 'data-blok-table-cell';
const ROW_ATTR = 'data-blok-table-row';
const MIN_COL_WIDTH = 50;
const HANDLE_HIT_WIDTH = 16;

/**
 * Handles column resize drag interaction on the table grid.
 * Each handle controls the column to its left.
 * Table width = sum of all column widths.
 */
export class TableResize {
  private gridEl: HTMLElement;
  private colWidths: number[];
  private onChange: (widths: number[]) => void;
  private isDragging = false;
  private dragStartX = 0;
  private dragColIndex = -1;
  private startColWidth = 0;
  private handles: HTMLElement[] = [];

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

    this.gridEl.style.position = 'relative';
    this.applyWidths();
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

    Array.from({ length: colCount }).forEach((_, i) => {
      const handle = this.createHandle(i);

      this.handles.push(handle);
      this.gridEl.appendChild(handle);
    });
  }

  private createHandle(colIndex: number): HTMLElement {
    const handle = document.createElement('div');
    const leftPx = this.getHandleLeftPx(colIndex);

    handle.setAttribute(RESIZE_ATTR, '');
    handle.setAttribute('data-col', String(colIndex));
    handle.style.position = 'absolute';
    handle.style.top = '0px';
    handle.style.bottom = '0px';
    handle.style.width = `${HANDLE_HIT_WIDTH}px`;
    handle.style.left = `${leftPx - HANDLE_HIT_WIDTH / 2}px`;
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

  private getHandleLeftPx(colIndex: number): number {
    return this.colWidths.slice(0, colIndex + 1).reduce((sum, w) => sum + w, 0);
  }

  private updateHandlePositions(): void {
    this.handles.forEach((handle, i) => {
      const leftPx = this.getHandleLeftPx(i);
      const handleEl: HTMLElement = handle;

      handleEl.style.left = `${leftPx - HANDLE_HIT_WIDTH / 2}px`;
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
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.startColWidth = this.colWidths[this.dragColIndex];

    this.gridEl.style.userSelect = 'none';

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

    const deltaPx = e.clientX - this.dragStartX;
    const rawWidth = this.startColWidth + deltaPx;
    const newWidth = Math.max(MIN_COL_WIDTH, rawWidth);

    this.colWidths[this.dragColIndex] = newWidth;
    this.applyWidths();
    this.updateHandlePositions();
  }

  private onPointerUp(): void {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;
    this.gridEl.style.userSelect = '';

    const activeHandle = this.handles[this.dragColIndex];

    if (activeHandle) {
      activeHandle.style.background = '';
    }

    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);

    this.onChange([...this.colWidths]);
  }

  private applyWidths(): void {
    const totalWidth = this.colWidths.reduce((sum, w) => sum + w, 0);

    this.gridEl.style.width = `${totalWidth + BORDER_WIDTH}px`;

    const rows = this.gridEl.querySelectorAll(`[${ROW_ATTR}]`);

    rows.forEach(row => {
      const cells = row.querySelectorAll(`[${CELL_ATTR}]`);

      cells.forEach((node, i) => {
        if (i < this.colWidths.length) {
          const cellEl = node as HTMLElement;

          cellEl.style.width = `${this.colWidths[i]}px`;
        }
      });
    });
  }
}
