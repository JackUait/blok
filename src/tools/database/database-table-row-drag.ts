import type { TableState } from './database-table-grid';

const THRESHOLD = 5;

export interface TableRowDropResult {
  rowId: string;
  /** Row now below the dropped one, or null at the end. */
  beforeRowId: string | null;
  /** Row now above the dropped one, or null at the start. */
  afterRowId: string | null;
  /** Group the row was dropped into ('' when ungrouped). */
  groupKey: string;
  /** Group the row came from. */
  fromGroupKey: string;
}

export interface TableRowDragOptions {
  grid: HTMLElement;
  state: TableState;
  onDrop: (result: TableRowDropResult) => void;
}

/**
 * Row drag from the ⋮⋮ handle, Notion's model (research/08): a ghost row at
 * opacity 0.4, a 4px drop line between rows, no reflow animation. A press
 * that never moves stays a click, which opens the row menu.
 */
export class DatabaseTableRowDrag {
  private readonly grid: HTMLElement;
  private readonly state: TableState;
  private readonly onDrop: (result: TableRowDropResult) => void;
  private press: { rowEl: HTMLElement; x: number; y: number; offsetY: number } | null = null;
  private ghost: HTMLElement | null = null;
  private line: HTMLElement | null = null;
  private target: { before: HTMLElement | null; after: HTMLElement | null; groupKey: string } | null = null;

  constructor(options: TableRowDragOptions) {
    this.grid = options.grid;
    this.state = options.state;
    this.onDrop = options.onDrop;
    this.grid.addEventListener('pointerdown', this.handleDown);
  }

  destroy(): void {
    this.grid.removeEventListener('pointerdown', this.handleDown);
    this.stop();
  }

  private readonly handleDown = (event: PointerEvent): void => {
    const handle = event.target instanceof Element ? event.target.closest('[data-blok-database-table-row-handle]') : null;
    const rowEl = handle?.closest<HTMLElement>('[data-blok-database-table-row]');

    if (rowEl === null || rowEl === undefined || event.button !== 0) {
      return;
    }
    const rect = rowEl.getBoundingClientRect();

    this.press = { rowEl, x: event.clientX, y: event.clientY, offsetY: event.clientY - rect.top };
    document.addEventListener('pointermove', this.handleMove);
    document.addEventListener('pointerup', this.handleUp);
    document.addEventListener('pointercancel', this.handleCancel);
    document.addEventListener('keydown', this.handleKey, true);
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
      this.start(press.rowEl);
    }
    event.preventDefault();
    if (this.ghost !== null) {
      this.ghost.style.top = `${event.clientY - press.offsetY}px`;
    }
    this.track(event.clientY);
  };

  private start(rowEl: HTMLElement): void {
    const rect = rowEl.getBoundingClientRect();
    const ghost = rowEl.cloneNode(true) as HTMLElement;

    ghost.removeAttribute('data-blok-database-table-row');
    ghost.removeAttribute('role');
    ghost.setAttribute('data-blok-database-table-row-ghost', '');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    document.body.appendChild(ghost);
    this.ghost = ghost;

    const line = document.createElement('div');

    line.setAttribute('data-blok-database-table-drop-line', '');
    line.setAttribute('aria-hidden', 'true');
    this.grid.appendChild(line);
    this.line = line;
    this.state.busy = true;
    rowEl.setAttribute('data-dragging', '');
  }

  private rowEls(): HTMLElement[] {
    return [...this.grid.querySelectorAll<HTMLElement>('[data-blok-database-table-row]')];
  }

  private track(clientY: number): void {
    const source = this.press?.rowEl;
    const rows = this.rowEls().filter((el) => el !== source);
    const before = rows.find((el) => {
      const rect = el.getBoundingClientRect();

      return clientY < rect.top + rect.height / 2;
    }) ?? null;
    const index = before === null ? rows.length : rows.indexOf(before);
    const after = index > 0 ? rows[index - 1] : null;
    const groupKey = (before ?? after)?.getAttribute('data-group-key') ?? '';

    this.target = { before, after, groupKey };

    const line = this.line;

    if (line === null) {
      return;
    }
    const gridRect = this.grid.getBoundingClientRect();
    const edge = before !== null ? before.getBoundingClientRect().top : after?.getBoundingClientRect().bottom ?? gridRect.top;

    line.style.top = `${edge - gridRect.top - 2}px`;
    line.setAttribute('data-visible', '');
  }

  private readonly handleUp = (): void => {
    const press = this.press;
    const target = this.target;
    const dragged = this.ghost !== null;

    this.stop();
    if (!dragged || press === null || target === null) {
      return;
    }
    // A drag is not a click: the handle must not open its menu on release.
    this.grid.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => this.grid.removeEventListener('click', swallow, { capture: true }), 0);

    const rowId = press.rowEl.getAttribute('data-row-id') ?? '';
    const beforeRowId = target.before?.getAttribute('data-row-id') ?? null;
    const afterRowId = target.after?.getAttribute('data-row-id') ?? null;

    if (beforeRowId === rowId || afterRowId === rowId) {
      return;
    }
    this.onDrop({
      rowId,
      beforeRowId: target.before?.getAttribute('data-group-key') === target.groupKey ? beforeRowId : null,
      afterRowId: target.after?.getAttribute('data-group-key') === target.groupKey ? afterRowId : null,
      groupKey: target.groupKey,
      fromGroupKey: press.rowEl.getAttribute('data-group-key') ?? '',
    });
  };

  private readonly handleCancel = (): void => {
    this.stop();
  };

  private readonly handleKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.ghost !== null) {
      event.preventDefault();
      event.stopPropagation();
      this.stop();
    }
  };

  private stop(): void {
    document.removeEventListener('pointermove', this.handleMove);
    document.removeEventListener('pointerup', this.handleUp);
    document.removeEventListener('pointercancel', this.handleCancel);
    document.removeEventListener('keydown', this.handleKey, true);
    this.press?.rowEl.removeAttribute('data-dragging');
    this.ghost?.remove();
    this.line?.remove();
    if (this.ghost !== null) {
      this.state.busy = false;
    }
    this.ghost = null;
    this.line = null;
    this.press = null;
    this.target = null;
  }
}

const swallow = (event: Event): void => {
  event.stopPropagation();
  event.preventDefault();
};
