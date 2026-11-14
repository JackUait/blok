import { IconChevronDown, IconViewBoard, IconChart, IconGallery, IconListBulleted, IconTable, IconPencil, IconCopy, IconTrash, IconPlus, IconSliders, IconMap, IconTabs, IconPreview, IconDatabase, IconViewCalendar, IconViewFeed, IconForm, IconViewTimeline, IconViewDashboard, IconLink, IconDotsHorizontal, IconPageLayout, IconEyeSlash, IconExpandDiagonal } from '../../components/icons';
import { ADD_VIEW_MENU_WIDTH, DatabaseViewPopover } from './database-view-popover';
import { DATABASE_MENU_CLASS, DATABASE_SUBMENU_OPEN_DELAY_MS } from './database-group-menu';
import { DATABASE_HEADER_MENU_CLASS } from './database-table-menus';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { OverflowList } from '../../components/utils/overflow-list';
import { planViewBarFold } from './database-view-bar-fold';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import type { PopoverItemParams } from '@/types/utils/popover/popover-item';
import { startInlineRename } from '../../components/utils/inline-rename';
import { onHover } from '../../components/utils/tooltip';
import { rovingRadioGroup, type RovingRadioGroup } from '../../components/utils/roving-radio-group';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import type { API } from '../../../types';
import type { DatabaseTabDisplay, DatabaseViewConfig, ViewType } from './types';
import { isHistoryKey } from './database-keyboard';
import { propertyHint } from './property-hint';
import { positionBetween } from '../../shared/database/positions';

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
  board: IconViewBoard,
  list: IconListBulleted,
  table: IconTable,
  gallery: IconGallery,
  calendar: IconViewCalendar,
  timeline: IconViewTimeline,
  chart: IconChart,
  feed: IconViewFeed,
  form: IconForm,
  map: IconMap,
  dashboard: IconViewDashboard,
};

/** Each layout's name, for a tab's hint. */
const VIEW_LABEL_KEYS: Record<ViewType, string> = {
  board: 'tools.database.viewTypeBoard',
  list: 'tools.database.viewTypeList',
  table: 'tools.database.viewTypeTable',
  gallery: 'tools.database.viewTypeGallery',
  calendar: 'tools.database.viewTypeCalendar',
  timeline: 'tools.database.viewTypeTimeline',
  chart: 'tools.database.viewTypeChart',
  feed: 'tools.database.viewTypeFeed',
  form: 'tools.database.viewTypeForm',
  map: 'tools.database.viewTypeMap',
  dashboard: 'tools.database.viewTypeDashboard',
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
  /** "Copy link to view". */
  onCopyLink?: (viewId: string) => void;
  /** "Open as full page": read when the menu opens; undefined leaves the row out. */
  openFullPage?: () => ((viewId: string) => void) | undefined;
  /** "Edit title" in the title row's "…". */
  onEditTitle?: () => void;
  /** "Edit layout" in the title row's "…": Customize layout on a row page. */
  onEditLayout?: () => void;
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
  /** The database's name, read on hover for each tab's "Table view of …" hint. */
  sourceTitle?: () => string;
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
  /** "Table ⌄": the current view as one button once fewer than two tabs fit. */
  private compactBtnEl: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private isDragging = false;
  /** The click after a drop belongs to the drag, not the tab. */
  private dragEnded = false;
  private dragViewId = '';
  private dragStartX = 0;
  /** The shown tabs and their centres at pickup: the slots the drop and the slides read, untouched by the transforms. */
  private dragSlots: Array<{ tab: HTMLElement; center: number }> = [];
  /** The dragged tab's own slot among them, and how far a passed tab slides: its width and the bar's gap. */
  private dragHome = 0;
  private dragStep = 0;
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
    onHover(addBtn, this.t('tools.database.addNewView', 'Add a new view'));
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
      if (viewId === null || this.consumeDragClick()) {
        return;
      }
      // feel/findings-toolbar V06: a click on the current tab opens its menu. A
      // second click while it is open does nothing (same-trigger law).
      if (viewId === this.options.activeViewId) {
        if (!this.readOnly && this.contextPopover === null) this.openContextPopover(tab, viewId);

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
      // The first click of the pair already opened the menu on the current tab.
      if (this.readOnly || this.contextPopover !== null) {
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
      this.dragEnded = false;
      this.dragViewId = viewId;
      this.dragStartX = e.clientX;
      this.isDragging = false;
      document.addEventListener('pointermove', this.boundDragMove);
      document.addEventListener('pointerup', this.boundDragUp);
      document.addEventListener('pointercancel', this.boundDragCancel);
      document.addEventListener('keydown', this.boundDragKeyDown);
    });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.refold());
      this.resizeObserver.observe(bar);
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

  /**
   * Folds the view bar to its width (notion-spec-2 §26.1): tabs into "N more…",
   * then "Table ⌄", then the toolbar's icon group, then New. The marks for the
   * toolbar go on the view bar, so a toolbar moved to the title row drops them.
   */
  private refold(): void {
    const bar = this.element;

    if (bar === null) return;
    const parent = bar.parentElement;
    const viewBar = parent?.hasAttribute('data-blok-database-view-bar') === true ? parent : null;
    const toolbar = viewBar?.querySelector<HTMLElement>(':scope > [data-blok-database-view-toolbar]') ?? null;
    const tabs = Array.from(bar.querySelectorAll<HTMLElement>('[data-blok-database-tab]'));

    for (const tab of tabs) {
      tab.style.display = '';
    }
    this.moreBtnEl?.remove();
    this.moreBtnEl = null;
    this.compactBtnEl?.remove();
    this.compactBtnEl = null;
    bar.removeAttribute('data-blok-database-tab-folded');
    viewBar?.removeAttribute('data-blok-database-fold-icons');
    viewBar?.removeAttribute('data-blok-database-fold-new');
    if (!bar.isConnected) return;

    // The padding that centres the bar on a wide page is not room for tabs.
    const style = getComputedStyle(bar);
    const padding = (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    const full = toolbar?.offsetWidth ?? 0;

    viewBar?.setAttribute('data-blok-database-fold-icons', '');
    const noIcons = toolbar?.offsetWidth ?? 0;

    viewBar?.removeAttribute('data-blok-database-fold-icons');

    const barStyle = viewBar === null ? null : getComputedStyle(viewBar);
    // The toolbar's end margin keeps it in the text column. Only the end side: the start margin is auto, so it reads as the free space.
    const toolbarStyle = toolbar === null ? null : getComputedStyle(toolbar);
    const toolbarEnd = toolbarStyle === null ? 0 : Number.parseFloat(toolbarStyle.direction === 'rtl' ? toolbarStyle.marginLeft : toolbarStyle.marginRight) || 0;
    const width = viewBar === null || barStyle === null
      ? bar.clientWidth - padding
      : viewBar.clientWidth - (Number.parseFloat(barStyle.paddingLeft) || 0) - (Number.parseFloat(barStyle.paddingRight) || 0) - padding - toolbarEnd;
    const gap = full > 0 ? Number.parseFloat(barStyle?.columnGap ?? '') || 0 : 0;
    // The 28px "+" and the 1px gaps before it and before "N more…";
    // each tab pays the 1px gap before it (database.css).
    const add = this.addBtnEl !== null && bar.contains(this.addBtnEl) ? 30 : 0;
    // "N more…" is measured with the widest count it can show.
    const probe = this.placeMoreButton(tabs.length);
    const more = probe.offsetWidth;

    probe.remove();
    this.moreBtnEl = null;

    const fold = planViewBarFold({
      width,
      gap,
      tabs: tabs.map((tab) => tab.offsetWidth + 1),
      current: tabs.findIndex((tab) => tab.getAttribute('data-view-id') === this.options.activeViewId),
      add,
      more,
      toolbar: { full, noIcons },
    });

    viewBar?.toggleAttribute('data-blok-database-fold-icons', !fold.icons);
    viewBar?.toggleAttribute('data-blok-database-fold-new', !fold.newButton);
    if (fold.tabs === 'all') return;
    // Notion's "+" leaves once a tab folds.
    bar.setAttribute('data-blok-database-tab-folded', '');
    if (fold.tabs === 'compact') {
      for (const tab of tabs) {
        tab.style.display = 'none';
      }
      this.placeCompactButton();

      return;
    }
    this.foldTabs(fold.tabs);
  }

  /** "Table ⌄": the current view's icon and name and a chevron; it opens the views list. */
  private placeCompactButton(): void {
    const view = this.options.views.find((v) => v.id === this.options.activeViewId);
    const button = document.createElement('div');
    const icon = document.createElement('span');
    const name = document.createElement('span');
    const chevron = document.createElement('span');

    button.setAttribute('data-blok-database-tab-compact', '');
    button.setAttribute('role', 'button');
    button.setAttribute('tabindex', '0');
    button.setAttribute('aria-haspopup', 'listbox');
    icon.setAttribute('data-blok-database-tab-icon', '');
    icon.innerHTML = view === undefined ? '' : VIEW_ICONS[view.type] ?? '';
    name.setAttribute('data-blok-database-tab-name', '');
    name.textContent = view?.name ?? '';
    chevron.setAttribute('data-blok-database-tab-compact-chevron', '');
    chevron.setAttribute('aria-hidden', 'true');
    chevron.innerHTML = IconChevronDown;
    button.append(icon, name, chevron);
    button.addEventListener('click', () => {
      this.openOverflowDropdown(button);
    });
    activateOnEnterOrSpace(button, () => {
      this.openOverflowDropdown(button);
    });
    this.element?.insertBefore(button, this.element.querySelector('[data-blok-database-add-view]'));
    this.compactBtnEl = button;
  }

  private consumeDragClick(): boolean {
    const ended = this.dragEnded;

    this.dragEnded = false;

    return ended;
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
    this.bindTabHint(tab, view);

    return tab;
  }

  /**
   * notion-motion.md Round 14, Round 15 §A: the name, then "Table view of New database", under the tab.
   * Round 23 §7: a dashboard has no source, so it reads "Dashboard view".
   */
  private bindTabHint(tab: HTMLElement, view: DatabaseViewConfig): void {
    const { api, sourceTitle } = this.options;

    if (api === undefined || sourceTitle === undefined) {
      return;
    }
    const layout = api.i18n.t(VIEW_LABEL_KEYS[view.type]);
    const hint = document.createElement('div');

    // The title can change while the tabs stay, so the hint is rebuilt on each hover.
    tab.addEventListener('mouseenter', () => {
      const detail = view.type === 'dashboard'
        ? api.i18n.t('tools.database.tabView', { layout })
        : api.i18n.t('tools.database.tabViewOf', { layout, database: sourceTitle() });

      hint.replaceChildren(propertyHint(view.name, detail));
    });
    onHover(tab, hint, { bare: true, placement: 'bottom' });
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
    const onCopyLink = this.options.onCopyLink;
    // The page opens on the shown view: switching first would save the switch, and opening changes nothing.
    const onOpenFullPage = viewId === this.options.activeViewId ? this.options.openFullPage?.() : undefined;
    // Notion's dashboard tab has no "Open as full page" (notion-motion.md Round 15 A).
    const dashboard = this.options.views.find((view) => view.id === viewId)?.type === 'dashboard';
    // Notion's order (feel/findings-toolbar V07).
    const editItems: PopoverItemParams[] = [
      {
        icon: IconPencil,
        name: 'database-view-rename',
        title: t('tools.database.renameView', 'Rename'),
        closeOnActivate: true,
        onActivate: this.options.onRenameView === undefined ? menu.rename : () => this.options.onRenameView?.(viewId, menu.editAnchor),
      },
      ...(menu.withDisplay ? this.displayItems() : []),
      ...(onEditView === undefined ? [] : [{
        icon: IconSliders,
        name: 'database-view-edit',
        title: t('tools.database.editView', 'Edit view'),
        closeOnActivate: true,
        onActivate: () => {
          onEditView(viewId, menu.editAnchor);
        },
      }]),
    ];
    const shareItems: PopoverItemParams[] = [
      ...(onCopyLink === undefined ? [] : [{
        icon: IconLink,
        name: 'database-view-copy-link',
        title: t('tools.database.layoutCopyLinkToView', 'Copy link to view'),
        closeOnActivate: true,
        onActivate: () => onCopyLink(viewId),
      }]),
      ...(onOpenFullPage === undefined || dashboard ? [] : [{
        icon: IconExpandDiagonal,
        name: 'database-view-full-page',
        title: t('tools.database.peekExpand', 'Open as full page'),
        closeOnActivate: true,
        onActivate: () => onOpenFullPage(viewId),
      }]),
      ...(menu.withDisplay ? this.dataSourceTitleItems() : []),
    ];
    const changeItems: PopoverItemParams[] = [
      {
        icon: IconCopy,
        name: 'database-view-duplicate',
        title: t('tools.database.layoutDuplicateView', 'Duplicate view'),
        closeOnActivate: true,
        onActivate: () => {
          this.options.onDuplicate(viewId);
        },
      },
      ...(canDelete ? [{
        icon: IconTrash,
        name: 'database-view-delete',
        title: t('tools.database.layoutDeleteView', 'Delete view'),
        isDestructive: true,
        onActivate: () => this.deleteFromMenu(viewId),
      }] : []),
    ];
    const items = [editItems, shareItems, changeItems]
      .filter((group) => group.length > 0)
      .flatMap((group, index) => index === 0 ? group : [{ type: PopoverItemType.Separator as const }, ...group]);

    // notion-motion.md Round 27 §3: 220 wide, rows 28 at pitch 29, 20px icon at +8, rules 12 in, 4 under the tab.
    this.showMenu(trigger, items, { class: `${DATABASE_HEADER_MENU_CLASS} blok-database-column-menu`, minWidth: '220px', offset: 4 });
  }

  private showMenu(
    trigger: HTMLElement,
    items: PopoverItemParams[],
    look: { class: string; minWidth: string; offset?: number } = { class: DATABASE_MENU_CLASS, minWidth: '160px' }
  ): void {
    this.closeContextPopover();
    this.contextPopover = new PopoverDesktop({
      class: look.class,
      animateClose: true,
      trigger,
      width: 'auto',
      minWidth: look.minWidth,
      ...(look.offset === undefined ? {} : { offset: look.offset }),
      autoFocusFirstItem: false,
      items,
    });
    // database.css gives an expanded tab the pressed fill (notion-motion.md Round 27 §3).
    trigger.setAttribute('aria-expanded', 'true');

    this.contextPopover.on(PopoverEvent.Closed, () => {
      trigger.removeAttribute('aria-expanded');
      if (this.contextPopover !== null) {
        const p = this.contextPopover;
        this.contextPopover = null;
        p.destroy();
      }
    });

    this.contextPopover.nestedOpenDelay = DATABASE_SUBMENU_OPEN_DELAY_MS;
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
      name: 'database-tab-display',
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

  private openViewPopover(anchor: HTMLElement, placement: 'below' | 'aside' = 'below', focusFirst = false): void {
    if (this.viewPopover !== null) {
      this.viewPopover.destroy();
    }
    anchor.setAttribute('data-popover-open', '');
    this.barEl?.setAttribute('data-popover-open', '');
    this.viewPopover = new DatabaseViewPopover({
      onSelect: (type) => {
        // The menu closes itself after a pick; the list closing must not destroy it mid-pick.
        this.viewPopover = null;
        this.closeOverflowDropdown();
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
    this.viewPopover.open(anchor, placement, focusFirst);
  }

  private closeViewPopover(): boolean {
    if (this.viewPopover === null) return false;
    const popover = this.viewPopover;

    this.viewPopover = null;
    popover.destroy();

    return true;
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
      // notion-motion.md Round 31 §3: Add view opens beside the New view row and the list stays open.
      keepOpenOnNew: !this.readOnly,
      onNew: (row, byKeyboard) => {
        const addBtn = this.element?.querySelector<HTMLElement>('[data-blok-database-add-view]');

        if (this.readOnly || addBtn === null || addBtn === undefined) return;
        if (row.getBoundingClientRect().right + ADD_VIEW_MENU_WIDTH <= window.innerWidth) {
          this.openViewPopover(row, 'aside', byKeyboard);

          return;
        }
        // No room beside the list (Notion unmeasured): Add view opens under "+", as before.
        this.closeOverflowDropdown();
        // A folded "+" has no box to hang the menu from.
        this.openViewPopover(this.element?.hasAttribute('data-blok-database-tab-folded') === true ? anchor : addBtn);
      },
      ...(this.readOnly || this.options.onNewDataSource === undefined ? {} : {
        onNewSecond: { label: this.t('tools.database.newDataSource', 'New data source'), icon: IconDatabase, activate: this.options.onNewDataSource },
      }),
      // The row menu mounts in <body>, outside the list, but belongs to it.
      ownsNode: (target) => this.contextPopover?.hasNode(target) === true || this.viewPopover?.contains(target) === true,
      closeLayer: () => {
        if (this.contextPopover === null) {
          return this.closeViewPopover();
        }
        this.closeContextPopover();

        return true;
      },
      onClose: () => {
        this.closeViewPopover();
      },
      yieldsKeys: () => this.viewPopover !== null,
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

    this.onReorder(viewId, positionBetween(afterView?.position ?? null, beforeView?.position ?? null));
  }

  private closeOverflowDropdown(): void {
    const list = this.overflowList;

    this.overflowList = null;
    list?.close();
  }

  private dragSource(): HTMLElement | null {
    return this.element?.querySelector<HTMLElement>(`[data-view-id="${this.dragViewId}"]`) ?? null;
  }

  /** Where a drop at `x` lands among the shown tabs other than the dragged one. */
  private dropSlot(x: number): number {
    const index = this.dragSlots.findIndex((slot) => x < slot.center);

    return index === -1 ? this.dragSlots.length : index;
  }

  /**
   * Notion (notion-motion.md Round 14): no ghost and no drop line. The pressed
   * tab follows the pointer; each tab it passes slides by its width over
   * database.css's 200ms ease.
   */
  private handleDragMove(e: PointerEvent): void {
    const dx = e.clientX - this.dragStartX;
    if (!this.isDragging && Math.abs(dx) < DRAG_THRESHOLD) return;
    const sourceTab = this.dragSource();

    if (!this.isDragging) {
      this.isDragging = true;
      this.element?.setAttribute('data-dragging', '');
      sourceTab?.setAttribute('data-blok-database-tab-drag-source', '');
      this.dragSlots = Array.from(this.element?.querySelectorAll<HTMLElement>('[data-blok-database-tab]') ?? [])
        .filter((tab) => tab !== sourceTab && tab.style.display !== 'none')
        .map((tab) => {
          const rect = tab.getBoundingClientRect();

          return { tab, center: (rect.left + rect.right) / 2 };
        });
      const source = sourceTab?.getBoundingClientRect();
      const sourceCenter = source === undefined ? 0 : (source.left + source.right) / 2;

      this.dragHome = this.dragSlots.filter((slot) => slot.center < sourceCenter).length;
      this.dragStep = (source?.width ?? 0) + this.tabGap();
    }
    if (sourceTab === null) return;
    sourceTab.style.transform = `translateX(${dx}px)`;

    const { dragHome: home, dragStep: step } = this;
    const drop = this.dropSlot(e.clientX);

    this.dragSlots.forEach(({ tab }, index) => {
      const right = index < home && index >= drop;
      const left = index >= home && index < drop;

      Object.assign(tab.style, { transform: right || left ? `translateX(${right ? step : -step}px)` : '' });
    });
  }

  private tabGap(): number {
    const bar = this.element;

    return bar === null ? 0 : Number.parseFloat(getComputedStyle(bar).columnGap) || 0;
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
    const shown = this.dragSlots.map((slot) => slot.tab);
    const slot = this.dropSlot(e.clientX);
    const dropIndex = slot === shown.length ? -1 : slot;
    const afterTab = dropIndex === -1 ? tabs.at(-1) : shown[dropIndex - 1];
    const nextIndex = afterTab === undefined ? 0 : tabs.indexOf(afterTab) + 1;
    const beforeTab = dropIndex === -1 ? undefined : tabs[nextIndex];
    const afterViewId = afterTab?.getAttribute('data-view-id') ?? null;
    const beforeViewId = beforeTab?.getAttribute('data-view-id') ?? null;

    const viewId = this.dragViewId;

    this.dragEnded = true;
    this.cleanupDrag();
    this.reorderBetween(viewId, afterViewId, beforeViewId);
  }

  private cleanupDrag(): void {
    // The flag goes first: without it the tabs jump back instead of sliding.
    this.element?.removeAttribute('data-dragging');
    const sourceTab = this.dragSource();
    sourceTab?.removeAttribute('data-blok-database-tab-drag-source');
    if (sourceTab !== null) sourceTab.style.transform = '';
    this.dragSlots.forEach(({ tab }) => Object.assign(tab.style, { transform: '' }));
    this.dragSlots = [];
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
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
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

  /**
   * The title row's "…" with one view (feel/findings-toolbar V03): Notion's
   * items that Blok can back, in Notion's order.
   */
  createTitleMoreButton(): HTMLElement {
    const button = document.createElement('button');
    const viewId = this.options.activeViewId;
    const t = this.t.bind(this);

    button.type = 'button';
    button.setAttribute('data-blok-database-title-more', '');
    button.setAttribute('aria-label', t('tools.database.tableMoreActions', 'More actions'));
    button.innerHTML = IconDotsHorizontal;
    button.addEventListener('click', () => {
      if (this.contextPopover !== null) return;
      const { onCopyLink, onEditTitle, onEditLayout, onDataSourceTitlesToggle } = this.options;
      const hidden = this.options.dataSourceTitlesHidden === true;
      const view: PopoverItemParams[] = [
        ...(onCopyLink === undefined ? [] : [{
          icon: IconLink,
          name: 'database-title-copy-link',
          title: t('tools.database.layoutCopyLinkToView', 'Copy link to view'),
          closeOnActivate: true,
          onActivate: () => onCopyLink(viewId),
        }]),
        {
          icon: IconCopy,
          name: 'database-title-duplicate',
          title: t('tools.database.layoutDuplicateView', 'Duplicate view'),
          closeOnActivate: true,
          onActivate: () => this.options.onDuplicate(viewId),
        },
      ];
      // A hidden title has nothing to edit.
      const edit: PopoverItemParams[] = [
        ...(onEditTitle === undefined || hidden ? [] : [{
          icon: IconPencil,
          name: 'database-title-edit',
          title: t('tools.database.editCardTitle', 'Edit title'),
          closeOnActivate: true,
          onActivate: onEditTitle,
        }]),
        ...(onEditLayout === undefined ? [] : [{
          icon: IconPageLayout,
          name: 'database-title-edit-layout',
          title: t('tools.database.editLayout', 'Edit layout'),
          closeOnActivate: true,
          onActivate: onEditLayout,
        }]),
      ];
      const title: PopoverItemParams[] = onDataSourceTitlesToggle === undefined ? [] : [{
        icon: IconEyeSlash,
        name: 'database-title-hide',
        title: hidden ? t('tools.database.showTitle', 'Show title') : t('tools.database.hideTitle', 'Hide title'),
        closeOnActivate: true,
        onActivate: onDataSourceTitlesToggle,
      }];
      const items = [view, edit, title]
        .filter((group) => group.length > 0)
        .flatMap((group, index) => index === 0 ? group : [{ type: PopoverItemType.Separator as const }, ...group]);

      this.showMenu(button, items);
    });

    return button;
  }
}
