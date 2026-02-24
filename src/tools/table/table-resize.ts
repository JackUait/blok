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
  private _enabled = true;

  private gridEl: HTMLElement;
  private colWidths: number[];
  private onChange: (widths: number[]) => void;
  private onDragStart: (() => void) | null;
  private onDrag: (() => void) | null;
  private isDragging = false;
  private dragStartX = 0;
  private dragColIndex = -1;
  private startColWidth = 0;
  private dragRowCells: HTMLElement[][] | null = null;
  private handles: HTMLElement[] = [];
  private needsInitialApply: boolean;

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;

  public get enabled(): boolean {
    return this._enabled;
  }

  public set enabled(value: boolean) {
    this._enabled = value;

    const pointerEvents = value ? '' : 'none';

    this.handles.forEach(handle => {
      const el: HTMLElement = handle;

      el.style.pointerEvents = pointerEvents;
    });
  }

  constructor(gridEl: HTMLElement, colWidths: number[], onChange: (widths: number[]) => void, onDragStart?: () => void, onDrag?: () => void, skipInitialApply = false) {
    this.gridEl = gridEl;
    this.colWidths = [...colWidths];
    this.onChange = onChange;
    this.onDragStart = onDragStart ?? null;
    this.onDrag = onDrag ?? null;
    this.needsInitialApply = skipInitialApply;

    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerUp.bind(this);

    this.gridEl.style.position = 'relative';

    if (!skipInitialApply) {
      this.applyWidths();
    }

    this.createHandles();

    this.gridEl.addEventListener('pointerdown', this.boundPointerDown);
  }

  public destroy(): void {
    this.gridEl.removeEventListener('pointerdown', this.boundPointerDown);
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    this.dragRowCells = null;

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
    handle.style.top = `-${BORDER_WIDTH}px`;
    handle.style.bottom = '0px';
    handle.style.width = `${HANDLE_HIT_WIDTH}px`;
    handle.style.left = `${leftPx - HANDLE_HIT_WIDTH / 2}px`;
    handle.style.cursor = 'col-resize';
    handle.style.zIndex = '2';
    handle.style.background = 'linear-gradient(to right, transparent 7px, #3b82f6 7px, #3b82f6 9px, transparent 9px)';
    handle.style.opacity = '0';
    handle.style.transition = 'opacity 150ms ease';
    handle.setAttribute('contenteditable', 'false');

    handle.addEventListener('mouseenter', () => {
      if (!this.isDragging) {
        handle.style.opacity = '1';
      }
    });

    handle.addEventListener('mouseleave', () => {
      if (!this.isDragging) {
        handle.style.opacity = '0';
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
    if (!this._enabled) {
      return;
    }

    const target = e.target as HTMLElement;

    if (!target.hasAttribute(RESIZE_ATTR)) {
      return;
    }

    e.preventDefault();

    if (this.needsInitialApply) {
      this.applyWidths();
      this.updateHandlePositions();
      this.needsInitialApply = false;
    }

    const colStr = target.getAttribute('data-col');

    if (colStr === null) {
      return;
    }

    this.dragColIndex = Number(colStr);
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.startColWidth = this.colWidths[this.dragColIndex];
    this.dragRowCells = this.resolveRowCells();

    this.onDragStart?.();
    this.gridEl.style.userSelect = 'none';

    target.style.opacity = '1';

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
    this.applyWidths(this.dragRowCells ?? undefined);
    this.updateHandlePositions();
    this.onDrag?.();
  }

  private onPointerUp(): void {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;
    this.gridEl.style.userSelect = '';

    const activeHandle = this.handles[this.dragColIndex];

    if (activeHandle) {
      activeHandle.style.opacity = '0';
    }

    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    this.dragRowCells = null;

    this.onChange([...this.colWidths]);
  }

  private resolveRowCells(): HTMLElement[][] {
    const rows = this.gridEl.querySelectorAll<HTMLElement>(`[${ROW_ATTR}]`);

    return Array.from(rows, row => Array.from(row.querySelectorAll<HTMLElement>(`[${CELL_ATTR}]`)));
  }

  private applyWidths(rowCells: HTMLElement[][] = this.resolveRowCells()): void {
    const totalWidth = this.colWidths.reduce((sum, w) => sum + w, 0);

    this.gridEl.style.width = `${totalWidth + BORDER_WIDTH}px`;

    rowCells.forEach(cells => {
      cells.forEach((cellEl, i) => {
        if (i < this.colWidths.length) {
          cellEl.style.setProperty('width', `${this.colWidths[i]}px`);
        }
      });
    });
  }
}
