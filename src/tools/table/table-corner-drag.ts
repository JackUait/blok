import { show as showTooltip, hide as hideTooltip } from '../../components/utils/tooltip';

const CORNER_DRAG_ATTR = 'data-blok-table-corner-drag';

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
  onClickAdd?: () => void;
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
  private getTableSize: () => { rows: number; cols: number };
  private onAddRow: () => void;
  private onAddColumn: () => void;
  private onRemoveLastRow: () => void;
  private onRemoveLastColumn: () => void;
  private onDragStart: () => void;
  private onDragEnd: () => void;
  private canRemoveLastRow: () => boolean;
  private canRemoveLastColumn: () => boolean;
  private onClickAdd: (() => void) | null;
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
    this.onClickAdd = options.onClickAdd ?? null;

    this.hitZone = document.createElement('div');
    this.hitZone.setAttribute(CORNER_DRAG_ATTR, '');
    this.hitZone.setAttribute('contenteditable', 'false');
    this.hitZone.style.position = 'absolute';
    this.hitZone.style.width = '36px';
    this.hitZone.style.height = '36px';
    this.hitZone.style.cursor = 'nwse-resize';
    this.hitZone.style.zIndex = '2';
    this.hitZone.style.pointerEvents = 'auto';
    this.hitZone.style.bottom = '-36px';
    this.hitZone.style.right = '-16px';

    this.boundMouseEnter = this.handleMouseEnter.bind(this);
    this.boundMouseLeave = this.handleMouseLeave.bind(this);
    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);

    this.hitZone.addEventListener('mouseenter', this.boundMouseEnter);
    this.hitZone.addEventListener('mouseleave', this.boundMouseLeave);
    this.hitZone.addEventListener('pointerdown', this.boundPointerDown);

    this.wrapper.appendChild(this.hitZone);
  }

  private updateTooltip(): void {
    const size = this.getTableSize();

    showTooltip(this.hitZone, `${size.cols}\u00D7${size.rows}`, { placement: 'bottom' });
  }

  private handleMouseEnter(): void {
    this.updateTooltip();
  }

  private handleMouseLeave(): void {
    if (this.dragState !== null) {
      return;
    }
    hideTooltip();
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

    this.updateTooltip();

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

    const targetRows = Math.trunc(dy / unitHeight);
    const targetCols = Math.trunc(dx / unitWidth);

    while (this.dragState.addedRows < targetRows) {
      this.onAddRow();
      this.dragState.addedRows++;
    }

    while (this.dragState.addedRows > targetRows && this.canRemoveLastRow()) {
      this.onRemoveLastRow();
      this.dragState.addedRows--;
    }

    while (this.dragState.addedCols < targetCols) {
      this.onAddColumn();
      this.dragState.addedCols++;
    }

    while (this.dragState.addedCols > targetCols && this.canRemoveLastColumn()) {
      this.onRemoveLastColumn();
      this.dragState.addedCols--;
    }

    this.updateTooltip();
  }

  private handlePointerUp(_e: PointerEvent): void {
    if (this.dragState === null) {
      return;
    }

    const { didDrag, pointerId } = this.dragState;

    this.dragState = null;
    hideTooltip();
    this.hitZone.releasePointerCapture(pointerId);
    this.hitZone.removeEventListener('pointermove', this.boundPointerMove);
    this.hitZone.removeEventListener('pointerup', this.boundPointerUp);

    if (!didDrag) {
      if (this.onClickAdd) {
        this.onClickAdd();
      } else {
        this.onAddRow();
        this.onAddColumn();
      }
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this.onDragEnd();
    }
  }

  public setDisplay(visible: boolean): void {
    this.hitZone.style.display = visible ? '' : 'none';
  }

  public setInteractive(interactive: boolean): void {
    this.hitZone.style.pointerEvents = interactive ? 'auto' : 'none';
  }

  public destroy(): void {
    this.hitZone.removeEventListener('mouseenter', this.boundMouseEnter);
    this.hitZone.removeEventListener('mouseleave', this.boundMouseLeave);
    this.hitZone.removeEventListener('pointerdown', this.boundPointerDown);
    this.hitZone.removeEventListener('pointermove', this.boundPointerMove);
    this.hitZone.removeEventListener('pointerup', this.boundPointerUp);
    if (this.dragState?.didDrag) {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    this.dragState = null;
    hideTooltip();
    this.hitZone.remove();
  }
}
