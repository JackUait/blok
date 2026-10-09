import type { TableState } from './database-table-grid';

const MIN_WIDTH = 32;

export interface ColumnResizeOptions {
  grid: HTMLElement;
  state: TableState;
  onCommit: (propertyId: string, width: number) => void;
  /** Width that fits the column's widest content. */
  measure: (propertyId: string) => number;
}

/**
 * Column resize from the 5px handle at a header's end edge. The width follows
 * the pointer live with no transition; one write lands on release.
 * A double-click fits the column to its content.
 */
export class DatabaseTableColumnResize {
  private readonly grid: HTMLElement;
  private readonly state: TableState;
  private readonly onCommit: (propertyId: string, width: number) => void;
  private readonly measure: (propertyId: string) => number;
  private drag: { propertyId: string; startX: number; startWidth: number; width: number; rtl: boolean } | null = null;

  constructor(options: ColumnResizeOptions) {
    this.grid = options.grid;
    this.state = options.state;
    this.onCommit = options.onCommit;
    this.measure = options.measure;
    this.grid.addEventListener('pointerdown', this.handleDown);
    this.grid.addEventListener('dblclick', this.handleDoubleClick);
  }

  destroy(): void {
    this.grid.removeEventListener('pointerdown', this.handleDown);
    this.grid.removeEventListener('dblclick', this.handleDoubleClick);
    this.stop();
  }

  private header(target: EventTarget | null): { handle: HTMLElement; propertyId: string; header: HTMLElement } | null {
    const handle = target instanceof Element ? target.closest<HTMLElement>('[data-blok-database-table-resize]') : null;
    const header = handle?.closest<HTMLElement>('[data-blok-database-table-column-header]');
    const propertyId = header?.getAttribute('data-property-id');

    return handle !== null && handle !== undefined && header !== null && header !== undefined && typeof propertyId === 'string'
      ? { handle, propertyId, header }
      : null;
  }

  private readonly handleDown = (event: PointerEvent): void => {
    const found = this.header(event.target);

    if (found === null || event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const width = found.header.getBoundingClientRect().width || parseFloat(found.header.style.width) || 0;

    this.drag = {
      propertyId: found.propertyId,
      startX: event.clientX,
      startWidth: width,
      width,
      rtl: getComputedStyle(this.grid).direction === 'rtl',
    };
    this.state.busy = true;
    found.handle.setAttribute('data-active', '');
    this.grid.setAttribute('data-resizing', '');
    document.addEventListener('pointermove', this.handleMove);
    document.addEventListener('pointerup', this.handleUp);
    document.addEventListener('pointercancel', this.handleCancel);
  };

  private readonly handleMove = (event: PointerEvent): void => {
    const drag = this.drag;

    if (drag === null) {
      return;
    }
    const delta = (event.clientX - drag.startX) * (drag.rtl ? -1 : 1);

    drag.width = Math.max(MIN_WIDTH, Math.round(drag.startWidth + delta));
    this.applyWidth(drag.propertyId, drag.width);
  };

  private readonly handleUp = (): void => {
    const drag = this.drag;

    this.stop();
    if (drag !== null && drag.width !== Math.round(drag.startWidth)) {
      this.onCommit(drag.propertyId, drag.width);
    }
  };

  private readonly handleCancel = (): void => {
    const drag = this.drag;

    this.stop();
    if (drag !== null) {
      this.applyWidth(drag.propertyId, drag.startWidth);
    }
  };

  private readonly handleDoubleClick = (event: MouseEvent): void => {
    const found = this.header(event.target);

    if (found === null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const width = this.measure(found.propertyId);

    this.applyWidth(found.propertyId, width);
    this.onCommit(found.propertyId, width);
  };

  /** Every cell of the column: header, body cells and footer. */
  private applyWidth(propertyId: string, width: number): void {
    const escaped = CSS.escape(propertyId);

    this.grid.querySelectorAll<HTMLElement>(`[data-property-id="${escaped}"]`).forEach(({ style }) => {
      style.setProperty('width', `${width}px`);
    });
  }

  private stop(): void {
    document.removeEventListener('pointermove', this.handleMove);
    document.removeEventListener('pointerup', this.handleUp);
    document.removeEventListener('pointercancel', this.handleCancel);
    this.grid.querySelector('[data-blok-database-table-resize][data-active]')?.removeAttribute('data-active');
    this.grid.removeAttribute('data-resizing');
    if (this.drag !== null) {
      this.drag = null;
      this.state.busy = false;
    }
  }
}
