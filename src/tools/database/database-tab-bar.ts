import { IconBoard } from '../../components/icons';
import { DatabaseViewPopover } from './database-view-popover';
import type { DatabaseViewData } from './types';

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
  private barEl: HTMLElement | null = null;
  private viewPopover: DatabaseViewPopover | null = null;
  private contextPopoverEl: HTMLElement | null = null;
  private boundOutsideContextClick: ((e: MouseEvent) => void) | null = null;

  constructor(options: TabBarOptions) {
    this.options = options;
  }

  render(): HTMLElement {
    const bar = document.createElement('div');
    bar.setAttribute('data-blok-database-tab-bar', '');
    this.barEl = bar;

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

  destroy(): void {
    this.closeContextPopover();
    if (this.viewPopover !== null) {
      this.viewPopover.destroy();
      this.viewPopover = null;
    }
  }
}
