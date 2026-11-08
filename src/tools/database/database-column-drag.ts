import { getElementDirection, inlineStartOffset } from '../../components/utils/direction';
import { mountGhost } from './copy-ghost-radius';

const DRAG_THRESHOLD = 10;

/** A header's slot: its column, or a sub-grouped board's head (lane columns have no header). Slots never move. */
const SLOT_SELECTOR = '[data-blok-database-column]:not([data-sub-group]), [data-blok-database-board-column-head]';

const HEADER_SELECTOR = ':scope > [data-blok-database-column-header]';

const SLIDING = 'data-blok-database-column-sliding';

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
 * As in Notion, only the header strip follows the pointer and the other headers slide into
 * the order the drop would give; the cards stay put until the drop.
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
  /** Where the dragged header would land among the other slots; -1 before the first move. */
  private targetIndex = -1;

  private readonly boundPointerMove: (e: PointerEvent) => void;
  private readonly boundPointerUp: (e: PointerEvent) => void;
  private readonly boundPointerCancel: () => void;
  private readonly boundKeyDown: (e: KeyboardEvent) => void;

  constructor(options: GroupDragOptions) {
    this.wrapper = options.wrapper;
    this.onDrop = options.onDrop;

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
    this.sourceColumn = this.slots().find((slot) => slot.getAttribute('data-option-id') === optionId) ?? null;

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

    // The reordering attribute holds the transition, so removing it in the same task snaps the headers home.
    this.wrapper.removeAttribute('data-blok-database-column-reordering');
    for (const slot of this.slots()) {
      this.headerOf(slot)?.style.removeProperty('transform');
      this.headerOf(slot)?.removeAttribute(SLIDING);
    }
    this.targetIndex = -1;

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
  }

  private handlePointerMove(e: PointerEvent): void {
    const dx = Math.abs(e.clientX - this.startX);

    if (!this.isDragging && dx > DRAG_THRESHOLD) {
      this.isDragging = true;
      this.startActiveDrag(e);
    }

    if (this.isDragging) {
      this.updateGhostPosition(e);
      this.slideHeaders(e.clientX);
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
    style.zIndex = '50';
    style.overflow = 'hidden';

    const header = this.sourceColumn === null ? null : this.headerOf(this.sourceColumn);

    if (this.sourceColumn !== null && header !== null) {
      const slot = this.sourceColumn;
      const computed = getComputedStyle(slot);
      const slotRect = slot.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const clone = header.cloneNode(true) as HTMLElement;

      ghost.appendChild(clone);

      // The slot's padding keeps the pill where it was; its tint paints the strip (database.css).
      style.paddingLeft = computed.paddingLeft;
      style.paddingRight = computed.paddingRight;
      style.borderTopLeftRadius = computed.borderTopLeftRadius;
      style.borderTopRightRadius = computed.borderTopRightRadius;
      style.borderBottomRightRadius = '0px';
      style.borderBottomLeftRadius = '0px';

      const tint = slot.style.getPropertyValue('--_blok-group-tint');

      if (tint !== '') {
        style.setProperty('--_blok-group-tint', tint);
      }

      style.left = `${e.clientX - this.ghostOffsetX}px`;
      style.top = `${headerRect.top}px`;
      style.width = `${slotRect.width}px`;
      style.height = `${headerRect.height}px`;
    } else {
      style.left = `${e.clientX}px`;
      style.top = `${e.clientY}px`;
    }

    mountGhost(this.sourceColumn ?? this.wrapper, ghost);
    this.ghostEl = ghost;
  }

  private updateGhostPosition(e: PointerEvent): void {
    if (!this.ghostEl) {
      return;
    }

    this.ghostEl.style.left = `${e.clientX - this.ghostOffsetX}px`;
  }

  /** Slides the other headers into the order the drop would give. Writes only when the target slot changes. */
  private slideHeaders(clientX: number): void {
    const slots = this.slots();
    const source = this.sourceColumn;

    if (source === null || !slots.includes(source)) {
      return;
    }

    const others = slots.filter((slot) => slot !== source);
    const { beforeColumn } = this.getDropPosition(clientX);
    const index = beforeColumn === null ? others.length : others.indexOf(beforeColumn);

    if (index === this.targetIndex) {
      return;
    }

    this.targetIndex = index;

    const order = [...others.slice(0, index), source, ...others.slice(index)];
    const lefts = slots.map((slot) => slot.getBoundingClientRect().left);

    others.forEach((slot) => {
      const header = this.headerOf(slot);
      const dx = (lefts[order.indexOf(slot)] ?? 0) - (lefts[slots.indexOf(slot)] ?? 0);

      if (header === null) {
        return;
      }
      if (dx === 0) {
        header.style.removeProperty('transform');
      } else {
        header.style.transform = `translateX(${dx}px)`;
      }
      // A moved header carries its own tint over the column it now sits on.
      header.toggleAttribute(SLIDING, dx !== 0);
    });
  }

  private slots(): HTMLElement[] {
    return Array.from(this.wrapper.querySelectorAll<HTMLElement>(SLOT_SELECTOR));
  }

  private headerOf(slot: HTMLElement): HTMLElement | null {
    return slot.querySelector<HTMLElement>(HEADER_SELECTOR);
  }

  private getDropPosition(clientX: number): { beforeColumn: HTMLElement | null; afterColumn: HTMLElement | null } {
    const columns = this.slots().filter((col) => col.getAttribute('data-option-id') !== this.optionId);
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
