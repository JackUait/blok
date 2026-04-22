import { IconBoard, IconList } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { API } from '../../../types';
import type { ViewType } from './types';

interface ViewTypeOption {
  type: ViewType;
  icon: string;
  labelKey: string;
  descriptionKey: string;
}

const VIEW_TYPES: ViewTypeOption[] = [
  { type: 'board', icon: IconBoard, labelKey: 'tools.database.viewTypeBoard', descriptionKey: 'tools.database.viewTypeBoardDescription' },
  { type: 'list', icon: IconList, labelKey: 'tools.database.viewTypeList', descriptionKey: 'tools.database.viewTypeListDescription' },
];

export interface ViewPopoverOptions {
  onSelect: (type: ViewType) => void;
  onClose?: () => void;
  api?: API;
}

export class DatabaseViewPopover {
  private readonly onSelect: (type: ViewType) => void;
  private readonly onClose: (() => void) | undefined;
  private readonly api: API | undefined;
  private popover: PopoverDesktop | null = null;

  constructor(options: ViewPopoverOptions) {
    this.onSelect = options.onSelect;
    this.onClose = options.onClose;
    this.api = options.api;
  }

  private translate(key: string, fallback: string): string {
    return this.api?.i18n.t(key) ?? fallback;
  }

  open(anchor: HTMLElement): void {
    this.close();

    const headingEl = document.createElement('div');

    headingEl.setAttribute('data-blok-database-view-popover-heading', '');
    headingEl.textContent = this.translate('tools.database.addView', ['Add', 'view'].join(' '));

    const headingItem = {
      type: PopoverItemType.Html as const,
      element: headingEl,
    };

    const items = [
      headingItem,
      ...VIEW_TYPES.map((option) => {
        const el = this.createViewItem(option);

        return {
          type: PopoverItemType.Html as const,
          element: el,
          closeOnActivate: true,
        };
      }),
    ];

    this.popover = new PopoverDesktop({
      items,
      trigger: anchor,
      width: 'auto',
      minWidth: '200px',
      flippable: false,
      autoFocusFirstItem: false,
    });

    this.popover.on(PopoverEvent.Closed, () => {
      if (this.popover !== null) {
        const p = this.popover;
        this.popover = null;
        p.destroy();
        this.onClose?.();
      }
    });

    this.popover.show();
  }

  private createViewItem(option: ViewTypeOption): HTMLElement {
    const item = document.createElement('div');

    item.setAttribute('data-blok-database-view-option', option.type);

    const iconEl = document.createElement('div');

    iconEl.setAttribute('data-blok-database-view-option-icon', '');
    iconEl.innerHTML = option.icon;
    item.appendChild(iconEl);

    const textEl = document.createElement('div');

    textEl.setAttribute('data-blok-database-view-option-text', '');

    const labelEl = document.createElement('span');

    labelEl.setAttribute('data-blok-database-view-option-label', '');
    labelEl.textContent = this.translate(option.labelKey, '');
    textEl.appendChild(labelEl);

    const descEl = document.createElement('span');

    descEl.setAttribute('data-blok-database-view-option-desc', '');
    descEl.textContent = this.translate(option.descriptionKey, '');
    textEl.appendChild(descEl);

    item.appendChild(textEl);

    item.addEventListener('click', () => {
      this.onSelect(option.type);
    });

    return item;
  }

  close(): void {
    if (this.popover !== null) {
      const popover = this.popover;
      this.popover = null;
      popover.destroy();
      this.onClose?.();
    }
  }

  destroy(): void {
    this.close();
  }
}
