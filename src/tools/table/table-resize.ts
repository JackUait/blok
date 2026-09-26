import { BORDER_WIDTH, CELL_ATTR, CELL_COL_ATTR, MIN_COL_WIDTH, ROW_ATTR } from './table-core';

const RESIZE_ATTR = 'data-blok-table-resize';
const HANDLE_HIT_WIDTH = 16;
/** Two clicks on the same handle within this window count as a double-click. */
const DBLCLICK_MS = 300;

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
  private onResetWidths: (() => void) | null;
  private isDragging = false;
  private dragStartX = 0;
  private dragColIndex = -1;
  private startColWidth = 0;
  /** True once a drag has moved — so a no-move press-release reads as a click. */
  private didDrag = false;
  /** Timestamp + column of the last press-release, for double-click detection. */
  private lastClickTime = 0;
  private lastClickCol = -1;
  private dragColElements: HTMLElement[] | null = null;
  private handles: HTMLElement[] = [];
  private needsInitialApply: boolean;
  private bodyObserver: MutationObserver | null = null;
  private rowObserver: ResizeObserver | null = null;

  private boundPointerDown: (e: PointerEvent) => void;
  private boundPointerMove: (e: PointerEvent) => void;
  private boundPointerUp: (e: PointerEvent) => void;
  private boundPointerCancel: (e: PointerEvent) => void;

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

  constructor(gridEl: HTMLElement, colWidths: number[], onChange: (widths: number[]) => void, onDragStart?: () => void, onDrag?: () => void, skipInitialApply = false, onResetWidths?: () => void) {
    this.gridEl = gridEl;
    this.colWidths = [...colWidths];
    this.onChange = onChange;
    this.onDragStart = onDragStart ?? null;
    this.onDrag = onDrag ?? null;
    this.onResetWidths = onResetWidths ?? null;
    this.needsInitialApply = skipInitialApply;

    this.boundPointerDown = this.onPointerDown.bind(this);
    this.boundPointerMove = this.onPointerMove.bind(this);
    this.boundPointerUp = this.onPointerEnd.bind(this);
    this.boundPointerCancel = this.onPointerEnd.bind(this);

    this.gridEl.style.position = 'relative';

    if (!skipInitialApply) {
      this.applyWidths();
    }

    this.createHandles();
    this.watchRows();

    this.gridEl.addEventListener('pointerdown', this.boundPointerDown);
  }

  public destroy(): void {
    this.bodyObserver?.disconnect();
    this.bodyObserver = null;
    this.rowObserver?.disconnect();
    this.rowObserver = null;
    this.gridEl.removeEventListener('pointerdown', this.boundPointerDown);
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('pointercancel', this.boundPointerCancel);
    this.dragColElements = null;

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

    handle.setAttribute(RESIZE_ATTR, '');
    handle.setAttribute('data-col', String(colIndex));
    handle.style.position = 'absolute';
    handle.style.top = `-${BORDER_WIDTH}px`;
    handle.style.bottom = '0px';
    handle.style.width = `${HANDLE_HIT_WIDTH}px`;
    handle.style.left = `${this.getHandleOffsetPx(colIndex)}px`;
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

  /**
   * Keep each handle off the rows where a merged cell hides its border.
   * The handle is a full-height strip above the cells and its pointerdown
   * calls preventDefault, so over a merged cell it would eat the click.
   * clip-path also clips hit testing, so the strip stays one element.
   *
   * Merge and split swap the <tbody> without re-creating TableResize, and
   * typing changes row heights, so both are watched.
   */
  private watchRows(): void {
    this.bodyObserver = new MutationObserver(() => this.observeRowSizes());
    this.bodyObserver.observe(this.gridEl, { childList: true });
    this.observeRowSizes();
  }

  /**
   * A new ResizeObserver reports each rendered row once on observe(), and
   * that report clips the handles, so clipping here too would measure twice.
   */
  private observeRowSizes(): void {
    if (typeof ResizeObserver === 'undefined') {
      this.clipHandlesToVisibleBorders();

      return;
    }

    this.rowObserver?.disconnect();
    this.rowObserver = new ResizeObserver(() => this.clipHandlesToVisibleBorders());
    this.bodyRows().forEach(row => this.rowObserver?.observe(row));
  }

  private bodyRows(): HTMLElement[] {
    return Array.from(this.gridEl.querySelectorAll<HTMLElement>(`:scope > tbody > [${ROW_ATTR}]`));
  }

  /**
   * For each border index, the rows where a merged cell spans across it.
   * Border `c` is the right edge of column `c`.
   */
  private crossedRowsByBorder(rows: HTMLElement[]): Map<number, Set<number>> {
    const crossed = new Map<number, Set<number>>();

    rows.forEach((row, r) => {
      row.querySelectorAll<HTMLTableCellElement>(`:scope > [${CELL_ATTR}]`).forEach(cell => {
        const col = Number(cell.getAttribute(CELL_COL_ATTR));
        const colSpan = cell.colSpan || 1;
        const rowSpan = cell.rowSpan || 1;

        if (colSpan < 2 || Number.isNaN(col)) {
          return;
        }

        Array.from({ length: colSpan - 1 }, (_, i) => col + i).forEach(border => {
          const set = crossed.get(border) ?? new Set<number>();

          Array.from({ length: rowSpan }, (_, i) => r + i).forEach(covered => set.add(covered));
          crossed.set(border, set);
        });
      });
    });

    return crossed;
  }

  private clipHandlesToVisibleBorders(): void {
    const rows = this.bodyRows();
    const crossed = this.crossedRowsByBorder(rows);

    this.handles.forEach((handle, border) => {
      const el: HTMLElement = handle;
      const hidden = crossed.get(border);
      const clip = hidden === undefined ? '' : this.clipForVisibleRows(el, rows, hidden);

      if (el.style.clipPath !== clip) {
        el.style.clipPath = clip;
      }
    });
  }

  /**
   * A clip that keeps only the runs of rows where the border is visible,
   * in the handle's own coordinates. The first and last runs reach the
   * handle's ends so the table's top border stays grabbable.
   */
  private clipForVisibleRows(handle: HTMLElement, rows: HTMLElement[], hidden: Set<number>): string {
    const handleRect = handle.getBoundingClientRect();
    const runs: Array<[number, number]> = [];

    rows.forEach((row, r) => {
      if (hidden.has(r)) {
        return;
      }

      const rowRect = row.getBoundingClientRect();
      const top = r === 0 ? 0 : rowRect.top - handleRect.top;
      const bottom = r === rows.length - 1 ? handleRect.height : rowRect.bottom - handleRect.top;
      const last = runs[runs.length - 1];

      if (last !== undefined && !hidden.has(r - 1) && r > 0) {
        last[1] = bottom;
      } else {
        runs.push([top, bottom]);
      }
    });

    if (runs.length === 0) {
      return 'inset(50%)';
    }

    const round = (n: number): number => Math.round(n * 100) / 100;
    const path = runs
      .map(([top, bottom]) => `M0 ${round(top)} H${HANDLE_HIT_WIDTH} V${round(bottom)} H0 Z`)
      .join('');

    return `path('${path}')`;
  }

  private getHandleLeftPx(colIndex: number): number {
    return this.colWidths.slice(0, colIndex + 1).reduce((sum, w) => sum + w, 0);
  }

  /**
   * `left` offset of a handle, clamped so the handle NEVER pokes outside the
   * grid's own box.
   *
   * A handle is a HANDLE_HIT_WIDTH-wide hit area centred on the column border
   * it controls. For the last column that border IS the table's right edge, so
   * a centred handle would hang HANDLE_HIT_WIDTH / 2 px past the grid — and the
   * grid lives inside an `overflow-x: auto` scroll container (every table has
   * one, see Table.render), which counts that overhang as scrollable content.
   * A table that fits its container would then grow a horizontal scrollbar and
   * a right-edge haze. Clamping shifts the last handle inwards so its right
   * edge lands exactly ON the border: still straddling/touching it, still
   * grabbable, but contributing nothing to scrollWidth.
   */
  private getHandleOffsetPx(colIndex: number): number {
    const centred = this.getHandleLeftPx(colIndex) - HANDLE_HIT_WIDTH / 2;
    const gridWidth = this.colWidths.reduce((sum, w) => sum + w, 0);

    return Math.max(0, Math.min(centred, gridWidth - HANDLE_HIT_WIDTH));
  }

  private updateHandlePositions(): void {
    this.handles.forEach((handle, i) => {
      const handleEl: HTMLElement = handle;

      handleEl.style.left = `${this.getHandleOffsetPx(i)}px`;
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

    const colIndex = Number(colStr);

    /**
     * Notion parity: double-clicking a column border resets the table to evenly
     * distributed, page-fitted columns — the inline equivalent of the settings
     * menu's "Fit to page width", reachable without opening any menu. Detected
     * from pointer events because the pointerdown preventDefault() above
     * suppresses the native dblclick. A second press on the same handle within
     * DBLCLICK_MS of a no-drag release counts as the double-click.
     */
    const now = Date.now();
    const isDoubleClick = this.onResetWidths !== null &&
      !this.didDrag &&
      this.lastClickCol === colIndex &&
      now - this.lastClickTime < DBLCLICK_MS;

    if (isDoubleClick) {
      this.lastClickTime = 0;
      this.lastClickCol = -1;
      this.onResetWidths?.();

      return;
    }

    this.dragColIndex = colIndex;
    this.didDrag = false;
    this.isDragging = true;
    this.dragStartX = e.clientX;
    this.startColWidth = this.colWidths[this.dragColIndex];
    this.dragColElements = this.resolveColElements();

    this.onDragStart?.();
    this.gridEl.style.userSelect = 'none';

    target.style.opacity = '1';

    if (target.setPointerCapture) {
      target.setPointerCapture(e.pointerId);
    }

    document.addEventListener('pointermove', this.boundPointerMove);
    document.addEventListener('pointerup', this.boundPointerUp);
    // With pointer capture the browser fires pointercancel INSTEAD of pointerup
    // when it takes the gesture over (touch pan, device disruption). Without
    // this listener the drag would stay "active" forever: dangling document
    // listeners, userSelect:none stuck on the grid — and onChange never called,
    // so the widths already painted into the DOM never reach the model.
    document.addEventListener('pointercancel', this.boundPointerCancel);
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isDragging) {
      return;
    }

    const deltaPx = e.clientX - this.dragStartX;
    const rawWidth = this.startColWidth + deltaPx;
    const newWidth = Math.max(MIN_COL_WIDTH, rawWidth);

    // Only a width-changing move counts as a drag. A 0-delta pointermove (some
    // browsers emit one between the clicks of a double-click) must NOT flag a
    // drag, or it would defeat the double-click reset detection.
    if (newWidth !== this.startColWidth) {
      this.didDrag = true;
    }
    this.colWidths[this.dragColIndex] = newWidth;
    this.applyWidths(this.dragColElements ?? undefined);
    this.updateHandlePositions();
    this.onDrag?.();
  }

  /**
   * End of a resize drag — pointerup AND pointercancel.
   *
   * A cancelled drag COMMITS rather than aborts: every pointermove has already
   * written its widths into the <col> elements and the grid width, so bailing
   * out without committing would leave the DOM resized while the model still
   * holds the old widths — the table would silently snap back on the next
   * render/save. Committing keeps model and DOM in agreement and keeps the
   * result the user was looking at when the gesture was taken away.
   */
  private onPointerEnd(): void {
    if (!this.isDragging) {
      return;
    }

    this.isDragging = false;
    this.gridEl.style.userSelect = '';

    // Record this release for double-click detection: a no-drag release arms the
    // next press on the same handle to be treated as a double-click.
    this.lastClickTime = Date.now();
    this.lastClickCol = this.dragColIndex;

    const activeHandle = this.handles[this.dragColIndex];

    if (activeHandle) {
      activeHandle.style.opacity = '0';
    }

    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('pointercancel', this.boundPointerCancel);
    this.dragColElements = null;

    this.onChange([...this.colWidths]);
  }

  private resolveColElements(): HTMLElement[] {
    const colgroup = this.gridEl.querySelector('colgroup');

    if (!colgroup) {
      return [];
    }

    return Array.from(colgroup.querySelectorAll<HTMLElement>('col'));
  }

  private applyWidths(cols: HTMLElement[] = this.resolveColElements()): void {
    const totalWidth = this.colWidths.reduce((sum, w) => sum + w, 0);

    this.gridEl.style.width = `${totalWidth + BORDER_WIDTH}px`;
    // Leaving fluid mode: the percent-mode floor would fight the pinned width.
    this.gridEl.style.minWidth = '';

    cols.forEach((colEl, i) => {
      if (i < this.colWidths.length) {
        const el: HTMLElement = colEl;

        el.style.width = `${this.colWidths[i]}px`;
      }
    });
  }
}
