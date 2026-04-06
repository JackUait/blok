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

export class TableCornerDrag {
  private wrapper: HTMLElement;
  private hitZone: HTMLElement;
  private tooltip: HTMLElement;
  private getTableSize: () => { rows: number; cols: number };
  private readonly boundMouseEnter: () => void;
  private readonly boundMouseLeave: () => void;

  constructor(options: TableCornerDragOptions) {
    this.wrapper = options.wrapper;
    this.getTableSize = options.getTableSize;

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

    this.hitZone.addEventListener('mouseenter', this.boundMouseEnter);
    this.hitZone.addEventListener('mouseleave', this.boundMouseLeave);

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

  public destroy(): void {
    this.hitZone.removeEventListener('mouseenter', this.boundMouseEnter);
    this.hitZone.removeEventListener('mouseleave', this.boundMouseLeave);
    this.hitZone.remove();
    this.tooltip.remove();
  }
}
