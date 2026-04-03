const DRAG_THRESHOLD = 10;

export interface ListRowDragResult {
  rowId: string;
  beforeRowId: string | null;
  afterRowId: string | null;
}

export interface ListRowDragOptions {
  wrapper: HTMLElement;
  onDrop: (result: ListRowDragResult) => void;
}

/**
 * Handles pointer-based drag-and-drop for list rows.
 * Supports vertical-only movement for reordering rows within a list.
 */
export class DatabaseListRowDrag {
  private readonly wrapper: HTMLElement;
  private readonly onDrop: (result: ListRowDragResult) => void;

  private isDragging = false;
  private rowId = '';
  private startY = 0;
  private ghostEl: HTMLElement | null = null;
  private sourceRow: HTMLElement | null = null;
  private sourceRowHeight = 0;
  private ghostOffsetY = 0;
  private gapTarget: HTMLElement | null = null;

  private readonly boundPointerMove: (e: PointerEvent) => void;
  private readonly boundPointerUp: (e: PointerEvent) => void;
  private readonly boundPointerCancel: () => void;
  private readonly boundKeyDown: (e: KeyboardEvent) => void;

  constructor(options: ListRowDragOptions) {
    this.wrapper = options.wrapper;
    this.onDrop = options.onDrop;

    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundPointerCancel = this.handlePointerCancel.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
  }

  /**
   * Start tracking pointer after a pointerdown on a list row.
   */
  public beginTracking(rowId: string, startX: number, startY: number): void {
    this.cleanup();
    this.rowId = rowId;
    this.startY = startY;
    this.isDragging = false;
    this.sourceRow = this.wrapper.querySelector(`[data-row-id="${rowId}"]`);

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

    this.clearGap();

    if (this.sourceRow) {
      this.sourceRow.style.opacity = '';
      this.sourceRow = null;
    }

    this.isDragging = false;
    this.rowId = '';
    this.sourceRowHeight = 0;
    this.ghostOffsetY = 0;
  }

  public destroy(): void {
    this.cleanup();
  }

  private handlePointerMove(e: PointerEvent): void {
    const dy = Math.abs(e.clientY - this.startY);

    if (!this.isDragging && dy > DRAG_THRESHOLD) {
      this.isDragging = true;
      this.startActiveDrag(e);
    }

    if (this.isDragging) {
      this.updateGhostPosition(e);
      this.updateDropIndicator(e);
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
    if (this.sourceRow) {
      const rect = this.sourceRow.getBoundingClientRect();

      this.sourceRowHeight = rect.height;
      this.ghostOffsetY = this.startY - rect.top;
      this.sourceRow.style.opacity = '0.4';
    }

    this.createGhost(e);
  }

  private createGhost(e: PointerEvent): void {
    const ghost = document.createElement('div');

    ghost.setAttribute('data-blok-database-ghost', '');
    ghost.setAttribute('contenteditable', 'false');

    const style = ghost.style;

    style.position = 'fixed';
    style.pointerEvents = 'none';
    style.opacity = '0.85';
    style.zIndex = '50';
    style.boxShadow = '0 12px 28px rgba(0, 0, 0, 0.2), 0 4px 10px rgba(0, 0, 0, 0.1)';
    style.borderRadius = '8px';
    style.overflow = 'hidden';

    if (this.sourceRow) {
      const clone = this.sourceRow.cloneNode(true) as HTMLElement;

      clone.style.opacity = '';
      ghost.appendChild(clone);

      const rect = this.sourceRow.getBoundingClientRect();

      style.left = `${rect.left}px`;
      style.top = `${e.clientY - this.ghostOffsetY}px`;
      style.width = `${rect.width}px`;
    } else {
      style.left = '0px';
      style.top = `${e.clientY}px`;
    }

    document.body.appendChild(ghost);
    this.ghostEl = ghost;
  }

  private updateGhostPosition(e: PointerEvent): void {
    if (!this.ghostEl) {
      return;
    }

    this.ghostEl.style.top = `${e.clientY - this.ghostOffsetY}px`;
  }

  private updateDropIndicator(e: PointerEvent): void {
    const position = this.getDropPosition(e.clientY);
    const beforeEl = position.beforeEl as HTMLElement | null;

    if (beforeEl) {
      if (beforeEl === this.gapTarget) {
        return;
      }

      this.clearGap();
      beforeEl.style.marginTop = `${this.sourceRowHeight}px`;
      this.gapTarget = beforeEl;
    } else {
      this.clearGap();
    }
  }

  private clearGap(): void {
    if (this.gapTarget) {
      this.gapTarget.style.marginTop = '';
      this.gapTarget = null;
    }
  }

  private getDropPosition(clientY: number): { beforeEl: Element | null } {
    const rows = Array.from(
      this.wrapper.querySelectorAll<HTMLElement>('[data-blok-database-list-row]')
    ).filter((row) => row.getAttribute('data-row-id') !== this.rowId);

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;

      if (clientY < midY) {
        return { beforeEl: row };
      }
    }

    return { beforeEl: null };
  }

  private commitDrop(e: PointerEvent): void {
    const position = this.getDropPosition(e.clientY);
    const rows = Array.from(
      this.wrapper.querySelectorAll<HTMLElement>('[data-blok-database-list-row]')
    ).filter((row) => row.getAttribute('data-row-id') !== this.rowId);

    const beforeRowId: string | null = position.beforeEl
      ? position.beforeEl.getAttribute('data-row-id')
      : null;

    const beforeIndex = position.beforeEl ? rows.indexOf(position.beforeEl as HTMLElement) : -1;

    const afterRowId = this.resolveAfterRowId(position.beforeEl, rows, beforeIndex);

    this.onDrop({ rowId: this.rowId, beforeRowId, afterRowId });
  }

  private resolveAfterRowId(
    beforeEl: Element | null,
    rows: HTMLElement[],
    beforeIndex: number
  ): string | null {
    if (beforeEl) {
      return beforeIndex > 0 ? rows[beforeIndex - 1].getAttribute('data-row-id') : null;
    }

    return rows.length > 0 ? rows[rows.length - 1].getAttribute('data-row-id') : null;
  }
}
