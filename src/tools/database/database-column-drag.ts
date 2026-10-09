import { getElementDirection, inlineStartOffset } from '../../components/utils/direction';
import { copyGhostRadius } from './copy-ghost-radius';
import { DatabaseDropLine } from './database-drop-line';

const DRAG_THRESHOLD = 10;

/** Half the 12px gap between columns, so the line sits in the gap. */
const HALF_GAP = 6;

export interface GroupDragResult {
  optionId: string;
  beforeOptionId: string | null;
  afterOptionId: string | null;
}

export interface GroupDragOptions {
  wrapper: HTMLElement;
  onDrop: (result: GroupDragResult) => void;
}

/**
 * Handles pointer-based drag-and-drop for kanban column reordering.
 * Horizontal-only movement; drop position determined by cursor X relative to column midpoints.
 */
export class DatabaseColumnDrag {
  private readonly wrapper: HTMLElement;
  private readonly onDrop: (result: GroupDragResult) => void;

  private isDragging = false;
  private optionId = '';
  private startX = 0;
  private startY = 0;
  private ghostEl: HTMLElement | null = null;
  private sourceColumn: HTMLElement | null = null;
  private ghostOffsetX = 0;
  private readonly dropLine: DatabaseDropLine;

  private readonly boundPointerMove: (e: PointerEvent) => void;
  private readonly boundPointerUp: (e: PointerEvent) => void;
  private readonly boundPointerCancel: () => void;
  private readonly boundKeyDown: (e: KeyboardEvent) => void;

  constructor(options: GroupDragOptions) {
    this.wrapper = options.wrapper;
    this.onDrop = options.onDrop;
    this.dropLine = new DatabaseDropLine(options.wrapper);

    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundPointerCancel = this.handlePointerCancel.bind(this);
    this.boundKeyDown = this.handleKeyDown.bind(this);
  }

  public beginTracking(optionId: string, startX: number, startY: number): void {
    this.cleanup();
    this.optionId = optionId;
    this.startX = startX;
    this.startY = startY;
    this.isDragging = false;
    this.sourceColumn = this.wrapper.querySelector(`[data-option-id="${optionId}"]`);

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

    this.dropLine.hide();
    this.wrapper.removeAttribute('data-blok-database-column-reordering');

    if (this.sourceColumn) {
      this.sourceColumn.removeAttribute('data-blok-database-drag-source');
      this.sourceColumn = null;
    }

    this.isDragging = false;
    this.optionId = '';
    this.ghostOffsetX = 0;
  }

  /** True while a drag has passed the threshold and not yet dropped. */
  public get active(): boolean {
    return this.isDragging;
  }

  public destroy(): void {
    this.cleanup();
    this.dropLine.destroy();
  }

  private handlePointerMove(e: PointerEvent): void {
    const dx = Math.abs(e.clientX - this.startX);

    if (!this.isDragging && dx > DRAG_THRESHOLD) {
      this.isDragging = true;
      this.startActiveDrag(e);
    }

    if (this.isDragging) {
      this.updateGhostPosition(e);
      this.updateDropIndicator(e.clientX);
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
      const rect = this.sourceColumn.getBoundingClientRect();

      this.ghostOffsetX = this.startX - rect.left;
      this.sourceColumn.setAttribute('data-blok-database-drag-source', '');
    }

    this.wrapper.setAttribute('data-blok-database-column-reordering', '');
    this.createGhost(e);
  }

  private createGhost(e: PointerEvent): void {
    const ghost = document.createElement('div');

    ghost.setAttribute('data-blok-database-column-ghost', '');
    ghost.setAttribute('contenteditable', 'false');

    const style = ghost.style;

    style.position = 'fixed';
    style.pointerEvents = 'none';
    style.opacity = '0.4';
    style.zIndex = '50';
    style.overflow = 'hidden';

    if (this.sourceColumn) {
      const clone = this.sourceColumn.cloneNode(true) as HTMLElement;

      clone.removeAttribute('data-blok-database-drag-source');
      ghost.appendChild(clone);

      copyGhostRadius(this.sourceColumn, ghost);

      const rect = this.sourceColumn.getBoundingClientRect();

      style.left = `${e.clientX - this.ghostOffsetX}px`;
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
    if (!this.ghostEl) {
      return;
    }

    this.ghostEl.style.left = `${e.clientX - this.ghostOffsetX}px`;
  }

  private updateDropIndicator(clientX: number): void {
    const { beforeColumn } = this.getDropPosition(clientX);
    // The source column stays in place, so it counts as a neighbour for the line.
    const visible = Array.from(this.wrapper.querySelectorAll<HTMLElement>('[data-blok-database-column]'));
    const rtl = getElementDirection(this.wrapper) === 'rtl';
    const startOf = (rect: DOMRect): number => (rtl ? rect.right : rect.left);
    const endOf = (rect: DOMRect): number => (rtl ? rect.left : rect.right);
    const outward = rtl ? -HALF_GAP : HALF_GAP;

    if (beforeColumn !== null) {
      const rect = beforeColumn.getBoundingClientRect();
      const previous = visible[visible.indexOf(beforeColumn) - 1];
      const centerX = previous === undefined
        ? startOf(rect) - outward
        : (endOf(previous.getBoundingClientRect()) + startOf(rect)) / 2;

      this.dropLine.showVertical({ centerX, top: rect.top, height: rect.height });

      return;
    }

    const last = visible.at(-1);

    if (last === undefined) {
      this.dropLine.hide();

      return;
    }

    const rect = last.getBoundingClientRect();

    this.dropLine.showVertical({ centerX: endOf(rect) + outward, top: rect.top, height: rect.height });
  }

  private getDropPosition(clientX: number): { beforeColumn: HTMLElement | null; afterColumn: HTMLElement | null } {
    const columns = Array.from(
      this.wrapper.querySelectorAll<HTMLElement>('[data-blok-database-column]')
    ).filter((col) => col.getAttribute('data-option-id') !== this.optionId);
    const direction = getElementDirection(this.wrapper);

    for (const col of columns) {
      const rect = col.getBoundingClientRect();

      if (inlineStartOffset(clientX, rect, direction) < rect.width / 2) {
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

    const beforeOptionId = position.beforeColumn
      ? position.beforeColumn.getAttribute('data-option-id')
      : null;

    const afterOptionId = position.afterColumn
      ? position.afterColumn.getAttribute('data-option-id')
      : null;

    this.onDrop({ optionId: this.optionId, beforeOptionId, afterOptionId });
  }
}
