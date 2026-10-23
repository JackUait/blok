import { generateKeyBetween } from 'fractional-indexing';
import { IconBoard, IconCalendar, IconChart, IconGallery, IconList, IconMessage, IconTable, IconTimeline, IconPencil, IconCopy, IconTrash, IconPlus, IconSliders, IconColumns, IconListChecklist, IconMap, IconTabs, IconPreview, IconDatabase } from '../../components/icons';
import { DatabaseViewPopover } from './database-view-popover';
import { DATABASE_MENU_CLASS } from './database-group-menu';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { OverflowList, tabsThatFit } from '../../components/utils/overflow-list';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { startInlineRename } from '../../components/utils/inline-rename';
import { rovingRadioGroup, type RovingRadioGroup } from '../../components/utils/roving-radio-group';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import type { API } from '../../../types';
import type { DatabaseTabDisplay, DatabaseViewConfig, ViewType } from './types';
import { copyGhostRadius, mountGhost } from './copy-ghost-radius';
import { isHistoryKey } from './database-keyboard';

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

export const VIEW_ICONS: Record<string, string> = {
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
  /** A promise means it asked first: true once the view is gone, false when cancelled. */
  onDelete: (viewId: string) => void | Promise<boolean>;
  onReorder: (viewId: string, newPosition: string) => void;
  /** "Edit view": opens the view settings panel under the tab. */
  onEditView?: (viewId: string, anchor: HTMLElement) => void;
  /** "Rename" opens the view settings with the name field focused (findings V08). Without it, the tab renames inline. */
  onRenameView?: (viewId: string, anchor: HTMLElement) => void;
  /** This person's "Display as". Defaults to both. */
  display?: DatabaseTabDisplay;
  /** Offers "Display as" in the tab menu. */
  onDisplayChange?: (display: DatabaseTabDisplay) => void;
  api?: API;
  readOnly?: boolean;
  /** Layouts the add-view menu leaves out. */
  hiddenViewTypes?: readonly ViewType[];
  /** The title line above the tabs is hidden. One setting for the whole database. */
  dataSourceTitlesHidden?: boolean;
  /** Offers "Hide / Show data source titles" in the tab menu. */
  onDataSourceTitlesToggle?: () => void;
  /** Offers "New data source" last in the add-view menu and the "N more…" list (research/23 §10). */
  onNewDataSource?: () => void;
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

  private overflowList: OverflowList | null = null;
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
      // The editor's undo would rewrite views under the drag.
      if (isHistoryKey(e)) { e.preventDefault(); }
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

        const addBtnWidth = 40;
        const active = tabs.findIndex((tab) => tab.getAttribute('data-view-id') === this.options.activeViewId);
        const widths = tabs.map((tab) => tab.offsetWidth + 2);
        // clientWidth counts the padding that centres the bar on a wide page.
        const style = getComputedStyle(this.element);
        const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
        const budget = this.element.clientWidth - padding - addBtnWidth;

        if (tabsThatFit(widths, active, budget, 0).length === tabs.length) {
          return;
        }
        // Once a tab folds, "N more…" takes room too; measured with the widest count it can show.
        // The +2 on each tab already pays the gap before it.
        const more = this.placeMoreButton(tabs.length);

        this.foldTabs(tabsThatFit(widths, active, budget - more.offsetWidth, 0));
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
   * The view menu, shared by a tab and its overflow row. "Display as" and the
   * data source titles are the bar's settings, not the view's, so the overflow
   * row leaves them out.
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
        onActivate: this.options.onRenameView === undefined ? menu.rename : () => this.options.onRenameView?.(viewId, menu.editAnchor),
      },
      ...(menu.withDisplay ? this.dataSourceTitleItems() : []),
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
            onActivate: () => this.deleteFromMenu(viewId),
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

  /** "Hide data source titles" (research/23 §10). The item stays with one source too. */
  private dataSourceTitleItems(): PopoverItemParams[] {
    const onToggle = this.options.onDataSourceTitlesToggle;

    if (onToggle === undefined) return [];
    const hidden = this.options.dataSourceTitlesHidden === true;

    return [{
      icon: IconPreview,
      name: 'database-view-data-source-titles',
      title: hidden
        ? this.t('tools.database.showDataSourceTitles', 'Show data source titles')
        : this.t('tools.database.hideDataSourceTitles', 'Hide data source titles'),
      closeOnActivate: true,
      onActivate: onToggle,
    }];
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

  /**
   * research/30 B3: a delete that asks first keeps the menu open behind its
   * dialog; after Cancel the cursor goes back to the Delete row.
   */
  private deleteFromMenu(viewId: string): void {
    const popover = this.contextPopover;
    // Before onDelete: the dialog takes focus as it opens, and that would close the menu.
    const release = popover?.holdOpen();
    const asked = this.options.onDelete(viewId);

    if (asked === undefined || release === undefined) {
      this.closeContextPopover();

      return;
    }

    void asked.then((deleted) => {
      // A rebuild while the dialog was up already closed this menu.
      if (this.contextPopover !== popover) return;
      if (deleted) {
        this.closeContextPopover();

        return;
      }
      release('database-view-delete');
    });
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
      ...(this.options.hiddenViewTypes !== undefined ? { hidden: this.options.hiddenViewTypes } : {}),
      ...(this.options.onNewDataSource !== undefined && !this.readOnly ? { onNewSource: this.options.onNewDataSource } : {}),
    });
    this.viewPopover.open(anchor);
  }

  /** Keeps the first `visibleCount` tabs and folds the rest. */
  handleOverflow(visibleCount: number): void {
    this.foldTabs(Array.from({ length: visibleCount }, (_, i) => i));
  }

  /** Keeps the tabs at `shown` (indices in view order) and folds the rest behind "N more…". */
  private foldTabs(shown: readonly number[]): void {
    if (this.element === null) return;

    // Remove existing more button
    this.moreBtnEl?.remove();

    const hiddenCount = this.views.length - shown.length;
    if (hiddenCount <= 0) return;

    const tabs = Array.from(this.element.querySelectorAll<HTMLElement>('[data-blok-database-tab]'));

    for (const [index, tab] of tabs.entries()) {
      if (!shown.includes(index)) {
        tab.style.display = 'none';
      }
    }

    this.placeMoreButton(hiddenCount);
  }

  /** Puts the localized "N more…" button before the + button, replacing any earlier one. */
  private placeMoreButton(hiddenCount: number): HTMLElement {
    this.moreBtnEl?.remove();

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

    const addBtn = this.element?.querySelector('[data-blok-database-add-view]') ?? null;
    if (addBtn !== null) {
      this.element?.insertBefore(moreBtn, addBtn);
    } else {
      this.element?.appendChild(moreBtn);
    }
    this.moreBtnEl = moreBtn;

    return moreBtn;
  }

  /** research/13 §3a: the shared "N more…" list over this bar's views. */
  private openOverflowDropdown(anchor: HTMLElement): void {
    this.closeOverflowDropdown();

    const orderedViews = [...this.views].sort((a, b) => (a.position < b.position ? -1 : 1));
    const list = new OverflowList({
      anchor,
      prefix: 'data-blok-database-tab-overflow',
      idAttribute: 'data-view-id',
      rows: orderedViews.map((view) => ({
        id: view.id,
        name: view.name,
        icon: { svg: VIEW_ICONS[view.type] ?? '' },
        active: view.id === this.options.activeViewId,
      })),
      labels: {
        search: this.t('tools.database.searchViews', 'Search for a view...'),
        handle: this.t('tools.database.settingsDragToReorder', 'Drag to reorder'),
        menu: this.t('tools.database.tableMoreActions', 'More actions'),
        newItem: this.t('tools.database.newView', 'New view'),
        noResults: this.t('find.noResults', 'No results'),
      },
      readOnly: this.readOnly,
      onSelect: (viewId) => {
        if (viewId !== this.options.activeViewId) {
          this.options.onTabClick(viewId);
        }
      },
      onReorder: (viewId, afterId, beforeId) => this.reorderBetween(viewId, afterId, beforeId),
      onMenu: (button, viewId, row) => {
        const tab = this.element?.querySelector<HTMLElement>(`[data-blok-database-tab][data-view-id="${CSS.escape(viewId)}"]`);

        this.showViewMenu(button, viewId, {
          editAnchor: tab !== null && tab !== undefined && tab.style.display !== 'none' ? tab : anchor,
          rename: () => {
            const current = row.querySelector<HTMLElement>('[data-blok-database-tab-overflow-name]');

            if (current !== null) {
              this.startRename(current, viewId, 'data-blok-database-tab-overflow-name');
            }
          },
          withDisplay: false,
        });
      },
      onNew: () => {
        const addBtn = this.element?.querySelector<HTMLElement>('[data-blok-database-add-view]');

        if (addBtn !== null && addBtn !== undefined) {
          this.openViewPopover(addBtn);
        }
      },
      ...(this.readOnly || this.options.onNewDataSource === undefined ? {} : {
        onNewSecond: { label: this.t('tools.database.newDataSource', 'New data source'), icon: IconDatabase, activate: this.options.onNewDataSource },
      }),
      // The row menu mounts in <body>, outside the list, but belongs to it.
      ownsNode: (target) => this.contextPopover?.hasNode(target) === true,
      closeLayer: () => {
        if (this.contextPopover === null) {
          return false;
        }
        this.closeContextPopover();

        return true;
      },
      // A row rename owns its Escape (it restores the old name).
      ownsEscape: (target) => target instanceof HTMLInputElement && target.hasAttribute('data-blok-database-tab-rename-input'),
    });

    this.overflowList = list;
    list.open();
  }

  /** Moves a view between two neighbours, the same way for a tab and an overflow row. */
  private reorderBetween(viewId: string, afterViewId: string | null, beforeViewId: string | null): void {
    const afterView = afterViewId === null ? undefined : this.views.find((v) => v.id === afterViewId);
    const beforeView = beforeViewId === null ? undefined : this.views.find((v) => v.id === beforeViewId);

    this.onReorder(viewId, generateKeyBetween(afterView?.position ?? null, beforeView?.position ?? null));
  }

  private closeOverflowDropdown(): void {
    const list = this.overflowList;

    this.overflowList = null;
    list?.close();
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

    // Folded tabs can sit between shown ones (the current view stays shown):
    // a drop between shown tabs lands right after the one on its left; past
    // the row it goes after every view.
    const shown = tabs.filter((t) => t.style.display !== 'none');
    const dropIndex = shown.findIndex((t) => {
      const rect = t.getBoundingClientRect();
      return e.clientX < (rect.left + rect.right) / 2;
    });
    const afterTab = dropIndex === -1 ? tabs.at(-1) : shown[dropIndex - 1];
    const nextIndex = afterTab === undefined ? 0 : tabs.indexOf(afterTab) + 1;
    const beforeTab = dropIndex === -1 ? undefined : tabs[nextIndex];
    const afterViewId = afterTab?.getAttribute('data-view-id') ?? null;
    const beforeViewId = beforeTab?.getAttribute('data-view-id') ?? null;

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
