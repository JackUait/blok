const CORNER_DRAG_ATTR = 'data-blok-table-corner-drag';
const CORNER_TOOLTIP_ATTR = 'data-blok-table-corner-tooltip';

export interface TableCornerDragOptions {
  wrapper: HTMLElement;
  gridEl: HTMLElement;
  onAddRow: () => void;
  onAddColumn: () => void;
  onRemoveLastRow: () => void;
  onRemoveLastColumn: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  getTableSize: () => { rows: number; cols: number };
  canRemoveLastRow: () => boolean;
  canRemoveLastColumn: () => boolean;
}

const DRAG_THRESHOLD = 5;

interface DragState {
  startX: number;
  startY: number;
  unitWidth: number;
  unitHeight: number;
  addedRows: number;
  addedCols: number;
  pointerId: number;
  didDrag: boolean;
}

export class TableCornerDrag {
  private wrapper: HTMLElement;
  private gridEl: HTMLElement;
  private hitZone: HTMLElement;
  private tooltip: HTMLElement;
  private getTableSize: () => { rows: number; cols: number };
  private onAddRow: () => void;
  private onAddColumn: () => void;
  private onRemoveLastRow: () => void;
  private onRemoveLastColumn: () => void;
  private onDragStart: () => void;
  private onDragEnd: () => void;
  private canRemoveLastRow: () => boolean;
  private canRemoveLastColumn: () => boolean;
  private dragState: DragState | null = null;
  private readonly boundMouseEnter: () => void;
  private readonly boundMouseLeave: () => void;
  private readonly boundPointerDown: (e: PointerEvent) => void;
  private readonly boundPointerMove: (e: PointerEvent) => void;
  private readonly boundPointerUp: (e: PointerEvent) => void;

  constructor(options: TableCornerDragOptions) {
    this.wrapper = options.wrapper;
    this.gridEl = options.gridEl;
    this.getTableSize = options.getTableSize;
    this.onAddRow = options.onAddRow;
    this.onAddColumn = options.onAddColumn;
    this.onRemoveLastRow = options.onRemoveLastRow;
    this.onRemoveLastColumn = options.onRemoveLastColumn;
    this.onDragStart = options.onDragStart;
    this.onDragEnd = options.onDragEnd;
    this.canRemoveLastRow = options.canRemoveLastRow;
    this.canRemoveLastColumn = options.canRemoveLastColumn;

    this.hitZone = document.createElement('div');
    this.hitZone.setAttribute(CORNER_DRAG_ATTR, '');
    this.hitZone.setAttribute('contenteditable', 'false');
    this.hitZone.style.position = 'absolute';
    this.hitZone.style.width = '20px';
    this.hitZone.style.height = '20px';
    this.hitZone.style.cursor = 'nwse-resize';
    this.hitZone.style.zIndex = '2';
    this.hitZone.style.pointerEvents = 'auto';

    this.tooltip = document.createElement('div');
    this.tooltip.setAttribute(CORNER_TOOLTIP_ATTR, '');
    this.tooltip.style.position = 'absolute';
    this.tooltip.style.opacity = '0';
    this.tooltip.style.pointerEvents = 'none';
    this.tooltip.style.fontSize = '11px';
    this.tooltip.style.color = '#6b7280';
    this.tooltip.style.whiteSpace = 'nowrap';

    this.boundMouseEnter = this.handleMouseEnter.bind(this);
    this.boundMouseLeave = this.handleMouseLeave.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);

    this.hitZone.addEventListener('mouseenter', this.boundMouseEnter);
    this.hitZone.addEventListener('mouseleave', this.boundMouseLeave);
    this.hitZone.addEventListener('pointerdown', this.boundPointerDown);

    this.wrapper.appendChild(this.hitZone);
    this.wrapper.appendChild(this.tooltip);
  }

  private updateTooltip(): void {
    const size = this.getTableSize();

    this.tooltip.textContent = `${size.rows}\u00D7${size.cols}`;
  }

  private handleMouseEnter(): void {
    this.updateTooltip();
    this.tooltip.style.opacity = '1';
  }

  private handleMouseLeave(): void {
    this.tooltip.style.opacity = '0';
  }

  private measureUnitHeight(): number {
    const rows = this.gridEl.querySelectorAll('[data-blok-table-row]');
    const lastRow = rows[rows.length - 1] as HTMLElement | undefined;

    return lastRow?.offsetHeight || 30;
  }

  private measureUnitWidth(): number {
    const firstRow = this.gridEl.querySelector('[data-blok-table-row]');

    if (!firstRow) {
      return 100;
    }

    const cells = firstRow.querySelectorAll('[data-blok-table-cell]');
    const lastCell = cells[cells.length - 1] as HTMLElement | undefined;

    return lastCell?.offsetWidth || 100;
  }

  private handlePointerDown(e: PointerEvent): void {
    this.dragState = {
      startX: e.clientX,
      startY: e.clientY,
      unitWidth: this.measureUnitWidth(),
      unitHeight: this.measureUnitHeight(),
      addedRows: 0,
      addedCols: 0,
      pointerId: e.pointerId,
      didDrag: false,
    };

    this.hitZone.setPointerCapture(e.pointerId);
    this.hitZone.addEventListener('pointermove', this.boundPointerMove);
    this.hitZone.addEventListener('pointerup', this.boundPointerUp);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (this.dragState === null) {
      return;
    }

    const dx = e.clientX - this.dragState.startX;
    const dy = e.clientY - this.dragState.startY;

    if (!this.dragState.didDrag) {
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < DRAG_THRESHOLD) {
        return;
      }

      this.dragState.didDrag = true;
      document.body.style.cursor = 'nwse-resize';
      document.body.style.userSelect = 'none';
      this.onDragStart();
    }

    const { unitHeight, unitWidth } = this.dragState;

    const targetRows = Math.floor(dy / unitHeight);
    const targetCols = Math.floor(dx / unitWidth);

    while (this.dragState.addedRows < targetRows) {
      this.onAddRow();
      this.dragState.addedRows++;
    }

    while (this.dragState.addedCols < targetCols) {
      this.onAddColumn();
      this.dragState.addedCols++;
    }
  }

  private handlePointerUp(_e: PointerEvent): void {
    if (this.dragState === null) {
      return;
    }

    const { didDrag, pointerId } = this.dragState;

    this.dragState = null;
    this.hitZone.releasePointerCapture(pointerId);
    this.hitZone.removeEventListener('pointermove', this.boundPointerMove);
    this.hitZone.removeEventListener('pointerup', this.boundPointerUp);

    if (!didDrag) {
      this.onAddRow();
      this.onAddColumn();
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this.onDragEnd();
    }
  }

  public destroy(): void {
    this.hitZone.removeEventListener('mouseenter', this.boundMouseEnter);
    this.hitZone.removeEventListener('mouseleave', this.boundMouseLeave);
    this.hitZone.removeEventListener('pointerdown', this.boundPointerDown);
    this.hitZone.removeEventListener('pointermove', this.boundPointerMove);
    this.hitZone.removeEventListener('pointerup', this.boundPointerUp);
    this.dragState = null;
    this.hitZone.remove();
    this.tooltip.remove();
  }
}
