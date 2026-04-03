import { IconBoard, IconTable, IconGallery, IconList } from '../../components/icons';
import type { ViewType } from './types';

interface ViewTypeOption {
  type: ViewType;
  icon: string;
  label: string;
  enabled: boolean;
}

const VIEW_TYPES: ViewTypeOption[] = [
  { type: 'board', icon: IconBoard, label: 'Board', enabled: true },
  { type: 'table', icon: IconTable, label: 'Table', enabled: false },
  { type: 'gallery', icon: IconGallery, label: 'Gallery', enabled: false },
  { type: 'list', icon: IconList, label: 'List', enabled: true },
];

export interface ViewPopoverOptions {
  onSelect: (type: ViewType) => void;
}

export class DatabaseViewPopover {
  private readonly onSelect: (type: ViewType) => void;
  private popoverEl: HTMLElement | null = null;
  private boundOutsideClick: ((e: MouseEvent) => void) | null = null;

  constructor(options: ViewPopoverOptions) {
    this.onSelect = options.onSelect;
  }

  open(anchor: HTMLElement): void {
    this.close();

    const popover = document.createElement('div');
    popover.setAttribute('data-blok-popover', '');
    popover.setAttribute('data-blok-database-view-popover', '');
    popover.style.position = 'fixed';
    popover.style.zIndex = '1000';

    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = `${rect.left}px`;

    const heading = document.createElement('div');
    heading.setAttribute('data-blok-database-view-popover-heading', '');
    heading.textContent = 'Add a new view';
    popover.appendChild(heading);

    const grid = document.createElement('div');
    grid.setAttribute('data-blok-database-view-popover-grid', '');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gap = '2px';

    for (const option of VIEW_TYPES) {
      const item = document.createElement('div');
      item.setAttribute('data-blok-database-view-option', option.type);

      if (!option.enabled) {
        item.style.opacity = '0.35';
        item.style.pointerEvents = 'none';
        item.style.cursor = 'not-allowed';
      }

      const iconEl = document.createElement('div');
      iconEl.setAttribute('data-blok-database-view-option-icon', '');
      iconEl.innerHTML = option.icon;
      item.appendChild(iconEl);

      const label = document.createElement('span');
      label.textContent = option.label;
      item.appendChild(label);

      if (option.enabled) {
        item.addEventListener('click', () => {
          this.onSelect(option.type);
          this.close();
        });
      }

      grid.appendChild(item);
    }

    popover.appendChild(grid);
    document.body.appendChild(popover);
    this.popoverEl = popover;

    this.boundOutsideClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!popover.contains(target) && !anchor.contains(target)) {
        this.close();
      }
    };

    document.addEventListener('mousedown', this.boundOutsideClick);
  }

  close(): void {
    if (this.popoverEl !== null) {
      this.popoverEl.remove();
      this.popoverEl = null;
    }
    if (this.boundOutsideClick !== null) {
      document.removeEventListener('mousedown', this.boundOutsideClick);
      this.boundOutsideClick = null;
    }
  }

  destroy(): void {
    this.close();
  }
}
