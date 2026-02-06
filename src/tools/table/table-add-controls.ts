import { IconPlus } from '../../components/icons';
import { twMerge } from '../../components/utils/tw';

const ADD_ROW_ATTR = 'data-blok-table-add-row';
const ADD_COL_ATTR = 'data-blok-table-add-col';
const HIDE_DELAY_MS = 150;

const HIT_AREA_CLASSES = [
  'flex',
  'items-center',
  'justify-center',
  'cursor-pointer',
  'transition-opacity',
  'duration-150',
];

const VISUAL_CLASSES = [
  'flex',
  'items-center',
  'justify-center',
  'border',
  'border-gray-300',
  'rounded-full',
  'group-hover/add:bg-gray-50',
];

const ICON_SIZE = '12';

interface TableAddControlsOptions {
  wrapper: HTMLElement;
  grid: HTMLElement;
  onAddRow: () => void;
  onAddColumn: () => void;
}

/**
 * Manages hover-to-reveal "+" buttons for adding rows and columns to the table.
 */
export class TableAddControls {
  private wrapper: HTMLElement;
  private grid: HTMLElement;
  private addRowBtn: HTMLElement;
  private addColBtn: HTMLElement;
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;

  private boundMouseEnter: () => void;
  private boundMouseLeave: () => void;
  private boundAddRowClick: () => void;
  private boundAddColClick: () => void;

  constructor(options: TableAddControlsOptions) {
    this.wrapper = options.wrapper;
    this.grid = options.grid;

    this.boundAddRowClick = options.onAddRow;
    this.boundAddColClick = options.onAddColumn;
    this.boundMouseEnter = this.show.bind(this);
    this.boundMouseLeave = this.scheduleHide.bind(this);

    this.addRowBtn = this.createAddRowButton();
    this.addColBtn = this.createAddColumnButton();

    this.wrapper.appendChild(this.addRowBtn);
    this.grid.appendChild(this.addColBtn);
    this.syncRowButtonWidth();

    this.wrapper.addEventListener('mouseenter', this.boundMouseEnter);
    this.wrapper.addEventListener('mouseleave', this.boundMouseLeave);

    this.addRowBtn.addEventListener('click', this.boundAddRowClick);
    this.addColBtn.addEventListener('click', this.boundAddColClick);
  }

  /**
   * Match the add-row button width to the grid's explicit width.
   * When the grid has a pixel width (from colWidths), the button must use
   * the same value so it scrolls with the table instead of staying at 100%
   * of the wrapper's visible area.
   */
  public syncRowButtonWidth(): void {
    const gridWidth = this.grid.style.width;

    this.addRowBtn.style.width = gridWidth && gridWidth.endsWith('px')
      ? gridWidth
      : '100%';
  }

  public destroy(): void {
    this.wrapper.removeEventListener('mouseenter', this.boundMouseEnter);
    this.wrapper.removeEventListener('mouseleave', this.boundMouseLeave);
    this.addRowBtn.removeEventListener('click', this.boundAddRowClick);
    this.addColBtn.removeEventListener('click', this.boundAddColClick);

    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    this.addRowBtn.remove();
    this.addColBtn.remove();
  }

  private show(): void {
    if (this.hideTimeout !== null) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    this.addRowBtn.style.opacity = '1';
    this.addColBtn.style.opacity = '1';
  }

  private scheduleHide(): void {
    this.hideTimeout = setTimeout(() => {
      this.addRowBtn.style.opacity = '0';
      this.addColBtn.style.opacity = '0';
      this.hideTimeout = null;
    }, HIDE_DELAY_MS);
  }

  private createAddRowButton(): HTMLElement {
    const btn = document.createElement('div');

    btn.className = twMerge(HIT_AREA_CLASSES, 'group/add', 'items-start');
    btn.setAttribute(ADD_ROW_ATTR, '');
    btn.setAttribute('contenteditable', 'false');
    btn.style.opacity = '0';
    btn.style.boxSizing = 'content-box';
    btn.style.width = '100%';
    btn.style.height = '32px';
    btn.style.padding = '4px 8px 0';
    btn.style.marginLeft = '-8px';

    const visual = document.createElement('div');

    visual.className = twMerge(VISUAL_CLASSES);
    visual.style.width = '100%';
    visual.style.height = '16px';

    this.appendIcon(visual);
    btn.appendChild(visual);

    return btn;
  }

  private createAddColumnButton(): HTMLElement {
    const btn = document.createElement('div');

    btn.className = twMerge(HIT_AREA_CLASSES, 'group/add', 'justify-start');
    btn.setAttribute(ADD_COL_ATTR, '');
    btn.setAttribute('contenteditable', 'false');
    btn.style.opacity = '0';
    btn.style.position = 'absolute';
    btn.style.right = '-36px';
    btn.style.top = '0px';
    btn.style.bottom = '0px';
    btn.style.width = '32px';

    const visual = document.createElement('div');

    visual.className = twMerge(VISUAL_CLASSES);
    visual.style.width = '16px';
    visual.style.height = '100%';

    this.appendIcon(visual);
    btn.appendChild(visual);

    return btn;
  }

  private appendIcon(parent: HTMLElement): void {
    parent.insertAdjacentHTML('beforeend', IconPlus);

    const svg = parent.querySelector('svg');

    if (svg) {
      svg.setAttribute('width', ICON_SIZE);
      svg.setAttribute('height', ICON_SIZE);
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.classList.add('text-gray-500', 'pointer-events-none');
    }
  }
}
