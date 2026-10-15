import { generateKeyBetween } from 'fractional-indexing';
import { syncPortalDirection } from '../../components/utils/portal-direction';
import { IconBoard, IconCalendar, IconChart, IconGallery, IconList, IconMessage, IconTable, IconTimeline, IconPencil, IconCopy, IconTrash, IconPlus, IconSliders, IconColumns, IconListChecklist, IconMap, IconTabs, IconMenu, IconDotsHorizontal } from '../../components/icons';
import { DatabaseViewPopover } from './database-view-popover';
import { DATABASE_MENU_CLASS } from './database-group-menu';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { SearchInput, SearchInputEvent } from '../../components/utils/popover/components/search-input';
import {
  createPositionTracker,
  positionFixedAnchored,
  type PositionTracker,
} from '../../components/utils/popover/anchored-position';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { startInlineRename } from '../../components/utils/inline-rename';
import { rovingRadioGroup, type RovingRadioGroup } from '../../components/utils/roving-radio-group';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import type { API } from '../../../types';
import type { DatabaseTabDisplay, DatabaseViewConfig, ViewType } from './types';
import { copyGhostRadius, mountGhost } from './copy-ghost-radius';

const DRAG_THRESHOLD = 10;

/**
 * Set when a tab is activated from the keyboard. Switching views makes the
 * database tool destroy and replace the whole bar, which drops DOM focus to
 * `<body>` mid-keystroke; the freshly rendered bar consumes this to put focus
 * back on the tab the user just moved to, so arrow navigation can continue.
 */
const tabFocusHandoff = { pending: false };

/** The bar's controls are `<div>`s (the CSS keys off attributes), so no click arrives from Enter/Space. */
function activateOnEnterOrSpace(element: HTMLElement, action: () => void): void {
  element.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    action();
  });
}

const VIEW_ICONS: Record<string, string> = {
  board: IconBoard,
  list: IconList,
  table: IconTable,
  gallery: IconGallery,
  calendar: IconCalendar,
  timeline: IconTimeline,
  chart: IconChart,
  feed: IconMessage,
  form: IconListChecklist,
  map: IconMap,
  dashboard: IconColumns,
};

export interface TabBarOptions {
  views: DatabaseViewConfig[];
  activeViewId: string;
  onTabClick: (viewId: string) => void;
  onAddView: (type: ViewType) => void;
  onRename: (viewId: string, newName: string) => void;
  onDuplicate: (viewId: string) => void;
  onDelete: (viewId: string) => void;
  onReorder: (viewId: string, newPosition: string) => void;
  /** "Edit view": opens the view settings panel under the tab. */
  onEditView?: (viewId: string, anchor: HTMLElement) => void;
  /** This person's "Display as". Defaults to both. */
  display?: DatabaseTabDisplay;
  /** Offers "Display as" in the tab menu. */
  onDisplayChange?: (display: DatabaseTabDisplay) => void;
  api?: API;
  readOnly?: boolean;
}

export class DatabaseTabBar {
  private readonly options: TabBarOptions;
  private readonly views: DatabaseViewConfig[];
  private readonly onReorder: (viewId: string, newPosition: string) => void;
  private element: HTMLElement | null = null;
  private barEl: HTMLElement | null = null;
  private addBtnEl: HTMLElement | null = null;
  private readOnly: boolean;
  private viewPopover: DatabaseViewPopover | null = null;
  private contextPopover: PopoverDesktop | null = null;
  private roving: RovingRadioGroup | null = null;

  private overflowDropdownEl: HTMLElement | null = null;
  private overflowPositionTracker: PositionTracker | null = null;
  private boundOverflowClose: ((e: MouseEvent) => void) | null = null;
  private overflowSearch: SearchInput | null = null;
  private overflowRowDrag: { viewId: string; row: HTMLElement; moved: boolean } | null = null;
  private moreBtnEl: HTMLElement | null = null;

  private isDragging = false;
  private dragViewId = '';
  private dragStartX = 0;
  private ghostEl: HTMLElement | null = null;
  private readonly boundDragMove: (e: PointerEvent) => void;
  private readonly boundDragUp: (e: PointerEvent) => void;
  private readonly boundDragCancel: () => void;
  private readonly boundDragKeyDown: (e: KeyboardEvent) => void;

  constructor(options: TabBarOptions) {
    this.options = options;
    this.views = options.views;
    this.onReorder = options.onReorder;
    this.readOnly = options.readOnly ?? false;

    this.boundDragMove = this.handleDragMove.bind(this);
    this.boundDragUp = this.handleDragUp.bind(this);
    this.boundDragCancel = this.cleanupDrag.bind(this);
    this.boundDragKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { this.cleanupDrag(); }
    };
  }

  render(): HTMLElement {
    const bar = document.createElement('div');
    bar.setAttribute('data-blok-database-tab-bar', '');
    bar.setAttribute(DATA_ATTR.contextMenuOwner, '');
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('data-display', this.options.display ?? 'both');
    // Arrow/Home/End roving and Enter/Space activation are the bar's own; Blok's
    // block- and editor-level keyboard handling stands down inside the subtree.
    bar.setAttribute(DATA_ATTR.keyboardOwner, '');
    this.barEl = bar;
    this.element = bar;

    const sorted = [...this.options.views].sort((a, b) => (a.position < b.position ? -1 : 1));
    const tabEls = sorted.map((view) => this.createTab(view));

    for (const tab of tabEls) {
      bar.appendChild(tab);
    }

    const activeIndex = sorted.findIndex((view) => view.id === this.options.activeViewId);

    this.roving = rovingRadioGroup({
      radios: tabEls,
      getSelectedIndex: () => activeIndex,
      onSelect: (index) => {
        this.activateTab(sorted[index].id, true);
      },
    });

    const addBtn = document.createElement('button');
    addBtn.setAttribute('data-blok-database-add-view', '');
    addBtn.setAttribute('aria-label', this.t('tools.database.addView', 'Add view'));
    addBtn.innerHTML = IconPlus;
    addBtn.addEventListener('click', () => {
      this.openViewPopover(addBtn);
    });
    this.addBtnEl = addBtn;
    if (!this.readOnly) {
      bar.appendChild(addBtn);
    }

    bar.addEventListener('click', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const tab = target.closest('[data-blok-database-tab]');
      if (!(tab instanceof HTMLElement)) {
        return;
      }
      const viewId = tab.getAttribute('data-view-id');
      if (viewId === null) {
        return;
      }
      this.activateTab(viewId, false);
    });

    // Read-only is read at event time: setReadOnly flips a live bar.
    bar.addEventListener('contextmenu', (e: MouseEvent) => {
      if (this.readOnly) {
        return;
      }
      const target = e.target as HTMLElement;
      const tab = target.closest('[data-blok-database-tab]');
      if (!(tab instanceof HTMLElement)) {
        return;
      }
      e.preventDefault();
      const viewId = tab.getAttribute('data-view-id');
      if (viewId === null) {
        return;
      }
      this.openContextPopover(tab, viewId);
    });

    bar.addEventListener('dblclick', (e: MouseEvent) => {
      if (this.readOnly) {
        return;
      }
      const target = e.target as HTMLElement;
      const tab = target.closest('[data-blok-database-tab]');
      if (!(tab instanceof HTMLElement)) {
        return;
      }
      const viewId = tab.getAttribute('data-view-id');
      if (viewId === null) {
        return;
      }
      this.openContextPopover(tab, viewId);
    });

    bar.addEventListener('pointerdown', (e) => {
      if (this.readOnly) {
        return;
      }
      const target = e.target as HTMLElement;
      const tab = target.closest<HTMLElement>('[data-blok-database-tab]');
      if (tab === null) return;
      const viewId = tab.getAttribute('data-view-id');
      if (viewId === null) return;
      this.dragViewId = viewId;
      this.dragStartX = e.clientX;
      this.isDragging = false;
      document.addEventListener('pointermove', this.boundDragMove);
      document.addEventListener('pointerup', this.boundDragUp);
      document.addEventListener('pointercancel', this.boundDragCancel);
      document.addEventListener('keydown', this.boundDragKeyDown);
    });

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (this.element === null) {
          return;
        }

        const tabs = Array.from(this.element.querySelectorAll<HTMLElement>('[data-blok-database-tab]'));

        for (const tab of tabs) {
          tab.style.display = '';
        }
        this.moreBtnEl?.remove();
        this.moreBtnEl = null;

        const barWidth = this.element.clientWidth;
        const addBtnWidth = 40;
        const visibleCount = tabs.findIndex((_tab, i) => {
          const consumed = addBtnWidth + tabs.slice(0, i + 1).reduce((w, t) => w + t.offsetWidth + 2, 0);

          return consumed > barWidth;
        });
        const resolved = visibleCount === -1 ? tabs.length : visibleCount;

        if (resolved < tabs.length) {
          this.handleOverflow(resolved);
        }
      });

      ro.observe(bar);
    }

    const restoreFocus = tabFocusHandoff.pending;

    tabFocusHandoff.pending = false;

    if (restoreFocus && activeIndex >= 0) {
      const activeTab = tabEls[activeIndex];

      // The bar is still detached here — the tool swaps it in right after
      // render() returns, so the focus call waits for that to happen.
      queueMicrotask(() => {
        activeTab.focus();
      });
    }

    return bar;
  }

  private t(key: string, fallback: string): string {
    return this.options.api?.i18n.t(key) ?? fallback;
  }

  /**
   * Switches to a view. `viaKeyboard` arms the focus hand-off across the tab-bar
   * rebuild the switch triggers.
   */
  private activateTab(viewId: string, viaKeyboard: boolean): void {
    if (viewId === this.options.activeViewId) {
      return;
    }

    tabFocusHandoff.pending = viaKeyboard;
    this.options.onTabClick(viewId);
  }

  private createTab(view: DatabaseViewConfig): HTMLElement {
    const tab = document.createElement('div');
    const isActive = view.id === this.options.activeViewId;

    tab.setAttribute('data-blok-database-tab', '');
    tab.setAttribute('data-view-id', view.id);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', isActive ? 'true' : 'false');

    if (isActive) {
      tab.setAttribute('data-active', '');
      tab.setAttribute('aria-current', 'true');
    }

    const iconSpan = document.createElement('span');
    iconSpan.setAttribute('data-blok-database-tab-icon', '');
    iconSpan.innerHTML = VIEW_ICONS[view.type] ?? '';
    tab.appendChild(iconSpan);

    const nameSpan = document.createElement('span');
    nameSpan.setAttribute('data-blok-database-tab-name', '');
    nameSpan.textContent = view.name;
    tab.appendChild(nameSpan);

    activateOnEnterOrSpace(tab, () => {
      this.activateTab(view.id, true);
    });

    return tab;
  }

  private openContextPopover(tab: HTMLElement, viewId: string): void {
    this.showViewMenu(tab, viewId, {
      editAnchor: tab,
      rename: () => this.startTabRename(tab, viewId),
      withDisplay: true,
    });
  }

  /**
   * The view menu, shared by a tab and its overflow row. "Display as" is the
   * bar's setting, not the view's, so the overflow row leaves it out.
   */
  private showViewMenu(
    trigger: HTMLElement,
    viewId: string,
    menu: { editAnchor: HTMLElement; rename: () => void; withDisplay: boolean }
  ): void {
    this.closeContextPopover();

    const canDelete = this.options.views.length > 1;
    const t = this.t.bind(this);

    const onEditView = this.options.onEditView;
    const editItems = onEditView === undefined ? [] : [{
      icon: IconSliders,
      name: 'database-view-edit',
      title: t('tools.database.editView', 'Edit view'),
      closeOnActivate: true,
      onActivate: () => {
        onEditView(viewId, menu.editAnchor);
      },
    }];
    const baseItems = [
      ...editItems,
      {
        icon: IconPencil,
        name: 'database-view-rename',
        title: t('tools.database.renameView', 'Rename'),
        closeOnActivate: true,
        onActivate: menu.rename,
      },
      {
        icon: IconCopy,
        name: 'database-view-duplicate',
        title: t('tools.database.duplicateView', 'Duplicate'),
        closeOnActivate: true,
        onActivate: () => {
          this.options.onDuplicate(viewId);
        },
      },
      ...(menu.withDisplay ? this.displayItems() : []),
    ];

    const deleteItems = canDelete
      ? [
          { type: PopoverItemType.Separator as const },
          {
            icon: IconTrash,
            name: 'database-view-delete',
            title: t('tools.database.deleteView', 'Delete'),
            isDestructive: true,
            closeOnActivate: true,
            onActivate: () => {
              this.options.onDelete(viewId);
            },
          },
        ]
      : [];

    this.contextPopover = new PopoverDesktop({
      class: DATABASE_MENU_CLASS,
      animateClose: true,
      trigger,
      width: 'auto',
      minWidth: '160px',
      autoFocusFirstItem: false,
      items: [...baseItems, ...deleteItems],
    });

    this.contextPopover.on(PopoverEvent.Closed, () => {
      if (this.contextPopover !== null) {
        const p = this.contextPopover;
        this.contextPopover = null;
        p.destroy();
      }
    });

    this.contextPopover.show();
  }

  /** "Display as" (research/03 §1.2). */
  private displayItems(): PopoverItemParams[] {
    const onDisplayChange = this.options.onDisplayChange;

    if (onDisplayChange === undefined) return [];
    const current = this.options.display ?? 'both';
    const modes: Array<[DatabaseTabDisplay, string, string]> = [
      ['both', 'tools.database.tabDisplayBoth', 'Text and icon'],
      ['text', 'tools.database.tabDisplayText', 'Text only'],
      ['icon', 'tools.database.tabDisplayIcon', 'Icon only'],
    ];

    return [{
      icon: IconTabs,
      title: this.t('tools.database.tabDisplayAs', 'Display as'),
      children: {
        items: modes.map(([mode, key, fallback]) => ({
          name: `database-tab-display-${mode}`,
          title: this.t(key, fallback),
          isActive: mode === current,
          closeOnActivate: true,
          onActivate: () => onDisplayChange(mode),
        })),
      },
    }];
  }

  private closeContextPopover(): void {
    if (this.contextPopover !== null) {
      const popover = this.contextPopover;
      this.contextPopover = null;
      popover.destroy();
    }
  }

  private startTabRename(tab: HTMLElement, viewId: string): void {
    const nameSpan = tab.querySelector('[data-blok-database-tab-name]');
    if (!(nameSpan instanceof HTMLElement)) {
      return;
    }
    this.startRename(nameSpan, viewId, 'data-blok-database-tab-name');
  }

  private startRename(nameSpan: HTMLElement, viewId: string, nameAttr: string): void {
    const originalName = nameSpan.textContent ?? '';

    const buildNameSpan = (name: string): HTMLElement => {
      const span = document.createElement('span');
      span.setAttribute(nameAttr, '');
      span.textContent = name;
      return span;
    };

    startInlineRename({
      target: nameSpan,
      currentValue: originalName,
      label: this.options.api?.i18n.t('tools.database.renameView') ?? 'Rename',
      configureInput: (input) => {
        input.setAttribute('data-blok-database-tab-rename-input', '');
      },
      buildRestored: buildNameSpan,
      onCommit: (newName) => {
        if (newName !== originalName) {
          this.options.onRename(viewId, newName);
        }
      },
    });
  }

  private openViewPopover(anchor: HTMLElement): void {
    if (this.viewPopover !== null) {
      this.viewPopover.destroy();
    }
    anchor.setAttribute('data-popover-open', '');
    this.barEl?.setAttribute('data-popover-open', '');
    this.viewPopover = new DatabaseViewPopover({
      onSelect: (type) => {
        this.options.onAddView(type);
      },
      onClose: () => {
        anchor.removeAttribute('data-popover-open');
        this.barEl?.removeAttribute('data-popover-open');
      },
      api: this.options.api,
    });
    this.viewPopover.open(anchor);
  }

  handleOverflow(visibleCount: number): void {
    if (this.element === null) return;

    // Remove existing more button
    this.moreBtnEl?.remove();

    const orderedViews = [...this.views].sort((a, b) => (a.position < b.position ? -1 : 1));
    const hiddenCount = orderedViews.length - visibleCount;
    if (hiddenCount <= 0) return;

    // Hide overflow tabs
    const tabs = Array.from(this.element.querySelectorAll<HTMLElement>('[data-blok-database-tab]'));

    for (const tab of tabs.slice(visibleCount)) {
      tab.style.display = 'none';
    }

    // Add the localized overflow-count button before the + button.
    const moreBtn = document.createElement('div');
    moreBtn.setAttribute('data-blok-database-tab-more', '');
    moreBtn.setAttribute('role', 'button');
    moreBtn.setAttribute('tabindex', '0');
    moreBtn.textContent = this.options.api?.i18n.has('tools.database.moreViews')
      ? this.options.api.i18n.t('tools.database.moreViews', { count: hiddenCount })
      : `${hiddenCount} more…`;
    moreBtn.style.cursor = 'pointer';
    moreBtn.addEventListener('click', () => {
      this.openOverflowDropdown(moreBtn);
    });
    activateOnEnterOrSpace(moreBtn, () => {
      this.openOverflowDropdown(moreBtn);
    });

    const addBtn = this.element.querySelector('[data-blok-database-add-view]');
    if (addBtn !== null) {
      this.element.insertBefore(moreBtn, addBtn);
    } else {
      this.element.appendChild(moreBtn);
    }
    this.moreBtnEl = moreBtn;
  }

  /**
   * research/13 §3a: a "Search for a view..." field, every view in tab order
   * with a drag handle and "•••", then "New view".
   */
  private openOverflowDropdown(anchor: HTMLElement): void {
    this.closeOverflowDropdown();

    const dropdown = document.createElement('div');
    dropdown.setAttribute('data-blok-popover', '');
    dropdown.setAttribute('data-blok-database-tab-overflow-dropdown', '');
    dropdown.setAttribute(DATA_ATTR.keyboardOwner, '');
    dropdown.style.zIndex = '1000';

    const orderedViews = [...this.views].sort((a, b) => (a.position < b.position ? -1 : 1));
    const searchItems = orderedViews.map((view) => ({ title: view.name }));
    const search = new SearchInput({
      items: searchItems,
      placeholder: this.t('tools.database.searchViews', 'Search for a view...'),
    });
    const rows = orderedViews.map((view) => this.createOverflowRow(view, anchor));

    // Matches stay in tab order; the shared search only decides which match.
    search.on(SearchInputEvent.Search, ({ query, items }) => {
      rows.forEach((row, index) => {
        row.toggleAttribute('hidden', query !== '' && !items.includes(searchItems[index]));
      });
    });
    dropdown.append(search.getElement(), ...rows);
    this.overflowSearch = search;

    const separator = document.createElement('div');
    separator.setAttribute('data-blok-database-tab-overflow-separator', '');
    dropdown.appendChild(separator);

    const addBtn = this.element?.querySelector<HTMLElement>('[data-blok-database-add-view]');
    const newViewBtn = document.createElement('div');
    const openNewViewPopover = (): void => {
      this.closeOverflowDropdown();
      if (addBtn !== null && addBtn !== undefined) {
        this.openViewPopover(addBtn);
      }
    };
    const newViewIcon = document.createElement('span');
    const newViewLabel = document.createElement('span');

    newViewBtn.setAttribute('data-blok-database-tab-overflow-new', '');
    newViewBtn.setAttribute('role', 'button');
    newViewBtn.setAttribute('tabindex', '0');
    newViewIcon.setAttribute('aria-hidden', 'true');
    newViewIcon.innerHTML = IconPlus;
    newViewLabel.textContent = this.t('tools.database.newView', 'New view');
    newViewBtn.append(newViewIcon, newViewLabel);
    newViewBtn.addEventListener('click', openNewViewPopover);
    activateOnEnterOrSpace(newViewBtn, openNewViewPopover);
    dropdown.appendChild(newViewBtn);

    document.body.appendChild(dropdown);
    const reposition = (): void => {
      positionFixedAnchored(dropdown, anchor, { side: 'bottom', offset: 4 });
    };

    // The anchor mirrors with the editor, so a flip re-places the dropdown.
    syncPortalDirection(dropdown, { source: anchor, onResync: reposition });
    this.overflowDropdownEl = dropdown;

    reposition();
    this.overflowPositionTracker = createPositionTracker(dropdown, reposition);
    this.overflowPositionTracker.attach();

    // The row menu mounts in <body>, outside the list, but belongs to it.
    this.boundOverflowClose = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!dropdown.contains(target) && !anchor.contains(target) && this.contextPopover?.hasNode(target) !== true) {
        this.closeOverflowDropdown();
      }
    };

    document.addEventListener('mousedown', this.boundOverflowClose);
    // Window capture runs before the popover registry's document-capture
    // Escape, so one press peels only the top layer.
    window.addEventListener('keydown', this.handleOverflowKeyDown, true);
    search.focus();
  }

  private readonly handleOverflowKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing) {
      return;
    }
    const target = event.target;

    // A row rename owns its Escape (it restores the old name).
    if (target instanceof HTMLInputElement && target.hasAttribute('data-blok-database-tab-rename-input')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (this.overflowRowDrag !== null) {
      this.endOverflowRowDrag();
      this.overflowDropdownEl?.replaceChildren(...this.overflowRowsInViewOrder());
      return;
    }
    if (this.contextPopover !== null) {
      this.closeContextPopover();
      return;
    }
    this.closeOverflowDropdown();
  };

  private createOverflowRow(view: DatabaseViewConfig, anchor: HTMLElement): HTMLElement {
    const item = document.createElement('div');
    item.setAttribute('data-blok-database-tab-overflow-item', '');
    item.setAttribute('data-view-id', view.id);

    if (view.id === this.options.activeViewId) {
      item.setAttribute('data-active', '');
    }

    const iconSpan = document.createElement('span');
    iconSpan.innerHTML = VIEW_ICONS[view.type] ?? '';

    const nameSpan = document.createElement('span');
    nameSpan.setAttribute('data-blok-database-tab-overflow-name', '');
    nameSpan.textContent = view.name;

    if (this.readOnly) {
      item.append(iconSpan, nameSpan);
    } else {
      const handle = this.overflowRowButton('data-blok-database-tab-overflow-handle', IconMenu, this.t('tools.database.settingsDragToReorder', 'Drag to reorder'));
      const menu = this.overflowRowButton('data-blok-database-tab-overflow-menu', IconDotsHorizontal, this.t('tools.database.tableMoreActions', 'More actions'));

      handle.addEventListener('pointerdown', (event) => this.startOverflowRowDrag(event, view.id, item));
      menu.addEventListener('click', () => {
        const tab = this.element?.querySelector<HTMLElement>(`[data-blok-database-tab][data-view-id="${CSS.escape(view.id)}"]`);

        this.showViewMenu(menu, view.id, {
          editAnchor: tab !== null && tab !== undefined && tab.style.display !== 'none' ? tab : anchor,
          rename: () => {
            const current = item.querySelector<HTMLElement>('[data-blok-database-tab-overflow-name]');

            if (current !== null) {
              this.startRename(current, view.id, 'data-blok-database-tab-overflow-name');
            }
          },
          withDisplay: false,
        });
      });
      item.append(handle, iconSpan, nameSpan, menu);
    }

    item.addEventListener('click', (event) => {
      // Its buttons and a rename field act on the row; they do not open it.
      if (event.target instanceof Element && event.target.closest('button, input') !== null) {
        return;
      }
      if (view.id !== this.options.activeViewId) {
        this.options.onTabClick(view.id);
      }
      this.closeOverflowDropdown();
    });

    return item;
  }

  private overflowRowButton(attribute: string, icon: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(attribute, '');
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;

    return button;
  }

  private overflowRowsInViewOrder(): Node[] {
    const dropdown = this.overflowDropdownEl;

    if (dropdown === null) {
      return [];
    }
    const children = Array.from(dropdown.children);
    const rows = children.filter((child) => child.hasAttribute('data-blok-database-tab-overflow-item'));
    const order = [...this.views].sort((a, b) => (a.position < b.position ? -1 : 1)).map((view) => view.id);

    rows.sort((a, b) => order.indexOf(a.getAttribute('data-view-id') ?? '') - order.indexOf(b.getAttribute('data-view-id') ?? ''));

    return [children[0], ...rows, ...children.filter((child) => child !== children[0] && !rows.includes(child))];
  }

  /** The row follows the pointer through the list; the drop commits the order the list shows. */
  private startOverflowRowDrag(event: PointerEvent, viewId: string, row: HTMLElement): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.overflowRowDrag = { viewId, row, moved: false };
    row.setAttribute('data-dragging', '');
    document.addEventListener('pointermove', this.handleOverflowRowMove);
    document.addEventListener('pointerup', this.handleOverflowRowUp);
    document.addEventListener('pointercancel', this.handleOverflowRowCancel);
  }

  private readonly handleOverflowRowMove = (event: PointerEvent): void => {
    const drag = this.overflowRowDrag;
    const dropdown = this.overflowDropdownEl;

    if (drag === null || dropdown === null) {
      return;
    }
    const others = Array.from(dropdown.querySelectorAll<HTMLElement>('[data-blok-database-tab-overflow-item]'))
      .filter((row) => row !== drag.row && !row.hidden);
    const before = others.find((row) => {
      const rect = row.getBoundingClientRect();

      return event.clientY < (rect.top + rect.bottom) / 2;
    });
    const last = others.at(-1);

    if (before !== undefined) {
      if (drag.row.nextElementSibling !== before) {
        before.before(drag.row);
        drag.moved = true;
      }
    } else if (last !== undefined && last.nextElementSibling !== drag.row) {
      last.after(drag.row);
      drag.moved = true;
    }
  };

  private readonly handleOverflowRowUp = (): void => {
    const drag = this.overflowRowDrag;

    this.endOverflowRowDrag();
    if (drag === null || !drag.moved) {
      return;
    }
    const neighbour = (element: Element | null, step: 'previousElementSibling' | 'nextElementSibling'): string | null => {
      const next = element?.[step] ?? null;

      if (next === null || !next.hasAttribute('data-blok-database-tab-overflow-item')) {
        return null;
      }

      return next.getAttribute('data-view-id');
    };

    this.reorderBetween(drag.viewId, neighbour(drag.row, 'previousElementSibling'), neighbour(drag.row, 'nextElementSibling'));
  };

  private readonly handleOverflowRowCancel = (): void => {
    this.endOverflowRowDrag();
    this.overflowDropdownEl?.replaceChildren(...this.overflowRowsInViewOrder());
  };

  private endOverflowRowDrag(): void {
    this.overflowRowDrag?.row.removeAttribute('data-dragging');
    this.overflowRowDrag = null;
    document.removeEventListener('pointermove', this.handleOverflowRowMove);
    document.removeEventListener('pointerup', this.handleOverflowRowUp);
    document.removeEventListener('pointercancel', this.handleOverflowRowCancel);
  }

  /** Moves a view between two neighbours, the same way for a tab and an overflow row. */
  private reorderBetween(viewId: string, afterViewId: string | null, beforeViewId: string | null): void {
    const afterView = afterViewId === null ? undefined : this.views.find((v) => v.id === afterViewId);
    const beforeView = beforeViewId === null ? undefined : this.views.find((v) => v.id === beforeViewId);

    this.onReorder(viewId, generateKeyBetween(afterView?.position ?? null, beforeView?.position ?? null));
  }

  private closeOverflowDropdown(): void {
    this.overflowPositionTracker?.detach();
    this.overflowPositionTracker = null;
    this.endOverflowRowDrag();
    this.overflowSearch?.destroy();
    this.overflowSearch = null;
    window.removeEventListener('keydown', this.handleOverflowKeyDown, true);

    if (this.overflowDropdownEl !== null) {
      this.overflowDropdownEl.remove();
      this.overflowDropdownEl = null;
    }
    if (this.boundOverflowClose !== null) {
      document.removeEventListener('mousedown', this.boundOverflowClose);
      this.boundOverflowClose = null;
    }
  }

  private handleDragMove(e: PointerEvent): void {
    const dx = Math.abs(e.clientX - this.dragStartX);
    if (!this.isDragging && dx < DRAG_THRESHOLD) return;
    if (!this.isDragging) {
      this.isDragging = true;
      this.element?.setAttribute('data-dragging', '');
      const sourceTab = this.element?.querySelector(`[data-view-id="${this.dragViewId}"]`) as HTMLElement | null;
      if (sourceTab !== null) {
        this.ghostEl = sourceTab.cloneNode(true) as HTMLElement;
        this.ghostEl.setAttribute('data-blok-database-tab-ghost', '');
        this.ghostEl.style.position = 'fixed';
        this.ghostEl.style.pointerEvents = 'none';
        this.ghostEl.style.zIndex = '50';
        this.ghostEl.style.opacity = '0.7';
        copyGhostRadius(sourceTab, this.ghostEl);
        const rect = sourceTab.getBoundingClientRect();
        this.ghostEl.style.top = `${rect.top}px`;
        this.ghostEl.style.width = `${rect.width}px`;
        mountGhost(sourceTab, this.ghostEl);
        sourceTab.style.opacity = '0.4';
      }
    }
    if (this.ghostEl !== null) {
      this.ghostEl.style.left = `${e.clientX - 50}px`;
    }
  }

  private handleDragUp(e: PointerEvent): void {
    if (!this.isDragging) {
      this.removeDragListeners();
      return;
    }
    const tabs = Array.from(
      this.element?.querySelectorAll<HTMLElement>('[data-blok-database-tab]') ?? []
    ).filter((t) => t.getAttribute('data-view-id') !== this.dragViewId);

    const dropIndex = tabs.findIndex((t) => {
      const rect = t.getBoundingClientRect();
      return e.clientX < (rect.left + rect.right) / 2;
    });

    const beforeViewId = dropIndex >= 0 ? tabs[dropIndex].getAttribute('data-view-id') : null;
    const afterViewId = ((): string | null => {
      if (dropIndex > 0) return tabs[dropIndex - 1].getAttribute('data-view-id');
      if (dropIndex === -1 && tabs.length > 0) return tabs[tabs.length - 1].getAttribute('data-view-id');
      return null;
    })();

    const viewId = this.dragViewId;

    this.cleanupDrag();
    this.reorderBetween(viewId, afterViewId, beforeViewId);
  }

  private cleanupDrag(): void {
    if (this.ghostEl !== null) {
      this.ghostEl.remove();
      this.ghostEl = null;
    }
    this.element?.removeAttribute('data-dragging');
    const sourceTab = this.element?.querySelector(`[data-view-id="${this.dragViewId}"]`) as HTMLElement | null;
    if (sourceTab !== null) {
      sourceTab.style.opacity = '';
    }
    this.isDragging = false;
    this.removeDragListeners();
  }

  private removeDragListeners(): void {
    document.removeEventListener('pointermove', this.boundDragMove);
    document.removeEventListener('pointerup', this.boundDragUp);
    document.removeEventListener('pointercancel', this.boundDragCancel);
    document.removeEventListener('keydown', this.boundDragKeyDown);
  }

  setReadOnly(state: boolean): void {
    if (this.readOnly === state) {
      return;
    }
    this.readOnly = state;

    if (this.barEl === null || this.addBtnEl === null) {
      return;
    }

    if (state) {
      this.addBtnEl.remove();
    } else {
      // Only re-attach to bar if the button isn't already placed elsewhere (e.g. title row)
      if (!this.addBtnEl.isConnected) {
        this.barEl.appendChild(this.addBtnEl);
      }
    }
  }

  destroy(): void {
    this.cleanupDrag();
    this.closeContextPopover();
    this.closeOverflowDropdown();
    this.roving?.destroy();
    this.roving = null;
    if (this.viewPopover !== null) {
      this.viewPopover.destroy();
      this.viewPopover = null;
    }
  }

  getAddBtnEl(): HTMLElement | null {
    return this.addBtnEl;
  }
}
