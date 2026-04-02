import { generateKeyBetween } from 'fractional-indexing';
import { IconBoard } from '../../components/icons';
import { DatabaseViewPopover } from './database-view-popover';
import type { DatabaseViewData } from './types';

const DRAG_THRESHOLD = 10;

const VIEW_ICONS: Record<string, string> = {
  board: IconBoard,
};

export interface TabBarOptions {
  views: DatabaseViewData[];
  activeViewId: string;
  onTabClick: (viewId: string) => void;
  onAddView: (type: 'board') => void;
  onRename: (viewId: string, newName: string) => void;
  onDuplicate: (viewId: string) => void;
  onDelete: (viewId: string) => void;
  onReorder: (viewId: string, newPosition: string) => void;
}

export class DatabaseTabBar {
  private readonly options: TabBarOptions;
  private readonly views: DatabaseViewData[];
  private readonly onReorder: (viewId: string, newPosition: string) => void;
  private element: HTMLElement | null = null;
  private barEl: HTMLElement | null = null;
  private viewPopover: DatabaseViewPopover | null = null;
  private contextPopoverEl: HTMLElement | null = null;
  private boundOutsideContextClick: ((e: MouseEvent) => void) | null = null;

  private overflowDropdownEl: HTMLElement | null = null;
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
    this.barEl = bar;
    this.element = bar;

    const sorted = [...this.options.views].sort((a, b) => (a.position < b.position ? -1 : 1));

    for (const view of sorted) {
      bar.appendChild(this.createTab(view));
    }

    const addBtn = document.createElement('button');
    addBtn.setAttribute('data-blok-database-add-view', '');
    addBtn.textContent = '+';
    addBtn.addEventListener('click', () => {
      this.openViewPopover(addBtn);
    });
    bar.appendChild(addBtn);

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
      if (tab.hasAttribute('data-active')) {
        return;
      }
      this.options.onTabClick(viewId);
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

    return bar;
  }

  private createTab(view: DatabaseViewData): HTMLElement {
    const tab = document.createElement('div');
    tab.setAttribute('data-blok-database-tab', '');
    tab.setAttribute('data-view-id', view.id);

    if (view.id === this.options.activeViewId) {
      tab.setAttribute('data-active', '');
    }

    const iconSpan = document.createElement('span');
    iconSpan.innerHTML = VIEW_ICONS[view.type] ?? '';
    tab.appendChild(iconSpan);

    const nameSpan = document.createElement('span');
    nameSpan.setAttribute('data-blok-database-tab-name', '');
    nameSpan.textContent = view.name;
    tab.appendChild(nameSpan);

    return tab;
  }

  private openContextPopover(tab: HTMLElement, viewId: string): void {
    this.closeContextPopover();

    const popover = document.createElement('div');
    popover.setAttribute('data-blok-database-tab-context', '');
    popover.style.position = 'absolute';
    popover.style.zIndex = '1000';

    const rect = tab.getBoundingClientRect();
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = `${rect.left}px`;

    const renameItem = document.createElement('div');
    renameItem.setAttribute('data-blok-database-tab-action', 'rename');
    renameItem.textContent = 'Rename';
    renameItem.addEventListener('click', () => {
      this.closeContextPopover();
      this.startInlineRename(tab, viewId);
    });
    popover.appendChild(renameItem);

    const duplicateItem = document.createElement('div');
    duplicateItem.setAttribute('data-blok-database-tab-action', 'duplicate');
    duplicateItem.textContent = 'Duplicate';
    duplicateItem.addEventListener('click', () => {
      this.closeContextPopover();
      this.options.onDuplicate(viewId);
    });
    popover.appendChild(duplicateItem);

    const deleteItem = document.createElement('div');
    deleteItem.setAttribute('data-blok-database-tab-action', 'delete');
    deleteItem.textContent = 'Delete';
    if (this.options.views.length === 1) {
      deleteItem.style.display = 'none';
    }
    deleteItem.addEventListener('click', () => {
      this.closeContextPopover();
      this.options.onDelete(viewId);
    });
    popover.appendChild(deleteItem);

    document.body.appendChild(popover);
    this.contextPopoverEl = popover;

    this.boundOutsideContextClick = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!popover.contains(target) && !tab.contains(target)) {
        this.closeContextPopover();
      }
    };

    document.addEventListener('mousedown', this.boundOutsideContextClick);
  }

  private closeContextPopover(): void {
    if (this.contextPopoverEl !== null) {
      this.contextPopoverEl.remove();
      this.contextPopoverEl = null;
    }
    if (this.boundOutsideContextClick !== null) {
      document.removeEventListener('mousedown', this.boundOutsideContextClick);
      this.boundOutsideContextClick = null;
    }
  }

  private startInlineRename(tab: HTMLElement, viewId: string): void {
    const nameSpan = tab.querySelector('[data-blok-database-tab-name]');
    if (!(nameSpan instanceof HTMLElement)) {
      return;
    }

    const originalName = nameSpan.textContent ?? '';

    const input = document.createElement('input');
    input.setAttribute('data-blok-database-tab-rename-input', '');
    input.value = originalName;
    nameSpan.replaceWith(input);
    input.focus();
    input.select();

    const commit = (): void => {
      const newName = input.value.trim() || originalName;
      const newSpan = document.createElement('span');
      newSpan.setAttribute('data-blok-database-tab-name', '');
      newSpan.textContent = newName;
      input.replaceWith(newSpan);
      if (newName !== originalName) {
        this.options.onRename(viewId, newName);
      }
    };

    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        input.blur();
      } else if (e.key === 'Escape') {
        input.removeEventListener('blur', commit);
        const cancelSpan = document.createElement('span');
        cancelSpan.setAttribute('data-blok-database-tab-name', '');
        cancelSpan.textContent = originalName;
        input.replaceWith(cancelSpan);
      }
    });
  }

  private openViewPopover(anchor: HTMLElement): void {
    if (this.viewPopover !== null) {
      this.viewPopover.destroy();
    }
    this.viewPopover = new DatabaseViewPopover({
      onSelect: (type: 'board') => {
        this.options.onAddView(type);
      },
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
    const tabs = this.element.querySelectorAll<HTMLElement>('[data-blok-database-tab]');
    for (let i = visibleCount; i < tabs.length; i++) {
      tabs[i].style.display = 'none';
    }

    // Add "N more..." button before the + button
    const moreBtn = document.createElement('div');
    moreBtn.setAttribute('data-blok-database-tab-more', '');
    moreBtn.textContent = `${hiddenCount} more...`;
    moreBtn.style.cursor = 'pointer';
    moreBtn.addEventListener('click', () => {
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
    dropdown.setAttribute('data-blok-database-tab-overflow-dropdown', '');
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = '1000';

    const rect = anchor.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;

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
    newViewBtn.setAttribute('data-blok-database-tab-overflow-new', '');
    newViewBtn.textContent = '+ New view';
    newViewBtn.addEventListener('click', () => {
      this.closeOverflowDropdown();
      if (addBtn !== null && addBtn !== undefined) {
        this.openViewPopover(addBtn);
      }
    });
    dropdown.appendChild(newViewBtn);

    document.body.appendChild(dropdown);
    this.overflowDropdownEl = dropdown;

    this.boundOverflowClose = (e: MouseEvent): void => {
      const target = e.target as HTMLElement;
      if (!dropdown.contains(target) && !anchor.contains(target)) {
        this.closeOverflowDropdown();
      }
    };

    document.addEventListener('mousedown', this.boundOverflowClose);
  }

  private closeOverflowDropdown(): void {
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

  destroy(): void {
    this.cleanupDrag();
    this.closeContextPopover();
    this.closeOverflowDropdown();
    if (this.viewPopover !== null) {
      this.viewPopover.destroy();
      this.viewPopover = null;
    }
  }
}
