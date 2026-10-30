import { DATA_ATTR } from '../../components/constants/data-attributes';
import { IconArrowDiagonal, IconPlus } from '../../components/icons';
import { PopoverDesktop } from '../../components/utils/popover';
import { PopoverItemType } from '../../components/utils/popover/components/popover-item';
import { SearchInput, SearchInputEvent } from '../../components/utils/popover/components/search-input';
import { PopoverEvent } from '../../../types/utils/popover/popover-event';
import { PAGE_DRAFT_BADGE_CLASSES, PAGE_ICON_CLASSES, PAGE_PATH_CLASSES, PAGE_PATH_SEPARATOR } from './constants';
import { pageIconNode } from './icon-node';
import { readIcon } from './page-values';
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

  const { pageId, access, title, icon, path, status } = value as Record<string, unknown>;

  if (typeof pageId !== 'string' || pageId.trim() === '' || access !== undefined ||
    (title !== undefined && typeof title !== 'string')) {
    return null;
  }

  return {
    pageId,
    title: typeof title === 'string' ? title : undefined,
    icon: readIcon(icon),
    path: Array.isArray(path) ? path.filter((part): part is string => typeof part === 'string') : undefined,
    status: status === 'draft' || status === 'published' ? status : undefined,
  };
};

/** Rows shown before the "N more results" row. */
const COLLAPSED_ROWS = 6;

/** The active row (the first one, as in Notion) and a hovered row get the menu's neutral fill. */
const ROW_FILL_CLASSES = 'mx-1 cursor-pointer rounded-(--blok-radius-inner,var(--blok-radius-control)) aria-selected:bg-item-focus-bg can-hover:hover:bg-item-hover-bg';
const ROW_CLASSES = `${ROW_FILL_CLASSES} flex items-start gap-2 px-2 py-1.5 text-sm text-text-primary`;

/** Stands in for the query while a label template is split around it. */
const QUERY_MARK = '\u0000';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** What the "New page" section's two items do. Each gets the typed query. */
export interface PagePickerNewPage {
  /** A returned promise shows the item busy until it settles. */
  onSubPage: (query: string) => Promise<void> | void;
  onPageIn: (query: string) => void;
}

/** Options for {@link PagePicker.open}. */
export interface PagePickerOptions {
  /**
   * Gives the picker its own search field, for when nothing is typed in the
   * text. Each typed query starts a search and reaches `onQuery`; answer it with `setResults`.
   */
  searchField?: { placeholder: string; onQuery: (query: string) => void };
  /** Adds the "New page" section under the pages. Not with `searchField`. */
  newPage?: PagePickerNewPage;
  /** Called once when the picker closes without a pick. */
  onClose?: () => void;
}

/** Options for {@link PagePicker.chooseParent}. */
export interface PagePickerParentStep {
  placeholder: string;
  onQuery: (query: string) => void;
  /** The chosen page shows busy until the promise settles. */
  onChoose: (pageId: string) => Promise<void>;
}

interface Entry {
  key: string;
  element: HTMLElement;
  run: () => Promise<void> | void;
}

const skeletonRow = (): HTMLElement => {
  const row = document.createElement('div');
  const square = document.createElement('div');
  const bars = document.createElement('div');
  const long = document.createElement('div');
  const short = document.createElement('div');

  row.setAttribute(DATA_ATTR.testid, 'page-picker-skeleton');
  row.setAttribute('aria-hidden', 'true');
  row.className = 'flex items-center gap-2 px-3 py-1.5';
  square.className = 'size-5 flex-none rounded-(--blok-radius-mark) bg-(--blok-skeleton-bar)';
  bars.className = 'flex flex-col gap-1.5';
  long.className = 'h-2.5 w-36 rounded-full bg-(--blok-skeleton-bar)';
  short.className = 'h-2 w-16 rounded-full bg-(--blok-skeleton-bar)';
  bars.append(long, short);
  row.append(square, bars);

  return row;
};

export class PagePicker {
  private readonly label: string;
  private readonly fallback: string;
  private readonly draft: string;
  private readonly nothingFound: string;
  private readonly t: Translate;
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
  private onChoose: ((pageId: string) => Promise<void>) | null = null;
  private newPage: PagePickerNewPage | null = null;
  /** Section headers show only in the inline menu, not under a search field. */
  private sectioned = false;
  private results: PageSearchResult[] = [];
  private entries: Entry[] = [];
  private query = '';
  private loading = false;
  private answered = false;
  private expanded = false;
  private busyKey: string | null = null;
  private activeIndex = -1;
  private keyboardNavigated = false;
  private previousAttributes: Map<string, string | null> | null = null;

  /**
   * @param label - the list's name
   * @param fallback - the title of an untitled page
   * @param draft - the draft badge text
   * @param nothingFound - the empty state text
   * @param t - translates the section, loading, more-results and New page texts
   */
  constructor(label: string, fallback: string, draft: string, nothingFound: string, t: Translate = (key) => key) {
    this.label = label;
    this.fallback = fallback;
    this.draft = draft;
    this.nothingFound = nothingFound;
    this.t = t;
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
    this.sectioned = options.searchField === undefined;
    this.newPage = options.searchField === undefined ? options.newPage ?? null : null;
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
    this.claimCombobox(this.search?.getInput() ?? anchor);
    this.search?.focus();
    this.render();
  }

  /** A search for `query` started: shows the loading state and names the query in the New page items. */
  public startSearch(query: string): void {
    if (this.content === null) {
      return;
    }
    this.query = query;
    this.loading = true;
    this.render();
  }

  public setResults(results: readonly unknown[]): void {
    if (this.content === null) {
      return;
    }

    this.results = results.map(toVisiblePage).filter((page): page is PageSearchResult => page !== null);
    this.loading = false;
    this.answered = true;
    this.expanded = false;
    this.activeIndex = 0;
    this.keyboardNavigated = false;
    this.render();
  }

  /**
   * Turns the open menu into a search over pages, to choose where a new page
   * goes. The New page section and the section headers go away.
   */
  public chooseParent(step: PagePickerParentStep): void {
    const popover = this.popover;

    if (popover === null || this.search !== null) {
      return;
    }
    this.restoreAnchor();
    this.sectioned = false;
    this.newPage = null;
    this.onChoose = step.onChoose;
    this.results = [];
    this.answered = false;
    const search = this.mountSearchField(popover, { placeholder: step.placeholder, onQuery: step.onQuery });

    this.claimCombobox(search.getInput());
    search.focus();
    this.startSearch('');
    step.onQuery('');
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

    const count = this.entries.length;

    if (count === 0) {
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

      this.activeIndex = (this.activeIndex + step + count) % count;
      this.keyboardNavigated = true;
      this.syncSelection();

      return true;
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      this.activeIndex = event.key === 'Home' ? 0 : count - 1;
      this.keyboardNavigated = true;
      this.syncSelection();

      return true;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      this.activate(this.activeIndex);

      return true;
    }

    return false;
  }

  public close(): void {
    const popover = this.popover;
    const search = this.search;
    const listbox = this.listbox;
    const content = this.content;
    const onClose = this.onClose;

    this.restoreAnchor();
    this.popover = null;
    this.anchor = null;
    this.combobox = null;
    this.search = null;
    this.listbox = null;
    this.content = null;
    this.onPick = null;
    this.onChoose = null;
    this.onClose = null;
    this.newPage = null;
    this.results = [];
    this.entries = [];
    this.query = '';
    this.loading = false;
    this.answered = false;
    this.expanded = false;
    this.busyKey = null;
    this.activeIndex = -1;
    this.keyboardNavigated = false;
    document.removeEventListener('pointerdown', this.handleOutsidePointer, true);
    content?.replaceChildren();
    listbox?.removeAttribute('role');
    listbox?.removeAttribute('aria-busy');
    listbox?.removeAttribute('aria-label');
    listbox?.removeAttribute('id');
    search?.destroy();
    popover?.destroy();
    onClose?.();
  }

  private claimCombobox(combobox: HTMLElement | null): void {
    this.combobox = combobox;
    combobox?.setAttribute('role', 'combobox');
    combobox?.setAttribute('aria-expanded', 'true');
    combobox?.setAttribute('aria-autocomplete', 'list');
    combobox?.setAttribute('aria-haspopup', 'listbox');
    combobox?.setAttribute('aria-controls', this.listboxId);
  }

  /** Gives the anchor back the attributes it had before the picker made it a combobox. */
  private restoreAnchor(): void {
    const anchor = this.anchor;

    this.previousAttributes?.forEach((value, name) => {
      if (value === null) {
        anchor?.removeAttribute(name);
      } else {
        anchor?.setAttribute(name, value);
      }
    });
    this.previousAttributes = null;
  }

  private pick(pageId: string): void {
    const onPick = this.onPick;

    if (onPick === null) {
      return;
    }

    // A pick is not a close: onClose stays silent.
    this.onClose = null;
    this.close();
    onPick(pageId);
  }

  private activate(index: number): void {
    const entry = this.entries[index];

    if (entry === undefined || this.busyKey !== null) {
      return;
    }

    const answer = entry.run();

    if (answer instanceof Promise) {
      const done = (): void => {
        if (this.busyKey === entry.key) {
          this.busyKey = null;
          this.syncSelection();
        }
      };

      this.busyKey = entry.key;
      this.syncSelection();
      answer.then(done, done);
    }
  }

  private mountSearchField(popover: PopoverDesktop, field: NonNullable<PagePickerOptions['searchField']>): SearchInput {
    const search = new SearchInput({ items: [], placeholder: field.placeholder, controlsId: this.listboxId });
    const input = search.getInput();

    input.setAttribute(DATA_ATTR.testid, 'page-picker-search-input');
    search.on(SearchInputEvent.Search, ({ query }) => {
      this.startSearch(query);
      field.onQuery(query);
    });
    input.addEventListener('keydown', (event) => {
      this.handleKeydown(event);
    });
    popover.mountSearchField(search.getElement());
    // Blok's editor keys stand down: the field's arrows, Enter and Escape are the picker's.
    popover.getElement().setAttribute(DATA_ATTR.keyboardOwner, '');
    // The editor does not see this field's focus, so a press outside closes the picker.
    document.addEventListener('pointerdown', this.handleOutsidePointer, true);
    this.search = search;

    return search;
  }

  private readonly handleOutsidePointer = (event: Event): void => {
    const root = this.popover?.getElement();

    if (root !== undefined && event.target instanceof Node && !root.contains(event.target)) {
      this.close();
    }
  };

  private render(): void {
    const content = this.content;

    if (content === null) {
      return;
    }

    const visible = this.expanded ? this.results : this.results.slice(0, COLLAPSED_ROWS);
    const hidden = this.results.length - visible.length;
    const rows: HTMLElement[] = [];
    const entries: Entry[] = [];
    const add = ({ key, element, run }: Entry): void => {
      element.setAttribute('id', `${this.listboxId}-option-${entries.length}`);
      entries.push({ key, element, run });
      rows.push(element);
    };

    if (this.sectioned && (visible.length > 0 || this.loading)) {
      rows.push(this.buildHeader('link', this.t('toolNames.pageLink')));
    }
    visible.forEach((result) => add({
      key: `page:${result.pageId}`,
      element: this.buildPageOption(result),
      run: () => this.onChoose !== null ? this.onChoose(result.pageId) : this.pick(result.pageId),
    }));
    if (hidden > 0) {
      add({ key: 'more', element: this.buildMoreOption(hidden), run: () => this.expand() });
    }
    if (this.loading && this.results.length === 0) {
      rows.push(skeletonRow(), skeletonRow());
    }
    if (this.newPage !== null) {
      this.appendNewPageSection(this.newPage, rows, add);
    }

    this.entries = entries;
    this.activeIndex = entries.length === 0 ? -1 : Math.min(Math.max(this.activeIndex, 0), entries.length - 1);
    content.replaceChildren(...rows);
    if (this.loading) {
      this.listbox?.setAttribute('aria-busy', 'true');
    } else {
      this.listbox?.removeAttribute('aria-busy');
    }
    this.popover?.setNothingFound(this.answered && !this.loading && entries.length === 0);
    this.syncSelection();
  }

  private appendNewPageSection(newPage: PagePickerNewPage, rows: HTMLElement[], add: (entry: Entry) => void): void {
    const query = this.query;

    if (rows.length > 0) {
      const separator = document.createElement('div');
      const line = document.createElement('div');

      separator.setAttribute('role', 'presentation');
      separator.setAttribute(DATA_ATTR.testid, 'page-picker-separator');
      separator.className = 'py-1.5 px-2';
      line.className = 'h-px w-full bg-popover-border/60';
      separator.append(line);
      rows.push(separator);
    }
    rows.push(this.buildHeader('new', this.t('tools.page.mentionNewSection')));
    add({
      key: 'new:sub-page',
      element: this.buildActionOption('page-picker-new-sub-page', IconPlus,
        query === '' ? this.t('tools.page.mentionAddSubPage') : this.t('tools.page.mentionNewSubPage', { query: QUERY_MARK })),
      run: () => newPage.onSubPage(query),
    });
    add({
      key: 'new:page-in',
      element: this.buildActionOption('page-picker-new-page-in', IconArrowDiagonal,
        query === '' ? this.t('tools.page.mentionAddPageIn') : this.t('tools.page.mentionNewPageIn', { query: QUERY_MARK })),
      run: () => newPage.onPageIn(query),
    });
  }

  private expand(): void {
    this.expanded = true;
    this.render();
  }

  private buildHeader(name: 'link' | 'new', text: string): HTMLElement {
    const header = document.createElement('div');

    header.setAttribute('role', 'presentation');
    header.setAttribute('data-blok-page-picker-section', name);
    header.className = 'flex items-center gap-1.5 px-3 pt-2 pb-1 text-xs font-medium text-menu-section-label cursor-default select-none';
    header.textContent = text;
    if (name === 'link' && this.loading) {
      const spinner = document.createElement('span');

      // A listbox may own only options, so the spinner is hidden and the list is marked busy.
      spinner.setAttribute('aria-hidden', 'true');
      spinner.setAttribute('aria-label', this.t('tools.page.searching'));
      spinner.setAttribute(DATA_ATTR.testid, 'page-picker-spinner');
      spinner.className = 'inline-block size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent';
      header.append(spinner);
    }

    return header;
  }

  private buildRow(testid: string, icon: Node): { option: HTMLElement; body: HTMLElement } {
    const option = document.createElement('div');
    const slot = document.createElement('span');
    const body = document.createElement('div');

    option.setAttribute('role', 'option');
    option.setAttribute(DATA_ATTR.testid, testid);
    option.className = ROW_CLASSES;
    slot.className = PAGE_ICON_CLASSES;
    slot.setAttribute('aria-hidden', 'true');
    slot.setAttribute(DATA_ATTR.testid, 'page-picker-option-icon');
    slot.append(icon);
    // The icon markup's indentation would leak into the option's text name.
    [slot, ...Array.from(slot.querySelectorAll('*'))].forEach((element) => Array.from(element.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === '') {
        node.remove();
      }
    }));
    body.className = 'flex min-w-0 flex-1 flex-col';
    option.append(slot, body);
    option.addEventListener('pointerdown', (event) => event.preventDefault());
    option.addEventListener('click', () => this.activate(this.entries.findIndex((entry) => entry.element === option)));

    return { option, body };
  }

  private buildPageOption(result: PageSearchResult): HTMLElement {
    const { option, body } = this.buildRow('page-picker-option', pageIconNode(result.icon));
    const line = document.createElement('div');
    const title = document.createElement('span');

    line.className = 'flex items-center gap-1.5 min-w-0 leading-5';
    title.className = 'truncate';
    title.textContent = result.title || this.fallback;
    line.append(title);
    body.append(line);
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
      body.append(path);
    }

    return option;
  }

  private buildMoreOption(count: number): HTMLElement {
    const option = document.createElement('div');

    option.setAttribute('role', 'option');
    option.setAttribute(DATA_ATTR.testid, 'page-picker-more');
    option.className = `${ROW_FILL_CLASSES} block px-2 py-1.5 text-sm leading-5 text-text-secondary`;
    option.textContent = this.t('tools.page.moreResults', { count });
    option.addEventListener('pointerdown', (event) => event.preventDefault());
    option.addEventListener('click', () => this.activate(this.entries.findIndex((entry) => entry.element === option)));

    return option;
  }

  /** `label` holds QUERY_MARK where the query goes; the query is drawn bold, as text. */
  private buildActionOption(testid: string, icon: string, label: string): HTMLElement {
    const glyph = document.createElement('template');

    // A trusted constant from the icon module, not user input.
    glyph.innerHTML = icon;

    const { option, body } = this.buildRow(testid, glyph.content);
    const line = document.createElement('span');

    line.className = 'truncate leading-5';
    label.split(QUERY_MARK).forEach((part, index) => {
      if (index > 0) {
        const strong = document.createElement('strong');

        strong.className = 'font-semibold';
        strong.textContent = this.query;
        line.append(strong);
      }
      line.append(document.createTextNode(part));
    });
    body.append(line);

    return option;
  }

  private syncSelection(): void {
    this.entries.forEach(({ element, key }, index) => {
      element.setAttribute('aria-selected', String(index === this.activeIndex));
      element.style.setProperty('outline', this.keyboardNavigated && index === this.activeIndex
        ? '2px solid var(--blok-focus-ring)'
        : '');
      if (key === this.busyKey) {
        element.setAttribute('aria-busy', 'true');
      } else {
        element.removeAttribute('aria-busy');
      }
      element.style.setProperty('opacity', key === this.busyKey ? '0.5' : '');
    });
    const active = this.entries[this.activeIndex]?.element;

    if (active === undefined) {
      this.combobox?.removeAttribute('aria-activedescendant');
    } else {
      this.combobox?.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    }
  }
}
