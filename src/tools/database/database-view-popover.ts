import { IconViewBoard, IconCalendar, IconChart, IconGallery, IconListBulleted, IconMessage, IconTable, IconTimeline, IconListChecklist, IconMap, IconDatabase } from '../../components/icons';
import { DATABASE_MENU_CLASS } from './database-group-menu';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { API } from '../../../types';
import type { ViewType } from './types';

interface ViewTypeOption {
  type: ViewType;
  icon: string;
  labelKey: string;
}

/** Notion's add-view order (research/08:113). */
const VIEW_TYPES: ViewTypeOption[] = [
  { type: 'table', icon: IconTable, labelKey: 'tools.database.viewTypeTable' },
  { type: 'board', icon: IconViewBoard, labelKey: 'tools.database.viewTypeBoard' },
  { type: 'gallery', icon: IconGallery, labelKey: 'tools.database.viewTypeGallery' },
  { type: 'list', icon: IconListBulleted, labelKey: 'tools.database.viewTypeList' },
  { type: 'chart', icon: IconChart, labelKey: 'tools.database.viewTypeChart' },
  { type: 'timeline', icon: IconTimeline, labelKey: 'tools.database.viewTypeTimeline' },
  { type: 'feed', icon: IconMessage, labelKey: 'tools.database.viewTypeFeed' },
  // Form and map are Tier 3 (D6). Dashboard, after Chart in Notion, is a data slot only, so it is not offered.
  { type: 'map', icon: IconMap, labelKey: 'tools.database.viewTypeMap' },
  { type: 'calendar', icon: IconCalendar, labelKey: 'tools.database.viewTypeCalendar' },
  { type: 'form', icon: IconListChecklist, labelKey: 'tools.database.viewTypeForm' },
];

export interface ViewPopoverOptions {
  onSelect: (type: ViewType) => void;
  onClose?: () => void;
  api?: API;
  /** Layouts to leave out. */
  hidden?: readonly ViewType[];
  /** "New data source", the last item (research/08:113, research/23 §10). */
  onNewSource?: () => void;
}

export class DatabaseViewPopover {
  private readonly onSelect: (type: ViewType) => void;
  private readonly onClose: (() => void) | undefined;
  private readonly api: API | undefined;
  private readonly hidden: readonly ViewType[];
  private readonly onNewSource: (() => void) | undefined;
  private popover: PopoverDesktop | null = null;

  constructor(options: ViewPopoverOptions) {
    this.onSelect = options.onSelect;
    this.onClose = options.onClose;
    this.api = options.api;
    this.hidden = options.hidden ?? [];
    this.onNewSource = options.onNewSource;
  }

  private translate(key: string, fallback: string): string {
    return this.api?.i18n.t(key) ?? fallback;
  }

  open(anchor: HTMLElement): void {
    this.close();

    const headingEl = document.createElement('div');

    headingEl.setAttribute('data-blok-database-view-popover-heading', '');
    headingEl.textContent = this.translate('tools.database.addNewView', 'Add a new view');

    const headingItem = {
      type: PopoverItemType.Html as const,
      element: headingEl,
    };

    const items = [
      headingItem,
      ...VIEW_TYPES.filter((option) => !this.hidden.includes(option.type)).map((option) => {
        const el = this.createViewItem(option);

        return {
          type: PopoverItemType.Html as const,
          name: 'database-view-tile',
          element: el,
          closeOnActivate: true,
        };
      }),
      ...(this.onNewSource === undefined ? [] : [{ type: PopoverItemType.Separator as const }, {
        type: PopoverItemType.Html as const,
        element: this.createNewSourceItem(this.onNewSource),
        closeOnActivate: true,
      }]),
    ];

    this.popover = new PopoverDesktop({
      // The second class lays the tiles out as Notion's 4-column grid (feel/findings-toolbar V04).
      class: `${DATABASE_MENU_CLASS} blok-database-add-view-menu`,
      animateClose: true,
      items,
      trigger: anchor,
      width: '390px',
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

  /** A button, so the menu's arrow keys reach it and Enter picks it. */
  private createViewItem(option: ViewTypeOption): HTMLElement {
    const item = document.createElement('button');
    const iconEl = document.createElement('span');
    const labelEl = document.createElement('span');

    item.type = 'button';
    item.setAttribute('data-blok-database-view-option', option.type);
    iconEl.setAttribute('data-blok-database-view-option-icon', '');
    iconEl.innerHTML = option.icon;
    labelEl.setAttribute('data-blok-database-view-option-label', '');
    labelEl.textContent = this.translate(option.labelKey, '');
    item.append(iconEl, labelEl);
    item.addEventListener('click', () => {
      this.onSelect(option.type);
    });

    return item;
  }

  private createNewSourceItem(onNewSource: () => void): HTMLElement {
    const item = document.createElement('button');
    const iconEl = document.createElement('span');
    const labelEl = document.createElement('span');

    item.type = 'button';
    item.setAttribute('data-blok-database-view-option', 'new-source');
    item.setAttribute('data-blok-database-view-new-source', '');
    iconEl.setAttribute('data-blok-database-view-option-icon', '');
    iconEl.innerHTML = IconDatabase;
    labelEl.setAttribute('data-blok-database-view-option-label', '');
    labelEl.textContent = this.translate('tools.database.newDataSource', 'New data source');
    item.append(iconEl, labelEl);
    item.addEventListener('click', () => onNewSource());

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
