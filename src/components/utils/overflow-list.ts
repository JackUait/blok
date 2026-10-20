import { IconDotsHorizontal, IconMenu, IconPlus } from '../icons';
import { DATA_ATTR } from '../constants/data-attributes';
import { syncPortalDirection } from './portal-direction';
import { SearchInput, SearchInputEvent } from './popover/components/search-input';
import { createPositionTracker, positionFixedAnchored, type PositionTracker } from './popover/anchored-position';

export interface OverflowListRow {
  id: string;
  name: string;
  /** Drawn before the name: a trusted SVG string, or plain text such as an emoji. */
  icon: { svg: string } | { text: string };
  active: boolean;
}

export interface OverflowListOptions {
  /** The "N more…" button; the list hangs below it. */
  anchor: HTMLElement;
  /** Attribute prefix: `<prefix>-dropdown`, `-item`, `-name`, `-handle`, `-menu`, `-separator`, `-new`, `-empty`. */
  prefix: string;
  /** The row attribute that carries its id. */
  idAttribute: string;
  rows: OverflowListRow[];
  labels: { search: string; handle: string; menu: string; newItem: string; noResults: string };
  /** Read-only rows only open their item: no handle, no "•••". */
  readOnly: boolean;
  onSelect: (id: string) => void;
  /** A row dropped between two neighbours; null at either end. Omitted: no drag handle. */
  onReorder?: (id: string, afterId: string | null, beforeId: string | null) => void;
  /** "•••" on a row. The caller's menu lives outside the list. Omitted: no "•••". */
  onMenu?: (button: HTMLElement, id: string, row: HTMLElement) => void;
  /** Omitted: no new-item row. */
  onNew?: () => void;
  /** A node outside the list that still belongs to it (the row menu). */
  ownsNode: (target: Node) => boolean;
  /** Escape closes the caller's top layer first; true when it closed one. */
  closeLayer: () => boolean;
  /** An element whose own Escape must not close the list (a rename field). */
  ownsEscape: (target: EventTarget | null) => boolean;
  onClose?: () => void;
}

/**
 * The "N more…" list (research/13 §3a): a search field, every item in order
 * with a drag handle and "•••", then a new-item row. Shared by the database
 * view tabs and the tabs block.
 */
const listIds = { next: 0 };

export class OverflowList {
  private readonly options: OverflowListOptions;
  private element: HTMLElement | null = null;
  private search: SearchInput | null = null;
  private tracker: PositionTracker | null = null;
  private drag: { id: string; row: HTMLElement; moved: boolean } | null = null;
  private highlighted: HTMLElement | null = null;
  private readonly listId = `blok-overflow-list-${++listIds.next}`;

  constructor(options: OverflowListOptions) {
    this.options = options;
  }

  public get isOpen(): boolean {
    return this.element !== null;
  }

  /** The list mounts on body: an owner's outside-click check asks here. */
  public contains(node: Node): boolean {
    return this.element?.contains(node) === true;
  }

  public open(): void {
    const { anchor, prefix, rows, labels } = this.options;
    const dropdown = document.createElement('div');

    dropdown.setAttribute('data-blok-popover', '');
    dropdown.setAttribute(`${prefix}-dropdown`, '');
    dropdown.setAttribute(DATA_ATTR.keyboardOwner, '');
    dropdown.style.zIndex = '1000';

    const searchItems = rows.map((row) => ({ title: row.name }));
    const search = new SearchInput({ items: searchItems, placeholder: labels.search, controlsId: this.listId });
    const rowElements = rows.map((row, index) => this.createRow(row, index));
    const listbox = document.createElement('div');
    const empty = document.createElement('div');

    listbox.id = this.listId;
    listbox.setAttribute('role', 'listbox');
    listbox.setAttribute('aria-label', labels.search);
    empty.setAttribute(`${prefix}-empty`, '');
    empty.hidden = true;
    empty.textContent = labels.noResults;

    // Matches stay in order; the shared search only decides which match.
    search.on(SearchInputEvent.Search, ({ query, items }) => {
      rowElements.forEach((row, index) => {
        row.toggleAttribute('hidden', query !== '' && !items.includes(searchItems[index]));
      });
      const shown = rowElements.filter((row) => !row.hidden);

      empty.hidden = shown.length > 0;
      this.highlight(query === '' ? this.currentRow() : shown[0] ?? null);
    });
    listbox.append(...rowElements);
    this.search = search;

    const onNew = this.options.onNew;

    if (onNew !== undefined) {
      listbox.appendChild(this.createNewRow(onNew));
    }
    // Outside the listbox: only options belong in it.
    dropdown.append(search.getElement(), empty, listbox);

    document.body.appendChild(dropdown);
    const reposition = (): void => {
      positionFixedAnchored(dropdown, anchor, { side: 'bottom', offset: 4 });
    };

    // The anchor mirrors with the editor, so a flip re-places the dropdown.
    syncPortalDirection(dropdown, { source: anchor, onResync: reposition });
    this.element = dropdown;

    reposition();
    this.tracker = createPositionTracker(dropdown, reposition);
    this.tracker.attach();

    document.addEventListener('mousedown', this.handleOutsideMouseDown);
    // Window capture runs before the popover registry's document-capture
    // Escape, so one press peels only the top layer.
    window.addEventListener('keydown', this.handleKeyDown, true);
    search.focus();
    this.highlight(this.currentRow());
  }

  public close(): void {
    if (this.element === null) {
      return;
    }
    this.tracker?.detach();
    this.tracker = null;
    this.endDrag();
    this.search?.destroy();
    this.search = null;
    this.highlighted = null;
    window.removeEventListener('keydown', this.handleKeyDown, true);
    document.removeEventListener('mousedown', this.handleOutsideMouseDown);
    this.element.remove();
    this.element = null;
    this.options.onClose?.();
  }

  private readonly handleOutsideMouseDown = (event: MouseEvent): void => {
    const target = event.target;

    if (!(target instanceof Node) || this.element === null) {
      return;
    }
    if (!this.element.contains(target) && !this.options.anchor.contains(target) && !this.options.ownsNode(target)) {
      this.close();
    }
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const input = this.search?.getInput();

    // Only the search field steers the highlight: a rename field or a row menu keeps its own keys.
    if (input !== undefined && event.target === input && !event.isComposing && this.handleNavigation(event)) {
      event.preventDefault();
      event.stopPropagation();

      return;
    }
    if (event.key !== 'Escape' || event.isComposing || this.options.ownsEscape(event.target)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (this.drag !== null) {
      this.endDrag();
      this.restoreOrder();

      return;
    }
    if (this.options.closeLayer()) {
      return;
    }
    this.close();
  };

  /** True when the key moved or activated the highlight. */
  private handleNavigation(event: KeyboardEvent): boolean {
    if (event.key === 'Enter') {
      this.highlighted?.click();

      return this.highlighted !== null;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return false;
    }
    const targets = Array.from(this.element?.querySelectorAll<HTMLElement>('[role="option"]') ?? []).filter((el) => !el.hidden);

    if (targets.length === 0) {
      return true;
    }
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const index = this.highlighted === null ? -1 : targets.indexOf(this.highlighted);
    // Nothing highlighted: Down starts at the top, Up at the bottom.
    const start = step === 1 ? -1 : 0;
    const from = index === -1 ? start : index;

    this.highlight(targets[(from + step + targets.length) % targets.length]);

    return true;
  }

  private currentRow(): HTMLElement | null {
    return this.rowElements().find((row) => row.hasAttribute('data-active')) ?? this.rowElements()[0] ?? null;
  }

  private highlight(target: HTMLElement | null): void {
    const input = this.search?.getInput();

    this.highlighted?.removeAttribute('data-highlighted');
    this.highlighted = target;
    target?.setAttribute('data-highlighted', '');
    if (target === null) {
      input?.removeAttribute('aria-activedescendant');
    } else {
      input?.setAttribute('aria-activedescendant', target.id);
    }
  }

  private createRow(row: OverflowListRow, index: number): HTMLElement {
    const { prefix, idAttribute, labels } = this.options;
    const item = document.createElement('div');

    item.id = `${this.listId}-${index}`;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(row.active));
    item.setAttribute(`${prefix}-item`, '');
    item.setAttribute(idAttribute, row.id);
    item.toggleAttribute('data-active', row.active);

    const iconSpan = document.createElement('span');

    if ('svg' in row.icon) {
      iconSpan.innerHTML = row.icon.svg;
    } else {
      iconSpan.textContent = row.icon.text;
    }

    const nameSpan = document.createElement('span');

    nameSpan.setAttribute(`${prefix}-name`, '');
    nameSpan.textContent = row.name;

    const { onReorder, onMenu, readOnly } = this.options;

    if (!readOnly && onReorder !== undefined) {
      const handle = this.rowButton(`${prefix}-handle`, IconMenu, labels.handle);

      handle.addEventListener('pointerdown', (event) => this.startDrag(event, row.id, item));
      item.append(handle);
    }
    item.append(iconSpan, nameSpan);
    if (!readOnly && onMenu !== undefined) {
      const menu = this.rowButton(`${prefix}-menu`, IconDotsHorizontal, labels.menu);

      menu.addEventListener('click', () => onMenu(menu, row.id, item));
      item.append(menu);
    }

    item.addEventListener('click', (event) => {
      // Its buttons and a rename field act on the row; they do not open it.
      if (event.target instanceof Element && event.target.closest('button, input') !== null) {
        return;
      }
      this.options.onSelect(row.id);
      this.close();
    });

    return item;
  }

  private createNewRow(onNew: () => void): DocumentFragment {
    const { prefix, labels } = this.options;
    const fragment = document.createDocumentFragment();
    const separator = document.createElement('div');
    const button = document.createElement('div');
    const icon = document.createElement('span');
    const label = document.createElement('span');
    const activate = (): void => {
      this.close();
      onNew();
    };

    separator.setAttribute(`${prefix}-separator`, '');
    separator.setAttribute('role', 'presentation');
    button.id = `${this.listId}-new`;
    button.setAttribute(`${prefix}-new`, '');
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', 'false');
    button.setAttribute('tabindex', '0');
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = IconPlus;
    label.textContent = labels.newItem;
    button.append(icon, label);
    button.addEventListener('click', activate);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });
    fragment.append(separator, button);

    return fragment;
  }

  private rowButton(attribute: string, icon: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');

    button.type = 'button';
    button.setAttribute(attribute, '');
    button.setAttribute('aria-label', label);
    button.innerHTML = icon;

    return button;
  }

  private rowElements(): HTMLElement[] {
    return Array.from(this.element?.querySelectorAll<HTMLElement>(`[${this.options.prefix}-item]`) ?? []);
  }

  /** Puts the rows back in the order they opened with (a cancelled drag). */
  private restoreOrder(): void {
    const order = this.options.rows.map((row) => row.id);
    const rows = this.rowElements();

    rows.sort((a, b) => order.indexOf(a.getAttribute(this.options.idAttribute) ?? '') - order.indexOf(b.getAttribute(this.options.idAttribute) ?? ''));
    rows[0]?.parentElement?.prepend(...rows);
  }

  /** The row follows the pointer through the list; the drop commits the order the list shows. */
  private startDrag(event: PointerEvent, id: string, row: HTMLElement): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.drag = { id, row, moved: false };
    row.setAttribute('data-dragging', '');
    document.addEventListener('pointermove', this.handleDragMove);
    document.addEventListener('pointerup', this.handleDragUp);
    document.addEventListener('pointercancel', this.handleDragCancel);
  }

  private readonly handleDragMove = (event: PointerEvent): void => {
    const drag = this.drag;

    if (drag === null) {
      return;
    }
    const others = this.rowElements().filter((row) => row !== drag.row && !row.hidden);
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

  private readonly handleDragUp = (): void => {
    const drag = this.drag;

    this.endDrag();
    if (drag === null || !drag.moved) {
      return;
    }
    const { prefix, idAttribute } = this.options;
    const neighbour = (step: 'previousElementSibling' | 'nextElementSibling'): string | null => {
      const next = drag.row[step];

      return next !== null && next.hasAttribute(`${prefix}-item`) ? next.getAttribute(idAttribute) : null;
    };

    this.options.onReorder?.(drag.id, neighbour('previousElementSibling'), neighbour('nextElementSibling'));
  };

  private readonly handleDragCancel = (): void => {
    this.endDrag();
    this.restoreOrder();
  };

  private endDrag(): void {
    this.drag?.row.removeAttribute('data-dragging');
    this.drag = null;
    document.removeEventListener('pointermove', this.handleDragMove);
    document.removeEventListener('pointerup', this.handleDragUp);
    document.removeEventListener('pointercancel', this.handleDragCancel);
  }
}
