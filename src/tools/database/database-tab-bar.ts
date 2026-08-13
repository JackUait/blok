import { generateKeyBetween } from 'fractional-indexing';
import { IconBoard, IconList, IconPencil, IconCopy, IconTrash, IconPlus } from '../../components/icons';
import { DatabaseViewPopover } from './database-view-popover';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import {
  createPositionTracker,
  positionFixedAnchored,
  type PositionTracker,
} from '../../components/utils/popover/anchored-position';
import { PopoverEvent } from '@/types/utils/popover/popover-event';
import { startInlineRename } from '../../components/utils/inline-rename';
import { rovingRadioGroup, type RovingRadioGroup } from '../../components/utils/roving-radio-group';
import { DATA_ATTR } from '../../components/constants/data-attributes';
import type { API } from '../../../types';
import type { DatabaseViewConfig, ViewType } from './types';

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
    bar.setAttribute('role', 'tablist');
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

    bar.addEventListener('contextmenu', (e: MouseEvent) => {
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
    this.closeContextPopover();

    const canDelete = this.options.views.length > 1;
    const t = this.t.bind(this);

    const baseItems = [
      {
        icon: IconPencil,
        title: t('tools.database.renameView', 'Rename'),
        closeOnActivate: true,
        onActivate: () => {
          this.startTabRename(tab, viewId);
        },
      },
      {
        icon: IconCopy,
        title: t('tools.database.duplicateView', 'Duplicate'),
        closeOnActivate: true,
        onActivate: () => {
          this.options.onDuplicate(viewId);
        },
      },
    ];

    const deleteItems = canDelete
      ? [
          { type: PopoverItemType.Separator as const },
          {
            icon: IconTrash,
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
      trigger: tab,
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

    const originalName = nameSpan.textContent ?? '';

    const buildNameSpan = (name: string): HTMLElement => {
      const span = document.createElement('span');
      span.setAttribute('data-blok-database-tab-name', '');
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

  private openOverflowDropdown(anchor: HTMLElement): void {
    this.closeOverflowDropdown();

    const dropdown = document.createElement('div');
    dropdown.setAttribute('data-blok-popover', '');
    dropdown.setAttribute('data-blok-database-tab-overflow-dropdown', '');
    dropdown.setAttribute(DATA_ATTR.keyboardOwner, '');
    dropdown.style.zIndex = '1000';

    const orderedViews = [...this.views].sort((a, b) => (a.position < b.position ? -1 : 1));

    for (const view of orderedViews) {
      const item = document.createElement('div');
      item.setAttribute('data-blok-database-tab-overflow-item', '');
      item.setAttribute('data-view-id', view.id);

      if (view.id === this.options.activeViewId) {
        item.setAttribute('data-active', '');
      }

      const iconSpan = document.createElement('span');
      iconSpan.innerHTML = VIEW_ICONS[view.type] ?? '';
      item.appendChild(iconSpan);

      const nameSpan = document.createElement('span');
      nameSpan.textContent = view.name;
      item.appendChild(nameSpan);

      item.addEventListener('click', () => {
        if (view.id !== this.options.activeViewId) {
          this.options.onTabClick(view.id);
        }
        this.closeOverflowDropdown();
      });

      dropdown.appendChild(item);
    }

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

    newViewBtn.setAttribute('data-blok-database-tab-overflow-new', '');
    newViewBtn.setAttribute('role', 'button');
    newViewBtn.setAttribute('tabindex', '0');
    newViewBtn.textContent = '+ New view';
    newViewBtn.addEventListener('click', openNewViewPopover);
    activateOnEnterOrSpace(newViewBtn, openNewViewPopover);
    dropdown.appendChild(newViewBtn);

    document.body.appendChild(dropdown);
    this.overflowDropdownEl = dropdown;

    const reposition = (): void => {
      positionFixedAnchored(dropdown, anchor, { side: 'bottom', offset: 4 });
    };

    reposition();
    this.overflowPositionTracker = createPositionTracker(dropdown, reposition);
    this.overflowPositionTracker.attach();

    this.boundOverflowClose = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!dropdown.contains(target) && !anchor.contains(target)) {
        this.closeOverflowDropdown();
      }
    };

    document.addEventListener('mousedown', this.boundOverflowClose);
  }

  private closeOverflowDropdown(): void {
    this.overflowPositionTracker?.detach();
    this.overflowPositionTracker = null;

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
        const rect = sourceTab.getBoundingClientRect();
        this.ghostEl.style.top = `${rect.top}px`;
        this.ghostEl.style.width = `${rect.width}px`;
        document.body.appendChild(this.ghostEl);
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

    const orderedViews = [...this.views].sort((a, b) => (a.position < b.position ? -1 : 1));
    const beforeView = beforeViewId !== null ? orderedViews.find((v) => v.id === beforeViewId) : null;
    const afterView = afterViewId !== null ? orderedViews.find((v) => v.id === afterViewId) : null;

    const newPosition = generateKeyBetween(
      afterView?.position ?? null,
      beforeView?.position ?? null
    );

    this.cleanupDrag();
    this.onReorder(this.dragViewId, newPosition);
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
