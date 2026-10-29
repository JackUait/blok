import { DATA_ATTR } from '../../components/constants/data-attributes';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { SearchInput, SearchInputEvent } from '../../components/utils/popover/components/search-input';
import { PopoverEvent } from '../../../types/utils/popover/popover-event';
import { PAGE_DRAFT_BADGE_CLASSES, PAGE_PATH_CLASSES, PAGE_PATH_SEPARATOR } from './constants';
import type { PageSearchResult } from './types';

const listboxIds = { next: 0 };
const COMBOBOX_ATTRIBUTES = [
  'role', 'aria-expanded', 'aria-autocomplete', 'aria-haspopup', 'aria-controls', 'aria-activedescendant',
] as const;

/** The page to show, or null to drop it. A malformed path or status is ignored, not fatal. */
const toVisiblePage = (value: unknown): PageSearchResult | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { pageId, access, title, path, status } = value as Record<string, unknown>;

  if (typeof pageId !== 'string' || pageId.trim() === '' || access !== undefined ||
    (title !== undefined && typeof title !== 'string')) {
    return null;
  }

  return {
    pageId,
    title: typeof title === 'string' ? title : undefined,
    path: Array.isArray(path) ? path.filter((part): part is string => typeof part === 'string') : undefined,
    status: status === 'draft' || status === 'published' ? status : undefined,
  };
};

/** Options for {@link PagePicker.open}. */
export interface PagePickerOptions {
  /**
   * Gives the picker its own search field, for when nothing is typed in the
   * text. `onQuery` gets each typed query; answer it with `setResults`.
   */
  searchField?: { placeholder: string; onQuery: (query: string) => void };
  /** Called once when the picker closes without a pick. */
  onClose?: () => void;
}

export class PagePicker {
  private readonly label: string;
  private readonly fallback: string;
  private readonly draft: string;
  private readonly nothingFound: string;
  private readonly listboxId = `blok-page-picker-${++listboxIds.next}`;
  private popover: PopoverDesktop | null = null;
  private anchor: HTMLElement | null = null;
  /** Holds the combobox semantics: the search field when there is one, else the anchor. */
  private combobox: HTMLElement | null = null;
  private search: SearchInput | null = null;
  private onClose: (() => void) | null = null;
  private listbox: HTMLElement | null = null;
  private content: HTMLElement | null = null;
  private onPick: ((pageId: string) => void) | null = null;
  private results: PageSearchResult[] = [];
  private activeIndex = -1;
  private keyboardNavigated = false;
  private previousAttributes: Map<string, string | null> | null = null;

  /**
   * @param label - the list's name
   * @param fallback - the title of an untitled page
   * @param draft - the draft badge text
   * @param nothingFound - the empty state text
   */
  constructor(label: string, fallback: string, draft: string, nothingFound: string) {
    this.label = label;
    this.fallback = fallback;
    this.draft = draft;
    this.nothingFound = nothingFound;
  }

  public get opened(): boolean {
    return this.popover !== null;
  }

  public open(_query: string, anchor: HTMLElement, onPick: (pageId: string) => void, options: PagePickerOptions = {}): void {
    this.close();
    this.anchor = anchor;
    if (options.searchField === undefined) {
      this.previousAttributes = new Map(COMBOBOX_ATTRIBUTES.map((name) => [name, anchor.getAttribute(name)] as const));
    }
    this.onPick = onPick;
    this.onClose = options.onClose ?? null;
    this.content = document.createElement('div');
    this.popover = new PopoverDesktop({
      items: [{ type: PopoverItemType.Html, element: this.content }],
      trigger: anchor,
      listbox: true,
      // With a field, the content is the listbox, so the field stays outside it.
      listboxId: options.searchField === undefined ? this.listboxId : undefined,
      // Search results arrive after show() measures the empty menu.
      minWidth: '240px',
      flippable: false,
      messages: { actions: this.label, nothingFound: this.nothingFound },
    });
    this.popover.on(PopoverEvent.Closed, () => this.close());
    if (options.searchField !== undefined) {
      this.mountSearchField(this.popover, options.searchField);
    }
    this.popover.show();

    this.listbox = document.getElementById(this.listboxId);
    if (this.listbox === null) {
      this.listbox = this.content;
      this.listbox.id = this.listboxId;
    }
    this.listbox.setAttribute('role', 'listbox');
    this.listbox.setAttribute('aria-label', this.label);

    const combobox = this.search?.getInput() ?? anchor;

    this.combobox = combobox;
    combobox.setAttribute('role', 'combobox');
    combobox.setAttribute('aria-expanded', 'true');
    combobox.setAttribute('aria-autocomplete', 'list');
    combobox.setAttribute('aria-haspopup', 'listbox');
    combobox.setAttribute('aria-controls', this.listboxId);
    this.search?.focus();
  }

  public setResults(results: readonly unknown[]): void {
    if (this.content === null) {
      return;
    }

    this.results = results.map(toVisiblePage).filter((page): page is PageSearchResult => page !== null);
    this.activeIndex = this.results.length > 0 ? 0 : -1;
    this.keyboardNavigated = false;
    this.content.replaceChildren(...this.results.map((result, index) => this.buildOption(result, index)));
    this.popover?.setNothingFound(this.results.length === 0);
    this.syncSelection();
  }

  public handleKeydown(event: KeyboardEvent): boolean {
    if (!this.opened || event.isComposing) {
      return false;
    }

    if (event.key === 'Tab') {
      this.close();

      return false;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();

      return true;
    }

    if (this.results.length === 0) {
      if (event.key === 'Enter' || event.key === 'ArrowDown' || event.key === 'ArrowUp' ||
        event.key === 'Home' || event.key === 'End') {
        event.preventDefault();

        return true;
      }

      return false;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;

      this.activeIndex = (this.activeIndex + step + this.results.length) % this.results.length;
      this.keyboardNavigated = true;
      this.syncSelection();

      return true;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      this.activeIndex = event.key === 'Home' ? 0 : this.results.length - 1;
      this.keyboardNavigated = true;
      this.syncSelection();

      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.pick(this.activeIndex);

      return true;
    }

    return false;
  }

  public close(): void {
    const popover = this.popover;
    const anchor = this.anchor;
    const search = this.search;
    const listbox = this.listbox;
    const content = this.content;
    const previousAttributes = this.previousAttributes;
    const onClose = this.onClose;

    this.popover = null;
    this.anchor = null;
    this.combobox = null;
    this.search = null;
    this.listbox = null;
    this.content = null;
    this.onPick = null;
    this.onClose = null;
    this.results = [];
    this.activeIndex = -1;
    this.keyboardNavigated = false;
    this.previousAttributes = null;
    document.removeEventListener('pointerdown', this.handleOutsidePointer, true);
    content?.replaceChildren();
    listbox?.removeAttribute('role');
    listbox?.removeAttribute('aria-label');
    listbox?.removeAttribute('id');
    previousAttributes?.forEach((value, name) => {
      if (value === null) {
        anchor?.removeAttribute(name);
      } else {
        anchor?.setAttribute(name, value);
      }
    });
    search?.destroy();
    popover?.destroy();
    onClose?.();
  }

  private pick(index: number): void {
    const result = this.results[index];
    const onPick = this.onPick;

    if (result === undefined || onPick === null) {
      return;
    }

    // A pick is not a close: onClose stays silent.
    this.onClose = null;
    this.close();
    onPick(result.pageId);
  }

  private mountSearchField(popover: PopoverDesktop, field: NonNullable<PagePickerOptions['searchField']>): void {
    const search = new SearchInput({ items: [], placeholder: field.placeholder, controlsId: this.listboxId });
    const input = search.getInput();

    input.setAttribute(DATA_ATTR.testid, 'page-picker-search-input');
    search.on(SearchInputEvent.Search, ({ query }) => field.onQuery(query));
    input.addEventListener('keydown', (event) => {
      this.handleKeydown(event);
    });
    popover.mountSearchField(search.getElement());
    // Blok's editor keys stand down: the field's arrows, Enter and Escape are the picker's.
    popover.getElement().setAttribute(DATA_ATTR.keyboardOwner, '');
    // The editor does not see this field's focus, so a press outside closes the picker.
    document.addEventListener('pointerdown', this.handleOutsidePointer, true);
    this.search = search;
  }

  private readonly handleOutsidePointer = (event: Event): void => {
    const root = this.popover?.getElement();

    if (root !== undefined && event.target instanceof Node && !root.contains(event.target)) {
      this.close();
    }
  };

  private buildOption(result: PageSearchResult, index: number): HTMLElement {
    const option = document.createElement('div');
    const line = document.createElement('div');
    const title = document.createElement('span');

    option.id = `${this.listboxId}-option-${index}`;
    option.setAttribute('role', 'option');
    option.setAttribute(DATA_ATTR.testid, 'page-picker-option');
    option.className = 'cursor-pointer px-3 py-2 text-sm text-text-primary';
    line.className = 'flex items-center gap-1.5 min-w-0';
    title.className = 'truncate';
    title.textContent = result.title || this.fallback;
    line.append(title);
    option.append(line);
    if (result.status === 'draft') {
      const badge = document.createElement('span');

      badge.className = PAGE_DRAFT_BADGE_CLASSES;
      badge.setAttribute(DATA_ATTR.testid, 'page-draft-badge');
      badge.textContent = this.draft;
      line.append(badge);
      option.setAttribute('data-blok-page-status', 'draft');
    }
    if (result.path !== undefined && result.path.length > 0) {
      const path = document.createElement('div');

      path.className = PAGE_PATH_CLASSES;
      path.setAttribute(DATA_ATTR.testid, 'page-picker-option-path');
      path.textContent = result.path.join(PAGE_PATH_SEPARATOR);
      option.append(path);
    }
    option.addEventListener('pointerdown', (event) => event.preventDefault());
    option.addEventListener('click', () => this.pick(index));

    return option;
  }

  private syncSelection(): void {
    const options = this.content?.querySelectorAll<HTMLElement>('[role="option"]');

    options?.forEach((option, index) => {
      option.setAttribute('aria-selected', String(index === this.activeIndex));
      option.style.setProperty('outline', this.keyboardNavigated && index === this.activeIndex
        ? '2px solid var(--blok-focus-ring)'
        : '');
    });
    const active = options?.[this.activeIndex];

    if (active === undefined) {
      this.combobox?.removeAttribute('aria-activedescendant');
    } else {
      this.combobox?.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    }
  }
}
