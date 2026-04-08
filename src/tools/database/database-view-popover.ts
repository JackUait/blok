import { IconBoard, IconList } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { ViewType } from './types';

interface ViewTypeOption {
  type: ViewType;
  icon: string;
  label: string;
  description: string;
}

const VIEW_TYPES: ViewTypeOption[] = [
  { type: 'board', icon: IconBoard, label: 'Board', description: 'Visualize work as columns' },
  { type: 'list', icon: IconList, label: 'List', description: 'A simple linear view' },
];

export interface ViewPopoverOptions {
  onSelect: (type: ViewType) => void;
  onClose?: () => void;
}

export class DatabaseViewPopover {
  private readonly onSelect: (type: ViewType) => void;
  private readonly onClose: (() => void) | undefined;
  private popover: PopoverDesktop | null = null;

  constructor(options: ViewPopoverOptions) {
    this.onSelect = options.onSelect;
    this.onClose = options.onClose;
  }

  open(anchor: HTMLElement): void {
    this.close();

    const headingEl = document.createElement('div');

    headingEl.setAttribute('data-blok-database-view-popover-heading', '');
    headingEl.textContent = 'Add view';

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
      this.popover?.destroy();
      this.popover = null;
      this.onClose?.();
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
    labelEl.textContent = option.label;
    textEl.appendChild(labelEl);

    const descEl = document.createElement('span');

    descEl.setAttribute('data-blok-database-view-option-desc', '');
    descEl.textContent = option.description;
    textEl.appendChild(descEl);

    item.appendChild(textEl);

    item.addEventListener('click', () => {
      this.onSelect(option.type);
    });

    return item;
  }

  close(): void {
    if (this.popover !== null) {
      this.popover.destroy();
      this.popover = null;
      this.onClose?.();
    }
  }

  destroy(): void {
    this.close();
  }
}
