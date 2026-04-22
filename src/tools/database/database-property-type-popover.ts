import {
  IconText,
  IconHash,
  IconList,
  IconListBulleted,
  IconCalendar,
  IconListChecklist,
  IconGlobe,
} from '../../components/icons';
import type { I18n } from '../../../types';
import type { PropertyType } from './types';

interface PropertyTypeOption {
  type: PropertyType;
  icon: string;
  labelKey: string;
}

const PROPERTY_TYPES: PropertyTypeOption[] = [
  { type: 'text', icon: IconText, labelKey: 'tools.database.propertyTypeText' },
  { type: 'number', icon: IconHash, labelKey: 'tools.database.propertyTypeNumber' },
  { type: 'select', icon: IconList, labelKey: 'tools.database.propertyTypeSelect' },
  { type: 'multiSelect', icon: IconListBulleted, labelKey: 'tools.database.propertyTypeMultiSelect' },
  { type: 'date', icon: IconCalendar, labelKey: 'tools.database.propertyTypeDate' },
  { type: 'checkbox', icon: IconListChecklist, labelKey: 'tools.database.propertyTypeCheckbox' },
  { type: 'url', icon: IconGlobe, labelKey: 'tools.database.propertyTypeUrl' },
];

export interface PropertyTypePopoverOptions {
  onSelect: (type: PropertyType) => void;
  i18n?: I18n;
}

export class DatabasePropertyTypePopover {
  private readonly onSelect: (type: PropertyType) => void;
  private readonly i18n: I18n | undefined;
  private popoverEl: HTMLElement | null = null;
  private boundOutsideClick: ((e: MouseEvent) => void) | null = null;

  constructor(options: PropertyTypePopoverOptions) {
    this.onSelect = options.onSelect;
    this.i18n = options.i18n;
  }

  open(anchor: HTMLElement): void {
    this.close();

    const popover = document.createElement('div');
    popover.setAttribute('data-blok-popover', '');
    popover.setAttribute('data-blok-popover-opened', '');
    popover.setAttribute('data-blok-database-property-type-popover', '');
    popover.style.position = 'fixed';
    popover.style.zIndex = '1000';

    const rect = anchor.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = `${rect.left}px`;

    const heading = document.createElement('div');
    heading.setAttribute('data-blok-database-property-type-heading', '');
    heading.textContent = this.i18n?.t('tools.database.propertyTypeHeading') ?? 'tools.database.propertyTypeHeading';
    popover.appendChild(heading);

    for (const option of PROPERTY_TYPES) {
      const item = document.createElement('div');
      item.setAttribute('data-blok-database-property-type-option', option.type);

      const iconEl = document.createElement('div');
      iconEl.setAttribute('data-blok-database-property-type-option-icon', '');
      iconEl.innerHTML = option.icon;
      item.appendChild(iconEl);

      const label = document.createElement('span');
      label.textContent = this.i18n?.t(option.labelKey) ?? option.labelKey;
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
