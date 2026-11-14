import { IconDatabase } from '../../components/icons';
import { VIEW_ICONS } from './database-tab-bar';
import { DATABASE_MENU_CLASS, DATABASE_SUBMENU_OPEN_DELAY_MS } from './database-group-menu';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { API } from '../../../types';
import type { ViewType } from './types';

interface ViewTypeOption {
  type: ViewType;
  labelKey: string;
}

/**
 * Notion's add-view order (research/08:113). Tiles draw the tab glyphs
 * (VIEW_ICONS): Notion uses one glyph per layout in both places.
 */
const VIEW_TYPES: ViewTypeOption[] = [
  { type: 'table', labelKey: 'tools.database.viewTypeTable' },
  { type: 'board', labelKey: 'tools.database.viewTypeBoard' },
  { type: 'gallery', labelKey: 'tools.database.viewTypeGallery' },
  { type: 'list', labelKey: 'tools.database.viewTypeList' },
  { type: 'chart', labelKey: 'tools.database.viewTypeChart' },
  { type: 'dashboard', labelKey: 'tools.database.viewTypeDashboard' },
  { type: 'timeline', labelKey: 'tools.database.viewTypeTimeline' },
  { type: 'feed', labelKey: 'tools.database.viewTypeFeed' },
  // Form and map are Tier 3 (D6).
  { type: 'map', labelKey: 'tools.database.viewTypeMap' },
  { type: 'calendar', labelKey: 'tools.database.viewTypeCalendar' },
  { type: 'form', labelKey: 'tools.database.viewTypeForm' },
];

/** Notion's card of view layouts is 390 wide (feel/findings-toolbar V04). */
export const ADD_VIEW_MENU_WIDTH = 390;

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

  /**
   * `aside`: beside a menu row, vertically centred on it, its left on the row's
   * right (notion-motion.md Round 31 §3: the fold menu's right − 4, its padding).
   */
  open(anchor: HTMLElement, placement: 'below' | 'aside' = 'below'): void {
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
      // motion-addview.json: Notion's card starts 4px under the "+".
      offset: placement === 'aside' ? 0 : 4,
      ...(placement === 'aside' ? { placeLeftOfAnchor: true, asideSide: 'right' as const } : {}),
      width: `${ADD_VIEW_MENU_WIDTH}px`,
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

    this.popover.nestedOpenDelay = DATABASE_SUBMENU_OPEN_DELAY_MS;
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
    iconEl.innerHTML = VIEW_ICONS[option.type] ?? '';
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

  /** A node of the open menu, or of a submenu. */
  contains(node: Node): boolean {
    return this.popover?.hasNode(node) === true;
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
