import {
  IconText,
  IconHash,
  IconList,
  IconListBulleted,
  IconTable,
  IconListChecklist,
  IconGlobe,
} from '../../components/icons';
import type { PropertyType } from './types';

interface PropertyTypeOption {
  type: PropertyType;
  icon: string;
  label: string;
}

const PROPERTY_TYPES: PropertyTypeOption[] = [
  { type: 'text', icon: IconText, label: 'Text' },
  { type: 'number', icon: IconHash, label: 'Number' },
  { type: 'select', icon: IconList, label: 'Select' },
  { type: 'multiSelect', icon: IconListBulleted, label: 'Multi-select' },
  { type: 'date', icon: IconTable, label: 'Date' },
  { type: 'checkbox', icon: IconListChecklist, label: 'Checkbox' },
  { type: 'url', icon: IconGlobe, label: 'URL' },
];

export interface PropertyTypePopoverOptions {
  onSelect: (type: PropertyType) => void;
}

export class DatabasePropertyTypePopover {
  private readonly onSelect: (type: PropertyType) => void;
  private popoverEl: HTMLElement | null = null;
  private boundOutsideClick: ((e: MouseEvent) => void) | null = null;

  constructor(options: PropertyTypePopoverOptions) {
    this.onSelect = options.onSelect;
  }

  open(anchor: HTMLElement): void {
    this.close();

    const popover = document.createElement('div');
    popover.setAttribute('data-blok-popover', '');
    popover.setAttribute('data-blok-database-property-type-popover', '');
    popover.style.position = 'fixed';
    popover.style.zIndex = '1000';

    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = `${rect.left}px`;

    for (const option of PROPERTY_TYPES) {
      const item = document.createElement('div');
      item.setAttribute('data-blok-database-property-type-option', option.type);

      const iconEl = document.createElement('div');
      iconEl.setAttribute('data-blok-database-property-type-option-icon', '');
      iconEl.innerHTML = option.icon;
      item.appendChild(iconEl);

      const label = document.createElement('span');
      label.textContent = option.label;
      item.appendChild(label);

      item.addEventListener('click', () => {
        this.onSelect(option.type);
        this.close();
      });

      popover.appendChild(item);
    }

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
