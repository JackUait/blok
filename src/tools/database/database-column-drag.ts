const DRAG_THRESHOLD = 10;

export interface ColumnDragResult {
  columnId: string;
  beforeColumnId: string | null;
  afterColumnId: string | null;
}

export interface ColumnDragOptions {
  wrapper: HTMLElement;
  onDrop: (result: ColumnDragResult) => void;
}

/**
 * Handles pointer-based drag-and-drop for kanban column reordering.
 * Horizontal-only movement; drop position determined by cursor X relative to column midpoints.
 */
export class DatabaseColumnDrag {
  private readonly wrapper: HTMLElement;
  private readonly onDrop: (result: ColumnDragResult) => void;

  private isDragging = false;
  private columnId = '';
  private startX = 0;
  private startY = 0;
  private ghostEl: HTMLElement | null = null;
  private sourceColumn: HTMLElement | null = null;

  private readonly boundPointerMove: (e: PointerEvent) => void;
  private readonly boundPointerUp: (e: PointerEvent) => void;
  private readonly boundPointerCancel: () => void;
  private readonly boundKeyDown: (e: KeyboardEvent) => void;

  constructor(options: ColumnDragOptions) {
    this.wrapper = options.wrapper;
    this.onDrop = options.onDrop;

    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundPointerCancel = this.handlePointerCancel.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
  }

  public beginTracking(columnId: string, startX: number, startY: number): void {
    this.columnId = columnId;
    this.startX = startX;
    this.startY = startY;
    this.isDragging = false;
    this.sourceColumn = this.wrapper.querySelector(`[data-column-id="${columnId}"]`);

    document.addEventListener('pointermove', this.boundPointerMove);
    document.addEventListener('pointerup', this.boundPointerUp);
    document.addEventListener('pointercancel', this.boundPointerCancel);
    document.addEventListener('keydown', this.boundKeyDown);
  }

  public cleanup(): void {
    document.removeEventListener('pointermove', this.boundPointerMove);
    document.removeEventListener('pointerup', this.boundPointerUp);
    document.removeEventListener('pointercancel', this.boundPointerCancel);
    document.removeEventListener('keydown', this.boundKeyDown);

    this.ghostEl?.remove();
    this.ghostEl = null;

    if (this.sourceColumn) {
      this.sourceColumn.style.opacity = '';
      this.sourceColumn = null;
    }

    this.isDragging = false;
    this.columnId = '';
  }

  public destroy(): void {
    this.cleanup();
  }

  private handlePointerMove(e: PointerEvent): void {
    const dx = Math.abs(e.clientX - this.startX);

    if (!this.isDragging && dx > DRAG_THRESHOLD) {
      this.isDragging = true;
      this.startActiveDrag(e);
    }

    if (this.isDragging) {
      this.updateGhostPosition(e);
    }
  }

  private handlePointerUp(e: PointerEvent): void {
    if (this.isDragging) {
      this.commitDrop(e);
    }

    this.cleanup();
  }

  private handlePointerCancel(): void {
    this.cleanup();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.cleanup();
    }
  }

  private startActiveDrag(e: PointerEvent): void {
    if (this.sourceColumn) {
      this.sourceColumn.style.opacity = '0.4';
    }

    this.createGhost(e);
  }

  private createGhost(e: PointerEvent): void {
    const ghost = document.createElement('div');

    ghost.setAttribute('data-blok-database-column-ghost', '');
    ghost.setAttribute('contenteditable', 'false');

    const style = ghost.style;

    style.position = 'fixed';
    style.pointerEvents = 'none';
    style.opacity = '0.7';
    style.zIndex = '50';

    if (this.sourceColumn) {
      const clone = this.sourceColumn.cloneNode(true) as HTMLElement;

      clone.style.opacity = '';
      ghost.appendChild(clone);

      const rect = this.sourceColumn.getBoundingClientRect();

      style.left = `${rect.left}px`;
      style.top = `${rect.top}px`;
      style.width = `${rect.width}px`;
    } else {
      style.left = `${e.clientX}px`;
      style.top = `${e.clientY}px`;
    }

    document.body.appendChild(ghost);
    this.ghostEl = ghost;
  }

  private updateGhostPosition(e: PointerEvent): void {
    if (!this.ghostEl || !this.sourceColumn) {
      return;
    }

    const rect = this.sourceColumn.getBoundingClientRect();
    const offsetX = this.startX - rect.left;

    this.ghostEl.style.left = `${e.clientX - offsetX}px`;
  }

  private getDropPosition(clientX: number): { beforeColumn: HTMLElement | null; afterColumn: HTMLElement | null } {
    const columns = Array.from(
      this.wrapper.querySelectorAll<HTMLElement>('[data-blok-database-column]')
    ).filter((col) => col.getAttribute('data-column-id') !== this.columnId);

    for (const col of columns) {
      const rect = col.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;

      if (clientX < midX) {
        const idx = columns.indexOf(col);

        return {
          beforeColumn: col,
          afterColumn: idx > 0 ? columns[idx - 1] : null,
        };
      }
    }

    return {
      beforeColumn: null,
      afterColumn: columns.length > 0 ? columns[columns.length - 1] : null,
    };
  }

  private commitDrop(e: PointerEvent): void {
    const position = this.getDropPosition(e.clientX);

    const beforeColumnId = position.beforeColumn
      ? position.beforeColumn.getAttribute('data-column-id')
      : null;

    const afterColumnId = position.afterColumn
      ? position.afterColumn.getAttribute('data-column-id')
      : null;

    this.onDrop({ columnId: this.columnId, beforeColumnId, afterColumnId });
  }
}
