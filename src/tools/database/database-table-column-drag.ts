import type { TableState } from './database-table-grid';

const THRESHOLD = 5;

export interface TableColumnDragOptions {
  grid: HTMLElement;
  state: TableState;
  /** `beforeId` is the column now after the moved one, or null for the end. */
  onDrop: (propertyId: string, beforeId: string | null) => void;
}

/**
 * Column reorder by dragging a header left or right. A press that never moves
 * stays a click, which opens the header menu. Visuals reuse the row drag's
 * ghost and drop line; Notion's column drag look was not measured.
 */
export class DatabaseTableColumnDrag {
  private readonly grid: HTMLElement;
  private readonly state: TableState;
  private readonly onDrop: (propertyId: string, beforeId: string | null) => void;
  private press: { header: HTMLElement; x: number; y: number; offsetX: number } | null = null;
  private ghost: HTMLElement | null = null;
  private line: HTMLElement | null = null;
  private beforeId: string | null | undefined = undefined;

  constructor(options: TableColumnDragOptions) {
    this.grid = options.grid;
    this.state = options.state;
    this.onDrop = options.onDrop;
    this.grid.addEventListener('pointerdown', this.handleDown);
  }

  destroy(): void {
    this.grid.removeEventListener('pointerdown', this.handleDown);
    this.stop();
  }

  private headers(): HTMLElement[] {
    return [...this.grid.querySelectorAll<HTMLElement>('[data-blok-database-table-column-header]')];
  }

  private readonly handleDown = (event: PointerEvent): void => {
    const target = event.target instanceof Element ? event.target : null;
    const header = target?.closest<HTMLElement>('[data-blok-database-table-column-header]');

    if (header === null || header === undefined || target?.closest('[data-blok-database-table-resize]') !== null || event.button !== 0) {
      return;
    }
    this.press = { header, x: event.clientX, y: event.clientY, offsetX: event.clientX - header.getBoundingClientRect().left };
    document.addEventListener('pointermove', this.handleMove);
    document.addEventListener('pointerup', this.handleUp);
    document.addEventListener('pointercancel', this.handleCancel);
  };

  private readonly handleMove = (event: PointerEvent): void => {
    const press = this.press;

    if (press === null) {
      return;
    }
    if (this.ghost === null) {
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < THRESHOLD) {
        return;
      }
      this.start(press.header);
    }
    event.preventDefault();
    if (this.ghost !== null) {
      this.ghost.style.left = `${event.clientX - press.offsetX}px`;
    }
    this.track(event.clientX);
  };

  private start(header: HTMLElement): void {
    const rect = header.getBoundingClientRect();
    const ghost = header.cloneNode(true) as HTMLElement;

    ghost.removeAttribute('data-blok-database-table-column-header');
    ghost.removeAttribute('role');
    ghost.setAttribute('data-blok-database-table-column-ghost', '');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);
    this.ghost = ghost;

    const line = document.createElement('div');

    line.setAttribute('data-blok-database-table-column-drop-line', '');
    line.setAttribute('aria-hidden', 'true');
    this.grid.appendChild(line);
    this.line = line;
    this.state.busy = true;
  }

  private track(clientX: number): void {
    const source = this.press?.header;
    const headers = this.headers().filter((el) => el !== source);
    const rtl = getComputedStyle(this.grid).direction === 'rtl';
    const before = headers.find((el) => {
      const rect = el.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;

      return rtl ? clientX > mid : clientX < mid;
    }) ?? null;

    this.beforeId = before?.getAttribute('data-property-id') ?? null;

    const line = this.line;
    const last = headers[headers.length - 1];

    if (line === null) {
      return;
    }
    const gridRect = this.grid.getBoundingClientRect();
    const beforeRect = before?.getBoundingClientRect();
    const lastRect = last?.getBoundingClientRect();
    const beforeEdge = rtl ? beforeRect?.right : beforeRect?.left;
    const endEdge = rtl ? lastRect?.left : lastRect?.right;
    const edge = beforeEdge ?? endEdge ?? gridRect.left;

    line.style.left = `${edge - gridRect.left - 2}px`;
    line.setAttribute('data-visible', '');
  }

  private readonly handleUp = (): void => {
    const press = this.press;
    const dragged = this.ghost !== null;
    const beforeId = this.beforeId;

    this.stop();
    if (!dragged || press === null || beforeId === undefined) {
      return;
    }
    // A drag is not a click: the header must not open its menu on release.
    // On the document: the drop redraws the table, so the click lands in new DOM.
    document.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 0);

    const propertyId = press.header.getAttribute('data-property-id') ?? '';
    const headers = this.headers();
    const next = headers[headers.indexOf(press.header) + 1]?.getAttribute('data-property-id') ?? null;

    if (beforeId !== propertyId && beforeId !== next) {
      this.onDrop(propertyId, beforeId);
    }
  };

  private readonly handleCancel = (): void => {
    this.stop();
  };

  private stop(): void {
    document.removeEventListener('pointermove', this.handleMove);
    document.removeEventListener('pointerup', this.handleUp);
    document.removeEventListener('pointercancel', this.handleCancel);
    this.ghost?.remove();
    this.line?.remove();
    if (this.ghost !== null) {
      this.state.busy = false;
    }
    this.ghost = null;
    this.line = null;
    this.press = null;
    this.beforeId = undefined;
  }
}

const swallow = (event: Event): void => {
  event.stopPropagation();
  event.preventDefault();
};
